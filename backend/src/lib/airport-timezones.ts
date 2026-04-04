/**
 * Airport Timezone Database
 *
 * Maps IATA airport codes to IANA timezone strings.
 * Used for accurate local time normalization in schedule imports.
 *
 * IMPORTANT: Crew Access Start(LT)/End(LT) are ALREADY local times.
 * Do NOT convert them. This database is used to:
 * 1. Validate that times make sense for the airport
 * 2. Convert Zulu times to local when needed
 * 3. Handle midnight rollover calculations
 */

export interface AirportTimezone {
  iata: string;
  iana: string;
  name?: string;
  city?: string;
  utcOffset?: number; // Standard offset in hours (not accounting for DST)
}

// UPS major stations and common US/international airports
export const AIRPORT_TIMEZONES: Record<string, AirportTimezone> = {
  // ============================================
  // UPS MAJOR HUBS
  // ============================================
  SDF: { iata: "SDF", iana: "America/Kentucky/Louisville", name: "Louisville Muhammad Ali Intl", city: "Louisville", utcOffset: -5 },
  ONT: { iata: "ONT", iana: "America/Los_Angeles", name: "Ontario Intl", city: "Ontario", utcOffset: -8 },
  PHL: { iata: "PHL", iana: "America/New_York", name: "Philadelphia Intl", city: "Philadelphia", utcOffset: -5 },
  DFW: { iata: "DFW", iana: "America/Chicago", name: "Dallas/Fort Worth Intl", city: "Dallas", utcOffset: -6 },
  RFD: { iata: "RFD", iana: "America/Chicago", name: "Chicago Rockford Intl", city: "Rockford", utcOffset: -6 },
  MIA: { iata: "MIA", iana: "America/New_York", name: "Miami Intl", city: "Miami", utcOffset: -5 },
  ANC: { iata: "ANC", iana: "America/Anchorage", name: "Ted Stevens Anchorage Intl", city: "Anchorage", utcOffset: -9 },

  // ============================================
  // US DOMESTIC - EASTERN
  // ============================================
  JFK: { iata: "JFK", iana: "America/New_York", name: "John F. Kennedy Intl", city: "New York", utcOffset: -5 },
  EWR: { iata: "EWR", iana: "America/New_York", name: "Newark Liberty Intl", city: "Newark", utcOffset: -5 },
  LGA: { iata: "LGA", iana: "America/New_York", name: "LaGuardia", city: "New York", utcOffset: -5 },
  BOS: { iata: "BOS", iana: "America/New_York", name: "Boston Logan Intl", city: "Boston", utcOffset: -5 },
  IAD: { iata: "IAD", iana: "America/New_York", name: "Washington Dulles Intl", city: "Washington", utcOffset: -5 },
  DCA: { iata: "DCA", iana: "America/New_York", name: "Ronald Reagan Washington Natl", city: "Washington", utcOffset: -5 },
  BWI: { iata: "BWI", iana: "America/New_York", name: "Baltimore/Washington Intl", city: "Baltimore", utcOffset: -5 },
  ATL: { iata: "ATL", iana: "America/New_York", name: "Hartsfield-Jackson Atlanta Intl", city: "Atlanta", utcOffset: -5 },
  MCO: { iata: "MCO", iana: "America/New_York", name: "Orlando Intl", city: "Orlando", utcOffset: -5 },
  TPA: { iata: "TPA", iana: "America/New_York", name: "Tampa Intl", city: "Tampa", utcOffset: -5 },
  CLT: { iata: "CLT", iana: "America/New_York", name: "Charlotte Douglas Intl", city: "Charlotte", utcOffset: -5 },
  RDU: { iata: "RDU", iana: "America/New_York", name: "Raleigh-Durham Intl", city: "Raleigh", utcOffset: -5 },
  PIT: { iata: "PIT", iana: "America/New_York", name: "Pittsburgh Intl", city: "Pittsburgh", utcOffset: -5 },
  CLE: { iata: "CLE", iana: "America/New_York", name: "Cleveland Hopkins Intl", city: "Cleveland", utcOffset: -5 },
  CVG: { iata: "CVG", iana: "America/New_York", name: "Cincinnati/Northern Kentucky Intl", city: "Cincinnati", utcOffset: -5 },
  CMH: { iata: "CMH", iana: "America/New_York", name: "John Glenn Columbus Intl", city: "Columbus", utcOffset: -5 },
  DTW: { iata: "DTW", iana: "America/Detroit", name: "Detroit Metro Wayne County", city: "Detroit", utcOffset: -5 },
  IND: { iata: "IND", iana: "America/Indiana/Indianapolis", name: "Indianapolis Intl", city: "Indianapolis", utcOffset: -5 },

  // ============================================
  // US DOMESTIC - CENTRAL
  // ============================================
  ORD: { iata: "ORD", iana: "America/Chicago", name: "O'Hare Intl", city: "Chicago", utcOffset: -6 },
  MDW: { iata: "MDW", iana: "America/Chicago", name: "Chicago Midway Intl", city: "Chicago", utcOffset: -6 },
  MSP: { iata: "MSP", iana: "America/Chicago", name: "Minneapolis-St Paul Intl", city: "Minneapolis", utcOffset: -6 },
  MCI: { iata: "MCI", iana: "America/Chicago", name: "Kansas City Intl", city: "Kansas City", utcOffset: -6 },
  STL: { iata: "STL", iana: "America/Chicago", name: "St. Louis Lambert Intl", city: "St. Louis", utcOffset: -6 },
  MSY: { iata: "MSY", iana: "America/Chicago", name: "Louis Armstrong New Orleans Intl", city: "New Orleans", utcOffset: -6 },
  IAH: { iata: "IAH", iana: "America/Chicago", name: "George Bush Intercontinental", city: "Houston", utcOffset: -6 },
  HOU: { iata: "HOU", iana: "America/Chicago", name: "William P. Hobby", city: "Houston", utcOffset: -6 },
  SAT: { iata: "SAT", iana: "America/Chicago", name: "San Antonio Intl", city: "San Antonio", utcOffset: -6 },
  AUS: { iata: "AUS", iana: "America/Chicago", name: "Austin-Bergstrom Intl", city: "Austin", utcOffset: -6 },
  OKC: { iata: "OKC", iana: "America/Chicago", name: "Will Rogers World", city: "Oklahoma City", utcOffset: -6 },
  TUL: { iata: "TUL", iana: "America/Chicago", name: "Tulsa Intl", city: "Tulsa", utcOffset: -6 },
  MEM: { iata: "MEM", iana: "America/Chicago", name: "Memphis Intl", city: "Memphis", utcOffset: -6 },
  BNA: { iata: "BNA", iana: "America/Chicago", name: "Nashville Intl", city: "Nashville", utcOffset: -6 },
  MKE: { iata: "MKE", iana: "America/Chicago", name: "General Mitchell Intl", city: "Milwaukee", utcOffset: -6 },
  DSM: { iata: "DSM", iana: "America/Chicago", name: "Des Moines Intl", city: "Des Moines", utcOffset: -6 },
  OMA: { iata: "OMA", iana: "America/Chicago", name: "Eppley Airfield", city: "Omaha", utcOffset: -6 },

  // ============================================
  // US DOMESTIC - MOUNTAIN
  // ============================================
  DEN: { iata: "DEN", iana: "America/Denver", name: "Denver Intl", city: "Denver", utcOffset: -7 },
  PHX: { iata: "PHX", iana: "America/Phoenix", name: "Phoenix Sky Harbor Intl", city: "Phoenix", utcOffset: -7 },
  SLC: { iata: "SLC", iana: "America/Denver", name: "Salt Lake City Intl", city: "Salt Lake City", utcOffset: -7 },
  ABQ: { iata: "ABQ", iana: "America/Denver", name: "Albuquerque Intl Sunport", city: "Albuquerque", utcOffset: -7 },
  ELP: { iata: "ELP", iana: "America/Denver", name: "El Paso Intl", city: "El Paso", utcOffset: -7 },
  TUS: { iata: "TUS", iana: "America/Phoenix", name: "Tucson Intl", city: "Tucson", utcOffset: -7 },
  BOI: { iata: "BOI", iana: "America/Boise", name: "Boise Air Terminal", city: "Boise", utcOffset: -7 },

  // ============================================
  // US DOMESTIC - PACIFIC
  // ============================================
  LAX: { iata: "LAX", iana: "America/Los_Angeles", name: "Los Angeles Intl", city: "Los Angeles", utcOffset: -8 },
  SFO: { iata: "SFO", iana: "America/Los_Angeles", name: "San Francisco Intl", city: "San Francisco", utcOffset: -8 },
  SJC: { iata: "SJC", iana: "America/Los_Angeles", name: "San Jose Intl", city: "San Jose", utcOffset: -8 },
  OAK: { iata: "OAK", iana: "America/Los_Angeles", name: "Oakland Intl", city: "Oakland", utcOffset: -8 },
  SAN: { iata: "SAN", iana: "America/Los_Angeles", name: "San Diego Intl", city: "San Diego", utcOffset: -8 },
  SEA: { iata: "SEA", iana: "America/Los_Angeles", name: "Seattle-Tacoma Intl", city: "Seattle", utcOffset: -8 },
  PDX: { iata: "PDX", iana: "America/Los_Angeles", name: "Portland Intl", city: "Portland", utcOffset: -8 },
  BFI: { iata: "BFI", iana: "America/Los_Angeles", name: "Boeing Field King County Intl", city: "Seattle", utcOffset: -8 },
  LAS: { iata: "LAS", iana: "America/Los_Angeles", name: "Harry Reid Intl", city: "Las Vegas", utcOffset: -8 },
  SMF: { iata: "SMF", iana: "America/Los_Angeles", name: "Sacramento Intl", city: "Sacramento", utcOffset: -8 },
  SNA: { iata: "SNA", iana: "America/Los_Angeles", name: "John Wayne", city: "Orange County", utcOffset: -8 },
  BUR: { iata: "BUR", iana: "America/Los_Angeles", name: "Hollywood Burbank", city: "Burbank", utcOffset: -8 },
  LGB: { iata: "LGB", iana: "America/Los_Angeles", name: "Long Beach", city: "Long Beach", utcOffset: -8 },

  // ============================================
  // US DOMESTIC - ALASKA & HAWAII
  // ============================================
  HNL: { iata: "HNL", iana: "Pacific/Honolulu", name: "Daniel K. Inouye Intl", city: "Honolulu", utcOffset: -10 },
  OGG: { iata: "OGG", iana: "Pacific/Honolulu", name: "Kahului", city: "Maui", utcOffset: -10 },
  KOA: { iata: "KOA", iana: "Pacific/Honolulu", name: "Kona Intl", city: "Kona", utcOffset: -10 },
  FAI: { iata: "FAI", iana: "America/Anchorage", name: "Fairbanks Intl", city: "Fairbanks", utcOffset: -9 },

  // ============================================
  // CANADA
  // ============================================
  YYZ: { iata: "YYZ", iana: "America/Toronto", name: "Toronto Pearson Intl", city: "Toronto", utcOffset: -5 },
  YVR: { iata: "YVR", iana: "America/Vancouver", name: "Vancouver Intl", city: "Vancouver", utcOffset: -8 },
  YYC: { iata: "YYC", iana: "America/Edmonton", name: "Calgary Intl", city: "Calgary", utcOffset: -7 },
  YEG: { iata: "YEG", iana: "America/Edmonton", name: "Edmonton Intl", city: "Edmonton", utcOffset: -7 },
  YUL: { iata: "YUL", iana: "America/Montreal", name: "Montréal-Pierre Elliott Trudeau Intl", city: "Montreal", utcOffset: -5 },
  YOW: { iata: "YOW", iana: "America/Toronto", name: "Ottawa Macdonald-Cartier Intl", city: "Ottawa", utcOffset: -5 },

  // ============================================
  // MEXICO & CENTRAL AMERICA
  // ============================================
  MEX: { iata: "MEX", iana: "America/Mexico_City", name: "Mexico City Intl", city: "Mexico City", utcOffset: -6 },
  GDL: { iata: "GDL", iana: "America/Mexico_City", name: "Guadalajara Intl", city: "Guadalajara", utcOffset: -6 },
  CUN: { iata: "CUN", iana: "America/Cancun", name: "Cancún Intl", city: "Cancún", utcOffset: -5 },
  SJO: { iata: "SJO", iana: "America/Costa_Rica", name: "Juan Santamaría Intl", city: "San José", utcOffset: -6 },
  PTY: { iata: "PTY", iana: "America/Panama", name: "Tocumen Intl", city: "Panama City", utcOffset: -5 },

  // ============================================
  // SOUTH AMERICA
  // ============================================
  GRU: { iata: "GRU", iana: "America/Sao_Paulo", name: "São Paulo–Guarulhos Intl", city: "São Paulo", utcOffset: -3 },
  BOG: { iata: "BOG", iana: "America/Bogota", name: "El Dorado Intl", city: "Bogotá", utcOffset: -5 },
  LIM: { iata: "LIM", iana: "America/Lima", name: "Jorge Chávez Intl", city: "Lima", utcOffset: -5 },
  SCL: { iata: "SCL", iana: "America/Santiago", name: "Arturo Merino Benítez Intl", city: "Santiago", utcOffset: -4 },
  EZE: { iata: "EZE", iana: "America/Argentina/Buenos_Aires", name: "Ministro Pistarini Intl", city: "Buenos Aires", utcOffset: -3 },

  // ============================================
  // EUROPE
  // ============================================
  CGN: { iata: "CGN", iana: "Europe/Berlin", name: "Cologne Bonn", city: "Cologne", utcOffset: 1 },
  FRA: { iata: "FRA", iana: "Europe/Berlin", name: "Frankfurt am Main", city: "Frankfurt", utcOffset: 1 },
  LHR: { iata: "LHR", iana: "Europe/London", name: "London Heathrow", city: "London", utcOffset: 0 },
  CDG: { iata: "CDG", iana: "Europe/Paris", name: "Charles de Gaulle", city: "Paris", utcOffset: 1 },
  AMS: { iata: "AMS", iana: "Europe/Amsterdam", name: "Amsterdam Schiphol", city: "Amsterdam", utcOffset: 1 },
  MAD: { iata: "MAD", iana: "Europe/Madrid", name: "Adolfo Suárez Madrid–Barajas", city: "Madrid", utcOffset: 1 },
  FCO: { iata: "FCO", iana: "Europe/Rome", name: "Leonardo da Vinci–Fiumicino", city: "Rome", utcOffset: 1 },
  MXP: { iata: "MXP", iana: "Europe/Rome", name: "Milan Malpensa", city: "Milan", utcOffset: 1 },
  ZRH: { iata: "ZRH", iana: "Europe/Zurich", name: "Zürich", city: "Zurich", utcOffset: 1 },
  BRU: { iata: "BRU", iana: "Europe/Brussels", name: "Brussels", city: "Brussels", utcOffset: 1 },
  MUC: { iata: "MUC", iana: "Europe/Berlin", name: "Munich", city: "Munich", utcOffset: 1 },
  VIE: { iata: "VIE", iana: "Europe/Vienna", name: "Vienna Intl", city: "Vienna", utcOffset: 1 },
  CPH: { iata: "CPH", iana: "Europe/Copenhagen", name: "Copenhagen", city: "Copenhagen", utcOffset: 1 },
  ARN: { iata: "ARN", iana: "Europe/Stockholm", name: "Stockholm Arlanda", city: "Stockholm", utcOffset: 1 },
  OSL: { iata: "OSL", iana: "Europe/Oslo", name: "Oslo Gardermoen", city: "Oslo", utcOffset: 1 },
  DUB: { iata: "DUB", iana: "Europe/Dublin", name: "Dublin", city: "Dublin", utcOffset: 0 },
  LGW: { iata: "LGW", iana: "Europe/London", name: "London Gatwick", city: "London", utcOffset: 0 },
  STN: { iata: "STN", iana: "Europe/London", name: "London Stansted", city: "London", utcOffset: 0 },
  EDI: { iata: "EDI", iana: "Europe/London", name: "Edinburgh", city: "Edinburgh", utcOffset: 0 },
  BCN: { iata: "BCN", iana: "Europe/Madrid", name: "Josep Tarradellas Barcelona-El Prat", city: "Barcelona", utcOffset: 1 },
  LIS: { iata: "LIS", iana: "Europe/Lisbon", name: "Lisbon Humberto Delgado", city: "Lisbon", utcOffset: 0 },
  WAW: { iata: "WAW", iana: "Europe/Warsaw", name: "Warsaw Chopin", city: "Warsaw", utcOffset: 1 },
  PRG: { iata: "PRG", iana: "Europe/Prague", name: "Václav Havel", city: "Prague", utcOffset: 1 },
  BUD: { iata: "BUD", iana: "Europe/Budapest", name: "Budapest Ferenc Liszt Intl", city: "Budapest", utcOffset: 1 },

  // ============================================
  // ASIA PACIFIC
  // ============================================
  HKG: { iata: "HKG", iana: "Asia/Hong_Kong", name: "Hong Kong Intl", city: "Hong Kong", utcOffset: 8 },
  SIN: { iata: "SIN", iana: "Asia/Singapore", name: "Singapore Changi", city: "Singapore", utcOffset: 8 },
  NRT: { iata: "NRT", iana: "Asia/Tokyo", name: "Narita Intl", city: "Tokyo", utcOffset: 9 },
  HND: { iata: "HND", iana: "Asia/Tokyo", name: "Tokyo Haneda", city: "Tokyo", utcOffset: 9 },
  PVG: { iata: "PVG", iana: "Asia/Shanghai", name: "Shanghai Pudong Intl", city: "Shanghai", utcOffset: 8 },
  PEK: { iata: "PEK", iana: "Asia/Shanghai", name: "Beijing Capital Intl", city: "Beijing", utcOffset: 8 },
  ICN: { iata: "ICN", iana: "Asia/Seoul", name: "Incheon Intl", city: "Seoul", utcOffset: 9 },
  TPE: { iata: "TPE", iana: "Asia/Taipei", name: "Taiwan Taoyuan Intl", city: "Taipei", utcOffset: 8 },
  MNL: { iata: "MNL", iana: "Asia/Manila", name: "Ninoy Aquino Intl", city: "Manila", utcOffset: 8 },
  BKK: { iata: "BKK", iana: "Asia/Bangkok", name: "Suvarnabhumi", city: "Bangkok", utcOffset: 7 },
  KUL: { iata: "KUL", iana: "Asia/Kuala_Lumpur", name: "Kuala Lumpur Intl", city: "Kuala Lumpur", utcOffset: 8 },
  SYD: { iata: "SYD", iana: "Australia/Sydney", name: "Sydney Kingsford Smith", city: "Sydney", utcOffset: 10 },
  MEL: { iata: "MEL", iana: "Australia/Melbourne", name: "Melbourne", city: "Melbourne", utcOffset: 10 },
  AKL: { iata: "AKL", iana: "Pacific/Auckland", name: "Auckland", city: "Auckland", utcOffset: 12 },
  DEL: { iata: "DEL", iana: "Asia/Kolkata", name: "Indira Gandhi Intl", city: "New Delhi", utcOffset: 5.5 },
  BOM: { iata: "BOM", iana: "Asia/Kolkata", name: "Chhatrapati Shivaji Maharaj Intl", city: "Mumbai", utcOffset: 5.5 },
  DXB: { iata: "DXB", iana: "Asia/Dubai", name: "Dubai Intl", city: "Dubai", utcOffset: 4 },
  DOH: { iata: "DOH", iana: "Asia/Qatar", name: "Hamad Intl", city: "Doha", utcOffset: 3 },
  AUH: { iata: "AUH", iana: "Asia/Dubai", name: "Abu Dhabi Intl", city: "Abu Dhabi", utcOffset: 4 },
  TLV: { iata: "TLV", iana: "Asia/Jerusalem", name: "Ben Gurion", city: "Tel Aviv", utcOffset: 2 },
  IST: { iata: "IST", iana: "Europe/Istanbul", name: "Istanbul", city: "Istanbul", utcOffset: 3 },

  // ============================================
  // AFRICA
  // ============================================
  JNB: { iata: "JNB", iana: "Africa/Johannesburg", name: "O.R. Tambo Intl", city: "Johannesburg", utcOffset: 2 },
  CPT: { iata: "CPT", iana: "Africa/Johannesburg", name: "Cape Town Intl", city: "Cape Town", utcOffset: 2 },
  NBO: { iata: "NBO", iana: "Africa/Nairobi", name: "Jomo Kenyatta Intl", city: "Nairobi", utcOffset: 3 },
  CAI: { iata: "CAI", iana: "Africa/Cairo", name: "Cairo Intl", city: "Cairo", utcOffset: 2 },
  LOS: { iata: "LOS", iana: "Africa/Lagos", name: "Murtala Muhammed Intl", city: "Lagos", utcOffset: 1 },
  ADD: { iata: "ADD", iana: "Africa/Addis_Ababa", name: "Bole Intl", city: "Addis Ababa", utcOffset: 3 },
  CMN: { iata: "CMN", iana: "Africa/Casablanca", name: "Mohammed V Intl", city: "Casablanca", utcOffset: 1 },
  ALG: { iata: "ALG", iana: "Africa/Algiers", name: "Houari Boumediene", city: "Algiers", utcOffset: 1 },
};

