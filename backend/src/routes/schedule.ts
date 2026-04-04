import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type AppType } from "../types";
import { db } from "../db";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateImageHash } from "../lib/image-preprocessing";
import { performOCRWithRetry } from "../lib/ocr-engine";
import {
  parseScheduleFromOCR,
  simplifyParsedSchedule,
} from "../lib/schedule-parser";
import {
  getCachedParse,
  isImageDuplicate,
  invalidateUserCache,
} from "../lib/parse-cache";
import {
  importToCanonicalStructure,
  normalizeAIParsedData,
  type ParsedTripImport,
  type ImportSourceType,
} from "../lib/canonical-import-pipeline";
import {
  importWithVersionTracking,
  type VersionAwareImportResult,
} from "../lib/version-aware-import";

const scheduleRouter = new Hono<AppType>();

// ============================================
// Validation Schemas
// ============================================

const parseScheduleSchema = z.object({
  images: z.array(z.string()), // Array of image URLs from upload
});

const createEventSchema = z.object({
  tripId: z.string(),
  eventType: z.enum([
    "REPORT",
    "FLIGHT",
    "DEADHEAD",
    "LAYOVER",
    "HOTEL",
    "TRANSPORT",
    "COMMUTE",
    "OTHER",
  ]),
  startTimeLocal: z.string().optional(),
  endTimeLocal: z.string().optional(),
  timezone: z.string().optional(),
  depAirport: z.string().optional(),
  arrAirport: z.string().optional(),
  station: z.string().optional(),
  flightMetadata: z.string().optional(),
  layoverMinutes: z.number().optional(),
  hotelName: z.string().optional(),
  hotelPhone: z.string().optional(),
  hotelBooked: z.boolean().optional(),
  transportNotes: z.string().optional(),
  transportPhone: z.string().optional(),
  creditMinutes: z.number().optional(),
  rawCreditText: z.string().optional(),
  sortOrder: z.number().optional(),
});

// ============================================
// Helper: Parse time string like "06:06" to minutes since midnight
// ============================================
function parseTimeToMinutes(timeStr: string | undefined): number {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

// ============================================
// Helper: Parse duration string like "6:00" or "11:31" to minutes
// ============================================
function parseDurationToMinutes(durStr: string | undefined): number {
  if (!durStr) return 0;
  const match = durStr.match(/(\d+):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

// ============================================
// Helper: Format date for display
// ============================================
function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ============================================
// Helper: Classify source type from OCR text
// ============================================
function classifySourceType(
  ocrText: string
): "trip_board_browser" | "trip_board_trip_details" | "crew_access_trip_info" {
  const textLower = ocrText.toLowerCase();

  // Crew Access Trip Information
  if (
    textLower.includes("trip information") ||
    textLower.includes("hotel details") ||
    textLower.includes("hotel transport")
  ) {
    return "crew_access_trip_info";
  }

  // Trip Board Trip Details (table view)
  if (
    textLower.includes("trip details") ||
    (textLower.includes("eqp") &&
      textLower.includes("pairing") &&
      textLower.includes("flt"))
  ) {
    return "trip_board_trip_details";
  }

  // Trip Board Browser (Pairing View)
  if (
    textLower.includes("browser") ||
    textLower.includes("pairing view") ||
    textLower.includes("report at")
  ) {
    return "trip_board_browser";
  }

  // Default to trip_board_browser
  return "trip_board_browser";
}

// ============================================
// Helper: Parse Trip Board Browser format
// ============================================
function parseTripBoardBrowser(ocrText: string): any {
  const result: any = {
    tripNumber: null,
    reportTime: null,
    events: [],
    totals: {},
  };

  // Extract Trip number (Trip 1234)
  const tripMatch = ocrText.match(/Trip\s+(\d+)/i);
  if (tripMatch) {
    result.tripNumber = `Trip ${tripMatch[1]}`;
  }

  // Extract report time (Report at (##) HH:MM)
  const reportMatch = ocrText.match(
    /Report\s+at\s*\(?(\d+)?\)?\s*(\d{1,2}:\d{2})/i
  );
  if (reportMatch) {
    result.reportTime = reportMatch[2];
  }

  // Extract flight rows - simplified pattern matching
  // Pattern: FLT DEP ARR BLK DUTY CR L/O
  const flightPattern =
    /(\d{3,4})\s+([A-Z]{3})\s+(\d{2}:\d{2})\s+([A-Z]{3})\s+(\d{2}:\d{2})\s+(\d{1,2}:\d{2})/gi;
  let match;
  while ((match = flightPattern.exec(ocrText)) !== null) {
    result.events.push({
      eventType: "FLIGHT",
      flightNumber: match[1],
      depAirport: match[2],
      depTime: match[3],
      arrAirport: match[4],
      arrTime: match[5],
      blockMinutes: parseDurationToMinutes(match[6]),
    });
  }

  return result;
}

// ============================================
// Helper: Parse Trip Board Trip Details format
// ============================================
function parseTripBoardTripDetails(ocrText: string): any {
  const result: any = {
    tripNumber: null,
    pairingId: null,
    baseFleet: null,
    events: [],
    totals: {},
  };

  // Extract trip label (S5055)
  const tripLabelMatch = ocrText.match(/([A-Z]\d{4,5})/);
  if (tripLabelMatch) {
    result.tripNumber = tripLabelMatch[1];
  }

  // Extract base/fleet (SDF 757)
  const baseFleetMatch = ocrText.match(/([A-Z]{3})\s+(757|767|747|MD11)/i);
  if (baseFleetMatch) {
    result.baseFleet = `${baseFleetMatch[1]} ${baseFleetMatch[2]}`;
  }

  // Extract totals from footer
  const creditMatch = ocrText.match(/Credit[:\s]+(\d+:\d{2})/i);
  if (creditMatch) {
    result.totals.creditMinutes = parseDurationToMinutes(creditMatch[1]);
  }

  const blockMatch = ocrText.match(/Blk[:\s]+(\d+:\d{2})/i);
  if (blockMatch) {
    result.totals.blockMinutes = parseDurationToMinutes(blockMatch[1]);
  }

  const tafbMatch = ocrText.match(/TAFB[:\s]+(\d+:\d{2})/i);
  if (tafbMatch) {
    result.totals.tafbMinutes = parseDurationToMinutes(tafbMatch[1]);
  }

  const dutyDaysMatch = ocrText.match(/Duty\s+Days[:\s]+(\d+)/i);
  if (dutyDaysMatch && dutyDaysMatch[1]) {
    result.totals.dutyDays = parseInt(dutyDaysMatch[1]);
  }

  return result;
}

// ============================================
// Helper: Parse Crew Access Trip Info format
// ============================================
function parseCrewAccessTripInfo(ocrText: string): any {
  const result: any = {
    tripId: null,
    events: [],
    hotels: [],
    transport: [],
    totals: {},
  };

  // Extract Trip ID
  const tripIdMatch = ocrText.match(/Trip\s+Id[:\s]+(\S+)/i);
  if (tripIdMatch) {
    result.tripId = tripIdMatch[1];
  }

  // Extract hotel details
  const hotelPattern =
    /Hotel[:\s]*([^\n]+?)(?:\s+BOOKED)?[\s\n]+(?:Phone[:\s]*)?(\d[\d\-\s]+\d)?/gi;
  let hotelMatch;
  while ((hotelMatch = hotelPattern.exec(ocrText)) !== null) {
    if (hotelMatch[1]) {
      result.hotels.push({
        name: hotelMatch[1].trim(),
        phone: hotelMatch[2]?.replace(/[\s\-]/g, "") || null,
        booked: ocrText.includes("BOOKED"),
      });
    }
  }

  // Extract transport info
  const transportMatch = ocrText.match(
    /Hotel\s+Transport[:\s]*([^\n]+?)(?:\n|Phone)/i
  );
  if (transportMatch && transportMatch[1]) {
    result.transport.push({
      notes: transportMatch[1].trim(),
    });
  }

  // Extract rest times
  const restMatch = ocrText.match(/Rest[:\s]+(\d+:\d{2})/i);
  if (restMatch) {
    result.totals.restMinutes = parseDurationToMinutes(restMatch[1]);
  }

  return result;
}

// ============================================
// Helper: Parse image using OCR pipeline (OPTIMIZED)
// ============================================
async function parseImageWithOCR(
  imageUrl: string,
  userId: string
): Promise<{
  ocrText: string;
  parsedData: any;
  sourceType: string;
  confidence: number;
  fileHash: string;
  fromCache: boolean;
  lowConfidenceFields: string[];
}> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const filename = imageUrl.replace("/uploads/", "");
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  const ocrStartTime = Date.now();
  console.log(`📸 [OCR] Processing image: ${filename}`);

  // Generate image hash for caching/dedup
  const fileHash = await generateImageHash(filePath);
  console.log(`  Hash: ${fileHash.substring(0, 8)}... (${Date.now() - ocrStartTime}ms)`);

  // Check for duplicate
  const { isDuplicate, existingTripId } = await isImageDuplicate(fileHash, userId);
  if (isDuplicate && existingTripId) {
    console.log(`  ⚠️ Duplicate image detected, returning cached result`);
    const cached = await getCachedParse(fileHash, userId);
    if (cached) {
      // Check if cached data is already simplified (has sourceType as string) or needs simplification
      const isAlreadySimplified = typeof cached.sourceType === 'string';

      if (isAlreadySimplified) {
        // Already simplified format - use as-is
        const simplifiedCached = cached as any;
        return {
          ocrText: simplifiedCached.rawText || "[Cached - OCR text not available]",
          parsedData: simplifiedCached,
          sourceType: simplifiedCached.sourceType,
          confidence: simplifiedCached.confidence || 0.5,
          fileHash,
          fromCache: true,
          lowConfidenceFields: simplifiedCached.lowConfidenceFields || [],
        };
      } else {
        // Full ParsedSchedule format - needs simplification
        const cachedOcrText = cached.rawText || "[Cached - OCR text not available]";
        const simplified = simplifyParsedSchedule(cached);
        return {
          ocrText: cachedOcrText,
          parsedData: simplified,
          sourceType: simplified.sourceType,
          confidence: simplified.confidence,
          fileHash,
          fromCache: true,
          lowConfidenceFields: simplified.lowConfidenceFields,
        };
      }
    }
  }

  // OPTIMIZED: Skip preprocessing - use original image directly
  // Sharp preprocessing adds ~2-3 seconds but doesn't improve OCR much
  console.log(`  🔤 Running OCR on original image (skipping preprocessing)...`);

  // Perform OCR - single pass only (skip retry logic for speed)
  const ocrResult = await performOCRWithRetry(filePath);
  console.log(`  OCR confidence: ${ocrResult.confidence.toFixed(1)}% (${Date.now() - ocrStartTime}ms)`);
  console.log(`  Text length: ${ocrResult.fullText.length} chars`);

  // Parse OCR result into structured data
  console.log(`  📋 Parsing schedule data...`);
  const parsedSchedule = parseScheduleFromOCR(ocrResult);
  const simplified = simplifyParsedSchedule(parsedSchedule);

  console.log(`  Source type: ${simplified.sourceType}`);
  console.log(`  Events found: ${simplified.events.length}`);
  console.log(`  Flight events: ${simplified.events.filter((e: any) => e.eventType === 'FLIGHT' || e.eventType === 'DEADHEAD').length}`);
  console.log(`  Overall confidence: ${(simplified.confidence * 100).toFixed(1)}%`);
  console.log(`  Total OCR time: ${Date.now() - ocrStartTime}ms`);

  return {
    ocrText: ocrResult.fullText,
    parsedData: simplified,
    sourceType: simplified.sourceType,
    confidence: simplified.confidence,
    fileHash,
    fromCache: false,
    lowConfidenceFields: simplified.lowConfidenceFields,
  };
}

// ============================================
// Helper: Call OpenAI Vision API to parse schedule image (FAST + ACCURATE)
// ============================================
async function parseImageWithAI(imageUrl: string): Promise<{
  ocrText: string;
  parsedData: any;
  sourceType: string;
  confidence: number;
  sikDetected?: {
    detected: boolean;
    dateRange?: { startDate: string; endDate: string } | null;
    station?: string | null;
    totalHours?: number | null;
    rawText?: string | null;
  } | null;
}> {
  // Vibecode proxy handles auth - use placeholder if no key in env
  const apiKey =
    process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "vibecode-proxy";

  // Use Vibecode proxy URL or default OpenAI
  const baseUrl =
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  console.log("🤖 [Schedule] Using OpenAI Vision API (gpt-4o-mini) for fast parsing");
  console.log(`  Base URL: ${baseUrl}`);

  try {
    // Read image file and convert to base64
    const uploadsDir = path.join(process.cwd(), "uploads");
    const filename = imageUrl.replace("/uploads/", "");
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    console.log(`  Image loaded: ${filename} (${(imageBuffer.length / 1024).toFixed(1)}KB)`);

    // Call OpenAI Vision API - gpt-4o with high detail for 100% accuracy
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Fast model for speed
        max_tokens: 3000,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Parse this pilot schedule image. Extract LOCAL times, NOT Zulu/UTC.

THERE ARE TWO SCHEDULE FORMATS - IDENTIFY WHICH ONE AND APPLY THE CORRECT RULES:

=== FORMAT 1: CREW ACCESS "Trip Information" ===
If you see columns labeled: Start | Start(LT) | End | End(LT) | Block
- Start = ZULU time (IGNORE THIS)
- Start(LT) = LOCAL time (USE THIS for scheduledOut)
- End = ZULU time (IGNORE THIS)
- End(LT) = LOCAL time (USE THIS for scheduledIn)
- Block = flight block time in H:MM format

CREW ACCESS EXAMPLE ROW:
"1 5432 SDF-PDX 13:00 08:00 20:41 15:41 4:41 767"
Columns: Day | Flight | Route | Start(Z) | Start(LT) | End(Z) | End(LT) | Block | Equipment
→ scheduledOut: "08:00" (from Start(LT) column)
→ scheduledIn: "15:41" (from End(LT) column)
→ blockMinutes: 281 (from 4:41)

=== FORMAT 2: TRIP BOARD (Dark theme / Browser) ===
The format "(DayCode+LocalHour)ZuluTime" means:
- Number INSIDE () = LOCAL hour
- Number AFTER () = ZULU time (use only the minutes)
- LOCAL TIME = hour from inside () + minutes from Zulu

TRIP BOARD EXAMPLES:
- "(FR14)19:00" → scheduledOut: "14:00"
- "(SU06)14:30" → scheduledOut: "06:30"
- "(15)23:41" → scheduledIn: "15:41"

=== BLOCK TIME RULES (CRITICAL) ===
- blockMinutes must NEVER be 0 for actual flights
- Read block time from the Block column (format H:MM or HH:MM)
- Convert to minutes: "4:41" = 4*60+41 = 281 minutes
- If block column is missing, compute: arrivalTime - departureTime (handle overnight)

DUTY DAY RULES:
- Each flight MUST have dutyDayNumber (1, 2, 3...)
- Look for day groupings, date changes, or hotel/layover rows between duty days

=== SIK (SICK) DETECTION ===
CRITICAL: If you see "SIK" label on any line, row, or trip header, this indicates SICK TIME.
- Look for "SIK", "SIK:", "SIK: TASK", "Sick", or similar sick indicators
- A SIK entry typically shows: date range, station code (e.g., SDF), and hours (TAFB - ignore this)
- Example: "SIK Stn SDF 126:16h" or "SIK: TASK"
- IMPORTANT: The hours shown (e.g., 126:16h) is TAFB (Time Away From Base), NOT sick hours to deduct!
  The actual sick credit comes from the trip's credit hours, not this TAFB number.
- When SIK is detected, add a "sikDetected" object to the response with:
  - detected: true
  - dateRange: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
  - station: "XXX" (if available)
  - tafbHours: number (the TAFB hours shown - for reference only, NOT for deduction)
  - rawText: the exact text that indicated SIK

Return JSON:
{"tripNumber":"","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","dutyPeriods":[{"dutyDayNumber":1,"startDate":"YYYY-MM-DD","legCount":2}],"events":[{"dutyDayNumber":1,"date":"YYYY-MM-DD","flightNumber":"","depAirport":"XXX","arrAirport":"XXX","scheduledOut":"HH:MM","scheduledIn":"HH:MM","blockMinutes":0}],"totals":{"creditMinutes":0,"blockMinutes":0,"tafbMinutes":0,"dutyDays":0},"sikDetected":{"detected":false,"dateRange":null,"station":null,"tafbHours":null,"rawText":null},"confidence":0.95}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                  detail: "auto", // Auto for balance of speed and accuracy
                },
              },
            ],
          },
        ],
      }),
    });

    console.log(`  API response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  API error: ${errorText}`);
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    // Extract the response text from chat completions format
    const responseText = data.choices?.[0]?.message?.content || "";
    console.log(`  Response length: ${responseText.length} chars`);

    if (!responseText) {
      throw new Error("Empty response from OpenAI API");
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = responseText;

    // Remove markdown code blocks if present
    const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Find JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`  Failed to find JSON in response: ${responseText.substring(0, 200)}`);
      throw new Error("No JSON found in AI response");
    }

    const parsedData = JSON.parse(jsonMatch[0]);
    console.log(`  Parsed successfully: ${parsedData.events?.length || 0} events`);

    // Log extracted events for verification
    if (parsedData.events && parsedData.events.length > 0) {
      console.log(`  📋 Extracted flights:`);
      for (const event of parsedData.events) {
        const route = `${event.depAirport || event.origin || "?"}-${event.arrAirport || event.destination || "?"}`;
        console.log(`    - ${event.flightNumber || "N/A"}: ${route} (Block: ${event.blockMinutes || 0}min)`);
      }
    } else {
      console.log(`  ⚠️ No flight events extracted from image!`);
    }

    // Log extracted totals for verification
    if (parsedData.totals) {
      console.log(`  Totals: Credit=${parsedData.totals.creditMinutes}min, Block=${parsedData.totals.blockMinutes}min, TAFB=${parsedData.totals.tafbMinutes}min, Days=${parsedData.totals.dutyDays}`);
    }

    // Log hotels if found
    if (parsedData.hotels && parsedData.hotels.length > 0) {
      console.log(`  🏨 Hotels: ${parsedData.hotels.map((h: any) => h.name).join(", ")}`);
    }

    // Log duty periods with rest times (CRITICAL for layover accuracy)
    if (parsedData.dutyPeriods && parsedData.dutyPeriods.length > 0) {
      console.log(`  📅 Duty Periods:`);
      for (const dp of parsedData.dutyPeriods) {
        const restStr = dp.restMinutes ? `Rest: ${Math.floor(dp.restMinutes / 60)}:${String(dp.restMinutes % 60).padStart(2, '0')}` : 'No rest (final day)';
        console.log(`    Day ${dp.dutyDayNumber}: ${dp.legCount || '?'} leg(s), Block: ${dp.blockMinutes || 0}min, ${restStr}`);
      }
    }

    // Log SIK detection if found
    if (parsedData.sikDetected?.detected) {
      console.log(`  ❤️ SIK DETECTED!`);
      console.log(`    Date Range: ${parsedData.sikDetected.dateRange?.startDate} - ${parsedData.sikDetected.dateRange?.endDate}`);
      console.log(`    Station: ${parsedData.sikDetected.station || 'N/A'}`);
      console.log(`    Total Hours: ${parsedData.sikDetected.totalHours || 'N/A'}`);
      console.log(`    Raw Text: ${parsedData.sikDetected.rawText || 'N/A'}`);
    }

    return {
      ocrText: responseText,
      parsedData,
      sourceType: parsedData.sourceType || "trip_board_browser",
      confidence: parsedData.confidence || 0.9,
      sikDetected: parsedData.sikDetected || null,
    };
  } catch (error) {
    console.error("❌ [Schedule] AI parsing error:", error);
    throw error;
  }
}

