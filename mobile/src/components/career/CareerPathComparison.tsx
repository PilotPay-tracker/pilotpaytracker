/**
 * CareerPathComparison — v1
 *
 * Neutral, fact-based FO vs Captain scenario model.
 * Replaces the old "Career Path Impact" toggle + Plan B chart.
 *
 * Features:
 *  1. 3-scenario selector: Stay FO / Upgrade Now / Upgrade Later
 *  2. Upgrade timing control (year-based, only for "Upgrade Later")
 *  3. Side-by-side comparison cards (career earnings + retirement)
 *  4. Difference strip (neutral: "Difference", "Opportunity Cost")
 *  5. Break-even calculation: first year upgrade cumulative >= FO cumulative
 *  6. Opportunity cost line
 *  7. Senior FO / premium pay reality-check collapsible
 *  8. Earnings Basis control (inline)
 *  9. Retirement Asset Projection chart (FO vs Upgrade, CPT marker)
 * 10. Assumptions modal / "i" icon
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  Dimensions,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import {
  Plane,
  Info,
  ChevronDown,
  ChevronUp,
  X,
  TrendingUp,
  AlertCircle,
  Calendar,
  DollarSign,
  ArrowRight,
  Calculator,
  BarChart3,
  Target,
} from "lucide-react-native";
import Svg, { Polyline, Line, Circle, Text as SvgText } from "react-native-svg";

import {
  computeRetirementForecast,
  computeDualScenarioForecast,
  getPayTableAnnualComp,
  DEFAULT_UPGRADE_YEARS_FROM_DOH,
  UPS_CONTRACT_RULES,
  CBA_RULESET_VERSION,
  type RetirementProfile,
  type DualScenarioForecast,
  type EarningsBasis,
  type RetirementForecast,
} from "@/lib/state/retirement-store";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_WIDTH = SCREEN_WIDTH - 48;
const GRAPH_HEIGHT = 150;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ComparisonScenario = "STAY_FO" | "UPGRADE_NOW" | "UPGRADE_LATER";

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtM(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (Math.abs(d) >= 1_000) return `$${Math.round(d / 1_000)}K`;
  return `$${Math.round(d).toLocaleString()}`;
}

function fmtDollarsLong(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function fmtMonthly(annualCents: number): string {
  return fmtDollarsLong(Math.round(annualCents / 12));
}

function signPrefix(n: number): string {
  return n >= 0 ? "+" : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAK-EVEN CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

interface BreakEvenResult {
  breakEvenYear: number | null;
  breakEvenCalendarYear: number | null;
  yearsFromNow: number | null;
  notApplicable: boolean;
  notApplicableReason: string | null;
}

/**
 * Find the first year where cumulative upgrade earnings >= cumulative FO earnings.
 * Both are measured from currentYear forward (i.e., opportunity cost from now).
 * Uses yearlyProjections from each forecast.
 */
