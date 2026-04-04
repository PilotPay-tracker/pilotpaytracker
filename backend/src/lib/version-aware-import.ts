/**
 * Version-Aware Import Pipeline
 *
 * Wraps the canonical import pipeline to:
 * 1. Create Trip Versions (immutable snapshots) on every import
 * 2. Run Diff Engine when updating existing trips
 * 3. Detect severity of changes and create RosterChanges
 * 4. Apply pay protection logic
 * 5. Create audit records
 *
 * CRITICAL RULES:
 * - Trip Versions are IMMUTABLE - never deleted
 * - protected_credit set ONCE at baseline (v1), NEVER changes
 * - pay_credit = max(protected_credit, current_credit) - ALWAYS
 */

import { db } from "../db";
import {
  importToCanonicalStructure,
  type ParsedTripImport,
  type ImportSourceType,
  type CanonicalImportResult,
} from "./canonical-import-pipeline";
import {
  createTripVersion,
  evaluatePayCredit,
  getActiveVersion,
  setActiveVersion,
  tripToVersionScheduleData,
  createAuditRecord,
  generatePayOutcomeBanner,
  determineUserActionStatus,
  type CreateVersionInput,
  type PayCreditEvaluation,
} from "./trip-version-engine";
import {
  compareTripVersions,
  saveRosterChanges,
} from "./roster-diff-engine";
import type {
  TripVersionScheduleData,
  RosterChangeSeverity,
} from "../../../shared/contracts";

// ============================================
// TYPES
// ============================================

export interface VersionAwareImportResult extends CanonicalImportResult {
  // Version info
  versionId: string;
  versionNumber: number;
  isNewTrip: boolean;
  isFirstVersion: boolean;

  // Change detection
  hasChanges: boolean;
  overallSeverity: RosterChangeSeverity | null;
  requiresAck: boolean;
  hasPremiumCandidates: boolean;
  changeCount: number;

  // Pay protection
  payEvaluation: PayCreditEvaluation | null;

  // Roster changes (for UI)
  rosterChangeIds: string[];
}

export interface ImportOptions {
  sourceType: "import" | "manual" | "calendar_sync";
  sourceSnapshotId?: string;
  imageUrls?: string[];
  parseConfidence?: number;
  lowConfidenceFields?: string[];
  hourlyRateCents?: number;
}

// ============================================
// VERSION-AWARE IMPORT
// ============================================

/**
 * Import schedule with full version tracking
 *
 * Flow:
 * 1. Call canonical import (creates/updates trip structure)
 * 2. Load full trip with duty days and legs
 * 3. Convert to TripVersionScheduleData
 * 4. Create new TripVersion (immutable snapshot)
 * 5. If version > 1: run diff engine, create RosterChanges
 * 6. Evaluate pay credit
 * 7. Create audit records
 */
