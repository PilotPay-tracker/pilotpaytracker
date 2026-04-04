/**
 * Schedule Parser Module
 * Converts OCR text into structured airline schedule data
 * Supports: Trip Board Browser, Trip Board Trip Details, Crew Access Trip Info
 */

import type { OCRResult, OCRLine } from "./ocr-engine";

// ============================================
// Types
// ============================================

export type SourceType =
  | "trip_board_browser"
  | "trip_board_trip_details"
  | "crew_access_trip_info"
  | "crew_access_enrichment_only"
  | "enrichment_only"
  | "unknown";

export type ParseClassification =
  | "full_schedule"      // Has flights/legs - can build timeline
  | "enrichment_only"    // Only hotel/transport - attach to existing trip
  | "incomplete";        // Missing required data

export interface ParsedField<T> {
  value: T;
  confidence: number;
  rawText?: string;
}

export interface ParsedEvent {
  eventType: ParsedField<string>;
  date?: ParsedField<string>;
  startTime?: ParsedField<string>;
  endTime?: ParsedField<string>;
  depAirport?: ParsedField<string>;
  arrAirport?: ParsedField<string>;
  flightNumber?: ParsedField<string>;
  equipment?: ParsedField<string>;
  blockMinutes?: ParsedField<number>;
  creditMinutes?: ParsedField<number>;
  dutyMinutes?: ParsedField<number>;
  layoverMinutes?: ParsedField<number>;
  hotelName?: ParsedField<string>;
  hotelPhone?: ParsedField<string>;
  hotelBooked?: ParsedField<boolean>;
  hotelAddress?: ParsedField<string>;
  transportNotes?: ParsedField<string>;
  transportPhone?: ParsedField<string>;
  isDeadhead?: ParsedField<boolean>;
  rawCreditText?: ParsedField<string>;
}

export interface ParsedTotals {
  creditMinutes?: ParsedField<number>;
  blockMinutes?: ParsedField<number>;
  tafbMinutes?: ParsedField<number>;
  dutyDays?: ParsedField<number>;
  restMinutes?: ParsedField<number>;
  perDiemCents?: ParsedField<number>;
}

export interface ParsedSchedule {
  sourceType: ParsedField<SourceType>;
  classification: ParseClassification;
  tripNumber?: ParsedField<string>;
  pairingId?: ParsedField<string>;
  baseFleet?: ParsedField<string>;
  startDate?: ParsedField<string>;
  endDate?: ParsedField<string>;
  reportTime?: ParsedField<string>;
  events: ParsedEvent[];
  totals: ParsedTotals;
  hotels: Array<{
    name: ParsedField<string>;
    phone?: ParsedField<string>;
    booked?: ParsedField<boolean>;
    layoverAirport?: ParsedField<string>;
    address?: ParsedField<string>;
  }>;
  transport: Array<{
    notes: ParsedField<string>;
    phone?: ParsedField<string>;
    layoverAirport?: ParsedField<string>;
  }>;
  overallConfidence: number;
  lowConfidenceFields: string[];
  rawText: string;
  hasFlightLegs: boolean;
  hasHotelInfo: boolean;
  hasTransportInfo: boolean;
}

// ============================================
// Constants
// ============================================

// Airport code pattern (3 uppercase letters)
const AIRPORT_PATTERN = /\b([A-Z]{3})\b/g;

// Time patterns (HH:MM format)
const TIME_PATTERN = /\b(\d{1,2}):(\d{2})\b/g;

// Flight number patterns
const FLIGHT_NUMBER_PATTERN = /\b(\d{3,4})\b/;

// Duration patterns (H:MM or HH:MM)
const DURATION_PATTERN = /\b(\d{1,2}):(\d{2})\b/;

// Date patterns
const DATE_PATTERN_MDY = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/; // MM/DD or MM/DD/YY
const DATE_PATTERN_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/; // YYYY-MM-DD

// Trip identifiers
const TRIP_NUMBER_PATTERN = /Trip\s+(\d+)/i;
const PAIRING_ID_PATTERN = /\b([A-Z]\d{4,5})\b/;

// Equipment patterns
const EQUIPMENT_PATTERN = /\b(7[3567]7|76[78]|MD\d{2}|A3[0-9]{2}|E1[79]0)\b/i;

// Phone number patterns
const PHONE_PATTERN = /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/;

// ============================================
// UTC Date Helpers
// ============================================

/**
 * Create a UTC date string (YYYY-MM-DD) from year, month (0-indexed), day
 * This avoids timezone issues when creating dates from parsed values
 */
