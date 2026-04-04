/**
 * Annual Pay Planner Screen
 * Pilot-brain friendly income planning using credit-hour equivalents.
 * NO trip counts. NO min-trip assumptions. Credit hours only.
 * Pacing is expressed in operational timeframes: Monthly / Bid Period / Pay Period.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  Switch,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronLeft,
  Info,
  Zap,
  Target,
  Plus,
  Minus,
  Save,
  Check,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Calendar,
  BarChart3,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  TriangleAlert,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { useProfile } from "@/lib/state/profile-store";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import {
  useCalculateAnnualPlan,
  useSaveScenario,
  formatCurrency,
  type CalculateAnnualPlanResponse,
  type FeasibilityRating,
  type ScenarioType,
} from "@/lib/useAnnualPlanner";
import { useSharedProjectedAnnual } from "@/lib/useSharedProjectedAnnual";
import { useUpsertYearPlan, useActiveYearPlan } from "@/lib/useYearPlan";
import { useTrips, type BackendTrip } from "@/lib/useTripsData";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import {
  type CreditCapResult,
  type PeriodType,
  type AssignmentType,
  type CreditCapPreferences,
  evaluateCreditedTimeStatus,
  buildCapInputsFromPrefs,
  getPeriodLimits,
  formatDecimalToHHMM,
  DEFAULT_CREDIT_CAP_PREFERENCES,
  getRelevantBidPeriod,
} from "@/lib/CreditCapEngine";

// ============================================
// TYPES
// ============================================
type AchievementMethod = "CURRENT_PACE" | "OPEN_TIME" | "JA_NEEDED" | "NOT_REALISTIC";
type WhatIfScenario = "NONE" | "GUARANTEE_ONLY" | "ALL_OPEN_TIME" | "ALL_JA";

// Extended response type with server fields
type ExtendedPlanResponse = CalculateAnnualPlanResponse & {
  gapEquivalents?: {
    gapRemainingCents: number;
    gapEquivBaseCreditHours: number;
    gapEquivJACreditHours: number;
    basePayPerCreditHour: number;
    jaPayPerCreditHour: number;
    jaMultiplier: number;
  };
  fromTodayForward?: {
    monthsLeft: number;
    remainingIncomeNeededCents: number;
    requiredCreditHoursPerMonthBase: number;
    requiredCreditHoursPerMonthJA: number;
    bidPeriodsRemaining: number;
    payPeriodsRemaining: number;
    requiredCreditHoursPerBidPeriodBase: number;
    requiredCreditHoursPerBidPeriodJA: number;
    requiredCreditHoursPerPayPeriodBase: number;
    requiredCreditHoursPerPayPeriodJA: number;
    baselineMonthlyHours: number;
    baselineBidPeriodHours: number;   // always 28-day (75 hrs) — legacy alias
    baselineBidPeriodHours_28: number;
    baselineBidPeriodHours_56: number;
    baselinePayPeriodHours: number;
    // Adjustment deltas (required - baseline) — clamped to >= 0
    adjustmentMonthlyBase: number;
    adjustmentMonthlyJA: number;
    adjustmentBidPeriodBase: number;       // 28-day variant (legacy alias)
    adjustmentBidPeriodBase_28: number;
    adjustmentBidPeriodBase_56: number;
    adjustmentBidPeriodJA: number;
    adjustmentPayPeriodBase: number;
    adjustmentPayPeriodJA: number;
    normalBidVariability: number;
    paceRatio: number;
    baselineSource: "rolling_90_day" | "guarantee";
  };
  bestLever?: {
    annualValueOf10ExtraHoursBase: number;
    annualValueOf10ExtraHoursJA: number;
  };
  // Credit Cap Engine result (null when awardedLineCredit not configured)
  creditCapResult?: CreditCapResult | null;
};

// ============================================
// CONSTANTS
// ============================================
const DEFAULT_TARGET_CENTS = 30000000;
const MIN_TARGET_CENTS = 10000000;
const MAX_TARGET_CENTS = 80000000;
const TARGET_INCREMENT = 1000000;
const UPS_GUARANTEE_HOURS = 75;
const JA_MULTIPLIER = 1.5;

// Contract anchors — single source of truth for UI labels
const CONTRACT = {
  // 28-day pay period guarantee
  GUARANTEE_28_DAY: 75,
  // 56-day bid period guarantee = 2 pay periods
  GUARANTEE_56_DAY: 150,
  // RDG guarantee per pay period
  RDG_GUARANTEE_PAY_PERIOD: 37.5,
  // Construction maxima (56-day)
  CONSTRUCTION_MAX_56_DOMESTIC: 172,
  CONSTRUCTION_MAX_56_INTL: 179.2,
  // Construction maxima (28-day)
  CONSTRUCTION_MAX_28_DOMESTIC: 86,
  CONSTRUCTION_MAX_28_INTL: 89.6,
};

const PRESETS = [
  { label: "$200K", value: 20000000 },
  { label: "$250K", value: 25000000 },
  { label: "$300K", value: 30000000 },
  { label: "$350K", value: 35000000 },
  { label: "$400K", value: 40000000 },
];

const JA_SHARE_OPTIONS = [0, 25, 50, 75, 100];

// ============================================
// HELPER: achievement method from scenarios
// ============================================
function getAchievementMethod(
  scenarios: CalculateAnnualPlanResponse["scenarios"] | undefined
): { method: AchievementMethod; bestScenario: CalculateAnnualPlanResponse["scenarios"][0] | null } {
  if (!scenarios || scenarios.length === 0) {
    return { method: "NOT_REALISTIC", bestScenario: null };
  }
  const currentPace = scenarios.find(s => s.scenarioType === "CURRENT_PACE");
  const optimized = scenarios.find(s => s.scenarioType === "OPTIMIZED");
  const aggressive = scenarios.find(s => s.scenarioType === "AGGRESSIVE");

  if (currentPace && currentPace.percentOfTarget >= 95) {
    return { method: "CURRENT_PACE", bestScenario: currentPace };
  }
  if (optimized && (optimized.feasibilityRating === "VERY_ACHIEVABLE" || optimized.feasibilityRating === "ACHIEVABLE_WITH_EFFORT")) {
    return { method: "OPEN_TIME", bestScenario: optimized };
  }
  if (aggressive && (aggressive.feasibilityRating === "VERY_ACHIEVABLE" || aggressive.feasibilityRating === "ACHIEVABLE_WITH_EFFORT" || aggressive.feasibilityRating === "UNLIKELY_WITHOUT_SIGNIFICANT_CHANGE")) {
    return { method: "JA_NEEDED", bestScenario: aggressive };
  }
  return { method: "NOT_REALISTIC", bestScenario: aggressive || null };
}

// ============================================
// COMPONENT: Target Selector
// ============================================
function TargetSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      <Text className="text-slate-400 text-sm mb-3 text-center">I want to earn this year</Text>

      <View className="flex-row items-center justify-center mb-4">
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(Math.max(value - TARGET_INCREMENT, MIN_TARGET_CENTS)); }}
          className="w-12 h-12 rounded-full bg-slate-700/60 items-center justify-center active:bg-slate-600"
        >
          <Minus size={24} color="#94a3b8" />
        </Pressable>
        <View className="mx-6">
          <Text className="text-green-400 text-4xl font-bold text-center">{formatCurrency(value)}</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(Math.min(value + TARGET_INCREMENT, MAX_TARGET_CENTS)); }}
          className="w-12 h-12 rounded-full bg-slate-700/60 items-center justify-center active:bg-slate-600"
        >
          <Plus size={24} color="#94a3b8" />
        </Pressable>
      </View>

      <View className="flex-row justify-center gap-2 flex-wrap">
        {PRESETS.map(p => (
          <Pressable
            key={p.value}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(p.value); }}
            className={`px-4 py-2 rounded-full ${value === p.value ? "bg-green-500/30 border border-green-500/50" : "bg-slate-700/50"}`}
          >
            <Text className={`text-sm font-medium ${value === p.value ? "text-green-400" : "text-slate-400"}`}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: GoalFeasibilitySummaryCard
// One compact "verdict" card shown near the top
// ============================================
function GoalFeasibilitySummaryCard({
  data,
  capPrefs,
  capResult,
  isLoading,
}: {
  data: ExtendedPlanResponse | null | undefined;
  capPrefs: CreditCapPreferences;
  capResult: CreditCapResult | null | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !data?.fromTodayForward) return null;

  const ftf = data.fromTodayForward;
  const extraNeededBid = Math.max(0, ftf.adjustmentBidPeriodBase ?? (ftf.requiredCreditHoursPerBidPeriodBase - (ftf.baselineBidPeriodHours ?? UPS_GUARANTEE_HOURS)));

  // Determine construction max based on period type and assignment
  const is56Day = capPrefs.periodType === "BID_56";
  const isIntl = capPrefs.assignmentType === "INTERNATIONAL";
  const constructionMax = is56Day
    ? (isIntl ? CONTRACT.CONSTRUCTION_MAX_56_INTL : CONTRACT.CONSTRUCTION_MAX_56_DOMESTIC)
    : (isIntl ? CONTRACT.CONSTRUCTION_MAX_28_INTL : CONTRACT.CONSTRUCTION_MAX_28_DOMESTIC);
  const guarantee = is56Day ? CONTRACT.GUARANTEE_56_DAY : CONTRACT.GUARANTEE_28_DAY;
  const goalPace = ftf.requiredCreditHoursPerBidPeriodBase;
  const withinConstructionMax = goalPace <= constructionMax;
  const requiresPickups = extraNeededBid > 0;
  const requiresJA = extraNeededBid > (constructionMax - guarantee) * 0.6;

  // Feasibility summary text
  let summaryLabel: string;
  let summaryColor: string;
  let summaryBg: string;
  let summaryBorder: string;

  if (extraNeededBid <= 0) {
    summaryLabel = "Reachable at current pace";
    summaryColor = "#22c55e";
    summaryBg = "rgba(34,197,94,0.08)";
    summaryBorder = "rgba(34,197,94,0.30)";
  } else if (!withinConstructionMax) {
    summaryLabel = "Not realistic under contract limits";
    summaryColor = "#ef4444";
    summaryBg = "rgba(239,68,68,0.08)";
    summaryBorder = "rgba(239,68,68,0.30)";
  } else if (requiresJA) {
    summaryLabel = "Reachable, but aggressive — requires Open Time + JA";
    summaryColor = "#f59e0b";
    summaryBg = "rgba(245,158,11,0.08)";
    summaryBorder = "rgba(245,158,11,0.30)";
  } else if (requiresPickups) {
    summaryLabel = "Reachable with balanced Open Time / JA";
    summaryColor = "#38bdf8";
    summaryBg = "rgba(56,189,248,0.08)";
    summaryBorder = "rgba(56,189,248,0.30)";
  } else {
    summaryLabel = "Reachable at current pace";
    summaryColor = "#22c55e";
    summaryBg = "rgba(34,197,94,0.08)";
    summaryBorder = "rgba(34,197,94,0.30)";
  }

  const periodLabel = is56Day ? "56-Day Bid Period" : "28-Day Pay Period";

  return (
    <View className="rounded-2xl p-4 border" style={{ backgroundColor: summaryBg, borderColor: summaryBorder }}>
      <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: summaryColor }}>
        Goal Feasibility
      </Text>
      <Text className="text-white text-base font-bold mb-3">{summaryLabel}</Text>
      {/* 3 quick facts */}
      <View className="gap-y-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-slate-400 text-xs">Extra needed / {periodLabel}</Text>
          <Text className="text-white text-xs font-bold">
            {extraNeededBid <= 0 ? "None" : `+${extraNeededBid.toFixed(1)} hrs`}
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-slate-400 text-xs">Within construction max ({constructionMax} hrs)?</Text>
          <View className="flex-row items-center gap-x-1">
            {withinConstructionMax
              ? <CheckCircle size={12} color="#22c55e" />
              : <AlertTriangle size={12} color="#ef4444" />}
            <Text className="text-xs font-semibold" style={{ color: withinConstructionMax ? "#22c55e" : "#ef4444" }}>
              {withinConstructionMax ? "Yes" : "No"}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-slate-400 text-xs">Requires Open Time / JA?</Text>
          <Text className="text-xs font-semibold" style={{ color: requiresPickups ? "#f59e0b" : "#22c55e" }}>
            {requiresPickups ? "Yes" : "No"}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: Result Card
