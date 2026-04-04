/**
 * Onboarding Step 1: UPS Auto-Selection
 *
 * This screen auto-sets UPS as the airline and immediately proceeds
 * to the next onboarding step. No user selection is required.
 *
 * Built by a UPS pilot for UPS pilots.
 */

import { useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Package, Check } from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { getAliasPack } from "@/lib/data/airline-alias-packs";

// UPS is the only supported airline
const UPS_AIRLINE_ID = "UPS";

export default function AirlineSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const updateMutation = useUpdateProfileMutation();
  const hasInitiatedRef = useRef(false);

  const handleAutoSetUPS = useCallback(async () => {
    // Prevent multiple calls
    if (hasInitiatedRef.current || updateMutation.isPending) return;
    hasInitiatedRef.current = true;

    try {
      // Get the UPS alias pack
      const aliasPack = getAliasPack(UPS_AIRLINE_ID);

      // Auto-set UPS as the airline
      await updateMutation.mutateAsync({
        airline: UPS_AIRLINE_ID,
        operatorType: aliasPack.operatorType,
        aliasPackVersion: aliasPack.version,
        onboardingStep: 1,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to next step
      router.push("/onboarding/contract-upload" as any);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("Failed to set airline:", error);
      hasInitiatedRef.current = false; // Allow retry on error
    }
  }, [updateMutation, router]);

  // Auto-trigger UPS selection on mount
  useEffect(() => {
    // Small delay for smooth transition
    const timer = setTimeout(() => {
      handleAutoSetUPS();
    }, 800);
    return () => clearTimeout(timer);
  }, [handleAutoSetUPS]);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <View
          className="flex-1 items-center justify-center px-6"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            className="items-center"
          >
            {/* UPS Icon */}
            <View className="w-24 h-24 rounded-full bg-amber-500/20 items-center justify-center mb-6">
              <Package size={48} color="#f59e0b" />
            </View>

            {/* Header */}
            <Text className="text-white text-2xl font-bold text-center mb-2">
              Built by a UPS pilot
            </Text>
            <Text className="text-amber-500 text-xl font-semibold text-center mb-6">
              for UPS pilots
            </Text>

            {/* Loading state */}
            <View className="flex-row items-center bg-slate-800/60 rounded-2xl px-6 py-4 border border-slate-700/50">
              {updateMutation.isPending ? (
                <>
                  <ActivityIndicator size="small" color="#f59e0b" />
                  <Text className="text-slate-300 text-base ml-3">
                    Setting up UPS configuration...
                  </Text>
                </>
              ) : (
                <>
                  <View className="w-8 h-8 rounded-full bg-green-500/20 items-center justify-center">
                    <Check size={18} color="#22c55e" />
                  </View>
                  <Text className="text-slate-300 text-base ml-3">
                    UPS pilot configuration loaded
                  </Text>
                </>
              )}
            </View>

            {/* UPS-specific terminology info */}
            <Text className="text-slate-500 text-sm text-center mt-6 px-4">
              All terminology, pay codes, and contract rules are configured for the UPS Collective Bargaining Agreement.
            </Text>
          </Animated.View>
        </View>
      </LinearGradient>
    </View>
  );
}
