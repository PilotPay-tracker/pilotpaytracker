/**
 * Pay Profile Engine — Source of Truth for All Compensation Values
 *
 * Derives the full pay profile from Date of Hire (DOH) + Position using the
 * 2025 UPS/IPA Contract Extension TA pay table.
 *
 * Usage:
 *   import { getPayProfile } from "@/lib/payProfile";
 *   const profile = getPayProfile({ doh: "2022-04-04", position: "FO" });
 *   // => { payStepLabel: "5th Year FO", hourlyRateCents: 23758, ... }
 */

// ─── 2025 TA Pay Table (embedded — no network call) ─────────────────────────
//
// Source: UPS / IPA Contract Extension TA — Effective September 1, 2025
// Pay @ Guarantee  = 975-hour annual guarantee (75 hrs/month × 13)
// Average Line Pay = average regular line paid hours (1,018.3 hrs)
// Average Total Pay = average total paid hours (CPT 1,223.2 | FO 1,123.4 hrs)
//
// All monetary values in CENTS (dollars × 100).

interface PayRow {
  yearOfService: number;
  hourlyRateCents: number;
  payAtGuaranteeCents: number;
  avgLinePayCents: number;
  avgTotalPayCents: number;
}

const FO_TABLE: PayRow[] = [
  { yearOfService: 1,  hourlyRateCents: 5977,  payAtGuaranteeCents: 5827600,  avgLinePayCents: 6086600,  avgTotalPayCents: 6714600  },
  { yearOfService: 2,  hourlyRateCents: 22804, payAtGuaranteeCents: 22233900, avgLinePayCents: 23222000, avgTotalPayCents: 25618000 },
  { yearOfService: 3,  hourlyRateCents: 22835, payAtGuaranteeCents: 22264100, avgLinePayCents: 23253600, avgTotalPayCents: 25652800 },
  { yearOfService: 4,  hourlyRateCents: 23293, payAtGuaranteeCents: 22710700, avgLinePayCents: 23720000, avgTotalPayCents: 26167400 },
  { yearOfService: 5,  hourlyRateCents: 23758, payAtGuaranteeCents: 23164100, avgLinePayCents: 24193500, avgTotalPayCents: 26689700 },
  { yearOfService: 6,  hourlyRateCents: 24232, payAtGuaranteeCents: 23626200, avgLinePayCents: 24676200, avgTotalPayCents: 27222200 },
  { yearOfService: 7,  hourlyRateCents: 24717, payAtGuaranteeCents: 24099100, avgLinePayCents: 25170100, avgTotalPayCents: 27767100 },
  { yearOfService: 8,  hourlyRateCents: 25210, payAtGuaranteeCents: 24579800, avgLinePayCents: 25672100, avgTotalPayCents: 28320900 },
  { yearOfService: 9,  hourlyRateCents: 25714, payAtGuaranteeCents: 25071200, avgLinePayCents: 26185300, avgTotalPayCents: 28887100 },
  { yearOfService: 10, hourlyRateCents: 26432, payAtGuaranteeCents: 25771200, avgLinePayCents: 26916500, avgTotalPayCents: 29693700 },
  { yearOfService: 11, hourlyRateCents: 27174, payAtGuaranteeCents: 26494700, avgLinePayCents: 27672100, avgTotalPayCents: 30527300 },
  { yearOfService: 12, hourlyRateCents: 27937, payAtGuaranteeCents: 27238600, avgLinePayCents: 28449100, avgTotalPayCents: 31384400 },
  { yearOfService: 13, hourlyRateCents: 28078, payAtGuaranteeCents: 27376100, avgLinePayCents: 28592700, avgTotalPayCents: 31542800 },
  { yearOfService: 14, hourlyRateCents: 28216, payAtGuaranteeCents: 27510600, avgLinePayCents: 28733200, avgTotalPayCents: 31697900 },
  { yearOfService: 15, hourlyRateCents: 28429, payAtGuaranteeCents: 27718300, avgLinePayCents: 28950100, avgTotalPayCents: 31937100 },
];

