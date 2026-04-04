/**
 * Career Pay Benchmarks Screen
 *
 * Shows structured benchmark data comparing user's pay performance
 * against airline pay scales. Includes upgrade simulation with seniority-driven
 * pay calculations and auto-generated career insights.
 */

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import {
  ChevronLeft,
  TrendingUp,
  DollarSign,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronRight,
  Star,
  Plane,
  Info,
  X,
  Edit3,
  RotateCcw,
  Lightbulb,
  AlertCircle,
  ChevronDown,
  Target,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  useUserBenchmarkComparison,
  usePayBenchmarks,
  useUpgradeScenario,
  useCareerInsight,
  type UpgradeScenarioParams,
} from "@/lib/usePayBenchmarks";
import { useProfile } from "@/lib/state/profile-store";
import { webSafeExit } from "@/lib/webSafeAnimation";
import { useActiveYearPlan } from "@/lib/useYearPlan";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

// ============================================
// CONSTANTS - Airline-specific defaults
// ============================================

const AIRLINE_GUARANTEE_DEFAULTS: Record<string, number> = {
  UPS: 75, // 75 hrs/month
  FedEx: 75,
  Delta: 75,
  American: 75,
  United: 75,
  Southwest: 76,
  JetBlue: 75,
  Alaska: 75,
  Spirit: 76,
  Frontier: 76,
};

