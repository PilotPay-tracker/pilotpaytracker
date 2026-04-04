/**
 * Onboarding Step 4 — Goals
 *
 * User selects their primary goal.
 * On completion, marks onboardingComplete: true and navigates to (tabs).
 */

import { useState } from "react";
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
import { ChevronLeft, DollarSign, TrendingUp, PiggyBank, FileText, Check } from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i < step ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i < step ? "#f59e0b" : "#1e293b",
          }}
        />
      ))}
    </View>
  );
}

const GOALS = [
  {
    id: "pay_tracking",
    icon: DollarSign,
    color: "#22c55e",
    bg: "rgba(34,197,94,0.12)",
    title: "Pay Tracking",
    desc: "Verify every paycheck and catch errors before they cost you",
  },
  {
    id: "upgrade_planning",
    icon: TrendingUp,
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
    title: "Upgrade Planning",
    desc: "Track seniority, bid windows, and your path to captain",
  },
  {
    id: "retirement_planning",
    icon: PiggyBank,
    color: "#a855f7",
    bg: "rgba(168,85,247,0.12)",
    title: "Retirement Planning",
    desc: "Project your pension, Plan A/B, and retirement timeline",
  },
  {
    id: "paycheck_projection",
    icon: FileText,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.12)",
    title: "Paycheck Projection",
    desc: "Forecast your earnings before your pay statement arrives",
  },
] as const;

type GoalId = (typeof GOALS)[number]["id"];

export default function OnboardingGoalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const updateProfile = useUpdateProfileMutation();
  const [selected, setSelected] = useState<GoalId | null>(null);

  const handleFinish = async () => {
    if (!selected) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateProfile.mutateAsync({
      onboardingStep: 4,
      onboardingComplete: true,
    });
    router.replace("/(tabs)");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#030712" }}>
      <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View
            style={{
              paddingTop: insets.top + 16,
              paddingHorizontal: 24,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 32,
            }}
          >
            <Pressable
              onPress={() => router.replace("/onboarding/career")}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(30,41,59,0.8)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeft size={20} color="#94a3b8" />
            </Pressable>
            <ProgressBar step={3} total={4} />
            <View style={{ width: 40 }} />
          </View>

          <Animated.View entering={FadeInDown.delay(100).springify()} style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
              Step 4 of 4
            </Text>
            <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
              What's your{"\n"}main goal?
            </Text>
            <Text style={{ color: "#64748b", fontSize: 15, lineHeight: 22 }}>
              We'll prioritize what's most relevant to you. You can use all features regardless.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(180).springify()} style={{ paddingHorizontal: 24, gap: 12 }}>
            {GOALS.map((goal, i) => {
              const active = selected === goal.id;
              return (
                <Animated.View key={goal.id} entering={FadeInDown.delay(200 + i * 60).springify()}>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelected(goal.id);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: active ? "rgba(245,158,11,0.08)" : "rgba(15,23,42,0.7)",
                      borderRadius: 18,
                      borderWidth: 1.5,
                      borderColor: active ? "#f59e0b" : "rgba(255,255,255,0.06)",
                      padding: 18,
                      gap: 16,
                    }}
                  >
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 16,
                        backgroundColor: active ? goal.bg : "rgba(15,23,42,0.9)",
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: active ? goal.color + "44" : "transparent",
                        flexShrink: 0,
                      }}
                    >
                      <goal.icon size={24} color={active ? goal.color : "#475569"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: active ? "#ffffff" : "#94a3b8", fontWeight: "700", fontSize: 16, marginBottom: 4 }}>
                        {goal.title}
                      </Text>
                      <Text style={{ color: active ? "#94a3b8" : "#475569", fontSize: 13, lineHeight: 18 }}>
                        {goal.desc}
                      </Text>
                    </View>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: active ? "#f59e0b" : "transparent",
                        borderWidth: active ? 0 : 1.5,
                        borderColor: "#334155",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {active && <Check size={14} color="#0f172a" strokeWidth={3} />}
                    </View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.View>
        </ScrollView>

        {/* Footer CTA */}
        <Animated.View
          entering={FadeInUp.delay(400).springify()}
          style={{
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 16,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(6,18,32,0.95)",
          }}
        >
          <Pressable
            onPress={handleFinish}
            disabled={!selected || updateProfile.isPending}
            style={{
              backgroundColor: selected ? "#f59e0b" : "#1e293b",
              borderRadius: 18,
              paddingVertical: 18,
              alignItems: "center",
            }}
          >
            {updateProfile.isPending ? (
              <ActivityIndicator color={selected ? "#0f172a" : "#475569"} />
            ) : (
              <Text style={{ color: selected ? "#0f172a" : "#475569", fontWeight: "800", fontSize: 17 }}>
                {selected ? "Start Tracking →" : "Select a Goal"}
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}
