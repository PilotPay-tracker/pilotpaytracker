/**
 * Subscription Gate Component
 *
 * Wraps app content and gates access based on entitlement status from backend.
 *
 * Access rules:
 *   free     → auto-start 7-day trial, let through
 *   trialing → full access (trial in progress)
 *   active   → full access (paid subscriber)
 *   expired  → show paywall directing user to website
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, Crown, RefreshCw } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { usePremiumAccess, useStartTrial } from "@/lib/useSubscription";
import { restorePurchases, isRevenueCatEnabled } from "@/lib/revenuecatClient";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

interface SubscriptionGateProps {
  children: React.ReactNode;
}

export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    isLoading,
    hasPremiumAccess,
    entitlementStatus,
  } = usePremiumAccess();

  const startTrial = useStartTrial();
  const trialStartAttempted = useRef(false);

  const [isRestoring, setIsRestoring] = useState(false);
  // Track RevenueCat sync so we don't flash the paywall for paying users
  const [isCheckingRevenueCat, setIsCheckingRevenueCat] = useState(() => isRevenueCatEnabled());

  // Auto-start the 7-day trial for new users (entitlementStatus === "free").
  // This sets subscriptionStatus = "trialing" on the backend.
  useEffect(() => {
    if (
      !isLoading &&
      entitlementStatus === "free" &&
      !trialStartAttempted.current &&
      !startTrial.isPending
    ) {
      trialStartAttempted.current = true;
      console.log("[SubscriptionGate] Auto-starting 7-day trial for new user");
      startTrial.mutate();
    }
  }, [isLoading, entitlementStatus]);

  // Always check RevenueCat on mount — ensures returning subscribers aren't shown the paywall before sync.
  useEffect(() => {
    if (!isRevenueCatEnabled()) {
      setIsCheckingRevenueCat(false);
      return;
    }

    let cancelled = false;
    const safetyTimer = setTimeout(() => {
      if (!cancelled) setIsCheckingRevenueCat(false);
    }, 6000);

    async function checkRevenueCatStatus() {
      try {
        const result = await restorePurchases();
        if (!cancelled && result.ok) {
          const isPremium = result.data.entitlements.active?.premium;
          if (isPremium) {
            await api.post("/api/subscription/sync-revenuecat", {
              isActive: true,
              expirationDate: isPremium.expirationDate ?? undefined,
            });
            queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
            queryClient.invalidateQueries({ queryKey: ["profile"] });
          }
        }
      } catch (error) {
        console.log("[SubscriptionGate] RevenueCat check failed:", error);
      } finally {
        clearTimeout(safetyTimer);
        if (!cancelled) setIsCheckingRevenueCat(false);
      }
    }

    checkRevenueCatStatus();
    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, []);

  // Still loading — let through to avoid flash
  if (isLoading || isCheckingRevenueCat) {
    return <>{children}</>;
  }

  // Trial being started — let through
  if (entitlementStatus === "free" || startTrial.isPending) {
    return <>{children}</>;
  }

  // Trialing or active subscription — full access
  if (hasPremiumAccess) {
    return <>{children}</>;
  }

  // Expired trial with no active subscription — show paywall gate
  if (entitlementStatus === "expired") {
    const handleSubscribe = () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({ pathname: "/paywall", params: { trialExpired: "true" } });
    };

    const handleRestore = async () => {
      setIsRestoring(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        const result = await restorePurchases();
        if (result.ok) {
          const isPremium = result.data.entitlements.active?.premium;
          if (isPremium) {
            await api.post("/api/subscription/sync-revenuecat", {
              isActive: true,
              expirationDate: isPremium.expirationDate ?? undefined,
            });
            queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
            queryClient.invalidateQueries({ queryKey: ["profile"] });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        }
      } catch (error) {
        console.log("[SubscriptionGate] Restore failed:", error);
      } finally {
        setIsRestoring(false);
      }
    };

    return (
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          <View
            className="flex-1 items-center justify-center px-8"
            style={{ paddingTop: insets.top }}
          >
            {/* Alert icon */}
            <View className="w-20 h-20 rounded-3xl bg-amber-500/20 items-center justify-center mb-6">
              <AlertTriangle size={40} color="#f59e0b" />
            </View>

            {/* Title */}
            <Text className="text-white font-bold text-2xl text-center mb-3">
              Your Trial Has Ended
            </Text>

            {/* Description */}
            <Text className="text-slate-400 text-center text-base leading-relaxed mb-2">
              Your 7-day free trial is over.
            </Text>
            <Text className="text-slate-400 text-center text-base leading-relaxed mb-8">
              Subscribe on{" "}
              <Text className="text-amber-400 font-semibold">pilotpaytracker.com</Text>
              {" "}to keep tracking your pay.
            </Text>

            {/* Subscribe button → opens paywall which goes to website */}
            <Pressable
              onPress={handleSubscribe}
              className="w-full bg-amber-500 py-4 rounded-2xl items-center active:bg-amber-600 mb-4"
            >
              <View className="flex-row items-center">
                <Crown size={20} color="#0f172a" />
                <Text className="text-slate-900 font-bold text-base ml-2">
                  Subscribe on Website
                </Text>
              </View>
            </Pressable>

            {/* Restore purchases button */}
            <Pressable
              onPress={handleRestore}
              disabled={isRestoring}
              className="flex-row items-center py-3 active:opacity-70"
            >
              {isRestoring ? (
                <ActivityIndicator size="small" color="#94a3b8" />
              ) : (
                <>
                  <RefreshCw size={16} color="#94a3b8" />
                  <Text className="text-slate-400 text-sm ml-2">
                    Already subscribed? Restore Access
                  </Text>
                </>
              )}
            </Pressable>

            {/* Benefits reminder */}
            <View className="mt-8 w-full bg-slate-800/30 rounded-2xl p-4">
              <Text className="text-slate-500 text-xs text-center mb-3 uppercase tracking-wider">
                Premium includes
              </Text>
              <Text className="text-slate-300 text-sm text-center leading-relaxed">
                Unlimited trip imports • Pay confidence scoring{"\n"}
                Earnings projections • 30-in-7 compliance{"\n"}
                Smart change detection • Priority support
              </Text>
            </View>
          </View>
        </LinearGradient>
      </View>
    );
  }

  // Default: allow access
  return <>{children}</>;
}
