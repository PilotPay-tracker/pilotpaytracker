/**
 * Projections Screen - Earnings forecasts and goal tracking
 */

import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import {
  ChevronLeft,
  TrendingUp,
  Target,
  Calendar,
  DollarSign,
  Clock,
  ArrowRight,
  Zap,
  BarChart3,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

import {
  useProjections,
  useCalculateGoal,
  useWhatIf,
  useProjectionHistory,
  formatCurrency,
  formatMinutes,
  formatDecimalHours,
  getProgressColor,
  calculateProgress,
} from "@/lib/useProjections";
import { useSharedProjectedAnnual } from "@/lib/useSharedProjectedAnnual";
import type { ProjectionScope } from "@/lib/contracts";

// Progress bar component
function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
      <View
        className="h-full rounded-full"
        style={{ width: `${Math.min(100, progress)}%`, backgroundColor: color }}
      />
    </View>
  );
}

// Period card component
function PeriodCard({
  title,
  period,
  icon,
}: {
  title: string;
  period: {
    actual: { payCents: number; creditMinutes: number; flights: number };
    projectedCents: number;
    projectedCreditMinutes: number;
    daysElapsed: number;
    daysRemaining: number;
    daysTotal: number;
    dailyAvgCents: number;
  };
  icon: React.ReactNode;
}) {
  const progress = calculateProgress(period.actual.payCents, period.projectedCents);
  const progressColor = getProgressColor(progress);

  return (
    <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
          {icon}
        </View>
        <Text className="text-white font-semibold text-lg ml-3">{title}</Text>
        <View className="ml-auto bg-slate-700/50 px-2 py-1 rounded-lg">
          <Text className="text-slate-300 text-xs">
            {period.daysElapsed}/{period.daysTotal} days
          </Text>
        </View>
      </View>

      {/* Actual vs Projected */}
      <View className="flex-row justify-between mb-3">
        <View>
          <Text className="text-slate-400 text-xs mb-1">Actual</Text>
          <Text className="text-white text-xl font-bold">
            {formatCurrency(period.actual.payCents)}
          </Text>
        </View>
        <View className="items-center">
          <ArrowRight size={16} color="#64748b" />
        </View>
        <View className="items-end">
          <Text className="text-slate-400 text-xs mb-1">Projected</Text>
          <Text className="text-amber-400 text-xl font-bold">
            {formatCurrency(period.projectedCents)}
          </Text>
        </View>
      </View>

      {/* Progress Bar */}
      <View className="mb-3">
        <ProgressBar progress={progress} color={progressColor} />
        <Text className="text-slate-500 text-xs mt-1 text-center">
          {progress}% of projected
        </Text>
      </View>

      {/* Stats Row */}
      <View className="flex-row justify-between pt-3 border-t border-slate-700/50">
        <View className="items-center">
          <Text className="text-slate-500 text-xs">Credit</Text>
          <Text className="text-slate-300 text-sm font-medium">
            {formatMinutes(period.actual.creditMinutes)}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-slate-500 text-xs">Daily Avg</Text>
          <Text className="text-slate-300 text-sm font-medium">
            {formatCurrency(period.dailyAvgCents)}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-slate-500 text-xs">Flights</Text>
          <Text className="text-slate-300 text-sm font-medium">
            {period.actual.flights}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-slate-500 text-xs">Days Left</Text>
          <Text className="text-slate-300 text-sm font-medium">
            {period.daysRemaining}
          </Text>
        </View>
      </View>
    </View>
  );
}

