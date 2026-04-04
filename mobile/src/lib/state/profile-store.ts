/**
 * Global Profile Store
 *
 * Manages the pilot profile state globally so all pay calculations
 * can access hourly rate, position, base, etc.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PilotProfile } from "@/lib/contracts";

interface ProfileState {
  // Profile data
  profile: PilotProfile | null;
  isComplete: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProfile: (profile: PilotProfile | null, isComplete: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearProfile: () => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      isComplete: false,
      isLoading: true,
      error: null,

      setProfile: (profile, isComplete) => set({
        profile,
        isComplete,
        isLoading: false,
        error: null
      }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      clearProfile: () => set({
        profile: null,
        isComplete: false,
        isLoading: false,
        error: null
      }),
    }),
    {
      name: "pilot-profile-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist profile and isComplete, not loading/error state
      partialize: (state) => ({
        profile: state.profile,
        isComplete: state.isComplete
      }),
    }
  )
);

// Selectors for common use cases - always use these for better performance
export const useProfile = () => useProfileStore((s) => s.profile);
export const useIsProfileComplete = () => useProfileStore((s) => s.isComplete);
export const useProfileLoading = () => useProfileStore((s) => s.isLoading);
export const useProfileError = () => useProfileStore((s) => s.error);

// Get hourly rate directly (most common use case)
export const useHourlyRateCents = () => useProfileStore((s) => s.profile?.hourlyRateCents ?? 0);
export const usePosition = () => useProfileStore((s) => s.profile?.position ?? null);
export const useBase = () => useProfileStore((s) => s.profile?.base ?? null);
export const usePilotName = () => useProfileStore((s) => {
  const p = s.profile;
  if (!p?.firstName) return null;
  return `${p.firstName}${p.lastName ? ` ${p.lastName}` : ""}`;
});

// Onboarding selectors
export const useIsOnboardingComplete = () => useProfileStore((s) => s.profile?.onboardingComplete ?? false);
export const useOnboardingStep = () => useProfileStore((s) => s.profile?.onboardingStep ?? 0);
export const useAirline = () => useProfileStore((s) => s.profile?.airline ?? "UPS");
export const useContractMappingStatus = () => useProfileStore((s) => s.profile?.contractMappingStatus ?? "none");

// Store actions selector
export const useProfileActions = () => useProfileStore((s) => ({
  setProfile: s.setProfile,
  setLoading: s.setLoading,
  setError: s.setError,
  clearProfile: s.clearProfile,
}));
