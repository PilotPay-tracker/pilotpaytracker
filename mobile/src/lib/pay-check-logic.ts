/**
 * UPS Pay Check Logic
 *
 * Implements the Small Check (Advance) vs Big Check (Settlement) pay structure.
 *
 * UPS pilots receive two distinct check types each month:
 * 1. SMALL CHECK (Advance Pay) - First half of monthly guarantee only
 * 2. BIG CHECK (Settlement Pay) - Remaining guarantee + credit above guarantee + ALL premiums
 *
 * This module is airline-aware and can be extended for other airlines.
 */

// ============================================
// TYPES
// ============================================

export type CheckType = 'big' | 'small';
export type CheckConfirmation = 'expected' | 'confirmed';

export interface AirlinePayConfig {
  airlineCode: string;
  airlineName: string;
  monthlyGuaranteeMinutes: number; // Total monthly guarantee (e.g., 75 hrs = 4500 mins)
  advancePayPercent: number; // % of guarantee paid on small check (typically 50%)
  premiumsOnBigCheckOnly: boolean; // Whether premiums are only paid on settlement
  perDiemOnBigCheckOnly: boolean; // Whether per diem is only paid on settlement
  adjustmentsOnBigCheckOnly: boolean; // Whether adjustments are only paid on settlement
}

export interface CheckTypeInfo {
  checkType: CheckType;
  confirmation: CheckConfirmation;
  label: string;
  shortLabel: string;
  description: string;
  tooltipTitle: string;
  tooltipContent: string;
}

export interface PayBreakdown {
  // Guarantee components
  guaranteeHours: number;
  guaranteePayCents: number;

  // Additional credit above guarantee
  additionalCreditHours: number;
  additionalCreditPayCents: number;

  // Premium pay (JA, Junior Man, overrides, etc.)
  premiumPayCents: number;

  // Per diem
  taxablePerDiemCents: number;
  nonTaxablePerDiemCents: number;

  // Adjustments
  adjustmentsCents: number;

  // Totals
  grossPayCents: number;
  taxableGrossCents: number;
}

// ============================================
// UPS CONFIGURATION (Default Template)
// ============================================

export const UPS_PAY_CONFIG: AirlinePayConfig = {
  airlineCode: 'UPS',
  airlineName: 'UPS Airlines',
  monthlyGuaranteeMinutes: 75 * 60, // 75 hours = 4500 minutes
  advancePayPercent: 50, // Small check = 50% of guarantee = 37.5 hours
  premiumsOnBigCheckOnly: true, // Hard rule: premiums ONLY on big check
  perDiemOnBigCheckOnly: true, // Per diem paid on settlement
  adjustmentsOnBigCheckOnly: true, // Adjustments paid on settlement
};

// ============================================
// AIRLINE CONFIGURATION REGISTRY (Phase 5)
// ============================================

/**
 * Registry of airline pay configurations
 * UPS is the initial template - other airlines can be added here
 */
export const AIRLINE_CONFIGS: Record<string, AirlinePayConfig> = {
  UPS: UPS_PAY_CONFIG,
  // Future airlines can be added here:
  // FEDEX: { ... },
  // ATLAS: { ... },
  // ABX: { ... },
};

/**
 * Get airline configuration by code
 * Falls back to UPS if airline not found
 */
export function getAirlineConfig(airlineCode?: string | null): AirlinePayConfig {
  if (!airlineCode) return UPS_PAY_CONFIG;
  return AIRLINE_CONFIGS[airlineCode.toUpperCase()] ?? UPS_PAY_CONFIG;
}

/**
 * Get list of supported airlines
 */
export function getSupportedAirlines(): Array<{ code: string; name: string }> {
  return Object.values(AIRLINE_CONFIGS).map((config) => ({
    code: config.airlineCode,
    name: config.airlineName,
  }));
}

/**
 * Check if an airline is supported
 */
export function isAirlineSupported(airlineCode: string): boolean {
  return airlineCode.toUpperCase() in AIRLINE_CONFIGS;
}

// ============================================
// CHECK TYPE DETERMINATION
// ============================================

/**
 * Get check type info based on pay date position within month
 *
 * Logic (corrected for UPS):
 * - Sort pay dates in a month ascending
 * - 1st pay date (earlier, ~1st of month) = SMALL (Advance)
 * - 2nd pay date (later, ~15th of month) = BIG (Settlement)
 * - 3rd pay date (if exists) = BIG (Settlement)
 */
