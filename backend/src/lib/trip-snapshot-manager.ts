/**
 * Trip Snapshot Manager
 * Phase 3 + Phase 5: Manages original and current roster snapshots with immutability guarantees
 *
 * Key Rules:
 * 1. original_roster_snapshot is set ONLY ONCE (first time trip is created from upload)
 * 2. original_roster_snapshot is IMMUTABLE after first set
 * 3. current_roster_snapshot updates on every new upload matched to the trip
 * 4. All credit times stored as minutes (int) internally
 * 5. pay_credit_minutes = max(protected_credit_minutes, current_credit_minutes) [Phase 5]
 */

import { db } from "../db";
import { calculatePayCredit, type PayCreditCalculation } from "./pay-credit-engine";

// ============================================
// Types
// ============================================

export interface RosterSnapshotData {
  dutyDays: DutyDaySnapshot[];
  totalCreditMinutes: number;
  totalBlockMinutes: number;
  totalTafbMinutes: number;
  legCount: number;
  dutyDaysCount: number;
}

export interface DutyDaySnapshot {
  dayIndex: number;        // 1-indexed
  dutyDate: string;        // YYYY-MM-DD
  reportTimeISO?: string;  // ISO 8601
  releaseTimeISO?: string; // ISO 8601
  creditMinutes: number;
  blockMinutes: number;
  legs: LegSnapshot[];
  layover?: LayoverSnapshot;
}

export interface LegSnapshot {
  legIndex: number;        // 1-indexed
  flightNumber?: string;
  origin?: string;
  destination?: string;
  equipment?: string;
  isDeadhead: boolean;
  scheduledOutISO?: string;
  scheduledInISO?: string;
  blockMinutes: number;
  creditMinutes: number;
}

export interface LayoverSnapshot {
  station: string;
  restMinutes: number;
  hotelName?: string;
}

export interface SnapshotUpdateResult {
  tripId: string;
  originalSet: boolean;           // Was original set in this operation?
  originalAlreadyLocked: boolean; // Was original already locked before?
  currentUpdated: boolean;        // Was current updated?
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;       // Phase 5: max(protected, current)
  payCalculation: PayCreditCalculation; // Full pay credit calculation details
}

// ============================================
// Core Functions
// ============================================

/**
 * Set or update trip snapshots from an upload
 *
 * IMMUTABILITY RULE:
 * - If originalRosterSnapshot is NULL, set it and lock it (originalSnapshotSetAt)
 * - If originalRosterSnapshot is NOT NULL, do NOT modify it
 * - Always update currentRosterSnapshot
 *
 * @param tripId - The trip to update
 * @param snapshotData - The roster data from the upload
 * @returns SnapshotUpdateResult with status
 */
export async function setTripSnapshotsFromUpload(
  tripId: string,
  snapshotData: RosterSnapshotData
): Promise<SnapshotUpdateResult> {
  // Get current trip state
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      originalRosterSnapshot: true,
      originalSnapshotSetAt: true,
      protectedCreditMinutes: true,
    },
  });

  if (!trip) {
    throw new Error(`Trip not found: ${tripId}`);
  }

  const snapshotJson = JSON.stringify(snapshotData);
  const now = new Date();
  const originalAlreadyLocked = trip.originalRosterSnapshot !== null;

  // Build update data
  const updateData: Record<string, unknown> = {
    // Always update current snapshot
    currentRosterSnapshot: snapshotJson,
    currentSnapshotUpdatedAt: now,
    currentCreditMinutes: snapshotData.totalCreditMinutes,

    // Update derived totals
    totalCreditMinutes: snapshotData.totalCreditMinutes,
    totalBlockMinutes: snapshotData.totalBlockMinutes,
    totalTafbMinutes: snapshotData.totalTafbMinutes,
    legCount: snapshotData.legCount,
    dutyDaysCount: snapshotData.dutyDaysCount,
  };

  // Determine protected credit (either existing or new)
  let protectedCreditMinutes: number;

  // IMMUTABILITY CHECK: Only set original if not already set
  if (!originalAlreadyLocked) {
    updateData.originalRosterSnapshot = snapshotJson;
    updateData.originalSnapshotSetAt = now;
    updateData.protectedCreditMinutes = snapshotData.totalCreditMinutes;
    protectedCreditMinutes = snapshotData.totalCreditMinutes;

    console.log(`[TripSnapshotManager] Setting ORIGINAL snapshot for trip ${tripId} (first upload)`);
  } else {
    protectedCreditMinutes = trip.protectedCreditMinutes;
    console.log(`[TripSnapshotManager] Original snapshot LOCKED for trip ${tripId} - only updating current`);
  }

  // PHASE 5: Calculate pay credit = max(protected, current)
  const payCalculation = calculatePayCredit(
    protectedCreditMinutes,
    snapshotData.totalCreditMinutes
  );

  // Update pay credit in database
  updateData.payCreditMinutes = payCalculation.payCreditMinutes;

  // Perform update
  await db.trip.update({
    where: { id: tripId },
    data: updateData,
  });

  console.log(
    `[TripSnapshotManager] Pay credit updated: protected=${protectedCreditMinutes}, current=${snapshotData.totalCreditMinutes}, pay=${payCalculation.payCreditMinutes}, scenario=${payCalculation.scenario}`
  );

  return {
    tripId,
    originalSet: !originalAlreadyLocked,
    originalAlreadyLocked,
    currentUpdated: true,
    protectedCreditMinutes,
    currentCreditMinutes: snapshotData.totalCreditMinutes,
    payCreditMinutes: payCalculation.payCreditMinutes,
    payCalculation,
  };
}

