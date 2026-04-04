/**
 * Retirement Planning Store — v3
 *
 * Pure calculation logic lives in @/shared/retirementEngine.
 * This file contains the Zustand store and convenience selectors only.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Re-export everything from shared engine so existing imports work unchanged
export {
  CBA_RULESET_VERSION,
  PENSION_FLAT_DOLLAR_CAPTAIN_PER_YOS,
  PENSION_FLAT_DOLLAR_FO_PER_YOS,
  PLAN_B_EMPLOYER_RATE,
  PENSION_PERCENT_FORMULA_COEFFICIENT,
  VEBA_PER_HOUR_CENTS,
  HRA_ANNUAL_POST_RETIRE_CENTS,
  MEDICARE_ELIGIBILITY_AGE_DEFAULT,
  DEFAULT_UPGRADE_YEARS_FROM_DOH,
  UPS_PAY_TABLES,
  UPS_CONTRACT_RULES,
  getPayTableForYear,
  getPayStepYear,
  getPayTableAnnualComp,
  getPayTableHourlyRate,
  getContractRulesForYear,
  computePlanAPension,
  computeRetirementForecast,
  computeMultiAgeForecast,
  emptyForecast,
  buildScenario,
  computeDualScenarioForecast,
} from "@/lib/retirementEngine";

export type {
  SeatType,
  EarningsBasis,
  CareerPathScenario,
  PensionFormulaUsed,
  PriorEarnings,
  RetirementProfile,
  PayTableRow,
  PayTable,
  ContractRetirementRules,
  PensionCalculationResult,
  YearlyProjection,
  RetirementForecast,
  EarningsLedgerEntry,
  CareerScenario,
  ScenarioLabel,
  DualScenarioForecast,
} from "@/lib/retirementEngine";

import type { RetirementProfile } from "@/lib/retirementEngine";
import { MEDICARE_ELIGIBILITY_AGE_DEFAULT, DEFAULT_UPGRADE_YEARS_FROM_DOH } from "@/lib/retirementEngine";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT PROFILE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: RetirementProfile = {
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

// ─────────────────────────────────────────────────────────────────────────────
// ZUSTAND STORE
// ─────────────────────────────────────────────────────────────────────────────

interface RetirementState {
  profile: RetirementProfile;
  hasCompletedSetup: boolean;

  updateProfile: (updates: Partial<RetirementProfile>) => void;
  setPriorEarnings: (pe: RetirementProfile["priorEarnings"]) => void;
  skipPriorEarnings: () => void;
  setHasCompletedSetup: (v: boolean) => void;
  reset: () => void;
}

export const useRetirementStore = create<RetirementState>()(
  persist(
    (set) => ({
      profile: DEFAULT_PROFILE,
      hasCompletedSetup: false,

      updateProfile: (updates) =>
        set((s) => ({ profile: { ...s.profile, ...updates } })),

      setPriorEarnings: (pe) =>
        set((s) => ({
          profile: { ...s.profile, priorEarnings: pe, priorEarningsSkipped: false },
        })),

      skipPriorEarnings: () =>
        set((s) => ({
          profile: { ...s.profile, priorEarningsSkipped: true, priorEarnings: null },
        })),

      setHasCompletedSetup: (v) => set({ hasCompletedSetup: v }),

      reset: () => set({ profile: DEFAULT_PROFILE, hasCompletedSetup: false }),
    }),
    {
      name: "retirement-profile-storage-v5",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Convenience selectors
export const useRetirementProfile = () => useRetirementStore((s) => s.profile);
export const useRetirementSetupComplete = () => useRetirementStore((s) => s.hasCompletedSetup);
export const useRetirementActions = () =>
  useRetirementStore(
    useShallow((s) => ({
      updateProfile: s.updateProfile,
      setPriorEarnings: s.setPriorEarnings,
      skipPriorEarnings: s.skipPriorEarnings,
      setHasCompletedSetup: s.setHasCompletedSetup,
      reset: s.reset,
    }))
  );
