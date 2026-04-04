/**
 * UPS Premium Pay Codes and Constants
 * Based on UPS Airline Pilots Contract
 */

// Minimum daily credit guarantee (6:00 hours = 360 minutes)
export const MIN_DAILY_CREDIT_MINUTES = 360;

// Default hourly rate in cents ($325.00)
export const DEFAULT_HOURLY_RATE_CENTS = 32500;

// Per Diem rates (cents per hour of TAFB)
// Domestic (CONUS)
export const PER_DIEM_DOMESTIC_CENTS_PER_HOUR = 350; // $3.50/hr
// International regions (OCONUS)
export const PER_DIEM_INTERNATIONAL_CENTS_PER_HOUR = 420; // $4.20/hr
export const PER_DIEM_ASIA_CENTS_PER_HOUR = 390; // $3.90/hr
export const PER_DIEM_EUROPE_CENTS_PER_HOUR = 385; // $3.85/hr

// 30-in-7 limit (30 hours = 1800 minutes)
export const THIRTY_IN_SEVEN_LIMIT_MINUTES = 1800;

// 30-in-7 warning threshold (27 hours = 1620 minutes)
export const THIRTY_IN_SEVEN_WARNING_MINUTES = 1620;

/**
 * Premium Pay Code Types
 */
export type PremiumCodeType =
  | 'ADD_HOURS'    // Adds fixed hours to credit
  | 'MULTIPLIER'   // Multiplies credit by factor
  | 'INFO_ONLY';   // No pay adjustment (tracking only)

/**
 * Premium Pay Code Configuration
 */
export interface PremiumCodeConfig {
  code: string;
  name: string;
  type: PremiumCodeType;
  value: number; // Hours to add, or multiplier factor
  description: string;
}

/**
 * UPS Premium Pay Codes
 * AP series: Airport reserve premium (+2:00)
 * SVT/LRP/GT1/PRM: Various add-hour premiums
 * LP1/LP2/LPT/RJA: Multiplier premiums
 * APE: Info only (no pay adjustment yet)
 */
