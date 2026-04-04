/**
 * Pay Dashboard - Professional Pay Intelligence Tool
 *
 * Features:
 * - Gross/Net pay toggle with estimated taxes
 * - Tappable confidence indicator with verification breakdown
 * - "Why this amount?" pay explainability
 * - Color-coded efficiency ratio
 * - Conditional "Action Needed" card
 * - Consolidated earnings summary
 * - Premium banner with clear trial language
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  Switch,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Plane,
  ChevronRight,
  Settings,
  PartyPopper,
  X,
  CheckCircle2,
  AlertTriangle,
  Plus,
  FileText,
  Camera,
  ClipboardList,
  ShieldCheck,
  CalendarClock,
  Info,
  HelpCircle,
  TrendingUp,
  Clock,
  Sparkles,
  Crown,
  Zap,
  Target,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { webSafeExit } from "@/lib/webSafeAnimation";
import { useDashboard, useBidPeriodBaseline } from "@/lib/useFlightData";
import { SetAwardedCreditModal } from "@/components/SetAwardedCreditModal";
import { useSession } from "@/lib/useSession";
import { useProfileQuery } from "@/lib/useProfile";
import { useProfile, useIsProfileComplete, useProfileLoading } from "@/lib/state/profile-store";
import { usePayEvents, formatEventType } from "@/lib/usePayEvents";
import { useProjections } from "@/lib/useProjections";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PayEventType } from "@/lib/contracts";
import { useContracts } from "@/lib/useContracts";
import {
  useSubscriptionTier,
  useTrialDaysRemaining,
  useIsTrialExpired,
} from "@/lib/subscriptionStore";
import { useShowNetPay, useTaxStore, type TaxBreakdown } from "@/lib/state/tax-store";
import { useCalculateNetPay } from "@/lib/useTax";
import { useScheduleChanges, useUnacknowledgedChangesCount } from "@/lib/useSnapshotData";
import { ChangesDetectedModal } from "@/components/schedule/ChangesDetectedModal";
import { NewChangesPopup } from "@/components/schedule/NewChangesPopup";
import { usePayConfidence } from "@/lib/state/pay-confidence-context";
import { PayConfidenceBadge } from "@/components/PayConfidenceBadge";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { useIsOnline, useAutoRefreshOnReconnect } from "@/lib/useNetworkStatus";
import { offlineCache } from "@/lib/offlineStorage";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import { usePayNotificationScheduler } from "@/lib/useNotifications";
import { ActionNeededModal } from "@/components/ActionNeededModal";
import { useResponsive } from "@/lib/responsive";
import { calculateGuaranteeBreakdown, resolveBidPeriodType, GUARANTEE_HOURS_BY_PERIOD } from "@/lib/pay-check-logic";
import { useSharedProjectedAnnual } from "@/lib/useSharedProjectedAnnual";

// ============================================
// HELPERS
// ============================================

function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

function formatCentsAsCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCentsShort(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatDateDisplay(dateISO: string): string {
  const date = new Date(dateISO + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function checkAnniversary(
  dateOfHire: string | null
): { isAnniversary: boolean; years: number } {
  if (!dateOfHire) return { isAnniversary: false, years: 0 };
  const today = new Date();
  const hireDate = new Date(dateOfHire + "T12:00:00");
  const isSameDay =
    today.getMonth() === hireDate.getMonth() &&
    today.getDate() === hireDate.getDate();
  const years = today.getFullYear() - hireDate.getFullYear();
  return { isAnniversary: isSameDay, years };
}

// Calculate confidence with detailed reasons
function calculateConfidence(data: {
  hasFlights: boolean;
  pendingEvents: number;
  needsReviewCount: number;
  hasContractRules: boolean;
}): { level: "high" | "medium" | "low"; percent: number; reasons: string[] } {
  let score = 100;
  const reasons: string[] = [];

  if (!data.hasFlights) {
    score -= 40;
    reasons.push("No flights logged this period");
  } else {
    reasons.push("Trips verified");
  }

  if (data.pendingEvents > 0) {
    score -= data.pendingEvents * 10;
    reasons.push(`${data.pendingEvents} pending pay event(s)`);
  }

  if (data.needsReviewCount > 0) {
    score -= data.needsReviewCount * 15;
    reasons.push(`${data.needsReviewCount} trip(s) need review`);
  } else if (data.hasFlights) {
    reasons.push("No missing credits");
  }

  if (data.hasContractRules) {
    reasons.push("Contract rules matched");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    level: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
    percent: score,
    reasons,
  };
}

// ============================================
// HOOKS
// ============================================

interface TripSummary {
  id: string;
  status: string;
  needsReview: boolean;
  totalCreditMinutes: number;
  totalPayCents: number;
  totalTafbMinutes: number;
  startDate: string;
  endDate: string;
}

function useTripsForPeriod(startDate?: string, endDate?: string) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["trips-period", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const url = `/api/trips?${params.toString()}`;
      const response = await api.get<{ trips: TripSummary[] }>(url);
      return response.trips;
    },
    enabled: isAuthenticated && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5, // 5 minutes
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

interface ProfileStatsResponse {
  allTime: { totalPayCents: number };
  currentYear: { totalPayCents: number; year: number };
  currentMonth: { totalPayCents: number; month: string };
}

function useProfileStats() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["profile-stats"],
    queryFn: async () => {
      const netState = await (await import("@react-native-community/netinfo")).default.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getProfileStats<ProfileStatsResponse>();
        if (cached) return cached;
        throw new Error("No cached profile stats available offline");
      }
      const response = await api.get<ProfileStatsResponse>("/api/profile/stats");
      await offlineCache.saveProfileStats(response);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes — profile stats don't change without user action
    retry: isOnline ? 2 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

interface UpcomingPayDate {
  payDate: string;
  payType: "standard" | "remainder";
  periodNumber: number;
  year: number;
}

function useUpcomingPayDates() {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["upcoming-pay-dates"],
    queryFn: async () => {
      const netState = await (await import("@react-native-community/netinfo")).default.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getPayPeriods<{ payDates: UpcomingPayDate[] }>();
        if (cached) return cached.payDates;
        throw new Error("No cached pay dates available offline");
      }
      const response = await api.get<{ payDates: UpcomingPayDate[]; today: string }>(
        "/api/pay-periods/upcoming-pay-dates"
      );
      await offlineCache.savePayPeriods(response);
      return response.payDates;
    },
    staleTime: 1000 * 60 * 60, // 1 hour - pay dates rarely change
    retry: isOnline ? 2 : 0,
  });
}

// ============================================
// MODAL COMPONENTS
// ============================================

// Confidence Breakdown Modal
function ConfidenceModal({
  visible,
  onClose,
  confidence,
}: {
  visible: boolean;
  onClose: () => void;
  confidence: { level: string; percent: number; reasons: string[] };
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          entering={FadeIn}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="px-5 py-4 border-b border-slate-700/50">
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-lg font-semibold">
                Confidence Breakdown
              </Text>
              <Pressable onPress={onClose}>
                <X size={20} color="#64748b" />
              </Pressable>
            </View>
          </View>

          <View className="px-5 py-4">
            <View className="flex-row items-center mb-4">
              <View
                className={`w-10 h-10 rounded-full items-center justify-center ${
                  confidence.level === "high"
                    ? "bg-green-500/20"
                    : confidence.level === "medium"
                      ? "bg-amber-500/20"
                      : "bg-red-500/20"
                }`}
              >
                {confidence.level === "high" ? (
                  <CheckCircle2 size={22} color="#22c55e" />
                ) : (
                  <AlertTriangle
                    size={22}
                    color={confidence.level === "medium" ? "#f59e0b" : "#ef4444"}
                  />
                )}
              </View>
              <View className="ml-3">
                <Text className="text-white font-bold text-xl">
                  {confidence.percent}% Confidence
                </Text>
                <Text
                  className={
                    confidence.level === "high"
                      ? "text-green-400"
                      : confidence.level === "medium"
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                >
                  {confidence.level.toUpperCase()}
                </Text>
              </View>
            </View>

            <Text className="text-slate-400 text-sm mb-3 uppercase tracking-wider">
              Verification Status
            </Text>

            {confidence.reasons.map((reason, index) => {
              const isPositive =
                reason.includes("verified") ||
                reason.includes("matched") ||
                reason.includes("No missing");
              return (
                <View
                  key={index}
                  className="flex-row items-center py-2.5 border-b border-slate-800"
                >
                  {isPositive ? (
                    <CheckCircle2 size={16} color="#22c55e" />
                  ) : (
                    <AlertTriangle size={16} color="#f59e0b" />
                  )}
                  <Text className="text-slate-300 ml-3">{reason}</Text>
                </View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Pay Explanation Modal
function PayExplanationModal({
  visible,
  onClose,
  dashboard,
  payEvents,
}: {
  visible: boolean;
  onClose: () => void;
  dashboard: import("@/lib/contracts").GetDashboardResponse | null | undefined;
  payEvents: { eventType: string; title: string; payDifferenceCents?: number | null; premiumMinutes?: number | null; creditDifferenceMinutes?: number | null }[];
}) {
  const insets = useSafeAreaInsets();
  const profile = useProfile();
  const hourlyRate = (profile?.hourlyRateCents ?? dashboard?.hourlyRateCents ?? 0) / 100;

  // ── pull all audit values from dashboard (with safe defaults) ──────────────
  const schedCredit    = dashboard?.baseScheduleCredit        ?? dashboard?.totalCreditMinutes ?? 0;
  const jaCredit       = dashboard?.jaPickupCreditMinutes     ?? 0;
  const companyCredit  = dashboard?.companyRemovedCreditMinutes ?? 0;
  const droppedCredit  = dashboard?.droppedByUserCreditMinutes ?? 0;
  const protectedBase  = dashboard?.protectedBaseCredit       ?? (schedCredit - jaCredit + companyCredit);
  const guarantee      = dashboard?.guaranteeMinutes          ?? 75 * 60;
  const adjFloor       = dashboard?.adjustedGuaranteeFloor    ?? Math.max(0, guarantee - droppedCredit);
  const paidBase       = dashboard?.paidBaseCreditMinutes     ?? Math.max(protectedBase, adjFloor);
  const bufferMins     = dashboard?.bufferMinutes             ?? Math.max(0, paidBase - protectedBase);
  const basePayCents   = dashboard?.basePayCents              ?? Math.round((paidBase / 60) * hourlyRate * 100);
  const jaPayCents     = dashboard?.jaPayCents                ?? Math.round((jaCredit / 60) * hourlyRate * 1.5 * 100);
  const totalPayCents  = dashboard?.totalPayCents             ?? 0;

  const isGuaranteeActive        = dashboard?.isGuaranteeActive        ?? false;
  const isGuaranteeWaivedByDrop  = dashboard?.isGuaranteeWaivedByUserDrop ?? false;

  const fmt = (mins: number) => (mins / 60).toFixed(1);
  const fmtMoney = (cents: number) => {
    const d = Math.abs(cents / 100);
    return (cents < 0 ? "−" : "") + "$" + d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // ── plain-language summary ─────────────────────────────────────────────────
  let summaryText = "";
  if (isGuaranteeWaivedByDrop) {
    summaryText = `A dropped trip reduced your schedule credit. Guarantee was partially waived — pay is based on ${fmt(paidBase)} hrs.`;
  } else if (isGuaranteeActive) {
    summaryText = `Your current schedule credit (${fmt(protectedBase)} hrs) is below the ${fmt(guarantee)}-hr guarantee. Pay is based on the guarantee floor.`;
  } else if (jaCredit > 0) {
    summaryText = `Your schedule exceeds guarantee. ${fmt(jaCredit)} hrs of JA pickup credit pays at 150% on top of your base.`;
  } else {
    summaryText = `Your current schedule credit exceeds the ${fmt(guarantee)}-hr guarantee. Pay is based on actual credited hours.`;
  }

  // ── categorise pay events ──────────────────────────────────────────────────
  const droppedEvents    = payEvents.filter(e => e.eventType === "dropped_trip"    || e.eventType === "drop");
  const pickupEvents     = payEvents.filter(e => e.eventType === "pickup"          || e.eventType === "trade_pickup");
  const jaEvents         = payEvents.filter(e => e.eventType === "ja_pickup"       || e.eventType === "ja");
  const protectionEvents = payEvents.filter(e => e.eventType === "pay_protection"  || e.eventType === "protection");
  const companyRevEvents = payEvents.filter(e => e.eventType === "company_revision"|| e.eventType === "company_removed");
  const premiumEvents    = payEvents.filter(e => (e.premiumMinutes ?? 0) > 0 && !jaEvents.includes(e));
  const otherEvents      = payEvents.filter(e =>
    !droppedEvents.includes(e) && !pickupEvents.includes(e) && !jaEvents.includes(e) &&
    !protectionEvents.includes(e) && !companyRevEvents.includes(e) && !premiumEvents.includes(e)
  );

  const hasChanges = companyCredit > 0 || droppedCredit > 0 || jaCredit > 0 || payEvents.length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/70">
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          entering={FadeIn}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Header */}
          <View className="px-5 py-4 border-b border-slate-700/50">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <HelpCircle size={18} color="#f59e0b" />
                <Text className="text-white text-lg font-semibold">Why This Amount?</Text>
              </View>
              <Pressable onPress={onClose}>
                <X size={20} color="#64748b" />
              </Pressable>
            </View>
          </View>

          <ScrollView className="px-5 py-4" style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>

            {/* ── Summary banner ──────────────────────────────────────────── */}
            <View
              className="rounded-xl p-3 mb-5 flex-row items-start gap-2"
              style={{
                backgroundColor: isGuaranteeActive
                  ? "rgba(245,158,11,0.12)"
                  : isGuaranteeWaivedByDrop
                    ? "rgba(239,68,68,0.10)"
                    : "rgba(34,197,94,0.10)",
                borderWidth: 1,
                borderColor: isGuaranteeActive
                  ? "rgba(245,158,11,0.25)"
                  : isGuaranteeWaivedByDrop
                    ? "rgba(239,68,68,0.25)"
                    : "rgba(34,197,94,0.20)",
              }}
            >
              <Info size={14} color={isGuaranteeActive ? "#f59e0b" : isGuaranteeWaivedByDrop ? "#f87171" : "#4ade80"} style={{ marginTop: 2 }} />
              <Text className="text-slate-300 text-sm leading-5 flex-1">{summaryText}</Text>
            </View>

            {/* ── Section 1: Pay Basis ─────────────────────────────────────── */}
            <SectionLabel label="Pay Basis" />
            <View className="bg-slate-800/50 rounded-xl p-3 mb-4 gap-2">
              <AuditRow label="Schedule credit" value={`${fmt(schedCredit - jaCredit)} hrs`} />
              {companyCredit > 0 && (
                <AuditRow label="+ Company protection" value={`+${fmt(companyCredit)} hrs`} accent="green" note="Company-removed trips protected" />
              )}
              {jaCredit > 0 && (
                <AuditRow label="+ JA pickup credit" value={`+${fmt(jaCredit)} hrs`} accent="amber" note="Pays at 150% — not applied to guarantee" />
              )}
              <Divider />
              <AuditRow label="Protected base credit" value={`${fmt(protectedBase)} hrs`} bold />
              <AuditRow label="Guarantee floor" value={`${fmt(guarantee)} hrs`} />
              {droppedCredit > 0 && (
                <AuditRow label="  − Drop reduction" value={`−${fmt(droppedCredit)} hrs`} accent="red" note="Guarantee reduced by dropped credit" />
              )}
              {droppedCredit > 0 && (
                <AuditRow label="  Adjusted floor" value={`${fmt(adjFloor)} hrs`} />
              )}
              <Divider />
              <AuditRow
                label="Pay basis (base)"
                value={`${fmt(paidBase)} hrs`}
                bold
                note={isGuaranteeActive ? "Guarantee applied ✦" : protectedBase >= adjFloor ? "Above guarantee" : undefined}
                accent={isGuaranteeActive ? "amber" : undefined}
              />
              {bufferMins > 0 && (
                <AuditRow label="  Guarantee buffer added" value={`+${fmt(bufferMins)} hrs`} accent="amber" />
              )}
            </View>

            {/* ── Section 2: What Changed ──────────────────────────────────── */}
            {hasChanges && (
              <>
                <SectionLabel label="What Changed" />
                <View className="bg-slate-800/50 rounded-xl p-3 mb-4 gap-2">
                  {companyCredit > 0 && (
                    <ChangeRow icon="🛡" label="Company revision / removal" delta={`+${fmt(companyCredit)} hrs protected`} color="#4ade80" />
                  )}
                  {droppedCredit > 0 && (
                    <ChangeRow icon="↓" label="Trip dropped by you" delta={`−${fmt(droppedCredit)} hrs (guarantee reduced)`} color="#f87171" />
                  )}
                  {jaCredit > 0 && (
                    <ChangeRow icon="★" label="JA pickup (150%)" delta={`+${fmt(jaCredit)} hrs at 1.5×`} color="#f59e0b" />
                  )}
                  {pickupEvents.map((e, i) => (
                    <ChangeRow key={i} icon="+" label={e.title} delta={e.creditDifferenceMinutes ? `+${fmt(e.creditDifferenceMinutes)} hrs` : "Pickup added"} color="#60a5fa" />
                  ))}
                  {protectionEvents.map((e, i) => (
                    <ChangeRow key={i} icon="🛡" label={e.title} delta={e.creditDifferenceMinutes ? `+${fmt(e.creditDifferenceMinutes)} hrs protected` : "Pay protection"} color="#4ade80" />
                  ))}
                  {droppedEvents.map((e, i) => (
                    <ChangeRow key={i} icon="−" label={e.title} delta={e.creditDifferenceMinutes ? `${fmt(e.creditDifferenceMinutes)} hrs` : "Trip dropped"} color="#f87171" />
                  ))}
                  {otherEvents.map((e, i) => (
                    <ChangeRow key={i} icon="·" label={e.title} delta={e.creditDifferenceMinutes ? `${e.creditDifferenceMinutes > 0 ? "+" : ""}${fmt(e.creditDifferenceMinutes)} hrs` : "Logged"} color="#94a3b8" />
                  ))}
                </View>
              </>
            )}

            {/* ── Section 3: Awarded Baseline ─────────────────────────────── */}
            {(() => {
              const bl = dashboard?.baselineAnalysis;
              if (!bl) return null;
              const fmtH = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
              return (
                <>
                  <SectionLabel label="Awarded Line Credit" />
                  <View className="bg-slate-800/50 rounded-xl p-3 mb-4 gap-2">
                    {!bl.isBaselineSet ? (
                      <View className="flex-row items-start gap-2">
                        <Info size={13} color="#f59e0b" style={{ marginTop: 2 }} />
                        <Text className="text-amber-300 text-xs leading-relaxed flex-1">
                          Awarded line credit not set. Set it on the dashboard for accurate pickup/drop classification.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <AuditRow
                          label="Awarded line credit"
                          value={`${fmtH(bl.awardedCreditMinutes)} hrs`}
                          note={bl.source === "uploaded_award" ? "uploaded" : bl.source === "manual_entry" ? "manual" : "estimated"}
                        />
                        <AuditRow
                          label="Guarantee floor"
                          value={`${fmtH(dashboard?.guaranteeMinutes ?? 4500)} hrs`}
                        />
                        {bl.awardedAboveGuarantee ? (
                          <AuditRow
                            label="Awarded above guarantee"
                            value={`+${fmtH(bl.awardedCreditMinutes - (dashboard?.guaranteeMinutes ?? 4500))} hrs`}
                            accent="green"
                            note="Started above guarantee floor"
                          />
                        ) : (
                          <AuditRow
                            label="Guarantee gap at award"
                            value={`${fmtH(bl.guaranteeGapMinutes)} hrs`}
                            accent="amber"
                            note="Guarantee covered this gap"
                          />
                        )}
                        {bl.straightPickupCreditMinutes > 0 && (
                          <>
                            <Divider />
                            <AuditRow label="Straight pickup credit" value={`+${fmtH(bl.straightPickupCreditMinutes)} hrs`} />
                            {bl.pickupsFillGuaranteeGapMinutes > 0 && (
                              <AuditRow
                                label="  → fills guarantee gap"
                                value={`${fmtH(bl.pickupsFillGuaranteeGapMinutes)} hrs`}
                                accent="amber"
                                note="No extra pay — covered by guarantee"
                              />
                            )}
                            {bl.pickupsAboveGuaranteeMinutes > 0 && (
                              <AuditRow
                                label="  → truly extra paid"
                                value={`${fmtH(bl.pickupsAboveGuaranteeMinutes)} hrs`}
                                accent="green"
                                note="Above guarantee — generates real extra pay"
                              />
                            )}
                          </>
                        )}
                        {bl.droppedCreditMinutes > 0 && (
                          <>
                            <Divider />
                            <AuditRow
                              label="Dropped credit"
                              value={`−${fmtH(bl.droppedCreditMinutes)} hrs`}
                              accent="red"
                              note={bl.dropsReducedPaidCredit ? "Reduced actual paid credit" : "Guarantee still protects pay"}
                            />
                          </>
                        )}
                        {bl.extraPaidAboveGuaranteeMinutes > 0 && (
                          <>
                            <Divider />
                            <AuditRow
                              label="Extra paid above guarantee"
                              value={`${fmtH(bl.extraPaidAboveGuaranteeMinutes)} hrs`}
                              accent="green"
                              bold
                            />
                          </>
                        )}
                      </>
                    )}
                  </View>
                </>
              );
            })()}

            {/* ── Section 4: Premiums ──────────────────────────────────────── */}
            {(jaCredit > 0 || premiumEvents.length > 0) && (
              <>
                <SectionLabel label="Premiums & Protections" />
                <View className="bg-slate-800/50 rounded-xl p-3 mb-4 gap-2">
                  {jaCredit > 0 && (
                    <>
                      <AuditRow label="JA credit" value={`${fmt(jaCredit)} hrs`} />
                      <AuditRow label="× Premium rate" value="1.50×" />
                      <Divider />
                      <AuditRow label="JA pickup pay" value={fmtMoney(jaPayCents)} accent="amber" bold />
                    </>
                  )}
                  {premiumEvents.map((e, i) => (
                    <AuditRow
                      key={i}
                      label={e.title}
                      value={e.payDifferenceCents ? fmtMoney(e.payDifferenceCents) : `${e.premiumMinutes} min`}
                      accent="amber"
                    />
                  ))}
                </View>
              </>
            )}

            {/* ── Section 5: Final Total ───────────────────────────────────── */}
            <SectionLabel label="Final Total" />
            <View className="bg-slate-800/50 rounded-xl p-3 mb-2 gap-2">
              <AuditRow label={`Base pay (${fmt(paidBase)} hrs × $${hourlyRate.toFixed(0)}/hr)`} value={fmtMoney(basePayCents)} />
              {jaCredit > 0 && (
                <AuditRow label={`JA pay (${fmt(jaCredit)} hrs × 1.5×)`} value={`+${fmtMoney(jaPayCents)}`} accent="amber" />
              )}
            </View>
            <View
              className="rounded-xl p-4 flex-row justify-between items-center mb-2"
              style={{ backgroundColor: "rgba(34,197,94,0.10)", borderWidth: 1, borderColor: "rgba(34,197,94,0.25)" }}
            >
              <Text className="text-white font-semibold text-base">Total Estimated</Text>
              <Text className="text-green-400 font-bold text-xl">{fmtMoney(totalPayCents)}</Text>
            </View>

            {/* pay events footnote */}
            {payEvents.length > 0 && (
              <Text className="text-slate-500 text-xs text-center mt-1 mb-2">
                {payEvents.length} pay event{payEvents.length !== 1 ? "s" : ""} logged · amounts included above where applicable
              </Text>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Small helper sub-components ───────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Text className="text-slate-400 text-xs font-semibold uppercase tracking-widest mb-2">
      {label}
    </Text>
  );
}

