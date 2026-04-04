/**
 * Robust Schedule Import Pipeline
 *
 * Template-aware parser for UPS pilot schedule screenshots.
 * Supports three primary formats:
 * 1. Crew Access "Trip Information" - light blue table with LOCAL times
 * 2. Trip Board Browser (Dark) - dark theme with Report at...
 * 3. Trip Board Trip Details - white table modal view
 *
 * KEY PRINCIPLES:
 * - LOCAL times are authoritative (never convert Crew Access LT columns)
 * - Block time must never be 0:00 when dep/arr times exist
 * - Validation gate prevents silent failures
 * - Low-confidence imports go to Review UI
 */

import {
  computeBlockMinutes,
  formatMinutesAsDuration,
  parseDurationToMinutes,
  parseTimeToMinutes,
  isValidAirportCode,
} from "./airport-timezones";

// ============================================
// TYPE DEFINITIONS
// ============================================

export type TemplateType =
  | "crew_access_trip_info"
  | "trip_board_browser"
  | "trip_board_trip_details"
  | "unknown";

export interface TemplateDetectionResult {
  templateType: TemplateType;
  confidence: number; // 0-1
  matchedKeywords: string[];
  warnings: string[];
}

export interface ParsedLeg {
  legSeq: number;
  flightNumber: string | null;
  position: string | null; // CPT, FO, etc.
  dhFlag: boolean;
  equipment: string | null;
  depAirport: string;
  arrAirport: string;
  depLocalTime: string; // HH:MM (LOCAL)
  arrLocalTime: string; // HH:MM (LOCAL)
  depDisplayTime: string; // HH:MM for display
  arrDisplayTime: string; // HH:MM for display
  blockMinutes: number;
  blockSource: "parsed" | "computed";
  rawRowText: string | null;
  confidence: number; // 0-1
  needsReview: boolean;
  warnings: string[];
}

export interface ParsedLayover {
  layoverStation: string;
  layoverMinutes: number;
  restMinutes: number | null; // From Crew Access "Rest:" line
  hotelName: string | null;
  hotelPhone: string | null;
  hotelStatus: string | null; // "BOOKED", "PENDING", etc.
  hotelTransport: string | null;
  confidence: number;
  needsReview: boolean;
}

export interface ParsedDutyDay {
  dutyDayIndex: number;
  calendarDate: string; // YYYY-MM-DD
  dayLabel: string; // "Fri Jan 30"
  dutyStartLocalTime: string | null; // HH:MM
  dutyEndLocalTime: string | null; // HH:MM
  dayBlockMinutes: number;
  dayCreditMinutes: number;
  dayDutyMinutes: number | null;
  legs: ParsedLeg[];
  layoverToNextDay: ParsedLayover | null;
  confidence: number;
  needsReview: boolean;
  warnings: string[];
}

export interface ParsedTripTotals {
  creditMinutes: number;
  blockMinutes: number;
  tafbMinutes: number;
  dutyMinutes: number; // AUTHORITATIVE: From Crew Access "Duty Time:" row
  perDiemCents: number | null;
  dutyDaysCount: number; // AUTHORITATIVE: Trip Days from Crew Access
  tripDaysCount: number; // AUTHORITATIVE: Calendar days the trip spans
}

