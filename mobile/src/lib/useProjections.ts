/**
 * Projections Hooks
 * React Query hooks for earnings projections and goal tracking
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  GetProjectionsResponse,
  CalculateGoalRequest,
  CalculateGoalResponse,
  WhatIfRequest,
  WhatIfResponse,
  GetHistoryResponse,
  ProjectionScope,
} from "@/lib/contracts";

// ============================================
// PROJECTIONS
// ============================================

export function useProjections() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["projections"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getProjections<GetProjectionsResponse>();
        if (cached) {
          console.log("[useProjections] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached projections available offline");
      }
      const response = await api.get<GetProjectionsResponse>("/api/projections");
      await offlineCache.saveProjections(response);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
    retry: isOnline ? 2 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

// ============================================
// GOAL CALCULATION
// ============================================

export function useCalculateGoal() {
  return useMutation({
    mutationFn: async (data: CalculateGoalRequest) => {
      const response = await api.post<CalculateGoalResponse>("/api/projections/goal", data);
      return response;
    },
  });
}

// ============================================
// WHAT-IF SCENARIOS
// ============================================

export function useWhatIf() {
  return useMutation({
    mutationFn: async (data: WhatIfRequest) => {
      const response = await api.post<WhatIfResponse>("/api/projections/what-if", data);
      return response;
    },
  });
}

// ============================================
// HISTORY
// ============================================

export function useProjectionHistory(months: number = 12) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["projections-history", months],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getProjectionHistory<GetHistoryResponse>(months);
        if (cached) {
          console.log("[useProjectionHistory] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached projection history available offline");
      }
      const response = await api.get<GetHistoryResponse>(`/api/projections/history?months=${months}`);
      await offlineCache.saveProjectionHistory(months, response);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Format cents as currency
 */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Format cents as currency with decimals
 */
export function formatCurrencyPrecise(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format minutes as hours:minutes
 */
export function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Format minutes as decimal hours
 */
export function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/**
 * Format scope for display
 */
export function formatScope(scope: ProjectionScope): string {
  const labels: Record<ProjectionScope, string> = {
    PAY_PERIOD: "Pay Period",
    MONTH: "Month",
    YEAR: "Year",
  };
  return labels[scope] || scope;
}

/**
 * Get progress bar color based on percentage
 */
export function getProgressColor(percent: number): string {
  if (percent >= 100) return "#22c55e"; // green
  if (percent >= 75) return "#f59e0b"; // amber
  if (percent >= 50) return "#3b82f6"; // blue
  return "#64748b"; // slate
}

/**
 * Calculate progress percentage safely
 */
export function calculateProgress(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}