// ============================================
function ResultCard({
  method,
  bestScenario,
  targetCents,
  isLoading,
  projectedAnnualCents,
}: {
  method: AchievementMethod;
  bestScenario: CalculateAnnualPlanResponse["scenarios"][0] | null;
  targetCents: number;
  isLoading: boolean;
  projectedAnnualCents: number;
}) {
  if (isLoading) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700/50 items-center">
        <ActivityIndicator color="#f59e0b" size="large" />
        <Text className="text-slate-400 mt-3">Analyzing your goal...</Text>
      </View>
    );
  }
  if (!bestScenario) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-6 border border-slate-700/50 items-center">
        <Info size={32} color="#64748b" />
        <Text className="text-slate-400 mt-3 text-center">Set your target above to see your plan</Text>
      </View>
    );
  }

  // Always show CURRENT_PACE projected annual for consistency with Career Benchmarks and Dashboard.
  // bestScenario drives the achievement method title/icon and extra hours info.

  const configs: Record<AchievementMethod, { icon: any; iconColor: string; bgColor: string; borderColor: string; title: string; accentColor: string }> = {
    CURRENT_PACE: { icon: CheckCircle, iconColor: "#22c55e", bgColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.30)", title: "You're Already On Track", accentColor: "#22c55e" },
    OPEN_TIME:    { icon: TrendingUp,  iconColor: "#f59e0b", bgColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.30)", title: "Achievable with Open Time", accentColor: "#f59e0b" },
    JA_NEEDED:    { icon: Zap,         iconColor: "#a855f7", bgColor: "rgba(168,85,247,0.10)", borderColor: "rgba(168,85,247,0.30)", title: "Achievable with JA Flying", accentColor: "#a855f7" },
    NOT_REALISTIC:{ icon: AlertTriangle,iconColor:"#ef4444", bgColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.30)",  title: "Target May Be Too High",  accentColor: "#ef4444" },
  };
  const localPct = targetCents > 0 ? (projectedAnnualCents / targetCents) * 100 : 0;
  const methodForDisplay: AchievementMethod = localPct >= 95 ? "CURRENT_PACE" : method;
  const cfg = configs[methodForDisplay];
  const Icon = cfg.icon;
  // Progress to goal is based on current pace projected annual vs target (local math)
  const pct = localPct;

  return (
    <View className="rounded-2xl p-5 border" style={{ backgroundColor: cfg.bgColor, borderColor: cfg.borderColor }}>
      <View className="flex-row items-center mb-4">
        <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: cfg.borderColor }}>
          <Icon size={24} color={cfg.iconColor} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-white text-lg font-bold">{cfg.title}</Text>
          <Text className="text-slate-400 text-sm">
            {methodForDisplay === "CURRENT_PACE" && "Your current pace gets you there"}
            {methodForDisplay === "OPEN_TIME" && `+${bestScenario.requiredExtraCreditHoursPerBidPeriod.toFixed(0)} credit hrs/bid above your baseline`}
            {methodForDisplay === "JA_NEEDED" && "Plan requires JA (150%) flying above baseline"}
            {methodForDisplay === "NOT_REALISTIC" && "Consider adjusting your goal"}
          </Text>
        </View>
      </View>

      <View className="mb-4">
        <View className="flex-row justify-between mb-1">
          <Text className="text-slate-400 text-xs">Progress to Goal</Text>
          <Text className="text-sm font-semibold" style={{ color: cfg.accentColor }}>{pct.toFixed(0)}%</Text>
        </View>
        <View className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
          <View className="h-full rounded-full" style={{ backgroundColor: cfg.accentColor, width: `${Math.min(pct, 100)}%` }} />
        </View>
      </View>

      <View className="bg-slate-900/50 rounded-xl p-4 flex-row justify-between items-center">
        <View>
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Projected Annual Pay</Text>
          <Text className="text-2xl font-bold" style={{ color: cfg.accentColor }}>
            {formatCurrency(projectedAnnualCents)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Your Target</Text>
          <Text className="text-white text-lg font-semibold">{formatCurrency(targetCents)}</Text>
        </View>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: BidPeriodPrimaryCard
// LARGE hero card — actionable bid-period target with "How to Fly" section
// ============================================
function BidPeriodPrimaryCard({
  data,
  useRollingBaseline,
  jaSharePct,
  onJaShareChange,
  capResult,
  periodType,
  isRDGLine,
}: {
  data: NonNullable<ExtendedPlanResponse["fromTodayForward"]>;
  useRollingBaseline: boolean;
  jaSharePct: number;
  onJaShareChange: (pct: number) => void;
  capResult?: CreditCapResult | null;
  periodType: PeriodType;
  isRDGLine: boolean;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const gap = data.remainingIncomeNeededCents;

  // Determine baseline from period type and RDG
  const is56Day = periodType === "BID_56";
  const contractGuarantee = is56Day ? CONTRACT.GUARANTEE_56_DAY : CONTRACT.GUARANTEE_28_DAY;
  const rdgBaseline = is56Day
    ? CONTRACT.RDG_GUARANTEE_PAY_PERIOD * 2
    : CONTRACT.RDG_GUARANTEE_PAY_PERIOD;
  const flatContractBaseline = isRDGLine ? rdgBaseline : contractGuarantee;
  const periodLabel = is56Day ? "56-Day Bid Period" : "28-Day Pay Period";
  const baselineLabel = isRDGLine ? "Baseline (RDG Guarantee)" : "Baseline (Contract Guarantee)";

  if (gap <= 0) {
    return (
      <View className="rounded-2xl p-5 border border-green-500/30" style={{ backgroundColor: "rgba(34,197,94,0.07)" }}>
        <View className="flex-row items-center mb-3">
          <CheckCircle size={18} color="#22c55e" />
          <Text className="text-green-400 text-base font-bold ml-2">You're Ahead of Pace</Text>
        </View>
        <View className="bg-green-500/10 rounded-xl p-4">
          <Text className="text-green-300 text-sm font-semibold mb-1">Surplus Buffer</Text>
          <Text className="text-white text-2xl font-bold">
            No extra credit hours needed this {periodLabel}
          </Text>
          <Text className="text-slate-400 text-xs mt-1">Your projected pace exceeds your target. Great work.</Text>
        </View>
      </View>
    );
  }

  // Determine display baseline based on toggle
  const usingRolling = useRollingBaseline && data.baselineSource === "rolling_90_day";
  const displayBaselineBid = usingRolling
    ? (data.baselineBidPeriodHours ?? flatContractBaseline)
    : flatContractBaseline;

  // Required bid-period credit hours (from server)
  const reqBidBase = data.requiredCreditHoursPerBidPeriodBase;

  // Use the period-correct server-computed adjustment delta.
  // The server clamps these to max(0, …) and uses the right baseline (150 for 56-day, 75 for 28-day).
  const serverAdj = is56Day
    ? (data.adjustmentBidPeriodBase_56 ?? Math.max(0, reqBidBase - flatContractBaseline))
    : (data.adjustmentBidPeriodBase_28 ?? Math.max(0, reqBidBase - flatContractBaseline));
  // When rolling baseline is active, recompute against the rolling anchor
  const rawAdjBidBase = usingRolling
    ? Math.max(0, reqBidBase - (data.baselineBidPeriodHours ?? flatContractBaseline))
    : serverAdj;

  // ── Cap engine: clamp the displayed OT to what's contractually allowed ──
  const isCapped = capResult != null && (
    capResult.status === "NOT_ACHIEVABLE_WITH_OT" ||
    capResult.status === "EXCEEDS_CAP_BLOCKED" ||
    capResult.status === "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION"
  );
  const cappedOT = capResult != null
    ? Math.min(rawAdjBidBase, capResult.maxOpenTimeAllowed)
    : rawAdjBidBase;
  const adjBidBase = isCapped ? cappedOT : rawAdjBidBase;
  const capShortfall = rawAdjBidBase - adjBidBase; // hours the cap is cutting off

  // Mixed strategy computation
  const jaShare = jaSharePct / 100;
  const otCreditPart = adjBidBase * (1 - jaShare);
  const jaHourPart = (adjBidBase * jaShare) / 1.5;

  return (
    <View
      className="rounded-2xl p-5 border border-amber-500/30"
      style={{ backgroundColor: "rgba(245,158,11,0.07)" }}
    >
      {/* Card header */}
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center flex-1">
          <Target size={18} color="#f59e0b" />
          <Text className="text-amber-400 text-base font-bold ml-2">{periodLabel} Target</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowTooltip(v => !v); }}
          className="w-7 h-7 items-center justify-center"
        >
          <Info size={16} color={showTooltip ? "#f59e0b" : "#64748b"} />
        </Pressable>
      </View>
      <Text className="text-slate-500 text-xs mb-3">
        Extra credit needed above {flatContractBaseline.toFixed(0)}-hr {isRDGLine ? "RDG" : "contract"} guarantee
      </Text>

      {/* Tooltip */}
      {showTooltip && (
        <View className="bg-slate-900/80 border border-amber-500/20 rounded-xl p-3 mb-3">
          <Text className="text-slate-300 text-xs leading-5">
            {is56Day
              ? "The 56-Day Bid Period is your primary planning clock. Guarantee is 150 hrs (2 × 75-hr pay periods). Monthly and pay period figures are approximate conversions of the same requirement."
              : "The 28-Day Pay Period guarantee is 75 hrs. Monthly is an approximate conversion. Bid Period is your primary contract timeframe."}
          </Text>
        </View>
      )}

      {/* Rolling baseline note */}
      {usingRolling && (
        <View className="bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2 mb-3 flex-row items-center">
          <Info size={12} color="#38bdf8" />
          <Text className="text-sky-400 text-xs ml-2">(rolling avg baseline — overrides contract guarantee)</Text>
        </View>
      )}
      {useRollingBaseline && data.baselineSource !== "rolling_90_day" && (
        <View className="bg-slate-700/40 border border-slate-600/30 rounded-lg px-3 py-2 mb-3">
          <Text className="text-slate-400 text-xs leading-4">
            Using {flatContractBaseline.toFixed(0)}-hr {isRDGLine ? "RDG" : "contract"} guarantee baseline (not enough YTD data for a stable pace).
          </Text>
        </View>
      )}

      {/* ── Cap status banner ── */}
      {capResult && capResult.status !== "ACHIEVABLE" && (
        <View
          className="rounded-xl px-3 py-2.5 mb-3 flex-row items-start gap-x-2"
          style={{
            backgroundColor: capResult.status === "EXCEEDS_CAP_BLOCKED"
              ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.10)",
            borderWidth: 1,
            borderColor: capResult.status === "EXCEEDS_CAP_BLOCKED"
              ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.35)",
          }}
        >
          <ShieldAlert size={14} color={capResult.status === "EXCEEDS_CAP_BLOCKED" ? "#ef4444" : "#f59e0b"} style={{ marginTop: 1 }} />
          <View className="flex-1">
            {capResult.status === "NOT_ACHIEVABLE_WITH_OT" && (
              <>
                <Text className="text-amber-300 text-xs font-bold">Open Time Pickup Limit — Goal Not Achievable with Open Time Alone</Text>
                <Text className="text-slate-400 text-xs mt-0.5 leading-4">
                  Max Open Time allowed: {formatDecimalToHHMM(capResult.maxOpenTimeAllowed)} hrs · Goal needs: {formatDecimalToHHMM(rawAdjBidBase)} hrs · Showing capped view below
                  {capShortfall > 0 ? ` (${formatDecimalToHHMM(capShortfall)} hrs short)` : ""}
                </Text>
              </>
            )}
            {capResult.status === "EXCEEDS_CAP_BLOCKED" && (
              <>
                <Text className="text-red-300 text-xs font-bold">Exceeds {capResult.periodType.replace("_", "-")} Absolute Cap ({capResult.effectiveAbsoluteCap} hrs)</Text>
                <Text className="text-slate-400 text-xs mt-0.5 leading-4">
                  Projected: {formatDecimalToHHMM(capResult.capCountingCredit)} hrs · Cap: {formatDecimalToHHMM(capResult.effectiveAbsoluteCap)} hrs · Over by {formatDecimalToHHMM(capResult.overCapBy)} hrs
                </Text>
              </>
            )}
            {capResult.status === "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION" && (
              <>
                <Text className="text-amber-300 text-xs font-bold">Over Cap — Trip Completion Exception</Text>
                <Text className="text-slate-400 text-xs mt-0.5">Over by {formatDecimalToHHMM(capResult.overCapBy)} hrs (trip already departed)</Text>
              </>
            )}
          </View>
        </View>
      )}

      {/* HERO number */}
      <View className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4 mb-4 items-center">
        <Text style={{ fontSize: 48, fontWeight: "800", color: "#ffffff", lineHeight: 54 }}>
          +{adjBidBase.toFixed(1)}
        </Text>
        <Text className="text-amber-400 text-xs font-bold uppercase tracking-widest mt-1">
          EXTRA CREDIT HRS · {periodLabel.toUpperCase()}
        </Text>
        {isCapped && capShortfall > 0 && (
          <View className="mt-2 bg-amber-500/15 rounded-full px-3 py-1">
            <Text className="text-amber-400 text-xs font-semibold">
              Capped ↓ from {rawAdjBidBase.toFixed(1)} · {formatDecimalToHHMM(capShortfall)} hrs not achievable via Open Time
            </Text>
          </View>
        )}

        {/* Baseline / Goal row */}
        <View className="flex-row mt-3 pt-3 border-t border-amber-500/20 gap-x-8 justify-center">
          <View className="items-center">
            <Text className="text-slate-500 text-xs">{baselineLabel}</Text>
            <Text className="text-slate-300 text-sm font-semibold">{displayBaselineBid.toFixed(1)} hrs/{is56Day ? "bid" : "pay period"}</Text>
          </View>
          <View className="items-center">
            <Text className="text-slate-500 text-xs">Goal pace needed</Text>
            <Text className="text-slate-300 text-sm font-semibold">{reqBidBase.toFixed(1)} hrs/{is56Day ? "bid" : "pay period"}</Text>
          </View>
        </View>
      </View>

      {/* HOW TO FLY THIS TARGET section */}
      <View>
        <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
          How to Fly This Target (credit hours only — no trip assumptions)
        </Text>

        {/* Row 1: Open Time (Base Rate) */}
        <View
          className="rounded-xl p-3.5 mb-2.5"
          style={{ backgroundColor: "rgba(56,189,248,0.07)", borderWidth: 1, borderColor: "rgba(56,189,248,0.25)" }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sky-300 text-xs font-semibold uppercase tracking-wide">Open Time (Base Rate)</Text>
            </View>
            <Text className="text-sky-300 font-bold text-lg">+{adjBidBase.toFixed(1)} credit hrs</Text>
          </View>
        </View>

        {/* Row 2: JA Equivalent */}
        <View
          className="rounded-xl p-3.5 mb-2.5"
          style={{ backgroundColor: "rgba(192,132,252,0.07)", borderWidth: 1, borderColor: "rgba(192,132,252,0.25)" }}
        >
          <View className="flex-row items-center justify-between mb-0.5">
            <View className="flex-1">
              <Text className="text-purple-300 text-xs font-semibold uppercase tracking-wide">Junior Assignment (JA) — 150% pay value</Text>
            </View>
            <Text className="text-purple-300 font-bold text-lg">+{(adjBidBase / 1.5).toFixed(1)} JA hrs</Text>
          </View>
          <Text className="text-slate-500 text-xs">Fewer physical hours at 1.5× pay value — pay-equivalent to the full Open Time requirement above</Text>
        </View>

        {/* Row 3: Mixed Strategy with share picker */}
        <View
          className="rounded-xl p-3.5"
          style={{ backgroundColor: "rgba(52,211,153,0.07)", borderWidth: 1, borderColor: "rgba(52,211,153,0.25)" }}
        >
          <Text className="text-emerald-300 text-xs font-semibold uppercase tracking-wide mb-2">Mixed Strategy</Text>

          {/* JA Share picker */}
          <View className="mb-2.5">
            <Text className="text-slate-500 text-xs mb-2">JA Share: {jaSharePct}%</Text>
            <View className="flex-row gap-x-2">
              {JA_SHARE_OPTIONS.map(pct => (
                <Pressable
                  key={pct}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onJaShareChange(pct); }}
                  className={`flex-1 py-1.5 rounded-lg items-center ${jaSharePct === pct ? "bg-emerald-500/30 border border-emerald-400/50" : "bg-slate-700/50"}`}
                >
                  <Text className={`text-xs font-semibold ${jaSharePct === pct ? "text-emerald-300" : "text-slate-400"}`}>{pct}%</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Mixed result */}
          <View className="flex-row items-center flex-wrap gap-x-2">
            <Text className="text-emerald-300 font-bold text-base">
              +{otCreditPart.toFixed(1)} Open Time credit hrs
            </Text>
            {jaShare > 0 && (
              <>
                <Text className="text-slate-500 text-sm">+</Text>
                <Text className="text-purple-300 font-bold text-base">
                  {jaHourPart.toFixed(1)} JA hrs
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Note */}
        <Text className="text-slate-600 text-xs mt-3 leading-4">
          Junior Assignment (JA) availability varies by base/seniority/staffing. JA hour counts are pay-equivalents — fewer hours at 1.5× pay rate.
        </Text>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: EquivalentPaceSection
// Secondary — conversions from the bid period source of truth
// ============================================
function EquivalentPaceSection({
  data,
  useRollingBaseline,
  periodType,
  isRDGLine,
}: {
  data: NonNullable<ExtendedPlanResponse["fromTodayForward"]>;
  useRollingBaseline: boolean;
  periodType: PeriodType;
  isRDGLine: boolean;
}) {
  const gap = data.remainingIncomeNeededCents;
  if (gap <= 0) return null;

  const usingRolling = useRollingBaseline && data.baselineSource === "rolling_90_day";
  const is56Day = periodType === "BID_56";

  // Bid period is source of truth
  const contractBaseline = is56Day ? CONTRACT.GUARANTEE_56_DAY : CONTRACT.GUARANTEE_28_DAY;
  const rdgBaseline = is56Day ? CONTRACT.RDG_GUARANTEE_PAY_PERIOD * 2 : CONTRACT.RDG_GUARANTEE_PAY_PERIOD;
  const flatContractBaseline = isRDGLine ? rdgBaseline : contractBaseline;

  const displayBaselineBid = usingRolling
    ? (data.baselineBidPeriodHours ?? flatContractBaseline)
    : flatContractBaseline;
  const reqBidBase = data.requiredCreditHoursPerBidPeriodBase;
  // Use period-correct server adjustment (clamped, right baseline)
  const serverAdj = is56Day
    ? (data.adjustmentBidPeriodBase_56 ?? Math.max(0, reqBidBase - flatContractBaseline))
    : (data.adjustmentBidPeriodBase_28 ?? Math.max(0, reqBidBase - flatContractBaseline));
  const adjBidBase = usingRolling
    ? Math.max(0, reqBidBase - (data.baselineBidPeriodHours ?? flatContractBaseline))
    : serverAdj;

  // 28-Day Pay Period Equivalent: divide bid period by 2 (56-day → 28-day)
  const reqPayPeriod = is56Day ? reqBidBase / 2 : reqBidBase;
  const baselinePayPeriod = is56Day ? displayBaselineBid / 2 : displayBaselineBid;
  const adjPayPeriod = Math.max(0, reqPayPeriod - baselinePayPeriod);

  // Monthly: derive from bid-period baseline using same 30.44/28 scalar the backend uses
  const reqMonthApprox = data.requiredCreditHoursPerMonthBase;
  const baselineMonthApprox = is56Day
    ? displayBaselineBid * (30.44 / 56)
    : displayBaselineBid * (30.44 / 28);
  const adjMonthApprox = Math.max(0, reqMonthApprox - baselineMonthApprox);

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      {/* Header */}
      <Text className="text-slate-300 text-base font-semibold mb-0.5">
        Equivalent Pace
      </Text>
      <Text className="text-slate-500 text-xs mb-4 leading-4">
        Conversions of the same requirement. {is56Day ? "56-Day Bid Period" : "28-Day Pay Period"} is your primary contract anchor.
      </Text>

      {/* 28-Day Pay Period Equivalent */}
      <View
        className="rounded-xl p-4 mb-3"
        style={{ backgroundColor: "rgba(167,139,250,0.07)", borderWidth: 1, borderColor: "rgba(167,139,250,0.20)" }}
      >
        <View className="flex-row items-center mb-2">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: "rgba(167,139,250,0.15)" }}
          >
            <DollarSign size={15} color="#a78bfa" />
          </View>
          <Text className="text-violet-300 text-sm font-semibold flex-1">28-Day Pay Period Equivalent</Text>
          <Text className="text-violet-300 font-bold text-lg">+{adjPayPeriod.toFixed(1)} hrs</Text>
        </View>
        <View className="flex-row gap-x-5 pl-10">
          <View>
            <Text className="text-slate-500 text-xs">Guarantee</Text>
            <Text className="text-slate-400 text-xs font-semibold">{baselinePayPeriod.toFixed(1)} hrs</Text>
          </View>
          <View>
            <Text className="text-slate-500 text-xs">Goal pace</Text>
            <Text className="text-slate-400 text-xs font-semibold">{reqPayPeriod.toFixed(1)} hrs/pay period</Text>
          </View>
        </View>
        {is56Day && (
          <Text className="text-slate-600 text-xs mt-2 pl-10">Bid period ÷ 2 (56-day → 28-day)</Text>
        )}
      </View>

      {/* Approx. Monthly Equivalent */}
      <View
        className="rounded-xl p-4"
        style={{ backgroundColor: "rgba(56,189,248,0.07)", borderWidth: 1, borderColor: "rgba(56,189,248,0.20)" }}
      >
        <View className="flex-row items-center mb-2">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: "rgba(56,189,248,0.15)" }}
          >
            <Calendar size={15} color="#38bdf8" />
          </View>
          <Text className="text-sky-300 text-sm font-semibold flex-1">Approx. Monthly Equivalent</Text>
          <Text className="text-sky-300 font-bold text-lg">+{adjMonthApprox.toFixed(1)} hrs</Text>
        </View>
        <View className="flex-row gap-x-5 pl-10">
          <View>
            <Text className="text-slate-500 text-xs">Approx. baseline</Text>
            <Text className="text-slate-400 text-xs font-semibold">~{baselineMonthApprox.toFixed(1)} hrs</Text>
          </View>
          <View>
            <Text className="text-slate-500 text-xs">Goal pace</Text>
            <Text className="text-slate-400 text-xs font-semibold">~{reqMonthApprox.toFixed(1)} hrs/mo</Text>
          </View>
        </View>
        <Text className="text-slate-600 text-xs mt-2 pl-10">Approximate — calendar months vary. Not a contract basis.</Text>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: Pace Intensity Card