export interface ParsedTrip {
  tripId: string;
  base: string | null;
  status: "scheduled" | "review_required";
  variantTag: string | null; // "Original", "Modified", etc.
  tripStartDate: string; // YYYY-MM-DD
  tripEndDate: string; // YYYY-MM-DD
  tripDaysCount: number;
  totals: ParsedTripTotals;
  dutyDays: ParsedDutyDay[];
  sourceType: TemplateType;
  sourceFiles: string[];
  ocrConfidence: number;
  importVersion: string;
  needsReview: boolean;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface ImportValidationResult {
  isValid: boolean;
  canImport: boolean; // Can import if valid OR user confirms review
  errors: string[]; // Must fix before import
  warnings: string[]; // Should review but can proceed
  confidence: number;
}

// ============================================
// TEMPLATE DETECTION
// ============================================

const TEMPLATE_KEYWORDS = {
  crew_access_trip_info: [
    "crewaccess",          // Domain — definitive
    "trip id:",            // Trip header — very specific
    "trip id",
    "duty start",          // Duty period marker — very specific
    "start(lt)",
    "end(lt)",
    "start (lt)",
    "end (lt)",
    "hotel transport",     // Hotel section — specific
    "hotel details",
    "duty totals",
    "status: booked",
    "rest:",
    "block:",              // Duty totals block field
    "cnx",                 // Credit column header
    "departure-arrival",   // Column header specific to this format
  ],
  trip_board_browser: [
    "report at",
    "dag",
    "flt",
    "eqp",
    "dep",
    "arr",
    "tog",
    "blk",
    "cr",
    "l/o",
    "cat",
    "ldgs",
  ],
  trip_board_trip_details: [
    "trip details",
    "trip details -",
    "eqp date pairing",
    "dep (l)",
    "arr (l)",
    "flt",
    "pos",
    "duty days:",
    "out credit",
    "pdiem",
    "prem",
  ],
};

// Keywords that are NOT airport codes (filter these out)
const NON_AIRPORT_CODES = new Set([
  "THE", "AND", "EQP", "BLK", "FLT", "POS", "DAY", "DEP", "ARR",
  "DH", "CR", "L/O", "CAT", "TOG", "DUTY", "REST", "TAFB",
  "OUT", "OFF", "ON", "IN", "CPT", "FO", "CML", "DHL",
]);

export function detectTemplate(ocrText: string): TemplateDetectionResult {
  const textLower = ocrText.toLowerCase();
  const results: Record<TemplateType, { matches: string[]; score: number }> = {
    crew_access_trip_info: { matches: [], score: 0 },
    trip_board_browser: { matches: [], score: 0 },
    trip_board_trip_details: { matches: [], score: 0 },
    unknown: { matches: [], score: 0 },
  };

  // Check each template type
  for (const [template, keywords] of Object.entries(TEMPLATE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (textLower.includes(keyword.toLowerCase())) {
        results[template as TemplateType].matches.push(keyword);
        // Weight keywords differently based on uniqueness
        const weight = keyword.length > 10 ? 2 : 1;
        results[template as TemplateType].score += weight;
      }
    }
  }

  // Find best match
  let bestTemplate: TemplateType = "unknown";
  let bestScore = 0;

  for (const [template, result] of Object.entries(results)) {
    if (result.score > bestScore) {
      bestScore = result.score;
      bestTemplate = template as TemplateType;
    }
  }

  // DEFINITIVE OVERRIDE: If crewaccess domain OR "Trip Id:" + "Duty start" both appear,
  // this is unambiguously Crew Access Trip Information format
  const hasCrewAccessDomain = textLower.includes("crewaccess");
  const hasTripIdAndDutyStart = textLower.includes("trip id") && textLower.includes("duty start");
  if (hasCrewAccessDomain || hasTripIdAndDutyStart) {
    bestTemplate = "crew_access_trip_info";
    bestScore = Math.max(bestScore, 10);
  }

  // Calculate confidence
  let confidence = 0;
  const warnings: string[] = [];

  if (bestScore >= 5) {
    confidence = Math.min(0.95, 0.6 + bestScore * 0.05);
  } else if (bestScore >= 3) {
    confidence = 0.5 + bestScore * 0.1;
  } else if (bestScore > 0) {
    confidence = bestScore * 0.15;
    warnings.push("Low keyword match - may not be a recognized schedule format");
  }

  // Check for conflicting signals
  const topTwoScores = Object.values(results)
    .map((r) => r.score)
    .sort((a, b) => b - a)
    .slice(0, 2);

  if (topTwoScores[0]! > 0 && topTwoScores[1]! > 0) {
    const scoreDiff = topTwoScores[0]! - topTwoScores[1]!;
    if (scoreDiff < 2) {
      confidence *= 0.8;
      warnings.push("Multiple template types detected - ambiguous format");
    }
  }

  return {
    templateType: bestTemplate,
    confidence,
    matchedKeywords: results[bestTemplate].matches,
    warnings,
  };
}

// ============================================
// AIRPORT CODE EXTRACTION
// ============================================

/**
 * Extract valid airport codes from text, filtering out non-airport 3-letter codes
 */
export function extractAirportCodes(text: string): string[] {
  const matches = text.match(/\b[A-Z]{3}\b/g) || [];
  return matches.filter(
    (code) => !NON_AIRPORT_CODES.has(code) && isValidAirportCode(code)
  );
}

/**
 * Parse route string like "SDF-DFW" or "SDF - DFW" into [origin, destination]
 */
export function parseRoute(routeStr: string): [string, string] | null {
  const match = routeStr.match(/([A-Z]{3})\s*[-–]\s*([A-Z]{3})/);
  if (!match) return null;
  const origin = match[1]!;
  const dest = match[2]!;
  if (NON_AIRPORT_CODES.has(origin) || NON_AIRPORT_CODES.has(dest)) return null;
  return [origin, dest];
}

// ============================================
// TIME PARSING UTILITIES
// ============================================

/**
 * Parse time from various formats:
 * - HH:MM
 * - HHMM
 * - (DD)HH:MM like (FR03)08:29 - extracts just HH:MM
 * - (LocalHour)ZuluTime like (FR14)19:00 - extracts LOCAL hour from ()
 */
export function parseTime(timeStr: string): string | null {
  if (!timeStr) return null;

  // Format: (DAYCODE)HH:MM - extract just HH:MM
  const dayCodeMatch = timeStr.match(/\([A-Z]{2}\d*\)?(\d{1,2}):?(\d{2})/i);
  if (dayCodeMatch && dayCodeMatch[1] && dayCodeMatch[2]) {
    const h = dayCodeMatch[1].padStart(2, "0");
    const m = dayCodeMatch[2];
    return `${h}:${m}`;
  }

  // Format: (LocalHour)ZuluTime like (14)19:00 - extract local hour
  const localHourMatch = timeStr.match(/\((\d{1,2})\)(\d{1,2}):?(\d{2})/);
  if (localHourMatch && localHourMatch[1] && localHourMatch[3]) {
    // The number in () is the LOCAL hour
    const localHour = localHourMatch[1].padStart(2, "0");
    const minutes = localHourMatch[3];
    return `${localHour}:${minutes}`;
  }

  // Format: HH:MM
  const hhmmMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (hhmmMatch && hhmmMatch[1] && hhmmMatch[2]) {
    const h = hhmmMatch[1].padStart(2, "0");
    const m = hhmmMatch[2];
    return `${h}:${m}`;
  }

  // Format: HHMM (no colon)
  const noColonMatch = timeStr.match(/^(\d{2})(\d{2})$/);
  if (noColonMatch && noColonMatch[1] && noColonMatch[2]) {
    return `${noColonMatch[1]}:${noColonMatch[2]}`;
  }

  return null;
}

/**
 * Parse day code like FR13, SA14, MOl6 (handles OCR errors like l/I/1)
 */
export function parseDayCode(
  dayCode: string
): { dayOfWeek: string; dayOfMonth: number } | null {
  // Normalize OCR errors: l and I become 1
  const normalized = dayCode.replace(/[lI]/g, "1");

  const match = normalized.match(/([A-Z]{2})(\d{1,2})/i);
  if (!match || !match[1] || !match[2]) return null;

  const dayOfWeek = match[1].toUpperCase();
  const dayOfMonth = parseInt(match[2]);

  const validDays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  if (!validDays.includes(dayOfWeek)) return null;
  if (dayOfMonth < 1 || dayOfMonth > 31) return null;

  return { dayOfWeek, dayOfMonth };
}

// ============================================
// CREW ACCESS TRIP INFORMATION PARSER
// ============================================

interface CrewAccessParseResult {
  tripId: string | null;
  base: string | null;
  tripStartDate: string | null; // YYYY-MM-DD from Trip Id line
  tripStartDateSource: string; // "trip_id_line" | "header_date_fallback" | "base_date_param" | "none"
  tripDays: number;
  dutyDays: ParsedDutyDay[];
  totals: ParsedTripTotals;
  hotels: Array<{
    name: string;
    phone: string | null;
    status: string | null;
    transport: string | null;
    afterDutyDay: number;
  }>;
  confidence: number;
  warnings: string[];
}

export function parseCrewAccessTripInfo(
  ocrText: string,
  baseDate?: string // YYYY-MM-DD for month/year context
): CrewAccessParseResult {
  const warnings: string[] = [];
  let confidence = 0.8;

  // ============================================
  // STEP 1: Extract Trip ID and TRIP START DATE
  // ============================================
  // CRITICAL: Trip start date MUST come from "Trip Id: <id> <date>" line
  // NOT from header "Date:" which is document generation date
  // Example: "Trip Id: 35324 30Jan2026" → tripId=35324, tripStartDate=2026-01-30

  let tripId: string | null = null;
  let tripStartDate: string | null = null;
  let tripStartDateSource: string = "none";

  // Pattern: "Trip Id: 35324 30Jan2026" or "Trip Id: S50558 11Jan2026"
  const tripIdLineMatch = ocrText.match(
    /Trip\s*(?:Id|1d)[:\s]+([A-Z]?\d{4,6})\s+(\d{1,2})([A-Za-z]{3})(\d{4})/i
  );

  if (tripIdLineMatch) {
    tripId = tripIdLineMatch[1] ?? null;
    const day = parseInt(tripIdLineMatch[2]!);
    const monthStr = tripIdLineMatch[3]!.toLowerCase();
    const year = parseInt(tripIdLineMatch[4]!);

    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const month = months[monthStr] ?? 0;

    // Create ISO date string
    tripStartDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    tripStartDateSource = "trip_id_line";

    console.log(`  [CrewAccess] Trip ID: ${tripId}`);
    console.log(`  [CrewAccess] Trip start date from Trip Id line: ${tripStartDate} (source: ${tripStartDateSource})`);
  } else {
    // Fallback: Try just extracting Trip ID without date
    const tripIdOnlyMatch = ocrText.match(/Trip\s*(?:Id|1d)[:\s]+([A-Z]?\d{4,6})/i);
    tripId = tripIdOnlyMatch?.[1] ?? null;

    if (!tripId) {
      warnings.push("Could not extract Trip ID");
      confidence -= 0.2;
    }
  }

  // Only use header "Date:" as LAST RESORT if Trip Id line had no date
  // This is the document generation date, NOT the trip start date
  if (!tripStartDate) {
    const headerDateMatch = ocrText.match(/^Date[:\s]+(\d{1,2})([A-Za-z]{3})(\d{4})/im);
    if (headerDateMatch) {
      const day = parseInt(headerDateMatch[1]!);
      const monthStr = headerDateMatch[2]!.toLowerCase();
      const year = parseInt(headerDateMatch[3]!);

      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      const month = months[monthStr] ?? 0;

      tripStartDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      tripStartDateSource = "header_date_fallback";
      warnings.push("Trip start date from header 'Date:' (fallback) - may be document date, not trip start");
      console.log(`  [CrewAccess] Trip start date from header Date (FALLBACK): ${tripStartDate}`);
    }
  }

  // Use baseDate as final fallback
  if (!tripStartDate && baseDate) {
    tripStartDate = baseDate;
    tripStartDateSource = "base_date_param";
    warnings.push("Trip start date from baseDate parameter (fallback)");
  }

  // Extract base (if present)
  const baseMatch = ocrText.match(/Base[:\s]+([A-Z]{3})/i);
  const base = baseMatch?.[1] ?? null;

  // ============================================
  // STEP 2: Parse flight legs with DUTY PERIOD GROUPING
  // ============================================
  // CREW ACCESS FORMAT:
  // - Day column contains CALENDAR day numbers (1, 2, 3) NOT duty day numbers
  // - "Duty totals" row marks the END of a duty period
  // - Legs between "Duty totals" rows belong to the SAME duty period
  // - A duty period can span multiple calendar days (e.g., Day 1+2 in same duty)
  //
  // Example:
  //   1 Fr 5984 SDF-PDX ... (Day 1, Duty Period 1)
  //   2 Sa 5984 PDX-BFI ... (Day 2, but STILL Duty Period 1!)
  //   Duty totals            (End of Duty Period 1)
  //   Hotel details          (Layover after Duty Period 1)
  //   3 Su 5981 BFI-SDF ... (Day 3, Duty Period 2)
  //   Duty totals            (End of Duty Period 2)

  const lines = ocrText.split('\n');

  // First pass: collect all parsed legs with their calendar day numbers and line indices
  interface TempLeg {
    lineIndex: number;
    calendarDayNum: number;
    dayCode: string;
    flightNum: string | null;
    origin: string;
    dest: string;
    depLocalTime: string;
    arrLocalTime: string;
    blockMinutes: number;
    blockSource: "parsed" | "computed";
    creditMinutes: number; // From Cnx column (per-leg credit)
    isDeadhead: boolean;
    rawLine: string;
    equipment: string | null;
  }

  // Structure to hold duty totals extracted from each "Duty totals" row
  interface DutyTotalsRow {
    lineIndex: number;
    dutyMinutes: number;    // From "Time: HH:MM"
    blockMinutes: number;   // From "Block: H:MM"
    creditMinutes: number;  // From "Credit: H:MM" (if present)
    restMinutes: number;    // From "Rest: HH:MM"
    rawLine: string;
  }

  const allLegs: TempLeg[] = [];
  const dutyTotalsLineIndices: number[] = [];
  const dutyTotalsRows: DutyTotalsRow[] = [];

  // Debug info for parsing
  const debugInfo: Array<{
    line: string;
    dayNum: number | null;
    dayCode: string | null;
    flight: string | null;
    route: string | null;
    times: string[];
    block: string | null;
  }> = [];

  console.log(`  [CrewAccess] Parsing ${lines.length} lines (duty marker mode)...`);

  let prevNonEmptyWasDH = false; // Track if preceding non-empty line was a standalone DH marker

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const trimmedLine = line.trim();

    // Track "Duty totals" markers and extract values from the row
    // Format: "Duty totals Time: 12:34 Block: 5:67 Rest: 12:34"
    // OCR VARIANT: "uy poe:  Block: 0:00  Rest: 25:48" (mangled "Duty totals Time:")
    // OCR VARIANT: "uy  Tone:     Block: 6:34  Rest: 12:48" (further OCR corruption)
    // Detect by: starts with "Duty totals" OR contains "Block:" (duty totals signature)
    // Note: trimmedLine starts with lowercase letters for OCR-mangled "Duty totals" variants
    // The last duty totals row may have empty "Rest:" value, so only require Block: presence
    const isDutyTotalsLine = /^Duty\s*totals/i.test(trimmedLine) ||
      (/Block[:\s]+\d+:\d{2}/i.test(trimmedLine) && /^[a-z]/i.test(trimmedLine.charAt(0)) && !trimmedLine.match(/^[A-Z0-9]/));
    if (isDutyTotalsLine) {
      dutyTotalsLineIndices.push(lineIndex);

      // AUTHORITATIVE: Extract duty period totals from Crew Access
      // Format: "Duty totals Time: HH:MM Block: H:MM Rest: HH:MM"
      const dutyTimeMatch = trimmedLine.match(/Time[:\s]+(\d+:\d{2})/i);
      const dutyBlockMatch = trimmedLine.match(/Block[:\s]+(\d+:\d{2})/i);
      const dutyCreditMatch = trimmedLine.match(/Credit[:\s]+(\d+:\d{2})/i);
      const dutyRestMatch = trimmedLine.match(/Rest[:\s]+(\d+:\d{2})/i);

      const dutyTotalsRow: DutyTotalsRow = {
        lineIndex,
        dutyMinutes: parseDurationToMinutes(dutyTimeMatch?.[1]),
        blockMinutes: parseDurationToMinutes(dutyBlockMatch?.[1]),
        creditMinutes: parseDurationToMinutes(dutyCreditMatch?.[1]),
        restMinutes: parseDurationToMinutes(dutyRestMatch?.[1]),
        rawLine: trimmedLine,
      };

      dutyTotalsRows.push(dutyTotalsRow);
      console.log(`  [CrewAccess] Found Duty totals at line ${lineIndex}: duty=${formatMinutesAsDuration(dutyTotalsRow.dutyMinutes)}, block=${formatMinutesAsDuration(dutyTotalsRow.blockMinutes)}, rest=${formatMinutesAsDuration(dutyTotalsRow.restMinutes)}`);
      continue;
    }

    // Skip non-flight lines, but track standalone "DH" lines as a DH marker for the next leg
    if (!trimmedLine ||
        trimmedLine.startsWith('Hotel') ||
        trimmedLine.startsWith('Crew') ||
        trimmedLine.startsWith('Trip Id') ||
        trimmedLine.startsWith('Trip Information') ||
        trimmedLine.startsWith('Day ') || // Header row
        trimmedLine.startsWith('Date:') ||
        trimmedLine.startsWith('Duty start') ||
        trimmedLine.startsWith('Duty end') ||
        trimmedLine.startsWith('Rest:') ||
        trimmedLine.startsWith('Status:')) {
      // Check if this is a standalone "DH" line (marks the next leg as deadhead)
      if (/^DH\s*$/i.test(trimmedLine)) {
        prevNonEmptyWasDH = true;
      } else if (trimmedLine) {
        prevNonEmptyWasDH = false;
      }
      continue;
    }

    // ============================================
    // PATTERN: Day# DayCode [DH/pH] [Flight] Route Times Block
    // OCR variations:
    //   "1 Su   pH      SDF-DFW"        (DH misread as pH, flight on next line)
    //   "1 Su   DH      DFW-MFE"        (explicit DH, flight on next line)
    //   "3Tu 795      MFE-SDF"          (no space, numeric flight)
    //   "78a 651       SGF-SDF"         (day=7, code=8a→Sa misread)
    //   "8 Su   AA1522   MFE-DFW"       (AA-prefixed flight number, inline)
    //   "8 Su    AAS644   DFW-SDF"      (AAS→AA OCR misread)
    // ============================================
    //
    // Strategy: match day number (1-9), day code (Su/Mo/etc with OCR variants),
    // optional DH/pH/flight tokens, then airport route
    //
    // Day code variants: 8a→Sa, 0u→Su; also "78a" = day 7 + code 8a→Sa
    const legPattern = /^(\d)\s*(Su|Mo|Tu|We|Th|Fr|Sa|8a|0u|Sa)\s+(.{0,20}?)\s*([A-Z]{3})\s*[-–]\s*([A-Z]{3})/i;
    // Also handle "78a" style: day=7, dayCode=8a(Sa) - one combined token at start
    const combinedDayPattern = /^(\d)(8a|0u)\s+(.{0,20}?)\s*([A-Z]{3})\s*[-–]\s*([A-Z]{3})/i;

    let legPatternMatch = trimmedLine.match(combinedDayPattern) || trimmedLine.match(legPattern);

    if (!legPatternMatch) {
      // Check if this non-leg line is a standalone DH marker or DH remark line
      // (e.g., "DH                  AA 4097 MFEDFW..." or just "DH")
      if (/^DH\b/i.test(trimmedLine)) {
        prevNonEmptyWasDH = true;
      } else if (trimmedLine) {
        prevNonEmptyWasDH = false;
      }
      continue;
    }

    const calendarDayNum = parseInt(legPatternMatch[1]!);
    // Normalize OCR misreads of day codes
    let dayCode = legPatternMatch[2]!.toLowerCase();
    if (dayCode === "8a") dayCode = "sa";
    else if (dayCode === "0u") dayCode = "su";
    dayCode = dayCode.charAt(0).toUpperCase() + dayCode.charAt(1);

    // The "middle" token(s) between day code and route contain DH flag and/or flight number
    const middleToken = (legPatternMatch[3] ?? "").trim();
    const origin = legPatternMatch[4]!.toUpperCase();
    const dest = legPatternMatch[5]!.toUpperCase();

    // Filter out non-airport codes
    if (NON_AIRPORT_CODES.has(origin) || NON_AIRPORT_CODES.has(dest)) {
      continue;
    }

    // Parse flight number and DH flag from middleToken
    // middleToken may be: "DH", "pH" (OCR misread of DH), "795", "AA1522", "AAS644", "pH AA5644", etc.
    // "pH" = OCR misread of "DH" → treat as deadhead
    // Numeric only → flight number, not DH
    // AA+digits → flight number with AA prefix (DH indicator from "DH" keyword presence)
    const isDHKeyword = /\b(?:DH|pH|pHl|pfl|0H)\b/i.test(middleToken);
    // Extract numeric flight number (may be standalone digits or AA+digits)
    const flightNumMatch = middleToken.match(/(?:AA[S]?)?(\d{3,5})/i);
    const flightNum: string | null = flightNumMatch ? flightNumMatch[1]! : null;

    // If middleToken has only DH/pH and no flight number, check NEXT line for AA flight number
    // Crew Access sometimes puts AA flight numbers on the line below the route
    let resolvedFlightNum = flightNum;
    if (!resolvedFlightNum && lineIndex + 1 < lines.length) {
      const nextLine = lines[lineIndex + 1]!.trim();
      const nextLineFlightMatch = nextLine.match(/^AA[S]?(\d{3,5})$/i);
      if (nextLineFlightMatch) {
        resolvedFlightNum = nextLineFlightMatch[1]!;
      }
    }

    // DH: explicit DH/pH keyword, OR no flight number at all, OR preceding line was standalone DH
    const isDeadhead = isDHKeyword || (!resolvedFlightNum && !flightNum) || prevNonEmptyWasDH;
    prevNonEmptyWasDH = false; // Reset after consuming

    // Extract ALL times from the line after the route
    const routeEndIndex = trimmedLine.indexOf(dest) + 3;
    const afterRoute = trimmedLine.substring(routeEndIndex);
    const allTimes = afterRoute.match(/(\d{1,2}:\d{2})/g) || [];

    // CREW ACCESS time columns (after route):
    // Position 0: Start (ZULU)
    // Position 1: Start(LT) - LOCAL departure ← USE THIS
    // Position 2: End (ZULU)
    // Position 3: End(LT) - LOCAL arrival ← USE THIS
    // Position 4: Block time ← THIS IS AUTHORITATIVE
    // Position 5: Cnx (credit) time per leg (after aircraft type column)
    // Note: DH legs often have "-" for block, so allTimes may only have 4 entries (no block)

    let startLT: string | null = null;
    let endLT: string | null = null;
    let parsedBlockStr: string | null = null;
    let parsedCnxStr: string | null = null;

    if (allTimes.length >= 6) {
      startLT = allTimes[1] ?? null;
      endLT = allTimes[3] ?? null;
      parsedBlockStr = allTimes[4] ?? null;
      parsedCnxStr = allTimes[5] ?? null;
    } else if (allTimes.length >= 5) {
      startLT = allTimes[1] ?? null;
      endLT = allTimes[3] ?? null;
      parsedBlockStr = allTimes[4] ?? null;
    } else if (allTimes.length >= 4) {
      startLT = allTimes[1] ?? null;
      endLT = allTimes[3] ?? null;
    } else if (allTimes.length >= 2) {
      startLT = allTimes[0] ?? null;
      endLT = allTimes[1] ?? null;
    }

    const legCreditMinutes = parsedCnxStr ? parseDurationToMinutes(parsedCnxStr) : 0;

    // Also look for block time pattern near equipment marker
    const blockEquipMatch = afterRoute.match(/(\d{1,2}:\d{2})\s*(?:76[78PWpw\*]|75[7Ppw\*]|7[3567]7|MD\d{2})/i);
    if (blockEquipMatch && !parsedBlockStr) {
      parsedBlockStr = blockEquipMatch[1] ?? null;
    }

    // Extract equipment from the line (e.g., 767, 757, 767*, 757*)
    // The asterisk (*) after aircraft type is common in Crew Access (e.g., "757*", "767*")
    const equipmentMatch = trimmedLine.match(/\b(76[78PWpw]|75[7Ppw]|7[3567]7|MD\d{2})\*?/i);
    let extractedEquipment: string | null = null;
    if (equipmentMatch) {
      const eqCode = equipmentMatch[1]!.toUpperCase();
      const eqMap: Record<string, string> = {
        '76P': '767', '76W': '767', '768': '767', '767': '767',
        '75P': '757', '75W': '757', '757': '757',
        '74F': '747', '744': '747', '747': '747', '748': '747-8',
        '77F': '777', '77W': '777', '777': '777',
        '73F': '737', '738': '737', '737': '737',
        'MD11': 'MD11',
      };
      extractedEquipment = eqMap[eqCode] ?? eqCode;
    }

    // Debug log
    debugInfo.push({
      line: trimmedLine.substring(0, 60),
      dayNum: calendarDayNum,
      dayCode,
      flight: resolvedFlightNum,
      route: `${origin}-${dest}`,
      times: allTimes,
      block: parsedBlockStr,
    });

    // Parse block time
    let blockMinutes = 0;
    let blockSource: "parsed" | "computed" = "parsed";

    if (parsedBlockStr) {
      blockMinutes = parseDurationToMinutes(parsedBlockStr);
    }

    if (blockMinutes === 0 && !parsedBlockStr && startLT && endLT) {
      const depTime = parseTime(startLT);
      const arrTime = parseTime(endLT);
      if (depTime && arrTime) {
        const computed = computeBlockMinutes(depTime, arrTime, "2000-01-01");
        blockMinutes = computed.blockMinutes;
        blockSource = "computed";
        warnings.push(`Computed block time for ${origin}-${dest}: ${formatMinutesAsDuration(blockMinutes)}`);
      }
    }

    allLegs.push({
      lineIndex,
      calendarDayNum,
      dayCode,
      flightNum: resolvedFlightNum,
      origin,
      dest,
      depLocalTime: parseTime(startLT ?? "") ?? (startLT ?? ""),
      arrLocalTime: parseTime(endLT ?? "") ?? (endLT ?? ""),
      blockMinutes,
      blockSource,
      creditMinutes: legCreditMinutes,
      isDeadhead,
      rawLine: line,
      equipment: extractedEquipment,
    });

    console.log(`  [CrewAccess] Leg at line ${lineIndex}: Day ${calendarDayNum} ${isDeadhead ? 'DH' : ''} ${resolvedFlightNum ?? '---'} ${origin}-${dest} block=${formatMinutesAsDuration(blockMinutes)} equip=${extractedEquipment ?? 'none'}`);
  }

