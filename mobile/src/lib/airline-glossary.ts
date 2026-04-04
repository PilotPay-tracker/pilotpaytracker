/**
 * UPS Glossary Terms
 *
 * Maps UPS-specific terminology to universal pay event types.
 * These terms are display/reference-only and do not affect pay calculations.
 *
 * Built by a UPS pilot for UPS pilots.
 *
 * Universal Pay Event Keys (Canonical):
 * - schedule_change_after_report
 * - reassignment
 * - duty_extension
 * - premium_pay_trigger
 * - pay_protection_event
 * - deadhead_added
 * - training_event
 * - reserve_event
 * - draft_event
 * - per_diem_adjustment
 */

// Re-export from terminology packs for backward compatibility
export {
  getTerminologyPack,
  getTermsForAirline,
  getTermsByCategory,
  searchTerminology,
  getSynonymsForTerm,
  getAllCategories,
  getAvailableAirlineIds,
  TERMINOLOGY_PACK_REGISTRY,
  type TerminologyTerm,
  type TerminologyPack,
  type TermCategory,
} from "@/lib/data/terminology-packs";

export type UniversalPayEventKey =
  | "schedule_change_after_report"
  | "reassignment"
  | "duty_extension"
  | "premium_pay_trigger"
  | "pay_protection_event"
  | "deadhead_added"
  | "training_event"
  | "reserve_event"
  | "draft_event"
  | "per_diem_adjustment";

// UPS-only airline code
export type AirlineCode = "UPS";

export interface GlossaryTerm {
  /** Airline-specific abbreviation (e.g., "JA", "DH") */
  abbreviation: string;
  /** Full name of the term */
  longName: string;
  /** Universal pay event key this maps to */
  mapsTo: UniversalPayEventKey;
  /** Plain-English definition */
  definition: string;
  /** Optional example scenario */
  example?: string;
}

export interface AirlineGlossary {
  code: AirlineCode;
  name: string;
  type: "cargo" | "mainline" | "fractional" | "charter" | "regional";
  terms: GlossaryTerm[];
}

// Universal pay event definitions
export const UNIVERSAL_PAY_EVENTS: Record<
  UniversalPayEventKey,
  { name: string; description: string }
> = {
  schedule_change_after_report: {
    name: "Schedule Change After Report",
    description:
      "Assignment or change to schedule that occurs after the pilot has reported for duty or checked in.",
  },
  reassignment: {
    name: "Reassignment",
    description:
      "Trip, pairing, or leg changed by scheduling to different flying than originally assigned.",
  },
  duty_extension: {
    name: "Duty Extension",
    description:
      "Duty day extended beyond the originally scheduled arrival or release time.",
  },
  premium_pay_trigger: {
    name: "Premium Pay Trigger",
    description:
      "Event that may qualify for additional compensation beyond base pay.",
  },
  pay_protection_event: {
    name: "Pay Protection Event",
    description:
      "Event that triggers pay protection due to schedule changes, cancellations, or other qualifying circumstances.",
  },
  deadhead_added: {
    name: "Deadhead Added",
    description:
      "Travel as a passenger assigned by the company for positioning purposes.",
  },
  training_event: {
    name: "Training Event",
    description:
      "Training, simulator, or other required training activity affecting pay.",
  },
  reserve_event: {
    name: "Reserve Event",
    description:
      "Reserve duty activation, call-out, or related reserve status event.",
  },
  draft_event: {
    name: "Draft Event",
    description:
      "Involuntary assignment to flying, typically based on seniority.",
  },
  per_diem_adjustment: {
    name: "Per Diem Adjustment",
    description:
      "Adjustment to per diem or expense reimbursement based on duty changes.",
  },
};

