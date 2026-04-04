/**
 * UPS Terminology Pack
 *
 * UPS-specific terminology used for:
 * - Glossary display
 * - AI keyword suggestions for contract search
 * - Search synonyms (codes/terms)
 * - UI labels (reference-only, not pay logic)
 *
 * IMPORTANT: Terminology Packs are NOT contract text.
 * They are general pilot-used terms and synonyms to improve usability.
 * All contract references/excerpts come ONLY from user-uploaded documents.
 *
 * Built by a UPS pilot for UPS pilots.
 */

// ============================================
// TERM CATEGORIES
// ============================================

export type TermCategory =
  | "Scheduling"
  | "Pay"
  | "Reserve"
  | "Trade"
  | "Training"
  | "Deadhead"
  | "Duty"
  | "Benefits"
  | "Other";

// ============================================
// TERMINOLOGY TERM INTERFACE
// ============================================

export interface TerminologyTerm {
  /** Normalized key for internal reference */
  termKey: string;
  /** What user sees */
  displayTerm: string;
  /** Category for grouping */
  category: TermCategory;
  /** Plain-English definition (1-2 lines) */
  neutralSummary: string;
  /** Search helper synonyms */
  synonyms: string[];
  /** Optional tags for filtering */
  tags?: string[];
}

export interface TerminologyPack {
  /** Airline ID */
  airlineId: string;
  /** Display name */
  displayName: string;
  /** Pack version for cache invalidation */
  version: string;
  /** Last updated date */
  updatedAt: string;
  /** Array of terms */
  terms: TerminologyTerm[];
}

// ============================================
// UPS AIRLINES TERMINOLOGY PACK
// ============================================

export const UPS_TERMINOLOGY_PACK: TerminologyPack = {
  airlineId: "UPS",
  displayName: "UPS Airlines",
  version: "v1",
  updatedAt: "2026-01-10",
  terms: [
    {
      termKey: "junior_available",
      displayTerm: "Junior Available",
      category: "Scheduling",
      neutralSummary: "Assignment to junior pilot after report.",
      synonyms: ["JA"],
    },
    {
      termKey: "reassignment",
      displayTerm: "Reassignment",
      category: "Scheduling",
      neutralSummary: "Trip or leg changed by scheduling.",
      synonyms: ["RA", "reroute"],
    },
    {
      termKey: "airport_reserve",
      displayTerm: "Airport Reserve",
      category: "Reserve",
      neutralSummary: "Reserve duty at the ready room.",
      synonyms: ["AP", "AR"],
    },
    {
      termKey: "long_range_premium",
      displayTerm: "Long Range Premium",
      category: "Pay",
      neutralSummary: "Premium for international long-haul flights.",
      synonyms: ["LRP"],
    },
    {
      termKey: "min_daily_credit",
      displayTerm: "Minimum Daily Credit",
      category: "Pay",
      neutralSummary: "Guaranteed minimum credit per duty day (6:00).",
      synonyms: ["MDC", "daily minimum"],
    },
    {
      termKey: "deadhead",
      displayTerm: "Deadhead",
      category: "Deadhead",
      neutralSummary: "Positioning as passenger.",
      synonyms: ["DH"],
    },
    {
      termKey: "call_out",
      displayTerm: "Call-Out",
      category: "Reserve",
      neutralSummary: "Contact from scheduling affecting duty.",
      synonyms: ["callout"],
    },
    {
      termKey: "gateway",
      displayTerm: "Gateway",
      category: "Other",
      neutralSummary: "Hub airport (SDF, ONT, etc.).",
      synonyms: ["hub"],
    },
    {
      termKey: "trip_guarantee",
      displayTerm: "Trip Guarantee",
      category: "Pay",
      neutralSummary: "Minimum credit guaranteed for a trip.",
      synonyms: ["TG", "pairing guarantee"],
    },
    {
      termKey: "pay_protection",
      displayTerm: "Pay Protection",
      category: "Pay",
      neutralSummary: "Guaranteed pay when removed from flying.",
      synonyms: ["PP", "guarantee"],
    },
    {
      termKey: "duty_extension",
      displayTerm: "Duty Extension",
      category: "Duty",
      neutralSummary: "Duty period extended beyond scheduled release.",
      synonyms: ["extension", "late arrival"],
    },
    {
      termKey: "short_call_reserve",
      displayTerm: "Short Call Reserve",
      category: "Reserve",
      neutralSummary: "Reserve with short notice call-out window.",
      synonyms: ["SCR", "short call"],
    },
    {
      termKey: "long_call_reserve",
      displayTerm: "Long Call Reserve",
      category: "Reserve",
      neutralSummary: "Reserve with longer notice call-out window.",
      synonyms: ["LCR", "long call"],
    },
    {
      termKey: "tafb",
      displayTerm: "Time Away From Base",
      category: "Pay",
      neutralSummary: "Total trip duration for per diem calculation.",
      synonyms: ["TAFB"],
    },
    {
      termKey: "block_time",
      displayTerm: "Block Time",
      category: "Pay",
      neutralSummary: "Time from gate departure to gate arrival.",
      synonyms: ["block", "gate-to-gate"],
    },
    {
      termKey: "credit_time",
      displayTerm: "Credit Time",
      category: "Pay",
      neutralSummary: "Pay-credited time (may differ from block).",
      synonyms: ["credit", "CR"],
    },
    {
      termKey: "training_event",
      displayTerm: "Training Event",
      category: "Training",
      neutralSummary: "Simulator or qualification activity.",
      synonyms: ["sim", "recurrent", "checkride"],
    },
    {
      termKey: "trip_trade",
      displayTerm: "Trip Trade",
      category: "Trade",
      neutralSummary: "Exchange of trips between pilots.",
      synonyms: ["swap", "trade"],
    },
    {
      termKey: "open_time",
      displayTerm: "Open Time",
      category: "Scheduling",
      neutralSummary: "Unassigned flying available for pickup.",
      synonyms: ["open flying", "pickup"],
    },
    {
      termKey: "per_diem",
      displayTerm: "Per Diem",
      category: "Benefits",
      neutralSummary: "Daily expense allowance while on trip.",
      synonyms: ["PD", "meal money"],
    },
    {
      termKey: "gems",
      displayTerm: "GEMS",
      category: "Other",
      neutralSummary: "Global Employee Management System - UPS employee portal.",
      synonyms: ["employee portal"],
    },
    {
      termKey: "crew_access",
      displayTerm: "Crew Access",
      category: "Other",
      neutralSummary: "UPS crew scheduling system.",
      synonyms: ["scheduling system", "trip board"],
    },
  ],
};

