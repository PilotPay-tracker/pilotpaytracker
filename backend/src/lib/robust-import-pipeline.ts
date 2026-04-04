/**
 * Robust Import Pipeline
 *
 * Integrates the robust schedule parser with the database import flow.
 * Handles:
 * - Template detection and parsing
 * - Validation gate (prevents silent failures)
 * - Trip creation/update with canonical structure
 * - Import error tracking for review UI
 */

import { db } from "../db";
import {
  parseScheduleFromOCRText,
  type ParseScheduleResult,
  type ParsedTrip,
  type ParsedDutyDay,
  type ParsedLeg,
  type ParsedLayover,
  type TemplateType,
} from "./robust-schedule-parser";
import {
  formatMinutesAsDuration,
  parseDurationToMinutes,
} from "./airport-timezones";
// NEW: RSV Activation Integration
import { tryActivateRSVForImport } from "./rsv-activation-integration";

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ImportResult {
  success: boolean;
  tripId: string | null;
  tripNumber: string | null;
  action: "created" | "updated" | "skipped" | "review_required" | "failed";
  message: string;
  warnings: string[];
  errors: string[];
  confidence: number;
  parseResult: ParseScheduleResult | null;
}

export interface BatchImportResult {
  totalImages: number;
  tripsCreated: number;
  tripsUpdated: number;
  tripsSkipped: number;
  reviewRequired: number;
  failed: number;
  results: ImportResult[];
  overallConfidence: number;
}

export interface ImportOptions {
  userId: string;
  imageUrls: string[];
  ocrText: string;
  sourceType?: TemplateType;
  baseDate?: string; // YYYY-MM-DD for month/year context
  forceReview?: boolean; // Skip validation gate
  dryRun?: boolean; // Parse only, don't save
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a match key for deduplication
 */
function generateMatchKey(trip: ParsedTrip): string {
  const firstLeg = trip.dutyDays[0]?.legs[0];
  const reportTime = trip.dutyDays[0]?.dutyStartLocalTime ?? "0000";
  return `${trip.base ?? "UNK"}_${trip.tripStartDate}_${reportTime}_${firstLeg?.flightNumber ?? "UNK"}`;
}

/**
 * Find existing trip by pairing ID + start date, or match key
 *
 * CRITICAL: Same trip number (pairingId) can exist for different dates!
 * e.g., S12345 on Jan 15 vs S12345 on Feb 20 are DIFFERENT trips.
 * We must match on BOTH pairingId AND startDate to avoid overwrites.
 */
async function findExistingTrip(
  userId: string,
  pairingId: string | null,
  tripStartDate: string | null,
  matchKey: string
): Promise<string | null> {
  // Try pairingId + startDate first (most reliable for avoiding overwrites)
  if (pairingId && tripStartDate) {
    const existingByPairingAndDate = await db.trip.findFirst({
      where: {
        userId,
        pairingId,
        startDate: tripStartDate,
      },
      select: { id: true },
    });
    if (existingByPairingAndDate) return existingByPairingAndDate.id;
  }

  // Fallback to matchKey (includes date + report time + first flight)
  const existingByMatch = await db.trip.findFirst({
    where: {
      userId,
      matchKey,
    },
    select: { id: true },
  });

  return existingByMatch?.id ?? null;
}

/**
 * Create calendar date from day label and base date context
 */
function resolveCalendarDate(
  dayLabel: string,
  baseDate: string | undefined,
  dutyDayIndex: number
): string {
  // If we have a proper date already, use it
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayLabel)) {
    return dayLabel;
  }

  // Try to compute from base date
  if (baseDate) {
    const base = new Date(baseDate + "T00:00:00Z");
    base.setUTCDate(base.getUTCDate() + dutyDayIndex - 1);
    return base.toISOString().split("T")[0]!;
  }

  // Default to today + offset
  const now = new Date();
  now.setDate(now.getDate() + dutyDayIndex - 1);
  return now.toISOString().split("T")[0]!;
}

// ============================================
// MAIN IMPORT FUNCTION
// ============================================