export function getCheckTypeFromDatePosition(
  payDateISO: string,
  allPayDatesInMonth: string[]
): CheckType {
  // Sort pay dates ascending
  const sorted = [...allPayDatesInMonth].sort((a, b) => a.localeCompare(b));
  const position = sorted.indexOf(payDateISO);

  // 1st (index 0) = SMALL (Advance), 2nd (index 1) = BIG (Settlement)
  if (position === 0) return 'small';
  if (position === 1) return 'big';
  if (position === 2) return 'big';

  // Default to big for any additional pay dates
  return 'big';
}

/**
 * Determine check type from content.
 *
 * The date-based check type is always the authority — it determines whether this
 * period is a Small Check (Advance) or Big Check (Settlement).
 *
 * Content is used only to *confirm* the expected type:
 * - If expected = big AND content has premiums/over-guarantee → confirmed big
 * - If expected = big AND no such content yet → expected big (still big, just not confirmed)
 * - If expected = small → always small, regardless of trip content
 *   (the trip credit belongs to the NEXT settlement check, not this advance)
 */
export function getCheckTypeFromContent(
  premiumPayCents: number,
  creditAboveGuaranteeMinutes: number,
  expectedCheckType: CheckType
): { checkType: CheckType; confirmation: CheckConfirmation } {
  // Small check is always small — trip credit doesn't change that
  if (expectedCheckType === 'small') {
    return { checkType: 'small', confirmation: 'expected' };
  }

  // Big check: confirm with content if available
  if (premiumPayCents > 0 || creditAboveGuaranteeMinutes > 0) {
    return { checkType: 'big', confirmation: 'confirmed' };
  }

  return { checkType: 'big', confirmation: 'expected' };
}

// ============================================
// CHECK TYPE INFO
// ============================================

export const CHECK_TYPE_INFO: Record<CheckType, Omit<CheckTypeInfo, 'confirmation'>> = {
  small: {
    checkType: 'small',
    label: 'Advance Pay (Small Check)',
    shortLabel: 'Advance Pay',
    description: 'Advance payment of 37.5 hours guarantee only. No premiums, per diem, or adjustments.',
    tooltipTitle: 'Why is this check smaller?',
    tooltipContent: 'The Advance Pay (Small Check) only includes half of your monthly guarantee (37.5 hours). Premium pay, per diem, additional credit hours, and adjustments are all paid on the Settlement Pay (Big Check) after the month is reconciled.',
  },
  big: {
    checkType: 'big',
    label: 'Settlement Pay (Big Check)',
    shortLabel: 'Settlement Pay',
    description: 'Settlement pay including remaining guarantee, credit above guarantee, ALL premiums, per diem, and adjustments.',
    tooltipTitle: 'Why are premiums on this check?',
    tooltipContent: 'The Settlement Pay (Big Check) reconciles your actual flying for the month. It includes: the remaining 37.5 hours of guarantee, any credit hours above the 75-hour guarantee, ALL premium pay (JA, Junior Man, overrides), per diem, and any adjustments. This is why settlement checks are typically larger.',
  },
};

/**
 * Get full check type info with confirmation status
 */
export function getCheckTypeInfo(
  checkType: CheckType,
  confirmation: CheckConfirmation
): CheckTypeInfo {
  return {
    ...CHECK_TYPE_INFO[checkType],
    confirmation,
  };
}

// ============================================
// PAY CALCULATION HELPERS
// ============================================

/**
 * Calculate monthly credit above guarantee
 *
 * @param monthlyCreditMinutes - Total credit minutes for the month
 * @param config - Airline pay configuration
 * @returns Minutes above the monthly guarantee (can be 0)
 */
export function calculateCreditAboveGuarantee(
  monthlyCreditMinutes: number,
  config: AirlinePayConfig = UPS_PAY_CONFIG
): number {
  return Math.max(0, monthlyCreditMinutes - config.monthlyGuaranteeMinutes);
}

/**
 * Calculate small check (advance) pay breakdown
 *
 * Small check contains ONLY:
 * - Half of monthly guarantee (37.5 hours for UPS)
 * - NO premium pay
 * - NO per diem
 * - NO adjustments
 */
export function calculateSmallCheckBreakdown(
  hourlyRateCents: number,
  config: AirlinePayConfig = UPS_PAY_CONFIG
): PayBreakdown {
  const advanceGuaranteeMinutes = config.monthlyGuaranteeMinutes * (config.advancePayPercent / 100);
  const advanceGuaranteeHours = advanceGuaranteeMinutes / 60;
  const guaranteePayCents = Math.round((advanceGuaranteeMinutes / 60) * hourlyRateCents);

  return {
    guaranteeHours: advanceGuaranteeHours,
    guaranteePayCents,
    additionalCreditHours: 0,
    additionalCreditPayCents: 0,
    premiumPayCents: 0, // Never on small check
    taxablePerDiemCents: 0, // Never on small check
    nonTaxablePerDiemCents: 0, // Never on small check
    adjustmentsCents: 0, // Never on small check
    grossPayCents: guaranteePayCents,
    taxableGrossCents: guaranteePayCents,
  };
}