  console.log(`  [CrewAccess] Found ${allLegs.length} legs, ${dutyTotalsLineIndices.length} duty markers`);

  // ============================================
  // STEP 2b: Group legs into duty periods using "Duty totals" markers
  // ============================================
  // Legs are grouped by which "Duty totals" marker they appear BEFORE

  const dutyDays: ParsedDutyDay[] = [];
  let currentDutyLegs: TempLeg[] = [];
  let dutyPeriodIndex = 1;
  let markerIndex = 0;

  for (const leg of allLegs) {
    // Check if this leg appears AFTER the current duty marker
    while (markerIndex < dutyTotalsLineIndices.length &&
           leg.lineIndex > dutyTotalsLineIndices[markerIndex]!) {
      // We've passed a duty marker - finalize the current duty period
      if (currentDutyLegs.length > 0) {
        const firstLeg = currentDutyLegs[0]!;
        const lastLeg = currentDutyLegs[currentDutyLegs.length - 1]!;

        // Calculate calendar date from tripStartDate + (firstLeg.calendarDayNum - 1)
        let calendarDate = "";
        if (tripStartDate) {
          const startDateObj = new Date(tripStartDate + "T00:00:00Z");
          startDateObj.setUTCDate(startDateObj.getUTCDate() + (firstLeg.calendarDayNum - 1));
          calendarDate = startDateObj.toISOString().split('T')[0]!;
        }

        // AUTHORITATIVE: Get duty totals from the Crew Access "Duty totals" row
        // The markerIndex corresponds to the duty totals row that ends this duty period
        const dutyTotalsForThisPeriod = dutyTotalsRows[markerIndex];

        // Use Crew Access duty totals as authoritative, fallback to computed if not found
        const computedBlock = currentDutyLegs.reduce((sum, l) => sum + l.blockMinutes, 0);
        const computedCredit = currentDutyLegs.reduce((sum, l) => sum + l.creditMinutes, 0);
        // If we have a duty totals row, its blockMinutes is AUTHORITATIVE (even if 0 for DH-only duty)
        // Only fall back to computed when there's no duty totals row at all
        const authoritativeBlock = dutyTotalsForThisPeriod !== undefined
          ? dutyTotalsForThisPeriod.blockMinutes
          : computedBlock;
        const authoritativeDuty = dutyTotalsForThisPeriod?.dutyMinutes || null;
        // Credit: prefer duty totals row, then per-leg Cnx sum, then block
        const authoritativeCredit = (dutyTotalsForThisPeriod?.creditMinutes ?? 0) > 0
          ? dutyTotalsForThisPeriod!.creditMinutes
          : (computedCredit > 0 ? computedCredit : computedBlock);

        const dutyDay: ParsedDutyDay = {
          dutyDayIndex: dutyPeriodIndex,
          calendarDate,
          dayLabel: `Duty ${dutyPeriodIndex}`,
          dutyStartLocalTime: firstLeg.depLocalTime,
          dutyEndLocalTime: lastLeg.arrLocalTime,
          // AUTHORITATIVE: Use parsed values from Crew Access Duty totals row
          dayBlockMinutes: authoritativeBlock,
          dayCreditMinutes: authoritativeCredit,
          dayDutyMinutes: authoritativeDuty,
          legs: currentDutyLegs.map((l, idx) => ({
            legSeq: idx + 1,
            flightNumber: l.flightNum,
            position: null,
            dhFlag: l.isDeadhead,
            equipment: l.equipment,
            depAirport: l.origin,
            arrAirport: l.dest,
            depLocalTime: l.depLocalTime,
            arrLocalTime: l.arrLocalTime,
            depDisplayTime: l.depLocalTime,
            arrDisplayTime: l.arrLocalTime,
            blockMinutes: l.blockMinutes,
            blockSource: l.blockSource,
            rawRowText: l.rawLine,
            confidence: l.blockSource === "parsed" ? 0.9 : 0.7,
            needsReview: false,
            warnings: [],
          })),
          layoverToNextDay: null,
          confidence: 0.85,
          needsReview: false,
          warnings: [],
        };

        dutyDays.push(dutyDay);
        console.log(`  [CrewAccess] Created duty period ${dutyPeriodIndex}: ${currentDutyLegs.length} legs, block=${formatMinutesAsDuration(dutyDay.dayBlockMinutes)}, duty=${authoritativeDuty ? formatMinutesAsDuration(authoritativeDuty) : 'computed'}, date=${calendarDate}`);
        dutyPeriodIndex++;
      }

      currentDutyLegs = [];
      markerIndex++;
    }

    // Add leg to current duty period
    currentDutyLegs.push(leg);
  }

