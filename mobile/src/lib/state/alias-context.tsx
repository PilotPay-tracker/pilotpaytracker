/**
 * Airline Alias Context
 *
 * Provides airline-specific terminology throughout the app.
 * The context reads the user's profile airline and loads the
 * appropriate alias pack, making terminology available via hooks.
 *
 * Usage:
 *   const { getDisplayName, getShortCode, glossary } = useAliasContext();
 *   const label = getDisplayName("MIN_DAILY_CREDIT"); // "Minimum Daily Credit" for UPS
 */

import React, { createContext, useContext, useMemo } from "react";
import { useProfile } from "./profile-store";
import {
  getAliasPack,
  getRuleDisplayName,
  getRuleShortCode,
  getRuleDescription,
  getGlossary,
  type AirlineAliasPack,
  type CanonicalRuleId,
  type RuleAlias,
  CANONICAL_RULES,
  DEFAULT_ALIAS_PACK,
} from "../data/airline-alias-packs";

// ============================================
// CONTEXT TYPE
// ============================================

interface AliasContextValue {
  /** Current airline ID */
  airlineId: string;
  /** Current alias pack */
  aliasPack: AirlineAliasPack;
  /** Get display name for a canonical rule ID */
  getDisplayName: (canonicalId: CanonicalRuleId) => string;
  /** Get short code for a canonical rule ID */
  getShortCode: (canonicalId: CanonicalRuleId) => string | undefined;
  /** Get description for a canonical rule ID */
  getDescription: (canonicalId: CanonicalRuleId) => string;
  /** Get full rule alias info */
  getRuleAlias: (canonicalId: CanonicalRuleId) => RuleAlias | undefined;
  /** Get glossary for current airline */
  glossary: Record<string, string>;
  /** Look up a glossary term */
  lookupTerm: (term: string) => string | undefined;
  /** Get all canonical rule IDs */
  canonicalRules: typeof CANONICAL_RULES;
}

// ============================================
// CONTEXT
// ============================================

const AliasContext = createContext<AliasContextValue | null>(null);

// ============================================
// PROVIDER
// ============================================

export function AliasProvider({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const airlineId = profile?.airline ?? "UPS";

  const value = useMemo<AliasContextValue>(() => {
    const aliasPack = getAliasPack(airlineId);
    const glossary = getGlossary(airlineId);

    return {
      airlineId,
      aliasPack,
      getDisplayName: (canonicalId: CanonicalRuleId) =>
        getRuleDisplayName(airlineId, canonicalId),
      getShortCode: (canonicalId: CanonicalRuleId) =>
        getRuleShortCode(airlineId, canonicalId),
      getDescription: (canonicalId: CanonicalRuleId) =>
        getRuleDescription(airlineId, canonicalId),
      getRuleAlias: (canonicalId: CanonicalRuleId) =>
        aliasPack.rules[canonicalId],
      glossary,
      lookupTerm: (term: string) => glossary[term],
      canonicalRules: CANONICAL_RULES,
    };
  }, [airlineId]);

  return (
    <AliasContext.Provider value={value}>{children}</AliasContext.Provider>
  );
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook to access airline terminology context
 */
export function useAliasContext(): AliasContextValue {
  const context = useContext(AliasContext);
  if (!context) {
    // Return default values if not in provider (shouldn't happen in prod)
    const aliasPack = DEFAULT_ALIAS_PACK;
    const glossary = aliasPack.glossary;
    return {
      airlineId: "Other",
      aliasPack,
      getDisplayName: (canonicalId: CanonicalRuleId) =>
        getRuleDisplayName("Other", canonicalId),
      getShortCode: (canonicalId: CanonicalRuleId) =>
        getRuleShortCode("Other", canonicalId),
      getDescription: (canonicalId: CanonicalRuleId) =>
        getRuleDescription("Other", canonicalId),
      getRuleAlias: (canonicalId: CanonicalRuleId) =>
        aliasPack.rules[canonicalId],
      glossary,
      lookupTerm: (term: string) => glossary[term],
      canonicalRules: CANONICAL_RULES,
    };
  }
  return context;
}

/**
 * Hook to get display name for a specific rule
 */
export function useRuleDisplayName(canonicalId: CanonicalRuleId): string {
  const { getDisplayName } = useAliasContext();
  return getDisplayName(canonicalId);
}

/**
 * Hook to get short code for a specific rule
 */
export function useRuleShortCode(
  canonicalId: CanonicalRuleId
): string | undefined {
  const { getShortCode } = useAliasContext();
  return getShortCode(canonicalId);
}

/**
 * Hook to get the current airline's glossary
 */
export function useGlossary(): Record<string, string> {
  const { glossary } = useAliasContext();
  return glossary;
}

/**
 * Hook to get the current airline ID
 */
export function useCurrentAirline(): string {
  const { airlineId } = useAliasContext();
  return airlineId;
}

/**
 * Hook to get the full alias pack for the current airline
 */
export function useAliasPack(): AirlineAliasPack {
  const { aliasPack } = useAliasContext();
  return aliasPack;
}

// ============================================
// UTILITY FUNCTIONS (Non-hook, for use outside React)
// ============================================

/**
 * Format a pay event type with airline-specific label
 */
export function formatPayEventWithAlias(
  airlineId: string,
  eventType: string,
  airlineLabel?: string | null
): string {
  // If there's an airline-specific label, use it
  if (airlineLabel) {
    return airlineLabel;
  }

  // Try to map to canonical rules
  const canonicalMapping: Record<string, CanonicalRuleId> = {
    SCHEDULE_CHANGE: "SCHEDULE_CHANGE",
    DUTY_EXTENSION: "DUTY_EXTENSION",
    REASSIGNMENT: "REASSIGNMENT",
    JUNIOR_ASSIGNMENT: "JUNIOR_ASSIGNMENT",
    PREMIUM_TRIGGER: "PREMIUM_TRIGGER",
    PAY_PROTECTION: "PAY_PROTECTION_GUARANTEE",
    RESERVE_ACTIVATION: "SHORT_CALL_RESERVE",
    DEADHEAD: "DEADHEAD_PAY",
    TRAINING: "TRAINING_PAY",
  };

  const canonicalId = canonicalMapping[eventType];
  if (canonicalId) {
    return getRuleDisplayName(airlineId, canonicalId);
  }

  // Fallback to formatted event type
  return eventType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