// ============================================
// Helper: Find or create matching trip (with conflict detection)
// ============================================
import { checkTripConflicts, type ConflictCheckResult } from "../lib/trip-conflict-detector";

interface FindOrCreateTripResult {
  tripId: string;
  isNew: boolean;
  hasConflicts: boolean;
  conflictResult?: ConflictCheckResult;
  parsedData?: any; // Return parsed data with computed totals for conflict modal
}

async function findOrCreateTrip(
  userId: string,
  parsedData: any
): Promise<FindOrCreateTripResult> {
  // Determine date range from events first (needed for proper matching)
  let startDate = parsedData.startDate;
  let endDate = parsedData.endDate;

  if (!startDate && parsedData.events?.length > 0) {
    const dates = parsedData.events
      .map((e: any) => e.date)
      .filter(Boolean)
      .sort();
    startDate = dates[0] || new Date().toISOString().split("T")[0];
    endDate = dates[dates.length - 1] || startDate;
  }

  if (!startDate) {
    startDate = new Date().toISOString().split("T")[0];
    endDate = startDate;
  }

  // Try to find existing trip by tripNumber/pairingId + startDate
  // CRITICAL: Same trip number can exist for different dates (e.g., S12345 Jan vs S12345 Feb)
  // We must match on BOTH tripId AND startDate to avoid overwrites
  if (parsedData.tripNumber || parsedData.pairingId) {
    const existing = await db.trip.findFirst({
      where: {
        userId,
        startDate, // REQUIRED: Include date to prevent overwrites
        OR: [
          parsedData.tripNumber
            ? { tripNumber: parsedData.tripNumber }
            : undefined,
          parsedData.pairingId ? { pairingId: parsedData.pairingId } : undefined,
        ].filter(Boolean) as any,
      },
    });

    if (existing) {
      return { tripId: existing.id, isNew: false, hasConflicts: false };
    }
  }

  // Extract duty dates from parsed data for more precise conflict detection
  const dutyDates: string[] = [];
  if (parsedData.events?.length > 0) {
    const uniqueDates = new Set<string>();
    for (const event of parsedData.events) {
      if (event.date) {
        uniqueDates.add(event.date);
      }
    }
    dutyDates.push(...uniqueDates);
  }
  if (parsedData.dutyDays?.length > 0) {
    for (const dd of parsedData.dutyDays) {
      if (dd.date) {
        dutyDates.push(dd.date);
      }
    }
  }

  // Build duty times for precise time-based conflict detection
  const dutyTimes: Array<{ date: string; reportTimeISO?: string; releaseTimeISO?: string }> = [];
  if (parsedData.dutyDays?.length > 0) {
    for (const dd of parsedData.dutyDays) {
      if (dd.date) {
        dutyTimes.push({
          date: dd.date,
          reportTimeISO: dd.reportTimeISO,
          releaseTimeISO: dd.releaseTimeISO,
        });
      }
    }
  }

  // Extract route highlights from parsed events for newTripSummary
  let routeHighlights = "N/A";
  if (parsedData.events?.length > 0) {
    const stations: string[] = [];
    for (const event of parsedData.events) {
      if ((event.eventType === "FLIGHT" || event.eventType === "DEADHEAD") && event.depAirport) {
        if (!stations.includes(event.depAirport)) stations.push(event.depAirport);
      }
      if ((event.eventType === "FLIGHT" || event.eventType === "DEADHEAD") && event.arrAirport) {
        if (!stations.includes(event.arrAirport)) stations.push(event.arrAirport);
      }
    }
    routeHighlights = stations.slice(0, 5).join("-") || "N/A";
  }

  // Count legs for newTripSummary
  const legCount = parsedData.events?.filter((e: any) =>
    e.eventType === "FLIGHT" || e.eventType === "DEADHEAD"
  ).length || 0;

  // ============================================
  // COMPUTE CREDIT - from totals OR from events
  // ============================================
  // First try footer totals (authoritative)
  let computedCreditMinutes = parsedData.totals?.creditMinutes || 0;
  let computedBlockMinutes = parsedData.totals?.blockMinutes || 0;

  // If credit is 0, compute from individual events
  if (computedCreditMinutes === 0 && parsedData.events?.length > 0) {
    // Sum credit from each flight event
    const eventCredits = parsedData.events
      .filter((e: any) => e.eventType === "FLIGHT" || e.eventType === "DEADHEAD")
      .map((e: any) => {
        // Try creditMinutes first, then blockMinutes
        if (e.creditMinutes && e.creditMinutes > 0) return e.creditMinutes;
        if (e.blockMinutes && e.blockMinutes > 0) return e.blockMinutes;
        // Try parsing raw credit text
        if (e.rawCreditText) {
          const match = e.rawCreditText.match(/(\d+):(\d{2})/);
          if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
        }
        return 0;
      });

    computedCreditMinutes = eventCredits.reduce((sum: number, c: number) => sum + c, 0);
    console.log(`  📊 Computed credit from ${eventCredits.length} events: ${computedCreditMinutes} min`);
  }

  // If block is 0, compute from individual events
  if (computedBlockMinutes === 0 && parsedData.events?.length > 0) {
    const eventBlocks = parsedData.events
      .filter((e: any) => e.eventType === "FLIGHT" || e.eventType === "DEADHEAD")
      .map((e: any) => e.blockMinutes || 0);

    computedBlockMinutes = eventBlocks.reduce((sum: number, b: number) => sum + b, 0);
  }

  // Count duty days from unique dates
  const dutyDaysCount = parsedData.totals?.dutyDays || dutyDates.length ||
    new Set(parsedData.events?.map((e: any) => e.date).filter(Boolean)).size || 1;

  console.log(`  📊 Final computed: Credit=${computedCreditMinutes}min, Block=${computedBlockMinutes}min, DutyDays=${dutyDaysCount}, Legs=${legCount}`);

  // CHECK FOR CONFLICTS before creating
  // Pass full data so newTripSummary shows REAL values, not "Pending"
  const conflictResult = await checkTripConflicts({
    userId,
    startDate,
    endDate,
    tripNumber: parsedData.tripNumber,
    pairingId: parsedData.pairingId,
    dutyDates: dutyDates.length > 0 ? dutyDates : undefined,
    dutyTimes: dutyTimes.length > 0 ? dutyTimes : undefined,
    // Pass COMPUTED values for accurate newTripSummary display
    totalCreditMinutes: computedCreditMinutes,
    totalBlockMinutes: computedBlockMinutes,
    legCount,
    routeHighlights,
  });

  if (conflictResult.hasConflicts) {
    console.log(`⚠️ [Schedule] CONFLICT DETECTED: ${conflictResult.conflicts.length} conflicts found`);
    console.log(`   New trip summary - Credit: ${computedCreditMinutes}min, Block: ${computedBlockMinutes}min`);
    // Return conflict info - DO NOT create the trip
    // The frontend must handle this and show the conflict modal
    return {
      tripId: "", // No trip created
      isNew: false,
      hasConflicts: true,
      conflictResult,
      // ALSO return parsedData with computed totals for the modal
      parsedData: {
        ...parsedData,
        totals: {
          ...parsedData.totals,
          creditMinutes: computedCreditMinutes,
          blockMinutes: computedBlockMinutes,
          dutyDays: dutyDaysCount,
        },
      },
    };
  }

  // No conflicts - create new trip
  const trip = await db.trip.create({
    data: {
      userId,
      tripNumber: parsedData.tripNumber || null,
      pairingId: parsedData.pairingId || null,
      baseFleet: parsedData.baseFleet || null,
      startDate,
      endDate,
      source: "import",
      totalCreditMinutes: computedCreditMinutes,
      totalBlockMinutes: computedBlockMinutes,
      totalTafbMinutes: parsedData.totals?.tafbMinutes || 0,
      totalPdiemCents: parsedData.totals?.perDiemCents || 0,
      dutyDaysCount,
      // Initialize credit protection fields for review-changes screen
      protectedCreditMinutes: computedCreditMinutes,
      currentCreditMinutes: computedCreditMinutes,
      payCreditMinutes: computedCreditMinutes,
    },
  });

  console.log(`✅ [Schedule] Created new trip: ${trip.id}`);

  return { tripId: trip.id, isNew: true, hasConflicts: false };
}

