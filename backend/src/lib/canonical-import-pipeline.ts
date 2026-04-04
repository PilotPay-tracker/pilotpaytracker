/**
 * Canonical Import Pipeline
 *
 * Handles schedule imports for two formats:
 * 1. Trip Information / CML printout (has "Rest: HH:MM" + hotel name/phone/status)
 * 2. Trip Details table (leg list + duty/credit + may not include hotel lines)
 *
 * Normalizes all imports into the canonical structure:
 * Trip → TripDutyDays → TripDutyLegs → TripLayovers (after each duty day except final)
 *
 * LAYOVER/REST RULE (non-negotiable):
 * Layover/rest = next duty start (report) − prior duty end
 * Never use calendar day math. Never skip duty boundaries.
 */

import { db } from "../db";

// ============================================
// Types
// ============================================

export type ImportSourceType =
  | "trip_board_browser"
  | "trip_board_trip_details"
  | "crew_access_trip_info"
  | "unknown";

export interface ParsedLeg {
  flightNumber?: string;
  origin?: string;
  destination?: string;
  equipment?: string;
  isDeadhead: boolean;
  scheduledOutISO?: string;
  scheduledInISO?: string;
  plannedBlockMinutes: number;
  plannedCreditMinutes: number;
  dayCode?: string; // SU01, TU03, etc.
  date?: string; // YYYY-MM-DD
}

export interface ParsedDutyDay {
  index: number; // 1-indexed
  date: string; // YYYY-MM-DD
  reportTimeISO?: string; // Full ISO datetime for duty start
  releaseTimeISO?: string; // Full ISO datetime for duty end
  dutyMinutes: number;
  blockMinutes: number;
  creditMinutes: number;
  legs: ParsedLeg[];
  // From Trip Information only:
  restMinutesExplicit?: number; // "Rest: HH:MM" from source
}

export interface ParsedHotel {
  station?: string; // Airport code where hotel is
  name: string;
  phone?: string;
  status?: string; // "BOOKED", "PENDING", etc.
  address?: string;
}

export interface ParsedTransport {
  station?: string;
  notes: string;
  phone?: string;
}

export interface ParsedTripImport {
  sourceType: ImportSourceType;
  tripNumber?: string;
  pairingId?: string;
  baseFleet?: string;
  startDate?: string;
  endDate?: string;
  dutyDays: ParsedDutyDay[];
  hotels: ParsedHotel[];
  transport: ParsedTransport[];
  totals?: {
    creditMinutes?: number;
    blockMinutes?: number;
    tafbMinutes?: number;
    dutyDays?: number;
    perDiemCents?: number;
  };
  confidence: number;
}

export interface CanonicalImportResult {
  tripId: string;
  dutyDayIds: string[];
  legIds: string[];
  layoverIds: string[];
  hotelsPopulated: number;
  hotelsFromDirectory: number;
  needsHotelReview: string[]; // Layover IDs needing user review
}

// ============================================
// Duration Parsing
// ============================================

/**
 * Parse duration string "H:MM" or "HH:MM" to total minutes
 */