function Divider() {
  return <View className="h-px bg-slate-700/60 my-1" />;
}

function AuditRow({
  label, value, bold, accent, note,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: "green" | "amber" | "red";
  note?: string;
}) {
  const valueColor =
    accent === "green" ? "#4ade80" :
    accent === "amber" ? "#f59e0b" :
    accent === "red"   ? "#f87171" :
    bold ? "#ffffff" : "#94a3b8";
  return (
    <View>
      <View className="flex-row justify-between items-center">
        <Text className={`text-sm flex-1 mr-2 ${bold ? "text-slate-200 font-semibold" : "text-slate-400"}`}>{label}</Text>
        <Text style={{ color: valueColor, fontWeight: bold ? "700" : "500", fontSize: 14 }}>{value}</Text>
      </View>
      {note && <Text className="text-slate-500 text-xs mt-0.5">{note}</Text>}
    </View>
  );
}

function ChangeRow({ icon, label, delta, color }: { icon: string; label: string; delta: string; color: string }) {
  return (
    <View className="flex-row items-start gap-2">
      <Text style={{ color, fontSize: 13, width: 16, textAlign: "center" }}>{icon}</Text>
      <View className="flex-1">
        <View className="flex-row justify-between items-center">
          <Text className="text-slate-300 text-sm flex-1 mr-2">{label}</Text>
          <Text style={{ color, fontSize: 13, fontWeight: "600" }}>{delta}</Text>
        </View>
      </View>
    </View>
  );
}