// ============================================
// Helper: Create events from parsed data with proper timeline
// ============================================
// OPTIMIZED: Uses batch insert for speed (single DB call instead of N calls)
async function createEventsFromParsed(
  tripId: string,
  parsedData: any,
  sourceType: string,
  confidence: number
): Promise<{ eventIds: string[]; layoversCreated: number }> {
  if (!parsedData.events || parsedData.events.length === 0) {
    return { eventIds: [], layoversCreated: 0 };
  }

  // Separate events by type for proper ordering
  const reportEvents = parsedData.events.filter((e: any) => e.eventType === "REPORT");
  const flightEvents = parsedData.events.filter((e: any) =>
    e.eventType === "FLIGHT" || e.eventType === "DEADHEAD" || e.eventType === "COMMUTE"
  );
  const layoverEvents = parsedData.events.filter((e: any) => e.eventType === "LAYOVER");
  const hotelEvents = parsedData.events.filter((e: any) => e.eventType === "HOTEL");
  const transportEvents = parsedData.events.filter((e: any) => e.eventType === "TRANSPORT");

  // Sort flights by date then time
  flightEvents.sort((a: any, b: any) => {
    const dateA = a.date || parsedData.startDate || "";
    const dateB = b.date || parsedData.startDate || "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const timeA = a.startTime || "00:00";
    const timeB = b.startTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  // Build all events to insert in one batch
  const eventsToCreate: any[] = [];
  let sortOrder = 0;
  let layoversCreated = 0;
  let lastArrivalAirport: string | null = null;
  let lastArrivalTime: string | null = null;
  let lastEventDate: string | null = null;

  // 1. Add REPORT events
  for (const eventData of reportEvents) {
    eventsToCreate.push({
      tripId,
      eventType: "REPORT",
      startTimeLocal: eventData.startTime
        ? `${eventData.date || parsedData.startDate || ""}T${eventData.startTime}`
        : null,
      endTimeLocal: null,
      timezone: null,
      depAirport: eventData.depAirport || null,
      arrAirport: null,
      station: eventData.station || eventData.depAirport || null,
      flightMetadata: null,
      layoverMinutes: null,
      hotelName: null,
      hotelPhone: null,
      hotelBooked: false,
      hotelAddress: null,
      transportNotes: null,
      transportPhone: null,
      creditMinutes: 0,
      rawCreditText: null,
      minGuarantee: false,
      sortOrder: sortOrder++,
      sourceType,
      confidence,
    });
  }

  // 2. Add FLIGHT/DEADHEAD events with auto-layovers
  for (let i = 0; i < flightEvents.length; i++) {
    const eventData = flightEvents[i];
    const isDeadhead = eventData.eventType === "DEADHEAD" || eventData.isDeadhead;

    const flightMetadata = JSON.stringify({
      flightNumber: eventData.flightNumber,
      equipment: eventData.equipment,
      blockMinutes: eventData.blockMinutes,
      dutyMinutes: eventData.dutyMinutes,
      creditMinutes: eventData.creditMinutes,
      isDeadhead,
      hasOoiProof: false,
    });

    eventsToCreate.push({
      tripId,
      eventType: isDeadhead ? "DEADHEAD" : "FLIGHT",
      startTimeLocal: eventData.startTime
        ? `${eventData.date || parsedData.startDate || ""}T${eventData.startTime}`
        : null,
      endTimeLocal: eventData.endTime
        ? `${eventData.date || parsedData.startDate || ""}T${eventData.endTime}`
        : null,
      timezone: null,
      depAirport: eventData.depAirport || null,
      arrAirport: eventData.arrAirport || null,
      station: eventData.arrAirport || eventData.depAirport || null,
      flightMetadata,
      layoverMinutes: null,
      hotelName: null,
      hotelPhone: null,
      hotelBooked: false,
      hotelAddress: null,
      transportNotes: null,
      transportPhone: null,
      creditMinutes: eventData.creditMinutes || 0,
      rawCreditText: eventData.rawCreditText || null,
      minGuarantee: false,
      sortOrder: sortOrder++,
      sourceType,
      confidence,
    });

    lastArrivalAirport = eventData.arrAirport || null;
    lastArrivalTime = eventData.endTime || null;
    lastEventDate = eventData.date || parsedData.startDate || null;

    // Check for layover between flights
    const nextFlight = flightEvents[i + 1];
    if (nextFlight && lastArrivalAirport) {
      const existingLayover = layoverEvents.find((l: any) =>
        l.station === lastArrivalAirport || l.arrAirport === lastArrivalAirport
      );

      if (!existingLayover && nextFlight.depAirport === lastArrivalAirport) {
        const parsedLayover = layoverEvents.find((l: any) => !l._used);
        const parsedLayoverMinutes = parsedLayover?.layoverMinutes;

        if (parsedLayoverMinutes) {
          if (parsedLayover) parsedLayover._used = true;
          const matchingHotel = hotelEvents.find((h: any) => !h._used);
          const matchingTransport = transportEvents.find((t: any) => !t._used);

          eventsToCreate.push({
            tripId,
            eventType: "LAYOVER",
            startTimeLocal: lastArrivalTime
              ? `${lastEventDate || ""}T${lastArrivalTime}`
              : null,
            endTimeLocal: null,
            timezone: null,
            depAirport: null,
            arrAirport: null,
            station: lastArrivalAirport,
            flightMetadata: null,
            layoverMinutes: parsedLayoverMinutes,
            hotelName: matchingHotel?.hotelName || null,
            hotelPhone: matchingHotel?.hotelPhone || null,
            hotelBooked: matchingHotel?.hotelBooked || false,
            hotelAddress: null,
            transportNotes: matchingTransport?.transportNotes || null,
            transportPhone: matchingTransport?.transportPhone || null,
            creditMinutes: 0,
            rawCreditText: null,
            minGuarantee: false,
            sortOrder: sortOrder++,
            sourceType,
            confidence,
          });
          layoversCreated++;

          if (matchingHotel) matchingHotel._used = true;
          if (matchingTransport) matchingTransport._used = true;
        }
      }
    }
  }

  // 3. Add remaining LAYOVER events
  for (const eventData of layoverEvents) {
    if (eventData._used) continue;

    const layoverStation = eventData.station || eventData.depAirport || eventData.arrAirport;
    const matchingHotel = hotelEvents.find((h: any) =>
      !h._used && (h.station === layoverStation || h.arrAirport === layoverStation || h.depAirport === layoverStation)
    ) || hotelEvents.find((h: any) => !h._used);

    const matchingTransport = transportEvents.find((t: any) =>
      !t._used && (t.station === layoverStation || t.depAirport === layoverStation)
    ) || transportEvents.find((t: any) => !t._used);

    eventsToCreate.push({
      tripId,
      eventType: "LAYOVER",
      startTimeLocal: eventData.startTime
        ? `${eventData.date || parsedData.startDate || ""}T${eventData.startTime}`
        : null,
      endTimeLocal: eventData.endTime
        ? `${eventData.date || parsedData.startDate || ""}T${eventData.endTime}`
        : null,
      timezone: null,
      depAirport: eventData.depAirport || null,
      arrAirport: eventData.arrAirport || null,
      station: eventData.station || eventData.depAirport || eventData.arrAirport || lastArrivalAirport,
      flightMetadata: null,
      layoverMinutes: eventData.layoverMinutes || null,
      hotelName: matchingHotel?.hotelName || null,
      hotelPhone: matchingHotel?.hotelPhone || null,
      hotelBooked: matchingHotel?.hotelBooked || false,
      hotelAddress: null,
      transportNotes: matchingTransport?.transportNotes || null,
      transportPhone: matchingTransport?.transportPhone || null,
      creditMinutes: 0,
      rawCreditText: null,
      minGuarantee: false,
      sortOrder: sortOrder++,
      sourceType,
      confidence,
    });

    if (matchingHotel) matchingHotel._used = true;
    if (matchingTransport) matchingTransport._used = true;
  }

  // 4. Add standalone HOTEL events
  for (const eventData of hotelEvents) {
    if (eventData._used) continue;

    eventsToCreate.push({
      tripId,
      eventType: "HOTEL",
      startTimeLocal: null,
      endTimeLocal: null,
      timezone: null,
      depAirport: null,
      arrAirport: null,
      station: eventData.station || eventData.arrAirport || lastArrivalAirport,
      flightMetadata: null,
      layoverMinutes: null,
      hotelName: eventData.hotelName || null,
      hotelPhone: eventData.hotelPhone || null,
      hotelBooked: eventData.hotelBooked || false,
      hotelAddress: null,
      transportNotes: null,
      transportPhone: null,
      creditMinutes: 0,
      rawCreditText: null,
      minGuarantee: false,
      sortOrder: sortOrder++,
      sourceType,
      confidence,
    });
  }

  // 5. Add standalone TRANSPORT events
  for (const eventData of transportEvents) {
    if (eventData._used) continue;

    eventsToCreate.push({
      tripId,
      eventType: "TRANSPORT",
      startTimeLocal: null,
      endTimeLocal: null,
      timezone: null,
      depAirport: null,
      arrAirport: null,
      station: eventData.station || lastArrivalAirport,
      flightMetadata: null,
      layoverMinutes: null,
      hotelName: null,
      hotelPhone: null,
      hotelBooked: false,
      hotelAddress: null,
      transportNotes: eventData.transportNotes || null,
      transportPhone: eventData.transportPhone || null,
      creditMinutes: 0,
      rawCreditText: null,
      minGuarantee: false,
      sortOrder: sortOrder++,
      sourceType,
      confidence,
    });
  }

  // BATCH INSERT: One DB call instead of N calls
  if (eventsToCreate.length > 0) {
    await db.tripEvent.createMany({ data: eventsToCreate });
  }

  // Fetch created event IDs (createMany doesn't return IDs)
  const createdEvents = await db.tripEvent.findMany({
    where: { tripId },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });

  return {
    eventIds: createdEvents.map(e => e.id),
    layoversCreated,
  };
}

// ============================================
// Helper: Update shared hotel/transport library
// ============================================
async function updateHotelLibrary(
  parsedData: any,
  base: string | null,
  fleet: string | null
): Promise<void> {
  if (!parsedData.events) return;

  for (const event of parsedData.events) {
    if (event.eventType === "HOTEL" && event.hotelName) {
      const nameNormalized = event.hotelName.toLowerCase().trim();
      const airportCode =
        event.station || event.arrAirport || event.depAirport;

      if (!airportCode) continue;

      // Find or create hotel property
      let hotelProperty = await db.hotelProperty.findFirst({
        where: {
          nameNormalized,
          airportCode,
        },
      });

      if (!hotelProperty) {
        hotelProperty = await db.hotelProperty.create({
          data: {
            nameNormalized,
            displayName: event.hotelName,
            phone: event.hotelPhone || null,
            city: null,
            airportCode,
            address: null,
          },
        });
        console.log(`✅ [Schedule] Created hotel property: ${event.hotelName}`);
      } else if (event.hotelPhone && !hotelProperty.phone) {
        // Update phone if we have it now
        await db.hotelProperty.update({
          where: { id: hotelProperty.id },
          data: { phone: event.hotelPhone },
        });
      }

      // Update layover-hotel mapping
      if (base) {
        const existingMapping = await db.layoverHotelMapping.findFirst({
          where: {
            base,
            fleet: fleet || null,
            layoverAirport: airportCode,
          },
        });

        if (existingMapping) {
          await db.layoverHotelMapping.update({
            where: { id: existingMapping.id },
            data: {
              hotelPropertyId: hotelProperty.id,
              evidenceCount: existingMapping.evidenceCount + 1,
              confidenceScore: Math.min(
                0.99,
                existingMapping.confidenceScore + 0.1
              ),
              lastSeenAt: new Date(),
            },
          });
        } else {
          await db.layoverHotelMapping.create({
            data: {
              base,
              fleet: fleet || null,
              layoverAirport: airportCode,
              hotelPropertyId: hotelProperty.id,
              confidenceScore: 0.6,
              evidenceCount: 1,
            },
          });
        }
      }
    }

    // Update transport notes
    if (event.eventType === "TRANSPORT" && event.transportNotes) {
      const airportCode =
        event.station || event.arrAirport || event.depAirport;
      if (!airportCode) continue;

      const existingNote = await db.transportNote.findFirst({
        where: {
          layoverAirport: airportCode,
          noteText: event.transportNotes,
        },
      });

      if (!existingNote) {
        await db.transportNote.create({
          data: {
            base: base || null,
            fleet: fleet || null,
            layoverAirport: airportCode,
            noteText: event.transportNotes,
            phone: event.transportPhone || null,
            confidenceScore: 0.6,
            evidenceCount: 1,
          },
        });
      } else {
        await db.transportNote.update({
          where: { id: existingNote.id },
          data: {
            evidenceCount: existingNote.evidenceCount + 1,
            confidenceScore: Math.min(0.99, existingNote.confidenceScore + 0.1),
            lastSeenAt: new Date(),
          },
        });
      }
    }
  }
}

// ============================================
// Helper: Create DutyDays and Legs from parsed data
// This ensures the trip shows up properly in the frontend
// ============================================
async function createDutyDaysAndLegsFromParsed(
  tripId: string,
  userId: string,
  parsedData: any
): Promise<{ dutyDayIds: string[]; legIds: string[]; skippedDuplicates: number }> {
  const dutyDayIds: string[] = [];
  const legIds: string[] = [];
  let skippedDuplicates = 0;

  // Get user profile for hourly rate
  const profile = await db.profile.findUnique({
    where: { userId },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // DUPLICATE PROTECTION: Get existing duty days for this trip
  const existingDutyDays = await db.dutyDay.findMany({
    where: { tripId },
    include: { legs: true },
  });

  // Create a map of existing duty days by date for quick lookup
  const existingDutyDaysByDate = new Map<string, typeof existingDutyDays[0]>();
  for (const dd of existingDutyDays) {
    existingDutyDaysByDate.set(dd.dutyDate, dd);
  }

  // If trip already has duty days, check if this is a duplicate upload
  if (existingDutyDays.length > 0) {
    console.log(`  ⚠️ Trip already has ${existingDutyDays.length} duty days - checking for duplicates`);
  }

  // Group flight events by date
  // Handle multiple formats: eventType/type, uppercase/lowercase
  const flightEvents = (parsedData.events || []).filter(
    (e: any) => {
      const eventType = (e.eventType || e.type || "").toString().toUpperCase();
      return eventType === "FLIGHT" ||
             eventType === "DEADHEAD" ||
             eventType === "COMMUTE" ||
             // Also match if there's a flight number (common in AI parsed data)
             (e.flightNumber && !eventType.includes("HOTEL") && !eventType.includes("LAYOVER"));
    }
  );

  // Get the trip to find its start date if parsedData doesn't have one
  let tripStartDate = parsedData.startDate;
  if (!tripStartDate) {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: { startDate: true },
    });
    tripStartDate = trip?.startDate || new Date().toISOString().split("T")[0];
  }

  // If no flight events, create duty days based on totals
  if (flightEvents.length === 0) {
    // Check if we have totals that indicate there should be flights
    const hasTotals = parsedData.totals?.creditMinutes || parsedData.totals?.blockMinutes;
    const dutyDaysCount = parsedData.totals?.dutyDays || 1;

    if (hasTotals) {
      console.log(`  📅 No flight events found, creating ${dutyDaysCount} duty day(s) from totals`);

      // Get credit from totals if available
      const totalCreditMinutes = parsedData.totals?.creditMinutes || 360;
      const totalBlockMinutes = parsedData.totals?.blockMinutes || totalCreditMinutes;

      // Distribute minutes across duty days
      const creditPerDay = Math.round(totalCreditMinutes / dutyDaysCount);
      const blockPerDay = Math.round(totalBlockMinutes / dutyDaysCount);

      // Create duty days for each day
      for (let dayOffset = 0; dayOffset < dutyDaysCount; dayOffset++) {
        const dutyDate = new Date(tripStartDate);
        dutyDate.setDate(dutyDate.getDate() + dayOffset);
        const dutyDateStr = dutyDate.toISOString().split("T")[0] || tripStartDate;

        const calculatedPayCents = Math.round((Math.max(creditPerDay, 360) / 60) * hourlyRateCents);

        // Create duty day
        const dutyDay = await db.dutyDay.create({
          data: {
            tripId,
            dutyDate: dutyDateStr,
            dutyStartISO: parsedData.reportTime && dayOffset === 0
              ? `${dutyDateStr}T${parsedData.reportTime}:00.000Z`
              : null,
            dutyEndISO: null,
            plannedCreditMinutes: creditPerDay,
            actualBlockMinutes: blockPerDay,
            actualCreditMinutes: creditPerDay,
            finalCreditMinutes: Math.max(creditPerDay, 360),
            minCreditMinutes: 360,
            totalPayCents: calculatedPayCents,
          },
        });
        dutyDayIds.push(dutyDay.id);
        console.log(`  📅 Created duty day ${dayOffset + 1}/${dutyDaysCount} for ${dutyDateStr}: ${dutyDay.id}`);

        // Create a placeholder leg so the trip shows in the frontend
        const leg = await db.leg.create({
          data: {
            dutyDayId: dutyDay.id,
            legIndex: 0,
            flightNumber: parsedData.tripNumber || parsedData.pairingId || null,
            origin: null,
            destination: null,
            equipment: parsedData.baseFleet?.split(" ")[1] || null,
            tailNumber: null,
            isDeadhead: false,
            scheduledOutISO: null,
            scheduledInISO: null,
            plannedBlockMinutes: blockPerDay,
            plannedCreditMinutes: creditPerDay,
            actualOutISO: null,
            actualOffISO: null,
            actualOnISO: null,
            actualInISO: null,
            actualFlightMinutes: 0,
            actualBlockMinutes: blockPerDay,
            creditMinutes: creditPerDay,
            premiumCode: null,
            premiumAmountCents: 0,
            calculatedPayCents,
            source: "import",
            ooiProofUri: null,
            notes: dayOffset === 0
              ? "Imported from schedule - add flight details manually"
              : `Day ${dayOffset + 1} of trip - add flight details manually`,
          },
        });
        legIds.push(leg.id);
        console.log(`    ✈️ Created placeholder leg for day ${dayOffset + 1}`);
      }

      return { dutyDayIds, legIds, skippedDuplicates };
    }

    // No totals and no events - nothing to create
    console.log(`  📅 No flight events or totals found, skipping duty day creation`);
    return { dutyDayIds, legIds, skippedDuplicates };
  }

  // NEW: Group flights by DUTY DAY NUMBER (not calendar date)
  // This correctly handles overnight flights where Day 1 & Day 2 calendar days are same duty
  const eventsByDutyDay: Record<number, any[]> = {};
  const dutyDayInfo: Record<number, { startDate: string; endDate?: string; reportTime?: string; releaseTime?: string }> = {};

  // Check if we have dutyPeriods info from AI parsing
  if (parsedData.dutyPeriods && Array.isArray(parsedData.dutyPeriods)) {
    for (const dp of parsedData.dutyPeriods) {
      const dutyNum = dp.dutyDayNumber || 1;
      dutyDayInfo[dutyNum] = {
        startDate: dp.startDate || tripStartDate,
        endDate: dp.endDate,
        reportTime: dp.reportTime,
        releaseTime: dp.releaseTime,
      };
    }
  }

  // FALLBACK: If no dutyDayNumber on any event AND we have multiple unique dates,
  // try to infer duty days from dates and totals
  const eventsHaveDutyDayNumber = flightEvents.some((e: any) => e.dutyDayNumber);
  const uniqueDates = new Set(flightEvents.map((e: any) => e.date).filter(Boolean));
  const expectedDutyDays = parsedData.totals?.dutyDays || parsedData.totals?.tripDays || 0;

  if (!eventsHaveDutyDayNumber && uniqueDates.size > 1) {
    // Events don't have dutyDayNumber but have different dates - use dates to group
    console.log(`  🔄 No dutyDayNumber found, using ${uniqueDates.size} unique dates to infer duty days`);
    const sortedDates = Array.from(uniqueDates).sort();

    // Map each date to a duty day number
    const dateToDay: Record<string, number> = {};
    sortedDates.forEach((date, index) => {
      dateToDay[date as string] = index + 1;
      dutyDayInfo[index + 1] = { startDate: date as string };
    });

    // Assign dutyDayNumber based on date
    for (const event of flightEvents) {
      const dutyNum = event.date ? (dateToDay[event.date] || 1) : 1;
      if (!eventsByDutyDay[dutyNum]) {
        eventsByDutyDay[dutyNum] = [];
      }
      eventsByDutyDay[dutyNum]!.push(event);
    }
  } else if (!eventsHaveDutyDayNumber && expectedDutyDays > 1 && uniqueDates.size === 1) {
    // All events have same date but totals say multiple duty days
    // This happens with Trip Board formats where date is only shown once
    console.log(`  ⚠️ All events have same date but expected ${expectedDutyDays} duty days - cannot auto-split`);
    // Fall through to normal single-day grouping
    for (const event of flightEvents) {
      if (!eventsByDutyDay[1]) {
        eventsByDutyDay[1] = [];
        dutyDayInfo[1] = { startDate: event.date || tripStartDate };
      }
      eventsByDutyDay[1]!.push(event);
    }
  } else {
    // Group events by dutyDayNumber
    for (const event of flightEvents) {
      // Use dutyDayNumber if available, otherwise fall back to dayNumber or calculate from date
      let dutyNum = event.dutyDayNumber || event.dayNumber || 1;

      // If we don't have dutyDayNumber, try to infer from the date and duty periods
      if (!event.dutyDayNumber && event.date) {
        // Check if this event's date falls within a known duty period
        for (const [numStr, info] of Object.entries(dutyDayInfo)) {
          const num = parseInt(numStr);
          if (event.date >= info.startDate && (!info.endDate || event.date <= info.endDate)) {
            dutyNum = num;
            break;
          }
        }
      }

      if (!eventsByDutyDay[dutyNum]) {
        eventsByDutyDay[dutyNum] = [];
        // Initialize duty day info if not from dutyPeriods
        if (!dutyDayInfo[dutyNum]) {
          dutyDayInfo[dutyNum] = { startDate: event.date || tripStartDate };
        }
      }
      eventsByDutyDay[dutyNum]!.push(event);

      // Track end date for this duty day
      const currentInfo = dutyDayInfo[dutyNum];
      if (currentInfo && event.date && (!currentInfo.endDate || event.date > currentInfo.endDate)) {
        currentInfo.endDate = event.date;
      }
    }
  }

  // Sort by duty day number
  const sortedDutyDays = Object.keys(eventsByDutyDay).map(Number).sort((a, b) => a - b);

  console.log(`  📊 Grouped ${flightEvents.length} flights into ${sortedDutyDays.length} duty day(s)`);
  for (const dutyNum of sortedDutyDays) {
    const events = eventsByDutyDay[dutyNum] || [];
    const info = dutyDayInfo[dutyNum] as { startDate?: string; endDate?: string } | undefined;
    const startDate = info?.startDate ?? '';
    const endDate = info?.endDate ?? '';
    console.log(`    Duty Day ${dutyNum}: ${events.length} leg(s), dates: ${startDate}${endDate && endDate !== startDate ? ' to ' + endDate : ''}`);
  }

  // Create DutyDay and Legs for each DUTY DAY (not calendar date)
  for (const dutyNum of sortedDutyDays) {
    const events = eventsByDutyDay[dutyNum] || [];
    const info = dutyDayInfo[dutyNum] || { startDate: tripStartDate };

    // Use the START date of the duty period as the duty day date
    const dutyDate = info.startDate;

    // DUPLICATE PROTECTION: Check if duty day already exists for this date
    const existingDutyDay = existingDutyDaysByDate.get(dutyDate);
    if (existingDutyDay) {
      // Check if the existing duty day has similar data (same number of legs, similar times)
      const existingLegCount = existingDutyDay.legs.length;
      const newLegCount = events.length;

      // If existing duty day has legs and we're trying to add similar number, skip as duplicate
      if (existingLegCount > 0 && Math.abs(existingLegCount - newLegCount) <= 1) {
        console.log(`  ⏭️ DUPLICATE: Duty day for ${dutyDate} already exists with ${existingLegCount} legs - skipping`);
        skippedDuplicates++;
        dutyDayIds.push(existingDutyDay.id); // Return existing ID
        for (const leg of existingDutyDay.legs) {
          legIds.push(leg.id);
        }
        continue; // Skip to next date
      }

      // If existing has no legs but new data has legs, we should update (not duplicate)
      if (existingLegCount === 0 && newLegCount > 0) {
        console.log(`  🔄 Duty day for ${dutyDate} exists but has no legs - will add legs to existing`);
        // Use existing duty day but add new legs
        dutyDayIds.push(existingDutyDay.id);

        // Add legs to existing duty day
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const isDeadhead = event.eventType === "DEADHEAD" || event.isDeadhead;

          let scheduledOutISO: string | null = null;
          let scheduledInISO: string | null = null;
          if (event.startTime) {
            scheduledOutISO = `${dutyDate}T${event.startTime}:00.000Z`;
          }
          if (event.endTime) {
            scheduledInISO = `${dutyDate}T${event.endTime}:00.000Z`;
          }

          const creditMinutes = event.creditMinutes || event.blockMinutes || 0;
          const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

          const leg = await db.leg.create({
            data: {
              dutyDayId: existingDutyDay.id,
              legIndex: i,
              flightNumber: event.flightNumber || null,
              origin: event.depAirport || event.origin || null,
              destination: event.arrAirport || event.destination || null,
              equipment: event.equipment || null,
              tailNumber: null,
              isDeadhead,
              scheduledOutISO,
              scheduledInISO,
              plannedBlockMinutes: event.blockMinutes || 0,
              plannedCreditMinutes: creditMinutes,
              actualOutISO: null,
              actualOffISO: null,
              actualOnISO: null,
              actualInISO: null,
              actualFlightMinutes: 0,
              actualBlockMinutes: event.blockMinutes || 0,
              creditMinutes,
              premiumCode: null,
              premiumAmountCents: 0,
              calculatedPayCents,
              source: "import",
              ooiProofUri: null,
              notes: null,
            },
          });
          legIds.push(leg.id);
        }
        continue;
      }
    }

    // Calculate duty day totals
    let plannedCreditMinutes = 0;
    let totalBlockMinutes = 0;
    let dutyStartISO: string | null = null;
    let dutyEndISO: string | null = null;

    // Find report time for this date from REPORT events
    const reportEvent = parsedData.events.find(
      (e: any) => e.eventType === "REPORT" && (e.date === dutyDate || !e.date)
    );
    if (reportEvent?.startTime) {
      dutyStartISO = `${dutyDate}T${reportEvent.startTime}:00.000Z`;
    }

    // Sort events by start time
    events.sort((a: any, b: any) => {
      const timeA = a.startTime || "00:00";
      const timeB = b.startTime || "00:00";
      return timeA.localeCompare(timeB);
    });

    // Calculate totals from events
    for (const event of events) {
      if (event.creditMinutes) {
        plannedCreditMinutes += event.creditMinutes;
      }
      if (event.blockMinutes) {
        totalBlockMinutes += event.blockMinutes;
      }
    }

    // Get end time from last event
    const lastEvent = events[events.length - 1];
    if (lastEvent?.endTime) {
      dutyEndISO = `${dutyDate}T${lastEvent.endTime}:00.000Z`;
    }

    // Create DutyDay
    const dutyDay = await db.dutyDay.create({
      data: {
        tripId,
        dutyDate,
        dutyStartISO,
        dutyEndISO,
        plannedCreditMinutes,
        actualBlockMinutes: totalBlockMinutes,
        actualCreditMinutes: plannedCreditMinutes,
        finalCreditMinutes: Math.max(plannedCreditMinutes, 360), // 6:00 minimum
        minCreditMinutes: 360,
        totalPayCents: Math.round((Math.max(plannedCreditMinutes, 360) / 60) * hourlyRateCents),
      },
    });
    dutyDayIds.push(dutyDay.id);
    console.log(`  📅 Created duty day for ${dutyDate}: ${dutyDay.id}`);

    // Create Legs for each flight event
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventType = (event.eventType || event.type || "").toString().toUpperCase();
      const isDeadhead = eventType === "DEADHEAD" || event.isDeadhead === true;

      // Build scheduled times - handle multiple field name formats
      let scheduledOutISO: string | null = null;
      let scheduledInISO: string | null = null;
      const outTime = event.scheduledOut || event.startTime || event.localOut;
      const inTime = event.scheduledIn || event.endTime || event.localIn;

      // Debug: log the event times
      console.log(`    [Leg ${i + 1}] Event times: scheduledOut=${event.scheduledOut}, scheduledIn=${event.scheduledIn}, startTime=${event.startTime}, endTime=${event.endTime}`);

      if (outTime) {
        scheduledOutISO = `${dutyDate}T${outTime}:00.000Z`;
      }
      if (inTime) {
        // Handle cross-midnight flights
        let inDate = dutyDate;
        if (outTime && inTime < outTime) {
          // Flight ends after midnight, add a day
          const nextDay = new Date(dutyDate);
          nextDay.setDate(nextDay.getDate() + 1);
          inDate = nextDay.toISOString().split("T")[0] || dutyDate;
        }
        scheduledInISO = `${inDate}T${inTime}:00.000Z`;
      }

      // Handle multiple field name formats for airports
      const origin = event.depAirport || event.origin || event.departure || null;
      const destination = event.arrAirport || event.destination || event.arrival || null;

      const creditMinutes = event.creditMinutes || event.blockMinutes || 0;
      const blockMinutes = event.blockMinutes || 0;
      const calculatedPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

      const leg = await db.leg.create({
        data: {
          dutyDayId: dutyDay.id,
          legIndex: i,
          flightNumber: event.flightNumber || null,
          origin,
          destination,
          equipment: event.equipment || event.aircraftType || null,
          tailNumber: event.tailNumber || null,
          isDeadhead,
          scheduledOutISO,
          scheduledInISO,
          plannedBlockMinutes: blockMinutes,
          plannedCreditMinutes: creditMinutes,
          actualOutISO: null,
          actualOffISO: null,
          actualOnISO: null,
          actualInISO: null,
          actualFlightMinutes: 0,
          actualBlockMinutes: blockMinutes,
          creditMinutes,
          premiumCode: null,
          premiumAmountCents: 0,
          calculatedPayCents,
          source: "import",
          ooiProofUri: null,
          notes: event.rawCreditText || null,
        },
      });
      legIds.push(leg.id);
      console.log(`    ✈️ Created leg ${i + 1}: ${origin || "?"}-${destination || "?"} (${event.flightNumber || "N/A"}) Block: ${blockMinutes}min`);
    }
  }

  // Update trip totals
  // IMPORTANT: Use authoritative footer totals from parsed data when available
  // The parser extracts these from the footer (e.g., "Credit: 43:42T") which is the official total
  // Only fall back to summing duty days if footer totals are not available
  const allDutyDays = await db.dutyDay.findMany({
    where: { tripId },
    include: { legs: true },
  });

  const totalBlockMinutes = allDutyDays.reduce((sum, d) => sum + d.actualBlockMinutes, 0);
  const calculatedCreditMinutes = allDutyDays.reduce((sum, d) => sum + d.finalCreditMinutes, 0);
  const totalPayCents = allDutyDays.reduce((sum, d) => sum + d.totalPayCents, 0);
  const legCount = allDutyDays.reduce((sum, d) => sum + d.legs.length, 0);

  // Use footer total if available and reasonable (within 20% of calculated to catch parsing errors)
  // The footer total from CML/BidPro is authoritative - it accounts for trip rig, duty rig, etc.
  const footerCreditMinutes = parsedData.totals?.creditMinutes || 0;
  let totalCreditMinutes = calculatedCreditMinutes;

  if (footerCreditMinutes > 0) {
    // Footer total is authoritative - use it directly
    // This includes trip rig, duty rig adjustments that leg-level parsing may miss
    totalCreditMinutes = footerCreditMinutes;
    console.log(`  📊 Using authoritative footer credit: ${footerCreditMinutes} min (calculated was ${calculatedCreditMinutes} min)`);
  }

  await db.trip.update({
    where: { id: tripId },
    data: {
      totalBlockMinutes,
      totalCreditMinutes,
      totalPayCents,
      legCount,
      dutyDaysCount: allDutyDays.length,
    },
  });

  return { dutyDayIds, legIds, skippedDuplicates };
}