/**
 * Create a trip with initial snapshots from an upload
 * This is used when a new trip is created from an upload
 *
 * @param userId - User ID
 * @param tripData - Basic trip data (pairingId, startDate, etc.)
 * @param snapshotData - The roster data from the upload
 * @param uploadId - The upload that created this trip
 * @returns Created trip with snapshots
 */
export async function createTripWithSnapshots(
  userId: string,
  tripData: {
    pairingId?: string;
    tripNumber?: string;
    matchKey?: string;
    baseFleet?: string;
    startDate: string;
    endDate: string;
    source?: string;
  },
  snapshotData: RosterSnapshotData,
  uploadId: string
) {
  const snapshotJson = JSON.stringify(snapshotData);
  const now = new Date();

  const trip = await db.trip.create({
    data: {
      userId,
      pairingId: tripData.pairingId,
      tripNumber: tripData.tripNumber ?? tripData.pairingId,
      matchKey: tripData.matchKey,
      baseFleet: tripData.baseFleet,
      startDate: tripData.startDate,
      endDate: tripData.endDate,
      source: tripData.source ?? "import",

      // Set BOTH original and current (first upload = baseline)
      originalRosterSnapshot: snapshotJson,
      originalSnapshotSetAt: now,
      currentRosterSnapshot: snapshotJson,
      currentSnapshotUpdatedAt: now,

      // Credit tracking
      protectedCreditMinutes: snapshotData.totalCreditMinutes,
      currentCreditMinutes: snapshotData.totalCreditMinutes,
      payCreditMinutes: snapshotData.totalCreditMinutes, // Initially same

      // Derived totals
      totalCreditMinutes: snapshotData.totalCreditMinutes,
      totalBlockMinutes: snapshotData.totalBlockMinutes,
      totalTafbMinutes: snapshotData.totalTafbMinutes,
      legCount: snapshotData.legCount,
      dutyDaysCount: snapshotData.dutyDaysCount,

      // Upload linkage
      lastUploadId: uploadId,

      // Placeholders for Phase 4-5
      changeSeverity: "none",
      acknowledgmentRequired: false,
    },
  });

  console.log(`[TripSnapshotManager] Created trip ${trip.id} with ORIGINAL snapshot locked`);

  return trip;
}

/**
 * Link an upload to a trip
 * Updates Trip.lastUploadId and creates the many-to-many relation
 *
 * @param tripId - Trip ID
 * @param uploadId - Upload ID
 */
export async function linkUploadToTrip(tripId: string, uploadId: string): Promise<void> {
  await db.trip.update({
    where: { id: tripId },
    data: {
      lastUploadId: uploadId,
      uploads: {
        connect: { id: uploadId },
      },
    },
  });

  console.log(`[TripSnapshotManager] Linked upload ${uploadId} to trip ${tripId}`);
}

/**
 * Get the original snapshot for a trip
 * Returns null if original is not set yet
 */
