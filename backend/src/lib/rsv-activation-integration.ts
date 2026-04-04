/**
 * RSV Activation Integration
 *
 * Handles automatic activation of Reserve Schedule Events (RSV) during import.
 * When a schedule upload contains legs that overlap with an existing RSV event,
 * this module attaches those legs to the RSV instead of creating a new Trip.
 *
 * Key Rules:
 * 1. RSV credit is LOCKED - never modified during activation
 * 2. Block hours are populated from actual flying legs
 * 3. Activation status is updated based on legs attached
 * 4. No duplicate trips are created for RSV activations
 */

import { db } from "../db";

// ============================================
// Types
// ============================================

export interface MatchingLeg {
  flightNumber?: string;
  origin: string;
  destination: string;
  depDtLocal: string;  // ISO datetime
  arrDtLocal: string;  // ISO datetime
  blockMinutes?: number;
  equipment?: string;
  isDeadhead?: boolean;
}

export interface RSVMatchResult {
  matched: boolean;
  matchedEventId: string | null;
  matchedEvent: {
    id: string;
    scheduleType: string;
    domicile: string;
    startDtLocal: string;
    endDtLocal: string;
    creditHours: number;
    creditLocked: boolean;
    activationStatus: string;
  } | null;
  reason: string;
}

export interface RSVActivationResult {
  success: boolean;
  eventId: string | null;
  legsAdded: number;
  blockHoursUpdated: number;
  creditPreserved: number;  // Credit that remains locked
  activationStatus: string;
  message: string;
}

// RSV schedule types that support activation
const RSV_TYPES = ["RSVA", "RSVB", "RSVC", "RSVD"];

// ============================================
// Helper Functions
// ============================================

/**
 * Extract leg data from parsed schedule result for RSV matching
 */
export function extractLegsForRSVMatching(parsedData: any): MatchingLeg[] {
  const legs: MatchingLeg[] = [];

  // Handle events array (AI parser output)
  if (parsedData.events && Array.isArray(parsedData.events)) {
    for (const event of parsedData.events) {
      const eventType = (event.eventType || event.type || "").toString().toUpperCase();

      // Only include flight events (not layovers, hotels, etc.)
      if (eventType === "FLIGHT" || eventType === "DEADHEAD" || eventType === "" || event.flightNumber) {
        const depAirport = event.depAirport || event.origin;
        const arrAirport = event.arrAirport || event.destination;
        const date = event.date || parsedData.startDate;

        if (depAirport && arrAirport && date) {
          const depTime = event.scheduledOut || event.startTime || "00:00";
          const arrTime = event.scheduledIn || event.endTime || "23:59";

          legs.push({
            flightNumber: event.flightNumber,
            origin: depAirport,
            destination: arrAirport,
            depDtLocal: `${date}T${depTime}:00`,
            arrDtLocal: `${date}T${arrTime}:00`,
            blockMinutes: event.blockMinutes || 0,
            equipment: event.equipment,
            isDeadhead: event.isDeadhead || eventType === "DEADHEAD",
          });
        }
      }
    }
  }

  // Handle duty periods (robust parser output)
  if (parsedData.dutyPeriods && Array.isArray(parsedData.dutyPeriods)) {
    for (const dp of parsedData.dutyPeriods) {
      const dpDate = dp.startDate || parsedData.startDate;

      if (dp.legs && Array.isArray(dp.legs)) {
        for (const leg of dp.legs) {
          if (leg.depAirport && leg.arrAirport) {
            legs.push({
              flightNumber: leg.flightNumber,
              origin: leg.depAirport,
              destination: leg.arrAirport,
              depDtLocal: leg.depLocalTime ? `${dpDate}T${leg.depLocalTime}:00` : `${dpDate}T00:00:00`,
              arrDtLocal: leg.arrLocalTime ? `${dpDate}T${leg.arrLocalTime}:00` : `${dpDate}T23:59:00`,
              blockMinutes: leg.blockMinutes || 0,
              equipment: leg.equipment,
              isDeadhead: leg.dhFlag || false,
            });
          }
        }
      }
    }
  }

  // Handle dutyDays (canonical format)
  if (parsedData.dutyDays && Array.isArray(parsedData.dutyDays)) {
    for (const dd of parsedData.dutyDays) {
      const dayDate = dd.date || dd.calendarDate || parsedData.startDate;

      if (dd.legs && Array.isArray(dd.legs)) {
        for (const leg of dd.legs) {
          const origin = leg.origin || leg.depAirport;
          const destination = leg.destination || leg.arrAirport;

          if (origin && destination) {
            // Handle ISO format or time-only format
            let depDtLocal: string;
            let arrDtLocal: string;

            if (leg.scheduledOutISO) {
              depDtLocal = leg.scheduledOutISO;
            } else if (leg.depLocalTime) {
              depDtLocal = `${dayDate}T${leg.depLocalTime}:00`;
            } else {
              depDtLocal = `${dayDate}T00:00:00`;
            }

            if (leg.scheduledInISO) {
              arrDtLocal = leg.scheduledInISO;
            } else if (leg.arrLocalTime) {
              arrDtLocal = `${dayDate}T${leg.arrLocalTime}:00`;
            } else {
              arrDtLocal = `${dayDate}T23:59:00`;
            }

            legs.push({
              flightNumber: leg.flightNumber,
              origin,
              destination,
              depDtLocal,
              arrDtLocal,
              blockMinutes: leg.plannedBlockMinutes || leg.blockMinutes || 0,
              equipment: leg.equipment,
              isDeadhead: leg.isDeadhead || leg.dhFlag || false,
            });
          }
        }
      }
    }
  }

  return legs;
}

