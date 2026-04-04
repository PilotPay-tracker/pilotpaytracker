/**
 * Subscription Hook
 *
 * Provides subscription status and premium access checking.
 * Uses backend as source of truth.
 *
 * Canonical entitlement states:
 *   free      — never started a trial, no subscription
 *   trialing  — inside the 7-day free trial window
 *   active    — paid Stripe subscription is active
 *   expired   — trial ended AND no active subscription
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/state/profile-store";
import { useEffect, useMemo } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { isAppleReviewAccount, logBypassVerification } from "@/lib/appleReviewBypass";
import { useAuth } from "@/lib/BetterAuthProvider";

// Canonical entitlement status from backend
export type EntitlementStatus = "free" | "trialing" | "active" | "expired";

// Subscription status response type
interface SubscriptionStatus {
  // Canonical entitlement state (primary source of truth)
  subscriptionStatus: EntitlementStatus;
  trialStatus: "not_started" | "active" | "expired";
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  accessExpiresAt: string | null;
  plan: string | null;
  hasPremiumAccess: boolean;
  trialDaysRemaining: number | null;
  // Legacy fields (kept for backward compat)
  trialStartDate: string | null;
  trialEndDate: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  revenuecatCustomerId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
}

// Fetch subscription status from backend
export function useSubscriptionStatus() {
  const queryClient = useQueryClient();
  const query = useQuery<SubscriptionStatus>({
    queryKey: ["subscription-status"],
    queryFn: async () => {
      const response = await api.get<SubscriptionStatus>("/api/subscription/status");
      return response;
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // Refresh subscription status whenever the app comes to the foreground
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [queryClient]);

  return query;
}

// Start free trial
export function useStartTrial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return api.post("/api/subscription/start-trial", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

// Sync with RevenueCat
export function useSyncRevenueCat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      isActive: boolean;
      expirationDate?: string;
      revenuecatCustomerId?: string;
    }) => {
      return api.post("/api/subscription/sync-revenuecat", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

// Combined hook for checking premium access
export function usePremiumAccess() {
  const profile = useProfile();
  const { user } = useAuth();
  const { data: status, isLoading, error } = useSubscriptionStatus();

  const isReviewAccount = useMemo(() => {
    const isReview = isAppleReviewAccount(user?.email);
    if (isReview) logBypassVerification();
    return isReview;
  }, [user?.email]);

  // Get the canonical entitlement state from backend
  // Falls back to legacy profile fields for older app versions / cache misses
  const entitlementStatus = useMemo((): EntitlementStatus => {
    if (isReviewAccount) return "active";

    // Backend is source of truth
    if (status?.subscriptionStatus) return status.subscriptionStatus;

    // Legacy fallback from profile store
    if (profile?.subscriptionStatus === "active" || profile?.subscriptionStatus === "active_lifetime") {
      return "active";
    }
    if (profile?.trialStatus === "active" && profile?.trialEndDate) {
      const now = new Date();
      const end = new Date(profile.trialEndDate);
      return now < end ? "trialing" : "expired";
    }
    if (profile?.trialStatus === "expired") return "expired";

    return "free";
  }, [status, profile, isReviewAccount]);

  const hasPremiumAccess = useMemo(() => {
    if (isReviewAccount) return true;
    // Backend drives this value — trust it over local derivation
    if (status?.hasPremiumAccess != null) return status.hasPremiumAccess;
    return entitlementStatus === "trialing" || entitlementStatus === "active";
  }, [status, entitlementStatus, isReviewAccount]);

  // Debug log whenever the entitlement decision changes
  useEffect(() => {
    if (!isLoading) {
      console.log(
        `[Entitlement] status=${entitlementStatus} hasPremiumAccess=${hasPremiumAccess} plan=${status?.plan ?? "none"} source=${status ? "backend" : "cache/fallback"}`
      );
    }
  }, [entitlementStatus, hasPremiumAccess, status, isLoading]);

  const isTrialExpired = useMemo(() => {
    if (isReviewAccount) return false;
    return entitlementStatus === "expired";
  }, [entitlementStatus, isReviewAccount]);

  const isTrialActive = useMemo(() => {
    if (isReviewAccount) return false;
    return entitlementStatus === "trialing";
  }, [entitlementStatus, isReviewAccount]);

  const isSubscriptionActive = useMemo(() => {
    if (isReviewAccount) return true;
    return entitlementStatus === "active";
  }, [entitlementStatus, isReviewAccount]);

  const trialDaysRemaining = useMemo(() => {
    if (isReviewAccount) return null;
    if (status?.trialDaysRemaining != null) return status.trialDaysRemaining;

    const trialEnd = status?.trialEndsAt ?? status?.trialEndDate ?? profile?.trialEndDate;
    if (trialEnd) {
      const now = new Date();
      const end = new Date(trialEnd);
      const diffTime = end.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }
    return null;
  }, [status, profile, isReviewAccount]);

  const hasTrialBeenUsed = useMemo(() => {
    if (isReviewAccount) return true;
    const trialStatus = status?.trialStatus ?? profile?.trialStatus;
    return trialStatus !== "not_started";
  }, [status, profile, isReviewAccount]);

  return {
    isLoading,
    error,
    hasPremiumAccess,
    isTrialExpired,
    isTrialActive,
    isSubscriptionActive,
    trialDaysRemaining,
    hasTrialBeenUsed,
    isReviewAccount,
    entitlementStatus,
    plan: status?.plan ?? null,
    accessExpiresAt: status?.accessExpiresAt ?? null,
    // Normalised subscriptionStatus using canonical values
    subscriptionStatus: isReviewAccount ? "active" as EntitlementStatus : entitlementStatus,
    // Keep trialStatus for any legacy consumers
    trialStatus: isReviewAccount
      ? ("not_started" as const)
      : (status?.trialStatus ?? profile?.trialStatus ?? "not_started"),
  };
}

// Simple selector for just checking premium access
export function useHasPremiumAccess(): boolean {
  const { hasPremiumAccess } = usePremiumAccess();
  return hasPremiumAccess;
}

// Check if specific feature requires premium
export function useFeatureAccess(feature: "basic" | "premium" | "trial"): boolean {
  const { hasPremiumAccess, isTrialActive } = usePremiumAccess();

  if (feature === "basic") return true;
  if (feature === "trial") return isTrialActive || hasPremiumAccess;
  return hasPremiumAccess;
}