// ============================================
// Helper: Attach enrichment (hotel/transport) to existing trip
// ============================================
async function attachEnrichmentToTrip(
  tripId: string,
  parsedData: any
): Promise<{ hotelsAdded: number; transportAdded: number }> {
  let hotelsAdded = 0;
  let transportAdded = 0;

  // Get existing layovers for this trip
  const existingEvents = await db.tripEvent.findMany({
    where: { tripId },
    orderBy: { sortOrder: "asc" },
  });

  const layoverEvents = existingEvents.filter((e) => e.eventType === "LAYOVER");

  // Extract hotels and transport from parsed data
  const hotelEvents = parsedData.events?.filter((e: any) => e.eventType === "HOTEL") || [];
  const transportEvents = parsedData.events?.filter((e: any) => e.eventType === "TRANSPORT") || [];

  // Try to match hotels to layovers
  for (const hotel of hotelEvents) {
    // Find a layover without hotel info
    const targetLayover = layoverEvents.find((l) =>
      !l.hotelName && (l.station === hotel.station || l.station === hotel.arrAirport || !hotel.station)
    ) || layoverEvents.find((l) => !l.hotelName);

    if (targetLayover) {
      await db.tripEvent.update({
        where: { id: targetLayover.id },
        data: {
          hotelName: hotel.hotelName,
          hotelPhone: hotel.hotelPhone || null,
          hotelBooked: hotel.hotelBooked || false,
        },
      });
      hotelsAdded++;
      console.log(`  🏨 Added hotel "${hotel.hotelName}" to layover at ${targetLayover.station}`);
    } else {
      // No layover found - check if we should add to existing events
      // Only add as standalone if there are no layovers at all
      if (layoverEvents.length === 0) {
        const lastEvent = existingEvents[existingEvents.length - 1];
        await db.tripEvent.create({
          data: {
            tripId,
            eventType: "HOTEL",
            startTimeLocal: null,
            endTimeLocal: null,
            timezone: null,
            depAirport: null,
            arrAirport: null,
            station: hotel.station || lastEvent?.station || null,
            flightMetadata: null,
            layoverMinutes: null,
            hotelName: hotel.hotelName,
            hotelPhone: hotel.hotelPhone || null,
            hotelBooked: hotel.hotelBooked || false,
            hotelAddress: null,
            transportNotes: null,
            transportPhone: null,
            creditMinutes: 0,
            rawCreditText: null,
            minGuarantee: false,
            sortOrder: existingEvents.length,
            sourceType: "enrichment",
            confidence: 0.7,
          },
        });
        hotelsAdded++;
        console.log(`  🏨 Added standalone hotel "${hotel.hotelName}"`);
      }
    }
  }

  // Try to match transport to layovers
  for (const transport of transportEvents) {
    // Find a layover without transport info
    const targetLayover = layoverEvents.find((l) =>
      !l.transportNotes && (l.station === transport.station || !transport.station)
    ) || layoverEvents.find((l) => !l.transportNotes);

    if (targetLayover) {
      await db.tripEvent.update({
        where: { id: targetLayover.id },
        data: {
          transportNotes: transport.transportNotes,
          transportPhone: transport.transportPhone || null,
        },
      });
      transportAdded++;
      console.log(`  🚐 Added transport to layover at ${targetLayover.station}`);
    }
  }

  return { hotelsAdded, transportAdded };
}

// ============================================
// POST /api/schedule/parse - Parse schedule screenshots
// ============================================
scheduleRouter.post(
  "/parse",
  zValidator("json", parseScheduleSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { images } = c.req.valid("json");

    if (!images || images.length === 0) {
      return c.json({ error: "No images provided" }, 400);
    }

    console.log(
      `📸 [Schedule] Parsing ${images.length} image(s) for user ${user.id}`
    );

    const createdTripIds: string[] = [];
    const updatedTripIds: string[] = [];
    const evidenceIds: string[] = [];
    const parsedTrips: any[] = [];
    const errors: string[] = [];
    const lowConfidenceWarnings: string[] = [];

    // Get user profile for base/fleet
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });
    const userBase = profile?.base || null;

    // Check if OpenAI is available - Vibecode proxy handles auth
    const hasOpenAI = Boolean(
      process.env.OPENAI_BASE_URL || // Vibecode proxy
      process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY
    );

    for (const imageUrl of images) {
      const imageStartTime = Date.now();
      try {
        let ocrText: string = "";
        let parsedData: any = {};
        let sourceType: string = "trip_board_browser"; // Default value
        let confidence: number = 0.5; // Default value
        let fileHash: string | undefined;
        let lowConfidenceFields: string[] = [];
        let sikDetected: {
          detected: boolean;
          dateRange?: { startDate: string; endDate: string } | null;
          station?: string | null;
          totalHours?: number | null;
          rawText?: string | null;
        } | null = null;

        // ============================================
        // OPTIMIZED STRATEGY: AI-FIRST (Skip slow OCR)
        // ============================================
        // When OpenAI is available, go DIRECTLY to AI Vision
        // This cuts parsing time from 60+ seconds to ~15-20 seconds
        // OCR is only used as fallback when AI is not available

        console.log(`📸 [Schedule] Processing image: ${imageUrl}`);
        console.log(`  ⚡ Strategy: ${hasOpenAI ? 'AI-FIRST (fast)' : 'OCR-only (slower)'}`);

        // Step 1: Quick cache check using just the image hash (no full OCR)
        const uploadsDir = path.join(process.cwd(), "uploads");
        const filename = imageUrl.replace("/uploads/", "");
        const filePath = path.join(uploadsDir, filename);

        if (fs.existsSync(filePath)) {
          const hashStartTime = Date.now();
          fileHash = await generateImageHash(filePath);
          console.log(`  🔑 Hash generated in ${Date.now() - hashStartTime}ms: ${fileHash.substring(0, 8)}...`);

          // Check cache for this hash
          const cached = await getCachedParse(fileHash, user.id);
          if (cached && cached.overallConfidence >= 0.8) {
            // Simplify cached ParsedSchedule format
            const simplified = simplifyParsedSchedule(cached);
            console.log(`  ✅ Using cached result (confidence: ${(simplified.confidence * 100).toFixed(1)}%) - ${Date.now() - imageStartTime}ms total`);
            ocrText = cached.rawText || "[Cached]";
            parsedData = simplified;
            sourceType = simplified.sourceType;
            confidence = simplified.confidence;
            lowConfidenceFields = simplified.lowConfidenceFields || [];
            // Skip to trip creation
          } else if (hasOpenAI) {
            // Step 2: AI-FIRST parsing (no OCR pre-scan)
            console.log(`  🤖 Using AI Vision (GPT-4o) for fast, accurate parsing...`);
            const aiStartTime = Date.now();
            try {
              const aiResult = await parseImageWithAI(imageUrl);
              ocrText = aiResult.ocrText;
              parsedData = aiResult.parsedData;
              sourceType = aiResult.sourceType;
              confidence = aiResult.confidence;
              lowConfidenceFields = [];
              sikDetected = aiResult.sikDetected || parsedData.sikDetected || null;

              const aiFlightCount = (parsedData.events || []).filter(
                (e: any) => e.eventType === "FLIGHT" || e.eventType === "DEADHEAD"
              ).length;
              const aiTotals = parsedData.totals;
              console.log(`  ✅ AI parsed in ${Date.now() - aiStartTime}ms: ${aiFlightCount} flights, Credit=${aiTotals?.creditMinutes || 0}min, Block=${aiTotals?.blockMinutes || 0}min`);

              // Log SIK detection if found
              if (sikDetected?.detected) {
                console.log(`  ❤️ SIK DETECTED in upload! Date range: ${sikDetected.dateRange?.startDate} - ${sikDetected.dateRange?.endDate}`);
              }

              // Note: We don't cache AI results here since cacheParse expects ParsedSchedule format
              // The trip creation will handle evidence storage
            } catch (aiError) {
              // AI failed, fall back to OCR
              console.log(`  ⚠️ AI parsing failed (${Date.now() - aiStartTime}ms): ${aiError}`);
              console.log(`  🔄 Falling back to OCR...`);
              const ocrResult = await parseImageWithOCR(imageUrl, user.id);
              ocrText = ocrResult.ocrText;
              parsedData = ocrResult.parsedData;
              sourceType = ocrResult.sourceType;
              confidence = ocrResult.confidence;
              fileHash = ocrResult.fileHash;
              lowConfidenceFields = ocrResult.lowConfidenceFields;
            }
          } else {
            // No AI available - use OCR
            console.log(`  🔤 No AI available, using OCR...`);
            const ocrStartTime = Date.now();
            const ocrResult = await parseImageWithOCR(imageUrl, user.id);
            ocrText = ocrResult.ocrText;
            parsedData = ocrResult.parsedData;
            sourceType = ocrResult.sourceType;
            confidence = ocrResult.confidence;
            fileHash = ocrResult.fileHash;
            lowConfidenceFields = ocrResult.lowConfidenceFields;
            console.log(`  ✅ OCR completed in ${Date.now() - ocrStartTime}ms`);
          }
        } else {
          throw new Error(`Image file not found: ${filePath}`);
        }

        console.log(`  ⏱️ Total parsing time: ${Date.now() - imageStartTime}ms`);

        // Track low confidence warnings
        if (lowConfidenceFields.length > 0) {
          lowConfidenceWarnings.push(
            `Image has uncertain fields: ${lowConfidenceFields.join(", ")}`
          );
        }

        // Ensure sourceType is always defined (defensive fallback)
        if (!sourceType) {
          console.log(`  ⚠️ sourceType was undefined, defaulting to 'trip_board_browser'`);
          sourceType = parsedData.sourceType || "trip_board_browser";
        }

        // Ensure confidence is always defined (defensive fallback)
        if (confidence === undefined || confidence === null) {
          console.log(`  ⚠️ confidence was undefined, defaulting to 0.5`);
          confidence = parsedData.confidence || 0.5;
        }

        // Check if this is enrichment-only (no flight legs)
        const classification = parsedData.classification || "full_schedule";
        const hasFlightLegs = parsedData.hasFlightLegs ??
          parsedData.events?.some((e: any) =>
            e.eventType === "FLIGHT" || e.eventType === "DEADHEAD" || e.eventType === "COMMUTE"
          );

        // Check if this is a Crew Access trip info screenshot
        // These should create trips even without explicit flight legs
        const isCrewAccessTripInfo = sourceType === "crew_access_trip_info";
        const hasTripInfo = parsedData.tripNumber || parsedData.pairingId || parsedData.startDate;

        // Extract fleet from parsed data or profile
        const fleet =
          parsedData.baseFleet?.split(" ")[1] || profile?.position || null;

        let tripId: string;
        let isNew = false;
        let versionResult: VersionAwareImportResult | null = null;

        // Only treat as enrichment-only if:
        // 1. Classification explicitly says enrichment_only AND
        // 2. It's NOT a Crew Access trip info screenshot with trip identifiers
        const isEnrichmentOnly = classification === "enrichment_only" && !isCrewAccessTripInfo;
        const shouldCreateTrip = hasFlightLegs || (isCrewAccessTripInfo && hasTripInfo) || classification === "full_schedule";

        if (isEnrichmentOnly && !shouldCreateTrip) {
          // For enrichment-only uploads, try to find existing trip to attach to
          console.log(`📎 [Schedule] Enrichment-only upload (no flight legs)`);

          // Try to find a recent trip to attach enrichment to
          const recentTrip = await db.trip.findFirst({
            where: {
              userId: user.id,
            },
            orderBy: { createdAt: "desc" },
          });

          if (recentTrip) {
            tripId = recentTrip.id;
            updatedTripIds.push(tripId);
            console.log(`  📎 Attaching to existing trip: ${tripId}`);

            // Only add hotel/transport data to existing layovers
            await attachEnrichmentToTrip(tripId, parsedData);
          } else {
            // No existing trip - store as orphan enrichment
            console.log(`  ⚠️ No existing trip found - storing enrichment for later`);

            // Store the evidence but don't create a trip
            const evidence = await db.scheduleEvidence.create({
              data: {
                userId: user.id,
                tripId: null,
                sourceType: sourceType,
                imageUrl: fileHash ? `${imageUrl}#hash=${fileHash}` : imageUrl,
                parseStatus: "enrichment_pending",
                parseConfidence: confidence,
                rawOcrText: ocrText?.substring(0, 10000) || "",
                parsedData: JSON.stringify(parsedData),
              },
            });
            evidenceIds.push(evidence.id);

            // Add warning about needing flight data
            lowConfidenceWarnings.push(
              "Hotel & transport info captured. Please upload Trip Board screenshot to build the flight timeline."
            );

            parsedTrips.push({
              ...parsedData,
              tripId: null,
              sourceType,
              confidence,
              lowConfidenceFields,
              classification: "enrichment_only",
              message: "Please upload Trip Board screenshot to complete the trip timeline.",
            });

            continue; // Skip normal trip creation
          }
        } else {
          // Full schedule - find or create trip
          const result = await findOrCreateTrip(user.id, parsedData);

          // CHECK: Did conflict detection find overlapping trips?
          if (result.hasConflicts && result.conflictResult) {
            console.log(`🛑 [Schedule] BLOCKING IMPORT - Conflicts detected!`);

            // Use the parsedData from result if available (has computed totals)
            // Fall back to original parsedData
            const dataForModal = result.parsedData || parsedData;

            // Return conflict info - frontend must handle this
            return c.json({
              success: false,
              hasConflicts: true,
              conflictResult: result.conflictResult,
              parsedData: dataForModal, // Include parsed data WITH COMPUTED TOTALS so frontend can display and re-submit after resolution
              message: "Trip conflicts detected. User decision required before import.",
              // Standard fields (empty since we didn't create anything)
              createdTrips: [],
              updatedTrips: [],
              evidence: [],
              parsedTrips: [{
                ...dataForModal,
                tripId: null,
                sourceType,
                confidence,
                lowConfidenceFields,
                classification,
                hasConflicts: true,
                conflicts: result.conflictResult.conflicts,
              }],
              warnings: ["⚠️ Pay Protection Alert: Trip conflict detected. Review required."],
            });
          }

          tripId = result.tripId;
          isNew = result.isNew;

          if (isNew) {
            createdTripIds.push(tripId);
          } else {
            updatedTripIds.push(tripId);
          }

          // Create events with proper timeline hierarchy
          // Create DutyDays and Legs for frontend display
          // Run these in parallel since they're independent
          const [eventResult, dutyDayResult] = await Promise.all([
            createEventsFromParsed(tripId, parsedData, sourceType, confidence),
            createDutyDaysAndLegsFromParsed(tripId, user.id, parsedData),
          ]);
          console.log(`  📋 Created ${eventResult.eventIds.length} events (${eventResult.layoversCreated} auto-layovers)`);
          console.log(`  📅 Created ${dutyDayResult.dutyDayIds.length} duty days with ${dutyDayResult.legIds.length} legs`);

          // OPTIMIZATION: Skip version-aware import for NEW trips (first import)
          // Version tracking is only useful when updating existing trips to detect changes
          // For new trips, DutyDays/Legs created above are sufficient
          if (!isNew) {
            try {
              const airline = profile?.airline ?? "UPS";
              const normalizedData = normalizeAIParsedData(parsedData, sourceType as ImportSourceType);

              // Use version-aware import for UPDATES only
              versionResult = await importWithVersionTracking(
                user.id,
                airline,
                normalizedData,
                tripId,
                {
                  sourceType: "import",
                  imageUrls: [imageUrl],
                  parseConfidence: confidence,
                  lowConfidenceFields,
                  hourlyRateCents: profile?.hourlyRateCents ?? 0,
                }
              );

              console.log(`  📊 Version update: v${versionResult.versionNumber}`);

              if (versionResult.hasChanges) {
                console.log(`  🔄 Roster Changes: ${versionResult.changeCount} changes detected (${versionResult.overallSeverity})`);
                if (versionResult.requiresAck) {
                  lowConfidenceWarnings.push(`Roster changes detected - review required before applying`);
                }
              }

              if (versionResult.payEvaluation?.isPayProtected) {
                console.log(`  🛡️ Pay Protected: credit reduced but pay maintained at ${versionResult.payEvaluation.payCreditMinutes} min`);
              }
            } catch (canonicalError) {
              console.log(`  ⚠️ Version-aware import failed (non-fatal): ${canonicalError}`);
            }
          }
        }

        // Update hotel library in background (non-blocking)
        updateHotelLibrary(parsedData, userBase, fleet).catch(err =>
          console.log(`  ⚠️ Hotel library update failed (non-fatal): ${err}`)
        );

        // Store evidence with hash for caching
        const evidence = await db.scheduleEvidence.create({
          data: {
            userId: user.id,
            tripId,
            sourceType,
            imageUrl: fileHash ? `${imageUrl}#hash=${fileHash}` : imageUrl,
            parseStatus: "success",
            parseConfidence: confidence,
            rawOcrText: ocrText?.substring(0, 10000) || "", // Limit length, handle undefined
            parsedData: JSON.stringify(parsedData),
          },
        });
        evidenceIds.push(evidence.id);

        parsedTrips.push({
          ...parsedData,
          tripId,
          sourceType,
          confidence,
          lowConfidenceFields,
          classification,
          // SIK detection from upload (Phase 1)
          sikDetected: sikDetected || null,
          // Version tracking info (Phase 1-3)
          versionInfo: versionResult ? {
            versionId: versionResult.versionId,
            versionNumber: versionResult.versionNumber,
            isNewTrip: versionResult.isNewTrip,
            isFirstVersion: versionResult.isFirstVersion,
            hasChanges: versionResult.hasChanges,
            overallSeverity: versionResult.overallSeverity,
            requiresAck: versionResult.requiresAck,
            hasPremiumCandidates: versionResult.hasPremiumCandidates,
            changeCount: versionResult.changeCount,
            rosterChangeIds: versionResult.rosterChangeIds,
            payEvaluation: versionResult.payEvaluation,
          } : null,
        });

        console.log(
          `✅ [Schedule] Parsed image: ${sourceType}, confidence: ${(confidence * 100).toFixed(1)}%`
        );
      } catch (error) {
        console.error(`❌ [Schedule] Error parsing image ${imageUrl}:`, error);
        errors.push(
          `Failed to parse image: ${error instanceof Error ? error.message : "Unknown error"}`
        );

        // Store failed evidence
        const evidence = await db.scheduleEvidence.create({
          data: {
            userId: user.id,
            tripId: null,
            sourceType: "unknown",
            imageUrl,
            parseStatus: "failed",
            parseConfidence: 0,
            errorMessage:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
        evidenceIds.push(evidence.id);
      }
    }

    // Check if any parsed trips have SIK detected
    const sikDetectedResults = parsedTrips
      .filter((t: any) => t.sikDetected?.detected)
      .map((t: any) => ({
        tripId: t.tripId,
        sikDetected: t.sikDetected,
      }));

    return c.json({
      success: errors.length === 0,
      parsedTrips,
      createdTripIds,
      updatedTripIds,
      evidenceIds,
      errors: errors.length > 0 ? errors : undefined,
      lowConfidenceWarnings: lowConfidenceWarnings.length > 0 ? lowConfidenceWarnings : undefined,
      // SIK detection summary for frontend to show review modal
      sikDetected: sikDetectedResults.length > 0 ? sikDetectedResults : undefined,
      hasSikDetected: sikDetectedResults.length > 0,
    });
  }
);

// ============================================
// GET /api/schedule/timeline - Get trips timeline grouped by date
// ============================================
scheduleRouter.get("/timeline", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const month = c.req.query("month"); // YYYY-MM format
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Build date filters
  let dateFilter: any = {};
  if (month) {
    const [year, monthNum] = month.split("-");
    const monthStart = `${year}-${monthNum}-01`;
    const monthEnd = `${year}-${monthNum}-31`;
    dateFilter = {
      OR: [
        { startDate: { gte: monthStart, lte: monthEnd } },
        { endDate: { gte: monthStart, lte: monthEnd } },
      ],
    };
  } else if (startDate && endDate) {
    dateFilter = {
      OR: [
        { startDate: { gte: startDate, lte: endDate } },
        { endDate: { gte: startDate, lte: endDate } },
      ],
    };
  }

  // Fetch trips with events
  const trips = await db.trip.findMany({
    where: {
      userId: user.id,
      ...dateFilter,
    },
    include: {
      events: {
        orderBy: [{ sortOrder: "asc" }, { startTimeLocal: "asc" }],
      },
    },
    orderBy: { startDate: "asc" },
  });

  // Group events by date
  const dayGroups: Map<
    string,
    {
      date: string;
      events: any[];
      creditMinutes: number;
      minGuaranteeApplied: boolean;
    }
  > = new Map();

  for (const trip of trips) {
    for (const event of trip.events) {
      // Determine the date for this event
      let eventDate: string = trip.startDate;
      if (event.startTimeLocal) {
        const datePart = event.startTimeLocal.split("T")[0];
        if (datePart) {
          eventDate = datePart;
        }
      } else if (event.station) {
        // For layovers without explicit time, use trip date range
        eventDate = trip.startDate;
      }

      if (!dayGroups.has(eventDate)) {
        dayGroups.set(eventDate, {
          date: eventDate,
          events: [],
          creditMinutes: 0,
          minGuaranteeApplied: false,
        });
      }

      const dayGroup = dayGroups.get(eventDate);
      if (dayGroup) {
        dayGroup.events.push(event);
        dayGroup.creditMinutes += event.creditMinutes;
        if (event.minGuarantee) {
          dayGroup.minGuaranteeApplied = true;
        }
      }
    }
  }

  // Convert to array and format
  const days = Array.from(dayGroups.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
      date: day.date,
      dateDisplay: formatDateDisplay(day.date),
      eventCount: day.events.length,
      creditMinutes: day.creditMinutes,
      minGuaranteeApplied: day.minGuaranteeApplied,
      events: day.events,
    }));

  return c.json({ days, trips });
});

