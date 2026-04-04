/**
 * Trip Conflict Detector
 *
 * Detects overlapping trips before import to prevent duplicate/conflicting trips.
 *
 * 3-TIER CONFLICT DETECTION RULES:
 *
 * TIER 1 - HARD CONFLICT (EXACT DUPLICATE):
 * - Same pairingId or tripNumber
 * - Outcome: Block import, show modal with "Duplicate pairing detected"
 * - Recommendation: Replace existing
 *
 * TIER 2 - HARD CONFLICT (TRUE TIME OVERLAP):
 * - Duty/flight time windows actually overlap (report → release times)
 * - Outcome: Block import, show modal with "Overlaps on Jan 11 by Xh Ym"
 * - Recommendation: User must decide
 *
 * TIER 3 - SOFT CONFLICT (SAME DAY, NO TIME OVERLAP):
 * - Same calendar day but non-overlapping duty times
 * - Pilots can have multiple valid pairings on the same day
 * - Outcome: DO NOT BLOCK import
 * - Default recommendation: KEEP BOTH
 */

import { db } from "../db";
import type {
  TripConflict,
  TripConflictType,
  ConflictTripSummary,
  ConflictDecision,
} from "../../../shared/contracts";

// ============================================
// Types
// ============================================

export interface ConflictCheckInput {
  userId: string;
  startDate: string;
  endDate: string;
  tripNumber?: string | null;
  pairingId?: string | null;
  dutyDates?: string[]; // Specific duty day dates
  dutyTimes?: Array<{
    date: string;
    reportTimeISO?: string;
    releaseTimeISO?: string;
  }>; // Duty time windows for precise overlap detection
  excludeTripId?: string; // For re-imports, exclude the trip being updated
  // For populating newTripSummary with actual values
  totalCreditMinutes?: number;
  totalBlockMinutes?: number;
  legCount?: number;
  routeHighlights?: string;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: TripConflict[];
  newTripSummary: ConflictTripSummary;
  recommendedAction: ConflictDecision | null;
  // Additional info for UX
  conflictTier: "hard_duplicate" | "hard_time_overlap" | "soft_same_day" | "none";
  overlapSummary?: string; // e.g., "Overlaps on Jan 11 by 2h 30m"
}

// ============================================
// Helpers
// ============================================

/**
 * Build route highlights string from trip's legs
 */
async function buildRouteHighlights(tripId: string): Promise<string> {
  const tripDutyDays = await db.tripDutyDay.findMany({
    where: { tripId },
    include: {
      legs: {
        orderBy: { legIndex: "asc" },
        select: { origin: true, destination: true },
      },
    },
    orderBy: { dutyDayIndex: "asc" },
  });

  const stations: string[] = [];
  for (const dd of tripDutyDays) {
    for (const leg of dd.legs) {
      if (leg.origin && !stations.includes(leg.origin)) {
        stations.push(leg.origin);
      }
      if (leg.destination && !stations.includes(leg.destination)) {
        stations.push(leg.destination);
      }
    }
  }

  // If no legs found, try duty days
  if (stations.length === 0) {
    const dutyDays = await db.dutyDay.findMany({
      where: { tripId },
      include: {
        legs: {
          orderBy: { legIndex: "asc" },
          select: { origin: true, destination: true },
        },
      },
      orderBy: { dutyDate: "asc" },
    });

    for (const dd of dutyDays) {
      for (const leg of dd.legs) {
        if (leg.origin && !stations.includes(leg.origin)) {
          stations.push(leg.origin);
        }
        if (leg.destination && !stations.includes(leg.destination)) {
          stations.push(leg.destination);
        }
      }
    }
  }

  return stations.slice(0, 5).join("-") || "N/A";
}

/**
 * Convert a trip to ConflictTripSummary
 */