// Compares required ADJUSTMENT vs normal bid-period variability range
// ============================================
function PaceIntensityCard({
  data,
}: {
  data: ExtendedPlanResponse["fromTodayForward"];
}) {
  if (!data) return null;

  const gap = data.remainingIncomeNeededCents;
  if (gap <= 0) return null;

  // Use bid-period adjustment as the primary signal
  const adjustment = data.adjustmentBidPeriodBase ?? (data.requiredCreditHoursPerBidPeriodBase - (data.baselineBidPeriodHours ?? UPS_GUARANTEE_HOURS));
  const normalVariability = data.normalBidVariability ?? Math.round((data.baselineBidPeriodHours ?? UPS_GUARANTEE_HOURS) * 0.14 * 10) / 10;
  const baselineBid = UPS_GUARANTEE_HOURS; // Flat 75-hr contract guarantee

  type IntensityLevel = "mild" | "moderate" | "strong" | "aggressive";

  let intensity: IntensityLevel;
  if (adjustment <= normalVariability * 0.75) {
    intensity = "mild";
  } else if (adjustment <= normalVariability * 1.5) {
    intensity = "moderate";
  } else if (adjustment <= normalVariability * 2.5) {
    intensity = "strong";
  } else {
    intensity = "aggressive";
  }

  const intensityConfigs: Record<IntensityLevel, {
    label: string; color: string; bgColor: string; borderColor: string; description: string; primaryMessage: string;
  }> = {
    mild: {
      label: "Mild Adjustment",
      color: "#22c55e",
      bgColor: "rgba(34,197,94,0.08)",
      borderColor: "rgba(34,197,94,0.25)",
      description: `+${adjustment.toFixed(1)} hrs above baseline is within normal bid-to-bid variability (±${normalVariability.toFixed(0)} hrs).`,
      primaryMessage: "Pickup one or two open time trips.",
    },
    moderate: {
      label: "Moderate Push",
      color: "#f59e0b",
      bgColor: "rgba(245,158,11,0.08)",
      borderColor: "rgba(245,158,11,0.25)",
      description: `+${adjustment.toFixed(1)} hrs exceeds typical variability. Requires focused open time acquisition.`,
      primaryMessage: "Actively pursue open time each bid period.",
    },
    strong: {
      label: "Strong Push",
      color: "#f97316",
      bgColor: "rgba(249,115,22,0.08)",
      borderColor: "rgba(249,115,22,0.25)",
      description: `+${adjustment.toFixed(1)} hrs is well above normal variability (±${normalVariability.toFixed(0)} hrs). Consistent effort required.`,
      primaryMessage: "Open time + JA flying consistently needed.",
    },
    aggressive: {
      label: "Aggressive Push",
      color: "#ef4444",
      bgColor: "rgba(239,68,68,0.08)",
      borderColor: "rgba(239,68,68,0.25)",
      description: `+${adjustment.toFixed(1)} hrs is significantly above normal variability. Consider adjusting your target.`,
      primaryMessage: "Heavy JA and open time every bid period.",
    },
  };

  const cfg = intensityConfigs[intensity];

  // Bar visualization: adjustment vs variability band
  const maxBarValue = Math.max(adjustment * 1.3, normalVariability * 3);
  const variabilityPct = Math.min(100, (normalVariability / maxBarValue) * 100);
  const adjustmentPct = Math.min(100, Math.max(0, (adjustment / maxBarValue) * 100));

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      <View className="flex-row items-center mb-3">
        <Gauge size={18} color="#64748b" />
        <Text className="text-slate-300 text-base font-semibold ml-2">Adjustment Intensity</Text>
      </View>

      {/* Key message */}
      <View className="rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: cfg.bgColor, borderWidth: 1, borderColor: cfg.borderColor }}>
        <Text className="text-sm font-bold mb-0.5" style={{ color: cfg.color }}>{cfg.label}</Text>
        <Text className="text-white text-base font-semibold">{cfg.primaryMessage}</Text>
      </View>

      {/* Comparison bar */}
      <View className="mb-4">
        <View className="h-4 bg-slate-900/60 rounded-full overflow-hidden relative mb-2">
          {/* Normal variability band */}
          <View
            className="absolute h-full rounded-full opacity-40"
            style={{ left: 0, width: `${variabilityPct}%`, backgroundColor: "#22c55e" }}
          />
          {/* Adjustment marker */}
          <View
            className="absolute h-full w-1 rounded-full"
            style={{ left: `${adjustmentPct}%`, backgroundColor: cfg.color }}
          />
        </View>
        <View className="flex-row justify-between">
          <Text className="text-slate-500 text-xs">Normal variability: ±{normalVariability.toFixed(0)} hrs</Text>
          <Text className="text-xs font-semibold" style={{ color: cfg.color }}>Your adjustment: +{adjustment.toFixed(1)} hrs</Text>
        </View>
      </View>

      {/* Stats row */}
      <View className="flex-row gap-x-3">
        <View className="flex-1 bg-slate-900/50 rounded-xl p-3">
          <Text className="text-slate-500 text-xs">Baseline (Guarantee)</Text>
          <Text className="text-slate-300 text-sm font-bold">{baselineBid.toFixed(1)} hrs</Text>
          <Text className="text-slate-500 text-xs">per bid period</Text>
        </View>
        <View className="flex-1 rounded-xl p-3" style={{ backgroundColor: cfg.bgColor, borderWidth: 1, borderColor: cfg.borderColor }}>
          <Text className="text-slate-500 text-xs">Your Adjustment</Text>
          <Text className="text-sm font-bold" style={{ color: cfg.color }}>+{adjustment.toFixed(1)} hrs</Text>
          <Text className="text-slate-500 text-xs">above baseline</Text>
        </View>
      </View>

      <Text className="text-slate-600 text-xs mt-3 leading-4">{cfg.description}</Text>
    </View>
  );
}

