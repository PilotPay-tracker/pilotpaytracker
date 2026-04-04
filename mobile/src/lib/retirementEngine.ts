/**
 * Retirement Planning Engine — v3
 *
 * CBA 2023–2028 Calculation Engine (ruleset version: "CBA 2023–2028")
 * Pure TypeScript — no React Native or browser dependencies.
 * Shared between mobile and web.
 *
 * Plans modelled per UPS–IPA CBA:
 *   - Plan A Pension (Defined Benefit):
 *       Formula 1: 0.01 × FinalAverageEarnings × min(YOS, 30)
 *       Formula 2 (flat dollar minimum):
 *         Captain: $4,200 × min(YOS, 30) (retirements >= 2021-01-01)
 *         FO: $3,360 × min(YOS, 30) (retirements >= 2021-01-01)
 *       USE MAX of the two formulas.
 *
 *   - Plan B / MPP (Defined Contribution — employer only):
 *       Annual company contribution = 12% of eligible comp
 *       Project balance to retirement via contributions + return assumption
 *       Retirement income via SWR (default 4%): balance × SWR
 *
 *   - VEBA / HRA (Retiree Medical Trust):
 *       Accrual while working: $1 per hour of pay
 *       Post-retire benefit: $6,250/yr per participant (1–3)
 *       Stops at Medicare eligibility (default age 65, toggleable)
 *       NOT cash — medical reimbursement only
 *
 *   - Sick Leave: One-time payout at retirement. NEVER included in annual income.
 *
 * Validation:
 *   - pensionMonthly must == pensionAnnual / 12
 *   - Flag unrealistic pension if YOS < 30 (sanity check)
 *
 * All calculations are estimates only.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const CBA_RULESET_VERSION = "CBA 2023–2028";

/** Flat dollar minimums per YOS per CBA (retirements >= 2021-01-01) */
export const PENSION_FLAT_DOLLAR_CAPTAIN_PER_YOS = 420000;  // $4,200 in cents
export const PENSION_FLAT_DOLLAR_FO_PER_YOS = 336000;       // $3,360 in cents

/** Plan B employer-only contribution rate */
export const PLAN_B_EMPLOYER_RATE = 0.12;  // 12% employer only per CBA

/** Percent formula coefficient */
export const PENSION_PERCENT_FORMULA_COEFFICIENT = 0.01;  // 1%

/** VEBA per-hour accrual */
export const VEBA_PER_HOUR_CENTS = 100;  // $1.00 per paid hour

/** HRA annual post-retirement benefit */
export const HRA_ANNUAL_POST_RETIRE_CENTS = 625000;  // $6,250/year

/** Medicare eligibility default age */
export const MEDICARE_ELIGIBILITY_AGE_DEFAULT = 65;

/** Default upgrade years from DOH (staffing average) */
export const DEFAULT_UPGRADE_YEARS_FROM_DOH = 7;

// ─────────────────────────────────────────────────────────────────────────────
// DATA TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SeatType = "FO" | "CAPTAIN";

export type EarningsBasis = "GUAR" | "LINE" | "TOTAL";

/** Career path scenario — drives the forecast seat assignment */
export type CareerPathScenario = "FO_ONLY" | "UPGRADE_TO_CPT";

/** Which pension formula was used (for audit/display) */
export type PensionFormulaUsed = "PERCENT" | "FLAT_DOLLAR";

export interface PriorEarnings {
  priorYearsService: number;
  averageAnnualIncomeCents: number;
  estimatedPlanBContributionsCents: number | null; // null = computed from rate
}

export interface RetirementProfile {
  doh: string | null;   // date of hire YYYY-MM-DD
  dob: string | null;   // date of birth YYYY-MM-DD
  retirementAge: number;  // default 65
  earningsBasis: EarningsBasis;
  expectedUpgradeYear: number | null;
  activeScenario: CareerPathScenario;
  priorEarnings: PriorEarnings | null;
  outsideRetirementAssetsCents: number;
  includeOutsideAssets: boolean;
  priorEarningsSkipped: boolean;
  planBGrowthRatePct: number; // 3, 5, or 7
  safeWithdrawalRatePct: number;
  stopHRAAtMedicare: boolean;
  medicareEligibilityAge: number;
  sickLeaveHoursBalance: number | null;
  retirement401kCents: number;
  retirementIRACents: number;
  retirementBrokerageCents: number;
  include401kInRetirementIncome: boolean;
  careerPriority: "maximize_earnings" | "maximize_schedule" | "balanced";
}

// ─────────────────────────────────────────────────────────────────────────────
// PAY TABLE — embedded from UPS Contract Extension TA 2025
// ─────────────────────────────────────────────────────────────────────────────

export interface PayTableRow {
  yearOfService: number;
  hourlyRateCents: number;
  payAtGuaranteeCents: number;
  avgLinePayCents: number;
  avgTotalPayCents: number;
}

