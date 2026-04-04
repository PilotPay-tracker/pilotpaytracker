/**
 * Airport Database Utility
 * Provides timezone lookups for airports worldwide using IATA/ICAO codes
 * Supports user-uploaded CSV/JSON airport databases
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type IANATimezone = string; // e.g. "Europe/London", "Asia/Tokyo"

export interface AirportRecord {
  iata?: string;        // "SDF"
  icao?: string;        // "KSDF"
  name?: string;
  city?: string;
  country?: string;
  tz: IANATimezone;     // "America/New_York"
}

export interface AirportDb {
  version: number;
  updatedAtISO: string;
  records: AirportRecord[];
}

const STORAGE_KEY = 'pilotpay_airport_db_v1';

/**
 * Minimal built-in seed so app works even before user upload.
 */
export const DEFAULT_AIRPORT_DB: AirportDb = {
  version: 1,
  updatedAtISO: new Date().toISOString(),
  records: [
    // UPS-heavy / common US airports
    { iata: 'SDF', icao: 'KSDF', tz: 'America/New_York', name: 'Louisville', city: 'Louisville', country: 'USA' },
    { iata: 'ONT', icao: 'KONT', tz: 'America/Los_Angeles', name: 'Ontario', city: 'Ontario', country: 'USA' },
    { iata: 'LAX', icao: 'KLAX', tz: 'America/Los_Angeles', name: 'Los Angeles', city: 'Los Angeles', country: 'USA' },
    { iata: 'PHX', icao: 'KPHX', tz: 'America/Phoenix', name: 'Phoenix', city: 'Phoenix', country: 'USA' },
    { iata: 'DFW', icao: 'KDFW', tz: 'America/Chicago', name: 'Dallas/Fort Worth', city: 'Dallas', country: 'USA' },
    { iata: 'MIA', icao: 'KMIA', tz: 'America/New_York', name: 'Miami', city: 'Miami', country: 'USA' },
    { iata: 'JFK', icao: 'KJFK', tz: 'America/New_York', name: 'New York JFK', city: 'New York', country: 'USA' },
    { iata: 'EWR', icao: 'KEWR', tz: 'America/New_York', name: 'Newark', city: 'Newark', country: 'USA' },
    { iata: 'ATL', icao: 'KATL', tz: 'America/New_York', name: 'Atlanta', city: 'Atlanta', country: 'USA' },
    { iata: 'MCO', icao: 'KMCO', tz: 'America/New_York', name: 'Orlando', city: 'Orlando', country: 'USA' },
    { iata: 'RFD', icao: 'KRFD', tz: 'America/Chicago', name: 'Rockford', city: 'Rockford', country: 'USA' },
    { iata: 'ANC', icao: 'PANC', tz: 'America/Anchorage', name: 'Anchorage', city: 'Anchorage', country: 'USA' },
    { iata: 'HNL', icao: 'PHNL', tz: 'Pacific/Honolulu', name: 'Honolulu', city: 'Honolulu', country: 'USA' },
    { iata: 'OGG', icao: 'PHOG', tz: 'Pacific/Honolulu', name: 'Maui', city: 'Kahului', country: 'USA' },
    { iata: 'KOA', icao: 'PHKO', tz: 'Pacific/Honolulu', name: 'Kona', city: 'Kailua-Kona', country: 'USA' },
    { iata: 'LIH', icao: 'PHLI', tz: 'Pacific/Honolulu', name: 'Lihue', city: 'Lihue', country: 'USA' },
    { iata: 'ORD', icao: 'KORD', tz: 'America/Chicago', name: "O'Hare", city: 'Chicago', country: 'USA' },
    { iata: 'DEN', icao: 'KDEN', tz: 'America/Denver', name: 'Denver', city: 'Denver', country: 'USA' },
    { iata: 'SEA', icao: 'KSEA', tz: 'America/Los_Angeles', name: 'Seattle-Tacoma', city: 'Seattle', country: 'USA' },
    { iata: 'SFO', icao: 'KSFO', tz: 'America/Los_Angeles', name: 'San Francisco', city: 'San Francisco', country: 'USA' },
    { iata: 'BOS', icao: 'KBOS', tz: 'America/New_York', name: 'Boston Logan', city: 'Boston', country: 'USA' },
    { iata: 'IAH', icao: 'KIAH', tz: 'America/Chicago', name: 'Houston Intercontinental', city: 'Houston', country: 'USA' },
    { iata: 'MSP', icao: 'KMSP', tz: 'America/Chicago', name: 'Minneapolis-St. Paul', city: 'Minneapolis', country: 'USA' },
    { iata: 'DTW', icao: 'KDTW', tz: 'America/Detroit', name: 'Detroit Metro', city: 'Detroit', country: 'USA' },
    { iata: 'PHL', icao: 'KPHL', tz: 'America/New_York', name: 'Philadelphia', city: 'Philadelphia', country: 'USA' },
    { iata: 'CLT', icao: 'KCLT', tz: 'America/New_York', name: 'Charlotte', city: 'Charlotte', country: 'USA' },
    { iata: 'LAS', icao: 'KLAS', tz: 'America/Los_Angeles', name: 'Las Vegas', city: 'Las Vegas', country: 'USA' },
    { iata: 'SAN', icao: 'KSAN', tz: 'America/Los_Angeles', name: 'San Diego', city: 'San Diego', country: 'USA' },
    { iata: 'TPA', icao: 'KTPA', tz: 'America/New_York', name: 'Tampa', city: 'Tampa', country: 'USA' },
    { iata: 'PDX', icao: 'KPDX', tz: 'America/Los_Angeles', name: 'Portland', city: 'Portland', country: 'USA' },

    // World examples
    { iata: 'LHR', icao: 'EGLL', tz: 'Europe/London', name: 'London Heathrow', city: 'London', country: 'UK' },
    { iata: 'CDG', icao: 'LFPG', tz: 'Europe/Paris', name: 'Paris CDG', city: 'Paris', country: 'France' },
    { iata: 'FRA', icao: 'EDDF', tz: 'Europe/Berlin', name: 'Frankfurt', city: 'Frankfurt', country: 'Germany' },
    { iata: 'AMS', icao: 'EHAM', tz: 'Europe/Amsterdam', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'Netherlands' },
    { iata: 'DXB', icao: 'OMDB', tz: 'Asia/Dubai', name: 'Dubai', city: 'Dubai', country: 'UAE' },
    { iata: 'HND', icao: 'RJTT', tz: 'Asia/Tokyo', name: 'Tokyo Haneda', city: 'Tokyo', country: 'Japan' },
    { iata: 'NRT', icao: 'RJAA', tz: 'Asia/Tokyo', name: 'Tokyo Narita', city: 'Tokyo', country: 'Japan' },
    { iata: 'SYD', icao: 'YSSY', tz: 'Australia/Sydney', name: 'Sydney', city: 'Sydney', country: 'Australia' },
    { iata: 'HKG', icao: 'VHHH', tz: 'Asia/Hong_Kong', name: 'Hong Kong', city: 'Hong Kong', country: 'China' },
    { iata: 'SIN', icao: 'WSSS', tz: 'Asia/Singapore', name: 'Singapore Changi', city: 'Singapore', country: 'Singapore' },
    { iata: 'ICN', icao: 'RKSI', tz: 'Asia/Seoul', name: 'Seoul Incheon', city: 'Seoul', country: 'South Korea' },
    { iata: 'PVG', icao: 'ZSPD', tz: 'Asia/Shanghai', name: 'Shanghai Pudong', city: 'Shanghai', country: 'China' },
    { iata: 'MEX', icao: 'MMMX', tz: 'America/Mexico_City', name: 'Mexico City', city: 'Mexico City', country: 'Mexico' },
    { iata: 'GRU', icao: 'SBGR', tz: 'America/Sao_Paulo', name: 'Sao Paulo', city: 'Sao Paulo', country: 'Brazil' },
    { iata: 'YYZ', icao: 'CYYZ', tz: 'America/Toronto', name: 'Toronto Pearson', city: 'Toronto', country: 'Canada' },
    { iata: 'YVR', icao: 'CYVR', tz: 'America/Vancouver', name: 'Vancouver', city: 'Vancouver', country: 'Canada' },
  ],
};

