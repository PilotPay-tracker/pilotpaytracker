/**
 * Shared projected annual pay calculation.
 *
 * Critical goal: use the same "current pace" local extrapolation math across screens,
 * avoiding the potentially-stale `/api/projections` year calculation.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api";
import { useSession } from "./useSession";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";

interface ProfileStatsResponse {
  allTime?: { totalPayCents: number };
  currentYear?: { totalPayCents: number; year?: number };
  currentMonth?: { totalPayCents: number; month?: string };
}

export function useSharedProjectedAnnual(): {
  projectedAnnualCents: number;
  ytdPayCents: number;
  dayOfYear: number;
  isLoading: boolean;
} {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  const { data: stats, isLoading } = useQuery({
    queryKey: ["profile-stats"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline =
        (netState.isConnected ?? true) && netState.isInternetReachable !== false;

      if (!currentlyOnline) {
        const cached = await offlineCache.getProfileStats<ProfileStatsResponse>();
        if (cached) {
          console.log("[useSharedProjectedAnnual] Using cached profile stats (offline)");
          return cached;
        }
        throw new Error("No cached profile stats available offline");
      }

      const response = await api.get<ProfileStatsResponse>("/api/profile/stats");
      await offlineCache.saveProfileStats(response);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: isOnline ? 2 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.max(
      1,
      Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24))
    );

    const ytdPayCents = stats?.currentYear?.totalPayCents ?? 0;

    // Same linear extrapolation used for "current pace" style projections:
    // projectedAnnualCents = (ytd / dayOfYear) * 365
    const projectedAnnualCents =
      ytdPayCents > 0 ? Math.round((ytdPayCents / dayOfYear) * 365) : 0;

    return {
      projectedAnnualCents,
      ytdPayCents,
      dayOfYear,
      isLoading: isAuthenticated ? isLoading : false,
    };
  }, [isAuthenticated, isLoading, stats]);
}

