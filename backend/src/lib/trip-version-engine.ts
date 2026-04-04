/**
 * Trip Version Engine
 * Core logic for creating versions, evaluating pay credit, and generating audit records
 *
 * CRITICAL RULES (Phase 2):
 * - Trip Versions are IMMUTABLE - never deleted or overwritten
 * - protected_credit is set ONCE at baseline (v1)
 * - pay_credit = max(protected_credit, current_credit) - ALWAYS
 */

import { db } from "../db";
import type {
  TripVersionScheduleData,
  RosterChangeSeverity,
  RosterChangeType,
  PremiumCandidateType,
  AuditRecordType,
  PayOutcomeState,
  UserActionStatus,
} from "../../../shared/contracts";

// ============================================
// TYPES
// ============================================

export interface CreateVersionInput {
  tripId: string;
  userId: string;
  scheduleData: TripVersionScheduleData;
  sourceType: "import" | "manual" | "calendar_sync";
  sourceSnapshotId?: string;
  imageUrls?: string[];
  parseConfidence?: number;
  lowConfidenceFields?: string[];
}

export interface PayCreditEvaluation {
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;
  payCreditSource: "protected" | "current";
  isPayProtected: boolean;
  creditDeltaMinutes: number;
  estimatedDeltaCents: number;
}

export interface PayOutcomeBanner {
  state: PayOutcomeState;
  title: string;
  message: string;
  subtext: string | null;
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;
  creditDeltaMinutes: number;
  estimatedDeltaCents: number | null;
}

// ============================================
// VERSION CREATION
// ============================================

/**
 * Create a new Trip Version (immutable snapshot)
 * If this is the first version (v1), it becomes the baseline and sets protected_credit
 */
export async function createTripVersion(input: CreateVersionInput) {
  const { tripId, userId, scheduleData, sourceType, sourceSnapshotId, imageUrls, parseConfidence, lowConfidenceFields } = input;

  // Get next version number for this trip
  const existingVersions = await db.tripVersion.findMany({
    where: { tripId },
    orderBy: { versionNumber: "desc" },
    take: 1,
  });

  const latestVersion = existingVersions[0];
  const versionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
  const isBaseline = versionNumber === 1;

  // Create the immutable version
  const version = await db.tripVersion.create({
    data: {
      tripId,
      versionNumber,
      isActiveVersion: isBaseline, // First version is automatically active
      isBaselineVersion: isBaseline,
      scheduleData: JSON.stringify(scheduleData),
      totalCreditMinutes: scheduleData.totals.creditMinutes,
      totalBlockMinutes: scheduleData.totals.blockMinutes,
      totalTafbMinutes: scheduleData.totals.tafbMinutes,
      dutyDaysCount: scheduleData.totals.dutyDaysCount,
      legCount: scheduleData.totals.legCount,
      sourceType,
      sourceSnapshotId,
      imageUrls: imageUrls ? JSON.stringify(imageUrls) : null,
      parseConfidence: parseConfidence ?? 0.8,
      lowConfidenceFields: lowConfidenceFields ? JSON.stringify(lowConfidenceFields) : null,
    },
  });

  // For baseline (v1), initialize pay protection
  if (isBaseline) {
    await initializePayProtection(tripId, version.id, scheduleData.totals.creditMinutes);

    // Update trip with active version
    await db.trip.update({
      where: { id: tripId },
      data: { activeVersionId: version.id },
    });

    // Create audit record for baseline
    await createAuditRecord({
      userId,
      recordType: "trip_imported",
      tripId,
      tripVersionId: version.id,
      title: "Trip Imported — Baseline Set",
      summary: `Trip ${scheduleData.tripNumber || tripId} imported. Protected credit set to ${formatMinutes(scheduleData.totals.creditMinutes)}.`,
      creditContext: {
        protected: scheduleData.totals.creditMinutes,
        current: scheduleData.totals.creditMinutes,
        pay: scheduleData.totals.creditMinutes,
        delta: 0,
      },
    });
  }

  return version;
}

/**
 * Initialize pay protection for a trip (called on first import)
 */
async function initializePayProtection(tripId: string, baselineVersionId: string, creditMinutes: number) {
  await db.tripPayProtection.create({
    data: {
      tripId,
      protectedCreditMinutes: creditMinutes,
      protectedSetAt: new Date(),
      baselineVersionId,
      currentCreditMinutes: creditMinutes,
      currentVersionId: baselineVersionId,
      payCreditMinutes: creditMinutes,
      payCreditSource: "protected",
      isPayProtected: false,
      creditDeltaMinutes: 0,
      estimatedDeltaCents: 0,
      evaluationCount: 1,
    },
  });
}

// ============================================
// PAY CREDIT EVALUATION (Phase 2 Core Logic)
// ============================================

