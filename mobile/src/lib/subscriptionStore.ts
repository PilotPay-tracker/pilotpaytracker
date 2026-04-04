/**
 * Subscription Store
 *
 * Manages subscription state for the paywall.
 * In production, this will be replaced with RevenueCat integration.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SubscriptionTier = 'free' | 'trial' | 'premium';

interface SubscriptionState {
  tier: SubscriptionTier;
  trialStartDate: string | null;
  trialEndDate: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  isTrialExpired: boolean;

  // Actions
  startTrial: () => void;
  upgradeToPremium: () => void;
  checkTrialStatus: () => void;
  resetSubscription: () => void;
}

const TRIAL_DAYS = 7;

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      tier: 'free',
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: null,
      subscriptionEndDate: null,
      isTrialExpired: false,

      startTrial: () => {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + TRIAL_DAYS);

        set({
          tier: 'trial',
          trialStartDate: now.toISOString(),
          trialEndDate: endDate.toISOString(),
          isTrialExpired: false,
        });
      },

      upgradeToPremium: () => {
        const now = new Date();
        // For demo, set subscription for 1 year
        const endDate = new Date(now);
        endDate.setFullYear(endDate.getFullYear() + 1);

        set({
          tier: 'premium',
          subscriptionStartDate: now.toISOString(),
          subscriptionEndDate: endDate.toISOString(),
          isTrialExpired: false,
        });
      },

      checkTrialStatus: () => {
        const { tier, trialEndDate } = get();
        if (tier === 'trial' && trialEndDate) {
          const now = new Date();
          const end = new Date(trialEndDate);
          if (now > end) {
            set({
              tier: 'free',
              isTrialExpired: true,
            });
          }
        }
      },

      resetSubscription: () => {
        set({
          tier: 'free',
          trialStartDate: null,
          trialEndDate: null,
          subscriptionStartDate: null,
          subscriptionEndDate: null,
          isTrialExpired: false,
        });
      },
    }),
    {
      name: 'subscription-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Selectors
export const useSubscriptionTier = () => useSubscriptionStore((s) => s.tier);
export const useIsTrialExpired = () => useSubscriptionStore((s) => s.isTrialExpired);
export const useTrialEndDate = () => useSubscriptionStore((s) => s.trialEndDate);

// Helper to check if feature is available
export function useHasFeatureAccess(feature: 'basic' | 'premium'): boolean {
  const tier = useSubscriptionTier();
  if (feature === 'basic') return true;
  return tier === 'trial' || tier === 'premium';
}

// Calculate days remaining in trial
export function useTrialDaysRemaining(): number | null {
  const tier = useSubscriptionTier();
  const trialEndDate = useTrialEndDate();

  if (tier !== 'trial' || !trialEndDate) return null;

  const now = new Date();
  const end = new Date(trialEndDate);
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}