function createUTCDateString(year: number, month: number, day: number): string {
  const paddedMonth = String(month + 1).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${year}-${paddedMonth}-${paddedDay}`;
}

/**
 * Add days to a date string and return new date string (YYYY-MM-DD)
 * Handles month/year rollovers correctly using UTC
 */
function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return dateString;
  }
  // Create a UTC date to avoid timezone issues
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return utcDate.toISOString().split('T')[0]!;
}

// ============================================
// Source Type Classification
// ============================================

/**
 * Classify the source type based on OCR text content
 */
export function classifySourceType(ocrText: string): ParsedField<SourceType> {
  const textLower = ocrText.toLowerCase();
  let confidence = 0.5;
  let sourceType: SourceType = "unknown";

  // Crew Access Trip Information markers
  const crewAccessMarkers = [
    "trip information",
    "hotel details",
    "hotel transport",
    "crew access",
    "trip id:",
  ];
  const crewAccessScore = crewAccessMarkers.filter((m) =>
    textLower.includes(m)
  ).length;

  // Trip Board Trip Details markers (table view)
  const tripDetailsMarkers = [
    "trip details",
    "eqp",
    "pairing",
    "flt",
    "pos",
    "blk",
    "duty",
    "cr",
    "l/o",
  ];
  const tripDetailsScore = tripDetailsMarkers.filter((m) =>
    textLower.includes(m)
  ).length;

  // Trip Board Browser markers (pairing view)
  const browserMarkers = [
    "browser",
    "pairing view",
    "report at",
    "trip ",
    "day ",
  ];
  const browserScore = browserMarkers.filter((m) =>
    textLower.includes(m)
  ).length;

  // Determine source type based on scores
  if (crewAccessScore >= 2) {
    sourceType = "crew_access_trip_info";
    confidence = Math.min(0.95, 0.6 + crewAccessScore * 0.1);
  } else if (tripDetailsScore >= 4) {
    sourceType = "trip_board_trip_details";
    confidence = Math.min(0.95, 0.5 + tripDetailsScore * 0.08);
  } else if (browserScore >= 2) {
    sourceType = "trip_board_browser";
    confidence = Math.min(0.95, 0.5 + browserScore * 0.1);
  } else {
    // Default based on structure
    if (textLower.includes("report") && textLower.includes("trip")) {
      sourceType = "trip_board_browser";
      confidence = 0.6;
    }
  }

  return { value: sourceType, confidence };
}

// ============================================
// Time and Duration Parsing
// ============================================

/**
 * Parse time string to minutes since midnight
 */
function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  return hours * 60 + mins;
}

/**
 * Parse duration string to total minutes
 */
function parseDurationToMinutes(durStr: string): number {
  const match = durStr.match(/(\d+):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  return hours * 60 + mins;
}

/**
 * Extract all times from a text string
 */
function extractTimes(text: string): Array<{ time: string; position: number }> {
  const results: Array<{ time: string; position: number }> = [];
  const regex = /\b(\d{1,2}:\d{2})\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      results.push({ time: match[1], position: match.index });
    }
  }
  return results;
}

/**
 * Extract all airport codes from text
 */
function extractAirports(
  text: string
): Array<{ code: string; position: number }> {
  const results: Array<{ code: string; position: number }> = [];
  const regex = /\b([A-Z]{3})\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    // Filter out common non-airport 3-letter sequences
    const code = match[1];
    const nonAirportCodes = [
      "THE",
      "AND",
      "FOR",
      "ARE",
      "BUT",
      "NOT",
      "YOU",
      "ALL",
      "CAN",
      "HAD",
      "HER",
      "WAS",
      "ONE",
      "OUR",
      "OUT",
      "DAY",
      "GET",
      "HAS",
      "HIM",
      "HIS",
      "HOW",
      "ITS",
      "LET",
      "MAY",
      "NEW",
      "NOW",
      "OLD",
      "SEE",
      "WAY",
      "WHO",
      "BOY",
      "DID",
      "EQP",
      "FLT",
      "POS",
      "BLK",
      "DHD",
      "CML",
    ];
    if (code && !nonAirportCodes.includes(code)) {
      results.push({ code, position: match.index });
    }
  }
  return results;
}

// ============================================
// Flight Row Parsing
// ============================================

/**
 * Parse a potential flight row from OCR text
 * Handles formats like: "1234 SAT 06:06 DFW 08:30 2:24"
 */
function parseFlightRow(line: string, lineConfidence: number): ParsedEvent | null {
  const airports = extractAirports(line);
  const times = extractTimes(line);

  // Need at least 2 airports (dep/arr) and 2 times to be a flight
  if (airports.length < 2 || times.length < 2) {
    return null;
  }

  // Look for flight number
  const flightMatch = line.match(/\b(\d{3,4})\b/);
  const flightNumber = flightMatch ? flightMatch[1] : undefined;

  // Check for deadhead indicators
  const isDeadhead =
    /\b(DH|DHD|DEADHEAD)\b/i.test(line) || /\bDH\s*\d{3,4}\b/i.test(line);

  // Extract block time (usually 3rd time if present)
  let blockMinutes: number | undefined;
  if (times.length >= 3 && times[2]) {
    blockMinutes = parseDurationToMinutes(times[2].time);
  }

  // Extract credit (usually has 'L' suffix for local)
  const creditMatch = line.match(/(\d{1,2}:\d{2})\s*L?\b/i);
  let creditMinutes: number | undefined;
  let rawCreditText: string | undefined;
  if (creditMatch && creditMatch[1]) {
    creditMinutes = parseDurationToMinutes(creditMatch[1]);
    rawCreditText = creditMatch[0];
  }

  // Extract equipment
  const equipMatch = line.match(EQUIPMENT_PATTERN);
  const equipment = equipMatch && equipMatch[1] ? equipMatch[1].toUpperCase() : undefined;

  const baseConfidence = lineConfidence / 100;

  // We already checked that airports.length >= 2 and times.length >= 2
  const depAirport = airports[0]!;
  const arrAirport = airports[1]!;
  const startTime = times[0]!;
  const endTime = times[1]!;

  return {
    eventType: {
      value: isDeadhead ? "DEADHEAD" : "FLIGHT",
      confidence: baseConfidence * 0.9,
    },
    depAirport: {
      value: depAirport.code,
      confidence: baseConfidence * 0.95,
    },
    arrAirport: {
      value: arrAirport.code,
      confidence: baseConfidence * 0.95,
    },
    startTime: {
      value: startTime.time,
      confidence: baseConfidence * 0.9,
    },
    endTime: {
      value: endTime.time,
      confidence: baseConfidence * 0.9,
    },
    flightNumber: flightNumber
      ? {
          value: flightNumber,
          confidence: baseConfidence * 0.85,
        }
      : undefined,
    equipment: equipment
      ? {
          value: equipment,
          confidence: baseConfidence * 0.8,
        }
      : undefined,
    blockMinutes: blockMinutes
      ? {
          value: blockMinutes,
          confidence: baseConfidence * 0.85,
        }
      : undefined,
    creditMinutes: creditMinutes
      ? {
          value: creditMinutes,
          confidence: baseConfidence * 0.8,
        }
      : undefined,
    rawCreditText: rawCreditText
      ? {
          value: rawCreditText,
          confidence: baseConfidence * 0.9,
        }
      : undefined,
    isDeadhead: {
      value: isDeadhead,
      confidence: baseConfidence * 0.95,
    },
  };
}

// ============================================
// Hotel/Transport Parsing
// ============================================

/**
 * Parse hotel information from text
 *
 * ENHANCED: Handles multiple formats including Crew Access Hotel details
 * - "Hotel details Status: BOOKED Hotel: Florida Hotel Orlando Phone: 407-859-1000"
 * - "Hotel: Marriott Downtown"
 * - Hotel brand names (Marriott, Hilton, etc.)
 */
function parseHotelInfo(
  text: string,
  confidence: number
): Array<{
  name: ParsedField<string>;
  phone?: ParsedField<string>;
  booked?: ParsedField<boolean>;
  layoverAirport?: ParsedField<string>;
  address?: ParsedField<string>;
}> {
  const hotels: Array<{
    name: ParsedField<string>;
    phone?: ParsedField<string>;
    booked?: ParsedField<boolean>;
    layoverAirport?: ParsedField<string>;
    address?: ParsedField<string>;
  }> = [];

  const confBase = confidence / 100;

  // ============================================
  // Strategy 1: Crew Access "Hotel details" format (HIGHEST PRIORITY)
  // Format: "Hotel details Status: BOOKED Hotel: [Name] Phone: [Phone]"
  // or: "Hotel details Status: BOOKED Hotel: [Name] Address: [Address] Phone: [Phone]"
  // ============================================
  const crewAccessHotelPattern = /Hotel\s+details\s+(?:Status[:\s]*(BOOKED|PENDING|TBD|CONFIRMED|NOT BOOKED))?\s*Hotel[:\s]*([^\n]+?)(?:\s+Address[:\s]*([^\n]+?))?(?:\s+Phone[:\s]*([0-9\-.\s()]+))?(?:\s*(?:Hotel Transport|Transport)|$)/gi;
  let crewAccessMatch;
  while ((crewAccessMatch = crewAccessHotelPattern.exec(text)) !== null) {
    const status = crewAccessMatch[1]?.trim();
    let hotelName = crewAccessMatch[2]?.trim() || "";
    const address = crewAccessMatch[3]?.trim();
    const phone = crewAccessMatch[4]?.trim().replace(/[-.\s()]/g, "");

    // Clean up hotel name - remove trailing "Address:" if OCR ran together
    hotelName = hotelName.replace(/\s*Address[:\s]*.*$/i, "").trim();

    if (hotelName.length > 3) {
      console.log(`  [HotelParser] Crew Access match: "${hotelName}" Status=${status} Phone=${phone || 'N/A'}`);

      // Find the nearest airport code before this hotel entry
      // Look for the last route (XXX-YYY) before this position
      const textBefore = text.substring(0, crewAccessMatch.index);
      const lastRouteMatch = [...textBefore.matchAll(/([A-Z]{3})-([A-Z]{3})/g)].pop();
      const layoverAirport = lastRouteMatch?.[2]; // Arrival airport of last leg

      hotels.push({
        name: { value: hotelName, confidence: confBase * 0.95 },
        phone: phone ? { value: phone, confidence: confBase * 0.9 } : undefined,
        booked: { value: status?.toUpperCase() === "BOOKED", confidence: confBase * 0.95 },
        layoverAirport: layoverAirport ? { value: layoverAirport, confidence: confBase * 0.85 } : undefined,
        address: address ? { value: address, confidence: confBase * 0.85 } : undefined,
      });
    }
  }

  // ============================================
  // Strategy 2: Simple "Hotel: [Name]" pattern
  // ============================================
  const simpleHotelPattern = /Hotel[:\s]+(?!details|Transport)([^\n]+?)(?:\s+(?:BOOKED|Phone|Transport|Status)|\n|$)/gi;
  let simpleMatch;
  while ((simpleMatch = simpleHotelPattern.exec(text)) !== null) {
    let hotelName = simpleMatch[1]?.trim() || "";

    // Skip if we already captured this from Crew Access pattern
    if (hotels.some(h => h.name.value.toLowerCase() === hotelName.toLowerCase())) continue;
    // Skip if it's just "details" (partial match from "Hotel details")
    if (hotelName.toLowerCase() === "details") continue;

    if (hotelName.length > 3) {
      // Look for phone number nearby
      const context = text.substring(simpleMatch.index, simpleMatch.index + 150);
      const phoneMatch = context.match(/(?:Phone[:\s]*)?(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
      const bookedMatch = context.toLowerCase().includes("booked");

      console.log(`  [HotelParser] Simple pattern match: "${hotelName}" Phone=${phoneMatch?.[1] || 'N/A'}`);

      hotels.push({
        name: { value: hotelName, confidence: confBase * 0.85 },
        phone: phoneMatch?.[1] ? { value: phoneMatch[1].replace(/[-.\s]/g, ""), confidence: confBase * 0.75 } : undefined,
        booked: { value: bookedMatch, confidence: confBase * 0.8 },
      });
    }
  }

  // ============================================
  // Strategy 3: Hotel brand name patterns (fallback)
  // Extensive list of major hotel chains
  // ============================================
  const hotelBrands = [
    // Marriott brands
    "Marriott", "JW Marriott", "Ritz-Carlton", "St. Regis", "W Hotel", "Westin",
    "Sheraton", "Four Points", "Courtyard", "Fairfield", "SpringHill", "Residence Inn",
    "TownePlace", "AC Hotel", "Moxy", "Aloft", "Element", "Le Meridien",
    // Hilton brands
    "Hilton", "Conrad", "Waldorf", "LXR", "Curio", "DoubleTree", "Embassy Suites",
    "Hampton", "Tru", "Homewood Suites", "Home2", "Canopy", "Signia",
    // IHG brands
    "Holiday Inn", "Crowne Plaza", "InterContinental", "Kimpton", "Hotel Indigo",
    "Staybridge", "Candlewood", "Even Hotels", "voco",
    // Hyatt brands
    "Hyatt", "Grand Hyatt", "Park Hyatt", "Andaz", "Hyatt Regency", "Hyatt Place",
    "Hyatt House", "Thompson", "Caption", "Miraval",
    // Wyndham brands
    "Wyndham", "Days Inn", "Super 8", "Ramada", "La Quinta", "Wingate",
    "Baymont", "Microtel", "Trademark", "Dolce",
    // Best Western
    "Best Western", "SureStay",
    // Choice Hotels
    "Quality Inn", "Comfort Inn", "Comfort Suites", "Sleep Inn", "Clarion",
    "Cambria", "Ascend", "WoodSpring",
    // Other chains
    "Radisson", "Country Inn", "Drury", "Red Roof", "Motel 6",
    "Extended Stay", "InTown Suites", "MainStay", "Sonesta"
  ];

  // Build pattern from brands
  const brandPattern = new RegExp(`(${hotelBrands.join("|")})[^\\n]*`, "gi");
  let brandMatch: RegExpExecArray | null;
  while ((brandMatch = brandPattern.exec(text)) !== null) {
    const hotelName = brandMatch[0].trim();
    const brandName = brandMatch[1]?.toLowerCase() || "";

    // Skip if already captured
    if (hotels.some(h => h.name.value.toLowerCase().includes(brandName))) continue;
    // Skip header/footer text
    if (/Credit|Block|TAFB|Duty|Transport|Phone[:\s]*$/i.test(hotelName)) continue;

    if (hotelName.length > 5 && hotelName.length < 100) {
      // Look for phone number nearby
      const context = text.substring(brandMatch.index, brandMatch.index + 150);
      const phoneMatch = context.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
      const bookedMatch = context.toLowerCase().includes("booked");

      console.log(`  [HotelParser] Brand match: "${hotelName}"`);

      hotels.push({
        name: { value: hotelName.replace(/\s+Phone.*$/i, "").trim(), confidence: confBase * 0.75 },
        phone: phoneMatch?.[1] ? { value: phoneMatch[1].replace(/[-.\s]/g, ""), confidence: confBase * 0.7 } : undefined,
        booked: { value: bookedMatch, confidence: confBase * 0.7 },
      });
    }
  }

  console.log(`  [HotelParser] Total hotels found: ${hotels.length}`);
  return hotels;
}

/**
 * Parse transport information from text
 *
 * ENHANCED: Handles Crew Access "Hotel Transport" format and various patterns
 * - "Hotel Transport Phone: 407-859-1000"
 * - "Transport: Shuttle every 30 min"
 * - "Shuttle: ABC Transportation"
 * - "Van service on request"
 */
function parseTransportInfo(
  text: string,
  confidence: number
): Array<{
  notes: ParsedField<string>;
  phone?: ParsedField<string>;
  layoverAirport?: ParsedField<string>;
}> {
  const transport: Array<{
    notes: ParsedField<string>;
    phone?: ParsedField<string>;
    layoverAirport?: ParsedField<string>;
  }> = [];

  const confBase = confidence / 100;

  // ============================================
  // Strategy 1: Crew Access "Hotel Transport" format
  // Format: "Hotel Transport Phone: 407-859-1000" or "Hotel Transport [notes] Phone: ###"
  // ============================================
  const crewAccessTransportPattern = /Hotel\s+Transport\s*(?:Phone[:\s]*([0-9\-.\s()]+))?([^\n]*)?/gi;
  let crewMatch: RegExpExecArray | null;
  while ((crewMatch = crewAccessTransportPattern.exec(text)) !== null) {
    let phone = crewMatch[1]?.trim().replace(/[-.\s()]/g, "");
    let notes = crewMatch[2]?.trim() || "";

    // If no phone in first position, check notes
    if (!phone && notes) {
      const phoneInNotes = notes.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
      if (phoneInNotes && phoneInNotes[1]) {
        phone = phoneInNotes[1].replace(/[-.\s]/g, "");
        notes = notes.replace(phoneInNotes[0], "").trim();
      }
    }

    // Only add if we have phone or meaningful notes
    if (phone || (notes && notes.length > 3)) {
      // Find nearest airport
      const textBefore = text.substring(0, crewMatch.index);
      const lastRouteMatch = [...textBefore.matchAll(/([A-Z]{3})-([A-Z]{3})/g)].pop();
      const layoverAirport = lastRouteMatch?.[2];

      console.log(`  [TransportParser] Crew Access match: notes="${notes || 'Phone only'}" phone=${phone || 'N/A'} airport=${layoverAirport || 'N/A'}`);

      transport.push({
        notes: { value: notes || `Transport phone: ${phone}`, confidence: confBase * 0.9 },
        phone: phone ? { value: phone, confidence: confBase * 0.9 } : undefined,
        layoverAirport: layoverAirport ? { value: layoverAirport, confidence: confBase * 0.85 } : undefined,
      });
    }
  }

  // ============================================
  // Strategy 2: Generic transport patterns
  // ============================================
  const transportPatterns = [
    /Transport(?:ation)?[:\s]+([^\n]+)/gi,
    /Shuttle[:\s]+([^\n]+)/gi,
    /Van\s+(?:service)?[:\s]*([^\n]+)/gi,
    /Ground\s+transport(?:ation)?[:\s]+([^\n]+)/gi,
    /(?:Complimentary|Free)\s+(?:shuttle|transport)[:\s]*([^\n]*)/gi,
  ];

  for (const pattern of transportPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const notes = (match[1] || match[0]).trim();

      // Skip if already captured or if it's part of "Hotel Transport" we already processed
      if (transport.some(t => t.notes.value.toLowerCase().includes(notes.toLowerCase().substring(0, 20)))) continue;
      if (/^Phone[:\s]*\d/i.test(notes)) continue; // Skip bare phone numbers

      if (notes.length > 3 && notes.length < 200) {
        // Look for phone number
        const phoneMatch = notes.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);

        console.log(`  [TransportParser] Pattern match: "${notes.substring(0, 50)}..." Phone=${phoneMatch?.[1] || 'N/A'}`);

        transport.push({
          notes: { value: notes, confidence: confBase * 0.8 },
          phone: phoneMatch?.[1] ? { value: phoneMatch[1].replace(/[-.\s]/g, ""), confidence: confBase * 0.75 } : undefined,
        });
      }
    }
  }

  console.log(`  [TransportParser] Total transport entries found: ${transport.length}`);
  return transport;
}

// ============================================
// Totals Parsing
// ============================================

/**
 * Parse totals from text (Credit, Block, TAFB, Duty Days)
 */
function parseTotals(text: string, confidence: number): ParsedTotals {
  const totals: ParsedTotals = {};
  const baseConf = confidence / 100;

  // Credit time - matches "Credit Time: 43:42" or "Credit: 43:42" or "Credit: 12:58T"
  // IMPORTANT: Must NOT match "Out Credit:" - look for Credit NOT preceded by "Out "
  // Also handles T suffix for totals (e.g., "Credit: 43:42T")
  const creditMatch = text.match(/(?<!Out\s)Credit(?:\s*Time)?[:\s]+(\d+:\d{2})T?(?![0-9])/i);
  if (creditMatch && creditMatch[1]) {
    totals.creditMinutes = {
      value: parseDurationToMinutes(creditMatch[1]),
      confidence: baseConf * 0.9,
      rawText: creditMatch[0],
    };
  }

  // Fallback: If no credit found, try footer pattern at end of text
  // Look for "Credit: HH:MM" near TAFB/Blk indicators (footer area)
  if (!totals.creditMinutes) {
    // Try to find credit in footer area (after "TAFB" or "Blk" mentions)
    const footerSection = text.slice(-500); // Last 500 chars are likely footer
    const footerCreditMatch = footerSection.match(/Credit[:\s]+(\d{1,3}):(\d{2})/i);
    if (footerCreditMatch && footerCreditMatch[1] && footerCreditMatch[2]) {
      const hours = parseInt(footerCreditMatch[1], 10);
      const mins = parseInt(footerCreditMatch[2], 10);
      totals.creditMinutes = {
        value: hours * 60 + mins,
        confidence: baseConf * 0.85,
        rawText: footerCreditMatch[0],
      };
    }
  }

  // Block time - FIRST try "Block Time: HH:MM" (Crew Access footer format)
  // This prevents matching duty day "Block: 0:00" before footer "Block Time: 25:08"
  const blockTimeMatch = text.match(/Block\s*Time[:\s]+(\d{1,3}):(\d{2})/i);
  if (blockTimeMatch && blockTimeMatch[1] && blockTimeMatch[2]) {
    const hours = parseInt(blockTimeMatch[1], 10);
    const mins = parseInt(blockTimeMatch[2], 10);
    totals.blockMinutes = {
      value: hours * 60 + mins,
      confidence: baseConf * 0.95,
      rawText: blockTimeMatch[0],
    };
  }

  // PBS/BidPro format: "Blk: HH:MM" in footer row - look for it near Credit/TAFB
  if (!totals.blockMinutes) {
    const blkMatch = text.match(/Blk[:\s]+(\d{1,3}):(\d{2})/i);
    if (blkMatch && blkMatch[1] && blkMatch[2]) {
      const hours = parseInt(blkMatch[1], 10);
      const mins = parseInt(blkMatch[2], 10);
      totals.blockMinutes = {
        value: hours * 60 + mins,
        confidence: baseConf * 0.9,
        rawText: blkMatch[0],
      };
    }
  }

  // Fallback: find ALL "Block: HH:MM" matches and use the LAST one (footer is at end)
  // This handles duty day "Block: X:XX" rows appearing before footer total
  if (!totals.blockMinutes) {
    const blockPattern = /Block[:\s]+(\d{1,3}):(\d{2})/gi;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(text)) !== null) {
      lastMatch = match;
    }
    if (lastMatch && lastMatch[1] && lastMatch[2]) {
      const hours = parseInt(lastMatch[1], 10);
      const mins = parseInt(lastMatch[2], 10);
      // Only use if it's a reasonable total (>10 minutes) to avoid picking up "Block: 0:00"
      if (hours > 0 || mins > 10) {
        totals.blockMinutes = {
          value: hours * 60 + mins,
          confidence: baseConf * 0.85,
          rawText: lastMatch[0],
        };
      }
    }
  }

  // TAFB (Time Away From Base) - also handle OCR variations like "TAB:" or "TAEB:"
  const tafbMatch = text.match(/TA[FE]?B[:\s]+(\d+):(\d{2})/i);
  if (tafbMatch && tafbMatch[1] && tafbMatch[2]) {
    const hours = parseInt(tafbMatch[1], 10);
    const mins = parseInt(tafbMatch[2], 10);
    totals.tafbMinutes = {
      value: hours * 60 + mins,
      confidence: baseConf * 0.9,
      rawText: tafbMatch[0],
    };
  }

  // Handle OCR misreading "TAFB: 142:21" as "TAB: 142221" (no colon in time)
  if (!totals.tafbMinutes) {
    const tafbNoColonMatch = text.match(/TA[FE]?B[:\s]+(\d{3,6})/i);
    if (tafbNoColonMatch && tafbNoColonMatch[1]) {
      const numStr = tafbNoColonMatch[1];
      // Parse as HHMM or HHHMM format
      let hours = 0, mins = 0;
      if (numStr.length === 4) {
        hours = parseInt(numStr.substring(0, 2), 10);
        mins = parseInt(numStr.substring(2), 10);
      } else if (numStr.length === 5) {
        hours = parseInt(numStr.substring(0, 3), 10);
        mins = parseInt(numStr.substring(3), 10);
      } else if (numStr.length === 6) {
        // OCR might double-read a digit (142:21 -> 142221)
        // First 3 digits = hours, last 2 digits = minutes, ignore middle extra digit
        hours = parseInt(numStr.substring(0, 3), 10);
        mins = parseInt(numStr.substring(numStr.length - 2), 10);
      }
      if (hours > 0 || mins > 0) {
        totals.tafbMinutes = {
          value: hours * 60 + mins,
          confidence: baseConf * 0.8,
          rawText: tafbNoColonMatch[0],
        };
      }
    }
  }

  // Duty Days / Trip Days - matches "Duty Days: 8", "Trip Days: 8"
  const dutyDaysMatch = text.match(/(?:Duty|Trip)\s*Days[:\s]+(\d+)/i);
  if (dutyDaysMatch && dutyDaysMatch[1]) {
    totals.dutyDays = {
      value: parseInt(dutyDaysMatch[1], 10),
      confidence: baseConf * 0.9,
      rawText: dutyDaysMatch[0],
    };
  }

  // PBS format: count unique day codes like FR13, SA14, MO16, TU17
  // These indicate distinct duty days when "Duty Days" text isn't present
  if (!totals.dutyDays) {
    const uniqueDayCodes = new Set<string>();
    const fullDayPattern = /^([SMTWF][AaOoUuEeHhRrIi][0-9lIi]{1,2})\s+(?:DH\s+)?\d{3,4}/gim;
    let fullMatch;
    while ((fullMatch = fullDayPattern.exec(text)) !== null) {
      if (fullMatch[1]) {
        // Normalize to handle OCR variations (SAl4 -> SA14)
        uniqueDayCodes.add(fullMatch[1].toUpperCase().replace(/[lI]/g, '1'));
      }
    }
    if (uniqueDayCodes.size > 0) {
      totals.dutyDays = {
        value: uniqueDayCodes.size,
        confidence: baseConf * 0.85,
        rawText: `${uniqueDayCodes.size} unique day codes`,
      };
    }
  }

  // Rest time
  const restMatch = text.match(/Rest[:\s]+(\d+:\d{2})/i);
  if (restMatch && restMatch[1]) {
    totals.restMinutes = {
      value: parseDurationToMinutes(restMatch[1]),
      confidence: baseConf * 0.85,
      rawText: restMatch[0],
    };
  }

  // Per Diem - matches formats like "PDiem: $123.45", "Per Diem: 123.45", "PDIEM $123"
  const perDiemMatch = text.match(/(?:PDiem|Per\s*Diem)[:\s]*\$?(\d+(?:\.\d{2})?)/i);
  if (perDiemMatch && perDiemMatch[1]) {
    const dollars = parseFloat(perDiemMatch[1]);
    totals.perDiemCents = {
      value: Math.round(dollars * 100),
      confidence: baseConf * 0.9,
      rawText: perDiemMatch[0],
    };
  }

  return totals;
}

// ============================================
// Trip Board Trip Details Fragmented Parser
// ============================================

/**
 * Parse BidPro Trip Details format
 *
 * This handles the UPS BidPro Trip Details screen format:
 * - Header: "Trip Details - S5055 - SDF 757"
 * - Table columns: Date, Pairing, Flt, Pos, Dep, (L) Z, Arr, (L) Z, Blk, Duty, Cr, L/O
 * - Date format: M/DD/YY (e.g., 1/11/26)
 * - Time format: (DayCode)HH:MM (e.g., (SU15)20:37, (17)22:09)
 * - Footer: Credit: HH:MM, Blk: HH:MM, TAFB: HH:MM, Duty Days: N
 *
 * The key insight: Each row represents one flight leg with all data on the same line
 */
function parseBidProTripDetails(fullText: string, baseConfidence: number): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const confBase = baseConfidence / 100;

  console.log(`  [BidPro] Starting BidPro Trip Details parser`);
  console.log(`  [BidPro] Text preview: ${fullText.substring(0, 300).replace(/\n/g, '|')}`);

  // Detect BidPro format markers
  const hasTripDetailsHeader = /Trip\s*Details/i.test(fullText);
  const hasParenTimes = /\([A-Z]{2}\d{1,2}\)\d{1,2}:\d{2}/.test(fullText) || /\(\d{1,2}\)\d{1,2}:\d{2}/.test(fullText);
  const hasBaseFleet = /[A-Z]{3}\s+7[3567]7/i.test(fullText);
  const hasCreditFooter = /Credit[:\s]+\d+:\d{2}/i.test(fullText);
  const hasBlkFooter = /Blk[:\s]+\d+:\d{2}/i.test(fullText);
  const hasTAFB = /TAFB[:\s]+\d+:\d{2}/i.test(fullText);
  const hasDutyDays = /Duty\s*Days[:\s]+\d+/i.test(fullText);
  const hasDateColumn = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(fullText);
  const hasPairingId = /[A-Z]\d{4,5}/.test(fullText);

  const isBidProFormat = hasTripDetailsHeader ||
    (hasParenTimes && (hasCreditFooter || hasBlkFooter)) ||
    (hasBaseFleet && hasDateColumn && hasPairingId) ||
    (hasTAFB && hasDutyDays);

  if (!isBidProFormat) {
    console.log(`  [BidPro] Not detected as BidPro format`);
    return events;
  }

  console.log(`  [BidPro] Detected BidPro Trip Details format!`);
  console.log(`  [BidPro] Markers: header=${hasTripDetailsHeader}, parenTimes=${hasParenTimes}, baseFleet=${hasBaseFleet}, credit=${hasCreditFooter}, tafb=${hasTAFB}`);

  // Extract totals from footer FIRST - these are reliable
  let totalCreditMinutes = 0;
  let totalBlockMinutes = 0;
  let totalTAFBMinutes = 0;
  let dutyDaysCount = 0;

  // Credit: Match "Credit: HH:MM" or "Credit: HH:MMT" but NOT "Out Credit:"
  // Also try footer-focused search (last portion of text)
  const footerSection = fullText.slice(-600);
  let creditMatch = footerSection.match(/(?<!Out\s)Credit[:\s]+(\d+):(\d{2})T?/i);
  if (!creditMatch) {
    // Fallback: search full text
    creditMatch = fullText.match(/(?<!Out\s)Credit[:\s]+(\d+):(\d{2})T?/i);
  }
  if (creditMatch && creditMatch[1] && creditMatch[2]) {
    totalCreditMinutes = parseInt(creditMatch[1]) * 60 + parseInt(creditMatch[2]);
    console.log(`  [BidPro] Footer Credit: ${creditMatch[1]}:${creditMatch[2]} = ${totalCreditMinutes} min`);
  }

  const blkMatch = fullText.match(/Blk[:\s]+(\d+):(\d{2})/i);
  if (blkMatch && blkMatch[1] && blkMatch[2]) {
    totalBlockMinutes = parseInt(blkMatch[1]) * 60 + parseInt(blkMatch[2]);
    console.log(`  [BidPro] Footer Block: ${blkMatch[1]}:${blkMatch[2]} = ${totalBlockMinutes} min`);
  }

  const tafbMatch = fullText.match(/TAFB[:\s]+(\d+):(\d{2})/i);
  if (tafbMatch && tafbMatch[1] && tafbMatch[2]) {
    totalTAFBMinutes = parseInt(tafbMatch[1]) * 60 + parseInt(tafbMatch[2]);
    console.log(`  [BidPro] Footer TAFB: ${tafbMatch[1]}:${tafbMatch[2]} = ${totalTAFBMinutes} min`);
  }

  const dutyDaysMatch = fullText.match(/Duty\s*Days[:\s]+(\d+)/i);
  if (dutyDaysMatch && dutyDaysMatch[1]) {
    dutyDaysCount = parseInt(dutyDaysMatch[1]);
    console.log(`  [BidPro] Footer Duty Days: ${dutyDaysCount}`);
  }

  // Also check for Trip Days (alternate format)
  if (dutyDaysCount === 0) {
    const tripDaysMatch = fullText.match(/Trip\s*Days[:\s]+(\d+)/i);
    if (tripDaysMatch && tripDaysMatch[1]) {
      dutyDaysCount = parseInt(tripDaysMatch[1]);
      console.log(`  [BidPro] Footer Trip Days: ${dutyDaysCount}`);
    }
  }

  // PBS format may have Ldgs (landings) - count unique day codes instead
  // Day codes like FR13, SA14, MO16, TU17 indicate distinct duty days
  if (dutyDaysCount === 0) {
    const dayCodePattern = /^([SMTWF][AaOoUuEeHhRrIi][0-9lIi]{1,2})\s+/gim;
    const dayCodesFound = new Set<string>();
    let dayMatch;
    while ((dayMatch = dayCodePattern.exec(fullText)) !== null) {
      if (dayMatch[1]) {
        // Normalize the day code (SAl4 -> SA14)
        const normalized = dayMatch[1].toUpperCase().replace(/[lI]/g, '1');
        dayCodesFound.add(normalized.substring(0, 2)); // Just the day part (FR, SA, etc.)
      }
    }
    if (dayCodesFound.size > 0) {
      // Count unique days from flight rows
      const uniqueDayCodes = new Set<string>();
      const fullDayPattern = /^([SMTWF][AaOoUuEeHhRrIi][0-9lIi]{1,2})\s+(?:DH\s+)?\d{3,4}/gim;
      let fullMatch;
      while ((fullMatch = fullDayPattern.exec(fullText)) !== null) {
        if (fullMatch[1]) {
          uniqueDayCodes.add(fullMatch[1].toUpperCase().replace(/[lI]/g, '1'));
        }
      }
      dutyDaysCount = uniqueDayCodes.size;
      console.log(`  [BidPro] Duty Days from day codes: ${dutyDaysCount} (${Array.from(uniqueDayCodes).join(', ')})`);
    }
  }

  // Non-airport codes to filter out
  const nonAirportCodes = new Set([
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HAD', 'HER', 'WAS',
    'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'MAY',
    'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'EQP', 'BLK', 'CRE', 'FLT',
    'POS', 'ACT', 'EST', 'REP', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'JAN',
    'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'CRD', 'DHD',
    'TTL', 'TOT', 'MIN', 'MAX', 'AVG', 'DIS', 'CON', 'END', 'CML', 'DEP', 'ARR', 'BLK',
    'DUTY', 'TAFB', 'PREM', 'OUT', 'DATE', 'FLT', 'POS', 'TRIP', 'DH', 'CREDIT',
    'TOG', 'CAT', 'LDG', 'LDGS', 'CNX', 'PNR', 'CAT'
  ]);

  // Known valid airports
  const knownAirports = new Set([
    'SDF', 'ATL', 'MCO', 'RFD', 'PHX', 'ONT', 'MIA', 'DFW', 'LAX', 'EWR', 'JFK',
    'ORD', 'DEN', 'SFO', 'SEA', 'BOS', 'IAD', 'IAH', 'MSP', 'DTW', 'PHL', 'CLT',
    'LGA', 'FLL', 'BWI', 'SLC', 'SAN', 'TPA', 'AUS', 'HNL', 'PDX', 'STL', 'BNA',
    'OAK', 'SMF', 'SNA', 'MCI', 'RDU', 'CLE', 'IND', 'CMH', 'SAT', 'PIT', 'CVG',
    'MKE', 'OMA', 'ABQ', 'TUS', 'OKC', 'MEM', 'BUF', 'RNO', 'ANC', 'SJU', 'BOI',
    'ONT', 'RSW', 'PBI', 'JAX', 'RIC', 'SYR', 'ALB', 'BDL', 'PWM', 'MHT', 'PVD',
    'BGR', 'BTV', 'AVL', 'CHS', 'GSO', 'TYS', 'LEX', 'SBN', 'GRR', 'DSM', 'MSN',
    'FSD', 'FAR', 'BIL', 'GEG', 'PSC', 'EUG', 'MFR', 'SBA', 'PSP', 'FAT', 'SJC',
    'OGG', 'KOA', 'LIH', 'HNL', 'MHR', 'ROC', 'SRQ', 'MSY', 'BHM', 'GSP', 'CAK',
    'MYR', 'TLH', 'SAV', 'ORF', 'LIT', 'OGG', 'LIH',
    // UPS and cargo hubs
    'BFI', 'RFD', 'CGN', 'SZX', 'PVG', 'TPE', 'HKG', 'ICN', 'NRT', 'PEK',
    'SHV', 'MFE', 'CRW', 'ELP', 'LAS', 'YYZ', 'YUL', 'YVR', 'MEX', 'GDL',
    'PTY', 'MDE', 'UIO', 'LIM', 'SCL', 'GRU', 'EZE', 'BOG', 'CGK', 'SIN',
    'BKK', 'DEL', 'BOM', 'DXB', 'AMS', 'CDG', 'FRA', 'LHR', 'MAN', 'MAD',
    'BCN', 'FCO', 'MXP', 'ZRH', 'VIE', 'BRU', 'LGG', 'LEJ', 'HAM', 'MUC'
  ]);

  function isValidAirport(code: string): boolean {
    if (!code || code.length !== 3) return false;
    if (nonAirportCodes.has(code)) return false;
    // If it's a known airport, accept it
    if (knownAirports.has(code)) return true;
    // Otherwise check if it looks like an airport code (all uppercase letters)
    return /^[A-Z]{3}$/.test(code);
  }

  // Strategy 1: Parse line by line looking for flight rows
  // BidPro format: Date Pairing Flt Pos DEP (time) ARR (time) Blk ...
  // Example: "1/11/26 S50558 CML F/O SDF (SU15)20:37 ATL (17)22:09 0:00"

  const lines = fullText.split('\n');
  console.log(`  [BidPro] Processing ${lines.length} lines`);

  // Comprehensive flight row pattern for Trip Board Details format
  // Format: Date Pairing Flt Pos DEP (LocalHour)ZuluTime ARR (LocalHour)ZuluTime Block
  // Example: "1/30/26 35324 5984 F/O SDF (FR14)19:00 PDX (15)23:41 4:41"
  //
  // TIME FORMAT EXPLANATION:
  // - (FR14)19:00 means: Friday, LOCAL hour 14, ZULU time 19:00
  // - The LOCAL time is: hour from inside () + minutes from Zulu = 14:00 LOCAL
  // - (15)23:41 means: LOCAL hour 15, ZULU time 23:41 → 15:41 LOCAL
  //
  // We extract LOCAL times by taking hour from inside () and minutes from Zulu time
  const bidProRowPattern = /(?:DH\s+)?(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s+)?(?:\d{4,5}\s+)?(?:\d{3,4}|CML)\s+F\/O\s+([A-Z]{3})\s+\((?:[A-Z]{2})?(\d{1,2})\)(\d{1,2}):(\d{2})\s+([A-Z]{3})\s+\((?:[A-Z]{2})?(\d{1,2})\)(\d{1,2}):(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/gi;

  let rowMatch;
  while ((rowMatch = bidProRowPattern.exec(fullText)) !== null) {
    const depAirport = rowMatch[1];
    const depLocalHour = rowMatch[2];  // Hour from inside parentheses = LOCAL hour
    const depZuluHour = rowMatch[3];   // Hour after parentheses = ZULU hour (ignored)
    const depMin = rowMatch[4];        // Minutes (same for local and Zulu)
    const arrAirport = rowMatch[5];
    const arrLocalHour = rowMatch[6];  // Hour from inside parentheses = LOCAL hour
    const arrZuluHour = rowMatch[7];   // Hour after parentheses = ZULU hour (ignored)
    const arrMin = rowMatch[8];        // Minutes (same for local and Zulu)
    const blkHour = rowMatch[9];
    const blkMin = rowMatch[10];

    if (depAirport && arrAirport && depLocalHour && depMin && arrLocalHour && arrMin &&
        isValidAirport(depAirport) && isValidAirport(arrAirport)) {

      // Use LOCAL hours (from inside parentheses) with minutes from Zulu time
      const depTime = `${depLocalHour.padStart(2, '0')}:${depMin.padStart(2, '0')}`;
      const arrTime = `${arrLocalHour.padStart(2, '0')}:${arrMin.padStart(2, '0')}`;
      const blockMinutes = (blkHour && blkMin) ? parseInt(blkHour) * 60 + parseInt(blkMin) : 0;

      // Check if this is a deadhead (DH at start or CML flight or 0:00 block)
      const matchText = rowMatch[0];
      const isDeadhead = /^DH\s/i.test(matchText) || /\bCML\b/i.test(matchText) || blockMinutes === 0;

      console.log(`  [BidPro] Row match: ${depAirport}-${arrAirport} LOCAL=${depTime}-${arrTime} (Zulu hours were ${depZuluHour}/${arrZuluHour}) blk=${blockMinutes} dh=${isDeadhead}`);

      // Check for duplicate
      const isDuplicate = events.some(e =>
        e.depAirport?.value === depAirport &&
        e.arrAirport?.value === arrAirport &&
        e.startTime?.value === depTime
      );

      if (!isDuplicate) {
        events.push({
          eventType: { value: isDeadhead ? "DEADHEAD" : "FLIGHT", confidence: confBase * 0.9 },
          depAirport: { value: depAirport, confidence: confBase * 0.95 },
          arrAirport: { value: arrAirport, confidence: confBase * 0.95 },
          startTime: { value: depTime, confidence: confBase * 0.9 },
          endTime: { value: arrTime, confidence: confBase * 0.9 },
          blockMinutes: blockMinutes > 0 ? { value: blockMinutes, confidence: confBase * 0.85 } : undefined,
          isDeadhead: { value: isDeadhead, confidence: confBase * 0.95 },
        });
      }
    }
  }

  console.log(`  [BidPro] Strategy 1 (row pattern) found ${events.length} flights`);

  // Strategy 1.5: PBS Format with DayCode (FR13, SA14, MO16, TU17) pattern
  // Format: "FR13   956  76P SDF (FR03)08:29 MHR(05)13:05     04:36"
  // This handles the dark background PBS/BidPro format
  // Note: OCR may read "14" as "l4" (lowercase L), "I4", etc.
  if (events.length === 0) {
    console.log(`  [BidPro] Trying Strategy 1.5 (PBS format with day codes)`);

    // Pattern: DayCode Flight# Eqp DEP (LocalHour)ZuluTime ARR (LocalHour)ZuluTime [TOG]? Block
    // Example: "FR13   956  76P SDF (FR03)08:29 MHR(05)13:05     04:36"
    //
    // TIME FORMAT: (DayCode + LocalHour)ZuluTime
    // - (FR03)08:29 means: LOCAL hour 03, ZULU 08:29 → LOCAL time is 03:29
    // - (05)13:05 means: LOCAL hour 05, ZULU 13:05 → LOCAL time is 05:05
    //
    // Day codes: FR, SA, SU, MO, TU, WE, TH followed by LOCAL hour
    // Equipment: 76P, 76W, 75P, 75W (code format) OR 767, 757, 747, 777, MD11 (numeric format)
    const pbsRowPattern = /^([SMTWF][AaOoUuEeHhRrIi][0-9lIi]{1,2})\s+(?:DH\s+)?(\d{3,4})\s+(\d{2}[PWpw78]|7[3567]7|MD\d{2})\s+([A-Z]{3})\s*\((?:[A-Za-z]{0,2})(\d{1,2})\)(\d{2}):(\d{2})\s+([A-Z]{3})\s*\((?:[A-Za-z]{0,2})?(\d{1,2})\)(\d{2}):(\d{2})(?:\s+(?:\[[^\]]*\])?\s*(\d{2}):(\d{2}))?/i;

    for (const line of lines) {
      if (!line) continue;
      const trimmed = line.trim();

      const pbsMatch = trimmed.match(pbsRowPattern);

      if (pbsMatch) {
        const dayCode = pbsMatch[1];
        const flightNum = pbsMatch[2];
        const equipment = pbsMatch[3];
        const depAirport = pbsMatch[4];
        const depLocalHour = pbsMatch[5];  // LOCAL hour from inside parentheses
        const depZuluHour = pbsMatch[6];   // ZULU hour (ignored)
        const depMin = pbsMatch[7];        // Minutes (same for local and Zulu)
        const arrAirport = pbsMatch[8];
        const arrLocalHour = pbsMatch[9];  // LOCAL hour from inside parentheses
        const arrZuluHour = pbsMatch[10];  // ZULU hour (ignored)
        const arrMin = pbsMatch[11];       // Minutes
        const blockHour = pbsMatch[12];
        const blockMin = pbsMatch[13];

        // Use LOCAL hours from inside parentheses with minutes from Zulu
        const depTime = `${(depLocalHour ?? '00').padStart(2, '0')}:${depMin}`;
        const arrTime = `${(arrLocalHour ?? '00').padStart(2, '0')}:${arrMin}`;
        const blockMinutes = blockHour && blockMin ? parseInt(blockHour) * 60 + parseInt(blockMin) : 0;

        // Skip if already found
        const isDuplicate = events.some(e =>
          e.depAirport?.value === depAirport &&
          e.arrAirport?.value === arrAirport &&
          e.flightNumber?.value === flightNum
        );

        if (!isDuplicate) {
          console.log(`  [BidPro] PBS match: ${dayCode} Flt=${flightNum} ${depAirport}-${arrAirport} LOCAL=${depTime}-${arrTime} Block=${blockMinutes}min`);

          events.push({
            eventType: { value: "FLIGHT", confidence: confBase * 0.95 },
            flightNumber: flightNum ? { value: flightNum, confidence: confBase * 0.95 } : undefined,
            depAirport: depAirport ? { value: depAirport, confidence: confBase * 0.95 } : undefined,
            arrAirport: arrAirport ? { value: arrAirport, confidence: confBase * 0.95 } : undefined,
            startTime: { value: depTime, confidence: confBase * 0.9 },
            endTime: { value: arrTime, confidence: confBase * 0.9 },
            blockMinutes: blockMinutes > 0 ? { value: blockMinutes, confidence: confBase * 0.9 } : undefined,
            equipment: equipment ? { value: equipment, confidence: confBase * 0.85 } : undefined,
            isDeadhead: { value: false, confidence: confBase * 0.95 },
          });
        }
      }
    }

    console.log(`  [BidPro] Strategy 1.5 (PBS format) found ${events.length} flights`);
  }

  // Strategy 2: If Strategy 1 didn't find flights, try extracting airport-time pairs
  if (events.length === 0) {
    console.log(`  [BidPro] Strategy 1 failed, trying Strategy 2 (airport-time pairs)`);

    // Extract all (LocalHour)ZuluTime patterns and convert to LOCAL time
    // Format: (DayCode?LocalHour)ZuluHour:ZuluMin
    // LOCAL time = LocalHour:ZuluMin (minutes are the same)
    const timePattern = /\((?:[A-Z]{2})?(\d{1,2})\)(\d{1,2}):(\d{2})/g;
    const allTimes: Array<{ time: string; position: number }> = [];
    let tMatch;

    while ((tMatch = timePattern.exec(fullText)) !== null) {
      const localHour = parseInt(tMatch[1] || '0');  // Hour from inside () = LOCAL
      const zuluMin = parseInt(tMatch[3] || '0');    // Minutes from Zulu (same for local)
      if (localHour >= 0 && localHour <= 23 && zuluMin >= 0 && zuluMin <= 59) {
        allTimes.push({
          time: `${localHour.toString().padStart(2, '0')}:${zuluMin.toString().padStart(2, '0')}`,
          position: tMatch.index
        });
      }
    }

    console.log(`  [BidPro] Found ${allTimes.length} paren times`);

    // Extract all airport codes in order
    const airportPattern = /\b([A-Z]{3})\b/g;
    const allAirports: Array<{ code: string; position: number }> = [];
    let aMatch;

    while ((aMatch = airportPattern.exec(fullText)) !== null) {
      const code = aMatch[1];
      if (code && isValidAirport(code)) {
        allAirports.push({ code, position: aMatch.index });
      }
    }

    console.log(`  [BidPro] Found ${allAirports.length} valid airport codes: ${allAirports.map(a => a.code).join(', ')}`);

    // Match airports with times by proximity
    // Each flight should have: DEP (time) ARR (time)
    // So we pair airports with their nearby times

    if (allAirports.length >= 2 && allTimes.length >= 2) {
      // Group into flights: pairs of airports with pairs of times
      const flightCount = Math.min(Math.floor(allAirports.length / 2), Math.floor(allTimes.length / 2));

      console.log(`  [BidPro] Forming ${flightCount} flights from airports and times`);

      for (let i = 0; i < flightCount; i++) {
        const depAirport = allAirports[i * 2];
        const arrAirport = allAirports[i * 2 + 1];
        const depTime = allTimes[i * 2];
        const arrTime = allTimes[i * 2 + 1];

        if (depAirport && arrAirport && depTime && arrTime) {
          console.log(`  [BidPro] Flight ${i + 1}: ${depAirport.code}-${arrAirport.code} ${depTime.time}-${arrTime.time}`);

          events.push({
            eventType: { value: "FLIGHT", confidence: confBase * 0.8 },
            depAirport: { value: depAirport.code, confidence: confBase * 0.85 },
            arrAirport: { value: arrAirport.code, confidence: confBase * 0.85 },
            startTime: { value: depTime.time, confidence: confBase * 0.8 },
            endTime: { value: arrTime.time, confidence: confBase * 0.8 },
            isDeadhead: { value: false, confidence: confBase * 0.8 },
          });
        }
      }
    }
  }

  // Strategy 3: If still no flights but we have footer totals, create synthetic legs
  // This ensures we at least capture the trip even if individual leg parsing failed
  if (events.length === 0 && (totalCreditMinutes > 0 || totalBlockMinutes > 0) && dutyDaysCount > 0) {
    console.log(`  [BidPro] Strategy 2 failed, using Strategy 3 (synthetic from totals)`);

    // Extract any airport codes we can find
    const airports: string[] = [];
    const airportMatches = fullText.match(/\b([A-Z]{3})\b/g) || [];
    for (const code of airportMatches) {
      if (isValidAirport(code) && !airports.includes(code)) {
        airports.push(code);
      }
    }

    // Create flights based on duty days count
    const creditPerDay = totalCreditMinutes > 0 ? Math.round(totalCreditMinutes / dutyDaysCount) : 0;
    const blockPerDay = totalBlockMinutes > 0 ? Math.round(totalBlockMinutes / dutyDaysCount) : 0;

    // If we have at least 2 airports, assume they form a pattern
    if (airports.length >= 2) {
      console.log(`  [BidPro] Creating ${dutyDaysCount} synthetic duty days from airports: ${airports.join(', ')}`);

      // Simple approach: assume round-trip pattern or chain
      for (let i = 0; i < dutyDaysCount; i++) {
        const depIdx = i % airports.length;
        const arrIdx = (i + 1) % airports.length;
        const dep = airports[depIdx];
        const arr = airports[arrIdx];

        if (dep && arr) {
          events.push({
            eventType: { value: "FLIGHT", confidence: confBase * 0.6 },
            depAirport: { value: dep, confidence: confBase * 0.7 },
            arrAirport: { value: arr, confidence: confBase * 0.7 },
            blockMinutes: blockPerDay > 0 ? { value: blockPerDay, confidence: confBase * 0.6 } : undefined,
            creditMinutes: creditPerDay > 0 ? { value: creditPerDay, confidence: confBase * 0.6 } : undefined,
            isDeadhead: { value: false, confidence: confBase * 0.7 },
          });
        }
      }
    }
  }

  console.log(`  [BidPro] Final result: ${events.length} flight events`);

  // ============================================
  // Extract L/O (Layover) times from BidPro format
  // L/O times appear at the end of duty day summary rows
  // Pattern: Blk Duty Cr L/O  e.g., "4:32 7:22 4:32L 14:58"
  // Or after duty day rows: "X:XX X:XX X:XXM HH:MM" where M/L/D suffix on Cr
  // ============================================

  // Pattern 1: Look for L/O times in the rightmost column after Cr (credit) values
  // Credit has M (min guarantee), L (leg), or D (duty) suffix
  // L/O is the time after that: "4:00M 24:14" → L/O is 24:14
  const layoverRowPattern = /(\d{1,2}:\d{2})[MLD]\s+(\d{1,2}):(\d{2})(?:\s|$)/g;
  let layoverMatch;
  const layoverMinutesFound: number[] = [];

  while ((layoverMatch = layoverRowPattern.exec(fullText)) !== null) {
    const hours = parseInt(layoverMatch[2] || '0', 10);
    const minutes = parseInt(layoverMatch[3] || '0', 10);
    const layoverMins = hours * 60 + minutes;

    // Only accept reasonable layover times (between 8 hours and 48 hours)
    if (layoverMins >= 8 * 60 && layoverMins <= 48 * 60) {
      layoverMinutesFound.push(layoverMins);
      console.log(`  [BidPro] Found L/O time: ${hours}:${minutes.toString().padStart(2, '0')} (${layoverMins} min)`);
    }
  }

  // Pattern 2: Explicit "L/O" label pattern
  const explicitLayoverPattern = /L\/O\s+(\d{1,2}):(\d{2})/gi;
  while ((layoverMatch = explicitLayoverPattern.exec(fullText)) !== null) {
    const hours = parseInt(layoverMatch[1] || '0', 10);
    const minutes = parseInt(layoverMatch[2] || '0', 10);
    const layoverMins = hours * 60 + minutes;

    if (layoverMins > 0 && !layoverMinutesFound.includes(layoverMins)) {
      layoverMinutesFound.push(layoverMins);
      console.log(`  [BidPro] Found explicit L/O: ${hours}:${minutes.toString().padStart(2, '0')} (${layoverMins} min)`);
    }
  }

  // Create LAYOVER events for each found L/O time
  // These will be matched by position in the frontend
  for (const layoverMins of layoverMinutesFound) {
    events.push({
      eventType: { value: 'LAYOVER', confidence: confBase * 0.9 },
      layoverMinutes: { value: layoverMins, confidence: confBase * 0.9 },
    });
  }

  console.log(`  [BidPro] Created ${layoverMinutesFound.length} LAYOVER events`);

  return events;
}

/**
 * Parse Trip Board Trip Details when OCR fragments the table
 * This handles the common case where the table columns are read separately:
 * - Departure airports in one section (SDF, ATL, MCO...)
 * - Arrival airports in another section
 * - Times in format (DayCode)HH:MM like (SU15)20:37
 * - Block times, credit times scattered
 *
 * The strategy: Extract all airports and all times, then pair them up sequentially
 */
function parseTripBoardDetailsFragmented(fullText: string, baseConfidence: number, nonAirport: string[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const confBase = baseConfidence / 100;

  // First try the BidPro-specific parser
  const bidProEvents = parseBidProTripDetails(fullText, baseConfidence);
  if (bidProEvents.length > 0) {
    return bidProEvents;
  }

  // Check if this looks like Trip Board Trip Details format
  // OCR may misread "Trip Details" so we look for multiple indicators
  const hasTripDetails = /Trip\s*(?:Details|Board)/i.test(fullText);
  const hasParenTimes = /\([^)]*\d{1,2}\)\d{1,2}:\d{2}/.test(fullText);
  const hasBaseFleet = /[A-Z]{3}\s+7[3567]7/i.test(fullText); // Like "SDF 757"
  const hasCreditTotal = /Credit[:\s]+\d+:\d{2}/i.test(fullText);
  const hasBlockTotal = /Blk[:\s]+\d+:\d{2}/i.test(fullText);

  const isTripBoardDetails = hasTripDetails || hasParenTimes || (hasBaseFleet && (hasCreditTotal || hasBlockTotal));

  if (!isTripBoardDetails) {
    return events;
  }

  console.log(`  [TripBoard-Fragmented] Detected Trip Board Details format but BidPro parser didn't find flights`);

  // The BidPro parser already tried and found nothing, so we return empty
  // The main parseTripBoardTable function will try other strategies
  return events;
}

