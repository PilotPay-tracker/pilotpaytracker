/**
 * Welcome Screen
 * - Title: Pilot Pay Tracker
 * - Features list
 * - Create Account, Sign In buttons
 */

import { View, Text, Pressable, Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Plane, AlertTriangle, DollarSign, Shield, TrendingUp } from "lucide-react-native";
import { useRef } from "react";
import { BACKEND_URL } from "@/lib/api";

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Secret diagnostics access - tap logo 5 times
  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  const handleLogoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current > 2000) {
      // Reset if more than 2 seconds since last tap
      tapCountRef.current = 0;
    }
    lastTapRef.current = now;
    tapCountRef.current += 1;

    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push("/diagnostics");
    }
  };

  const handleCreateAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/create-account");
  };

  const handleSignIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/sign-in");
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
          className="flex-1 px-6"
          style={{ paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20 }}
        >
          {/* Logo & Title */}
          <Animated.View
            entering={FadeInDown.duration(700).delay(100)}
            className="items-center"
          >
            <Pressable onPress={handleLogoTap}>
              <View className="w-24 h-24 rounded-full bg-amber-500/20 items-center justify-center mb-6">
                <Plane size={48} color="#f59e0b" strokeWidth={1.5} />
              </View>
            </Pressable>
            <Text className="text-white text-4xl font-bold text-center">
              Never Get Underpaid Again
            </Text>
            <Text className="text-slate-400 text-lg mt-3 text-center">
              Track, audit, and verify your pay using real UPS schedule data.
            </Text>
          </Animated.View>

          {/* Features */}
          <Animated.View
            entering={FadeInDown.duration(700).delay(300)}
            className="mt-10"
          >
            <View className="bg-slate-900/60 rounded-2xl p-5 border border-slate-800">
              <View className="flex-row items-center mb-4">
                <View className="w-10 h-10 rounded-full bg-red-500/20 items-center justify-center">
                  <AlertTriangle size={20} color="#ef4444" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-white font-semibold text-base">
                    Catch Pay Mistakes Instantly
                  </Text>
                  <Text className="text-slate-400 text-sm mt-0.5">
                    Compare your schedule vs paycheck and flag missing credit, premiums, and errors.
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center mb-4">
                <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center">
                  <DollarSign size={20} color="#f59e0b" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-white font-semibold text-base">
                    Know Exactly What You Should Be Paid
                  </Text>
                  <Text className="text-slate-400 text-sm mt-0.5">
                    Real-time projections using your trips, premiums, JA pay, and guarantee logic.
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center mb-4">
                <View className="w-10 h-10 rounded-full bg-blue-500/20 items-center justify-center">
                  <Shield size={20} color="#3b82f6" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-white font-semibold text-base">
                    Built for UPS Pay Rules
                  </Text>
                  <Text className="text-slate-400 text-sm mt-0.5">
                    Handles 75-hour guarantee, JA 150%, premium codes, and schedule changes correctly.
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-green-500/20 items-center justify-center">
                  <TrendingUp size={20} color="#22c55e" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-white font-semibold text-base">
                    Plan A + Plan B, Simplified
                  </Text>
                  <Text className="text-slate-400 text-sm mt-0.5">
                    Track your pension, savings, and long-term income based on your real career progression.
                  </Text>
                </View>
              </View>
            </View>

            <Text className="text-slate-500 text-sm text-center mt-4">
              Built by a UPS pilot to track pay today and plan for tomorrow.
            </Text>
          </Animated.View>

          {/* Spacer */}
          <View className="flex-1" />

          {/* Buttons */}
          <Animated.View entering={FadeInUp.duration(700).delay(500)}>
            <Text className="text-slate-500 text-xs text-center mb-3">
              Pilots can miss hundreds to thousands per year in unnoticed pay differences.
            </Text>
            <Pressable
              onPress={handleCreateAccount}
              className="bg-amber-500 rounded-2xl p-4 items-center active:opacity-80"
            >
              <Text className="text-slate-900 text-lg font-bold">Check My Pay Now</Text>
            </Pressable>

            <Pressable
              onPress={handleSignIn}
              className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 items-center mt-3 active:opacity-80"
            >
              <Text className="text-white text-lg font-semibold">Sign In</Text>
            </Pressable>
          </Animated.View>

          {/* Footer */}
          <Animated.View entering={FadeInUp.duration(700).delay(600)} className="mt-6">
            <Text className="text-slate-500 text-sm text-center">
              By continuing, you agree to our{" "}
              <Text
                className="text-amber-500"
                onPress={() => Linking.openURL(`${BACKEND_URL}/terms`)}
              >
                Terms
              </Text>{" "}
              and{" "}
              <Text
                className="text-amber-500"
                onPress={() => Linking.openURL(`${BACKEND_URL}/privacy`)}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </Animated.View>
        </View>
      </LinearGradient>
    </View>
  );
}
