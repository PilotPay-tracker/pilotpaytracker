/**
 * Contract Guarantee Engine
 *
 * Single source of truth for UPS bid-period guarantee logic.
 * Used by dashboard, projections, profile/stats, and pay-benchmarks
 * so every screen always shows the same numbers.
 *
 * Rules:
 *   paidCreditMinutes = max(lineCreditMinutes, guaranteeMinutes)
 *   guaranteeMinutes  = 75 * 60  for 28-day periods
 *                     = 96 * 60  for 35-day periods
 */

export type BidPeriodType = "28_DAY" | "35_DAY";

const GUARANTEE_MINUTES: Record<string, number> = {
  "28_DAY": 75 * 60,
  "28-DAY": 75 * 60,
  "35_DAY": 96 * 60,
  "35-DAY": 96 * 60,
};

const DEFAULT_MONTHLY_GUARANTEE_MINUTES = 75 * 60; // 28-day default

/**
 * Resolve the monthly guarantee in minutes from a profile's creditCapPeriodType string.
 * Accepts "28_DAY", "28-DAY", "28", "35_DAY", "35-DAY", "35", null, undefined.
 */
export function resolveGuaranteeMinutes(creditCapPeriodType?: string | null): number {
  if (!creditCapPeriodType) return DEFAULT_MONTHLY_GUARANTEE_MINUTES;
  const key = creditCapPeriodType.toUpperCase().replace(/-/g, "_").trim();
  if (key.includes("35")) return GUARANTEE_MINUTES["35_DAY"]!;
  return GUARANTEE_MINUTES["28_DAY"]!;
}

/**
 * Apply the monthly guarantee floor to a month's credit minutes.
 * If the pilot flew less than the guarantee, they're still paid the guarantee.
 */
export function applyMonthlyGuaranteeFloor(
  creditMinutes: number,
  creditCapPeriodType?: string | null
): number {
  const guaranteeMinutes = resolveGuaranteeMinutes(creditCapPeriodType);
  return Math.max(creditMinutes, guaranteeMinutes);
}

/**
 * Given a total YTD credit minutes figure and the number of complete calendar
 * months elapsed, apply the guarantee floor on a per-month basis.
 *
 * Each month gets at least `guaranteeMinutes` of paid credit.
 * Months where the pilot flew over guarantee are unaffected.
 *
 * monthsCreditMinutes: array of per-month credit minute totals (length = months elapsed)
 * creditCapPeriodType: from profile
 *
 * Returns the guarantee-floored YTD total.
 */
export function applyYTDGuaranteeFloor(
  monthsCreditMinutes: number[],
  creditCapPeriodType?: string | null
): number {
  const gMin = resolveGuaranteeMinutes(creditCapPeriodType);
  return monthsCreditMinutes.reduce((sum, m) => sum + Math.max(m, gMin), 0);
}

/**
 * Simple floor: if we only have the raw YTD credit total (not broken out by month),
 * we can still apply a floor based on months elapsed.
 *
 * monthsElapsed: how many full calendar months have passed this year (1-12)
 */
export function applyYTDGuaranteeFloorSimple(
  ytdCreditMinutes: number,
  monthsElapsed: number,
  creditCapPeriodType?: string | null
): number {
  const gMin = resolveGuaranteeMinutes(creditCapPeriodType);
  const minYTD = gMin * monthsElapsed;
  return Math.max(ytdCreditMinutes, minYTD);
}
