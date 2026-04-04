/**
 * Parse Cache Module
 * Handles caching of parsed schedules and deduplication
 */

import { db } from "../db";
import type { ParsedSchedule } from "./schedule-parser";
import { getSourceTypeValue, safeString } from "./import-schedule-stable";

// ============================================
// Types
// ============================================

export interface CachedParse {
  id: string;
  fileHash: string;
  userId: string;
  parsedData: string; // JSON stringified ParsedSchedule
  sourceType: string;
  confidence: number;
  createdAt: Date;
  expiresAt: Date;
}

// Cache duration: 7 days
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================
// Cache Operations
// ============================================

/**
 * Check if a parse result exists in cache
 */
export async function getCachedParse(
  fileHash: string,
  userId: string
): Promise<ParsedSchedule | null> {
  try {
    // Look up in ScheduleEvidence table using image hash
    const cached = await db.scheduleEvidence.findFirst({
      where: {
        userId,
        imageUrl: { contains: fileHash },
        parseStatus: "success",
        parsedData: { not: "{}" }, // Check for non-empty parsed data
      },
      orderBy: { createdAt: "desc" },
    });

    if (cached && cached.parsedData && cached.parsedData !== "{}") {
      console.log(`📦 [Cache] Found cached parse for hash: ${fileHash.substring(0, 8)}...`);
      return JSON.parse(cached.parsedData) as ParsedSchedule;
    }

    return null;
  } catch (error) {
    console.error("❌ [Cache] Error retrieving cached parse:", error);
    return null;
  }
}

/**
 * Store a parse result in cache
 */
export async function cacheParse(
  fileHash: string,
  userId: string,
  tripId: string | null,
  imageUrl: string,
  parsed: ParsedSchedule,
  rawOcrText: string
): Promise<string> {
  try {
    const evidence = await db.scheduleEvidence.create({
      data: {
        userId,
        tripId,
        sourceType: getSourceTypeValue(parsed),
        imageUrl: `${imageUrl}#hash=${fileHash}`,
        parseStatus: "success",
        parseConfidence: parsed.overallConfidence,
        rawOcrText: rawOcrText.substring(0, 10000),
        parsedData: JSON.stringify(parsed),
      },
    });

    console.log(`💾 [Cache] Stored parse for hash: ${fileHash.substring(0, 8)}...`);
    return evidence.id;
  } catch (error) {
    console.error("❌ [Cache] Error caching parse:", error);
    throw error;
  }
}

/**
 * Check if image was already processed (deduplication)
 */