/**
 * Evaluate pay credit for a trip
 * CRITICAL: pay_credit = max(protected_credit, current_credit)
 * This is the ONLY formula, no exceptions
 */
export async function evaluatePayCredit(
  tripId: string,
  newCreditMinutes: number,
  newVersionId: string,
  hourlyRateCents: number = 0
): Promise<PayCreditEvaluation> {
  // Get current pay protection state
  let payProtection = await db.tripPayProtection.findUnique({
    where: { tripId },
  });

  if (!payProtection) {
    // No protection exists - this shouldn't happen but handle gracefully
    return {
      protectedCreditMinutes: newCreditMinutes,
      currentCreditMinutes: newCreditMinutes,
      payCreditMinutes: newCreditMinutes,
      payCreditSource: "current",
      isPayProtected: false,
      creditDeltaMinutes: 0,
      estimatedDeltaCents: 0,
    };
  }

  const protectedCredit = payProtection.protectedCreditMinutes;
  const currentCredit = newCreditMinutes;

  // THE CORE RULE: pay_credit = max(protected_credit, current_credit)
  const payCredit = Math.max(protectedCredit, currentCredit);
  const payCreditSource: "protected" | "current" = payCredit === protectedCredit ? "protected" : "current";
  const isPayProtected = currentCredit < protectedCredit;

  // Calculate delta (only meaningful when credit increased)
  const creditDelta = currentCredit > protectedCredit ? currentCredit - protectedCredit : 0;
  const estimatedDeltaCents = Math.round((creditDelta / 60) * hourlyRateCents);

  // Update pay protection state
  await db.tripPayProtection.update({
    where: { tripId },
    data: {
      currentCreditMinutes: currentCredit,
      currentVersionId: newVersionId,
      payCreditMinutes: payCredit,
      payCreditSource,
      isPayProtected,
      protectionAppliedAt: isPayProtected ? new Date() : null,
      creditDeltaMinutes: creditDelta,
      estimatedDeltaCents,
      lastEvaluatedAt: new Date(),
      evaluationCount: { increment: 1 },
    },
  });

  return {
    protectedCreditMinutes: protectedCredit,
    currentCreditMinutes: currentCredit,
    payCreditMinutes: payCredit,
    payCreditSource,
    isPayProtected,
    creditDeltaMinutes: creditDelta,
    estimatedDeltaCents,
  };
}

/**
 * Get pay protection state for a trip
 */
export async function getPayProtection(tripId: string) {
  return db.tripPayProtection.findUnique({
    where: { tripId },
  });
}

// ============================================
// PAY OUTCOME BANNER (Phase 4 UX)
// ============================================

/**
 * Generate the Pay Outcome Banner for display
 * This banner MUST appear before diffs, schedules, or buttons
 */
export function generatePayOutcomeBanner(
  evaluation: PayCreditEvaluation,
  hasPendingChanges: boolean
): PayOutcomeBanner {
  const { protectedCreditMinutes, currentCreditMinutes, payCreditMinutes, isPayProtected, creditDeltaMinutes, estimatedDeltaCents } = evaluation;

  // Determine state
  let state: PayOutcomeState;
  let title: string;
  let message: string;
  let subtext: string | null = null;

  if (hasPendingChanges && (isPayProtected || creditDeltaMinutes !== 0)) {
    // Review required state
    state = "review_required";
    title = "Roster Change Detected";
    message = "Your company changed this trip. Review required before finalizing.";
  } else if (isPayProtected) {
    // Pay protected state
    state = "protected";
    title = "Pay Protected";
    message = "You are fully pay protected. Your credit will not decrease.";
  } else if (creditDeltaMinutes > 0) {
    // Credit increased state
    state = "increased";
    title = "Pay Increased";
    message = `Your trip credit increased by +${formatMinutes(creditDeltaMinutes)}.`;
    if (estimatedDeltaCents > 0) {
      subtext = `Estimated additional pay: +$${(estimatedDeltaCents / 100).toFixed(2)}`;
    }
  } else {
    // Unchanged state
    state = "unchanged";
    title = "No Pay Change";
    message = "Your trip credit remains the same.";
  }

  return {
    state,
    title,
    message,
    subtext,
    protectedCreditMinutes,
    currentCreditMinutes,
    payCreditMinutes,
    creditDeltaMinutes,
    estimatedDeltaCents: estimatedDeltaCents > 0 ? estimatedDeltaCents : null,
  };
}

/**
 * Determine user action status
 */
export function determineUserActionStatus(
  hasPendingChanges: boolean,
  requiresAck: boolean,
  hasPremiumCandidates: boolean
): UserActionStatus {
  if (requiresAck) {
    return "acknowledgment_required";
  }
  if (hasPremiumCandidates) {
    return "log_event_recommended";
  }
  return "no_action_required";
}