export async function importScheduleRobust(
  options: ImportOptions
): Promise<ImportResult> {
  const {
    userId,
    imageUrls,
    ocrText,
    baseDate,
    forceReview = false,
    dryRun = false,
  } = options;

  console.log(`📦 [RobustImport] Starting import for user: ${userId}`);
  console.log(`   Images: ${imageUrls.length}, OCR length: ${ocrText.length}`);

  // Step 1: Parse the schedule
  const parseResult = parseScheduleFromOCRText(ocrText, imageUrls, baseDate);

  console.log(`   Template: ${parseResult.templateType} (confidence: ${(parseResult.templateConfidence * 100).toFixed(1)}%)`);
  console.log(`   Validation: ${parseResult.validation.isValid ? "PASS" : "FAIL"}`);

  // Step 2: Check validation gate
  if (!parseResult.trip || !parseResult.validation.canImport) {
    console.log(`   ❌ Failed validation gate`);

    // Create import error record for review UI
    if (!dryRun) {
      await db.scheduleEvidence.create({
        data: {
          userId,
          sourceType: parseResult.templateType,
          imageUrl: imageUrls[0] ?? "",
          parseStatus: "failed",
          parseConfidence: parseResult.validation.confidence,
          rawOcrText: ocrText,
          parsedData: JSON.stringify(parseResult),
          errorMessage: parseResult.validation.errors.join("; "),
        },
      });
    }

    return {
      success: false,
      tripId: null,
      tripNumber: null,
      action: "failed",
      message: `Import failed: ${parseResult.validation.errors.join(", ")}`,
      warnings: parseResult.validation.warnings,
      errors: parseResult.validation.errors,
      confidence: parseResult.validation.confidence,
      parseResult,
    };
  }

  const parsedTrip = parseResult.trip;

  // Step 3: Check if review is required (low confidence or force)
  if (forceReview || parsedTrip.status === "review_required" || parseResult.validation.confidence < 0.7) {
    console.log(`   ⚠️ Review required (confidence: ${(parseResult.validation.confidence * 100).toFixed(1)}%)`);

    if (!dryRun) {
      await db.scheduleEvidence.create({
        data: {
          userId,
          sourceType: parseResult.templateType,
          imageUrl: imageUrls[0] ?? "",
          parseStatus: "review_required",
          parseConfidence: parseResult.validation.confidence,
          rawOcrText: ocrText,
          parsedData: JSON.stringify(parseResult),
          errorMessage: null,
        },
      });
    }

    return {
      success: true,
      tripId: null,
      tripNumber: parsedTrip.tripId,
      action: "review_required",
      message: `Import requires review: ${parseResult.validation.warnings.join(", ")}`,
      warnings: parseResult.validation.warnings,
      errors: [],
      confidence: parseResult.validation.confidence,
      parseResult,
    };
  }

  // Step 4: Dry run check
  if (dryRun) {
    return {
      success: true,
      tripId: null,
      tripNumber: parsedTrip.tripId,
      action: "skipped",
      message: "Dry run - no changes made",
      warnings: parseResult.validation.warnings,
      errors: [],
      confidence: parseResult.validation.confidence,
      parseResult,
    };
  }

  // ============================================
  // Step 4.5: Check for RSV activation FIRST
  // If legs overlap an existing RSV, activate it instead of creating a Trip
  // ============================================
  console.log(`   🎯 Checking for RSV activation opportunity...`);

  // Convert parsed trip to a format the RSV matcher can use
  const parsedDataForRSV = {
    dutyDays: parsedTrip.dutyDays.map((dd) => ({
      date: dd.calendarDate,
      calendarDate: dd.calendarDate,
      legs: dd.legs.map((leg) => ({
        flightNumber: leg.flightNumber,
        depAirport: leg.depAirport,
        arrAirport: leg.arrAirport,
        depLocalTime: leg.depLocalTime,
        arrLocalTime: leg.arrLocalTime,
        blockMinutes: leg.blockMinutes,
        equipment: leg.equipment,
        dhFlag: leg.dhFlag,
      })),
    })),
    startDate: parsedTrip.tripStartDate,
    endDate: parsedTrip.tripEndDate,
  };

  const rsvActivation = await tryActivateRSVForImport(
    userId,
    parsedDataForRSV,
    imageUrls[0]
  );

  if (rsvActivation.activated && rsvActivation.eventId) {
    console.log(`   ✅ RSV ACTIVATED: ${rsvActivation.eventId}`);
    console.log(`      Legs: ${rsvActivation.activationResult?.legsAdded}, Block: ${rsvActivation.activationResult?.blockHoursUpdated}h`);
    console.log(`      Credit preserved: ${rsvActivation.activationResult?.creditPreserved}h`);

    // Return success with RSV activation info
    // NOTE: We return tripId as null since this is an RSV activation, not a Trip
    // The caller should use the rsvEventId for any further operations
    return {
      success: true,
      tripId: null, // No trip created - RSV was activated instead
      tripNumber: parsedTrip.tripId,
      action: "skipped" as const, // Skipped trip creation
      message: `RSV activated: ${rsvActivation.eventId} with ${rsvActivation.activationResult?.legsAdded} legs`,
      warnings: [
        ...parseResult.validation.warnings,
        `RSV ${rsvActivation.eventId} activated instead of creating trip`,
      ],
      errors: [],
      confidence: parseResult.validation.confidence,
      parseResult,
    };
  }

  console.log(`   No RSV match (${rsvActivation.reason}), proceeding with Trip creation...`);

  // Step 5: Check for existing trip (by tripId + startDate, or matchKey)
  const matchKey = generateMatchKey(parsedTrip);
  const existingTripId = await findExistingTrip(userId, parsedTrip.tripId, parsedTrip.tripStartDate, matchKey);

  console.log(`   Match key: ${matchKey}`);
  console.log(`   Existing trip: ${existingTripId ?? "none"}`);

  try {
    if (existingTripId) {
      // Update existing trip
      const updatedTrip = await updateExistingTrip(
        existingTripId,
        parsedTrip,
        parseResult
      );

      console.log(`   ✅ Updated trip: ${updatedTrip.id}`);

      return {
        success: true,
        tripId: updatedTrip.id,
        tripNumber: parsedTrip.tripId,
        action: "updated",
        message: `Updated trip ${parsedTrip.tripId}`,
        warnings: parseResult.validation.warnings,
        errors: [],
        confidence: parseResult.validation.confidence,
        parseResult,
      };
    } else {
      // Create new trip
      const newTrip = await createNewTrip(userId, parsedTrip, parseResult, matchKey);

      console.log(`   ✅ Created trip: ${newTrip.id}`);

      return {
        success: true,
        tripId: newTrip.id,
        tripNumber: parsedTrip.tripId,
        action: "created",
        message: `Created trip ${parsedTrip.tripId}`,
        warnings: parseResult.validation.warnings,
        errors: [],
        confidence: parseResult.validation.confidence,
        parseResult,
      };
    }
  } catch (error) {
    console.error(`   💥 Database error:`, error);

    return {
      success: false,
      tripId: null,
      tripNumber: parsedTrip.tripId,
      action: "failed",
      message: `Database error: ${error instanceof Error ? error.message : "Unknown"}`,
      warnings: parseResult.validation.warnings,
      errors: [error instanceof Error ? error.message : "Database error"],
      confidence: parseResult.validation.confidence,
      parseResult,
    };
  }
}

