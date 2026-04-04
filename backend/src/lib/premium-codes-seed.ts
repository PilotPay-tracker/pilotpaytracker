/**
 * PHASE 1 — UPS PREMIUM CODE LIBRARY SEED DATA (SINGLE SOURCE OF TRUTH)
 *
 * This file contains ALL hard-coded UPS premium codes.
 * These codes are NOT user-editable and represent official UPS contract premiums.
 *
 * BOTH Pay Code Library AND Log Event pages read from this single source.
 */

import { db } from '../db';

// ============================================
// TYPES
// ============================================

export type PremiumCategory =
  | 'reassignment'      // AP codes
  | 'reserve'           // Reserve-related premiums
  | 'schedule_revision' // LRP, timing changes
  | 'grievance'         // GT1, etc.
  | 'soft_max'          // APE, exceeding limits
  | 'late_arrival'      // LP1, LP2, RJA
  | 'other';            // Misc premiums

export type PremiumType =
  | 'minutes'     // Fixed credit addition (e.g., +2:00)
  | 'multiplier'  // Percentage-based (e.g., 1.5x)
  | 'manual';     // Requires user input (complex rules)

export interface PremiumVariant {
  variant_key: string;
  label: string;
  premium_type: PremiumType;
  premium_minutes?: number;
  premium_multiplier?: number;
  notes?: string;
}

export interface PremiumCodeSeed {
  code: string;
  title: string;
  description?: string;
  category: PremiumCategory;
  premiumType: PremiumType;
  premiumMinutes?: number;
  premiumMultiplier?: number;
  eligibility?: string;
  tripType?: string;
  contractRef?: string;
  notes?: string;
  variants?: PremiumVariant[];
  requiresInputs?: string[];
  applicableContext?: string[];
  triggerKeywords?: string[];
  sortOrder?: number;
  autoConnect?: boolean; // Auto-connects when used to add credit
}