export async function isImageDuplicate(
  fileHash: string,
  userId: string
): Promise<{ isDuplicate: boolean; existingTripId?: string }> {
  try {
    const existing = await db.scheduleEvidence.findFirst({
      where: {
        userId,
        imageUrl: { contains: fileHash },
        parseStatus: "success",
      },
      select: { tripId: true },
    });

    if (existing) {
      return {
        isDuplicate: true,
        existingTripId: existing.tripId || undefined,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error("❌ [Cache] Error checking duplicate:", error);
    return { isDuplicate: false };
  }
}

/**
 * Invalidate cached parses for a user (e.g., when they clear trips)
 */
export async function invalidateUserCache(userId: string): Promise<number> {
  try {
    const result = await db.scheduleEvidence.deleteMany({
      where: { userId },
    });

    console.log(`🗑️ [Cache] Invalidated ${result.count} cached parses for user`);
    return result.count;
  } catch (error) {
    console.error("❌ [Cache] Error invalidating cache:", error);
    return 0;
  }
}

// ============================================
// Diff-Merge Operations
// ============================================

export interface MergeResult {
  merged: boolean;
  fieldsUpdated: string[];
  fieldsSkipped: string[];
  finalData: any;
}

/**
 * Merge new parsed data with existing trip data
 * Only updates fields that are missing or have higher confidence
 */
export async function mergeWithExistingTrip(
  tripId: string,
  newData: ParsedSchedule
): Promise<MergeResult> {
  const result: MergeResult = {
    merged: false,
    fieldsUpdated: [],
    fieldsSkipped: [],
    finalData: null,
  };

  try {
    // Get existing trip
    const existingTrip = await db.trip.findUnique({
      where: { id: tripId },
      include: { events: true },
    });

    if (!existingTrip) {
      return result;
    }

    // Prepare update data
    const updateData: any = {};

    // Merge trip-level fields (only if new data has higher confidence or existing is null)
    if (newData.tripNumber && !existingTrip.tripNumber) {
      updateData.tripNumber = newData.tripNumber.value;
      result.fieldsUpdated.push("tripNumber");
    } else if (existingTrip.tripNumber) {
      result.fieldsSkipped.push("tripNumber");
    }

    if (newData.pairingId && !existingTrip.pairingId) {
      updateData.pairingId = newData.pairingId.value;
      result.fieldsUpdated.push("pairingId");
    } else if (existingTrip.pairingId) {
      result.fieldsSkipped.push("pairingId");
    }

    if (newData.baseFleet && !existingTrip.baseFleet) {
      updateData.baseFleet = newData.baseFleet.value;
      result.fieldsUpdated.push("baseFleet");
    } else if (existingTrip.baseFleet) {
      result.fieldsSkipped.push("baseFleet");
    }

    // Merge totals (prefer higher values as they might be more complete)
    if (newData.totals.creditMinutes?.value &&
        (!existingTrip.totalCreditMinutes || newData.totals.creditMinutes.value > existingTrip.totalCreditMinutes)) {
      updateData.totalCreditMinutes = newData.totals.creditMinutes.value;
      result.fieldsUpdated.push("totalCreditMinutes");
    }

    if (newData.totals.blockMinutes?.value &&
        (!existingTrip.totalBlockMinutes || newData.totals.blockMinutes.value > existingTrip.totalBlockMinutes)) {
      updateData.totalBlockMinutes = newData.totals.blockMinutes.value;
      result.fieldsUpdated.push("totalBlockMinutes");
    }

    if (newData.totals.tafbMinutes?.value &&
        (!existingTrip.totalTafbMinutes || newData.totals.tafbMinutes.value > existingTrip.totalTafbMinutes)) {
      updateData.totalTafbMinutes = newData.totals.tafbMinutes.value;
      result.fieldsUpdated.push("totalTafbMinutes");
    }

    // Apply updates if any
    if (Object.keys(updateData).length > 0) {
      await db.trip.update({
        where: { id: tripId },
        data: updateData,
      });
      result.merged = true;
    }

    // Merge events - add only events that don't exist
    const existingFlightNumbers = new Set(
      existingTrip.events
        .filter((e) => e.flightMetadata)
        .map((e) => {
          try {
            const meta = JSON.parse(e.flightMetadata!);
            return meta.flightNumber;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );

    for (const event of newData.events) {
      // Skip if flight already exists
      if (event.flightNumber && existingFlightNumbers.has(event.flightNumber.value)) {
        result.fieldsSkipped.push(`event:${event.flightNumber.value}`);
        continue;
      }

      // Add new events (hotels, transport, layovers)
      if (event.eventType.value === "HOTEL" && event.hotelName) {
        const hotelNameValue = event.hotelName.value;
        // Check if hotel already exists for this trip
        const existingHotel = existingTrip.events.find(
          (e) => e.eventType === "HOTEL" && e.hotelName === hotelNameValue
        );
        if (!existingHotel) {
          await db.tripEvent.create({
            data: {
              tripId,
              eventType: "HOTEL",
              hotelName: hotelNameValue,
              hotelPhone: event.hotelPhone?.value || null,
              hotelBooked: event.hotelBooked?.value || false,
              sourceType: getSourceTypeValue(newData),
              confidence: event.eventType.confidence,
              sortOrder: existingTrip.events.length,
            },
          });
          result.fieldsUpdated.push(`hotel:${hotelNameValue}`);
          result.merged = true;
        }
      }

      if (event.eventType.value === "TRANSPORT" && event.transportNotes) {
        const transportNotesValue = event.transportNotes.value;
        // Check if transport already exists
        const existingTransport = existingTrip.events.find(
          (e) => e.eventType === "TRANSPORT" && e.transportNotes === transportNotesValue
        );
        if (!existingTransport) {
          await db.tripEvent.create({
            data: {
              tripId,
              eventType: "TRANSPORT",
              transportNotes: transportNotesValue,
              transportPhone: event.transportPhone?.value || null,
              sourceType: getSourceTypeValue(newData),
              confidence: event.eventType.confidence,
              sortOrder: existingTrip.events.length,
            },
          });
          result.fieldsUpdated.push(`transport:${transportNotesValue.substring(0, 20)}`);
          result.merged = true;
        }
      }
    }

    // Get final data
    result.finalData = await db.trip.findUnique({
      where: { id: tripId },
      include: { events: true },
    });

    return result;
  } catch (error) {
    console.error("❌ [Merge] Error merging data:", error);
    return result;
  }
}

/**
 * Smart merge that determines if we should merge or create new
 */
export async function smartMerge(
  userId: string,
  newData: ParsedSchedule
): Promise<{
  action: "create" | "merge" | "skip";
  tripId?: string;
  mergeResult?: MergeResult;
}> {
  // Try to find existing trip that matches
  if (newData.tripNumber || newData.pairingId) {
    const existing = await db.trip.findFirst({
      where: {
        userId,
        OR: [
          newData.tripNumber ? { tripNumber: newData.tripNumber.value } : undefined,
          newData.pairingId ? { pairingId: newData.pairingId.value } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (existing) {
      const mergeResult = await mergeWithExistingTrip(existing.id, newData);
      return {
        action: "merge",
        tripId: existing.id,
        mergeResult,
      };
    }
  }

  // No existing trip found, create new
  return { action: "create" };
}