export async function getOriginalSnapshot(tripId: string): Promise<RosterSnapshotData | null> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { originalRosterSnapshot: true },
  });

  if (!trip?.originalRosterSnapshot) {
    return null;
  }

  return JSON.parse(trip.originalRosterSnapshot) as RosterSnapshotData;
}

/**
 * Get the current snapshot for a trip
 * Returns null if current is not set yet
 */
export async function getCurrentSnapshot(tripId: string): Promise<RosterSnapshotData | null> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { currentRosterSnapshot: true },
  });

  if (!trip?.currentRosterSnapshot) {
    return null;
  }

  return JSON.parse(trip.currentRosterSnapshot) as RosterSnapshotData;
}

/**
 * Check if a trip's original snapshot is locked (immutable)
 */
export async function isOriginalSnapshotLocked(tripId: string): Promise<boolean> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: { originalSnapshotSetAt: true },
  });

  return trip?.originalSnapshotSetAt !== null;
}

/**
 * Generate a match key for a trip
 * Used as fallback when pairingId is not available
 * Format: base + first duty date + first report time + first flight number
 */
export function generateMatchKey(
  base: string | null,
  firstDutyDate: string,
  firstReportTime: string | null,
  firstFlightNumber: string | null
): string {
  const parts = [
    base ?? "UNKN",
    firstDutyDate,
    firstReportTime?.replace(/[^0-9]/g, "") ?? "0000",
    firstFlightNumber ?? "0000",
  ];
  return parts.join("-");
}

/**
 * Build RosterSnapshotData from parsed trip data
 * Utility to convert parsed schedule data to snapshot format
 */
export function buildSnapshotFromParsedData(
  dutyDays: Array<{
    dayIndex: number;
    dutyDate: string;
    reportTimeISO?: string;
    releaseTimeISO?: string;
    creditMinutes: number;
    blockMinutes: number;
    legs: Array<{
      legIndex: number;
      flightNumber?: string;
      origin?: string;
      destination?: string;
      equipment?: string;
      isDeadhead: boolean;
      scheduledOutISO?: string;
      scheduledInISO?: string;
      blockMinutes: number;
      creditMinutes: number;
    }>;
    layover?: {
      station: string;
      restMinutes: number;
      hotelName?: string;
    };
  }>
): RosterSnapshotData {
  let totalCreditMinutes = 0;
  let totalBlockMinutes = 0;
  let totalTafbMinutes = 0;
  let legCount = 0;

  const dutyDaySnapshots: DutyDaySnapshot[] = dutyDays.map((dd) => {
    totalCreditMinutes += dd.creditMinutes;
    totalBlockMinutes += dd.blockMinutes;
    legCount += dd.legs.length;

    // Add rest time to TAFB calculation
    if (dd.layover) {
      totalTafbMinutes += dd.layover.restMinutes;
    }

    return {
      dayIndex: dd.dayIndex,
      dutyDate: dd.dutyDate,
      reportTimeISO: dd.reportTimeISO,
      releaseTimeISO: dd.releaseTimeISO,
      creditMinutes: dd.creditMinutes,
      blockMinutes: dd.blockMinutes,
      legs: dd.legs.map((leg) => ({
        legIndex: leg.legIndex,
        flightNumber: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        equipment: leg.equipment,
        isDeadhead: leg.isDeadhead,
        scheduledOutISO: leg.scheduledOutISO,
        scheduledInISO: leg.scheduledInISO,
        blockMinutes: leg.blockMinutes,
        creditMinutes: leg.creditMinutes,
      })),
      layover: dd.layover,
    };
  });

  // Calculate TAFB: sum of duty times + rest times
  dutyDays.forEach((dd) => {
    if (dd.reportTimeISO && dd.releaseTimeISO) {
      const reportTime = new Date(dd.reportTimeISO).getTime();
      const releaseTime = new Date(dd.releaseTimeISO).getTime();
      totalTafbMinutes += Math.round((releaseTime - reportTime) / 60000);
    }
  });

  return {
    dutyDays: dutyDaySnapshots,
    totalCreditMinutes,
    totalBlockMinutes,
    totalTafbMinutes,
    legCount,
    dutyDaysCount: dutyDays.length,
  };
}
