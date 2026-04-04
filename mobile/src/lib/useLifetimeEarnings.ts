/**
 * Lifetime Earnings API Hooks
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offlineCache } from "@/lib/offlineStorage";
import { useIsOnline } from "@/lib/useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";

interface CareerContext {
  hasLifetimeData: boolean;
  averageAnnualEarningsCents: number | null;
  yearsTracked: number;
}

/**
 * Get career context for Upgrade Simulation tie-in
 */
export function useCareerContext() {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["lifetime-earnings", "context"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getLifetimeEarnings<CareerContext>();
        if (cached) {
          console.log("[useCareerContext] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached career context available offline");
      }
      const response = await api.get<CareerContext>("/api/lifetime-earnings/context");
      await offlineCache.saveLifetimeEarnings(response);
      return response;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Format career context for display
 */
export function formatCareerContext(context: CareerContext | undefined): string | null {
  if (!context?.hasLifetimeData || !context.averageAnnualEarningsCents) {
    return null;
  }

  const avgAnnual = Math.round(context.averageAnnualEarningsCents / 100);
  const formatted = avgAnnual >= 1000
    ? `$${Math.round(avgAnnual / 1000)}K`
    : `$${avgAnnual.toLocaleString()}`;

  return `Your historical career average is ~${formatted} per year across ${context.yearsTracked} year${context.yearsTracked !== 1 ? "s" : ""}.`;
}