// Net Pay Breakdown Modal
function NetPayBreakdownModal({
  visible,
  onClose,
  breakdown,
}: {
  visible: boolean;
  onClose: () => void;
  breakdown: TaxBreakdown | null;
}) {
  const insets = useSafeAreaInsets();

  if (!breakdown) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={onClose} />
        <Animated.View
          entering={FadeIn}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="px-5 py-4 border-b border-slate-700/50">
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-lg font-semibold">
                Net Pay Breakdown
              </Text>
              <Pressable onPress={onClose}>
                <X size={20} color="#64748b" />
              </Pressable>
            </View>
          </View>

          <ScrollView className="px-5 py-4 max-h-96">
            {/* Gross */}
            <View className="flex-row justify-between py-2">
              <Text className="text-white font-medium">Gross Pay</Text>
              <Text className="text-white font-bold">
                {formatCentsAsCurrency(breakdown.grossPayCents)}
              </Text>
            </View>

            {/* Pre-tax Deductions */}
            {breakdown.pretaxDeductionsCents > 0 && (
              <>
                <View className="h-px bg-slate-700/50 my-2" />
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                  Pre-tax Deductions
                </Text>
                {breakdown.pretaxDeductions.map((d, i) => (
                  <View key={i} className="flex-row justify-between py-1">
                    <Text className="text-slate-400">{d.name}</Text>
                    <Text className="text-red-400">
                      -{formatCentsAsCurrency(d.amountCents)}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {/* Taxable Wages */}
            <View className="h-px bg-slate-700/50 my-2" />
            <View className="flex-row justify-between py-2">
              <Text className="text-slate-300">Taxable Wages</Text>
              <Text className="text-slate-300">
                {formatCentsAsCurrency(breakdown.taxableWagesCents)}
              </Text>
            </View>

            {/* Taxes */}
            <View className="h-px bg-slate-700/50 my-2" />
            <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
              Estimated Taxes
            </Text>
            <View className="flex-row justify-between py-1">
              <Text className="text-slate-400">Federal</Text>
              <Text className="text-red-400">
                -{formatCentsAsCurrency(breakdown.federalWithholdingCents)}
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-slate-400">Social Security</Text>
              <Text className="text-red-400">
                -{formatCentsAsCurrency(breakdown.socialSecurityCents)}
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-slate-400">Medicare</Text>
              <Text className="text-red-400">
                -{formatCentsAsCurrency(breakdown.medicareCents)}
              </Text>
            </View>
            {breakdown.additionalMedicareCents > 0 && (
              <View className="flex-row justify-between py-1">
                <Text className="text-slate-400">Additional Medicare</Text>
                <Text className="text-red-400">
                  -{formatCentsAsCurrency(breakdown.additionalMedicareCents)}
                </Text>
              </View>
            )}
            {breakdown.stateWithholdingCents > 0 && (
              <View className="flex-row justify-between py-1">
                <Text className="text-slate-400">
                  State ({breakdown.stateInfo.code})
                </Text>
                <Text className="text-red-400">
                  -{formatCentsAsCurrency(breakdown.stateWithholdingCents)}
                </Text>
              </View>
            )}
            {!breakdown.stateInfo.hasIncomeTax && (
              <View className="flex-row justify-between py-1">
                <Text className="text-slate-400">
                  State ({breakdown.stateInfo.code})
                </Text>
                <Text className="text-green-400">$0 (no state tax)</Text>
              </View>
            )}

            {/* Post-tax Deductions */}
            {breakdown.posttaxDeductionsCents > 0 && (
              <>
                <View className="h-px bg-slate-700/50 my-2" />
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                  Post-tax Deductions
                </Text>
                {breakdown.posttaxDeductions.map((d, i) => (
                  <View key={i} className="flex-row justify-between py-1">
                    <Text className="text-slate-400">{d.name}</Text>
                    <Text className="text-red-400">
                      -{formatCentsAsCurrency(d.amountCents)}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {/* Net Pay */}
            <View className="h-px bg-slate-700/50 my-2" />
            <View className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mt-2">
              <View className="flex-row justify-between">
                <Text className="text-white font-semibold text-lg">
                  Net Pay (Estimated)
                </Text>
                <Text className="text-green-400 font-bold text-lg">
                  {formatCentsAsCurrency(breakdown.netPayCents)}
                </Text>
              </View>
              <Text className="text-slate-500 text-xs mt-1">
                Effective rate: {breakdown.effectiveTotalRate.toFixed(1)}%
              </Text>
            </View>

            {/* Disclaimer */}
            <View className="mt-4 bg-blue-500/10 rounded-xl p-3">
              <Text className="text-blue-300 text-xs">
                This is an estimate based on your tax settings. Actual withholding
                may vary.
              </Text>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ============================================
// CARD COMPONENTS
// ============================================

// Premium Banner - Polished with clear trial language
// Slim inline chip — renders null for premium subscribers
function PremiumChip() {
  const router = useRouter();
  const tier = useSubscriptionTier();
  const daysRemaining = useTrialDaysRemaining();
  const isTrialExpired = useIsTrialExpired();

  // Gone once subscribed
  if (tier === "premium") return null;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/paywall");
  };

  if (isTrialExpired) {
    return (
      <Pressable
        onPress={handlePress}
        style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.3)", borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 5 }}
        className="active:opacity-70"
      >
        <AlertTriangle size={12} color="#f87171" />
        <Text style={{ color: "#f87171", fontSize: 12, fontWeight: "600" }}>Trial ended · Upgrade</Text>
      </Pressable>
    );
  }

  if (tier === "trial" && daysRemaining !== null) {
    const isUrgent = daysRemaining <= 2;
    return (
      <Pressable
        onPress={handlePress}
        style={{
          flexDirection: "row", alignItems: "center",
          backgroundColor: isUrgent ? "rgba(245,158,11,0.15)" : "rgba(100,116,139,0.15)",
          borderColor: isUrgent ? "rgba(245,158,11,0.35)" : "rgba(100,116,139,0.3)",
          borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 5,
        }}
        className="active:opacity-70"
      >
        <Clock size={12} color={isUrgent ? "#f59e0b" : "#94a3b8"} />
        <Text style={{ color: isUrgent ? "#f59e0b" : "#94a3b8", fontSize: 12, fontWeight: "600" }}>
          {daysRemaining}d trial left
        </Text>
      </Pressable>
    );
  }

  // Free tier
  return (
    <Pressable
      onPress={handlePress}
      style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.3)", borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 5 }}
      className="active:opacity-70"
    >
      <Crown size={12} color="#f59e0b" />
      <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "600" }}>Try Free</Text>
    </Pressable>
  );
}

// Slim contract chip for header
function ContractChip({
  hasDocuments,
  documentCount,
  primaryDocumentTitle,
  onPress,
}: {
  hasDocuments: boolean;
  documentCount: number;
  primaryDocumentTitle?: string;
  onPress: () => void;
}) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  if (hasDocuments) {
    return (
      <Pressable
        onPress={handlePress}
        style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(59,130,246,0.12)", borderColor: "rgba(59,130,246,0.3)", borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 5 }}
        className="active:opacity-70"
      >
        <CheckCircle2 size={12} color="#60a5fa" />
        <Text style={{ color: "#60a5fa", fontSize: 12, fontWeight: "500" }} numberOfLines={1}>
          {primaryDocumentTitle ?? "Contract active"}{documentCount > 1 ? ` +${documentCount - 1}` : ""}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(100,116,139,0.12)", borderColor: "rgba(100,116,139,0.25)", borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 5 }}
      className="active:opacity-70"
    >
      <FileText size={12} color="#64748b" />
      <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "500" }}>Upload contract</Text>
    </Pressable>
  );
}

// Pay Confidence Card with tappable confidence
function PayConfidenceCard({
  totalPayCents,
  netPayCents,
  showNet,
  creditMinutes,
  blockMinutes,
  eventCount,
  confidence,
  onConfidencePress,
  onWhyPress,
  onNetBreakdownPress,
  onToggleNet,
  paidMinutes,
  bufferPayMinutes,
}: {
  totalPayCents: number;
  netPayCents: number | null;
  showNet: boolean;
  creditMinutes: number;
  blockMinutes: number;
  eventCount: number;
  confidence: { level: "high" | "medium" | "low"; percent: number };
  onConfidencePress: () => void;
  onWhyPress: () => void;
  onNetBreakdownPress: () => void;
  onToggleNet: () => void;
  paidMinutes: number;
  bufferPayMinutes: number;
}) {
  const confidenceColors = {
    high: { bg: "#22c55e", text: "text-green-400" },
    medium: { bg: "#f59e0b", text: "text-amber-400" },
    low: { bg: "#ef4444", text: "text-red-400" },
  };

  const config = confidenceColors[confidence.level];
  const displayAmount = showNet && netPayCents !== null ? netPayCents : totalPayCents;

  return (
    <LinearGradient
      colors={["#0c1f3d", "#0a3d62", "#1a1a2e"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 24, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
    >
      {/* Subtle shimmer line at top */}
      <View style={{ position: "absolute", top: 0, left: 24, right: 24, height: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 1 }} />

      {/* Header Row: Confidence + Net Toggle */}
      <View className="flex-row items-center justify-between mb-5">
        {/* Tappable Confidence Badge */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onConfidencePress();
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: config.bg + "20",
            borderRadius: 99,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderWidth: 1,
            borderColor: config.bg + "50",
          }}
        >
          {confidence.level === "high" ? (
            <CheckCircle2 size={13} color={config.bg} />
          ) : (
            <AlertTriangle size={13} color={config.bg} />
          )}
          <Text style={{ color: config.bg, fontSize: 12, fontWeight: "700", marginLeft: 5, letterSpacing: 0.3 }}>
            {confidence.level.toUpperCase()} Confidence
          </Text>
          <Info size={11} color={config.bg + "90"} style={{ marginLeft: 4 }} />
        </Pressable>

        {/* Gross/Net Toggle */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}>
          <Text style={{ color: showNet ? "#64748b" : "#f1f5f9", fontSize: 12, fontWeight: showNet ? "400" : "700" }}>
            Gross
          </Text>
          <Switch
            value={showNet}
            onValueChange={onToggleNet}
            trackColor={{ false: "#334155", true: "#22c55e" }}
            thumbColor="#ffffff"
            ios_backgroundColor="#334155"
            style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
          />
          <Text style={{ color: showNet ? "#f1f5f9" : "#64748b", fontSize: 12, fontWeight: showNet ? "700" : "400" }}>
            Net
          </Text>
        </View>
      </View>

      {/* Label */}
      <Text style={{ color: "rgba(148,163,184,0.8)", fontSize: 12, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        {showNet ? "Estimated Net Pay" : "Gross Pay"} · Current Period
      </Text>

      {/* Hero Amount */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 4 }}>
        <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 22, fontWeight: "300", marginRight: 2, lineHeight: 58, letterSpacing: -0.5 }}>
          $
        </Text>
        <Text style={{ color: "#ffffff", fontSize: 52, fontWeight: "800", letterSpacing: -2, lineHeight: 62 }}>
          {formatCentsAsCurrency(displayAmount).replace("$", "").split(".")[0]}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 24, fontWeight: "600", letterSpacing: -0.5, lineHeight: 62, marginLeft: 2, marginBottom: 2 }}>
          .{formatCentsAsCurrency(displayAmount).split(".")[1] ?? "00"}
        </Text>
      </View>

      {/* Stats chips row */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: `${formatDecimalHours(creditMinutes)} cr hrs` },
          { label: `${formatDecimalHours(blockMinutes)} blk hrs` },
          { label: `${eventCount} event${eventCount !== 1 ? "s" : ""}` },
          { label: `${formatDecimalHours(paidMinutes)} paid`, highlight: true },
        ].map(({ label, highlight }) => (
          <View key={label} style={{ backgroundColor: highlight ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.06)", borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: highlight ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)" }}>
            <Text style={{ color: highlight ? "#4ade80" : "rgba(226,232,240,0.7)", fontSize: 11, fontWeight: "600" }}>{label}</Text>
          </View>
        ))}
        {bufferPayMinutes > 0 && (
          <View style={{ backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}>
            <Text style={{ color: "#fcd34d", fontSize: 11, fontWeight: "700" }}>+{formatDecimalHours(bufferPayMinutes)} buffer</Text>
          </View>
        )}
      </View>

      {/* Actions Row */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" }}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onWhyPress();
          }}
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <View style={{ backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 99, padding: 5, marginRight: 6 }}>
            <HelpCircle size={12} color="#94a3b8" />
          </View>
          <Text style={{ color: "#94a3b8", fontSize: 13, fontWeight: "500" }}>Why this amount?</Text>
        </Pressable>

        {showNet && netPayCents !== null && (
          <>
            <View style={{ width: 1, height: 14, backgroundColor: "rgba(255,255,255,0.1)", marginHorizontal: 12 }} />
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onNetBreakdownPress();
              }}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Text style={{ color: "#4ade80", fontSize: 13, fontWeight: "600" }}>Tax breakdown</Text>
            </Pressable>
          </>
        )}

        <View style={{ flex: 1 }} />
        <PayConfidenceBadge size="sm" showIcon={true} />
      </View>
    </LinearGradient>
  );
}