// ============================================
// Trip Board Parser
// ============================================

/**
 * Parse Trip Board Browser and Trip Details formats
 * Trip Board has several formats:
 * 1. Browser (Pairing View): Trip ###, Report at HH:MM, table with DAY, FLT, EQP, DEP, ARR, BLK, DUTY, CR, L/O
 * 2. Trip Details: Eqp, Date, Pairing, Flt, Pos, Dep, Arr, Blk, Duty, Cr, L/O
 *
 * The Trip Details format is particularly challenging because OCR often fragments the table:
 * - Dates end up on separate lines from airports and times
 * - Times have format like (SU15)20:37 (day code + time)
 * - Airports may be listed in columns separately from times
 */
function parseTripBoardTable(fullText: string, baseConfidence: number): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const lines = fullText.split('\n');

  console.log(`  [TripBoard] Parsing ${lines.length} lines`);
  console.log(`  [TripBoard] Raw text sample: ${fullText.substring(0, 500).replace(/\n/g, '|')}`);

  // Non-airport 3-letter codes to skip
  const nonAirport = ['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HAD', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'EQP', 'BLK', 'CRE', 'FLT', 'POS', 'ACT', 'EST', 'REP', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'CRD', 'DHD', 'TTL', 'TOT', 'MIN', 'MAX', 'AVG', 'DIS', 'CON', 'END', 'CML', 'ATL', 'LAX', 'OUT', 'DEW', 'REX'];

  // Strategy 0: Parse Trip Board Trip Details fragmented OCR format
  // This handles cases where OCR fragments the table so airports and times are on separate lines
  // Pattern seen: airports like SDF, ATL in one area; times like (SU15)20:37, (17)22:09 in another
  const tripBoardDetailsEvents = parseTripBoardDetailsFragmented(fullText, baseConfidence, nonAirport);
  if (tripBoardDetailsEvents.length > 0) {
    console.log(`  [TripBoard] Strategy 0 (fragmented) found ${tripBoardDetailsEvents.length} flights`);
    events.push(...tripBoardDetailsEvents);
  }

  // Strategy 1: Look for Trip Board table row patterns
  // Format: DAY FLT# EQP DEP DepTime ARR ArrTime BLK DUTY CR L/O
  // Example: "1 1234 757 SDF 06:06 LAX 09:30 3:24 4:00 3:24"
  const tableRowPattern = /\b(\d)\s+(\d{3,4})\s+(?:7[3567]7|76[78]|MD\d{2}|A3[0-9]{2}|E\d{2,3}|\d{3})?\s*([A-Z]{3})\s+(\d{1,2}:\d{2})\s+([A-Z]{3})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/gi;

  let tableMatch;
  while ((tableMatch = tableRowPattern.exec(fullText)) !== null) {
    const [, dayNum, flightNum, dep, depTime, arr, arrTime, block] = tableMatch;

    if (dep && arr && depTime && arrTime && !nonAirport.includes(dep) && !nonAirport.includes(arr)) {
      console.log(`  [TripBoard] Found table row: Day ${dayNum} Flt ${flightNum} ${dep} ${depTime} - ${arr} ${arrTime}`);

      const confBase = baseConfidence / 100;
      events.push({
        eventType: { value: "FLIGHT", confidence: confBase * 0.9 },
        flightNumber: flightNum ? { value: flightNum, confidence: confBase * 0.85 } : undefined,
        depAirport: { value: dep, confidence: confBase * 0.95 },
        arrAirport: { value: arr, confidence: confBase * 0.95 },
        startTime: { value: depTime, confidence: confBase * 0.9 },
        endTime: { value: arrTime, confidence: confBase * 0.9 },
        blockMinutes: block ? { value: parseDurationToMinutes(block), confidence: confBase * 0.85 } : undefined,
        isDeadhead: { value: false, confidence: confBase * 0.95 },
      });
    }
  }

  // Strategy 2: Look for simpler flight patterns line by line
  // Format variations: "1234 DEP HH:MM ARR HH:MM" or "DEP-ARR HH:MM HH:MM"
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length < 10) continue;

    // Skip header and summary rows
    if (/\b(Date|Day|Flt|Dep\s*Sta|Arr\s*Sta|Blk|Cre|A\/C|Hotel|Transport|Report|Release|Credit|TAFB|Duty\s+Days|Trip\s+Details|Pairing)\b/i.test(trimmedLine)) {
      continue;
    }

    // Extract all 3-letter uppercase codes that could be airports
    const airportMatches = trimmedLine.match(/\b([A-Z]{3})\b/g) || [];
    const validAirports = airportMatches.filter(code => !nonAirport.includes(code));

    // Extract times in HH:MM format
    const timeMatches: string[] = [];
    const timeRegex = /\b(\d{1,2}):(\d{2})\b/g;
    let timeMatch;
    while ((timeMatch = timeRegex.exec(trimmedLine)) !== null) {
      if (timeMatch[1] && timeMatch[2]) {
        const hour = parseInt(timeMatch[1]);
        const min = parseInt(timeMatch[2]);
        if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
          timeMatches.push(timeMatch[0]);
        }
      }
    }

    // Also check for HHMM format (4 digits that look like times)
    const hhmmRegex = /(?<!\d)(\d{4})(?!\d)/g;
    let hhmmMatch;
    while ((hhmmMatch = hhmmRegex.exec(trimmedLine)) !== null) {
      const val = hhmmMatch[1];
      if (val) {
        const hour = parseInt(val.substring(0, 2));
        const min = parseInt(val.substring(2, 4));
        if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59 && hour < 25) {
          const formattedTime = `${hour}:${min.toString().padStart(2, '0')}`;
          if (!timeMatches.includes(formattedTime)) {
            timeMatches.push(formattedTime);
          }
        }
      }
    }

    // Look for flight number
    const flightNumMatch = trimmedLine.match(/\b(\d{3,4})\b/);

    // Check for deadhead
    const isDeadhead = /\b(DH|DHD|DEADHEAD)\b/i.test(trimmedLine);

    // Check for equipment
    const equipMatch = trimmedLine.match(/\b(7[3567]7|76[78]|MD\d{2}|A3[0-9]{2}|E1[79]0|CRJ|ERJ|E[0-9]{2,3})\b/i);

    // If we have at least 2 airports and 2 times, it's probably a flight
    if (validAirports.length >= 2 && timeMatches.length >= 2) {
      const confBase = baseConfidence / 100;
      const depAirport = validAirports[0]!;
      const arrAirport = validAirports[1]!;
      const startTime = timeMatches[0]!;
      const endTime = timeMatches[1]!;

      // Check for duplicates
      const isDuplicate = events.some(e =>
        e.depAirport?.value === depAirport &&
        e.arrAirport?.value === arrAirport &&
        e.startTime?.value === startTime
      );

      if (!isDuplicate) {
        console.log(`  [TripBoard] Found flight from line: ${depAirport}-${arrAirport} ${startTime}-${endTime} Flt:${flightNumMatch?.[1] || 'N/A'}`);

        // Calculate block time from times if we have a third time
        let blockMinutes: number | undefined;
        if (timeMatches.length >= 3) {
          blockMinutes = parseDurationToMinutes(timeMatches[2]!);
        }

        events.push({
          eventType: { value: isDeadhead ? "DEADHEAD" : "FLIGHT", confidence: confBase * 0.9 },
          depAirport: { value: depAirport, confidence: confBase * 0.95 },
          arrAirport: { value: arrAirport, confidence: confBase * 0.95 },
          startTime: { value: startTime, confidence: confBase * 0.9 },
          endTime: { value: endTime, confidence: confBase * 0.9 },
          flightNumber: flightNumMatch && flightNumMatch[1] ? { value: flightNumMatch[1], confidence: confBase * 0.85 } : undefined,
          equipment: equipMatch && equipMatch[1] ? { value: equipMatch[1].toUpperCase(), confidence: confBase * 0.8 } : undefined,
          blockMinutes: blockMinutes ? { value: blockMinutes, confidence: confBase * 0.85 } : undefined,
          isDeadhead: { value: isDeadhead, confidence: confBase * 0.95 },
        });
      }
    }
  }

  // Strategy 3: Try more aggressive pattern matching for minimal data
  // Look for airport pairs with any numbers nearby
  const airportPairPattern = /([A-Z]{3})\s*[-–—]\s*([A-Z]{3})/g;
  let pairMatch;
  while ((pairMatch = airportPairPattern.exec(fullText)) !== null) {
    const dep = pairMatch[1];
    const arr = pairMatch[2];

    if (dep && arr && !nonAirport.includes(dep) && !nonAirport.includes(arr)) {
      // Look for times nearby
      const surroundingText = fullText.substring(Math.max(0, pairMatch.index - 30), pairMatch.index + pairMatch[0].length + 50);
      const nearbyTimes = surroundingText.match(/\b(\d{1,2}:\d{2})\b/g) || [];

      if (nearbyTimes.length >= 2) {
        const isDuplicate = events.some(e => e.depAirport?.value === dep && e.arrAirport?.value === arr);

        if (!isDuplicate) {
          console.log(`  [TripBoard] Found airport pair: ${dep}-${arr} with times ${nearbyTimes.slice(0, 2).join(', ')}`);
          const confBase = baseConfidence / 100;

          events.push({
            eventType: { value: "FLIGHT", confidence: confBase * 0.8 },
            depAirport: { value: dep, confidence: confBase * 0.9 },
            arrAirport: { value: arr, confidence: confBase * 0.9 },
            startTime: { value: nearbyTimes[0]!, confidence: confBase * 0.8 },
            endTime: { value: nearbyTimes[1]!, confidence: confBase * 0.8 },
            isDeadhead: { value: false, confidence: confBase * 0.9 },
          });
        }
      }
    }
  }

  console.log(`  [TripBoard] Extracted ${events.length} flight events`);
  return events;
}