// Goal calculator component
function GoalCalculator() {
  const [targetAmount, setTargetAmount] = useState("");
  const [selectedScope, setSelectedScope] = useState<ProjectionScope>("YEAR");
  const calculateGoalMutation = useCalculateGoal();

  const scopes: { value: ProjectionScope; label: string }[] = [
    { value: "PAY_PERIOD", label: "Pay Period" },
    { value: "MONTH", label: "Month" },
    { value: "YEAR", label: "Year" },
  ];

  const handleCalculate = async () => {
    const cents = Math.round(parseFloat(targetAmount) * 100);
    if (isNaN(cents) || cents <= 0) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await calculateGoalMutation.mutateAsync({
      targetCents: cents,
      scope: selectedScope,
    });
  };

  const result = calculateGoalMutation.data;

  return (
    <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
      <View className="flex-row items-center mb-4">
        <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center">
          <Target size={20} color="#22c55e" />
        </View>
        <Text className="text-white font-semibold text-lg ml-3">Income Goal</Text>
      </View>

      {/* Scope Selection */}
      <View className="flex-row mb-4">
        {scopes.map((scope) => (
          <Pressable
            key={scope.value}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedScope(scope.value);
            }}
            className={`flex-1 py-2 mx-1 rounded-lg ${
              selectedScope === scope.value
                ? "bg-amber-500/20 border border-amber-500"
                : "bg-slate-800/60 border border-slate-700/50"
            }`}
          >
            <Text
              className={`text-center text-sm font-medium ${
                selectedScope === scope.value ? "text-amber-400" : "text-slate-400"
              }`}
            >
              {scope.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Target Input */}
      <View className="flex-row items-center mb-4">
        <View className="flex-1 flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3">
          <DollarSign size={18} color="#64748b" />
          <TextInput
            value={targetAmount}
            onChangeText={setTargetAmount}
            placeholder="Enter target amount"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            className="flex-1 text-white text-base ml-2"
          />
        </View>
        <Pressable
          onPress={handleCalculate}
          disabled={!targetAmount || calculateGoalMutation.isPending}
          className={`ml-3 px-4 py-3 rounded-xl ${
            targetAmount && !calculateGoalMutation.isPending
              ? "bg-amber-500 active:opacity-80"
              : "bg-slate-700"
          }`}
        >
          {calculateGoalMutation.isPending ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Zap size={20} color={targetAmount ? "#000" : "#64748b"} />
          )}
        </Pressable>
      </View>

      {/* Result */}
      {result && (
        <Animated.View entering={FadeIn.duration(300)}>
          <View className="bg-slate-800/60 rounded-xl p-4">
            {/* Progress */}
            <View className="mb-3">
              <View className="flex-row justify-between mb-2">
                <Text className="text-slate-400 text-sm">Progress</Text>
                <Text className="text-white font-medium">
                  {result.percentComplete}%
                </Text>
              </View>
              <ProgressBar
                progress={result.percentComplete}
                color={getProgressColor(result.percentComplete)}
              />
            </View>

            {/* Stats */}
            <View className="flex-row justify-between mb-3">
              <View>
                <Text className="text-slate-500 text-xs">Current</Text>
                <Text className="text-white font-medium">
                  {formatCurrency(result.currentCents)}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-slate-500 text-xs">Remaining</Text>
                <Text className="text-amber-400 font-medium">
                  {formatCurrency(result.remainingCents)}
                </Text>
              </View>
            </View>

            {/* Required Pace */}
            {result.daysRemaining > 0 && !result.isOnTrack && (
              <View className="bg-amber-900/30 rounded-lg p-3 border border-amber-700/30">
                <Text className="text-amber-300 text-sm font-medium mb-2">
                  To reach your goal:
                </Text>
                <View className="flex-row justify-between">
                  <View>
                    <Text className="text-slate-400 text-xs">Daily</Text>
                    <Text className="text-white text-sm">
                      {formatCurrency(result.required.dailyCents)} ({formatMinutes(result.required.dailyCreditMinutes)})
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-slate-400 text-xs">Weekly</Text>
                    <Text className="text-white text-sm">
                      {formatCurrency(result.required.weeklyCents)} ({formatDecimalHours(result.required.weeklyCreditMinutes)}h)
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {result.isOnTrack && (
              <View className="bg-green-900/30 rounded-lg p-3 border border-green-700/30">
                <Text className="text-green-300 text-sm font-medium text-center">
                  Goal reached!
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// What-if scenario component
function WhatIfScenario() {
  const [additionalHours, setAdditionalHours] = useState("");
  const [additionalTrips, setAdditionalTrips] = useState("");
  const [selectedScope, setSelectedScope] = useState<ProjectionScope>("YEAR");
  const whatIfMutation = useWhatIf();

  const handleCalculate = async () => {
    const hours = parseFloat(additionalHours);
    const trips = parseInt(additionalTrips, 10);

    if (isNaN(hours) && isNaN(trips)) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await whatIfMutation.mutateAsync({
      additionalCreditMinutes: !isNaN(hours) ? Math.round(hours * 60) : undefined,
      additionalTrips: !isNaN(trips) ? trips : undefined,
      scope: selectedScope,
    });
  };

  const result = whatIfMutation.data;

  return (
    <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
      <View className="flex-row items-center mb-4">
        <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center">
          <BarChart3 size={20} color="#3b82f6" />
        </View>
        <Text className="text-white font-semibold text-lg ml-3">What If?</Text>
      </View>

      <Text className="text-slate-400 text-sm mb-4">
        See how additional flying affects your earnings
      </Text>

      {/* Inputs */}
      <View className="flex-row mb-4">
        <View className="flex-1 mr-2">
          <Text className="text-slate-500 text-xs mb-1">Add Hours</Text>
          <View className="flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2">
            <Clock size={16} color="#64748b" />
            <TextInput
              value={additionalHours}
              onChangeText={setAdditionalHours}
              placeholder="0"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              className="flex-1 text-white text-base ml-2"
            />
          </View>
        </View>
        <View className="flex-1 ml-2">
          <Text className="text-slate-500 text-xs mb-1">Add Trips</Text>
          <View className="flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2">
            <Calendar size={16} color="#64748b" />
            <TextInput
              value={additionalTrips}
              onChangeText={setAdditionalTrips}
              placeholder="0"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              className="flex-1 text-white text-base ml-2"
            />
          </View>
        </View>
      </View>

      <Pressable
        onPress={handleCalculate}
        disabled={(!additionalHours && !additionalTrips) || whatIfMutation.isPending}
        className={`py-3 rounded-xl items-center ${
          (additionalHours || additionalTrips) && !whatIfMutation.isPending
            ? "bg-blue-500 active:opacity-80"
            : "bg-slate-700"
        }`}
      >
        {whatIfMutation.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text
            className={`font-semibold ${
              additionalHours || additionalTrips ? "text-white" : "text-slate-500"
            }`}
          >
            Calculate
          </Text>
        )}
      </Pressable>

      {/* Result */}
      {result && (
        <Animated.View entering={FadeIn.duration(300)} className="mt-4">
          <View className="bg-slate-800/60 rounded-xl p-4">
            <View className="flex-row justify-between mb-3">
              <View>
                <Text className="text-slate-500 text-xs">Current</Text>
                <Text className="text-white font-medium">
                  {formatCurrency(result.current.payCents)}
                </Text>
              </View>
              <View className="items-center">
                <ArrowRight size={16} color="#64748b" />
              </View>
              <View className="items-end">
                <Text className="text-slate-500 text-xs">Projected</Text>
                <Text className="text-blue-400 font-medium">
                  {formatCurrency(result.projected.payCents)}
                </Text>
              </View>
            </View>

            <View className="bg-green-900/30 rounded-lg p-3 border border-green-700/30">
              <Text className="text-green-300 text-sm font-medium text-center">
                +{formatCurrency(result.difference.payCents)} additional earnings
              </Text>
              <Text className="text-slate-400 text-xs text-center mt-1">
                (+{formatDecimalHours(result.difference.creditMinutes)} credit hours)
              </Text>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

export default function ProjectionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { TutorialModalComponent } = useAutoTutorial("projections");

  const { data, isLoading } = useProjections();
  const { projectedAnnualCents, ytdPayCents, dayOfYear, isLoading: isSharedProjectedAnnualLoading } =
    useSharedProjectedAnnual();

  const yearPeriodForDisplay = !isSharedProjectedAnnualLoading && data
    ? {
        ...data.year,
        // Keep Year card consistent with Career + Dashboard.
        projectedCents: projectedAnnualCents,
        dailyAvgCents: dayOfYear > 0 ? Math.round(ytdPayCents / dayOfYear) : data.year.dailyAvgCents,
      }
    : data?.year;

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
                <HelpButton tutorialId="projections" />
              </View>

              <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                <View className="flex-row items-center mb-2">
                  <TrendingUp size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Forecast
                  </Text>
                </View>
                <Text className="text-white text-3xl font-bold">Projections</Text>
                <Text className="text-slate-400 text-base mt-1">
                  Track earnings and set income goals
                </Text>
              </Animated.View>
            </View>

            {/* Loading */}
            {isLoading && (
              <View className="items-center justify-center py-20">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4">Loading projections...</Text>
              </View>
            )}

            {/* Content */}
            {!isLoading && data && (
              <View className="px-5 mt-6">
                {/* Period Cards */}
                <Animated.View entering={FadeInDown.duration(600).delay(150)}>
                  <PeriodCard
                    title="Pay Period"
                    period={data.payPeriod}
                    icon={<Calendar size={20} color="#f59e0b" />}
                  />
                </Animated.View>

                <Animated.View entering={FadeInDown.duration(600).delay(200)}>
                  <PeriodCard
                    title={data.month.name ?? "Month"}
                    period={data.month}
                    icon={<Calendar size={20} color="#3b82f6" />}
                  />
                </Animated.View>

                <Animated.View entering={FadeInDown.duration(600).delay(250)}>
                  <PeriodCard
                    title={`${data.year.year}`}
                    period={yearPeriodForDisplay!}
                    icon={<Calendar size={20} color="#22c55e" />}
                  />
                </Animated.View>

                {/* Goal Calculator */}
                <Animated.View entering={FadeInDown.duration(600).delay(300)}>
                  <GoalCalculator />
                </Animated.View>

                {/* What-If Scenario */}
                <Animated.View entering={FadeInDown.duration(600).delay(350)}>
                  <WhatIfScenario />
                </Animated.View>
              </View>
            )}
          </ScrollView>
        </LinearGradient>
      </View>
      {TutorialModalComponent}
    </>
  );
}