/**
 * Calculate big check (settlement) pay breakdown
 *
 * Big check contains:
 * - Remaining half of monthly guarantee (37.5 hours for UPS) → taxable
 * - Any credit above monthly guarantee → taxable
 * - 100% of ALL premium pay → taxable
 * - Per diem (NON-taxable - only if non-zero)
 * - Adjustments → taxable
 *
 * Net pay formula:
 *   grossTaxableEarnings = guarantee + overGuarantee + premiumPay + adjustments
 *   grossNonTaxable = perDiem
 *   taxableWages = grossTaxableEarnings + taxableBenefits - preTaxDeductions
 *   netPay = grossTaxableEarnings + grossNonTaxable - preTaxDeductions - taxes - postTaxDeductions
 */
export function calculateBigCheckBreakdown(
  hourlyRateCents: number,
  monthlyCreditMinutes: number,
  premiumPayCents: number,
  taxablePerDiemCents: number,
  nonTaxablePerDiemCents: number,
  adjustmentsCents: number,
  config: AirlinePayConfig = UPS_PAY_CONFIG
): PayBreakdown {
  // Remaining guarantee (50% of monthly guarantee)
  const remainingGuaranteeMinutes = config.monthlyGuaranteeMinutes * (config.advancePayPercent / 100);
  const remainingGuaranteeHours = remainingGuaranteeMinutes / 60;
  const guaranteePayCents = Math.round((remainingGuaranteeMinutes / 60) * hourlyRateCents);

  // Credit above guarantee (Over Guarantee)
  const creditAboveGuaranteeMinutes = calculateCreditAboveGuarantee(monthlyCreditMinutes, config);
  const creditAboveGuaranteeHours = creditAboveGuaranteeMinutes / 60;
  const additionalCreditPayCents = Math.round((creditAboveGuaranteeMinutes / 60) * hourlyRateCents);

  // Taxable gross = guarantee + overGuarantee + premiumPay + adjustments
  // Per diem is NON-taxable - not included in taxable gross
  const taxableGrossCents = guaranteePayCents + additionalCreditPayCents + premiumPayCents + adjustmentsCents;

  // Total gross including non-taxable per diem
  const grossPayCents = taxableGrossCents + nonTaxablePerDiemCents + taxablePerDiemCents;

  return {
    guaranteeHours: remainingGuaranteeHours,
    guaranteePayCents,
    additionalCreditHours: creditAboveGuaranteeHours,
    additionalCreditPayCents,
    premiumPayCents,
    taxablePerDiemCents,
    nonTaxablePerDiemCents,
    adjustmentsCents,
    grossPayCents,
    taxableGrossCents,
  };
}

// ============================================
// TOOLTIP HELPERS
// ============================================

export const TOOLTIPS = {
  smallCheckWhy: {
    title: 'Why is this check smaller?',
    content: 'The Small Check pays only half of your monthly guarantee (37.5 hours at UPS) as an advance. It never includes premium pay, per diem, or adjustments — those all come on the Big Check after the month is reconciled.',
  },
  bigCheckPremiums: {
    title: 'Why are premiums paid here?',
    content: 'All premium pay (JA, Junior Man, overrides, etc.) is paid exclusively on the Big Check (Settlement). This is when your actual monthly flying is reconciled and any credit above the 75-hour guarantee is also paid.',
  },
  additionalCredit: {
    title: 'What is additional credit?',
    content: 'Additional credit is flight time above your 75-hour monthly guarantee. If you fly 85 hours, 10 hours are "above guarantee" and paid on the Big Check in addition to your guarantee settlement.',
  },
  guarantee: {
    title: 'Monthly Guarantee (75 Hours)',
    content: 'UPS pilots are guaranteed 75 credit hours per month. This is split across two checks: 37.5 hours on the Small Check (advance) and 37.5 hours on the Big Check (settlement).',
  },
  perDiem: {
    title: 'Per Diem Payments',
    content: 'Per diem compensates for meals and incidentals while on duty. Non-taxable per diem is excluded from your taxable gross but included in your total earnings.',
  },
  contractGuarantee: {
    title: 'Contract Guarantee & Buffer Pay',
    content: 'Paid Hours are the greater of your Line Credit or the contractual guarantee. Buffer Pay is the difference when your Line Credit falls below guarantee — you are always paid at least the minimum guarantee.\n\nExample: 73.2 hrs credit on a 28-day period pays 75.0 hrs (+1.8 hrs Buffer Pay).',
  },
};

// ============================================
// PAY DATE HELPERS
// ============================================

/**
 * Group pay dates by month and determine check types
 */