// ============================================
// Crew Access Table Parser
// ============================================

/**
 * Parse Crew Access Trip Information table format
 *
 * EXACT FORMAT from screenshot:
 * Header: "Trip Information" / "Date: 11Jan2026"
 * Table header: "Trip Id: S50558 11Jan2026"
 * Columns: Day | Flight | Departure-Arrival | Start | Start(LT) | End | End(LT) | Block | A/C | Cnx | PNR DH Remark
 *
 * Row examples:
 * "1 Su    DH DL3195  SDF-ATL   20:37  15:37   22:09  17:09    -    -   00:56  -"
 * "3 Tu    1327       MCO-RFD   02:09  21:09   04:51  22:51  02:42 767"
 * "Duty totals   Time: 5:18  Block: 0:00    Rest: 24:14"
 * "Hotel details Status: BOOKED Hotel: Florida Hotel..."
 *
 * Footer: "Block Time: 29:13 Credit Time: 43:42 Trip Days: 8 TAFB: 163:53"
 */
function parseCrewAccessTable(fullText: string, baseConfidence: number): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const lines = fullText.split('\n');
  const confBase = baseConfidence / 100;

  console.log(`  [CrewAccess] Parsing ${lines.length} lines for Trip Information format`);

  // Log first 20 lines of raw OCR for debugging
  console.log(`  [CrewAccess] --- RAW OCR TEXT (first 20 lines) ---`);
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    console.log(`  [CrewAccess] Line ${i}: "${lines[i]}"`);
  }
  console.log(`  [CrewAccess] --- END RAW OCR TEXT ---`);

  // Extract trip start date from header - multiple patterns
  // IMPORTANT: Use string-based dates (YYYY-MM-DD) to avoid timezone issues
  let tripStartDateStr: string | null = null;

  // Pattern 1: "Date: 11Jan2026"
  const dateHeaderMatch = fullText.match(/Date:\s*(\d{1,2})([A-Za-z]{3})(\d{4})/i);
  if (dateHeaderMatch && dateHeaderMatch[1] && dateHeaderMatch[2] && dateHeaderMatch[3]) {
    const day = parseInt(dateHeaderMatch[1], 10);
    const monthStr = dateHeaderMatch[2].toLowerCase();
    const year = parseInt(dateHeaderMatch[3], 10);
    const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[monthStr] ?? 0;
    tripStartDateStr = createUTCDateString(year, month, day);
    console.log(`  [CrewAccess] Trip start date from header: ${tripStartDateStr}`);
  }

  // Pattern 2: "Trip Id: S50558 11Jan2026"
  if (!tripStartDateStr) {
    const tripIdDateMatch = fullText.match(/Trip\s*(?:Id|1d):\s*\S+\s+(\d{1,2})([A-Za-z]{3})(\d{4})/i);
    if (tripIdDateMatch && tripIdDateMatch[1] && tripIdDateMatch[2] && tripIdDateMatch[3]) {
      const day = parseInt(tripIdDateMatch[1], 10);
      const monthStr = tripIdDateMatch[2].toLowerCase();
      const year = parseInt(tripIdDateMatch[3], 10);
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const month = months[monthStr] ?? 0;
      tripStartDateStr = createUTCDateString(year, month, day);
      console.log(`  [CrewAccess] Trip start date from Trip Id: ${tripStartDateStr}`);
    }
  }

  // Fallback: today's date if nothing found (use UTC)
  if (!tripStartDateStr) {
    console.log(`  [CrewAccess] WARNING: No trip start date found, using today`);
    const now = new Date();
    tripStartDateStr = createUTCDateString(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  // Non-airport codes to skip
  const nonAirport = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HAD', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'EQP', 'BLK', 'CRE', 'FLT', 'POS', 'ACT', 'EST', 'REP', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'JAN', 'FEB', 'MAR', 'APR', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'CNL', 'GND', 'CNX', 'PNR', 'END', 'DUT']);

  // ============================================
  // STRATEGY 1: Parse flight rows with Day number pattern
  // Format: "N Day  [DH] [DL]FlightNum  DEP-ARR  StartTime  StartLT  EndTime  EndLT  Block  A/C"
  // Example: "1 Su    DH DL3195  SDF-ATL   20:37  15:37   22:09  17:09"
  // Example: "3 Tu    1327       MCO-RFD   02:09  21:09   04:51  22:51  02:42 767"
  // OCR QUIRKS: "DH DL3195" may be read as "DHDL3195" (no space)
  // ============================================

  // Match day patterns: "1Su", "1 Su", "3Tu", "4 We", "75a" (OCR may read "Sa" as "5a"), "78a"
  const dayPattern = /^(\d)\s*([SsMmTtWwFf][aAoOuUeEhHrRi])\s+/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmedLine = line.trim();

    // Skip empty lines and non-flight lines
    if (!trimmedLine || trimmedLine.startsWith('Duty totals') || trimmedLine.startsWith('Hotel') || trimmedLine.startsWith('Crew') || trimmedLine.startsWith('Trip Id') || trimmedLine.startsWith('Day ')) {
      continue;
    }

    const dayMatch = trimmedLine.match(dayPattern);
    if (!dayMatch || !dayMatch[1]) continue;

    const dayNum = parseInt(dayMatch[1], 10);
    const restOfLine = trimmedLine.substring(dayMatch[0].length).trim();

    // Log the COMPLETE line for debugging - no truncation
    console.log(`  [CrewAccess] Day ${dayNum} FULL line (${trimmedLine.length} chars): "${trimmedLine}"`);
    console.log(`  [CrewAccess] restOfLine: "${restOfLine}"`);

    // Check for deadhead - "DH ", "DH" at start, or "DHDL" pattern (OCR combines them)
    const isDeadhead = /^DH\s/i.test(restOfLine) || /^DHDL/i.test(restOfLine) || /\sDH\s/.test(restOfLine);

    // Extract flight number - handle various OCR patterns:
    // "DH DL3195" - normal with space
    // "DHDL3195" - OCR combined (no space)
    // "1327" - regular flight
    // "GND" - ground transport
    // "5076 CNL" - cancelled flight
    let flightNumber: string | null = null;
    let lineAfterFlight = restOfLine;

    // Pattern 1: DHDL#### (OCR combined deadhead) - extract just the number
    const combinedDHMatch = restOfLine.match(/^DHDL(\d{3,5})\s+/i);
    if (combinedDHMatch && combinedDHMatch[1]) {
      flightNumber = combinedDHMatch[1];
      lineAfterFlight = restOfLine.substring(combinedDHMatch[0].length);
    } else {
      // Pattern 2: DH DL#### or DH #### (normal deadhead)
      const dhFlightMatch = restOfLine.match(/^DH\s+(?:DL)?(\d{3,5})\s+/i);
      if (dhFlightMatch && dhFlightMatch[1]) {
        flightNumber = dhFlightMatch[1];
        lineAfterFlight = restOfLine.substring(dhFlightMatch[0].length);
      } else {
        // Pattern 3: Regular flight: #### or #### CNL or GND
        const regularFlightMatch = restOfLine.match(/^(\d{3,5}|GND)\s*(?:CNL)?\s+/i);
        if (regularFlightMatch && regularFlightMatch[1]) {
          flightNumber = regularFlightMatch[1];
          lineAfterFlight = restOfLine.substring(regularFlightMatch[0].length);
        }
      }
    }

    // Extract route DEP-ARR - also correct common OCR errors
    let routeMatch = lineAfterFlight.match(/([A-Z]{3})-([A-Z]{3})/);
    if (!routeMatch) {
      // Try to find route in the original line if not found after flight number
      routeMatch = restOfLine.match(/([A-Z]{3})-([A-Z]{3})/);
    }

    if (!routeMatch) {
      console.log(`  [CrewAccess] No route found in: "${lineAfterFlight.substring(0, 50)}"`);
      continue;
    }

    let depAirport = routeMatch[1] ?? "";
    let arrAirport = routeMatch[2] ?? "";

    // OCR error correction: "RED" should be "RFD" (common OCR misread)
    if (depAirport === "RED") depAirport = "RFD";
    if (arrAirport === "RED") arrAirport = "RFD";

    if (!depAirport || !arrAirport || nonAirport.has(depAirport) || nonAirport.has(arrAirport)) {
      console.log(`  [CrewAccess] Skipping non-airport codes: ${depAirport}-${arrAirport}`);
      continue;
    }

    // Get text after the route for time extraction
    const routeIndex = restOfLine.indexOf(routeMatch[0]);
    const afterRoute = restOfLine.substring(routeIndex + routeMatch[0].length).trim();

    // Extract ALL times from the ENTIRE line (not just after route)
    // OCR may place times in unexpected positions
    const allTimesInLine = restOfLine.match(/(\d{1,2}:\d{2})/g) || [];
    const timesAfterRoute = afterRoute.match(/(\d{1,2}:\d{2})/g) || [];

    console.log(`  [CrewAccess] Line times: allInLine=${allTimesInLine.length}, afterRoute=${timesAfterRoute.length}`);
    console.log(`  [CrewAccess] Times after route: ${timesAfterRoute.join(', ')}`);

    // Use times from after route if available, otherwise from entire line
    const times = timesAfterRoute.length >= 2 ? timesAfterRoute : allTimesInLine;

    // CREW ACCESS FORMAT COLUMNS:
    // Column 4: Start = Departure time (ZULU) - position 0
    // Column 5: Start(LT) = Departure time (LOCAL) - position 1 ← WE WANT THIS
    // Column 6: End = Arrival time (ZULU) - position 2
    // Column 7: End(LT) = Arrival time (LOCAL) - position 3 ← WE WANT THIS
    // Column 8: Block = Block time - position 4
    //
    // For domestic flights, we want LOCAL times (positions 1 and 3)
    // LOCAL times are what pilots see on their watch at the airport
    let startTime: string | null = null;
    let endTime: string | null = null;
    let blockMinutes = 0;

    // Extract LOCAL times (positions 1 and 3) for departure and arrival
    if (times.length >= 4) {
      // Full row with all 4+ times: use local times at positions 1 and 3
      startTime = times[1] ?? null; // Start(LT) - LOCAL departure
      endTime = times[3] ?? null;   // End(LT) - LOCAL arrival
      console.log(`  [CrewAccess] Using LOCAL times (positions 1,3): dep=${startTime}, arr=${endTime}`);
    } else if (times.length >= 2) {
      // Fallback: only 2 times available, assume they are Zulu
      startTime = times[0] ?? null;
      endTime = times[1] ?? null;
      console.log(`  [CrewAccess] Fallback: only ${times.length} times, using positions 0,1: dep=${startTime}, arr=${endTime}`);
    }

    // Look for block time - pattern: "HH:MM 767" or the 5th time
    // Also look in entire line for block time near equipment marker
    const blockEquipMatch = restOfLine.match(/(\d{1,2}:\d{2})\s*767/);
    if (blockEquipMatch) {
      blockMinutes = parseDurationToMinutes(blockEquipMatch[1] ?? "");
    } else if (times.length >= 5) {
      blockMinutes = parseDurationToMinutes(times[4] ?? "");
    }

    // Extract equipment (767, 757, etc.) from entire line
    const equipMatch = restOfLine.match(/\b(7[3567]7|76[78]|MD\d{2}|A3[0-9]{2})\b/);
    const equipment = equipMatch ? equipMatch[1] : null;

    // Calculate the date for this flight using UTC-safe string manipulation
    let flightDate: string | null = null;
    if (tripStartDateStr) {
      flightDate = addDaysToDateString(tripStartDateStr, dayNum - 1);
    }

    console.log(`  [CrewAccess] Extracted: Flt=${flightNumber || 'N/A'} ${depAirport}-${arrAirport} ${startTime}-${endTime} Block=${blockMinutes}min DH=${isDeadhead} Date=${flightDate}`);

    events.push({
      eventType: {
        value: isDeadhead ? "DEADHEAD" : "FLIGHT",
        confidence: confBase * 0.95,
      },
      date: flightDate ? { value: flightDate, confidence: confBase * 0.9 } : undefined,
      flightNumber: flightNumber ? { value: flightNumber, confidence: confBase * 0.9 } : undefined,
      depAirport: { value: depAirport, confidence: confBase * 0.95 },
      arrAirport: { value: arrAirport, confidence: confBase * 0.95 },
      startTime: startTime ? { value: startTime, confidence: confBase * 0.9 } : undefined,
      endTime: endTime ? { value: endTime, confidence: confBase * 0.9 } : undefined,
      blockMinutes: blockMinutes > 0 ? { value: blockMinutes, confidence: confBase * 0.85 } : undefined,
      equipment: equipment ? { value: equipment, confidence: confBase * 0.85 } : undefined,
      isDeadhead: { value: isDeadhead, confidence: confBase * 0.95 },
    });
  }

  // ============================================
  // STRATEGY 2: Look for missed routes in the full text
  // Catches flights that didn't match the day pattern (OCR issues with day number)
  // ============================================

  console.log(`  [CrewAccess] Strategy 1 found ${events.length} flights, checking for missed routes...`);

  // ============================================
  // STRATEGY 1.5: Extract REST times from Duty totals rows
  // These are the authoritative layover times from Crew Access
  // Format: "Duty totals Time: 5:18 Block: 0:00 Rest: 24:14"
  //
  // KEY INSIGHT: REST times appear AFTER each duty day's flights in the OCR text.
  // So we need to track which flights appear BEFORE each "Duty totals" line
  // to determine the layover station (last arrival before that line).
  // ============================================

  // First, collect all "Duty totals" positions and their REST times
  const dutyTotalsPattern = /Duty\s*totals.*?Rest[:\s]+(\d{1,2}):(\d{2})/gi;
  const restTimePositions: Array<{ position: number; hours: number; minutes: number; restMinutes: number }> = [];
  let dutyTotalsMatch;

  while ((dutyTotalsMatch = dutyTotalsPattern.exec(fullText)) !== null) {
    const hours = parseInt(dutyTotalsMatch[1] ?? '0', 10);
    const minutes = parseInt(dutyTotalsMatch[2] ?? '0', 10);
    restTimePositions.push({
      position: dutyTotalsMatch.index,
      hours,
      minutes,
      restMinutes: hours * 60 + minutes,
    });
  }

  console.log(`  [CrewAccess] Found ${restTimePositions.length} REST time entries in OCR text`);

  // Now, for each REST time, find the last route (XXX-YYY) that appears BEFORE it in the text
  // This gives us the arrival airport for that duty day's layover
  const routePattern = /([A-Z]{3})-([A-Z]{3})/g;
  const allRoutes: Array<{ dep: string; arr: string; position: number }> = [];
  let routeMatch;

  while ((routeMatch = routePattern.exec(fullText)) !== null) {
    const dep = routeMatch[1];
    const arr = routeMatch[2];
    if (dep && arr && !nonAirport.has(dep) && !nonAirport.has(arr)) {
      // Apply OCR corrections
      const correctedDep = dep === "RED" ? "RFD" : dep;
      const correctedArr = arr === "RED" ? "RFD" : arr;
      allRoutes.push({ dep: correctedDep, arr: correctedArr, position: routeMatch.index });
    }
  }

  console.log(`  [CrewAccess] Found ${allRoutes.length} routes in OCR text`);

  // For each REST time position, find the last route before it
  let restDayIndex = 0;
  for (const restInfo of restTimePositions) {
    restDayIndex++;

    // Find all routes that appear BEFORE this "Duty totals" line
    const routesBefore = allRoutes.filter(r => r.position < restInfo.position);

    // The last route before this Duty totals line is the one that ends the duty day
    const lastRouteBefore = routesBefore.length > 0 ? routesBefore[routesBefore.length - 1] : null;
    const layoverStation = lastRouteBefore?.arr;

    // Calculate the date for this layover using UTC-safe string manipulation
    let layoverDate: string | null = null;
    if (tripStartDateStr) {
      layoverDate = addDaysToDateString(tripStartDateStr, restDayIndex - 1);
    }

    console.log(`  [CrewAccess] REST ${restDayIndex}: ${restInfo.hours}:${restInfo.minutes.toString().padStart(2, '0')} (${restInfo.restMinutes} min) at ${layoverStation || 'unknown'} (last route before pos ${restInfo.position}: ${lastRouteBefore?.dep}-${lastRouteBefore?.arr})`);

    // Add layover event with the correct station
    events.push({
      eventType: {
        value: 'LAYOVER',
        confidence: confBase * 0.95,
      },
      date: layoverDate ? { value: layoverDate, confidence: confBase * 0.9 } : undefined,
      layoverMinutes: { value: restInfo.restMinutes, confidence: confBase * 0.95 },
      depAirport: layoverStation ? { value: layoverStation, confidence: confBase * 0.9 } : undefined, // Station where layover occurs
    });
  }

  console.log(`  [CrewAccess] Extracted ${restDayIndex} REST/layover times with station associations`);

  // Find all routes in the text that we haven't captured yet
  const missedRoutes = fullText.match(/([A-Z]{3})-([A-Z]{3})/g) || [];
  const capturedRoutes = new Set(events.map(e => `${e.depAirport?.value}-${e.arrAirport?.value}`));

  for (const route of missedRoutes) {
    const [dep, arr] = route.split('-');
    if (!dep || !arr) continue;

    // Apply OCR corrections FIRST
    let depAirport = dep === "RED" ? "RFD" : dep;
    let arrAirport = arr === "RED" ? "RFD" : arr;

    // Skip if already captured (check both original and corrected)
    const correctedRoute = `${depAirport}-${arrAirport}`;
    if (capturedRoutes.has(route) || capturedRoutes.has(correctedRoute)) continue;

    // Skip non-airports
    if (nonAirport.has(depAirport) || nonAirport.has(arrAirport)) continue;

    // Get context around this route
    const routeIndex = fullText.indexOf(route);
    const contextStart = Math.max(0, routeIndex - 100);
    const contextEnd = Math.min(fullText.length, routeIndex + route.length + 150);
    const context = fullText.substring(contextStart, contextEnd);

    // Extract times from context
    const times = context.match(/(\d{1,2}:\d{2})/g) || [];

    // Check for deadhead
    const isDeadhead = /\bDH\b/i.test(context.substring(0, 50));

    // Try to find flight number before the route
    const flightMatch = context.match(/(?:^|\s)(\d{3,5}|GND)\s+[A-Z]{3}-[A-Z]{3}/);
    const flightNumber = flightMatch ? flightMatch[1] : null;

    // Look for day number - match patterns like "7Sa", "75a", "78a" (OCR reads "Sa" as "5a" or "8a")
    const dayMatch = context.match(/(\d)\s*(?:Su|Mo|Tu|We|Th|Fr|Sa|5a|8a)/i);
    let flightDate: string | null = null;
    if (dayMatch && dayMatch[1] && tripStartDateStr) {
      const dayNum = parseInt(dayMatch[1], 10);
      flightDate = addDaysToDateString(tripStartDateStr, dayNum - 1);
    }

    console.log(`  [CrewAccess] Strategy 2: Found missed route ${depAirport}-${arrAirport} Flt=${flightNumber || 'N/A'}`);

    // For Crew Access format, times are: Zulu_dep, Local_dep, Zulu_arr, Local_arr, Block
    // Use LOCAL times (positions 1 and 3) for domestic flights
    const depTimeLocal = times.length >= 4 ? times[1] : times[0]; // Local departure (position 1)
    const arrTimeLocal = times.length >= 4 ? times[3] : (times.length >= 2 ? times[1] : undefined); // Local arrival (position 3)

    events.push({
      eventType: {
        value: isDeadhead ? "DEADHEAD" : "FLIGHT",
        confidence: confBase * 0.8,
      },
      date: flightDate ? { value: flightDate, confidence: confBase * 0.7 } : undefined,
      flightNumber: flightNumber ? { value: flightNumber, confidence: confBase * 0.7 } : undefined,
      depAirport: { value: depAirport, confidence: confBase * 0.85 },
      arrAirport: { value: arrAirport, confidence: confBase * 0.85 },
      startTime: depTimeLocal ? { value: depTimeLocal, confidence: confBase * 0.7 } : undefined,
      endTime: arrTimeLocal ? { value: arrTimeLocal, confidence: confBase * 0.7 } : undefined,
      isDeadhead: { value: isDeadhead, confidence: confBase * 0.8 },
    });

    capturedRoutes.add(`${depAirport}-${arrAirport}`);
  }

  console.log(`  [CrewAccess] Extracted ${events.length} flight events total`);
  return events;
}

