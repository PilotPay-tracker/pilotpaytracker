/**
 * Career Tab - Career Pay Benchmarks, Upgrade Simulation, Lifetime Earnings & Retirement Forecast
 *
 * Four-section architecture:
 * 1. Career Benchmarks (present performance) - Hero view
 * 2. Upgrade Simulation (future scenarios)
 * 3. Lifetime Earnings (historical record)
 * 4. Retirement (contract-aware forecast engine)
 */

import React, { useState, useCallback, useMemo } from "react";
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
import {
  TrendingUp,
  DollarSign,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ChevronRight,
  Star,
  Plane,
  Calendar,
  Info,
  X,
  Edit3,
  RotateCcw,
  Lightbulb,
  AlertCircle,
  ChevronDown,
  History,
  HelpCircle,
  Target,
  Zap,
  ShieldCheck,
  Clock,
  BarChart3,
  Compass,
  TrendingDown,
  RefreshCw,
  ChevronLeft,
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
import { useCareerContext, formatCareerContext } from "@/lib/useLifetimeEarnings";
import { LifetimeEarningsSection } from "@/components/career/LifetimeEarningsSection";
import { RetirementSection } from "@/components/career/RetirementSection";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import {
  useActiveYearPlan,
  useUpdateGuaranteeHours,
  getPlanHealthColor,
  getPlanHealthLabel,
  formatCurrencyYP,
  type YearPlanSnapshot,
} from "@/lib/useYearPlan";
import { useRouter } from "expo-router";
import { useResponsive } from "@/lib/responsive";
import {
  generateCareerInsights,
  type CareerInsightItem,
  type CareerPriority,
  type InsightType,
} from "@/core/CareerInsightEngine";
import {
  useRetirementProfile,
  useRetirementActions,
  computeDualScenarioForecast,
  UPS_CONTRACT_RULES,
} from "@/lib/state/retirement-store";

// ============================================
// TYPES
// ============================================

type CareerSection = "benchmarks" | "simulation" | "earnings" | "retirement";

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

function calculateYearOfService(dateOfHire: string | null): number {
  if (!dateOfHire) return 1;
  const hireDate = new Date(dateOfHire);
  const now = new Date();
  const years = Math.floor((now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return Math.max(1, years + 1); // Year 1 is first year
}

// ============================================
// SECTION NAV COMPONENT
// ============================================

function SectionNav({
  activeSection,
  onSectionChange,
}: {
  activeSection: CareerSection;
  onSectionChange: (section: CareerSection) => void;
}) {
  const tabs: { id: CareerSection; label: string; icon: React.ReactNode; iconActive: React.ReactNode }[] = [
    {
      id: "benchmarks",
      label: "Benchmarks",
      icon: <TrendingUp size={14} color="#94a3b8" />,
      iconActive: <TrendingUp size={14} color="#0f172a" />,
    },
    {
      id: "simulation",
      label: "Simulation",
      icon: <Star size={14} color="#94a3b8" />,
      iconActive: <Star size={14} color="#0f172a" />,
    },
    {
      id: "earnings",
      label: "Earnings",
      icon: <History size={14} color="#94a3b8" />,
      iconActive: <History size={14} color="#0f172a" />,
    },
    {
      id: "retirement",
      label: "Retirement",
      icon: <ShieldCheck size={14} color="#94a3b8" />,
      iconActive: <ShieldCheck size={14} color="#0f172a" />,
    },
  ];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 4, marginHorizontal: 20, marginTop: 12, gap: 3, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
      {tabs.map((tab) => {
        const active = activeSection === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSectionChange(tab.id);
            }}
            style={{
              width: "48%",
              flexGrow: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: active ? "#f59e0b" : "transparent",
            }}
          >
            {active ? tab.iconActive : tab.icon}
            <Text
              style={{
                marginLeft: 5,
                fontWeight: "700",
                fontSize: 12,
                color: active ? "#0f172a" : "#475569",
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================
// BENCHMARK COMPONENTS (extracted from original)
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
    <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", flex: 1 }}>
      <View className="flex-row items-center mb-2">
        <View
          style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: iconColor + "20" }}
        >
          {icon}
        </View>
        <Text style={{ color: "#475569", fontSize: 11, marginLeft: 8, flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ color: "#f1f5f9", fontSize: 20, fontWeight: "800", letterSpacing: -0.5 }}>{value}</Text>
      {subtitle && <Text style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{subtitle}</Text>}
      {delta !== undefined && deltaLabel && (
        <View className="mt-2">
          <DeltaIndicator value={delta} label={deltaLabel} />
        </View>
      )}
    </View>
  );
}

function PerformanceCard({
  title,
  percentage,
  color,
  explanation,
}: {
  title: string;
  percentage: number | null;
  color: string;
  explanation: string;
}) {
  const [showInfo, setShowInfo] = useState(false);

  if (percentage === null) return null;

  const getStatusText = () => {
    if (percentage >= 125) return "Extreme";
    if (percentage >= 110) return "Above Average";
    if (percentage >= 90) return "On Track";
    return "Below Benchmark";
  };

  return (
    <View className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center flex-1">
          <Text className="text-slate-400 text-sm">{title}</Text>
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
        <Text className="text-slate-500 text-xs">{getStatusText()}</Text>
      </View>

      {showInfo && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={webSafeExit(FadeOut.duration(200))}
          className="bg-slate-900/60 rounded-lg p-2 mb-2"
        >
          <Text className="text-slate-400 text-xs">{explanation}</Text>
        </Animated.View>
      )}

      <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{
            width: `${Math.min(percentage, 100)}%`,
            backgroundColor: color,
          }}
        />
      </View>
      <Text className="text-white font-semibold mt-1">{percentage}%</Text>
    </View>
  );
}

// ============================================================
// YEAR PLAN CARD — shown at top of Benchmarks if plan exists
// ============================================================

function YearPlanBadge({ health }: { health: YearPlanSnapshot["planHealth"] }) {
  const color = getPlanHealthColor(health);
  const label = getPlanHealthLabel(health);
  return (
    <View className="flex-row items-center px-2.5 py-1 rounded-full" style={{ backgroundColor: color + "20" }}>
      <ShieldCheck size={12} color={color} />
      <Text className="text-xs font-bold ml-1" style={{ color }}>{label}</Text>
    </View>
  );
}

function YearPlanCard({
  snapshot,
  projectedAnnualCents,
  onOpenPlan,
}: {
  snapshot: YearPlanSnapshot;
  projectedAnnualCents: number | null;
  onOpenPlan: () => void;
}) {
  const gapCents = projectedAnnualCents !== null
    ? projectedAnnualCents - snapshot.targetAnnualIncomeCents
    : null;
  const isAhead = gapCents !== null && gapCents >= 0;

  return (
    <View className="bg-slate-800/60 rounded-2xl border border-amber-500/30 overflow-hidden">
      {/* Header */}
      <LinearGradient
        colors={["rgba(245,158,11,0.15)", "rgba(245,158,11,0.05)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16, paddingBottom: 12 }}
      >
        <View className="flex-row items-center justify-between mb-1">
          <View className="flex-row items-center">
            <Target size={16} color="#f59e0b" />
            <Text className="text-amber-400 text-sm font-bold ml-2 uppercase tracking-wider">
              Your {snapshot.planYear} Plan
            </Text>
          </View>
          <YearPlanBadge health={snapshot.planHealth} />
        </View>

        {/* Target + Projected side-by-side */}
        <View className="flex-row mt-3 gap-4">
          <View className="flex-1">
            <Text className="text-slate-400 text-xs">Target</Text>
            <Text className="text-white text-xl font-bold">
              {formatCurrencyYP(snapshot.targetAnnualIncomeCents)}
            </Text>
          </View>
          {projectedAnnualCents !== null && (
            <View className="flex-1">
              <Text className="text-slate-400 text-xs">Projected Annual</Text>
              <Text className="text-white text-xl font-bold">
                {formatCurrencyYP(projectedAnnualCents)}
              </Text>
            </View>
          )}
          {gapCents !== null && (
            <View className="flex-1 items-end">
              <Text className="text-slate-400 text-xs">Gap vs Plan</Text>
              <Text
                className="text-lg font-bold"
                style={{ color: isAhead ? "#22c55e" : "#ef4444" }}
              >
                {isAhead ? "+" : ""}{formatCurrencyYP(gapCents)}
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* From Today Forward row */}
      <View className="px-4 py-3 border-t border-slate-700/40">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <View className="flex-row items-center mb-0.5">
              <Zap size={13} color="#38bdf8" />
              <Text className="text-slate-400 text-xs ml-1">From Today Forward</Text>
              <View className="ml-2 bg-sky-500/15 px-1.5 py-0.5 rounded-full">
                <Text className="text-sky-400 text-xs">{snapshot.monthsLeft} mo left</Text>
              </View>
            </View>
            <Text className="text-white text-sm font-semibold">
              {snapshot.requiredBaseCreditsPerMonthFromToday.toFixed(1)} base hrs/month
            </Text>
            <Text className="text-slate-500 text-xs">
              or {snapshot.requiredJACreditsPerMonthFromToday.toFixed(1)} JA credit hrs/month (150%)
            </Text>
          </View>
        </View>
      </View>

      {/* Open Plan CTA */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOpenPlan(); }}
        className="mx-4 mb-4 mt-1 bg-amber-500/20 border border-amber-500/40 rounded-xl py-3 items-center flex-row justify-center"
      >
        <Target size={16} color="#f59e0b" />
        <Text className="text-amber-400 font-semibold text-sm ml-2">Open Plan</Text>
        <ChevronRight size={14} color="#f59e0b" style={{ marginLeft: 4 }} />
      </Pressable>
    </View>
  );
}

function NextBestActionCard({
  snapshot,
  currentBidPeriodPaceHours,
}: {
  snapshot: YearPlanSnapshot;
  currentBidPeriodPaceHours: number | null;
}) {
  const required = snapshot.requiredBaseCreditsPerBidPeriodFromToday;
  const current = currentBidPeriodPaceHours ?? snapshot.monthlyGuaranteeHours * (28 / 30);
  const gap = Math.max(0, Math.round((required - current) * 10) / 10);
  const jaGap = Math.max(0, Math.round((gap / snapshot.jaMultiplier) * 10) / 10);

  if (gap <= 0) {
    return (
      <View className="rounded-xl p-4 border border-green-500/30" style={{ backgroundColor: "rgba(34,197,94,0.08)" }}>
        <View className="flex-row items-center">
          <ShieldCheck size={16} color="#22c55e" />
          <Text className="text-green-400 font-semibold text-sm ml-2">On Pace — No Action Needed</Text>
        </View>
        <Text className="text-slate-400 text-xs mt-1">Your current bid period pace meets the plan requirement.</Text>
      </View>
    );
  }

  return (
    <View className="bg-slate-800/50 rounded-xl p-4 border border-amber-500/20">
      <View className="flex-row items-center mb-2">
        <Zap size={15} color="#f59e0b" />
        <Text className="text-slate-300 text-sm font-semibold ml-2">Next Best Action</Text>
      </View>
      <Text className="text-slate-200 text-sm leading-5">
        Add <Text className="text-amber-300 font-bold">+{gap.toFixed(1)} credit hrs</Text> this bid period to stay on plan.
      </Text>
      {jaGap > 0 && (
        <Text className="text-slate-400 text-xs mt-1">
          Or +{jaGap.toFixed(1)} JA credit hrs (150%) for the same income impact.
        </Text>
      )}
      <Text className="text-slate-600 text-xs mt-2">
        Planning-only metric based on your pace and remaining time.
      </Text>
    </View>
  );
}

function WhyThisStatus({ snapshot }: { snapshot: YearPlanSnapshot }) {
  const bullets: string[] = [];

  // Bullet 1: Credit pace vs guarantee
  const guarantee = snapshot.monthlyGuaranteeHours;
  const required = snapshot.requiredBaseCreditsPerMonthFromToday;
  const delta = required - guarantee;
  if (delta > 0) {
    bullets.push(`Your plan requires ${required.toFixed(1)} hrs/month — ${delta.toFixed(1)} hrs above the ${guarantee}-hour guarantee.`);
  } else {
    bullets.push(`Your required pace of ${required.toFixed(1)} hrs/month is at or below the ${guarantee}-hour guarantee.`);
  }

  // Bullet 2: Time pressure
  const months = snapshot.monthsLeft;
  if (months <= 3) {
    bullets.push(`Only ${months.toFixed(1)} months remain — closing the gap requires consistent action soon.`);
  } else if (months <= 6) {
    bullets.push(`${months.toFixed(1)} months remain — still time to close the gap with sustained effort.`);
  } else {
    bullets.push(`${months.toFixed(1)} months remain — you have time to course-correct if needed.`);
  }

  // Bullet 3: YTD progress
  const ytdPct = snapshot.targetAnnualIncomeCents > 0
    ? Math.round((snapshot.ytdPaidEstimateCents / snapshot.targetAnnualIncomeCents) * 100)
    : 0;
  bullets.push(`YTD earnings represent ${ytdPct}% of your annual target.`);

  return (
    <View className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
      <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Why This Status?</Text>
      {bullets.map((b, i) => (
        <View key={i} className="flex-row items-start mb-1.5">
          <View className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-1.5 mr-2" />
          <Text className="text-slate-300 text-xs flex-1 leading-4">{b}</Text>
        </View>
      ))}
      <Text className="text-slate-600 text-xs mt-2">
        Planning-only metric based on your pace and remaining time.
      </Text>
    </View>
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC CAREER INSIGHT ENGINE UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const INSIGHT_ICON: Record<InsightType, React.ReactNode> = {
  UPGRADE_PAY_LEVERAGE: <TrendingUp size={20} color="#f59e0b" />,
  BREAK_EVEN_ANALYSIS: <BarChart3 size={20} color="#38bdf8" />,
  RETIREMENT_IMPACT: <ShieldCheck size={20} color="#22c55e" />,
  QUALITY_OF_LIFE_TRADEOFF: <Clock size={20} color="#a78bfa" />,
  SENIOR_FO_VIABILITY: <Award size={20} color="#34d399" />,
  BALANCED_CAREER_STRATEGY: <Compass size={20} color="#fb923c" />,
};

const INSIGHT_COLOR: Record<InsightType, string> = {
  UPGRADE_PAY_LEVERAGE: "#f59e0b",
  BREAK_EVEN_ANALYSIS: "#38bdf8",
  RETIREMENT_IMPACT: "#22c55e",
  QUALITY_OF_LIFE_TRADEOFF: "#a78bfa",
  SENIOR_FO_VIABILITY: "#34d399",
  BALANCED_CAREER_STRATEGY: "#fb923c",
};

function DynamicCareerInsightCard({
  insights,
}: {
  insights: CareerInsightItem[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (insights.length === 0) return null;

  const insight = insights[activeIndex];
  const color = INSIGHT_COLOR[insight.type] ?? "#94a3b8";
  const icon = INSIGHT_ICON[insight.type] ?? <Lightbulb size={20} color="#94a3b8" />;

  const importanceBadgeStyle: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: "#ef444420", text: "#f87171", label: "High Priority" },
    medium: { bg: "#f59e0b20", text: "#fbbf24", label: "Notable" },
    low: { bg: "#64748b20", text: "#94a3b8", label: "Informational" },
  };
  const badge = importanceBadgeStyle[insight.importance] ?? importanceBadgeStyle.low;

  return (
    <View>
      {/* Main Insight Card */}
      <View
        className="rounded-2xl overflow-hidden border"
        style={{
          borderColor: color + "35",
          backgroundColor: "#0f172a",
        }}
      >
        {/* Accent bar */}
        <View style={{ height: 3, backgroundColor: color }} />

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
          <View className="flex-row items-center flex-1">
            <View
              className="w-9 h-9 rounded-xl items-center justify-center mr-3"
              style={{ backgroundColor: color + "20" }}
            >
              {icon}
            </View>
            <View className="flex-1">
              <Text className="text-slate-500 text-xs uppercase tracking-wider">Career Strategy Insight</Text>
              <Text className="text-white font-bold text-base">{insight.title}</Text>
            </View>
          </View>
          <View
            className="px-2.5 py-1 rounded-full"
            style={{ backgroundColor: badge.bg }}
          >
            <Text className="text-xs font-semibold" style={{ color: badge.text }}>
              {badge.label}
            </Text>
          </View>
        </View>

        {/* Message */}
        <View className="px-4 pb-4">
          <Text className="text-slate-300 text-sm leading-5">{insight.message}</Text>
        </View>

        {/* Multi-insight navigation */}
        {insights.length > 1 && (
          <View
            className="flex-row items-center justify-between px-4 py-3 border-t"
            style={{ borderTopColor: "#1e293b" }}
          >
            <Pressable
              onPress={() => {
                if (activeIndex > 0) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveIndex(activeIndex - 1);
                }
              }}
              className="w-8 h-8 items-center justify-center"
              style={{ opacity: activeIndex === 0 ? 0.3 : 1 }}
            >
              <ChevronLeft size={18} color="#94a3b8" />
            </Pressable>

            {/* Dot indicators */}
            <View className="flex-row gap-1.5 items-center">
              {insights.map((_, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveIndex(i);
                  }}
                >
                  <View
                    className="rounded-full"
                    style={{
                      width: i === activeIndex ? 16 : 6,
                      height: 6,
                      backgroundColor: i === activeIndex ? color : "#334155",
                    }}
                  />
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => {
                if (activeIndex < insights.length - 1) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveIndex(activeIndex + 1);
                }
              }}
              className="w-8 h-8 items-center justify-center"
              style={{ opacity: activeIndex === insights.length - 1 ? 0.3 : 1 }}
            >
              <ChevronRight size={18} color="#94a3b8" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Disclaimer */}
      <View className="flex-row items-start mt-2 px-1">
        <AlertCircle size={11} color="#475569" />
        <Text className="text-slate-600 text-xs ml-1.5 flex-1 leading-4">
          Career insights are projections based on available data and assumptions. Actual outcomes may vary.
        </Text>
      </View>
    </View>
  );
}

function CareerPrioritySelector({
  value,
  onChange,
}: {
  value: CareerPriority;
  onChange: (v: CareerPriority) => void;
}) {
  const options: { key: CareerPriority; label: string; sub: string; icon: React.ReactNode }[] = [
    {
      key: "maximize_earnings",
      label: "Maximize Earnings",
      sub: "Prioritize pay growth",
      icon: <DollarSign size={14} color="#f59e0b" />,
    },
    {
      key: "balanced",
      label: "Balanced",
      sub: "Earnings + schedule",
      icon: <Compass size={14} color="#38bdf8" />,
    },
    {
      key: "maximize_schedule",
      label: "Schedule Quality",
      sub: "Prioritize lifestyle",
      icon: <Clock size={14} color="#a78bfa" />,
    },
  ];

  return (
    <View>
      <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Career Priority</Text>
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onChange(opt.key);
              }}
              className="flex-1 rounded-xl p-3 border"
              style={{
                backgroundColor: active ? "#1e293b" : "#0f172a",
                borderColor: active ? "#f59e0b40" : "#1e293b",
              }}
            >
              <View className="flex-row items-center mb-1">
                {opt.icon}
                {active && (
                  <View
                    className="w-3 h-3 rounded-full ml-auto"
                    style={{ backgroundColor: "#f59e0b" }}
                  />
                )}
              </View>
              <Text
                className="text-xs font-semibold"
                style={{ color: active ? "#f8fafc" : "#64748b" }}
              >
                {opt.label}
              </Text>
              <Text className="text-slate-600 text-xs mt-0.5">{opt.sub}</Text>
            </Pressable>
          );
        })}
      </View>
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