function computeBreakEven(
  foForecast: RetirementForecast,
  upgradeForecast: RetirementForecast,
  upgradeAfterRetirement: boolean
): BreakEvenResult {
  if (upgradeAfterRetirement) {
    return {
      breakEvenYear: null,
      breakEvenCalendarYear: null,
      yearsFromNow: null,
      notApplicable: true,
      notApplicableReason: "Upgrade would occur after retirement under this scenario.",
    };
  }

  const foProj = foForecast.yearlyProjections;
  const upProj = upgradeForecast.yearlyProjections;

  if (foProj.length === 0 || upProj.length === 0) {
    return {
      breakEvenYear: null,
      breakEvenCalendarYear: null,
      yearsFromNow: null,
      notApplicable: true,
      notApplicableReason: "Insufficient data to compute break-even.",
    };
  }

  const currentYear = foProj[0]?.year ?? new Date().getFullYear();
  let foCumulative = 0;
  let upCumulative = 0;

  for (let i = 0; i < Math.max(foProj.length, upProj.length); i++) {
    const foEntry = foProj[i];
    const upEntry = upProj[i];
    if (!foEntry && !upEntry) break;
    foCumulative += foEntry?.estimatedAnnualIncomeCents ?? 0;
    upCumulative += upEntry?.estimatedAnnualIncomeCents ?? 0;
    if (upCumulative >= foCumulative && i > 0) {
      const calYear = foEntry?.year ?? currentYear + i;
      return {
        breakEvenYear: i + 1,
        breakEvenCalendarYear: calYear,
        yearsFromNow: i,
        notApplicable: false,
        notApplicableReason: null,
      };
    }
  }

  // Upgrade never breaks even over the career window
  return {
    breakEvenYear: null,
    breakEvenCalendarYear: null,
    yearsFromNow: null,
    notApplicable: false,
    notApplicableReason: "Upgrade does not break even within career window under this scenario.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFETIME CAREER EARNINGS (sum of yearlyProjections)
// ─────────────────────────────────────────────────────────────────────────────

function sumCareerEarnings(forecast: RetirementForecast): number {
  return forecast.yearlyProjections.reduce(
    (acc, p) => acc + p.estimatedAnnualIncomeCents,
    0
  );
}

function avgAnnualEarnings(forecast: RetirementForecast): number {
  const proj = forecast.yearlyProjections;
  if (proj.length === 0) return 0;
  return Math.round(sumCareerEarnings(forecast) / proj.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSUMPTIONS MODAL
// ─────────────────────────────────────────────────────────────────────────────

function AssumptionsInfoModal({
  visible,
  onClose,
  profile,
  upgradeTiming,
  scenario,
  taxPct,
}: {
  visible: boolean;
  onClose: () => void;
  profile: RetirementProfile;
  upgradeTiming: string;
  scenario: ComparisonScenario;
  taxPct: number;
}) {
  const basisLabels: Record<EarningsBasis, string> = {
    GUAR: "Guarantee (975 hrs/yr)",
    LINE: "Avg Line (~1,018 hrs/yr)",
    TOTAL: "Avg Total (with OT + premiums)",
  };
  const scenarioLabels: Record<ComparisonScenario, string> = {
    STAY_FO: "Stay FO (no upgrade)",
    UPGRADE_NOW: "Upgrade Now",
    UPGRADE_LATER: `Upgrade Later (${upgradeTiming})`,
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
          <View className="flex-row items-center gap-2">
            <Info size={18} color="#38bdf8" />
            <Text className="text-white text-lg font-bold">Scenario Assumptions</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 items-center justify-center">
            <X size={20} color="#94a3b8" />
          </Pressable>
        </View>
        <ScrollView className="flex-1 px-6 pt-5" contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="gap-4">
            {[
              {
                label: "Scenario",
                value: scenarioLabels[scenario],
                note: "Determines which seat (FO or CPT) is used for each projection year.",
              },
              {
                label: "Earnings Basis",
                value: basisLabels[profile.earningsBasis],
                note: "Guarantee uses 975 hrs/yr contract minimum. Line adds average bid-line hours. Total includes OT and premium pay. Adjust to match your actual strategy.",
              },
              {
                label: "Upgrade Timing",
                value: scenario === "STAY_FO" ? "N/A (Stay FO)" : upgradeTiming,
                note: "The calendar year when the pilot transitions from FO to Captain pay scale.",
              },
              {
                label: "Plan B Growth Rate",
                value: `${profile.planBGrowthRatePct ?? 5}% per year`,
                note: "Annual return assumption for the DC (Plan B / MPP) account balance. Change in Edit Assumptions.",
              },
              {
                label: "Safe Withdrawal Rate",
                value: `${profile.safeWithdrawalRatePct ?? 4}% per year`,
                note: "Annual income drawn from the Plan B balance at retirement. Default 4%.",
              },
              {
                label: "Tax Estimate",
                value: `${taxPct}% effective rate`,
                note: "Applied to gross retirement income for net monthly estimates. Actual tax depends on your situation.",
              },
              {
                label: "Retirement Age",
                value: `Age ${profile.retirementAge}`,
                note: "Career earnings are projected from today through this retirement age.",
              },
              {
                label: "Contract Ruleset",
                value: CBA_RULESET_VERSION,
                note: "All calculations use official UPS pay tables from CBA 2023–2028.",
              },
            ].map(({ label, value, note }, i) => (
              <View key={i} className="rounded-2xl p-4 border border-slate-700/30" style={{ backgroundColor: "#131f35" }}>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider">{label}</Text>
                  <Text className="text-white text-sm font-semibold">{value}</Text>
                </View>
                <Text className="text-slate-500 text-xs leading-4">{note}</Text>
              </View>
            ))}

            <View className="rounded-2xl p-4 mt-2" style={{ backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: "#f59e0b30" }}>
              <View className="flex-row items-center gap-2 mb-2">
                <AlertCircle size={13} color="#f59e0b" />
                <Text className="text-amber-400 text-xs font-bold">Disclaimer</Text>
              </View>
              <Text className="text-slate-400 text-xs leading-4">
                Estimates only. Actual outcomes depend on bids, premium pay, contract changes, seniority, and individual circumstances. Not financial, legal, or HR advice. Verify with UPS HR and IPA.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function ScenarioSelector({
  selected,
  onSelect,
}: {
  selected: ComparisonScenario;
  onSelect: (s: ComparisonScenario) => void;
}) {
  const options: { key: ComparisonScenario; label: string; short: string }[] = [
    { key: "STAY_FO", label: "Stay FO", short: "FO" },
    { key: "UPGRADE_NOW", label: "Upgrade Now", short: "Now" },
    { key: "UPGRADE_LATER", label: "Upgrade Later", short: "Later" },
  ];

  return (
    <View className="flex-row rounded-2xl p-1" style={{ backgroundColor: "#1a2540" }}>
      {options.map((opt) => {
        const active = selected === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => { onSelect(opt.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={{ flex: 1 }}
          >
            <LinearGradient
              colors={active
                ? opt.key === "STAY_FO" ? ["#0ea5e9", "#0284c7"] : ["#f59e0b", "#d97706"]
                : ["transparent", "transparent"]}
              style={{ borderRadius: 14, paddingVertical: 10, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{
                fontSize: 12,
                fontWeight: "700",
                color: active ? (opt.key === "STAY_FO" ? "#fff" : "#1a1a1a") : "#64748b",
              }}>
                {opt.label}
              </Text>
            </LinearGradient>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE TIMING PICKER
// ─────────────────────────────────────────────────────────────────────────────

function UpgradeTimingPicker({
  dohYear,
  currentYear,
  upgradeYear,
  onChangeYear,
}: {
  dohYear: number;
  currentYear: number;
  upgradeYear: number;
  onChangeYear: (y: number) => void;
}) {
  // Offer relative offsets: +3, +5, +7, +10 years from now
  const options = [3, 5, 7, 10].map((offset) => currentYear + offset);
  const isCustom = !options.includes(upgradeYear);

  return (
    <Animated.View entering={FadeIn.duration(200)} className="mt-3">
      <View className="flex-row items-center gap-2 mb-2">
        <Calendar size={12} color="#94a3b8" />
        <Text className="text-slate-400 text-xs font-semibold">Upgrade Timing — Year</Text>
        <View className="flex-row items-center gap-1 ml-auto">
          <Info size={10} color="#475569" />
          <Text className="text-slate-600 text-xs">Calendar year of upgrade</Text>
        </View>
      </View>
      <View className="flex-row gap-2">
        {options.map((yr) => {
          const active = upgradeYear === yr;
          const yearsFromNow = yr - currentYear;
          return (
            <Pressable
              key={yr}
              onPress={() => { onChangeYear(yr); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={{ flex: 1 }}
              className={`py-2.5 rounded-xl items-center border ${
                active ? "border-amber-500" : "border-slate-700"
              }`}
              {...(active ? {} : {})}
            >
              <LinearGradient
                colors={active ? ["#f59e0b30", "#d97706200"] : ["transparent", "transparent"]}
                style={{ position: "absolute", inset: 0, borderRadius: 12 }}
              />
              <Text style={{ color: active ? "#f59e0b" : "#64748b", fontSize: 13, fontWeight: "700" }}>{yr}</Text>
              <Text style={{ color: active ? "#92400e" : "#334155", fontSize: 10, marginTop: 1 }}>+{yearsFromNow}yr</Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS BASIS CONTROL (inline, compact)
// ─────────────────────────────────────────────────────────────────────────────

function EarningsBasisControl({
  value,
  onChange,
}: {
  value: EarningsBasis;
  onChange: (b: EarningsBasis) => void;
}) {
  const options: { key: EarningsBasis; label: string; sub: string }[] = [
    { key: "GUAR", label: "Guarantee", sub: "975 hrs" },
    { key: "LINE", label: "Avg Line", sub: "~1,018 hrs" },
    { key: "TOTAL", label: "Avg Total", sub: "w/ OT" },
  ];
  return (
    <View className="mt-3">
      <View className="flex-row items-center gap-1.5 mb-2">
        <DollarSign size={12} color="#94a3b8" />
        <Text className="text-slate-400 text-xs font-semibold">Earnings Basis</Text>
        <View className="bg-slate-700/40 rounded-full px-2 py-0.5 ml-auto">
          <Text className="text-slate-500 text-xs">Affects all projections</Text>
        </View>
      </View>
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => { onChange(opt.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={{ flex: 1 }}
              className={`py-2.5 rounded-xl items-center border ${active ? "border-sky-500" : "border-slate-700"}`}
            >
              <Text style={{ color: active ? "#38bdf8" : "#64748b", fontSize: 12, fontWeight: "700" }}>{opt.label}</Text>
              <Text style={{ color: active ? "#0c4a6e" : "#1e293b", fontSize: 10 }}>{opt.sub}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARISON CARDS
// ─────────────────────────────────────────────────────────────────────────────

function ComparisonCards({
  foForecast,
  upgradeForecast,
  upgradeLabel,
  taxPct,
  upgradeAfterRetirement,
}: {
  foForecast: RetirementForecast;
  upgradeForecast: RetirementForecast;
  upgradeLabel: string;
  taxPct: number;
  upgradeAfterRetirement: boolean;
}) {
  const foCareer = sumCareerEarnings(foForecast);
  const upCareer = sumCareerEarnings(upgradeForecast);
  const foAvgAnnual = avgAnnualEarnings(foForecast);
  const upAvgAnnual = avgAnnualEarnings(upgradeForecast);

  const foRetireAssets = foForecast.projectedPlanBBalanceCents;
  const upRetireAssets = upgradeForecast.projectedPlanBBalanceCents;

  const foRetireMonthlyGross = Math.round(foForecast.projectedTotalAnnualRetirementIncomeCents / 12);
  const upRetireMonthlyGross = Math.round(upgradeForecast.projectedTotalAnnualRetirementIncomeCents / 12);
  const foRetireMonthlyNet = Math.round(foRetireMonthlyGross * (1 - taxPct / 100));
  const upRetireMonthlyNet = Math.round(upRetireMonthlyGross * (1 - taxPct / 100));

  const diffCareer = upCareer - foCareer;
  const diffAssets = upRetireAssets - foRetireAssets;
  const diffMonthly = upRetireMonthlyNet - foRetireMonthlyNet;

  return (
    <Animated.View entering={FadeInDown.delay(60).springify()}>
      {/* Cards row */}
      <View className="flex-row gap-3">
        {/* FO Card */}
        <View className="flex-1 rounded-2xl overflow-hidden border border-sky-500/20" style={{ backgroundColor: "#0c1a30" }}>
          <LinearGradient colors={["#0ea5e920", "transparent"]} style={{ padding: 14 }}>
            <View className="flex-row items-center gap-1.5 mb-3">
              <View className="w-2 h-2 rounded-full bg-sky-400" />
              <Text className="text-sky-400 text-xs font-bold uppercase tracking-wider">Scenario A</Text>
            </View>
            <Text className="text-white text-sm font-bold mb-3" numberOfLines={1}>Stay FO</Text>
            <MetricRow label="Est. Avg Annual" value={fmtM(foAvgAnnual)} accent="#38bdf8" sub="Gross" />
            <MetricRow label="Lifetime Earnings" value={fmtM(foCareer)} accent="#38bdf8" sub="Gross total" />
            <MetricRow label="Retirement Assets" value={fmtM(foRetireAssets)} accent="#38bdf8" sub="Plan B at ret." />
            <View className="mt-2 pt-2 border-t border-sky-500/10">
              <MetricRow label="Retirement Income" value={`${fmtM(foRetireMonthlyNet * 12)}/yr`} accent="#22c55e" sub={`Est. Net · ${fmtDollarsLong(foRetireMonthlyNet)}/mo`} />
            </View>
          </LinearGradient>
        </View>

        {/* Upgrade Card */}
        <View
          className="flex-1 rounded-2xl overflow-hidden border"
          style={{
            backgroundColor: upgradeAfterRetirement ? "#1a1510" : "#1a1a0a",
            borderColor: upgradeAfterRetirement ? "#78350f40" : "#f59e0b30",
          }}
        >
          <LinearGradient
            colors={upgradeAfterRetirement ? ["#78350f15", "transparent"] : ["#f59e0b20", "transparent"]}
            style={{ padding: 14 }}
          >
            <View className="flex-row items-center gap-1.5 mb-3">
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: upgradeAfterRetirement ? "#78350f" : "#f59e0b" }} />
              <Text style={{ color: upgradeAfterRetirement ? "#92400e" : "#f59e0b", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>Scenario B</Text>
            </View>
            <Text className="text-white text-sm font-bold mb-3" numberOfLines={1}>{upgradeLabel}</Text>

            {upgradeAfterRetirement ? (
              <View className="items-center justify-center py-4">
                <AlertCircle size={20} color="#78350f" />
                <Text className="text-amber-900 text-xs text-center mt-2 leading-4">
                  Upgrade occurs after retirement under this timing.
                </Text>
              </View>
            ) : (
              <>
                <MetricRow label="Est. Avg Annual" value={fmtM(upAvgAnnual)} accent="#f59e0b" sub="Gross" />
                <MetricRow label="Lifetime Earnings" value={fmtM(upCareer)} accent="#f59e0b" sub="Gross total" />
                <MetricRow label="Retirement Assets" value={fmtM(upRetireAssets)} accent="#f59e0b" sub="Plan B at ret." />
                <View className="mt-2 pt-2 border-t border-amber-500/10">
                  <MetricRow label="Retirement Income" value={`${fmtM(upRetireMonthlyNet * 12)}/yr`} accent="#22c55e" sub={`Est. Net · ${fmtDollarsLong(upRetireMonthlyNet)}/mo`} />
                </View>
              </>
            )}
          </LinearGradient>
        </View>
      </View>

      {/* Difference strip */}
      {!upgradeAfterRetirement && (
        <View className="mt-3 rounded-2xl border border-slate-700/20 overflow-hidden" style={{ backgroundColor: "#131f35" }}>
          <View className="px-4 pt-3 pb-1">
            <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider">Difference (Upgrade − FO)</Text>
          </View>
          <View className="flex-row px-2 pb-2">
            <DiffCell label="Lifetime Earnings" value={diffCareer} suffix="" isMonetary />
            <DiffCell label="Retire Assets" value={diffAssets} suffix="" isMonetary />
            <DiffCell label="Retire Income" value={diffMonthly * 12} suffix="/yr" isMonetary />
          </View>
          {/* Opportunity cost line */}
          {diffCareer !== 0 && (
            <View className="px-4 pb-3 pt-1 border-t border-slate-700/20">
              <Text className="text-slate-500 text-xs leading-4">
                <Text className="text-slate-400 font-semibold">Estimated Opportunity Cost</Text>
                {diffCareer < 0
                  ? ` of upgrading: ${fmtM(Math.abs(diffCareer))} lifetime earnings, ${fmtDollarsLong(Math.abs(diffMonthly))}/mo retirement income.`
                  : ` of staying FO: ${fmtM(Math.abs(diffCareer))} lifetime earnings, ${fmtDollarsLong(Math.abs(diffMonthly))}/mo retirement income.`
                }{" "}
                <Text className="text-slate-600">(Estimated)</Text>
              </Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

function MetricRow({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <View className="flex-row items-start justify-between mb-2">
      <Text className="text-slate-500 text-xs flex-1 mr-2" numberOfLines={2}>{label}</Text>
      <View className="items-end">
        <Text style={{ color: accent, fontSize: 13, fontWeight: "700" }}>{value}</Text>
        {sub && <Text className="text-slate-600 text-xs mt-0.5">{sub}</Text>}
      </View>
    </View>
  );
}

function DiffCell({ label, value, suffix, isMonetary }: { label: string; value: number; suffix: string; isMonetary: boolean }) {
  const isPos = value > 0;
  const isZero = value === 0;
  const color = isZero ? "#64748b" : isPos ? "#22c55e" : "#f97316";
  return (
    <View className="flex-1 items-center px-2 py-2">
      <Text className="text-slate-600 text-xs mb-1 text-center" numberOfLines={1}>{label}</Text>
      <Text style={{ color, fontSize: 13, fontWeight: "700" }}>
        {isZero ? "—" : `${isPos ? "+" : ""}${isMonetary ? fmtM(value) : value}${suffix}`}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAK-EVEN CARD
// ─────────────────────────────────────────────────────────────────────────────

function BreakEvenCard({
  result,
  foForecast,
  upgradeForecast,
  upgradeYear,
}: {
  result: BreakEvenResult;
  foForecast: RetirementForecast;
  upgradeForecast: RetirementForecast;
  upgradeYear: number | null;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <Animated.View entering={FadeInDown.delay(100).springify()} className="mt-3">
      <View className="rounded-2xl border border-slate-700/20 overflow-hidden" style={{ backgroundColor: "#131f35" }}>
        <LinearGradient colors={["#1e293b50", "transparent"]} style={{ padding: 14 }}>
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Calculator size={14} color="#a78bfa" />
              <Text className="text-white text-sm font-bold">Upgrade Break-Even</Text>
            </View>
            <Pressable
              onPress={() => setShowTooltip(true)}
              className="w-6 h-6 rounded-full items-center justify-center"
              style={{ backgroundColor: "#1e293b" }}
            >
              <Info size={12} color="#64748b" />
            </Pressable>
          </View>

          {result.notApplicable ? (
            <View className="flex-row items-start gap-2">
              <AlertCircle size={14} color="#64748b" style={{ marginTop: 1 }} />
              <Text className="text-slate-400 text-sm leading-5 flex-1">
                {result.notApplicableReason ?? "Break-even not applicable under this scenario."}
              </Text>
            </View>
          ) : result.breakEvenCalendarYear ? (
            <View>
              <View className="flex-row items-end gap-3">
                <View>
                  <Text className="text-slate-500 text-xs mb-1">Financially advantageous after</Text>
                  <View className="flex-row items-baseline gap-1.5">
                    <Text style={{ color: "#a78bfa", fontSize: 28, fontWeight: "800" }}>{result.yearsFromNow}</Text>
                    <Text className="text-slate-400 text-sm font-semibold">years</Text>
                  </View>
                </View>
                <View className="mb-1">
                  <Text className="text-slate-500 text-xs mb-1">Around</Text>
                  <Text style={{ color: "#7c3aed", fontSize: 20, fontWeight: "700" }}>{result.breakEvenCalendarYear}</Text>
                </View>
              </View>
              <Text className="text-slate-600 text-xs mt-2 leading-4">
                Cumulative earnings with upgrade reach parity with stay-FO path in this scenario. Estimate.
              </Text>
            </View>
          ) : (
            <View className="flex-row items-start gap-2">
              <AlertCircle size={14} color="#f97316" style={{ marginTop: 1 }} />
              <Text className="text-slate-400 text-sm leading-5 flex-1">
                {result.notApplicableReason ?? "Upgrade does not break even within the career window."}
              </Text>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* Tooltip modal */}
      <Modal visible={showTooltip} transparent animationType="fade" onRequestClose={() => setShowTooltip(false)}>
        <Pressable className="flex-1 justify-center items-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }} onPress={() => setShowTooltip(false)}>
          <View className="mx-8 rounded-2xl p-5 border border-slate-700" style={{ backgroundColor: "#131f35" }}>
            <Text className="text-white text-sm font-bold mb-2">How Break-Even is Calculated</Text>
            <Text className="text-slate-400 text-xs leading-5">
              Starting from today, cumulative annual earnings are summed year-by-year for both the Stay FO and Upgrade paths. Break-even is the first year where the upgrade path's cumulative earnings meet or exceed the FO path's cumulative earnings.{"\n\n"}
              Break-even uses earnings only. It does not factor in quality-of-life, schedule, seniority, or other non-financial considerations.{"\n\n"}
              Labeled <Text className="text-amber-400">Estimate</Text>. Actual results depend on bids, premium pay, and contract changes.
            </Text>
            <Pressable className="mt-4 items-center py-2.5 rounded-xl bg-slate-700" onPress={() => setShowTooltip(false)}>
              <Text className="text-white text-sm font-semibold">Got it</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SENIOR FO REALITY CHECK (collapsible)
// ─────────────────────────────────────────────────────────────────────────────

function SeniorFORealityCheck() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Animated.View entering={FadeInDown.delay(130).springify()} className="mt-3">
      <Pressable
        onPress={() => { setExpanded((p) => !p); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        className="rounded-2xl border border-slate-700/30 overflow-hidden"
        style={{ backgroundColor: "#0d1b2a" }}
      >
        <View className="flex-row items-center justify-between px-4 py-3">
          <View className="flex-row items-center gap-2">
            <Info size={13} color="#64748b" />
            <Text className="text-slate-400 text-xs font-semibold">Why can FO sometimes match Captain pay?</Text>
          </View>
          {expanded ? <ChevronUp size={15} color="#64748b" /> : <ChevronDown size={15} color="#64748b" />}
        </View>
        {expanded && (
          <View className="px-4 pb-4 border-t border-slate-700/20">
            <Text className="text-slate-400 text-xs leading-5 mt-3">
              Actual earnings vary with bidding, premium pay (international, overtime, training), and trip selection. Senior FOs with strategic trip selection under <Text className="text-sky-400">Avg Total</Text> basis can approach or exceed junior Captain Guarantee pay.{"\n\n"}
              This model uses your selected Earnings Basis. To model a senior FO strategy, switch to <Text className="text-sky-400">Avg Total</Text> and compare against Captain <Text className="text-amber-400">Guarantee</Text> in a separate run.{"\n\n"}
              <Text className="text-slate-500">The basis selector above applies to both FO and CPT projections equally.</Text>
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RETIREMENT ASSET PROJECTION CHART
// ─────────────────────────────────────────────────────────────────────────────

function RetirementAssetProjectionChart({
  foForecast,
  upgradeForecast,
  scenario,
  upgradeYear,
}: {
  foForecast: RetirementForecast;
  upgradeForecast: RetirementForecast;
  scenario: ComparisonScenario;
  upgradeYear: number | null;
}) {
  const upgradeProjections = upgradeForecast.yearlyProjections;
  const foProjections = foForecast.yearlyProjections;

  if (foProjections.length < 2) return null;

  const ghostUpgrade = scenario === "STAY_FO";

  const SVG_W = GRAPH_WIDTH;
  const SVG_H = GRAPH_HEIGHT + 32;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 16;
  const PAD_B = 28;
  const chartW = SVG_W - PAD_L - PAD_R;
  const chartH = SVG_H - PAD_T - PAD_B;

  const allVals = [
    ...foProjections.map((p) => p.cumulativePlanBCents),
    ...upgradeProjections.map((p) => p.cumulativePlanBCents),
  ];
  const maxVal = Math.max(...allVals, 1);

  function toX(i: number, len: number) {
    return PAD_L + (i / (len - 1)) * chartW;
  }
  function toY(val: number) {
    return PAD_T + chartH - (val / maxVal) * chartH;
  }

  const foPoints = foProjections.map((p, i) => `${toX(i, foProjections.length)},${toY(p.cumulativePlanBCents)}`).join(" ");
  const upPoints = upgradeProjections.map((p, i) => `${toX(i, upgradeProjections.length)},${toY(p.cumulativePlanBCents)}`).join(" ");

  const finalFO = foProjections[foProjections.length - 1]?.cumulativePlanBCents ?? 0;
  const finalUp = upgradeProjections[upgradeProjections.length - 1]?.cumulativePlanBCents ?? 0;
  const diffAsset = finalUp - finalFO;

  const foEndX = toX(foProjections.length - 1, foProjections.length);
  const foEndY = toY(finalFO);
  const upEndX = toX(upgradeProjections.length - 1, upgradeProjections.length);
  const upEndY = toY(finalUp);

  // CPT upgrade marker
  const cptIdx = upgradeProjections.findIndex((p) => p.seatType === "CAPTAIN");
  const cptX = cptIdx > 0 ? toX(cptIdx, upgradeProjections.length) : null;

  // X-axis year labels
  const labelStep = Math.max(1, Math.floor(foProjections.length / 5));
  const labelYears = foProjections.filter((_, i) => i % labelStep === 0);

  const upgradeYrLabel = upgradeYear ?? upgradeForecast.expectedUpgradeYear;

  return (
    <Animated.View entering={FadeInDown.delay(150).springify()} className="mt-5">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <BarChart3 size={14} color="#a78bfa" />
          <Text className="text-slate-300 text-sm font-semibold">Retirement Asset Projection</Text>
        </View>
        <View className="flex-row gap-3">
          <View className="flex-row items-center gap-1.5">
            <View className="w-5 h-1.5 rounded-full" style={{ backgroundColor: "#f59e0b", opacity: ghostUpgrade ? 0.35 : 0.9 }} />
            <Text className="text-slate-500 text-xs" style={{ opacity: ghostUpgrade ? 0.5 : 1 }}>Upgrade</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-5 h-1.5 rounded-full" style={{ backgroundColor: "#38bdf8", opacity: 0.85 }} />
            <Text className="text-slate-500 text-xs">FO only</Text>
          </View>
        </View>
      </View>

      {/* SVG Chart */}
      <View className="rounded-2xl overflow-hidden border border-slate-700/30" style={{ backgroundColor: "#131f35" }}>
        <Svg width={SVG_W} height={SVG_H}>
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <Line
              key={f}
              x1={PAD_L} y1={toY(maxVal * f)}
              x2={SVG_W - PAD_R} y2={toY(maxVal * f)}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1}
            />
          ))}

          {/* CPT upgrade vertical marker */}
          {cptX !== null && !ghostUpgrade && (
            <Line
              x1={cptX} y1={PAD_T}
              x2={cptX} y2={SVG_H - PAD_B}
              stroke="#f59e0b" strokeWidth={1} strokeOpacity={0.4}
              strokeDasharray="3,3"
            />
          )}

          {/* FO line */}
          <Polyline
            points={foPoints}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2.5}
            strokeOpacity={0.85}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Upgrade line */}
          <Polyline
            points={upPoints}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={2.5}
            strokeOpacity={ghostUpgrade ? 0.2 : 0.9}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* FO endpoint dot */}
          <Circle cx={foEndX} cy={foEndY} r={4} fill="#38bdf8" opacity={0.9} />

          {/* Upgrade endpoint dot */}
          <Circle cx={upEndX} cy={upEndY} r={4} fill="#f59e0b" opacity={ghostUpgrade ? 0.25 : 0.9} />

          {/* X-axis year labels */}
          {foProjections.map((p, i) => {
            if (i % labelStep !== 0) return null;
            const x = toX(i, foProjections.length);
            return (
              <SvgText key={p.year} x={x} y={SVG_H - 6} fontSize={10} fill="#475569" textAnchor="middle">{p.year}</SvgText>
            );
          })}
        </Svg>
      </View>

      {/* Below-chart summary: both final values */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#38bdf8" }} />
          <Text style={{ color: "#94a3b8", fontSize: 11 }}>FO only</Text>
          <Text style={{ color: "#38bdf8", fontSize: 12, fontWeight: "700" }}>{fmtM(finalFO)}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b" }} />
          <Text style={{ color: "#94a3b8", fontSize: 11 }}>Upgrade</Text>
          <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700" }}>{fmtM(finalUp)}</Text>
        </View>
      </View>

      {/* Insight line */}
      {!ghostUpgrade && diffAsset !== 0 && (
        <View className="mt-2 flex-row items-start gap-1.5">
          <Target size={11} color="#64748b" style={{ marginTop: 1 }} />
          <Text className="text-slate-500 text-xs leading-4 flex-1">
            <Text className="text-slate-400">Insight:</Text>
            {" "}Upgrading in {upgradeYrLabel} {diffAsset >= 0 ? "increases" : "decreases"} retirement assets by{" "}
            <Text style={{ color: diffAsset >= 0 ? "#22c55e" : "#f97316", fontWeight: "700" }}>
              {signPrefix(diffAsset)}{fmtM(Math.abs(diffAsset))}
            </Text>
            {" "}under this scenario.{" "}
            <Text className="text-slate-600">Estimate.</Text>
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export interface CareerPathComparisonProps {
  profile: RetirementProfile;
  taxPct: number;
  onChangeBasis: (b: EarningsBasis) => void;
}

export function CareerPathComparison({
  profile,
  taxPct,
  onChangeBasis,
}: CareerPathComparisonProps) {
  const currentYear = new Date().getFullYear();
  const dohYear = profile.doh ? new Date(profile.doh).getFullYear() : currentYear;

  const defaultUpgradeNowYear = currentYear;
  const defaultUpgradeLaterYear = currentYear + 5;

  const [scenario, setScenario] = useState<ComparisonScenario>("UPGRADE_NOW");
  const [upgradeYear, setUpgradeYear] = useState(defaultUpgradeLaterYear);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Build profiles for each scenario
  const foProfile: RetirementProfile = useMemo(() => ({
    ...profile,
    activeScenario: "FO_ONLY",
    expectedUpgradeYear: 9999,
  }), [profile]);

  const upgradeNowProfile: RetirementProfile = useMemo(() => ({
    ...profile,
    activeScenario: "UPGRADE_TO_CPT",
    expectedUpgradeYear: defaultUpgradeNowYear,
  }), [profile, defaultUpgradeNowYear]);

  const upgradeLaterProfile: RetirementProfile = useMemo(() => ({
    ...profile,
    activeScenario: "UPGRADE_TO_CPT",
    expectedUpgradeYear: upgradeYear,
  }), [profile, upgradeYear]);

  // Compute forecasts
  const foForecast = useMemo(
    () => computeRetirementForecast(foProfile, UPS_CONTRACT_RULES),
    [foProfile]
  );
  const upgradeNowForecast = useMemo(
    () => computeRetirementForecast(upgradeNowProfile, UPS_CONTRACT_RULES),
    [upgradeNowProfile]
  );
  const upgradeLaterForecast = useMemo(
    () => computeRetirementForecast(upgradeLaterProfile, UPS_CONTRACT_RULES),
    [upgradeLaterProfile]
  );

  const retirementYear = foForecast.retirementYear;

  const activeUpgradeForecast =
    scenario === "STAY_FO" ? foForecast :
    scenario === "UPGRADE_NOW" ? upgradeNowForecast :
    upgradeLaterForecast;

  const activeUpgradeYear =
    scenario === "UPGRADE_NOW" ? defaultUpgradeNowYear :
    scenario === "UPGRADE_LATER" ? upgradeYear :
    null;

  const upgradeAfterRetirement = activeUpgradeYear != null && activeUpgradeYear >= retirementYear;

  const breakEvenResult = useMemo(() => {
    if (scenario === "STAY_FO") {
      return {
        breakEvenYear: null,
        breakEvenCalendarYear: null,
        yearsFromNow: null,
        notApplicable: true,
        notApplicableReason: "Break-even not applicable for Stay FO scenario.",
      } as BreakEvenResult;
    }
    return computeBreakEven(foForecast, activeUpgradeForecast, upgradeAfterRetirement);
  }, [scenario, foForecast, activeUpgradeForecast, upgradeAfterRetirement]);

  const upgradeLabel =
    scenario === "STAY_FO" ? "Stay FO" :
    scenario === "UPGRADE_NOW" ? "Upgrade Now" :
    `Upgrade ${upgradeYear}`;

  const upgradeTiming =
    scenario === "UPGRADE_NOW" ? `Now (${currentYear})` :
    scenario === "UPGRADE_LATER" ? `Year ${upgradeYear}` :
    "N/A";

  if (!profile.dob || !profile.doh) {
    return (
      <View className="mx-6 mt-5">
        <View className="rounded-2xl border border-slate-700/30 p-5 items-center" style={{ backgroundColor: "#131f35" }}>
          <AlertCircle size={20} color="#64748b" />
          <Text className="text-slate-400 text-sm font-semibold mt-2">Profile Incomplete</Text>
          <Text className="text-slate-500 text-xs text-center mt-1 leading-4">
            Date of birth and date of hire are required to model career paths. Enter them in Edit Assumptions.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="mx-6 mt-5">
      {/* Section Header */}
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center gap-2">
          <Plane size={15} color="#a78bfa" />
          <Text className="text-white text-base font-bold">Career Path Comparison</Text>
        </View>
        <Pressable
          onPress={() => { setShowAssumptions(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          className="w-7 h-7 rounded-full items-center justify-center border border-slate-700/40"
          style={{ backgroundColor: "#1e293b" }}
        >
          <Info size={13} color="#64748b" />
        </Pressable>
      </View>
      <Text className="text-slate-500 text-xs mb-4 leading-4">
        Compare First Officer vs Captain career outcomes under different upgrade timing scenarios.
      </Text>

      {/* Earnings Basis — inline */}
      <EarningsBasisControl value={profile.earningsBasis} onChange={onChangeBasis} />

      {/* Scenario selector */}
      <View className="mt-3">
        <ScenarioSelector selected={scenario} onSelect={setScenario} />
      </View>

      {/* Upgrade Later timing picker */}
      {scenario === "UPGRADE_LATER" && (
        <UpgradeTimingPicker
          dohYear={dohYear}
          currentYear={currentYear}
          upgradeYear={upgradeYear}
          onChangeYear={setUpgradeYear}
        />
      )}

      {/* Comparison cards */}
      <View className="mt-4">
        <ComparisonCards
          foForecast={foForecast}
          upgradeForecast={activeUpgradeForecast}
          upgradeLabel={upgradeLabel}
          taxPct={taxPct}
          upgradeAfterRetirement={upgradeAfterRetirement}
        />
      </View>

      {/* Break-even */}
      <BreakEvenCard
        result={breakEvenResult}
        foForecast={foForecast}
        upgradeForecast={activeUpgradeForecast}
        upgradeYear={activeUpgradeYear}
      />

      {/* Senior FO reality check */}
      <SeniorFORealityCheck />

      {/* Retirement Asset Projection chart */}
      <RetirementAssetProjectionChart
        foForecast={foForecast}
        upgradeForecast={scenario === "STAY_FO" ? upgradeNowForecast : activeUpgradeForecast}
        scenario={scenario}
        upgradeYear={activeUpgradeYear}
      />

      {/* Assumptions modal */}
      <AssumptionsInfoModal
        visible={showAssumptions}
        onClose={() => setShowAssumptions(false)}
        profile={profile}
        upgradeTiming={upgradeTiming}
        scenario={scenario}
        taxPct={taxPct}
      />
    </View>
  );
}