  // Handle remaining legs after the last duty marker (or if no markers found)
  if (currentDutyLegs.length > 0) {
    const firstLeg = currentDutyLegs[0]!;
    const lastLeg = currentDutyLegs[currentDutyLegs.length - 1]!;

    let calendarDate = "";
    if (tripStartDate) {
      const startDateObj = new Date(tripStartDate + "T00:00:00Z");
      startDateObj.setUTCDate(startDateObj.getUTCDate() + (firstLeg.calendarDayNum - 1));
      calendarDate = startDateObj.toISOString().split('T')[0]!;
    }

    // For the final duty period, check if there's a corresponding duty totals row
    // (This handles cases where legs come after all duty markers)
    const finalDutyTotals = dutyTotalsRows[markerIndex] || dutyTotalsRows[dutyTotalsRows.length - 1];

    const computedBlock = currentDutyLegs.reduce((sum, l) => sum + l.blockMinutes, 0);
    const computedCredit = currentDutyLegs.reduce((sum, l) => sum + l.creditMinutes, 0);
    // If we have a duty totals row, its blockMinutes is AUTHORITATIVE (even if 0 for DH-only duty)
    const authoritativeBlock = finalDutyTotals !== undefined
      ? finalDutyTotals.blockMinutes
      : computedBlock;
    const authoritativeDuty = finalDutyTotals?.dutyMinutes || null;
    // Credit: prefer duty totals row, then per-leg Cnx sum, then block
    const authoritativeCredit = (finalDutyTotals?.creditMinutes ?? 0) > 0
      ? finalDutyTotals!.creditMinutes
      : (computedCredit > 0 ? computedCredit : computedBlock);

    const dutyDay: ParsedDutyDay = {
      dutyDayIndex: dutyPeriodIndex,
      calendarDate,
      dayLabel: `Duty ${dutyPeriodIndex}`,
      dutyStartLocalTime: firstLeg.depLocalTime,
      dutyEndLocalTime: lastLeg.arrLocalTime,
      // AUTHORITATIVE: Use parsed values from Crew Access Duty totals row
      dayBlockMinutes: authoritativeBlock,
      dayCreditMinutes: authoritativeCredit,
      dayDutyMinutes: authoritativeDuty,
      legs: currentDutyLegs.map((l, idx) => ({
        legSeq: idx + 1,
        flightNumber: l.flightNum,
        position: null,
        dhFlag: l.isDeadhead,
        equipment: l.equipment,
        depAirport: l.origin,
        arrAirport: l.dest,
        depLocalTime: l.depLocalTime,
        arrLocalTime: l.arrLocalTime,
        depDisplayTime: l.depLocalTime,
        arrDisplayTime: l.arrLocalTime,
        blockMinutes: l.blockMinutes,
        blockSource: l.blockSource,
        rawRowText: l.rawLine,
        confidence: l.blockSource === "parsed" ? 0.9 : 0.7,
        needsReview: false,
        warnings: [],
      })),
      layoverToNextDay: null,
      confidence: 0.85,
      needsReview: false,
      warnings: [],
    };

    dutyDays.push(dutyDay);
    console.log(`  [CrewAccess] Created final duty period ${dutyPeriodIndex}: ${currentDutyLegs.length} legs, block=${formatMinutesAsDuration(dutyDay.dayBlockMinutes)}, duty=${authoritativeDuty ? formatMinutesAsDuration(authoritativeDuty) : 'computed'}, date=${calendarDate}`);
  }

  console.log(`  [CrewAccess] Total duty periods: ${dutyDays.length}`);
  for (const dd of dutyDays) {
    console.log(`    Duty ${dd.dutyDayIndex}: ${dd.legs.length} legs, block=${formatMinutesAsDuration(dd.dayBlockMinutes)}, date=${dd.calendarDate}`);
  }

  // ============================================
  // STEP 3: Set layover stations = FINAL ARRIVAL of each duty period
  // and use AUTHORITATIVE rest time from Crew Access "Duty totals" row
  // ============================================
  for (let i = 0; i < dutyDays.length; i++) {
    const dutyDay = dutyDays[i]!;
    const lastLeg = dutyDay.legs[dutyDay.legs.length - 1];

    // Layover station is the FINAL arrival airport of this duty period
    if (lastLeg && i < dutyDays.length - 1) {
      // Not the last day, so there's a layover
      // AUTHORITATIVE: Use Rest time from Crew Access "Duty totals" row
      const dutyTotalsForThisPeriod = dutyTotalsRows[i];
      const authoritativeRestMinutes = dutyTotalsForThisPeriod?.restMinutes ?? 0;

      dutyDay.layoverToNextDay = {
        layoverStation: lastLeg.arrAirport, // FINAL arrival of this duty
        layoverMinutes: authoritativeRestMinutes, // AUTHORITATIVE: From Crew Access Rest: field
        restMinutes: authoritativeRestMinutes,
        hotelName: null,
        hotelPhone: null,
        hotelStatus: null,
        hotelTransport: null,
        confidence: authoritativeRestMinutes > 0 ? 0.9 : 0.7, // Higher confidence if we have rest time
        needsReview: false,
      };
      console.log(`  [CrewAccess] Day ${dutyDay.dutyDayIndex} layover at: ${lastLeg.arrAirport}, rest=${authoritativeRestMinutes > 0 ? formatMinutesAsDuration(authoritativeRestMinutes) : 'unknown'}`);
    }
  }

  // Extract hotel information with multiple pattern strategies
  const hotels: CrewAccessParseResult["hotels"] = [];
  let hotelIndex = 0;