// ============================================
// CREATE NEW TRIP
// ============================================

async function createNewTrip(
  userId: string,
  parsedTrip: ParsedTrip,
  parseResult: ParseScheduleResult,
  matchKey: string
): Promise<{ id: string }> {
  // Compute dates
  const startDate = parsedTrip.tripStartDate || new Date().toISOString().split("T")[0]!;
  const endDate = parsedTrip.tripEndDate || startDate;

  // Create trip with canonical structure
  const trip = await db.trip.create({
    data: {
      userId,
      pairingId: parsedTrip.tripId,
      matchKey,
      tripNumber: parsedTrip.tripId,
      source: "import",
      baseFleet: parsedTrip.base,
      startDate,
      endDate,
      totalBlockMinutes: parsedTrip.totals.blockMinutes,
      totalCreditMinutes: parsedTrip.totals.creditMinutes,
      // AUTHORITATIVE: Duty Time from Crew Access totals - DO NOT recompute
      totalDutyMinutes: parsedTrip.totals.dutyMinutes,
      totalTafbMinutes: parsedTrip.totals.tafbMinutes,
      totalPdiemCents: parsedTrip.totals.perDiemCents ?? 0,
      // AUTHORITATIVE: Use parsed Trip Days count from Crew Access (not duty periods length)
      dutyDaysCount: parsedTrip.tripDaysCount ?? parsedTrip.dutyDays.length,
      legCount: parsedTrip.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0),
      status: "scheduled",
      needsReview: parsedTrip.needsReview,

      // Create canonical breakdown
      tripDutyDays: {
        create: parsedTrip.dutyDays.map((dutyDay, index) => ({
          dutyDayIndex: index + 1,
          dutyDate: dutyDay.calendarDate || resolveCalendarDate(dutyDay.dayLabel, startDate, index + 1),
          reportTimeISO: dutyDay.dutyStartLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyStartLocalTime}:00`
            : null,
          releaseTimeISO: dutyDay.dutyEndLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyEndLocalTime}:00`
            : null,
          blockMinutes: dutyDay.dayBlockMinutes,
          creditMinutes: dutyDay.dayCreditMinutes,
          dutyMinutes: dutyDay.dayDutyMinutes ?? 0,
          restAfterMinutes: dutyDay.layoverToNextDay?.layoverMinutes ?? null,
          layoverStation: dutyDay.layoverToNextDay?.layoverStation ?? null,

          // Create legs
          legs: {
            create: dutyDay.legs.map((leg, legIndex) => ({
              legIndex: legIndex + 1,
              flightNumber: leg.flightNumber,
              origin: leg.depAirport,
              destination: leg.arrAirport,
              equipment: leg.equipment,
              isDeadhead: leg.dhFlag,
              scheduledOutISO: leg.depLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.depLocalTime}:00`
                : null,
              scheduledInISO: leg.arrLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.arrLocalTime}:00`
                : null,
              plannedBlockMinutes: leg.blockMinutes,
              plannedCreditMinutes: leg.blockMinutes, // Default credit = block
            })),
          },

          // Create layover if present
          ...(dutyDay.layoverToNextDay
            ? {
                layover: {
                  create: {
                    station: dutyDay.layoverToNextDay.layoverStation,
                    restMinutes: dutyDay.layoverToNextDay.restMinutes ?? dutyDay.layoverToNextDay.layoverMinutes,
                    hotelName: dutyDay.layoverToNextDay.hotelName,
                    hotelPhone: dutyDay.layoverToNextDay.hotelPhone,
                    hotelStatus: dutyDay.layoverToNextDay.hotelStatus,
                    hotelSource: "import",
                    hotelConfidence: dutyDay.layoverToNextDay.confidence,
                    transportNotes: dutyDay.layoverToNextDay.hotelTransport,
                  },
                },
              }
            : {}),
        })),
      },

      // Also create legacy DutyDay/Leg structure for backwards compatibility
      dutyDays: {
        create: parsedTrip.dutyDays.map((dutyDay, index) => ({
          dutyDate: dutyDay.calendarDate || resolveCalendarDate(dutyDay.dayLabel, startDate, index + 1),
          dutyStartISO: dutyDay.dutyStartLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyStartLocalTime}:00`
            : null,
          dutyEndISO: dutyDay.dutyEndLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyEndLocalTime}:00`
            : null,
          plannedCreditMinutes: dutyDay.dayCreditMinutes,
          legs: {
            create: dutyDay.legs.map((leg, legIndex) => ({
              legIndex: legIndex + 1,
              flightNumber: leg.flightNumber,
              origin: leg.depAirport,
              destination: leg.arrAirport,
              equipment: leg.equipment,
              isDeadhead: leg.dhFlag,
              scheduledOutISO: leg.depLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.depLocalTime}:00`
                : null,
              scheduledInISO: leg.arrLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.arrLocalTime}:00`
                : null,
              plannedBlockMinutes: leg.blockMinutes,
              plannedCreditMinutes: leg.blockMinutes,
              source: "import",
              needsReview: leg.needsReview,
            })),
          },
        })),
      },

      // Create trip events for layovers and hotels
      events: {
        create: parsedTrip.dutyDays
          .filter((dd) => dd.layoverToNextDay)
          .flatMap((dd, idx) => {
            const events = [];
            const layover = dd.layoverToNextDay!;

            // Layover event
            events.push({
              eventType: "LAYOVER",
              station: layover.layoverStation,
              layoverMinutes: layover.layoverMinutes,
              sortOrder: (idx + 1) * 100,
              sourceType: parseResult.templateType,
              confidence: layover.confidence,
            });

            // Hotel event if present
            if (layover.hotelName) {
              events.push({
                eventType: "HOTEL",
                station: layover.layoverStation,
                hotelName: layover.hotelName,
                hotelPhone: layover.hotelPhone,
                hotelBooked: layover.hotelStatus === "BOOKED",
                sortOrder: (idx + 1) * 100 + 1,
                sourceType: parseResult.templateType,
                confidence: layover.confidence,
              });
            }

            return events;
          }),
      },
    },
    select: { id: true },
  });

  // Create schedule evidence record
  await db.scheduleEvidence.create({
    data: {
      userId,
      tripId: trip.id,
      sourceType: parseResult.templateType,
      imageUrl: parsedTrip.sourceFiles[0] ?? "",
      parseStatus: "success",
      parseConfidence: parseResult.validation.confidence,
      rawOcrText: parseResult.rawOcrText,
      parsedData: JSON.stringify(parseResult),
    },
  });

  return trip;
}