export function parseDurationToMinutes(durStr: string | undefined | null): number {
  if (!durStr) return 0;
  const match = durStr.match(/(\d+):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Format minutes as "H:MM"
 */
export function formatMinutesToDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Compute block minutes from departure and arrival times
 * Handles overnight flights (arrival < departure = next day)
 *
 * @param depTime - Departure time in "HH:MM" format
 * @param arrTime - Arrival time in "HH:MM" format
 * @returns Block minutes, or 0 if times are invalid
 */
export function computeBlockFromTimes(depTime: string | undefined, arrTime: string | undefined): number {
  if (!depTime || !arrTime) return 0;

  const depMatch = depTime.match(/(\d{1,2}):(\d{2})/);
  const arrMatch = arrTime.match(/(\d{1,2}):(\d{2})/);

  if (!depMatch || !arrMatch) return 0;

  const depMinutes = parseInt(depMatch[1]!) * 60 + parseInt(depMatch[2]!);
  const arrMinutes = parseInt(arrMatch[1]!) * 60 + parseInt(arrMatch[2]!);

  // If arrival is before departure, it's an overnight flight (add 24 hours)
  if (arrMinutes < depMinutes) {
    return (24 * 60) + arrMinutes - depMinutes;
  }

  return arrMinutes - depMinutes;
}

/**
 * Validate parsed leg data for potential issues
 * Returns warnings if data looks suspicious
 */
export function validateLegData(leg: {
  flightNumber?: string;
  origin?: string;
  destination?: string;
  scheduledOut?: string;
  scheduledIn?: string;
  blockMinutes?: number;
}): string[] {
  const warnings: string[] = [];

  // Check for missing critical data
  if (!leg.origin || !leg.destination) {
    warnings.push(`Missing route for flight ${leg.flightNumber || 'unknown'}`);
  }

  // Check for missing times
  if (!leg.scheduledOut || !leg.scheduledIn) {
    warnings.push(`Missing times for ${leg.origin || '?'}-${leg.destination || '?'}`);
  }

  // Check for zero or very short block time (less than 30 minutes is suspicious for most routes)
  if (leg.blockMinutes !== undefined && leg.blockMinutes < 30 && leg.blockMinutes !== 0) {
    // Could be valid for very short hops, but worth flagging
    warnings.push(`Very short block time (${leg.blockMinutes}min) for ${leg.origin}-${leg.destination}`);
  }

  // Check for impossibly long block time (more than 18 hours)
  if (leg.blockMinutes !== undefined && leg.blockMinutes > 1080) {
    warnings.push(`Unusually long block time (${Math.floor(leg.blockMinutes / 60)}h) for ${leg.origin}-${leg.destination}`);
  }

  // Check for block time of 0 with valid times (indicates parsing issue)
  if (leg.blockMinutes === 0 && leg.scheduledOut && leg.scheduledIn) {
    const computed = computeBlockFromTimes(leg.scheduledOut, leg.scheduledIn);
    if (computed > 0) {
      warnings.push(`Block time was 0 but computed ${computed}min from times ${leg.scheduledOut}-${leg.scheduledIn}`);
    }
  }

  return warnings;
}

// ============================================
// Layover/Rest Calculation (Non-negotiable rule)
// ============================================

/**
 * Calculate layover/rest time between duty days
 *
 * RULE: Rest = next duty start (report) − prior duty end
 * Never use calendar day math. Never skip duty boundaries.
 */
export function calculateRestMinutes(
  priorDutyEndISO: string | undefined | null,
  nextDutyStartISO: string | undefined | null
): number | null {
  if (!priorDutyEndISO || !nextDutyStartISO) {
    return null;
  }

  const priorEnd = new Date(priorDutyEndISO);
  const nextStart = new Date(nextDutyStartISO);

  // Validate dates
  if (isNaN(priorEnd.getTime()) || isNaN(nextStart.getTime())) {
    return null;
  }

  const diffMs = nextStart.getTime() - priorEnd.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  // Rest should be positive
  return diffMinutes > 0 ? diffMinutes : null;
}

// ============================================
// Hotel Directory Lookup
// ============================================

interface HotelLookupResult {
  hotelName: string;
  hotelPhone?: string;
  hotelAddress?: string;
  source: "trip_info" | "directory" | "shared_directory";
  confidence: number;
}

/**
 * Look up hotel from user's directory for a given station and airline
 */
export async function lookupHotelFromDirectory(
  userId: string,
  airlineCode: string,
  station: string,
  baseCode?: string | null,
  equipmentCode?: string | null
): Promise<HotelLookupResult | null> {
  // 1. Try exact match with base/equipment
  if (baseCode || equipmentCode) {
    const exactMatch = await db.userHotelDirectory.findFirst({
      where: {
        userId,
        airlineCode,
        station,
        ...(baseCode ? { baseCode } : {}),
        ...(equipmentCode ? { equipmentCode } : {}),
      },
      orderBy: [
        { confirmCount: "desc" },
        { lastConfirmedAt: "desc" },
      ],
    });

    if (exactMatch && exactMatch.rejectCount < exactMatch.confirmCount) {
      return {
        hotelName: exactMatch.hotelName,
        hotelPhone: exactMatch.hotelPhone ?? undefined,
        hotelAddress: exactMatch.hotelAddress ?? undefined,
        source: "directory",
        confidence: Math.min(0.95, 0.5 + (exactMatch.confirmCount * 0.1)),
      };
    }
  }

  // 2. Try station-only match for user
  const stationMatch = await db.userHotelDirectory.findFirst({
    where: {
      userId,
      airlineCode,
      station,
    },
    orderBy: [
      { confirmCount: "desc" },
      { lastConfirmedAt: "desc" },
    ],
  });

  if (stationMatch && stationMatch.rejectCount < stationMatch.confirmCount) {
    return {
      hotelName: stationMatch.hotelName,
      hotelPhone: stationMatch.hotelPhone ?? undefined,
      hotelAddress: stationMatch.hotelAddress ?? undefined,
      source: "directory",
      confidence: Math.min(0.9, 0.4 + (stationMatch.confirmCount * 0.1)),
    };
  }

  // 3. Check shared directory (only same airline)
  const sharedMatch = await db.sharedHotelDirectory.findFirst({
    where: {
      airlineCode,
      station,
    },
    orderBy: [
      { confirmCount: "desc" },
      { userCount: "desc" },
    ],
  });

  if (sharedMatch) {
    return {
      hotelName: sharedMatch.hotelName,
      hotelPhone: sharedMatch.hotelPhone ?? undefined,
      hotelAddress: sharedMatch.hotelAddress ?? undefined,
      source: "shared_directory",
      confidence: Math.min(0.8, 0.3 + (sharedMatch.confirmCount * 0.05) + (sharedMatch.userCount * 0.1)),
    };
  }

  return null;
}

/**
 * Batch prefetch hotels for multiple stations in parallel
 * This is an optimization for the import pipeline to reduce DB round trips
 */
export async function prefetchHotelsForStations(
  userId: string,
  airlineCode: string,
  stations: string[],
  baseCode?: string | null,
  equipmentCode?: string | null
): Promise<Map<string, HotelLookupResult>> {
  const results = new Map<string, HotelLookupResult>();

  if (stations.length === 0) return results;

  // Fetch all in parallel
  const lookupPromises = stations.map(async (station) => {
    const result = await lookupHotelFromDirectory(
      userId,
      airlineCode,
      station,
      baseCode,
      equipmentCode
    );
    return { station, result };
  });

  const lookupResults = await Promise.all(lookupPromises);

  for (const { station, result } of lookupResults) {
    if (result) {
      results.set(station, result);
    }
  }

  console.log(`🏨 [Prefetch] Loaded ${results.size}/${stations.length} hotels from directory`);
  return results;
}

/**
 * Update user's hotel directory when they confirm a hotel
 */
export async function confirmHotelInDirectory(
  userId: string,
  airlineCode: string,
  station: string,
  hotelName: string,
  hotelPhone?: string | null,
  hotelAddress?: string | null,
  baseCode?: string | null,
  equipmentCode?: string | null,
  isShared: boolean = false
): Promise<void> {
  // Upsert user directory entry
  await db.userHotelDirectory.upsert({
    where: {
      userId_airlineCode_station_hotelName: {
        userId,
        airlineCode,
        station,
        hotelName,
      },
    },
    create: {
      userId,
      airlineCode,
      station,
      hotelName,
      hotelPhone: hotelPhone ?? null,
      hotelAddress: hotelAddress ?? null,
      baseCode: baseCode ?? null,
      equipmentCode: equipmentCode ?? null,
      confirmCount: 1,
      isShared,
    },
    update: {
      hotelPhone: hotelPhone ?? undefined,
      hotelAddress: hotelAddress ?? undefined,
      confirmCount: { increment: 1 },
      lastConfirmedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  // If user opted into sharing, update shared directory
  if (isShared) {
    await db.sharedHotelDirectory.upsert({
      where: {
        airlineCode_station_hotelName: {
          airlineCode,
          station,
          hotelName,
        },
      },
      create: {
        airlineCode,
        station,
        hotelName,
        hotelPhone: hotelPhone ?? null,
        hotelAddress: hotelAddress ?? null,
        confirmCount: 1,
        userCount: 1,
      },
      update: {
        hotelPhone: hotelPhone ?? undefined,
        hotelAddress: hotelAddress ?? undefined,
        confirmCount: { increment: 1 },
        lastConfirmedAt: new Date(),
      },
    });
  }
}

/**
 * Record hotel rejection (user says this hotel is wrong for this station)
 */
export async function rejectHotelInDirectory(
  userId: string,
  airlineCode: string,
  station: string,
  hotelName: string
): Promise<void> {
  const existing = await db.userHotelDirectory.findUnique({
    where: {
      userId_airlineCode_station_hotelName: {
        userId,
        airlineCode,
        station,
        hotelName,
      },
    },
  });

  if (existing) {
    await db.userHotelDirectory.update({
      where: { id: existing.id },
      data: {
        rejectCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });
  }
}

// ============================================
// Match Key Generation
// ============================================

/**
 * Generate a match key for a trip
 * Format: base-firstDutyDate-firstReportTime-firstFlightNumber
 * Example: "SDF-2025-01-15-0600-5103"
 */
function generateMatchKey(
  base: string | null,
  firstDutyDate: string,
  firstReportTime: string | null,
  firstFlightNumber: string | null
): string {
  const parts = [
    base ?? "UNKN",
    firstDutyDate,
    firstReportTime?.replace(/[^0-9]/g, "").slice(0, 4) ?? "0000",
    firstFlightNumber?.replace(/[^0-9]/g, "") ?? "0000",
  ];
  return parts.join("-");
}

// ============================================
// Main Import Pipeline
// ============================================

/**
 * Import a parsed trip into the canonical structure
 *
 * DEDUPLICATION STRATEGY (Priority Order):
 * 1. If tripId provided → use that trip directly
 * 2. Match by pairingId (exact match, highest confidence)
 * 3. Match by tripNumber (fallback)
 * 4. Match by matchKey (base + date + time + flight number)
 * 5. Match by exact date range (startDate + endDate)
 * 6. If no match → create new trip
 *
 * DATE VALIDATION:
 * - startDate must be ≤ endDate
 * - Dates must be valid YYYY-MM-DD format
 */
export async function importToCanonicalStructure(
  userId: string,
  airlineCode: string,
  parsed: ParsedTripImport,
  tripId?: string
): Promise<CanonicalImportResult> {
  const result: CanonicalImportResult = {
    tripId: "",
    dutyDayIds: [],
    legIds: [],
    layoverIds: [],
    hotelsPopulated: 0,
    hotelsFromDirectory: 0,
    needsHotelReview: [],
  };

  // ============================================
  // 1. Determine and validate date range
  // ============================================
  let startDate = parsed.startDate;
  let endDate = parsed.endDate;

  // Derive from duty days if not provided
  if (!startDate && parsed.dutyDays.length > 0) {
    // Sort duty days by date to ensure correct order
    const sortedDutyDays = [...parsed.dutyDays].sort((a, b) => a.date.localeCompare(b.date));
    startDate = sortedDutyDays[0]?.date;
    endDate = sortedDutyDays[sortedDutyDays.length - 1]?.date;
  }

  // Fallback to today if no dates found
  if (!startDate) {
    startDate = new Date().toISOString().split("T")[0]!;
    endDate = startDate;
  }

  // Ensure endDate is set
  if (!endDate) {
    endDate = startDate;
  }

  // DATE VALIDATION: Ensure startDate ≤ endDate
  if (startDate > endDate) {
    console.warn(`[Import] Invalid date range: startDate ${startDate} > endDate ${endDate}. Swapping.`);
    [startDate, endDate] = [endDate, startDate];
  }

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    throw new Error(`Invalid date format. Expected YYYY-MM-DD, got startDate=${startDate}, endDate=${endDate}`);
  }

  // ============================================
  // 2. Generate matchKey for deduplication
  // ============================================
  const firstDutyDay = parsed.dutyDays[0];
  const firstLeg = firstDutyDay?.legs[0];
  const matchKey = generateMatchKey(
    parsed.baseFleet ?? null,
    startDate,
    firstDutyDay?.reportTimeISO ?? null,
    firstLeg?.flightNumber ?? null
  );

  console.log(`[Import] Dedup check for user ${userId}:`, {
    pairingId: parsed.pairingId,
    tripNumber: parsed.tripNumber,
    matchKey,
    startDate,
    endDate,
  });

  // ============================================
  // 3. Find existing trip (comprehensive dedup)
  // ============================================
  let trip;

  // Priority 1: Explicit tripId provided
  if (tripId) {
    trip = await db.trip.findUnique({ where: { id: tripId } });
    if (!trip || trip.userId !== userId) {
      throw new Error("Trip not found or access denied");
    }
    console.log(`[Import] Using provided tripId: ${tripId}`);
  }

  // Priority 2: Match by pairingId + startDate (highest confidence)
  // CRITICAL: Same trip number can exist for different dates!
  // e.g., S12345 on Jan 15 vs S12345 on Feb 20 are DIFFERENT trips.
  if (!trip && parsed.pairingId && startDate) {
    trip = await db.trip.findFirst({
      where: { userId, pairingId: parsed.pairingId, startDate },
    });
    if (trip) {
      console.log(`[Import] Found existing trip by pairingId ${parsed.pairingId} + startDate ${startDate}: ${trip.id}`);
    }
  }

  // Priority 3: Match by tripNumber + startDate
  if (!trip && parsed.tripNumber && startDate) {
    trip = await db.trip.findFirst({
      where: { userId, tripNumber: parsed.tripNumber, startDate },
    });
    if (trip) {
      console.log(`[Import] Found existing trip by tripNumber ${parsed.tripNumber} + startDate ${startDate}: ${trip.id}`);
    }
  }

  // Priority 4: Match by matchKey (already includes date in the key)
  if (!trip && matchKey) {
    trip = await db.trip.findFirst({
      where: { userId, matchKey },
    });
    if (trip) {
      console.log(`[Import] Found existing trip by matchKey ${matchKey}: ${trip.id}`);
    }
  }

  // Priority 5: Match by exact date range (same start AND end date) with identifier overlap
  if (!trip) {
    trip = await db.trip.findFirst({
      where: {
        userId,
        startDate,
        endDate,
        // Only match if there's some identifying info overlap
        OR: [
          parsed.pairingId ? { pairingId: parsed.pairingId } : undefined,
          parsed.tripNumber ? { tripNumber: parsed.tripNumber } : undefined,
          // Also match if the trip has no identifier (manual entry)
          { pairingId: null, tripNumber: null },
        ].filter(Boolean) as any,
      },
    });
    if (trip) {
      console.log(`[Import] Found existing trip by date range ${startDate} to ${endDate}: ${trip.id}`);
    }
  }

  // ============================================
  // 4. Create or update trip
  // ============================================
  if (!trip) {
    console.log(`[Import] Creating new trip with pairingId=${parsed.pairingId}, matchKey=${matchKey}`);
    try {
      trip = await db.trip.create({
        data: {
          userId,
          tripNumber: parsed.tripNumber ?? null,
          pairingId: parsed.pairingId ?? null,
          matchKey, // Store matchKey for future dedup
          baseFleet: parsed.baseFleet ?? null,
          startDate,
          endDate,
          source: "import",
          totalCreditMinutes: parsed.totals?.creditMinutes ?? 0,
          totalBlockMinutes: parsed.totals?.blockMinutes ?? 0,
          totalTafbMinutes: parsed.totals?.tafbMinutes ?? 0,
          totalPdiemCents: parsed.totals?.perDiemCents ?? 0,
          dutyDaysCount: parsed.dutyDays.length,
          status: "scheduled",
        },
      });
    } catch (error: any) {
      // Handle unique constraint violation (race condition or duplicate)
      if (error?.code === "P2002") {
        console.log(`[Import] Unique constraint hit, retrying lookup...`);
        // Retry finding the trip that was just created by another process
        trip = await db.trip.findFirst({
          where: {
            userId,
            OR: [
              parsed.pairingId ? { pairingId: parsed.pairingId } : undefined,
              { matchKey },
            ].filter(Boolean) as any,
          },
        });
        if (!trip) {
          throw new Error(`Duplicate trip detected but could not find existing: pairingId=${parsed.pairingId}, matchKey=${matchKey}`);
        }
        console.log(`[Import] Found existing trip after constraint hit: ${trip.id}`);
      } else {
        throw error;
      }
    }
  } else {
    // Update existing trip with any new data
    console.log(`[Import] Updating existing trip ${trip.id} with new data`);
    await db.trip.update({
      where: { id: trip.id },
      data: {
        tripNumber: parsed.tripNumber ?? trip.tripNumber,
        pairingId: parsed.pairingId ?? trip.pairingId,
        matchKey: matchKey ?? trip.matchKey, // Update matchKey if we have a better one
        baseFleet: parsed.baseFleet ?? trip.baseFleet,
        startDate, // Always update to latest parsed dates
        endDate,
        totalCreditMinutes: parsed.totals?.creditMinutes ?? trip.totalCreditMinutes,
        totalBlockMinutes: parsed.totals?.blockMinutes ?? trip.totalBlockMinutes,
        totalTafbMinutes: parsed.totals?.tafbMinutes ?? trip.totalTafbMinutes,
        totalPdiemCents: parsed.totals?.perDiemCents ?? trip.totalPdiemCents,
        dutyDaysCount: parsed.dutyDays.length || trip.dutyDaysCount,
      },
    });
  }

  result.tripId = trip.id;

  // 2. Clear existing canonical structure for this trip (for re-import)
  await db.tripLayover.deleteMany({
    where: { tripDutyDay: { tripId: trip.id } },
  });
  await db.tripDutyLeg.deleteMany({
    where: { tripDutyDay: { tripId: trip.id } },
  });
  await db.tripDutyDay.deleteMany({
    where: { tripId: trip.id },
  });

  // 3. Create duty days with legs - OPTIMIZED: Use batch operations
  const createdDutyDays: Array<{
    id: string;
    index: number;
    releaseTimeISO: string | null;
    finalLegDestination: string | null;
    restMinutesExplicit?: number;
  }> = [];

  // OPTIMIZATION: Prepare all duty day data first, then batch insert
  const dutyDayDataList: Array<{
    tripId: string;
    dutyDayIndex: number;
    dutyDate: string;
    reportTimeISO: string | null;
    releaseTimeISO: string | null;
    dutyMinutes: number;
    blockMinutes: number;
    creditMinutes: number;
    restAfterMinutes: number | null;
    layoverStation: string | null;
  }> = [];

  // Track leg data keyed by duty day index for batch insert later
  const legDataByDutyIndex = new Map<number, Array<{
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
    creditMinutes: number;
  }>>();

  // Track final destinations for layover creation
  const finalDestinationByIndex = new Map<number, string | null>();
  const restMinutesByIndex = new Map<number, number | undefined>();

  for (const dd of parsed.dutyDays) {
    // Calculate totals from legs if not provided
    let dutyBlockMinutes = dd.blockMinutes;
    let dutyCreditMinutes = dd.creditMinutes;

    if (dutyBlockMinutes === 0 && dd.legs.length > 0) {
      dutyBlockMinutes = dd.legs.reduce((sum, leg) => sum + leg.plannedBlockMinutes, 0);
    }
    if (dutyCreditMinutes === 0 && dd.legs.length > 0) {
      dutyCreditMinutes = dd.legs.reduce((sum, leg) => sum + leg.plannedCreditMinutes, 0);
    }

    dutyDayDataList.push({
      tripId: trip.id,
      dutyDayIndex: dd.index,
      dutyDate: dd.date,
      reportTimeISO: dd.reportTimeISO ?? null,
      releaseTimeISO: dd.releaseTimeISO ?? null,
      dutyMinutes: dd.dutyMinutes,
      blockMinutes: dutyBlockMinutes,
      creditMinutes: dutyCreditMinutes,
      restAfterMinutes: null,
      layoverStation: null,
    });

    // Prepare leg data
    const legDataList: typeof legDataByDutyIndex extends Map<number, infer T> ? T : never = [];
    let finalLegDestination: string | null = null;

    for (let i = 0; i < dd.legs.length; i++) {
      const leg = dd.legs[i]!;
      legDataList.push({
        legIndex: i + 1,
        flightNumber: leg.flightNumber ?? null,
        origin: leg.origin ?? null,
        destination: leg.destination ?? null,
        equipment: leg.equipment ?? null,
        isDeadhead: leg.isDeadhead,
        scheduledOutISO: leg.scheduledOutISO ?? null,
        scheduledInISO: leg.scheduledInISO ?? null,
        plannedBlockMinutes: leg.plannedBlockMinutes,
        plannedCreditMinutes: leg.plannedCreditMinutes,
        creditMinutes: leg.plannedCreditMinutes,
      });
      finalLegDestination = leg.destination ?? null;
    }

    legDataByDutyIndex.set(dd.index, legDataList);
    finalDestinationByIndex.set(dd.index, finalLegDestination);
    restMinutesByIndex.set(dd.index, dd.restMinutesExplicit);
  }

  // BATCH INSERT: Create all duty days at once
  if (dutyDayDataList.length > 0) {
    await db.tripDutyDay.createMany({ data: dutyDayDataList });
  }

  // Fetch created duty days to get their IDs
  const createdDutyDayRecords = await db.tripDutyDay.findMany({
    where: { tripId: trip.id },
    orderBy: { dutyDayIndex: "asc" },
    select: { id: true, dutyDayIndex: true, releaseTimeISO: true },
  });

  // Map duty day IDs and prepare leg inserts
  const allLegData: Array<{
    tripDutyDayId: string;
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
    creditMinutes: number;
  }> = [];

  for (const ddRecord of createdDutyDayRecords) {
    result.dutyDayIds.push(ddRecord.id);

    const legDataList = legDataByDutyIndex.get(ddRecord.dutyDayIndex) || [];
    for (const legData of legDataList) {
      allLegData.push({
        tripDutyDayId: ddRecord.id,
        ...legData,
      });
    }

    createdDutyDays.push({
      id: ddRecord.id,
      index: ddRecord.dutyDayIndex,
      releaseTimeISO: ddRecord.releaseTimeISO,
      finalLegDestination: finalDestinationByIndex.get(ddRecord.dutyDayIndex) ?? null,
      restMinutesExplicit: restMinutesByIndex.get(ddRecord.dutyDayIndex),
    });
  }

  // BATCH INSERT: Create all legs at once
  if (allLegData.length > 0) {
    await db.tripDutyLeg.createMany({ data: allLegData });

    // Fetch leg IDs
    const createdLegs = await db.tripDutyLeg.findMany({
      where: { tripDutyDayId: { in: result.dutyDayIds } },
      select: { id: true },
    });
    result.legIds = createdLegs.map(l => l.id);
  }

  // 4. Calculate layover/rest times and create layover records
  // Sort duty days by index
  createdDutyDays.sort((a, b) => a.index - b.index);

  // OPTIMIZATION: Prefetch all hotels in parallel before the layover loop
  const layoverStations = createdDutyDays
    .filter((_, i) => i < createdDutyDays.length - 1) // All except last day (no layover after last day)
    .map(d => d.finalLegDestination)
    .filter((s): s is string => s !== null);

  const prefetchedHotels = await prefetchHotelsForStations(
    userId,
    airlineCode,
    layoverStations,
    parsed.baseFleet?.split(" ")[0],
    parsed.baseFleet?.split(" ")[1]
  );

  // OPTIMIZED: Prepare all layover data and duty day updates, then batch execute
  const layoversToCreate: Array<{
    tripDutyDayId: string;
    station: string;
    restMinutes: number;
    hotelName: string | null;
    hotelPhone: string | null;
    hotelAddress: string | null;
    hotelStatus: string | null;
    hotelSource: string | null;
    hotelConfidence: number;
    transportNotes: string | null;
    transportPhone: string | null;
  }> = [];
  const dutyDayUpdates: Array<{ id: string; restAfterMinutes: number | null; layoverStation: string | null }> = [];
  const hotelsToLearn: Array<{ station: string; name: string; phone: string | null; address: string | null }> = [];
  const layoverNeedsReviewIndices: number[] = [];

  for (let i = 0; i < createdDutyDays.length - 1; i++) {
    const currentDay = createdDutyDays[i]!;
    const nextDay = createdDutyDays[i + 1];

    // Get next day's report time from parsed data
    const nextDayParsed = parsed.dutyDays.find(d => d.index === nextDay?.index);
    const nextDutyStartISO = nextDayParsed?.reportTimeISO;

    // Calculate rest: next duty start - prior duty end
    let restMinutes: number | null = null;

    // PRIORITY 1: If explicit rest time was parsed from the schedule, use it (source of truth)
    if (currentDay.restMinutesExplicit && currentDay.restMinutesExplicit > 0) {
      restMinutes = currentDay.restMinutesExplicit;
    } else {
      // PRIORITY 2: Calculate from duty end to next duty start
      restMinutes = calculateRestMinutes(currentDay.releaseTimeISO, nextDutyStartISO);
    }

    // Layover station = arrival station of final leg of current duty day
    const layoverStation = currentDay.finalLegDestination;

    // Queue duty day update
    dutyDayUpdates.push({
      id: currentDay.id,
      restAfterMinutes: restMinutes,
      layoverStation,
    });

    // Find matching hotel from parsed data
    let hotelInfo: ParsedHotel | undefined;
    if (layoverStation) {
      hotelInfo = parsed.hotels.find(h =>
        h.station === layoverStation || !h.station
      );
      if (hotelInfo) {
        const idx = parsed.hotels.indexOf(hotelInfo);
        if (idx >= 0) parsed.hotels.splice(idx, 1);
      }
    }

    // Prepare layover record data
    let hotelSource: string | null = null;
    let hotelConfidence = 0;
    let hotelName: string | null = null;
    let hotelPhone: string | null = null;
    let hotelAddress: string | null = null;
    let hotelStatus: string | null = null;
    let needsReview = false;

    if (hotelInfo) {
      hotelName = hotelInfo.name;
      hotelPhone = hotelInfo.phone ?? null;
      hotelAddress = hotelInfo.address ?? null;
      hotelStatus = hotelInfo.status ?? null;
      hotelSource = "trip_info";
      hotelConfidence = 0.95;
      result.hotelsPopulated++;

      if (layoverStation) {
        hotelsToLearn.push({
          station: layoverStation,
          name: hotelName,
          phone: hotelPhone,
          address: hotelAddress,
        });
      }
    } else if (layoverStation) {
      const directoryHotel = prefetchedHotels.get(layoverStation);
      if (directoryHotel) {
        hotelName = directoryHotel.hotelName;
        hotelPhone = directoryHotel.hotelPhone ?? null;
        hotelAddress = directoryHotel.hotelAddress ?? null;
        hotelSource = directoryHotel.source;
        hotelConfidence = directoryHotel.confidence;
        result.hotelsFromDirectory++;
        if (hotelConfidence < 0.7) {
          needsReview = true;
        }
      }
    }

    if (layoverStation && restMinutes !== null) {
      layoversToCreate.push({
        tripDutyDayId: currentDay.id,
        station: layoverStation,
        restMinutes,
        hotelName,
        hotelPhone,
        hotelAddress,
        hotelStatus,
        hotelSource,
        hotelConfidence,
        transportNotes: null,
        transportPhone: null,
      });
      if (needsReview) {
        layoverNeedsReviewIndices.push(layoversToCreate.length - 1);
      }
    }
  }

  // BATCH EXECUTE: Update all duty days in parallel
  if (dutyDayUpdates.length > 0) {
    await Promise.all(
      dutyDayUpdates.map(update =>
        db.tripDutyDay.update({
          where: { id: update.id },
          data: {
            restAfterMinutes: update.restAfterMinutes,
            layoverStation: update.layoverStation,
          },
        })
      )
    );
  }

  // BATCH INSERT: Create all layovers at once
  if (layoversToCreate.length > 0) {
    await db.tripLayover.createMany({ data: layoversToCreate });

    // Fetch created layover IDs
    const createdLayovers = await db.tripLayover.findMany({
      where: { tripDutyDayId: { in: createdDutyDays.map(d => d.id) } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    result.layoverIds = createdLayovers.map(l => l.id);

    // Mark which ones need review
    for (const idx of layoverNeedsReviewIndices) {
      if (createdLayovers[idx]) {
        result.needsHotelReview.push(createdLayovers[idx]!.id);
      }
    }
  }

  // Learn hotels in background (non-blocking)
  if (hotelsToLearn.length > 0) {
    Promise.all(
      hotelsToLearn.map(h =>
        confirmHotelInDirectory(
          userId,
          airlineCode,
          h.station,
          h.name,
          h.phone,
          h.address,
          parsed.baseFleet?.split(" ")[0],
          parsed.baseFleet?.split(" ")[1],
          false
        ).catch(() => {})
      )
    ).catch(() => {});
  }

  // 5. Recalculate trip totals from actual duty day data
  // This ensures totals are correct even if OCR didn't detect them
  const tripDutyDays = await db.tripDutyDay.findMany({
    where: { tripId: trip.id },
    include: { legs: true },
  });

  // Calculate totals from duty days
  let recalculatedBlockMinutes = 0;
  let recalculatedCreditMinutes = 0;
  let recalculatedTafbMinutes = 0;

  for (const dd of tripDutyDays) {
    // Sum block and credit from duty days (which were already calculated from legs if needed)
    recalculatedBlockMinutes += dd.blockMinutes;
    recalculatedCreditMinutes += dd.creditMinutes;
    // Add duty time + rest time for TAFB
    recalculatedTafbMinutes += dd.dutyMinutes + (dd.restAfterMinutes ?? 0);
  }

  // Determine final totals with proper fallback logic
  // BLOCK: Use recalculated if > 0, otherwise parsed
  const finalBlockMinutes = recalculatedBlockMinutes > 0
    ? recalculatedBlockMinutes
    : (parsed.totals?.blockMinutes ?? 0);

  // CREDIT: Prefer parsed credit from schedule footer when available
  // Credit time is often GREATER than block sum due to:
  // - Daily minimum guarantees (e.g., 6:00 min per day)
  // - Rig rules (duty rigs, trip rigs)
  // - Premium adjustments
  // The parsed credit from the schedule footer is the authoritative value
  const parsedCreditMinutes = parsed.totals?.creditMinutes ?? 0;
  const finalCreditMinutes = parsedCreditMinutes > 0
    ? Math.max(parsedCreditMinutes, recalculatedCreditMinutes)  // Use whichever is larger (credit usually >= block)
    : (recalculatedCreditMinutes > 0 ? recalculatedCreditMinutes : 0);

  // TAFB: Prefer parsed TAFB when available (more accurate than calculated)
  const parsedTafbMinutes = parsed.totals?.tafbMinutes ?? 0;
  const finalTafbMinutes = parsedTafbMinutes > 0
    ? parsedTafbMinutes  // Parsed TAFB from schedule is authoritative
    : (recalculatedTafbMinutes > 0 ? recalculatedTafbMinutes : 0);

  console.log(`[Canonical] Final totals: Block=${finalBlockMinutes}min (recalc=${recalculatedBlockMinutes}), Credit=${finalCreditMinutes}min (parsed=${parsedCreditMinutes}, recalc=${recalculatedCreditMinutes}), TAFB=${finalTafbMinutes}min (parsed=${parsedTafbMinutes})`);

  // Determine duty days count - use the maximum of parsed totals and actual duty days created
  const parsedDutyDays = parsed.totals?.dutyDays ?? 0;
  const actualDutyDays = result.dutyDayIds.length;
  const finalDutyDaysCount = Math.max(parsedDutyDays, actualDutyDays);
  console.log(`[Canonical] Duty days: parsed=${parsedDutyDays}, actual=${actualDutyDays}, final=${finalDutyDaysCount}`);

  await db.trip.update({
    where: { id: trip.id },
    data: {
      legCount: result.legIds.length,
      dutyDaysCount: finalDutyDaysCount,
      totalBlockMinutes: finalBlockMinutes,
      totalCreditMinutes: finalCreditMinutes,
      totalTafbMinutes: finalTafbMinutes,
    },
  });

  return result;
}

// ============================================
// Parse AI/OCR Response to Canonical Format
// ============================================

/**
 * Convert AI-parsed schedule data to canonical ParsedTripImport format
 */
export function normalizeAIParsedData(aiData: any, sourceType: ImportSourceType): ParsedTripImport {
  const result: ParsedTripImport = {
    sourceType,
    tripNumber: aiData.tripNumber,
    pairingId: aiData.pairingId,
    baseFleet: aiData.baseFleet,
    startDate: aiData.startDate,
    endDate: aiData.endDate,
    dutyDays: [],
    hotels: [],
    transport: [],
    totals: {
      creditMinutes: aiData.totals?.creditMinutes ?? 0,
      blockMinutes: aiData.totals?.blockMinutes ?? 0,
      tafbMinutes: aiData.totals?.tafbMinutes ?? 0,
      dutyDays: aiData.totals?.dutyDays ?? aiData.totals?.tripDays ?? 0,
      perDiemCents: aiData.totals?.perDiemCents ?? 0,
    },
    confidence: aiData.confidence ?? 0.8,
  };

  // NEW FORMAT: Check if AI returned dutyPeriods (new format with proper duty day grouping)
  if (aiData.dutyPeriods && Array.isArray(aiData.dutyPeriods) && aiData.dutyPeriods.length > 0) {
    console.log(`[Canonical] Processing ${aiData.dutyPeriods.length} duty periods (new AI format)`);

    // Group events by dutyDayNumber
    const eventsByDutyDay = new Map<number, any[]>();
    if (aiData.events && Array.isArray(aiData.events)) {
      for (const event of aiData.events) {
        const dutyNum = event.dutyDayNumber || 1;
        if (!eventsByDutyDay.has(dutyNum)) {
          eventsByDutyDay.set(dutyNum, []);
        }
        eventsByDutyDay.get(dutyNum)!.push(event);
      }
    }

    // Create duty days from dutyPeriods
    for (const dp of aiData.dutyPeriods) {
      const dutyNum = dp.dutyDayNumber || 1;
      const events = eventsByDutyDay.get(dutyNum) || [];

      // Compute duty period date from trip startDate + (dayNumber - 1)
      // The "Day" column in Crew Access uses calendar day offset from trip start
      // Day 1 = startDate, Day 3 = startDate + 2, etc.
      let dpStartDate = dp.startDate;
      if (!dpStartDate && aiData.startDate) {
        const base = new Date(aiData.startDate + 'T12:00:00');
        base.setDate(base.getDate() + (dutyNum - 1));
        dpStartDate = base.toISOString().split('T')[0]!;
      }
      // Override dp.startDate with computed value for use below
      const effectiveStartDate = dpStartDate || aiData.startDate || new Date().toISOString().split('T')[0]!;

      // Sort events by leg index if provided, otherwise by scheduled out time
      // CRITICAL: For overnight flights, we need to handle times that cross midnight
      // e.g., 19:00 departure should come BEFORE 01:16 departure (next day)
      events.sort((a, b) => {
        // If leg index is provided, use it (most reliable)
        if (a.legIndex !== undefined && b.legIndex !== undefined) {
          return a.legIndex - b.legIndex;
        }

        // Otherwise sort by departure time, accounting for overnight flights
        const timeA = a.scheduledOut || a.startTime || "00:00";
        const timeB = b.scheduledOut || b.startTime || "00:00";

        // Parse hours to detect overnight crossings
        // Times before 06:00 are likely "next day" flights in an overnight duty
        const hoursA = parseInt(timeA.split(":")[0] || "0");
        const hoursB = parseInt(timeB.split(":")[0] || "0");

        // If one is early morning (before 6am) and one is evening (after 6pm),
        // the evening one comes first
        const isEarlyMorningA = hoursA < 6;
        const isEarlyMorningB = hoursB < 6;
        const isEveningA = hoursA >= 18;
        const isEveningB = hoursB >= 18;

        if (isEveningA && isEarlyMorningB) return -1; // A (evening) comes first
        if (isEarlyMorningA && isEveningB) return 1;  // B (evening) comes first

        // Same period - sort normally by time
        return timeA.localeCompare(timeB);
      });

      // Create legs from events with proper date handling for overnight flights
      const legs: ParsedLeg[] = events
        .filter((e: any) => {
          const eventType = (e.eventType || e.type || "").toString().toUpperCase();
          return eventType === "FLIGHT" || eventType === "" || e.flightNumber;
        })
        .map((event: any) => {
          const depTime = event.scheduledOut || "00:00";
          const arrTime = event.scheduledIn || "00:00";
          const depHour = parseInt(depTime.split(":")[0] || "0");
          const arrHour = parseInt(arrTime.split(":")[0] || "0");

          // Determine departure date
          // Use event.date if provided, otherwise effectiveStartDate
          // If departure is early morning (before 6am) and duty spans multiple days, use endDate
          let depDate = event.date || effectiveStartDate;
          if (depHour < 6 && dp.endDate && dp.endDate !== effectiveStartDate) {
            depDate = dp.endDate;
          }

          // Determine arrival date
          // If arrival time < departure time, arrival is next day
          let arrDate = depDate;
          if (arrTime && depTime && arrHour < depHour) {
            // Arrival is next day
            const nextDay = new Date(depDate);
            nextDay.setDate(nextDay.getDate() + 1);
            arrDate = nextDay.toISOString().split("T")[0] || depDate;
          }

          const isDeadhead = event.isDeadhead === true || (event.type || event.eventType || "").toString().toUpperCase() === "DEADHEAD";

          // BLOCK TIME LOGIC - PARSED VALUE IS AUTHORITATIVE
          // Only compute from times if:
          // 1. No blockMinutes value was provided (undefined/null)
          // 2. Not a deadhead (deadheads legitimately have 0 block)
          let blockMinutes = event.blockMinutes ?? 0;
          let blockWasComputed = false;

          // Check if blockMinutes was explicitly provided (even if 0)
          const hasExplicitBlock = event.blockMinutes !== undefined && event.blockMinutes !== null;

          if (!hasExplicitBlock && !isDeadhead && event.scheduledOut && event.scheduledIn) {
            // No block was parsed - compute from times as fallback
            const computed = computeBlockFromTimes(event.scheduledOut, event.scheduledIn);
            if (computed > 0) {
              blockMinutes = computed;
              blockWasComputed = true;
              console.log(`[Canonical] Computed block from times (no parsed value): ${event.scheduledOut} -> ${event.scheduledIn} = ${blockMinutes} min`);
            }
          } else if (hasExplicitBlock && blockMinutes > 0 && event.scheduledOut && event.scheduledIn) {
            // We have a parsed block value - validate it against computed but KEEP parsed
            const computed = computeBlockFromTimes(event.scheduledOut, event.scheduledIn);
            const diff = Math.abs(blockMinutes - computed);
            if (diff > 10) {
              console.log(`[Canonical] Block mismatch for ${event.depAirport || event.origin}-${event.arrAirport || event.destination}: parsed=${blockMinutes}min vs computed=${computed}min (diff=${diff}min) - USING PARSED`);
              // DO NOT override - parsed value is authoritative
            }
          }

          // Equipment: use per-leg value or fall back to trip baseFleet
          const legEquipment = (event.equipment && event.equipment !== '')
            ? event.equipment
            : (aiData.baseFleet ? aiData.baseFleet.replace(/^[A-Z]{3}\s+/, '') : undefined);

          return {
            flightNumber: event.flightNumber,
            origin: event.depAirport || event.origin,
            destination: event.arrAirport || event.destination,
            equipment: legEquipment,
            isDeadhead,
            scheduledOutISO: event.scheduledOut ? `${depDate}T${event.scheduledOut}:00` : undefined,
            scheduledInISO: event.scheduledIn ? `${arrDate}T${event.scheduledIn}:00` : undefined,
            plannedBlockMinutes: isDeadhead ? 0 : blockMinutes,  // Deadheads don't count as block
            plannedCreditMinutes: event.creditMinutes || (isDeadhead ? 0 : blockMinutes),
            date: depDate,
          };
        });

      // Calculate duty day totals from legs
      const blockMinutes = legs.reduce((sum, leg) => sum + leg.plannedBlockMinutes, 0);
      const creditMinutes = legs.reduce((sum, leg) => sum + leg.plannedCreditMinutes, 0);

      // Build report/release times
      let reportTimeISO: string | undefined;
      let releaseTimeISO: string | undefined;

      if (dp.reportTime) {
        // Detect overnight report: if reportTime is late evening (>= 20:00) and the first
        // leg departs early morning or the report date would be before the first leg,
        // the report actually falls on the PREVIOUS calendar day.
        const reportHour = parseInt(dp.reportTime.split(':')[0] ?? '0', 10);
        let reportDate = effectiveStartDate;
        if (reportHour >= 20) {
          // Check first leg departure time — if it's early morning it's likely next day's flight
          const firstLegOut = legs[0]?.scheduledOutISO;
          if (firstLegOut) {
            const firstLegHour = parseInt((firstLegOut.split('T')[1] ?? '00').split(':')[0] ?? '0', 10);
            // If first departure is in the early morning (< 12:00) and report is late evening,
            // the report falls the evening before the duty's calendar date
            if (firstLegHour < 12) {
              const prevDay = new Date(effectiveStartDate + 'T12:00:00');
              prevDay.setDate(prevDay.getDate() - 1);
              reportDate = prevDay.toISOString().split('T')[0]!;
            }
          }
        }
        reportTimeISO = `${reportDate}T${dp.reportTime}:00`;
      } else if (legs.length > 0 && legs[0]?.scheduledOutISO) {
        reportTimeISO = legs[0].scheduledOutISO;
      }

      if (dp.releaseTime) {
        // Release time might be on the next day for overnight duties
        const releaseDate = dp.endDate || effectiveStartDate;
        releaseTimeISO = `${releaseDate}T${dp.releaseTime}:00`;
      } else if (legs.length > 0 && legs[legs.length - 1]?.scheduledInISO) {
        releaseTimeISO = legs[legs.length - 1]!.scheduledInISO;
      }

      // Calculate duty minutes
      let dutyMinutes = dp.dutyMinutes || 0;
      if (!dutyMinutes && reportTimeISO && releaseTimeISO) {
        const start = new Date(reportTimeISO);
        const end = new Date(releaseTimeISO);
        dutyMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      }

      // CRITICAL: Extract rest/layover minutes from dutyPeriod (this is the layover time!)
      const restMinutesExplicit = dp.restMinutes || undefined;
      if (restMinutesExplicit) {
        console.log(`[Canonical] Duty Day ${dutyNum} has explicit rest time: ${restMinutesExplicit} minutes (${Math.floor(restMinutesExplicit / 60)}:${String(restMinutesExplicit % 60).padStart(2, '0')})`);
      }

      result.dutyDays.push({
        index: dutyNum,
        date: effectiveStartDate,
        reportTimeISO,
        releaseTimeISO,
        dutyMinutes,
        blockMinutes: dp.blockMinutes || blockMinutes,
        creditMinutes: dp.creditMinutes || creditMinutes,
        legs,
        restMinutesExplicit,
      });
    }
  } else {
    // LEGACY FORMAT: Group events by date
    console.log(`[Canonical] Processing events by date (legacy AI format)`);

    const eventsByDate = new Map<string, any[]>();
    const hotelEvents: any[] = [];
    const transportEvents: any[] = [];

    if (aiData.events && Array.isArray(aiData.events)) {
      for (const event of aiData.events) {
        const eventDate = event.date || aiData.startDate;
        const eventType = (event.eventType || event.type || "").toString().toUpperCase();

        if (eventType === "HOTEL") {
          hotelEvents.push(event);
        } else if (eventType === "TRANSPORT") {
          transportEvents.push(event);
        } else if (eventType === "FLIGHT" || eventType === "DEADHEAD" || eventType === "" || event.flightNumber) {
          if (eventDate) {
            if (!eventsByDate.has(eventDate)) {
              eventsByDate.set(eventDate, []);
            }
            eventsByDate.get(eventDate)!.push(event);
          }
        }
      }
    }

    // Create duty days from grouped events
    const sortedDates = Array.from(eventsByDate.keys()).sort();
    let dutyDayIndex = 1;

    for (const date of sortedDates) {
      const events = eventsByDate.get(date) || [];

      // Sort events by start time
      events.sort((a, b) => {
        const timeA = a.scheduledOut || a.startTime || "00:00";
        const timeB = b.scheduledOut || b.startTime || "00:00";
        return timeA.localeCompare(timeB);
      });

      // Find report time (first event departure)
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];

      let reportTimeISO: string | undefined;
      let releaseTimeISO: string | undefined;

      const firstTime = firstEvent?.scheduledOut || firstEvent?.startTime;
      const lastTime = lastEvent?.scheduledIn || lastEvent?.endTime;

      if (firstTime) {
        reportTimeISO = `${date}T${firstTime}:00`;
      }
      if (lastTime) {
        releaseTimeISO = `${date}T${lastTime}:00`;
      }

      // Create legs from events with block time computation fix
      const legs: ParsedLeg[] = events.map((event) => {
        const depTime = event.scheduledOut || event.startTime;
        const arrTime = event.scheduledIn || event.endTime;
        const isDeadhead = event.isDeadhead === true || (event.type || event.eventType || "").toString().toUpperCase() === "DEADHEAD";

        // BLOCK TIME LOGIC - PARSED VALUE IS AUTHORITATIVE
        // Only compute from times if no blockMinutes was provided AND not a deadhead
        let blockMinutes = event.blockMinutes ?? 0;
        const hasExplicitBlock = event.blockMinutes !== undefined && event.blockMinutes !== null;

        if (!hasExplicitBlock && !isDeadhead && depTime && arrTime) {
          // No block was parsed - compute from times as fallback
          const computed = computeBlockFromTimes(depTime, arrTime);
          if (computed > 0) {
            blockMinutes = computed;
            console.log(`[Canonical Legacy] Computed block from times (no parsed value): ${depTime} -> ${arrTime} = ${blockMinutes} min`);
          }
        } else if (hasExplicitBlock && blockMinutes > 0 && depTime && arrTime) {
          // We have a parsed block value - validate but KEEP parsed
          const computed = computeBlockFromTimes(depTime, arrTime);
          const diff = Math.abs(blockMinutes - computed);
          if (diff > 10) {
            console.log(`[Canonical Legacy] Block mismatch for ${event.depAirport || event.origin}-${event.arrAirport || event.destination}: parsed=${blockMinutes}min vs computed=${computed}min (diff=${diff}min) - USING PARSED`);
          }
        }

        // Compute correct arrival ISO - if arrTime < depTime on same day and block is short, compute from dep+block
        let scheduledInISO: string | undefined;
        if (arrTime) {
          const depMinutes = depTime ? parseInt(depTime.split(':')[0]!) * 60 + parseInt(depTime.split(':')[1]!) : 0;
          const arrMinutes = parseInt(arrTime.split(':')[0]!) * 60 + parseInt(arrTime.split(':')[1]!);
          // If arrival appears before departure and we have block time, compute arrival from dep + block
          if (depTime && arrMinutes < depMinutes && blockMinutes > 0) {
            const computedArrMinutes = depMinutes + blockMinutes;
            const computedArrH = Math.floor(computedArrMinutes / 60) % 24;
            const computedArrM = computedArrMinutes % 60;
            const computedArrDate = computedArrMinutes >= 1440
              ? (() => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]!; })()
              : date;
            const computedArrTime = `${String(computedArrH).padStart(2,'0')}:${String(computedArrM).padStart(2,'0')}`;
            scheduledInISO = `${computedArrDate}T${computedArrTime}:00`;
            console.log(`[Canonical Legacy] Fixed arrTime for ${event.depAirport || event.origin}-${event.arrAirport || event.destination}: ${arrTime} → ${computedArrTime} (dep ${depTime} + ${blockMinutes}min block)`);
          } else {
            scheduledInISO = `${date}T${arrTime}:00`;
          }
        }

        // Equipment: use per-leg value or fall back to trip baseFleet
        const legEquipment = (event.equipment && event.equipment !== '')
          ? event.equipment
          : (aiData.baseFleet ? aiData.baseFleet.replace(/^[A-Z]{3}\s+/, '') : undefined);

        return {
          flightNumber: event.flightNumber,
          origin: event.depAirport || event.origin,
          destination: event.arrAirport || event.destination,
          equipment: legEquipment,
          isDeadhead,
          scheduledOutISO: depTime ? `${date}T${depTime}:00` : undefined,
          scheduledInISO,
          plannedBlockMinutes: isDeadhead ? 0 : blockMinutes,  // Deadheads don't count as block
          plannedCreditMinutes: event.creditMinutes || (isDeadhead ? 0 : blockMinutes),
          date,
        };
      });

      // Calculate duty day totals
      const blockMinutes = legs.reduce((sum, leg) => sum + leg.plannedBlockMinutes, 0);
      const creditMinutes = legs.reduce((sum, leg) => sum + leg.plannedCreditMinutes, 0);

      // Calculate duty minutes from first departure to last arrival
      let dutyMinutes = 0;
      if (reportTimeISO && releaseTimeISO) {
        const start = new Date(reportTimeISO);
        const end = new Date(releaseTimeISO);
        dutyMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      }

      result.dutyDays.push({
        index: dutyDayIndex++,
        date,
        reportTimeISO,
        releaseTimeISO,
        dutyMinutes,
        blockMinutes,
        creditMinutes,
        legs,
      });
    }
  }

  // Extract hotel info - from dedicated hotels array (preferred) or hotel events
  if (aiData.hotels && Array.isArray(aiData.hotels)) {
    for (const hotel of aiData.hotels) {
      if (hotel.name) {
        result.hotels.push({
          station: hotel.airport || hotel.layoverAirport || hotel.station,
          name: hotel.name,
          phone: hotel.phone,
          status: hotel.status || (hotel.booked ? "BOOKED" : undefined),
          address: hotel.address,
        });
      }
    }
  }

  // Extract transport info
  if (aiData.transport && Array.isArray(aiData.transport)) {
    for (const trans of aiData.transport) {
      if (trans.notes) {
        result.transport.push({
          station: trans.layoverAirport || trans.station,
          notes: trans.notes,
          phone: trans.phone,
        });
      }
    }
  }

  // Recalculate totals from duty days if not provided or zero
  if (result.dutyDays.length > 0) {
    let calculatedBlockMinutes = 0;
    let calculatedCreditMinutes = 0;
    let calculatedTafbMinutes = 0;

    for (const dd of result.dutyDays) {
      calculatedBlockMinutes += dd.blockMinutes;
      calculatedCreditMinutes += dd.creditMinutes;
      // TAFB = duty time + rest time
      calculatedTafbMinutes += dd.dutyMinutes + (dd.restMinutesExplicit ?? 0);
    }

    // Use calculated values if greater than what was parsed
    if (calculatedBlockMinutes > (result.totals?.blockMinutes ?? 0)) {
      result.totals!.blockMinutes = calculatedBlockMinutes;
    }
    if (calculatedCreditMinutes > (result.totals?.creditMinutes ?? 0)) {
      result.totals!.creditMinutes = calculatedCreditMinutes;
    }
    if (calculatedTafbMinutes > (result.totals?.tafbMinutes ?? 0)) {
      result.totals!.tafbMinutes = calculatedTafbMinutes;
    }
    if (result.dutyDays.length > (result.totals?.dutyDays ?? 0)) {
      result.totals!.dutyDays = result.dutyDays.length;
    }
  }

  console.log(`[Canonical] Normalized: ${result.dutyDays.length} duty days, ${result.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0)} legs, ${result.hotels.length} hotels`);

  return result;
}

// ============================================
// Get Canonical Trip Breakdown
// ============================================

export interface CanonicalTripBreakdown {
  tripId: string;
  tripNumber?: string;
  pairingId?: string;
  baseFleet?: string;
  startDate: string;
  endDate: string;
  dutyDays: Array<{
    id: string;
    index: number;
    date: string;
    reportTimeISO?: string;
    releaseTimeISO?: string;
    dutyMinutes: number;
    blockMinutes: number;
    creditMinutes: number;
    restAfterMinutes?: number;
    layoverStation?: string;
    legs: Array<{
      id: string;
      index: number;
      flightNumber?: string;
      origin?: string;
      destination?: string;
      equipment?: string;
      isDeadhead: boolean;
      scheduledOutISO?: string;
      scheduledInISO?: string;
      plannedBlockMinutes: number;
      creditMinutes: number;
    }>;
    layover?: {
      id: string;
      station: string;
      restMinutes: number;
      hotelName?: string;
      hotelPhone?: string;
      hotelStatus?: string;
      hotelSource?: string;
      hotelConfidence: number;
      transportNotes?: string;
    };
  }>;
  totals: {
    creditMinutes: number;
    blockMinutes: number;
    tafbMinutes: number;
    dutyDays: number;
  };
}

/**
 * Get canonical trip breakdown for display
 */
export async function getCanonicalTripBreakdown(tripId: string): Promise<CanonicalTripBreakdown | null> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
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

  if (!trip) return null;

  return {
    tripId: trip.id,
    tripNumber: trip.tripNumber ?? undefined,
    pairingId: trip.pairingId ?? undefined,
    baseFleet: trip.baseFleet ?? undefined,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dutyDays: trip.tripDutyDays.map(dd => ({
      id: dd.id,
      index: dd.dutyDayIndex,
      date: dd.dutyDate,
      reportTimeISO: dd.reportTimeISO ?? undefined,
      releaseTimeISO: dd.releaseTimeISO ?? undefined,
      dutyMinutes: dd.dutyMinutes,
      blockMinutes: dd.blockMinutes,
      creditMinutes: dd.creditMinutes,
      restAfterMinutes: dd.restAfterMinutes ?? undefined,
      layoverStation: dd.layoverStation ?? undefined,
      legs: dd.legs.map(leg => ({
        id: leg.id,
        index: leg.legIndex,
        flightNumber: leg.flightNumber ?? undefined,
        origin: leg.origin ?? undefined,
        destination: leg.destination ?? undefined,
        equipment: leg.equipment ?? undefined,
        isDeadhead: leg.isDeadhead,
        scheduledOutISO: leg.scheduledOutISO ?? undefined,
        scheduledInISO: leg.scheduledInISO ?? undefined,
        plannedBlockMinutes: leg.plannedBlockMinutes,
        creditMinutes: leg.creditMinutes,
      })),
      layover: dd.layover ? {
        id: dd.layover.id,
        station: dd.layover.station,
        restMinutes: dd.layover.restMinutes,
        hotelName: dd.layover.hotelName ?? undefined,
        hotelPhone: dd.layover.hotelPhone ?? undefined,
        hotelStatus: dd.layover.hotelStatus ?? undefined,
        hotelSource: dd.layover.hotelSource ?? undefined,
        hotelConfidence: dd.layover.hotelConfidence,
        transportNotes: dd.layover.transportNotes ?? undefined,
      } : undefined,
    })),
    totals: {
      creditMinutes: trip.totalCreditMinutes,
      blockMinutes: trip.totalBlockMinutes,
      tafbMinutes: trip.totalTafbMinutes,
      dutyDays: trip.dutyDaysCount,
    },
  };
}