// UPS glossary data - this is a UPS-only app
export const AIRLINE_GLOSSARIES: AirlineGlossary[] = [
  {
    code: "UPS",
    name: "UPS Airlines",
    type: "cargo",
    terms: [
      {
        abbreviation: "JA",
        longName: "Junior Available",
        mapsTo: "schedule_change_after_report",
        definition:
          "Assignment or change to a junior pilot after report. May trigger pay protection depending on circumstances.",
        example:
          "You check in for your trip and are reassigned to different flying as the most junior available pilot.",
      },
      {
        abbreviation: "Late Arrival",
        longName: "Late Arrival",
        mapsTo: "duty_extension",
        definition:
          "Duty day extended beyond scheduled arrival time due to delays.",
        example:
          "Your flight arrives 2 hours late due to weather, extending your duty day.",
      },
      {
        abbreviation: "Reassign",
        longName: "Reassignment",
        mapsTo: "reassignment",
        definition: "Trip or leg changed by scheduling to different flying.",
        example: "Scheduling changes your SDF-LAX trip to SDF-PHX.",
      },
      {
        abbreviation: "Premium",
        longName: "Premium Pay",
        mapsTo: "premium_pay_trigger",
        definition: "Event that may qualify for additional compensation.",
        example: "Long range premium (LRP) or airport reserve premium (AP).",
      },
      {
        abbreviation: "DH",
        longName: "Deadhead",
        mapsTo: "deadhead_added",
        definition: "Travel as passenger assigned by company for positioning.",
        example: "Company books you on a commercial flight to position for your next trip.",
      },
      {
        abbreviation: "CR",
        longName: "Credit",
        mapsTo: "premium_pay_trigger",
        definition: "Credit time applied to pay calculations.",
        example: "Additional credit added for duty time exceeding block time.",
      },
      {
        abbreviation: "Call-Out",
        longName: "Call-Out",
        mapsTo: "pay_protection_event",
        definition: "Contact from scheduling impacting duty or pay.",
        example: "Scheduling calls you on a day off to cover a trip.",
      },
      {
        abbreviation: "MDC",
        longName: "Minimum Daily Credit",
        mapsTo: "premium_pay_trigger",
        definition: "Guaranteed minimum credit per duty day (typically 6:00).",
        example: "Even if you only fly 4 hours, you're credited for 6 hours minimum.",
      },
      {
        abbreviation: "LRP",
        longName: "Long Range Premium",
        mapsTo: "premium_pay_trigger",
        definition: "Premium for international long-haul flights.",
        example: "Flying SDF-CGN qualifies for long range premium.",
      },
      {
        abbreviation: "AR",
        longName: "Airport Reserve",
        mapsTo: "reserve_event",
        definition: "Reserve duty at the airport ready room.",
        example: "Sitting airport reserve at SDF gateway.",
      },
      {
        abbreviation: "SCR",
        longName: "Short Call Reserve",
        mapsTo: "reserve_event",
        definition: "Reserve with short notice call-out window.",
        example: "On short call reserve with 2-hour report requirement.",
      },
      {
        abbreviation: "LCR",
        longName: "Long Call Reserve",
        mapsTo: "reserve_event",
        definition: "Reserve with longer notice call-out window.",
        example: "On long call reserve with 12-hour report window.",
      },
      {
        abbreviation: "TAFB",
        longName: "Time Away From Base",
        mapsTo: "per_diem_adjustment",
        definition: "Total trip duration used for per diem calculation.",
        example: "Your 3-day trip has a TAFB of 72 hours for per diem purposes.",
      },
    ],
  },
];

// Helper functions

/**
 * Get glossary for a specific airline
 */
export function getAirlineGlossary(
  airlineCode: AirlineCode
): AirlineGlossary | undefined {
  return AIRLINE_GLOSSARIES.find((g) => g.code === airlineCode);
}

/**
 * Get all terms that map to a specific universal event type
 */
export function getTermsByUniversalEvent(
  eventKey: UniversalPayEventKey
): Array<{ airline: AirlineCode; term: GlossaryTerm }> {
  const results: Array<{ airline: AirlineCode; term: GlossaryTerm }> = [];

  for (const glossary of AIRLINE_GLOSSARIES) {
    for (const term of glossary.terms) {
      if (term.mapsTo === eventKey) {
        results.push({ airline: glossary.code, term });
      }
    }
  }

  return results;
}

/**
 * Find a term by abbreviation across all airlines
 */
export function findTermByAbbreviation(
  abbreviation: string
): Array<{ airline: AirlineCode; term: GlossaryTerm }> {
  const results: Array<{ airline: AirlineCode; term: GlossaryTerm }> = [];
  const searchLower = abbreviation.toLowerCase();

  for (const glossary of AIRLINE_GLOSSARIES) {
    for (const term of glossary.terms) {
      if (term.abbreviation.toLowerCase() === searchLower) {
        results.push({ airline: glossary.code, term });
      }
    }
  }

  return results;
}

/**
 * Search glossary terms by keyword
 */
export function searchGlossary(
  query: string
): Array<{ airline: AirlineCode; term: GlossaryTerm }> {
  const results: Array<{ airline: AirlineCode; term: GlossaryTerm }> = [];
  const queryLower = query.toLowerCase();

  for (const glossary of AIRLINE_GLOSSARIES) {
    for (const term of glossary.terms) {
      if (
        term.abbreviation.toLowerCase().includes(queryLower) ||
        term.longName.toLowerCase().includes(queryLower) ||
        term.definition.toLowerCase().includes(queryLower)
      ) {
        results.push({ airline: glossary.code, term });
      }
    }
  }

  return results;
}

/**
 * Get the airline-specific label for a universal event type
 */
export function getAirlineLabel(
  eventKey: UniversalPayEventKey,
  airlineCode: AirlineCode
): string | undefined {
  const glossary = getAirlineGlossary(airlineCode);
  if (!glossary) return undefined;

  const term = glossary.terms.find((t) => t.mapsTo === eventKey);
  return term?.abbreviation;
}

/**
 * Get all airline codes
 */
export function getAllAirlineCodes(): AirlineCode[] {
  return AIRLINE_GLOSSARIES.map((g) => g.code);
}
