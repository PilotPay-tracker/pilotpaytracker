/**
 * Annual Pay Planner Hook
 * Flagship PRO feature for income planning
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offlineCache } from "@/lib/offlineStorage";
import { useIsOnline } from "@/lib/useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  CalculateAnnualPlanRequest,
  CalculateAnnualPlanResponse,
  SavePlannerScenarioRequest,
  SavePlannerScenarioResponse,
  GetSavedScenariosResponse,
  DeleteSavedScenarioResponse,
  GetPlanTrackingResponse,
  PlanningMode,
  FeasibilityRating,
  ScenarioType,
} from "@/lib/contracts";

// ============================================
// Calculate Annual Plan
// ============================================
export function useCalculateAnnualPlan() {
  return useMutation<CalculateAnnualPlanResponse, Error, CalculateAnnualPlanRequest>({
    mutationFn: async (input) => {
      return api.post<CalculateAnnualPlanResponse>("/api/planner/annual", input);
    },
  });
}

// ============================================
// Saved Scenarios
// ============================================
export function useSavedScenarios() {
  const isOnline = useIsOnline();

  return useQuery<GetSavedScenariosResponse>({
    queryKey: ["planner-saved-scenarios"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getAnnualPlannerScenarios<GetSavedScenariosResponse>();
        if (cached) {
          console.log("[useSavedScenarios] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached planner scenarios available offline");
      }
      const response = await api.get<GetSavedScenariosResponse>("/api/planner/annual/saved");
      await offlineCache.saveAnnualPlannerScenarios(response);
      return response;
    },
    staleTime: 60 * 1000, // 1 minute
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useSaveScenario() {
  const queryClient = useQueryClient();

  return useMutation<SavePlannerScenarioResponse, Error, SavePlannerScenarioRequest>({
    mutationFn: async (input) => {
      return api.post<SavePlannerScenarioResponse>("/api/planner/annual/save", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-saved-scenarios"] });
      queryClient.invalidateQueries({ queryKey: ["planner-tracking"] });
    },
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();

  return useMutation<DeleteSavedScenarioResponse, Error, string>({
    mutationFn: async (id) => {
      return api.delete<DeleteSavedScenarioResponse>(`/api/planner/annual/saved/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-saved-scenarios"] });
      queryClient.invalidateQueries({ queryKey: ["planner-tracking"] });
    },
  });
}

// ============================================
// Plan Tracking
// ============================================
export function usePlanTracking() {
  const isOnline = useIsOnline();

  return useQuery<GetPlanTrackingResponse>({
    queryKey: ["planner-tracking"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getAnnualPlannerTracking<GetPlanTrackingResponse>();
        if (cached) {
          console.log("[usePlanTracking] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached plan tracking available offline");
      }
      const response = await api.get<GetPlanTrackingResponse>("/api/planner/annual/tracking");
      await offlineCache.saveAnnualPlannerTracking(response);
      return response;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

// ============================================
// Helpers
// ============================================

// Format currency
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// Format hours
export function formatHours(hours: number): string {
  return `${hours.toFixed(1)} hrs`;
}

// Get feasibility color
export function getFeasibilityColor(rating: FeasibilityRating): string {
  switch (rating) {
    case "VERY_ACHIEVABLE":
      return "#22c55e"; // green-500
    case "ACHIEVABLE_WITH_EFFORT":
      return "#f59e0b"; // amber-500
    case "UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE":
      return "#f97316"; // orange-500
    case "HIGHLY_UNLIKELY_UNDER_CURRENT_CONDITIONS":
      return "#ef4444"; // red-500
    default:
      return "#64748b"; // slate-500
  }
}

// Get feasibility label
export function getFeasibilityLabel(rating: FeasibilityRating): string {
  switch (rating) {
    case "VERY_ACHIEVABLE":
      return "Very Achievable";
    case "ACHIEVABLE_WITH_EFFORT":
      return "Achievable with Effort";
    case "UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE":
      return "Unlikely Without Change";
    case "HIGHLY_UNLIKELY_UNDER_CURRENT_CONDITIONS":
      return "Highly Unlikely";
    default:
      return "Unknown";
  }
}

// Get scenario color
export function getScenarioColor(type: ScenarioType): string {
  switch (type) {
    case "CURRENT_PACE":
      return "#3b82f6"; // blue-500
    case "OPTIMIZED":
      return "#22c55e"; // green-500
    case "AGGRESSIVE":
      return "#f59e0b"; // amber-500
    default:
      return "#64748b"; // slate-500
  }
}

// Get planning mode description
export function getPlanningModeDescription(mode: PlanningMode): string {
  switch (mode) {
    case "CONSERVATIVE":
      return "Lower projections with safety margins";
    case "BALANCED":
      return "Realistic projections based on historical data";
    case "AGGRESSIVE":
      return "Higher projections assuming optimal conditions";
    default:
      return "";
  }
}

// Get tracking status color
export function getTrackingStatusColor(status: "ABOVE_PLAN" | "ON_TRACK" | "BELOW_PLAN"): string {
  switch (status) {
    case "ABOVE_PLAN":
      return "#22c55e"; // green-500
    case "ON_TRACK":
      return "#3b82f6"; // blue-500
    case "BELOW_PLAN":
      return "#ef4444"; // red-500
    default:
      return "#64748b"; // slate-500
  }
}

// Get tracking status label
export function getTrackingStatusLabel(status: "ABOVE_PLAN" | "ON_TRACK" | "BELOW_PLAN"): string {
  switch (status) {
    case "ABOVE_PLAN":
      return "Above Plan";
    case "ON_TRACK":
      return "On Track";
    case "BELOW_PLAN":
      return "Below Plan";
    default:
      return "Unknown";
  }
}

// Export types for convenience
export type {
  CalculateAnnualPlanRequest,
  CalculateAnnualPlanResponse,
  SavePlannerScenarioRequest,
  PlanningMode,
  FeasibilityRating,
  ScenarioType,
};
