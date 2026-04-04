/**
 * Tax Calculator Engine
 *
 * Calculates estimated federal, FICA, and state taxes.
 * All tax tables are config-driven by tax year for easy annual updates.
 */

// ============================================
// TAX YEAR CONFIGURATION
// ============================================

interface TaxBracket {
  min: number;
  max: number;
  rate: number;  // As decimal (0.10 = 10%)
  baseTax: number;
}

interface FilingStatusConfig {
  standardDeduction: number;
  brackets: TaxBracket[];
}

interface TaxYearConfig {
  year: number;
  federal: Record<string, FilingStatusConfig>;
  fica: {
    socialSecurityRate: number;
    socialSecurityWageBase: number;
    medicareRate: number;
    additionalMedicareRate: number;
    additionalMedicareThreshold: Record<string, number>;
  };
  states: Record<string, StateConfig>;
}

interface StateConfig {
  name: string;
  hasIncomeTax: boolean;
  defaultRate?: number;  // Flat rate as basis points (100 = 1%)
  notes?: string;
}

// 2024 Tax Year Configuration
const TAX_YEAR_2024: TaxYearConfig = {
  year: 2024,
  federal: {
    single: {
      standardDeduction: 14600,
      brackets: [
        { min: 0, max: 11600, rate: 0.10, baseTax: 0 },
        { min: 11600, max: 47150, rate: 0.12, baseTax: 1160 },
        { min: 47150, max: 100525, rate: 0.22, baseTax: 5426 },
        { min: 100525, max: 191950, rate: 0.24, baseTax: 17168.50 },
        { min: 191950, max: 243725, rate: 0.32, baseTax: 39110.50 },
        { min: 243725, max: 609350, rate: 0.35, baseTax: 55678.50 },
        { min: 609350, max: Infinity, rate: 0.37, baseTax: 183647.25 },
      ],
    },
    mfj: {
      standardDeduction: 29200,
      brackets: [
        { min: 0, max: 23200, rate: 0.10, baseTax: 0 },
        { min: 23200, max: 94300, rate: 0.12, baseTax: 2320 },
        { min: 94300, max: 201050, rate: 0.22, baseTax: 10852 },
        { min: 201050, max: 383900, rate: 0.24, baseTax: 34337 },
        { min: 383900, max: 487450, rate: 0.32, baseTax: 78221 },
        { min: 487450, max: 731200, rate: 0.35, baseTax: 111357 },
        { min: 731200, max: Infinity, rate: 0.37, baseTax: 196669.50 },
      ],
    },
    mfs: {
      standardDeduction: 14600,
      brackets: [
        { min: 0, max: 11600, rate: 0.10, baseTax: 0 },
        { min: 11600, max: 47150, rate: 0.12, baseTax: 1160 },
        { min: 47150, max: 100525, rate: 0.22, baseTax: 5426 },
        { min: 100525, max: 191950, rate: 0.24, baseTax: 17168.50 },
        { min: 191950, max: 243725, rate: 0.32, baseTax: 39110.50 },
        { min: 243725, max: 365600, rate: 0.35, baseTax: 55678.50 },
        { min: 365600, max: Infinity, rate: 0.37, baseTax: 98334.75 },
      ],
    },
    hoh: {
      standardDeduction: 21900,
      brackets: [
        { min: 0, max: 16550, rate: 0.10, baseTax: 0 },
        { min: 16550, max: 63100, rate: 0.12, baseTax: 1655 },
        { min: 63100, max: 100500, rate: 0.22, baseTax: 7241 },
        { min: 100500, max: 191950, rate: 0.24, baseTax: 15469 },
        { min: 191950, max: 243700, rate: 0.32, baseTax: 37417 },
        { min: 243700, max: 609350, rate: 0.35, baseTax: 53977 },
        { min: 609350, max: Infinity, rate: 0.37, baseTax: 181954.50 },
      ],
    },
  },
  fica: {
    socialSecurityRate: 0.062,  // 6.2%
    socialSecurityWageBase: 168600,  // 2024 wage base
    medicareRate: 0.0145,  // 1.45%
    additionalMedicareRate: 0.009,  // 0.9% additional
    additionalMedicareThreshold: {
      single: 200000,
      mfj: 250000,
      mfs: 125000,
      hoh: 200000,
    },
  },
  states: {
    // No income tax states
    AK: { name: 'Alaska', hasIncomeTax: false },
    FL: { name: 'Florida', hasIncomeTax: false },
    NV: { name: 'Nevada', hasIncomeTax: false },
    NH: { name: 'New Hampshire', hasIncomeTax: false, notes: 'No tax on wages (only interest/dividends)' },
    SD: { name: 'South Dakota', hasIncomeTax: false },
    TN: { name: 'Tennessee', hasIncomeTax: false },
    TX: { name: 'Texas', hasIncomeTax: false },
    WA: { name: 'Washington', hasIncomeTax: false },
    WY: { name: 'Wyoming', hasIncomeTax: false },
    // Flat rate states (simplified - actual rates vary by income)
    AL: { name: 'Alabama', hasIncomeTax: true, defaultRate: 500 },  // 5%
    AZ: { name: 'Arizona', hasIncomeTax: true, defaultRate: 250 },  // 2.5%
    AR: { name: 'Arkansas', hasIncomeTax: true, defaultRate: 440 },  // 4.4%
    CA: { name: 'California', hasIncomeTax: true, defaultRate: 930 },  // 9.3% (high earners)
    CO: { name: 'Colorado', hasIncomeTax: true, defaultRate: 440 },  // 4.4%
    CT: { name: 'Connecticut', hasIncomeTax: true, defaultRate: 550 },  // 5.5%
    DE: { name: 'Delaware', hasIncomeTax: true, defaultRate: 660 },  // 6.6%
    GA: { name: 'Georgia', hasIncomeTax: true, defaultRate: 549 },  // 5.49%
    HI: { name: 'Hawaii', hasIncomeTax: true, defaultRate: 825 },  // 8.25%
    ID: { name: 'Idaho', hasIncomeTax: true, defaultRate: 580 },  // 5.8%
    IL: { name: 'Illinois', hasIncomeTax: true, defaultRate: 495 },  // 4.95%
    IN: { name: 'Indiana', hasIncomeTax: true, defaultRate: 305 },  // 3.05%
    IA: { name: 'Iowa', hasIncomeTax: true, defaultRate: 575 },  // 5.75%
    KS: { name: 'Kansas', hasIncomeTax: true, defaultRate: 570 },  // 5.7%
    KY: { name: 'Kentucky', hasIncomeTax: true, defaultRate: 400 },  // 4%
    LA: { name: 'Louisiana', hasIncomeTax: true, defaultRate: 425 },  // 4.25%
    ME: { name: 'Maine', hasIncomeTax: true, defaultRate: 715 },  // 7.15%
    MD: { name: 'Maryland', hasIncomeTax: true, defaultRate: 575 },  // 5.75%
    MA: { name: 'Massachusetts', hasIncomeTax: true, defaultRate: 500 },  // 5%
    MI: { name: 'Michigan', hasIncomeTax: true, defaultRate: 425 },  // 4.25%
    MN: { name: 'Minnesota', hasIncomeTax: true, defaultRate: 785 },  // 7.85%
    MS: { name: 'Mississippi', hasIncomeTax: true, defaultRate: 500 },  // 5%
    MO: { name: 'Missouri', hasIncomeTax: true, defaultRate: 480 },  // 4.8%
    MT: { name: 'Montana', hasIncomeTax: true, defaultRate: 590 },  // 5.9%
    NE: { name: 'Nebraska', hasIncomeTax: true, defaultRate: 584 },  // 5.84%
    NJ: { name: 'New Jersey', hasIncomeTax: true, defaultRate: 637 },  // 6.37%
    NM: { name: 'New Mexico', hasIncomeTax: true, defaultRate: 490 },  // 4.9%
    NY: { name: 'New York', hasIncomeTax: true, defaultRate: 685 },  // 6.85%
    NC: { name: 'North Carolina', hasIncomeTax: true, defaultRate: 475 },  // 4.75%
    ND: { name: 'North Dakota', hasIncomeTax: true, defaultRate: 195 },  // 1.95%
    OH: { name: 'Ohio', hasIncomeTax: true, defaultRate: 375 },  // 3.75%
    OK: { name: 'Oklahoma', hasIncomeTax: true, defaultRate: 475 },  // 4.75%
    OR: { name: 'Oregon', hasIncomeTax: true, defaultRate: 875 },  // 8.75%
    PA: { name: 'Pennsylvania', hasIncomeTax: true, defaultRate: 307 },  // 3.07%
    RI: { name: 'Rhode Island', hasIncomeTax: true, defaultRate: 599 },  // 5.99%
    SC: { name: 'South Carolina', hasIncomeTax: true, defaultRate: 640 },  // 6.4%
    UT: { name: 'Utah', hasIncomeTax: true, defaultRate: 465 },  // 4.65%
    VT: { name: 'Vermont', hasIncomeTax: true, defaultRate: 660 },  // 6.6%
    VA: { name: 'Virginia', hasIncomeTax: true, defaultRate: 575 },  // 5.75%
    WV: { name: 'West Virginia', hasIncomeTax: true, defaultRate: 550 },  // 5.5%
    WI: { name: 'Wisconsin', hasIncomeTax: true, defaultRate: 533 },  // 5.33%
    DC: { name: 'District of Columbia', hasIncomeTax: true, defaultRate: 600 },  // 6%
  },
};

