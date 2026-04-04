// src/lib/oooi/types.ts
// Core type definitions for OOOI (Out-Off-On-In) flight tracking

export interface OOOITimes {
  out?: string; // Gate departure (push back) - HH:MM format
  off?: string; // Takeoff time
  on?: string;  // Landing time
  in?: string;  // Gate arrival
}

export interface ComputedTimes {
  blockTime?: number;  // IN - OUT in minutes
  flightTime?: number; // ON - OFF in minutes
}

export type ParseMethod = 'ocr' | 'openai' | 'manual';

export interface Leg {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  scheduledDeparture: string; // ISO date string
  scheduledArrival: string;   // ISO date string

  // OOOI times
  oopiTimes?: OOOITimes;
  computedTimes?: ComputedTimes;

  // Parse info
  parseMethod?: ParseMethod;
  parseConfidence?: number;
  lastUpdated?: number;

  // Crew info (optional)
  aircraftTail?: string;
  crewPosition?: string;

  // Credit
  creditMinutes?: number;
  scheduledBlockMinutes?: number;

  // Deadhead
  isDeadhead?: boolean;
  deadheadCreditMinutes?: number;
}

export interface DutyDay {
  id: string;
  date: string; // YYYY-MM-DD
  legs: Leg[];

  // Duty times
  reportTime?: string;   // HH:MM
  releaseTime?: string;  // HH:MM
  dutyMinutes?: number;

  // Credit summary
  totalBlockMinutes: number;
  totalFlightMinutes: number;
  totalCreditMinutes: number;

  // Minimum credit rule
  minimumCreditApplied: boolean;
  minimumCreditMinutes?: number;
}

export interface Trip {
  id: string;
  tripNumber: string;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  dutyDays: DutyDay[];

  // Trip totals
  totalBlockMinutes: number;
  totalFlightMinutes: number;
  totalCreditMinutes: number;
  totalDutyMinutes: number;

  // Trip info
  baseCode?: string;
  equipmentType?: string;

  // Status
  isComplete: boolean;
  lastUpdated: number;
}

export interface CreditBreakdown {
  scheduledBlock: number;
  actualBlock: number;
  actualFlight: number;
  deadheadCredit: number;
  minimumDayCredit: number;
  totalCredit: number;
}

// Minimum credit constants
export const MIN_CREDIT_MINUTES = 360; // 6:00 per duty day
export const MONTHLY_GUARANTEE_MINUTES = 75 * 60; // 75:00

// Helper functions
export function parseTimeToMinutes(time: string | undefined): number | undefined {
  if (!time) return undefined;

  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined;
  }

  return hours * 60 + minutes;
}

export function formatMinutesToTime(minutes: number | undefined): string {
  if (minutes === undefined || minutes < 0) return '--:--';

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function computeOOOITimes(oooi: OOOITimes): ComputedTimes {
  const result: ComputedTimes = {};

  const outMinutes = parseTimeToMinutes(oooi.out);
  const offMinutes = parseTimeToMinutes(oooi.off);
  const onMinutes = parseTimeToMinutes(oooi.on);
  const inMinutes = parseTimeToMinutes(oooi.in);

  // Block time = IN - OUT
  if (outMinutes !== undefined && inMinutes !== undefined) {
    let blockTime = inMinutes - outMinutes;
    // Handle overnight flights
    if (blockTime < 0) {
      blockTime += 24 * 60;
    }
    result.blockTime = blockTime;
  }

  // Flight time = ON - OFF
  if (offMinutes !== undefined && onMinutes !== undefined) {
    let flightTime = onMinutes - offMinutes;
    // Handle overnight flights
    if (flightTime < 0) {
      flightTime += 24 * 60;
    }
    result.flightTime = flightTime;
  }

  return result;
}

export function computeDutyDayCredit(dutyDay: DutyDay): number {
  let totalCredit = 0;

  for (const leg of dutyDay.legs) {
    if (leg.isDeadhead) {
      // Deadhead credit (typically 50% of block)
      totalCredit += leg.deadheadCreditMinutes || 0;
    } else {
      // Use actual block time or scheduled block
      totalCredit += leg.computedTimes?.blockTime || leg.scheduledBlockMinutes || 0;
    }
  }

  // Apply minimum credit rule
  if (totalCredit < MIN_CREDIT_MINUTES && dutyDay.legs.length > 0) {
    return MIN_CREDIT_MINUTES;
  }

  return totalCredit;
}

export function computeTripTotals(trip: Trip): Pick<Trip, 'totalBlockMinutes' | 'totalFlightMinutes' | 'totalCreditMinutes' | 'totalDutyMinutes'> {
  let totalBlockMinutes = 0;
  let totalFlightMinutes = 0;
  let totalCreditMinutes = 0;
  let totalDutyMinutes = 0;

  for (const dutyDay of trip.dutyDays) {
    totalBlockMinutes += dutyDay.totalBlockMinutes;
    totalFlightMinutes += dutyDay.totalFlightMinutes;
    totalCreditMinutes += dutyDay.totalCreditMinutes;
    totalDutyMinutes += dutyDay.dutyMinutes || 0;
  }

  return {
    totalBlockMinutes,
    totalFlightMinutes,
    totalCreditMinutes,
    totalDutyMinutes,
  };
}

export function generateLegId(): string {
  return `leg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateDutyDayId(): string {
  return `dd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateTripId(): string {
  return `trip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Time comparison utilities
export function isValidTimeFormat(time: string): boolean {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(time);
}

export function compareTimesChronological(time1: string, time2: string): number {
  const minutes1 = parseTimeToMinutes(time1) || 0;
  const minutes2 = parseTimeToMinutes(time2) || 0;
  return minutes1 - minutes2;
}

// Date utilities
export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateFull(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function isSameDay(date1: string, date2: string): boolean {
  return date1.split('T')[0] === date2.split('T')[0];
}

export function getDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