export interface PayTable {
  contractTag: string;
  effectiveDate: string;  // "YYYY-MM-DD"
  fo: PayTableRow[];
  captain: PayTableRow[];
}

/**
 * UPS Contract Extension TA 2025 — Official pay table
 * Source: UPS / IPA Contract Extension TA, effective Sep 1, 2025
 * 975 hrs/yr guarantee (75 hrs/month)
 */
export const UPS_PAY_TABLES: PayTable[] = [
  {
    contractTag: "Contract Extension TA – 2025",
    effectiveDate: "2025-09-01",
    fo: [
      { yearOfService: 1,  hourlyRateCents: 5977,   payAtGuaranteeCents: 5827600,  avgLinePayCents: 6086600,  avgTotalPayCents: 6714600 },
      { yearOfService: 2,  hourlyRateCents: 22804,  payAtGuaranteeCents: 22233900, avgLinePayCents: 23222000, avgTotalPayCents: 25618000 },
      { yearOfService: 3,  hourlyRateCents: 22835,  payAtGuaranteeCents: 22264100, avgLinePayCents: 23253600, avgTotalPayCents: 25652800 },
      { yearOfService: 4,  hourlyRateCents: 23293,  payAtGuaranteeCents: 22710700, avgLinePayCents: 23720000, avgTotalPayCents: 26167400 },
      { yearOfService: 5,  hourlyRateCents: 23758,  payAtGuaranteeCents: 23164100, avgLinePayCents: 24193500, avgTotalPayCents: 26689700 },
      { yearOfService: 6,  hourlyRateCents: 24232,  payAtGuaranteeCents: 23626200, avgLinePayCents: 24676200, avgTotalPayCents: 27222200 },
      { yearOfService: 7,  hourlyRateCents: 24717,  payAtGuaranteeCents: 24099100, avgLinePayCents: 25170100, avgTotalPayCents: 27767100 },
      { yearOfService: 8,  hourlyRateCents: 25210,  payAtGuaranteeCents: 24579800, avgLinePayCents: 25672100, avgTotalPayCents: 28320900 },
      { yearOfService: 9,  hourlyRateCents: 25714,  payAtGuaranteeCents: 25071200, avgLinePayCents: 26185300, avgTotalPayCents: 28887100 },
      { yearOfService: 10, hourlyRateCents: 26432,  payAtGuaranteeCents: 25771200, avgLinePayCents: 26916500, avgTotalPayCents: 29693700 },
      { yearOfService: 11, hourlyRateCents: 27174,  payAtGuaranteeCents: 26494700, avgLinePayCents: 27672100, avgTotalPayCents: 30527300 },
      { yearOfService: 12, hourlyRateCents: 27937,  payAtGuaranteeCents: 27238600, avgLinePayCents: 28449100, avgTotalPayCents: 31384400 },
      { yearOfService: 13, hourlyRateCents: 28078,  payAtGuaranteeCents: 27376100, avgLinePayCents: 28592700, avgTotalPayCents: 31542800 },
      { yearOfService: 14, hourlyRateCents: 28216,  payAtGuaranteeCents: 27510600, avgLinePayCents: 28733200, avgTotalPayCents: 31697900 },
      { yearOfService: 15, hourlyRateCents: 28429,  payAtGuaranteeCents: 27718300, avgLinePayCents: 28950100, avgTotalPayCents: 31937100 },
    ],
    captain: [
      { yearOfService: 1,  hourlyRateCents: 5977,   payAtGuaranteeCents: 5827600,  avgLinePayCents: 6086600,  avgTotalPayCents: 7311100 },
      { yearOfService: 2,  hourlyRateCents: 36739,  payAtGuaranteeCents: 35820500, avgLinePayCents: 37412400, avgTotalPayCents: 44939100 },
      { yearOfService: 3,  hourlyRateCents: 36811,  payAtGuaranteeCents: 35890700, avgLinePayCents: 37485700, avgTotalPayCents: 45027200 },
      { yearOfService: 4,  hourlyRateCents: 36960,  payAtGuaranteeCents: 36036000, avgLinePayCents: 37637500, avgTotalPayCents: 45209500 },
      { yearOfService: 5,  hourlyRateCents: 37107,  payAtGuaranteeCents: 36179300, avgLinePayCents: 37787200, avgTotalPayCents: 45389300 },
      { yearOfService: 6,  hourlyRateCents: 37253,  payAtGuaranteeCents: 36321700, avgLinePayCents: 37935800, avgTotalPayCents: 45567900 },
      { yearOfService: 7,  hourlyRateCents: 37404,  payAtGuaranteeCents: 36468900, avgLinePayCents: 38089600, avgTotalPayCents: 45752600 },
      { yearOfService: 8,  hourlyRateCents: 37553,  payAtGuaranteeCents: 36614200, avgLinePayCents: 38241300, avgTotalPayCents: 45934800 },
      { yearOfService: 9,  hourlyRateCents: 37702,  payAtGuaranteeCents: 36759500, avgLinePayCents: 38393100, avgTotalPayCents: 46117100 },
      { yearOfService: 10, hourlyRateCents: 38137,  payAtGuaranteeCents: 37183600, avgLinePayCents: 38836100, avgTotalPayCents: 46649200 },
      { yearOfService: 11, hourlyRateCents: 38577,  payAtGuaranteeCents: 37612600, avgLinePayCents: 39284100, avgTotalPayCents: 47187400 },
      { yearOfService: 12, hourlyRateCents: 39021,  payAtGuaranteeCents: 38045500, avgLinePayCents: 39736300, avgTotalPayCents: 47730500 },
      { yearOfService: 13, hourlyRateCents: 39312,  payAtGuaranteeCents: 38329200, avgLinePayCents: 40032600, avgTotalPayCents: 48086400 },
      { yearOfService: 14, hourlyRateCents: 39705,  payAtGuaranteeCents: 38712400, avgLinePayCents: 40432800, avgTotalPayCents: 48567200 },
      { yearOfService: 15, hourlyRateCents: 40101,  payAtGuaranteeCents: 39098500, avgLinePayCents: 40836100, avgTotalPayCents: 49051500 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT RULES — versioned, effective-date-driven
// ─────────────────────────────────────────────────────────────────────────────

export interface ContractRetirementRules {
  contractVersion: string;
  effectiveDate: string;
  label: string;
  rulesetVersion: string;
  planBEmployerRate: number;
  pensionPercentCoefficient: number;
  pensionFlatDollarCaptainPerYOS: number;
  pensionFlatDollarFOPerYOS: number;
  pensionFlatDollarEffectiveDate: string;
  pensionMaxYOS: number;
  pensionCap: number | null;
  vebaPerHourCents: number;
  hraAnnualPostRetireCents: number;
  vebaEnabled: boolean;
  monthlyGuaranteeHours: number;
  wording: {
    planB: string;
    planA: string;
    veba: string;
    sick: string;
  };
}

export const UPS_CONTRACT_RULES: ContractRetirementRules[] = [
  {
    contractVersion: "2023",
    effectiveDate: "2023-08-01",
    label: "CBA 2023–2028",
    rulesetVersion: CBA_RULESET_VERSION,
    planBEmployerRate: PLAN_B_EMPLOYER_RATE,
    pensionPercentCoefficient: PENSION_PERCENT_FORMULA_COEFFICIENT,
    pensionFlatDollarCaptainPerYOS: PENSION_FLAT_DOLLAR_CAPTAIN_PER_YOS,
    pensionFlatDollarFOPerYOS: PENSION_FLAT_DOLLAR_FO_PER_YOS,
    pensionFlatDollarEffectiveDate: "2021-01-01",
    pensionMaxYOS: 30,
    pensionCap: null,
    vebaPerHourCents: VEBA_PER_HOUR_CENTS,
    hraAnnualPostRetireCents: HRA_ANNUAL_POST_RETIRE_CENTS,
    vebaEnabled: true,
    monthlyGuaranteeHours: 75,
    wording: {
      planB: "UPS contributes 12% of eligible compensation (gross pay) to the Money Purchase Pension (MPP) as an employer-only contribution. This goes into a tax-deferred defined contribution account. Per CBA 2023–2028.",
      planA: "UPS pilots receive a defined-benefit pension calculated as the GREATER of: (1) 1% × Final Average Earnings × Years of Service (max 30), or (2) a flat-dollar minimum of $4,200/YOS for Captains or $3,360/YOS for First Officers (for retirements on or after January 1, 2021). YOS capped at 30. Per CBA 2023–2028.",
      veba: "The VEBA / HRA funds post-retirement medical coverage. $1 per paid flight hour is contributed to the Health Reimbursement Account while working. After retirement, the HRA provides up to $6,250/year in medical reimbursements (participant coverage). This is NOT cash — medical reimbursement only. Benefit stops at Medicare eligibility (default age 65). Per CBA 2023–2028.",
      sick: "Sick leave payout upon retirement is a one-time payment only. Unused sick bank hours may be payable at retirement based on your accumulated balance. This amount is NEVER included in annual retirement income projections. Consult UPS HR for your specific payout amount.",
    },
  },
  {
    contractVersion: "2028",
    effectiveDate: "2028-01-01",
    label: "CBA 2028 (Projected)",
    rulesetVersion: "CBA 2028 (Projected)",
    planBEmployerRate: 0.13,
    pensionPercentCoefficient: PENSION_PERCENT_FORMULA_COEFFICIENT,
    pensionFlatDollarCaptainPerYOS: 462000,
    pensionFlatDollarFOPerYOS: 369600,
    pensionFlatDollarEffectiveDate: "2021-01-01",
    pensionMaxYOS: 30,
    pensionCap: null,
    vebaPerHourCents: VEBA_PER_HOUR_CENTS,
    hraAnnualPostRetireCents: HRA_ANNUAL_POST_RETIRE_CENTS,
    vebaEnabled: true,
    monthlyGuaranteeHours: 75,
    wording: {
      planB: "Projected 2028 contract: estimated Plan B employer contribution increases to ~13%. These are estimates only — actual figures depend on future bargaining.",
      planA: "Projected 2028 contract: estimated flat-dollar pension minimums increase to ~$4,620/YOS (Captain) and ~$3,696/YOS (FO). Percent formula remains 1% × FAE × YOS. USE MAX of the two. Estimates only.",
      veba: "VEBA contribution rate and HRA benefit assumed to remain at 2023 contract levels pending future bargaining. Estimate only. Benefit still stops at Medicare eligibility.",
      sick: "Sick leave payout rules assumed to carry forward. One-time payout only. Consult future contract language when available.",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PAY TABLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getPayTableForYear(year: number): PayTable {
  const sorted = [...UPS_PAY_TABLES].sort(
    (a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime()
  );
  for (const table of sorted) {
    if (year >= new Date(table.effectiveDate).getFullYear()) return table;
  }
  return sorted[sorted.length - 1];
}

export function getPayStepYear(calendarYear: number, doh: string): number {
  const dohYear = new Date(doh).getFullYear();
  const step = calendarYear - dohYear;
  return Math.max(1, Math.min(step, 15));
}

export function getPayTableAnnualComp(
  calendarYear: number,
  doh: string,
  seatType: SeatType,
  basis: EarningsBasis
): number {
  const table = getPayTableForYear(calendarYear);
  const step = getPayStepYear(calendarYear, doh);
  const rows = seatType === "FO" ? table.fo : table.captain;
  const row = rows.find((r) => r.yearOfService === step) ?? rows[rows.length - 1];
  switch (basis) {
    case "GUAR":  return row.payAtGuaranteeCents;
    case "LINE":  return row.avgLinePayCents;
    case "TOTAL": return row.avgTotalPayCents;
  }
}

export function getPayTableHourlyRate(calendarYear: number, doh: string, seatType: SeatType): number {
  const table = getPayTableForYear(calendarYear);
  const step = getPayStepYear(calendarYear, doh);
  const rows = seatType === "FO" ? table.fo : table.captain;
  const row = rows.find((r) => r.yearOfService === step) ?? rows[rows.length - 1];
  return row.hourlyRateCents;
}

export function getContractRulesForYear(year: number): ContractRetirementRules {
  const sorted = [...UPS_CONTRACT_RULES].sort(
    (a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime()
  );
  for (const rule of sorted) {
    if (year >= new Date(rule.effectiveDate).getFullYear()) return rule;
  }
  return sorted[sorted.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// PENSION DUAL-FORMULA ENGINE (Plan A)
// ─────────────────────────────────────────────────────────────────────────────

export interface PensionCalculationResult {
  annualCents: number;
  monthlyCents: number;
  formulaUsed: PensionFormulaUsed;
  percentFormulaAnnualCents: number;
  flatDollarFormulaAnnualCents: number;
  finalAverageEarningsCents: number;
  effectiveYOS: number;
  isValid: boolean;
  validationError: string | null;
  sanityWarning: string | null;
}

export function computePlanAPension(
  finalAverageEarningsCents: number,
  yearsOfService: number,
  seatAtRetirement: SeatType,
  retirementDate: string,
  rules: ContractRetirementRules
): PensionCalculationResult {
  const effectiveYOS = Math.max(0, Math.min(yearsOfService, rules.pensionMaxYOS));

  const percentFormulaAnnualCents = Math.round(
    rules.pensionPercentCoefficient * finalAverageEarningsCents * effectiveYOS
  );

  const retirementIsEligibleForFlat = retirementDate >= rules.pensionFlatDollarEffectiveDate;

  let flatDollarFormulaAnnualCents = 0;
  if (retirementIsEligibleForFlat) {
    const flatRatePerYOS =
      seatAtRetirement === "CAPTAIN"
        ? rules.pensionFlatDollarCaptainPerYOS
        : rules.pensionFlatDollarFOPerYOS;
    flatDollarFormulaAnnualCents = flatRatePerYOS * effectiveYOS;
  }

  const useFlat = flatDollarFormulaAnnualCents > percentFormulaAnnualCents;
  const annualCents = useFlat ? flatDollarFormulaAnnualCents : percentFormulaAnnualCents;
  const formulaUsed: PensionFormulaUsed = useFlat ? "FLAT_DOLLAR" : "PERCENT";
  const monthlyCents = Math.round(annualCents / 12);

  const expectedMonthly = annualCents / 12;
  const monthlyDrift = Math.abs(monthlyCents - expectedMonthly);
  const isValid = monthlyDrift <= 1;
  const validationError = isValid
    ? null
    : `Pension validation error: monthly ($${(monthlyCents / 100).toFixed(2)}) ≠ annual / 12 ($${(expectedMonthly / 100).toFixed(2)})`;

  let sanityWarning: string | null = null;
  if (effectiveYOS < 30) {
    const maxPossibleFlat =
      seatAtRetirement === "CAPTAIN"
        ? rules.pensionFlatDollarCaptainPerYOS * 30
        : rules.pensionFlatDollarFOPerYOS * 30;
    if (annualCents > maxPossibleFlat * 1.5) {
      sanityWarning = `Unusually high pension projected for ${effectiveYOS} YOS. Verify Final Average Earnings.`;
    }
  }

  return {
    annualCents,
    monthlyCents,
    formulaUsed,
    percentFormulaAnnualCents,
    flatDollarFormulaAnnualCents,
    finalAverageEarningsCents,
    effectiveYOS,
    isValid,
    validationError,
    sanityWarning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RETIREMENT ENGINE — v3: CBA-locked, dual-formula pension, validated output
// ─────────────────────────────────────────────────────────────────────────────

export interface YearlyProjection {
  year: number;
  age: number;
  seatType: SeatType;
  payStep: number;
  estimatedAnnualIncomeCents: number;
  isActualEarnings: boolean;
  planBContributionCents: number;
  cumulativePlanBCents: number;
  vebaHoursAccrued: number;
  vebaContributionThisYearCents: number;
  cumulativeVebaCents: number;
  contractVersion: string;
  contractLabel: string;
}

export interface RetirementForecast {
  yearlyProjections: YearlyProjection[];

  // Plan A — Defined Benefit Pension
  pension: PensionCalculationResult;
  /** @deprecated Use pension.annualCents */
  projectedAnnualPensionCents: number;
  /** @deprecated Use pension.monthlyCents */
  projectedMonthlyPensionCents: number;

  // Plan B — Defined Contribution
  projectedPlanBBalanceCents: number;
  planBAnnualWithdrawalCents: number;

  // VEBA / HRA — NOT cash, medical reimbursement only
  projectedVebaBalanceCents: number;
  hraAnnualPostRetireCents: number;
  hraStopsAtMedicare: boolean;
  medicareEligibilityAge: number;

  // Sick leave — one-time payout only, never in annual income
  sickLeaveEstimatedPayoutCents: number;

  // Total annual income (Plan B SWR + Pension only)
  projectedTotalAnnualRetirementIncomeCents: number;
  outsideAssetsAnnualCents: number;

  // Timeline
  yearsRemaining: number;
  yearsOfService: number;
  retirementYear: number;
  historicalPlanBCents: number;
  retirementAge: number;
  expectedUpgradeYear: number;
  earningsBasis: EarningsBasis;
  contractAtRetirement: ContractRetirementRules;

  // Confidence
  confidenceLevel: "HIGH" | "MEDIUM" | "ESTIMATE";
  actualEarningsYears: number;
  projectedEarningsYears: number;

  // Validation
  hasValidationErrors: boolean;
  validationErrors: string[];
  sanityWarnings: string[];

  // Audit
  rulesetVersion: string;
  finalAverageEarningsCents: number;
  seatAtRetirement: SeatType;
}

export type EarningsLedgerEntry = {
  year: number;
  annualEarningsCents: number;
};

export function computeRetirementForecast(
  profile: RetirementProfile,
  contractRules: ContractRetirementRules[],
  overrideRetirementAge?: number,
  earningsLedger?: EarningsLedgerEntry[]
): RetirementForecast {
  const today = new Date();
  const currentYear = today.getFullYear();
  const retirementAge = overrideRetirementAge ?? profile.retirementAge;
  const growthRate = (profile.planBGrowthRatePct ?? 5) / 100;
  const swr = (profile.safeWithdrawalRatePct ?? 4) / 100;
  const stopHRAAtMedicare = profile.stopHRAAtMedicare ?? true;
  const medicareAge = profile.medicareEligibilityAge ?? MEDICARE_ELIGIBILITY_AGE_DEFAULT;
  const sickLeaveHours = profile.sickLeaveHoursBalance ?? 0;

  if (!profile.dob || !profile.doh) {
    return emptyForecast(retirementAge);
  }

  const dob = new Date(profile.dob);
  const doh = new Date(profile.doh);
  const currentAgeFloat = (today.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const retirementYear = Math.floor(dob.getFullYear() + retirementAge);
  const yearsOfService = Math.max(0, retirementYear - doh.getFullYear());
  const yearsRemaining = Math.max(0, retirementYear - currentYear);
  const dohYear = doh.getFullYear();

  const upgradeYear =
    profile.expectedUpgradeYear ?? (dohYear + DEFAULT_UPGRADE_YEARS_FROM_DOH);

  const seatAtRetirement: SeatType =
    profile.activeScenario === "FO_ONLY" || upgradeYear >= retirementYear
      ? "FO"
      : "CAPTAIN";

  let historicalPlanBCents = 0;
  if (profile.priorEarnings && !profile.priorEarningsSkipped) {
    const pe = profile.priorEarnings;
    const rules = getContractRulesForYear(currentYear - pe.priorYearsService);
    if (pe.estimatedPlanBContributionsCents != null && pe.estimatedPlanBContributionsCents > 0) {
      const yearsGrowth = Math.min(pe.priorYearsService, 30);
      historicalPlanBCents = pe.estimatedPlanBContributionsCents * Math.pow(1 + growthRate, yearsGrowth);
    } else {
      const annualContribCents = Math.round(pe.averageAnnualIncomeCents * rules.planBEmployerRate);
      const n = Math.min(pe.priorYearsService, 30);
      if (growthRate === 0) {
        historicalPlanBCents = annualContribCents * n;
      } else {
        historicalPlanBCents = annualContribCents * (Math.pow(1 + growthRate, n) - 1) / growthRate;
      }
    }
  }

  const yearlyProjections: YearlyProjection[] = [];
  let cumulativePlanBCents = historicalPlanBCents;
  let cumulativeVebaCents = 0;
  let actualEarningsYears = 0;
  let projectedEarningsYears = 0;
  const earningsForFAEWindow: number[] = [];

  for (let year = currentYear; year <= retirementYear; year++) {
    const age = currentAgeFloat + (year - currentYear);
    const contract = getContractRulesForYear(year);
    const seatType: SeatType = (profile.activeScenario === "FO_ONLY" || year < upgradeYear)
      ? "FO"
      : "CAPTAIN";
    const payStep = getPayStepYear(year, profile.doh);

    const ledgerEntry = earningsLedger?.find((e) => e.year === year);
    let annualComp: number;
    let isActual: boolean;

    if (ledgerEntry && ledgerEntry.annualEarningsCents > 0) {
      annualComp = ledgerEntry.annualEarningsCents;
      isActual = true;
      actualEarningsYears++;
    } else {
      annualComp = getPayTableAnnualComp(year, profile.doh, seatType, profile.earningsBasis);
      isActual = false;
      projectedEarningsYears++;
    }

    const yearsToRetirement = retirementYear - year;
    if (yearsToRetirement < 5) {
      earningsForFAEWindow.push(annualComp);
    }

    const planBContrib = Math.round(annualComp * contract.planBEmployerRate);
    cumulativePlanBCents = cumulativePlanBCents * (1 + growthRate) + planBContrib;

    const hourlyRate = getPayTableHourlyRate(year, profile.doh, seatType);
    const estimatedHours = hourlyRate > 0 ? Math.round(annualComp / hourlyRate) : 975;
    const vebaThisYear = contract.vebaEnabled ? estimatedHours * contract.vebaPerHourCents : 0;
    cumulativeVebaCents += vebaThisYear;

    yearlyProjections.push({
      year,
      age,
      seatType,
      payStep,
      estimatedAnnualIncomeCents: annualComp,
      isActualEarnings: isActual,
      planBContributionCents: planBContrib,
      cumulativePlanBCents: Math.round(cumulativePlanBCents),
      vebaHoursAccrued: estimatedHours,
      vebaContributionThisYearCents: Math.round(vebaThisYear),
      cumulativeVebaCents: Math.round(cumulativeVebaCents),
      contractVersion: contract.contractVersion,
      contractLabel: contract.label,
    });
  }

  const faeWindow = earningsForFAEWindow.length > 0 ? earningsForFAEWindow : [
    getPayTableAnnualComp(retirementYear, profile.doh, seatAtRetirement, profile.earningsBasis)
  ];
  const finalAverageEarningsCents = Math.round(
    faeWindow.reduce((a, b) => a + b, 0) / faeWindow.length
  );

  const finalRules = getContractRulesForYear(retirementYear);
  const effectiveYOS = Math.max(0, Math.min(yearsOfService, finalRules.pensionMaxYOS));
  const retirementDateStr = `${retirementYear}-01-01`;

  const pension = computePlanAPension(
    finalAverageEarningsCents,
    effectiveYOS,
    seatAtRetirement,
    retirementDateStr,
    finalRules
  );

  const finalPlanBBalance = Math.round(cumulativePlanBCents);
  const planBWithdrawalCents = Math.round(finalPlanBBalance * swr);

  const hraBenefitCents = (stopHRAAtMedicare && retirementAge >= medicareAge)
    ? 0
    : finalRules.hraAnnualPostRetireCents;

  const sickLeavePayoutCents = sickLeaveHours > 0
    ? Math.round(sickLeaveHours * getPayTableHourlyRate(retirementYear, profile.doh, seatAtRetirement))
    : 0;

  const outsideAssetsAnnualCents = profile.includeOutsideAssets
    ? Math.round(profile.outsideRetirementAssetsCents * swr)
    : 0;

  const projectedTotalAnnualRetirementIncomeCents =
    planBWithdrawalCents + pension.annualCents + outsideAssetsAnnualCents;

  let confidenceLevel: "HIGH" | "MEDIUM" | "ESTIMATE";
  if (actualEarningsYears >= 3) {
    confidenceLevel = "HIGH";
  } else if (actualEarningsYears >= 1) {
    confidenceLevel = "MEDIUM";
  } else {
    confidenceLevel = "ESTIMATE";
  }

  const validationErrors: string[] = [];
  const sanityWarnings: string[] = [];

  if (pension.validationError) {
    validationErrors.push(pension.validationError);
  }
  if (pension.sanityWarning) {
    sanityWarnings.push(pension.sanityWarning);
  }
  if (effectiveYOS < 30) {
    sanityWarnings.push(`Pension projected with ${effectiveYOS} YOS (max 30). Income projection may be incomplete.`);
  }

  return {
    yearlyProjections,
    pension,
    projectedAnnualPensionCents: pension.annualCents,
    projectedMonthlyPensionCents: pension.monthlyCents,
    projectedPlanBBalanceCents: finalPlanBBalance,
    planBAnnualWithdrawalCents: planBWithdrawalCents,
    projectedVebaBalanceCents: Math.round(cumulativeVebaCents),
    hraAnnualPostRetireCents: hraBenefitCents,
    hraStopsAtMedicare: stopHRAAtMedicare,
    medicareEligibilityAge: medicareAge,
    sickLeaveEstimatedPayoutCents: sickLeavePayoutCents,
    projectedTotalAnnualRetirementIncomeCents: Math.round(projectedTotalAnnualRetirementIncomeCents),
    outsideAssetsAnnualCents,
    yearsRemaining,
    yearsOfService: effectiveYOS,
    retirementYear,
    historicalPlanBCents: Math.round(historicalPlanBCents),
    retirementAge,
    expectedUpgradeYear: upgradeYear,
    earningsBasis: profile.earningsBasis,
    contractAtRetirement: finalRules,
    confidenceLevel,
    actualEarningsYears,
    projectedEarningsYears,
    hasValidationErrors: validationErrors.length > 0,
    validationErrors,
    sanityWarnings,
    rulesetVersion: finalRules.rulesetVersion,
    finalAverageEarningsCents,
    seatAtRetirement,
  };
}

export function computeMultiAgeForecast(
  profile: RetirementProfile,
  contractRules: ContractRetirementRules[],
  ages: number[] = [60, 62, 65],
  earningsLedger?: EarningsLedgerEntry[]
): Record<number, RetirementForecast> {
  const result: Record<number, RetirementForecast> = {};
  for (const age of ages) {
    result[age] = computeRetirementForecast(profile, contractRules, age, earningsLedger);
  }
  return result;
}

export function emptyForecast(retirementAge = 65): RetirementForecast {
  const fallbackRules = UPS_CONTRACT_RULES[0];
  const emptyPension: PensionCalculationResult = {
    annualCents: 0,
    monthlyCents: 0,
    formulaUsed: "FLAT_DOLLAR",
    percentFormulaAnnualCents: 0,
    flatDollarFormulaAnnualCents: 0,
    finalAverageEarningsCents: 0,
    effectiveYOS: 0,
    isValid: true,
    validationError: null,
    sanityWarning: null,
  };
  return {
    yearlyProjections: [],
    pension: emptyPension,
    projectedPlanBBalanceCents: 0,
    planBAnnualWithdrawalCents: 0,
    projectedAnnualPensionCents: 0,
    projectedMonthlyPensionCents: 0,
    projectedVebaBalanceCents: 0,
    hraAnnualPostRetireCents: fallbackRules.hraAnnualPostRetireCents,
    hraStopsAtMedicare: true,
    medicareEligibilityAge: MEDICARE_ELIGIBILITY_AGE_DEFAULT,
    sickLeaveEstimatedPayoutCents: 0,
    projectedTotalAnnualRetirementIncomeCents: 0,
    outsideAssetsAnnualCents: 0,
    yearsRemaining: 0,
    yearsOfService: 0,
    retirementYear: new Date().getFullYear(),
    historicalPlanBCents: 0,
    retirementAge,
    expectedUpgradeYear: new Date().getFullYear() + DEFAULT_UPGRADE_YEARS_FROM_DOH,
    earningsBasis: "GUAR",
    contractAtRetirement: fallbackRules,
    confidenceLevel: "ESTIMATE",
    actualEarningsYears: 0,
    projectedEarningsYears: 0,
    hasValidationErrors: false,
    validationErrors: [],
    sanityWarnings: [],
    rulesetVersion: fallbackRules.rulesetVersion,
    finalAverageEarningsCents: 0,
    seatAtRetirement: "FO",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE SCENARIO — "No upgrade" vs "Upgrade at year X"
// ─────────────────────────────────────────────────────────────────────────────

export type ScenarioLabel = "Early Upgrade" | "Mid-Career Upgrade" | "Late Upgrade" | "Current Path";

export interface CareerScenario {
  label: ScenarioLabel;
  upgradeYear: number;
  foAnnualCents: number;
  captainAnnualCents: number;
  forecast: RetirementForecast;
}

export function buildScenario(
  baseProfile: RetirementProfile,
  label: ScenarioLabel,
  upgradeYear: number,
  earningsLedger?: EarningsLedgerEntry[]
): CareerScenario {
  const scenarioProfile: RetirementProfile = {
    ...baseProfile,
    expectedUpgradeYear: upgradeYear,
  };

  const doh = baseProfile.doh ?? new Date().toISOString().split("T")[0];
  const foAnnualCents = getPayTableAnnualComp(
    new Date().getFullYear(), doh, "FO", baseProfile.earningsBasis
  );
  const captainAnnualCents = getPayTableAnnualComp(
    upgradeYear, doh, "CAPTAIN", baseProfile.earningsBasis
  );

  const forecast = computeRetirementForecast(scenarioProfile, UPS_CONTRACT_RULES, undefined, earningsLedger);
  return { label, upgradeYear, foAnnualCents, captainAnnualCents, forecast };
}

// ─────────────────────────────────────────────────────────────────────────────
// DUAL-SCENARIO — FO-only vs Upgrade (for chart overlay + comparison row)
// ─────────────────────────────────────────────────────────────────────────────

export interface DualScenarioForecast {
  foOnly: RetirementForecast;
  upgrade: RetirementForecast;
  upgradeAdvantageCents: number;
  upgradeAfterRetirement: boolean;
}

export function computeDualScenarioForecast(
  profile: RetirementProfile,
  overrideRetirementAge?: number,
  earningsLedger?: EarningsLedgerEntry[]
): DualScenarioForecast {
  const foProfile: RetirementProfile = {
    ...profile,
    activeScenario: "FO_ONLY",
    expectedUpgradeYear: 9999,
  };
  const upgradeProfile: RetirementProfile = {
    ...profile,
    activeScenario: "UPGRADE_TO_CPT",
  };

  const foOnly = computeRetirementForecast(foProfile, UPS_CONTRACT_RULES, overrideRetirementAge, earningsLedger);
  const upgrade = computeRetirementForecast(upgradeProfile, UPS_CONTRACT_RULES, overrideRetirementAge, earningsLedger);

  const upgradeAdvantageCents =
    upgrade.projectedTotalAnnualRetirementIncomeCents - foOnly.projectedTotalAnnualRetirementIncomeCents;

  const retirementYear = overrideRetirementAge && profile.dob
    ? new Date(profile.dob).getFullYear() + overrideRetirementAge
    : upgrade.retirementYear;
  const resolvedUpgradeYear = profile.expectedUpgradeYear
    ?? (profile.doh ? new Date(profile.doh).getFullYear() + DEFAULT_UPGRADE_YEARS_FROM_DOH : 9999);
  const upgradeAfterRetirement = resolvedUpgradeYear >= retirementYear;

  return { foOnly, upgrade, upgradeAdvantageCents, upgradeAfterRetirement };
}

export const DEFAULT_RETIREMENT_PROFILE: RetirementProfile = {
  doh: null,
  dob: null,
  retirementAge: 65,
  earningsBasis: "GUAR",
  expectedUpgradeYear: null,
  activeScenario: "UPGRADE_TO_CPT",
  priorEarnings: null,
  outsideRetirementAssetsCents: 0,
  includeOutsideAssets: false,
  priorEarningsSkipped: false,
  planBGrowthRatePct: 5,
  safeWithdrawalRatePct: 4,
  stopHRAAtMedicare: true,
  medicareEligibilityAge: MEDICARE_ELIGIBILITY_AGE_DEFAULT,
  sickLeaveHoursBalance: null,
  retirement401kCents: 0,
  retirementIRACents: 0,
  retirementBrokerageCents: 0,
  include401kInRetirementIncome: false,
  careerPriority: "balanced",
};
