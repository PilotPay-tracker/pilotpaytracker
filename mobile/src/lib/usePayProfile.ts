/**
 * usePayProfile — React hook for the shared pay profile calculation.
 *
 * Reads DOH + position from the profile store and returns the full
 * PayProfile (step label, hourly rate, guarantee, avg line, avg total).
 *
 * This is the single source of truth for all compensation-related pages:
 * onboarding, profile/settings, career page, pay summary/projections,
 * retirement/upgrade pages, etc.
 *
 * Usage:
 *   const { profile, computedYear, setOverrideRateCents } = usePayProfile();
 */

import { useState, useMemo } from "react";
import { useProfileStore } from "@/lib/state/profile-store";
import {
  getPayProfile,
  getPayProfileByYear,
  computePayYearFromDOH,
  type PayProfile,
  type PayPosition,
} from "@/lib/payProfile";

// ─── Main hook ───────────────────────────────────────────────────────────────

export interface UsePayProfileResult {
  /** Full pay profile derived from DOH + position */
  profile: PayProfile;
  /** Year of service computed from DOH (1–15) */
  computedYear: number;
  /** Whether the DOH was available and used for auto-calculation */
  hasDOH: boolean;
  /** Override the hourly rate (optional; pass null to revert to contract) */
  setOverrideRateCents: (cents: number | null) => void;
  /** Current override value (null = use contract) */
  overrideRateCents: number | null;
}

export function usePayProfile(
  /** Optional: override the position read from the profile store */
  positionOverride?: PayPosition,
  /** Optional: override the DOH read from the profile store */
  dohOverride?: string | null
): UsePayProfileResult {
  const storeProfile = useProfileStore((s) => s.profile);
  const [overrideRateCents, setOverrideRateCents] = useState<number | null>(null);

  const doh = dohOverride !== undefined ? dohOverride : (storeProfile?.dateOfHire ?? null);
  const rawPosition = positionOverride ?? (storeProfile?.position as PayPosition | null | undefined) ?? "FO";
  const position: PayPosition = rawPosition === "CPT" ? "CPT" : "FO";

  const computedYear = useMemo(
    () => computePayYearFromDOH(doh),
    [doh]
  );

  const profile = useMemo(
    () =>
      getPayProfile({
        doh,
        position,
        overrideRateCents,
      }),
    [doh, position, overrideRateCents]
  );

  return {
    profile,
    computedYear,
    hasDOH: !!doh,
    setOverrideRateCents,
    overrideRateCents,
  };
}

// ─── Year-selector variant (for onboarding / manual override) ────────────────

export interface UsePayProfileByYearResult {
  /** Full pay profile for the given year + position */
  profile: PayProfile;
  /** Override the hourly rate (optional) */
  setOverrideRateCents: (cents: number | null) => void;
  /** Current override value */
  overrideRateCents: number | null;
}

export function usePayProfileByYear(
  yearOfService: number,
  position: PayPosition,
  initialOverrideCents?: number | null
): UsePayProfileByYearResult {
  const [overrideRateCents, setOverrideRateCents] = useState<number | null>(
    initialOverrideCents ?? null
  );

  const profile = useMemo(
    () =>
      getPayProfileByYear({
        yearOfService,
        position,
        overrideRateCents,
      }),
    [yearOfService, position, overrideRateCents]
  );

  return { profile, setOverrideRateCents, overrideRateCents };
}
