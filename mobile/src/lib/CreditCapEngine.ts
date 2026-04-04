/**
 * CreditCapEngine — UPS Pilot Pay Credit Cap Engine
 *
 * Single source of truth for all contract-defined credited time limits.
 * Pure functions only — no UI imports, no side effects.
 * All times in decimal hours (e.g. 7.5 = 7:30).
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodType = "BID_56" | "BID_28" | "PAY_35";
export type AssignmentType = "DOMESTIC" | "INTERNATIONAL";

export interface CapExclusions {
  /** Vacation credit hours (excluded from cap counting) */
  vacationCredit?: number;
  /** Short-term training credit hours */
  shortTermTrainingCredit?: number;
  /** Junior Manning credit hours */
  juniorManningCredit?: number;
  /** CRAF activation credit hours */
  crafActivationCredit?: number;
  /** Sick leave credit hours */
  sickLeaveCredit?: number;
}

export interface VacationNuance {
  /** Whether the pilot has vacation scheduled in this period */
  hasVacationInPeriod?: boolean;
  /**
   * Credit hours of trips dropped to accommodate vacation.
   * When vacation cap relief is enabled, the effective absolute cap
   * increases by this amount.
   */
  droppedTripsCreditForVacation?: number;
  /** Toggle: enable the vacation-drop cap relief feature */
  enableVacationDropCapRelief?: boolean;
}

export interface CreditCapInputs {
  /** Period type determines absolute cap and OT gate cap */
  periodType: PeriodType;
  /** Pilot's awarded bid line projection credit (hours) */
  awardedLineCredit: number;
  /** Planned Open Time credit the pilot wants to pick up (hours) */
  plannedOpenTimeCredit: number;
  /** Any other cap-counting adders besides line + OT (hours, optional) */
  plannedOtherCapCountingCredit?: number;
  /** Is this a Reduced Guarantee (RDG) line? */
  isRDGLine?: boolean;
  /** Required when isRDGLine is true */
  assignmentType?: AssignmentType;
  /**
   * Allow trip completion to exceed caps. When a trip departed domicile,
   * the pilot may lawfully exceed the absolute cap for completion.
   */
  allowTripCompletionOvercap?: boolean;
  /**
   * Unavoidable additional credit from a trip already in progress.
   * Only used when allowTripCompletionOvercap is true.
   */
  tripCompletionCreditOvercap?: number;
  /** Credited time excluded from cap accounting (still counts for pay) */
  exclusions?: CapExclusions;
  /** Vacation scheduling nuance */
  vacationNuance?: VacationNuance;
}

export type CreditCapStatus =
  | "ACHIEVABLE"
  | "NOT_ACHIEVABLE_WITH_OT"
  | "EXCEEDS_CAP_BLOCKED"
  | "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION";

export interface CreditCapResult {
  status: CreditCapStatus;

  // Period limits
  periodType: PeriodType;
  absoluteCap: number;
  effectiveAbsoluteCap: number;
  openTimeGateCap: number;

  // Line & credit breakdown
  awardedLineCredit: number;
  exclusionsSum: number;
  maxOpenTimeAllowed: number;

  // Planned vs clamped OT
  plannedOpenTimeCreditRequested: number;
  plannedOpenTimeCreditClamped: number;

  // Final cap-counting credit (after clamping OT)
  capCountingCredit: number;

  // How far over effective cap (0 if not over)
  overCapBy: number;