  // Strategy 1: Crew Access "Hotel details" format (most specific)
  // Format: "Hotel details Status: BOOKED Hotel: [Name] Phone: [Phone]"
  const crewAccessPattern = /Hotel\s+details\s+(?:Status[:\s]*(BOOKED|PENDING|TBD|CONFIRMED))?\s*Hotel[:\s]*([^\n]+?)(?:\s+Phone[:\s]*([0-9\-.\s()]+))?(?:\s*(?:Hotel Transport|Transport)|$)/gi;
  let crewAccessMatch;
  while ((crewAccessMatch = crewAccessPattern.exec(ocrText)) !== null) {
    const status = crewAccessMatch[1] ?? null;
    let hotelName = crewAccessMatch[2]?.trim() ?? "";
    const phone = crewAccessMatch[3]?.replace(/[\s\-\(\)]/g, "") ?? null;

    // Clean up hotel name - remove trailing junk
    hotelName = hotelName.replace(/\s*(?:Address|Phone|Transport)[:\s]*.*$/i, "").trim();

    if (hotelName.length > 3 && !hotels.some(h => h.name === hotelName)) {
      console.log(`  [HotelParser] Crew Access match: "${hotelName}" Status=${status} Phone=${phone || 'N/A'}`);
      hotels.push({
        name: hotelName,
        phone,
        status,
        transport: null,
        afterDutyDay: hotelIndex + 1,
      });
      hotelIndex++;
    }
  }

  // Strategy 2: Original pattern - "Status: BOOKED Hotel: [Name] Phone: [Phone]"
  const hotelPattern = /Status:\s*(BOOKED|PENDING)?\s*Hotel:\s*([^\n]+?)\s+Phone:\s*([\d\-\(\)\s]+)/gi;
  let hotelMatch;
  while ((hotelMatch = hotelPattern.exec(ocrText)) !== null) {
    const hotelName = hotelMatch[2]?.trim() ?? "";
    if (hotelName.length > 3 && !hotels.some(h => h.name === hotelName)) {
      console.log(`  [HotelParser] Status pattern match: "${hotelName}"`);
      hotels.push({
        name: hotelName,
        phone: hotelMatch[3]?.replace(/[\s\-\(\)]/g, "") ?? null,
        status: hotelMatch[1] ?? null,
        transport: null,
        afterDutyDay: hotels.length + 1,
      });
    }
  }

  // Strategy 3: Hotel brand patterns (common chains)
  const hotelBrands = [
    "Marriott", "JW Marriott", "Courtyard", "Fairfield", "SpringHill", "Residence Inn",
    "TownePlace", "AC Hotel", "Ayres", "Hilton", "Hampton", "DoubleTree", "Embassy Suites",
    "Homewood Suites", "Home2", "Hyatt", "Grand Hyatt", "Radisson", "Country Inn",
    "Holiday Inn", "Crowne Plaza", "Best Western", "Sheraton", "Westin", "Four Points",
    "La Quinta", "Comfort Inn", "Quality Inn", "Sleep Inn", "Red Roof"
  ];
  const brandPattern = new RegExp(`((?:${hotelBrands.join("|")})[^\\n]{0,50}?)(?:\\s+(\\d{3}[-.]?\\d{3}[-.]?\\d{4}))?`, "gi");
  let brandMatch;
  while ((brandMatch = brandPattern.exec(ocrText)) !== null) {
    let hotelName = brandMatch[1]?.trim() ?? "";
    const phone = brandMatch[2]?.replace(/[\s\-\(\).]/g, "") ?? null;

    // Clean up - remove trailing junk
    hotelName = hotelName.replace(/\s*(?:Phone|Transport|Status|Hotel details)[:\s]*.*$/i, "").trim();

    if (hotelName.length > 5 && hotelName.length < 80 && !hotels.some(h => h.name.toLowerCase().includes(hotelName.toLowerCase().split(" ")[0]!))) {
      console.log(`  [HotelParser] Brand match: "${hotelName}" Phone=${phone || 'N/A'}`);
      hotels.push({
        name: hotelName,
        phone,
        status: null,
        transport: null,
        afterDutyDay: hotels.length + 1,
      });
    }
  }

  console.log(`  [HotelParser] Total hotels found: ${hotels.length}`);

  // Extract transport info
  const transportMatch = ocrText.match(
    /Hotel\s+Transport[:\s]*([^\n]+?)(?:\n|Phone)/i
  );
  if (transportMatch && hotels.length > 0) {
    hotels[0]!.transport = transportMatch[1]?.trim() ?? null;
  }

  // Link hotels to layovers
  for (const hotel of hotels) {
    const dayIndex = hotel.afterDutyDay - 1;
    if (dayIndex >= 0 && dayIndex < dutyDays.length) {
      const dutyDay = dutyDays[dayIndex]!;
      const lastLeg = dutyDay.legs[dutyDay.legs.length - 1];
      dutyDay.layoverToNextDay = {
        layoverStation: lastLeg?.arrAirport ?? "",
        layoverMinutes: 0, // Will compute
        restMinutes: null,
        hotelName: hotel.name,
        hotelPhone: hotel.phone,
        hotelStatus: hotel.status,
        hotelTransport: hotel.transport,
        confidence: 0.85,
        needsReview: false,
      };
    }
  }

  // Extract rest times and link to layovers
  const restPattern = /Rest[:\s]+(\d+:\d{2})/gi;
  let restMatch;
  let restIndex = 0;

  while ((restMatch = restPattern.exec(ocrText)) !== null) {
    const restMinutes = parseDurationToMinutes(restMatch[1]);
    if (restIndex < dutyDays.length && dutyDays[restIndex]?.layoverToNextDay) {
      dutyDays[restIndex]!.layoverToNextDay!.restMinutes = restMinutes;
      dutyDays[restIndex]!.layoverToNextDay!.layoverMinutes = restMinutes;
    }
    restIndex++;
  }

  // ============================================
  // STEP 4: Extract AUTHORITATIVE totals from TRIP SUMMARY line
  // ============================================
  // CRITICAL: Crew Access provides authoritative values for these fields:
  // - Block Time (sum of all block times)
  // - Credit Time (often > Block due to minimums/rigs)
  // - Duty Time (total duty time - DO NOT recompute)
  // - TAFB (Time Away From Base)
  // - Trip Days (calendar days - may differ from duty period count)
  // These should NEVER be overridden by computed values - they are the SOURCE OF TRUTH

  // In Crew Access PDFs, the trip summary is a TABLE with headers on one row and values
  // on the next row. The OCR output looks like:
  //
  //   Line N:   "Crew: 1F/O  Base: SDF   Duty Time: 63:53   Block   Credit   Trip"
  //   Line N+1: "                                            Time:   Time:    Days:  TAFB: 168:45"
  //   Line N+2: "                                            26:22   45:00    8"
  //
  // OR sometimes all on one line:
  //   "Duty Time: 63:53  Block Time: 26:22  Credit Time: 45:00  Trip Days: 8  TAFB: 168:45"
  //
  // Strategy:
  //   1. Try inline patterns first (Block Time: XX, Credit Time: XX, Trip Days: N)
  //   2. Find "Duty Time: XX" and "TAFB: XX" anchors, then look for the values
  //      triplet (H:MM  H:MM  N) anywhere in the summary section

  // AUTHORITATIVE: Duty Time from Crew Access - DO NOT compute this
  const dutyTimeMatch = ocrText.match(/Duty Time[:\s]+(\d+:\d{2})/i);
  const tafbMatch = ocrText.match(/TAFB[:\s]+(\d+:\d{2})/i);

  // Try inline patterns first (some OCR outputs keep them on one line)
  const creditMatch = ocrText.match(/Credit Time[:\s]+(\d+:\d{2})/i);
  const blockTotalMatch = ocrText.match(/Block Time[:\s]+(\d+:\d{2})/i);
  const tripDaysMatch = ocrText.match(/Trip Days[:\s]+(\d+)/i) ?? ocrText.match(/Days:\s+(\d+)/i);

  let splitSummaryBlock: string | null = null;
  let splitSummaryCredit: string | null = null;
  let splitSummaryDays: string | null = null;

  // If inline patterns didn't find everything, look for the table value triplet
  // Find the summary section: text between last "TAFB:" (end of headers) and end of document
  // The values row "26:22  45:00  8" comes AFTER the TAFB value in the OCR text
  if (!creditMatch || !blockTotalMatch || !tripDaysMatch) {
    // Anchor to TAFB value (last header), then look for the triplet after it
    const tafbIdx = ocrText.lastIndexOf('TAFB');
    if (tafbIdx >= 0) {
      const afterTafb = ocrText.substring(tafbIdx);
      // Skip past the TAFB time value itself, then find H:MM  H:MM  N
      const afterTafbValue = afterTafb.replace(/^TAFB[:\s]+\d+:\d{2}/, '');
      // The values triplet: two H:MM values followed by a small integer (trip days 1-30)
      const tripletMatch = afterTafbValue.match(/(\d{1,3}:\d{2})\s+(\d{1,3}:\d{2})\s+(\d{1,2})(?:\s|$|\n)/);
      if (tripletMatch) {
        splitSummaryBlock = tripletMatch[1] ?? null;
        splitSummaryCredit = tripletMatch[2] ?? null;
        splitSummaryDays = tripletMatch[3] ?? null;
        console.log(`  [CrewAccess] Split summary (after-TAFB) found: block=${splitSummaryBlock}, credit=${splitSummaryCredit}, days=${splitSummaryDays}`);
      }
    }
    // Also try: find "Duty Time:" then look for triplet in section (but skip Duty Time and TAFB values)
    if (!splitSummaryBlock) {
      const dutyTimeIdx = ocrText.lastIndexOf('Duty Time');
      if (dutyTimeIdx >= 0) {
        const summarySection = ocrText.substring(dutyTimeIdx);
        // Remove the known time values (duty time and TAFB) from the section before searching
        const cleaned = summarySection
          .replace(/Duty Time[:\s]+\d+:\d{2}/i, '')
          .replace(/TAFB[:\s]+\d+:\d{2}/i, '');
        const tripletMatch = cleaned.match(/(\d{1,3}:\d{2})\s+(\d{1,3}:\d{2})\s+(\d{1,2})(?:\s|$|\n)/);
        if (tripletMatch) {
          splitSummaryBlock = tripletMatch[1] ?? null;
          splitSummaryCredit = tripletMatch[2] ?? null;
          splitSummaryDays = tripletMatch[3] ?? null;
          console.log(`  [CrewAccess] Split summary (cleaned section) found: block=${splitSummaryBlock}, credit=${splitSummaryCredit}, days=${splitSummaryDays}`);
        }
      }
    }
  }

