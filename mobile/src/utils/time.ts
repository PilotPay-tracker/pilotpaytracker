/**
 * Time Utilities
 * Provides Zulu to local time conversion using airport timezone database
 */

import type { AirportDb, IANATimezone } from './airportDb';
import { findAirportTz } from './airportDb';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.floor(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${pad2(mm)}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const match = (hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export function hhmmCompactToColon(hhmm: string): string {
  const t = (hhmm || '').replace(':', '').trim();
  if (t.length !== 4) return hhmm;
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

function formatInTZ(date: Date, tz: IANATimezone): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}${mm}`; // HHMM
}

export function getTzOrUTC(db: AirportDb, code: string): IANATimezone {
  return findAirportTz(db, code) || 'UTC';
}

/**
 * Convert Zulu time (HHMM) on a date to local time at a station
 */
export function zuluToLocalHHMM(args: {
  airportDb: AirportDb;
  dateISO: string;      // "2026-01-13"
  zuluHHMM: string;     // "0209" or "02:09"
  stationCode: string;  // IATA or ICAO
}): string {
  const t = (args.zuluHHMM || '').replace(':', '').trim();
  if (t.length !== 4) return hhmmCompactToColon(t);

  const yyyy = parseInt(args.dateISO.slice(0, 4), 10);
  const mm = parseInt(args.dateISO.slice(5, 7), 10) - 1;
  const dd = parseInt(args.dateISO.slice(8, 10), 10);

  const HH = parseInt(t.slice(0, 2), 10);
  const MM = parseInt(t.slice(2, 4), 10);

  const utc = new Date(Date.UTC(yyyy, mm, dd, HH, MM, 0, 0));
  const tz = getTzOrUTC(args.airportDb, args.stationCode);
  const localHHMMcompact = formatInTZ(utc, tz);
  return hhmmCompactToColon(localHHMMcompact);
}

/**
 * Safe wrapper for zuluToLocalHHMM that returns original on error
 */
export function safeZuluToLocal(args: {
  airportDb: AirportDb;
  dateISO: string;
  zuluHHMM: string;
  stationCode: string;
}): string {
  try {
    return zuluToLocalHHMM(args);
  } catch {
    return hhmmCompactToColon((args.zuluHHMM || '').replace(':', ''));
  }
}

/**
 * Create a Date representing local time at station for countdown timers
 */
export function parseLocalISO(args: {
  airportDb: AirportDb;
  dateISO: string;
  localHHMM: string;    // "22:15"
  stationCode: string;  // IATA/ICAO
}): Date {
  const tz = getTzOrUTC(args.airportDb, args.stationCode);
  const [H, M] = args.localHHMM.split(':').map((x) => parseInt(x, 10));

  const yyyy = parseInt(args.dateISO.slice(0, 4), 10);
  const mm = parseInt(args.dateISO.slice(5, 7), 10) - 1;
  const dd = parseInt(args.dateISO.slice(8, 10), 10);

  const guessUTC = new Date(Date.UTC(yyyy, mm, dd, H, M, 0, 0));

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(guessUTC);

  const tzY = parseInt(parts.find((p) => p.type === 'year')?.value ?? String(yyyy), 10);
  const tzMo = parseInt(parts.find((p) => p.type === 'month')?.value ?? '01', 10) - 1;
  const tzD = parseInt(parts.find((p) => p.type === 'day')?.value ?? '01', 10);
  const tzH = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '00', 10);
  const tzM = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '00', 10);

  const desiredUTC = new Date(Date.UTC(yyyy, mm, dd, H, M, 0, 0));
  const observedUTC = new Date(Date.UTC(tzY, tzMo, tzD, tzH, tzM, 0, 0));
  const deltaMin = Math.round((desiredUTC.getTime() - observedUTC.getTime()) / 60000);

  return new Date(guessUTC.getTime() + deltaMin * 60000);
}

/**
 * Format a date as ISO date string (YYYY-MM-DD)
 */
export function toDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get current time as ISO string
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Calculate time difference in minutes between two dates
 */
export function diffMinutes(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60000);
}

/**
 * Format remaining time as hours and minutes
 */
export function formatRemainingTime(minutes: number): { hours: number; mins: number; display: string } {
  const totalMins = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return {
    hours,
    mins,
    display: `${hours}:${pad2(mins)}`,
  };
}
