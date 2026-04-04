/**
 * Roster Diff Engine
 * Phase 4: Compares trip versions and roster snapshots to detect changes and classify severity
 *
 * SEVERITY RULES:
 * - none: No changes detected
 * - minor: Auto-apply, no interruption (time shifts < 30 min, same route/legs)
 * - moderate_ack: ACK required (time shifts > 30 min, route changes, leg additions)
 * - major_ack: ACK required, strongly recommend Log Event (duty day added/removed, credit changes > 60 min)
 */

import { db } from "../db";
import type {
  TripVersionScheduleData,
  TripVersionDutyDay,
  RosterChangeSeverity,
  RosterChangeType,
  PremiumCandidateType,
  ConfidenceLevel,
} from "../../../shared/contracts";
import { createAuditRecord, formatMinutes } from "./trip-version-engine";
import type {
  RosterSnapshotData,
  DutyDaySnapshot,
  LegSnapshot,
} from "./trip-snapshot-manager";

// ============================================
// TYPES
// ============================================

export interface DiffResult {
  changes: DetectedChange[];
  overallSeverity: RosterChangeSeverity;
  creditDiffMinutes: number;
  estimatedPayDiffCents: number;
  requiresAck: boolean;
  hasPremiumCandidates: boolean;
}

export interface DetectedChange {
  changeType: RosterChangeType;
  severity: RosterChangeSeverity;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  affectedDays: number[];
  affectedLegs: number[];
  changeSummary: string;
  creditDiffMinutes: number;
  isPremiumCandidate: boolean;
  premiumCandidateType: PremiumCandidateType | null;
  premiumConfidence: ConfidenceLevel | null;
}

// Thresholds for severity classification
const TIME_CHANGE_THRESHOLD_MINUTES = 30; // Changes <= 30 min are MINOR

// ============================================
// MAIN DIFF FUNCTION
// ============================================

/**
 * Compare two trip versions and detect all changes
 * Returns structured diff with severity classification
 */
export function compareTripVersions(
  oldData: TripVersionScheduleData | null,
  newData: TripVersionScheduleData,
  hourlyRateCents: number = 0
): DiffResult {
  const changes: DetectedChange[] = [];

  // First import - no comparison needed
  if (!oldData) {
    return {
      changes: [],
      overallSeverity: "minor",
      creditDiffMinutes: 0,
      estimatedPayDiffCents: 0,
      requiresAck: false,
      hasPremiumCandidates: false,
    };
  }

  // Compare duty day count
  if (oldData.dutyDays.length !== newData.dutyDays.length) {
    const diff = newData.dutyDays.length - oldData.dutyDays.length;
    if (diff > 0) {
      // Duty days added - MAJOR
      changes.push({
        changeType: "duty_day_added",
        severity: "major",
        fieldChanged: "dutyDaysCount",
        oldValue: String(oldData.dutyDays.length),
        newValue: String(newData.dutyDays.length),
        affectedDays: Array.from({ length: diff }, (_, i) => oldData.dutyDays.length + i),
        affectedLegs: [],
        changeSummary: `${diff} duty day${diff > 1 ? "s" : ""} added to trip.`,
        creditDiffMinutes: 0,
        isPremiumCandidate: true,
        premiumCandidateType: "additional_flying",
        premiumConfidence: "high",
      });
    } else {
      // Duty days removed - MAJOR
      changes.push({
        changeType: "duty_day_removed",
        severity: "major",
        fieldChanged: "dutyDaysCount",
        oldValue: String(oldData.dutyDays.length),
        newValue: String(newData.dutyDays.length),
        affectedDays: Array.from({ length: Math.abs(diff) }, (_, i) => newData.dutyDays.length + i),
        affectedLegs: [],
        changeSummary: `${Math.abs(diff)} duty day${Math.abs(diff) > 1 ? "s" : ""} removed from trip.`,
        creditDiffMinutes: 0,
        isPremiumCandidate: true,
        premiumCandidateType: "pay_protection",
        premiumConfidence: "high",
      });
    }
  }

  // Compare each duty day (up to the minimum count)
  const minDays = Math.min(oldData.dutyDays.length, newData.dutyDays.length);
  for (let i = 0; i < minDays; i++) {
    const oldDay = oldData.dutyDays[i];
    const newDay = newData.dutyDays[i];
    if (oldDay && newDay) {
      const dayChanges = compareDutyDays(oldDay, newDay, i);
      changes.push(...dayChanges);
    }
  }

  // Compare total credit
  const creditDiff = newData.totals.creditMinutes - oldData.totals.creditMinutes;
  if (creditDiff !== 0) {
    const severity: RosterChangeSeverity = creditDiff < 0 ? "moderate" : "minor";
    changes.push({
      changeType: "credit_change",
      severity,
      fieldChanged: "totalCreditMinutes",
      oldValue: formatMinutes(oldData.totals.creditMinutes),
      newValue: formatMinutes(newData.totals.creditMinutes),
      affectedDays: [],
      affectedLegs: [],
      changeSummary:
        creditDiff > 0
          ? `Total trip credit increased by +${formatMinutes(creditDiff)}.`
          : `Total trip credit decreased by ${formatMinutes(Math.abs(creditDiff))}.`,
      creditDiffMinutes: creditDiff,
      isPremiumCandidate: creditDiff < 0,
      premiumCandidateType: creditDiff < 0 ? "pay_protection" : null,
      premiumConfidence: creditDiff < 0 ? "high" : null,
    });
  }

  // Calculate overall severity (highest wins)
  const overallSeverity = calculateOverallSeverity(changes);
  const requiresAck = overallSeverity !== "minor";
  const hasPremiumCandidates = changes.some((c) => c.isPremiumCandidate);
  const estimatedPayDiffCents = Math.round((creditDiff / 60) * hourlyRateCents);

  return {
    changes,
    overallSeverity,
    creditDiffMinutes: creditDiff,
    estimatedPayDiffCents,
    requiresAck,
    hasPremiumCandidates,
  };
}