// ============================================
// REASSIGNMENT PREMIUMS (AP0-AP9)
// ============================================
const REASSIGNMENT_CODES: PremiumCodeSeed[] = [
  {
    code: 'AP0',
    title: 'Domestic 757 Jumpseating',
    description: 'Premium for domestic 757 jumpseating assignments. Additional +4:00 if pilot jumpseats AND operates duty period >4:30.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Regular LH, VTO LH, OT Trip, JA Trip',
    tripType: 'Domestic',
    contractRef: '13.H.10.b.(6)',
    notes: 'Standard jumpseat premium. See variant for extended operations.',
    variants: [
      {
        variant_key: 'extended',
        label: 'Jumpseat + Operate >4:30',
        premium_type: 'minutes',
        premium_minutes: 240, // +4:00
        notes: 'When pilot jumpseats AND operates duty period exceeding 4:30',
      },
    ],
    applicableContext: ['jumpseat', 'assignment', 'deadhead'],
    triggerKeywords: ['jumpseat', 'jumpseating', '757', 'DH', 'deadhead'],
    sortOrder: 10,
  },
  {
    code: 'AP1',
    title: 'Extra Duty Period Added to Trip',
    description: 'Premium for additional duty period added to schedule via revision notification.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00 per revision notification
    eligibility: 'Regular LH, VTO LH, OT Trip, JA Trip, Trip Xfer FNP',
    tripType: 'Original / Revised',
    contractRef: '13.E.4.b',
    notes: 'Cap rules may apply. +2:00 per revision notification.',
    applicableContext: ['duty_added', 'schedule_change', 'revision'],
    triggerKeywords: ['extra duty', 'additional duty', 'duty added', 'duty period'],
    sortOrder: 20,
  },
  {
    code: 'AP2',
    title: 'Change of Layover',
    description: 'Premium for confirmed layover change. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Regular LH, VTO LH',
    tripType: 'Domestic / International',
    contractRef: '13.E.4.b.(2), 08-217',
    notes: 'Fixed +2:00 premium for layover changes. Auto-connects when used for credit.',
    applicableContext: ['layover_change', 'layover_shortened', 'layover_extended', 'layover_city_change'],
    triggerKeywords: ['layover', 'rest change', 'layover changed', 'layover shortened', 'hotel'],
    sortOrder: 30,
  },
  {
    code: 'AP3',
    title: 'Trip Canceled & Different Trip Substituted',
    description: 'Premium when original trip is canceled and pilot assigned to a different trip.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00 per revision notification
    eligibility: 'Regular LH, VTO LH, OT Trip, JA Trip',
    tripType: 'Original / Revised',
    contractRef: '13.E.4.b',
    notes: 'Cap rules may apply. +2:00 per revision notification.',
    applicableContext: ['trip_canceled', 'trip_substituted', 'reroute', 'reassignment'],
    triggerKeywords: ['canceled', 'cancelled', 'substituted', 'replaced', 'different trip'],
    sortOrder: 40,
  },
  {
    code: 'AP4',
    title: 'Replace High-Mins Captain / FAR Illegality',
    description: 'Premium for replacing another pilot due to high minutes or FAR illegality.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00 per revision notification
    eligibility: 'Regular LH, VTO LH, OT Trip, JA Trip, Trip Xfer FNP',
    tripType: 'Original / Revised',
    contractRef: '13.E.4.b',
    notes: 'Applies when replacing due to FAR illegality. Cap rules may apply.',
    applicableContext: ['replacement', 'illegality', 'far_violation', 'high_mins'],
    triggerKeywords: ['replace', 'replacement', 'illegality', 'FAR', 'high mins', 'crew swap'],
    sortOrder: 50,
  },
  {
    code: 'AP5',
    title: 'Swap Due to Own Illegality',
    description: 'Premium for swap caused by own illegality. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'All pilots',
    tripType: 'All',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['swap', 'illegality', 'own_illegality'],
    triggerKeywords: ['swap', 'own illegality', 'my illegality'],
    sortOrder: 60,
  },
  {
    code: 'AP6',
    title: 'Additional Segment Added',
    description: 'Premium for additional flight segment added to trip. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Regular LH, VTO LH',
    tripType: 'Original / Revised',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['leg_added', 'segment_added', 'route_change'],
    triggerKeywords: ['segment added', 'leg added', 'additional leg', 'extra leg', 'extra segment'],
    sortOrder: 70,
  },
  {
    code: 'AP7',
    title: 'Trip Begins >1 Hour Early',
    description: 'Premium when trip begins more than 1 hour before originally scheduled. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Regular LH, VTO LH',
    tripType: 'Revised',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['early_start', 'timing_change', 'report_time_change'],
    triggerKeywords: ['early', 'starts early', 'begins early', 'report early'],
    sortOrder: 80,
  },
  {
    code: 'AP8',
    title: 'Turn-for-Turn',
    description: 'Premium for turn-for-turn assignment. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Regular LH',
    tripType: 'Original',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['turn_for_turn'],
    triggerKeywords: ['turn for turn', 'turn-for-turn', 'TFT'],
    sortOrder: 90,
  },
  {
    code: 'AP9',
    title: 'FO to IRO for Another Crewmember Training',
    description: 'Premium for First Officer flying as IRO for another crewmember\'s training. Fixed +2:00 credit.',
    category: 'reassignment',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'First Officers',
    tripType: 'Training',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['training', 'iro', 'fo_to_iro'],
    triggerKeywords: ['IRO', 'training', 'FO to IRO', 'instructor'],
    sortOrder: 100,
  },
];

// ============================================
// RESERVE PREMIUMS
// ============================================
const RESERVE_CODES: PremiumCodeSeed[] = [
  {
    code: 'SVT',
    title: 'Reserve CQ Support / Turned-Out Rules',
    description: 'Premium for reserve CQ support or reserve turned-out rules application.',
    category: 'reserve',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Reserve pilots',
    tripType: 'Reserve',
    contractRef: '13.B.6.b.(17), 13.B.6.b.(7)',
    notes: 'Standard reserve premium for CQ support or turned out.',
    applicableContext: ['reserve', 'cq', 'turned_out', 'callout'],
    triggerKeywords: ['reserve', 'CQ', 'turned out', 'callout', 'on call'],
    sortOrder: 110,
  },
  {
    code: 'RT1',
    title: 'Reserve Turned Out 3rd Time During Peak',
    description: 'Premium for reserve pilot turned out for the third time during a peak period.',
    category: 'reserve',
    premiumType: 'manual',
    eligibility: 'Reserve pilots',
    tripType: 'Reserve / Peak Period',
    contractRef: '13.B.6.b.(7)(b)(vii)',
    notes: 'Manual minutes entry required - applies during peak periods only. Auto-connects when used for credit.',
    requiresInputs: ['peak_period_dates', 'turnout_count', 'credit_minutes'],
    applicableContext: ['reserve', 'turned_out', 'peak', 'third_turnout'],
    triggerKeywords: ['third time', 'turned out', 'reserve', 'peak', '3rd turnout'],
    sortOrder: 160,
    autoConnect: true, // Auto-connects when used to add credit
  },
];