// ============================================
// UPDATE EXISTING TRIP
// ============================================

async function updateExistingTrip(
  tripId: string,
  parsedTrip: ParsedTrip,
  parseResult: ParseScheduleResult
): Promise<{ id: string }> {
  // Get existing trip for comparison
  const existing = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      tripDutyDays: {
        include: {
          legs: true,
          layover: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error(`Trip ${tripId} not found`);
  }

  // Delete existing canonical structure (will recreate)
  await db.tripDutyLeg.deleteMany({
    where: { tripDutyDay: { tripId } },
  });
  await db.tripLayover.deleteMany({
    where: { tripDutyDay: { tripId } },
  });
  await db.tripDutyDay.deleteMany({
    where: { tripId },
  });

  // Update trip with new data
  const startDate = parsedTrip.tripStartDate || existing.startDate;
  const endDate = parsedTrip.tripEndDate || existing.endDate;

  const updatedTrip = await db.trip.update({
    where: { id: tripId },
    data: {
      totalBlockMinutes: parsedTrip.totals.blockMinutes,
      totalCreditMinutes: parsedTrip.totals.creditMinutes,
      // AUTHORITATIVE: Duty Time from Crew Access totals - DO NOT recompute
      totalDutyMinutes: parsedTrip.totals.dutyMinutes,
      totalTafbMinutes: parsedTrip.totals.tafbMinutes,
      totalPdiemCents: parsedTrip.totals.perDiemCents ?? existing.totalPdiemCents,
      // AUTHORITATIVE: Use parsed Trip Days count from Crew Access (not duty periods length)
      dutyDaysCount: parsedTrip.tripDaysCount ?? parsedTrip.dutyDays.length,
      legCount: parsedTrip.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0),
      needsReview: parsedTrip.needsReview,
      startDate,
      endDate,

      // Update current roster snapshot
      currentRosterSnapshot: JSON.stringify(parsedTrip),
      currentSnapshotUpdatedAt: new Date(),

      // Recreate canonical structure
      tripDutyDays: {
        create: parsedTrip.dutyDays.map((dutyDay, index) => ({
          dutyDayIndex: index + 1,
          dutyDate: dutyDay.calendarDate || resolveCalendarDate(dutyDay.dayLabel, startDate, index + 1),
          reportTimeISO: dutyDay.dutyStartLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyStartLocalTime}:00`
            : null,
          releaseTimeISO: dutyDay.dutyEndLocalTime
            ? `${dutyDay.calendarDate || startDate}T${dutyDay.dutyEndLocalTime}:00`
            : null,
          blockMinutes: dutyDay.dayBlockMinutes,
          creditMinutes: dutyDay.dayCreditMinutes,
          dutyMinutes: dutyDay.dayDutyMinutes ?? 0,
          restAfterMinutes: dutyDay.layoverToNextDay?.layoverMinutes ?? null,
          layoverStation: dutyDay.layoverToNextDay?.layoverStation ?? null,

          legs: {
            create: dutyDay.legs.map((leg, legIndex) => ({
              legIndex: legIndex + 1,
              flightNumber: leg.flightNumber,
              origin: leg.depAirport,
              destination: leg.arrAirport,
              equipment: leg.equipment,
              isDeadhead: leg.dhFlag,
              scheduledOutISO: leg.depLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.depLocalTime}:00`
                : null,
              scheduledInISO: leg.arrLocalTime
                ? `${dutyDay.calendarDate || startDate}T${leg.arrLocalTime}:00`
                : null,
              plannedBlockMinutes: leg.blockMinutes,
              plannedCreditMinutes: leg.blockMinutes,
            })),
          },

          ...(dutyDay.layoverToNextDay
            ? {
                layover: {
                  create: {
                    station: dutyDay.layoverToNextDay.layoverStation,
                    restMinutes: dutyDay.layoverToNextDay.restMinutes ?? dutyDay.layoverToNextDay.layoverMinutes,
                    hotelName: dutyDay.layoverToNextDay.hotelName,
                    hotelPhone: dutyDay.layoverToNextDay.hotelPhone,
                    hotelStatus: dutyDay.layoverToNextDay.hotelStatus,
                    hotelSource: "import",
                    hotelConfidence: dutyDay.layoverToNextDay.confidence,
                    transportNotes: dutyDay.layoverToNextDay.hotelTransport,
                  },
                },
              }
            : {}),
        })),
      },
    },
    select: { id: true },
  });

  // Create schedule evidence record
  await db.scheduleEvidence.create({
    data: {
      userId: existing.userId,
      tripId: updatedTrip.id,
      sourceType: parseResult.templateType,
      imageUrl: parsedTrip.sourceFiles[0] ?? "",
      parseStatus: "success",
      parseConfidence: parseResult.validation.confidence,
      rawOcrText: parseResult.rawOcrText,
      parsedData: JSON.stringify(parseResult),
    },
  });

  return updatedTrip;
}

