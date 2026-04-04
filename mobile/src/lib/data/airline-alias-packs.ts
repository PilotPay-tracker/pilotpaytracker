/**
 * UPS Alias Pack
 *
 * Maps canonical rule IDs to UPS-specific terminology.
 * The calculation logic uses canonical IDs internally, but the UI
 * displays UPS-native terms.
 *
 * This is a DISPLAY LAYER only - it does not change calculation logic.
 *
 * Built by a UPS pilot for UPS pilots.
 */

// ============================================
// CANONICAL RULE IDS (Internal - Never Change)
// ============================================

export const CANONICAL_RULES = {
  // Daily Guarantees
  MIN_DAILY_CREDIT: "MIN_DAILY_CREDIT",
  TRIP_GUARANTEE: "TRIP_GUARANTEE",

  // Pay Protection
  PAY_PROTECTION_GUARANTEE: "PAY_PROTECTION_GUARANTEE",
  SICK_PAY: "SICK_PAY",
  VACATION_PAY: "VACATION_PAY",

  // Duty & Extensions
  DUTY_EXTENSION: "DUTY_EXTENSION",
  DUTY_PERIOD_LIMIT: "DUTY_PERIOD_LIMIT",

  // Reassignment & Changes
  REASSIGNMENT: "REASSIGNMENT",
  JUNIOR_ASSIGNMENT: "JUNIOR_ASSIGNMENT",
  SCHEDULE_CHANGE: "SCHEDULE_CHANGE",

  // Premium Pay
  PREMIUM_TRIGGER: "PREMIUM_TRIGGER",
  AIRPORT_RESERVE: "AIRPORT_RESERVE",
  SHORT_CALL_RESERVE: "SHORT_CALL_RESERVE",
  LONG_CALL_RESERVE: "LONG_CALL_RESERVE",
  TRAINING_PAY: "TRAINING_PAY",

  // Deadhead
  DEADHEAD_PAY: "DEADHEAD_PAY",
  COMMERCIAL_DEADHEAD: "COMMERCIAL_DEADHEAD",

  // Overtime / Limits
  MONTHLY_MAX: "MONTHLY_MAX",
  ROLLING_30_IN_7: "ROLLING_30_IN_7",

  // Per Diem
  PER_DIEM: "PER_DIEM",
  INTERNATIONAL_PER_DIEM: "INTERNATIONAL_PER_DIEM",
} as const;

export type CanonicalRuleId = keyof typeof CANONICAL_RULES;

// ============================================
// RULE CATEGORIES
// ============================================

export const RULE_CATEGORIES = {
  DAILY_GUARANTEES: "Daily Guarantees",
  PREMIUM_PAY: "Premium Pay",
  DUTY_LIMITS: "Duty Limits",
  PAY_PROTECTION: "Pay Protection",
  REASSIGNMENT: "Reassignment & Changes",
  RESERVE: "Reserve Pay",
  DEADHEAD: "Deadhead",
  PER_DIEM: "Per Diem & Expenses",
} as const;

export type RuleCategory = keyof typeof RULE_CATEGORIES;

// ============================================
// ALIAS DEFINITION TYPE
// ============================================

export interface RuleAlias {
  /** What pilots see in the app */
  displayName: string;
  /** Short code (e.g., "MDC", "JA") */
  shortCode?: string;
  /** Glossary/help text */
  description: string;
  /** Which category this belongs to */
  category: RuleCategory;
  /** Default value (minutes or cents depending on rule type) */
  defaultValue?: number;
  /** Default toggle state */
  defaultEnabled?: boolean;
}

export interface AirlineAliasPack {
  /** Airline identifier */
  airlineId: string;
  /** Display name */
  airlineName: string;
  /** Operator type */
  operatorType: "cargo" | "passenger" | "corporate" | "charter";
  /** Version for cache invalidation */
  version: string;
  /** Rule aliases mapped by canonical ID */
  rules: Partial<Record<CanonicalRuleId, RuleAlias>>;
  /** Common terms/jargon specific to this airline */
  glossary: Record<string, string>;
}

// ============================================
// UPS ALIAS PACK (Primary and Only)
// ============================================

