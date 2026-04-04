/**
 * Paywall Screen
 *
 * Trial-expired screen that directs users to the website for subscription.
 * All payments are handled on the website via Stripe — no in-app purchases.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
  Linking,
  AppState,
  type AppStateStatus,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  X,
  Check,
  Crown,
  Sparkles,
  Shield,
  Bell,
  FileText,
  Clock,
  TrendingUp,
  Zap,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
} from "lucide-react-native";
import { cn } from "@/lib/cn";
import { BACKEND_URL } from "@/lib/api";
import { useProfile } from "@/lib/state/profile-store";
import { usePremiumAccess, useSubscriptionStatus } from "@/lib/useSubscription";
import { useResponsive } from "@/lib/responsive";
import { useQueryClient } from "@tanstack/react-query";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Website URL for subscription page
const getWebUrl = () => {
  return (
    (process.env.EXPO_PUBLIC_WEB_URL as string | undefined) ??
    "https://pilotpaytracker.com"
  );
};

// Premium features list
const PREMIUM_FEATURES = [
  {
    icon: FileText,
    title: "Unlimited Trip Board Imports",
    description: "Import and track all schedule changes",
  },
  {
    icon: Bell,
    title: "Smart Change Detection",
    description: "AI-powered schedule diff analysis",
  },
  {
    icon: Shield,
    title: "Pay Confidence Scoring",
    description: "Know your pay accuracy at a glance",
  },
  {
    icon: TrendingUp,
    title: "Earnings Projections",
    description: "Forecast annual income & set goals",
  },
  {
    icon: Clock,
    title: "30-in-7 Compliance",
    description: "Real-time FAR tracking alerts",
  },
  {
    icon: Zap,
    title: "Priority Support",
    description: "Direct access to pilot support team",
  },
];

// Feature row component
function FeatureRow({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <View className="flex-row items-center py-3">
      <View className="w-10 h-10 rounded-xl bg-amber-500/10 items-center justify-center mr-3 shrink-0">
        <Icon size={20} color="#f59e0b" />
      </View>
      <View className="flex-1">
        <Text className="text-white font-semibold text-sm">{title}</Text>
        <Text className="text-slate-400 text-xs mt-0.5">{description}</Text>
      </View>
    </View>
  );
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ source?: string; trialExpired?: string }>();
  const profile = useProfile();
  const { contentMaxWidth } = useResponsive();
  const queryClient = useQueryClient();

  const { hasPremiumAccess, isSubscriptionActive, isTrialActive, entitlementStatus } = usePremiumAccess();
  const { refetch: refetchSubscription } = useSubscriptionStatus();

  const [openingPlan, setOpeningPlan] = useState<"monthly" | "yearly" | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubscribingNow, setIsSubscribingNow] = useState(false);
  const appState = useRef(AppState.currentState);

  // Refresh subscription when user returns to app (e.g. after completing web checkout)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [queryClient]);

  const isTrialExpired = entitlementStatus === "expired" || params.trialExpired === "true";
  const hasActiveSubscription = hasPremiumAccess || isSubscriptionActive;

  // Animated glow effect
  const glowOpacity = useSharedValue(0.5);

  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.8, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 2000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  // Open website subscribe page from the trial active screen
  const handleSubscribeNow = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubscribingNow(true);
    try {
      const webUrl = getWebUrl();
      await Linking.openURL(`${webUrl}/subscribe`);
    } catch {
      Alert.alert(
        "Unable to Open Browser",
        "Please visit pilotpaytracker.com/subscribe to start your subscription."
      );
    } finally {
      setIsSubscribingNow(false);
    }
  }, []);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  // Open website subscription page in browser for a specific plan
  const handleSubscribe = useCallback(async (plan: "monthly" | "yearly") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setOpeningPlan(plan);
    try {
      const webUrl = getWebUrl();
      const url = `${webUrl}/subscribe?plan=${plan}`;
      await Linking.openURL(url);
    } catch (error) {
      console.error("[Paywall] Error opening subscription URL:", error);
      Alert.alert(
        "Unable to Open Browser",
        "Please visit pilotpaytracker.com/subscribe to start your subscription."
      );
    } finally {
      setOpeningPlan(null);
    }
  }, []);

  // Refresh subscription status (e.g. after completing web checkout)
  const handleRefreshSubscription = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await refetchSubscription();
    } catch (err) {
      console.error("[Paywall] Refresh subscription failed:", err);
      Alert.alert(
        "Couldn't refresh",
        "We couldn't confirm your subscription yet. Pull to refresh or try again."
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, refetchSubscription]);

  const handleOpenSignIn = () => {
    router.replace("/sign-in");
  };

  const handleSupport = async () => {
    try {
      await Linking.openURL("mailto:support@pilotpaytracker.app");
    } catch {
      // ignore
    }
  };

  const termsUrl = `${BACKEND_URL}/terms`;
  const privacyUrl = `${BACKEND_URL}/privacy`;

  const handleOpenTerms = async () => {
    try { await Linking.openURL(termsUrl); } catch { /* ignore */ }
  };
  const handleOpenPrivacy = async () => {
    try { await Linking.openURL(privacyUrl); } catch { /* ignore */ }
  };

  // Already premium — show confirmation screen
  if (hasActiveSubscription) {
    const isTrial = isTrialActive || entitlementStatus === "trialing";
    return (
      <View className="flex-1 bg-slate-900">
        <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
          <View
            className="flex-1 items-center justify-center px-8"
            style={{ paddingTop: insets.top }}
          >
            <View className="w-20 h-20 rounded-3xl bg-amber-500/20 items-center justify-center mb-6">
              <Crown size={40} color="#f59e0b" />
            </View>
            <Text className="text-white font-bold text-2xl text-center mb-2">
              {isTrial ? "Trial Active" : "You're Subscribed!"}
            </Text>
            <Text className="text-slate-400 text-center mb-8">
              {isTrial
                ? "Your 7-day free trial is active.\nYou have full access to all features."
                : "Your subscription is active.\nYou have full access to all features."}
            </Text>
            <Pressable
              onPress={handleClose}
              className="bg-amber-500 px-8 py-4 rounded-2xl active:bg-amber-600"
            >
              <Text className="text-slate-900 font-bold text-base">Continue</Text>
            </Pressable>
            {isTrial && (
              <>
                <Text className="text-slate-600 text-xs text-center mt-3 mb-1">
                  No charge until trial ends
                </Text>
                <Pressable
                  onPress={handleSubscribeNow}
                  disabled={isSubscribingNow}
                  className="py-2 px-6 mt-1 active:opacity-60"
                >
                  {isSubscribingNow ? (
                    <ActivityIndicator size="small" color="#94a3b8" />
                  ) : (
                    <Text className="text-slate-400 text-sm text-center">
                      Subscribe now
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
        {/* Background glow */}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: -100,
              left: SCREEN_WIDTH / 2 - 150,
              width: 300,
              height: 300,
              borderRadius: 150,
              backgroundColor: "#f59e0b",
            },
            glowStyle,
          ]}
        />
        <View
          style={{
            position: "absolute",
            top: -100,
            left: SCREEN_WIDTH / 2 - 150,
            width: 300,
            height: 300,
            borderRadius: 150,
          }}
        >
          <BlurView intensity={100} style={{ flex: 1, borderRadius: 150 }} />
        </View>

        {/* Header */}
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Pressable
            onPress={handleClose}
            className="w-10 h-10 rounded-full bg-slate-800/80 items-center justify-center"
          >
            <X size={20} color="#94a3b8" />
          </Pressable>
          <Pressable onPress={handleOpenSignIn} className="flex-row items-center py-2 px-3">
            <Text className="text-slate-400 text-sm">Log In</Text>
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            maxWidth: contentMaxWidth,
            width: "100%",
            alignSelf: "center" as const,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <Animated.View entering={FadeIn.delay(100)} className="items-center px-6 pt-6 pb-6">
            {isTrialExpired && (
              <View className="flex-row items-start bg-amber-500/20 rounded-xl px-4 py-3 mb-4">
                <AlertTriangle size={20} color="#f59e0b" />
                <Text className="text-amber-400 font-medium text-sm ml-2 flex-1">
                  Your trial has ended. Start a subscription to continue.
                </Text>
              </View>
            )}

            <View className="flex-row items-center mb-4">
              <Sparkles size={24} color="#f59e0b" />
              <Text className="text-amber-400 font-semibold text-sm ml-2 tracking-wide uppercase">
                {isTrialExpired ? "Subscribe to Continue" : "Upgrade to Premium"}
              </Text>
            </View>

            <Text className="text-white font-bold text-3xl text-center mb-3">
              Make Sure You're{"\n"}Getting Paid Correctly
            </Text>

            <Text className="text-slate-400 text-center text-base leading-relaxed">
              Track, audit, and verify your pay{"\n"}using real UPS schedule data.
            </Text>
          </Animated.View>

          {/* Plan Buttons */}
          <View className="px-5 mb-6 gap-3">
            <Animated.View entering={FadeInDown.delay(200).springify()}>
              <Pressable
                onPress={() => handleSubscribe("monthly")}
                disabled={openingPlan !== null}
              >
                <LinearGradient
                  colors={openingPlan === "monthly" ? ["#475569", "#334155"] : ["#1e293b", "#0f172a"]}
                  style={{
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#334155",
                    paddingVertical: 18,
                    paddingHorizontal: 20,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                      Start Monthly Plan
                    </Text>
                    <Text style={{ color: "#94a3b8", fontSize: 13, marginTop: 2 }}>
                      $9.99/month — cancel anytime
                    </Text>
                  </View>
                  {openingPlan === "monthly" ? (
                    <ActivityIndicator color="#f59e0b" size="small" />
                  ) : (
                    <ExternalLink size={18} color="#64748b" />
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(280).springify()}>
              <Pressable
                onPress={() => handleSubscribe("yearly")}
                disabled={openingPlan !== null}
              >
                <LinearGradient
                  colors={openingPlan === "yearly" ? ["#475569", "#334155"] : ["#f59e0b", "#d97706"]}
                  style={{
                    borderRadius: 14,
                    paddingVertical: 18,
                    paddingHorizontal: 20,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ color: "#0f172a", fontWeight: "700", fontSize: 16 }}>
                        Start Annual Plan
                      </Text>
                      <View style={{
                        backgroundColor: "#0f172a",
                        borderRadius: 8,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}>
                        <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "800" }}>
                          BEST VALUE
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: "#78350f", fontSize: 13, marginTop: 2 }}>
                      $99.99/year — save 2 months
                    </Text>
                  </View>
                  {openingPlan === "yearly" ? (
                    <ActivityIndicator color="#0f172a" size="small" />
                  ) : (
                    <ExternalLink size={18} color="#78350f" />
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </View>

          {/* Features */}
          <View className="px-5 mb-6">
            <Animated.Text
              entering={FadeInUp.delay(350)}
              className="text-slate-500 text-xs font-semibold tracking-wider mb-3 uppercase"
            >
              Everything You Get
            </Animated.Text>
            <View className="bg-slate-800/30 rounded-2xl px-4 border border-slate-700/30">
              {PREMIUM_FEATURES.map((feature, index) => (
                <View
                  key={feature.title}
                  className={cn(index < PREMIUM_FEATURES.length - 1 && "border-b border-slate-700/30")}
                >
                  <FeatureRow icon={feature.icon} title={feature.title} description={feature.description} />
                </View>
              ))}
            </View>
          </View>

          {/* Trust badges */}
          <Animated.View
            entering={FadeInUp.delay(500)}
            className="flex-row justify-center items-center px-5 mb-5"
          >
            <View className="flex-row items-center bg-slate-800/40 rounded-full px-4 py-2 mr-3">
              <Shield size={14} color="#22c55e" />
              <Text className="text-slate-400 text-xs ml-2">Secure Payment</Text>
            </View>
            <View className="flex-row items-center bg-slate-800/40 rounded-full px-4 py-2">
              <Clock size={14} color="#22c55e" />
              <Text className="text-slate-400 text-xs ml-2">Cancel Anytime</Text>
            </View>
          </Animated.View>

          {/* Restore / Refresh access */}
          <Animated.View entering={FadeInUp.delay(600)} className="items-center px-5 mb-4">
            <Pressable
              onPress={handleRefreshSubscription}
              disabled={isRefreshing}
              className="flex-row items-center py-3 px-5 bg-slate-800/40 rounded-xl border border-slate-700/40 active:bg-slate-700/40"
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color="#94a3b8" />
              ) : (
                <RefreshCw size={15} color="#94a3b8" />
              )}
              <Text className="text-slate-400 text-sm ml-2">
                {isRefreshing ? "Checking..." : "Already subscribed? Refresh Access"}
              </Text>
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(700)} className="items-center mb-6">
            <Pressable onPress={handleSupport}>
              <Text className="text-slate-500 text-sm underline">Need help? Contact support</Text>
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(750)} className="items-center px-5 mb-4">
            <Text className="text-slate-600 text-[10px] text-center leading-relaxed">
              Subscription managed on pilotpaytracker.com.{" "}
              <Text className="underline" onPress={handleOpenTerms}>Terms</Text>
              {" & "}
              <Text className="underline" onPress={handleOpenPrivacy}>Privacy</Text>
            </Text>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