/**
 * Get timezone for an airport by IATA code
 */
export function getAirportTimezone(iataCode: string): AirportTimezone | null {
  return AIRPORT_TIMEZONES[iataCode.toUpperCase()] ?? null;
}

/**
 * Get IANA timezone string for an airport
 */
export function getAirportIanaTimezone(iataCode: string): string | null {
  return AIRPORT_TIMEZONES[iataCode.toUpperCase()]?.iana ?? null;
}

/**
 * Check if an airport code is valid
 */
export function isValidAirportCode(iataCode: string): boolean {
  return iataCode.toUpperCase() in AIRPORT_TIMEZONES;
}

/**
 * Parse a local time string and airport to create an ISO datetime
 *
 * @param date - The date in YYYY-MM-DD format
 * @param localTime - The local time in HH:MM format
 * @param airportCode - The IATA airport code
 * @returns ISO datetime string with timezone (or null if airport unknown)
 */
export function createLocalDatetime(
  date: string,
  localTime: string,
  airportCode: string
): string | null {
  const tz = getAirportIanaTimezone(airportCode);
  if (!tz) return null;

  // Create ISO datetime with local time (we don't convert, just associate timezone)
  return `${date}T${localTime}:00`;
}

/**
 * Compute block time in minutes from departure and arrival times
 * Handles midnight rollover (arrival before departure on next day)
 *
 * @param depTime - Departure time in HH:MM format
 * @param arrTime - Arrival time in HH:MM format
 * @param depDate - Departure date in YYYY-MM-DD format
 * @returns Block time in minutes, and computed arrival date
 */