/**
 * Get date range from legs for RSV matching
 */
function getLegDateRange(legs: MatchingLeg[]): { firstDate: string; lastDate: string } | null {
  if (legs.length === 0) return null;

  const legDates = legs
    .map((l) => l.depDtLocal.split("T")[0])
    .filter((d): d is string => !!d)
    .sort();

  if (legDates.length === 0) return null;

  return {
    firstDate: legDates[0]!,
    lastDate: legDates[legDates.length - 1]!,
  };
}

// ============================================
// Main Functions
// ============================================

/**
 * Check if legs from a schedule upload match an existing RSV event
 * This is called BEFORE creating a Trip to see if we should activate an RSV instead
 */
export async function matchLegsToRSV(
  userId: string,
  legs: MatchingLeg[]
): Promise<RSVMatchResult> {
  if (legs.length === 0) {
    return {
      matched: false,
      matchedEventId: null,
      matchedEvent: null,
      reason: "no_legs_provided",
    };
  }

  const dateRange = getLegDateRange(legs);
  if (!dateRange) {
    return {
      matched: false,
      matchedEventId: null,
      matchedEvent: null,
      reason: "invalid_leg_dates",
    };
  }

  const { firstDate, lastDate } = dateRange;

  console.log(`🎯 [RSV Match] Checking for RSV overlap: ${firstDate} to ${lastDate}`);

  // Find RSV events that overlap with the leg dates
  // RSV event starts before or on last leg date AND ends after or on first leg date
  const matchingEvents = await db.reserveScheduleEvent.findMany({
    where: {
      userId,
      scheduleType: { in: RSV_TYPES },
      startDtLocal: { lte: lastDate + "T23:59:59" },
      endDtLocal: { gte: firstDate + "T00:00:00" },
    },
    include: {
      activationLegs: true,
    },
    orderBy: { startDtLocal: "asc" },
  });

  if (matchingEvents.length === 0) {
    console.log(`🎯 [RSV Match] No matching RSV found for date range`);
    return {
      matched: false,
      matchedEventId: null,
      matchedEvent: null,
      reason: "no_rsv_found",
    };
  }

  // Find the best matching RSV (prefer UNACTIVATED, then closest start date)
  const unactivatedEvents = matchingEvents.filter((e) => e.activationStatus === "UNACTIVATED");
  const partialEvents = matchingEvents.filter((e) => e.activationStatus === "PARTIAL");

  // Priority: UNACTIVATED > PARTIAL > ACTIVATED
  let matchedEvent = unactivatedEvents[0] || partialEvents[0] || matchingEvents[0]!;

  console.log(`🎯 [RSV Match] Found ${matchingEvents.length} matching RSV event(s), selected: ${matchedEvent.id} (${matchedEvent.scheduleType}, status: ${matchedEvent.activationStatus})`);

  return {
    matched: true,
    matchedEventId: matchedEvent.id,
    matchedEvent: {
      id: matchedEvent.id,
      scheduleType: matchedEvent.scheduleType,
      domicile: matchedEvent.domicile,
      startDtLocal: matchedEvent.startDtLocal,
      endDtLocal: matchedEvent.endDtLocal,
      creditHours: matchedEvent.creditHours,
      creditLocked: matchedEvent.creditLocked,
      activationStatus: matchedEvent.activationStatus,
    },
    reason: "date_overlap",
  };
}