// 2025 Tax Year Configuration (projected, update when official)
const TAX_YEAR_2025: TaxYearConfig = {
  year: 2025,
  federal: {
    single: {
      standardDeduction: 15000,  // Estimated
      brackets: [
        { min: 0, max: 11925, rate: 0.10, baseTax: 0 },
        { min: 11925, max: 48475, rate: 0.12, baseTax: 1192.50 },
        { min: 48475, max: 103350, rate: 0.22, baseTax: 5578.50 },
        { min: 103350, max: 197300, rate: 0.24, baseTax: 17651 },
        { min: 197300, max: 250500, rate: 0.32, baseTax: 40199 },
        { min: 250500, max: 626350, rate: 0.35, baseTax: 57223 },
        { min: 626350, max: Infinity, rate: 0.37, baseTax: 188770.75 },
      ],
    },
    mfj: {
      standardDeduction: 30000,  // Estimated
      brackets: [
        { min: 0, max: 23850, rate: 0.10, baseTax: 0 },
        { min: 23850, max: 96950, rate: 0.12, baseTax: 2385 },
        { min: 96950, max: 206700, rate: 0.22, baseTax: 11157 },
        { min: 206700, max: 394600, rate: 0.24, baseTax: 35302 },
        { min: 394600, max: 501050, rate: 0.32, baseTax: 80398 },
        { min: 501050, max: 751600, rate: 0.35, baseTax: 114462 },
        { min: 751600, max: Infinity, rate: 0.37, baseTax: 202154.50 },
      ],
    },
    mfs: {
      standardDeduction: 15000,
      brackets: [
        { min: 0, max: 11925, rate: 0.10, baseTax: 0 },
        { min: 11925, max: 48475, rate: 0.12, baseTax: 1192.50 },
        { min: 48475, max: 103350, rate: 0.22, baseTax: 5578.50 },
        { min: 103350, max: 197300, rate: 0.24, baseTax: 17651 },
        { min: 197300, max: 250525, rate: 0.32, baseTax: 40199 },
        { min: 250525, max: 375800, rate: 0.35, baseTax: 57231 },
        { min: 375800, max: Infinity, rate: 0.37, baseTax: 101077.25 },
      ],
    },
    hoh: {
      standardDeduction: 22500,
      brackets: [
        { min: 0, max: 17000, rate: 0.10, baseTax: 0 },
        { min: 17000, max: 64850, rate: 0.12, baseTax: 1700 },
        { min: 64850, max: 103350, rate: 0.22, baseTax: 7442 },
        { min: 103350, max: 197300, rate: 0.24, baseTax: 15912 },
        { min: 197300, max: 250500, rate: 0.32, baseTax: 38460 },
        { min: 250500, max: 626350, rate: 0.35, baseTax: 55484 },
        { min: 626350, max: Infinity, rate: 0.37, baseTax: 187031.75 },
      ],
    },
  },
  fica: {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 176100,  // Estimated
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: {
      single: 200000,
      mfj: 250000,
      mfs: 125000,
      hoh: 200000,
    },
  },
  states: TAX_YEAR_2024.states,  // Inherit from 2024
};