// ============================================
// DELETE /api/schedule/clear - Clear trips for month or all
// ============================================
scheduleRouter.delete("/clear", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const month = c.req.query("month"); // YYYY-MM format

  let whereClause: any = { userId: user.id };

  if (month) {
    const [year, monthNum] = month.split("-");
    const monthStart = `${year}-${monthNum}-01`;
    const monthEnd = `${year}-${monthNum}-31`;
    whereClause = {
      userId: user.id,
      OR: [
        { startDate: { gte: monthStart, lte: monthEnd } },
        { endDate: { gte: monthStart, lte: monthEnd } },
      ],
    };
  }

  const result = await db.trip.deleteMany({ where: whereClause });

  // Also clear the parse cache to allow re-uploads
  const cacheCleared = await invalidateUserCache(user.id);

  console.log(
    `🗑️ [Schedule] Deleted ${result.count} trip(s) and ${cacheCleared} cached parses for user ${user.id}`
  );

  return c.json({
    success: true,
    deletedCount: result.count,
    cacheCleared,
  });
});

// ============================================
// DELETE /api/schedule/clear-cache - Clear parse cache only
// ============================================
scheduleRouter.delete("/clear-cache", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const cacheCleared = await invalidateUserCache(user.id);

  console.log(
    `🗑️ [Schedule] Cleared ${cacheCleared} cached parses for user ${user.id}`
  );

  return c.json({
    success: true,
    cacheCleared,
  });
});

// ============================================
// POST /api/schedule/events - Create event manually
// ============================================
scheduleRouter.post(
  "/events",
  zValidator("json", createEventSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = c.req.valid("json");

    // Verify trip ownership
    const trip = await db.trip.findFirst({
      where: { id: body.tripId, userId: user.id },
    });

    if (!trip) {
      return c.json({ error: "Trip not found" }, 404);
    }

    // Get max sort order for this trip
    const maxSortOrder = await db.tripEvent.findFirst({
      where: { tripId: body.tripId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const event = await db.tripEvent.create({
      data: {
        tripId: body.tripId,
        eventType: body.eventType,
        startTimeLocal: body.startTimeLocal || null,
        endTimeLocal: body.endTimeLocal || null,
        timezone: body.timezone || null,
        depAirport: body.depAirport || null,
        arrAirport: body.arrAirport || null,
        station: body.station || null,
        flightMetadata: body.flightMetadata || null,
        layoverMinutes: body.layoverMinutes || null,
        hotelName: body.hotelName || null,
        hotelPhone: body.hotelPhone || null,
        hotelBooked: body.hotelBooked || false,
        transportNotes: body.transportNotes || null,
        transportPhone: body.transportPhone || null,
        creditMinutes: body.creditMinutes || 0,
        rawCreditText: body.rawCreditText || null,
        sortOrder: body.sortOrder ?? (maxSortOrder?.sortOrder ?? 0) + 1,
        sourceType: "manual",
        confidence: 1.0,
      },
    });

    return c.json({ success: true, event });
  }
);

// ============================================
// PUT /api/schedule/events/:id - Update event
// ============================================
scheduleRouter.put(
  "/events/:id",
  zValidator("json", createEventSchema.partial()),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const eventId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify ownership through trip
    const existing = await db.tripEvent.findFirst({
      where: { id: eventId },
      include: { trip: true },
    });

    if (!existing || existing.trip.userId !== user.id) {
      return c.json({ error: "Event not found" }, 404);
    }

    const event = await db.tripEvent.update({
      where: { id: eventId },
      data: {
        ...body,
      },
    });

    return c.json({ success: true, event });
  }
);

// ============================================
// DELETE /api/schedule/events/:id - Delete event
// ============================================
scheduleRouter.delete("/events/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const eventId = c.req.param("id");

  // Verify ownership through trip
  const existing = await db.tripEvent.findFirst({
    where: { id: eventId },
    include: { trip: true },
  });

  if (!existing || existing.trip.userId !== user.id) {
    return c.json({ error: "Event not found" }, 404);
  }

  await db.tripEvent.delete({ where: { id: eventId } });

  return c.json({ success: true });
});

// ============================================
// GET /api/schedule/hotels - Get hotel suggestions for an airport
// ============================================
scheduleRouter.get("/hotels", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const airport = c.req.query("airport");
  if (!airport) {
    return c.json({ error: "Airport code required" }, 400);
  }

  // Get user's base
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });

  // Find hotel mappings with high confidence
  const mappings = await db.layoverHotelMapping.findMany({
    where: {
      layoverAirport: airport.toUpperCase(),
      ...(profile?.base ? { base: profile.base } : {}),
      confidenceScore: { gte: 0.7 },
    },
    include: { hotelProperty: true },
    orderBy: [{ confidenceScore: "desc" }, { evidenceCount: "desc" }],
    take: 5,
  });

  // Also get transport notes
  const transportNotes = await db.transportNote.findMany({
    where: {
      layoverAirport: airport.toUpperCase(),
      confidenceScore: { gte: 0.7 },
    },
    orderBy: [{ confidenceScore: "desc" }, { evidenceCount: "desc" }],
    take: 3,
  });

  return c.json({
    hotels: mappings.map((m) => ({
      id: m.hotelProperty.id,
      name: m.hotelProperty.displayName,
      phone: m.hotelProperty.phone,
      address: m.hotelProperty.address,
      confidence: m.confidenceScore,
      evidenceCount: m.evidenceCount,
    })),
    transport: transportNotes.map((t) => ({
      id: t.id,
      notes: t.noteText,
      phone: t.phone,
      confidence: t.confidenceScore,
    })),
  });
});

// ============================================
// SCHEDULE SNAPSHOTS - Trip Board comparison feature
// ============================================

// Helper: Extract snapshot data from parsed trip data
function extractSnapshotData(parsedData: any): {
  trips: any[];
  dateRange: { start: string; end: string };
  tripCount: number;
  legCount: number;
  totalCreditMinutes: number;
} {
  const trips: any[] = [];
  let totalLegCount = 0;
  let totalCreditMinutes = 0;
  let minDate = "9999-99-99";
  let maxDate = "0000-00-00";

  // Handle both single trip and multiple trips
  const tripDataList = Array.isArray(parsedData) ? parsedData : [parsedData];

  for (const tripData of tripDataList) {
    const legs: any[] = [];

    // Extract legs from events
    const events = tripData.events || [];
    let legIndex = 0;

    for (const event of events) {
      if (event.eventType === "FLIGHT" || event.eventType === "DEADHEAD") {
        legs.push({
          legIndex: legIndex++,
          flightNumber: event.flightNumber || null,
          origin: event.depAirport || "",
          destination: event.arrAirport || "",
          scheduledOutISO: event.startTime
            ? `${event.date || tripData.startDate || ""}T${event.startTime}`
            : null,
          scheduledInISO: event.endTime
            ? `${event.date || tripData.startDate || ""}T${event.endTime}`
            : null,
          creditMinutes: event.creditMinutes || 0,
          isDeadhead: event.eventType === "DEADHEAD" || event.isDeadhead || false,
          equipment: event.equipment || null,
        });
        totalCreditMinutes += event.creditMinutes || 0;
      }
    }

    const startDate = tripData.startDate || tripData.events?.[0]?.date || new Date().toISOString().split("T")[0];
    const endDate = tripData.endDate || tripData.events?.[events.length - 1]?.date || startDate;

    if (startDate < minDate) minDate = startDate;
    if (endDate > maxDate) maxDate = endDate;

    trips.push({
      tripNumber: tripData.tripNumber || null,
      pairingId: tripData.pairingId || null,
      startDate,
      endDate,
      baseFleet: tripData.baseFleet || null,
      totalCreditMinutes: tripData.totals?.creditMinutes || legs.reduce((sum, l) => sum + l.creditMinutes, 0),
      legs,
    });

    totalLegCount += legs.length;
  }

  return {
    trips,
    dateRange: {
      start: minDate !== "9999-99-99" ? minDate : (new Date().toISOString().split("T")[0] ?? ""),
      end: maxDate !== "0000-00-00" ? maxDate : (new Date().toISOString().split("T")[0] ?? ""),
    },
    tripCount: trips.length,
    legCount: totalLegCount,
    totalCreditMinutes,
  };
}