// ============================================
// SCHEDULE REVISION PREMIUMS
// ============================================
const SCHEDULE_REVISION_CODES: PremiumCodeSeed[] = [
  {
    code: 'LRP',
    title: 'Line Revision Premium',
    description: 'Premium for line revision affecting pilot\'s schedule.',
    category: 'schedule_revision',
    premiumType: 'minutes',
    premiumMinutes: 360, // +6:00
    eligibility: 'Line holders',
    tripType: 'Original / Revised',
    contractRef: '13.E.4.f',
    notes: 'Significant premium for line revisions. +6:00 credit.',
    applicableContext: ['line_revision', 'schedule_change'],
    triggerKeywords: ['line revision', 'LRP', 'line change'],
    sortOrder: 130,
  },
  {
    code: 'PRM',
    title: 'No PRM Augmented 767',
    description: 'Premium for augmented 767 operations without PRM.',
    category: 'schedule_revision',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Pilots on 767 augmented ops',
    tripType: 'International',
    notes: 'Applies to 767 augmented operations without PRM.',
    applicableContext: ['augmented', '767', 'no_prm'],
    triggerKeywords: ['PRM', 'augmented', '767', 'no PRM'],
    sortOrder: 120,
  },
];

// ============================================
// GRIEVANCE PREMIUMS
// ============================================
const GRIEVANCE_CODES: PremiumCodeSeed[] = [
  {
    code: 'GT1',
    title: 'In Lieu of Grievance Premium',
    description: 'Premium granted in lieu of filing a grievance.',
    category: 'grievance',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00 (most cases)
    eligibility: 'All pilots',
    tripType: 'All',
    notes: 'Standard +2:00 premium. Fresh linen cases receive +1:00 variant.',
    variants: [
      {
        variant_key: 'fresh_linen',
        label: 'Fresh Linen',
        premium_type: 'minutes',
        premium_minutes: 60, // +1:00
        notes: 'For fresh linen-related grievances',
      },
    ],
    applicableContext: ['grievance', 'in_lieu', 'settlement'],
    triggerKeywords: ['grievance', 'in lieu', 'settlement', 'GT1'],
    sortOrder: 140,
  },
];

// ============================================
// SOFT MAX PREMIUMS
// ============================================
const SOFT_MAX_CODES: PremiumCodeSeed[] = [
  {
    code: 'APE',
    title: 'Exceeding Soft Max Premium',
    description: 'Premium for exceeding soft maximum limits (hours, duty, etc.). Fixed +2:00 credit.',
    category: 'soft_max',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'All pilots',
    tripType: 'All',
    contractRef: '13.A.1.a, 13.A.1.b, 13.A.1.e, 13.R.1',
    notes: 'Fixed +2:00 premium. Auto-connects when used for credit.',
    applicableContext: ['soft_max', 'exceeding_limits', 'overtime'],
    triggerKeywords: ['soft max', 'exceeding', 'limit exceeded', 'over max'],
    sortOrder: 150,
  },
];

// ============================================
// LATE ARRIVAL PREMIUMS (MULTIPLIER-BASED)
// ============================================
const LATE_ARRIVAL_CODES: PremiumCodeSeed[] = [
  {
    code: 'LP1',
    title: 'Late Arrival >4h After Scheduled Trip End',
    description: 'Premium for late arrival more than 4 hours after scheduled trip end. Paid at 150% for time beyond threshold.',
    category: 'late_arrival',
    premiumType: 'multiplier',
    premiumMultiplier: 1.5, // 150%
    eligibility: 'All pilots',
    tripType: 'Domestic / International',
    contractRef: '13.E.4.e.(1),(2)',
    notes: 'Applied to credit hours from 4h after scheduled end to actual arrival. Requires OOOI data.',
    requiresInputs: ['scheduled_trip_end', 'actual_release', 'hourly_rate'],
    applicableContext: ['late_arrival', 'duty_extension', 'delay'],
    triggerKeywords: ['late arrival', 'late', '4 hours', 'delayed', 'LP1'],
    sortOrder: 200,
  },
  {
    code: 'LP2',
    title: 'Late Arrival >25h Dom / >50h Intl After Scheduled End',
    description: 'Premium for extreme late arrivals exceeding 25h (domestic) or 50h (international) after scheduled trip end.',
    category: 'late_arrival',
    premiumType: 'multiplier',
    premiumMultiplier: 2.5, // 250%
    eligibility: 'All pilots',
    tripType: 'Domestic >25h / International >50h',
    contractRef: '13.E.5.c',
    notes: '250% rate applies. 25 hours domestic threshold, 50 hours international threshold.',
    requiresInputs: ['scheduled_trip_end', 'actual_release', 'trip_type', 'hourly_rate'],
    applicableContext: ['late_arrival', 'extreme_delay'],
    triggerKeywords: ['late', '25 hours', '50 hours', 'extreme', 'LP2'],
    sortOrder: 210,
  },
  {
    code: 'RJA',
    title: 'Late Arrival >2h Into Calendar Day Off',
    description: 'Premium for late arrival extending more than 2 hours into scheduled calendar day off.',
    category: 'late_arrival',
    premiumType: 'multiplier',
    premiumMultiplier: 1.5, // 150%
    eligibility: 'All pilots',
    tripType: 'All',
    contractRef: '13.B.6.c.(2)(a)',
    notes: 'Applied to hours worked into day off beyond 2h threshold.',
    requiresInputs: ['day_off_start', 'actual_release', 'hourly_rate'],
    applicableContext: ['late_arrival', 'day_off_encroachment', 'overtime'],
    triggerKeywords: ['day off', 'late into', 'encroachment', 'RJA'],
    sortOrder: 220,
  },
];