// ============================================
// HELPERS
// ============================================

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatCurrencyShort(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000000) {
    return `$${(dollars / 1000000).toFixed(1)}M`;
  }
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(0)}K`;
  }
  return `$${dollars.toFixed(0)}`;
}

// ============================================
// COMPONENTS
// ============================================

function DeltaIndicator({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;

  const isPositive = value >= 0;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#94a3b8";

  return (
    <View className="flex-row items-center">
      <Icon size={16} color={color} />
      <Text style={{ color }} className="text-sm font-medium ml-1">
        {isPositive && value > 0 ? "+" : ""}
        {formatCurrencyShort(value)}
      </Text>
      <Text className="text-slate-500 text-xs ml-1">{label}</Text>
    </View>
  );
}

function BenchmarkCard({
  title,
  value,
  subtitle,
  icon,
  iconColor,
  delta,
  deltaLabel,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  iconColor: string;
  delta?: number | null;
  deltaLabel?: string;
}) {
  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 flex-1">
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ backgroundColor: iconColor + "20" }}
        >
          {icon}
        </View>
        <Text className="text-slate-400 text-xs ml-2 flex-1">{title}</Text>
      </View>
      <Text className="text-white text-xl font-bold">{value}</Text>
      {subtitle && <Text className="text-slate-500 text-xs mt-1">{subtitle}</Text>}
      {delta !== undefined && deltaLabel && (
        <View className="mt-2">
          <DeltaIndicator value={delta} label={deltaLabel} />
        </View>
      )}
    </View>
  );
}

/**
 * Performance Card with contextual explanation
 */
function PerformanceCard({
  title,
  percentage,
  color,
  explanation,
  contextLabel,
}: {
  title: string;
  percentage: number | null;
  color: string;
  explanation: string;
  contextLabel?: string;
}) {
  const [showInfo, setShowInfo] = useState(false);

  if (percentage === null) return null;

  const getStatusConfig = () => {
    if (percentage >= 125) return { label: "Well Above", badge: "bg-emerald-500/20", text: "text-emerald-400" };
    if (percentage >= 110) return { label: "Above Average", badge: "bg-blue-500/20", text: "text-blue-400" };
    if (percentage >= 90) return { label: "On Track", badge: "bg-slate-600/40", text: "text-slate-300" };
    if (percentage >= 75) return { label: "Slightly Below", badge: "bg-amber-500/20", text: "text-amber-400" };
    return { label: "Below Benchmark", badge: "bg-red-500/20", text: "text-red-400" };
  };

  const status = getStatusConfig();
  const diff = percentage - 100;
  const diffText =
    diff === 0
      ? "Exactly at benchmark"
      : diff > 0
      ? `${diff}% above benchmark`
      : `${Math.abs(diff)}% below benchmark`;

  return (
    <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
      {/* Header row */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <Text className="text-slate-300 text-sm font-medium">{title}</Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowInfo(!showInfo);
            }}
            className="ml-2 p-1"
          >
            <Info size={14} color="#64748b" />
          </Pressable>
        </View>
        <View className={`px-2 py-0.5 rounded-full ${status.badge}`}>
          <Text className={`text-xs font-semibold ${status.text}`}>{status.label}</Text>
        </View>
      </View>

      {/* Expandable explanation */}
      {showInfo && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={webSafeExit(FadeOut.duration(200))}
          className="bg-slate-900/60 rounded-lg p-3 mb-3"
        >
          <Text className="text-slate-400 text-xs leading-5">{explanation}</Text>
        </Animated.View>
      )}

      {/* Big number + context */}
      <View className="flex-row items-baseline mb-3">
        <Text className="text-3xl font-bold text-white">{percentage}%</Text>
        {contextLabel ? (
          <Text className="text-slate-400 text-sm ml-2 flex-1" numberOfLines={1}>
            {contextLabel}
          </Text>
        ) : null}
      </View>

      {/* Progress bar */}
      <View className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
        <View
          className="h-full rounded-full"
          style={{
            width: `${Math.min(percentage, 100)}%`,
            backgroundColor: color,
          }}
        />
      </View>

      {/* Plain-English difference line */}
      <Text className="text-slate-500 text-xs">{diffText}</Text>
    </View>
  );
}

/**
 * Guarantee Configuration Card
 */
function GuaranteeConfigCard({
  airline,
  currentGuarantee,
  isUserAdjusted,
  onEdit,
  onReset,
}: {
  airline: string;
  currentGuarantee: number;
  isUserAdjusted: boolean;
  onEdit: () => void;
  onReset: () => void;
}) {
  return (
    <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-slate-400 text-sm">Monthly Guaranteed Hours</Text>
            {isUserAdjusted && (
              <View className="ml-2 bg-amber-500/20 px-2 py-0.5 rounded">
                <Text className="text-amber-400 text-xs">User-adjusted</Text>
              </View>
            )}
          </View>
          <Text className="text-white text-2xl font-bold mt-1">
            {currentGuarantee} hrs
          </Text>
          <Text className="text-slate-500 text-xs mt-1">
            {currentGuarantee * 12} hrs/year
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {isUserAdjusted && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onReset();
              }}
              className="w-10 h-10 rounded-full bg-slate-700/50 items-center justify-center"
            >
              <RotateCcw size={18} color="#94a3b8" />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onEdit();
            }}
            className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center"
          >
            <Edit3 size={18} color="#f59e0b" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Edit Guarantee Modal
 */
function EditGuaranteeModal({
  visible,
  currentValue,
  defaultValue,
  onSave,
  onClose,
}: {
  visible: boolean;
  currentValue: number;
  defaultValue: number;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const [inputValue, setInputValue] = useState(currentValue.toString());
  const insets = useSafeAreaInsets();

  const handleSave = () => {
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 200) {
      onSave(parsed);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={onClose}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="bg-slate-900 rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <View className="p-6">
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-white text-xl font-bold">
                  Edit Monthly Guarantee
                </Text>
                <Pressable
                  onPress={onClose}
                  className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
                >
                  <X size={18} color="#94a3b8" />
                </Pressable>
              </View>

              <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                <Text className="text-slate-400 text-sm mb-2">
                  Guaranteed Hours per Month
                </Text>
                <TextInput
                  value={inputValue}
                  onChangeText={setInputValue}
                  keyboardType="numeric"
                  className="text-white text-3xl font-bold"
                  placeholder="75"
                  placeholderTextColor="#64748b"
                  maxLength={5}
                />
                <Text className="text-slate-500 text-xs mt-2">
                  Contract default: {defaultValue} hrs/month
                </Text>
              </View>

              <Text className="text-slate-400 text-xs mb-4">
                This value will be used to calculate your performance vs guarantee
                and will update all benchmark comparisons in real time.
              </Text>

              <View className="flex-row gap-3">
                <Pressable
                  onPress={onClose}
                  className="flex-1 py-4 rounded-xl bg-slate-800"
                >
                  <Text className="text-slate-300 text-center font-semibold">
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  className="flex-1 py-4 rounded-xl bg-amber-500"
                >
                  <Text className="text-slate-900 text-center font-bold">
                    Save
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Upgrade Simulation Card - Opens scenario modal
 */
function UpgradeSimulationCard({
  currentPay,
  captainPay,
  increase,
  percentIncrease,
  onPress,
  isCurrentCaptain,
  foEquivalent,
}: {
  currentPay: number;
  captainPay: number;
  increase: number;
  percentIncrease: number | null;
  onPress: () => void;
  isCurrentCaptain?: boolean;
  foEquivalent?: number | null;
}) {
  // Captain Reverse Comparison view
  if (isCurrentCaptain && foEquivalent !== undefined) {
    const leverage = currentPay - (foEquivalent ?? 0);

    return (
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className="active:opacity-90"
      >
        <LinearGradient
          colors={["#1e3a5a", "#0f4c75", "#1e3a5a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 16, padding: 16 }}
        >
          <View className="flex-row items-center mb-3">
            <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center">
              <Star size={20} color="#f59e0b" fill="#f59e0b" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-white font-semibold text-base">Captain Leverage</Text>
              <Text className="text-slate-400 text-xs">Your upgrade advantage</Text>
            </View>
            <ChevronRight size={20} color="#64748b" />
          </View>

          <View className="flex-row items-center justify-between bg-slate-900/40 rounded-xl p-3">
            <View className="flex-1">
              <Text className="text-slate-400 text-xs">Current (CPT)</Text>
              <Text className="text-white font-bold text-lg">{formatCurrencyShort(currentPay)}</Text>
            </View>
            <View className="px-4">
              <ArrowUpRight size={24} color="#22c55e" />
            </View>
            <View className="flex-1 items-end">
              <Text className="text-slate-400 text-xs">FO Equivalent</Text>
              <Text className="text-slate-300 font-bold text-lg">
                {foEquivalent ? formatCurrencyShort(foEquivalent) : "N/A"}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center justify-center mt-3">
            <Text className="text-green-400 font-semibold">
              +{formatCurrency(leverage)}
            </Text>
            <Text className="text-slate-400 text-sm ml-2">upgrade leverage</Text>
          </View>
        </LinearGradient>
      </Pressable>
    );
  }

  // Standard FO → Captain view
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className="active:opacity-90"
    >
      <LinearGradient
        colors={["#1e3a5a", "#0f4c75", "#1e3a5a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 16, padding: 16 }}
      >
        <View className="flex-row items-center mb-3">
          <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center">
            <Star size={20} color="#f59e0b" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-white font-semibold text-base">Simulate Upgrade</Text>
            <Text className="text-slate-400 text-xs">Based on company seniority</Text>
          </View>
          <ChevronRight size={20} color="#64748b" />
        </View>

        <View className="flex-row items-center justify-between bg-slate-900/40 rounded-xl p-3">
          <View className="flex-1">
            <Text className="text-slate-400 text-xs">Current (FO)</Text>
            <Text className="text-white font-bold text-lg">{formatCurrencyShort(currentPay)}</Text>
          </View>
          <View className="px-4">
            <ArrowUpRight size={24} color="#22c55e" />
          </View>
          <View className="flex-1 items-end">
            <Text className="text-slate-400 text-xs">Captain</Text>
            <Text className="text-green-400 font-bold text-lg">{formatCurrencyShort(captainPay)}</Text>
          </View>
        </View>

        <View className="flex-row items-center justify-center mt-3">
          <Text className="text-green-400 font-semibold">
            +{formatCurrency(increase)}
          </Text>
          {percentIncrease !== null && (
            <Text className="text-slate-400 text-sm ml-2">
              ({percentIncrease}% increase)
            </Text>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * Career Pay Scenario Modal
 */
function CareerPayScenarioModal({
  visible,
  onClose,
  userProfile,
  currentBenchmark,
}: {
  visible: boolean;
  onClose: () => void;
  userProfile: {
    airline: string;
    position: string;
    yearOfService: number;
    hourlyRateCents: number;
  } | null;
  currentBenchmark: {
    avgTotalPayCents: number;
  } | null;
}) {
  const insets = useSafeAreaInsets();
  const [upgradeYear, setUpgradeYear] = useState(
    userProfile?.yearOfService ? userProfile.yearOfService + 3 : 4
  );
  const [compareYear, setCompareYear] = useState(
    userProfile?.yearOfService ?? 1
  );
  const [showUpgradeYearPicker, setShowUpgradeYearPicker] = useState(false);
  const [showCompareYearPicker, setShowCompareYearPicker] = useState(false);

  const scenarioParams: UpgradeScenarioParams = {
    upgradeToYear: upgradeYear,
    compareAgainstFoYear: compareYear,
  };

  const { data: scenario, isLoading } = useUpgradeScenario(scenarioParams);

  const yearOptions = Array.from({ length: 15 }, (_, i) => i + 1);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="bg-slate-900 rounded-t-3xl max-h-[85%]"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="p-6">
            {/* Header */}
            <View className="flex-row items-center justify-between mb-6">
              <View>
                <Text className="text-white text-xl font-bold">
                  Career Pay Scenario
                </Text>
                <Text className="text-slate-400 text-sm mt-1">
                  Based on your company seniority
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center"
              >
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Read-only Profile Info */}
              <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-3">
                  Your Profile (Read-only)
                </Text>
                <View className="flex-row flex-wrap gap-4">
                  <View className="flex-1 min-w-[45%]">
                    <Text className="text-slate-400 text-xs">Airline</Text>
                    <Text className="text-white font-semibold">
                      {userProfile?.airline ?? "UPS"}
                    </Text>
                  </View>
                  <View className="flex-1 min-w-[45%]">
                    <Text className="text-slate-400 text-xs">Current Seat</Text>
                    <Text className="text-white font-semibold">
                      {userProfile?.position === "CPT" ? "Captain" : "First Officer"}
                    </Text>
                  </View>
                  <View className="flex-1 min-w-[45%]">
                    <Text className="text-slate-400 text-xs">Company Year</Text>
                    <Text className="text-white font-semibold">
                      Year {userProfile?.yearOfService ?? 1}
                    </Text>
                  </View>
                  <View className="flex-1 min-w-[45%]">
                    <Text className="text-slate-400 text-xs">Hourly Rate</Text>
                    <Text className="text-white font-semibold">
                      ${((userProfile?.hourlyRateCents ?? 0) / 100).toFixed(0)}/hr
                    </Text>
                  </View>
                </View>
              </View>

              {/* Scenario Controls */}
              <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-3">
                  Scenario Configuration
                </Text>

                {/* Upgrade Year Selector */}
                <Pressable
                  onPress={() => setShowUpgradeYearPicker(!showUpgradeYearPicker)}
                  className="bg-slate-700/50 rounded-xl p-4 mb-3"
                >
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text className="text-slate-400 text-xs">
                        Upgrade to Captain at Year
                      </Text>
                      <Text className="text-white text-lg font-bold">
                        Year {upgradeYear}
                      </Text>
                    </View>
                    <ChevronDown size={20} color="#64748b" />
                  </View>
                </Pressable>

                {showUpgradeYearPicker && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    className="bg-slate-700/30 rounded-xl p-3 mb-3"
                  >
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ flexGrow: 0 }}
                    >
                      <View className="flex-row gap-2">
                        {yearOptions.map((year) => (
                          <Pressable
                            key={year}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setUpgradeYear(year);
                              setShowUpgradeYearPicker(false);
                            }}
                            className={`px-4 py-2 rounded-lg ${
                              upgradeYear === year
                                ? "bg-amber-500"
                                : "bg-slate-600/50"
                            }`}
                          >
                            <Text
                              className={`font-semibold ${
                                upgradeYear === year
                                  ? "text-slate-900"
                                  : "text-white"
                              }`}
                            >
                              Y{year}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </Animated.View>
                )}

                {/* Compare Year Selector */}
                <Pressable
                  onPress={() => setShowCompareYearPicker(!showCompareYearPicker)}
                  className="bg-slate-700/50 rounded-xl p-4"
                >
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text className="text-slate-400 text-xs">
                        Compare Against FO Year
                      </Text>
                      <Text className="text-white text-lg font-bold">
                        Year {compareYear}
                      </Text>
                    </View>
                    <ChevronDown size={20} color="#64748b" />
                  </View>
                </Pressable>

                {showCompareYearPicker && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    className="bg-slate-700/30 rounded-xl p-3 mt-3"
                  >
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ flexGrow: 0 }}
                    >
                      <View className="flex-row gap-2">
                        {yearOptions.map((year) => (
                          <Pressable
                            key={year}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setCompareYear(year);
                              setShowCompareYearPicker(false);
                            }}
                            className={`px-4 py-2 rounded-lg ${
                              compareYear === year
                                ? "bg-amber-500"
                                : "bg-slate-600/50"
                            }`}
                          >
                            <Text
                              className={`font-semibold ${
                                compareYear === year
                                  ? "text-slate-900"
                                  : "text-white"
                              }`}
                            >
                              Y{year}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </Animated.View>
                )}
              </View>

              {/* Earnings Comparison Table */}
              {isLoading ? (
                <View className="bg-slate-800/60 rounded-xl p-8 items-center">
                  <ActivityIndicator size="small" color="#f59e0b" />
                  <Text className="text-slate-400 mt-2">Calculating...</Text>
                </View>
              ) : scenario ? (
                <View className="bg-slate-800/60 rounded-xl overflow-hidden mb-4">
                  <View className="p-4 border-b border-slate-700/50">
                    <Text className="text-slate-500 text-xs uppercase tracking-wider">
                      Upgrade Earnings Comparison
                    </Text>
                  </View>

                  {/* Table Header */}
                  <View className="flex-row bg-slate-700/30 px-4 py-2">
                    <View className="flex-1">
                      <Text className="text-slate-500 text-xs font-medium">SEAT</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-500 text-xs font-medium">YEAR</Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-slate-500 text-xs font-medium">AVG EARNINGS</Text>
                    </View>
                  </View>

                  {/* FO Row */}
                  <View className="flex-row px-4 py-3 border-b border-slate-700/30">
                    <View className="flex-1">
                      <Text className="text-slate-300">First Officer</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-300">Year {scenario.foYear}</Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-white font-semibold">
                        {formatCurrency(scenario.foAvgTotalCents)}
                      </Text>
                    </View>
                  </View>

                  {/* Captain Row */}
                  <View className="flex-row px-4 py-3 border-b border-slate-700/30">
                    <View className="flex-1">
                      <Text className="text-amber-400">Captain</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-amber-400">Year {scenario.captainYear}</Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-amber-400 font-semibold">
                        {formatCurrency(scenario.captainAvgTotalCents)}
                      </Text>
                    </View>
                  </View>

                  {/* Net Difference Row */}
                  <View className="flex-row px-4 py-3 bg-green-500/10">
                    <View className="flex-1">
                      <Text className="text-green-400 font-semibold">Net Difference</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-400 text-sm">Upgrade Leverage</Text>
                    </View>
                    <View className="flex-1 items-end">
                      <Text className="text-green-400 font-bold">
                        +{formatCurrency(scenario.netDifferenceCents)}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Disclaimer */}
              <View className="bg-slate-800/40 rounded-xl p-3 mb-4">
                <View className="flex-row items-start">
                  <AlertCircle size={14} color="#64748b" />
                  <Text className="text-slate-500 text-xs ml-2 flex-1">
                    Estimates based on published pay tables and average utilization.
                    Actual earnings may vary based on trip selection, premium flying,
                    and individual schedule choices.
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Career Insight Card - Auto-generated, priority-ranked
 */
function CareerInsightCard({
  insight,
}: {
  insight: {
    type: string;
    priority: number;
    title: string;
    message: string;
  } | null;
}) {
  if (!insight) return null;

  const getInsightIcon = () => {
    switch (insight.type) {
      case "senior_fo_advantage":
        return <Award size={20} color="#22c55e" />;
      case "captain_leverage":
        return <TrendingUp size={20} color="#3b82f6" />;
      case "oe_displacement":
        return <AlertCircle size={20} color="#f59e0b" />;
      case "premium_strategy":
        return <DollarSign size={20} color="#a78bfa" />;
      default:
        return <Lightbulb size={20} color="#94a3b8" />;
    }
  };

  const getInsightColor = () => {
    switch (insight.type) {
      case "senior_fo_advantage":
        return "#22c55e";
      case "captain_leverage":
        return "#3b82f6";
      case "oe_displacement":
        return "#f59e0b";
      case "premium_strategy":
        return "#a78bfa";
      default:
        return "#94a3b8";
    }
  };

  return (
    <View
      className="rounded-xl p-4 border"
      style={{
        backgroundColor: getInsightColor() + "10",
        borderColor: getInsightColor() + "30",
      }}
    >
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center"
          style={{ backgroundColor: getInsightColor() + "20" }}
        >
          {getInsightIcon()}
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">
            Career Insight
          </Text>
          <Text className="text-white font-semibold">{insight.title}</Text>
        </View>
      </View>
      <Text className="text-slate-300 text-sm leading-5">{insight.message}</Text>
    </View>
  );
}

function BenchmarkTableRow({
  year,
  hourlyRate,
  guarantee,
  avgLine,
  avgTotal,
  isCurrentYear,
}: {
  year: number;
  hourlyRate: number;
  guarantee: number;
  avgLine: number;
  avgTotal: number;
  isCurrentYear: boolean;
}) {
  return (
    <View
      className={`flex-row items-center py-3 px-4 ${
        isCurrentYear ? "bg-amber-500/10" : ""
      }`}
    >
      <View className="w-12">
        <Text className={`font-semibold ${isCurrentYear ? "text-amber-400" : "text-white"}`}>
          Y{year}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="text-slate-300 text-sm">${(hourlyRate / 100).toFixed(0)}/hr</Text>
      </View>
      <View className="flex-1">
        <Text className="text-slate-300 text-sm">{formatCurrencyShort(guarantee)}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-slate-300 text-sm">{formatCurrencyShort(avgLine)}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-white text-sm font-medium">{formatCurrencyShort(avgTotal)}</Text>
      </View>
    </View>
  );
}

/**
 * YourPlanCard - shows active year plan summary linking to Annual Pay Planner
 */
function YourPlanCard({
  plan,
  bidPeriodTarget,
  onOpenPlan,
}: {
  plan: { targetAnnualIncomeCents: number; planYear: number } | null;
  bidPeriodTarget: number | null;
  onOpenPlan: () => void;
}) {
  if (!plan) return null;
  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-amber-500/25">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <Target size={16} color="#f59e0b" />
          <Text className="text-amber-400 text-sm font-semibold ml-2 uppercase tracking-wider">
            Your {plan.planYear} Plan
          </Text>
        </View>
        <Pressable onPress={onOpenPlan} className="flex-row items-center">
          <Text className="text-amber-400 text-xs mr-1">Open Plan</Text>
          <ChevronRight size={14} color="#f59e0b" />
        </Pressable>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 bg-slate-900/50 rounded-xl p-3">
          <Text className="text-slate-500 text-xs">Target</Text>
          <Text className="text-white font-bold">
            ${(plan.targetAnnualIncomeCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </Text>
        </View>
        {bidPeriodTarget !== null && (
          <View className="flex-1 bg-amber-500/10 rounded-xl p-3 border border-amber-500/20">
            <Text className="text-slate-500 text-xs">This Bid Period</Text>
            <Text className="text-amber-400 font-bold">+{bidPeriodTarget.toFixed(1)} cr hrs</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function CareerBenchmarksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const { TutorialModalComponent } = useAutoTutorial("career_benchmarks");
  const [selectedSeat, setSelectedSeat] = useState<"FO" | "Captain">(
    profile?.position === "CPT" ? "Captain" : "FO"
  );
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [showGuaranteeModal, setShowGuaranteeModal] = useState(false);

  // User-adjustable guarantee
  const defaultGuarantee = AIRLINE_GUARANTEE_DEFAULTS[profile?.airline ?? "UPS"] ?? 75;
  const [userGuarantee, setUserGuarantee] = useState<number | null>(null);
  const currentGuarantee = userGuarantee ?? defaultGuarantee;
  const isGuaranteeAdjusted = userGuarantee !== null;

  const { data: comparison, isLoading: comparisonLoading } = useUserBenchmarkComparison();
  const { data: benchmarks, isLoading: benchmarksLoading } = usePayBenchmarks({ seat: selectedSeat });
  const { data: careerInsight } = useCareerInsight();
  const { data: activeYearPlanData } = useActiveYearPlan();

  const currentYear = new Date().getFullYear();

  const isLoading = comparisonLoading || benchmarksLoading;
  const isCurrentCaptain = profile?.position === "CPT";

  // Calculate user's year of service for highlighting
  const userYearOfService = comparison?.userProfile?.yearOfService ?? 1;

  // Recalculate percentages based on user-adjusted guarantee
  const adjustedPerformance = useMemo(() => {
    if (!comparison?.userPerformance || !comparison?.currentBenchmark) return null;

    const guaranteeAnnualCents = currentGuarantee * 12 * (comparison.currentBenchmark.hourlyRateCents);
    const projectedAnnual = comparison.userPerformance.projectedAnnualCents;

    return {
      ...comparison.userPerformance,
      percentOfBenchmarkGuarantee: Math.round((projectedAnnual / guaranteeAnnualCents) * 100),
      deltaFromGuaranteeCents: projectedAnnual - guaranteeAnnualCents,
    };
  }, [comparison, currentGuarantee]);

  const handleResetGuarantee = useCallback(() => {
    setUserGuarantee(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

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
                <HelpButton tutorialId="career_benchmarks" />
              </View>

              <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                <View className="flex-row items-center mb-2">
                  <TrendingUp size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Benchmarks
                  </Text>
                </View>
                <Text className="text-white text-3xl font-bold">Career Pay</Text>
                <Text className="text-slate-400 text-base mt-1">
                  Compare your earnings to airline benchmarks
                </Text>
              </Animated.View>
            </View>

            {isLoading ? (
              <View className="flex-1 items-center justify-center py-20">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4">Loading benchmarks...</Text>
              </View>
            ) : !comparison?.hasBenchmarks ? (
              <View className="mx-5 mt-6 bg-slate-800/60 rounded-2xl p-6 border border-slate-700/50 items-center">
                <Text className="text-slate-400 text-center">
                  {comparison?.message ?? "No benchmark data available for your airline."}
                </Text>
              </View>
            ) : (
              <>
                {/* User Profile Summary */}
                {comparison.userProfile && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(200)}
                    className="mx-5 mt-4"
                  >
                    <View className="flex-row items-center bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                      <View className="w-12 h-12 rounded-full bg-amber-500/20 items-center justify-center">
                        <Plane size={24} color="#f59e0b" />
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-white font-semibold">
                          {comparison.userProfile.airline} {comparison.userProfile.position === "CPT" ? "Captain" : "FO"}
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          Year {comparison.userProfile.yearOfService} •{" "}
                          ${(comparison.userProfile.hourlyRateCents / 100).toFixed(0)}/hr
                        </Text>
                      </View>
                    </View>
                  </Animated.View>
                )}

                {/* Guarantee Configuration */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(225)}
                  className="mx-5 mt-4"
                >
                  <GuaranteeConfigCard
                    airline={comparison.userProfile?.airline ?? "UPS"}
                    currentGuarantee={currentGuarantee}
                    isUserAdjusted={isGuaranteeAdjusted}
                    onEdit={() => setShowGuaranteeModal(true)}
                    onReset={handleResetGuarantee}
                  />
                </Animated.View>

                {/* Your Plan Card — links to Annual Pay Planner */}
                {activeYearPlanData?.plan && (
                  <Animated.View entering={FadeInDown.duration(600).delay(240)} className="mx-5 mt-4">
                    <YourPlanCard
                      plan={activeYearPlanData.plan}
                      bidPeriodTarget={activeYearPlanData.snapshot?.requiredBaseCreditsPerBidPeriodFromToday ?? null}
                      onOpenPlan={() => router.push("/annual-pay-planner")}
                    />
                  </Animated.View>
                )}

                {/* Your Performance */}
                {adjustedPerformance && comparison.currentBenchmark && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(250)}
                    className="mx-5 mt-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                      Your Performance
                    </Text>
                    <View className="flex-row gap-3 mb-3">
                      <BenchmarkCard
                        title="YTD Earnings"
                        value={formatCurrency(adjustedPerformance.ytdPayCents)}
                        subtitle={`Day ${adjustedPerformance.dayOfYear} of 365`}
                        icon={<DollarSign size={16} color="#22c55e" />}
                        iconColor="#22c55e"
                      />
                      <BenchmarkCard
                        title="Projected Annual"
                        value={formatCurrency(adjustedPerformance.projectedAnnualCents)}
                        subtitle="At current pace"
                        icon={<TrendingUp size={16} color="#3b82f6" />}
                        iconColor="#3b82f6"
                        delta={adjustedPerformance.deltaFromGuaranteeCents}
                        deltaLabel="vs Guaranteed Avg"
                      />
                    </View>

                    {/* Projection Note */}
                    <View className="bg-slate-800/40 rounded-lg p-3 mb-3">
                      <View className="flex-row items-start">
                        <Info size={14} color="#64748b" />
                        <Text className="text-slate-500 text-xs ml-2 flex-1">
                          Projection assumes similar flying pace, trip pickups, and premium pay throughout the year.
                        </Text>
                      </View>
                    </View>

                    {/* Performance vs Benchmarks */}
                    <View className="space-y-2">
                      <PerformanceCard
                        title="vs Contract Guarantee"
                        percentage={adjustedPerformance.percentOfBenchmarkGuarantee}
                        color="#22c55e"
                        contextLabel={`of your ${currentGuarantee}-hr/mo guarantee`}
                        explanation={`100% = you earned exactly what your ${currentGuarantee}-hr/month guarantee pays. Above 100% means you flew more than the minimum guaranteed hours and earned extra. Below 100% means you flew less than your guarantee floor.`}
                      />
                      <View className="h-2" />
                      <PerformanceCard
                        title="vs Average Line Holder"
                        percentage={comparison.userPerformance?.percentOfBenchmarkAvgLine ?? null}
                        color="#3b82f6"
                        contextLabel="of what a typical line holder earns"
                        explanation={`100% = you earned the same as the average scheduled line holder at your seniority. Above 100% means you earned more than a typical line holder (e.g. through trip trades or pickups). Below 100% means you earned less than average for your seat and years of service.`}
                      />
                      <View className="h-2" />
                      <PerformanceCard
                        title="vs Average Total (incl. vacation)"
                        percentage={comparison.userPerformance?.percentOfBenchmarkAvgTotal ?? null}
                        color="#a78bfa"
                        contextLabel="of peer total pay (vacation included)"
                        explanation={`100% = you earned the same as the average pilot at your seniority when vacation pay is factored in. This is the most comprehensive comparison — it includes scheduled line, pickups, and paid vacation for everyone. Above 100% means your total compensation beats the average; below means there may be room to grow.`}
                      />
                    </View>
                  </Animated.View>
                )}

                {/* Career Insight */}
                {careerInsight && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(275)}
                    className="mx-5 mt-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                      Career Insight
                    </Text>
                    <CareerInsightCard insight={careerInsight} />
                  </Animated.View>
                )}

                {/* Upgrade Simulation */}
                {(comparison.upgradeSimulation || isCurrentCaptain) && comparison.currentBenchmark && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(300)}
                    className="mx-5 mt-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                      {isCurrentCaptain ? "Upgrade Leverage" : "Upgrade Simulation"}
                    </Text>
                    <UpgradeSimulationCard
                      currentPay={comparison.currentBenchmark.avgTotalPayCents}
                      captainPay={comparison.upgradeSimulation?.captainYearAvgTotalCents ?? 0}
                      increase={comparison.upgradeSimulation?.potentialIncreaseCents ?? 0}
                      percentIncrease={comparison.upgradeSimulation?.percentIncrease ?? null}
                      onPress={() => setShowScenarioModal(true)}
                      isCurrentCaptain={isCurrentCaptain}
                      foEquivalent={comparison.foEquivalentCents}
                    />
                  </Animated.View>
                )}

                {/* Benchmark Scale */}
                {benchmarks && benchmarks.benchmarks.length > 0 && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(350)}
                    className="mx-5 mt-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                      Pay Scale
                    </Text>

                    {/* Seat Toggle */}
                    <View className="flex-row bg-slate-800/60 rounded-xl p-1 mb-4">
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedSeat("FO");
                        }}
                        className={`flex-1 py-2 rounded-lg ${
                          selectedSeat === "FO" ? "bg-amber-500" : ""
                        }`}
                      >
                        <Text
                          className={`text-center font-semibold ${
                            selectedSeat === "FO" ? "text-slate-900" : "text-slate-400"
                          }`}
                        >
                          First Officer
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSelectedSeat("Captain");
                        }}
                        className={`flex-1 py-2 rounded-lg ${
                          selectedSeat === "Captain" ? "bg-amber-500" : ""
                        }`}
                      >
                        <Text
                          className={`text-center font-semibold ${
                            selectedSeat === "Captain" ? "text-slate-900" : "text-slate-400"
                          }`}
                        >
                          Captain
                        </Text>
                      </Pressable>
                    </View>

                    {/* Table */}
                    <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                      <View className="flex-row items-center py-2 px-4 bg-slate-800/60 border-b border-slate-700/50">
                        <View className="w-12">
                          <Text className="text-slate-500 text-xs font-medium">YR</Text>
                        </View>
                        <View className="flex-1">
                          <Text className="text-slate-500 text-xs font-medium">RATE</Text>
                        </View>
                        <View className="flex-1">
                          <Text className="text-slate-500 text-xs font-medium">GUAR</Text>
                        </View>
                        <View className="flex-1">
                          <Text className="text-slate-500 text-xs font-medium">LINE</Text>
                        </View>
                        <View className="flex-1">
                          <Text className="text-slate-500 text-xs font-medium">TOTAL</Text>
                        </View>
                      </View>

                      {benchmarks.benchmarks.map((b) => (
                        <BenchmarkTableRow
                          key={b.id}
                          year={b.yearOfService}
                          hourlyRate={b.hourlyRateCents}
                          guarantee={b.payAtGuaranteeCents}
                          avgLine={b.avgLinePayCents}
                          avgTotal={b.avgTotalPayCents}
                          isCurrentYear={
                            b.seat === (profile?.position === "CPT" ? "Captain" : "FO") &&
                            b.yearOfService === userYearOfService
                          }
                        />
                      ))}
                    </View>

                    <Text className="text-slate-600 text-xs text-center mt-3">
                      {comparison.currentBenchmark?.sourceNote ?? "Contract Data"} • {currentGuarantee * 12}-hour annual guarantee
                    </Text>
                  </Animated.View>
                )}
              </>
            )}
          </ScrollView>
        </LinearGradient>
      </View>

      {/* Modals */}
      <EditGuaranteeModal
        visible={showGuaranteeModal}
        currentValue={currentGuarantee}
        defaultValue={defaultGuarantee}
        onSave={(value) => setUserGuarantee(value)}
        onClose={() => setShowGuaranteeModal(false)}
      />

      <CareerPayScenarioModal
        visible={showScenarioModal}
        onClose={() => setShowScenarioModal(false)}
        userProfile={comparison?.userProfile ?? null}
        currentBenchmark={comparison?.currentBenchmark ?? null}
      />
      {TutorialModalComponent}
    </>
  );
}