// Performance Card with % efficiency and unpaid block hours
function PerformanceCard({
  creditMinutes,
  blockMinutes,
}: {
  creditMinutes: number;
  blockMinutes: number;
}) {
  // Credit efficiency: what % of block time are you paid for
  const efficiency = blockMinutes > 0 ? (creditMinutes / blockMinutes) * 100 : 0;
  const unpaidBlockMinutes = Math.max(0, blockMinutes - creditMinutes);

  const getEfficiencyConfig = () => {
    if (efficiency >= 100) return { text: "text-green-400", bg: "#22c55e", bar: "#22c55e", label: "Excellent" };
    if (efficiency >= 85) return { text: "text-amber-400", bg: "#f59e0b", bar: "#f59e0b", label: "Good" };
    return { text: "text-slate-400", bg: "#64748b", bar: "#64748b", label: "Below Average" };
  };

  const config = getEfficiencyConfig();
  const barWidth = Math.min(100, efficiency);

  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>
      <View className="flex-row items-center mb-3">
        <View style={{ backgroundColor: config.bg + "20", borderRadius: 99, padding: 5, marginRight: 8 }}>
          <Sparkles size={14} color={config.bg} />
        </View>
        <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>
          Pay Efficiency
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ color: config.bar, fontWeight: "800", fontSize: 22, letterSpacing: -1 }}>
          {efficiency.toFixed(0)}%
        </Text>
      </View>

      {/* Progress bar */}
      <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden", marginBottom: 12 }}>
        <View
          style={{ width: `${barWidth}%`, height: "100%", borderRadius: 99, backgroundColor: config.bar }}
        />
      </View>

      {/* Explanation */}
      <Text style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>
        You are paid for{" "}
        <Text style={{ color: config.bar, fontWeight: "700" }}>
          {efficiency.toFixed(0)}% of your flying time
        </Text>
        .
      </Text>

      {/* Metrics row */}
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.05)", paddingTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#475569", fontSize: 11 }}>Credit</Text>
          <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 16 }}>
            {formatDecimalHours(creditMinutes)} hrs
          </Text>
        </View>
        <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#475569", fontSize: 11 }}>Block</Text>
          <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 16 }}>
            {formatDecimalHours(blockMinutes)} hrs
          </Text>
        </View>
        <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#475569", fontSize: 11 }}>Unpaid</Text>
          <Text style={{ color: unpaidBlockMinutes > 0 ? "#94a3b8" : "#4ade80", fontWeight: "700", fontSize: 16 }}>
            {formatDecimalHours(unpaidBlockMinutes)} hrs
          </Text>
        </View>
      </View>
    </View>
  );
}