// ============================================
// DUTY DAY COMPARISON
// ============================================

function compareDutyDays(
  oldDay: TripVersionDutyDay,
  newDay: TripVersionDutyDay,
  dayIndex: number
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // Compare report time
  if (oldDay.reportTimeISO !== newDay.reportTimeISO) {
    const timeDiff = calculateTimeDiffMinutes(oldDay.reportTimeISO, newDay.reportTimeISO);
    const severity = classifyTimeChangeSeverity(timeDiff);
    changes.push({
      changeType: "time_change",
      severity,
      fieldChanged: "reportTime",
      oldValue: formatTimeFromISO(oldDay.reportTimeISO),
      newValue: formatTimeFromISO(newDay.reportTimeISO),
      affectedDays: [dayIndex],
      affectedLegs: [],
      changeSummary: `Day ${dayIndex + 1} report time changed from ${formatTimeFromISO(oldDay.reportTimeISO)} to ${formatTimeFromISO(newDay.reportTimeISO)}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: severity !== "minor",
      premiumCandidateType: severity !== "minor" ? "reassignment" : null,
      premiumConfidence: severity !== "minor" ? "medium" : null,
    });
  }

  // Compare release time
  if (oldDay.releaseTimeISO !== newDay.releaseTimeISO) {
    const timeDiff = calculateTimeDiffMinutes(oldDay.releaseTimeISO, newDay.releaseTimeISO);
    const severity = classifyTimeChangeSeverity(timeDiff);
    const isExtended = timeDiff > 0;
    changes.push({
      changeType: "time_change",
      severity,
      fieldChanged: "releaseTime",
      oldValue: formatTimeFromISO(oldDay.releaseTimeISO),
      newValue: formatTimeFromISO(newDay.releaseTimeISO),
      affectedDays: [dayIndex],
      affectedLegs: [],
      changeSummary: `Day ${dayIndex + 1} release time changed from ${formatTimeFromISO(oldDay.releaseTimeISO)} to ${formatTimeFromISO(newDay.releaseTimeISO)}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: isExtended && severity !== "minor",
      premiumCandidateType: isExtended && severity !== "minor" ? "duty_extension" : null,
      premiumConfidence: isExtended && severity !== "minor" ? "medium" : null,
    });
  }

  // Compare layover station
  if (oldDay.layoverStation !== newDay.layoverStation) {
    changes.push({
      changeType: "layover_change",
      severity: "moderate",
      fieldChanged: "layoverStation",
      oldValue: oldDay.layoverStation,
      newValue: newDay.layoverStation,
      affectedDays: [dayIndex],
      affectedLegs: [],
      changeSummary: `Day ${dayIndex + 1} layover changed from ${oldDay.layoverStation || "none"} to ${newDay.layoverStation || "none"}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: true,
      premiumCandidateType: "layover_premium",
      premiumConfidence: "high",
    });
  }

  // Compare layover details
  if (oldDay.layover && newDay.layover) {
    if (oldDay.layover.restMinutes !== newDay.layover.restMinutes) {
      const restDiff = Math.abs(newDay.layover.restMinutes - oldDay.layover.restMinutes);
      const severity: RosterChangeSeverity = restDiff > 60 ? "moderate" : "minor";
      changes.push({
        changeType: "layover_change",
        severity,
        fieldChanged: "layoverRestMinutes",
        oldValue: formatMinutes(oldDay.layover.restMinutes),
        newValue: formatMinutes(newDay.layover.restMinutes),
        affectedDays: [dayIndex],
        affectedLegs: [],
        changeSummary: `Day ${dayIndex + 1} layover duration changed from ${formatMinutes(oldDay.layover.restMinutes)} to ${formatMinutes(newDay.layover.restMinutes)}.`,
        creditDiffMinutes: 0,
        isPremiumCandidate: severity === "moderate",
        premiumCandidateType: severity === "moderate" ? "layover_premium" : null,
        premiumConfidence: severity === "moderate" ? "medium" : null,
      });
    }
  }

  // Compare legs count
  if (oldDay.legs.length !== newDay.legs.length) {
    const diff = newDay.legs.length - oldDay.legs.length;
    if (diff > 0) {
      changes.push({
        changeType: "leg_added",
        severity: "major",
        fieldChanged: "legCount",
        oldValue: String(oldDay.legs.length),
        newValue: String(newDay.legs.length),
        affectedDays: [dayIndex],
        affectedLegs: Array.from({ length: diff }, (_, i) => oldDay.legs.length + i),
        changeSummary: `Day ${dayIndex + 1}: ${diff} leg${diff > 1 ? "s" : ""} added.`,
        creditDiffMinutes: 0,
        isPremiumCandidate: true,
        premiumCandidateType: "additional_flying",
        premiumConfidence: "high",
      });
    } else {
      changes.push({
        changeType: "leg_removed",
        severity: "major",
        fieldChanged: "legCount",
        oldValue: String(oldDay.legs.length),
        newValue: String(newDay.legs.length),
        affectedDays: [dayIndex],
        affectedLegs: Array.from({ length: Math.abs(diff) }, (_, i) => newDay.legs.length + i),
        changeSummary: `Day ${dayIndex + 1}: ${Math.abs(diff)} leg${Math.abs(diff) > 1 ? "s" : ""} removed.`,
        creditDiffMinutes: 0,
        isPremiumCandidate: true,
        premiumCandidateType: "pay_protection",
        premiumConfidence: "high",
      });
    }
  }

  // Compare each leg
  const minLegs = Math.min(oldDay.legs.length, newDay.legs.length);
  for (let j = 0; j < minLegs; j++) {
    const oldLeg = oldDay.legs[j];
    const newLeg = newDay.legs[j];
    if (oldLeg && newLeg) {
      const legChanges = compareLegs(oldLeg, newLeg, dayIndex, j);
      changes.push(...legChanges);
    }
  }

  return changes;
}

// ============================================
// LEG COMPARISON
// ============================================

function compareLegs(
  oldLeg: TripVersionDutyDay["legs"][0],
  newLeg: TripVersionDutyDay["legs"][0],
  dayIndex: number,
  legIndex: number
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // Compare flight number
  if (oldLeg.flightNumber !== newLeg.flightNumber) {
    changes.push({
      changeType: "flight_number_change",
      severity: "moderate",
      fieldChanged: "flightNumber",
      oldValue: oldLeg.flightNumber,
      newValue: newLeg.flightNumber,
      affectedDays: [dayIndex],
      affectedLegs: [legIndex],
      changeSummary: `Day ${dayIndex + 1} Leg ${legIndex + 1}: Flight number changed from ${oldLeg.flightNumber || "N/A"} to ${newLeg.flightNumber || "N/A"}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: true,
      premiumCandidateType: "reassignment",
      premiumConfidence: "medium",
    });
  }

  // Compare route
  const oldRoute = `${oldLeg.origin}-${oldLeg.destination}`;
  const newRoute = `${newLeg.origin}-${newLeg.destination}`;
  if (oldRoute !== newRoute) {
    changes.push({
      changeType: "route_change",
      severity: "moderate",
      fieldChanged: "route",
      oldValue: oldRoute,
      newValue: newRoute,
      affectedDays: [dayIndex],
      affectedLegs: [legIndex],
      changeSummary: `Day ${dayIndex + 1} Leg ${legIndex + 1}: Route changed from ${oldRoute} to ${newRoute}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: true,
      premiumCandidateType: "reassignment",
      premiumConfidence: "high",
    });
  }

  // Compare deadhead status
  if (oldLeg.isDeadhead !== newLeg.isDeadhead) {
    const changeDesc = newLeg.isDeadhead ? "changed to deadhead" : "changed from deadhead to live flight";
    changes.push({
      changeType: "deadhead_change",
      severity: "moderate",
      fieldChanged: "isDeadhead",
      oldValue: String(oldLeg.isDeadhead),
      newValue: String(newLeg.isDeadhead),
      affectedDays: [dayIndex],
      affectedLegs: [legIndex],
      changeSummary: `Day ${dayIndex + 1} Leg ${legIndex + 1}: ${changeDesc}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: true,
      premiumCandidateType: "deadhead_rig",
      premiumConfidence: "medium",
    });
  }

  // Compare scheduled times
  if (oldLeg.scheduledOutISO !== newLeg.scheduledOutISO) {
    const timeDiff = calculateTimeDiffMinutes(oldLeg.scheduledOutISO, newLeg.scheduledOutISO);
    const severity = classifyTimeChangeSeverity(timeDiff);
    changes.push({
      changeType: "time_change",
      severity,
      fieldChanged: "scheduledOut",
      oldValue: formatTimeFromISO(oldLeg.scheduledOutISO),
      newValue: formatTimeFromISO(newLeg.scheduledOutISO),
      affectedDays: [dayIndex],
      affectedLegs: [legIndex],
      changeSummary: `Day ${dayIndex + 1} Leg ${legIndex + 1}: Departure time changed from ${formatTimeFromISO(oldLeg.scheduledOutISO)} to ${formatTimeFromISO(newLeg.scheduledOutISO)}.`,
      creditDiffMinutes: 0,
      isPremiumCandidate: false,
      premiumCandidateType: null,
      premiumConfidence: null,
    });
  }

  return changes;
}

