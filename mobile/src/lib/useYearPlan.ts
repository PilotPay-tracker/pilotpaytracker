/**
 * useYearPlan Hook
 * Shared planning entity between Benchmarks and Annual Pay Planner.
 * Provides the active YearPlan + computed snapshot for the current year.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offlineCache } from "@/lib/offlineStorage";
import { useIsOnline } from "@/lib/useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";

// ============================================================
// TYPES
// ============================================================

export interface YearPlan {
  id: string;
  planYear: number;
  targetAnnualIncomeCents: number;
  hourlyRateCents: number;
  monthlyGuaranteeHours: number;
  jaMultiplier: number;
  includeJA: boolean;
  includeOpenTime: boolean;
  planningMode: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
  isActive: boolean;
  updatedAt: string;
}

export interface YearPlanSnapshot {
  planYear: number;
  ytdPaidEstimateCents: number;
  ytdCreditHours: number;
  ytdDaysElapsed: number;
  monthsLeft: number;
  remainingIncomeNeededCents: number;
  baseCreditEquivRemainingHours: number;
  jaCreditEquivRemainingHours: number;
  requiredBaseCreditsPerMonthFromToday: number;
  requiredJACreditsPerMonthFromToday: number;
  requiredBaseCreditsPerBidPeriodFromToday: number;
  planHealth: "STRONG" | "WATCH" | "AT_RISK";
  targetAnnualIncomeCents: number;
  hourlyRateCents: number;
  monthlyGuaranteeHours: number;
  jaMultiplier: number;
}

export interface ActiveYearPlanResponse {
  plan: YearPlan | null;
  snapshot: YearPlanSnapshot | null;
}

export interface UpsertYearPlanRequest {
  planYear: number;
  targetAnnualIncomeCents: number;
  hourlyRateCents?: number;
  monthlyGuaranteeHours?: number;
  jaMultiplier?: number;
  includeJA?: boolean;
  includeOpenTime?: boolean;
  planningMode?: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
}

// ============================================================
// QUERY KEYS
// ============================================================

export const YEAR_PLAN_QUERY_KEY = ["year-plan-active"] as const;

// ============================================================
// HOOKS
// ============================================================

/**
 * Get the active year plan + snapshot for the current year.
 * Returns null for both if no plan exists.
 */
export function useActiveYearPlan() {
  const isOnline = useIsOnline();

  return useQuery<ActiveYearPlanResponse>({
    queryKey: [...YEAR_PLAN_QUERY_KEY],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getYearPlan<ActiveYearPlanResponse>();
        if (cached) {
          console.log("[useActiveYearPlan] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached year plan available offline");
      }
      const response = await api.get<ActiveYearPlanResponse>("/api/year-plan/active");
      await offlineCache.saveYearPlan(response);
      return response;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Upsert (create or replace) the active year plan.
 * Called from Annual Pay Planner "Set as My {year} Target".
 */
export function useUpsertYearPlan() {
  const queryClient = useQueryClient();

  return useMutation<ActiveYearPlanResponse & { success: boolean }, Error, UpsertYearPlanRequest>({
    mutationFn: (input) =>
      api.post<ActiveYearPlanResponse & { success: boolean }>("/api/year-plan/upsert", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: YEAR_PLAN_QUERY_KEY });
      // Also refresh benchmarks snapshot
      queryClient.invalidateQueries({ queryKey: ["planner-saved-scenarios"] });
      queryClient.invalidateQueries({ queryKey: ["planner-tracking"] });
    },
  });
}

/**
 * Update only the monthly guarantee hours in the active year plan.
 * Called from Benchmarks guarantee editor (Phase 4 sync).
 */
export function useUpdateGuaranteeHours() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean; updated: number }, Error, number>({
    mutationFn: (monthlyGuaranteeHours) =>
      api.patch<{ success: boolean; updated: number }>("/api/year-plan/update-guarantee", {
        monthlyGuaranteeHours,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: YEAR_PLAN_QUERY_KEY });
    },
  });
}

// ============================================================
// HELPERS
// ============================================================

export function getPlanHealthColor(health: YearPlanSnapshot["planHealth"]): string {
  switch (health) {
    case "STRONG":
      return "#22c55e"; // green
    case "WATCH":
      return "#f59e0b"; // amber
    case "AT_RISK":
      return "#ef4444"; // red
    default:
      return "#64748b";
  }
}

export function getPlanHealthLabel(health: YearPlanSnapshot["planHealth"]): string {
  switch (health) {
    case "STRONG":
      return "Strong";
    case "WATCH":
      return "Watch";
    case "AT_RISK":
      return "At Risk";
    default:
      return "Unknown";
  }
}

export function formatCurrencyYP(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}