// ============================================
// BATCH IMPORT
// ============================================

export async function batchImportSchedules(
  userId: string,
  images: Array<{ url: string; ocrText: string }>,
  baseDate?: string
): Promise<BatchImportResult> {
  const results: ImportResult[] = [];
  let tripsCreated = 0;
  let tripsUpdated = 0;
  let tripsSkipped = 0;
  let reviewRequired = 0;
  let failed = 0;

  for (const image of images) {
    const result = await importScheduleRobust({
      userId,
      imageUrls: [image.url],
      ocrText: image.ocrText,
      baseDate,
    });

    results.push(result);

    switch (result.action) {
      case "created":
        tripsCreated++;
        break;
      case "updated":
        tripsUpdated++;
        break;
      case "skipped":
        tripsSkipped++;
        break;
      case "review_required":
        reviewRequired++;
        break;
      case "failed":
        failed++;
        break;
    }
  }

  const overallConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  return {
    totalImages: images.length,
    tripsCreated,
    tripsUpdated,
    tripsSkipped,
    reviewRequired,
    failed,
    results,
    overallConfidence,
  };
}

// ============================================
// GET PENDING REVIEWS
// ============================================

export async function getPendingReviews(userId: string): Promise<
  Array<{
    id: string;
    imageUrl: string;
    sourceType: string;
    parseConfidence: number;
    errorMessage: string | null;
    parsedData: ParseScheduleResult | null;
    createdAt: Date;
  }>