export function getPayDatesWithCheckTypes(
  payDates: Array<{ payDate: string; payType: string }>
): Array<{ payDate: string; checkType: CheckType; monthYear: string }> {
  // Group by month
  const byMonth: Record<string, string[]> = {};

  for (const pd of payDates) {
    const date = new Date(pd.payDate + 'T00:00:00');
    const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!byMonth[monthYear]) {
      byMonth[monthYear] = [];
    }
    byMonth[monthYear].push(pd.payDate);
  }

  // Assign check types based on position
  const result: Array<{ payDate: string; checkType: CheckType; monthYear: string }> = [];

  for (const [monthYear, dates] of Object.entries(byMonth)) {
    for (const payDate of dates) {
      result.push({
        payDate,
        checkType: getCheckTypeFromDatePosition(payDate, dates),
        monthYear,
      });
    }
  }

  return result.sort((a, b) => a.payDate.localeCompare(b.payDate));
}

/**
 * Format check type for display
 */
export function formatCheckTypeLabel(checkType: CheckType, confirmation: CheckConfirmation): string {
  const info = CHECK_TYPE_INFO[checkType];
  const confirmationLabel = confirmation === 'confirmed' ? '' : ' (Expected)';
  return `${info.shortLabel}${confirmationLabel}`;
}

// ============================================
// EARNINGS LINE ITEM GENERATORS
// ============================================

export interface EarningsLineItemInput {
  id: string;
  label: string;
  description: string;
  amountCents: number;
  creditMinutes?: number;
  isUserAdded?: boolean;
  trips?: string[];
}

/**
 * Generate earnings line items for Small Check (Advance Pay)
 *
 * Small Check contains ONLY:
 * - Guarantee Settlement (37.5 hrs) - First half of monthly guarantee
 * - NO premium pay
 * - NO per diem
 * - NO additional credit
 * - NO adjustments
 */
export function generateSmallCheckEarnings(
  hourlyRateCents: number,
  config: AirlinePayConfig = UPS_PAY_CONFIG
): EarningsLineItemInput[] {
  const items: EarningsLineItemInput[] = [];

  // 37.5 hours of guarantee (50% of monthly 75-hour guarantee)
  const guaranteeMinutes = config.monthlyGuaranteeMinutes * (config.advancePayPercent / 100);
  const guaranteeHours = guaranteeMinutes / 60;
  const guaranteePayCents = Math.round((guaranteeMinutes / 60) * hourlyRateCents);

  items.push({
    id: 'guarantee-settlement',
    label: `Guarantee Settlement (${guaranteeHours} hrs)`,
    description: `Advance payment of monthly guarantee`,
    amountCents: guaranteePayCents,
    creditMinutes: guaranteeMinutes,
  });

  // Note: Small check has NO premium pay line
  // Note: Small check has NO additional credit line
  // Note: Small check has NO per diem
  // Note: Small check has NO adjustments

  return items;
}

/**
 * Generate earnings line items for Big Check (Settlement Pay)
 *
 * Big Check contains:
 * 1) Guarantee / Advance Next Pay (37.5 hrs) - Remaining half of monthly guarantee
 * 2) Over Guarantee (X hrs) - Only if credit > 75 hours
 * 3) Premium Pay - 100% of all premiums (Junior Assignment 150%, JA, etc.)
 * 4) Per Diem (Non-Taxable) - Only if parsed from trips or per diem data
 * 5) Adjustments - Only if non-zero
 *
 * Taxable/Non-Taxable handling:
 * - Guarantee, Over Guarantee, Premium Pay = taxable earnings
 * - Per Diem = non-taxable (not included in taxableGross)
 * - Adjustments = taxable
 */