  // Human-readable warnings
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT LIMITS (hardcoded ONLY here — never in UI)
// ─────────────────────────────────────────────────────────────────────────────

const ABSOLUTE_CAPS: Record<PeriodType, number> = {
  BID_56: 208,
  BID_28: 104,
  PAY_35: 130,
};

const OPEN_TIME_GATE_CAPS: Record<PeriodType, number> = {
  BID_56: 192,
  BID_28: 96,
  PAY_35: 120,
};

const RDG_EXTRA_LIMIT: Record<AssignmentType, number> = {
  DOMESTIC: 5.0,
  INTERNATIONAL: 7.0,
};

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert decimal hours to HH:MM string.
 * e.g. 7.5 → "7:30", 130.0 → "130:00"
 */
export function formatDecimalToHHMM(hours: number): string {
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const sign = hours < 0 ? "-" : "";
  return `${sign}${h}:${m.toString().padStart(2, "0")}`;
}

/**
 * Convert HH:MM string to decimal hours.
 * e.g. "7:30" → 7.5
 */
export function formatHHMMToDecimal(hhMm: string): number {
  const parts = hhMm.split(":");
  if (parts.length !== 2) return parseFloat(hhMm) || 0;
  const hours = parseInt(parts[0] ?? "0", 10) || 0;
  const minutes = parseInt(parts[1] ?? "0", 10) || 0;
  return hours + minutes / 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the absolute credited time cap and the OT pickup gate cap
 * for the given period type.
 */
export function getPeriodLimits(
  periodType: PeriodType
): { absoluteCap: number; openTimeGateCap: number } {
  return {
    absoluteCap: ABSOLUTE_CAPS[periodType],
    openTimeGateCap: OPEN_TIME_GATE_CAPS[periodType],
  };
}

/**
 * Sum all exclusion credits. Returns 0 if no exclusions provided.
 */
export function sumExclusions(exclusions?: CapExclusions): number {
  if (!exclusions) return 0;
  return (
    (exclusions.vacationCredit ?? 0) +
    (exclusions.shortTermTrainingCredit ?? 0) +
    (exclusions.juniorManningCredit ?? 0) +
    (exclusions.crafActivationCredit ?? 0) +
    (exclusions.sickLeaveCredit ?? 0)
  );
}

/**
 * Compute the effective absolute cap, accounting for vacation drop relief.
 * If vacation cap relief is enabled and the pilot dropped trips for vacation,
 * the effective cap increases by those dropped trip credits.
 */
export function getEffectiveAbsoluteCap(inputs: CreditCapInputs): number {
  const { absoluteCap } = getPeriodLimits(inputs.periodType);
  const vac = inputs.vacationNuance;
  if (
    vac?.enableVacationDropCapRelief &&
    vac.hasVacationInPeriod &&
    (vac.droppedTripsCreditForVacation ?? 0) > 0
  ) {
    return absoluteCap + (vac.droppedTripsCreditForVacation ?? 0);
  }
  return absoluteCap;
}

/**
 * Compute cap-counting credit from inputs.
 * cap-counting = (awardedLineCredit + plannedOpenTimeCredit + plannedOtherCapCountingCredit)
 *                - exclusionsSum
 * Clamped to minimum 0.
 */
export function computeCapCountingCredit(inputs: CreditCapInputs): number {
  const exclusionsSum = sumExclusions(inputs.exclusions);
  const raw =
    (inputs.awardedLineCredit ?? 0) +
    (inputs.plannedOpenTimeCredit ?? 0) +
    (inputs.plannedOtherCapCountingCredit ?? 0) -
    exclusionsSum;
  return Math.max(0, raw);
}

/**
 * Compute the maximum Open Time hours the pilot is allowed to pick up.
 *
 * RDG line: max OT = awardedLineCredit + rdgExtraLimit - other cap counting - exclusionsSum
 * Regular line: max OT = max(0, openTimeGateCap - awardedLineCredit)
 */
export function computeMaxOpenTimeAllowed(inputs: CreditCapInputs): number {
  const { openTimeGateCap } = getPeriodLimits(inputs.periodType);
  const exclusionsSum = sumExclusions(inputs.exclusions);
  const other = inputs.plannedOtherCapCountingCredit ?? 0;

  if (inputs.isRDGLine) {
    const rdgExtra =
      RDG_EXTRA_LIMIT[inputs.assignmentType ?? "DOMESTIC"];
    // Maximum cap-counting credit allowed under RDG
    const maxCapCountingAllowed = inputs.awardedLineCredit + rdgExtra;
    // Solve: (awardedLine + maxOT + other - exclusionsSum) <= maxCapCountingAllowed
    const maxOT = maxCapCountingAllowed - inputs.awardedLineCredit - other + exclusionsSum;
    return Math.max(0, maxOT);
  }

  // Regular line: limited by OT pickup gate
  return Math.max(0, openTimeGateCap - inputs.awardedLineCredit);
}

/**
 * Return a copy of inputs with plannedOpenTimeCredit clamped to maxOpenTimeAllowed.
 */
export function applyOpenTimeClamp(inputs: CreditCapInputs): CreditCapInputs {
  const max = computeMaxOpenTimeAllowed(inputs);
  const clamped = Math.min(inputs.plannedOpenTimeCredit ?? 0, max);
  return { ...inputs, plannedOpenTimeCredit: clamped };
}

/**
 * Full evaluation of a pilot's intended credit plan against contract caps.
 * Returns a CreditCapResult with status, all intermediate values, and warnings.
 */
export function evaluateCreditedTimeStatus(
  inputs: CreditCapInputs
): CreditCapResult {
  const { absoluteCap, openTimeGateCap } = getPeriodLimits(inputs.periodType);
  const exclusionsSum = sumExclusions(inputs.exclusions);
  const effectiveAbsoluteCap = getEffectiveAbsoluteCap(inputs);

  const plannedOpenTimeCreditRequested = inputs.plannedOpenTimeCredit ?? 0;
  const maxOpenTimeAllowed = computeMaxOpenTimeAllowed(inputs);

  // Clamp OT
  const plannedOpenTimeCreditClamped = Math.min(
    plannedOpenTimeCreditRequested,
    maxOpenTimeAllowed
  );

  // Compute cap-counting credit with clamped OT
  const clampedInputs: CreditCapInputs = {
    ...inputs,
    plannedOpenTimeCredit: plannedOpenTimeCreditClamped,
  };
  const capCountingCredit = computeCapCountingCredit(clampedInputs);

  const warnings: string[] = [];
  let status: CreditCapStatus;
  let overCapBy = 0;

  // ── Step 1: Check if cap-counting credit exceeds effective absolute cap ──
  if (capCountingCredit > effectiveAbsoluteCap) {
    overCapBy = capCountingCredit - effectiveAbsoluteCap;

    if (
      inputs.allowTripCompletionOvercap &&
      (inputs.tripCompletionCreditOvercap ?? 0) > 0
    ) {
      status = "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION";
      warnings.push(
        `Over cap due to trip completion: ${formatDecimalToHHMM(overCapBy)} over effective cap of ${formatDecimalToHHMM(effectiveAbsoluteCap)}.`
      );
    } else {
      status = "EXCEEDS_CAP_BLOCKED";
      if (inputs.isRDGLine) {
        const rdgExtra =
          RDG_EXTRA_LIMIT[inputs.assignmentType ?? "DOMESTIC"];
        const rdgMaxAllowed = inputs.awardedLineCredit + rdgExtra;
        warnings.push(
          `RDG limit exceeded: awarded line is ${formatDecimalToHHMM(inputs.awardedLineCredit)}, max cap-counting credit with ${inputs.assignmentType ?? "DOMESTIC"} RDG is ${formatDecimalToHHMM(rdgMaxAllowed)} (+${rdgExtra} hrs). Over by ${formatDecimalToHHMM(overCapBy)}.`
        );
      } else {
        warnings.push(
          `Exceeds ${inputs.periodType} absolute credited time cap of ${formatDecimalToHHMM(effectiveAbsoluteCap)} by ${formatDecimalToHHMM(overCapBy)}.`
        );
      }
    }
  }
  // ── Step 2: OT was clamped (goal not achievable but cap not exceeded) ──
  else if (plannedOpenTimeCreditRequested > plannedOpenTimeCreditClamped) {
    status = "NOT_ACHIEVABLE_WITH_OT";
    const shortfall = plannedOpenTimeCreditRequested - plannedOpenTimeCreditClamped;
    warnings.push(
      `OT pickup limit binds: max OT allowed is ${formatDecimalToHHMM(maxOpenTimeAllowed)} (requested ${formatDecimalToHHMM(plannedOpenTimeCreditRequested)}, short by ${formatDecimalToHHMM(shortfall)}).`
    );
    if (inputs.isRDGLine) {
      const rdgExtra =
        RDG_EXTRA_LIMIT[inputs.assignmentType ?? "DOMESTIC"];
      warnings.push(
        `RDG (${inputs.assignmentType ?? "DOMESTIC"}) restricts pickup to +${rdgExtra} hrs over awarded line.`
      );
    }
  }
  // ── Step 3: Fully achievable ──
  else {
    status = "ACHIEVABLE";
  }

  // Additional informational warnings
  if (exclusionsSum > 0) {
    warnings.push(
      `${formatDecimalToHHMM(exclusionsSum)} excluded from cap (vacation, training, junior manning, CRAF, sick leave) — still contributes to pay.`
    );
  }
  if (
    inputs.vacationNuance?.enableVacationDropCapRelief &&
    inputs.vacationNuance?.hasVacationInPeriod &&
    (inputs.vacationNuance?.droppedTripsCreditForVacation ?? 0) > 0
  ) {
    warnings.push(
      `Vacation cap relief applied: effective absolute cap raised from ${formatDecimalToHHMM(absoluteCap)} to ${formatDecimalToHHMM(effectiveAbsoluteCap)}.`
    );
  }

  return {
    status,
    periodType: inputs.periodType,
    absoluteCap,
    effectiveAbsoluteCap,
    openTimeGateCap,
    awardedLineCredit: inputs.awardedLineCredit ?? 0,
    exclusionsSum,
    maxOpenTimeAllowed,
    plannedOpenTimeCreditRequested,
    plannedOpenTimeCreditClamped,
    capCountingCredit,
    overCapBy,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE: total pay-contributing credit (cap-counting + exclusions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Total credit that contributes to pay = capCountingCredit + exclusionsSum.
 * Exclusions do NOT consume cap room but DO generate pay.
 */
export function totalPayContributingCredit(
  result: CreditCapResult,
  exclusionsSum: number
): number {
  return result.capCountingCredit + exclusionsSum;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CREDIT CAP PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditCapPreferences {
  periodType: PeriodType;
  awardedLineCredit: number;
  isRDGLine: boolean;
  assignmentType: AssignmentType;
  exclusionsDefaults: CapExclusions;
  allowTripCompletionOvercap: boolean;
  tripCompletionCreditOvercap: number;
  enableVacationDropCapRelief: boolean;
  droppedTripsCreditForVacation: number;
  hasVacationInPeriod: boolean;
}

export const DEFAULT_CREDIT_CAP_PREFERENCES: CreditCapPreferences = {
  periodType: "BID_56",
  awardedLineCredit: 0,
  isRDGLine: false,
  assignmentType: "DOMESTIC",
  exclusionsDefaults: {
    vacationCredit: 0,
    shortTermTrainingCredit: 0,
    juniorManningCredit: 0,
    crafActivationCredit: 0,
    sickLeaveCredit: 0,
  },
  allowTripCompletionOvercap: false,
  tripCompletionCreditOvercap: 0,
  enableVacationDropCapRelief: false,
  droppedTripsCreditForVacation: 0,
  hasVacationInPeriod: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// BID PERIOD CALENDAR (UPS official dates)
// ─────────────────────────────────────────────────────────────────────────────

export interface BidPeriodEntry {
  contractYear: number;
  periodNumber: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  durationDays: 28 | 56;
}

export const UPS_BID_PERIODS: BidPeriodEntry[] = [
  // 2026
  { contractYear: 2026, periodNumber: 2, startDate: '2026-01-25', endDate: '2026-03-21', durationDays: 56 },
  { contractYear: 2026, periodNumber: 3, startDate: '2026-03-22', endDate: '2026-05-16', durationDays: 56 },
  { contractYear: 2026, periodNumber: 4, startDate: '2026-05-17', endDate: '2026-07-11', durationDays: 56 },
  { contractYear: 2026, periodNumber: 5, startDate: '2026-07-12', endDate: '2026-09-05', durationDays: 56 },
  { contractYear: 2026, periodNumber: 6, startDate: '2026-09-06', endDate: '2026-10-31', durationDays: 56 },
  { contractYear: 2026, periodNumber: 7, startDate: '2026-11-01', endDate: '2026-11-28', durationDays: 28 },
  // 2027
  { contractYear: 2027, periodNumber: 1, startDate: '2026-11-29', endDate: '2027-01-23', durationDays: 56 },
  { contractYear: 2027, periodNumber: 2, startDate: '2027-01-24', endDate: '2027-03-20', durationDays: 56 },
  { contractYear: 2027, periodNumber: 3, startDate: '2027-03-21', endDate: '2027-05-15', durationDays: 56 },
  { contractYear: 2027, periodNumber: 4, startDate: '2027-05-16', endDate: '2027-07-10', durationDays: 56 },
  { contractYear: 2027, periodNumber: 5, startDate: '2027-07-11', endDate: '2027-09-04', durationDays: 56 },
  { contractYear: 2027, periodNumber: 6, startDate: '2027-09-05', endDate: '2027-10-30', durationDays: 56 },
  { contractYear: 2027, periodNumber: 7, startDate: '2027-10-31', endDate: '2027-11-27', durationDays: 28 },
  { contractYear: 2028, periodNumber: 1, startDate: '2027-11-28', endDate: '2028-01-22', durationDays: 56 },
];

/**
 * Get the bid period for a given ISO date string.
 * Returns null if no bid period found.
 */
export function getBidPeriodForDate(dateISO: string): BidPeriodEntry | null {
  for (const period of UPS_BID_PERIODS) {
    if (dateISO >= period.startDate && dateISO <= period.endDate) {
      return period;
    }
  }
  return null;
}

/**
 * Get the "relevant" bid period for the credit cap section.
 * If today is within the last 3 days of the current period (or already past it),
 * return the NEXT period — since the pilot has already bid for that upcoming period.
 * Otherwise return the current period.
 */
export function getRelevantBidPeriod(todayISO?: string): BidPeriodEntry | null {
  const today = todayISO ?? new Date().toISOString().split('T')[0] ?? '';
  const current = getBidPeriodForDate(today);

  if (current) {
    // Check days remaining in current period
    const endMs = new Date(current.endDate + 'T23:59:59').getTime();
    const todayMs = new Date(today + 'T00:00:00').getTime();
    const daysRemaining = Math.ceil((endMs - todayMs) / (1000 * 60 * 60 * 24));

    // If 3 or fewer days left in the current period, use the next period
    if (daysRemaining <= 3) {
      const currentIdx = UPS_BID_PERIODS.indexOf(current);
      if (currentIdx >= 0 && currentIdx + 1 < UPS_BID_PERIODS.length) {
        return UPS_BID_PERIODS[currentIdx + 1] ?? current;
      }
    }
    return current;
  }

  // Today is between periods — find the next one
  for (const period of UPS_BID_PERIODS) {
    if (period.startDate > today) return period;
  }
  return null;
}

/**
 * Build CreditCapInputs from preferences + a planned OT value.
 */
export function buildCapInputsFromPrefs(
  prefs: CreditCapPreferences,
  plannedOpenTimeCredit: number,
  plannedOtherCapCountingCredit?: number
): CreditCapInputs {
  return {
    periodType: prefs.periodType,
    awardedLineCredit: prefs.awardedLineCredit,
    plannedOpenTimeCredit,
    plannedOtherCapCountingCredit: plannedOtherCapCountingCredit ?? 0,
    isRDGLine: prefs.isRDGLine,
    assignmentType: prefs.assignmentType,
    allowTripCompletionOvercap: prefs.allowTripCompletionOvercap,
    tripCompletionCreditOvercap: prefs.tripCompletionCreditOvercap,
    exclusions: prefs.exclusionsDefaults,
    vacationNuance: {
      hasVacationInPeriod: prefs.hasVacationInPeriod,
      droppedTripsCreditForVacation: prefs.droppedTripsCreditForVacation,
      enableVacationDropCapRelief: prefs.enableVacationDropCapRelief,
    },
  };
}