export function normalizeCode(code?: string): string {
  return (code || '').trim().toUpperCase();
}

export function isIcao(code: string): boolean {
  const c = normalizeCode(code);
  return c.length === 4 && /^[A-Z0-9]{4}$/.test(c);
}

export function isIata(code: string): boolean {
  const c = normalizeCode(code);
  return c.length === 3 && /^[A-Z0-9]{3}$/.test(c);
}

export async function loadAirportDb(): Promise<AirportDb> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AIRPORT_DB;
    const parsed = JSON.parse(raw) as AirportDb;
    if (!parsed?.records?.length) return DEFAULT_AIRPORT_DB;
    return parsed;
  } catch {
    return DEFAULT_AIRPORT_DB;
  }
}

export async function saveAirportDb(db: AirportDb): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function findAirportTz(db: AirportDb, code: string): IANATimezone | null {
  const c = normalizeCode(code);
  if (!c) return null;

  const rec =
    db.records.find((r) => normalizeCode(r.iata) === c) ||
    db.records.find((r) => normalizeCode(r.icao) === c);

  return rec?.tz || null;
}

export function findAirportRecord(db: AirportDb, code: string): AirportRecord | null {
  const c = normalizeCode(code);
  if (!c) return null;

  return (
    db.records.find((r) => normalizeCode(r.iata) === c) ||
    db.records.find((r) => normalizeCode(r.icao) === c) ||
    null
  );
}