// ============================================
// JUNIOR ASSIGNMENT PREMIUMS
// ============================================
const JUNIOR_ASSIGNMENT_CODES: PremiumCodeSeed[] = [
  {
    code: 'JA',
    title: 'Junior Assignment',
    description: 'Junior Available / Junior Assignment. Pilot assigned as junior-most qualified. Paid at 150% of normal credit for the entire trip.',
    category: 'reassignment',
    premiumType: 'multiplier',
    premiumMultiplier: 1.5, // 150%
    eligibility: 'All pilots',
    tripType: 'All',
    contractRef: '13.H.3',
    notes: 'Entire trip pay multiplied at 150%. Applies when pilot is junior-most qualified for the assignment.',
    applicableContext: ['junior_assignment', 'junior_available', 'ja_trip', 'reassignment'],
    triggerKeywords: ['JA', 'junior assignment', 'junior available', 'junior most'],
    sortOrder: 5,
  },
];

// ============================================
// OTHER PREMIUMS
// ============================================
const OTHER_CODES: PremiumCodeSeed[] = [
  {
    code: 'DOD_JS',
    title: 'DOD Jumpseater Excess (Not Performing Cargo Duties)',
    description: 'Premium for DOD jumpseater when pilot is not performing cargo-related duties.',
    category: 'other',
    premiumType: 'minutes',
    premiumMinutes: 120, // +2:00
    eligibility: 'Pilots on DOD missions',
    tripType: 'DOD / Military',
    contractRef: '16.E',
    notes: 'Applies if pilot is jumpseating but not performing cargo-related duties.',
    applicableContext: ['dod', 'jumpseat', 'military'],
    triggerKeywords: ['DOD', 'jumpseater', 'military', 'cargo'],
    sortOrder: 170,
  },
];

// ============================================
// COMBINED EXPORT
// ============================================
export const ALL_PREMIUM_CODES: PremiumCodeSeed[] = [
  ...JUNIOR_ASSIGNMENT_CODES,
  ...REASSIGNMENT_CODES,
  ...RESERVE_CODES,
  ...SCHEDULE_REVISION_CODES,
  ...GRIEVANCE_CODES,
  ...SOFT_MAX_CODES,
  ...LATE_ARRIVAL_CODES,
  ...OTHER_CODES,
];

// ============================================
// SEED FUNCTION
// ============================================

/**
 * Seed the premium codes table
 * This is idempotent - it will update existing codes or create new ones
 */
export async function seedPremiumCodes(): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const code of ALL_PREMIUM_CODES) {
    const existing = await db.premiumCode.findUnique({
      where: { code: code.code },
    });

    const data = {
      code: code.code,
      title: code.title,
      name: code.title, // Backwards compatibility
      description: code.description ?? null,
      category: code.category,
      premiumType: code.premiumType,
      premiumMinutes: code.premiumMinutes ?? null,
      premiumMultiplier: code.premiumMultiplier ?? null,
      eligibility: code.eligibility ?? null,
      eligibilityText: code.eligibility ?? null, // Backwards compatibility
      tripType: code.tripType ?? null,
      contractRef: code.contractRef ?? null,
      notes: code.notes ?? null,
      variantsJson: code.variants ? JSON.stringify(code.variants) : null,
      hasVariants: (code.variants?.length ?? 0) > 0,
      variantDescription: code.variants?.[0]?.label ?? null, // Backwards compatibility
      variantMinutes: code.variants?.[0]?.premium_minutes ?? null, // Backwards compatibility
      requiresInputsJson: code.requiresInputs ? JSON.stringify(code.requiresInputs) : null,
      applicableContext: code.applicableContext ? JSON.stringify(code.applicableContext) : null,
      triggerKeywords: code.triggerKeywords ? JSON.stringify(code.triggerKeywords) : null,
      sortOrder: code.sortOrder ?? 100,
      isActive: true,
      autoConnect: code.autoConnect ?? false,
    };

    if (existing) {
      await db.premiumCode.update({
        where: { code: code.code },
        data,
      });
      updated++;
    } else {
      await db.premiumCode.create({ data });
      created++;
    }
  }

  console.log(`✅ [PremiumCodes] Seeded ${created} new codes, updated ${updated} existing codes`);

  return { created, updated };
}