export function computeBlockMinutes(
  depTime: string,
  arrTime: string,
  depDate: string
): { blockMinutes: number; arrDate: string } {
  // Parse times to minutes since midnight
  const depMatch = depTime.match(/(\d{1,2}):(\d{2})/);
  const arrMatch = arrTime.match(/(\d{1,2}):(\d{2})/);

  if (!depMatch || !arrMatch) {
    return { blockMinutes: 0, arrDate: depDate };
  }

  const depMinutes = parseInt(depMatch[1]!) * 60 + parseInt(depMatch[2]!);
  const arrMinutes = parseInt(arrMatch[1]!) * 60 + parseInt(arrMatch[2]!);

  let blockMinutes = arrMinutes - depMinutes;
  let arrDate = depDate;

  // Handle midnight rollover
  if (blockMinutes < 0) {
    blockMinutes += 24 * 60; // Add 24 hours
    // Compute next day
    const date = new Date(depDate + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + 1);
    arrDate = date.toISOString().split("T")[0]!;
  }

  // Sanity check: block time should be positive and less than 24 hours
  if (blockMinutes < 0 || blockMinutes > 24 * 60) {
    console.warn(`[BlockTime] Invalid block time computed: ${blockMinutes} minutes for ${depTime} -> ${arrTime}`);
    return { blockMinutes: 0, arrDate: depDate };
  }

  return { blockMinutes, arrDate };
}

/**
 * Format minutes as HH:MM duration string
 */
export function formatMinutesAsDuration(minutes: number): string {
  if (minutes < 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/**
 * Parse duration string (H:MM or HH:MM) to total minutes
 */
export function parseDurationToMinutes(durStr: string | undefined | null): number {
  if (!durStr) return 0;
  const match = durStr.match(/(\d+):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
export function parseTimeToMinutes(timeStr: string | undefined | null): number {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match || !match[1] || !match[2]) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Get display time from ISO datetime (just HH:MM part)
 */
export function getDisplayTime(isoDatetime: string | undefined | null): string {
  if (!isoDatetime) return "";
  const match = isoDatetime.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? "";
}

/**
 * Get display date from ISO datetime (YYYY-MM-DD part)
 */
export function getDisplayDate(isoDatetime: string | undefined | null): string {
  if (!isoDatetime) return "";
  return isoDatetime.split("T")[0] ?? "";
}