  // AUTHORITATIVE: Trip Days from Crew Access (not computed from duty periods)
  // Trip Days = calendar days the trip spans, which can differ from duty period count
  const parsedTripDays = tripDaysMatch ? parseInt(tripDaysMatch[1]!) : (splitSummaryDays ? parseInt(splitSummaryDays) : null);

  // DEBUG: Log what we found for totals
  console.log("[CrewAccess] Totals parsing:");
  console.log(`  creditMatch: ${creditMatch?.[1] || 'NOT FOUND'}`);
  console.log(`  blockTotalMatch: ${blockTotalMatch?.[1] || 'NOT FOUND'}`);
  console.log(`  splitSummary: block=${splitSummaryBlock || 'NOT FOUND'}, credit=${splitSummaryCredit || 'NOT FOUND'}, days=${splitSummaryDays || 'NOT FOUND'}`);
  console.log(`  dutyTimeMatch: ${dutyTimeMatch?.[1] || 'NOT FOUND'}`);
  console.log(`  tafbMatch: ${tafbMatch?.[1] || 'NOT FOUND'}`);
  console.log(`  parsedTripDays: ${parsedTripDays ?? 'NOT FOUND'}`);

  const totals: ParsedTripTotals = {
    // Credit: prefer explicit "Credit Time:" match, then split summary
    creditMinutes: parseDurationToMinutes(creditMatch?.[1] ?? splitSummaryCredit ?? undefined),
    // Block: prefer explicit "Block Time:" match, then split summary
    blockMinutes: parseDurationToMinutes(blockTotalMatch?.[1] ?? splitSummaryBlock ?? undefined),
    tafbMinutes: parseDurationToMinutes(tafbMatch?.[1]),
    // AUTHORITATIVE: Duty Time from Crew Access - DO NOT compute
    dutyMinutes: parseDurationToMinutes(dutyTimeMatch?.[1]),
    perDiemCents: null,
    // AUTHORITATIVE: Use parsed Trip Days from Crew Access, not duty period count
    dutyDaysCount: dutyDays.length, // Actual duty periods parsed
    tripDaysCount: parsedTripDays ?? dutyDays.length,
  };

  // Compute block total from leg sums ONLY if not parsed from trip summary
  if (totals.blockMinutes === 0) {
    totals.blockMinutes = dutyDays.reduce((sum, dd) => sum + dd.dayBlockMinutes, 0);
    warnings.push("Block total computed from leg sums (Block Time not found in trip summary)");
  }

  // If credit time wasn't found in trip summary, sum from duty day credits (derived from Cnx column)
  // IMPORTANT: Credit is typically >= Block due to rigs/minimums, so this is a conservative fallback
  if (totals.creditMinutes === 0 && totals.blockMinutes > 0) {
    const summedCredit = dutyDays.reduce((sum, dd) => sum + dd.dayCreditMinutes, 0);
    if (summedCredit > 0) {
      totals.creditMinutes = summedCredit;
      warnings.push("Credit Time not found in trip summary - summed from per-duty Cnx values");
    } else {
      totals.creditMinutes = totals.blockMinutes;
      warnings.push("Credit Time not found in trip summary - using Block Time as fallback (may be understated)");
    }
  }

  return {
    tripId,
    base,
    tripStartDate,
    tripStartDateSource,
    // AUTHORITATIVE: Use parsed Trip Days from Crew Access, not computed duty period count
    tripDays: parsedTripDays ?? dutyDays.length,
    dutyDays,
    totals,
    hotels,
    confidence,
    warnings,
  };
}

// ============================================
// TRIP BOARD BROWSER PARSER (DARK THEME)
// ============================================

interface TripBoardBrowserParseResult {
  tripNumber: string | null;
  reportTime: string | null;
  dutyDays: ParsedDutyDay[];
  totals: ParsedTripTotals;
  confidence: number;
  warnings: string[];
}

export function parseTripBoardBrowser(ocrText: string): TripBoardBrowserParseResult {
  const warnings: string[] = [];
  let confidence = 0.8;

  // Extract Trip number (Trip 1234)
  const tripMatch = ocrText.match(/Trip\s+(\d{4,5})/i);
  const tripNumber = tripMatch ? `Trip ${tripMatch[1]}` : null;
  if (!tripNumber) {
    warnings.push("Could not extract Trip number");
    confidence -= 0.15;
  }

  // Extract report time (Report at (DD) HH:MM)
  const reportMatch = ocrText.match(
    /Report\s+at\s*\(?(\d+)?\)?\s*(\d{1,2}:\d{2})/i
  );
  const reportTime = reportMatch?.[2] ?? null;

  // Parse leg rows - DAY DH FLT EQP DEP (L)Z ARR (L)Z BLK DUTY CR L/O
  const dutyDays: ParsedDutyDay[] = [];
  let currentDutyDay: ParsedDutyDay | null = null;

  // Split into lines for line-by-line parsing
  const lines = ocrText.split("\n");

  for (const line of lines) {
    // Look for day code at start of line (FR13, SA14, etc.)
    const dayCodeMatch = line.match(/^([A-Z]{2}\d{1,2})/i);
    if (dayCodeMatch) {
      const parsed = parseDayCode(dayCodeMatch[1]!);
      if (parsed) {
        // Start new duty day
        if (currentDutyDay && currentDutyDay.legs.length > 0) {
          dutyDays.push(currentDutyDay);
        }
        currentDutyDay = {
          dutyDayIndex: dutyDays.length + 1,
          calendarDate: "",
          dayLabel: `${parsed.dayOfWeek}${parsed.dayOfMonth}`,
          dutyStartLocalTime: null,
          dutyEndLocalTime: null,
          dayBlockMinutes: 0,
          dayCreditMinutes: 0,
          dayDutyMinutes: null,
          legs: [],
          layoverToNextDay: null,
          confidence: 0.8,
          needsReview: false,
          warnings: [],
        };
      }
    }

    // Look for flight row pattern
    // DH? FLT EQP ORIGIN TIME DEST TIME BLK
    // Equipment: 76P, 76W, 75P, 75W (code format) OR 767, 757, 747, 777, MD11 (numeric format)
    const flightMatch = line.match(
      /(?:DH\s+)?(\d{3,4})?\s*(76[PW78]|75[PW7]|7[3567]7|MD11|MD\d{2}|74[78])?\s*([A-Z]{3})\s+(?:\([A-Z]{2}\d*\))?(\d{1,2}:\d{2})\s+([A-Z]{3})\s+(?:\([A-Z]{2}\d*\))?(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})?/i
    );

    if (flightMatch && currentDutyDay) {
      const [, flightNum, equipmentRaw, origin, depTime, dest, arrTime, block] =
        flightMatch;

      if (
        NON_AIRPORT_CODES.has(origin!.toUpperCase()) ||
        NON_AIRPORT_CODES.has(dest!.toUpperCase())
      ) {
        continue;
      }

      const isDeadhead = line.includes("DH") || !flightNum;

      let blockMinutes = parseDurationToMinutes(block);
      let blockSource: "parsed" | "computed" = "parsed";

      // Compute if missing
      if (blockMinutes === 0 && depTime && arrTime) {
        const dep = parseTime(depTime);
        const arr = parseTime(arrTime);
        if (dep && arr) {
          blockMinutes = computeBlockMinutes(dep, arr, "2000-01-01").blockMinutes;
          blockSource = "computed";
        }
      }

      // Normalize equipment code to readable aircraft type
      let normalizedEquip: string | null = null;
      if (equipmentRaw) {
        const eqUpper = equipmentRaw.toUpperCase();
        const equipMap: Record<string, string> = {
          '76P': '767', '76W': '767', '768': '767', '767': '767',
          '75P': '757', '75W': '757', '757': '757',
          '74F': '747', '744': '747', '747': '747', '748': '747-8',
          '77F': '777', '77W': '777', '777': '777',
          '73F': '737', '738': '737', '737': '737',
          'MD11': 'MD11',
        };
        normalizedEquip = equipMap[eqUpper] ?? eqUpper;
      }

      const leg: ParsedLeg = {
        legSeq: currentDutyDay.legs.length + 1,
        flightNumber: flightNum ?? null,
        position: null,
        dhFlag: isDeadhead,
        equipment: normalizedEquip,
        depAirport: origin!.toUpperCase(),
        arrAirport: dest!.toUpperCase(),
        depLocalTime: parseTime(depTime!) ?? depTime!,
        arrLocalTime: parseTime(arrTime!) ?? arrTime!,
        depDisplayTime: parseTime(depTime!) ?? depTime!,
        arrDisplayTime: parseTime(arrTime!) ?? arrTime!,
        blockMinutes,
        blockSource,
        rawRowText: line,
        confidence: blockSource === "parsed" ? 0.85 : 0.7,
        needsReview: blockSource === "computed",
        warnings:
          blockSource === "computed" ? ["Block time computed from times"] : [],
      };

      currentDutyDay.legs.push(leg);
      currentDutyDay.dayBlockMinutes += blockMinutes;

      // Track duty times
      if (!currentDutyDay.dutyStartLocalTime) {
        currentDutyDay.dutyStartLocalTime = leg.depLocalTime;
      }
      currentDutyDay.dutyEndLocalTime = leg.arrLocalTime;
    }

    // Look for L/O (layover) value
    const layoverMatch = line.match(/L\/O[:\s]+(\d+:\d{2})/i);
    if (layoverMatch && currentDutyDay) {
      const layoverMinutes = parseDurationToMinutes(layoverMatch[1]);
      const lastLeg = currentDutyDay.legs[currentDutyDay.legs.length - 1];
      if (lastLeg) {
        currentDutyDay.layoverToNextDay = {
          layoverStation: lastLeg.arrAirport,
          layoverMinutes,
          restMinutes: null,
          hotelName: null,
          hotelPhone: null,
          hotelStatus: null,
          hotelTransport: null,
          confidence: 0.8,
          needsReview: false,
        };
      }
    }
  }

  // Push final duty day
  if (currentDutyDay && currentDutyDay.legs.length > 0) {
    dutyDays.push(currentDutyDay);
  }

  // Extract totals from footer
  const creditMatch = ocrText.match(/Credit[:\s]+(\d+:\d{2})/i);
  const blockMatch = ocrText.match(/Blk[:\s]+(\d+:\d{2})/i);
  const tafbMatch = ocrText.match(/TAFB[:\s]+(\d+:\d{2})/i);
  const ldgsMatch = ocrText.match(/Ldgs[:\s]+(\d+)/i);

  // Trip Board Browser doesn't have explicit Duty Time - compute from duty periods
  const computedDutyMinutes = dutyDays.reduce((sum, dd) => sum + (dd.dayDutyMinutes || 0), 0);

  const totals: ParsedTripTotals = {
    creditMinutes: parseDurationToMinutes(creditMatch?.[1]),
    blockMinutes: parseDurationToMinutes(blockMatch?.[1]),
    tafbMinutes: parseDurationToMinutes(tafbMatch?.[1]),
    dutyMinutes: computedDutyMinutes, // Computed for Trip Board Browser
    perDiemCents: null,
    dutyDaysCount: dutyDays.length,
    tripDaysCount: dutyDays.length, // Trip Board Browser doesn't provide Trip Days
  };

  // Compute if missing
  if (totals.blockMinutes === 0) {
    totals.blockMinutes = dutyDays.reduce((sum, dd) => sum + dd.dayBlockMinutes, 0);
  }

  return {
    tripNumber,
    reportTime,
    dutyDays,
    totals,
    confidence,
    warnings,
  };
}