export const PREMIUM_CODES: Record<string, PremiumCodeConfig> = {
  // AP Series - Airport Reserve (+2:00 hours each)
  AP0: { code: 'AP0', name: 'Airport Reserve 0', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP1: { code: 'AP1', name: 'Airport Reserve 1', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP2: { code: 'AP2', name: 'Airport Reserve 2', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP3: { code: 'AP3', name: 'Airport Reserve 3', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP4: { code: 'AP4', name: 'Airport Reserve 4', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP5: { code: 'AP5', name: 'Airport Reserve 5', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP6: { code: 'AP6', name: 'Airport Reserve 6', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP7: { code: 'AP7', name: 'Airport Reserve 7', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP8: { code: 'AP8', name: 'Airport Reserve 8', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },
  AP9: { code: 'AP9', name: 'Airport Reserve 9', type: 'ADD_HOURS', value: 2, description: 'Airport reserve premium' },

  // Other Add-Hour Premiums
  SVT: { code: 'SVT', name: 'Short Visit', type: 'ADD_HOURS', value: 2, description: 'Short visit turnaround premium' },
  LRP: { code: 'LRP', name: 'Long Range Premium', type: 'ADD_HOURS', value: 6, description: 'Long range international premium (+6:00)' },
  GT1: { code: 'GT1', name: 'Ground Time 1', type: 'ADD_HOURS', value: 1, description: 'Ground time premium (+1:00)' },
  PRM: { code: 'PRM', name: 'Premium Pay', type: 'ADD_HOURS', value: 2, description: 'General premium (+2:00)' },

  // Multiplier Premiums
  LP1: { code: 'LP1', name: 'Language Premium 1', type: 'MULTIPLIER', value: 1.5, description: '1.5x multiplier' },
  LP2: { code: 'LP2', name: 'Language Premium 2', type: 'MULTIPLIER', value: 2.5, description: '2.5x multiplier' },
  LPT: { code: 'LPT', name: 'Language Premium Training', type: 'MULTIPLIER', value: 1.5, description: '1.5x training multiplier' },
  RJA: { code: 'RJA', name: 'Reserve Juniority Award', type: 'MULTIPLIER', value: 1.5, description: '1.5x reserve premium' },

  // Info Only (no pay adjustment)
  APE: { code: 'APE', name: 'Airport Reserve Extension', type: 'INFO_ONLY', value: 0, description: 'Tracking only - no pay adjustment' },
};

/**
 * Get premium code configuration
 */
export function getPremiumCode(code: string | null | undefined): PremiumCodeConfig | null {
  if (!code) return null;
  return PREMIUM_CODES[code.toUpperCase()] ?? null;
}

/**
 * UPS Pay Period Calendar 2026-2027
 * 13 periods per year (~4 weeks each)
 */
export interface PayPeriodInfo {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
  payType: 'standard' | 'remainder';
}

/**
 * UPS Pay Period Calendar 2026
 *
 * Actual UPS pay schedule from the official 2026 & 2027 pay period calendar.
 *
 * Pay periods run ~4 weeks each (28 days). Each period has TWO pay dates:
 *   - 'standard' = Advance Check (small check) — first pay date of the pair
 *   - 'remainder' = Settlement Check (big check) — second pay date of the pair
 *
 * Period start dates and pay dates are sourced directly from the official UPS calendar.
 *
 * Note: Period 6 (May 17 – Jun 13) and Period 11 (Oct 4 – Nov 1) have THREE pay dates
 * (extra settlement check). The third pay date is also typed 'remainder'.
 */
export const PAY_PERIODS_2026: PayPeriodInfo[] = [
  // Period 1: Dec 28, 2025 – Jan 24, 2026 → Advance: Jan 12, Settlement: Jan 26
  { year: 2026, periodNumber: 1, startDate: '2025-12-28', endDate: '2026-01-24', payDate: '2026-01-12', payType: 'standard' },
  { year: 2026, periodNumber: 1, startDate: '2025-12-28', endDate: '2026-01-24', payDate: '2026-01-26', payType: 'remainder' },

  // Period 2: Jan 25 – Feb 21, 2026 → Advance: Feb 9, Settlement: Feb 23
  { year: 2026, periodNumber: 2, startDate: '2026-01-25', endDate: '2026-02-21', payDate: '2026-02-09', payType: 'standard' },
  { year: 2026, periodNumber: 2, startDate: '2026-01-25', endDate: '2026-02-21', payDate: '2026-02-23', payType: 'remainder' },

  // Period 3: Feb 22 – Mar 21, 2026 → Advance: Mar 9, Settlement: Mar 23
  { year: 2026, periodNumber: 3, startDate: '2026-02-22', endDate: '2026-03-21', payDate: '2026-03-09', payType: 'standard' },
  { year: 2026, periodNumber: 3, startDate: '2026-02-22', endDate: '2026-03-21', payDate: '2026-03-23', payType: 'remainder' },

  // Period 4: Mar 22 – Apr 18, 2026 → Advance: Apr 6, Settlement: Apr 20
  { year: 2026, periodNumber: 4, startDate: '2026-03-22', endDate: '2026-04-18', payDate: '2026-04-06', payType: 'standard' },
  { year: 2026, periodNumber: 4, startDate: '2026-03-22', endDate: '2026-04-18', payDate: '2026-04-20', payType: 'remainder' },

  // Period 5: Apr 19 – May 16, 2026 → Advance: May 4, Settlement: May 18
  { year: 2026, periodNumber: 5, startDate: '2026-04-19', endDate: '2026-05-16', payDate: '2026-05-04', payType: 'standard' },
  { year: 2026, periodNumber: 5, startDate: '2026-04-19', endDate: '2026-05-16', payDate: '2026-05-18', payType: 'remainder' },

  // Period 6: May 17 – Jun 13, 2026 → Advance: Jun 1, Settlement: Jun 15, Extra: Jun 29
  { year: 2026, periodNumber: 6, startDate: '2026-05-17', endDate: '2026-06-13', payDate: '2026-06-01', payType: 'standard' },
  { year: 2026, periodNumber: 6, startDate: '2026-05-17', endDate: '2026-06-13', payDate: '2026-06-15', payType: 'remainder' },
  { year: 2026, periodNumber: 6, startDate: '2026-05-17', endDate: '2026-06-13', payDate: '2026-06-29', payType: 'remainder' },

  // Period 7: Jun 14 – Jul 11, 2026 → Advance: Jul 13, Settlement: Jul 27
  { year: 2026, periodNumber: 7, startDate: '2026-06-14', endDate: '2026-07-11', payDate: '2026-07-13', payType: 'standard' },
  { year: 2026, periodNumber: 7, startDate: '2026-06-14', endDate: '2026-07-11', payDate: '2026-07-27', payType: 'remainder' },

  // Period 8: Jul 12 – Aug 8, 2026 → Advance: Aug 10, Settlement: Aug 24
  { year: 2026, periodNumber: 8, startDate: '2026-07-12', endDate: '2026-08-08', payDate: '2026-08-10', payType: 'standard' },
  { year: 2026, periodNumber: 8, startDate: '2026-07-12', endDate: '2026-08-08', payDate: '2026-08-24', payType: 'remainder' },

  // Period 9: Aug 9 – Sep 5, 2026 → Advance: Sep 8, Settlement: Sep 21
  { year: 2026, periodNumber: 9, startDate: '2026-08-09', endDate: '2026-09-05', payDate: '2026-09-08', payType: 'standard' },
  { year: 2026, periodNumber: 9, startDate: '2026-08-09', endDate: '2026-09-05', payDate: '2026-09-21', payType: 'remainder' },

  // Period 10: Sep 6 – Oct 3, 2026 → Advance: Oct 5, Settlement: Oct 19
  { year: 2026, periodNumber: 10, startDate: '2026-09-06', endDate: '2026-10-03', payDate: '2026-10-05', payType: 'standard' },
  { year: 2026, periodNumber: 10, startDate: '2026-09-06', endDate: '2026-10-03', payDate: '2026-10-19', payType: 'remainder' },

  // Period 11: Oct 4 – Nov 1, 2026 → Advance: Nov 2, Settlement: Nov 16, Extra: Nov 30
  { year: 2026, periodNumber: 11, startDate: '2026-10-04', endDate: '2026-11-01', payDate: '2026-11-02', payType: 'standard' },
  { year: 2026, periodNumber: 11, startDate: '2026-10-04', endDate: '2026-11-01', payDate: '2026-11-16', payType: 'remainder' },
  { year: 2026, periodNumber: 11, startDate: '2026-10-04', endDate: '2026-11-01', payDate: '2026-11-30', payType: 'remainder' },

  // Period 12: Nov 2 – Nov 29, 2026 → Advance: Dec 14, Settlement: Dec 28
  { year: 2026, periodNumber: 12, startDate: '2026-11-02', endDate: '2026-11-29', payDate: '2026-12-14', payType: 'standard' },
  { year: 2026, periodNumber: 12, startDate: '2026-11-02', endDate: '2026-11-29', payDate: '2026-12-28', payType: 'remainder' },

  // Period 13: Nov 30 – Dec 31, 2026 → (2027 pay dates – placeholders)
  { year: 2026, periodNumber: 13, startDate: '2026-11-30', endDate: '2026-12-31', payDate: '2027-01-12', payType: 'standard' },
  { year: 2026, periodNumber: 13, startDate: '2026-11-30', endDate: '2026-12-31', payDate: '2027-01-26', payType: 'remainder' },
];

/**
 * Get the pay period for a given date
 */
export function getPayPeriodForDate(dateISO: string): PayPeriodInfo | null {
  // Check 2026 periods
  for (const period of PAY_PERIODS_2026) {
    if (dateISO >= period.startDate && dateISO <= period.endDate && period.payType === 'standard') {
      return period;
    }
  }
  return null;
}

/**
 * Get the next pay date from today
 */
export function getNextPayDate(fromDate: string): { payDate: string; payType: 'standard' | 'remainder' } | null {
  const allPayDates = PAY_PERIODS_2026
    .map(p => ({ payDate: p.payDate, payType: p.payType }))
    .sort((a, b) => a.payDate.localeCompare(b.payDate));

  for (const pd of allPayDates) {
    if (pd.payDate >= fromDate) {
      return pd;
    }
  }
  return null;
}

/**
 * UPS Official Bid Period Calendar 2026-2027
 *
 * Each bid period begins at 03:00 LDT (Local Domicile Time = Eastern Time)
 * on the listed Sunday. A trip whose report/start time is BEFORE 03:00 LDT
 * on the boundary Sunday belongs to the PREVIOUS bid period.
 *
 * Most periods are 56 days (BID_56). Period #7 each year is 28 days (BID_28).
 *
 * Source: Official UPS Published Bid Period Schedule 2026-2027.
 */
export interface BidPeriodEntry {
  /** Contract year this period belongs to (e.g. 2026 or 2027) */
  contractYear: number;
  /** Period number within the contract year (1-7) */
  periodNumber: number;
  /** ISO date "YYYY-MM-DD" — the Sunday the period begins (boundary at 03:00 LDT) */
  startDate: string;
  /** ISO date "YYYY-MM-DD" — last day (inclusive) of this period */
  endDate: string;
  /** 28 or 56 — contract period duration */
  durationDays: 28 | 56;
}

/**
 * Official UPS bid period start dates.
 * Bid periods begin at 03:00 LDT on the listed Sunday.
 * End dates are the day before the next period's start date (inclusive).
 */
export const UPS_BID_PERIODS: BidPeriodEntry[] = [
  // ── 2026 Contract Year ──────────────────────────────────────────────────────
  // Period #2: Jan 25 → Mar 21  (56 days)
  { contractYear: 2026, periodNumber: 2, startDate: '2026-01-25', endDate: '2026-03-21', durationDays: 56 },
  // Period #3: Mar 22 → May 16  (56 days)
  { contractYear: 2026, periodNumber: 3, startDate: '2026-03-22', endDate: '2026-05-16', durationDays: 56 },
  // Period #4: May 17 → Jul 11  (56 days)
  { contractYear: 2026, periodNumber: 4, startDate: '2026-05-17', endDate: '2026-07-11', durationDays: 56 },
  // Period #5: Jul 12 → Sep 5   (56 days)
  { contractYear: 2026, periodNumber: 5, startDate: '2026-07-12', endDate: '2026-09-05', durationDays: 56 },
  // Period #6: Sep 6  → Oct 31  (56 days)
  { contractYear: 2026, periodNumber: 6, startDate: '2026-09-06', endDate: '2026-10-31', durationDays: 56 },
  // Period #7: Nov 1  → Nov 28  (28 days — shortened period)
  { contractYear: 2026, periodNumber: 7, startDate: '2026-11-01', endDate: '2026-11-28', durationDays: 28 },

  // ── 2027 Contract Year ──────────────────────────────────────────────────────
  // Period #1: Nov 29, 2026 → Jan 23, 2027  (56 days)
  { contractYear: 2027, periodNumber: 1, startDate: '2026-11-29', endDate: '2027-01-23', durationDays: 56 },
  // Period #2: Jan 24 → Mar 20  (56 days)
  { contractYear: 2027, periodNumber: 2, startDate: '2027-01-24', endDate: '2027-03-20', durationDays: 56 },
  // Period #3: Mar 21 → May 15  (56 days)
  { contractYear: 2027, periodNumber: 3, startDate: '2027-03-21', endDate: '2027-05-15', durationDays: 56 },
  // Period #4: May 16 → Jul 10  (56 days)
  { contractYear: 2027, periodNumber: 4, startDate: '2027-05-16', endDate: '2027-07-10', durationDays: 56 },
  // Period #5: Jul 11 → Sep 4   (56 days)
  { contractYear: 2027, periodNumber: 5, startDate: '2027-07-11', endDate: '2027-09-04', durationDays: 56 },
  // Period #6: Sep 5  → Oct 30  (56 days)
  { contractYear: 2027, periodNumber: 6, startDate: '2027-09-05', endDate: '2027-10-30', durationDays: 56 },
  // Period #7: Oct 31 → Nov 27  (28 days — shortened period)
  { contractYear: 2027, periodNumber: 7, startDate: '2027-10-31', endDate: '2027-11-27', durationDays: 28 },
  // Period #1 (2028): Nov 28, 2027 → Jan 22, 2028  (56 days)
  { contractYear: 2028, periodNumber: 1, startDate: '2027-11-28', endDate: '2028-01-22', durationDays: 56 },
];

/**
 * Get the UPS bid period for a given date (and optionally local report time).
 *
 * Bid periods begin at 03:00 LDT on the boundary Sunday.
 * If localTimeHHMM is provided and the date IS the boundary Sunday, times
 * before "03:00" are assigned to the PREVIOUS bid period.
 *
 * @param dateISO       - ISO date string "YYYY-MM-DD"
 * @param localTimeHHMM - Optional local (domicile) time "HH:MM" for boundary enforcement
 */
export function getBidPeriodForDate(
  dateISO: string,
  localTimeHHMM?: string
): BidPeriodEntry | null {
  for (let i = 0; i < UPS_BID_PERIODS.length; i++) {
    const period = UPS_BID_PERIODS[i];
    if (!period) continue;

    if (dateISO >= period.startDate && dateISO <= period.endDate) {
      // On the boundary Sunday, check the 03:00 LDT rule
      if (dateISO === period.startDate && localTimeHHMM) {
        const [hStr, mStr] = localTimeHHMM.split(':');
        const totalMinutes = (parseInt(hStr ?? '0', 10) * 60) + parseInt(mStr ?? '0', 10);
        // Before 03:00 → belongs to the previous bid period
        if (totalMinutes < 180) {
          return i > 0 ? (UPS_BID_PERIODS[i - 1] ?? null) : null;
        }
      }
      return period;
    }
  }
  return null;
}

/**
 * Get the current bid period based on today's date.
 */
export function getCurrentBidPeriod(todayISO?: string): BidPeriodEntry | null {
  const today = todayISO ?? new Date().toISOString().split('T')[0] ?? '';
  return getBidPeriodForDate(today);
}

/**
 * Count bid periods remaining in the calendar year from a given date (inclusive).
 * Uses the official bid period calendar.
 *
 * "Remaining" means: bid periods whose startDate is >= todayISO AND
 * whose endDate is within the same calendar year as todayISO.
 */
export function getRemainingBidPeriods(todayISO: string): BidPeriodEntry[] {
  const year = parseInt(todayISO.slice(0, 4), 10);
  // Include periods that overlap with the year and haven't fully ended before today
  return UPS_BID_PERIODS.filter(
    p => p.endDate >= todayISO && (p.startDate.startsWith(String(year)) || p.endDate.startsWith(String(year)))
  );
}

/**
 * Get all bid periods in a given calendar year (periods whose startDate or endDate falls in that year).
 */
export function getBidPeriodsForYear(year: number): BidPeriodEntry[] {
  return UPS_BID_PERIODS.filter(
    p => p.startDate.startsWith(String(year)) || p.endDate.startsWith(String(year))
  );
}

/**
 * 30-in-7 Status Levels
 */
export type ThirtyInSevenStatus = 'green' | 'yellow' | 'red';

export function getThirtyInSevenStatus(blockMinutes: number): ThirtyInSevenStatus {
  if (blockMinutes >= THIRTY_IN_SEVEN_LIMIT_MINUTES) return 'red';
  if (blockMinutes >= THIRTY_IN_SEVEN_WARNING_MINUTES) return 'yellow';
  return 'green';
}