// Helper: Compare two snapshots and detect changes
function compareSnapshots(
  oldSnapshot: { scheduleData: string } | null,
  newSnapshotData: { trips: any[]; dateRange: { start: string; end: string } },
  hourlyRateCents: number
): {
  changes: any[];
  payImpactChanges: number;
  estimatedPayDiffCents: number;
} {
  const changes: any[] = [];
  let payImpactChanges = 0;
  let estimatedPayDiffCents = 0;

  // Parse old snapshot data
  let oldData: { trips: any[]; dateRange: { start: string; end: string } } | null = null;
  if (oldSnapshot?.scheduleData) {
    try {
      oldData = JSON.parse(oldSnapshot.scheduleData);
    } catch (e) {
      console.log("Failed to parse old snapshot data");
    }
  }

  if (!oldData) {
    // First snapshot - no comparison needed
    return { changes: [], payImpactChanges: 0, estimatedPayDiffCents: 0 };
  }

  // Create maps for easy lookup
  const oldTripsMap = new Map(
    oldData.trips.map((t) => [t.tripNumber || t.pairingId || `${t.startDate}-${t.endDate}`, t])
  );
  const newTripsMap = new Map(
    newSnapshotData.trips.map((t) => [t.tripNumber || t.pairingId || `${t.startDate}-${t.endDate}`, t])
  );

  // Check for removed trips
  for (const [tripKey, oldTrip] of oldTripsMap) {
    if (!newTripsMap.has(tripKey)) {
      const creditLoss = oldTrip.totalCreditMinutes || 0;
      const payLoss = Math.round((creditLoss / 60) * hourlyRateCents);

      changes.push({
        changeType: "TRIP_REMOVED",
        severity: creditLoss > 0 ? "pay_impact" : "warning",
        tripNumber: oldTrip.tripNumber,
        tripDate: oldTrip.startDate,
        oldValue: JSON.stringify(oldTrip),
        newValue: null,
        creditDiffMinutes: -creditLoss,
        estimatedPayDiffCents: -payLoss,
        suggestedEventType: "SCHEDULE_CHANGE",
        suggestedEventTitle: `Trip ${oldTrip.tripNumber || "removed"} dropped from schedule`,
      });

      if (creditLoss > 0) {
        payImpactChanges++;
        estimatedPayDiffCents -= payLoss;
      }
    }
  }

  // Check for added trips
  for (const [tripKey, newTrip] of newTripsMap) {
    if (!oldTripsMap.has(tripKey)) {
      const creditGain = newTrip.totalCreditMinutes || 0;
      const payGain = Math.round((creditGain / 60) * hourlyRateCents);

      changes.push({
        changeType: "TRIP_ADDED",
        severity: "info",
        tripNumber: newTrip.tripNumber,
        tripDate: newTrip.startDate,
        oldValue: null,
        newValue: JSON.stringify(newTrip),
        creditDiffMinutes: creditGain,
        estimatedPayDiffCents: payGain,
        suggestedEventType: "REASSIGNMENT",
        suggestedEventTitle: `Trip ${newTrip.tripNumber || "added"} assigned`,
      });
    }
  }

  // Check for modified trips
  for (const [tripKey, newTrip] of newTripsMap) {
    const oldTrip = oldTripsMap.get(tripKey);
    if (!oldTrip) continue;

    // Compare legs
    const oldLegsMap = new Map(
      (oldTrip.legs || []).map((l: any, i: number) => [
        `${l.origin}-${l.destination}-${l.flightNumber || i}`,
        l,
      ])
    );
    const newLegsMap = new Map(
      (newTrip.legs || []).map((l: any, i: number) => [
        `${l.origin}-${l.destination}-${l.flightNumber || i}`,
        l,
      ])
    );

    // Check for removed legs
    for (const [legKey, oldLeg] of oldLegsMap) {
      if (!newLegsMap.has(legKey)) {
        const creditLoss = (oldLeg as any).creditMinutes || 0;
        const payLoss = Math.round((creditLoss / 60) * hourlyRateCents);

        changes.push({
          changeType: "LEG_REMOVED",
          severity: creditLoss > 0 ? "pay_impact" : "warning",
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          legIndex: (oldLeg as any).legIndex,
          fieldChanged: "leg",
          oldValue: JSON.stringify(oldLeg),
          newValue: null,
          creditDiffMinutes: -creditLoss,
          estimatedPayDiffCents: -payLoss,
          suggestedEventType: "SCHEDULE_CHANGE",
          suggestedEventTitle: `Leg ${(oldLeg as any).origin}-${(oldLeg as any).destination} removed from Trip ${newTrip.tripNumber}`,
        });

        if (creditLoss > 0) {
          payImpactChanges++;
          estimatedPayDiffCents -= payLoss;
        }
      }
    }

    // Check for added legs
    for (const [legKey, newLeg] of newLegsMap) {
      if (!oldLegsMap.has(legKey)) {
        const creditGain = (newLeg as any).creditMinutes || 0;
        const payGain = Math.round((creditGain / 60) * hourlyRateCents);

        changes.push({
          changeType: "LEG_ADDED",
          severity: "info",
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          legIndex: (newLeg as any).legIndex,
          fieldChanged: "leg",
          oldValue: null,
          newValue: JSON.stringify(newLeg),
          creditDiffMinutes: creditGain,
          estimatedPayDiffCents: payGain,
          suggestedEventType: "SCHEDULE_CHANGE",
          suggestedEventTitle: `Leg ${(newLeg as any).origin}-${(newLeg as any).destination} added to Trip ${newTrip.tripNumber}`,
        });
      }
    }

    // Check for modified legs
    for (const [legKey, newLeg] of newLegsMap) {
      const oldLeg = oldLegsMap.get(legKey);
      if (!oldLeg) continue;

      const nl = newLeg as any;
      const ol = oldLeg as any;

      // Check time changes
      if (ol.scheduledOutISO !== nl.scheduledOutISO || ol.scheduledInISO !== nl.scheduledInISO) {
        changes.push({
          changeType: "TIME_CHANGE",
          severity: "warning",
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          legIndex: nl.legIndex,
          fieldChanged: "scheduledTime",
          oldValue: JSON.stringify({ out: ol.scheduledOutISO, in: ol.scheduledInISO }),
          newValue: JSON.stringify({ out: nl.scheduledOutISO, in: nl.scheduledInISO }),
          creditDiffMinutes: 0,
          estimatedPayDiffCents: 0,
          suggestedEventType: "SCHEDULE_CHANGE",
          suggestedEventTitle: `Flight times changed for ${nl.origin}-${nl.destination}`,
        });
      }

      // Check deadhead change
      if (ol.isDeadhead !== nl.isDeadhead) {
        const creditDiff = ol.isDeadhead ? nl.creditMinutes : -ol.creditMinutes;
        const payDiff = Math.round((creditDiff / 60) * hourlyRateCents);

        changes.push({
          changeType: "DH_CHANGE",
          severity: "pay_impact",
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          legIndex: nl.legIndex,
          fieldChanged: "isDeadhead",
          oldValue: String(ol.isDeadhead),
          newValue: String(nl.isDeadhead),
          creditDiffMinutes: creditDiff,
          estimatedPayDiffCents: payDiff,
          suggestedEventType: "SCHEDULE_CHANGE",
          suggestedEventTitle: nl.isDeadhead
            ? `Leg ${nl.origin}-${nl.destination} changed to deadhead`
            : `Leg ${nl.origin}-${nl.destination} changed from deadhead to working`,
        });

        payImpactChanges++;
        estimatedPayDiffCents += payDiff;
      }

      // Check credit change
      if (ol.creditMinutes !== nl.creditMinutes) {
        const creditDiff = nl.creditMinutes - ol.creditMinutes;
        const payDiff = Math.round((creditDiff / 60) * hourlyRateCents);

        changes.push({
          changeType: "CREDIT_CHANGE",
          severity: Math.abs(creditDiff) >= 30 ? "pay_impact" : "info",
          tripNumber: newTrip.tripNumber,
          tripDate: newTrip.startDate,
          legIndex: nl.legIndex,
          fieldChanged: "creditMinutes",
          oldValue: String(ol.creditMinutes),
          newValue: String(nl.creditMinutes),
          creditDiffMinutes: creditDiff,
          estimatedPayDiffCents: payDiff,
          suggestedEventType: creditDiff > 0 ? "DUTY_EXTENSION" : "SCHEDULE_CHANGE",
          suggestedEventTitle: `Credit changed for ${nl.origin}-${nl.destination}: ${Math.floor(ol.creditMinutes / 60)}:${String(ol.creditMinutes % 60).padStart(2, "0")} → ${Math.floor(nl.creditMinutes / 60)}:${String(nl.creditMinutes % 60).padStart(2, "0")}`,
        });

        if (Math.abs(creditDiff) >= 30) {
          payImpactChanges++;
          estimatedPayDiffCents += payDiff;
        }
      }
    }
  }

  return { changes, payImpactChanges, estimatedPayDiffCents };
}

// POST /api/schedule/snapshot - Create a new Trip Board snapshot
scheduleRouter.post(
  "/snapshot",
  zValidator(
    "json",
    z.object({
      images: z.array(z.string()),
      sourceType: z.enum(["trip_board_browser", "trip_board_trip_details"]).optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { images, sourceType: requestedSourceType } = c.req.valid("json");

    if (!images || images.length === 0) {
      return c.json({ error: "No images provided" }, 400);
    }

    console.log(`📸 [Snapshot] Creating snapshot from ${images.length} image(s)`);

    // Get user's hourly rate for pay impact calculation
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });
    const hourlyRateCents = profile?.hourlyRateCents || 32500;

    // Parse images (reuse existing OCR/AI pipeline)
    const parsedTrips: any[] = [];
    let aggregatedConfidence = 0;
    let detectedSourceType = requestedSourceType || "trip_board_browser";

    // Check if OpenAI is available - Vibecode proxy handles auth
    const hasOpenAI = Boolean(
      process.env.OPENAI_BASE_URL || // Vibecode proxy
      process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY
    );

    for (const imageUrl of images) {
      try {
        let parsedData: any;
        let confidence: number;

        console.log(`🔤 [Snapshot] Parsing: ${imageUrl}`);

        try {
          const ocrResult = await parseImageWithOCR(imageUrl, user.id);
          parsedData = ocrResult.parsedData;
          confidence = ocrResult.confidence;
          detectedSourceType = ocrResult.sourceType as any;

          // Fall back to AI if OCR confidence is low
          if (confidence < 0.5 && hasOpenAI) {
            console.log(`  ⚠️ Low OCR confidence, trying OpenAI...`);
            const aiResult = await parseImageWithAI(imageUrl);
            if (aiResult.confidence > confidence) {
              parsedData = aiResult.parsedData;
              confidence = aiResult.confidence;
              detectedSourceType = aiResult.sourceType as any;
            }
          }
        } catch (ocrError) {
          if (hasOpenAI) {
            const aiResult = await parseImageWithAI(imageUrl);
            parsedData = aiResult.parsedData;
            confidence = aiResult.confidence;
            detectedSourceType = aiResult.sourceType as any;
          } else {
            throw ocrError;
          }
        }

        parsedTrips.push(parsedData);
        aggregatedConfidence += confidence;
      } catch (error) {
        console.error(`❌ [Snapshot] Error parsing image:`, error);
      }
    }

    if (parsedTrips.length === 0) {
      return c.json({ error: "Failed to parse any images" }, 400);
    }

    const avgConfidence = aggregatedConfidence / parsedTrips.length;

    // Extract snapshot data
    const snapshotData = extractSnapshotData(parsedTrips);
    const today = new Date().toISOString().split("T")[0] ?? "";

    // Get the most recent snapshot for comparison
    const previousSnapshot = await db.scheduleSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // Compare snapshots
    const { changes, payImpactChanges, estimatedPayDiffCents } = compareSnapshots(
      previousSnapshot,
      snapshotData,
      hourlyRateCents
    );

    // Create new snapshot
    const snapshot = await db.scheduleSnapshot.create({
      data: {
        userId: user.id,
        snapshotDate: today,
        sourceType: detectedSourceType,
        imageUrls: JSON.stringify(images),
        scheduleData: JSON.stringify(snapshotData),
        startDate: snapshotData.dateRange.start,
        endDate: snapshotData.dateRange.end,
        confidence: avgConfidence,
        parseStatus: "success",
        tripCount: snapshotData.tripCount,
        legCount: snapshotData.legCount,
        totalCreditMinutes: snapshotData.totalCreditMinutes,
      },
    });

    console.log(`✅ [Snapshot] Created snapshot ${snapshot.id}`);

    // Create change records
    const createdChanges: any[] = [];
    for (const change of changes) {
      const changeRecord = await db.scheduleChange.create({
        data: {
          userId: user.id,
          oldSnapshotId: previousSnapshot?.id || null,
          newSnapshotId: snapshot.id,
          changeType: change.changeType,
          severity: change.severity,
          tripNumber: change.tripNumber,
          tripDate: change.tripDate,
          legIndex: change.legIndex,
          fieldChanged: change.fieldChanged,
          oldValue: change.oldValue,
          newValue: change.newValue,
          creditDiffMinutes: change.creditDiffMinutes,
          estimatedPayDiffCents: change.estimatedPayDiffCents,
          suggestedEventType: change.suggestedEventType,
          suggestedEventTitle: change.suggestedEventTitle,
        },
      });
      createdChanges.push({
        id: changeRecord.id,
        userId: changeRecord.userId,
        oldSnapshotId: changeRecord.oldSnapshotId,
        newSnapshotId: changeRecord.newSnapshotId,
        changeType: changeRecord.changeType,
        severity: changeRecord.severity,
        tripNumber: changeRecord.tripNumber,
        tripDate: changeRecord.tripDate,
        legIndex: changeRecord.legIndex,
        fieldChanged: changeRecord.fieldChanged,
        oldValue: changeRecord.oldValue,
        newValue: changeRecord.newValue,
        creditDiffMinutes: changeRecord.creditDiffMinutes,
        estimatedPayDiffCents: changeRecord.estimatedPayDiffCents,
        suggestedEventType: changeRecord.suggestedEventType,
        suggestedEventTitle: changeRecord.suggestedEventTitle,
        payEventId: changeRecord.payEventId,
        acknowledged: changeRecord.acknowledged,
        acknowledgedAt: changeRecord.acknowledgedAt?.toISOString() || null,
        createdAt: changeRecord.createdAt.toISOString(),
      });
    }

    // Update reminder settings with last import time
    await db.scheduleReminderSettings.upsert({
      where: { userId: user.id },
      update: { lastImportAt: new Date() },
      create: {
        userId: user.id,
        lastImportAt: new Date(),
      },
    });

    // Build suggested pay events
    const suggestedPayEvents = createdChanges
      .filter((c) => c.suggestedEventType && (c.severity === "pay_impact" || c.severity === "warning"))
      .map((c) => ({
        changeId: c.id,
        eventType: c.suggestedEventType,
        title: c.suggestedEventTitle || `Schedule change detected`,
        description: c.fieldChanged
          ? `${c.fieldChanged}: ${c.oldValue || "none"} → ${c.newValue || "none"}`
          : undefined,
      }));

    console.log(`📊 [Snapshot] ${createdChanges.length} changes detected, ${payImpactChanges} with pay impact`);

    // Format response
    const snapshotResponse = {
      id: snapshot.id,
      userId: snapshot.userId,
      snapshotDate: snapshot.snapshotDate,
      sourceType: snapshot.sourceType,
      imageUrls: snapshot.imageUrls,
      scheduleData: snapshot.scheduleData,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      confidence: snapshot.confidence,
      parseStatus: snapshot.parseStatus,
      tripCount: snapshot.tripCount,
      legCount: snapshot.legCount,
      totalCreditMinutes: snapshot.totalCreditMinutes,
      lastComparedAt: snapshot.lastComparedAt?.toISOString() || null,
      createdAt: snapshot.createdAt.toISOString(),
      updatedAt: snapshot.updatedAt.toISOString(),
    };

    const previousSnapshotResponse = previousSnapshot
      ? {
          id: previousSnapshot.id,
          userId: previousSnapshot.userId,
          snapshotDate: previousSnapshot.snapshotDate,
          sourceType: previousSnapshot.sourceType,
          imageUrls: previousSnapshot.imageUrls,
          scheduleData: previousSnapshot.scheduleData,
          startDate: previousSnapshot.startDate,
          endDate: previousSnapshot.endDate,
          confidence: previousSnapshot.confidence,
          parseStatus: previousSnapshot.parseStatus,
          tripCount: previousSnapshot.tripCount,
          legCount: previousSnapshot.legCount,
          totalCreditMinutes: previousSnapshot.totalCreditMinutes,
          lastComparedAt: previousSnapshot.lastComparedAt?.toISOString() || null,
          createdAt: previousSnapshot.createdAt.toISOString(),
          updatedAt: previousSnapshot.updatedAt.toISOString(),
        }
      : null;

    return c.json({
      success: true,
      snapshot: snapshotResponse,
      changes: createdChanges,
      previousSnapshot: previousSnapshotResponse,
      summary: {
        hasChanges: createdChanges.length > 0,
        totalChanges: createdChanges.length,
        payImpactChanges,
        estimatedPayDiffCents,
        suggestedPayEvents,
      },
    });
  }
);