// ============================================
// AUDIT RECORDS (Phase 6)
// ============================================

interface CreateAuditRecordInput {
  userId: string;
  recordType: AuditRecordType;
  tripId?: string;
  tripVersionId?: string;
  rosterChangeId?: string;
  logEventId?: string;
  title: string;
  summary: string;
  severity?: RosterChangeSeverity;
  creditContext?: {
    protected: number;
    current: number;
    pay: number;
    delta: number;
  };
  payContext?: {
    estimatedPayImpactCents: number;
  };
  linkedEvidence?: Array<{ type: string; url: string; description: string }>;
  metadata?: Record<string, unknown>;
}

/**
 * Create an audit record
 * Records are auto-generated and CANNOT be deleted
 */
export async function createAuditRecord(input: CreateAuditRecordInput) {
  return db.auditRecord.create({
    data: {
      userId: input.userId,
      recordType: input.recordType,
      tripId: input.tripId,
      tripVersionId: input.tripVersionId,
      rosterChangeId: input.rosterChangeId,
      logEventId: input.logEventId,
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      creditContext: input.creditContext ? JSON.stringify(input.creditContext) : null,
      payContext: input.payContext ? JSON.stringify(input.payContext) : null,
      linkedEvidence: input.linkedEvidence ? JSON.stringify(input.linkedEvidence) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Format minutes to HH:MM string
 */
export function formatMinutes(minutes: number): string {
  if (!minutes || minutes < 0) return "0:00";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

/**
 * Get active version for a trip
 */
export async function getActiveVersion(tripId: string) {
  return db.tripVersion.findFirst({
    where: { tripId, isActiveVersion: true },
  });
}

/**
 * Get all versions for a trip
 */
export async function getTripVersions(tripId: string) {
  return db.tripVersion.findMany({
    where: { tripId },
    orderBy: { versionNumber: "desc" },
  });
}

/**
 * Set a version as active (after acknowledgment)
 */
export async function setActiveVersion(tripId: string, versionId: string, userId: string) {
  // Deactivate all versions
  await db.tripVersion.updateMany({
    where: { tripId },
    data: { isActiveVersion: false },
  });

  // Activate the specified version
  await db.tripVersion.update({
    where: { id: versionId },
    data: { isActiveVersion: true },
  });

  // Update trip
  await db.trip.update({
    where: { id: tripId },
    data: {
      activeVersionId: versionId,
      hasChangePending: false,
      changePendingSince: null,
    },
  });

  // Get version for audit
  const version = await db.tripVersion.findUnique({ where: { id: versionId } });

  // Create audit record
  await createAuditRecord({
    userId,
    recordType: "roster_acknowledged",
    tripId,
    tripVersionId: versionId,
    title: "Roster Change Acknowledged & Applied",
    summary: `User acknowledged roster change. Version ${version?.versionNumber} is now active.`,
  });
}

/**
 * Convert trip data to TripVersionScheduleData format
 */
export function tripToVersionScheduleData(trip: {
  tripNumber: string | null;
  pairingId: string | null;
  baseFleet: string | null;
  startDate: string;
  endDate: string;
  totalCreditMinutes: number;
  totalBlockMinutes: number;
  totalTafbMinutes: number;
  dutyDaysCount: number;
  legCount: number;
  tripDutyDays?: Array<{
    dutyDayIndex: number;
    dutyDate: string;
    reportTimeISO: string | null;
    releaseTimeISO: string | null;
    dutyMinutes: number;
    blockMinutes: number;
    creditMinutes: number;
    restAfterMinutes: number | null;
    layoverStation: string | null;
    legs: Array<{
      legIndex: number;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
      equipment: string | null;
      isDeadhead: boolean;
      scheduledOutISO: string | null;
      scheduledInISO: string | null;
      plannedBlockMinutes: number;
      plannedCreditMinutes: number;
    }>;
    layover: {
      station: string;
      restMinutes: number;
      hotelName: string | null;
      hotelPhone: string | null;
    } | null;
  }>;
}): TripVersionScheduleData {
  return {
    tripNumber: trip.tripNumber,
    pairingId: trip.pairingId,
    baseFleet: trip.baseFleet,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dutyDays: (trip.tripDutyDays || []).map((dd) => ({
      dayIndex: dd.dutyDayIndex,
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
      layover: dd.layover,
    })),
    totals: {
      creditMinutes: trip.totalCreditMinutes,
      blockMinutes: trip.totalBlockMinutes,
      tafbMinutes: trip.totalTafbMinutes,
      dutyDaysCount: trip.dutyDaysCount,
      legCount: trip.legCount,
    },
  };
}