/**
 * Activate an RSV event by attaching legs to it
 * This is called when a schedule upload matches an existing RSV
 *
 * CRITICAL: Credit remains LOCKED - only blockHours is updated
 */
export async function activateRSVWithLegs(
  userId: string,
  eventId: string,
  legs: MatchingLeg[],
  sourceUploadId?: string
): Promise<RSVActivationResult> {
  // Verify the event exists and belongs to the user
  const existing = await db.reserveScheduleEvent.findFirst({
    where: { id: eventId, userId },
    include: { activationLegs: true },
  });

  if (!existing) {
    return {
      success: false,
      eventId: null,
      legsAdded: 0,
      blockHoursUpdated: 0,
      creditPreserved: 0,
      activationStatus: "UNKNOWN",
      message: "Reserve schedule event not found",
    };
  }

  console.log(`🎯 [RSV Activate] Activating RSV ${eventId} with ${legs.length} legs`);
  console.log(`   Credit locked: ${existing.creditLocked}, Current credit: ${existing.creditHours}h`);

  // Check for duplicate legs (idempotency)
  // A leg is duplicate if same flight number + origin + destination + departure time exists
  const existingLegKeys = new Set(
    existing.activationLegs.map((l) =>
      `${l.flightNumber || ""}_${l.origin}_${l.destination}_${l.depDtLocal}`
    )
  );

  const newLegs = legs.filter((leg) => {
    const key = `${leg.flightNumber || ""}_${leg.origin}_${leg.destination}_${leg.depDtLocal}`;
    return !existingLegKeys.has(key);
  });

  if (newLegs.length === 0) {
    console.log(`🎯 [RSV Activate] All legs already attached (idempotent re-upload)`);
    return {
      success: true,
      eventId: existing.id,
      legsAdded: 0,
      blockHoursUpdated: existing.blockHours,
      creditPreserved: existing.creditHours,
      activationStatus: existing.activationStatus,
      message: "All legs already attached (idempotent)",
    };
  }

  // Create activation legs in a transaction
  const result = await db.$transaction(async (tx) => {
    let totalNewBlockMinutes = 0;
    const createdLegs = [];

    // Get current max leg index
    const maxLegIndex =
      existing.activationLegs.length > 0
        ? Math.max(...existing.activationLegs.map((l) => l.legIndex))
        : -1;

    for (const [index, leg] of newLegs.entries()) {
      const blockMinutes = leg.blockMinutes ?? 0;
      totalNewBlockMinutes += blockMinutes;

      const createdLeg = await tx.activationLeg.create({
        data: {
          reserveScheduleEventId: eventId,
          flightNumber: leg.flightNumber ?? null,
          origin: leg.origin,
          destination: leg.destination,
          depDtLocal: leg.depDtLocal,
          arrDtLocal: leg.arrDtLocal,
          blockMinutes,
          equipment: leg.equipment ?? null,
          isDeadhead: leg.isDeadhead ?? false,
          legIndex: maxLegIndex + 1 + index,
          sourceUploadId: sourceUploadId ?? null,
        },
      });
      createdLegs.push(createdLeg);
    }

    // Calculate total block hours from ALL legs (existing + new)
    const allLegs = await tx.activationLeg.findMany({
      where: { reserveScheduleEventId: eventId },
    });
    const totalBlockHours = allLegs.reduce((sum, l) => sum + l.blockMinutes, 0) / 60;

    // Determine activation status
    // ACTIVATED if we have any block time, PARTIAL if legs but no block
    const activationStatus =
      allLegs.length > 0
        ? (totalBlockHours > 0 ? "ACTIVATED" : "PARTIAL")
        : "UNACTIVATED";

    // Update the event - CRITICAL: Only update blockHours, NEVER creditHours
    const updatedEvent = await tx.reserveScheduleEvent.update({
      where: { id: eventId },
      data: {
        blockHours: totalBlockHours,
        activationStatus,
      },
      include: {
        activationLegs: { orderBy: { legIndex: "asc" } },
      },
    });

    // Create log event for activation
    await tx.reserveLogEvent.create({
      data: {
        userId,
        reserveScheduleEventId: eventId,
        eventType: "activation",
        autoGeneratedNotes: `[AUTO-IMPORT] Attached ${createdLegs.length} activation legs. Total block: ${totalBlockHours.toFixed(2)} hours. Credit remains locked at ${existing.creditHours} hours.`,
        status: "saved",
      },
    });

    return {
      event: updatedEvent,
      legsAdded: createdLegs.length,
      blockHoursUpdated: totalBlockHours,
    };
  });

  console.log(`🎯 [RSV Activate] Success: ${result.legsAdded} legs added, block: ${result.blockHoursUpdated.toFixed(2)}h`);

  return {
    success: true,
    eventId: existing.id,
    legsAdded: result.legsAdded,
    blockHoursUpdated: result.blockHoursUpdated,
    creditPreserved: existing.creditHours,
    activationStatus: result.event.activationStatus,
    message: `Activated RSV with ${result.legsAdded} legs`,
  };
}