// Tax year configurations lookup
const TAX_CONFIGS: Record<number, TaxYearConfig> = {
  2024: TAX_YEAR_2024,
  2025: TAX_YEAR_2025,
};

// Get tax config for a given year (defaults to latest)
function getTaxConfig(year: number): TaxYearConfig {
  return TAX_CONFIGS[year] ?? TAX_YEAR_2024;
}

// ============================================
// TAX PROFILE TYPES
// ============================================

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface TaxProfile {
  stateOfResidence: string;
  filingStatus: FilingStatus;
  payFrequency: PayFrequency;
  dependents: number;
  additionalCreditsCents: number;
  extraWithholdingType: 'fixed' | 'percent';
  extraWithholdingValue: number;  // cents or basis points
  stateWithholdingOverride?: number;  // basis points
  taxYear: number;
}

export interface Deduction {
  name: string;
  deductionType: 'fixed' | 'percent';
  amount: number;  // cents or basis points
  timing: 'pretax' | 'posttax';
  frequency: 'per_paycheck' | 'monthly';
  isEnabled: boolean;
}

// ============================================
// TAX CALCULATION
// ============================================

function getPeriodsPerYear(frequency: PayFrequency): number {
  switch (frequency) {
    case 'weekly': return 52;
    case 'biweekly': return 26;
    case 'semimonthly': return 24;
    case 'monthly': return 12;
  }
}

