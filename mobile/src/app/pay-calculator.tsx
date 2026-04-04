/**
 * Pay Calculator Screen - Estimate pay for trips/flights
 */

import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import {
  ChevronLeft,
  Calculator,
  Clock,
  DollarSign,
  Plus,
  Minus,
  Info,
  Sparkles,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useHourlyRateCents } from "@/lib/state/profile-store";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

// Premium code options
const PREMIUM_OPTIONS = [
  { code: null, name: "None", description: "No premium", effect: "0" },
  { code: "AP", name: "Airport Reserve", description: "+2:00 credit", effect: "+2:00" },
  { code: "SVT", name: "Short Visit", description: "+2:00 credit", effect: "+2:00" },
  { code: "LRP", name: "Long Range", description: "+6:00 credit", effect: "+6:00" },
  { code: "LP1", name: "Time and a Half", description: "1.5x credit", effect: "1.5x" },
  { code: "LP2", name: "Double Time Plus", description: "2.5x credit", effect: "2.5x" },
];

// Parse HH:MM to minutes
function parseTimeToMinutes(time: string): number {
  if (!time) return 0;
  const match = time.match(/^(\d{1,2}):?(\d{2})?$/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  return hours * 60 + minutes;
}

// Format minutes to HH:MM
function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

// Format cents to currency
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PayCalculatorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profileHourlyRateCents = useHourlyRateCents();
  const { showTutorial, closeTutorial, TutorialModalComponent } = useAutoTutorial("pay_calculator");

  // Input state
  const [creditTime, setCreditTime] = useState("6:00");
  const [blockTime, setBlockTime] = useState("6:00");
  const [hourlyRate, setHourlyRate] = useState("");
  const [selectedPremium, setSelectedPremium] = useState<string | null>(null);
  const [dutyDays, setDutyDays] = useState(1);

  // Auto-populate hourly rate from profile on mount
  useEffect(() => {
    if (profileHourlyRateCents > 0) {
      const rateInDollars = (profileHourlyRateCents / 100).toFixed(2);
      setHourlyRate(rateInDollars);
    }
  }, [profileHourlyRateCents]);

  // Calculations
  const calculations = useMemo(() => {
    const creditMinutes = parseTimeToMinutes(creditTime);
    const blockMinutes = parseTimeToMinutes(blockTime);
    const rateCents = Math.round(parseFloat(hourlyRate || "0") * 100);
    const minDailyCredit = 360; // 6:00 minimum

    // Apply premium to credit
    let adjustedCreditMinutes = creditMinutes;
    const premium = PREMIUM_OPTIONS.find((p) => p.code === selectedPremium);

    if (premium?.code) {
      if (["AP", "SVT"].includes(premium.code)) {
        adjustedCreditMinutes += 120; // +2:00
      } else if (premium.code === "LRP") {
        adjustedCreditMinutes += 360; // +6:00
      } else if (premium.code === "LP1") {
        adjustedCreditMinutes = Math.round(adjustedCreditMinutes * 1.5);
      } else if (premium.code === "LP2") {
        adjustedCreditMinutes = Math.round(adjustedCreditMinutes * 2.5);
      }
    }

    // Apply minimum daily guarantee per duty day
    const guaranteedCreditMinutes = Math.max(
      adjustedCreditMinutes,
      minDailyCredit * dutyDays
    );

    // Calculate overage (block > credit)
    const overageMinutes = Math.max(0, blockMinutes - creditMinutes);

    // Calculate pay
    const basePayCents = Math.round((guaranteedCreditMinutes / 60) * rateCents);
    const overagePayCents = Math.round((overageMinutes / 60) * rateCents);
    const totalPayCents = basePayCents + overagePayCents;

    return {
      creditMinutes,
      blockMinutes,
      adjustedCreditMinutes,
      guaranteedCreditMinutes,
      overageMinutes,
      basePayCents,
      overagePayCents,
      totalPayCents,
      minGuaranteeApplied: guaranteedCreditMinutes > adjustedCreditMinutes,
      premiumApplied: adjustedCreditMinutes > creditMinutes,
    };
  }, [creditTime, blockTime, hourlyRate, selectedPremium, dutyDays]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            className="flex-1"
          >
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingBottom: 100 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View style={{ paddingTop: insets.top + 8 }} className="px-5">
                <View className="flex-row items-center justify-between mb-4">
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.back();
                    }}
                    className="flex-row items-center active:opacity-70"
                  >
                    <ChevronLeft size={24} color="#f59e0b" />
                    <Text className="text-amber-500 text-base ml-1">Back</Text>
                  </Pressable>
                  <HelpButton tutorialId="pay_calculator" />
                </View>

                <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                  <View className="flex-row items-center mb-2">
                    <Calculator size={24} color="#f59e0b" />
                    <Text className="text-amber-500 text-base font-semibold ml-2">
                      Calculator
                    </Text>
                  </View>
                  <Text className="text-white text-3xl font-bold">Pay Calculator</Text>
                  <Text className="text-slate-400 text-base mt-1">
                    Estimate pay for trips and flights
                  </Text>
                </Animated.View>
              </View>

              {/* Time Inputs */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Flight Times
                </Text>
                <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                  {/* Credit Time */}
                  <View className="mb-4">
                    <Text className="text-slate-400 text-sm mb-2">Credit Time (HH:MM)</Text>
                    <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                      <Clock size={20} color="#f59e0b" />
                      <TextInput
                        value={creditTime}
                        onChangeText={setCreditTime}
                        placeholder="6:00"
                        placeholderTextColor="#64748b"
                        keyboardType="numbers-and-punctuation"
                        className="flex-1 text-white text-lg font-medium ml-3"
                      />
                    </View>
                  </View>

                  {/* Block Time */}
                  <View>
                    <Text className="text-slate-400 text-sm mb-2">Block Time (HH:MM)</Text>
                    <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                      <Clock size={20} color="#3b82f6" />
                      <TextInput
                        value={blockTime}
                        onChangeText={setBlockTime}
                        placeholder="6:00"
                        placeholderTextColor="#64748b"
                        keyboardType="numbers-and-punctuation"
                        className="flex-1 text-white text-lg font-medium ml-3"
                      />
                    </View>
                  </View>
                </View>
              </Animated.View>

              {/* Rate & Duty Days */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(200)}
                className="mx-5 mt-4"
              >
                <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                  {/* Hourly Rate */}
                  <View className="mb-4">
                    <Text className="text-slate-400 text-sm mb-2">Hourly Rate ($)</Text>
                    <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                      <DollarSign size={20} color="#22c55e" />
                      <TextInput
                        value={hourlyRate}
                        onChangeText={setHourlyRate}
                        placeholder="From profile"
                        placeholderTextColor="#64748b"
                        keyboardType="decimal-pad"
                        className="flex-1 text-white text-lg font-medium ml-3"
                      />
                      {profileHourlyRateCents > 0 && hourlyRate === (profileHourlyRateCents / 100).toFixed(2) && (
                        <Text className="text-green-400 text-xs">Profile</Text>
                      )}
                    </View>
                  </View>

                  {/* Duty Days */}
                  <View>
                    <Text className="text-slate-400 text-sm mb-2">Duty Days</Text>
                    <View className="flex-row items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3">
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setDutyDays(Math.max(1, dutyDays - 1));
                        }}
                        className="w-10 h-10 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                      >
                        <Minus size={20} color="#fff" />
                      </Pressable>
                      <Text className="text-white text-2xl font-bold">{dutyDays}</Text>
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setDutyDays(Math.min(10, dutyDays + 1));
                        }}
                        className="w-10 h-10 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                      >
                        <Plus size={20} color="#fff" />
                      </Pressable>
                    </View>
                    <Text className="text-slate-500 text-xs mt-2 text-center">
                      Min {dutyDays * 6}:00 guarantee ({dutyDays} x 6:00)
                    </Text>
                  </View>
                </View>
              </Animated.View>

              {/* Premium Selection */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="mx-5 mt-4"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Premium Code
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0 }}
                >
                  {PREMIUM_OPTIONS.map((premium) => (
                    <Pressable
                      key={premium.code ?? "none"}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedPremium(premium.code);
                      }}
                      className={`mr-3 px-4 py-3 rounded-xl border ${
                        selectedPremium === premium.code
                          ? "bg-amber-500/20 border-amber-500"
                          : "bg-slate-900/60 border-slate-700/50"
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          selectedPremium === premium.code
                            ? "text-amber-400"
                            : "text-white"
                        }`}
                      >
                        {premium.name}
                      </Text>
                      <Text className="text-slate-400 text-xs mt-0.5">
                        {premium.effect}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </Animated.View>

              {/* Results */}
              <Animated.View
                entering={FadeIn.duration(600).delay(300)}
                className="mx-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Pay Breakdown
                </Text>
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                  {/* Credit breakdown */}
                  <View className="p-4 border-b border-slate-700/50">
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-slate-400">Base Credit</Text>
                      <Text className="text-white font-medium">
                        {formatMinutes(calculations.creditMinutes)}
                      </Text>
                    </View>

                    {calculations.premiumApplied && (
                      <View className="flex-row justify-between items-center mb-2">
                        <Text className="text-amber-400">+ Premium</Text>
                        <Text className="text-amber-400 font-medium">
                          {formatMinutes(
                            calculations.adjustedCreditMinutes - calculations.creditMinutes
                          )}
                        </Text>
                      </View>
                    )}

                    {calculations.minGuaranteeApplied && (
                      <View className="flex-row justify-between items-center mb-2">
                        <View className="flex-row items-center">
                          <Sparkles size={14} color="#22c55e" />
                          <Text className="text-green-400 ml-1">Min Guarantee</Text>
                        </View>
                        <Text className="text-green-400 font-medium">
                          {formatMinutes(
                            calculations.guaranteedCreditMinutes -
                              calculations.adjustedCreditMinutes
                          )}
                        </Text>
                      </View>
                    )}

                    <View className="flex-row justify-between items-center pt-2 border-t border-slate-700/30">
                      <Text className="text-white font-semibold">Final Credit</Text>
                      <Text className="text-white font-bold">
                        {formatMinutes(calculations.guaranteedCreditMinutes)}
                      </Text>
                    </View>
                  </View>

                  {/* Pay breakdown */}
                  <View className="p-4 border-b border-slate-700/50">
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-slate-400">Credit Pay</Text>
                      <Text className="text-white font-medium">
                        {formatCurrency(calculations.basePayCents)}
                      </Text>
                    </View>

                    {calculations.overageMinutes > 0 && (
                      <View className="flex-row justify-between items-center">
                        <Text className="text-blue-400">
                          + Overage ({formatMinutes(calculations.overageMinutes)})
                        </Text>
                        <Text className="text-blue-400 font-medium">
                          {formatCurrency(calculations.overagePayCents)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Total */}
                  <View className="p-4 bg-amber-500/10">
                    <View className="flex-row justify-between items-center">
                      <Text className="text-amber-400 text-lg font-semibold">
                        Total Pay
                      </Text>
                      <Text className="text-amber-400 text-2xl font-bold">
                        {formatCurrency(calculations.totalPayCents)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>

              {/* Info Note */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(350)}
                className="mx-5 mt-4"
              >
                <View className="flex-row items-start bg-blue-900/20 rounded-xl p-4 border border-blue-700/30">
                  <Info size={18} color="#60a5fa" />
                  <Text className="text-blue-300 text-sm ml-3 flex-1">
                    Hourly rate is auto-populated from your profile settings. Actual pay
                    may vary based on your specific contract and pay rules configuration.
                  </Text>
                </View>
              </Animated.View>
            </ScrollView>
          </KeyboardAvoidingView>
        </LinearGradient>
      </View>
      {TutorialModalComponent}
    </>
  );
}