// ============================================
// GETTER FUNCTIONS (SINGLE SOURCE OF TRUTH)
// ============================================

/**
 * Get premium code by code string - THE CANONICAL LOOKUP
 * Use this everywhere to ensure consistency
 */
export async function getPremiumCode(code: string) {
  return db.premiumCode.findUnique({
    where: { code: code.toUpperCase() },
  });
}

/**
 * Get all active premium codes
 */
export async function getAllPremiumCodes() {
  return db.premiumCode.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Get premium codes by category
 */
export async function getPremiumCodesByCategory(category: PremiumCategory) {
  return db.premiumCode.findMany({
    where: {
      isActive: true,
      category,
    },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Get premium codes by type
 */
export async function getPremiumCodesByType(premiumType: PremiumType) {
  return db.premiumCode.findMany({
    where: {
      isActive: true,
      premiumType,
    },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Get premium codes by context (for auto-suggestion)
 */
export async function getPremiumCodesByContext(context: string) {
  const codes = await db.premiumCode.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  // Filter by context
  return codes.filter(code => {
    if (!code.applicableContext) return false;
    try {
      const contexts = JSON.parse(code.applicableContext) as string[];
      return contexts.includes(context);
    } catch {
      return false;
    }
  });
}

// ============================================
// CALCULATION HELPERS
// ============================================

/**
 * Calculate premium pay for a fixed-minutes premium
 */
export function calculateFixedPremiumPay(
  premiumMinutes: number,
  hourlyRateCents: number
): number {
  return Math.round((premiumMinutes / 60) * hourlyRateCents);
}

/**
 * Format minutes as HH:MM string
 */
export function formatMinutesAsTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Format premium result for display
 */
export function formatPremiumResult(code: {
  premiumType: string;
  premiumMinutes?: number | null;
  premiumMultiplier?: number | null;
}): string {
  if (code.premiumType === 'minutes' && code.premiumMinutes) {
    return `+${formatMinutesAsTime(code.premiumMinutes)}`;
  }
  if (code.premiumType === 'multiplier' && code.premiumMultiplier) {
    return `${Math.round(code.premiumMultiplier * 100)}%`;
  }
  return 'Manual';
}

/**
 * Calculate premium pay for a multiplier-based premium (late arrival)
 */
export interface LateArrivalCalculation {
  scheduledEndISO: string;
  actualArrivalISO: string;
  hourlyRateCents: number;
  multiplier: number;
}

export function calculateMultiplierPremiumPay(params: LateArrivalCalculation): {
  lateMinutes: number;
  basePayCents: number;
  premiumPayCents: number;
  totalPayCents: number;
} {
  const scheduledEnd = new Date(params.scheduledEndISO);
  const actualArrival = new Date(params.actualArrivalISO);

  // Calculate late minutes (actual - scheduled)
  const lateMinutes = Math.max(0, Math.round((actualArrival.getTime() - scheduledEnd.getTime()) / 60000));

  // Base pay for the late period
  const basePayCents = Math.round((lateMinutes / 60) * params.hourlyRateCents);

  // Premium is (multiplier - 1) * base pay
  const premiumPayCents = Math.round(basePayCents * (params.multiplier - 1));

  // Total pay = base + premium
  const totalPayCents = basePayCents + premiumPayCents;

  return {
    lateMinutes,
    basePayCents,
    premiumPayCents,
    totalPayCents,
  };
}

// ============================================
// CATEGORY DISPLAY HELPERS
// ============================================

export const CATEGORY_DISPLAY_NAMES: Record<PremiumCategory, string> = {
  reassignment: 'Reassignment (AP)',
  reserve: 'Reserve',
  schedule_revision: 'Schedule Revision',
  grievance: 'Grievance',
  soft_max: 'Soft Max',
  late_arrival: 'Late Arrival',
  other: 'Other',
};

export const CATEGORY_ORDER: PremiumCategory[] = [
  'reassignment',
  'reserve',
  'schedule_revision',
  'grievance',
  'soft_max',
  'late_arrival',
  'other',
];