> {
  const reviews = await db.scheduleEvidence.findMany({
    where: {
      userId,
      parseStatus: {
        in: ["review_required", "failed"],
      },
      tripId: null, // Not yet imported
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return reviews.map((r) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    sourceType: r.sourceType,
    parseConfidence: r.parseConfidence,
    errorMessage: r.errorMessage,
    parsedData: r.parsedData ? JSON.parse(r.parsedData) : null,
    createdAt: r.createdAt,
  }));
}

/**
 * Confirm a reviewed import
 */
export async function confirmReviewedImport(
  evidenceId: string,
  userId: string,
  corrections?: Partial<ParsedTrip>
): Promise<ImportResult> {
  const evidence = await db.scheduleEvidence.findFirst({
    where: {
      id: evidenceId,
      userId,
    },
  });

  if (!evidence) {
    return {
      success: false,
      tripId: null,
      tripNumber: null,
      action: "failed",
      message: "Evidence record not found",
      warnings: [],
      errors: ["Evidence record not found"],
      confidence: 0,
      parseResult: null,
    };
  }

  // Re-import with force flag
  const result = await importScheduleRobust({
    userId,
    imageUrls: [evidence.imageUrl],
    ocrText: evidence.rawOcrText,
    forceReview: false, // User confirmed, skip review gate
  });

  // Update evidence record
  if (result.success && result.tripId) {
    await db.scheduleEvidence.update({
      where: { id: evidenceId },
      data: {
        tripId: result.tripId,
        parseStatus: "success",
      },
    });
  }

  return result;
}

/**
 * Dismiss a review item
 */
export async function dismissReview(evidenceId: string, userId: string): Promise<boolean> {
  const result = await db.scheduleEvidence.updateMany({
    where: {
      id: evidenceId,
      userId,
    },
    data: {
      parseStatus: "dismissed",
    },
  });

  return result.count > 0;
}