async function tripToSummary(trip: {
  id: string;
  tripNumber: string | null;
  pairingId: string | null;
  startDate: string;
  endDate: string;
  totalCreditMinutes: number;
  dutyDaysCount: number;
  legCount: number;
  status?: string;
}): Promise<ConflictTripSummary> {
  const routeHighlights = await buildRouteHighlights(trip.id);

  return {
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    pairingId: trip.pairingId,
    startDate: trip.startDate,
    endDate: trip.endDate,
    totalCreditMinutes: trip.totalCreditMinutes,
    dutyDaysCount: trip.dutyDaysCount,
    legCount: trip.legCount,
    routeHighlights,
    isOverride: trip.status === "override",
  };
}

/**
 * Get dates that overlap between two date ranges
 */
function getOverlappingDates(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): string[] {
  const dates: string[] = [];
  const rangeStart = new Date(Math.max(new Date(start1).getTime(), new Date(start2).getTime()));
  const rangeEnd = new Date(Math.min(new Date(end1).getTime(), new Date(end2).getTime()));

  const current = new Date(rangeStart);
  while (current <= rangeEnd) {
    dates.push(current.toISOString().split("T")[0]!);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Check if two time windows overlap and calculate overlap duration
 */
function checkTimeOverlap(
  start1ISO: string | null | undefined,
  end1ISO: string | null | undefined,
  start2ISO: string | null | undefined,
  end2ISO: string | null | undefined
): { overlaps: boolean; overlapMinutes: number } {
  // If any time is missing, we can't determine overlap - assume no conflict
  if (!start1ISO || !end1ISO || !start2ISO || !end2ISO) {
    return { overlaps: false, overlapMinutes: 0 };
  }

  const start1 = new Date(start1ISO).getTime();
  const end1 = new Date(end1ISO).getTime();
  const start2 = new Date(start2ISO).getTime();
  const end2 = new Date(end2ISO).getTime();

  // No overlap if one ends before the other starts
  if (end1 <= start2 || end2 <= start1) {
    return { overlaps: false, overlapMinutes: 0 };
  }

  // Calculate overlap
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);
  const overlapMinutes = Math.round((overlapEnd - overlapStart) / 60000);

  return { overlaps: true, overlapMinutes };
}

/**
 * Format overlap duration for display
 */
function formatOverlapDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

/**
 * Calculate severity score for a conflict (0-100)
 */
function calculateSeverityScore(
  conflictType: TripConflictType,
  overlappingDates: string[],
  existingTrip: { totalCreditMinutes: number; legCount: number },
  overlapMinutes: number = 0
): number {
  let score = 0;

  // Base score by conflict type
  switch (conflictType) {
    case "duplicate_trip":
      score = 95; // Very high - definite re-import
      break;
    case "duty_day_overlap":
      // For actual time overlap, score based on overlap duration
      if (overlapMinutes > 0) {
        score = 85; // High - real time conflict
      } else {
        score = 40; // Low - same day but no time overlap (SOFT conflict)
      }
      break;
    case "date_overlap":
      score = 60; // Medium - date ranges overlap
      break;
    case "same_calendar_day":
      score = 30; // Low - just same day, likely valid (SOFT conflict)
      break;
  }

  // Adjust by overlap amount (only for time-based overlaps)
  if (overlapMinutes > 240) { // >4 hours overlap
    score = Math.min(100, score + 10);
  } else if (overlapMinutes > 60) { // >1 hour overlap
    score = Math.min(100, score + 5);
  }

  // Adjust by existing trip significance
  if (existingTrip.totalCreditMinutes > 300) { // >5 hours
    score = Math.min(100, score + 3);
  }
  if (existingTrip.legCount >= 4) {
    score = Math.min(100, score + 2);
  }

  return score;
}

// ============================================
// Main Conflict Detection
// ============================================

/**
 * Check for conflicts before importing a trip
 *
 * Returns 3-tier conflict classification:
 * - hard_duplicate: Same trip (block import)
 * - hard_time_overlap: Duty times overlap (block import)
 * - soft_same_day: Same day but no overlap (allow import, recommend keep both)
 * - none: No conflicts
 */
export async function checkTripConflicts(
  input: ConflictCheckInput
): Promise<ConflictCheckResult> {
  const {
    userId,
    startDate,
    endDate,
    tripNumber,
    pairingId,
    dutyDates,
    dutyTimes,
    excludeTripId,
    totalCreditMinutes: inputCreditMinutes,
    totalBlockMinutes: inputBlockMinutes,
    legCount: inputLegCount,
    routeHighlights: inputRouteHighlights,
  } = input;

  const conflicts: TripConflict[] = [];
  let conflictTier: ConflictCheckResult["conflictTier"] = "none";
  let overlapSummary: string | undefined;
  let totalOverlapMinutes = 0;

  console.log(`🔍 [Conflict] Checking conflicts for user ${userId}: ${startDate} to ${endDate}`);
  console.log(`  Duty dates: ${dutyDates?.join(", ") || "not provided"}`);

  // ============================================
  // TIER 1: Check for EXACT DUPLICATE (same tripNumber or pairingId)
  // ============================================
  if (tripNumber || pairingId) {
    const duplicateTrip = await db.trip.findFirst({
      where: {
        userId,
        id: excludeTripId ? { not: excludeTripId } : undefined,
        OR: [
          tripNumber ? { tripNumber } : undefined,
          pairingId ? { pairingId } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (duplicateTrip) {
      console.log(`  🚨 TIER 1 - HARD CONFLICT: Duplicate trip found: ${duplicateTrip.id} (${duplicateTrip.tripNumber || duplicateTrip.pairingId})`);
      const summary = await tripToSummary(duplicateTrip);
      const overlappingDates = getOverlappingDates(startDate, endDate, duplicateTrip.startDate, duplicateTrip.endDate);

      conflicts.push({
        conflictType: "duplicate_trip",
        existingTrip: summary,
        overlappingDates,
        severityScore: calculateSeverityScore("duplicate_trip", overlappingDates, duplicateTrip),
      });

      conflictTier = "hard_duplicate";
      overlapSummary = `Duplicate pairing detected: ${duplicateTrip.tripNumber || duplicateTrip.pairingId}`;
    }
  }

  // ============================================
  // TIER 2 & 3: Check for TIME OVERLAP vs SAME DAY
  // ============================================
  if (dutyTimes && dutyTimes.length > 0) {
    // Get all existing trips that might overlap by date
    const potentialOverlapTrips = await db.trip.findMany({
      where: {
        userId,
        id: excludeTripId ? { not: excludeTripId } : undefined,
        NOT: {
          OR: [
            { endDate: { lt: startDate } },
            { startDate: { gt: endDate } },
          ],
        },
      },
      include: {
        tripDutyDays: {
          select: {
            dutyDate: true,
            reportTimeISO: true,
            releaseTimeISO: true,
          },
        },
      },
    });

    for (const existingTrip of potentialOverlapTrips) {
      // Skip if already flagged as duplicate
      if (conflicts.some(c => c.existingTrip.tripId === existingTrip.id)) {
        continue;
      }

      let hasTimeOverlap = false;
      let tripOverlapMinutes = 0;
      const overlappingDates: string[] = [];

      // Check each incoming duty day against existing duty days
      for (const incomingDuty of dutyTimes) {
        const existingDutyOnSameDate = existingTrip.tripDutyDays.find(
          d => d.dutyDate === incomingDuty.date
        );

        if (existingDutyOnSameDate) {
          // Check for actual time window overlap
          const { overlaps, overlapMinutes } = checkTimeOverlap(
            incomingDuty.reportTimeISO,
            incomingDuty.releaseTimeISO,
            existingDutyOnSameDate.reportTimeISO,
            existingDutyOnSameDate.releaseTimeISO
          );

          if (overlaps) {
            hasTimeOverlap = true;
            tripOverlapMinutes += overlapMinutes;
            if (!overlappingDates.includes(incomingDuty.date)) {
              overlappingDates.push(incomingDuty.date);
            }
          } else {
            // Same day but NO time overlap - this is a SOFT conflict
            // Don't add to overlappingDates unless we have time info
            if (!incomingDuty.reportTimeISO || !existingDutyOnSameDate.reportTimeISO) {
              // No time data - treat as potential conflict
              if (!overlappingDates.includes(incomingDuty.date)) {
                overlappingDates.push(incomingDuty.date);
              }
            }
            // If we have time data and no overlap, pilot can have both trips
          }
        }
      }

      if (hasTimeOverlap) {
        // TIER 2: HARD CONFLICT - True time overlap
        console.log(`  🚨 TIER 2 - HARD CONFLICT: Time overlap with trip ${existingTrip.id} - ${formatOverlapDuration(tripOverlapMinutes)} overlap`);
        const summary = await tripToSummary(existingTrip);

        conflicts.push({
          conflictType: "duty_day_overlap",
          existingTrip: summary,
          overlappingDates,
          severityScore: calculateSeverityScore("duty_day_overlap", overlappingDates, existingTrip, tripOverlapMinutes),
        });

        if (conflictTier !== "hard_duplicate") {
          conflictTier = "hard_time_overlap";
        }
        totalOverlapMinutes += tripOverlapMinutes;

        // Build overlap summary for first overlapping date
        if (overlappingDates[0]) {
          const dateDisplay = new Date(overlappingDates[0] + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          overlapSummary = `Overlaps on ${dateDisplay} by ${formatOverlapDuration(tripOverlapMinutes)}`;
        }
      }
    }
  }

  // ============================================
  // FALLBACK: Check date range overlap (legacy behavior)
  // ============================================
  if (conflicts.length === 0 || (!dutyTimes || dutyTimes.length === 0)) {
    const excludeIds = [
      ...conflicts.map(c => c.existingTrip.tripId),
      ...(excludeTripId ? [excludeTripId] : []),
    ];

    const overlappingTrips = await db.trip.findMany({
      where: {
        userId,
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
        NOT: {
          OR: [
            { endDate: { lt: startDate } },
            { startDate: { gt: endDate } },
          ],
        },
      },
    });

    for (const trip of overlappingTrips) {
      if (conflicts.some(c => c.existingTrip.tripId === trip.id)) {
        continue;
      }

      const overlappingDates = getOverlappingDates(startDate, endDate, trip.startDate, trip.endDate);

      if (overlappingDates.length > 0) {
        // Date overlap is a HARD conflict - user must choose how to handle
        // This is likely a company revision, swap, or duplicate import
        console.log(`  🚨 TIER 2 - HARD CONFLICT: Date overlap with trip ${trip.id} (${trip.tripNumber}) - ${overlappingDates.length} days`);
        const summary = await tripToSummary(trip);

        // Increase severity for date overlaps - these are real conflicts requiring user decision
        const severityScore = Math.max(65, calculateSeverityScore("date_overlap", overlappingDates, trip, 0));

        conflicts.push({
          conflictType: "date_overlap",
          existingTrip: summary,
          overlappingDates,
          severityScore,
        });

        // Date overlap is a hard conflict - must show modal for protected credit decision
        if (conflictTier === "none") {
          conflictTier = "hard_time_overlap";
        }
      }
    }
  }

  // ============================================
  // Check duty day overlap from parsed dutyDates (legacy fallback)
  // ============================================
  if (dutyDates && dutyDates.length > 0 && (!dutyTimes || dutyTimes.length === 0)) {
    const tripIdsWithOverlappingDutyDays = await db.tripDutyDay.findMany({
      where: {
        trip: {
          userId,
          id: excludeTripId ? { not: excludeTripId } : undefined,
        },
        dutyDate: { in: dutyDates },
      },
      select: {
        tripId: true,
        dutyDate: true,
        reportTimeISO: true,
        releaseTimeISO: true,
        trip: true,
      },
      distinct: ["tripId"],
    });

    for (const result of tripIdsWithOverlappingDutyDays) {
      if (conflicts.some(c => c.existingTrip.tripId === result.tripId)) {
        continue;
      }

      const allOverlappingDutyDays = await db.tripDutyDay.findMany({
        where: {
          tripId: result.tripId,
          dutyDate: { in: dutyDates },
        },
        select: { dutyDate: true },
      });

      const overlappingDates = allOverlappingDutyDays.map(d => d.dutyDate);

      // Without time info, treat as soft conflict
      console.log(`  ⚠️ TIER 3 - SOFT CONFLICT: Duty day on same date with trip ${result.tripId} - ${overlappingDates.length} days`);
      const summary = await tripToSummary(result.trip);

      conflicts.push({
        conflictType: "same_calendar_day",
        existingTrip: summary,
        overlappingDates,
        severityScore: calculateSeverityScore("same_calendar_day", overlappingDates, result.trip, 0),
      });

      if (conflictTier === "none") {
        conflictTier = "soft_same_day";
      }
    }
  }

  // Sort conflicts by severity (highest first)
  conflicts.sort((a, b) => b.severityScore - a.severityScore);

  // ============================================
  // Determine recommended action based on tier
  // ============================================
  let recommendedAction: ConflictDecision | null = null;

  if (conflicts.length > 0) {
    const highestSeverity = conflicts[0]!.severityScore;
    // Check if this looks like a company revision (same/similar trip number)
    const isDuplicateLike = conflicts.some(c => c.conflictType === "duplicate_trip");
    const isDateOverlap = conflicts.some(c => c.conflictType === "date_overlap");

    switch (conflictTier) {
      case "hard_duplicate":
        // Duplicate trip - recommend company revision (protected credit)
        recommendedAction = "company_revision";
        break;

      case "hard_time_overlap":
        // Date/time overlap - most likely a company revision or swap
        // Recommend company revision to protect pilot pay
        if (isDuplicateLike || isDateOverlap) {
          recommendedAction = "company_revision";
        } else {
          recommendedAction = null; // Let user decide
        }
        break;

      case "soft_same_day":
        // Same day but no proven overlap - pilots can have multiple trips
        // RECOMMEND: Keep Both
        recommendedAction = "keep_both_override";
        break;

      default:
        recommendedAction = null;
    }
  }

  // ============================================
  // Build newTripSummary with ACTUAL values (not placeholders)
  // ============================================
  const newTripSummary: ConflictTripSummary = {
    tripId: "", // Will be assigned after creation
    tripNumber: tripNumber ?? null,
    pairingId: pairingId ?? null,
    startDate,
    endDate,
    totalCreditMinutes: inputCreditMinutes ?? 0,
    dutyDaysCount: dutyDates?.length ?? dutyTimes?.length ?? 0,
    legCount: inputLegCount ?? 0,
    routeHighlights: inputRouteHighlights ?? "N/A",
    isOverride: false,
  };

  console.log(`🔍 [Conflict] Result: ${conflicts.length} conflicts found (Tier: ${conflictTier})`);
  if (recommendedAction) {
    console.log(`  Recommended action: ${recommendedAction}`);
  }

  // ============================================
  // SOFT CONFLICTS: Only same_calendar_day without overlap
  // ============================================
  // date_overlap conflicts are HARD conflicts - user must decide about pay protection
  // same_calendar_day with low severity (no time overlap confirmed) can be auto-allowed
  const hasOnlyMinorConflicts = conflicts.every(c =>
    (c.severityScore < 50 && c.conflictType === "same_calendar_day")
  );

  return {
    // Date overlap is a HARD conflict requiring user decision for pay protection
    // Only same_calendar_day conflicts with confirmed no overlap are soft
    hasConflicts: conflictTier === "hard_duplicate" || conflictTier === "hard_time_overlap" || (conflicts.length > 0 && !hasOnlyMinorConflicts),
    conflicts,
    newTripSummary,
    recommendedAction,
    conflictTier,
    overlapSummary: overlapSummary || (totalOverlapMinutes > 0 ? `Total overlap: ${formatOverlapDuration(totalOverlapMinutes)}` : undefined),
  };
}

// ============================================
// Conflict Resolution
// ============================================

export interface ResolveConflictInput {
  userId: string;
  decision: ConflictDecision;
  conflictingTripIds: string[];
  acknowledgmentNote?: string;
  // For "replace_trip" decision
  replaceTripReason?: "dropped_traded" | "company_pulled" | "not_sure";
  // For "company_revision" - the new trip data
  newTripData?: {
    totalCreditMinutes?: number;
    totalBlockMinutes?: number;
    dutyDays?: Array<{
      date: string;
      creditMinutes?: number;
      blockMinutes?: number;
    }>;
    legs?: Array<{
      dutyDate: string;
      flightNumber?: string;
      origin?: string;
      destination?: string;
    }>;
  };
}

export interface ResolveConflictResult {
  deletedTripIds: string[];
  archivedTripIds: string[];
  isOverride: boolean;
  auditRecordId: string | null;
  // For company_revision
  protectedCreditResult?: {
    oldCreditMinutes: number;
    newCreditMinutes: number;
    protectedCreditMinutes: number;
    changedDutyDays: string[];
  };
  // Updated trip ID (for company_revision)
  updatedTripId?: string;
}

/**
 * Execute conflict resolution based on user decision
 *
 * NEW DECISIONS (v2):
 * - company_revision: Update existing trip with new data, apply protected credit
 * - replace_trip: Archive old trip, import new one
 * - cancel: No action
 *
 * LEGACY DECISIONS (mapped):
 * - replace_existing → replace_trip (delete instead of archive for backwards compat)
 */
export async function resolveConflict(
  input: ResolveConflictInput
): Promise<ResolveConflictResult> {
  const { userId, decision, conflictingTripIds, acknowledgmentNote, replaceTripReason, newTripData } = input;

  console.log(`🔧 [Conflict] Resolving conflict with decision: ${decision}`);

  const result: ResolveConflictResult = {
    deletedTripIds: [],
    archivedTripIds: [],
    isOverride: false,
    auditRecordId: null,
  };

  // ============================================
  // CANCEL - No action
  // ============================================
  if (decision === "cancel") {
    // No action needed - caller should abort import
    return result;
  }

  // ============================================
  // COMPANY REVISION (Protected Credit)
  // ============================================
  if (decision === "company_revision") {
    // Get the existing trip (first conflicting trip)
    const existingTripId = conflictingTripIds[0];
    if (!existingTripId) {
      console.log(`  ⚠️ No existing trip ID provided for company_revision`);
      return result;
    }

    const existingTrip = await db.trip.findFirst({
      where: { id: existingTripId, userId },
      include: {
        tripDutyDays: {
          include: { legs: true },
          orderBy: { dutyDayIndex: "asc" },
        },
      },
    });

    if (!existingTrip) {
      console.log(`  ⚠️ Trip ${existingTripId} not found or not owned by user`);
      return result;
    }

    // Calculate protected credit: max(old, new)
    const oldCreditMinutes = existingTrip.totalCreditMinutes;
    const newCreditMinutes = newTripData?.totalCreditMinutes ?? 0;
    const protectedCreditMinutes = Math.max(oldCreditMinutes, newCreditMinutes);

    console.log(`  📊 Company Revision: old=${oldCreditMinutes}, new=${newCreditMinutes}, protected=${protectedCreditMinutes}`);

    // Find which duty days changed
    const changedDutyDays: string[] = [];
    if (newTripData?.dutyDays) {
      for (const newDutyDay of newTripData.dutyDays) {
        const existingDutyDay = existingTrip.tripDutyDays.find(d => d.dutyDate === newDutyDay.date);
        if (existingDutyDay) {
          // Check if credit changed
          if ((newDutyDay.creditMinutes ?? 0) !== existingDutyDay.creditMinutes) {
            changedDutyDays.push(newDutyDay.date);
          }
        } else {
          // New duty day
          changedDutyDays.push(newDutyDay.date);
        }
      }
    }

    // Update the trip with protected credit logic
    // The original trip ID is kept (continuity), but data is updated
    await db.trip.update({
      where: { id: existingTripId },
      data: {
        // Apply protected credit
        currentCreditMinutes: newCreditMinutes,
        // protectedCreditMinutes stays unchanged (was set on first import)
        payCreditMinutes: protectedCreditMinutes,
        // Update block time if provided
        totalBlockMinutes: newTripData?.totalBlockMinutes ?? existingTrip.totalBlockMinutes,
        // Mark as having a schedule change
        hasChangePending: false,
        needsReview: false,
        // Mark duty days as changed
        changeSeverity: changedDutyDays.length > 0 ? "moderate" : "minor",
      },
    });

    // Mark affected duty days as "Changed" with visual outline
    for (const dutyDate of changedDutyDays) {
      await db.tripDutyDay.updateMany({
        where: { tripId: existingTripId, dutyDate },
        data: {
          hasScheduleChange: true,
          scheduleChangeAt: new Date(),
          scheduleChangeReason: "company_revision",
        },
      });
    }

    result.updatedTripId = existingTripId;
    result.protectedCreditResult = {
      oldCreditMinutes,
      newCreditMinutes,
      protectedCreditMinutes,
      changedDutyDays,
    };

    // Create detailed audit record
    const auditRecord = await db.auditRecord.create({
      data: {
        userId,
        recordType: "company_revision",
        tripId: existingTripId,
        title: "Company Revision Applied",
        summary: `Company revision applied to trip ${existingTrip.tripNumber || existingTripId}. ` +
          `Old credit: ${formatCreditTime(oldCreditMinutes)}, ` +
          `New credit: ${formatCreditTime(newCreditMinutes)}, ` +
          `Protected credit: ${formatCreditTime(protectedCreditMinutes)}. ` +
          `${changedDutyDays.length} duty day(s) affected. ` +
          (acknowledgmentNote || ""),
        metadata: JSON.stringify({
          decision,
          existingTripId,
          oldCreditMinutes,
          newCreditMinutes,
          protectedCreditMinutes,
          changedDutyDays,
          affectedLegs: newTripData?.legs?.map(l => `${l.origin}-${l.destination}`),
          note: acknowledgmentNote,
        }),
        severity: protectedCreditMinutes > newCreditMinutes ? "pay_protected" : "none",
        creditContext: JSON.stringify({
          protected: existingTrip.protectedCreditMinutes,
          current: newCreditMinutes,
          pay: protectedCreditMinutes,
          delta: newCreditMinutes - oldCreditMinutes,
        }),
      },
    });
    result.auditRecordId = auditRecord.id;

    // Create a PayEvent for the log
    await db.payEvent.create({
      data: {
        userId,
        tripId: existingTripId,
        eventType: "SCHEDULE_CHANGE",
        eventDateISO: new Date().toISOString().split("T")[0] ?? new Date().toISOString().slice(0, 10),
        title: `Company Revision — Trip ${existingTrip.tripNumber || ""}`,
        description: `Company modified the assignment. Original credit: ${formatCreditTime(oldCreditMinutes)}, ` +
          `Revised credit: ${formatCreditTime(newCreditMinutes)}, ` +
          `Protected credit applied: ${formatCreditTime(protectedCreditMinutes)}. ` +
          `Affected dates: ${changedDutyDays.join(", ") || "N/A"}`,
        newCreditMinutes,
        creditDifferenceMinutes: newCreditMinutes - oldCreditMinutes,
        status: "resolved",
      },
    });

    console.log(`  ✅ Company Revision applied to trip: ${existingTripId}`);
    return result;
  }

  // ============================================
  // REPLACE TRIP (Swap / Open Time)
  // ============================================
  if (decision === "replace_trip" || decision === "replace_existing") {
    // Archive existing trips (don't delete - preserve for records)
    for (const tripId of conflictingTripIds) {
      const trip = await db.trip.findFirst({
        where: { id: tripId, userId },
      });

      if (!trip) {
        console.log(`  ⚠️ Trip ${tripId} not found or not owned by user`);
        continue;
      }

      // For legacy "replace_existing", delete the trip
      // For new "replace_trip", archive it (set status to archived, exclude from totals)
      if (decision === "replace_existing") {
        // LEGACY: Delete the trip
        await db.trip.delete({
          where: { id: tripId },
        });
        result.deletedTripIds.push(tripId);
        console.log(`  🗑️ Deleted trip (legacy): ${tripId} (${trip.tripNumber})`);
      } else {
        // NEW: Archive the trip by setting status and needsReview
        const archiveReason = replaceTripReason === "dropped_traded"
          ? "Dropped / Traded Away"
          : replaceTripReason === "company_pulled"
          ? "Company pulled it"
          : "Replaced (reason unspecified)";

        await db.trip.update({
          where: { id: tripId },
          data: {
            status: "archived",
            needsReview: replaceTripReason === "not_sure", // Review if user unsure
            // Suffix tripNumber so the unique (userId, startDate, tripNumber) constraint doesn't block a new import
            tripNumber: trip.tripNumber ? `${trip.tripNumber}_archived_${tripId.slice(-6)}` : null,
            // Store archive reason in changeSummary field (JSON)
            changeSummary: JSON.stringify([`Archived: ${archiveReason}`]),
            changeSeverity: "none",
          },
        });
        result.archivedTripIds.push(tripId);
        console.log(`  📦 Archived trip: ${tripId} (${trip.tripNumber}) - ${archiveReason}`);
      }
    }

    // Create audit record
    const auditRecord = await db.auditRecord.create({
      data: {
        userId,
        recordType: "trip_replaced",
        title: "Trip Replaced via Import",
        summary: `User replaced ${conflictingTripIds.length} existing trip(s) with a new import. ` +
          `Reason: ${replaceTripReason === "dropped_traded" ? "Dropped/Traded Away" :
                     replaceTripReason === "company_pulled" ? "Company pulled it" :
                     "Not specified"}. ` +
          (acknowledgmentNote || ""),
        metadata: JSON.stringify({
          decision,
          archivedTripIds: result.archivedTripIds,
          deletedTripIds: result.deletedTripIds,
          replaceTripReason,
          note: acknowledgmentNote,
        }),
      },
    });
    result.auditRecordId = auditRecord.id;
  }

  // ============================================
  // LEGACY: keep_both_override (no longer recommended)
  // ============================================
  if (decision === "keep_both_override") {
    // Mark that the new trip should be an override
    result.isOverride = true;

    // Create audit record
    const auditRecord = await db.auditRecord.create({
      data: {
        userId,
        recordType: "trip_override_created",
        title: "Trip Override Created via Conflict Resolution",
        summary: `User chose to keep both trips. New trip marked as OVERRIDE. Conflicts with: ${conflictingTripIds.join(", ")}. ${acknowledgmentNote || ""}`,
        metadata: JSON.stringify({
          decision,
          conflictingTripIds,
          note: acknowledgmentNote,
        }),
      },
    });
    result.auditRecordId = auditRecord.id;
  }

  // ============================================
  // LEGACY: resolve_later
  // ============================================
  if (decision === "resolve_later") {
    // Import for review - will need decision later
    result.isOverride = true; // Treated similar to override for now

    const auditRecord = await db.auditRecord.create({
      data: {
        userId,
        recordType: "trip_pending_review",
        title: "Trip Imported for Later Review",
        summary: `Trip imported with status=review. User will decide later. ${acknowledgmentNote || ""}`,
        metadata: JSON.stringify({
          decision,
          conflictingTripIds,
          note: acknowledgmentNote,
        }),
      },
    });
    result.auditRecordId = auditRecord.id;
  }

  return result;
}

/**
 * Format minutes to HH:MM display format
 */
function formatCreditTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, "0")}`;
}