// ============================================
// TRIP BOARD TRIP DETAILS PARSER (WHITE TABLE)
// ============================================

interface TripBoardDetailsParseResult {
  tripId: string | null;
  baseFleet: string | null;
  dutyDays: ParsedDutyDay[];
  totals: ParsedTripTotals;
  confidence: number;
  warnings: string[];
}

export function parseTripBoardDetails(ocrText: string): TripBoardDetailsParseResult {
  const warnings: string[] = [];
  let confidence = 0.8;

  // Extract Trip ID (S5055 format)
  const tripIdMatch = ocrText.match(/Trip\s+Details\s*[-–]\s*([A-Z]?\d{4,5})/i);
  const tripId = tripIdMatch?.[1] ?? null;
  if (!tripId) {
    // Try alternate pattern
    const altMatch = ocrText.match(/([A-Z]\d{4,5})\s*[-–]\s*[A-Z]{3}/);
    if (altMatch) {
      // tripId found via alternate
    } else {
      warnings.push("Could not extract Trip ID");
      confidence -= 0.15;
    }
  }

  // Extract base/fleet (SDF 757)
  // Equipment: 76P, 76W, 75P, 75W (code format) OR 767, 757, 747, 777, MD11 (numeric format)
  const baseFleetMatch = ocrText.match(
    /[-–]\s*([A-Z]{3})\s+(7[3567]7|76[PW78]|75[PW7]|MD11|MD\d{2})/i
  );
  const baseFleet = baseFleetMatch
    ? `${baseFleetMatch[1]} ${baseFleetMatch[2]}`
    : null;

  const dutyDays: ParsedDutyDay[] = [];
  let currentDutyDay: ParsedDutyDay | null = null;

  // Parse line by line
  const lines = ocrText.split("\n");

  for (const line of lines) {
    // Look for date column (M/DD/YY format)
    const dateMatch = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
    if (dateMatch) {
      const month = dateMatch[1]!.padStart(2, "0");
      const day = dateMatch[2]!.padStart(2, "0");
      const year = `20${dateMatch[3]}`;
      const calendarDate = `${year}-${month}-${day}`;

      // Check if new duty day
      if (!currentDutyDay || currentDutyDay.calendarDate !== calendarDate) {
        if (currentDutyDay && currentDutyDay.legs.length > 0) {
          dutyDays.push(currentDutyDay);
        }
        currentDutyDay = {
          dutyDayIndex: dutyDays.length + 1,
          calendarDate,
          dayLabel: "",
          dutyStartLocalTime: null,
          dutyEndLocalTime: null,
          dayBlockMinutes: 0,
          dayCreditMinutes: 0,
          dayDutyMinutes: null,
          legs: [],
          layoverToNextDay: null,
          confidence: 0.8,
          needsReview: false,
          warnings: [],
        };
      }
    }

    // Look for flight row
    // Eqp Date Pairing Flt Pos Dep (L) Z Arr (L) Z Blk
    // Pattern for Trip Details format with (LocalHour)ZuluTime
    // Equipment: 76P, 76W, 75P, 75W (code format) OR 767, 757, 747, 777, MD11 (numeric format)
    const flightMatch = line.match(
      /(76[PW78]|75[PW7]|7[3567]7|MD11|MD\d{2})?\s*(?:DH|CML)?\s*(\d{3,4})?\s*(CPT|FO)?\s*([A-Z]{3})\s+\((\d{1,2})\)(\d{1,2}:\d{2})\s+([A-Z]{3})\s+\((\d{1,2})\)(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})?/i
    );

    if (flightMatch && currentDutyDay) {
      const [
        ,
        equipmentCode,
        flightNum,
        position,
        origin,
        depLocalHour,
        depZulu,
        dest,
        arrLocalHour,
        arrZulu,
        block,
      ] = flightMatch;

      if (
        NON_AIRPORT_CODES.has(origin!.toUpperCase()) ||
        NON_AIRPORT_CODES.has(dest!.toUpperCase())
      ) {
        continue;
      }

      // Extract LOCAL time from the (LocalHour) prefix
      const depMinutes = depZulu!.split(":")[1] ?? "00";
      const arrMinutes = arrZulu!.split(":")[1] ?? "00";
      const depLocalTime = `${depLocalHour!.padStart(2, "0")}:${depMinutes}`;
      const arrLocalTime = `${arrLocalHour!.padStart(2, "0")}:${arrMinutes}`;

      const isDeadhead = line.includes("DH") || line.includes("CML");

      let blockMinutes = parseDurationToMinutes(block);
      let blockSource: "parsed" | "computed" = "parsed";

      if (blockMinutes === 0) {
        blockMinutes = computeBlockMinutes(
          depLocalTime,
          arrLocalTime,
          "2000-01-01"
        ).blockMinutes;
        blockSource = "computed";
      }

      // Normalize equipment code to readable aircraft type
      let normalizedEquipment: string | null = null;
      if (equipmentCode) {
        const eqUpper = equipmentCode.toUpperCase();
        const equipmentMap: Record<string, string> = {
          '76P': '767', '76W': '767', '768': '767', '767': '767',
          '75P': '757', '75W': '757', '757': '757',
          '74F': '747', '744': '747', '747': '747', '748': '747-8',
          '77F': '777', '77W': '777', '777': '777',
          '73F': '737', '738': '737', '737': '737',
          'MD11': 'MD11',
        };
        normalizedEquipment = equipmentMap[eqUpper] ?? eqUpper;
      }

      const leg: ParsedLeg = {
        legSeq: currentDutyDay.legs.length + 1,
        flightNumber: flightNum ?? null,
        position: position ?? null,
        dhFlag: isDeadhead,
        equipment: normalizedEquipment,
        depAirport: origin!.toUpperCase(),
        arrAirport: dest!.toUpperCase(),
        depLocalTime,
        arrLocalTime,
        depDisplayTime: depLocalTime,
        arrDisplayTime: arrLocalTime,
        blockMinutes,
        blockSource,
        rawRowText: line,
        confidence: blockSource === "parsed" ? 0.85 : 0.7,
        needsReview: blockSource === "computed",
        warnings:
          blockSource === "computed" ? ["Block time computed from times"] : [],
      };

      currentDutyDay.legs.push(leg);
      currentDutyDay.dayBlockMinutes += blockMinutes;

      if (!currentDutyDay.dutyStartLocalTime) {
        currentDutyDay.dutyStartLocalTime = depLocalTime;
      }
      currentDutyDay.dutyEndLocalTime = arrLocalTime;
    }
  }

  // Push final duty day
  if (currentDutyDay && currentDutyDay.legs.length > 0) {
    dutyDays.push(currentDutyDay);
  }

  // Extract totals
  const creditMatch = ocrText.match(/Credit[:\s]+(\d+:\d{2})/i);
  const blockMatch = ocrText.match(/Blk[:\s]+(\d+:\d{2})/i);
  const tafbMatch = ocrText.match(/TAFB[:\s]+(\d+:\d{2})/i);
  const dutyDaysMatch = ocrText.match(/Duty\s+Days[:\s]+(\d+)/i);
  const pdiemMatch = ocrText.match(/PDiem[:\s]+\$?([\d.]+)/i);

  // Trip Board Details doesn't have explicit total Duty Time - compute from duty periods
  const computedDutyMinutes = dutyDays.reduce((sum, dd) => sum + (dd.dayDutyMinutes || 0), 0);
  const parsedDutyDays = dutyDaysMatch ? parseInt(dutyDaysMatch[1]!) : dutyDays.length;

  const totals: ParsedTripTotals = {
    creditMinutes: parseDurationToMinutes(creditMatch?.[1]),
    blockMinutes: parseDurationToMinutes(blockMatch?.[1]),
    tafbMinutes: parseDurationToMinutes(tafbMatch?.[1]),
    dutyMinutes: computedDutyMinutes, // Computed for Trip Board Details
    perDiemCents: pdiemMatch ? Math.round(parseFloat(pdiemMatch[1]!) * 100) : null,
    dutyDaysCount: parsedDutyDays,
    tripDaysCount: parsedDutyDays, // Use Duty Days as Trip Days for this format
  };

  if (totals.blockMinutes === 0) {
    totals.blockMinutes = dutyDays.reduce((sum, dd) => sum + dd.dayBlockMinutes, 0);
  }

  return {
    tripId,
    baseFleet,
    dutyDays,
    totals,
    confidence,
    warnings,
  };
}

// ============================================
// VALIDATION GATE
// ============================================