export const UPS_ALIAS_PACK: AirlineAliasPack = {
  airlineId: "UPS",
  airlineName: "UPS Airlines",
  operatorType: "cargo",
  version: "1.0.0",
  rules: {
    MIN_DAILY_CREDIT: {
      displayName: "Minimum Daily Credit",
      shortCode: "MDC",
      description: "Minimum credit hours guaranteed per duty day (typically 6:00)",
      category: "DAILY_GUARANTEES",
      defaultValue: 360, // 6 hours in minutes
      defaultEnabled: true,
    },
    TRIP_GUARANTEE: {
      displayName: "Trip Guarantee",
      shortCode: "TG",
      description: "Minimum credit guaranteed for the entire trip/pairing",
      category: "DAILY_GUARANTEES",
      defaultValue: 0,
      defaultEnabled: true,
    },
    PAY_PROTECTION_GUARANTEE: {
      displayName: "Pay Protection",
      shortCode: "PP",
      description: "Guaranteed pay when removed from flying due to company action",
      category: "PAY_PROTECTION",
      defaultEnabled: true,
    },
    SICK_PAY: {
      displayName: "Sick Pay",
      shortCode: "SICK",
      description: "Pay for sick leave usage",
      category: "PAY_PROTECTION",
      defaultEnabled: true,
    },
    VACATION_PAY: {
      displayName: "Vacation Pay",
      shortCode: "VAC",
      description: "Pay for vacation days",
      category: "PAY_PROTECTION",
      defaultEnabled: true,
    },
    DUTY_EXTENSION: {
      displayName: "Duty Extension",
      shortCode: "EXT",
      description: "Additional pay when duty period extends beyond scheduled release",
      category: "DUTY_LIMITS",
      defaultEnabled: true,
    },
    DUTY_PERIOD_LIMIT: {
      displayName: "Duty Period Limit",
      shortCode: "DPL",
      description: "Maximum scheduled duty period hours",
      category: "DUTY_LIMITS",
      defaultValue: 840, // 14 hours in minutes
      defaultEnabled: true,
    },
    REASSIGNMENT: {
      displayName: "Reassignment",
      shortCode: "RA",
      description: "Reassigned to a different trip after check-in or report",
      category: "REASSIGNMENT",
      defaultEnabled: true,
    },
    JUNIOR_ASSIGNMENT: {
      displayName: "Junior Assignment",
      shortCode: "JA",
      description: "Drafted/assigned flying in seniority order (junior first)",
      category: "REASSIGNMENT",
      defaultEnabled: true,
    },
    SCHEDULE_CHANGE: {
      displayName: "Schedule Change",
      shortCode: "SC",
      description: "Schedule modified after original publication",
      category: "REASSIGNMENT",
      defaultEnabled: true,
    },
    PREMIUM_TRIGGER: {
      displayName: "Premium Pay",
      shortCode: "PREM",
      description: "Additional pay triggered by specific conditions",
      category: "PREMIUM_PAY",
      defaultEnabled: true,
    },
    AIRPORT_RESERVE: {
      displayName: "Airport Reserve",
      shortCode: "AR",
      description: "Reserve duty at the airport ready room",
      category: "RESERVE",
      defaultEnabled: true,
    },
    SHORT_CALL_RESERVE: {
      displayName: "Short Call Reserve",
      shortCode: "SCR",
      description: "Reserve with short notice call-out window",
      category: "RESERVE",
      defaultEnabled: true,
    },
    LONG_CALL_RESERVE: {
      displayName: "Long Call Reserve",
      shortCode: "LCR",
      description: "Reserve with longer notice call-out window",
      category: "RESERVE",
      defaultEnabled: true,
    },
    TRAINING_PAY: {
      displayName: "Training Pay",
      shortCode: "TRN",
      description: "Pay for training events and check rides",
      category: "PREMIUM_PAY",
      defaultEnabled: true,
    },
    DEADHEAD_PAY: {
      displayName: "Deadhead",
      shortCode: "DH",
      description: "Credit for positioning flights as passenger",
      category: "DEADHEAD",
      defaultEnabled: true,
    },
    COMMERCIAL_DEADHEAD: {
      displayName: "Commercial Deadhead",
      shortCode: "CDH",
      description: "Deadhead on commercial airline",
      category: "DEADHEAD",
      defaultEnabled: true,
    },
    MONTHLY_MAX: {
      displayName: "Monthly Maximum",
      shortCode: "MAX",
      description: "Maximum flight hours per calendar month",
      category: "DUTY_LIMITS",
      defaultValue: 5400, // 90 hours in minutes
      defaultEnabled: true,
    },
    ROLLING_30_IN_7: {
      displayName: "30-in-7 Limit",
      shortCode: "30/7",
      description: "Maximum flight time in any rolling 7-day period",
      category: "DUTY_LIMITS",
      defaultValue: 1800, // 30 hours in minutes
      defaultEnabled: true,
    },
    PER_DIEM: {
      displayName: "Per Diem",
      shortCode: "PD",
      description: "Daily expense allowance while on trip",
      category: "PER_DIEM",
      defaultEnabled: true,
    },
    INTERNATIONAL_PER_DIEM: {
      displayName: "International Per Diem",
      shortCode: "IPD",
      description: "Enhanced per diem rate for international layovers",
      category: "PER_DIEM",
      defaultEnabled: true,
    },
  },
  glossary: {
    "GEMS": "Global Employee Management System - UPS employee portal",
    "Trip Board": "Crew scheduling system showing trip assignments",
    "Pairing": "Multi-day trip sequence assigned to a crew",
    "TAFB": "Time Away From Base - total trip duration",
    "Block": "Time from gate departure to gate arrival",
    "Credit": "Pay-credited time (may differ from block)",
    "Deadhead": "Positioning as passenger to/from assignment",
    "JA": "Junior Assignment - draft assignment by seniority",
    "RA": "Reassignment - moved to different trip after check-in",
    "MDC": "Minimum Daily Credit - guaranteed daily minimum",
    "Ready Reserve": "Reserve status ready for immediate assignment",
    "Gateway": "Hub airport (SDF, ONT, etc.)",
  },
};