/**
 * Parses airport database from text (CSV or JSON)
 *
 * JSON formats:
 * - Array: [{iata, icao, tz, name...}, ...]
 * - Object: {records: [{iata, icao, tz, name...}, ...]}
 *
 * CSV format (requires header):
 * iata,icao,tz,name,city,country
 * SDF,KSDF,America/New_York,Louisville,Louisville,USA
 */
export function parseAirportDbFromText(text: string): AirportDb {
  const t = (text || '').trim();
  if (!t) throw new Error('Empty airport file');

  // JSON
  if (t.startsWith('{') || t.startsWith('[')) {
    const json = JSON.parse(t);
    if (Array.isArray(json)) {
      return {
        version: 1,
        updatedAtISO: new Date().toISOString(),
        records: json.map((r: Record<string, unknown>) => ({
          iata: r.iata as string | undefined,
          icao: r.icao as string | undefined,
          tz: r.tz as string,
          name: r.name as string | undefined,
          city: r.city as string | undefined,
          country: r.country as string | undefined,
        })),
      };
    }
    if (json.records && Array.isArray(json.records)) {
      return {
        version: Number(json.version || 1),
        updatedAtISO: new Date().toISOString(),
        records: json.records.map((r: Record<string, unknown>) => ({
          iata: r.iata as string | undefined,
          icao: r.icao as string | undefined,
          tz: r.tz as string,
          name: r.name as string | undefined,
          city: r.city as string | undefined,
          country: r.country as string | undefined,
        })),
      };
    }
    throw new Error('JSON format must be an array or {records:[...]}');
  }

  // CSV (expects header)
  const lines = t.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must include header + at least 1 row');

  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const idxIata = header.indexOf('iata');
  const idxIcao = header.indexOf('icao');
  const idxTz = header.indexOf('tz');
  const idxName = header.indexOf('name');
  const idxCity = header.indexOf('city');
  const idxCountry = header.indexOf('country');

  if (idxTz === -1) throw new Error("CSV header must include 'tz'");
  if (idxIata === -1 && idxIcao === -1) throw new Error("CSV must include 'iata' or 'icao'");

  const records: AirportRecord[] = lines.slice(1).map((line) => {
    const cols = line.split(',').map((s) => s.trim());
    const tz = cols[idxTz];
    if (!tz) throw new Error('Row missing tz');
    return {
      iata: idxIata !== -1 ? cols[idxIata] : undefined,
      icao: idxIcao !== -1 ? cols[idxIcao] : undefined,
      tz,
      name: idxName !== -1 ? cols[idxName] : undefined,
      city: idxCity !== -1 ? cols[idxCity] : undefined,
      country: idxCountry !== -1 ? cols[idxCountry] : undefined,
    };
  });

  return {
    version: 1,
    updatedAtISO: new Date().toISOString(),
    records,
  };
}