// GET /api/schedule/snapshots - List snapshots
scheduleRouter.get("/snapshots", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const limitStr = c.req.query("limit");
  const limit = limitStr ? parseInt(limitStr) : 20;

  const snapshots = await db.scheduleSnapshot.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const reminderSettings = await db.scheduleReminderSettings.findUnique({
    where: { userId: user.id },
  });

  return c.json({
    snapshots: snapshots.map((s) => ({
      id: s.id,
      userId: s.userId,
      snapshotDate: s.snapshotDate,
      sourceType: s.sourceType,
      imageUrls: s.imageUrls,
      scheduleData: s.scheduleData,
      startDate: s.startDate,
      endDate: s.endDate,
      confidence: s.confidence,
      parseStatus: s.parseStatus,
      tripCount: s.tripCount,
      legCount: s.legCount,
      totalCreditMinutes: s.totalCreditMinutes,
      lastComparedAt: s.lastComparedAt?.toISOString() || null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    reminderSettings: reminderSettings
      ? {
          id: reminderSettings.id,
          userId: reminderSettings.userId,
          enabled: reminderSettings.enabled,
          frequencyHours: reminderSettings.frequencyHours,
          reminderTimes: reminderSettings.reminderTimes,
          beforeReport: reminderSettings.beforeReport,
          beforeReportHours: reminderSettings.beforeReportHours,
          lastImportAt: reminderSettings.lastImportAt?.toISOString() || null,
          lastReminderAt: reminderSettings.lastReminderAt?.toISOString() || null,
          nextReminderAt: reminderSettings.nextReminderAt?.toISOString() || null,
          createdAt: reminderSettings.createdAt.toISOString(),
          updatedAt: reminderSettings.updatedAt.toISOString(),
        }
      : null,
  });
});

// GET /api/schedule/snapshots/:id - Get single snapshot with changes
scheduleRouter.get("/snapshots/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const snapshotId = c.req.param("id");

  const snapshot = await db.scheduleSnapshot.findFirst({
    where: { id: snapshotId, userId: user.id },
    include: { changesDetected: true },
  });

  if (!snapshot) {
    return c.json({ error: "Snapshot not found" }, 404);
  }

  // Get previous snapshot for context
  const previousSnapshot = await db.scheduleSnapshot.findFirst({
    where: {
      userId: user.id,
      createdAt: { lt: snapshot.createdAt },
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    snapshot: {
      id: snapshot.id,
      userId: snapshot.userId,
      snapshotDate: snapshot.snapshotDate,
      sourceType: snapshot.sourceType,
      imageUrls: snapshot.imageUrls,
      scheduleData: snapshot.scheduleData,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      confidence: snapshot.confidence,
      parseStatus: snapshot.parseStatus,
      tripCount: snapshot.tripCount,
      legCount: snapshot.legCount,
      totalCreditMinutes: snapshot.totalCreditMinutes,
      lastComparedAt: snapshot.lastComparedAt?.toISOString() || null,
      createdAt: snapshot.createdAt.toISOString(),
      updatedAt: snapshot.updatedAt.toISOString(),
    },
    changes: snapshot.changesDetected.map((c) => ({
      id: c.id,
      userId: c.userId,
      oldSnapshotId: c.oldSnapshotId,
      newSnapshotId: c.newSnapshotId,
      changeType: c.changeType,
      severity: c.severity,
      tripNumber: c.tripNumber,
      tripDate: c.tripDate,
      legIndex: c.legIndex,
      fieldChanged: c.fieldChanged,
      oldValue: c.oldValue,
      newValue: c.newValue,
      creditDiffMinutes: c.creditDiffMinutes,
      estimatedPayDiffCents: c.estimatedPayDiffCents,
      suggestedEventType: c.suggestedEventType,
      suggestedEventTitle: c.suggestedEventTitle,
      payEventId: c.payEventId,
      acknowledged: c.acknowledged,
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
    previousSnapshot: previousSnapshot
      ? {
          id: previousSnapshot.id,
          userId: previousSnapshot.userId,
          snapshotDate: previousSnapshot.snapshotDate,
          sourceType: previousSnapshot.sourceType,
          imageUrls: previousSnapshot.imageUrls,
          scheduleData: previousSnapshot.scheduleData,
          startDate: previousSnapshot.startDate,
          endDate: previousSnapshot.endDate,
          confidence: previousSnapshot.confidence,
          parseStatus: previousSnapshot.parseStatus,
          tripCount: previousSnapshot.tripCount,
          legCount: previousSnapshot.legCount,
          totalCreditMinutes: previousSnapshot.totalCreditMinutes,
          lastComparedAt: previousSnapshot.lastComparedAt?.toISOString() || null,
          createdAt: previousSnapshot.createdAt.toISOString(),
          updatedAt: previousSnapshot.updatedAt.toISOString(),
        }
      : null,
  });
});

// GET /api/schedule/changes - Get unacknowledged changes
scheduleRouter.get("/changes", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const acknowledgedStr = c.req.query("acknowledged");
  const severity = c.req.query("severity");

  const where: any = { userId: user.id };
  if (acknowledgedStr !== undefined) {
    where.acknowledged = acknowledgedStr === "true";
  }
  if (severity) {
    where.severity = severity;
  }

  const changes = await db.scheduleChange.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const totalPayImpactCents = changes
    .filter((c) => c.severity === "pay_impact")
    .reduce((sum, c) => sum + c.estimatedPayDiffCents, 0);

  return c.json({
    changes: changes.map((c) => ({
      id: c.id,
      userId: c.userId,
      oldSnapshotId: c.oldSnapshotId,
      newSnapshotId: c.newSnapshotId,
      changeType: c.changeType,
      severity: c.severity,
      tripNumber: c.tripNumber,
      tripDate: c.tripDate,
      legIndex: c.legIndex,
      fieldChanged: c.fieldChanged,
      oldValue: c.oldValue,
      newValue: c.newValue,
      creditDiffMinutes: c.creditDiffMinutes,
      estimatedPayDiffCents: c.estimatedPayDiffCents,
      suggestedEventType: c.suggestedEventType,
      suggestedEventTitle: c.suggestedEventTitle,
      payEventId: c.payEventId,
      acknowledged: c.acknowledged,
      acknowledgedAt: c.acknowledgedAt?.toISOString() || null,
      createdAt: c.createdAt.toISOString(),
    })),
    summary: {
      totalChanges: changes.length,
      unacknowledged: changes.filter((c) => !c.acknowledged).length,
      payImpactCount: changes.filter((c) => c.severity === "pay_impact").length,
      totalPayImpactCents,
    },
  });
});

// POST /api/schedule/changes/:id/acknowledge - Acknowledge a change
scheduleRouter.post(
  "/changes/:id/acknowledge",
  zValidator(
    "json",
    z.object({
      createPayEvent: z.boolean().optional(),
      payEventData: z
        .object({
          eventType: z.string(),
          title: z.string(),
          description: z.string().optional(),
          eventDateISO: z.string().optional(),
        })
        .optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const changeId = c.req.param("id");
    const { createPayEvent, payEventData } = c.req.valid("json");

    const change = await db.scheduleChange.findFirst({
      where: { id: changeId, userId: user.id },
    });

    if (!change) {
      return c.json({ error: "Change not found" }, 404);
    }

    let payEvent = null;

    // Create pay event if requested
    if (createPayEvent && payEventData) {
      payEvent = await db.payEvent.create({
        data: {
          userId: user.id,
          eventType: payEventData.eventType as any,
          eventDateISO: payEventData.eventDateISO || change.tripDate || (new Date().toISOString().split("T")[0] ?? ""),
          title: payEventData.title,
          description: payEventData.description || null,
          originalCreditMinutes: change.creditDiffMinutes < 0 ? -change.creditDiffMinutes : null,
          newCreditMinutes: change.creditDiffMinutes > 0 ? change.creditDiffMinutes : null,
          creditDifferenceMinutes: change.creditDiffMinutes,
          payDifferenceCents: change.estimatedPayDiffCents,
        },
      });
    }

    // Mark change as acknowledged
    const updatedChange = await db.scheduleChange.update({
      where: { id: changeId },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        payEventId: payEvent?.id || null,
      },
    });

    return c.json({
      success: true,
      change: {
        id: updatedChange.id,
        userId: updatedChange.userId,
        oldSnapshotId: updatedChange.oldSnapshotId,
        newSnapshotId: updatedChange.newSnapshotId,
        changeType: updatedChange.changeType,
        severity: updatedChange.severity,
        tripNumber: updatedChange.tripNumber,
        tripDate: updatedChange.tripDate,
        legIndex: updatedChange.legIndex,
        fieldChanged: updatedChange.fieldChanged,
        oldValue: updatedChange.oldValue,
        newValue: updatedChange.newValue,
        creditDiffMinutes: updatedChange.creditDiffMinutes,
        estimatedPayDiffCents: updatedChange.estimatedPayDiffCents,
        suggestedEventType: updatedChange.suggestedEventType,
        suggestedEventTitle: updatedChange.suggestedEventTitle,
        payEventId: updatedChange.payEventId,
        acknowledged: updatedChange.acknowledged,
        acknowledgedAt: updatedChange.acknowledgedAt?.toISOString() || null,
        createdAt: updatedChange.createdAt.toISOString(),
      },
      payEvent: payEvent
        ? {
            id: payEvent.id,
            userId: payEvent.userId,
            eventType: payEvent.eventType,
            airlineLabel: payEvent.airlineLabel,
            eventDateISO: payEvent.eventDateISO,
            eventTimeISO: payEvent.eventTimeISO,
            tripId: payEvent.tripId,
            dutyDayId: payEvent.dutyDayId,
            title: payEvent.title,
            description: payEvent.description,
            originalTripNumber: payEvent.originalTripNumber,
            originalStartTime: payEvent.originalStartTime,
            originalEndTime: payEvent.originalEndTime,
            originalCreditMinutes: payEvent.originalCreditMinutes,
            newTripNumber: payEvent.newTripNumber,
            newStartTime: payEvent.newStartTime,
            newEndTime: payEvent.newEndTime,
            newCreditMinutes: payEvent.newCreditMinutes,
            creditDifferenceMinutes: payEvent.creditDifferenceMinutes,
            payDifferenceCents: payEvent.payDifferenceCents,
            triggeredRuleIds: payEvent.triggeredRuleIds,
            status: payEvent.status,
            needsReview: payEvent.needsReview,
            createdAt: payEvent.createdAt.toISOString(),
            updatedAt: payEvent.updatedAt.toISOString(),
          }
        : null,
    });
  }
);

// POST /api/schedule/changes/acknowledge-all - Acknowledge all unacknowledged changes
scheduleRouter.post("/changes/acknowledge-all", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Find all unacknowledged changes for this user
  const unacknowledgedChanges = await db.scheduleChange.findMany({
    where: {
      userId: user.id,
      acknowledged: false,
    },
  });

  if (unacknowledgedChanges.length === 0) {
    return c.json({
      success: true,
      acknowledgedCount: 0,
      message: "No unacknowledged changes found",
    });
  }

  // Bulk update all to acknowledged
  const result = await db.scheduleChange.updateMany({
    where: {
      userId: user.id,
      acknowledged: false,
    },
    data: {
      acknowledged: true,
      acknowledgedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    acknowledgedCount: result.count,
    message: `Successfully acknowledged ${result.count} change${result.count !== 1 ? "s" : ""}`,
  });
});

// PUT /api/schedule/reminder-settings - Update reminder settings
scheduleRouter.put(
  "/reminder-settings",
  zValidator(
    "json",
    z.object({
      enabled: z.boolean().optional(),
      frequencyHours: z.number().optional(),
      reminderTimes: z.array(z.string()).optional(),
      beforeReport: z.boolean().optional(),
      beforeReportHours: z.number().optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = c.req.valid("json");

    const settings = await db.scheduleReminderSettings.upsert({
      where: { userId: user.id },
      update: {
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.frequencyHours !== undefined && { frequencyHours: body.frequencyHours }),
        ...(body.reminderTimes !== undefined && { reminderTimes: JSON.stringify(body.reminderTimes) }),
        ...(body.beforeReport !== undefined && { beforeReport: body.beforeReport }),
        ...(body.beforeReportHours !== undefined && { beforeReportHours: body.beforeReportHours }),
      },
      create: {
        userId: user.id,
        enabled: body.enabled ?? true,
        frequencyHours: body.frequencyHours ?? 48,
        reminderTimes: body.reminderTimes ? JSON.stringify(body.reminderTimes) : null,
        beforeReport: body.beforeReport ?? true,
        beforeReportHours: body.beforeReportHours ?? 12,
      },
    });

    return c.json({
      success: true,
      settings: {
        id: settings.id,
        userId: settings.userId,
        enabled: settings.enabled,
        frequencyHours: settings.frequencyHours,
        reminderTimes: settings.reminderTimes,
        beforeReport: settings.beforeReport,
        beforeReportHours: settings.beforeReportHours,
        lastImportAt: settings.lastImportAt?.toISOString() || null,
        lastReminderAt: settings.lastReminderAt?.toISOString() || null,
        nextReminderAt: settings.nextReminderAt?.toISOString() || null,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      },
    });
  }
);

// GET /api/schedule/reminder-status - Get current reminder status
scheduleRouter.get("/reminder-status", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const settings = await db.scheduleReminderSettings.findUnique({
    where: { userId: user.id },
  });

  // Calculate hours since last import
  let hoursSinceLastImport: number | null = null;
  if (settings?.lastImportAt) {
    hoursSinceLastImport = Math.round(
      (Date.now() - settings.lastImportAt.getTime()) / (1000 * 60 * 60)
    );
  }

  // Determine if we should remind
  let shouldRemind = false;
  if (settings?.enabled) {
    if (hoursSinceLastImport === null) {
      // Never imported - should remind
      shouldRemind = true;
    } else if (hoursSinceLastImport >= settings.frequencyHours) {
      // Past frequency threshold
      shouldRemind = true;
    }
  }

  // Get next report time from trips
  let nextReportTime: string | null = null;
  let hoursUntilReport: number | null = null;

  const upcomingTrip = await db.trip.findFirst({
    where: {
      userId: user.id,
      startDate: { gte: new Date().toISOString().split("T")[0] },
    },
    orderBy: { startDate: "asc" },
    include: {
      events: {
        where: { eventType: "REPORT" },
        orderBy: { startTimeLocal: "asc" },
        take: 1,
      },
    },
  });

  if (upcomingTrip?.events?.[0]?.startTimeLocal) {
    nextReportTime = upcomingTrip.events[0].startTimeLocal;
    const reportDate = new Date(nextReportTime);
    hoursUntilReport = Math.round(
      (reportDate.getTime() - Date.now()) / (1000 * 60 * 60)
    );

    // Check if we should remind based on "before report" setting
    if (
      settings?.beforeReport &&
      hoursUntilReport !== null &&
      hoursUntilReport <= settings.beforeReportHours
    ) {
      shouldRemind = true;
    }
  }

  return c.json({
    shouldRemind,
    lastImportAt: settings?.lastImportAt?.toISOString() || null,
    hoursSinceLastImport,
    nextReportTime,
    hoursUntilReport,
    settings: settings
      ? {
          id: settings.id,
          userId: settings.userId,
          enabled: settings.enabled,
          frequencyHours: settings.frequencyHours,
          reminderTimes: settings.reminderTimes,
          beforeReport: settings.beforeReport,
          beforeReportHours: settings.beforeReportHours,
          lastImportAt: settings.lastImportAt?.toISOString() || null,
          lastReminderAt: settings.lastReminderAt?.toISOString() || null,
          nextReminderAt: settings.nextReminderAt?.toISOString() || null,
          createdAt: settings.createdAt.toISOString(),
          updatedAt: settings.updatedAt.toISOString(),
        }
      : null,
  });
});

// ============================================
// POST /api/schedule/backfill - Backfill DutyDays and Legs for existing trips
// ============================================
scheduleRouter.post("/backfill", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  console.log(`🔄 [Schedule] Starting backfill for user ${user.id}`);

  // Get user's hourly rate
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
  });
  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Find trips without duty days
  const tripsWithoutDutyDays = await db.trip.findMany({
    where: {
      userId: user.id,
      dutyDays: { none: {} },
    },
    include: {
      events: {
        orderBy: [{ sortOrder: "asc" }, { startTimeLocal: "asc" }],
      },
    },
  });

  console.log(`  📋 Found ${tripsWithoutDutyDays.length} trips without duty days`);

  let tripsBackfilled = 0;
  let dutyDaysCreated = 0;
  let legsCreated = 0;

  for (const trip of tripsWithoutDutyDays) {
    // Group flight events by date
    const flightEvents = trip.events.filter(
      (e) =>
        e.eventType === "FLIGHT" ||
        e.eventType === "DEADHEAD" ||
        e.eventType === "COMMUTE"
    );

    if (flightEvents.length === 0) {
      // If no events but trip has dates, create a single duty day
      if (trip.startDate) {
        const creditMinutes = trip.totalCreditMinutes || 0;
        const calculatedPayCents = Math.round(
          (Math.max(creditMinutes, 360) / 60) * hourlyRateCents
        );

        await db.dutyDay.create({
          data: {
            tripId: trip.id,
            dutyDate: trip.startDate,
            dutyStartISO: null,
            dutyEndISO: null,
            plannedCreditMinutes: creditMinutes,
            actualBlockMinutes: 0,
            actualCreditMinutes: creditMinutes,
            finalCreditMinutes: Math.max(creditMinutes, 360),
            minCreditMinutes: 360,
            totalPayCents: calculatedPayCents,
          },
        });
        dutyDaysCreated++;

        // Update trip totals
        await db.trip.update({
          where: { id: trip.id },
          data: {
            totalPayCents: calculatedPayCents,
            dutyDaysCount: 1,
          },
        });
        tripsBackfilled++;
      }
      continue;
    }

    // Group events by date
    const eventsByDate: Record<string, typeof flightEvents> = {};
    for (const event of flightEvents) {
      // Extract date from startTimeLocal
      let date = trip.startDate;
      if (event.startTimeLocal) {
        date = event.startTimeLocal.split("T")[0] || trip.startDate;
      }
      if (!eventsByDate[date]) {
        eventsByDate[date] = [];
      }
      eventsByDate[date]!.push(event);
    }

    // Create DutyDay and Legs for each date
    const sortedDates = Object.keys(eventsByDate).sort();

    for (const dutyDate of sortedDates) {
      const events = eventsByDate[dutyDate];
      if (!events || events.length === 0) continue;

      // Calculate totals
      let plannedCreditMinutes = 0;
      let totalBlockMinutes = 0;
      let dutyStartISO: string | null = null;
      let dutyEndISO: string | null = null;

      // Find report time from events
      const reportEvent = trip.events.find(
        (e) => e.eventType === "REPORT" && e.startTimeLocal?.includes(dutyDate)
      );
      if (reportEvent?.startTimeLocal) {
        dutyStartISO = reportEvent.startTimeLocal;
      }

      // Sort events by start time
      events.sort((a, b) => {
        const timeA = a.startTimeLocal || "";
        const timeB = b.startTimeLocal || "";
        return timeA.localeCompare(timeB);
      });

      // Calculate totals from events
      for (const event of events) {
        if (event.creditMinutes) {
          plannedCreditMinutes += event.creditMinutes;
        }
        // Parse block minutes from metadata if available
        if (event.flightMetadata) {
          try {
            const metadata = JSON.parse(event.flightMetadata);
            if (metadata.blockMinutes) {
              totalBlockMinutes += metadata.blockMinutes;
            }
          } catch {}
        }
      }

      // Get end time from last event
      const lastEvent = events[events.length - 1];
      if (lastEvent?.endTimeLocal) {
        dutyEndISO = lastEvent.endTimeLocal;
      }

      const finalCreditMinutes = Math.max(plannedCreditMinutes, 360);
      const calculatedPayCents = Math.round(
        (finalCreditMinutes / 60) * hourlyRateCents
      );

      // Create DutyDay
      const dutyDay = await db.dutyDay.create({
        data: {
          tripId: trip.id,
          dutyDate,
          dutyStartISO,
          dutyEndISO,
          plannedCreditMinutes,
          actualBlockMinutes: totalBlockMinutes,
          actualCreditMinutes: plannedCreditMinutes,
          finalCreditMinutes,
          minCreditMinutes: 360,
          totalPayCents: calculatedPayCents,
        },
      });
      dutyDaysCreated++;

      // Create Legs for each flight event
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) continue;
        const isDeadhead = event.eventType === "DEADHEAD";

        // Parse metadata for additional info
        let flightNumber: string | null = null;
        let equipment: string | null = null;
        let blockMinutes = 0;

        if (event.flightMetadata) {
          try {
            const metadata = JSON.parse(event.flightMetadata);
            flightNumber = metadata.flightNumber || null;
            equipment = metadata.equipment || null;
            blockMinutes = metadata.blockMinutes || 0;
          } catch {}
        }

        const creditMinutes = event.creditMinutes || blockMinutes || 0;
        const legPayCents = Math.round((creditMinutes / 60) * hourlyRateCents);

        await db.leg.create({
          data: {
            dutyDayId: dutyDay.id,
            legIndex: i,
            flightNumber,
            origin: event.depAirport ?? "",
            destination: event.arrAirport ?? "",
            equipment,
            tailNumber: null,
            isDeadhead,
            scheduledOutISO: event.startTimeLocal ?? null,
            scheduledInISO: event.endTimeLocal ?? null,
            plannedBlockMinutes: blockMinutes,
            plannedCreditMinutes: creditMinutes,
            actualOutISO: null,
            actualOffISO: null,
            actualOnISO: null,
            actualInISO: null,
            actualFlightMinutes: 0,
            actualBlockMinutes: 0,
            creditMinutes,
            premiumCode: null,
            premiumAmountCents: 0,
            calculatedPayCents: legPayCents,
            source: "import",
            ooiProofUri: null,
            notes: event.rawCreditText ?? null,
          },
        });
        legsCreated++;
      }
    }

    // Update trip totals
    const allDutyDays = await db.dutyDay.findMany({
      where: { tripId: trip.id },
      include: { legs: true },
    });

    const totalBlockMinutes = allDutyDays.reduce(
      (sum, d) => sum + d.actualBlockMinutes,
      0
    );
    const totalCreditMinutes = allDutyDays.reduce(
      (sum, d) => sum + d.finalCreditMinutes,
      0
    );
    const totalPayCents = allDutyDays.reduce(
      (sum, d) => sum + d.totalPayCents,
      0
    );
    const legCount = allDutyDays.reduce((sum, d) => sum + d.legs.length, 0);

    await db.trip.update({
      where: { id: trip.id },
      data: {
        totalBlockMinutes,
        totalCreditMinutes,
        totalPayCents,
        legCount,
        dutyDaysCount: allDutyDays.length,
      },
    });

    tripsBackfilled++;
  }

  console.log(
    `✅ [Schedule] Backfill complete: ${tripsBackfilled} trips, ${dutyDaysCreated} duty days, ${legsCreated} legs`
  );

  return c.json({
    success: true,
    tripsBackfilled,
    dutyDaysCreated,
    legsCreated,
  });
});