// ============================================
// HELPERS
// ============================================

function calculateOverallSeverity(changes: DetectedChange[]): RosterChangeSeverity {
  if (changes.some((c) => c.severity === "major")) return "major";
  if (changes.some((c) => c.severity === "moderate")) return "moderate";
  return "minor";
}

function classifyTimeChangeSeverity(diffMinutes: number): RosterChangeSeverity {
  const absDiff = Math.abs(diffMinutes);
  if (absDiff <= TIME_CHANGE_THRESHOLD_MINUTES) return "minor";
  if (absDiff <= 120) return "moderate";
  return "major";
}

function calculateTimeDiffMinutes(oldISO: string | null, newISO: string | null): number {
  if (!oldISO || !newISO) return 0;
  try {
    const oldTime = new Date(oldISO).getTime();
    const newTime = new Date(newISO).getTime();
    return Math.round((newTime - oldTime) / (1000 * 60));
  } catch {
    return 0;
  }
}

function formatTimeFromISO(iso: string | null): string {
  if (!iso) return "N/A";
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "N/A";
  }
}

// ============================================
// PERSIST CHANGES TO DATABASE
// ============================================

/**
 * Save detected changes to the database
 */
export async function saveRosterChanges(
  userId: string,
  tripId: string,
  oldVersionId: string | null,
  newVersionId: string,
  diffResult: DiffResult
): Promise<void> {
  for (const change of diffResult.changes) {
    await db.rosterChange.create({
      data: {
        userId,
        tripId,
        oldVersionId,
        newVersionId,
        changeType: change.changeType,
        severity: change.severity,
        fieldChanged: change.fieldChanged,
        oldValue: change.oldValue,
        newValue: change.newValue,
        affectedDays: JSON.stringify(change.affectedDays),
        affectedLegs: JSON.stringify(change.affectedLegs),
        changeSummary: change.changeSummary,
        creditDiffMinutes: change.creditDiffMinutes,
        estimatedPayDiffCents: diffResult.estimatedPayDiffCents,
        isPremiumCandidate: change.isPremiumCandidate,
        premiumCandidateType: change.premiumCandidateType,
        premiumConfidence: change.premiumConfidence,
        requiresAck: diffResult.requiresAck,
        acknowledged: false,
      },
    });
  }

  // Update trip state if acknowledgment required
  if (diffResult.requiresAck) {
    await db.trip.update({
      where: { id: tripId },
      data: {
        hasChangePending: true,
        changePendingSince: new Date(),
        needsReview: true,
      },
    });
  }

  // Create audit record for change detection
  if (diffResult.changes.length > 0) {
    const recordType = diffResult.requiresAck ? "roster_change_detected" : "roster_updated_minor";
    await createAuditRecord({
      userId,
      recordType,
      tripId,
      tripVersionId: newVersionId,
      title: diffResult.requiresAck
        ? `Roster Change Detected — ${diffResult.overallSeverity.charAt(0).toUpperCase() + diffResult.overallSeverity.slice(1)}`
        : "Roster Updated — Minor Change",
      summary: `${diffResult.changes.length} change${diffResult.changes.length > 1 ? "s" : ""} detected. ${diffResult.hasPremiumCandidates ? "Premium pay candidates available." : ""}`,
      severity: diffResult.overallSeverity,
      creditContext: {
        protected: 0, // Will be filled by caller
        current: 0,
        pay: 0,
        delta: diffResult.creditDiffMinutes,
      },
    });
  }
}