// ============================================
// COMPONENT: Required This Bid Period (hidden in favor of new BidPeriodPrimaryCard)
// Kept for reference but not rendered
// ============================================
function BidPeriodTargetCard({
  data,
  gapData,
  showJA: _showJA,
}: {
  data: ExtendedPlanResponse["fromTodayForward"];
  gapData: ExtendedPlanResponse["gapEquivalents"];
  showJA: boolean;
}) {
  if (!data || !gapData) return null;

  const gap = data.remainingIncomeNeededCents;
  if (gap <= 0) return null;

  const adjBidBase = data.adjustmentBidPeriodBase ?? (data.requiredCreditHoursPerBidPeriodBase - (data.baselineBidPeriodHours ?? UPS_GUARANTEE_HOURS));
  const baselineBid = UPS_GUARANTEE_HOURS; // Flat 75-hr contract guarantee
  const reqBidBase = data.requiredCreditHoursPerBidPeriodBase;

  // Strategy calculations
  const otOnly = adjBidBase; // Open Time: full adjustment as base credit hrs
  const jaOnly = adjBidBase / 1.5; // JA Only: fewer physical hours at 1.5× value
  const mixedOT = adjBidBase / 2; // Mixed: half via OT
  const mixedJA = (adjBidBase / 2) / 1.5; // Mixed: half via JA (converted)

  const strategies = [
    {
      label: "Option A — Open Time Only",
      tag: "Base pay equivalent",
      tagColor: "#38bdf8",
      tagBg: "rgba(56,189,248,0.12)",
      borderColor: "rgba(56,189,248,0.25)",
      bgColor: "rgba(56,189,248,0.06)",
      valueLine: `+${otOnly.toFixed(1)} credit hrs`,
      subLine: "Open Time Credit Needed",
      subColor: "#94a3b8",
      dot: "#38bdf8",
    },
    {
      label: "Option B — JA Only (150%)",
      tag: "Premium efficiency",
      tagColor: "#c084fc",
      tagBg: "rgba(192,132,252,0.12)",
      borderColor: "rgba(192,132,252,0.25)",
      bgColor: "rgba(192,132,252,0.06)",
      valueLine: `+${jaOnly.toFixed(1)} JA hrs`,
      subLine: "JA Credit Hours Needed",
      subColor: "#94a3b8",
      dot: "#c084fc",
    },
    {
      label: "Option C — Mixed Strategy",
      tag: "Lower fatigue / smoother correction",
      tagColor: "#34d399",
      tagBg: "rgba(52,211,153,0.12)",
      borderColor: "rgba(52,211,153,0.25)",
      bgColor: "rgba(52,211,153,0.06)",
      valueLine: `+${mixedOT.toFixed(1)} OT  +  +${mixedJA.toFixed(1)} JA`,
      subLine: "Balanced Strategy",
      subColor: "#94a3b8",
      dot: "#34d399",
    },
  ];

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-amber-500/25">
      {/* Section header */}
      <View className="flex-row items-center mb-1">
        <Target size={18} color="#f59e0b" />
        <Text className="text-slate-300 text-base font-semibold ml-2">This Bid Period Target</Text>
      </View>
      <Text className="text-slate-500 text-xs mb-4">Extra credit needed above the 75-hr guarantee baseline.</Text>

      {/* HERO: Required Adjustment */}
      <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-4">
        <Text className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
          Required Adjustment
        </Text>
        <View className="flex-row items-baseline gap-x-2">
          <Text className="text-white font-bold" style={{ fontSize: 40, lineHeight: 44 }}>
            +{adjBidBase.toFixed(1)}
          </Text>
          <Text className="text-amber-400 text-base font-semibold">credit hrs</Text>
        </View>
        <View className="flex-row mt-3 pt-3 border-t border-amber-500/20 gap-x-6">
          <View>
            <Text className="text-slate-500 text-xs">Baseline (Guarantee)</Text>
            <Text className="text-slate-300 text-sm font-semibold">{baselineBid.toFixed(1)} hrs</Text>
          </View>
          <View>
            <Text className="text-slate-500 text-xs">Goal pace needed</Text>
            <Text className="text-slate-300 text-sm font-semibold">{reqBidBase.toFixed(1)} hrs</Text>
          </View>
        </View>
      </View>

      {/* Strategy label */}
      <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
        How you can achieve this:
      </Text>

      {/* Strategy cards */}
      <View className="gap-y-2.5">
        {strategies.map((s) => (
          <View
            key={s.label}
            className="rounded-xl p-3.5"
            style={{ backgroundColor: s.bgColor, borderWidth: 1, borderColor: s.borderColor }}
          >
            {/* Top row: label + tag */}
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center gap-x-2 flex-1">
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: s.dot }} />
                <Text className="text-slate-300 text-xs font-semibold flex-1">{s.label}</Text>
              </View>
              <View className="rounded-md px-2 py-0.5 ml-2" style={{ backgroundColor: s.tagBg }}>
                <Text className="text-xs font-medium" style={{ color: s.tagColor }}>{s.tag}</Text>
              </View>
            </View>

            {/* Value */}
            <Text className="text-white font-bold ml-4" style={{ fontSize: 22, lineHeight: 26 }}>
              {s.valueLine}
            </Text>

            {/* Sub label */}
            <Text className="text-slate-500 text-xs ml-4 mt-0.5">{s.subLine}</Text>
          </View>
        ))}
      </View>

      <Text className="text-slate-600 text-xs mt-4 leading-4">
        Adjustment = Required Pace − Your Baseline Average. Strategies are optional interpretations — no trip-count assumptions.
      </Text>
    </View>
  );
}