export function generateBigCheckEarnings(
  hourlyRateCents: number,
  monthlyCreditMinutes: number,
  premiumPayCents: number,
  perDiemCents: number,
  adjustmentsCents: number,
  tripIds: string[],
  config: AirlinePayConfig = UPS_PAY_CONFIG,
  juniorPayCents: number = 0,
  juniorCreditMinutes: number = 0
): EarningsLineItemInput[] {
  const items: EarningsLineItemInput[] = [];

  // 1) Guarantee / Advance Next Pay (37.5 hrs)
  const guaranteeMinutes = config.monthlyGuaranteeMinutes * (config.advancePayPercent / 100);
  const guaranteeHours = guaranteeMinutes / 60;
  const guaranteePayCents = Math.round((guaranteeMinutes / 60) * hourlyRateCents);

  items.push({
    id: 'guarantee-settlement',
    label: `Guarantee Settlement (${guaranteeHours} hrs)`,
    description: `Advance Next Pay / Guarantee Settlement — ${guaranteeHours} hrs × $${(hourlyRateCents/100).toFixed(2)}/hr`,
    amountCents: guaranteePayCents,
    creditMinutes: guaranteeMinutes,
    trips: tripIds,
  });

  // 2) Over Guarantee (only if credit > monthly guarantee)
  const creditAboveGuaranteeMinutes = calculateCreditAboveGuarantee(monthlyCreditMinutes, config);
  if (creditAboveGuaranteeMinutes > 0) {
    const additionalCreditHours = parseFloat((creditAboveGuaranteeMinutes / 60).toFixed(1));
    const additionalCreditPayCents = Math.round((creditAboveGuaranteeMinutes / 60) * hourlyRateCents);

    items.push({
      id: 'over-guarantee',
      label: `Over Guarantee (${additionalCreditHours} hrs)`,
      description: `Credit above ${config.monthlyGuaranteeMinutes / 60}-hour monthly guarantee`,
      amountCents: additionalCreditPayCents,
      creditMinutes: creditAboveGuaranteeMinutes,
    });
  }

  // 3a) Junior Available Pay — shown separately with hours if present
  if (juniorPayCents > 0) {
    const juniorHours = parseFloat((juniorCreditMinutes / 60).toFixed(1));
    const hoursLabel = juniorHours > 0 ? ` (${juniorHours} hrs)` : '';
    items.push({
      id: 'junior-available',
      label: `Junior Available${hoursLabel}`,
      description: 'Junior Assignment at 150% — 50% premium on top of base pay',
      amountCents: juniorPayCents,
      creditMinutes: juniorCreditMinutes > 0 ? juniorCreditMinutes : undefined,
      isUserAdded: true,
    });
  }

  // 3b) Other Premium Pay (non-JA premiums, only if non-zero)
  if (premiumPayCents > 0) {
    items.push({
      id: 'premium-pay',
      label: 'Premium Pay',
      description: 'Junior Man, overrides, and other premium events',
      amountCents: premiumPayCents,
      isUserAdded: true,
    });
  }

  // 4) Per Diem (Non-Taxable) — only show if there is actual per diem data
  // Do NOT assume per diem if zero (never inflate estimate)
  if (perDiemCents > 0) {
    items.push({
      id: 'per-diem',
      label: 'Per Diem (Non-Taxable)',
      description: 'Non-taxable duty day reimbursement — not included in taxable gross',
      amountCents: perDiemCents,
    });
  }

  // 5) Adjustments — only show if non-zero
  if (adjustmentsCents !== 0) {
    items.push({
      id: 'adjustments',
      label: 'Adjustments',
      description: 'Manual corrections and paystub adjustments',
      amountCents: adjustmentsCents,
    });
  }

  return items;
}

/**
 * Calculate total gross for a check
 */
export function calculateCheckGross(items: EarningsLineItemInput[]): number {
  return items.reduce((acc, item) => acc + item.amountCents, 0);
}

// ============================================
// PAY DATE SCHEDULING (Phase 3)
// ============================================

export interface ScheduledPayDate {
  payDate: string;
  checkType: CheckType;
  monthYear: string;
  isNext: boolean;
  daysUntil: number;
  periodNumber?: number;
}

/**
 * Get all pay dates for a given month with their check types
 *
 * Logic (UPS):
 * - 1st pay date of month (~1st)  → SMALL (Advance)
 * - 2nd pay date of month (~15th) → BIG (Settlement)
 * - 3rd pay date (if exists)      → BIG (Settlement)
 */
export function getMonthPayDatesWithCheckTypes(
  payDates: string[],
  monthYear: string // format: "2026-01"
): Array<{ payDate: string; checkType: CheckType }> {
  // Filter to only dates in the specified month
  const monthDates = payDates.filter((pd) => pd.startsWith(monthYear));

  // Sort ascending
  const sorted = [...monthDates].sort((a, b) => a.localeCompare(b));

  return sorted.map((payDate, index) => ({
    payDate,
    checkType: getCheckTypeFromDatePosition(payDate, monthDates),
  }));
}

/**
 * Get upcoming pay dates with check type expectations
 *
 * Returns the next 2-3 pay dates with their expected check types
 */