export async function importWithVersionTracking(
  userId: string,
  airlineCode: string,
  parsed: ParsedTripImport,
  tripId: string | undefined,
  options: ImportOptions
): Promise<VersionAwareImportResult> {
  // Check if trip already exists (to determine if this is an update)
  const existingTrip = tripId
    ? await db.trip.findUnique({
        where: { id: tripId },
        include: {
          tripDutyDays: {
            include: {
              legs: true,
              layover: true,
            },
            orderBy: { dutyDayIndex: "asc" },
          },
        },
      })
    : parsed.tripNumber || parsed.pairingId
    ? await db.trip.findFirst({
        where: {
          userId,
          OR: [
            parsed.tripNumber ? { tripNumber: parsed.tripNumber } : undefined,
            parsed.pairingId ? { pairingId: parsed.pairingId } : undefined,
          ].filter(Boolean) as any,
        },
        include: {
          tripDutyDays: {
            include: {
              legs: true,
              layover: true,
            },
            orderBy: { dutyDayIndex: "asc" },
          },
        },
      })
    : null;

  const isNewTrip = !existingTrip;
  const previousActiveVersion = existingTrip
    ? await getActiveVersion(existingTrip.id)
    : null;

  // 1. Call canonical import
  const canonicalResult = await importToCanonicalStructure(
    userId,
    airlineCode,
    parsed,
    tripId
  );

  // 2. Load full trip with all data
  const trip = await db.trip.findUnique({
    where: { id: canonicalResult.tripId },
    include: {
      tripDutyDays: {
        include: {
          legs: {
            orderBy: { legIndex: "asc" },
          },
          layover: true,
        },
        orderBy: { dutyDayIndex: "asc" },
      },
    },
  });

  if (!trip) {
    throw new Error("Trip not found after import");
  }

  // Calculate and persist totalPayCents if hourlyRateCents is provided
  // The canonical import pipeline does not compute pay — we do it here
  if (options.hourlyRateCents && options.hourlyRateCents > 0 && trip.totalCreditMinutes > 0) {
    const tripPayCents = Math.round((trip.totalCreditMinutes / 60) * options.hourlyRateCents);
    await db.trip.update({
      where: { id: trip.id },
      data: {
        totalPayCents: tripPayCents,
        payCreditMinutes: trip.totalCreditMinutes,
        currentCreditMinutes: trip.currentCreditMinutes || trip.totalCreditMinutes,
        protectedCreditMinutes: trip.protectedCreditMinutes || trip.totalCreditMinutes,
      },
    });
    console.log(`[VersionImport] Calculated pay for trip ${trip.id}: ${trip.totalCreditMinutes} cr min → $${(tripPayCents / 100).toFixed(2)}`);
  }

  // 3. Convert to TripVersionScheduleData
  const scheduleData = tripToVersionScheduleData({
    tripNumber: trip.tripNumber,
    pairingId: trip.pairingId,
    baseFleet: trip.baseFleet,
    startDate: trip.startDate,
    endDate: trip.endDate,
    totalCreditMinutes: trip.totalCreditMinutes,
    totalBlockMinutes: trip.totalBlockMinutes,
    totalTafbMinutes: trip.totalTafbMinutes,
    dutyDaysCount: trip.dutyDaysCount,
    legCount: trip.legCount,
    tripDutyDays: trip.tripDutyDays.map((dd) => ({
      dutyDayIndex: dd.dutyDayIndex,
      dutyDate: dd.dutyDate,
      reportTimeISO: dd.reportTimeISO,
      releaseTimeISO: dd.releaseTimeISO,
      dutyMinutes: dd.dutyMinutes,
      blockMinutes: dd.blockMinutes,
      creditMinutes: dd.creditMinutes,
      restAfterMinutes: dd.restAfterMinutes,
      layoverStation: dd.layoverStation,
      legs: dd.legs.map((leg) => ({
        legIndex: leg.legIndex,
        flightNumber: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        equipment: leg.equipment,
        isDeadhead: leg.isDeadhead,
        scheduledOutISO: leg.scheduledOutISO,
        scheduledInISO: leg.scheduledInISO,
        plannedBlockMinutes: leg.plannedBlockMinutes,
        plannedCreditMinutes: leg.plannedCreditMinutes,
      })),
      layover: dd.layover
        ? {
            station: dd.layover.station,
            restMinutes: dd.layover.restMinutes,
            hotelName: dd.layover.hotelName,
            hotelPhone: dd.layover.hotelPhone,
          }
        : null,
    })),
  });

  // 4. Create new TripVersion
  const versionInput: CreateVersionInput = {
    tripId: trip.id,
    userId,
    scheduleData,
    sourceType: options.sourceType,
    sourceSnapshotId: options.sourceSnapshotId,
    imageUrls: options.imageUrls,
    parseConfidence: options.parseConfidence,
    lowConfidenceFields: options.lowConfidenceFields,
  };

  const newVersion = await createTripVersion(versionInput);
  const isFirstVersion = newVersion.versionNumber === 1;

  // Initialize result
  const result: VersionAwareImportResult = {
    ...canonicalResult,
    versionId: newVersion.id,
    versionNumber: newVersion.versionNumber,
    isNewTrip,
    isFirstVersion,
    hasChanges: false,
    overallSeverity: null,
    requiresAck: false,
    hasPremiumCandidates: false,
    changeCount: 0,
    payEvaluation: null,
    rosterChangeIds: [],
  };

  // 5. If version > 1: run diff engine
  if (!isFirstVersion && previousActiveVersion) {
    // Parse previous version's schedule data
    let previousScheduleData: TripVersionScheduleData;
    try {
      previousScheduleData = JSON.parse(previousActiveVersion.scheduleData);
    } catch {
      console.error("Failed to parse previous version schedule data");
      previousScheduleData = scheduleData; // Fallback to current (no changes)
    }

    // Run diff engine
    const diffResult = compareTripVersions(
      previousScheduleData,
      scheduleData,
      options.hourlyRateCents ?? 0
    );

    result.hasChanges = diffResult.changes.length > 0;
    result.overallSeverity = diffResult.overallSeverity;
    result.requiresAck = diffResult.requiresAck;
    result.hasPremiumCandidates = diffResult.hasPremiumCandidates;
    result.changeCount = diffResult.changes.length;

    // Save roster changes to database
    if (diffResult.changes.length > 0) {
      await saveRosterChanges(
        userId,
        trip.id,
        previousActiveVersion.id,
        newVersion.id,
        diffResult
      );

      // Get the created change IDs
      const savedChanges = await db.rosterChange.findMany({
        where: {
          tripId: trip.id,
          newVersionId: newVersion.id,
        },
        select: { id: true },
      });
      result.rosterChangeIds = savedChanges.map((c) => c.id);

      // Update trip to show pending changes
      await db.trip.update({
        where: { id: trip.id },
        data: {
          hasChangePending: diffResult.requiresAck,
          changePendingSince: diffResult.requiresAck ? new Date() : null,
          pendingVersionId: diffResult.requiresAck ? newVersion.id : null,
        },
      });

      // Create audit record for roster change
      await createAuditRecord({
        userId,
        recordType: "roster_change_detected",
        tripId: trip.id,
        tripVersionId: newVersion.id,
        title: `Roster Change Detected — ${capitalizeFirst(diffResult.overallSeverity)}`,
        summary: `${diffResult.changes.length} change(s) detected. ${
          diffResult.requiresAck
            ? "Acknowledgment required."
            : "Auto-applied."
        }`,
        severity: diffResult.overallSeverity,
        creditContext: {
          protected: 0, // Will be filled by pay evaluation
          current: scheduleData.totals.creditMinutes,
          pay: 0,
          delta: diffResult.creditDiffMinutes,
        },
        payContext: {
          estimatedPayImpactCents: diffResult.estimatedPayDiffCents,
        },
      });

      // If minor changes, auto-apply (set as active)
      if (!diffResult.requiresAck) {
        await setActiveVersion(trip.id, newVersion.id, userId);
      }
    } else {
      // No changes - auto-apply
      await setActiveVersion(trip.id, newVersion.id, userId);
    }
  }

  // 6. Evaluate pay credit (for all versions after baseline)
  if (!isFirstVersion) {
    result.payEvaluation = await evaluatePayCredit(
      trip.id,
      scheduleData.totals.creditMinutes,
      newVersion.id,
      options.hourlyRateCents ?? 0
    );

    // Update audit record credit context if we have one
    if (result.rosterChangeIds.length > 0 && result.payEvaluation) {
      // Get the latest audit record for this version
      const latestAudit = await db.auditRecord.findFirst({
        where: {
          tripVersionId: newVersion.id,
          recordType: "roster_change_detected",
        },
        orderBy: { createdAt: "desc" },
      });

      if (latestAudit) {
        await db.auditRecord.update({
          where: { id: latestAudit.id },
          data: {
            creditContext: JSON.stringify({
              protected: result.payEvaluation.protectedCreditMinutes,
              current: result.payEvaluation.currentCreditMinutes,
              pay: result.payEvaluation.payCreditMinutes,
              delta: result.payEvaluation.creditDeltaMinutes,
            }),
          },
        });
      }
    }
  }

  return result;
}