// ============================================
// COMPONENT: What You Need (credit-hours only)
// ============================================
function WhatYouNeedCard({
  bestScenario, baseline, hourlyRateCents,
}: {
  bestScenario: CalculateAnnualPlanResponse["scenarios"][0] | null;
  baseline: CalculateAnnualPlanResponse["baseline"] | undefined;
  hourlyRateCents: number;
}) {
  if (!bestScenario || !baseline) return null;

  const guarantee = UPS_GUARANTEE_HOURS;
  const totalNeeded = bestScenario.projectedMonthlyAvgCreditHours;
  const extraNeeded = Math.max(0, Math.round((totalNeeded - guarantee) * 10) / 10);
  const jaEquivExtra = extraNeeded > 0
    ? Math.round((extraNeeded / JA_MULTIPLIER) * 10) / 10
    : 0;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      <View className="flex-row items-center mb-1">
        <Clock size={18} color="#64748b" />
        <Text className="text-slate-300 text-base font-semibold ml-2">What You Need (Credit Hours)</Text>
      </View>
      <Text className="text-slate-500 text-xs mb-4">Simple credit-hour plan — no trip assumptions.</Text>

      {/* Stacked bar */}
      <View className="h-7 flex-row rounded-xl overflow-hidden mb-3 bg-slate-900/40">
        <View className="h-full items-center justify-center" style={{ width: `${(guarantee / Math.max(totalNeeded, guarantee)) * 100}%`, backgroundColor: "#3b82f6" }}>
          <Text className="text-white text-xs font-semibold">{guarantee}</Text>
        </View>
        {extraNeeded > 0 && (
          <View className="h-full items-center justify-center" style={{ width: `${(extraNeeded / Math.max(totalNeeded, guarantee)) * 100}%`, backgroundColor: "#f59e0b" }}>
            {extraNeeded >= 5 && <Text className="text-white text-xs font-semibold">+{extraNeeded.toFixed(0)}</Text>}
          </View>
        )}
      </View>

      {/* 3-line breakdown */}
      <View className="bg-slate-900/50 rounded-xl p-4 gap-y-2">
        <View className="flex-row items-center gap-x-2">
          <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />
          <Text className="text-white text-sm flex-1">
            Baseline (Guarantee): <Text className="font-bold">{guarantee}.0 hrs/month</Text>
          </Text>
        </View>

        {extraNeeded > 0 && (
          <View className="flex-row items-center gap-x-2">
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />
            <Text className="text-amber-300 text-sm flex-1">
              Extra Needed: <Text className="font-bold">+{extraNeeded.toFixed(1)} hrs/month</Text>
            </Text>
          </View>
        )}

        {extraNeeded > 0 && (
          <View className="flex-row items-center gap-x-2">
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#a855f7" }} />
            <Text className="text-purple-300 text-sm flex-1">
              If those extra hours are Junior Assignment (JA) (150%): only <Text className="font-bold">+{jaEquivExtra.toFixed(1)} JA-hrs/month</Text>
            </Text>
          </View>
        )}

        <View className="border-t border-slate-700/40 mt-1 pt-2">
          <Text className="text-slate-400 text-xs">
            Total needed: <Text className="text-slate-200 font-semibold">{totalNeeded.toFixed(1)} hrs/month (base equivalent)</Text>
          </Text>
          <Text className="text-slate-500 text-xs mt-0.5">JA hours carry 1.5× pay value.</Text>
        </View>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: Best Lever
// ============================================
function BestLeverCard({ data, hourlyRateCents }: { data: ExtendedPlanResponse["bestLever"]; hourlyRateCents: number }) {
  if (!data) return null;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      <View className="flex-row items-center mb-3">
        <TrendingUp size={18} color="#34d399" />
        <Text className="text-slate-300 text-base font-semibold ml-2">Your Biggest Lever</Text>
      </View>
      <View className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 gap-y-2">
        <Text className="text-slate-200 text-sm leading-5">
          <Text className="text-emerald-300 font-bold">+10 credit hrs/month</Text>
          {" ≈ "}
          <Text className="text-white font-bold">{formatCurrency(data.annualValueOf10ExtraHoursBase)}/year</Text>
          {" at your current rate."}
        </Text>
        <Text className="text-slate-400 text-sm leading-5">
          If those 10 hrs are JA (150%):{" "}
          <Text className="text-purple-300 font-bold">+{formatCurrency(data.annualValueOf10ExtraHoursJA)}/year</Text>.
        </Text>
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: Pay Breakdown
// ============================================
function PayBreakdownCard({ bestScenario }: { bestScenario: CalculateAnnualPlanResponse["scenarios"][0] | null }) {
  if (!bestScenario) return null;
  const { basePay, premiumsContribution, reserveContribution, jaContribution } = bestScenario.projectedAnnualPay;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-4">
        <DollarSign size={18} color="#64748b" />
        <Text className="text-slate-400 text-sm font-semibold ml-2 uppercase tracking-wider">Pay Breakdown</Text>
      </View>
      <View className="gap-y-1">
        <View className="flex-row justify-between items-center py-2">
          <Text className="text-slate-300">Base Pay</Text>
          <Text className="text-white font-semibold">{formatCurrency(basePay)}</Text>
        </View>
        {premiumsContribution > 0 && (
          <View className="flex-row justify-between items-center py-2 border-t border-slate-700/30">
            <Text className="text-slate-300">Premium Capture</Text>
            <Text className="text-blue-400 font-semibold">+{formatCurrency(premiumsContribution)}</Text>
          </View>
        )}
        {reserveContribution > 0 && (
          <View className="flex-row justify-between items-center py-2 border-t border-slate-700/30">
            <Text className="text-slate-300">Reserve Activation</Text>
            <Text className="text-purple-400 font-semibold">+{formatCurrency(reserveContribution)}</Text>
          </View>
        )}
        {jaContribution > 0 && (
          <View className="flex-row justify-between items-center py-2 border-t border-slate-700/30">
            <View>
              <Text className="text-slate-300">JA Pay (150%)</Text>
              <Text className="text-slate-500 text-xs">Junior Available flying</Text>
            </View>
            <Text className="text-amber-400 font-semibold">+{formatCurrency(jaContribution)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: What If? (planning simulator)
// ============================================
function WhatIfCard({
  activeScenario, onScenarioChange, bestScenario, hourlyRateCents,
}: {
  activeScenario: WhatIfScenario;
  onScenarioChange: (s: WhatIfScenario) => void;
  bestScenario: CalculateAnnualPlanResponse["scenarios"][0] | null;
  hourlyRateCents: number;
}) {
  if (!bestScenario) return null;

  const { basePay, premiumsContribution, reserveContribution, jaContribution } = bestScenario.projectedAnnualPay;

  const computeProjection = (scenario: WhatIfScenario): number => {
    switch (scenario) {
      case "GUARANTEE_ONLY":
        return UPS_GUARANTEE_HOURS * 12 * hourlyRateCents;
      case "ALL_OPEN_TIME":
        return basePay + premiumsContribution + reserveContribution;
      case "ALL_JA": {
        const extraBase = premiumsContribution + reserveContribution;
        const jaBoost = extraBase * (JA_MULTIPLIER - 1);
        return basePay + extraBase + jaBoost + jaContribution;
      }
      default:
        return bestScenario.projectedAnnualPay.total;
    }
  };

  const buttons: { key: WhatIfScenario; label: string; desc: string }[] = [
    { key: "GUARANTEE_ONLY", label: "Guarantee Only", desc: "75 hrs/month, no extras, no JA" },
    { key: "ALL_OPEN_TIME", label: "All Extra as Open Time", desc: "Extra hours at base rate" },
    { key: "ALL_JA", label: "All Extra as Junior Assignment (150%)", desc: "Extra hours at JA rate" },
  ];

  const projectedIfActive = activeScenario !== "NONE" ? computeProjection(activeScenario) : null;
  const delta = projectedIfActive !== null ? projectedIfActive - bestScenario.projectedAnnualPay.total : 0;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
      <View className="flex-row items-center mb-1">
        <SlidersHorizontal size={18} color="#64748b" />
        <Text className="text-slate-300 text-base font-semibold ml-2">What If?</Text>
      </View>
      <Text className="text-slate-500 text-xs mb-4">Planning simulator — doesn't change your actual pay records.</Text>

      <View className="gap-y-2 mb-4">
        {buttons.map(btn => {
          const isActive = activeScenario === btn.key;
          return (
            <Pressable
              key={btn.key}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onScenarioChange(isActive ? "NONE" : btn.key); }}
              className={`flex-row items-center p-3 rounded-xl border ${isActive ? "bg-amber-500/15 border-amber-500/40" : "bg-slate-700/30 border-slate-600/30"}`}
            >
              <View className="flex-1">
                <Text className={`text-sm font-semibold ${isActive ? "text-amber-300" : "text-slate-300"}`}>{btn.label}</Text>
                <Text className="text-slate-500 text-xs mt-0.5">{btn.desc}</Text>
              </View>
              <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${isActive ? "border-amber-400 bg-amber-400" : "border-slate-500"}`}>
                {isActive && <Check size={10} color="#000" />}
              </View>
            </Pressable>
          );
        })}
      </View>

      {projectedIfActive !== null && (
        <View className="bg-slate-900/60 rounded-xl p-4">
          <Text className="text-slate-400 text-xs mb-2">
            {activeScenario === "GUARANTEE_ONLY" && "With guarantee flying only:"}
            {activeScenario === "ALL_OPEN_TIME" && "All extra hours at base rate:"}
            {activeScenario === "ALL_JA" && "All extra hours at Junior Assignment (150%):"}
          </Text>
          <View className="flex-row items-baseline gap-x-3">
            <Text className="text-white text-2xl font-bold">{formatCurrency(projectedIfActive)}</Text>
            <Text className={`text-sm font-semibold ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
              ({delta >= 0 ? "+" : ""}{formatCurrency(delta)})
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ============================================
// COMPONENT: Cap Settings Panel
// ============================================
const PERIOD_LABELS: Record<PeriodType, string> = {
  BID_56: "56-Day Bid",
  BID_28: "28-Day Bid",
  PAY_35: "35-Day Pay Period",
};

function CapNumInput({
  label, value, onChange, hint,
}: {
  label: string; value: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <View className="mb-3">
      <Text className="text-slate-400 text-xs mb-1">{label}</Text>
      <View className="flex-row items-center bg-slate-900/60 rounded-lg border border-slate-700/50 px-3 py-2">
        <TextInput
          className="flex-1 text-white text-sm"
          keyboardType="decimal-pad"
          value={value > 0 ? String(value) : ""}
          placeholder="0"
          placeholderTextColor="#475569"
          onChangeText={(t) => {
            const n = parseFloat(t);
            onChange(isNaN(n) ? 0 : n);
          }}
          style={{ color: "#fff" }}
        />
        <Text className="text-slate-500 text-xs ml-2">hrs</Text>
      </View>
      {hint ? <Text className="text-slate-600 text-xs mt-0.5">{hint}</Text> : null}
    </View>
  );
}

// ============================================
// COMPONENT: ContractLimitsDetailsPanel
// (formerly CapSettingsPanel — renamed and updated)
// ============================================
function ContractLimitsDetailsPanel({
  prefs, onChange, capResult,
}: {
  prefs: CreditCapPreferences;
  onChange: (p: CreditCapPreferences) => void;
  capResult: CreditCapResult | null | undefined;
}) {
  const [showExclusions, setShowExclusions] = useState(false);
  const [showExceptions, setShowExceptions] = useState(false);
  const [showFullBreakdown, setShowFullBreakdown] = useState(false);

  function update(partial: Partial<CreditCapPreferences>) {
    onChange({ ...prefs, ...partial });
  }

  const limits = getPeriodLimits(prefs.periodType);

  return (
    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-700/40">
        <View className="flex-row items-center">
          <ShieldAlert size={16} color="#f59e0b" />
          <Text className="text-white text-base font-semibold ml-2">Contract Limits Details</Text>
        </View>
        <Text className="text-slate-500 text-xs mt-1 leading-4">
          These are contract guardrails. The app automatically limits Open Time and Junior Assignment to stay within contract rules. Use these settings only if you want to review or override assumptions.
        </Text>
      </View>

      <View className="p-5 gap-y-4">
        {/* Trimmed breakdown — key metrics */}
        {capResult && (
          <View className="bg-slate-900/40 rounded-xl p-4 gap-y-2">
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-400 text-xs">Awarded line projection</Text>
              <Text className="text-slate-200 text-xs font-semibold">
                {prefs.awardedLineCredit > 0 ? `${formatDecimalToHHMM(capResult.awardedLineCredit)} hrs` : "—"}
              </Text>
            </View>
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-400 text-xs">Open Time pickup limit</Text>
              <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(capResult.openTimeGateCap)} hrs</Text>
            </View>
            <View className="flex-row justify-between items-center">
              <Text className="text-slate-400 text-xs">Max Open Time allowed</Text>
              <Text className="text-amber-300 text-xs font-bold">{formatDecimalToHHMM(capResult.maxOpenTimeAllowed)} hrs</Text>
            </View>

            {/* Full breakdown toggle */}
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowFullBreakdown(v => !v); }}
              className="flex-row items-center pt-2 mt-1 border-t border-slate-700/40"
            >
              <Text className="text-amber-400 text-xs font-semibold flex-1">Show full contract breakdown</Text>
              {showFullBreakdown ? <ChevronUp size={14} color="#f59e0b" /> : <ChevronDown size={14} color="#f59e0b" />}
            </Pressable>

            {showFullBreakdown && (
              <View className="gap-y-2 pt-1">
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-400 text-xs">Absolute credit cap</Text>
                  <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(capResult.absoluteCap)} hrs</Text>
                </View>
                {capResult.effectiveAbsoluteCap !== capResult.absoluteCap && (
                  <View className="flex-row justify-between items-center">
                    <Text className="text-slate-400 text-xs">Effective cap (+ vacation relief)</Text>
                    <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(capResult.effectiveAbsoluteCap)} hrs</Text>
                  </View>
                )}
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-400 text-xs">Open Time requested</Text>
                  <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(capResult.plannedOpenTimeCreditRequested)} hrs</Text>
                </View>
                {capResult.plannedOpenTimeCreditClamped !== capResult.plannedOpenTimeCreditRequested && (
                  <View className="flex-row justify-between items-center">
                    <Text className="text-slate-400 text-xs">Open Time (capped at)</Text>
                    <Text className="text-amber-300 text-xs font-semibold">{formatDecimalToHHMM(capResult.plannedOpenTimeCreditClamped)} hrs</Text>
                  </View>
                )}
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-400 text-xs">Cap-counting credit</Text>
                  <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(capResult.capCountingCredit)} hrs</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-400 text-xs">Remaining credit room</Text>
                  <Text className="text-slate-200 text-xs font-semibold">{formatDecimalToHHMM(Math.max(0, capResult.effectiveAbsoluteCap - capResult.capCountingCredit))} hrs</Text>
                </View>
                {capResult.overCapBy > 0 && (
                  <View className="flex-row justify-between items-center">
                    <Text className="text-slate-400 text-xs">Over cap by</Text>
                    <Text className="text-red-400 text-xs font-bold">{formatDecimalToHHMM(capResult.overCapBy)} hrs</Text>
                  </View>
                )}
                {capResult.warnings.length > 0 && (
                  <View className="mt-1 pt-2 border-t border-slate-700/40 gap-y-1">
                    {capResult.warnings.map((w, i) => (
                      <Text key={i} className="text-slate-500 text-xs leading-4">• {w}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Period type */}
        <View>
          <Text className="text-slate-400 text-xs mb-2 uppercase tracking-wider font-semibold">Period Type</Text>
          <View className="flex-row gap-x-2">
            {(["BID_56", "BID_28", "PAY_35"] as PeriodType[]).map((pt) => (
              <Pressable
                key={pt}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); update({ periodType: pt }); }}
                className={`flex-1 py-2 rounded-lg items-center border ${prefs.periodType === pt ? "bg-amber-500/20 border-amber-500/50" : "bg-slate-700/30 border-slate-600/30"}`}
              >
                <Text className={`text-xs font-semibold ${prefs.periodType === pt ? "text-amber-300" : "text-slate-400"}`}>
                  {pt === "BID_56" ? "56-Day" : pt === "BID_28" ? "28-Day" : "35-Day"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-slate-600 text-xs mt-1.5">
            Absolute cap: {limits.absoluteCap} hrs · Open Time pickup limit: {limits.openTimeGateCap} hrs
          </Text>
        </View>

        {/* RDG toggle */}
        <View>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <Text className="text-slate-300 text-sm font-semibold">RDG Line</Text>
              <Text className="text-slate-500 text-xs">Reduced Guarantee — stricter Open Time limits apply</Text>
            </View>
            <Switch
              value={prefs.isRDGLine}
              onValueChange={(v) => update({ isRDGLine: v })}
              trackColor={{ false: "#374151", true: "rgba(245,158,11,0.5)" }}
              thumbColor={prefs.isRDGLine ? "#f59e0b" : "#9ca3af"}
            />
          </View>
          {prefs.isRDGLine && (
            <View className="flex-row gap-x-2 mt-2">
              {(["DOMESTIC", "INTERNATIONAL"] as AssignmentType[]).map((at) => (
                <Pressable
                  key={at}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); update({ assignmentType: at }); }}
                  className={`flex-1 py-2 rounded-lg items-center border ${prefs.assignmentType === at ? "bg-sky-500/20 border-sky-500/50" : "bg-slate-700/30 border-slate-600/30"}`}
                >
                  <Text className={`text-xs font-semibold ${prefs.assignmentType === at ? "text-sky-300" : "text-slate-400"}`}>{at === "DOMESTIC" ? "Domestic (+5)" : "International (+7)"}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Exclusions accordion */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowExclusions(v => !v); }}
          className="flex-row items-center py-2"
        >
          <View className="flex-1">
            <Text className="text-slate-300 text-sm font-semibold">Exclusions</Text>
            <Text className="text-slate-500 text-xs mt-0.5">Credits that do not count toward contract caps.</Text>
          </View>
          {showExclusions ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
        </Pressable>
        {showExclusions && (
          <View className="bg-slate-900/40 rounded-xl p-4 gap-y-0.5 -mt-1">
            <Text className="text-slate-500 text-xs mb-3 leading-4">These credit hours do NOT consume cap room but DO contribute to pay.</Text>
            <CapNumInput label="Vacation Credit" value={prefs.exclusionsDefaults.vacationCredit ?? 0} onChange={(v) => update({ exclusionsDefaults: { ...prefs.exclusionsDefaults, vacationCredit: v } })} />
            <CapNumInput label="Short-Term Training" value={prefs.exclusionsDefaults.shortTermTrainingCredit ?? 0} onChange={(v) => update({ exclusionsDefaults: { ...prefs.exclusionsDefaults, shortTermTrainingCredit: v } })} />
            <CapNumInput label="Junior Manning" value={prefs.exclusionsDefaults.juniorManningCredit ?? 0} onChange={(v) => update({ exclusionsDefaults: { ...prefs.exclusionsDefaults, juniorManningCredit: v } })} />
            <CapNumInput label="CRAF Activation" value={prefs.exclusionsDefaults.crafActivationCredit ?? 0} onChange={(v) => update({ exclusionsDefaults: { ...prefs.exclusionsDefaults, crafActivationCredit: v } })} />
            <CapNumInput label="Sick Leave" value={prefs.exclusionsDefaults.sickLeaveCredit ?? 0} onChange={(v) => update({ exclusionsDefaults: { ...prefs.exclusionsDefaults, sickLeaveCredit: v } })} />
          </View>
        )}

        {/* Exceptions accordion */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowExceptions(v => !v); }}
          className="flex-row items-center py-2"
        >
          <View className="flex-1">
            <Text className="text-slate-300 text-sm font-semibold">Exceptions</Text>
            <Text className="text-slate-500 text-xs mt-0.5">Rare scenarios where contract caps may be exceeded.</Text>
          </View>
          {showExceptions ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
        </Pressable>
        {showExceptions && (
          <View className="bg-slate-900/40 rounded-xl p-4 gap-y-3 -mt-1">
            {/* Trip completion */}
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <Text className="text-slate-300 text-sm font-semibold">Trip Completion Overage</Text>
                <Text className="text-slate-500 text-xs">Trip already departed domicile — cap may be exceeded</Text>
              </View>
              <Switch
                value={prefs.allowTripCompletionOvercap}
                onValueChange={(v) => update({ allowTripCompletionOvercap: v })}
                trackColor={{ false: "#374151", true: "rgba(245,158,11,0.5)" }}
                thumbColor={prefs.allowTripCompletionOvercap ? "#f59e0b" : "#9ca3af"}
              />
            </View>
            {prefs.allowTripCompletionOvercap && (
              <CapNumInput label="Unavoidable Trip Completion Credit (hrs)" value={prefs.tripCompletionCreditOvercap} onChange={(v) => update({ tripCompletionCreditOvercap: v })} />
            )}

            {/* Vacation drop cap relief */}
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <Text className="text-slate-300 text-sm font-semibold">Vacation Drop Cap Relief</Text>
                <Text className="text-slate-500 text-xs">Cap increases by credit of trips dropped for vacation</Text>
              </View>
              <Switch
                value={prefs.enableVacationDropCapRelief}
                onValueChange={(v) => update({ enableVacationDropCapRelief: v })}
                trackColor={{ false: "#374151", true: "rgba(52,211,153,0.5)" }}
                thumbColor={prefs.enableVacationDropCapRelief ? "#34d399" : "#9ca3af"}
              />
            </View>
            {prefs.enableVacationDropCapRelief && (
              <View className="gap-y-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-slate-300 text-sm">Vacation in this period?</Text>
                  <Switch
                    value={prefs.hasVacationInPeriod}
                    onValueChange={(v) => update({ hasVacationInPeriod: v })}
                    trackColor={{ false: "#374151", true: "rgba(52,211,153,0.5)" }}
                    thumbColor={prefs.hasVacationInPeriod ? "#34d399" : "#9ca3af"}
                  />
                </View>
                <CapNumInput label="Dropped Trips Credit (hrs)" value={prefs.droppedTripsCreditForVacation} onChange={(v) => update({ droppedTripsCreditForVacation: v })} />
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================
// COMPONENT: ContractLimitsSummaryCard
// Default collapsed view — compact summary
// ============================================
function ContractLimitsSummaryCard({
  capResult,
  capPrefs,
  scheduleLineCreditHours,
  overrideScheduleCredit,
  setOverrideScheduleCredit,
  manualLineCreditInput,
  setManualLineCreditInput,
  onPrefsChange,
  showDetails,
  setShowDetails,
}: {
  capResult: CreditCapResult | null | undefined;
  capPrefs: CreditCapPreferences;
  scheduleLineCreditHours: number | null;
  overrideScheduleCredit: boolean;
  setOverrideScheduleCredit: (v: boolean) => void;
  manualLineCreditInput: string;
  setManualLineCreditInput: (v: string) => void;
  onPrefsChange: (p: CreditCapPreferences) => void;
  showDetails: boolean;
  setShowDetails: (v: boolean) => void;
}) {
  // Status pill config
  const statusConfig = capResult ? {
    ACHIEVABLE: { label: "Within limits", color: "#22c55e", bg: "rgba(34,197,94,0.15)", border: "rgba(34,197,94,0.40)", icon: ShieldCheck },
    NOT_ACHIEVABLE_WITH_OT: { label: "Limited by Open Time pickup limit", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.40)", icon: TriangleAlert },
    EXCEEDS_CAP_BLOCKED: { label: "Over cap (blocked)", color: "#ef4444", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.40)", icon: XCircle },
    EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION: { label: "Over cap (trip completion exception)", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.40)", icon: AlertTriangle },
  }[capResult.status] : null;

  const StatusIcon = statusConfig?.icon ?? ShieldCheck;

  const periodLabel = capResult ? {
    BID_56: "56-Day Bid",
    BID_28: "28-Day Bid",
    PAY_35: "35-Day Pay",
  }[capResult.periodType] : "—";

  const hasSchedule = scheduleLineCreditHours !== null;
  const lineCredit = capResult?.awardedLineCredit ?? 0;
  const maxOT = capResult?.maxOpenTimeAllowed ?? 0;
  const openTimeGateCap = capResult?.openTimeGateCap ?? 0;

  // NOT_ACHIEVABLE_WITH_OT comparison row
  const showComparisonRow = capResult?.status === "NOT_ACHIEVABLE_WITH_OT";
  const requestedOT = capResult?.plannedOpenTimeCreditRequested ?? 0;
  const clampedOT = capResult?.plannedOpenTimeCreditClamped ?? 0;
  const otShortfall = requestedOT - clampedOT;

  return (
    <View>
      {/* Summary Card */}
      <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
        {/* Card Header */}
        <View className="px-4 pt-4 pb-3">
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center">
              <ShieldAlert size={15} color="#f59e0b" />
              <Text className="text-white text-sm font-bold ml-2">Contract Limits (Auto)</Text>
            </View>
            {/* Status pill */}
            {statusConfig && (
              <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: statusConfig.bg, borderWidth: 1, borderColor: statusConfig.border }}>
                <StatusIcon size={11} color={statusConfig.color} />
                <Text className="text-xs font-semibold ml-1" style={{ color: statusConfig.color }}>{statusConfig.label}</Text>
              </View>
            )}
          </View>
          <Text className="text-slate-500 text-xs leading-4">
            Open Time and Junior Assignment are automatically limited to stay within contract rules.
          </Text>
        </View>

        {/* Awarded Line Credit — Auto or Manual */}
        <View className="mx-4 mb-3 bg-slate-900/50 rounded-xl p-3 border border-slate-700/30">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Awarded Line Projection Credit</Text>
            <View className="flex-row items-center">
              <Text className="text-slate-500 text-xs mr-2">Override</Text>
              <Switch
                value={overrideScheduleCredit}
                onValueChange={(v) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setOverrideScheduleCredit(v);
                  if (!v && hasSchedule) {
                    setManualLineCreditInput("");
                    onPrefsChange({ ...capPrefs, awardedLineCredit: scheduleLineCreditHours! });
                  }
                }}
                trackColor={{ false: "#374151", true: "rgba(245,158,11,0.5)" }}
                thumbColor={overrideScheduleCredit ? "#f59e0b" : "#9ca3af"}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>

          {!overrideScheduleCredit ? (
            <View>
              {hasSchedule ? (
                <>
                  <Text className="text-white text-xl font-bold">{formatDecimalToHHMM(scheduleLineCreditHours!)} hrs</Text>
                  <Text className="text-slate-500 text-xs mt-0.5">Auto from schedule · current bid period</Text>
                </>
              ) : (
                <>
                  <Text className="text-slate-400 text-sm">No schedule uploaded</Text>
                  <Text className="text-slate-600 text-xs mt-0.5">Upload a schedule to auto-populate, or enable Override to enter manually.</Text>
                </>
              )}
            </View>
          ) : (
            <View>
              <View className="flex-row items-center bg-slate-800/60 rounded-lg border border-amber-500/30 px-3 py-2 mt-1">
                <TextInput
                  className="flex-1 text-white text-sm"
                  keyboardType="decimal-pad"
                  value={manualLineCreditInput}
                  placeholder={hasSchedule ? String(scheduleLineCreditHours) : "Enter projected line credit"}
                  placeholderTextColor="#475569"
                  onChangeText={(t) => {
                    setManualLineCreditInput(t);
                    const n = parseFloat(t);
                    if (!isNaN(n)) {
                      onPrefsChange({ ...capPrefs, awardedLineCredit: n });
                    }
                  }}
                  style={{ color: "#fff" }}
                />
                <Text className="text-slate-500 text-xs ml-2">hrs</Text>
              </View>
              <Text className="text-slate-600 text-xs mt-1">Enter your bid line's projected credit for this period.</Text>
            </View>
          )}
        </View>

        {/* Enhanced summary rows */}
        {capResult && (
          <View className="mx-4 mb-3">
            {/* Key numbers grid */}
            <View className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/30 gap-y-2 mb-2">
              {/* Guarantee baseline */}
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Guarantee baseline</Text>
                <Text className="text-slate-200 text-xs font-semibold">
                  {capPrefs.periodType === "BID_56"
                    ? (capPrefs.isRDGLine ? `${CONTRACT.RDG_GUARANTEE_PAY_PERIOD * 2} hrs/bid` : `${CONTRACT.GUARANTEE_56_DAY} hrs/bid`)
                    : (capPrefs.isRDGLine ? `${CONTRACT.RDG_GUARANTEE_PAY_PERIOD} hrs/pay period` : `${CONTRACT.GUARANTEE_28_DAY} hrs/pay period`)}
                </Text>
              </View>
              {/* Construction max */}
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Construction max ({capPrefs.assignmentType === "INTERNATIONAL" ? "Intl" : "Domestic"})</Text>
                <Text className="text-slate-200 text-xs font-semibold">
                  {capPrefs.periodType === "BID_56"
                    ? (capPrefs.assignmentType === "INTERNATIONAL" ? `${CONTRACT.CONSTRUCTION_MAX_56_INTL}` : `${CONTRACT.CONSTRUCTION_MAX_56_DOMESTIC}`)
                    : (capPrefs.assignmentType === "INTERNATIONAL" ? `${CONTRACT.CONSTRUCTION_MAX_28_INTL}` : `${CONTRACT.CONSTRUCTION_MAX_28_DOMESTIC}`)} hrs
                </Text>
              </View>
              {/* Current line projection */}
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Current line projection</Text>
                <Text className="text-slate-200 text-xs font-semibold">
                  {(hasSchedule || capPrefs.awardedLineCredit > 0) ? `${formatDecimalToHHMM(lineCredit)} hrs` : "—"}
                </Text>
              </View>
              {/* Open Time pickup room */}
              <View className="flex-row justify-between items-center border-t border-slate-700/40 pt-2 mt-1">
                <Text className="text-slate-400 text-xs">Open Time pickup room remaining</Text>
                <Text className="text-amber-300 text-xs font-bold">{formatDecimalToHHMM(maxOT)} hrs</Text>
              </View>
              {/* Feasibility status */}
              <View className="flex-row justify-between items-center">
                <Text className="text-slate-400 text-xs">Feasibility status</Text>
                {statusConfig && (
                  <View className="flex-row items-center gap-x-1">
                    <StatusIcon size={11} color={statusConfig.color} />
                    <Text className="text-xs font-semibold" style={{ color: statusConfig.color }}>{statusConfig.label}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* NOT_ACHIEVABLE_WITH_OT comparison */}
            {showComparisonRow && (
              <View className="mt-2 bg-amber-500/8 rounded-xl p-3 border border-amber-500/20">
                <View className="flex-row justify-between mb-1">
                  <Text className="text-slate-400 text-xs">Open Time requested</Text>
                  <Text className="text-amber-300 text-xs font-semibold">{formatDecimalToHHMM(requestedOT)} hrs</Text>
                </View>
                <View className="flex-row justify-between mb-1">
                  <Text className="text-slate-400 text-xs">Allowed by contract</Text>
                  <Text className="text-green-400 text-xs font-semibold">{formatDecimalToHHMM(clampedOT)} hrs</Text>
                </View>
                <View className="flex-row justify-between pt-1 border-t border-amber-500/15">
                  <Text className="text-slate-400 text-xs">Short</Text>
                  <Text className="text-red-400 text-xs font-bold">−{formatDecimalToHHMM(otShortfall)} hrs</Text>
                </View>
                <Text className="text-slate-500 text-xs mt-1.5 leading-4">
                  Requested Open Time may be limited by contract credit caps.
                </Text>
              </View>
            )}

            {/* EXCEEDS_CAP_BLOCKED */}
            {capResult.status === "EXCEEDS_CAP_BLOCKED" && (
              <View className="mt-2 bg-red-500/8 rounded-xl p-3 border border-red-500/20">
                <Text className="text-red-300 text-xs font-semibold">Over contract credit cap</Text>
                <Text className="text-slate-400 text-xs mt-0.5 leading-4">Income planner cannot calculate earnings assuming credit above the absolute cap.</Text>
              </View>
            )}

            {/* EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION */}
            {capResult.status === "EXCEEDS_CAP_ALLOWED_TRIP_COMPLETION" && (
              <View className="mt-2 bg-amber-500/8 rounded-xl p-3 border border-amber-500/20">
                <Text className="text-amber-300 text-xs font-semibold">Cap exceeded due to trip completion.</Text>
                <Text className="text-slate-400 text-xs mt-0.5">No violation — this is a lawful trip completion exception.</Text>
              </View>
            )}
          </View>
        )}

        {/* View Contract Details link */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowDetails(!showDetails); }}
          className="mx-4 mb-4 flex-row items-center"
        >
          <Text className="text-amber-400 text-sm font-semibold">View Contract Details</Text>
          {showDetails ? <ChevronUp size={14} color="#f59e0b" style={{ marginLeft: 4 }} /> : <ChevronDown size={14} color="#f59e0b" style={{ marginLeft: 4 }} />}
        </Pressable>
      </View>

      {/* Contract Limits Details Panel — expands below */}
      {showDetails && (
        <View className="mt-2">
          <ContractLimitsDetailsPanel
            prefs={capPrefs}
            onChange={onPrefsChange}
            capResult={capResult}
          />
        </View>
      )}
    </View>
  );
}

// ============================================
// COMPONENT: Details Drawer
// ============================================
function DetailsDrawer({
  data, hourlyRateCents,
}: {
  data: ExtendedPlanResponse | null;
  hourlyRateCents: number;
}) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <View className="bg-slate-800/40 rounded-2xl border border-slate-700/30 overflow-hidden">
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpen(v => !v); }}
        className="flex-row items-center px-4 py-3"
      >
        <Info size={16} color="#64748b" />
        <Text className="text-slate-400 text-sm ml-2 flex-1">How is this calculated?</Text>
        {open ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
      </Pressable>

      {open && (
        <View className="px-4 pb-4 gap-y-2">
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Hourly rate used</Text>
            <Text className="text-slate-300 text-xs font-semibold">{formatCurrency(hourlyRateCents)}/hr</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">JA multiplier</Text>
            <Text className="text-slate-300 text-xs font-semibold">1.5×</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Baseline used</Text>
            <Text className="text-slate-300 text-xs font-semibold">{data.baseline.dataSource}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Contract guarantee</Text>
            <Text className="text-slate-300 text-xs font-semibold">75 hrs/month</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Bid periods remaining</Text>
            <Text className="text-slate-300 text-xs font-semibold">{data.fromTodayForward?.bidPeriodsRemaining?.toFixed(1) ?? "—"}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Pay periods remaining</Text>
            <Text className="text-slate-300 text-xs font-semibold">{data.fromTodayForward?.payPeriodsRemaining ?? "—"}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-slate-500 text-xs">Months of data</Text>
            <Text className="text-slate-300 text-xs font-semibold">{data.historicalAverages.totalMonthsOfData}</Text>
          </View>
          <Text className="text-slate-600 text-xs mt-2 leading-4">
            This is a personal planning tool. Estimates based on historical data and your inputs. Does not guarantee earnings or enforce contract rules.
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================
// COMPONENT: Save CTA
// ============================================
function SaveCTA({
  targetCents, projectedPayCents, scenarioType, feasibilityRating, settings, onSave, isSaving, isSaved,
}: {
  targetCents: number; projectedPayCents: number; scenarioType: ScenarioType; feasibilityRating: FeasibilityRating;
  settings: any; onSave: () => void; isSaving: boolean; isSaved: boolean;
}) {
  const yr = new Date().getFullYear();
  return (
    <View className="rounded-2xl p-4 border border-amber-500/30" style={{ backgroundColor: "rgba(245,158,11,0.07)" }}>
      <Pressable
        onPress={() => { if (!isSaving && !isSaved) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSave(); } }}
        disabled={isSaving || isSaved}
        className={`flex-row items-center justify-center py-3.5 px-6 rounded-xl ${isSaved ? "bg-green-500/20 border border-green-500/40" : "bg-amber-500 active:bg-amber-600"}`}
      >
        {isSaving ? <ActivityIndicator size="small" color="#fff" /> :
         isSaved ? <><Check size={20} color="#22c55e" /><Text className="text-green-400 font-semibold text-base ml-2">Saved as {yr} Target</Text></> :
         <><Save size={20} color="#fff" /><Text className="text-white font-semibold text-base ml-2">Set as My {yr} Target</Text></>}
      </Pressable>
      {!isSaved && <Text className="text-slate-400 text-xs text-center mt-2">Save to track progress on your dashboard</Text>}
      {isSaved && <Text className="text-green-400/70 text-xs text-center mt-2">Tracking against this plan on your dashboard</Text>}
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================
export default function AnnualPayPlannerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const { TutorialModalComponent } = useAutoTutorial("annual_pay_planner");
  const updateProfileMutation = useUpdateProfileMutation();

  const [targetCents, setTargetCents] = useState(DEFAULT_TARGET_CENTS);
  const [whatIfScenario, setWhatIfScenario] = useState<WhatIfScenario>("NONE");
  const [isSaved, setIsSaved] = useState(false);
  const [useRollingBaseline, setUseRollingBaseline] = useState(false);
  const [jaSharePct, setJaSharePct] = useState(50);
  const [showContractDetails, setShowContractDetails] = useState(false);
  const [overrideScheduleCredit, setOverrideScheduleCredit] = useState(false);
  const [manualLineCreditInput, setManualLineCreditInput] = useState("");

  // Credit Cap state — initialized from profile on load
  const [capPrefs, setCapPrefs] = useState<CreditCapPreferences>(DEFAULT_CREDIT_CAP_PREFERENCES);
  const [capPrefsLoaded, setCapPrefsLoaded] = useState(false);

  const calculateMutation = useCalculateAnnualPlan();
  const { projectedAnnualCents, isLoading: isSharedProjectedAnnualLoading } = useSharedProjectedAnnual();
  const saveMutation = useSaveScenario();
  const upsertYearPlan = useUpsertYearPlan();
  const { data: activeYearPlanData } = useActiveYearPlan();

  const hourlyRateCents = profile?.hourlyRateCents ?? 32500;

  // Load cap prefs from profile once
  useEffect(() => {
    if (profile && !capPrefsLoaded) {
      setCapPrefsLoaded(true);
      setCapPrefs({
        periodType: (profile.creditCapPeriodType as PeriodType) ?? "BID_56",
        awardedLineCredit: profile.creditCapAwardedLineCredit ?? 0,
        isRDGLine: profile.creditCapIsRDGLine ?? false,
        assignmentType: (profile.creditCapAssignmentType as AssignmentType) ?? "DOMESTIC",
        exclusionsDefaults: {
          vacationCredit: profile.creditCapExclusionVacation ?? 0,
          shortTermTrainingCredit: profile.creditCapExclusionTraining ?? 0,
          juniorManningCredit: profile.creditCapExclusionJuniorManning ?? 0,
          crafActivationCredit: profile.creditCapExclusionCRAF ?? 0,
          sickLeaveCredit: profile.creditCapExclusionSick ?? 0,
        },
        allowTripCompletionOvercap: profile.creditCapAllowTripCompletion ?? false,
        tripCompletionCreditOvercap: profile.creditCapTripCompletionOvercap ?? 0,
        enableVacationDropCapRelief: profile.creditCapEnableVacationRelief ?? false,
        droppedTripsCreditForVacation: profile.creditCapDroppedTripsCredit ?? 0,
        hasVacationInPeriod: profile.creditCapHasVacationInPeriod ?? false,
      });
    }
  }, [profile, capPrefsLoaded]);

  // Save cap prefs back to profile (debounced)
  const handleCapPrefsChange = useCallback((newPrefs: CreditCapPreferences) => {
    setCapPrefs(newPrefs);
    // Debounced profile save
    updateProfileMutation.mutate({
      creditCapPeriodType: newPrefs.periodType,
      creditCapAwardedLineCredit: newPrefs.awardedLineCredit,
      creditCapIsRDGLine: newPrefs.isRDGLine,
      creditCapAssignmentType: newPrefs.assignmentType,
      creditCapExclusionVacation: newPrefs.exclusionsDefaults.vacationCredit ?? 0,
      creditCapExclusionTraining: newPrefs.exclusionsDefaults.shortTermTrainingCredit ?? 0,
      creditCapExclusionJuniorManning: newPrefs.exclusionsDefaults.juniorManningCredit ?? 0,
      creditCapExclusionCRAF: newPrefs.exclusionsDefaults.crafActivationCredit ?? 0,
      creditCapExclusionSick: newPrefs.exclusionsDefaults.sickLeaveCredit ?? 0,
      creditCapAllowTripCompletion: newPrefs.allowTripCompletionOvercap,
      creditCapTripCompletionOvercap: newPrefs.tripCompletionCreditOvercap,
      creditCapEnableVacationRelief: newPrefs.enableVacationDropCapRelief,
      creditCapDroppedTripsCredit: newPrefs.droppedTripsCreditForVacation,
      creditCapHasVacationInPeriod: newPrefs.hasVacationInPeriod,
    });
  }, [updateProfileMutation]);

  // Compute cap result locally from prefs for instant UI feedback
  // Always runs — even without an awarded line, the absolute period cap still applies
  const localCapResult: CreditCapResult | null = useMemo(() => {
    const planData = calculateMutation.data as ExtendedPlanResponse | undefined;
    const reqBidBase = planData?.fromTodayForward?.requiredCreditHoursPerBidPeriodBase ?? 0;

    if (capPrefs.awardedLineCredit > 0) {
      // Full evaluation: awarded line is known — compute real OT needed
      const requestedOT = Math.max(0, reqBidBase - capPrefs.awardedLineCredit);
      const inputs = buildCapInputsFromPrefs(capPrefs, requestedOT);
      return evaluateCreditedTimeStatus(inputs);
    } else if (reqBidBase > 0) {
      // No awarded line entered — treat the full reqBidBase as cap-counting credit
      // against the period's absolute cap. This catches over-cap goals.
      const inputs = buildCapInputsFromPrefs(
        { ...capPrefs, awardedLineCredit: reqBidBase },
        0, // no OT planned
      );
      return evaluateCreditedTimeStatus(inputs);
    }
    // No plan data yet — show limits with zero credit so user can see caps
    const inputs = buildCapInputsFromPrefs(
      { ...capPrefs, awardedLineCredit: 0 },
      0,
    );
    return evaluateCreditedTimeStatus(inputs);
  }, [capPrefs, calculateMutation.data]);

  // Fetch trips for schedule-based auto credit
  const currentYear = new Date().getFullYear();
  const { data: tripsData } = useTrips({
    startDate: `${currentYear}-01-01`,
    endDate: `${currentYear}-12-31`,
  });

  // Auto credit from schedule: sum payCreditMinutes for trips within the relevant bid period only
  const scheduleLineCreditHours = useMemo(() => {
    const trips = tripsData?.trips ?? [];
    if (trips.length === 0) return null; // null = no schedule uploaded

    // Determine the relevant bid period (current, or upcoming if within last 3 days of current)
    const relevantPeriod = getRelevantBidPeriod();

    if (relevantPeriod) {
      // Filter trips that start within the relevant bid period
      const periodTrips = trips.filter((t: BackendTrip) => {
        const d = t.startDate ?? '';
        return d >= relevantPeriod.startDate && d <= relevantPeriod.endDate;
      });
      // If no trips in this specific period, fall back to all trips as a last resort
      if (periodTrips.length === 0) {
        const totalMinutes = trips.reduce((sum: number, t: BackendTrip) => sum + (t.payCreditMinutes ?? t.totalCreditMinutes ?? 0), 0);
        return Math.round((totalMinutes / 60) * 10) / 10;
      }
      const totalMinutes = periodTrips.reduce((sum: number, t: BackendTrip) => sum + (t.payCreditMinutes ?? t.totalCreditMinutes ?? 0), 0);
      return Math.round((totalMinutes / 60) * 10) / 10;
    }

    // Fallback: sum all trips if no bid period found
    const totalMinutes = trips.reduce((sum: number, t: BackendTrip) => sum + (t.payCreditMinutes ?? t.totalCreditMinutes ?? 0), 0);
    return Math.round((totalMinutes / 60) * 10) / 10;
  }, [tripsData]);

  // Auto-sync cap prefs from schedule when not overriding
  useEffect(() => {
    if (!overrideScheduleCredit && scheduleLineCreditHours !== null) {
      if (capPrefs.awardedLineCredit !== scheduleLineCreditHours) {
        setCapPrefs(prev => ({ ...prev, awardedLineCredit: scheduleLineCreditHours }));
      }
    }
  }, [scheduleLineCreditHours, overrideScheduleCredit]);

  // Pre-fill target from existing active year plan if available
  useEffect(() => {
    if (activeYearPlanData?.plan && activeYearPlanData.plan.targetAnnualIncomeCents > 0) {
      setTargetCents(activeYearPlanData.plan.targetAnnualIncomeCents);
    }
  }, [activeYearPlanData?.plan?.id]);

  // Auto-calculate on target change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      calculateMutation.mutate({
        targetAnnualIncomeCents: targetCents,
        hourlyRateCents,
        includePremiums: true,
        includeReserveActivation: true,
        includeAverageSickUsage: true,
        includeJA150: true,
        planningMode: "BALANCED",
        periodType: capPrefs.periodType ?? "BID_56",
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [targetCents, hourlyRateCents]);

  // Reset on target change
  useEffect(() => {
    setWhatIfScenario("NONE");
    setIsSaved(false);
  }, [targetCents]);

  const data = calculateMutation.data as ExtendedPlanResponse | undefined;
  const { method, bestScenario } = useMemo(() => getAchievementMethod(data?.scenarios), [data?.scenarios]);

  const handleSave = useCallback(() => {
    if (!bestScenario || !data) return;
    const yr = new Date().getFullYear();

    saveMutation.mutate({
      scenarioName: `${yr} Annual Target`,
      targetAnnualIncomeCents: targetCents,
      scenarioType: bestScenario.scenarioType as ScenarioType,
      settings: {
        includePremiums: data.settingsUsed.includePremiums,
        includeReserveActivation: data.settingsUsed.includeReserveActivation,
        includeAverageSickUsage: data.settingsUsed.includeAverageSickUsage,
        includeJA150: data.settingsUsed.includeJA150,
        planningMode: data.settingsUsed.planningMode,
      },
      projectedAnnualPayCents: bestScenario.projectedAnnualPay.total,
      feasibilityRating: bestScenario.feasibilityRating,
    });

    upsertYearPlan.mutate({
      planYear: yr,
      targetAnnualIncomeCents: targetCents,
      hourlyRateCents,
      monthlyGuaranteeHours: 75,
      jaMultiplier: 1.5,
      includeJA: data.settingsUsed.includeJA150,
      includeOpenTime: true,
      planningMode: (data.settingsUsed.planningMode ?? "BALANCED") as "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE",
    }, {
      onSuccess: () => {
        setIsSaved(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    });

  }, [bestScenario, data, targetCents, saveMutation, upsertYearPlan, hourlyRateCents]);

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient colors={["#0f172a", "#1a2744", "#0f172a"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <Animated.View entering={FadeInDown.duration(500).delay(50)} style={{ paddingTop: insets.top + 12 }} className="px-5">
            <View className="flex-row items-center justify-between mb-4">
              <Pressable onPress={() => router.back()} className="flex-row items-center">
                <ChevronLeft size={20} color="#f59e0b" />
                <Text className="text-amber-500 text-base ml-1">Back</Text>
              </Pressable>
              <HelpButton tutorialId="annual_pay_planner" />
            </View>
            <View className="flex-row items-center mb-0.5">
              <Target size={20} color="#f59e0b" />
              <Text className="text-amber-500 text-sm font-semibold ml-2 uppercase tracking-wider">Income Planner</Text>
            </View>
            <Text className="text-white text-2xl font-bold">Annual Pay Goal</Text>
          </Animated.View>

          {/* 1. Target Selector */}
          <Animated.View entering={FadeInDown.duration(500).delay(100)} className="px-5 mt-5">
            <TargetSelector value={targetCents} onChange={setTargetCents} />
          </Animated.View>

          {/* 1b. Contract Limits (Auto) summary card */}
          <Animated.View entering={FadeInDown.duration(500).delay(120)} className="px-5 mt-3">
            <ContractLimitsSummaryCard
              capResult={localCapResult}
              capPrefs={capPrefs}
              scheduleLineCreditHours={scheduleLineCreditHours}
              overrideScheduleCredit={overrideScheduleCredit}
              setOverrideScheduleCredit={setOverrideScheduleCredit}
              manualLineCreditInput={manualLineCreditInput}
              setManualLineCreditInput={setManualLineCreditInput}
              onPrefsChange={handleCapPrefsChange}
              showDetails={showContractDetails}
              setShowDetails={setShowContractDetails}
            />
          </Animated.View>

          {/* 2. Result Card */}
          <Animated.View entering={FadeInDown.duration(500).delay(150)} className="px-5 mt-4">
            <ResultCard
              method={method}
              bestScenario={bestScenario}
              targetCents={targetCents}
              isLoading={calculateMutation.isPending || isSharedProjectedAnnualLoading}
              projectedAnnualCents={projectedAnnualCents}
            />
          </Animated.View>

          {/* 3. (JA toggle removed — JA share picker is inside BidPeriodPrimaryCard) */}

          {/* 4. Rolling Baseline Toggle */}
          {data && (
            <Animated.View entering={FadeIn.duration(400).delay(40)} className="px-5 mt-2">
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUseRollingBaseline(v => !v); }}
                className={`flex-row items-center justify-center py-2.5 px-5 rounded-xl border ${useRollingBaseline ? "bg-sky-500/15 border-sky-500/35" : "bg-slate-700/40 border-slate-600/40"}`}
              >
                <BarChart3 size={15} color={useRollingBaseline ? "#38bdf8" : "#64748b"} />
                <Text className={`ml-2 text-sm font-semibold ${useRollingBaseline ? "text-sky-300" : "text-slate-400"}`}>
                  {useRollingBaseline ? "Using my actual pace (rolling avg)" : "Use my actual pace (rolling avg)"}
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* 5. NEW: BidPeriodPrimaryCard — PRIMARY hero card */}
          {data?.fromTodayForward && (
            <Animated.View entering={FadeIn.duration(500).delay(60)} className="px-5 mt-4">
              <BidPeriodPrimaryCard
                data={data.fromTodayForward}
                useRollingBaseline={useRollingBaseline}
                jaSharePct={jaSharePct}
                onJaShareChange={setJaSharePct}
                capResult={localCapResult}
                periodType={capPrefs.periodType}
                isRDGLine={capPrefs.isRDGLine}
              />
            </Animated.View>
          )}

          {/* 6. NEW: EquivalentPaceSection — secondary conversions */}
          {data?.fromTodayForward && (
            <Animated.View entering={FadeIn.duration(500).delay(70)} className="px-5 mt-4">
              <EquivalentPaceSection
                data={data.fromTodayForward}
                useRollingBaseline={useRollingBaseline}
                periodType={capPrefs.periodType}
                isRDGLine={capPrefs.isRDGLine}
              />
            </Animated.View>
          )}

          {/* 7. Pace Intensity */}
          {data?.fromTodayForward && (
            <Animated.View entering={FadeIn.duration(500).delay(100)} className="px-5 mt-4">
              <PaceIntensityCard data={data.fromTodayForward} />
            </Animated.View>
          )}

          {/* 8. BidPeriodTargetCard — HIDDEN to avoid duplication with BidPeriodPrimaryCard */}

          {/* 9. What You Need (credit hours) */}
          {data && (
            <Animated.View entering={FadeIn.duration(500).delay(140)} className="px-5 mt-4">
              <WhatYouNeedCard bestScenario={bestScenario} baseline={data.baseline} hourlyRateCents={hourlyRateCents} />
            </Animated.View>
          )}

          {/* 10. Best Lever */}
          {data?.bestLever && (
            <Animated.View entering={FadeIn.duration(500).delay(160)} className="px-5 mt-4">
              <BestLeverCard data={data.bestLever} hourlyRateCents={hourlyRateCents} />
            </Animated.View>
          )}

          {/* 11. Pay Breakdown */}
          {data && (
            <Animated.View entering={FadeIn.duration(500).delay(180)} className="px-5 mt-4">
              <PayBreakdownCard bestScenario={bestScenario} />
            </Animated.View>
          )}

          {/* 12. What If? */}
          {data && bestScenario && (
            <Animated.View entering={FadeIn.duration(500).delay(200)} className="px-5 mt-4">
              <WhatIfCard
                activeScenario={whatIfScenario}
                onScenarioChange={setWhatIfScenario}
                bestScenario={bestScenario}
                hourlyRateCents={hourlyRateCents}
              />
            </Animated.View>
          )}

          {/* 13. Save CTA */}
          {data && bestScenario && (
            <Animated.View entering={FadeIn.duration(500).delay(220)} className="px-5 mt-6">
              <SaveCTA
                targetCents={targetCents}
                projectedPayCents={bestScenario.projectedAnnualPay.total}
                scenarioType={bestScenario.scenarioType as ScenarioType}
                feasibilityRating={bestScenario.feasibilityRating}
                settings={data.settingsUsed}
                onSave={handleSave}
                isSaving={saveMutation.isPending || upsertYearPlan.isPending}
                isSaved={isSaved}
              />
            </Animated.View>
          )}

          {/* 14. Details Drawer */}
          {data && (
            <Animated.View entering={FadeIn.duration(500).delay(240)} className="px-5 mt-4">
              <DetailsDrawer data={data} hourlyRateCents={hourlyRateCents} />
            </Animated.View>
          )}

          {/* 15. Legal Disclaimer */}
          <Animated.View entering={FadeIn.duration(500).delay(260)} className="px-5 mt-4">
            <View className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/20">
              <Text className="text-slate-500 text-xs text-center leading-4">
                Planning tools are estimates based on historical data and user inputs. They do not guarantee earnings, enforce contract rules, or provide legal advice.
              </Text>
            </View>
          </Animated.View>

        </ScrollView>
      </LinearGradient>
      {TutorialModalComponent}
    </View>
  );
}
