/**
 * Profile Hooks
 *
 * React Query hooks for fetching and updating pilot profile
 * Automatically syncs with global Zustand store
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useProfileStore } from "./state/profile-store";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import type {
  GetProfileResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  DeleteProfileResponse,
} from "@/lib/contracts";

const PROFILE_KEY = ["profile"];

/**
 * Fetch pilot profile and sync to global store
 */
export function useProfileQuery(enabled = true) {
  const setProfile = useProfileStore((s) => s.setProfile);
  const setError = useProfileStore((s) => s.setError);
  const setLoading = useProfileStore((s) => s.setLoading);
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: [...PROFILE_KEY],
    queryFn: async () => {
      setLoading(true);
      try {
        const netState = await NetInfo.fetch();
        const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
        if (!currentlyOnline) {
          const cached = await offlineCache.getProfile<GetProfileResponse>();
          if (cached) {
            console.log("[useProfileQuery] Using cached profile (offline)");
            setProfile(cached.profile, cached.isComplete);
            return cached;
          }
          throw new Error("No cached profile available offline");
        }

        const data = await api.get<GetProfileResponse>("/api/profile");
        // Cache for offline use
        await offlineCache.saveProfile(data);
        // Sync to global store
        setProfile(data.profile, data.isComplete);
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load profile";
        setError(message);
        throw error;
      }
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: isOnline ? 2 : 0,
  });
}

/**
 * Update pilot profile mutation
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  const setProfile = useProfileStore((s) => s.setProfile);

  return useMutation({
    mutationFn: async (data: UpdateProfileRequest) => {
      return api.put<UpdateProfileResponse>("/api/profile", data);
    },
    onSuccess: (data) => {
      // Sync to global store
      setProfile(data.profile, data.isComplete);
      // Invalidate profile query to refetch
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });
}

/**
 * Delete profile and all data (reset)
 */
export function useDeleteProfileMutation() {
  const queryClient = useQueryClient();
  const clearProfile = useProfileStore((s) => s.clearProfile);

  return useMutation({
    mutationFn: async () => {
      return api.delete<DeleteProfileResponse>("/api/profile");
    },
    onSuccess: () => {
      // Clear global store
      clearProfile();
      // Invalidate all queries
      queryClient.invalidateQueries();
    },
  });
}