function normalizeToPaycheck(amount: number, deductionFreq: 'per_paycheck' | 'monthly', payFreq: PayFrequency): number {
  if (deductionFreq === 'per_paycheck') return amount;
  // Convert monthly to per-paycheck
  const periodsPerYear = getPeriodsPerYear(payFreq);
  return Math.round(amount * 12 / periodsPerYear);
}

function calculateFederalTax(
  taxableIncome: number,
  filingStatus: FilingStatus,
  config: TaxYearConfig
): number {
  const statusConfig = config.federal[filingStatus];
  if (!statusConfig) return 0;

  const brackets = statusConfig.brackets;

  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (bracket && taxableIncome > bracket.min) {
      const taxableInBracket = Math.min(taxableIncome - bracket.min, bracket.max - bracket.min);
      return Math.round(bracket.baseTax + taxableInBracket * bracket.rate);
    }
  }

  return 0;
}

export interface TaxBreakdown {
  grossPayCents: number;
  pretaxDeductionsCents: number;
  taxableWagesCents: number;
  federalWithholdingCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  additionalMedicareCents: number;
  stateWithholdingCents: number;
  posttaxDeductionsCents: number;
  extraWithholdingCents: number;
  netPayCents: number;
  // Details for display
  effectiveFederalRate: number;  // As percent
  effectiveStateRate: number;  // As percent
  effectiveTotalRate: number;  // As percent
  pretaxDeductions: Array<{ name: string; amountCents: number }>;
  posttaxDeductions: Array<{ name: string; amountCents: number }>;
  stateInfo: { code: string; name: string; hasIncomeTax: boolean };
}