// ============================================
// TERMINOLOGY PACK REGISTRY
// ============================================

export const TERMINOLOGY_PACK_REGISTRY: Record<string, TerminologyPack> = {
  UPS: UPS_TERMINOLOGY_PACK,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get terminology pack - always returns UPS pack
 */
export function getTerminologyPack(_airlineId: string): TerminologyPack {
  return UPS_TERMINOLOGY_PACK;
}

/**
 * Get all terms for UPS
 */
export function getTermsForAirline(_airlineId: string): TerminologyTerm[] {
  return UPS_TERMINOLOGY_PACK.terms;
}

/**
 * Get terms by category
 */
export function getTermsByCategory(
  _airlineId: string,
  category: TermCategory
): TerminologyTerm[] {
  return UPS_TERMINOLOGY_PACK.terms.filter((t) => t.category === category);
}

/**
 * Search terms across UPS terminology pack
 * Searches displayTerm, neutralSummary, and synonyms
 */
export function searchTerminology(
  _airlineId: string,
  query: string
): TerminologyTerm[] {
  const queryLower = query.toLowerCase().trim();

  if (!queryLower) return UPS_TERMINOLOGY_PACK.terms;

  return UPS_TERMINOLOGY_PACK.terms.filter((term) => {
    return (
      term.displayTerm.toLowerCase().includes(queryLower) ||
      term.neutralSummary.toLowerCase().includes(queryLower) ||
      term.termKey.toLowerCase().includes(queryLower) ||
      term.synonyms.some((s) => s.toLowerCase().includes(queryLower))
    );
  });
}

/**
 * Get synonyms for a search term (useful for AI-assisted contract search)
 */
export function getSynonymsForTerm(
  _airlineId: string,
  searchTerm: string
): string[] {
  const termLower = searchTerm.toLowerCase().trim();
  const synonyms: Set<string> = new Set();

  for (const term of UPS_TERMINOLOGY_PACK.terms) {
    // Check if searchTerm matches this terminology term
    const matches =
      term.displayTerm.toLowerCase().includes(termLower) ||
      term.termKey.toLowerCase().includes(termLower) ||
      term.synonyms.some((s) => s.toLowerCase() === termLower);

    if (matches) {
      // Add all synonyms for this term
      term.synonyms.forEach((s) => synonyms.add(s));
      synonyms.add(term.displayTerm);
    }
  }

  return Array.from(synonyms);
}

/**
 * Get all available categories
 */
export function getAllCategories(): TermCategory[] {
  return [
    "Scheduling",
    "Pay",
    "Reserve",
    "Trade",
    "Training",
    "Deadhead",
    "Duty",
    "Benefits",
    "Other",
  ];
}

/**
 * Get all airline IDs that have terminology packs (just UPS)
 */
export function getAvailableAirlineIds(): string[] {
  return ["UPS"];
}
