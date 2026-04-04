/**
 * Per Diem Calculator Screen - Calculate meal expenses
 */

import { useState, useMemo } from "react";
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
  DollarSign,
  Calendar,
  Utensils,
  Coffee,
  Moon,
  Sun,
  Plane,
  Plus,
  Minus,
  Info,
  MapPin,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

// Standard GSA per diem rates (2024/2025)
const PER_DIEM_RATES = {
  // Continental US standard
  CONUS_STANDARD: { meals: 64, incidentals: 15, total: 79 },
  // High cost areas
  HIGH_COST: { meals: 79, incidentals: 20, total: 99 },
  // International standard
  OCONUS_STANDARD: { meals: 74, incidentals: 20, total: 94 },
  // Custom
  CUSTOM: { meals: 0, incidentals: 0, total: 0 },
};

// Meal breakdown percentages (GSA standard)
const MEAL_PERCENTAGES = {
  breakfast: 0.2, // 20%
  lunch: 0.3, // 30%
  dinner: 0.5, // 50%
};

type RateType = "CONUS_STANDARD" | "HIGH_COST" | "OCONUS_STANDARD" | "CUSTOM";

// Format currency
function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Rate selection button
function RateButton({
  label,
  sublabel,
  selected,
  onPress,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={`flex-1 p-3 rounded-xl border mr-2 last:mr-0 ${
        selected
          ? "bg-amber-500/20 border-amber-500"
          : "bg-slate-800/60 border-slate-700/50"
      }`}
    >
      <Text
        className={`font-semibold text-center ${
          selected ? "text-amber-400" : "text-white"
        }`}
      >
        {label}
      </Text>
      <Text className="text-slate-400 text-xs text-center mt-0.5">{sublabel}</Text>
    </Pressable>
  );
}

// Meal toggle
function MealToggle({
  icon,
  label,
  amount,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      className={`flex-row items-center justify-between py-3 px-4 rounded-xl mb-2 ${
        enabled ? "bg-green-500/10 border border-green-500/30" : "bg-slate-800/40"
      }`}
    >
      <View className="flex-row items-center">
        {icon}
        <Text className={`ml-3 font-medium ${enabled ? "text-white" : "text-slate-500"}`}>
          {label}
        </Text>
      </View>
      <Text className={`font-semibold ${enabled ? "text-green-400" : "text-slate-600"}`}>
        {formatCurrency(amount)}
      </Text>
    </Pressable>
  );
}