/**
 * Quick check if a trip has pending changes requiring acknowledgment
 */
export async function getTripChangeStatus(tripId: string) {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      hasChangePending: true,
      changePendingSince: true,
      pendingVersionId: true,
      activeVersionId: true,
    },
  });

  if (!trip) return null;

  const pendingChanges = trip.hasChangePending
    ? await db.rosterChange.findMany({
        where: {
          tripId,
          acknowledged: false,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const payProtection = await db.tripPayProtection.findUnique({
    where: { tripId },
  });

  return {
    hasChangePending: trip.hasChangePending,
    changePendingSince: trip.changePendingSince,
    pendingVersionId: trip.pendingVersionId,
    activeVersionId: trip.activeVersionId,
    pendingChanges,
    payProtection,
  };
}

/**
 * Acknowledge roster changes and apply the pending version
 */
export async function acknowledgeRosterChanges(
  tripId: string,
  userId: string,
  changeIds: string[]
): Promise<{ success: boolean; newActiveVersionId: string | null }> {
  // Verify user owns this trip
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      userId: true,
      pendingVersionId: true,
    },
  });

  if (!trip || trip.userId !== userId) {
    throw new Error("Trip not found or access denied");
  }

  if (!trip.pendingVersionId) {
    return { success: true, newActiveVersionId: null };
  }

  // Acknowledge all provided changes
  await db.rosterChange.updateMany({
    where: {
      id: { in: changeIds },
      tripId,
      userId,
    },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
    },
  });

  // Check if all changes for this trip are now acknowledged
  const remainingUnacked = await db.rosterChange.count({
    where: {
      tripId,
      acknowledged: false,
    },
  });

  if (remainingUnacked === 0) {
    // All acknowledged - apply pending version
    await setActiveVersion(tripId, trip.pendingVersionId, userId);
    return { success: true, newActiveVersionId: trip.pendingVersionId };
  }

  return { success: true, newActiveVersionId: null };
}

// ============================================
// HELPERS
// ============================================

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
