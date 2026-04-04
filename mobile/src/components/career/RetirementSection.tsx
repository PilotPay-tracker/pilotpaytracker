/**
 * RetirementSection v3 — CBA 2023–2028 Locked
 *
 * Complete pilot-friendly retirement experience:
 * - Retirement Paycheck (monthly net + gross)
 * - Income / Assets / Medical / One-time payout separation
 * - "Can I Retire at 60?" readiness card
 * - Financial Independence Age estimate
 * - Adjustable assumptions behind Edit
 * - Calculation integrity validation
 * - "How Calculated" audit screen
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Dimensions,
  Share,
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
  TrendingUp,
  DollarSign,
  Calendar,
  Clock,
  ChevronRight,
  X,
  Check,
  AlertCircle,
  BarChart3,
  Lightbulb,
  Plane,
  Edit3,
  ShieldCheck,
  Award,
  Zap,
  ArrowUpRight,
  Info,
  Target,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Heart,
  Briefcase,
  BookOpen,
  Star,
  ArrowRight,
  CircleDot,
  Wallet,
  Share2,
  Calculator,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Flame,
  Users,
  Activity,
} from "lucide-react-native";

import {
  useRetirementProfile,
  useRetirementActions,
  useRetirementSetupComplete,
  computeRetirementForecast,
  computeMultiAgeForecast,
  computeDualScenarioForecast,
  buildScenario,
  UPS_CONTRACT_RULES,
  UPS_PAY_TABLES,
  DEFAULT_UPGRADE_YEARS_FROM_DOH,
  getPayTableAnnualComp,
  CBA_RULESET_VERSION,
  HRA_ANNUAL_POST_RETIRE_CENTS,
  type RetirementProfile,
  type PriorEarnings,
  type RetirementForecast,
  type DualScenarioForecast,
  type CareerPathScenario,
  type CareerScenario,
  type EarningsBasis,
} from "@/lib/state/retirement-store";
import { useProfile } from "@/lib/state/profile-store";
import { CareerPathComparison } from "@/components/career/CareerPathComparison";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_WIDTH = SCREEN_WIDTH - 48;
const GRAPH_HEIGHT = 140;

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${Math.round(d).toLocaleString()}`;
}

function fmtDollarsLong(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmtMonthly(annualCents: number): string {
  const monthly = Math.round(annualCents / 12);
  return fmtDollarsLong(monthly);
}

function parseDollarInput(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const val = parseFloat(cleaned) || 0;
  return Math.round(val * 100);
}

function currentAge(dob: string | null): number {
  if (!dob) return 0;
  const d = new Date(dob);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function calcYOS(doh: string | null): number {
  if (!doh) return 0;
  const d = new Date(doh);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// Integrity check: monthly must equal annual / 12
function checkMonthlyIntegrity(annualCents: number, monthlyCents: number): boolean {
  const expected = Math.round(annualCents / 12);
  return Math.abs(expected - monthlyCents) <= 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFESTYLE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

const LIFESTYLE_THRESHOLDS = [
  { label: "Middle Class",   monthlyNet: 800000,   color: "#22c55e",  badge: "#166534" },
  { label: "Upper Middle",   monthlyNet: 1500000,  color: "#3b82f6",  badge: "#1e3a5f" },
  { label: "Luxury",         monthlyNet: 2500000,  color: "#a78bfa",  badge: "#3b0764" },
  { label: "Ultra Luxury",   monthlyNet: 4000000,  color: "#f59e0b",  badge: "#451a03" },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE BADGE
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: "HIGH" | "MEDIUM" | "ESTIMATE" }) {
  const config = {
    HIGH:     { color: "#22c55e", bg: "#22c55e20", label: "High Confidence" },
    MEDIUM:   { color: "#f59e0b", bg: "#f59e0b20", label: "Medium" },
    ESTIMATE: { color: "#64748b", bg: "#64748b20", label: "Estimate" },
  }[level];
  return (
    <View style={{ backgroundColor: config.bg, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
      <View className="flex-row items-center gap-1">
        <CircleDot size={9} color={config.color} />
        <Text style={{ color: config.color, fontSize: 11, fontWeight: "600" }}>{config.label}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRITY ERROR BANNER
// ─────────────────────────────────────────────────────────────────────────────

function IntegrityBanner({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <View className="mx-6 mt-3">
      {errors.map((e, i) => (
        <View key={i} className="flex-row items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-2">
          <AlertCircle size={14} color="#ef4444" style={{ marginTop: 1 }} />
          <Text className="text-red-400 text-xs flex-1 leading-4">{e}</Text>
        </View>
      ))}
      {warnings.map((w, i) => (
        <View key={i} className="flex-row items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-2">
          <AlertTriangle size={14} color="#f59e0b" style={{ marginTop: 1 }} />
          <Text className="text-amber-400 text-xs flex-1 leading-4">{w}</Text>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOW CALCULATED AUDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

function HowCalculatedModal({
  visible,
  onClose,
  forecast,
  taxPct,
  hraParticipants,
}: {
  visible: boolean;
  onClose: () => void;
  forecast: RetirementForecast;
  taxPct: number;
  hraParticipants: number;
}) {
  const p = forecast.pension;
  const swr = forecast.contractAtRetirement ? (forecast.projectedPlanBBalanceCents > 0 ? Math.round(forecast.planBAnnualWithdrawalCents / forecast.projectedPlanBBalanceCents * 100) : 4) : 4;
  const grossMonthly = Math.round(forecast.projectedTotalAnnualRetirementIncomeCents / 12);
  const netMonthly = Math.round(grossMonthly * (1 - taxPct / 100));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
          <View className="flex-row items-center gap-2">
            <Calculator size={18} color="#f59e0b" />
            <Text className="text-white text-lg font-bold">How Calculated</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 items-center justify-center">
            <X size={20} color="#94a3b8" />
          </Pressable>
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 24 }}>

          {/* Ruleset */}
          <View className="flex-row items-center gap-2 mb-5 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
            <ShieldCheck size={14} color="#22c55e" />
            <Text className="text-green-400 text-sm font-semibold">{forecast.rulesetVersion}</Text>
          </View>

          {/* Key Inputs */}
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Assumptions Used</Text>
          <View className="bg-slate-800/50 rounded-2xl p-4 mb-5 gap-2">
            {[
              ["Retirement Age", `${forecast.retirementAge}`],
              ["Years of Service", `${forecast.yearsOfService} (max 30)`],
              ["Seat at Retirement", forecast.seatAtRetirement],
              ["Career Path", forecast.expectedUpgradeYear >= 9999 ? "FO Only" : `Upgrade at ${forecast.expectedUpgradeYear}`],
              ["Earnings Basis", forecast.earningsBasis],
              ["Final Avg Earnings (FAE)", fmtDollarsLong(forecast.finalAverageEarningsCents) + "/yr"],
              ["Actual Earnings Years", `${forecast.actualEarningsYears} real · ${forecast.projectedEarningsYears} estimated`],
              ["Plan B Growth Rate", "5% annual (assumed)"],
              ["Safe Withdrawal Rate", `${swr}%`],
              ["Tax Estimate", `${taxPct}%`],
              ["HRA Participants", `${hraParticipants}`],
            ].map(([k, v]) => (
              <View key={k} className="flex-row justify-between">
                <Text className="text-slate-500 text-sm">{k}</Text>
                <Text className="text-white text-sm font-semibold">{v}</Text>
              </View>
            ))}
          </View>

          {/* Plan A */}
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Plan A Pension</Text>
          <View className="bg-violet-500/8 border border-violet-500/20 rounded-2xl p-4 mb-5 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">Formula 1 (Percent)</Text>
              <Text className="text-slate-300 text-sm font-semibold">{fmtDollarsLong(p.percentFormulaAnnualCents)}/yr</Text>
            </View>
            <Text className="text-slate-600 text-xs ml-0">  1% × {fmtDollarsLong(p.finalAverageEarningsCents)} × {p.effectiveYOS} YOS</Text>
            <View className="flex-row justify-between mt-1">
              <Text className="text-slate-400 text-sm">Formula 2 (Flat $)</Text>
              <Text className="text-slate-300 text-sm font-semibold">{fmtDollarsLong(p.flatDollarFormulaAnnualCents)}/yr</Text>
            </View>
            <Text className="text-slate-600 text-xs">  ${forecast.seatAtRetirement === "CAPTAIN" ? "4,200" : "3,360"}/YOS × {p.effectiveYOS} YOS</Text>
            <View className="flex-row justify-between mt-2 pt-2 border-t border-violet-500/20">
              <Text className="text-violet-400 text-sm font-bold">Using: {p.formulaUsed === "FLAT_DOLLAR" ? "Flat Dollar ✓" : "Percent Formula ✓"}</Text>
              <Text className="text-violet-300 text-sm font-bold">{fmtDollarsLong(p.annualCents)}/yr</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-xs">Monthly ({p.annualCents}/12)</Text>
              <Text className="text-slate-400 text-xs font-semibold">{fmtDollarsLong(p.monthlyCents)}/mo {p.isValid ? "✓" : "⚠ MISMATCH"}</Text>
            </View>
          </View>

          {/* Plan B */}
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Plan B (DC Account)</Text>
          <View className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 mb-5 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">Projected Balance</Text>
              <Text className="text-amber-300 text-sm font-semibold">{fmtDollarsLong(forecast.projectedPlanBBalanceCents)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">Annual Withdrawal ({swr}% SWR)</Text>
              <Text className="text-amber-300 text-sm font-semibold">{fmtDollarsLong(forecast.planBAnnualWithdrawalCents)}/yr</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-500 text-xs">Monthly</Text>
              <Text className="text-slate-400 text-xs">{fmtMonthly(forecast.planBAnnualWithdrawalCents)}/mo</Text>
            </View>
          </View>

          {/* VEBA / HRA */}
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">VEBA / HRA (Not Cash)</Text>
          <View className="bg-sky-500/8 border border-sky-500/20 rounded-2xl p-4 mb-5 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">HRA Annual Benefit</Text>
              <Text className="text-sky-300 text-sm font-semibold">{fmtDollarsLong(HRA_ANNUAL_POST_RETIRE_CENTS * hraParticipants)}/yr</Text>
            </View>
            <Text className="text-slate-600 text-xs">NOT spendable cash — medical reimbursement only</Text>
            <Text className="text-slate-600 text-xs">Stops at Medicare eligibility (age {forecast.medicareEligibilityAge})</Text>
          </View>

          {/* Sick Leave */}
          {forecast.sickLeaveEstimatedPayoutCents > 0 && (
            <>
              <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Sick Leave (One-Time)</Text>
              <View className="bg-slate-700/30 border border-slate-600/30 rounded-2xl p-4 mb-5 gap-2">
                <View className="flex-row justify-between">
                  <Text className="text-slate-400 text-sm">Estimated One-Time Payout</Text>
                  <Text className="text-slate-300 text-sm font-semibold">{fmtDollarsLong(forecast.sickLeaveEstimatedPayoutCents)}</Text>
                </View>
                <Text className="text-slate-600 text-xs">NEVER included in annual retirement income</Text>
              </View>
            </>
          )}

          {/* Income vs Gross */}
          <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Monthly Paycheck Summary</Text>
          <View className="bg-slate-800/50 rounded-2xl p-4 mb-5 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">Gross Annual (Plan A + Plan B)</Text>
              <Text className="text-white text-sm font-semibold">{fmtDollarsLong(forecast.projectedTotalAnnualRetirementIncomeCents)}/yr</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-slate-400 text-sm">Gross Monthly</Text>
              <Text className="text-white text-sm font-semibold">{fmtMonthly(forecast.projectedTotalAnnualRetirementIncomeCents)}/mo</Text>
            </View>
            <View className="flex-row justify-between pt-2 border-t border-slate-700/30">
              <Text className="text-green-400 text-sm font-bold">Est. Net Monthly (after ~{taxPct}% tax)</Text>
              <Text className="text-green-400 text-sm font-bold">{fmtDollarsLong(netMonthly)}/mo</Text>
            </View>
          </View>

          <View className="bg-slate-900 rounded-xl p-4">
            <Text className="text-slate-500 text-xs leading-4 text-center">
              Estimates only. Not financial or benefits advice. Always verify with UPS HR and IPA for official plan details. Calculation engine locked to {forecast.rulesetVersion}.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

function ContractDetailModal({
  visible,
  onClose,
  title,
  contractWording,
  howCalculated,
  contractName,
  contractEffectiveDate,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  contractWording: string;
  howCalculated: string;
  contractName: string;
  contractEffectiveDate: string;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
          <View className="flex-row items-center gap-2">
            <BookOpen size={18} color="#f59e0b" />
            <Text className="text-white text-lg font-bold" numberOfLines={1} style={{ maxWidth: SCREEN_WIDTH - 100 }}>{title}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 items-center justify-center">
            <X size={20} color="#94a3b8" />
          </Pressable>
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 24 }}>
          <View className="flex-row items-center gap-2 mb-5">
            <ShieldCheck size={14} color="#22c55e" />
            <Text className="text-green-400 text-xs font-semibold">{contractName}</Text>
            <Text className="text-slate-600 text-xs">· Effective {contractEffectiveDate}</Text>
          </View>
          <View className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 mb-5">
            <Text className="text-amber-400 text-xs font-semibold uppercase tracking-wider mb-3">What the contract says</Text>
            <Text className="text-slate-300 text-sm leading-6">{contractWording}</Text>
          </View>
          <View className="bg-slate-800/50 border border-slate-700/30 rounded-2xl p-4">
            <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">How we calculate it</Text>
            <Text className="text-slate-300 text-sm leading-6">{howCalculated}</Text>
          </View>
          <View className="mt-5 p-4 bg-slate-900 rounded-xl">
            <Text className="text-slate-500 text-xs leading-4 text-center">
              Estimates only. Not financial or benefits advice. Verify with UPS HR and IPA for official figures.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RETIREMENT PAYCHECK CARD (Hero)
// ─────────────────────────────────────────────────────────────────────────────

function RetirementPaycheckCard({
  forecast,
  taxPct,
  swrPct,
  onInfoPress,
  onHowCalcPress,
  ssMonthly,
  includeSS,
  hraParticipants,
}: {
  forecast: RetirementForecast;
  taxPct: number;
  swrPct: number;
  onInfoPress: () => void;
  onHowCalcPress: () => void;
  ssMonthly?: number; // in cents, already accounting for claim age
  includeSS?: boolean;
  hraParticipants?: number;
}) {
  const grossAnnual = forecast.projectedTotalAnnualRetirementIncomeCents + (includeSS && ssMonthly ? ssMonthly * 12 : 0);
  const grossMonthly = Math.round(grossAnnual / 12);
  const netMonthly = Math.round(grossMonthly * (1 - taxPct / 100));

  // Integrity check
  const pensionMonthlyValid = checkMonthlyIntegrity(
    forecast.projectedAnnualPensionCents,
    forecast.projectedMonthlyPensionCents
  );

  return (
    <Animated.View entering={FadeInDown.springify()} className="mx-6 mt-5">
      <LinearGradient
        colors={["#0d2318", "#0a1628", "#0d1f0d"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, padding: 22, borderWidth: 1, borderColor: "#22c55e18" }}
      >
        {/* Header row */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center gap-2">
            <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: "#22c55e18" }}>
              <Wallet size={16} color="#22c55e" />
            </View>
            <View>
              <Text className="text-green-400 text-sm font-bold">Retirement Paycheck</Text>
              <View className="flex-row items-center gap-1.5 mt-0.5">
                <ShieldCheck size={9} color="#22c55e" />
                <Text className="text-green-600 text-xs">Contract benefits only</Text>
              </View>
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable onPress={onInfoPress} className="w-7 h-7 rounded-full bg-slate-700/60 items-center justify-center">
              <Info size={13} color="#94a3b8" />
            </Pressable>
            <Pressable onPress={onHowCalcPress} className="flex-row items-center gap-1 bg-slate-700/50 rounded-xl px-2.5 py-1.5">
              <Calculator size={11} color="#94a3b8" />
              <Text className="text-slate-400 text-xs">How calc'd</Text>
            </Pressable>
          </View>
        </View>

        {/* Integrity warning */}
        {!pensionMonthlyValid && (
          <View className="flex-row items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 mb-3">
            <AlertCircle size={13} color="#ef4444" />
            <Text className="text-red-400 text-xs flex-1">Pension calculation mismatch — monthly ≠ annual/12</Text>
          </View>
        )}

        {/* Net monthly — LEAD */}
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Est. Net Monthly</Text>
        <Text className="text-white font-bold mb-1" style={{ fontSize: 48, lineHeight: 54 }}>
          {fmtDollarsLong(netMonthly)}
        </Text>
        <Text className="text-slate-500 text-xs mb-4">after ~{taxPct}% estimated taxes</Text>

        {/* Gross monthly */}
        <View className="flex-row items-baseline gap-2 mb-1">
          <Text className="text-slate-300 text-xl font-bold">{fmtDollarsLong(grossMonthly)}</Text>
          <Text className="text-slate-500 text-sm">gross/mo</Text>
        </View>
        <Text className="text-slate-500 text-sm mb-5">{fmtDollarsLong(grossAnnual)}/yr gross</Text>

        {/* HRA note */}
        <View className="flex-row items-center gap-2 bg-sky-500/8 rounded-xl px-3 py-2 mb-4">
          <Heart size={12} color="#38bdf8" />
          <Text className="text-sky-400 text-xs flex-1">
            + {fmtDollarsLong(Math.round(HRA_ANNUAL_POST_RETIRE_CENTS * (hraParticipants ?? 1) / 12))}/mo HRA (not cash — medical reimbursement)
          </Text>
        </View>

        {/* SS note */}
        {includeSS && (ssMonthly ?? 0) > 0 && (
          <View className="flex-row items-center gap-2 bg-green-500/8 rounded-xl px-3 py-2 mb-4">
            <Users size={12} color="#22c55e" />
            <Text className="text-green-400 text-xs flex-1">
              + {fmtDollarsLong(ssMonthly ?? 0)}/mo Social Security included
            </Text>
          </View>
        )}

        {/* Metadata row */}
        <View className="flex-row flex-wrap gap-2" style={{ borderTopWidth: 1, borderTopColor: "#ffffff08", paddingTop: 14 }}>
          {[
            { label: "Retire Age", value: String(forecast.retirementAge) },
            { label: "YOS", value: `${forecast.yearsOfService} yrs` },
            { label: "Path", value: forecast.seatAtRetirement === "CAPTAIN" ? "FO → CPT" : "FO Only" },
            { label: "SWR", value: `${swrPct}%` },
            { label: "Tax Est.", value: `${taxPct}%` },
          ].map(({ label, value }) => (
            <View key={label} className="bg-slate-800/50 rounded-xl px-2.5 py-1.5">
              <Text className="text-slate-600 text-xs">{label}</Text>
              <Text className="text-slate-300 text-xs font-semibold">{value}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INCOME BREAKDOWN CARD
// ─────────────────────────────────────────────────────────────────────────────

function IncomeBreakdownCard({ forecast, includeSS, ssMonthly, ssClaimAge, hraParticipants }: { forecast: RetirementForecast; includeSS: boolean; ssMonthly: number; ssClaimAge: 62 | 67 | 70; hraParticipants?: number }) {
  const [activeModal, setActiveModal] = useState<"planA" | "planB" | "veba" | null>(null);
  const contract = forecast.contractAtRetirement;

  const pensionAnnual = forecast.projectedAnnualPensionCents;
  const pensionMonthly = forecast.projectedMonthlyPensionCents;
  const planBAnnual = forecast.planBAnnualWithdrawalCents;
  const planBMonthly = Math.round(planBAnnual / 12);
  const hraAnnual = HRA_ANNUAL_POST_RETIRE_CENTS * (hraParticipants ?? 1);
  const hraMonthly = Math.round(hraAnnual / 12);

  // Integrity checks
  const pensionIntegrity = checkMonthlyIntegrity(pensionAnnual, pensionMonthly);
  const planBIntegrity = checkMonthlyIntegrity(planBAnnual, planBMonthly);

  const rows = [
    {
      key: "planA" as const,
      icon: <Award size={16} color="#a78bfa" />,
      color: "#a78bfa",
      label: "Plan A Pension",
      badge: "Guaranteed",
      badgeColor: "#22c55e",
      monthly: pensionMonthly,
      annual: pensionAnnual,
      note: `${forecast.pension.formulaUsed === "FLAT_DOLLAR" ? "Flat $ minimum" : "Percent formula"} · ${forecast.yearsOfService} YOS`,
      integrity: pensionIntegrity,
      isCash: true,
      contractKey: "planA" as const,
      howCalc: `MAX of two formulas:\n(1) 1% × ${fmtDollarsLong(forecast.finalAverageEarningsCents)} FAE × ${forecast.yearsOfService} YOS = ${fmtDollarsLong(forecast.pension.percentFormulaAnnualCents)}/yr\n(2) $${forecast.seatAtRetirement === "CAPTAIN" ? "4,200" : "3,360"}/YOS × ${forecast.yearsOfService} = ${fmtDollarsLong(forecast.pension.flatDollarFormulaAnnualCents)}/yr\n\nUsing: ${forecast.pension.formulaUsed === "FLAT_DOLLAR" ? "Flat Dollar ✓" : "Percent Formula ✓"}\nPer CBA 2023–2028.`,
    },
    {
      key: "planB" as const,
      icon: <TrendingUp size={16} color="#f59e0b" />,
      color: "#f59e0b",
      label: "Plan B Withdrawal",
      badge: `${Math.round(forecast.planBAnnualWithdrawalCents / Math.max(forecast.projectedPlanBBalanceCents, 1) * 100)}% SWR`,
      badgeColor: "#f59e0b",
      monthly: planBMonthly,
      annual: planBAnnual,
      note: `from ${fmtDollars(forecast.projectedPlanBBalanceCents)} balance`,
      integrity: planBIntegrity,
      isCash: true,
      contractKey: "planB" as const,
      howCalc: `Plan B balance × Safe Withdrawal Rate:\n${fmtDollarsLong(forecast.projectedPlanBBalanceCents)} × SWR = ${fmtDollarsLong(planBAnnual)}/yr\n\nEmployer contributes ${Math.round(contract.planBEmployerRate * 100)}% of eligible comp annually.\nBalance grows at assumed 5% annual return.\nPer CBA 2023–2028.`,
    },
    {
      key: "veba" as const,
      icon: <Heart size={16} color="#38bdf8" />,
      color: "#38bdf8",
      label: "HRA Medical Benefit",
      badge: "Not Cash",
      badgeColor: "#38bdf8",
      monthly: hraMonthly,
      annual: hraAnnual,
      note: "Medical reimbursement only",
      integrity: true,
      isCash: false,
      contractKey: "veba" as const,
      howCalc: `$1 per paid flight hour contributed to VEBA while working.\nPost-retirement: ${fmtDollarsLong(contract.hraAnnualPostRetireCents)}/yr HRA benefit per participant.\nNOT spendable cash — medical reimbursement only.\nStops at Medicare eligibility (age ${forecast.medicareEligibilityAge}).\nPer CBA 2023–2028.`,
    },
  ];

  const ssAnnual = ssMonthly * 12;
  // Total cash income with optional SS
  const totalCashCents = forecast.projectedTotalAnnualRetirementIncomeCents + (includeSS && ssMonthly > 0 ? ssAnnual : 0);

  return (
    <Animated.View entering={FadeInDown.delay(60).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <DollarSign size={16} color="#f59e0b" />
        <Text className="text-white text-base font-bold">Income Breakdown</Text>
        <Text className="text-slate-600 text-xs ml-auto">monthly · annual</Text>
      </View>

      <View className="rounded-2xl overflow-hidden border border-slate-700/30" style={{ backgroundColor: "#111827" }}>
        {rows.map((row, i) => (
          <View key={row.key}>
            {i > 0 && <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />}
            <Pressable
              onPress={() => { setActiveModal(row.key); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              className="px-4 py-3.5"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3 flex-1">
                  <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: `${row.color}15` }}>
                    {row.icon}
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-white text-sm font-semibold">{row.label}</Text>
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: `${row.badgeColor}20` }}>
                        <Text style={{ color: row.badgeColor, fontSize: 10, fontWeight: "700" }}>{row.badge}</Text>
                      </View>
                      {!row.integrity && (
                        <AlertCircle size={12} color="#ef4444" />
                      )}
                    </View>
                    <Text className="text-slate-500 text-xs mt-0.5">{row.note}</Text>
                  </View>
                </View>
                <View className="items-end ml-2">
                  <Text style={{ color: row.isCash ? row.color : "#64748b" }} className="text-sm font-bold">
                    {fmtDollarsLong(row.monthly)}/mo
                  </Text>
                  <Text className="text-slate-600 text-xs">{fmtDollars(row.annual)}/yr</Text>
                </View>
                <Info size={12} color="#374151" style={{ marginLeft: 8 }} />
              </View>
            </Pressable>
          </View>
        ))}

        {/* SS row — only when enabled and has value */}
        {includeSS && ssMonthly > 0 && (
          <View>
            <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
            <View className="px-4 py-3.5">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3 flex-1">
                  <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: "#22c55e15" }}>
                    <Users size={16} color="#22c55e" />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-white text-sm font-semibold">Social Security (Est.)</Text>
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: "#22c55e20" }}>
                        <Text style={{ color: "#22c55e", fontSize: 10, fontWeight: "700" }}>
                          {ssClaimAge === 62 ? "Reduced" : ssClaimAge === 70 ? "Maximum" : "Full"}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-slate-500 text-xs mt-0.5">Optional non-UPS retirement income</Text>
                  </View>
                </View>
                <View className="items-end ml-2">
                  <Text style={{ color: "#22c55e" }} className="text-sm font-bold">
                    {fmtDollarsLong(ssMonthly)}/mo
                  </Text>
                  <Text className="text-slate-600 text-xs">{fmtDollars(ssAnnual)}/yr</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Total income row */}
        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.08)" }} />
        <View className="px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-300 text-sm font-bold">Total Cash Income</Text>
            <View className="items-end">
              <Text className="text-green-400 text-sm font-bold">
                {fmtDollarsLong(Math.round(totalCashCents / 12))}/mo
              </Text>
              <Text className="text-slate-500 text-xs">{fmtDollars(totalCashCents)}/yr</Text>
            </View>
          </View>
          <Text className="text-slate-600 text-xs mt-1">Plan A + Plan B{includeSS && ssMonthly > 0 ? " + Social Security" : ""}. HRA excluded (not cash).</Text>
        </View>
      </View>

      {/* Contract detail modals */}
      {rows.map((row) => (
        <ContractDetailModal
          key={row.key}
          visible={activeModal === row.key}
          onClose={() => setActiveModal(null)}
          title={row.label}
          contractWording={contract.wording[row.contractKey]}
          howCalculated={row.howCalc}
          contractName={contract.label}
          contractEffectiveDate={contract.effectiveDate}
        />
      ))}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RETIREMENT ASSETS CARD
// ─────────────────────────────────────────────────────────────────────────────

function RetirementAssetsCard({
  forecast,
  swrPct,
  assets401kCents,
  assetsIRACents,
  assetsBrokerageCents,
  include401k,
  onChangeAssets,
}: {
  forecast: RetirementForecast;
  swrPct: number;
  assets401kCents: number;
  assetsIRACents: number;
  assetsBrokerageCents: number;
  include401k: boolean;
  onChangeAssets: (k: "retirement401kCents" | "retirementIRACents" | "retirementBrokerageCents", v: number) => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const planBBalance = forecast.projectedPlanBBalanceCents;
  const totalAssets = planBBalance + assets401kCents + assetsIRACents + assetsBrokerageCents;
  const withdrawal401k = Math.round(assets401kCents * swrPct / 100);

  const personalRows = [
    { key: "retirement401kCents" as const, label: "401(k) Balance", value: assets401kCents, color: "#a78bfa" },
    { key: "retirementIRACents" as const, label: "IRA Balance", value: assetsIRACents, color: "#34d399" },
    { key: "retirementBrokerageCents" as const, label: "Brokerage Account", value: assetsBrokerageCents, color: "#38bdf8" },
  ];

  return (
    <Animated.View entering={FadeInDown.delay(80).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <BarChart3 size={16} color="#f59e0b" />
        <Text className="text-white text-base font-bold">Retirement Assets</Text>
        <View className="bg-slate-700/60 rounded-full px-2.5 py-0.5 ml-auto">
          <Text className="text-slate-400 text-xs font-semibold">{fmtDollars(totalAssets)} total</Text>
        </View>
      </View>

      <View className="rounded-2xl border border-amber-500/20 overflow-hidden" style={{ backgroundColor: "#0f1310" }}>

        {/* Plan B — auto-populated from contract */}
        <View className="px-4 pt-4 pb-3">
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full bg-amber-400" />
              <Text className="text-slate-300 text-sm font-semibold">Plan B Balance</Text>
              <View className="bg-amber-500/20 rounded-full px-2 py-0.5">
                <Text className="text-amber-400 text-xs font-bold">Contract</Text>
              </View>
            </View>
            <Pressable onPress={() => setShowTooltip(!showTooltip)}>
              <Info size={14} color="#64748b" />
            </Pressable>
          </View>
          <Text className="text-amber-400 font-bold" style={{ fontSize: 26 }}>
            {fmtDollarsLong(planBBalance)}
          </Text>
          <Text className="text-slate-600 text-xs mt-0.5">Auto-populated from UPS contract projection</Text>

          {showTooltip && (
            <Animated.View entering={FadeIn} className="bg-slate-800 rounded-xl p-3 mt-3">
              <Text className="text-slate-300 text-xs leading-4">
                Your Plan B balance is a retirement ASSET — the total in your account at retirement. Annual income from it equals balance × Safe Withdrawal Rate ({swrPct}%).
              </Text>
            </Animated.View>
          )}
        </View>

        {/* Personal assets — optional */}
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(245,158,11,0.08)" }} className="px-4 pt-3 pb-1">
          <Text className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Personal Assets (Optional)</Text>
          {personalRows.map((row) => (
            <View key={row.key} className="mb-3">
              <View className="flex-row items-center gap-2 mb-1.5">
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                <Text className="text-slate-400 text-sm">{row.label}</Text>
                {row.value > 0 && (
                  <Text className="text-slate-300 text-sm font-semibold ml-auto">{fmtDollars(row.value)}</Text>
                )}
              </View>
              <TextInput
                value={row.value > 0 ? String(row.value / 100) : ""}
                onChangeText={(t) => onChangeAssets(row.key, parseDollarInput(t))}
                keyboardType="decimal-pad"
                placeholder={`Enter ${row.label} ($)`}
                placeholderTextColor="#334155"
                style={{
                  backgroundColor: "#1a2035",
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  color: "#fff",
                  fontSize: 14,
                  borderWidth: 1,
                  borderColor: row.value > 0 ? `${row.color}40` : "#1e293b",
                }}
              />
            </View>
          ))}
        </View>

        {/* Total assets summary */}
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(245,158,11,0.15)", marginHorizontal: 0 }} className="px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-300 text-sm font-bold">Total Retirement Assets</Text>
            <Text className="text-white text-base font-bold">{fmtDollars(totalAssets)}</Text>
          </View>
          {assets401kCents > 0 && include401k && (
            <Text className="text-violet-400 text-xs mt-1">
              Includes 401(k) withdrawal ({fmtDollars(withdrawal401k)}/yr) in income
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL INCOME FROM PERSONAL ASSETS CARD
// ─────────────────────────────────────────────────────────────────────────────

function OptionalIncomeCard({
  swrPct,
  assets401kCents,
  assetsIRACents,
  assetsBrokerageCents,
  include401k,
}: {
  swrPct: number;
  assets401kCents: number;
  assetsIRACents: number;
  assetsBrokerageCents: number;
  include401k: boolean;
}) {
  const withdrawal401k = Math.round(assets401kCents * swrPct / 100);
  const withdrawalIRA = Math.round(assetsIRACents * swrPct / 100);
  const withdrawalBrokerage = Math.round(assetsBrokerageCents * swrPct / 100);
  const totalOptional = withdrawal401k + withdrawalIRA + withdrawalBrokerage;

  const hasAnyAssets = assets401kCents > 0 || assetsIRACents > 0 || assetsBrokerageCents > 0;
  if (!hasAnyAssets) return null;

  const rows = [
    { label: "401(k) Withdrawal Estimate", value: withdrawal401k, color: "#a78bfa", active: assets401kCents > 0, inIncome: include401k },
    { label: "IRA Withdrawal Estimate", value: withdrawalIRA, color: "#34d399", active: assetsIRACents > 0, inIncome: false },
    { label: "Brokerage Withdrawal Estimate", value: withdrawalBrokerage, color: "#38bdf8", active: assetsBrokerageCents > 0, inIncome: false },
  ].filter((r) => r.active);

  return (
    <Animated.View entering={FadeInDown.delay(85).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <TrendingUp size={16} color="#a78bfa" />
        <Text className="text-white text-base font-bold">Optional Income From Personal Assets</Text>
      </View>

      <View className="rounded-2xl border border-violet-500/20 overflow-hidden" style={{ backgroundColor: "#120f1a" }}>
        <View className="px-4 pt-3 pb-1">
          <View className="flex-row items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2.5 mb-3">
            <Info size={12} color="#a78bfa" />
            <Text className="text-violet-300 text-xs flex-1 leading-4">
              These are estimates only. Based on {swrPct}% Safe Withdrawal Rate applied to your entered balances.
            </Text>
          </View>

          {rows.map((row, i) => (
            <View key={i} className="mb-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1">
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                  <Text className="text-slate-400 text-sm flex-1">{row.label}</Text>
                </View>
                <View className="items-end">
                  <Text style={{ color: row.color }} className="text-sm font-bold">{fmtDollars(row.value)}/yr</Text>
                  <Text className="text-slate-600 text-xs">{fmtDollars(Math.round(row.value / 12))}/mo</Text>
                </View>
              </View>
              {row.inIncome && (
                <View className="flex-row items-center gap-1.5 mt-1 ml-4">
                  <CheckCircle2 size={11} color="#22c55e" />
                  <Text className="text-green-400 text-xs">Included in income projection</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(167,139,250,0.15)" }} className="px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-300 text-sm font-bold">Total Optional Withdrawals</Text>
            <Text className="text-violet-300 text-sm font-bold">{fmtDollars(totalOptional)}/yr</Text>
          </View>
          <Text className="text-slate-600 text-xs mt-1">= {fmtDollars(Math.round(totalOptional / 12))}/mo · at {swrPct}% SWR</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTAL RETIREMENT PICTURE CARD
// ─────────────────────────────────────────────────────────────────────────────

function TotalRetirementPictureCard({
  forecast,
  swrPct,
  taxPct,
  assets401kCents,
  assetsIRACents,
  assetsBrokerageCents,
  include401k,
  includeSS,
  ssMonthly,
}: {
  forecast: RetirementForecast;
  swrPct: number;
  taxPct: number;
  assets401kCents: number;
  assetsIRACents: number;
  assetsBrokerageCents: number;
  include401k: boolean;
  includeSS?: boolean;
  ssMonthly?: number; // cents, claim-age-adjusted
}) {
  const contractIncome = forecast.projectedTotalAnnualRetirementIncomeCents;
  const withdrawal401k = include401k ? Math.round(assets401kCents * swrPct / 100) : 0;
  const withdrawalIRA = Math.round(assetsIRACents * swrPct / 100);
  const withdrawalBrokerage = Math.round(assetsBrokerageCents * swrPct / 100);
  const totalOptionalWithdrawals = Math.round(assets401kCents * swrPct / 100) + withdrawalIRA + withdrawalBrokerage;

  const planBBalance = forecast.projectedPlanBBalanceCents;
  const totalAssets = planBBalance + assets401kCents + assetsIRACents + assetsBrokerageCents;

  const hasPersonalAssets = assets401kCents > 0 || assetsIRACents > 0 || assetsBrokerageCents > 0;

  const ssAnnual = (includeSS && ssMonthly) ? ssMonthly * 12 : 0;

  // Total income including optional 401k, SS if toggled
  const totalIncomeWithOptional = contractIncome + withdrawal401k + ssAnnual;
  const totalNetMonthly = Math.round(totalIncomeWithOptional / 12 * (1 - taxPct / 100));

  const includeLabel = [
    include401k ? "contract + 401k" : "contract only",
    includeSS && ssMonthly ? "+ SS" : null,
  ].filter(Boolean).join(" ");

  if (!hasPersonalAssets) return null;

  return (
    <Animated.View entering={FadeInDown.delay(92).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Target size={16} color="#22c55e" />
        <Text className="text-white text-base font-bold">Total Retirement Picture</Text>
      </View>

      <LinearGradient
        colors={["#0a1f14", "#0d1a2a", "#0a1220"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, borderWidth: 1, borderColor: "#22c55e18", overflow: "hidden" }}
      >
        {/* Contract income row */}
        <View className="px-4 pt-4 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
          <View className="flex-row items-center justify-between mb-0.5">
            <View className="flex-row items-center gap-2">
              <ShieldCheck size={13} color="#22c55e" />
              <Text className="text-slate-400 text-sm">Contract Retirement Income</Text>
            </View>
            <Text className="text-green-400 text-sm font-bold">{fmtDollars(contractIncome)}/yr</Text>
          </View>
          <Text className="text-slate-600 text-xs ml-5">Plan A Pension + Plan B Withdrawal · CBA 2023–2028</Text>
        </View>

        {/* Optional withdrawals row */}
        <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
          <View className="flex-row items-center justify-between mb-0.5">
            <View className="flex-row items-center gap-2">
              <TrendingUp size={13} color="#a78bfa" />
              <Text className="text-slate-400 text-sm">Optional Asset Withdrawals</Text>
            </View>
            <Text className="text-violet-400 text-sm font-bold">{fmtDollars(totalOptionalWithdrawals)}/yr</Text>
          </View>
          <Text className="text-slate-600 text-xs ml-5">401(k) + IRA + Brokerage at {swrPct}% SWR · personal estimate</Text>
        </View>

        {/* SS row — only when enabled */}
        {includeSS && ssMonthly ? (
          <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
            <View className="flex-row items-center justify-between mb-0.5">
              <View className="flex-row items-center gap-2">
                <Users size={13} color="#22c55e" />
                <Text className="text-slate-400 text-sm">Social Security (Est.)</Text>
              </View>
              <Text className="text-green-400 text-sm font-bold">{fmtDollars(ssAnnual)}/yr</Text>
            </View>
            <Text className="text-slate-600 text-xs ml-5">Auto estimate · long-career airline pilot</Text>
          </View>
        ) : null}

        {/* Total assets row */}
        <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
          <View className="flex-row items-center justify-between mb-0.5">
            <View className="flex-row items-center gap-2">
              <BarChart3 size={13} color="#f59e0b" />
              <Text className="text-slate-400 text-sm">Total Retirement Assets</Text>
            </View>
            <Text className="text-amber-400 text-sm font-bold">{fmtDollars(totalAssets)}</Text>
          </View>
          <Text className="text-slate-600 text-xs ml-5">Plan B + all personal accounts</Text>
        </View>

        {/* Net monthly estimate */}
        <View className="px-4 py-4">
          <Text className="text-slate-500 text-xs mb-1">
            Est. Net Monthly ({includeLabel})
          </Text>
          <Text className="text-white font-bold" style={{ fontSize: 30 }}>
            {fmtDollarsLong(totalNetMonthly)}/mo
          </Text>
          <Text className="text-slate-600 text-xs mt-0.5">after ~{taxPct}% estimated taxes</Text>
          {!include401k && assets401kCents > 0 && (
            <View className="flex-row items-center gap-1.5 mt-2">
              <Info size={11} color="#475569" />
              <Text className="text-slate-600 text-xs">Enable "Include 401(k)" in Edit to add it to income</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME PAYOUTS CARD
// ─────────────────────────────────────────────────────────────────────────────

function OneTimePayoutsCard({
  forecast,
  sickLeaveHours,
  onChangeSickLeaveHours,
}: {
  forecast: RetirementForecast;
  sickLeaveHours: number | null;
  onChangeSickLeaveHours: (h: number | null) => void;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <Animated.View entering={FadeInDown.delay(90).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Star size={16} color="#94a3b8" />
        <Text className="text-white text-base font-bold">One-Time Payouts</Text>
      </View>

      <View className="rounded-2xl border border-slate-700/30 overflow-hidden" style={{ backgroundColor: "#111827" }}>
        <Pressable
          onPress={() => { setShowModal(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          className="px-4 py-4"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-8 h-8 rounded-xl bg-slate-700/60 items-center justify-center">
                <Star size={15} color="#94a3b8" />
              </View>
              <View>
                <Text className="text-white text-sm font-semibold">Sick Leave Payout</Text>
                <Text className="text-slate-500 text-xs">
                  {forecast.sickLeaveEstimatedPayoutCents > 0
                    ? `Est. ${fmtDollarsLong(forecast.sickLeaveEstimatedPayoutCents)} at retirement`
                    : "Enter sick bank hours to estimate"}
                </Text>
              </View>
            </View>
            <View className="items-end">
              {forecast.sickLeaveEstimatedPayoutCents > 0 ? (
                <Text className="text-slate-300 text-sm font-bold">{fmtDollars(forecast.sickLeaveEstimatedPayoutCents)}</Text>
              ) : (
                <ChevronRight size={16} color="#64748b" />
              )}
            </View>
          </View>
        </Pressable>

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
        <View className="px-4 py-3 flex-row items-start gap-2">
          <AlertTriangle size={12} color="#64748b" style={{ marginTop: 2 }} />
          <Text className="text-slate-600 text-xs flex-1 leading-4">
            One-time payout only. NEVER included in annual retirement income totals. Consult UPS HR for your actual sick bank balance and payout rules.
          </Text>
        </View>
      </View>

      {/* Sick leave input modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
          <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
            <Text className="text-white text-lg font-bold">Sick Leave Payout</Text>
            <Pressable onPress={() => setShowModal(false)} className="w-8 h-8 items-center justify-center">
              <X size={20} color="#94a3b8" />
            </Pressable>
          </View>
          <ScrollView className="flex-1 px-6 pt-6">
            <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6">
              <Text className="text-amber-400 font-semibold text-sm mb-1">One-time payout only</Text>
              <Text className="text-slate-400 text-sm leading-5">
                Sick leave payout happens once at retirement. It is never counted as annual retirement income. Enter your estimated sick bank hours to see a rough estimate.
              </Text>
            </View>
            <Text className="text-slate-300 text-sm font-semibold mb-2">Sick Bank Hours (optional)</Text>
            <TextInput
              value={sickLeaveHours != null ? String(sickLeaveHours) : ""}
              onChangeText={(t) => {
                const n = parseInt(t.replace(/[^0-9]/g, ""));
                onChangeSickLeaveHours(isNaN(n) ? null : n);
              }}
              keyboardType="number-pad"
              placeholder="e.g. 1200"
              placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3.5 text-white text-base mb-4 border border-slate-700"
            />
            {forecast.sickLeaveEstimatedPayoutCents > 0 && (
              <View className="bg-slate-800/60 rounded-xl p-4">
                <Text className="text-slate-400 text-sm">Estimated one-time payout</Text>
                <Text className="text-white font-bold text-xl mt-1">{fmtDollarsLong(forecast.sickLeaveEstimatedPayoutCents)}</Text>
                <Text className="text-slate-500 text-xs mt-1">Based on hourly rate at retirement from pay table</Text>
              </View>
            )}
            <Pressable onPress={() => setShowModal(false)} className="bg-amber-500 rounded-2xl py-4 items-center mt-6">
              <Text className="text-slate-900 font-bold text-base">Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTHCARE COVERAGE SUMMARY CARD
// ─────────────────────────────────────────────────────────────────────────────

function HealthcareCoverageCard({
  forecast,
  hraParticipants,
  onChangeParticipants,
}: {
  forecast: RetirementForecast;
  hraParticipants: number;
  onChangeParticipants: (n: number) => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  // Per-participant rate from contract × participants for total benefit display
  const hraPerParticipant = HRA_ANNUAL_POST_RETIRE_CENTS; // $6,250/yr per participant
  const hraAnnual = hraPerParticipant * hraParticipants;
  const hraMonthly = Math.round(hraAnnual / 12);
  const stopsAtMedicare = forecast.hraStopsAtMedicare;
  const medicareAge = forecast.medicareEligibilityAge;

  return (
    <Animated.View entering={FadeInDown.delay(95).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Heart size={16} color="#38bdf8" />
        <Text className="text-white text-base font-bold">Medical Coverage</Text>
        <View className="bg-sky-500/20 rounded-full px-2 py-0.5 ml-1">
          <Text className="text-sky-400 text-xs font-bold">Not Cash</Text>
        </View>
      </View>

      <View className="rounded-2xl border border-sky-500/20 overflow-hidden" style={{ backgroundColor: "#07131c" }}>
        {/* HRA benefit display */}
        <View className="px-4 pt-4 pb-3">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-slate-400 text-sm">HRA Annual Benefit</Text>
            <Pressable onPress={() => setShowTooltip(!showTooltip)} className="w-7 h-7 items-center justify-center">
              <Info size={14} color="#64748b" />
            </Pressable>
          </View>
          <Text className="text-sky-400 font-bold" style={{ fontSize: 26 }}>
            {fmtDollarsLong(hraAnnual)}/yr
          </Text>
          <Text className="text-slate-500 text-xs mt-0.5">
            ≈ {fmtDollarsLong(hraMonthly)}/mo — medical reimbursement only, not spendable cash
          </Text>

          {showTooltip && (
            <Animated.View entering={FadeIn} className="bg-slate-800 rounded-xl p-3 mt-3">
              <Text className="text-slate-300 text-xs leading-4">
                The HRA (Health Reimbursement Account) provides ${(6250).toLocaleString()}/yr per participant for retiree medical expenses. It is NOT spendable cash — it reimburses eligible healthcare costs only. This amount is excluded from your retirement paycheck but shown here as a benefits supplement.
              </Text>
            </Animated.View>
          )}
        </View>

        {/* Participants selector */}
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(56,189,248,0.1)" }} className="px-4 py-3">
          <Text className="text-slate-400 text-sm mb-2">Participants</Text>
          <View className="flex-row gap-2">
            {[1, 2, 3].map((n) => (
              <Pressable
                key={n}
                onPress={() => { onChangeParticipants(n); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                className="flex-1 py-2.5 rounded-xl items-center border"
                style={{
                  backgroundColor: hraParticipants === n ? "#0e2733" : "#111827",
                  borderColor: hraParticipants === n ? "#38bdf8" : "#1e293b",
                }}
              >
                <Text style={{ color: hraParticipants === n ? "#38bdf8" : "#64748b", fontWeight: "700", fontSize: 14 }}>{n}</Text>
                <Text style={{ color: hraParticipants === n ? "#7dd3fc" : "#475569", fontSize: 10 }}>
                  {n === 1 ? "Self" : n === 2 ? "Spouse" : "+Family"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-slate-600 text-xs mt-2">
            ${(6250 * hraParticipants).toLocaleString()}/yr total for {hraParticipants} participant{hraParticipants > 1 ? "s" : ""}
          </Text>
        </View>

        {/* Medicare note */}
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(56,189,248,0.1)" }} className="px-4 py-3 flex-row items-start gap-2">
          <Info size={12} color="#475569" style={{ marginTop: 2 }} />
          <Text className="text-slate-500 text-xs flex-1 leading-4">
            {stopsAtMedicare
              ? `Benefit stops at Medicare eligibility (age ${medicareAge}). Plan accordingly for post-Medicare healthcare costs.`
              : `Medicare cutoff disabled — benefit projected through retirement. Edit assumptions to change.`}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAN I RETIRE AT 60? READINESS CARD
// ─────────────────────────────────────────────────────────────────────────────

function RetirementReadinessCard({
  multiForecasts,
  taxPct,
  swrPct,
  selectedAge,
  includeSS,
  ssMonthlyForAge,
  ssClaimAge,
}: {
  multiForecasts: Record<number, RetirementForecast>;
  taxPct: number;
  swrPct: number;
  selectedAge: number;
  includeSS?: boolean;
  ssMonthlyForAge?: (scenarioAge: number) => number;
  ssClaimAge?: 62 | 67 | 70;
}) {
  const fcSelected = multiForecasts[selectedAge] ?? multiForecasts[60];
  if (!fcSelected) return null;

  // Use ssClaimAge so SS is included even when retirement age < claim age
  const effectiveSsAge = ssClaimAge ?? selectedAge;
  const ssAddCents = includeSS && ssMonthlyForAge ? ssMonthlyForAge(effectiveSsAge) * 12 : 0;
  const grossMonthly60 = Math.round((fcSelected.projectedTotalAnnualRetirementIncomeCents + ssAddCents) / 12);
  const netMonthly60 = Math.round(grossMonthly60 * (1 - taxPct / 100));
  // netMonthly60 is in cents (same unit as LIFESTYLE_THRESHOLDS.monthlyNet)
  const netMonthly60Cents = netMonthly60;

  // Find highest lifestyle supported
  let lifestyleIdx = -1;
  for (let i = LIFESTYLE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (netMonthly60Cents >= LIFESTYLE_THRESHOLDS[i].monthlyNet) {
      lifestyleIdx = i;
      break;
    }
  }

  // Next level above current
  const nextLevel = LIFESTYLE_THRESHOLDS[lifestyleIdx + 1];
  const nextLevelGapCents = nextLevel ? nextLevel.monthlyNet - netMonthly60Cents : 0;

  // Determine status: YES / MAYBE / NOT YET
  // YES = meets at least Middle Class comfortably (index >= 0 AND not within 15% of threshold)
  // MAYBE = within 15% below Middle Class OR meets threshold but barely
  const middleClassThreshold = LIFESTYLE_THRESHOLDS[0].monthlyNet;
  const maybeRange = Math.round(middleClassThreshold * 0.85); // 85% of threshold
  const meetsMiddleClass = netMonthly60Cents >= middleClassThreshold;
  const closeToMiddleClass = netMonthly60Cents >= maybeRange && netMonthly60Cents < middleClassThreshold;

  type ReadinessStatus = "YES" | "MAYBE" | "NOT_YET";
  const readinessStatus: ReadinessStatus = meetsMiddleClass ? "YES" : closeToMiddleClass ? "MAYBE" : "NOT_YET";

  // Longevity risk from SWR
  const longevityRisk = swrPct <= 4 ? { label: "Low", color: "#22c55e" }
    : swrPct <= 5 ? { label: "Moderate", color: "#f59e0b" }
    : { label: "High", color: "#ef4444" };

  // Status config
  const statusConfig = readinessStatus === "YES"
    ? { label: "YES", sublabel: "Comfortable", color: "#22c55e", bg: "#166534", gradientColors: ["#0d2318", "#0a1a0d"] as [string, string], borderColor: "#22c55e25", icon: <CheckCircle2 size={20} color="#22c55e" /> }
    : readinessStatus === "MAYBE"
    ? { label: "MAYBE", sublabel: "Depends on lifestyle", color: "#f59e0b", bg: "#451a03", gradientColors: ["#1a1200", "#0f0d00"] as [string, string], borderColor: "#f59e0b25", icon: <AlertTriangle size={20} color="#f59e0b" /> }
    : { label: "NOT YET", sublabel: "Income shortfall", color: "#ef4444", bg: "#7f1d1d", gradientColors: ["#1a0d0d", "#0f0a0a"] as [string, string], borderColor: "#ef444425", icon: <AlertCircle size={20} color="#ef4444" /> };

  // Financial independence age — scan across more ages
  const allAges = [55, 57, 58, 59, 60, 61, 62, 63, 65];
  let fiAge: number | null = null;
  for (const age of allAges) {
    const fc = multiForecasts[age];
    if (!fc) continue;
    const ssAdd = includeSS && ssMonthlyForAge ? ssMonthlyForAge(effectiveSsAge) * 12 : 0;
    const netMoCents = Math.round((fc.projectedTotalAnnualRetirementIncomeCents + ssAdd) / 12 * (1 - taxPct / 100));
    if (netMoCents >= LIFESTYLE_THRESHOLDS[0].monthlyNet) {
      fiAge = age;
      break;
    }
  }

  return (
    <Animated.View entering={FadeInDown.delay(100).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Flame size={16} color="#f59e0b" />
        <Text className="text-white text-base font-bold">Can I Retire at {selectedAge}?</Text>
      </View>

      <LinearGradient
        colors={statusConfig.gradientColors}
        style={{ borderRadius: 20, padding: 18, borderWidth: 1, borderColor: statusConfig.borderColor }}
      >
        {/* Status badge */}
        <View className="flex-row items-center gap-3 mb-4">
          {statusConfig.icon}
          <View>
            <View className="rounded-xl px-4 py-1.5 mb-0.5" style={{ backgroundColor: statusConfig.bg + "60" }}>
              <Text style={{ color: statusConfig.color, fontWeight: "800", fontSize: 18 }}>{statusConfig.label}</Text>
            </View>
            <Text className="text-slate-500 text-xs ml-1">{statusConfig.sublabel}</Text>
          </View>
        </View>

        {/* Net monthly at 60 */}
        <Text className="text-slate-500 text-xs mb-1">Est. Net Monthly at Age {selectedAge}</Text>
        <View className="flex-row items-baseline gap-2 mb-1">
          <Text className="font-bold" style={{ color: statusConfig.color, fontSize: 34 }}>
            {fmtDollarsLong(netMonthly60Cents)}/mo
          </Text>
        </View>
        <View className="flex-row items-center gap-2 mb-4">
          <Text className="text-slate-600 text-xs">Gross: {fmtDollarsLong(grossMonthly60)}/mo</Text>
          <Text className="text-slate-700 text-xs">·</Text>
          <Text className="text-slate-600 text-xs">{fmtDollarsLong(fcSelected.projectedTotalAnnualRetirementIncomeCents + ssAddCents)}/yr gross</Text>
        </View>

        {/* Lifestyle levels */}
        <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Lifestyle Level Supported</Text>
        <View className="gap-1.5 mb-4">
          {LIFESTYLE_THRESHOLDS.map((level, i) => {
            const met = netMonthly60Cents >= level.monthlyNet;
            const isTarget = i === lifestyleIdx;
            const isNext = nextLevel && i === lifestyleIdx + 1;
            return (
              <View key={level.label} className="flex-row items-center gap-2">
                <View className="w-4 h-4 rounded-full items-center justify-center" style={{ backgroundColor: met ? level.color + "30" : "#1e293b" }}>
                  {met ? <Check size={10} color={level.color} /> : <View className="w-1.5 h-1.5 rounded-full bg-slate-700" />}
                </View>
                <Text style={{ color: isTarget ? level.color : met ? "#94a3b8" : "#475569", fontWeight: isTarget ? "700" : "400", fontSize: 13 }}>
                  {level.label}
                </Text>
                <Text className="text-slate-600 text-xs ml-auto">{fmtDollars(level.monthlyNet)}/mo</Text>
                {isTarget && (
                  <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: level.color + "20" }}>
                    <Text style={{ color: level.color, fontSize: 9, fontWeight: "700" }}>YOU</Text>
                  </View>
                )}
                {isNext && !met && nextLevelGapCents > 0 && (
                  <Text className="text-slate-600 text-xs">{fmtDollars(nextLevelGapCents)} gap</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Longevity risk */}
        <View className="flex-row items-center justify-between pt-3" style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" }}>
          <View className="flex-row items-center gap-2">
            <Activity size={13} color={longevityRisk.color} />
            <Text className="text-slate-400 text-sm">Longevity Risk</Text>
          </View>
          <View className="rounded-full px-3 py-1" style={{ backgroundColor: longevityRisk.color + "20" }}>
            <Text style={{ color: longevityRisk.color, fontWeight: "700", fontSize: 12 }}>{longevityRisk.label}</Text>
          </View>
        </View>
        <Text className="text-slate-600 text-xs mt-1">SWR {swrPct}% — {swrPct <= 4 ? "≤4% = low depletion risk" : swrPct <= 5 ? "4–5% = moderate risk" : ">5% = high depletion risk"}</Text>

        {/* FI Age */}
        {fiAge != null && (
          <View className="flex-row items-center gap-2 mt-3 pt-3 border-t border-white/5">
            <Target size={12} color="#64748b" />
            <Text className="text-slate-500 text-xs flex-1">
              Est. Financial Independence Age: <Text className="text-slate-300 font-semibold">{fiAge}</Text>
              <Text className="text-slate-600"> (middle-class threshold — estimate only)</Text>
            </Text>
          </View>
        )}
        {fiAge === null && (
          <View className="flex-row items-center gap-2 mt-3 pt-3 border-t border-white/5">
            <Target size={12} color="#475569" />
            <Text className="text-slate-600 text-xs flex-1">
              Add your date of hire & date of birth in Edit to compute FI age
            </Text>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO SELECTOR (Age Chips)
// ─────────────────────────────────────────────────────────────────────────────

const RETIRE_AGES = [55, 60, 62, 65] as const;

function AgeScenarioSelector({
  multiForecasts,
  selectedAge,
  onSelectAge,
  taxPct,
  includeSS,
  ssMonthlyForAge,
  ssClaimAge,
}: {
  multiForecasts: Record<number, RetirementForecast>;
  selectedAge: number;
  onSelectAge: (age: number) => void;
  taxPct: number;
  includeSS?: boolean;
  ssMonthlyForAge?: (scenarioAge: number) => number;
  ssClaimAge?: 62 | 67 | 70;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(60).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Target size={16} color="#f59e0b" />
        <Text className="text-white text-base font-bold">Retirement Age Scenarios</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
        <View className="flex-row gap-2 px-1">
          {RETIRE_AGES.map((age) => {
            const fc = multiForecasts[age];
            const isSelected = selectedAge === age;
            // Use ssClaimAge so SS is always reflected when toggled on
            const effectiveSsAge = ssClaimAge ?? age;
            const ssAdd = includeSS && ssMonthlyForAge ? ssMonthlyForAge(effectiveSsAge) * 12 : 0;
            const grossMo = fc ? Math.round((fc.projectedTotalAnnualRetirementIncomeCents + ssAdd) / 12) : 0;
            const netMo = Math.round(grossMo * (1 - taxPct / 100));
            const isReduced = age === 55;

            return (
              <Pressable
                key={age}
                onPress={() => { onSelectAge(age); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <LinearGradient
                  colors={isSelected ? ["#1a3020", "#0f2018"] : ["#1a2540", "#131f35"]}
                  style={{
                    borderRadius: 18,
                    padding: 14,
                    width: 140,
                    borderWidth: 1,
                    borderColor: isSelected ? "#22c55e50" : "#334155",
                  }}
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="font-bold text-base" style={{ color: isSelected ? "#22c55e" : "#94a3b8" }}>
                      Age {age}
                    </Text>
                    {isSelected && <Check size={14} color="#22c55e" />}
                  </View>
                  {isReduced && (
                    <View className="bg-amber-500/20 rounded-full px-2 py-0.5 self-start mb-2">
                      <Text className="text-amber-400 text-xs font-bold">Reduced</Text>
                    </View>
                  )}
                  <Text className="font-bold text-sm" style={{ color: isSelected ? "#fff" : "#cbd5e1" }}>
                    {fmtDollarsLong(netMo)}/mo
                  </Text>
                  <Text className="text-slate-500 text-xs">est. net</Text>
                  <Text className="text-slate-600 text-xs mt-0.5">{fmtDollarsLong(grossMo)}/mo gross</Text>
                  <View className="mt-2 pt-2" style={{ borderTopWidth: 1, borderTopColor: isSelected ? "#22c55e20" : "#1e293b" }}>
                    <Text className="text-slate-600 text-xs">{fc?.yearsOfService ?? 0} YOS</Text>
                    <Text className="text-slate-600 text-xs">{fc?.yearsRemaining ?? 0} yrs away</Text>
                  </View>
                </LinearGradient>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAREER PATH TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

function CareerPathToggle({
  activeScenario,
  dualForecast,
  taxPct,
  onToggle,
}: {
  activeScenario: CareerPathScenario;
  dualForecast: DualScenarioForecast;
  taxPct: number;
  onToggle: (s: CareerPathScenario) => void;
}) {
  const isUpgrade = activeScenario === "UPGRADE_TO_CPT";
  const advantage = dualForecast.upgradeAdvantageCents;
  const foGrossAnnual = dualForecast.foOnly.projectedTotalAnnualRetirementIncomeCents;
  const upGrossAnnual = dualForecast.upgrade.projectedTotalAnnualRetirementIncomeCents;
  const foNet = Math.round(foGrossAnnual / 12 * (1 - taxPct / 100));
  const upNet = Math.round(upGrossAnnual / 12 * (1 - taxPct / 100));
  const advantageMonthly = upNet - foNet;
  const advantageAnnualNet = (upNet - foNet) * 12;

  return (
    <Animated.View entering={FadeInDown.delay(80).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center gap-2 mb-3">
        <Plane size={15} color="#f59e0b" />
        <Text className="text-white text-base font-bold">Career Path Impact</Text>
      </View>

      <View className="flex-row rounded-2xl p-1 mb-3" style={{ backgroundColor: "#1a2540" }}>
        <Pressable
          onPress={() => { onToggle("FO_ONLY"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={{ flex: 1 }}
          className={`py-2.5 rounded-xl items-center ${!isUpgrade ? "bg-sky-500" : ""}`}
        >
          <Text className={`text-sm font-semibold ${!isUpgrade ? "text-white" : "text-slate-400"}`}>FO Only</Text>
        </Pressable>
        <Pressable
          onPress={() => { onToggle("UPGRADE_TO_CPT"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={{ flex: 1 }}
          className={`py-2.5 rounded-xl items-center ${isUpgrade ? "bg-amber-500" : ""}`}
        >
          <Text className={`text-sm font-semibold ${isUpgrade ? "text-slate-900" : "text-slate-400"}`}>Upgrade to CPT</Text>
        </Pressable>
      </View>

      <View className="rounded-2xl border border-slate-700/30 overflow-hidden" style={{ backgroundColor: "#131f35" }}>
        {/* Side-by-side net monthly */}
        <View className="flex-row">
          <View className="flex-1 p-3 items-center" style={{ borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.06)" }}>
            <Text className="text-slate-500 text-xs mb-1">FO-Only</Text>
            <Text className="text-sky-400 font-bold text-sm">{fmtDollarsLong(foNet)}/mo</Text>
            <Text className="text-slate-600 text-xs">{fmtDollars(foGrossAnnual)}/yr gross</Text>
          </View>
          <View className="flex-1 p-3 items-center" style={{ borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.06)" }}>
            <Text className="text-slate-500 text-xs mb-1">Upgrade</Text>
            <Text className="text-amber-400 font-bold text-sm">{fmtDollarsLong(upNet)}/mo</Text>
            <Text className="text-slate-600 text-xs">{fmtDollars(upGrossAnnual)}/yr gross</Text>
          </View>
          <View className="flex-1 p-3 items-center">
            <Text className="text-slate-500 text-xs mb-1">Advantage</Text>
            <View className="flex-row items-center gap-0.5">
              <ArrowUpRight size={11} color={advantage >= 0 ? "#22c55e" : "#ef4444"} />
              <Text style={{ color: advantage >= 0 ? "#22c55e" : "#ef4444" }} className="font-bold text-sm">
                {advantage >= 0 ? "+" : ""}{fmtDollars(Math.abs(advantage))}/yr
              </Text>
            </View>
            <Text style={{ color: advantage >= 0 ? "#15803d" : "#b91c1c", fontSize: 10 }}>gross annual</Text>
          </View>
        </View>
        {advantageMonthly !== 0 && (
          <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }} className="px-4 py-2.5">
            <View className="flex-row items-center justify-center gap-2">
              <ArrowUpRight size={12} color={advantageMonthly > 0 ? "#22c55e" : "#ef4444"} />
              <Text className="text-slate-400 text-xs text-center">
                Upgrade advantage: <Text style={{ color: advantageMonthly > 0 ? "#22c55e" : "#ef4444", fontWeight: "700" }}>
                  {advantageMonthly > 0 ? "+" : ""}{fmtDollarsLong(Math.abs(advantageMonthly))}/mo
                </Text>
                {" "}net · <Text style={{ color: advantageMonthly > 0 ? "#22c55e" : "#ef4444", fontWeight: "700" }}>
                  {advantageAnnualNet > 0 ? "+" : ""}{fmtDollars(Math.abs(advantageAnnualNet))}/yr
                </Text>
                {" "}net
              </Text>
            </View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN B GROWTH CHART
// ─────────────────────────────────────────────────────────────────────────────

function PlanBGrowthChart({
  forecast,
  dualForecast,
}: {
  forecast: RetirementForecast;
  dualForecast?: DualScenarioForecast | null;
}) {
  const upgradeProjections = dualForecast ? dualForecast.upgrade.yearlyProjections : forecast.yearlyProjections;
  const foProjections = dualForecast ? dualForecast.foOnly.yearlyProjections : null;
  const projections = upgradeProjections;
  if (projections.length < 2) return null;

  const maxVal = Math.max(
    ...projections.map((p) => p.cumulativePlanBCents),
    ...(foProjections ? foProjections.map((p) => p.cumulativePlanBCents) : [0])
  );

  function toX(i: number, len: number) { return (i / (len - 1)) * GRAPH_WIDTH; }
  function toY(val: number, max: number) {
    if (max === 0) return GRAPH_HEIGHT;
    return GRAPH_HEIGHT - (val / max) * (GRAPH_HEIGHT - 12);
  }

  const upgradePoints = projections.map((p, i) => ({ x: toX(i, projections.length), y: toY(p.cumulativePlanBCents, maxVal) }));
  const foPoints = foProjections
    ? foProjections.map((p, i) => ({ x: toX(i, foProjections.length), y: toY(p.cumulativePlanBCents, maxVal) }))
    : null;
  const labelYears = projections.filter((_, i) => i % Math.max(1, Math.floor(projections.length / 5)) === 0);
  const upgradeIdx = projections.findIndex((p) => p.seatType === "CAPTAIN");

  return (
    <Animated.View entering={FadeInDown.delay(120).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-slate-300 text-sm font-semibold">Plan B Retirement Account Growth</Text>
        <View className="flex-row gap-3">
          {dualForecast ? (
            <>
              <View className="flex-row items-center gap-1.5">
                <View className="w-6 h-1.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
                <Text className="text-slate-500 text-xs">Upgrade</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View className="w-6 h-1.5 rounded-full" style={{ backgroundColor: "#38bdf8", opacity: 0.8 }} />
                <Text className="text-slate-500 text-xs">FO only</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      <View
        className="rounded-2xl overflow-hidden border border-slate-700/30"
        style={{ backgroundColor: "#131f35", height: GRAPH_HEIGHT + 48 }}
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <View key={fraction} style={{ position: "absolute", left: 0, right: 0, top: toY(maxVal * fraction, maxVal) + 4, height: 1, backgroundColor: "rgba(255,255,255,0.04)" }} />
        ))}
        {upgradeIdx > 0 && upgradePoints[upgradeIdx] && (
          <View style={{ position: "absolute", left: upgradePoints[upgradeIdx].x + 6, top: 4, bottom: 24, width: 1, backgroundColor: "rgba(245,158,11,0.5)" }} />
        )}
        {foPoints && foPoints.map((pt, i) => {
          if (i === 0) return null;
          const prev = foPoints[i - 1];
          const dx = pt.x - prev.x; const dy = pt.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={`fo-${i}`} style={{ position: "absolute", left: prev.x + 6, top: prev.y + 4, width: len, height: 2, backgroundColor: "#38bdf8", opacity: 0.7, borderRadius: 1, transform: [{ rotate: `${angle}deg` }], transformOrigin: "left center" }} />
          );
        })}
        {upgradePoints.map((pt, i) => {
          if (i === 0) return null;
          const prev = upgradePoints[i - 1];
          const dx = pt.x - prev.x; const dy = pt.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View key={i} style={{ position: "absolute", left: prev.x + 6, top: prev.y + 4, width: len, height: 2, backgroundColor: "#f59e0b", opacity: 0.9, borderRadius: 1, transform: [{ rotate: `${angle}deg` }], transformOrigin: "left center" }} />
          );
        })}
        <View style={{ position: "absolute", bottom: 8, left: 8, right: 8, flexDirection: "row", justifyContent: "space-between" }}>
          {labelYears.map((p) => (<Text key={p.year} style={{ color: "#64748b", fontSize: 10 }}>{p.year}</Text>))}
        </View>
        <View style={{ position: "absolute", top: 8, right: 10 }}>
          <Text style={{ color: "#f59e0b", fontSize: 11, fontWeight: "700" }}>{fmtDollars(maxVal)}</Text>
        </View>
        {upgradeIdx > 0 && upgradePoints[upgradeIdx] && (
          <View style={{ position: "absolute", left: upgradePoints[upgradeIdx].x + 9, top: 8 }}>
            <Text style={{ color: "#f59e0b80", fontSize: 9 }}>CPT</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL SECURITY CARD
// ─────────────────────────────────────────────────────────────────────────────

function SocialSecurityCard({
  enabled,
  onToggle,
  claimAge,
  onClaimAgeChange,
  monthlyAt67Cents,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  claimAge: 62 | 67 | 70;
  onClaimAgeChange: (age: 62 | 67 | 70) => void;
  monthlyAt67Cents: number;
}) {
  // Hardcoded default estimates matching main state constants
  const ssAt62 = 270000;  // $2,700/mo
  const ssAt67 = monthlyAt67Cents; // $3,850/mo (passed in)
  const ssAt70 = 477000;  // $4,770/mo
  const currentMonthly = claimAge === 62 ? ssAt62 : claimAge === 70 ? ssAt70 : ssAt67;

  const claimOptions: { age: 62 | 67 | 70; label: string; sublabel: string; color: string }[] = [
    { age: 62, label: "62", sublabel: "Reduced", color: "#f59e0b" },
    { age: 67, label: "67", sublabel: "Full", color: "#22c55e" },
    { age: 70, label: "70", sublabel: "Maximum", color: "#a78bfa" },
  ];

  return (
    <Animated.View entering={FadeInDown.delay(65).springify()} className="mx-6 mt-5">
      <View className="rounded-2xl border border-slate-700/30 overflow-hidden" style={{ backgroundColor: "#111827" }}>
        {/* Toggle row */}
        <View className="px-4 py-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: "#22c55e15" }}>
                <Users size={16} color="#22c55e" />
              </View>
              <View>
                <Text className="text-white text-sm font-semibold">Include Social Security</Text>
                <Text className="text-slate-500 text-xs mt-0.5">Optional non-UPS retirement income</Text>
              </View>
            </View>
            <Switch
              value={enabled}
              onValueChange={(v) => { onToggle(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ true: "#22c55e", false: "#334155" }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {enabled && (
          <>
            {/* Auto-estimated amount display */}
            <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }} className="px-4 py-3">
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                Monthly Estimate at Age {claimAge} {claimAge === 62 ? "(Reduced)" : claimAge === 70 ? "(Maximum)" : "(Full)"}
              </Text>
              <View
                style={{
                  backgroundColor: "#1a2035",
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: "#22c55e40",
                  marginBottom: 6,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
                  ${(Math.round(currentMonthly / 100)).toLocaleString()}
                </Text>
                <View style={{ backgroundColor: "#22c55e20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: "#22c55e", fontSize: 10, fontWeight: "600" }}>AUTO ESTIMATE</Text>
                </View>
              </View>
              <Text className="text-slate-600 text-xs">Based on typical long-career airline pilot earnings</Text>
            </View>

            {/* Claim age selector */}
            <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }} className="px-4 py-3">
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Claim Age</Text>
              <View className="flex-row gap-2">
                {claimOptions.map((opt) => (
                  <Pressable
                    key={opt.age}
                    onPress={() => { onClaimAgeChange(opt.age); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    className="flex-1 py-3 rounded-xl items-center border"
                    style={{
                      backgroundColor: claimAge === opt.age ? `${opt.color}15` : "#1a2035",
                      borderColor: claimAge === opt.age ? opt.color : "#1e293b",
                    }}
                  >
                    <Text style={{ color: claimAge === opt.age ? opt.color : "#64748b", fontWeight: "700", fontSize: 15 }}>
                      {opt.label}
                    </Text>
                    <Text style={{ color: claimAge === opt.age ? opt.color : "#475569", fontSize: 11, marginTop: 2 }}>
                      {opt.sublabel}
                    </Text>
                    <Text style={{ color: claimAge === opt.age ? opt.color : "#374151", fontSize: 10, marginTop: 3 }}>
                      {fmtDollarsLong(opt.age === 62 ? ssAt62 : opt.age === 70 ? ssAt70 : ssAt67)}/mo
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Current SS amount display */}
            {monthlyAt67Cents > 0 && (
              <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }} className="px-4 py-3">
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-slate-400 text-sm">Social Security (Est.)</Text>
                    <Text className="text-slate-600 text-xs mt-0.5">
                      {claimAge === 62 ? "Reduced — early claim" : claimAge === 70 ? "Maximum — delayed credits" : "Full retirement estimate"}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-green-400 text-sm font-bold">{fmtDollarsLong(currentMonthly)}/mo</Text>
                    <Text className="text-slate-600 text-xs">{fmtDollars(currentMonthly * 12)}/yr</Text>
                  </View>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSUMPTIONS EDIT MODAL
// ─────────────────────────────────────────────────────────────────────────────

function AssumptionsModal({
  visible,
  onClose,
  profile,
  pilotProfile,
  taxPct,
  hraParticipants,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  profile: RetirementProfile;
  pilotProfile: ReturnType<typeof useProfile>;
  taxPct: number;
  hraParticipants: number;
  onSave: (updates: Partial<RetirementProfile>, tax: number, participants: number) => void;
}) {
  const [dob, setDob] = useState(profile.dob ?? pilotProfile?.dateOfBirth ?? "");
  const [doh, setDoh] = useState(profile.doh ?? pilotProfile?.dateOfHire ?? "");
  const [retireAge, setRetireAge] = useState(String(profile.retirementAge));
  const [earningsBasis, setEarningsBasis] = useState<EarningsBasis>(profile.earningsBasis);
  const [upgradeYear, setUpgradeYear] = useState(profile.expectedUpgradeYear ? String(profile.expectedUpgradeYear) : "");
  const [growthRate, setGrowthRate] = useState(String(profile.planBGrowthRatePct ?? 5));
  const [swr, setSwr] = useState(String(profile.safeWithdrawalRatePct ?? 4));
  const [localTax, setLocalTax] = useState(String(taxPct));
  const [participants, setParticipants] = useState(String(hraParticipants));
  const [stopMedicare, setStopMedicare] = useState(profile.stopHRAAtMedicare ?? true);
  const [medicareAge, setMedicareAge] = useState(String(profile.medicareEligibilityAge ?? 65));
  const [include401k, setInclude401k] = useState(profile.include401kInRetirementIncome ?? false);

  const derivedUpgradeYear = doh
    ? new Date(doh).getFullYear() + DEFAULT_UPGRADE_YEARS_FROM_DOH
    : new Date().getFullYear() + DEFAULT_UPGRADE_YEARS_FROM_DOH;

  const handleSave = useCallback(() => {
    onSave(
      {
        dob: dob || null,
        doh: doh || null,
        retirementAge: parseInt(retireAge) || 65,
        earningsBasis,
        expectedUpgradeYear: upgradeYear ? parseInt(upgradeYear) : null,
        planBGrowthRatePct: parseFloat(growthRate) || 5,
        safeWithdrawalRatePct: parseFloat(swr) || 4,
        stopHRAAtMedicare: stopMedicare,
        medicareEligibilityAge: parseInt(medicareAge) || 65,
        include401kInRetirementIncome: include401k,
      },
      parseInt(localTax) || 30,
      parseInt(participants) || 1
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  }, [dob, doh, retireAge, earningsBasis, upgradeYear, growthRate, swr, localTax, participants, stopMedicare, medicareAge, include401k]);

  const basisOptions: { key: EarningsBasis; label: string; desc: string }[] = [
    { key: "GUAR", label: "Guarantee", desc: "975 hrs/yr baseline" },
    { key: "LINE", label: "Avg Line", desc: "~1,018 hrs/yr" },
    { key: "TOTAL", label: "Avg Total", desc: "With OT + premiums" },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
          <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
            <View className="flex-row items-center gap-2">
              <Edit3 size={18} color="#f59e0b" />
              <Text className="text-white text-lg font-bold">Edit Assumptions</Text>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 items-center justify-center">
              <X size={20} color="#94a3b8" />
            </Pressable>
          </View>

          <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingVertical: 24 }} keyboardShouldPersistTaps="handled">

            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Profile</Text>
            <View className="gap-3 mb-6">
              <View>
                <Text className="text-slate-300 text-sm mb-1.5">Date of Birth</Text>
                <TextInput value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor="#475569"
                  className="bg-slate-800 rounded-xl px-4 py-3 text-white text-sm border border-slate-700" />
              </View>
              <View>
                <Text className="text-slate-300 text-sm mb-1.5">Date of Hire</Text>
                <TextInput value={doh} onChangeText={setDoh} placeholder="YYYY-MM-DD" placeholderTextColor="#475569"
                  className="bg-slate-800 rounded-xl px-4 py-3 text-white text-sm border border-slate-700" />
              </View>
              <View>
                <Text className="text-slate-300 text-sm mb-2">Target Retirement Age</Text>
                <View className="flex-row gap-2">
                  {[55, 60, 62, 65].map((age) => (
                    <Pressable key={age} onPress={() => setRetireAge(String(age))}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${retireAge === String(age) ? "bg-amber-500 border-amber-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-sm font-semibold ${retireAge === String(age) ? "text-slate-900" : "text-slate-400"}`}>{age}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Career</Text>
            <View className="gap-3 mb-6">
              <View>
                <Text className="text-slate-300 text-sm mb-2">Earnings Basis</Text>
                <View className="flex-row gap-2">
                  {basisOptions.map((opt) => (
                    <Pressable key={opt.key} onPress={() => setEarningsBasis(opt.key)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${earningsBasis === opt.key ? "bg-amber-500/20 border-amber-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-xs font-semibold ${earningsBasis === opt.key ? "text-amber-400" : "text-slate-400"}`}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Text className="text-slate-300 text-sm mb-1.5">Expected Upgrade Year</Text>
                <TextInput value={upgradeYear} onChangeText={setUpgradeYear} keyboardType="number-pad"
                  placeholder={`Default: ${derivedUpgradeYear} (DOH+7)`} placeholderTextColor="#475569"
                  className="bg-slate-800 rounded-xl px-4 py-3 text-white text-sm border border-slate-700" />
              </View>
            </View>

            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Financial Assumptions</Text>
            <View className="gap-3 mb-6">
              <View>
                <Text className="text-slate-300 text-sm mb-2">Plan B Growth Rate (%)</Text>
                <View className="flex-row gap-2">
                  {["3", "5", "7"].map((r) => (
                    <Pressable key={r} onPress={() => setGrowthRate(r)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${growthRate === r ? "bg-amber-500 border-amber-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-sm font-semibold ${growthRate === r ? "text-slate-900" : "text-slate-400"}`}>{r}%</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Text className="text-slate-300 text-sm mb-2">Safe Withdrawal Rate (%)</Text>
                <View className="flex-row gap-2">
                  {["3", "4", "5"].map((r) => (
                    <Pressable key={r} onPress={() => setSwr(r)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${swr === r ? "bg-amber-500 border-amber-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-sm font-semibold ${swr === r ? "text-slate-900" : "text-slate-400"}`}>{r}%</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View>
                <Text className="text-slate-300 text-sm mb-2">Tax Estimate (%)</Text>
                <View className="flex-row gap-2">
                  {["25", "30", "35"].map((t) => (
                    <Pressable key={t} onPress={() => setLocalTax(t)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${localTax === t ? "bg-amber-500 border-amber-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-sm font-semibold ${localTax === t ? "text-slate-900" : "text-slate-400"}`}>{t}%</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">HRA / Medical</Text>
            <View className="gap-3 mb-6">
              <View>
                <Text className="text-slate-300 text-sm mb-2">HRA Participants</Text>
                <View className="flex-row gap-2">
                  {["1", "2", "3"].map((p) => (
                    <Pressable key={p} onPress={() => setParticipants(p)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${participants === p ? "bg-sky-500/30 border-sky-500" : "bg-slate-800 border-slate-700"}`}>
                      <Text className={`text-sm font-semibold ${participants === p ? "text-sky-300" : "text-slate-400"}`}>{p}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text className="text-slate-600 text-xs mt-1">Participant, spouse, or dependents</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-slate-300 text-sm font-semibold">Stop HRA at Medicare</Text>
                  <Text className="text-slate-500 text-xs">Benefit stops at eligibility age</Text>
                </View>
                <Switch value={stopMedicare} onValueChange={setStopMedicare} trackColor={{ true: "#38bdf8", false: "#334155" }} thumbColor="#fff" />
              </View>
              {stopMedicare && (
                <View>
                  <Text className="text-slate-300 text-sm mb-1.5">Medicare Eligibility Age</Text>
                  <TextInput value={medicareAge} onChangeText={setMedicareAge} keyboardType="number-pad"
                    placeholder="65" placeholderTextColor="#475569"
                    className="bg-slate-800 rounded-xl px-4 py-3 text-white text-sm border border-slate-700" />
                </View>
              )}
            </View>

            <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">Personal Assets</Text>
            <View className="gap-3 mb-6">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <Text className="text-slate-300 text-sm font-semibold">Include 401(k) in Retirement Income</Text>
                  <Text className="text-slate-500 text-xs mt-0.5">Adds 401(k) SWR withdrawal to income projection. Off by default — contract benefits remain the primary income source.</Text>
                </View>
                <Switch value={include401k} onValueChange={setInclude401k} trackColor={{ true: "#a78bfa", false: "#334155" }} thumbColor="#fff" />
              </View>
              {include401k && (
                <View className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-3 py-2.5">
                  <Text className="text-violet-300 text-xs leading-4">
                    When enabled, your 401(k) balance × SWR will be added to total retirement income projections. Enter your balance in the Retirement Assets section.
                  </Text>
                </View>
              )}
            </View>

          </ScrollView>

          <View className="px-6 pb-10 pt-4 border-t border-slate-800">
            <Pressable onPress={handleSave} className="bg-amber-500 rounded-2xl py-4 items-center">
              <Text className="text-slate-900 font-bold text-base">Save Assumptions</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT VERSION BADGE
// ─────────────────────────────────────────────────────────────────────────────

function ContractVersionBadge({ forecast }: { forecast: RetirementForecast }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Animated.View entering={FadeInDown.delay(50)} className="mx-6 mt-5">
      <Pressable
        onPress={() => { setExpanded(!expanded); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/30"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <ShieldCheck size={16} color="#22c55e" />
            <Text className="text-slate-300 text-sm font-semibold">Contract Engine</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="bg-green-500/20 rounded-full px-2.5 py-0.5">
              <Text className="text-green-400 text-xs font-semibold">{forecast.rulesetVersion}</Text>
            </View>
            {expanded ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
          </View>
        </View>

        {expanded && (
          <Animated.View entering={FadeIn} className="mt-3 pt-3 border-t border-slate-700/30">
            {UPS_CONTRACT_RULES.map((rule, i) => (
              <View key={rule.contractVersion} className={`mb-3 pb-3 ${i < UPS_CONTRACT_RULES.length - 1 ? "border-b border-slate-700/20" : ""}`}>
                <View className="flex-row items-center justify-between mb-2">
                  <View>
                    <Text className="text-white text-sm font-bold">{rule.label}</Text>
                    <Text className="text-slate-500 text-xs">Effective {rule.effectiveDate}</Text>
                  </View>
                  <View className="bg-slate-700/60 rounded-xl px-2.5 py-1">
                    <Text className="text-amber-400 text-xs font-bold">{Math.round(rule.planBEmployerRate * 100)}% employer</Text>
                  </View>
                </View>
                <View className="gap-1">
                  <Text className="text-slate-500 text-xs">Plan B: {Math.round(rule.planBEmployerRate * 100)}% employer-only contribution</Text>
                  <Text className="text-slate-500 text-xs">Pension: MAX(1% × FAE × YOS, ${(rule.pensionFlatDollarCaptainPerYOS / 100).toLocaleString()}/YOS CPT)</Text>
                  <Text className="text-slate-500 text-xs">HRA post-retire: ${(rule.hraAnnualPostRetireCents / 100).toLocaleString()}/yr</Text>
                  <Text className="text-slate-500 text-xs">VEBA: ~$1/paid hour while working</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIOR EARNINGS MODAL
// ─────────────────────────────────────────────────────────────────────────────

function PriorEarningsModal({
  visible,
  onClose,
  onSave,
  onSkip,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (pe: PriorEarnings) => void;
  onSkip: () => void;
}) {
  const [years, setYears] = useState("0");
  const [avgIncome, setAvgIncome] = useState("");
  const [customContribs, setCustomContribs] = useState("");
  const [useCustomContribs, setUseCustomContribs] = useState(false);

  const handleSave = useCallback(() => {
    const pe: PriorEarnings = {
      priorYearsService: parseInt(years) || 0,
      averageAnnualIncomeCents: parseDollarInput(avgIncome),
      estimatedPlanBContributionsCents: useCustomContribs ? parseDollarInput(customContribs) : null,
    };
    onSave(pe);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [years, avgIncome, customContribs, useCustomContribs, onSave]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: "#0f172a" }}>
        <View className="flex-1 bg-slate-950">
          <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
            <Text className="text-white text-xl font-bold">Prior Career Earnings</Text>
            <Pressable onPress={onClose} className="w-8 h-8 items-center justify-center">
              <X size={20} color="#94a3b8" />
            </Pressable>
          </View>
          <ScrollView className="flex-1" contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6">
              <View className="flex-row items-center gap-2 mb-2">
                <Lightbulb size={16} color="#f59e0b" />
                <Text className="text-amber-400 font-semibold text-sm">Improve Accuracy</Text>
              </View>
              <Text className="text-slate-400 text-sm leading-5">
                Add years before app tracking to include your existing Plan B balance and pension credits.
              </Text>
            </View>
            <Text className="text-slate-300 text-sm font-semibold mb-2">Years of Service Before Tracking</Text>
            <TextInput value={years} onChangeText={setYears} keyboardType="number-pad" placeholder="e.g. 8" placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3.5 text-white text-base mb-5 border border-slate-700" />
            <Text className="text-slate-300 text-sm font-semibold mb-2">Average Annual Income During Those Years</Text>
            <TextInput value={avgIncome} onChangeText={setAvgIncome} keyboardType="decimal-pad" placeholder="$120,000" placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3.5 text-white text-base mb-5 border border-slate-700" />
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-slate-300 text-sm font-semibold">I know my Plan B balance</Text>
              <Switch value={useCustomContribs} onValueChange={setUseCustomContribs} trackColor={{ true: "#f59e0b", false: "#334155" }} thumbColor="#fff" />
            </View>
            {useCustomContribs && (
              <TextInput value={customContribs} onChangeText={setCustomContribs} keyboardType="decimal-pad"
                placeholder="Current Plan B balance ($)" placeholderTextColor="#475569"
                className="bg-slate-800 rounded-xl px-4 py-3.5 text-white text-base mb-5 border border-slate-700" />
            )}
            <Pressable onPress={handleSave} className="bg-amber-500 rounded-2xl py-4 items-center mb-3">
              <Text className="text-slate-900 font-bold text-base">Save Prior Earnings</Text>
            </Pressable>
            <Pressable onPress={onSkip} className="py-3 items-center">
              <Text className="text-slate-500 text-sm">Skip — use projected data only</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS DATA QUALITY BANNER
// ─────────────────────────────────────────────────────────────────────────────

interface LifetimeEarningsYear {
  id: string;
  year: number;
  grossEarningsCents: number;
  source: "user" | "app";
  isFinalized: boolean;
  notes: string | null;
}

interface LifetimeEarningsResponse {
  config: { airline: string; startYear: number | null; priorYearsAdded: boolean } | null;
  years: LifetimeEarningsYear[];
  summary: {
    totalCareerEarningsCents: number;
    yearsActive: number;
    averageAnnualEarningsCents: number;
    currentYearEarningsCents: number;
    currentYearIsInProgress: boolean;
  };
  airline: string;
}

function EarningsDataBanner({
  earningsData,
  actualYearsCount,
  onNavigateToEarnings,
}: {
  earningsData: LifetimeEarningsResponse | undefined;
  actualYearsCount: number;
  onNavigateToEarnings?: () => void;
}) {
  const finalizedYears = earningsData?.years.filter((y) => y.isFinalized && y.grossEarningsCents > 0) ?? [];
  const hasNoData = finalizedYears.length === 0;
  const hasPartialData = finalizedYears.length > 0 && finalizedYears.length < 3;

  if (!hasNoData && !hasPartialData) return null;

  return (
    <Animated.View entering={FadeInDown.delay(20).springify()} className="mx-6 mt-4 mb-1">
      <Pressable
        onPress={() => { onNavigateToEarnings?.(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
        style={{
          backgroundColor: hasNoData ? "#1c1000" : "#12180a",
          borderRadius: 16,
          padding: 14,
          borderWidth: 1,
          borderColor: hasNoData ? "#f59e0b60" : "#22c55e40",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: hasNoData ? "#f59e0b18" : "#22c55e18",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasNoData
            ? <AlertTriangle size={18} color="#f59e0b" />
            : <Activity size={18} color="#22c55e" />
          }
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: hasNoData ? "#fbbf24" : "#86efac", fontSize: 13, fontWeight: "700", marginBottom: 2 }}>
            {hasNoData ? "Improve accuracy — add real earnings" : `${finalizedYears.length} year${finalizedYears.length > 1 ? "s" : ""} of real data`}
          </Text>
          <Text style={{ color: "#64748b", fontSize: 11, lineHeight: 16 }}>
            {hasNoData
              ? "Pension FAE uses pay-table estimates. Add year-by-year earnings for a more accurate forecast."
              : `${3 - finalizedYears.length} more year${3 - finalizedYears.length > 1 ? "s" : ""} would unlock High Confidence. Tap to add historical earnings.`}
          </Text>
        </View>
        <ChevronRight size={16} color={hasNoData ? "#f59e0b" : "#4ade80"} />
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS YEAR LEDGER CARD (shows which years are real vs projected)
// ─────────────────────────────────────────────────────────────────────────────

function EarningsLedgerCard({
  forecast,
  earningsData,
  onNavigateToEarnings,
}: {
  forecast: RetirementForecast;
  earningsData: LifetimeEarningsResponse | undefined;
  onNavigateToEarnings?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const projections = forecast.yearlyProjections;
  if (projections.length === 0) return null;

  const currentYear = new Date().getFullYear();

  // Build prior years (before currentYear) from the earnings ledger — mirrors earnings page exactly
  type LedgerRow =
    | { kind: "prior"; year: number; earningsCents: number; source: "user" | "app" }
    | { kind: "projection"; proj: typeof projections[number] };

  const priorRows: LedgerRow[] = (earningsData?.years ?? [])
    .filter((y) => y.year < currentYear && y.grossEarningsCents > 0)
    .sort((a, b) => b.year - a.year)
    .map((y) => ({ kind: "prior" as const, year: y.year, earningsCents: y.grossEarningsCents, source: y.source }));

  // Projection rows starting from currentYear
  const projectionRows: LedgerRow[] = projections.map((proj) => ({ kind: "projection" as const, proj }));

  // Combined rows: prior years first (newest → oldest), then current+future projections
  const allRows: LedgerRow[] = [...priorRows, ...projectionRows];

  const actualCount = projections.filter((p) => p.isActualEarnings).length + priorRows.length;
  const totalProjected = projections.filter((p) => !p.isActualEarnings).length;

  const displayRows = expanded ? allRows : allRows.slice(0, 8);
  const hasMore = allRows.length > 8;

  return (
    <Animated.View entering={FadeInDown.delay(110).springify()} className="mx-6 mt-5">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <BarChart3 size={16} color="#94a3b8" />
          <Text className="text-white text-base font-bold">Year-by-Year Earnings</Text>
        </View>
        <View className="flex-row items-center gap-2">
          {actualCount > 0 && (
            <View style={{ backgroundColor: "#22c55e20", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: "#22c55e", fontSize: 10, fontWeight: "700" }}>{actualCount} REAL</Text>
            </View>
          )}
          <View style={{ backgroundColor: "#475569", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: "#94a3b8", fontSize: 10, fontWeight: "700" }}>{totalProjected} EST</Text>
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: "#111827", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        {/* FAE context row */}
        <View style={{ backgroundColor: "#1e1a0a", paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)" }}>
          <View className="flex-row items-center gap-2">
            <Award size={13} color="#f59e0b" />
            <Text style={{ color: "#fbbf24", fontSize: 12, fontWeight: "600" }}>Final Average Earnings (Pension FAE)</Text>
          </View>
          <Text style={{ color: "#f59e0b", fontSize: 13, fontWeight: "700" }}>{fmtDollarsLong(forecast.finalAverageEarningsCents)}/yr</Text>
        </View>

        {/* Year rows */}
        {displayRows.map((row, i) => {
          const isLast = i < displayRows.length - 1;
          if (row.kind === "prior") {
            // Prior year row — actual data from earnings page
            return (
              <View key={`prior-${row.year}`} style={{ borderBottomWidth: isLast ? 1 : 0, borderBottomColor: "rgba(255,255,255,0.04)" }}>
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{row.year}</Text>
                      <View style={{ backgroundColor: "#22c55e20", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: "#4ade80", fontSize: 9, fontWeight: "700" }}>ACTUAL</Text>
                      </View>
                      {row.source === "user" && (
                        <View style={{ backgroundColor: "#3b82f620", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ color: "#60a5fa", fontSize: 9, fontWeight: "700" }}>USER</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: "#475569", fontSize: 11 }}>Historical earnings</Text>
                  </View>
                  <Text style={{ color: "#e2e8f0", fontSize: 13, fontWeight: "600" }}>
                    {fmtDollarsLong(row.earningsCents)}
                  </Text>
                </View>
              </View>
            );
          }
          // Projection row
          const proj = row.proj;
          const isLast5 = forecast.retirementYear - proj.year < 5;
          const isCurrent = proj.year === currentYear;
          return (
            <View key={proj.year} style={{ borderBottomWidth: isLast ? 1 : 0, borderBottomColor: "rgba(255,255,255,0.04)", backgroundColor: isCurrent ? "rgba(245,158,11,0.04)" : "transparent" }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Text style={{ color: proj.isActualEarnings ? "#fff" : isCurrent ? "#fbbf24" : "#64748b", fontSize: 13, fontWeight: proj.isActualEarnings || isCurrent ? "600" : "400" }}>
                      {proj.year}
                    </Text>
                    {isCurrent && (
                      <View style={{ backgroundColor: "#f59e0b20", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: "#f59e0b", fontSize: 9, fontWeight: "700" }}>IN PROGRESS</Text>
                      </View>
                    )}
                    {!isCurrent && (
                      <View style={{ backgroundColor: proj.isActualEarnings ? "#22c55e20" : "#334155", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: proj.isActualEarnings ? "#4ade80" : "#475569", fontSize: 9, fontWeight: "700" }}>
                          {proj.isActualEarnings ? "ACTUAL" : "ESTIMATED"}
                        </Text>
                      </View>
                    )}
                    {isLast5 && (
                      <View style={{ backgroundColor: "#f59e0b10", borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Text style={{ color: "#f59e0b80", fontSize: 9, fontWeight: "700" }}>FAE</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: "#475569", fontSize: 11 }}>
                    {proj.seatType === "CAPTAIN" ? "Captain" : "First Officer"} · YOS {proj.payStep}
                  </Text>
                </View>
                <Text style={{ color: proj.isActualEarnings || isCurrent ? "#e2e8f0" : "#475569", fontSize: 13, fontWeight: proj.isActualEarnings || isCurrent ? "600" : "400" }}>
                  {fmtDollarsLong(proj.estimatedAnnualIncomeCents)}
                </Text>
              </View>
            </View>
          );
        })}

        {/* Add data CTA */}
        {!expanded && priorRows.length === 0 && actualCount < 3 && (
          <Pressable
            onPress={() => { onNavigateToEarnings?.(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)", backgroundColor: "#0d1117" }}
          >
            <Edit3 size={13} color="#f59e0b" />
            <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "600" }}>
              {actualCount === 0 ? "Add real earnings → improve FAE accuracy" : `Add ${3 - actualCount} more year${3 - actualCount > 1 ? "s" : ""} → unlock High Confidence`}
            </Text>
          </Pressable>
        )}

        {hasMore && (
          <Pressable
            onPress={() => { setExpanded(!expanded); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)" }}
          >
            {expanded ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
            <Text style={{ color: "#64748b", fontSize: 12 }}>{expanded ? "Show less" : `Show all ${allRows.length} years`}</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onSetup }: { onSetup: () => void }) {
  return (
    <Animated.View entering={FadeInDown.springify()} className="flex-1 items-center justify-center px-8 py-16">
      <View className="w-20 h-20 rounded-3xl items-center justify-center mb-6" style={{ backgroundColor: "#f59e0b15" }}>
        <TrendingUp size={36} color="#f59e0b" />
      </View>
      <Text className="text-white text-2xl font-bold text-center mb-3">Retirement Forecast</Text>
      <Text className="text-slate-400 text-sm text-center leading-6 mb-8">
        Contract-locked to CBA 2023–2028. Auto-populated from your profile. No manual income entry needed.
      </Text>
      <View className="w-full gap-3 mb-8">
        {[
          { icon: <Award size={16} color="#a78bfa" />, text: "Plan A Pension — dual formula, CBA locked" },
          { icon: <TrendingUp size={16} color="#f59e0b" />, text: "Plan B — 12% employer DC account" },
          { icon: <Heart size={16} color="#38bdf8" />, text: "HRA Medical — $6,250/yr (not cash)" },
          { icon: <Flame size={16} color="#22c55e" />, text: "\"Can I Retire at 60?\" readiness score" },
        ].map(({ icon, text }, i) => (
          <View key={i} className="flex-row items-center gap-3 bg-slate-800/40 rounded-xl px-4 py-3">
            {icon}
            <Text className="text-slate-300 text-sm flex-1">{text}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => { onSetup(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
        className="bg-amber-500 rounded-2xl px-8 py-4 w-full items-center"
      >
        <Text className="text-slate-900 font-bold text-base">Build My Retirement Forecast</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RETIREMENT SECTION
// ─────────────────────────────────────────────────────────────────────────────

export function RetirementSection({ onNavigateToEarnings }: { onNavigateToEarnings?: () => void }) {
  const profile = useRetirementProfile();
  const pilotProfile = useProfile();
  const actions = useRetirementActions();
  const setupComplete = useRetirementSetupComplete();

  // Fetch lifetime earnings to feed into retirement forecast
  const { data: lifetimeEarningsData } = useQuery({
    queryKey: ["lifetime-earnings"],
    queryFn: () => api.get<LifetimeEarningsResponse>("/api/lifetime-earnings"),
    staleTime: 60_000,
  });

  // Convert lifetime earnings years to EarningsLedger format for the retirement engine
  const earningsLedger = useMemo(() => {
    if (!lifetimeEarningsData?.years) return undefined;
    return lifetimeEarningsData.years
      .filter((y) => y.grossEarningsCents > 0)
      .map((y) => ({ year: y.year, annualEarningsCents: y.grossEarningsCents }));
  }, [lifetimeEarningsData]);

  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showPriorEarnings, setShowPriorEarnings] = useState(false);
  const [showHowCalc, setShowHowCalc] = useState(false);
  const [showPaycheckInfo, setShowPaycheckInfo] = useState(false);

  // Use profile.retirementAge as the single source of truth for selected age
  const selectedRetireAge = profile.retirementAge;

  // Local display-only assumptions (not persisted in store)
  const [taxPct, setTaxPct] = useState(30);
  const [hraParticipants, setHraParticipants] = useState(1);

  // Social Security state
  const [includeSocialSecurity, setIncludeSocialSecurity] = useState(false);
  const [ssClaimAge, setSsClaimAge] = useState<62 | 67 | 70>(67);

  // Hardcoded default estimates for long-career airline pilots (in cents)
  const SS_MONTHLY_AT_62_CENTS = 270000;  // $2,700/mo
  const SS_MONTHLY_AT_67_CENTS = 385000;  // $3,850/mo
  const SS_MONTHLY_AT_70_CENTS = 477000;  // $4,770/mo

  const ssMonthlyForClaimAge = useMemo(() =>
    ssClaimAge === 62 ? SS_MONTHLY_AT_62_CENTS
    : ssClaimAge === 70 ? SS_MONTHLY_AT_70_CENTS
    : SS_MONTHLY_AT_67_CENTS,
  [ssClaimAge]);

  // SS only counts when scenario age >= claim age
  const ssMonthlyForAge = useCallback((scenarioAge: number): number => {
    if (!includeSocialSecurity) return 0;
    if (scenarioAge < ssClaimAge) return 0;
    const monthly = ssClaimAge === 62 ? SS_MONTHLY_AT_62_CENTS
      : ssClaimAge === 70 ? SS_MONTHLY_AT_70_CENTS
      : SS_MONTHLY_AT_67_CENTS;
    return monthly;
  }, [includeSocialSecurity, ssClaimAge]);

  // Auto-seed retirement profile from pilot profile on mount
  useEffect(() => {
    if (setupComplete) return;
    if (pilotProfile?.dateOfBirth && !profile.dob) actions.updateProfile({ dob: pilotProfile.dateOfBirth });
    if (pilotProfile?.dateOfHire && !profile.doh) actions.updateProfile({ doh: pilotProfile.dateOfHire });
  }, [pilotProfile, setupComplete]);

  useEffect(() => {
    if (!setupComplete) return;
    if (pilotProfile?.dateOfBirth && profile.dob !== pilotProfile.dateOfBirth) actions.updateProfile({ dob: pilotProfile.dateOfBirth });
    if (pilotProfile?.dateOfHire && profile.doh !== pilotProfile.dateOfHire) actions.updateProfile({ doh: pilotProfile.dateOfHire });
  }, [pilotProfile?.dateOfBirth, pilotProfile?.dateOfHire]);

  // Auto-populate priorEarnings from lifetime earnings data when available
  // This uses the finalized (prior) years to compute average annual income and
  // estimate Plan B historical contributions — significantly improving FAE accuracy.
  const autoPopulateAttempted = useRef(false);
  useEffect(() => {
    if (!setupComplete) return;
    if (!lifetimeEarningsData?.years) return;
    if (profile.priorEarnings !== null || profile.priorEarningsSkipped) return;
    if (autoPopulateAttempted.current) return;

    const currentYear = new Date().getFullYear();
    // Only use finalized (past) years from user or app-synced data
    const finalizedYears = lifetimeEarningsData.years.filter(
      (y) => y.isFinalized && y.grossEarningsCents > 0 && y.year < currentYear
    );

    if (finalizedYears.length === 0) return;

    autoPopulateAttempted.current = true;

    const avgAnnualCents = Math.round(
      finalizedYears.reduce((sum, y) => sum + y.grossEarningsCents, 0) / finalizedYears.length
    );
    const dohYear = profile.doh ? new Date(profile.doh).getFullYear() : currentYear;
    const minYear = Math.min(...finalizedYears.map((y) => y.year));
    const priorYearsBeforeTracking = Math.max(0, minYear - dohYear);

    if (priorYearsBeforeTracking > 0 || finalizedYears.length > 0) {
      actions.setPriorEarnings({
        priorYearsService: priorYearsBeforeTracking,
        averageAnnualIncomeCents: avgAnnualCents,
        estimatedPlanBContributionsCents: null, // computed from rate
      });
    }
  }, [setupComplete, lifetimeEarningsData, profile.priorEarnings, profile.priorEarningsSkipped, profile.doh]);

  const shouldPromptPriorEarnings = setupComplete && !profile.priorEarningsSkipped && profile.priorEarnings === null;

  // All forecasts — now powered by real earnings data from lifetime earnings
  const forecast = useMemo(
    () => computeRetirementForecast(profile, UPS_CONTRACT_RULES, selectedRetireAge, earningsLedger),
    [profile, selectedRetireAge, earningsLedger]
  );
  const dualForecast = useMemo(
    () => computeDualScenarioForecast(profile, selectedRetireAge, earningsLedger),
    [profile, selectedRetireAge, earningsLedger]
  );
  const multiForecasts = useMemo(
    () => computeMultiAgeForecast(profile, UPS_CONTRACT_RULES, [55, 57, 58, 59, 60, 61, 62, 63, 65], earningsLedger),
    [profile, earningsLedger]
  );

  const displayForecast = profile.activeScenario === "FO_ONLY" ? dualForecast.foOnly : dualForecast.upgrade;

  const handleShare = useCallback(async () => {
    const grossMo = Math.round(displayForecast.projectedTotalAnnualRetirementIncomeCents / 12);
    const netMo = Math.round(grossMo * (1 - taxPct / 100));
    try {
      await Share.share({
        message: `PilotPay Tracker projects I can retire at ${displayForecast.retirementAge} with ~${fmtDollarsLong(netMo)}/mo net retirement income (Plan A pension + Plan B withdrawal). Estimates based on CBA 2023–2028.`,
      });
    } catch {}
  }, [displayForecast, taxPct]);

  if (!setupComplete) {
    return (
      <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
        <EmptyState onSetup={() => setShowAssumptions(true)} />
        {showAssumptions && (
          <AssumptionsModal
            visible={showAssumptions}
            onClose={() => { setShowAssumptions(false); actions.setHasCompletedSetup(true); }}
            profile={profile}
            pilotProfile={pilotProfile}
            taxPct={taxPct}
            hraParticipants={hraParticipants}
            onSave={(updates, tax, participants) => {
              actions.updateProfile(updates);
              setTaxPct(tax);
              setHraParticipants(participants);
              actions.setHasCompletedSetup(true);
            }}
          />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

      {/* Earnings data quality banner */}
      <EarningsDataBanner
        earningsData={lifetimeEarningsData}
        actualYearsCount={displayForecast.actualEarningsYears}
        onNavigateToEarnings={onNavigateToEarnings}
      />

      {/* Prior earnings banner — only show if no lifetime earnings data and not skipped */}
      {shouldPromptPriorEarnings && !lifetimeEarningsData?.years?.length && (
        <Animated.View entering={FadeInDown} className="mx-6 mt-4 mb-1">
          <Pressable
            onPress={() => setShowPriorEarnings(true)}
            className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4 flex-row items-center gap-3"
          >
            <Lightbulb size={18} color="#f59e0b" />
            <View className="flex-1">
              <Text className="text-amber-400 font-semibold text-sm">Add prior career earnings</Text>
              <Text className="text-slate-400 text-xs mt-0.5">Include existing Plan B balance in forecast</Text>
            </View>
            <ChevronRight size={16} color="#f59e0b" />
          </Pressable>
        </Animated.View>
      )}

      {/* Page header */}
      <View className="mx-6 mt-5 flex-row items-center justify-between">
        <View>
          <Text className="text-white text-lg font-bold">Retirement Forecast</Text>
          <View className="flex-row items-center gap-2 mt-0.5">
            <ConfidenceBadge level={displayForecast.confidenceLevel} />
            <Text className="text-slate-600 text-xs">{displayForecast.rulesetVersion}</Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Pressable onPress={handleShare} className="w-9 h-9 rounded-xl bg-slate-800 items-center justify-center">
            <Share2 size={15} color="#94a3b8" />
          </Pressable>
          <Pressable
            onPress={() => setShowAssumptions(true)}
            className="flex-row items-center gap-1.5 bg-slate-800 rounded-xl px-3 py-2"
          >
            <Edit3 size={13} color="#f59e0b" />
            <Text className="text-amber-400 text-xs font-semibold">Edit</Text>
          </Pressable>
        </View>
      </View>

      {/* Integrity errors */}
      <IntegrityBanner
        errors={displayForecast.validationErrors}
        warnings={displayForecast.sanityWarnings}
      />

      {/* 1. RETIREMENT PAYCHECK */}
      <RetirementPaycheckCard
        forecast={displayForecast}
        taxPct={taxPct}
        swrPct={profile.safeWithdrawalRatePct ?? 4}
        onInfoPress={() => setShowPaycheckInfo(true)}
        onHowCalcPress={() => setShowHowCalc(true)}
        includeSS={includeSocialSecurity}
        ssMonthly={ssMonthlyForAge(ssClaimAge)}
        hraParticipants={hraParticipants}
      />

      {/* 2. INCOME BREAKDOWN */}
      <IncomeBreakdownCard
        forecast={displayForecast}
        includeSS={includeSocialSecurity}
        ssMonthly={ssMonthlyForAge(ssClaimAge)}
        ssClaimAge={ssClaimAge}
        hraParticipants={hraParticipants}
      />

      {/* 2a. YEAR-BY-YEAR EARNINGS LEDGER */}
      <EarningsLedgerCard
        forecast={displayForecast}
        earningsData={lifetimeEarningsData}
        onNavigateToEarnings={onNavigateToEarnings}
      />

      {/* 2b. SOCIAL SECURITY */}
      <SocialSecurityCard
        enabled={includeSocialSecurity}
        onToggle={setIncludeSocialSecurity}
        claimAge={ssClaimAge}
        onClaimAgeChange={setSsClaimAge}
        monthlyAt67Cents={SS_MONTHLY_AT_67_CENTS}
      />

      {/* 3. RETIREMENT ASSETS */}
      <RetirementAssetsCard
        forecast={displayForecast}
        swrPct={profile.safeWithdrawalRatePct ?? 4}
        assets401kCents={profile.retirement401kCents ?? 0}
        assetsIRACents={profile.retirementIRACents ?? 0}
        assetsBrokerageCents={profile.retirementBrokerageCents ?? 0}
        include401k={profile.include401kInRetirementIncome ?? false}
        onChangeAssets={(k, v) => actions.updateProfile({ [k]: v })}
      />

      {/* 3b. OPTIONAL INCOME FROM PERSONAL ASSETS */}
      <OptionalIncomeCard
        swrPct={profile.safeWithdrawalRatePct ?? 4}
        assets401kCents={profile.retirement401kCents ?? 0}
        assetsIRACents={profile.retirementIRACents ?? 0}
        assetsBrokerageCents={profile.retirementBrokerageCents ?? 0}
        include401k={profile.include401kInRetirementIncome ?? false}
      />

      {/* 3c. TOTAL RETIREMENT PICTURE */}
      <TotalRetirementPictureCard
        forecast={displayForecast}
        swrPct={profile.safeWithdrawalRatePct ?? 4}
        taxPct={taxPct}
        assets401kCents={profile.retirement401kCents ?? 0}
        assetsIRACents={profile.retirementIRACents ?? 0}
        assetsBrokerageCents={profile.retirementBrokerageCents ?? 0}
        include401k={profile.include401kInRetirementIncome ?? false}
        includeSS={includeSocialSecurity}
        ssMonthly={ssMonthlyForAge(ssClaimAge)}
      />

      {/* 4. ONE-TIME PAYOUTS */}
      <OneTimePayoutsCard
        forecast={displayForecast}
        sickLeaveHours={profile.sickLeaveHoursBalance}
        onChangeSickLeaveHours={(h) => actions.updateProfile({ sickLeaveHoursBalance: h })}
      />

      {/* 8. HEALTHCARE COVERAGE */}
      <HealthcareCoverageCard
        forecast={displayForecast}
        hraParticipants={hraParticipants}
        onChangeParticipants={(n) => setHraParticipants(n)}
      />

      {/* 9. CAN I RETIRE AT 60 */}
      <RetirementReadinessCard
        multiForecasts={multiForecasts}
        taxPct={taxPct}
        swrPct={profile.safeWithdrawalRatePct ?? 4}
        selectedAge={selectedRetireAge}
        includeSS={includeSocialSecurity}
        ssMonthlyForAge={ssMonthlyForAge}
        ssClaimAge={ssClaimAge}
      />

      {/* 5. AGE SCENARIOS */}
      <AgeScenarioSelector
        multiForecasts={multiForecasts}
        selectedAge={selectedRetireAge}
        onSelectAge={(age) => { actions.updateProfile({ retirementAge: age }); }}
        taxPct={taxPct}
        includeSS={includeSocialSecurity}
        ssMonthlyForAge={ssMonthlyForAge}
        ssClaimAge={ssClaimAge}
      />

      {/* 6. CAREER PATH COMPARISON */}
      <CareerPathComparison
        profile={profile}
        taxPct={taxPct}
        onChangeBasis={(b) => actions.updateProfile({ earningsBasis: b })}
      />

      {/* Contract engine badge */}
      <ContractVersionBadge forecast={displayForecast} />

      {/* Disclaimer */}
      <View className="mx-6 mt-5 mb-2">
        <View className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/20">
          <View className="flex-row items-center gap-2 mb-2">
            <Info size={13} color="#64748b" />
            <Text className="text-slate-500 text-xs font-semibold">Disclaimer</Text>
          </View>
          <Text className="text-slate-500 text-xs leading-4">
            Estimates only. Calculation engine locked to CBA 2023–2028 contract rules and official UPS pay tables. Assumes 5% annual return unless changed. Actual outcomes depend on future earnings, markets, contract changes, and individual circumstances. Not HR, legal, or financial advice. Verify with UPS HR and IPA.
          </Text>
        </View>
      </View>

      {/* Paycheck info modal */}
      <Modal visible={showPaycheckInfo} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaycheckInfo(false)}>
        <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
          <View className="flex-row items-center justify-between px-6 pt-6 pb-4 border-b border-slate-800">
            <Text className="text-white text-lg font-bold">What's Included</Text>
            <Pressable onPress={() => setShowPaycheckInfo(false)} className="w-8 h-8 items-center justify-center">
              <X size={20} color="#94a3b8" />
            </Pressable>
          </View>
          <ScrollView className="flex-1 px-6 pt-6">
            {[
              { icon: <Award size={16} color="#a78bfa" />, title: "Plan A Pension", desc: "Defined benefit pension. Guaranteed for life. Calculated as MAX of 1% × FAE × YOS or flat dollar minimum per CBA.", cash: true },
              { icon: <TrendingUp size={16} color="#f59e0b" />, title: "Plan B Withdrawal", desc: "Annual income from your DC account balance at the Safe Withdrawal Rate. The balance itself is an asset — only the withdrawal is income.", cash: true },
              { icon: <Heart size={16} color="#38bdf8" />, title: "HRA Medical Benefit", desc: "NOT spendable cash. Medical reimbursement only. Excluded from net paycheck but shown separately as a benefit.", cash: false },
              { icon: <Star size={16} color="#94a3b8" />, title: "Sick Leave Payout", desc: "One-time payout at retirement only. NEVER included in annual retirement income.", cash: false },
            ].map(({ icon, title, desc, cash }, i) => (
              <View key={i} className="flex-row gap-3 mb-5">
                <View className="w-8 h-8 rounded-xl bg-slate-800 items-center justify-center mt-0.5">{icon}</View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-white text-sm font-semibold">{title}</Text>
                    <View className={`rounded-full px-2 py-0.5 ${cash ? "bg-green-500/20" : "bg-slate-700/50"}`}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: cash ? "#22c55e" : "#64748b" }}>
                        {cash ? "Cash income" : "Not cash"}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-slate-400 text-xs leading-4">{desc}</Text>
                </View>
              </View>
            ))}
            <View className="bg-slate-900 rounded-xl p-4 mt-2">
              <Text className="text-slate-500 text-xs leading-4">Tax estimate is applied to gross cash income (Plan A + Plan B). Net monthly is an estimate — actual taxes depend on your tax situation.</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Modals */}
      {showHowCalc && (
        <HowCalculatedModal
          visible={showHowCalc}
          onClose={() => setShowHowCalc(false)}
          forecast={displayForecast}
          taxPct={taxPct}
          hraParticipants={hraParticipants}
        />
      )}
      {showAssumptions && (
        <AssumptionsModal
          visible={showAssumptions}
          onClose={() => setShowAssumptions(false)}
          profile={profile}
          pilotProfile={pilotProfile}
          taxPct={taxPct}
          hraParticipants={hraParticipants}
          onSave={(updates, tax, participants) => {
            actions.updateProfile(updates);
            setTaxPct(tax);
            setHraParticipants(participants);
          }}
        />
      )}
      {showPriorEarnings && (
        <PriorEarningsModal
          visible={showPriorEarnings}
          onClose={() => setShowPriorEarnings(false)}
          onSave={(pe) => { actions.setPriorEarnings(pe); setShowPriorEarnings(false); }}
          onSkip={() => { actions.skipPriorEarnings(); setShowPriorEarnings(false); }}
        />
      )}
    </ScrollView>
  );
}