const CAPTAIN_TABLE: PayRow[] = [
  { yearOfService: 1,  hourlyRateCents: 5977,  payAtGuaranteeCents: 5827600,  avgLinePayCents: 6086600,  avgTotalPayCents: 7311100  },
  { yearOfService: 2,  hourlyRateCents: 36739, payAtGuaranteeCents: 35820500, avgLinePayCents: 37412400, avgTotalPayCents: 44939100 },
  { yearOfService: 3,  hourlyRateCents: 36811, payAtGuaranteeCents: 35890700, avgLinePayCents: 37485700, avgTotalPayCents: 45027200 },
  { yearOfService: 4,  hourlyRateCents: 36960, payAtGuaranteeCents: 36036000, avgLinePayCents: 37637500, avgTotalPayCents: 45209500 },
  { yearOfService: 5,  hourlyRateCents: 37107, payAtGuaranteeCents: 36179300, avgLinePayCents: 37787200, avgTotalPayCents: 45389300 },
  { yearOfService: 6,  hourlyRateCents: 37253, payAtGuaranteeCents: 36321700, avgLinePayCents: 37935800, avgTotalPayCents: 45567900 },
  { yearOfService: 7,  hourlyRateCents: 37404, payAtGuaranteeCents: 36468900, avgLinePayCents: 38089600, avgTotalPayCents: 45752600 },
  { yearOfService: 8,  hourlyRateCents: 37553, payAtGuaranteeCents: 36614200, avgLinePayCents: 38241300, avgTotalPayCents: 45934800 },
  { yearOfService: 9,  hourlyRateCents: 37702, payAtGuaranteeCents: 36759500, avgLinePayCents: 38393100, avgTotalPayCents: 46117100 },
  { yearOfService: 10, hourlyRateCents: 38137, payAtGuaranteeCents: 37183600, avgLinePayCents: 38836100, avgTotalPayCents: 46649200 },
  { yearOfService: 11, hourlyRateCents: 38577, payAtGuaranteeCents: 37612600, avgLinePayCents: 39284100, avgTotalPayCents: 47187400 },
  { yearOfService: 12, hourlyRateCents: 39021, payAtGuaranteeCents: 38045500, avgLinePayCents: 39736300, avgTotalPayCents: 47730500 },
  { yearOfService: 13, hourlyRateCents: 39312, payAtGuaranteeCents: 38329200, avgLinePayCents: 40032600, avgTotalPayCents: 48086400 },
  { yearOfService: 14, hourlyRateCents: 39705, payAtGuaranteeCents: 38712400, avgLinePayCents: 40432800, avgTotalPayCents: 48567200 },
  { yearOfService: 15, hourlyRateCents: 40101, payAtGuaranteeCents: 39098500, avgLinePayCents: 40836100, avgTotalPayCents: 49051500 },
];

// ─── Ordinal labels ──────────────────────────────────────────────────────────

const ORDINALS = [
  "1st", "2nd", "3rd", "4th", "5th",
  "6th", "7th", "8th", "9th", "10th",
  "11th", "12th", "13th", "14th", "15th",
];