// ============================================
// UPGRADE SIMULATION SECTION
// ============================================

function UpgradeSimulationSection({
  onNavigateToEarnings,
}: {
  onNavigateToEarnings: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const profile = useProfile();
  const { data: comparison } = useUserBenchmarkComparison();
  const { data: careerContext } = useCareerContext();
  const { data: benchmarks, isLoading: benchmarksLoading } = usePayBenchmarks({
    seat: profile?.position === "CPT" ? "Captain" : "FO"
  });

  // Retirement store for insight engine
  const retirementProfile = useRetirementProfile();
  const { updateProfile: updateRetirementProfile } = useRetirementActions();

  const [selectedSeat, setSelectedSeat] = useState<"FO" | "Captain">(
    profile?.position === "CPT" ? "Captain" : "FO"
  );
  const { data: selectedBenchmarks } = usePayBenchmarks({ seat: selectedSeat });

  const yearOfService = calculateYearOfService(profile?.dateOfHire ?? null);
  const userYearOfService = comparison?.userProfile?.yearOfService ?? 1;

  const [upgradeYear, setUpgradeYear] = useState(
    yearOfService ? yearOfService + 3 : 4
  );
  const [compareYear, setCompareYear] = useState(
    yearOfService ?? 1
  );
  const [showUpgradeYearPicker, setShowUpgradeYearPicker] = useState(false);
  const [showCompareYearPicker, setShowCompareYearPicker] = useState(false);

  const scenarioParams: UpgradeScenarioParams = {
    upgradeToYear: upgradeYear,
    compareAgainstFoYear: compareYear,
  };

  const { data: scenario, isLoading } = useUpgradeScenario(scenarioParams);
  const yearOptions = Array.from({ length: 15 }, (_, i) => i + 1);

  const careerContextText = formatCareerContext(careerContext);

  // Compute dual scenario for retirement impact insight
  const dualForecast = useMemo(() => {
    if (!retirementProfile.doh && !profile?.dateOfHire) return null;
    const mergedProfile = {
      ...retirementProfile,
      doh: retirementProfile.doh ?? profile?.dateOfHire ?? null,
      dob: retirementProfile.dob ?? profile?.dateOfBirth ?? null,
    };
    try {
      return computeDualScenarioForecast(mergedProfile);
    } catch {
      return null;
    }
  }, [retirementProfile, profile?.dateOfHire, profile?.dateOfBirth]);

  // Resolve expected upgrade calendar year from retirement profile
  const expectedUpgradeCalYear = useMemo(() => {
    if (retirementProfile.expectedUpgradeYear) return retirementProfile.expectedUpgradeYear;
    const doh = retirementProfile.doh ?? profile?.dateOfHire;
    if (!doh) return null;
    return new Date(doh).getFullYear() + 7; // default 7 years
  }, [retirementProfile.expectedUpgradeYear, retirementProfile.doh, profile?.dateOfHire]);

  // Generate insights using the engine
  const dynamicInsights = useMemo(() => {
    if (!profile) return [];
    return generateCareerInsights({
      profile,
      upgradeForecast: dualForecast?.upgrade ?? null,
      foOnlyForecast: dualForecast?.foOnly ?? null,
      careerPriority: retirementProfile.careerPriority ?? "balanced",
      expectedUpgradeYear: expectedUpgradeCalYear,
    });
  }, [profile, dualForecast, retirementProfile.careerPriority, expectedUpgradeCalYear]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(100)}
        style={{ paddingTop: insets.top + 16 }}
        className="px-5"
      >
        <View className="flex-row items-center mb-2">
          <Star size={24} color="#f59e0b" />
          <Text className="text-amber-500 text-base font-semibold ml-2">
            Future Scenarios
          </Text>
        </View>
        <Text className="text-white text-3xl font-bold">Upgrade Simulation</Text>
        <Text className="text-slate-400 text-base mt-1">
          Based on company seniority (DOH)
        </Text>
      </Animated.View>

      {/* Profile Summary */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(150)}
        className="mx-5 mt-6"
      >
        <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
          <Text className="text-slate-500 text-xs uppercase tracking-wider mb-3">
            Your Profile (Read-only)
          </Text>
          <View className="flex-row flex-wrap gap-4">
            <View className="flex-1 min-w-[45%]">
              <Text className="text-slate-400 text-xs">Airline</Text>
              <Text className="text-white font-semibold">
                {profile?.airline ?? "UPS"}
              </Text>
            </View>
            <View className="flex-1 min-w-[45%]">
              <Text className="text-slate-400 text-xs">Current Seat</Text>
              <Text className="text-white font-semibold">
                {profile?.position === "CPT" ? "Captain" : "First Officer"}
              </Text>
            </View>
            <View className="flex-1 min-w-[45%]">
              <Text className="text-slate-400 text-xs">Company Year</Text>
              <Text className="text-white font-semibold">
                Year {yearOfService}
              </Text>
            </View>
            <View className="flex-1 min-w-[45%]">
              <Text className="text-slate-400 text-xs">Hourly Rate</Text>
              <Text className="text-white font-semibold">
                ${((profile?.hourlyRateCents ?? 0) / 100).toFixed(0)}/hr
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Scenario Controls */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(200)}
        className="mx-5 mt-4"
      >
        <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
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
                        upgradeYear === year ? "bg-amber-500" : "bg-slate-600/50"
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          upgradeYear === year ? "text-slate-900" : "text-white"
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
                        compareYear === year ? "bg-amber-500" : "bg-slate-600/50"
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          compareYear === year ? "text-slate-900" : "text-white"
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
      </Animated.View>

      {/* Earnings Comparison Table */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(250)}
        className="mx-5 mt-4"
      >
        {isLoading ? (
          <View className="bg-slate-800/60 rounded-xl p-8 items-center">
            <ActivityIndicator size="small" color="#f59e0b" />
            <Text className="text-slate-400 mt-2">Calculating...</Text>
          </View>
        ) : scenario ? (
          <View className="bg-slate-800/60 rounded-xl overflow-hidden border border-slate-700/50">
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
      </Animated.View>

      {/* Career Priority + Dynamic Insight Engine */}
      {profile && (
        <Animated.View
          entering={FadeInDown.duration(600).delay(300)}
          className="mx-5 mt-6"
        >
          <View className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/40 mb-4">
            <CareerPrioritySelector
              value={retirementProfile.careerPriority ?? "balanced"}
              onChange={(v) => updateRetirementProfile({ careerPriority: v })}
            />
          </View>

          {dynamicInsights.length > 0 ? (
            <DynamicCareerInsightCard insights={dynamicInsights} />
          ) : (
            <View className="rounded-xl p-4 border border-slate-700/30 bg-slate-800/40 items-center">
              <Lightbulb size={20} color="#475569" />
              <Text className="text-slate-500 text-sm mt-2 text-center">
                Complete your career profile to unlock personalized insights.
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {/* Pay Scale */}
      {selectedBenchmarks && selectedBenchmarks.benchmarks.length > 0 && (
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

            {selectedBenchmarks.benchmarks.map((b) => (
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
            {comparison?.currentBenchmark?.sourceNote ?? "Contract Data"}
          </Text>
        </Animated.View>
      )}

      {/* Career Context Tie-in to Lifetime Earnings */}
      {careerContextText && (
        <Animated.View
          entering={FadeInDown.duration(600).delay(400)}
          className="mx-5 mt-6"
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onNavigateToEarnings();
            }}
            className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30"
          >
            <View className="flex-row items-center">
              <History size={16} color="#64748b" />
              <Text className="text-slate-400 text-sm ml-2 flex-1">
                Career context: {careerContextText}
              </Text>
              <ChevronRight size={16} color="#64748b" />
            </View>
          </Pressable>
        </Animated.View>
      )}

      {/* Disclaimer */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(450)}
        className="mx-5 mt-6"
      >
        <View className="bg-slate-800/40 rounded-xl p-3">
          <View className="flex-row items-start">
            <AlertCircle size={14} color="#64748b" />
            <Text className="text-slate-500 text-xs ml-2 flex-1">
              Estimates based on published pay tables and average utilization.
              Actual earnings may vary based on trip selection, premium flying,
              and individual schedule choices.
            </Text>
          </View>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ============================================
// BENCHMARKS SECTION (Original Career content)
// ============================================

function BenchmarksSection() {
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const profile = useProfile();
  const router = useRouter();
  const [showGuaranteeModal, setShowGuaranteeModal] = useState(false);

  // User-adjustable guarantee
  const defaultGuarantee = AIRLINE_GUARANTEE_DEFAULTS[profile?.airline ?? "UPS"] ?? 75;
  const [userGuarantee, setUserGuarantee] = useState<number | null>(null);
  const currentGuarantee = userGuarantee ?? defaultGuarantee;
  const isGuaranteeAdjusted = userGuarantee !== null;

  const { data: comparison, isLoading: comparisonLoading } = useUserBenchmarkComparison();
  const { data: yearPlanData } = useActiveYearPlan();
  const updateGuaranteeMutation = useUpdateGuaranteeHours();

  const isLoading = comparisonLoading;

  // Recalculate percentages based on user-adjusted guarantee
  const adjustedPerformance = useMemo(() => {
    if (!comparison?.userPerformance || !comparison?.currentBenchmark) return null;

    const guaranteeAnnualCents = currentGuarantee * 12 * comparison.currentBenchmark.hourlyRateCents;
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

  // Phase 4: when guarantee is saved, also update active YearPlan
  const handleSaveGuarantee = useCallback((value: number) => {
    setUserGuarantee(value);
    // Sync to YearPlan if one exists
    if (yearPlanData?.plan) {
      updateGuaranteeMutation.mutate(value);
    }
  }, [yearPlanData?.plan, updateGuaranteeMutation]);

  // Estimate current bid period pace from YTD credit hours
  const currentBidPeriodPaceHours = useMemo(() => {
    if (!comparison?.userPerformance) return null;
    // Use monthly credit avg as proxy for bid period pace (roughly 28/30 days)
    const monthlyHours = (comparison.userPerformance as any)?.avgMonthlyCreditHours ?? null;
    if (monthlyHours === null) return null;
    return Math.round((monthlyHours * (28 / 30)) * 10) / 10;
  }, [comparison]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(600).delay(100)}
        style={{ paddingTop: insets.top + 16 }}
        className="px-5"
      >
        <View className="flex-row items-center mb-2">
          <TrendingUp size={24} color="#f59e0b" />
          <Text className="text-amber-500 text-base font-semibold ml-2">
            Present Performance
          </Text>
        </View>
        <Text className="text-white text-3xl font-bold">Career Benchmarks</Text>
        <Text className="text-slate-400 text-base mt-1">
          Compare your earnings to airline benchmarks
        </Text>
      </Animated.View>

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
          {/* Dataset Source Info — compact pill */}
          {comparison.currentBenchmark && (
            <Animated.View entering={FadeInDown.duration(600).delay(150)} className="mx-5 mt-4 flex-row">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Calendar size={10} color="#64748b" />
                <Text style={{ color: "#64748b", fontSize: 11 }}>
                  {comparison.currentBenchmark.sourceNote?.split(" - ")[0] ?? "Contract Extension TA"} · eff. {comparison.currentBenchmark.effectiveDate}
                </Text>
              </View>
            </Animated.View>
          )}

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

          {/* ──────────────────────────────────────── */}
          {/* YEAR PLAN CARD (if active plan exists)  */}
          {/* OR prompt to create one                 */}
          {/* ──────────────────────────────────────── */}
          {!yearPlanData?.snapshot && !isLoading && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(210)}
              className="mx-5 mt-4"
            >
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/annual-pay-planner"); }}
                className="bg-slate-800/50 rounded-2xl border border-amber-500/20 p-4 flex-row items-center"
              >
                <View className="w-10 h-10 rounded-full bg-amber-500/15 items-center justify-center mr-3">
                  <Target size={20} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold text-sm">Set a {new Date().getFullYear()} Income Target</Text>
                  <Text className="text-slate-400 text-xs mt-0.5">Track your progress against a goal in the Annual Pay Planner</Text>
                </View>
                <ChevronRight size={18} color="#f59e0b" />
              </Pressable>
            </Animated.View>
          )}
          {yearPlanData?.snapshot && (
            <>
              <Animated.View
                entering={FadeInDown.duration(600).delay(210)}
                className="mx-5 mt-4"
              >
                <YearPlanCard
                  snapshot={yearPlanData.snapshot}
                  projectedAnnualCents={adjustedPerformance?.projectedAnnualCents ?? null}
                  onOpenPlan={() => router.push("/annual-pay-planner")}
                />
              </Animated.View>

              {/* Next Best Action */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(215)}
                className="mx-5 mt-3"
              >
                <NextBestActionCard
                  snapshot={yearPlanData.snapshot}
                  currentBidPeriodPaceHours={currentBidPeriodPaceHours}
                />
              </Animated.View>

              {/* Why This Status */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(220)}
                className="mx-5 mt-3"
              >
                <WhyThisStatus snapshot={yearPlanData.snapshot} />
              </Animated.View>
            </>
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
                  title="vs Guarantee"
                  percentage={adjustedPerformance.percentOfBenchmarkGuarantee}
                  color="#22c55e"
                  explanation={`You're flying ${adjustedPerformance.percentOfBenchmarkGuarantee}% of your defined contractual guarantee (${currentGuarantee} hrs/month).`}
                />
                <View className="h-2" />
                <PerformanceCard
                  title="vs Average Line Holder"
                  percentage={comparison.userPerformance?.percentOfBenchmarkAvgLine ?? null}
                  color="#3b82f6"
                  explanation="You're flying this percentage compared to the typical scheduled line holder at your seniority."
                />
                <View className="h-2" />
                <PerformanceCard
                  title="vs Average Total (incl. vacation)"
                  percentage={comparison.userPerformance?.percentOfBenchmarkAvgTotal ?? null}
                  color="#a78bfa"
                  explanation="Even including paid vacation averages, your earnings compared to peers at your seniority level."
                />
              </View>
            </Animated.View>
          )}

        </>
      )}

      {/* Modal */}
      <EditGuaranteeModal
        visible={showGuaranteeModal}
        currentValue={currentGuarantee}
        defaultValue={defaultGuarantee}
        onSave={handleSaveGuarantee}
        onClose={() => setShowGuaranteeModal(false)}
      />

      {/* Legal Disclaimer */}
      <View className="mx-5 mt-4 mb-2">
        <View className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/20">
          <Text className="text-slate-500 text-xs leading-4 text-center">
            Planning tools are estimates based on historical data and user inputs. They do not guarantee earnings, enforce contract rules, or provide legal advice.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function CareerScreen() {
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const [activeSection, setActiveSection] = useState<CareerSection>("benchmarks");

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("career");

  const handleNavigateToEarnings = useCallback(() => {
    setActiveSection("earnings");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: "#070e1a" }}>
      <LinearGradient
        colors={["#0d1b2e", "#071325", "#020b1a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* Section Navigation with Help Button */}
        <View style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
            <Text style={{ color: "#f59e0b", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 }}>Career</Text>
            <HelpButton tutorialId="career" size="small" />
          </View>
          <SectionNav
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </View>

        {/* Section Content */}
        {activeSection === "benchmarks" && <BenchmarksSection />}
        {activeSection === "simulation" && (
          <UpgradeSimulationSection onNavigateToEarnings={handleNavigateToEarnings} />
        )}
        {activeSection === "earnings" && <LifetimeEarningsSection />}
        {activeSection === "retirement" && <RetirementSection onNavigateToEarnings={handleNavigateToEarnings} />}
      </LinearGradient>

      {/* Tutorial Modal */}
      {TutorialModalComponent}
    </View>
  );
}
