/**
 * Pay Benchmarks Hooks
 * React Query hooks for Career Pay Benchmarks feature
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import { offlineCache } from "./offlineStorage";

// ============================================
// TYPES
// ============================================

export interface PayBenchmark {
  id: string;
  airline: string;
  effectiveDate: string;
  seat: "FO" | "Captain";
  yearOfService: number;
  hourlyRateCents: number;
  payAtGuaranteeCents: number;
  avgLinePayCents: number;
  avgTotalPayCents: number;
  sourceNote: string | null;
}

export interface BenchmarksResponse {
  airline: string;
  effectiveDate: string;
  benchmarks: PayBenchmark[];
  availableEffectiveDates: Array<{
    date: string;
    sourceNote: string | null;
  }>;
}

export interface UserComparisonResponse {
  hasBenchmarks: boolean;
  message?: string;
  userProfile?: {
    airline: string;
    position: string;
    yearOfService: number;
    hourlyRateCents: number;
  };
  currentBenchmark?: {
    seat: string;
    yearOfService: number;
    hourlyRateCents: number;
    payAtGuaranteeCents: number;
    avgLinePayCents: number;
    avgTotalPayCents: number;
    sourceNote: string | null;
    effectiveDate: string;
  };
  userPerformance?: {
    ytdPayCents: number;
    projectedAnnualCents: number;
    dayOfYear: number;
    percentOfBenchmarkGuarantee: number | null;
    percentOfBenchmarkAvgLine: number | null;
    percentOfBenchmarkAvgTotal: number | null;
    deltaFromGuaranteeCents: number | null;
    deltaFromAvgLineCents: number | null;
    // Utilization metrics for insights
    utilizationPercent?: number;
    premiumPercentOfEarnings?: number;
  };
  upgradeSimulation?: {
    captainYearHourlyCents: number;
    captainYearAvgTotalCents: number;
    potentialIncreaseCents: number;
    percentIncrease: number | null;
    captainYear: number; // The company seniority year for captain
  };
  // For captain reverse comparison
  foEquivalentCents?: number | null;
}

export interface UpgradeScenarioParams {
  upgradeToYear: number;
  compareAgainstFoYear: number;
}

export interface UpgradeScenarioResponse {
  foYear: number;
  foAvgTotalCents: number;
  foHourlyCents: number;
  captainYear: number;
  captainAvgTotalCents: number;
  captainHourlyCents: number;
  netDifferenceCents: number;
  percentIncrease: number;
}

export interface CareerInsight {
  type: string;
  priority: number;
  title: string;
  message: string;
}

// ============================================
// HOOKS
// ============================================

/**
 * Fetch benchmarks for an airline
 */
export function usePayBenchmarks(options?: {
  airline?: string;
  seat?: "FO" | "Captain";
  effectiveDate?: string;
}) {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-benchmarks", options?.airline, options?.seat, options?.effectiveDate],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getBenchmarks<BenchmarksResponse>();
        if (cached) return cached;
        throw new Error("No cached benchmarks available offline");
      }
      const params = new URLSearchParams();
      if (options?.airline) params.set("airline", options.airline);
      if (options?.seat) params.set("seat", options.seat);
      if (options?.effectiveDate) params.set("effectiveDate", options.effectiveDate);
      const queryString = params.toString();
      const response = await api.get<BenchmarksResponse>(`/api/pay-benchmarks${queryString ? `?${queryString}` : ""}`);
      await offlineCache.saveBenchmarks(response);
      return response;
    },
    retry: isOnline ? 3 : 0,
  });
}

/**
 * Fetch user's comparison to benchmarks
 */
export function useUserBenchmarkComparison() {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-benchmarks", "user-comparison"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        // Reuse benchmarks cache slot for user comparison data
        const cached = await offlineCache.getBenchmarks<UserComparisonResponse>();
        if (cached) return cached;
        throw new Error("No cached benchmark comparison available offline");
      }
      const response = await api.get<UserComparisonResponse>("/api/pay-benchmarks/user-comparison");
      await offlineCache.saveBenchmarks(response);
      return response;
    },
    retry: isOnline ? 3 : 0,
  });
}

/**
 * Get available effective dates for an airline
 */
export function usePayBenchmarkEffectiveDates(airline?: string) {
  return useQuery({
    queryKey: ["pay-benchmarks", "effective-dates", airline],
    queryFn: () =>
      api.get<{
        airline: string;
        effectiveDates: Array<{ date: string; sourceNote: string | null }>;
      }>(`/api/pay-benchmarks/effective-dates?airline=${airline ?? "UPS"}`),
  });
}

/**
 * Fetch upgrade scenario comparison
 * Compare FO at one year vs Captain at another year (both based on company seniority)
 */
export function useUpgradeScenario(params: UpgradeScenarioParams) {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-benchmarks", "upgrade-scenario", params.upgradeToYear, params.compareAgainstFoYear],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        throw new Error("Upgrade scenario requires network connection");
      }
      return api.get<UpgradeScenarioResponse>(
        `/api/pay-benchmarks/upgrade-scenario?upgradeToYear=${params.upgradeToYear}&compareAgainstFoYear=${params.compareAgainstFoYear}`
      );
    },
    enabled: params.upgradeToYear > 0 && params.compareAgainstFoYear > 0,
    retry: isOnline ? 3 : 0,
  });
}

/**
 * Fetch auto-generated career insight based on user's data
 * Returns the highest priority insight applicable to the user
 */
export function useCareerInsight() {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-benchmarks", "career-insight"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        throw new Error("Career insight requires network connection");
      }
      return api.get<CareerInsight>("/api/pay-benchmarks/career-insight");
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: isOnline ? 3 : 0,
  });
}