export function getUpcomingPayDates(
  allPayDates: Array<{ payDate: string; periodNumber?: number }>,
  todayISO: string,
  limit: number = 3
): ScheduledPayDate[] {
  // Filter to future pay dates
  const futureDates = allPayDates
    .filter((pd) => pd.payDate >= todayISO)
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .slice(0, limit);

  // Group all dates by month to determine check types
  const datesByMonth: Record<string, string[]> = {};
  allPayDates.forEach((pd) => {
    const date = new Date(pd.payDate + 'T00:00:00');
    const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!datesByMonth[monthYear]) {
      datesByMonth[monthYear] = [];
    }
    datesByMonth[monthYear].push(pd.payDate);
  });

  // Map future dates to ScheduledPayDate
  const today = new Date(todayISO + 'T00:00:00');

  return futureDates.map((pd, index) => {
    const payDate = new Date(pd.payDate + 'T00:00:00');
    const monthYear = `${payDate.getFullYear()}-${String(payDate.getMonth() + 1).padStart(2, '0')}`;
    const monthDates = datesByMonth[monthYear] || [];

    const daysUntil = Math.ceil(
      (payDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      payDate: pd.payDate,
      checkType: getCheckTypeFromDatePosition(pd.payDate, monthDates),
      monthYear,
      isNext: index === 0,
      daysUntil,
      periodNumber: pd.periodNumber,
    };
  });
}

/**
 * Determine expected check type for a specific pay date
 */
export function getExpectedCheckTypeForPayDate(
  payDateISO: string,
  allPayDates: string[]
): CheckType {
  // Get the month of this pay date
  const date = new Date(payDateISO + 'T00:00:00');
  const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  // Filter to only dates in the same month
  const monthDates = allPayDates.filter((pd) => {
    const pdDate = new Date(pd + 'T00:00:00');
    const pdMonthYear = `${pdDate.getFullYear()}-${String(pdDate.getMonth() + 1).padStart(2, '0')}`;
    return pdMonthYear === monthYear;
  });

  return getCheckTypeFromDatePosition(payDateISO, monthDates);
}

/**
 * Format pay date for display
 */