// ============================================
// Main Parser
// ============================================

/**
 * Parse OCR result into structured schedule data
 */
export function parseScheduleFromOCR(ocrResult: OCRResult): ParsedSchedule {
  const fullText = ocrResult.fullText;
  const baseConfidence = ocrResult.confidence;

  // Classify source type
  const sourceType = classifySourceType(fullText);

  // Extract trip identifiers
  let tripNumber: ParsedField<string> | undefined;
  const tripMatch = fullText.match(TRIP_NUMBER_PATTERN);
  if (tripMatch) {
    tripNumber = {
      value: `Trip ${tripMatch[1]}`,
      confidence: baseConfidence * 0.9 / 100,
    };
  }

  let pairingId: ParsedField<string> | undefined;
  const pairingMatch = fullText.match(PAIRING_ID_PATTERN);
  if (pairingMatch && pairingMatch[1]) {
    pairingId = {
      value: pairingMatch[1],
      confidence: baseConfidence * 0.85 / 100,
    };
  }

  // Extract base/fleet
  let baseFleet: ParsedField<string> | undefined;
  const baseFleetMatch = fullText.match(/([A-Z]{3})\s+(7[3567]7|76[78])/i);
  if (baseFleetMatch && baseFleetMatch[1] && baseFleetMatch[2]) {
    baseFleet = {
      value: `${baseFleetMatch[1]} ${baseFleetMatch[2]}`,
      confidence: baseConfidence * 0.8 / 100,
    };
  }

  // Extract report time
  let reportTime: ParsedField<string> | undefined;
  const reportMatch = fullText.match(/Report\s+(?:at\s*)?\(?(\d+)?\)?\s*(\d{1,2}:\d{2})/i);
  if (reportMatch && reportMatch[2]) {
    reportTime = {
      value: reportMatch[2],
      confidence: baseConfidence * 0.9 / 100,
    };
  }

  // Parse events from lines
  const events: ParsedEvent[] = [];

  // Add report event if found
  if (reportTime) {
    events.push({
      eventType: { value: "REPORT", confidence: 0.95 },
      startTime: reportTime,
    });
  }

  // Use specialized parsers based on source type
  if (sourceType.value === "trip_board_browser" || sourceType.value === "trip_board_trip_details") {
    console.log(`  [Parser] Using Trip Board table parser for source: ${sourceType.value}`);
    const tripBoardEvents = parseTripBoardTable(fullText, baseConfidence);
    events.push(...tripBoardEvents);
  }

  // Use specialized parser for Crew Access table format
  if (sourceType.value === "crew_access_trip_info" || sourceType.value === "crew_access_enrichment_only") {
    console.log(`  [Parser] Using Crew Access table parser`);
    const crewAccessEvents = parseCrewAccessTable(fullText, baseConfidence);
    events.push(...crewAccessEvents);
  }

  // If source is unknown, try both parsers
  if (sourceType.value === "unknown") {
    console.log(`  [Parser] Unknown source type, trying all parsers`);
    const tripBoardEvents = parseTripBoardTable(fullText, baseConfidence);
    events.push(...tripBoardEvents);
    const crewAccessEvents = parseCrewAccessTable(fullText, baseConfidence);
    // Only add non-duplicate events
    for (const event of crewAccessEvents) {
      const isDuplicate = events.some(e =>
        e.depAirport?.value === event.depAirport?.value &&
        e.arrAirport?.value === event.arrAirport?.value &&
        e.startTime?.value === event.startTime?.value
      );
      if (!isDuplicate) {
        events.push(event);
      }
    }
  }

  // Also try standard flight row parsing (catches additional formats)
  for (const line of ocrResult.lines) {
    const flightEvent = parseFlightRow(line.text, line.confidence);
    if (flightEvent) {
      // Check if we already have this flight (avoid duplicates)
      const isDuplicate = events.some(e =>
        e.eventType.value === flightEvent.eventType.value &&
        e.depAirport?.value === flightEvent.depAirport?.value &&
        e.arrAirport?.value === flightEvent.arrAirport?.value &&
        e.startTime?.value === flightEvent.startTime?.value
      );
      if (!isDuplicate) {
        events.push(flightEvent);
      }
    }
  }

  // Parse layovers (look for L/O times)
  const layoverPattern = /L\/O[:\s]+(\d+:\d{2})/gi;
  let layoverMatch;
  while ((layoverMatch = layoverPattern.exec(fullText)) !== null) {
    if (layoverMatch[1]) {
      events.push({
        eventType: { value: "LAYOVER", confidence: baseConfidence * 0.85 / 100 },
        layoverMinutes: {
          value: parseDurationToMinutes(layoverMatch[1]),
          confidence: baseConfidence * 0.8 / 100,
        },
      });
    }
  }

  // Parse hotels
  const hotels = parseHotelInfo(fullText, baseConfidence);

  // Add hotel events
  for (const hotel of hotels) {
    events.push({
      eventType: { value: "HOTEL", confidence: hotel.name.confidence },
      hotelName: hotel.name,
      hotelPhone: hotel.phone,
      hotelBooked: hotel.booked,
    });
  }

  // Parse transport
  const transport = parseTransportInfo(fullText, baseConfidence);

  // Add transport events
  for (const t of transport) {
    events.push({
      eventType: { value: "TRANSPORT", confidence: t.notes.confidence },
      transportNotes: t.notes,
      transportPhone: t.phone,
    });
  }

  // Parse totals
  const totals = parseTotals(fullText, baseConfidence);

  // Calculate overall confidence
  const fieldConfidences: number[] = [sourceType.confidence];
  if (tripNumber) fieldConfidences.push(tripNumber.confidence);
  if (pairingId) fieldConfidences.push(pairingId.confidence);
  for (const event of events) {
    fieldConfidences.push(event.eventType.confidence);
  }
  const overallConfidence =
    fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length;

  // Identify low confidence fields
  const lowConfidenceFields: string[] = [];
  const LOW_CONFIDENCE_THRESHOLD = 0.7;

  if (sourceType.confidence < LOW_CONFIDENCE_THRESHOLD) {
    lowConfidenceFields.push("sourceType");
  }
  if (tripNumber && tripNumber.confidence < LOW_CONFIDENCE_THRESHOLD) {
    lowConfidenceFields.push("tripNumber");
  }
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event && event.eventType.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceFields.push(`events[${i}].eventType`);
    }
    if (event && event.flightNumber && event.flightNumber.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceFields.push(`events[${i}].flightNumber`);
    }
  }

  // Extract dates from text
  let startDate: ParsedField<string> | undefined;
  let endDate: ParsedField<string> | undefined;

  const isoDateMatch = fullText.match(DATE_PATTERN_ISO);
  if (isoDateMatch) {
    startDate = {
      value: isoDateMatch[0],
      confidence: baseConfidence * 0.9 / 100,
    };
  }

  // Determine what content we have
  const hasFlightLegs = events.some(
    (e) => e.eventType.value === "FLIGHT" ||
           e.eventType.value === "DEADHEAD" ||
           e.eventType.value === "COMMUTE"
  );
  const hasHotelInfo = hotels.length > 0 || events.some((e) => e.eventType.value === "HOTEL");
  const hasTransportInfo = transport.length > 0 || events.some((e) => e.eventType.value === "TRANSPORT");

  // Check if we have enough trip info to create a trip even without explicit flight legs
  // Crew Access often shows trip info with hotel details but flight info is harder to extract
  const hasTripIdentifier = tripNumber?.value || pairingId?.value;
  const hasDateRange = startDate?.value;
  const hasCrewAccessTripInfo = sourceType.value === "crew_access_trip_info" && (hasTripIdentifier || hasDateRange);

  // Classify the parse result
  let classification: ParseClassification;
  if (hasFlightLegs) {
    classification = "full_schedule";
  } else if (hasCrewAccessTripInfo) {
    // Crew Access trip info screen - treat as full schedule even without explicit flight legs
    // The trip number and date info IS the schedule - we can still create a trip
    classification = "full_schedule";
  } else if (hasHotelInfo || hasTransportInfo) {
    classification = "enrichment_only";
    // Update source type if it's crew access with only enrichment
    if (sourceType.value === "crew_access_trip_info") {
      sourceType.value = "crew_access_enrichment_only";
    } else if (sourceType.value !== "crew_access_enrichment_only") {
      sourceType.value = "enrichment_only";
    }
  } else {
    classification = "incomplete";
  }

  return {
    sourceType,
    classification,
    tripNumber,
    pairingId,
    baseFleet,
    startDate,
    endDate,
    reportTime,
    events,
    totals,
    hotels,
    transport,
    overallConfidence,
    lowConfidenceFields,
    rawText: fullText,
    hasFlightLegs,
    hasHotelInfo,
    hasTransportInfo,
  };
}