// Current Trip Value Card
function CurrentTripValueCard({
  trips,
  allTimeAverageTripPayCents,
  hourlyRateCents,
}: {
  trips: TripSummary[];
  allTimeAverageTripPayCents: number;
  hourlyRateCents: number;
}) {
  // Find the active trip (started on or before today, ending on or after today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeTrip = trips.find((t) => {
    const start = new Date(t.startDate + "T00:00:00");
    const end = new Date(t.endDate + "T23:59:59");
    return start <= today && end >= today && t.status !== "cancelled";
  });

  if (!activeTrip) {
    return (
      <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>
        <View className="flex-row items-center mb-2">
          <View style={{ backgroundColor: "rgba(100,116,139,0.15)", borderRadius: 99, padding: 5, marginRight: 8 }}>
            <TrendingUp size={14} color="#64748b" />
          </View>
          <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>
            Current Trip Value
          </Text>
        </View>
        <Text style={{ color: "#475569", fontSize: 13 }}>
          No active trip. Trip value appears when a pairing is active.
        </Text>
      </View>
    );
  }

  // Resolve trip pay: use stored value if available, otherwise calculate from credit minutes × rate
  const resolvedPayCents = activeTrip.totalPayCents > 0
    ? activeTrip.totalPayCents
    : hourlyRateCents > 0 && activeTrip.totalCreditMinutes > 0
      ? Math.round((activeTrip.totalCreditMinutes / 60) * hourlyRateCents)
      : 0;

  // Calculate days away (TAFB in minutes → days, fallback to date diff)
  const daysAway = activeTrip.totalTafbMinutes > 0
    ? activeTrip.totalTafbMinutes / 60 / 24
    : (() => {
        const start = new Date(activeTrip.startDate + "T00:00:00");
        const end = new Date(activeTrip.endDate + "T23:59:59");
        return Math.max(0.5, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      })();

  const perDayCents = daysAway > 0 ? resolvedPayCents / daysAway : 0;

  // Compare to average
  const hasAverage = allTimeAverageTripPayCents > 0;
  const isAboveAverage = resolvedPayCents > allTimeAverageTripPayCents * 1.05;
  const isBelowAverage = resolvedPayCents < allTimeAverageTripPayCents * 0.95;

  const contextLabel = !hasAverage
    ? null
    : isAboveAverage
    ? "Above your average trip value"
    : isBelowAverage
    ? "Below your average trip value"
    : "Near your average trip value";

  const contextColor = !hasAverage
    ? "#64748b"
    : isAboveAverage
    ? "#22c55e"
    : isBelowAverage
    ? "#f59e0b"
    : "#64748b";

  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>
      <View className="flex-row items-center mb-3">
        <View style={{ backgroundColor: "rgba(34,197,94,0.15)", borderRadius: 99, padding: 5, marginRight: 8 }}>
          <TrendingUp size={14} color="#22c55e" />
        </View>
        <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>
          Active Trip Value
        </Text>
      </View>

      <View className="flex-row mb-3">
        <View className="flex-1">
          <Text style={{ color: "#475569", fontSize: 11, marginBottom: 2 }}>Trip Pay</Text>
          <Text style={{ color: "#f1f5f9", fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}>
            {formatCentsShort(resolvedPayCents)}
          </Text>
        </View>
        <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 12 }} />
        <View className="flex-1">
          <Text style={{ color: "#475569", fontSize: 11, marginBottom: 2 }}>Time Away</Text>
          <Text style={{ color: "#f1f5f9", fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}>
            {daysAway.toFixed(1)} days
          </Text>
        </View>
      </View>

      {/* Per day headline */}
      <View style={{ backgroundColor: "rgba(34,197,94,0.07)", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "rgba(34,197,94,0.15)" }}>
        <Text style={{ color: "#475569", fontSize: 11, marginBottom: 2 }}>Daily Rate</Text>
        <Text style={{ color: "#4ade80", fontSize: 22, fontWeight: "800", letterSpacing: -1 }}>
          {formatCentsShort(perDayCents)} / day
        </Text>
      </View>

      {/* Context indicator */}
      {contextLabel && (
        <View className="flex-row items-center">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: contextColor, marginRight: 6 }} />
          <Text style={{ color: contextColor, fontSize: 12 }}>
            {contextLabel}
          </Text>
          {hasAverage && (
            <Text style={{ color: "#334155", fontSize: 12, marginLeft: 4 }}>
              (avg {formatCentsShort(allTimeAverageTripPayCents)})
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// Action Needed Card - Only shows when relevant
function ActionNeededCard({
  actions,
  onPress,
}: {
  actions: Array<{ type: string; message: string }>;
  onPress: () => void;
}) {
  if (actions.length === 0) return null;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={{ backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" }}
    >
      <View className="flex-row items-center mb-2">
        <Zap size={18} color="#f59e0b" />
        <Text className="text-amber-400 font-semibold ml-2">Action Needed</Text>
      </View>
      {actions.map((action, index) => (
        <View key={index} className="flex-row items-center mt-1">
          <View className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-2" />
          <Text className="text-amber-300/80 text-sm flex-1">
            {action.message}
          </Text>
        </View>
      ))}
      <Text className="text-amber-500 text-xs mt-2">Tap to review</Text>
    </Pressable>
  );
}

// Pay Period Status (formerly Pay Period Outlook)
function PayPeriodStatus({
  nextPayDate,
  nextPayType,
  daysLeft,
  periodDaysTotal,
  periodProjectedCents,
  hourlyRateCents,
  tripsRemaining,
  periodEnd,
}: {
  nextPayDate: string;
  nextPayType: "standard" | "remainder" | null;
  daysLeft: number;
  periodDaysTotal: number;
  periodProjectedCents: number;
  hourlyRateCents: number;
  tripsRemaining: number;
  periodEnd: string;
}) {
  // Use real period length from backend (UPS periods are 27-29 days, not always 28)
  const totalPeriodDays = periodDaysTotal > 0 ? periodDaysTotal : 28;
  const daysElapsed = Math.max(0, totalPeriodDays - daysLeft);
  const progressPct = Math.min(1, daysElapsed / totalPeriodDays);

  const progressColor = daysLeft <= 3 ? "#ef4444" : daysLeft <= 7 ? "#f59e0b" : "#3b82f6";

  // Compute what will actually land in the account on the next pay date.
  // UPS advance (standard) = 37.5 hrs guarantee only (50% of 75-hr monthly guarantee).
  // UPS settlement (remainder) = period total projected minus the advance already paid.
  const ADVANCE_HOURS = 37.5;
  const advanceCents = Math.round((ADVANCE_HOURS * hourlyRateCents));

  let nextCheckCents: number;
  let checkLabel: string;

  if (nextPayType === "standard") {
    // Advance check — fixed 37.5 hrs regardless of flying
    nextCheckCents = advanceCents;
    checkLabel = "Advance Check";
  } else if (nextPayType === "remainder") {
    // Settlement — period total minus the advance already paid
    nextCheckCents = Math.max(0, periodProjectedCents - advanceCents);
    checkLabel = "Settlement Check";
  } else {
    // Unknown — show period total as fallback
    nextCheckCents = periodProjectedCents;
    checkLabel = "Projected";
  }

  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>
      <View className="flex-row items-center mb-3">
        <View style={{ backgroundColor: "rgba(59,130,246,0.15)", borderRadius: 99, padding: 5, marginRight: 8 }}>
          <CalendarClock size={14} color="#60a5fa" />
        </View>
        <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>
          Pay Period
        </Text>
      </View>

      {/* Two-column layout */}
      <View className="flex-row mb-4">
        <View className="flex-1">
          <Text style={{ color: "#475569", fontSize: 11, marginBottom: 2 }}>Next Paycheck</Text>
          <Text style={{ color: "#f1f5f9", fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}>{nextPayDate}</Text>
          <Text style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>{checkLabel}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.06)", marginHorizontal: 12 }} />
        <View className="flex-1">
          <Text style={{ color: "#475569", fontSize: 11, marginBottom: 2 }}>Est. Amount</Text>
          <Text style={{ color: "#4ade80", fontWeight: "800", fontSize: 20, letterSpacing: -0.5 }}>
            {formatCentsShort(nextCheckCents)}
          </Text>
          <Text style={{ color: "#64748b", fontSize: 11, marginTop: 1 }}>
            ~{formatCentsShort(periodProjectedCents)} total
          </Text>
        </View>
      </View>

      {/* Days remaining progress bar */}
      <View>
        <View className="flex-row justify-between mb-2">
          <Text style={{ color: "#475569", fontSize: 11 }}>
            {daysLeft} day{daysLeft !== 1 ? "s" : ""} left in period
          </Text>
          <Text style={{ color: "#475569", fontSize: 11 }}>
            {tripsRemaining} trip{tripsRemaining !== 1 ? "s" : ""} remaining
          </Text>
        </View>
        <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
          <View
            style={{
              width: `${progressPct * 100}%`,
              height: "100%",
              borderRadius: 99,
              backgroundColor: progressColor,
            }}
          />
        </View>
      </View>
    </View>
  );
}

// Earnings Summary - Consolidated MTD/YTD
function EarningsSummary({
  monthToDate,
  yearToDate,
  projectedYear,
  isLoading,
}: {
  monthToDate: number;
  yearToDate: number;
  projectedYear: number;
  isLoading?: boolean;
}) {
  const showMtdSeparately = monthToDate !== yearToDate && monthToDate > 0;
  const displayValue = (val: number) => isLoading ? "—" : formatCentsShort(val);

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}>
      <LinearGradient
        colors={["rgba(255,255,255,0.04)", "rgba(255,255,255,0.02)"]}
        style={{ padding: 16 }}
      >
        <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12 }}>
          Earnings
        </Text>
        <View className="flex-row items-center justify-between">
          {showMtdSeparately && (
            <>
              <View className="flex-1 items-center">
                <Text style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>This Month</Text>
                <Text style={{ color: "#e2e8f0", fontWeight: "700", fontSize: 15 }}>
                  {displayValue(monthToDate)}
                </Text>
              </View>
              <View style={{ width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.06)" }} />
            </>
          )}
          <View className="flex-1 items-center">
            <Text style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>Year-to-Date</Text>
            <Text style={{ color: "#f1f5f9", fontWeight: "800", fontSize: 18 }}>
              {displayValue(yearToDate)}
            </Text>
          </View>
          <View style={{ width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.06)" }} />
          <View className="flex-1 items-center">
            <Text style={{ color: "#475569", fontSize: 11, marginBottom: 3 }}>On Pace For</Text>
            <Text style={{ color: "#4ade80", fontWeight: "800", fontSize: 18 }}>
              {displayValue(projectedYear)}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

// Pay Events Summary
function PayEventsSummary({
  events,
  onPress,
}: {
  events: Array<{ id: string; eventType: string; airlineLabel: string | null }>;
  onPress: () => void;
}) {
  if (events.length === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" }}>
          Pay Events This Period
        </Text>
        <ChevronRight size={16} color="#334155" />
      </View>

      {events.slice(0, 3).map((event, index) => (
        <View
          key={event.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 8,
            borderBottomWidth: index < Math.min(events.length, 3) - 1 ? 1 : 0,
            borderBottomColor: "rgba(255,255,255,0.05)",
          }}
        >
          <View style={{ width: 5, height: 5, borderRadius: 99, backgroundColor: "#f59e0b", marginRight: 10 }} />
          <Text style={{ color: "#94a3b8", fontSize: 13, flex: 1 }}>
            {event.airlineLabel ||
              formatEventType(event.eventType as PayEventType)}
          </Text>
        </View>
      ))}

      {events.length > 3 && (
        <Text style={{ color: "#334155", fontSize: 12, marginTop: 6 }}>
          +{events.length - 3} more events
        </Text>
      )}
    </Pressable>
  );
}

// Quick Actions
function QuickActions({
  onLogEvent,
  onPayStatements,
  onAddRecord,
  onPayAudit,
}: {
  onLogEvent: () => void;
  onPayStatements: () => void;
  onAddRecord: () => void;
  onPayAudit: () => void;
}) {
  const actions = [
    { Icon: Plus, label: "Log Pay Event", onPress: onLogEvent, color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
    { Icon: FileText, label: "Pay Summary", onPress: onPayStatements, color: "#a78bfa", bg: "rgba(167,139,250,0.1)", border: "rgba(167,139,250,0.2)" },
    { Icon: ClipboardList, label: "Add Record", onPress: onAddRecord, color: "#38bdf8", bg: "rgba(56,189,248,0.1)", border: "rgba(56,189,248,0.2)" },
    { Icon: ShieldCheck, label: "Pay Audit", onPress: onPayAudit, color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.2)" },
  ];

  return (
    <View>
      <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
        Quick Actions
      </Text>
      <View className="flex-row gap-2">
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              action.onPress();
            }}
            style={{ flex: 1, backgroundColor: action.bg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, borderWidth: 1, borderColor: action.border, alignItems: "center" }}
          >
            <action.Icon size={20} color={action.color} />
            <Text style={{ color: "#e2e8f0", fontSize: 10, fontWeight: "600", marginTop: 8, textAlign: "center", lineHeight: 13 }}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Contract Upload Card
// ============================================
// MAIN SCREEN
// ============================================

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { px, contentMaxWidth } = useResponsive();
  const { data: session, isPending: isSessionPending } = useSession();
  const isAuthenticated = !!session?.user;

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("dashboard");

  const { isLoading: isRQProfileLoading } = useProfileQuery(isAuthenticated);
  const isProfileStoreLoading = useProfileLoading();
  const isProfileLoading = isRQProfileLoading || isProfileStoreLoading;
  const profile = useProfile();
  const isProfileComplete = useIsProfileComplete();

  const [showAnniversaryBanner, setShowAnniversaryBanner] = useState(true);

  // Network status for offline support
  const isOnline = useIsOnline();

  // Auto-refresh key queries when coming back online
  useAutoRefreshOnReconnect([
    ["dashboard"],
    ["trips-period"],
    ["profile-stats"],
    ["pay-events"],
  ]);

  // Modal states
  const [confidenceModalVisible, setConfidenceModalVisible] = useState(false);
  const [payExplanationVisible, setPayExplanationVisible] = useState(false);
  const [netBreakdownVisible, setNetBreakdownVisible] = useState(false);
  const [changesModalVisible, setChangesModalVisible] = useState(false);
  const [changesPopupDismissed, setChangesPopupDismissed] = useState(false);
  const [actionNeededModalVisible, setActionNeededModalVisible] = useState(false);
  const [awardedCreditModalVisible, setAwardedCreditModalVisible] = useState(false);

  // Schedule changes data
  const unacknowledgedChangesCount = useUnacknowledgedChangesCount();

  // Net pay state
  const showNetPay = useShowNetPay();
  const toggleShowNetPay = useTaxStore((s) => s.toggleShowNetPay);
  const lastBreakdown = useTaxStore((s) => s.lastBreakdown);
  const calculateNetPayMutation = useCalculateNetPay();

  // Data hooks
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading: dashboardLoading, refetch: refetchDashboard, isRefetching } = useDashboard();
  // Awarded-credit baseline for current period (drives pay logic + blank-period prompt)
  const { data: baselineData } = useBidPeriodBaseline();
  const { data: payEventsData } = usePayEvents({
    startDate: dashboard?.periodStart,
    endDate: dashboard?.periodEnd,
  });
  const { data: projections } = useProjections();
  const { projectedAnnualCents, isLoading: isSharedProjectedAnnualLoading } = useSharedProjectedAnnual();
  const { data: stats } = useProfileStats();
  const { data: trips } = useTripsForPeriod(
    dashboard?.periodStart,
    dashboard?.periodEnd
  );
  const { data: contractsData } = useContracts();
  const { data: upcomingPayDates } = useUpcomingPayDates();

  // Auto-fix trips imported with $0 pay (missing hourly rate during import)
  const payFixedRef = useRef(false);
  const recalculatePayMutation = useMutation({
    mutationFn: () => api.post('/api/trips/recalculate-pay', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trips-period'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  useEffect(() => {
    if (!trips || !isAuthenticated || payFixedRef.current) return;
    const hasZeroPayTrips = trips.some((t: any) => t.totalPayCents === 0 && (t.totalCreditMinutes ?? 0) > 0);
    if (!hasZeroPayTrips) return;
    payFixedRef.current = true;
    recalculatePayMutation.mutate();
  }, [trips, isAuthenticated]);

  // Schedule pay-related notifications (pay period ending, payday)
  const currentPeriodInfo = useMemo(() => {
    if (!dashboard) return undefined;
    return {
      year: new Date().getFullYear(),
      periodNumber: dashboard.currentPeriod,
      startDate: dashboard.periodStart,
      endDate: dashboard.periodEnd,
      payDate: "", // Will be filled from upcomingPayDates
    };
  }, [dashboard]);

  usePayNotificationScheduler(currentPeriodInfo, upcomingPayDates);

  // Calculate net pay when gross or YTD changes — skip identical values to prevent flicker
  const lastNetPayKey = useRef("");
  useEffect(() => {
    if (!dashboard?.totalPayCents || !showNetPay || !isAuthenticated) return;
    const key = `${dashboard.totalPayCents}:${stats?.currentYear.totalPayCents ?? 0}`;
    if (lastNetPayKey.current === key) return;
    lastNetPayKey.current = key;
    calculateNetPayMutation.mutate({
      grossPayCents: dashboard.totalPayCents,
      ytdWagesCents: stats?.currentYear.totalPayCents ?? 0,
    });
  }, [dashboard?.totalPayCents, stats?.currentYear.totalPayCents, showNetPay, isAuthenticated]);

  // Redirect to profile setup or onboarding if needed
  useEffect(() => {
    if (!isSessionPending && isAuthenticated && !isProfileLoading) {
      if (!isProfileComplete) {
        router.replace("/profile-setup");
      } else if (profile && !profile.onboardingComplete) {
        if (profile.onboardingStep === 0) {
          router.replace("/onboarding/airline-select" as any);
        } else if (profile.onboardingStep === 1) {
          router.replace("/onboarding/contract-upload" as any);
        } else if (profile.onboardingStep >= 2) {
          // Steps 2+ go to schedule-sync (rule-mapping removed)
          router.replace("/onboarding/schedule-sync" as any);
        }
      }
    }
  }, [isSessionPending, isAuthenticated, isProfileLoading, isProfileComplete, profile, router]);

  // Anniversary check
  const anniversary = useMemo(
    () => checkAnniversary(profile?.dateOfHire ?? null),
    [profile?.dateOfHire]
  );

  // Calculate confidence with reasons
  const confidence = useMemo(() => {
    const pendingEvents =
      payEventsData?.events.filter((e) => e.status === "open").length ?? 0;
    const needsReviewCount = trips?.filter((t) => t.needsReview).length ?? 0;

    return calculateConfidence({
      hasFlights: (dashboard?.entryCount ?? 0) > 0,
      pendingEvents,
      needsReviewCount,
      hasContractRules: contractsData?.hasActiveDocuments ?? false,
    });
  }, [dashboard, payEventsData, trips, contractsData]);

  // Action needed items - includes Open/Disputed records from audit trail
  // Simple summary for the card display
  const actionItemsSummary = useMemo(() => {
    const actions: Array<{ type: string; message: string }> = [];
    const needsReviewCount = trips?.filter((t) => t.needsReview).length ?? 0;
    const openEvents =
      payEventsData?.events.filter((e) => e.status === "open").length ?? 0;
    const disputedEvents =
      payEventsData?.events.filter((e) => e.status === "disputed").length ?? 0;

    if (needsReviewCount > 0) {
      actions.push({
        type: "review",
        message: `${needsReviewCount} trip${needsReviewCount !== 1 ? "s" : ""} may require pay review`,
      });
    }

    if (openEvents > 0) {
      actions.push({
        type: "open",
        message: `${openEvents} open pay event${openEvents !== 1 ? "s" : ""} pending verification`,
      });
    }

    if (disputedEvents > 0) {
      actions.push({
        type: "disputed",
        message: `${disputedEvents} disputed record${disputedEvents !== 1 ? "s" : ""} need attention`,
      });
    }

    return actions;
  }, [trips, payEventsData]);

  // Detailed action items with IDs for the modal
  const detailedActionItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: "open" | "disputed" | "review" | "changes";
      title: string;
      description?: string;
      eventType?: PayEventType;
    }> = [];

    // Add open pay events
    const openEvents = payEventsData?.events.filter((e) => e.status === "open") ?? [];
    openEvents.forEach((event) => {
      items.push({
        id: event.id,
        type: "open",
        title: event.airlineLabel || formatEventType(event.eventType as PayEventType),
        description: "Pending verification",
        eventType: event.eventType as PayEventType,
      });
    });

    // Add disputed pay events
    const disputedEvents = payEventsData?.events.filter((e) => e.status === "disputed") ?? [];
    disputedEvents.forEach((event) => {
      items.push({
        id: event.id,
        type: "disputed",
        title: event.airlineLabel || formatEventType(event.eventType as PayEventType),
        description: "Needs attention",
        eventType: event.eventType as PayEventType,
      });
    });

    // Add trips needing review
    const reviewTrips = trips?.filter((t) => t.needsReview) ?? [];
    reviewTrips.forEach((trip) => {
      items.push({
        id: trip.id,
        type: "review",
        title: `Trip ${formatDateDisplay(trip.startDate)}`,
        description: "Tap to review trip details and confirm pay",
      });
    });

    return items;
  }, [trips, payEventsData]);

  // Average trip pay (all trips in period with pay > 0)
  const averageTripPayCents = useMemo(() => {
    const paidTrips = trips?.filter((t) => t.totalPayCents > 0) ?? [];
    if (paidTrips.length === 0) return 0;
    return Math.round(paidTrips.reduce((sum, t) => sum + t.totalPayCents, 0) / paidTrips.length);
  }, [trips]);

  // Next pay date calculation — use real UPS pay calendar
  const nextPayInfo = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().split("T")[0] ?? "";

    // Use the real upcoming pay dates from the UPS calendar
    if (upcomingPayDates && upcomingPayDates.length > 0) {
      const next = upcomingPayDates.find((pd) => pd.payDate >= todayISO);
      if (next) {
        const payDate = new Date(next.payDate + "T12:00:00");
        const daysLeft = Math.max(
          0,
          Math.ceil((payDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        );
        return {
          date: payDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          daysLeft,
          payType: next.payType,
        };
      }
    }

    // Fallback: period end + 5 days
    if (!dashboard) return { date: "--", daysLeft: 0, payType: null as null };
    const endDate = new Date(dashboard.periodEnd + "T12:00:00");
    const payDate = new Date(endDate);
    payDate.setDate(payDate.getDate() + 5);
    const daysLeft = Math.max(
      0,
      Math.ceil((payDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    );
    return {
      date: payDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      daysLeft,
      payType: null as null,
    };
  }, [dashboard, upcomingPayDates]);

  // Days left in period
  const daysLeftInPeriod = useMemo(() => {
    if (!dashboard) return 0;
    const endDate = new Date(dashboard.periodEnd + "T23:59:59");
    const today = new Date();
    return Math.max(
      0,
      Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    );
  }, [dashboard]);

  const isLoading = dashboardLoading && isAuthenticated;

  // Contract guarantee breakdown — use server-computed values when available.
  // The server already accounts for dropped trips (reducing the guarantee floor)
  // and company-removed trips (protecting pay credit). Never recompute locally.
  const dashGuarantee = useMemo(() => {
    const periodType = resolveBidPeriodType(profile?.creditCapPeriodType);

    // Server provides authoritative guarantee-aware values
    if (dashboard?.paidCreditMinutes !== undefined) {
      const paidHours = dashboard.paidCreditMinutes / 60;
      const lineCreditHours = (dashboard.totalCreditMinutes ?? 0) / 60;
      const bufferPayHours = (dashboard.bufferMinutes ?? 0) / 60;
      const droppedHours = (dashboard.droppedByUserCreditMinutes ?? 0) / 60;
      const guaranteeHours = GUARANTEE_HOURS_BY_PERIOD[periodType] ?? 75;
      // Adjusted guarantee floor = guarantee - dropped credit (can't claim back what you dropped)
      const adjustedGuaranteeHours = Math.max(0, guaranteeHours - droppedHours);
      return {
        lineCreditHours,
        guaranteeHours: adjustedGuaranteeHours,
        paidHours,
        bufferPayHours,
        isOnGuarantee: dashboard.isGuaranteeActive ?? false,
        isGuaranteeWaivedByUserDrop: dashboard.isGuaranteeWaivedByUserDrop ?? false,
        droppedHours,
        periodType,
      };
    }

    // Fallback: no server data yet
    const lineCreditHours = (dashboard?.totalCreditMinutes ?? 0) / 60;
    return { ...calculateGuaranteeBreakdown(lineCreditHours, periodType), droppedHours: 0, isGuaranteeWaivedByUserDrop: false };
  }, [dashboard?.paidCreditMinutes, dashboard?.totalCreditMinutes, dashboard?.bufferMinutes, dashboard?.droppedByUserCreditMinutes, dashboard?.isGuaranteeActive, dashboard?.isGuaranteeWaivedByUserDrop, profile?.creditCapPeriodType]);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(() => {
    refetchDashboard();
  }, [refetchDashboard]);

  return (
    <View className="flex-1" style={{ backgroundColor: "#070e1a" }}>
      <LinearGradient
        colors={["#0d1b2e", "#071325", "#020b1a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#f59e0b"
            />
          }
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <View className="flex-row items-center mb-1">
                  <View style={{ backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 99, padding: 5, marginRight: 8 }}>
                    <Plane size={14} color="#f59e0b" />
                  </View>
                  <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>
                    {profile?.airline ?? "UPS"} Pilot Pay
                  </Text>
                </View>
                <Text style={{ color: "#ffffff", fontSize: 26, fontWeight: "800", letterSpacing: -0.5 }}>Pay Dashboard</Text>
                <Text className="text-slate-500 text-xs mt-1">
                  {dashboard
                    ? `Period ${dashboard.currentPeriod} · ${formatDateDisplay(dashboard.periodStart)} – ${formatDateDisplay(dashboard.periodEnd)}`
                    : "Loading..."}
                </Text>
                {/* Inline status chips */}
                {isAuthenticated && !isLoading && (
                  <View className="flex-row items-center gap-2 mt-2 flex-wrap">
                    <PremiumChip />
                    <ContractChip
                      hasDocuments={contractsData?.hasActiveDocuments ?? false}
                      documentCount={contractsData?.totalCount ?? 0}
                      primaryDocumentTitle={contractsData?.documents?.[0]?.title}
                      onPress={() => router.push("/contract-references")}
                    />
                  </View>
                )}
              </View>
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    openTutorial();
                  }}
                  style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}
                >
                  <HelpCircle size={17} color="#94a3b8" />
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push("/settings");
                  }}
                  style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}
                >
                  <Settings size={17} color="#94a3b8" />
                </Pressable>
              </View>
            </View>
          </Animated.View>

          {/* Anniversary Banner */}
          {isAuthenticated && anniversary.isAnniversary && showAnniversaryBanner && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(120)}
              exiting={webSafeExit(FadeOut.duration(300))}
              className="mx-5 mt-4"
            >
              <LinearGradient
                colors={["#f59e0b", "#d97706"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 12, padding: 12 }}
              >
                <View className="flex-row items-center">
                  <PartyPopper size={20} color="#ffffff" />
                  <View className="flex-1 ml-3">
                    <Text className="text-white font-semibold">
                      Happy {anniversary.years} Year Anniversary!
                    </Text>
                  </View>
                  <Pressable onPress={() => setShowAnniversaryBanner(false)}>
                    <X size={18} color="#ffffff" />
                  </Pressable>
                </View>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Offline Indicator */}
          {isAuthenticated && (
            <View className="mt-3">
              <OfflineIndicator
                message="You're offline - showing cached data"
                showSyncStatus={false}
              />
            </View>
          )}

          {/* Loading State */}
          {isLoading && (
            <View className="mx-5 mt-8 items-center">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading dashboard...</Text>
            </View>
          )}

          {/* Not Authenticated */}
          {!isAuthenticated && !isSessionPending && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(200)}
              className="mx-5 mt-8"
            >
              <View className="bg-slate-800/60 rounded-2xl p-6 items-center border border-slate-700/50">
                <Plane size={40} color="#64748b" />
                <Text className="text-white text-lg font-semibold mt-4">
                  Sign in to track your pay
                </Text>
                <Text className="text-slate-400 text-center mt-2">
                  Upload your schedule or log your first pay event to get started.
                </Text>
                <Pressable
                  onPress={() => router.push("/welcome")}
                  className="bg-amber-500 rounded-2xl px-6 py-3 mt-4 active:opacity-80"
                >
                  <Text className="text-slate-900 font-bold">Get Started</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* Dashboard Content */}
          {isAuthenticated && dashboard && (
            <>
              {/* Pay Confidence Card */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(150)}
                className="mx-5 mt-4"
              >
                <PayConfidenceCard
                  totalPayCents={dashboard.totalPayCents}
                  netPayCents={lastBreakdown?.netPayCents ?? null}
                  showNet={showNetPay}
                  creditMinutes={dashboard.totalCreditMinutes}
                  blockMinutes={dashboard.totalBlockMinutes}
                  eventCount={payEventsData?.events.length ?? 0}
                  confidence={confidence}
                  onConfidencePress={() => setConfidenceModalVisible(true)}
                  onWhyPress={() => setPayExplanationVisible(true)}
                  onNetBreakdownPress={() => setNetBreakdownVisible(true)}
                  onToggleNet={toggleShowNetPay}
                  paidMinutes={dashGuarantee.paidHours * 60}
                  bufferPayMinutes={dashGuarantee.bufferPayHours * 60}
                />
              </Animated.View>

              {/* Action Needed Card */}
              {(actionItemsSummary.length > 0 || unacknowledgedChangesCount > 0) && (
                <Animated.View
                  entering={FadeInUp.duration(600).delay(180)}
                  className="mx-5 mt-4"
                >
                  <ActionNeededCard
                    actions={[
                      ...actionItemsSummary,
                      ...(unacknowledgedChangesCount > 0
                        ? [
                            {
                              type: "changes",
                              message: `${unacknowledgedChangesCount} schedule change${unacknowledgedChangesCount !== 1 ? "s" : ""} to review`,
                            },
                          ]
                        : []),
                    ]}
                    onPress={() => {
                      setActionNeededModalVisible(true);
                    }}
                  />
                </Animated.View>
              )}

              {/* Awarded-Credit Baseline Prompt */}
              {dashboard?.baselineAnalysis && !dashboard.baselineAnalysis.isBaselineSet && (
                <Animated.View
                  entering={FadeInUp.duration(600).delay(195)}
                  className="mx-5 mt-4"
                >
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setAwardedCreditModalVisible(true);
                    }}
                    className="rounded-2xl p-4 flex-row items-center gap-3 active:opacity-80"
                    style={{
                      backgroundColor: "rgba(245,158,11,0.10)",
                      borderWidth: 1,
                      borderColor: "rgba(245,158,11,0.30)",
                    }}
                  >
                    <View className="w-9 h-9 rounded-xl bg-amber-500/20 items-center justify-center">
                      <Target size={18} color="#f59e0b" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-amber-300 font-semibold text-sm">Set awarded line credit</Text>
                      <Text className="text-slate-400 text-xs mt-0.5">
                        Improves pay accuracy · helps classify pickups &amp; drops
                      </Text>
                    </View>
                    <ChevronRight size={16} color="#f59e0b" />
                  </Pressable>
                </Animated.View>
              )}

              {/* Awarded-Credit Baseline Set — tap to edit */}
              {dashboard?.baselineAnalysis?.isBaselineSet && (
                <Animated.View
                  entering={FadeInUp.duration(600).delay(195)}
                  className="mx-5 mt-4"
                >
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setAwardedCreditModalVisible(true);
                    }}
                    className="rounded-2xl px-4 py-3 flex-row items-center gap-3 active:opacity-80"
                    style={{
                      backgroundColor: "rgba(30,41,59,0.6)",
                      borderWidth: 1,
                      borderColor: "rgba(71,85,105,0.4)",
                    }}
                  >
                    <View className="w-8 h-8 rounded-xl bg-blue-500/15 items-center justify-center">
                      <Target size={16} color="#60a5fa" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-400 text-xs">Awarded line credit</Text>
                      <Text className="text-white text-sm font-semibold">
                        {(dashboard.baselineAnalysis.awardedCreditMinutes / 60).toFixed(1)} hrs
                        <Text className="text-slate-500 text-xs font-normal">
                          {" "}· {dashboard.baselineAnalysis.source === "uploaded_award" ? "uploaded" : dashboard.baselineAnalysis.source === "manual_entry" ? "manual" : "estimated"}
                        </Text>
                      </Text>
                    </View>
                    <Text className="text-slate-500 text-xs">Edit</Text>
                  </Pressable>
                </Animated.View>
              )}

              {/* Pay Period Status */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(210)}
                className="mx-5 mt-5"
              >
                <PayPeriodStatus
                  nextPayDate={nextPayInfo.date}
                  nextPayType={nextPayInfo.payType ?? null}
                  daysLeft={daysLeftInPeriod}
                  periodDaysTotal={projections?.payPeriod.daysTotal ?? 28}
                  periodProjectedCents={
                    (projections?.payPeriod.projectedCents ?? 0) > 0
                      ? projections?.payPeriod.projectedCents ?? 0
                      : Math.round(projectedAnnualCents / 13)
                  }
                  hourlyRateCents={profile?.hourlyRateCents ?? 32500}
                  tripsRemaining={(() => {
                    const todayISO = new Date().toISOString().split("T")[0] ?? "";
                    return trips?.filter(
                      (t) => t.status === "scheduled" && t.startDate > todayISO
                    ).length ?? 0;
                  })()}
                  periodEnd={dashboard.periodEnd}
                />
              </Animated.View>

              {/* Performance Card */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(240)}
                className="mx-5 mt-4"
              >
                <PerformanceCard
                  creditMinutes={dashboard.totalCreditMinutes}
                  blockMinutes={dashboard.totalBlockMinutes}
                />
              </Animated.View>

              {/* Current Trip Value */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(260)}
                className="mx-5 mt-4"
              >
                <CurrentTripValueCard
                  trips={trips ?? []}
                  allTimeAverageTripPayCents={averageTripPayCents}
                  hourlyRateCents={profile?.hourlyRateCents ?? 0}
                />
              </Animated.View>

              {/* Pay Events Summary */}
              {(payEventsData?.events.length ?? 0) > 0 && (
                <Animated.View
                  entering={FadeInUp.duration(600).delay(270)}
                  className="mx-5 mt-4"
                >
                  <PayEventsSummary
                    events={payEventsData?.events ?? []}
                    onPress={() => router.push("/pay-events")}
                  />
                </Animated.View>
              )}

              {/* Quick Actions */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(300)}
                className="mx-5 mt-5"
              >
                <QuickActions
                  onLogEvent={() => router.push("/create-log-event")}
                  onPayStatements={() => router.push("/pay-summary")}
                  onAddRecord={() => router.push("/(tabs)/history")}
                  onPayAudit={() => router.push("/pay-audit")}
                />
              </Animated.View>

              {/* Earnings Summary */}
              <Animated.View
                entering={FadeInUp.duration(600).delay(330)}
                className="mx-5 mt-4 mb-2"
              >
                <EarningsSummary
                  monthToDate={(projections?.month.actual.payCents || stats?.currentMonth.totalPayCents) ?? 0}
                  yearToDate={(projections?.year.actual.payCents || stats?.currentYear.totalPayCents) ?? 0}
                  projectedYear={projectedAnnualCents}
                  isLoading={isSharedProjectedAnnualLoading}
                />
              </Animated.View>
            </>
          )}
        </ScrollView>

        {/* Modals */}
        <ConfidenceModal
          visible={confidenceModalVisible}
          onClose={() => setConfidenceModalVisible(false)}
          confidence={confidence}
        />

        <PayExplanationModal
          visible={payExplanationVisible}
          onClose={() => setPayExplanationVisible(false)}
          dashboard={dashboard}
          payEvents={payEventsData?.events ?? []}
        />

        <NetPayBreakdownModal
          visible={netBreakdownVisible}
          onClose={() => setNetBreakdownVisible(false)}
          breakdown={lastBreakdown}
        />

        <SetAwardedCreditModal
          visible={awardedCreditModalVisible}
          onClose={() => setAwardedCreditModalVisible(false)}
          periodKey={baselineData?.periodKey ?? (dashboard ? `${new Date(dashboard.periodStart).getFullYear()}-P${String(dashboard.currentPeriod).padStart(2, "0")}` : "current")}
          periodStartISO={baselineData?.periodStartISO ?? dashboard?.periodStart ?? ""}
          periodEndISO={baselineData?.periodEndISO ?? dashboard?.periodEnd ?? ""}
          guaranteeMinutes={baselineData?.guaranteeMinutes ?? dashboard?.guaranteeMinutes ?? 4500}
          currentCreditMinutes={baselineData?.currentCreditMinutes ?? dashboard?.totalCreditMinutes ?? 0}
          onSaved={() => setAwardedCreditModalVisible(false)}
        />

        {/* Schedule Changes Modal */}
        <ChangesDetectedModal
          visible={changesModalVisible}
          onClose={() => setChangesModalVisible(false)}
          onLogPayEvent={(change) => {
            setChangesModalVisible(false);
            router.push("/pay-events");
          }}
        />

        {/* Action Needed Modal */}
        <ActionNeededModal
          visible={actionNeededModalVisible}
          onClose={() => setActionNeededModalVisible(false)}
          actionItems={[
            ...detailedActionItems,
            ...(unacknowledgedChangesCount > 0
              ? [
                  {
                    id: "schedule-changes",
                    type: "changes" as const,
                    title: `${unacknowledgedChangesCount} schedule change${unacknowledgedChangesCount !== 1 ? "s" : ""}`,
                    description: "Review detected schedule changes",
                  },
                ]
              : []),
          ]}
          onViewAll={() => {
            setActionNeededModalVisible(false);
            if (unacknowledgedChangesCount > 0 && detailedActionItems.filter(i => i.type !== "review").length === 0) {
              setChangesModalVisible(true);
            } else {
              router.push("/pay-events");
            }
          }}
          onReviewTrip={(tripId) => {
            setActionNeededModalVisible(false);
            router.push(`/review-changes?tripId=${tripId}`);
          }}
          onViewChanges={() => {
            setActionNeededModalVisible(false);
            setChangesModalVisible(true);
          }}
          onResolveSuccess={() => {
            // Queries will be invalidated by the mutation
          }}
        />

        {/* New Changes Popup Banner */}
        {!changesPopupDismissed && unacknowledgedChangesCount > 0 && (
          <NewChangesPopup
            count={unacknowledgedChangesCount}
            onPress={() => setChangesModalVisible(true)}
            onDismiss={() => setChangesPopupDismissed(true)}
          />
        )}

        {/* Auto Tutorial Modal */}
        {TutorialModalComponent}
      </LinearGradient>
    </View>
  );
}