export function formatPayDateShort(dateISO: string): string {
  const date = new Date(dateISO + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get a human-readable description of when the next check is
 */
export function getNextCheckDescription(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 7) return `In ${daysUntil} days`;
  if (daysUntil < 14) return 'Next week';
  return `In ${Math.ceil(daysUntil / 7)} weeks`;
}

// ============================================
// CONTRACT GUARANTEE LOGIC
// ============================================

/**
 * Period type drives guarantee hours.
 * 28-day bid period → 75.0 hrs guarantee
 * 35-day bid period → 96.0 hrs guarantee
 */
export type BidPeriodType = '28_DAY' | '35_DAY';

export const GUARANTEE_HOURS_BY_PERIOD: Record<BidPeriodType, number> = {
  '28_DAY': 75.0,
  '35_DAY': 96.0,
};

export interface GuaranteeBreakdown {
  /** Awarded line credit for the bid period (hours) */
  lineCreditHours: number;
  /** Contractual guarantee for the period type (hours) */
  guaranteeHours: number;
  /** Hours actually paid: max(lineCredit, guarantee) */
  paidHours: number;
  /** Buffer pay: extra hours added when lineCredit < guarantee. Always >= 0. */
  bufferPayHours: number;
  /** Whether the pilot is currently on guarantee (credit < guarantee) */
  isOnGuarantee: boolean;
  /** Period type driving the guarantee */
  periodType: BidPeriodType;
}

/**
 * Calculate guarantee breakdown for a bid period.
 *
 * paidHours      = max(lineCredit, guaranteeHours)
 * bufferPayHours = max(guaranteeHours - lineCredit, 0)
 */
export function calculateGuaranteeBreakdown(
  lineCreditHours: number,
  periodType: BidPeriodType = '28_DAY'
): GuaranteeBreakdown {
  const guaranteeHours = GUARANTEE_HOURS_BY_PERIOD[periodType];
  const paidHours = Math.max(lineCreditHours, guaranteeHours);
  const bufferPayHours = Math.max(guaranteeHours - lineCreditHours, 0);

  return {
    lineCreditHours,
    guaranteeHours,
    paidHours,
    bufferPayHours,
    isOnGuarantee: lineCreditHours < guaranteeHours,
    periodType,
  };
}

/**
 * Resolve bid period type from contract profile fields.
 * Accepts "28_DAY", "28-DAY", "28" variants for both types.
 */
export function resolveBidPeriodType(raw?: string | null): BidPeriodType {
  if (!raw) return '28_DAY';
  const upper = raw.toUpperCase().replace(/-/g, '_').replace(/\s/g, '_');
  if (upper.includes('35')) return '35_DAY';
  return '28_DAY';
}

// ============================================
// CHECK-SPECIFIC GROSS CALCULATION (Phase 6)
// ============================================

/**
 * Calculate gross pay for a specific check type
 *
 * Small Check (Advance):
 * - Only guarantee hours (37.5 hrs)
 * - NO premium, NO per diem, NO adjustments
 *
 * Big Check (Settlement):
 * - Remaining guarantee hours (37.5 hrs)
 * - Additional credit above guarantee
 * - ALL premium pay
 * - Per diem (taxable portion for gross)
 * - Adjustments
 */
export function calculateCheckGrossForType(
  checkType: CheckType,
  hourlyRateCents: number,
  monthlyCreditMinutes: number,
  premiumPayCents: number,
  taxablePerDiemCents: number,
  adjustmentsCents: number,
  config: AirlinePayConfig = UPS_PAY_CONFIG
): {
  grossPayCents: number;
  taxableGrossCents: number;
  guaranteeHours: number;
  additionalCreditHours: number;
} {
  // Guarantee portion (37.5 hrs = 50% of 75 hrs)
  const guaranteeMinutes = config.monthlyGuaranteeMinutes * (config.advancePayPercent / 100);
  const guaranteeHours = guaranteeMinutes / 60;
  const guaranteePayCents = Math.round((guaranteeMinutes / 60) * hourlyRateCents);

  if (checkType === 'small') {
    // Small check = ONLY guarantee, nothing else
    return {
      grossPayCents: guaranteePayCents,
      taxableGrossCents: guaranteePayCents,
      guaranteeHours,
      additionalCreditHours: 0,
    };
  }

  // Big check = guarantee + additional credit + premium + per diem + adjustments
  const creditAboveGuaranteeMinutes = calculateCreditAboveGuarantee(monthlyCreditMinutes, config);
  const additionalCreditHours = creditAboveGuaranteeMinutes / 60;
  const additionalCreditPayCents = Math.round((creditAboveGuaranteeMinutes / 60) * hourlyRateCents);

  const grossPayCents = guaranteePayCents + additionalCreditPayCents + premiumPayCents +
                        taxablePerDiemCents + adjustmentsCents;

  // Taxable gross is the same for big check (per diem included)
  const taxableGrossCents = grossPayCents;

  return {
    grossPayCents,
    taxableGrossCents,
    guaranteeHours,
    additionalCreditHours,
  };
}

// ============================================
// PAYCHECK TYPE CLASSIFICATION (Advance / Settlement / Unknown)
// ============================================

/**
 * High-level paycheck classification for user-facing display.
 *
 * Distinct from the internal CheckType ('big'/'small') which drives earnings math.
 * This layer adds explicit ADVANCE / SETTLEMENT / UNKNOWN labeling with source tracking.
 */
export type PaycheckType = 'ADVANCE' | 'SETTLEMENT' | 'UNKNOWN';

export type PaycheckTypeSource =
  | 'PAYSTUB_LABEL'      // Parsed directly from uploaded paystub text
  | 'CALENDAR_INFERENCE' // Inferred from pay date position within the month
  | 'EARNINGS_INFERENCE' // Inferred from earnings line item content
  | 'FALLBACK';          // Could not determine with confidence

export interface PaycheckClassification {
  paycheckType: PaycheckType;
  confidence: 'high' | 'medium' | 'low';
  source: PaycheckTypeSource;
  reason: string;
}

/**
 * Paystub label keywords that identify check type from parsed text.
 *
 * Priority 1 — Highest confidence source of truth.
 */
const ADVANCE_PAYSTUB_KEYWORDS = [
  'advance next pay',
  'advance nextpay',
  'advance pay',
];

const SETTLEMENT_PAYSTUB_KEYWORDS = [
  'guarantee settlement',
  'settlement',
  'final settlement',
];

/**
 * Scan raw paystub text (or normalized earnings label strings) for known
 * advance / settlement keywords.  Returns null if no keyword matches.
 */
function scanLabelsForCheckType(
  labels: string[]
): { paycheckType: PaycheckType; keyword: string } | null {
  const normalised = labels.map((l) => l.toLowerCase().trim());

  for (const label of normalised) {
    for (const kw of ADVANCE_PAYSTUB_KEYWORDS) {
      if (label.includes(kw)) {
        return { paycheckType: 'ADVANCE', keyword: kw };
      }
    }
  }

  // Settlement keywords are checked only when no advance keyword is found.
  // We intentionally do NOT match "guarantee settlement" for advance because
  // both check types use the label "Guarantee Settlement" in our generated items —
  // only explicit "Settlement" on the big check implies a settlement check.
  for (const label of normalised) {
    for (const kw of SETTLEMENT_PAYSTUB_KEYWORDS) {
      if (label.includes(kw)) {
        return { paycheckType: 'SETTLEMENT', keyword: kw };
      }
    }
  }

  return null;
}

/**
 * Classify a paycheck as ADVANCE, SETTLEMENT, or UNKNOWN.
 *
 * Source priority (highest → lowest):
 *   1. Parsed paystub labels
 *   2. Pay calendar position (CheckType from date scheduling)
 *   3. Earnings structure / content hints
 *   4. Fallback → UNKNOWN
 *
 * @param earningsLabels   Array of earnings line item labels (from generated items or OCR)
 * @param calendarCheckType  Expected CheckType from pay-date scheduling ('big'/'small')
 * @param hasRealData      Whether we have real trip / earnings data (not demo)
 * @param premiumPayCents  Total premium pay cents for the period
 * @param creditAboveGuaranteeMinutes  Credit minutes above monthly guarantee
 */
export function classifyPaycheckType(
  earningsLabels: string[],
  calendarCheckType: CheckType | null,
  hasRealData: boolean,
  premiumPayCents: number = 0,
  creditAboveGuaranteeMinutes: number = 0
): PaycheckClassification {
  // ─── Priority 1: Paystub label scan ─────────────────────────────────────
  if (earningsLabels.length > 0) {
    const labelMatch = scanLabelsForCheckType(earningsLabels);
    if (labelMatch) {
      return {
        paycheckType: labelMatch.paycheckType,
        confidence: 'high',
        source: 'PAYSTUB_LABEL',
        reason: `Parsed paystub contains "${labelMatch.keyword}"`,
      };
    }
  }

  // ─── Priority 2: Calendar inference ────────────────────────────────────
  if (calendarCheckType !== null) {
    if (calendarCheckType === 'small') {
      return {
        paycheckType: 'ADVANCE',
        confidence: 'medium',
        source: 'CALENDAR_INFERENCE',
        reason: 'Pay date falls on the advance (first) check of the month',
      };
    }
    if (calendarCheckType === 'big') {
      return {
        paycheckType: 'SETTLEMENT',
        confidence: 'medium',
        source: 'CALENDAR_INFERENCE',
        reason: 'Pay date falls on the settlement (second) check of the month',
      };
    }
  }

  // ─── Priority 3: Earnings content hints ────────────────────────────────
  if (hasRealData) {
    if (premiumPayCents > 0 || creditAboveGuaranteeMinutes > 0) {
      return {
        paycheckType: 'SETTLEMENT',
        confidence: 'low',
        source: 'EARNINGS_INFERENCE',
        reason: 'Earnings include premium pay or credit above guarantee, consistent with settlement',
      };
    }

    // Only guarantee — more consistent with an advance, but low confidence
    if (premiumPayCents === 0 && creditAboveGuaranteeMinutes === 0) {
      return {
        paycheckType: 'ADVANCE',
        confidence: 'low',
        source: 'EARNINGS_INFERENCE',
        reason: 'Earnings contain only guarantee pay with no premiums — consistent with advance',
      };
    }
  }

  // ─── Priority 4: Fallback ───────────────────────────────────────────────
  return {
    paycheckType: 'UNKNOWN',
    confidence: 'low',
    source: 'FALLBACK',
    reason: 'Insufficient data to determine check type',
  };
}

/**
 * Get user-facing display info for a PaycheckType.
 */
export const PAYCHECK_TYPE_DISPLAY: Record<
  PaycheckType,
  {
    title: string;
    subtitle: string;
    description: string;
  }
> = {
  ADVANCE: {
    title: 'Advance Check',
    subtitle: 'Partial paycheck paid before final settlement.',
    description: 'This check represents your advance payment — half of your monthly guarantee paid early. Premium pay, additional credit, and per diem will appear on your upcoming Settlement Check.',
  },
  SETTLEMENT: {
    title: 'Settlement Check',
    subtitle: 'Finalized paycheck reflecting completed pay period earnings and adjustments.',
    description: 'This check reconciles your actual flying for the month — including remaining guarantee, credit above guarantee, all premium pay, and any adjustments.',
  },
  UNKNOWN: {
    title: 'Paycheck Summary',
    subtitle: 'Paycheck type could not be confirmed from available data.',
    description: 'We could not determine whether this is an advance or settlement check. The figures below are estimated based on your trips and saved settings.',
  },
};

/**
 * Estimate net pay range for a check type
 *
 * Returns a range because exact deductions may vary
 */
export function estimateNetPayRange(
  grossPayCents: number,
  estimatedTaxRate: number = 0.27 // ~27% combined taxes
): {
  lowEstimateCents: number;
  highEstimateCents: number;
  midpointCents: number;
} {
  // Tax rate can vary by ~5% based on brackets, deductions
  const lowTaxRate = Math.max(0, estimatedTaxRate - 0.03);
  const highTaxRate = estimatedTaxRate + 0.03;

  const lowEstimate = Math.round(grossPayCents * (1 - highTaxRate));
  const highEstimate = Math.round(grossPayCents * (1 - lowTaxRate));
  const midpoint = Math.round((lowEstimate + highEstimate) / 2);

  return {
    lowEstimateCents: lowEstimate,
    highEstimateCents: highEstimate,
    midpointCents: midpoint,
  };
}