export function calculateNetPay(
  grossPayCents: number,
  taxProfile: TaxProfile,
  deductions: Deduction[],
  ytdWagesCents: number = 0  // For Social Security wage base
): TaxBreakdown {
  const config = getTaxConfig(taxProfile.taxYear);
  const periodsPerYear = getPeriodsPerYear(taxProfile.payFrequency);

  // 1. Calculate pretax deductions
  const enabledPretax = deductions.filter(d => d.isEnabled && d.timing === 'pretax');
  let pretaxTotal = 0;
  const pretaxDetails: Array<{ name: string; amountCents: number }> = [];

  for (const d of enabledPretax) {
    let amount: number;
    if (d.deductionType === 'fixed') {
      amount = normalizeToPaycheck(d.amount, d.frequency, taxProfile.payFrequency);
    } else {
      // Percent of gross
      amount = Math.round(grossPayCents * d.amount / 10000);  // basis points
    }
    pretaxTotal += amount;
    pretaxDetails.push({ name: d.name, amountCents: amount });
  }

  // 2. Calculate taxable wages
  const taxableWages = Math.max(0, grossPayCents - pretaxTotal);

  // 3. Calculate FICA
  // Social Security
  const annualizedYtd = ytdWagesCents + taxableWages * periodsPerYear;
  let ssWages = taxableWages;
  const wageBaseCents = config.fica.socialSecurityWageBase * 100;

  // Check if already over wage base from YTD
  if (ytdWagesCents >= wageBaseCents) {
    ssWages = 0;
  } else if (ytdWagesCents + taxableWages > wageBaseCents) {
    // Partially over
    ssWages = wageBaseCents - ytdWagesCents;
  }

  const socialSecurityCents = Math.round(ssWages * config.fica.socialSecurityRate);
  const medicareCents = Math.round(taxableWages * config.fica.medicareRate);

  // Additional Medicare (0.9% above threshold)
  let additionalMedicareCents = 0;
  const medicareThreshold = (config.fica.additionalMedicareThreshold[taxProfile.filingStatus] ?? 200000) * 100;
  const annualizedWages = taxableWages * periodsPerYear;
  if (annualizedWages > medicareThreshold) {
    const wagesAboveThreshold = annualizedWages - medicareThreshold;
    const perPaycheckAbove = wagesAboveThreshold / periodsPerYear;
    additionalMedicareCents = Math.round(perPaycheckAbove * config.fica.additionalMedicareRate);
  }

  // 4. Calculate Federal Withholding
  const statusConfig = config.federal[taxProfile.filingStatus];
  const standardDeduction = statusConfig?.standardDeduction ?? 14600;

  // Annualize wages for bracket calculation
  const annualTaxableWages = (taxableWages / 100) * periodsPerYear;
  const taxableIncome = Math.max(0, annualTaxableWages - standardDeduction);

  // Apply dependent credits (simplified: $2000 per dependent per year)
  const dependentCredit = taxProfile.dependents * 2000;

  let annualFederalTax = calculateFederalTax(taxableIncome, taxProfile.filingStatus, config);
  annualFederalTax = Math.max(0, annualFederalTax - dependentCredit - (taxProfile.additionalCreditsCents / 100));

  const federalWithholdingCents = Math.round((annualFederalTax * 100) / periodsPerYear);

  // 5. Calculate State Withholding
  const stateConfig = config.states[taxProfile.stateOfResidence];
  const stateInfo = {
    code: taxProfile.stateOfResidence,
    name: stateConfig?.name ?? 'Unknown',
    hasIncomeTax: stateConfig?.hasIncomeTax ?? true,
  };

  let stateWithholdingCents = 0;
  if (stateConfig?.hasIncomeTax) {
    // Use override if set, otherwise default rate
    const rateBasisPoints = taxProfile.stateWithholdingOverride ?? stateConfig.defaultRate ?? 500;
    stateWithholdingCents = Math.round(taxableWages * rateBasisPoints / 10000);
  }

  // 6. Calculate posttax deductions
  const enabledPosttax = deductions.filter(d => d.isEnabled && d.timing === 'posttax');
  let posttaxTotal = 0;
  const posttaxDetails: Array<{ name: string; amountCents: number }> = [];

  for (const d of enabledPosttax) {
    let amount: number;
    if (d.deductionType === 'fixed') {
      amount = normalizeToPaycheck(d.amount, d.frequency, taxProfile.payFrequency);
    } else {
      amount = Math.round(grossPayCents * d.amount / 10000);
    }
    posttaxTotal += amount;
    posttaxDetails.push({ name: d.name, amountCents: amount });
  }

  // 7. Calculate extra withholding
  let extraWithholdingCents = 0;
  if (taxProfile.extraWithholdingType === 'fixed') {
    extraWithholdingCents = taxProfile.extraWithholdingValue;
  } else {
    extraWithholdingCents = Math.round(grossPayCents * taxProfile.extraWithholdingValue / 10000);
  }

  // 8. Calculate net pay
  const totalTaxes = federalWithholdingCents + socialSecurityCents + medicareCents +
                     additionalMedicareCents + stateWithholdingCents;
  const netPayCents = grossPayCents - pretaxTotal - totalTaxes - posttaxTotal - extraWithholdingCents;

  // Calculate effective rates
  const effectiveFederalRate = grossPayCents > 0 ? (federalWithholdingCents / grossPayCents) * 100 : 0;
  const effectiveStateRate = grossPayCents > 0 ? (stateWithholdingCents / grossPayCents) * 100 : 0;
  const totalWithholding = federalWithholdingCents + socialSecurityCents + medicareCents +
                          additionalMedicareCents + stateWithholdingCents;
  const effectiveTotalRate = grossPayCents > 0 ? (totalWithholding / grossPayCents) * 100 : 0;

  return {
    grossPayCents,
    pretaxDeductionsCents: pretaxTotal,
    taxableWagesCents: taxableWages,
    federalWithholdingCents,
    socialSecurityCents,
    medicareCents,
    additionalMedicareCents,
    stateWithholdingCents,
    posttaxDeductionsCents: posttaxTotal,
    extraWithholdingCents,
    netPayCents,
    effectiveFederalRate,
    effectiveStateRate,
    effectiveTotalRate,
    pretaxDeductions: pretaxDetails,
    posttaxDeductions: posttaxDetails,
    stateInfo,
  };
}

// ============================================
// STATE HELPERS
// ============================================

export function getNoTaxStates(): string[] {
  return Object.entries(TAX_YEAR_2024.states)
    .filter(([_, config]) => !config.hasIncomeTax)
    .map(([code]) => code);
}

export function getAllStates(): Array<{ code: string; name: string; hasIncomeTax: boolean; defaultRate?: number }> {
  return Object.entries(TAX_YEAR_2024.states).map(([code, config]) => ({
    code,
    name: config.name,
    hasIncomeTax: config.hasIncomeTax,
    defaultRate: config.defaultRate,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function getStateConfig(stateCode: string): StateConfig | undefined {
  return TAX_YEAR_2024.states[stateCode];
}

export const FILING_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married Filing Jointly' },
  { value: 'mfs', label: 'Married Filing Separately' },
  { value: 'hoh', label: 'Head of Household' },
] as const;

export const PAY_FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly (52/year)' },
  { value: 'biweekly', label: 'Bi-weekly (26/year)' },
  { value: 'semimonthly', label: 'Semi-monthly (24/year)' },
  { value: 'monthly', label: 'Monthly (12/year)' },
] as const;