function ordinal(n: number): string {
  return ORDINALS[(n - 1)] ?? `${n}th`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PayPosition = "FO" | "CPT";

export interface PayProfile {
  /** e.g. "5th Year FO" or "3rd Year CPT" */
  payStepLabel: string;
  /** Year of service (1–15, capped) */
  yearOfService: number;
  /** Hourly rate in cents */
  hourlyRateCents: number;
  /** Pay @ 975-hr annual guarantee, in cents */
  payAtGuaranteeCents: number;
  /** Average line pay in cents (1,018.3 hrs) */
  avgLinePayCents: number;
  /** Average total pay in cents (CPT 1,223.2 | FO 1,123.4 hrs) */
  avgTotalPayCents: number;
  /** Whether the hourly rate was manually overridden */
  isManualOverride: boolean;
  /** Source description */
  sourceNote: string;
}

// ─── Core Calculation ────────────────────────────────────────────────────────

/**
 * Compute the pay year (1–15) from DOH using actual anniversary date logic.
 *
 * Rules:
 * - Year 1 is the hire year (before first anniversary).
 * - Year 2 starts on the 1st anniversary.
 * - Capped at 15.
 *
 * @param doh ISO date string "YYYY-MM-DD" or "MM/DD/YYYY"
 * @param asOf  Date to evaluate as (defaults to today)
 */
export function computePayYearFromDOH(
  doh: string | null | undefined,
  asOf?: Date
): number {
  if (!doh) return 1;

  const hire = parseDateFlexible(doh);
  if (!hire) return 1;

  const now = asOf ?? new Date();

  // How many full anniversaries have passed?
  let yearsCompleted = now.getFullYear() - hire.getFullYear();

  // Check if we've passed the anniversary in the current year
  const anniversaryThisYear = new Date(
    now.getFullYear(),
    hire.getMonth(),
    hire.getDate()
  );

  if (now < anniversaryThisYear) {
    yearsCompleted -= 1;
  }

  // Year of service = completed years + 1 (year 1 = before first anniversary)
  const yearOfService = Math.max(1, yearsCompleted + 1);

  // Cap at 15
  return Math.min(yearOfService, 15);
}

/**
 * Get the full pay profile for a pilot.
 *
 * @param doh              ISO or US-format date string, or null/undefined
 * @param position         "FO" or "CPT"
 * @param asOf             Reference date (defaults to today)
 * @param overrideRateCents If provided, replaces the contract hourly rate
 */
export function getPayProfile(params: {
  doh: string | null | undefined;
  position: PayPosition;
  asOf?: Date;
  overrideRateCents?: number | null;
}): PayProfile {
  const { doh, position, asOf, overrideRateCents } = params;

  const yearOfService = computePayYearFromDOH(doh, asOf);
  const table = position === "CPT" ? CAPTAIN_TABLE : FO_TABLE;
  const row = table.find((r) => r.yearOfService === yearOfService) ?? table[0];
  const posLabel = position === "CPT" ? "CPT" : "FO";

  const isManualOverride =
    overrideRateCents != null &&
    overrideRateCents !== row.hourlyRateCents;

  return {
    payStepLabel: `${ordinal(yearOfService)} Year ${posLabel}`,
    yearOfService,
    hourlyRateCents: isManualOverride ? overrideRateCents! : row.hourlyRateCents,
    payAtGuaranteeCents: row.payAtGuaranteeCents,
    avgLinePayCents: row.avgLinePayCents,
    avgTotalPayCents: row.avgTotalPayCents,
    isManualOverride,
    sourceNote: "UPS / IPA Contract Extension TA (effective Sep 1, 2025)",
  };
}

/**
 * Look up a pay row directly by position + year (for cases where DOH is unknown
 * and the user has manually selected their pay year).
 */
export function getPayProfileByYear(params: {
  yearOfService: number;
  position: PayPosition;
  overrideRateCents?: number | null;
}): PayProfile {
  const { yearOfService, position, overrideRateCents } = params;
  const clampedYear = Math.max(1, Math.min(yearOfService, 15));
  const table = position === "CPT" ? CAPTAIN_TABLE : FO_TABLE;
  const row = table.find((r) => r.yearOfService === clampedYear) ?? table[0];
  const posLabel = position === "CPT" ? "CPT" : "FO";

  const isManualOverride =
    overrideRateCents != null &&
    overrideRateCents !== row.hourlyRateCents;

  return {
    payStepLabel: `${ordinal(clampedYear)} Year ${posLabel}`,
    yearOfService: clampedYear,
    hourlyRateCents: isManualOverride ? overrideRateCents! : row.hourlyRateCents,
    payAtGuaranteeCents: row.payAtGuaranteeCents,
    avgLinePayCents: row.avgLinePayCents,
    avgTotalPayCents: row.avgTotalPayCents,
    isManualOverride: isManualOverride ?? false,
    sourceNote: "UPS / IPA Contract Extension TA (effective Sep 1, 2025)",
  };
}

/**
 * Return the raw pay row for a given position + year (useful for display tables).
 */
export function getPayRow(
  position: PayPosition,
  yearOfService: number
): PayRow | null {
  const table = position === "CPT" ? CAPTAIN_TABLE : FO_TABLE;
  return table.find((r) => r.yearOfService === yearOfService) ?? null;
}

// ─── Formatting helpers (re-exported for convenience) ────────────────────────

export function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export function formatHourlyRate(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/hr`;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD" or "MM/DD/YYYY" into a Date (local midnight). */
function parseDateFlexible(raw: string): Date | null {
  const trimmed = raw.trim();

  // ISO: 2022-04-04
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }

  // US: 04/04/2022 or 4/4/2022
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const [, m, d, y] = us;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }

  return null;
}