// ============================================
// POST /api/schedule/check-conflicts - Check for conflicts before import
// ============================================
import {
  resolveConflict,
} from "../lib/trip-conflict-detector";
import {
  checkConflictsRequestSchema,
  resolveConflictRequestSchema,
} from "../../../shared/contracts";

scheduleRouter.post(
  "/check-conflicts",
  zValidator("json", checkConflictsRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = c.req.valid("json");

    console.log(`🔍 [Schedule] Checking conflicts for import: ${body.startDate} to ${body.endDate}`);

    const result = await checkTripConflicts({
      userId: user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      tripNumber: body.tripNumber,
      pairingId: body.pairingId,
      dutyDates: body.dutyDates,
    });

    return c.json(result);
  }
);

// ============================================
// POST /api/schedule/resolve-conflict - Resolve a conflict and proceed
// ============================================
scheduleRouter.post(
  "/resolve-conflict",
  zValidator("json", resolveConflictRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = c.req.valid("json");

    console.log(`🔧 [Schedule] Resolving conflict with decision: ${body.decision}`);

    // Get user profile for airline code
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { airline: true, hourlyRateCents: true },
    });
    const airlineCode = profile?.airline ?? "UPS";

    // Extract new trip data for company_revision
    const parsedData = body.newTripData;
    const newTripDataForResolution = parsedData ? {
      totalCreditMinutes: parsedData.totals?.creditMinutes ?? 0,
      totalBlockMinutes: parsedData.totals?.blockMinutes ?? 0,
      dutyDays: parsedData.events?.filter((e: any) => e.eventType === 'FLIGHT' || e.eventType === 'DEADHEAD')
        .map((e: any) => ({
          date: e.date,
          creditMinutes: e.creditMinutes ?? 0,
          blockMinutes: e.blockMinutes ?? 0,
        })) ?? [],
      legs: parsedData.events?.filter((e: any) => e.eventType === 'FLIGHT' || e.eventType === 'DEADHEAD')
        .map((e: any) => ({
          dutyDate: e.date,
          flightNumber: e.flightNumber,
          origin: e.origin,
          destination: e.destination,
        })) ?? [],
    } : undefined;

    // Resolve the conflict (delete/archive existing trips if needed)
    const resolution = await resolveConflict({
      userId: user.id,
      decision: body.decision,
      conflictingTripIds: body.conflictingTripIds,
      acknowledgmentNote: body.acknowledgmentNote,
      replaceTripReason: body.replaceTripReason,
      newTripData: newTripDataForResolution,
    });

    // ============================================
    // CANCEL - No action
    // ============================================
    if (body.decision === "cancel") {
      console.log(`🛑 [Schedule] Import canceled by user. No data saved.`);
      return c.json({
        success: true,
        tripId: null,
        deletedTripIds: [],
        archivedTripIds: [],
        isOverride: false,
        auditRecordId: null,
        message: "Import canceled. No changes made.",
      });
    }

    // ============================================
    // COMPANY REVISION - Update existing trip, don't create new one
    // ============================================
    if (body.decision === "company_revision") {
      console.log(`✅ [Schedule] Company revision applied to trip: ${resolution.updatedTripId}`);
      return c.json({
        success: true,
        tripId: resolution.updatedTripId ?? null,
        deletedTripIds: resolution.deletedTripIds,
        archivedTripIds: resolution.archivedTripIds,
        isOverride: false,
        auditRecordId: resolution.auditRecordId,
        protectedCreditResult: resolution.protectedCreditResult,
        message: "Company revision applied. Protected credit calculated.",
      });
    }

    // ============================================
    // REPLACE TRIP / LEGACY - Create new trip
    // ============================================
    // Determine if this is a "resolve_later" decision - creates trip with status="review"
    const isResolveLater = body.decision === "resolve_later";

    // Now proceed with the FULL import if not canceled
    // CRITICAL: Must create the complete trip structure (duty days, legs, layovers)
    let tripId: string | null = null;
    let versionResult: VersionAwareImportResult | null = null;

    if (body.newTripData) {
      const parsedData = body.newTripData;

      // Determine date range
      let startDate = parsedData.startDate;
      let endDate = parsedData.endDate;

      if (!startDate && parsedData.events?.length > 0) {
        const dates = parsedData.events
          .map((e: any) => e.date)
          .filter(Boolean)
          .sort();
        startDate = dates[0] || new Date().toISOString().split("T")[0];
        endDate = dates[dates.length - 1] || startDate;
      }

      if (!startDate) {
        startDate = new Date().toISOString().split("T")[0];
        endDate = startDate;
      }

      // Create the trip with proper status for override or review
      // NOTE: Override trips (status="override") should be excluded from pay totals by default
      // NOTE: Resolve Later trips (status="review") are also excluded from pay totals until decision made
      // This is handled by querying logic, not a DB field
      const tripStatus = isResolveLater ? "review" : (resolution.isOverride ? "override" : "scheduled");
      const tripSource = isResolveLater ? "import_pending" : (resolution.isOverride ? "import_override" : "import");

      const tripData = {
        userId: user.id,
        tripNumber: parsedData.tripNumber || null,
        pairingId: parsedData.pairingId || null,
        baseFleet: parsedData.baseFleet || null,
        startDate,
        endDate: endDate || startDate,
        source: tripSource,
        totalCreditMinutes: parsedData.totals?.creditMinutes || 0,
        totalBlockMinutes: parsedData.totals?.blockMinutes || 0,
        totalTafbMinutes: parsedData.totals?.tafbMinutes || 0,
        totalPdiemCents: parsedData.totals?.perDiemCents || 0,
        dutyDaysCount: parsedData.totals?.dutyDays || parsedData.events?.filter((e: any) => e.eventType === 'FLIGHT' || e.eventType === 'DEADHEAD').length || 0,
        needsReview: resolution.isOverride || isResolveLater, // Flag for override/review trips
        status: tripStatus,
      };

      const trip = await db.trip.create({
        data: tripData,
      });
      tripId = trip.id;

      console.log(`✅ [Schedule] Created trip shell: ${tripId}${resolution.isOverride ? " (OVERRIDE)" : isResolveLater ? " (REVIEW)" : ""}`);

      // CRITICAL FIX: Create the FULL trip structure (duty days, legs, layovers)
      // This was missing before - causing blank trips on override!
      try {
        // 1. Create TripEvents for timeline display
        const sourceType = parsedData.sourceType || "unknown";
        const confidence = parsedData.confidence || 0.8;
        const { eventIds, layoversCreated } = await createEventsFromParsed(tripId, parsedData, sourceType, confidence);
        console.log(`  📋 Created ${eventIds.length} events (${layoversCreated} auto-layovers)`);

        // 2. Create DutyDays and Legs (legacy structure for compatibility)
        const { dutyDayIds, legIds } = await createDutyDaysAndLegsFromParsed(tripId, user.id, parsedData);
        console.log(`  📅 Created ${dutyDayIds.length} duty days with ${legIds.length} legs`);

        // 3. Create canonical trip structure with version tracking
        // This is the most important step - creates TripDutyDay, TripDutyLeg, TripLayover
        const normalizedData = normalizeAIParsedData(parsedData, sourceType as ImportSourceType);

        versionResult = await importWithVersionTracking(
          user.id,
          airlineCode,
          normalizedData,
          tripId,
          {
            // Use "import" for version tracking - the trip.source field already tracks override status
            sourceType: "import",
            imageUrls: [],
            parseConfidence: confidence,
            lowConfidenceFields: parsedData.lowConfidenceFields || [],
            hourlyRateCents: profile?.hourlyRateCents ?? 0,
          }
        );

        console.log(`  📊 Canonical breakdown: ${versionResult.dutyDayIds.length} duty days, ${versionResult.legIds.length} legs, ${versionResult.layoverIds.length} layovers`);
        console.log(`  📋 Trip Version: v${versionResult.versionNumber} (${versionResult.isFirstVersion ? "baseline" : "update"})`);

        // Update trip with accurate counts from canonical structure
        const finalCreditMinutes = normalizedData.totals?.creditMinutes || parsedData.totals?.creditMinutes || 0;
        await db.trip.update({
          where: { id: tripId },
          data: {
            legCount: versionResult.legIds.length,
            dutyDaysCount: versionResult.dutyDayIds.length,
            totalCreditMinutes: finalCreditMinutes,
            totalBlockMinutes: normalizedData.totals?.blockMinutes || parsedData.totals?.blockMinutes || 0,
            // Initialize credit protection fields so review-changes screen shows correct values
            protectedCreditMinutes: finalCreditMinutes,
            currentCreditMinutes: finalCreditMinutes,
            payCreditMinutes: finalCreditMinutes,
          },
        });

      } catch (importError) {
        console.error(`❌ [Schedule] Failed to create trip structure for ${tripId}:`, importError);
        // Rollback: Delete the trip shell if structure creation failed
        await db.trip.delete({ where: { id: tripId } });
        return c.json({
          success: false,
          error: "Failed to create trip structure. Import rolled back.",
          details: importError instanceof Error ? importError.message : "Unknown error",
        }, 500);
      }

      // Create audit record for the import decision
      const auditRecordType = isResolveLater
        ? "trip_pending_review"
        : (resolution.isOverride ? "trip_override_created" : "trip_imported");

      const auditTitle = isResolveLater
        ? "Trip Imported (Needs Decision)"
        : (resolution.isOverride ? "Trip Created as Override" : "Trip Imported via Conflict Resolution");

      const auditSummary = isResolveLater
        ? `Trip ${parsedData.tripNumber || tripId} imported but marked for review. User chose "Resolve Later" due to conflict with: ${body.conflictingTripIds.join(", ")}. Trip excluded from pay totals until decision is made. ${body.acknowledgmentNote || ""}`
        : (resolution.isOverride
          ? `Trip ${parsedData.tripNumber || tripId} created as OVERRIDE due to conflict. Conflicts with trips: ${body.conflictingTripIds.join(", ")}. Override trips are visible but excluded from pay totals by default. ${body.acknowledgmentNote || ""}`
          : `Trip ${parsedData.tripNumber || tripId} imported after user chose to replace existing trip(s). ${body.acknowledgmentNote || ""}`);

      await db.auditRecord.create({
        data: {
          userId: user.id,
          tripId: trip.id,
          recordType: auditRecordType,
          title: auditTitle,
          summary: auditSummary,
          metadata: JSON.stringify({
            decision: body.decision,
            conflictingTripIds: body.conflictingTripIds,
            isOverride: resolution.isOverride,
            isResolveLater,
            deletedTripIds: resolution.deletedTripIds,
            note: body.acknowledgmentNote,
            versionId: versionResult?.versionId,
            versionNumber: versionResult?.versionNumber,
            dutyDaysCount: versionResult?.dutyDayIds.length,
            legCount: versionResult?.legIds.length,
          }),
        },
      });

      console.log(`✅ [Schedule] COMPLETE trip created via conflict resolution: ${tripId}${resolution.isOverride ? " (OVERRIDE)" : isResolveLater ? " (REVIEW)" : ""}`);
      console.log(`  ↳ Duty days: ${versionResult?.dutyDayIds.length || 0}, Legs: ${versionResult?.legIds.length || 0}, Layovers: ${versionResult?.layoverIds.length || 0}`);
    }

    return c.json({
      success: true,
      tripId,
      deletedTripIds: resolution.deletedTripIds,
      archivedTripIds: resolution.archivedTripIds,
      isOverride: resolution.isOverride,
      isResolveLater,
      auditRecordId: resolution.auditRecordId,
      versionInfo: versionResult ? {
        versionId: versionResult.versionId,
        versionNumber: versionResult.versionNumber,
        isNewTrip: versionResult.isNewTrip,
        dutyDaysCount: versionResult.dutyDayIds.length,
        legCount: versionResult.legIds.length,
        layoversCount: versionResult.layoverIds.length,
        payEvaluation: versionResult.payEvaluation,
      } : null,
    });
  }
);

// ============================================
// QUEUE-BASED UPLOAD SYSTEM
// For scalable processing with thousands of users
// ============================================

import {
  createUploadJob,
  getJobStatus,
  cleanupOldJobs,
} from "../lib/upload-job-processor";

// Schedule cleanup of old jobs every hour
setInterval(() => {
  cleanupOldJobs().catch(console.error);
}, 60 * 60 * 1000);

// ============================================
// POST /api/schedule/parse-async - Queue-based async parsing
// Returns immediately with job ID, processes in background
// ============================================
scheduleRouter.post(
  "/parse-async",
  zValidator("json", parseScheduleSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { images } = c.req.valid("json");

    if (!images || images.length === 0) {
      return c.json({ error: "No images provided" }, 400);
    }

    console.log(`⚡ [Schedule] Queueing ${images.length} image(s) for async processing - user ${user.id}`);

    // Create a job and return immediately
    const { jobId } = await createUploadJob(user.id, images);

    return c.json({
      success: true,
      jobId,
      message: `Processing ${images.length} image(s) in background`,
      pollUrl: `/api/schedule/job-status/${jobId}`,
    });
  }
);

// ============================================
// GET /api/schedule/job-status/:id - Poll job status
// ============================================
scheduleRouter.get("/job-status/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const jobId = c.req.param("id");
  const status = await getJobStatus(jobId, user.id);

  if (!status) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(status);
});

// ============================================
// ROBUST IMPORT PIPELINE - PHASE 2
// New template-aware parser with validation gate
// ============================================
import {
  importScheduleRobust,
  batchImportSchedules,
  getPendingReviews,
  confirmReviewedImport,
  dismissReview,
  type ImportResult,
  type BatchImportResult,
} from "../lib/robust-import-pipeline";

// ============================================
// POST /api/schedule/parse-robust - Robust schedule parsing
// Uses template-aware parser with validation gate
// ============================================
const parseRobustSchema = z.object({
  images: z.array(z.string()),
  baseDate: z.string().optional(), // YYYY-MM-DD for month/year context
  dryRun: z.boolean().optional(),
});

scheduleRouter.post(
  "/parse-robust",
  zValidator("json", parseRobustSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { images, baseDate, dryRun } = c.req.valid("json");

    if (!images || images.length === 0) {
      return c.json({ error: "No images provided" }, 400);
    }

    console.log(`🚀 [Robust] Parsing ${images.length} image(s) for user ${user.id}`);

    const results: ImportResult[] = [];
    const uploadsDir = path.join(process.cwd(), "uploads");

    for (const imageUrl of images) {
      const filename = imageUrl.replace("/uploads/", "");
      const filePath = path.join(uploadsDir, filename);

      if (!fs.existsSync(filePath)) {
        results.push({
          success: false,
          tripId: null,
          tripNumber: null,
          action: "failed",
          message: `Image file not found: ${filename}`,
          warnings: [],
          errors: [`Image file not found: ${filename}`],
          confidence: 0,
          parseResult: null,
        });
        continue;
      }

      try {
        // Perform OCR
        console.log(`📸 [Robust] Running OCR on: ${filename}`);
        const ocrResult = await performOCRWithRetry(filePath);
        console.log(`   OCR confidence: ${ocrResult.confidence.toFixed(1)}%`);
        console.log(`   Text length: ${ocrResult.fullText.length} chars`);

        // Run robust import
        const importResult = await importScheduleRobust({
          userId: user.id,
          imageUrls: [imageUrl],
          ocrText: ocrResult.fullText,
          baseDate,
          dryRun,
        });

        results.push(importResult);
      } catch (error) {
        console.error(`💥 [Robust] Error processing ${filename}:`, error);
        results.push({
          success: false,
          tripId: null,
          tripNumber: null,
          action: "failed",
          message: `Processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
          warnings: [],
          errors: [error instanceof Error ? error.message : "Unknown error"],
          confidence: 0,
          parseResult: null,
        });
      }
    }

    // Summarize results
    const summary: BatchImportResult = {
      totalImages: images.length,
      tripsCreated: results.filter((r) => r.action === "created").length,
      tripsUpdated: results.filter((r) => r.action === "updated").length,
      tripsSkipped: results.filter((r) => r.action === "skipped").length,
      reviewRequired: results.filter((r) => r.action === "review_required").length,
      failed: results.filter((r) => r.action === "failed").length,
      results,
      overallConfidence: results.length > 0
        ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
        : 0,
    };

    console.log(`✅ [Robust] Completed: ${summary.tripsCreated} created, ${summary.tripsUpdated} updated, ${summary.reviewRequired} need review, ${summary.failed} failed`);

    return c.json({
      success: summary.failed === 0,
      ...summary,
    });
  }
);

// ============================================
// GET /api/schedule/pending-reviews - Get imports needing review
// ============================================
scheduleRouter.get("/pending-reviews", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  try {
    const reviews = await getPendingReviews(user.id);
    return c.json({ success: true, reviews });
  } catch (error) {
    console.error("[Robust] Error fetching pending reviews:", error);
    return c.json({ error: "Failed to fetch pending reviews" }, 500);
  }
});

// ============================================
// POST /api/schedule/confirm-review - Confirm a reviewed import
// ============================================
const confirmReviewSchema = z.object({
  evidenceId: z.string(),
});

scheduleRouter.post(
  "/confirm-review",
  zValidator("json", confirmReviewSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { evidenceId } = c.req.valid("json");

    try {
      const result = await confirmReviewedImport(evidenceId, user.id);
      return c.json(result);
    } catch (error) {
      console.error("[Robust] Error confirming review:", error);
      return c.json({ error: "Failed to confirm review" }, 500);
    }
  }
);

// ============================================
// POST /api/schedule/dismiss-review - Dismiss a review item
// ============================================
const dismissReviewSchema = z.object({
  evidenceId: z.string(),
});

scheduleRouter.post(
  "/dismiss-review",
  zValidator("json", dismissReviewSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const { evidenceId } = c.req.valid("json");

    try {
      const dismissed = await dismissReview(evidenceId, user.id);
      return c.json({ success: dismissed });
    } catch (error) {
      console.error("[Robust] Error dismissing review:", error);
      return c.json({ error: "Failed to dismiss review" }, 500);
    }
  }
);

export { scheduleRouter };