/**
 * Get pending (unacknowledged) changes for a trip
 */
export async function getPendingChanges(tripId: string) {
  return db.rosterChange.findMany({
    where: {
      tripId,
      requiresAck: true,
      acknowledged: false,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Acknowledge a roster change
 */
export async function acknowledgeChange(changeId: string, userId: string) {
  const change = await db.rosterChange.update({
    where: { id: changeId },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
    },
  });

  return change;
}

/**
 * Check if all changes for a trip are acknowledged
 */
export async function areAllChangesAcknowledged(tripId: string): Promise<boolean> {
  const pendingCount = await db.rosterChange.count({
    where: {
      tripId,
      requiresAck: true,
      acknowledged: false,
    },
  });
  return pendingCount === 0;
}

// ============================================
// PHASE 4: SNAPSHOT COMPARISON
// ============================================

/**
 * Phase 4 Severity Type (matches schema)
 */
export type Phase4Severity = "none" | "minor" | "moderate_ack" | "major_ack";

/**
 * Phase 4 Change Item
 */
export interface Phase4ChangeItem {
  type: string;
  severity: Phase4Severity;
  summary: string; // "before → after" format
  details?: string;
  dayIndex?: number;
  legIndex?: number;
}

/**
 * Phase 4 Diff Result
 */
export interface Phase4DiffResult {
  hasChanges: boolean;
  severity: Phase4Severity;
  changes: Phase4ChangeItem[];
  changeSummary: string[]; // Array of "before → after" strings for DB storage
  acknowledgmentRequired: boolean;
  totalCreditDelta: number; // In minutes
  originalCreditMinutes: number;
  currentCreditMinutes: number;
}

// Phase 4 Thresholds
const PHASE4_THRESHOLDS = {
  TIME_SHIFT_MINOR_MINUTES: 30,
  TIME_SHIFT_MAJOR_MINUTES: 120,
  CREDIT_CHANGE_MINOR_MINUTES: 15,
  CREDIT_CHANGE_MAJOR_MINUTES: 60,
};

/**
 * Compare two RosterSnapshotData objects (Phase 4)
 * Used for comparing original vs current snapshots
 *
 * @param original - The original (protected) roster snapshot
 * @param current - The new/current roster snapshot
 * @returns Phase4DiffResult with changes and severity
 */
export function compareRosterSnapshots(
  original: RosterSnapshotData,
  current: RosterSnapshotData
): Phase4DiffResult {
  const changes: Phase4ChangeItem[] = [];

  // Compare duty days
  const dutyDayChanges = compareSnapshotDutyDays(original.dutyDays, current.dutyDays);
  changes.push(...dutyDayChanges);

  // Compare total credit
  const creditDelta = current.totalCreditMinutes - original.totalCreditMinutes;
  if (creditDelta !== 0) {
    const creditChange = createSnapshotCreditChangeItem(
      original.totalCreditMinutes,
      current.totalCreditMinutes,
      creditDelta
    );
    changes.push(creditChange);
  }

  // Determine overall severity
  const severity = calculatePhase4Severity(changes);
  const acknowledgmentRequired = severity === "moderate_ack" || severity === "major_ack";

  // Build summary strings
  const changeSummary = changes.map((c) => c.summary);

  return {
    hasChanges: changes.length > 0,
    severity,
    changes,
    changeSummary,
    acknowledgmentRequired,
    totalCreditDelta: creditDelta,
    originalCreditMinutes: original.totalCreditMinutes,
    currentCreditMinutes: current.totalCreditMinutes,
  };
}

/**
 * Compare duty days between original and current snapshots
 */
function compareSnapshotDutyDays(
  originalDays: DutyDaySnapshot[],
  currentDays: DutyDaySnapshot[]
): Phase4ChangeItem[] {
  const changes: Phase4ChangeItem[] = [];

  // Index days by date for comparison
  const originalByDate = new Map(originalDays.map((d) => [d.dutyDate, d]));
  const currentByDate = new Map(currentDays.map((d) => [d.dutyDate, d]));

  // Find removed days
  for (const [date, originalDay] of originalByDate) {
    if (!currentByDate.has(date)) {
      changes.push({
        type: "duty_day_removed",
        severity: "major_ack",
        summary: `Day ${originalDay.dayIndex} (${formatDateShort(date)}) → REMOVED`,
        dayIndex: originalDay.dayIndex,
      });
    }
  }

  // Find added days
  for (const [date, currentDay] of currentByDate) {
    if (!originalByDate.has(date)) {
      changes.push({
        type: "duty_day_added",
        severity: "major_ack",
        summary: `Day ${currentDay.dayIndex} (${formatDateShort(date)}) → ADDED`,
        dayIndex: currentDay.dayIndex,
      });
    }
  }

  // Compare matching days
  for (const [date, originalDay] of originalByDate) {
    const currentDay = currentByDate.get(date);
    if (currentDay) {
      const dayChanges = compareSnapshotSingleDutyDay(originalDay, currentDay);
      changes.push(...dayChanges);
    }
  }

  return changes;
}

/**
 * Compare a single duty day's details
 */
function compareSnapshotSingleDutyDay(
  original: DutyDaySnapshot,
  current: DutyDaySnapshot
): Phase4ChangeItem[] {
  const changes: Phase4ChangeItem[] = [];
  const dayLabel = `Day ${original.dayIndex}`;

  // Compare report time
  if (original.reportTimeISO !== current.reportTimeISO) {
    const change = createSnapshotTimeChangeItem(
      `${dayLabel} Report`,
      original.reportTimeISO,
      current.reportTimeISO,
      original.dayIndex
    );
    changes.push(change);
  }

  // Compare release time
  if (original.releaseTimeISO !== current.releaseTimeISO) {
    const change = createSnapshotTimeChangeItem(
      `${dayLabel} Release`,
      original.releaseTimeISO,
      current.releaseTimeISO,
      original.dayIndex
    );
    changes.push(change);
  }

  // Compare legs
  const legChanges = compareSnapshotLegs(original.legs, current.legs, original.dayIndex);
  changes.push(...legChanges);

  // Compare layover
  if (original.layover || current.layover) {
    const layoverChange = compareSnapshotLayover(
      original.layover,
      current.layover,
      original.dayIndex
    );
    if (layoverChange) {
      changes.push(layoverChange);
    }
  }

  return changes;
}

/**
 * Compare legs within a duty day
 */
function compareSnapshotLegs(
  originalLegs: LegSnapshot[],
  currentLegs: LegSnapshot[],
  dayIndex: number
): Phase4ChangeItem[] {
  const changes: Phase4ChangeItem[] = [];

  // Index by leg index for matching
  const originalByIndex = new Map(originalLegs.map((l) => [l.legIndex, l]));
  const currentByIndex = new Map(currentLegs.map((l) => [l.legIndex, l]));

  // Find removed legs
  for (const [index, originalLeg] of originalByIndex) {
    if (!currentByIndex.has(index)) {
      changes.push({
        type: "leg_removed",
        severity: "major_ack",
        summary: `Day ${dayIndex} Leg ${index} (${originalLeg.flightNumber ?? "DH"} ${originalLeg.origin}-${originalLeg.destination}) → REMOVED`,
        dayIndex,
        legIndex: index,
      });
    }
  }

  // Find added legs
  for (const [index, currentLeg] of currentByIndex) {
    if (!originalByIndex.has(index)) {
      changes.push({
        type: "leg_added",
        severity: "moderate_ack",
        summary: `Day ${dayIndex} Leg ${index} → ADDED (${currentLeg.flightNumber ?? "DH"} ${currentLeg.origin}-${currentLeg.destination})`,
        dayIndex,
        legIndex: index,
      });
    }
  }

  // Compare matching legs
  for (const [index, originalLeg] of originalByIndex) {
    const currentLeg = currentByIndex.get(index);
    if (currentLeg) {
      const legChanges = compareSnapshotSingleLeg(originalLeg, currentLeg, dayIndex);
      changes.push(...legChanges);
    }
  }

  return changes;
}

/**
 * Compare a single leg's details
 */
function compareSnapshotSingleLeg(
  original: LegSnapshot,
  current: LegSnapshot,
  dayIndex: number
): Phase4ChangeItem[] {
  const changes: Phase4ChangeItem[] = [];
  const legLabel = `Day ${dayIndex} Leg ${original.legIndex}`;

  // Route change (origin or destination)
  if (original.origin !== current.origin || original.destination !== current.destination) {
    changes.push({
      type: "route_changed",
      severity: "moderate_ack",
      summary: `${legLabel} Route: ${original.origin}-${original.destination} → ${current.origin}-${current.destination}`,
      dayIndex,
      legIndex: original.legIndex,
    });
  }

  // Departure time change
  if (original.scheduledOutISO !== current.scheduledOutISO) {
    const change = createSnapshotTimeChangeItem(
      `${legLabel} Departure`,
      original.scheduledOutISO,
      current.scheduledOutISO,
      dayIndex,
      original.legIndex
    );
    changes.push(change);
  }

  // Arrival time change
  if (original.scheduledInISO !== current.scheduledInISO) {
    const change = createSnapshotTimeChangeItem(
      `${legLabel} Arrival`,
      original.scheduledInISO,
      current.scheduledInISO,
      dayIndex,
      original.legIndex
    );
    changes.push(change);
  }

  // Equipment change
  if (original.equipment !== current.equipment) {
    changes.push({
      type: "equipment_changed",
      severity: "minor",
      summary: `${legLabel} Equipment: ${original.equipment ?? "Unknown"} → ${current.equipment ?? "Unknown"}`,
      dayIndex,
      legIndex: original.legIndex,
    });
  }

  // Deadhead status change
  if (original.isDeadhead !== current.isDeadhead) {
    changes.push({
      type: "deadhead_changed",
      severity: "moderate_ack",
      summary: `${legLabel}: ${original.isDeadhead ? "Deadhead" : "Operating"} → ${current.isDeadhead ? "Deadhead" : "Operating"}`,
      dayIndex,
      legIndex: original.legIndex,
    });
  }

  return changes;
}

/**
 * Compare layover information
 */
function compareSnapshotLayover(
  original: DutyDaySnapshot["layover"],
  current: DutyDaySnapshot["layover"],
  dayIndex: number
): Phase4ChangeItem | null {
  if (!original && !current) {
    return null;
  }

  if (!original && current) {
    return {
      type: "layover_changed",
      severity: "minor",
      summary: `Day ${dayIndex} Layover: None → ${current.station} (${formatMinutesShort(current.restMinutes)})`,
      dayIndex,
    };
  }

  if (original && !current) {
    return {
      type: "layover_changed",
      severity: "moderate_ack",
      summary: `Day ${dayIndex} Layover: ${original.station} → REMOVED`,
      dayIndex,
    };
  }

  if (original && current) {
    if (original.station !== current.station || original.restMinutes !== current.restMinutes) {
      return {
        type: "layover_changed",
        severity: "minor",
        summary: `Day ${dayIndex} Layover: ${original.station} (${formatMinutesShort(original.restMinutes)}) → ${current.station} (${formatMinutesShort(current.restMinutes)})`,
        dayIndex,
      };
    }
  }

  return null;
}

/**
 * Create a time change item with severity based on delta
 */
function createSnapshotTimeChangeItem(
  label: string,
  originalISO: string | undefined,
  currentISO: string | undefined,
  dayIndex: number,
  legIndex?: number
): Phase4ChangeItem {
  const originalTime = originalISO ? formatTimeShort(originalISO) : "N/A";
  const currentTime = currentISO ? formatTimeShort(currentISO) : "N/A";

  // Calculate time delta in minutes
  let deltaMinutes = 0;
  if (originalISO && currentISO) {
    const originalMs = new Date(originalISO).getTime();
    const currentMs = new Date(currentISO).getTime();
    deltaMinutes = Math.round((currentMs - originalMs) / 60000);
  }

  // Determine severity based on time shift magnitude
  let severity: Phase4Severity = "minor";
  const absDelta = Math.abs(deltaMinutes);
  if (absDelta > PHASE4_THRESHOLDS.TIME_SHIFT_MAJOR_MINUTES) {
    severity = "major_ack";
  } else if (absDelta > PHASE4_THRESHOLDS.TIME_SHIFT_MINOR_MINUTES) {
    severity = "moderate_ack";
  }

  const deltaStr = deltaMinutes !== 0
    ? ` (${deltaMinutes > 0 ? "+" : ""}${formatMinutesShort(deltaMinutes)})`
    : "";

  return {
    type: "time_changed",
    severity,
    summary: `${label}: ${originalTime} → ${currentTime}${deltaStr}`,
    dayIndex,
    legIndex,
  };
}

/**
 * Create a credit change item
 */
function createSnapshotCreditChangeItem(
  originalMinutes: number,
  currentMinutes: number,
  deltaMinutes: number
): Phase4ChangeItem {
  const absDelta = Math.abs(deltaMinutes);
  let severity: Phase4Severity = "minor";

  if (absDelta > PHASE4_THRESHOLDS.CREDIT_CHANGE_MAJOR_MINUTES) {
    severity = "major_ack";
  } else if (absDelta > PHASE4_THRESHOLDS.CREDIT_CHANGE_MINOR_MINUTES) {
    severity = "moderate_ack";
  }

  const direction = deltaMinutes > 0 ? "+" : "";

  return {
    type: "total_credit_changed",
    severity,
    summary: `Total Credit: ${formatMinutesShort(originalMinutes)} → ${formatMinutesShort(currentMinutes)} (${direction}${formatMinutesShort(deltaMinutes)})`,
  };
}

/**
 * Calculate overall severity from all changes (Phase 4)
 */
function calculatePhase4Severity(changes: Phase4ChangeItem[]): Phase4Severity {
  if (changes.length === 0) {
    return "none";
  }

  const severityOrder: Phase4Severity[] = ["none", "minor", "moderate_ack", "major_ack"];

  let maxSeverity: Phase4Severity = "none";
  for (const change of changes) {
    if (severityOrder.indexOf(change.severity) > severityOrder.indexOf(maxSeverity)) {
      maxSeverity = change.severity;
    }
  }

  return maxSeverity;
}

// ============================================
// Phase 4 Formatting Helpers
// ============================================

/**
 * Format ISO time to local time string (HH:MM)
 */
function formatTimeShort(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  } catch {
    return isoString;
  }
}

/**
 * Format date to readable format (Mon 1/15)
 */
function formatDateShort(dateString: string): string {
  try {
    const date = new Date(dateString + "T00:00:00Z");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateString;
  }
}

/**
 * Format minutes to hours:minutes (e.g., 150 → 2:30)
 */
function formatMinutesShort(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `${sign}${hours}:${mins.toString().padStart(2, "0")}`;
}

// ============================================
// Phase 4 Utility Functions
// ============================================

/**
 * Quick check if there are any changes between snapshots
 */
export function hasSnapshotChanges(
  original: RosterSnapshotData,
  current: RosterSnapshotData
): boolean {
  // Quick checks before full comparison
  if (original.totalCreditMinutes !== current.totalCreditMinutes) return true;
  if (original.legCount !== current.legCount) return true;
  if (original.dutyDaysCount !== current.dutyDaysCount) return true;

  // Full comparison needed
  const result = compareRosterSnapshots(original, current);
  return result.hasChanges;
}

/**
 * Get a summary description of changes suitable for notifications
 */
export function getSnapshotChangeSummaryText(result: Phase4DiffResult): string {
  if (!result.hasChanges) {
    return "No changes detected";
  }

  const parts: string[] = [];

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const change of result.changes) {
    typeCounts.set(change.type, (typeCounts.get(change.type) ?? 0) + 1);
  }

  if (typeCounts.has("duty_day_added") || typeCounts.has("duty_day_removed")) {
    const added = typeCounts.get("duty_day_added") ?? 0;
    const removed = typeCounts.get("duty_day_removed") ?? 0;
    if (added > 0) parts.push(`${added} day(s) added`);
    if (removed > 0) parts.push(`${removed} day(s) removed`);
  }

  if (typeCounts.has("leg_added") || typeCounts.has("leg_removed")) {
    const added = typeCounts.get("leg_added") ?? 0;
    const removed = typeCounts.get("leg_removed") ?? 0;
    if (added > 0) parts.push(`${added} leg(s) added`);
    if (removed > 0) parts.push(`${removed} leg(s) removed`);
  }

  if (typeCounts.has("route_changed")) {
    parts.push(`${typeCounts.get("route_changed")} route change(s)`);
  }

  if (typeCounts.has("time_changed")) {
    parts.push(`${typeCounts.get("time_changed")} time change(s)`);
  }

  if (result.totalCreditDelta !== 0) {
    const direction = result.totalCreditDelta > 0 ? "+" : "";
    parts.push(`Credit: ${direction}${formatMinutesShort(result.totalCreditDelta)}`);
  }

  return parts.join(", ");
}

/**
 * Apply diff result to trip record (Phase 4)
 * Updates changeSummary, changeSeverity, and acknowledgment flags
 */
export async function applyDiffResultToTrip(
  tripId: string,
  diffResult: Phase4DiffResult
): Promise<void> {
  await db.trip.update({
    where: { id: tripId },
    data: {
      changeSummary: JSON.stringify(diffResult.changeSummary),
      changeSeverity: diffResult.severity,
      acknowledgmentRequired: diffResult.acknowledgmentRequired,
      // Clear acknowledgedAt if new changes require acknowledgment
      acknowledgedAt: diffResult.acknowledgmentRequired ? null : undefined,
    },
  });

  console.log(`[RosterDiffEngine] Applied diff result to trip ${tripId}: severity=${diffResult.severity}, ackRequired=${diffResult.acknowledgmentRequired}`);
}