export function validateParsedTrip(trip: ParsedTrip): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let confidence = trip.ocrConfidence;

  // REQUIRED: Trip ID must exist
  if (!trip.tripId) {
    errors.push("Trip ID is missing");
  }

  // REQUIRED: At least 1 leg
  const totalLegs = trip.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0);
  if (totalLegs === 0) {
    errors.push("No flight legs parsed");
  }

  // REQUIRED: Each leg must have dep/arr airports and times
  for (const dutyDay of trip.dutyDays) {
    for (const leg of dutyDay.legs) {
      if (!leg.depAirport || !leg.arrAirport) {
        errors.push(
          `Leg ${leg.legSeq} missing airport codes: ${leg.depAirport ?? "?"} -> ${leg.arrAirport ?? "?"}`
        );
      }
      if (!leg.depLocalTime || !leg.arrLocalTime) {
        errors.push(`Leg ${leg.legSeq} missing departure or arrival time`);
      }
      // Block should not be 0 if times exist
      if (leg.blockMinutes === 0 && leg.depLocalTime && leg.arrLocalTime) {
        warnings.push(
          `Leg ${leg.legSeq} has 0:00 block time - verify ${leg.depLocalTime} -> ${leg.arrLocalTime}`
        );
        leg.needsReview = true;
        confidence -= 0.05;
      }
    }
  }

  // VALIDATE: Totals should roughly match computed sums (tolerance 15 minutes)
  const computedBlock = trip.dutyDays.reduce(
    (sum, dd) => sum + dd.dayBlockMinutes,
    0
  );
  if (trip.totals.blockMinutes > 0 && computedBlock > 0) {
    const diff = Math.abs(trip.totals.blockMinutes - computedBlock);
    if (diff > 15) {
      warnings.push(
        `Block total mismatch: parsed ${formatMinutesAsDuration(trip.totals.blockMinutes)} vs computed ${formatMinutesAsDuration(computedBlock)}`
      );
      confidence -= 0.1;
    }
  }

  // VALIDATE: Check for low confidence fields
  for (const dutyDay of trip.dutyDays) {
    for (const leg of dutyDay.legs) {
      if (leg.confidence < 0.7) {
        warnings.push(
          `Low confidence on leg ${leg.legSeq}: ${leg.depAirport}-${leg.arrAirport}`
        );
      }
    }
  }

  // Overall confidence adjustment
  if (errors.length > 0) {
    confidence = Math.min(confidence, 0.4);
  } else if (warnings.length > 3) {
    confidence = Math.min(confidence, 0.6);
  }

  return {
    isValid: errors.length === 0,
    canImport: errors.length === 0 || confidence >= 0.5,
    errors,
    warnings,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

// ============================================
// MAIN PARSE FUNCTION
// ============================================

export interface ParseScheduleResult {
  trip: ParsedTrip | null;
  templateType: TemplateType;
  templateConfidence: number;
  validation: ImportValidationResult;
  rawOcrText: string;
  // Debug info for verification (PHASE 7)
  debugInfo: {
    parserVersion: string;
    localTimeSource: string; // "LT" for Start(LT)/End(LT) columns, "computed" if derived
    dutyGroupingSource: string; // "dutyMarkers" for Duty totals rows, "calendar" for day-based
    totalsSource: {
      blockMinutes: string; // "trip_summary" or "computed"
      creditMinutes: string;
      dutyMinutes: string;
      tafbMinutes: string;
      tripDays: string;
    };
    perDutyTotals: Array<{
      dutyIndex: number;
      blockSource: string;
      creditSource: string;
      dutySource: string;
    }>;
  };
}

export function parseScheduleFromOCRText(
  ocrText: string,
  imageUrls: string[] = [],
  baseDate?: string
): ParseScheduleResult {
  // Helper to create default debug info
  const createDefaultDebugInfo = () => ({
    parserVersion: "2.1.1",
    localTimeSource: "unknown",
    dutyGroupingSource: "unknown",
    totalsSource: {
      blockMinutes: "unknown",
      creditMinutes: "unknown",
      dutyMinutes: "unknown",
      tafbMinutes: "unknown",
      tripDays: "unknown",
    },
    perDutyTotals: [],
  });

  // Step 1: Detect template type
  const detection = detectTemplate(ocrText);

  if (detection.templateType === "unknown" || detection.confidence < 0.4) {
    return {
      trip: null,
      templateType: detection.templateType,
      templateConfidence: detection.confidence,
      validation: {
        isValid: false,
        canImport: false,
        errors: ["Could not identify schedule format"],
        warnings: detection.warnings,
        confidence: detection.confidence,
      },
      rawOcrText: ocrText,
      debugInfo: createDefaultDebugInfo(),
    };
  }

  // Step 2: Parse based on detected template
  let parsedTrip: ParsedTrip;

  try {
    switch (detection.templateType) {
      case "crew_access_trip_info": {
        const result = parseCrewAccessTripInfo(ocrText, baseDate);

        // Use tripStartDate from Trip Id line (authoritative), fallback to first duty day
        const tripStart = result.tripStartDate ?? result.dutyDays[0]?.calendarDate ?? "";
        const tripEnd = result.dutyDays[result.dutyDays.length - 1]?.calendarDate ?? tripStart;

        // Add debug info about date source
        if (result.tripStartDateSource !== "trip_id_line") {
          result.warnings.push(`Trip start date source: ${result.tripStartDateSource} (preferred: trip_id_line)`);
        }

        parsedTrip = {
          tripId: result.tripId ?? `UNKNOWN-${Date.now()}`,
          base: result.base,
          status: "scheduled",
          variantTag: null,
          tripStartDate: tripStart,
          tripEndDate: tripEnd,
          // AUTHORITATIVE: Use parsed Trip Days from Crew Access, not computed duty period count
          tripDaysCount: result.tripDays ?? result.dutyDays.length,
          totals: result.totals,
          dutyDays: result.dutyDays,
          sourceType: "crew_access_trip_info",
          sourceFiles: imageUrls,
          ocrConfidence: result.confidence,
          importVersion: "2.1.1", // Updated version for Trip Days fix
          needsReview: result.warnings.length > 0,
          validationErrors: [],
          validationWarnings: result.warnings,
        };
        break;
      }
      case "trip_board_browser": {
        const result = parseTripBoardBrowser(ocrText);
        parsedTrip = {
          tripId: result.tripNumber ?? `UNKNOWN-${Date.now()}`,
          base: null,
          status: "scheduled",
          variantTag: null,
          tripStartDate: result.dutyDays[0]?.calendarDate ?? "",
          tripEndDate: result.dutyDays[result.dutyDays.length - 1]?.calendarDate ?? "",
          tripDaysCount: result.dutyDays.length,
          totals: result.totals,
          dutyDays: result.dutyDays,
          sourceType: "trip_board_browser",
          sourceFiles: imageUrls,
          ocrConfidence: result.confidence,
          importVersion: "2.0.0",
          needsReview: result.warnings.length > 0,
          validationErrors: [],
          validationWarnings: result.warnings,
        };
        break;
      }
      case "trip_board_trip_details": {
        const result = parseTripBoardDetails(ocrText);
        parsedTrip = {
          tripId: result.tripId ?? `UNKNOWN-${Date.now()}`,
          base: result.baseFleet?.split(" ")[0] ?? null,
          status: "scheduled",
          variantTag: null,
          tripStartDate: result.dutyDays[0]?.calendarDate ?? "",
          tripEndDate: result.dutyDays[result.dutyDays.length - 1]?.calendarDate ?? "",
          tripDaysCount: result.dutyDays.length,
          totals: result.totals,
          dutyDays: result.dutyDays,
          sourceType: "trip_board_trip_details",
          sourceFiles: imageUrls,
          ocrConfidence: result.confidence,
          importVersion: "2.0.0",
          needsReview: result.warnings.length > 0,
          validationErrors: [],
          validationWarnings: result.warnings,
        };
        break;
      }
      default:
        throw new Error(`Unsupported template type: ${detection.templateType}`);
    }
  } catch (error) {
    console.error("[ParseSchedule] Error parsing schedule:", error);
    return {
      trip: null,
      templateType: detection.templateType,
      templateConfidence: detection.confidence,
      validation: {
        isValid: false,
        canImport: false,
        errors: [`Parse error: ${error instanceof Error ? error.message : "Unknown error"}`],
        warnings: detection.warnings,
        confidence: 0,
      },
      rawOcrText: ocrText,
      debugInfo: createDefaultDebugInfo(),
    };
  }

  // Step 3: Validate parsed trip
  const validation = validateParsedTrip(parsedTrip);
  parsedTrip.validationErrors = validation.errors;
  parsedTrip.validationWarnings = [...parsedTrip.validationWarnings, ...validation.warnings];
  parsedTrip.ocrConfidence = validation.confidence;

  if (!validation.isValid) {
    parsedTrip.status = "review_required";
    parsedTrip.needsReview = true;
  }

  // Build debug info for verification (PHASE 7)
  const debugInfo = {
    parserVersion: "2.1.1",
    localTimeSource: detection.templateType === "crew_access_trip_info" ? "LT" : "computed",
    dutyGroupingSource: detection.templateType === "crew_access_trip_info" ? "dutyMarkers" : "calendar",
    totalsSource: {
      blockMinutes: parsedTrip.totals.blockMinutes > 0 ? "trip_summary" : "computed",
      creditMinutes: parsedTrip.totals.creditMinutes > 0 ? "trip_summary" : "computed",
      dutyMinutes: parsedTrip.totals.dutyMinutes > 0 ? "trip_summary" : "computed",
      tafbMinutes: parsedTrip.totals.tafbMinutes > 0 ? "trip_summary" : "computed",
      tripDays: parsedTrip.tripDaysCount > 0 ? "trip_summary" : "computed",
    },
    perDutyTotals: parsedTrip.dutyDays.map((dd, idx) => ({
      dutyIndex: idx + 1,
      blockSource: dd.dayBlockMinutes > 0 ? "duty_totals_row" : "computed",
      creditSource: dd.dayCreditMinutes > 0 ? "duty_totals_row" : "computed",
      dutySource: dd.dayDutyMinutes ? "duty_totals_row" : "computed",
    })),
  };

  return {
    trip: parsedTrip,
    templateType: detection.templateType,
    templateConfidence: detection.confidence,
    validation,
    rawOcrText: ocrText,
    debugInfo,
  };
}