/**
 * Convert parsed schedule to simplified format for API response
 */
export function simplifyParsedSchedule(parsed: ParsedSchedule): {
  sourceType: SourceType;
  classification: ParseClassification;
  tripNumber: string | null;
  pairingId: string | null;
  baseFleet: string | null;
  startDate: string | null;
  endDate: string | null;
  reportTime: string | null;
  events: Array<{
    eventType: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    depAirport?: string;
    arrAirport?: string;
    flightNumber?: string;
    equipment?: string;
    blockMinutes?: number;
    creditMinutes?: number;
    layoverMinutes?: number;
    hotelName?: string;
    hotelPhone?: string;
    hotelBooked?: boolean;
    hotelAddress?: string;
    transportNotes?: string;
    transportPhone?: string;
    isDeadhead?: boolean;
    rawCreditText?: string;
  }>;
  totals: {
    creditMinutes?: number;
    blockMinutes?: number;
    tafbMinutes?: number;
    dutyDays?: number;
    perDiemCents?: number;
  };
  hotels: Array<{
    name: string;
    phone?: string;
    booked?: boolean;
    layoverAirport?: string;
    address?: string;
  }>;
  transport: Array<{
    notes: string;
    phone?: string;
    layoverAirport?: string;
  }>;
  confidence: number;
  lowConfidenceFields: string[];
  hasFlightLegs: boolean;
  hasHotelInfo: boolean;
  hasTransportInfo: boolean;
} {
  return {
    sourceType: parsed.sourceType.value,
    classification: parsed.classification,
    tripNumber: parsed.tripNumber?.value || null,
    pairingId: parsed.pairingId?.value || null,
    baseFleet: parsed.baseFleet?.value || null,
    startDate: parsed.startDate?.value || null,
    endDate: parsed.endDate?.value || null,
    reportTime: parsed.reportTime?.value || null,
    events: parsed.events.map((e) => ({
      eventType: e.eventType.value,
      date: e.date?.value,
      startTime: e.startTime?.value,
      endTime: e.endTime?.value,
      depAirport: e.depAirport?.value,
      arrAirport: e.arrAirport?.value,
      flightNumber: e.flightNumber?.value,
      equipment: e.equipment?.value,
      blockMinutes: e.blockMinutes?.value,
      creditMinutes: e.creditMinutes?.value,
      layoverMinutes: e.layoverMinutes?.value,
      hotelName: e.hotelName?.value,
      hotelPhone: e.hotelPhone?.value,
      hotelBooked: e.hotelBooked?.value,
      hotelAddress: e.hotelAddress?.value,
      transportNotes: e.transportNotes?.value,
      transportPhone: e.transportPhone?.value,
      isDeadhead: e.isDeadhead?.value,
      rawCreditText: e.rawCreditText?.value,
    })),
    totals: {
      creditMinutes: parsed.totals.creditMinutes?.value,
      blockMinutes: parsed.totals.blockMinutes?.value,
      tafbMinutes: parsed.totals.tafbMinutes?.value,
      dutyDays: parsed.totals.dutyDays?.value,
      perDiemCents: parsed.totals.perDiemCents?.value,
    },
    hotels: parsed.hotels.map((h) => ({
      name: h.name.value,
      phone: h.phone?.value,
      booked: h.booked?.value,
      layoverAirport: h.layoverAirport?.value,
      address: h.address?.value,
    })),
    transport: parsed.transport.map((t) => ({
      notes: t.notes.value,
      phone: t.phone?.value,
      layoverAirport: t.layoverAirport?.value,
    })),
    confidence: parsed.overallConfidence,
    lowConfidenceFields: parsed.lowConfidenceFields,
    hasFlightLegs: parsed.hasFlightLegs,
    hasHotelInfo: parsed.hasHotelInfo,
    hasTransportInfo: parsed.hasTransportInfo,
  };
}
