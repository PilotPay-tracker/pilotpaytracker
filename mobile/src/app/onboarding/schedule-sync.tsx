/**
 * Onboarding Step 3: Schedule Upload
 *
 * Final onboarding step where user uploads their schedule snapshot.
 * Calendar sync removed - upload is the recommended approach.
 */

import { useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Camera,
  PartyPopper,
  Upload,
} from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile } from "@/lib/state/profile-store";

export default function ScheduleSyncScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const updateMutation = useUpdateProfileMutation();

  const handleUploadSchedule = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateMutation.mutateAsync({
        onboardingStep: 3,
        onboardingComplete: true,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to main app - user can upload from trips screen
      router.replace("/(tabs)");
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("Failed to complete onboarding:", error);
    }
  }, [updateMutation, router]);

  const handleSkip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await updateMutation.mutateAsync({
        onboardingStep: 3,
        onboardingComplete: true,
      });

      router.replace("/(tabs)");
    } catch (error) {
      console.error("Failed to skip:", error);
    }
  }, [updateMutation, router]);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 24 }}
            className="px-6"
          >
            {/* Back button */}
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center mb-4"
            >
              <ChevronLeft size={24} color="#f59e0b" />
            </Pressable>

            {/* Step indicator - 3 steps total */}
            <View className="flex-row items-center mb-6">
              <View className="w-8 h-8 rounded-full bg-green-500 items-center justify-center">
                <CheckCircle2 size={16} color="#ffffff" />
              </View>
              <View className="flex-1 h-1 bg-green-500 mx-2" />
              <View className="w-8 h-8 rounded-full bg-green-500 items-center justify-center">
                <CheckCircle2 size={16} color="#ffffff" />
              </View>
              <View className="flex-1 h-1 bg-amber-500 mx-2" />
              <View className="w-8 h-8 rounded-full bg-amber-500 items-center justify-center">
                <Text className="text-slate-900 font-bold">3</Text>
              </View>
            </View>

            <Calendar size={32} color="#f59e0b" />
            <Text className="text-white text-3xl font-bold mt-4">
              Upload your schedule
            </Text>
            <Text className="text-slate-400 text-base mt-2">
              Upload your schedule to start tracking trips and pay.
            </Text>
          </Animated.View>

          {/* Upload Option - Recommended */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="px-6 mt-8"
          >
            <View className="bg-amber-500/10 border-2 border-amber-500 rounded-2xl p-5">
              <View className="flex-row items-center">
                <View className="w-14 h-14 rounded-full bg-amber-500/20 items-center justify-center">
                  <Camera size={26} color="#f59e0b" />
                </View>
                <View className="flex-1 ml-4">
                  <View className="flex-row items-center">
                    <Text className="text-amber-500 text-lg font-semibold">
                      Upload Schedule Snapshot
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-sm mt-1">
                    Take screenshots of your Trip Board or Crew Access
                  </Text>
                </View>
              </View>

              {/* Features */}
              <View className="mt-4 pt-4 border-t border-amber-500/20">
                <View className="flex-row items-center mb-2">
                  <CheckCircle2 size={16} color="#22c55e" />
                  <Text className="text-slate-300 text-sm ml-2">
                    Works with Crew Access & Trip Board
                  </Text>
                </View>
                <View className="flex-row items-center mb-2">
                  <CheckCircle2 size={16} color="#22c55e" />
                  <Text className="text-slate-300 text-sm ml-2">
                    AI extracts trip details automatically
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <CheckCircle2 size={16} color="#22c55e" />
                  <Text className="text-slate-300 text-sm ml-2">
                    Hotel & transportation info included
                  </Text>
                </View>
              </View>

              {/* Recommended badge */}
              <View className="absolute top-3 right-3 px-2 py-1 rounded bg-green-500/20">
                <Text className="text-green-400 text-xs font-semibold">
                  Recommended
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* How it works */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-6 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              How it works
            </Text>
            <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
              <View className="flex-row items-start mb-3">
                <View className="w-6 h-6 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                  <Text className="text-amber-500 text-xs font-bold">1</Text>
                </View>
                <Text className="text-slate-300 text-sm flex-1">
                  Screenshot your schedule from Crew Access or Trip Board
                </Text>
              </View>
              <View className="flex-row items-start mb-3">
                <View className="w-6 h-6 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                  <Text className="text-amber-500 text-xs font-bold">2</Text>
                </View>
                <Text className="text-slate-300 text-sm flex-1">
                  Upload the screenshot in the app
                </Text>
              </View>
              <View className="flex-row items-start">
                <View className="w-6 h-6 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                  <Text className="text-amber-500 text-xs font-bold">3</Text>
                </View>
                <Text className="text-slate-300 text-sm flex-1">
                  AI extracts all trip details and calculates pay
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Almost Done Message */}
          <Animated.View
            entering={FadeInUp.duration(600).delay(400)}
            className="mx-6 mt-6 bg-green-500/10 border border-green-500/30 rounded-xl p-4"
          >
            <View className="flex-row items-center">
              <PartyPopper size={24} color="#22c55e" />
              <View className="flex-1 ml-3">
                <Text className="text-green-400 font-semibold">
                  Almost done!
                </Text>
                <Text className="text-green-400/70 text-sm mt-0.5">
                  Your {profile?.airline ?? "UPS"} profile is ready. Upload your
                  schedule to start tracking pay.
                </Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Bottom Buttons */}
        <Animated.View
          entering={FadeInUp.duration(600).delay(500)}
          className="absolute bottom-0 left-0 right-0 px-6"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <LinearGradient
            colors={["transparent", "#0f172a"]}
            style={{
              position: "absolute",
              top: -40,
              left: 0,
              right: 0,
              height: 40,
            }}
          />

          {/* Continue Button */}
          <Pressable
            onPress={handleUploadSchedule}
            disabled={updateMutation.isPending}
            className={`rounded-2xl p-4 flex-row items-center justify-center mb-3 ${
              !updateMutation.isPending
                ? "bg-amber-500 active:opacity-80"
                : "bg-slate-700"
            }`}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator size="small" color="#0f172a" />
            ) : (
              <>
                <Upload size={20} color="#0f172a" />
                <Text className="font-bold text-lg text-slate-900 ml-2">
                  Continue to App
                </Text>
                <ChevronRight
                  size={20}
                  color="#0f172a"
                  style={{ marginLeft: 4 }}
                />
              </>
            )}
          </Pressable>

          {/* Skip Button */}
          <Pressable
            onPress={handleSkip}
            disabled={updateMutation.isPending}
            className="rounded-2xl p-4 flex-row items-center justify-center bg-slate-800/60 border border-slate-700 active:opacity-80"
          >
            <Text className="text-slate-300 font-semibold">Skip for now</Text>
          </Pressable>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}
