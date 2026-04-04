/**
 * Pay Calculation Utilities
 * Handles all pay-related calculations for UPS pilots
 */

import {
  getPremiumCode,
  MIN_DAILY_CREDIT_MINUTES,
  THIRTY_IN_SEVEN_LIMIT_MINUTES,
  THIRTY_IN_SEVEN_WARNING_MINUTES,
  type ThirtyInSevenStatus,
} from "./constants";

/**
 * Calculate pay for a single flight entry
 */
export interface PayCalculationInput {
  creditMinutes: number;
  blockMinutes: number;
  hourlyRateCents: number;
  premiumCode?: string | null;
  premiumAmountCents?: number;
}

export interface PayCalculationResult {
  basePaoCents: number;
  adjustedCreditMinutes: number;
  overageMinutes: number;
  overagePaoCents: number;
  totalPayCents: number;
}

/**
 * Apply premium code adjustments to credit hours
 */
export function applyPremiumToCredit(
  creditMinutes: number,
  premiumCode: string | null | undefined
): number {
  const config = getPremiumCode(premiumCode);
  if (!config) return creditMinutes;

  switch (config.type) {
    case "ADD_HOURS":
      // Add fixed hours (value is in hours, convert to minutes)
      return creditMinutes + config.value * 60;

    case "MULTIPLIER":
      // Multiply credit by factor
      return Math.round(creditMinutes * config.value);

    case "INFO_ONLY":
      // No adjustment
      return creditMinutes;

    default:
      return creditMinutes;
  }
}

/**
 * Calculate pay for a flight entry
 */
export function calculateFlightPay(input: PayCalculationInput): PayCalculationResult {
  const {
    creditMinutes,
    blockMinutes,
    hourlyRateCents,
    premiumCode,
    premiumAmountCents = 0,
  } = input;

  // Apply premium code adjustments
  const adjustedCreditMinutes = applyPremiumToCredit(creditMinutes, premiumCode);

  // Calculate base pay from adjusted credit
  const basePaoCents = Math.round((adjustedCreditMinutes / 60) * hourlyRateCents);

  // Calculate overage (when block > credit)
  const overageMinutes = Math.max(0, blockMinutes - creditMinutes);
  const overagePaoCents = Math.round((overageMinutes / 60) * hourlyRateCents);

  // Total pay = base + overage + flat premium
  const totalPayCents = basePaoCents + overagePaoCents + premiumAmountCents;

  return {
    basePaoCents,
    adjustedCreditMinutes,
    overageMinutes,
    overagePaoCents,
    totalPayCents,
  };
}

/**
 * Apply minimum daily guarantee to a duty day
 * UPS contract: 6:00 minimum credit per duty day
 */
export function applyMinDailyGuarantee(
  actualCreditMinutes: number,
  minCreditMinutes: number = MIN_DAILY_CREDIT_MINUTES
): number {
  return Math.max(actualCreditMinutes, minCreditMinutes);
}

/**
 * Calculate duty day totals with minimum guarantee
 */
export interface DutyDayTotals {
  actualBlockMinutes: number;
  actualCreditMinutes: number;
  finalCreditMinutes: number; // After min guarantee applied
  totalPayCents: number;
}

export function calculateDutyDayTotals(
  legs: Array<{
    blockMinutes: number;
    creditMinutes: number;
    calculatedPayCents: number;
  }>,
  hourlyRateCents: number,
  minCreditMinutes: number = MIN_DAILY_CREDIT_MINUTES
): DutyDayTotals {
  const actualBlockMinutes = legs.reduce((sum, leg) => sum + leg.blockMinutes, 0);
  const actualCreditMinutes = legs.reduce((sum, leg) => sum + leg.creditMinutes, 0);

  // Apply minimum daily guarantee
  const finalCreditMinutes = applyMinDailyGuarantee(actualCreditMinutes, minCreditMinutes);

  // If we're using the minimum, recalculate pay
  let totalPayCents: number;
  if (finalCreditMinutes > actualCreditMinutes) {
    // Minimum guarantee applies - calculate pay on minimum
    totalPayCents = Math.round((finalCreditMinutes / 60) * hourlyRateCents);
  } else {
    // Actual credit exceeds minimum - sum individual leg pay
    totalPayCents = legs.reduce((sum, leg) => sum + leg.calculatedPayCents, 0);
  }

  return {
    actualBlockMinutes,
    actualCreditMinutes,
    finalCreditMinutes,
    totalPayCents,
  };
}

/**
 * Calculate 30-in-7 rolling block time
 */
export function calculate30In7BlockMinutes(
  flights: Array<{ dateISO: string; blockMinutes: number }>,
  asOfDate: string
): number {
  // Calculate date 7 days ago
  const asOf = new Date(asOfDate + "T00:00:00Z");
  const sevenDaysAgo = new Date(asOf);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Include today, so -6 gives us 7 days
  const sevenDaysAgoISO = sevenDaysAgo.toISOString().split("T")[0] ?? "";

  // Sum block time for flights in the window
  return flights
    .filter((f) => f.dateISO >= sevenDaysAgoISO && f.dateISO <= asOfDate)
    .reduce((sum, f) => sum + f.blockMinutes, 0);
}

/**
 * Get 30-in-7 status based on block minutes
 */
export function get30In7Status(blockMinutes: number): ThirtyInSevenStatus {
  if (blockMinutes >= THIRTY_IN_SEVEN_LIMIT_MINUTES) return "red";
  if (blockMinutes >= THIRTY_IN_SEVEN_WARNING_MINUTES) return "yellow";
  return "green";
}

/**
 * Calculate remaining available block time before hitting 30-in-7 limit
 */
export function get30In7Remaining(blockMinutes: number): number {
  return Math.max(0, THIRTY_IN_SEVEN_LIMIT_MINUTES - blockMinutes);
}

/**
 * Format minutes as HH:MM string
 */
export function formatMinutesAsHHMM(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Parse HH:MM string to minutes
 */
export function parseHHMMToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  if (parts.length !== 2) return 0;
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/**
 * Format cents as currency string
 */
export function formatCentsAsCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Calculate OOOI times from ISO strings
 */
export interface OOOITimes {
  outISO: string | null;
  offISO: string | null;
  onISO: string | null;
  inISO: string | null;
}

export function calculateOOOIMinutes(oooi: OOOITimes): {
  blockMinutes: number;
  flightMinutes: number;
} {
  let blockMinutes = 0;
  let flightMinutes = 0;

  // Block time = IN - OUT
  if (oooi.outISO && oooi.inISO) {
    const out = new Date(oooi.outISO).getTime();
    const into = new Date(oooi.inISO).getTime();
    blockMinutes = Math.round((into - out) / 60000);
  }

  // Flight time = ON - OFF
  if (oooi.offISO && oooi.onISO) {
    const off = new Date(oooi.offISO).getTime();
    const on = new Date(oooi.onISO).getTime();
    flightMinutes = Math.round((on - off) / 60000);
  }

  return { blockMinutes, flightMinutes };
}