// ============================================
// PACK REGISTRY & HELPERS
// ============================================

// Default alias pack (same as UPS - this is a UPS-only app)
export const DEFAULT_ALIAS_PACK = UPS_ALIAS_PACK;

// All lookups return UPS pack - this is a UPS-only app
export const ALIAS_PACK_REGISTRY: Record<string, AirlineAliasPack> = {
  UPS: UPS_ALIAS_PACK,
};

/**
 * Get the alias pack for a given airline (always returns UPS pack)
 */
export function getAliasPack(_airlineId: string): AirlineAliasPack {
  return UPS_ALIAS_PACK;
}

/**
 * Get display name for a canonical rule ID
 */
export function getRuleDisplayName(
  airlineId: string,
  canonicalId: CanonicalRuleId
): string {
  const pack = getAliasPack(airlineId);
  return pack.rules[canonicalId]?.displayName ?? canonicalId.replace(/_/g, " ");
}

/**
 * Get short code for a canonical rule ID
 */
export function getRuleShortCode(
  airlineId: string,
  canonicalId: CanonicalRuleId
): string | undefined {
  const pack = getAliasPack(airlineId);
  return pack.rules[canonicalId]?.shortCode;
}

/**
 * Get description for a canonical rule ID
 */
export function getRuleDescription(
  airlineId: string,
  canonicalId: CanonicalRuleId
): string {
  const pack = getAliasPack(airlineId);
  return pack.rules[canonicalId]?.description ?? "";
}

/**
 * Get glossary term definition
 */
export function getGlossaryTerm(
  airlineId: string,
  term: string
): string | undefined {
  const pack = getAliasPack(airlineId);
  return pack.glossary[term];
}

/**
 * Get all glossary terms for an airline
 */
export function getGlossary(airlineId: string): Record<string, string> {
  const pack = getAliasPack(airlineId);
  return pack.glossary;
}

/**
 * UPS is the only supported airline - this app is built by a UPS pilot for UPS pilots
 */
export const SUPPORTED_AIRLINES = [
  { id: "UPS", name: "UPS Airlines", type: "cargo" },
] as const;

export type SupportedAirlineId = (typeof SUPPORTED_AIRLINES)[number]["id"];
export type AirlineType = (typeof SUPPORTED_AIRLINES)[number]["type"];

// ============================================
// PAY CONFIDENCE MODE
// ============================================

/**
 * Pay Confidence Mode - UPS has verified pay calculations
 */
export type PayConfidenceMode = "verified" | "ai_guided";

/**
 * UPS has Verified Pay Mode (high-confidence automation)
 */
export const VERIFIED_PAY_AIRLINES: SupportedAirlineId[] = ["UPS"];

/**
 * No airlines in AI-Guided mode (UPS is verified)
 */
export const AI_GUIDED_PAY_AIRLINES: SupportedAirlineId[] = [];

/**
 * Get the pay confidence mode - always verified for UPS
 */
export function getPayConfidenceMode(_airlineId: string): PayConfidenceMode {
  return "verified";
}

/**
 * Check if an airline has verified pay mode - always true for UPS
 */
export function isVerifiedPayAirline(_airlineId: string): boolean {
  return true;
}

/**
 * Get display label for pay amounts - always "Verified" for UPS
 */
export function getPayConfidenceLabel(_airlineId: string): string {
  return "Verified";
}

/**
 * Get description for pay confidence mode
 */
export function getPayConfidenceDescription(_airlineId: string): string {
  return "Pay calculations are fully automated with verified dollar amounts based on the UPS CBA contract rules.";
}