export default function PerDiemCalculatorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { TutorialModalComponent } = useAutoTutorial("per_diem");

  // State
  const [rateType, setRateType] = useState<RateType>("CONUS_STANDARD");
  const [tripDays, setTripDays] = useState(3);
  const [customMeals, setCustomMeals] = useState("64");
  const [customIncidentals, setCustomIncidentals] = useState("15");
  const [includedMeals, setIncludedMeals] = useState({
    breakfast: true,
    lunch: true,
    dinner: true,
  });

  // Calculate per diem
  const calculations = useMemo(() => {
    const rates =
      rateType === "CUSTOM"
        ? {
            meals: parseFloat(customMeals) || 0,
            incidentals: parseFloat(customIncidentals) || 0,
            total: (parseFloat(customMeals) || 0) + (parseFloat(customIncidentals) || 0),
          }
        : PER_DIEM_RATES[rateType];

    // Calculate meal amounts
    const breakfastAmount = rates.meals * MEAL_PERCENTAGES.breakfast;
    const lunchAmount = rates.meals * MEAL_PERCENTAGES.lunch;
    const dinnerAmount = rates.meals * MEAL_PERCENTAGES.dinner;

    // Calculate daily total based on included meals
    let dailyMeals = 0;
    if (includedMeals.breakfast) dailyMeals += breakfastAmount;
    if (includedMeals.lunch) dailyMeals += lunchAmount;
    if (includedMeals.dinner) dailyMeals += dinnerAmount;

    const dailyTotal = dailyMeals + rates.incidentals;
    const tripTotal = dailyTotal * tripDays;

    // First/last day rules (75% typically)
    const firstLastDayRate = 0.75;
    const adjustedTripTotal =
      tripDays === 1
        ? dailyTotal * firstLastDayRate
        : tripDays === 2
        ? dailyTotal * firstLastDayRate * 2
        : dailyTotal * firstLastDayRate * 2 + dailyTotal * (tripDays - 2);

    return {
      rates,
      breakfastAmount,
      lunchAmount,
      dinnerAmount,
      dailyMeals,
      dailyTotal,
      tripTotal,
      adjustedTripTotal,
      incidentalsTotal: rates.incidentals * tripDays,
    };
  }, [rateType, customMeals, customIncidentals, includedMeals, tripDays]);

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
                  <HelpButton tutorialId="per_diem" />
                </View>

                <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                  <View className="flex-row items-center mb-2">
                    <Utensils size={24} color="#f59e0b" />
                    <Text className="text-amber-500 text-base font-semibold ml-2">
                      Calculator
                    </Text>
                  </View>
                  <Text className="text-white text-3xl font-bold">Per Diem</Text>
                  <Text className="text-slate-400 text-base mt-1">
                    Calculate meal and incidental expenses
                  </Text>
                </Animated.View>
              </View>

              {/* Rate Selection */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Per Diem Rate
                </Text>
                <View className="flex-row">
                  <RateButton
                    label="Standard"
                    sublabel="$79/day"
                    selected={rateType === "CONUS_STANDARD"}
                    onPress={() => setRateType("CONUS_STANDARD")}
                  />
                  <RateButton
                    label="High Cost"
                    sublabel="$99/day"
                    selected={rateType === "HIGH_COST"}
                    onPress={() => setRateType("HIGH_COST")}
                  />
                  <RateButton
                    label="Int'l"
                    sublabel="$94/day"
                    selected={rateType === "OCONUS_STANDARD"}
                    onPress={() => setRateType("OCONUS_STANDARD")}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRateType("CUSTOM");
                  }}
                  className={`mt-2 p-3 rounded-xl border ${
                    rateType === "CUSTOM"
                      ? "bg-amber-500/20 border-amber-500"
                      : "bg-slate-800/60 border-slate-700/50"
                  }`}
                >
                  <Text
                    className={`font-semibold text-center ${
                      rateType === "CUSTOM" ? "text-amber-400" : "text-white"
                    }`}
                  >
                    Custom Rate
                  </Text>
                </Pressable>
              </Animated.View>

              {/* Custom Rate Inputs */}
              {rateType === "CUSTOM" && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  className="mx-5 mt-4"
                >
                  <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                    <View className="flex-row">
                      <View className="flex-1 mr-2">
                        <Text className="text-slate-400 text-sm mb-2">Meals ($)</Text>
                        <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                          <DollarSign size={18} color="#f59e0b" />
                          <TextInput
                            value={customMeals}
                            onChangeText={setCustomMeals}
                            placeholder="64"
                            placeholderTextColor="#64748b"
                            keyboardType="decimal-pad"
                            className="flex-1 text-white text-lg font-medium ml-2"
                          />
                        </View>
                      </View>
                      <View className="flex-1">
                        <Text className="text-slate-400 text-sm mb-2">Incidentals ($)</Text>
                        <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                          <DollarSign size={18} color="#22c55e" />
                          <TextInput
                            value={customIncidentals}
                            onChangeText={setCustomIncidentals}
                            placeholder="15"
                            placeholderTextColor="#64748b"
                            keyboardType="decimal-pad"
                            className="flex-1 text-white text-lg font-medium ml-2"
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              )}

              {/* Trip Duration */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(200)}
                className="mx-5 mt-4"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Trip Duration
                </Text>
                <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                  <View className="flex-row items-center justify-between">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setTripDays(Math.max(1, tripDays - 1));
                      }}
                      className="w-12 h-12 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                    >
                      <Minus size={24} color="#fff" />
                    </Pressable>
                    <View className="items-center">
                      <Text className="text-white text-4xl font-bold">{tripDays}</Text>
                      <Text className="text-slate-400 text-sm">
                        {tripDays === 1 ? "day" : "days"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setTripDays(Math.min(30, tripDays + 1));
                      }}
                      className="w-12 h-12 rounded-full bg-slate-700 items-center justify-center active:opacity-70"
                    >
                      <Plus size={24} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              </Animated.View>

              {/* Meal Toggles */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="mx-5 mt-4"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Included Meals
                </Text>
                <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                  <MealToggle
                    icon={<Coffee size={20} color={includedMeals.breakfast ? "#f59e0b" : "#64748b"} />}
                    label="Breakfast"
                    amount={calculations.breakfastAmount}
                    enabled={includedMeals.breakfast}
                    onToggle={() =>
                      setIncludedMeals({ ...includedMeals, breakfast: !includedMeals.breakfast })
                    }
                  />
                  <MealToggle
                    icon={<Sun size={20} color={includedMeals.lunch ? "#f59e0b" : "#64748b"} />}
                    label="Lunch"
                    amount={calculations.lunchAmount}
                    enabled={includedMeals.lunch}
                    onToggle={() =>
                      setIncludedMeals({ ...includedMeals, lunch: !includedMeals.lunch })
                    }
                  />
                  <MealToggle
                    icon={<Moon size={20} color={includedMeals.dinner ? "#f59e0b" : "#64748b"} />}
                    label="Dinner"
                    amount={calculations.dinnerAmount}
                    enabled={includedMeals.dinner}
                    onToggle={() =>
                      setIncludedMeals({ ...includedMeals, dinner: !includedMeals.dinner })
                    }
                  />
                  <Text className="text-slate-500 text-xs mt-2 text-center">
                    Deselect meals provided by company/hotel
                  </Text>
                </View>
              </Animated.View>

              {/* Results */}
              <Animated.View
                entering={FadeIn.duration(600).delay(300)}
                className="mx-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  Per Diem Breakdown
                </Text>
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                  {/* Daily breakdown */}
                  <View className="p-4 border-b border-slate-700/50">
                    <Text className="text-slate-400 text-sm mb-3">Daily Rate</Text>
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-slate-400">Meals</Text>
                      <Text className="text-white font-medium">
                        {formatCurrency(calculations.dailyMeals)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between items-center">
                      <Text className="text-slate-400">Incidentals</Text>
                      <Text className="text-white font-medium">
                        {formatCurrency(calculations.rates.incidentals)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between items-center pt-2 mt-2 border-t border-slate-700/30">
                      <Text className="text-white font-semibold">Daily Total</Text>
                      <Text className="text-white font-bold">
                        {formatCurrency(calculations.dailyTotal)}
                      </Text>
                    </View>
                  </View>

                  {/* Trip breakdown */}
                  <View className="p-4 border-b border-slate-700/50">
                    <Text className="text-slate-400 text-sm mb-3">
                      {tripDays}-Day Trip
                    </Text>
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="text-slate-400">Full Days</Text>
                      <Text className="text-white font-medium">
                        {formatCurrency(calculations.tripTotal)}
                      </Text>
                    </View>
                    {tripDays > 1 && (
                      <View className="flex-row justify-between items-center">
                        <Text className="text-blue-400">First/Last Day (75%)</Text>
                        <Text className="text-blue-400 font-medium">
                          {formatCurrency(calculations.adjustedTripTotal)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Total */}
                  <View className="p-4 bg-green-500/10">
                    <View className="flex-row justify-between items-center">
                      <Text className="text-green-400 text-lg font-semibold">
                        Trip Per Diem
                      </Text>
                      <Text className="text-green-400 text-2xl font-bold">
                        {formatCurrency(calculations.adjustedTripTotal)}
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
                    Per diem rates are based on GSA standards. First and last travel days
                    are typically reimbursed at 75%. Check your company policy for specific
                    rates.
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