/**
 * Main entry point for RSV activation during import
 *
 * Returns:
 * - { activated: true, eventId } if RSV was found and activated
 * - { activated: false } if no RSV match, caller should create Trip
 */
export async function tryActivateRSVForImport(
  userId: string,
  parsedData: any,
  sourceUploadId?: string
): Promise<{
  activated: boolean;
  eventId?: string;
  activationResult?: RSVActivationResult;
  reason: string;
}> {
  // Extract legs from parsed data
  const legs = extractLegsForRSVMatching(parsedData);

  if (legs.length === 0) {
    return {
      activated: false,
      reason: "no_flight_legs_found",
    };
  }

  console.log(`🎯 [RSV Import] Checking ${legs.length} legs for RSV activation...`);

  // Check for matching RSV
  const matchResult = await matchLegsToRSV(userId, legs);

  if (!matchResult.matched || !matchResult.matchedEventId) {
    console.log(`🎯 [RSV Import] No RSV match: ${matchResult.reason}`);
    return {
      activated: false,
      reason: matchResult.reason,
    };
  }

  // Activate the RSV with legs
  const activationResult = await activateRSVWithLegs(
    userId,
    matchResult.matchedEventId,
    legs,
    sourceUploadId
  );

  if (!activationResult.success) {
    console.log(`🎯 [RSV Import] Activation failed: ${activationResult.message}`);
    return {
      activated: false,
      reason: activationResult.message,
    };
  }

  console.log(`🎯 [RSV Import] Successfully activated RSV ${matchResult.matchedEventId}`);

  return {
    activated: true,
    eventId: matchResult.matchedEventId,
    activationResult,
    reason: "rsv_activated",
  };
}
