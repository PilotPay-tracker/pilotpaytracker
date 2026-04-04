import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import {
  getBidPeriodBaseline,
  upsertBidPeriodBaseline,
  deleteBidPeriodBaseline,
} from "./api";
import { useSession } from "./useSession";
import { useAuth } from "./BetterAuthProvider";
import type { UpsertBidPeriodBaselineRequest } from "@/shared/contracts";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  GetDashboardResponse,
  GetFlightsResponse,
  CreateFlightRequest,
  CreateFlightResponse,
  DeleteFlightResponse,
  GetUserSettingsResponse,
  UpdateUserSettingsRequest,
  UpdateUserSettingsResponse,
} from "@/lib/contracts";

// ============================================
// DASHBOARD
// ============================================

export function useDashboard() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const { isProfileReady, isOptimisticallyAuthenticated } = useAuth();
  const isOnline = useIsOnline();
  const enabled = (isAuthenticated || isOptimisticallyAuthenticated) && isProfileReady;

  // Log whenever the enabled gate changes
  useEffect(() => {
    console.log(`[useDashboard] enabled=${enabled} (isAuthenticated=${isAuthenticated}, isProfileReady=${isProfileReady})`);
  }, [enabled, isAuthenticated, isProfileReady]);

  const query = useQuery({
    // Stable query key — network status is checked inside queryFn via NetInfo.fetch()
    // so it never changes the key and won't double-fire when NetInfo resolves
    queryKey: ["dashboard"],
    queryFn: async () => {
      console.log("[useDashboard] queryFn FIRED — fetching dashboard");
      // Check real-time network status inside queryFn to avoid key instability
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;

      // If offline, try to get cached data first
      if (!currentlyOnline) {
        const cached = await offlineCache.getDashboard<GetDashboardResponse>();
        if (cached) {
          console.log("[useDashboard] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached data available");
      }

      // Online - fetch from API
      console.log("[useDashboard] Fetching from backend /api/dashboard");
      const response = await api.get<GetDashboardResponse>("/api/dashboard");
      console.log("[useDashboard] Got response — periodStart:", (response as any)?.periodStart, "periodEnd:", (response as any)?.periodEnd);

      // Cache the response for offline use
      await offlineCache.saveDashboard(response);
      await offlineCache.saveLastSync();

      return response;
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes — data doesn't change between user actions
    gcTime: 1000 * 60 * 15,   // Keep in cache for 15 minutes
    // Always show previous data while refetching — prevents number flash
    placeholderData: (previousData) => previousData,
    // Don't retry if offline
    retry: isOnline ? 2 : 0,
    // Prevent background refetch from flickering numbers
    refetchOnWindowFocus: false,
  });

  // Try to load cached data if query fails and we have no data
  useEffect(() => {
    if (query.isError && !query.data && isAuthenticated) {
      console.log("[useDashboard] Query errored, checking offline cache");
      offlineCache.getDashboard<GetDashboardResponse>().then((cached) => {
        if (cached) {
          console.log("[useDashboard] Falling back to cached data");
          // Note: This won't update the query cache, but we handle this case
        }
      });
    }
  }, [query.isError, query.data, isAuthenticated]);

  // Log query status changes
  useEffect(() => {
    console.log(`[useDashboard] status=${query.status} hasData=${!!query.data} isLoading=${query.isLoading} isFetching=${query.isFetching}`);
  }, [query.status, query.data, query.isLoading, query.isFetching]);

  return query;
}

// ============================================
// FLIGHTS
// ============================================

export function useFlights(options?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const { isProfileReady, isOptimisticallyAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["flights", options?.startDate, options?.endDate, options?.limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.startDate) params.set("startDate", options.startDate);
      if (options?.endDate) params.set("endDate", options.endDate);
      if (options?.limit) params.set("limit", String(options.limit));
      const queryString = params.toString();
      const url = queryString ? `/api/flights?${queryString}` : "/api/flights";
      const response = await api.get<GetFlightsResponse>(url);
      return response;
    },
    enabled: (isAuthenticated || isOptimisticallyAuthenticated) && isProfileReady,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
  });
}

export function useCreateFlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFlightRequest) => {
      const response = await api.post<CreateFlightResponse>("/api/flights", data);
      return response;
    },
    onSuccess: () => {
      // Invalidate flights and dashboard queries
      queryClient.invalidateQueries({ queryKey: ["flights"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

export function useDeleteFlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (flightId: string) => {
      const response = await api.delete<DeleteFlightResponse>(
        `/api/flights/${flightId}`
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flights"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// SETTINGS
// ============================================

export function useSettings() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const { isProfileReady, isOptimisticallyAuthenticated } = useAuth();
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getSettings<GetUserSettingsResponse>();
        if (cached) {
          console.log("[useSettings] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached settings available offline");
      }
      const response = await api.get<GetUserSettingsResponse>("/api/settings");
      await offlineCache.saveSettings(response);
      return response;
    },
    enabled: (isAuthenticated || isOptimisticallyAuthenticated) && isProfileReady,
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: isOnline ? 2 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateUserSettingsRequest) => {
      const response = await api.put<UpdateUserSettingsResponse>(
        "/api/settings",
        data
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// BID PERIOD BASELINE
// ============================================

/**
 * Query the awarded-credit baseline for the given period (or current period).
 * Returns the baseline record + contextual fields needed by the UI.
 */
export function useBidPeriodBaseline(periodKey?: string) {
  const { data: session } = useSession();
  const { isProfileReady, isOptimisticallyAuthenticated } = useAuth();
  const isAuthenticated = !!session?.user || isOptimisticallyAuthenticated;

  return useQuery({
    queryKey: ["bid-period-baseline", periodKey ?? "current"],
    queryFn: () => getBidPeriodBaseline(periodKey),
    enabled: isAuthenticated && isProfileReady,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}

/**
 * Mutation to set or update the awarded-credit baseline for a period.
 * Invalidates the dashboard and baseline queries on success.
 */
export function useUpsertBidPeriodBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertBidPeriodBaselineRequest) => upsertBidPeriodBaseline(data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["bid-period-baseline"] });
    },
  });
}

/**
 * Mutation to clear the baseline for a period so the user can re-enter.
 */
export function useDeleteBidPeriodBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (periodKey: string) => deleteBidPeriodBaseline(periodKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["bid-period-baseline"] });
    },
  });
}
