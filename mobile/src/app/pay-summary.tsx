/**
 * Pay Summary Screen
 *
 * Auto-generated payroll-style pay summary for pilots.
 * Derived entirely from uploaded schedules, trips, credit hours, and premium codes.
 * NOT an official payroll document - estimated compensation for planning.
 *
 * Design matches professional pay statement style with:
 * - Header with airplane visual and PilotPay branding
 * - Table-style earnings and deductions breakdowns
 * - Year-to-Date tracking with progress indicators
 * - Legal disclaimer section
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Share,
  Modal,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Share2,
  AlertTriangle,
  Sliders,
  X,
  Calendar,
  Upload,
  Plane,
  Info,
  HelpCircle,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { useTrips } from "@/lib/useTripsData";
import { usePayEvents } from "@/lib/usePayEvents";
import { useProfile, usePilotName, useHourlyRateCents, useAirline } from "@/lib/state/profile-store";
import {
  useLastBreakdown,
} from "@/lib/state/tax-store";
import { useCalculateNetPay } from "@/lib/useTax";
import { PER_DIEM_DOMESTIC_CENTS_PER_HOUR, PER_DIEM_INTERNATIONAL_CENTS_PER_HOUR } from "@/lib/contracts";
import {
  type CheckType,
  type CheckConfirmation,
  CHECK_TYPE_INFO,
  TOOLTIPS,
  UPS_PAY_CONFIG,
  getCheckTypeFromContent,
  calculateCreditAboveGuarantee,
  generateSmallCheckEarnings,
  generateBigCheckEarnings,
  type EarningsLineItemInput,
  getUpcomingPayDates,
  getExpectedCheckTypeForPayDate,
  formatPayDateShort,
  getNextCheckDescription,
  type ScheduledPayDate,
  getAirlineConfig,
  calculateCheckGrossForType,
  estimateNetPayRange,
  classifyPaycheckType,
  PAYCHECK_TYPE_DISPLAY,
  type PaycheckClassification,
  calculateGuaranteeBreakdown,
  resolveBidPeriodType,
  type GuaranteeBreakdown,
} from "@/lib/pay-check-logic";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import { SickSummaryCard } from "@/components/trips/SickSummaryCard";
import { useSickBank } from "@/lib/useSickTimeTracker";

// ============================================
// TYPES
// ============================================

interface PayPeriod {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
  payType: 'standard' | 'remainder';
}

interface EarningsLineItem {
  id: string;
  label: string;
  description: string;
  amountCents: number;
  creditMinutes?: number;
  isUserAdded?: boolean;
  trips?: string[];
}

interface DeductionLineItem {
  id: string;
  name: string;
  rate?: string;
  amountCents: number;
}

interface YTDSummary {
  grossEarningsCents: number;
  estimatedTaxesCents: number;
  estimatedDeductionsCents: number;
  estimatedNetCents: number;
  ssWagesCents: number;
  ssCapCents: number;
  contribution401kCents: number;
}

// Check type state for Small/Big check toggle
interface CheckTypeState {
  checkType: CheckType;
  confirmation: CheckConfirmation;
}

// ============================================
// HOOKS
// ============================================

function usePayPeriods() {
  return useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => api.get<{ periods: PayPeriod[] }>("/api/pay-periods"),
  });
}

function useProfileStats() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["profile-stats"],
    queryFn: () =>
      api.get<{
        allTime: { totalPayCents: number };
        currentYear: { totalPayCents: number; year: number };
        currentMonth: { totalPayCents: number; month: string };
      }>("/api/profile/stats"),
    enabled: isAuthenticated,
  });
}

function usePayrollProfile() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  return useQuery({
    queryKey: ["payroll-profile"],
    queryFn: () => api.get<{ profile: {
      paystubCount: number;
      pretaxFlexCents: number;
      vebaCents: number;
      excessLifeCents: number;
      ltdCents: number;
      mutualAidCents: number;
      unionDuesCents: number;
      roth401kCents: number;
      confidence: string;
    }}>("/api/payroll-profile"),
    enabled: isAuthenticated,
  });
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCurrencyWhole(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Social Security wage cap for 2025/2026
const SS_WAGE_CAP_CENTS = 17640000; // $176,400

// ============================================
// TOOLTIP COMPONENT
// ============================================

function TooltipModal({
  visible,
  onClose,
  title,
  content,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  content: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <Pressable
        className="flex-1 bg-black/60 items-center justify-center"
        onPress={onClose}
      >
        <View
          className="bg-slate-800 rounded-2xl mx-6 max-w-sm border border-slate-600/50 shadow-2xl"
          style={{ marginBottom: insets.bottom }}
        >
          <View className="px-5 py-4 border-b border-slate-700/50 flex-row items-center">
            <HelpCircle size={20} color="#f59e0b" style={{ marginRight: 10 }} />
            <Text className="text-white text-lg font-semibold flex-1">{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={20} color="#64748b" />
            </Pressable>
          </View>
          <View className="px-5 py-4">
            <Text className="text-slate-300 text-sm leading-6">{content}</Text>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// ============================================
// CHECK TYPE BADGE
// ============================================

function CheckTypeBadge({
  checkType,
  confirmation,
  onInfoPress,
}: {
  checkType: CheckType;
  confirmation: CheckConfirmation;
  onInfoPress?: () => void;
}) {
  const info = CHECK_TYPE_INFO[checkType];
  const isSmall = checkType === 'small';

  return (
    <Pressable
      onPress={onInfoPress}
      className={`flex-row items-center px-3 py-1.5 rounded-lg ${
        isSmall ? 'bg-blue-500/20' : 'bg-emerald-500/20'
      } active:opacity-70`}
    >
      <View
        className={`w-2 h-2 rounded-full mr-2 ${
          isSmall ? 'bg-blue-400' : 'bg-emerald-400'
        }`}
      />
      <Text
        className={`font-semibold text-sm ${
          isSmall ? 'text-blue-400' : 'text-emerald-400'
        }`}
      >
        {info.shortLabel}
      </Text>
      {confirmation === 'expected' && (
        <Text className="text-slate-500 text-xs ml-1">(Est.)</Text>
      )}
      {onInfoPress && (
        <Info
          size={14}
          color={isSmall ? '#60a5fa' : '#34d399'}
          style={{ marginLeft: 6 }}
        />
      )}
    </Pressable>
  );
}

// ============================================
// NEXT PAY DATE INFO (Phase 3)
// ============================================

function NextPayDateInfo({
  upcomingPayDates,
  onSmallCheckInfo,
  onBigCheckInfo,
}: {
  upcomingPayDates: ScheduledPayDate[];
  onSmallCheckInfo: () => void;
  onBigCheckInfo: () => void;
}) {
  if (upcomingPayDates.length === 0) return null;

  const nextPay = upcomingPayDates[0];
  const followingPay = upcomingPayDates[1];

  return (
    <View className="bg-slate-800/40 border border-slate-700/30 rounded-xl p-4 mb-4">
      {/* Next Check */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-1">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
            Next Check
          </Text>
          <View className="flex-row items-center">
            <Text className="text-white font-bold text-lg mr-2">
              {formatPayDateShort(nextPay.payDate)}
            </Text>
            <Text className="text-slate-500 text-sm">
              ({getNextCheckDescription(nextPay.daysUntil)})
            </Text>
          </View>
        </View>
        <Pressable
          onPress={nextPay.checkType === 'small' ? onSmallCheckInfo : onBigCheckInfo}
          className={`flex-row items-center px-3 py-1.5 rounded-lg ${
            nextPay.checkType === 'small' ? 'bg-blue-500/20' : 'bg-emerald-500/20'
          } active:opacity-70`}
        >
          <View
            className={`w-2 h-2 rounded-full mr-2 ${
              nextPay.checkType === 'small' ? 'bg-blue-400' : 'bg-emerald-400'
            }`}
          />
          <Text
            className={`font-semibold text-sm ${
              nextPay.checkType === 'small' ? 'text-blue-400' : 'text-emerald-400'
            }`}
          >
            {CHECK_TYPE_INFO[nextPay.checkType].shortLabel}
          </Text>
          <Info
            size={12}
            color={nextPay.checkType === 'small' ? '#60a5fa' : '#34d399'}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
      </View>

      {/* Following Check */}
      {followingPay && (
        <View className="flex-row items-center justify-between pt-3 border-t border-slate-700/30">
          <View className="flex-1">
            <Text className="text-slate-500 text-xs uppercase tracking-wider mb-1">
              Following Check
            </Text>
            <Text className="text-slate-300 font-medium">
              {formatPayDateShort(followingPay.payDate)}
            </Text>
          </View>
          <View
            className={`flex-row items-center px-2 py-1 rounded ${
              followingPay.checkType === 'small' ? 'bg-blue-500/10' : 'bg-emerald-500/10'
            }`}
          >
            <View
              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                followingPay.checkType === 'small' ? 'bg-blue-400/60' : 'bg-emerald-400/60'
              }`}
            />
            <Text
              className={`text-xs ${
                followingPay.checkType === 'small' ? 'text-blue-400/80' : 'text-emerald-400/80'
              }`}
            >
              {CHECK_TYPE_INFO[followingPay.checkType].shortLabel}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ============================================
// COMPONENTS
// ============================================

// Statement Header with airplane visual
function StatementHeader({
  periodStart,
  periodEnd,
  generatedAt,
}: {
  periodStart: string;
  periodEnd: string;
  generatedAt: Date;
}) {
  return (
    <View className="overflow-hidden rounded-t-2xl">
      {/* Sky gradient with airplane */}
      <LinearGradient
        colors={["#1e3a5f", "#2d5a87", "#4a90b8", "#87ceeb"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ paddingTop: 20, paddingBottom: 30, paddingHorizontal: 20 }}
      >
        {/* Period info - top right */}
        <View className="items-end mb-4">
          <Text className="text-white/80 text-xs">
            Pay Period: {formatDateShort(periodStart)} - {formatDateShort(periodEnd)}
          </Text>
          <Text className="text-white/60 text-xs mt-0.5">
            Generated: {generatedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>

        {/* Logo and branding */}
        <View className="flex-row items-center">
          <View className="w-14 h-14 rounded-xl bg-amber-500 items-center justify-center shadow-lg">
            <Plane size={28} color="#0f172a" />
          </View>
          <View className="ml-3">
            <View className="flex-row items-baseline">
              <Text className="text-white text-2xl font-bold">Pilot</Text>
              <Text className="text-amber-400 text-2xl font-bold">Pay</Text>
            </View>
            <Text className="text-white/70 text-xs tracking-wider uppercase">
              Tracker
            </Text>
          </View>
        </View>

        {/* Airplane silhouette decoration */}
        <View className="absolute right-0 top-8 opacity-20">
          <Plane size={120} color="#ffffff" strokeWidth={0.5} />
        </View>
      </LinearGradient>

      {/* Subtitle bar */}
      <View className="bg-slate-800 py-2 px-4 flex-row justify-between items-center">
        <Text className="text-slate-400 text-xs italic">
          Earnings visualization for planning & tracking
        </Text>
      </View>
    </View>
  );
}

// Title bar with Pay Summary
function TitleBar({
  checkTypeState,
  paycheckClassification,
  onCheckTypeInfo,
}: {
  checkTypeState?: CheckTypeState;
  paycheckClassification?: PaycheckClassification;
  onCheckTypeInfo?: () => void;
}) {
  // Resolve display info from classification (preferred) or fall back to CheckType badge
  const displayInfo = paycheckClassification
    ? PAYCHECK_TYPE_DISPLAY[paycheckClassification.paycheckType]
    : null;

  return (
    <View className="bg-slate-900 px-4 pt-3 pb-1 border-b border-slate-700">
      {/* Top row: branding + check type badge */}
      <View className="flex-row justify-between items-center mb-2">
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-lg bg-amber-500 items-center justify-center mr-3">
            <Plane size={20} color="#0f172a" />
          </View>
          <Text className="text-white text-xl font-bold">PilotPay Tracker</Text>
        </View>
        {checkTypeState ? (
          <CheckTypeBadge
            checkType={checkTypeState.checkType}
            confirmation={checkTypeState.confirmation}
            onInfoPress={onCheckTypeInfo}
          />
        ) : (
          <View className="bg-slate-800 px-3 py-1.5 rounded-lg">
            <Text className="text-amber-400 font-semibold text-sm">Pay Summary</Text>
          </View>
        )}
      </View>

      {/* Dynamic check type title + subtitle */}
      {displayInfo ? (
        <View className="pb-2">
          <Text className="text-white text-lg font-bold">{displayInfo.title}</Text>
          <Text className="text-slate-400 text-xs mt-0.5 leading-4">{displayInfo.subtitle}</Text>
        </View>
      ) : (
        <View className="pb-2">
          <Text className="text-white text-lg font-bold">Paycheck Summary</Text>
          <Text className="text-slate-400 text-xs mt-0.5">
            Paycheck type could not be confirmed from available data.
          </Text>
        </View>
      )}
    </View>
  );
}

// Pilot Info Section
function PilotInfoSection({
  pilotName,
  gemsId,
  position,
  equipment,
  periodStart,
  periodEnd,
  generatedAt,
}: {
  pilotName: string | null;
  gemsId: string | null;
  position: string | null;
  equipment: string | null;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date;
}) {
  return (
    <View className="bg-slate-800/80 px-4 py-3 border-b border-slate-700/50">
      {/* Top row: Pay Period & Generated */}
      <View className="mb-3 pb-3 border-b border-slate-700/40">
        <View className="flex-row justify-between items-start mb-1">
          <Text className="text-slate-400 text-xs">Pay Period</Text>
          <Text className="text-white font-semibold text-xs text-right flex-shrink-0 ml-4">
            {formatDateShort(periodStart)} – {formatDateShort(periodEnd)}
          </Text>
        </View>
        <View className="flex-row justify-between items-center">
          <Text className="text-slate-400 text-xs">Generated</Text>
          <Text className="text-white font-semibold text-xs">
            {generatedAt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
        </View>
      </View>

      {/* Bottom row: Pilot details in 2x2 grid */}
      <View className="flex-row flex-wrap">
        <View className="w-1/2 mb-2">
          <Text className="text-slate-400 text-xs mb-0.5">Pilot Name</Text>
          <Text className="text-white font-semibold text-sm">{pilotName ?? "Pilot"}</Text>
        </View>
        <View className="w-1/2 mb-2 items-end">
          <Text className="text-slate-400 text-xs mb-0.5">GEMS ID</Text>
          <Text className="text-white font-semibold text-sm">{gemsId ?? "N/A"}</Text>
        </View>
        <View className="w-1/2">
          <Text className="text-slate-400 text-xs mb-0.5">Role</Text>
          <Text className="text-white font-semibold text-sm">{position === "CPT" ? "Captain" : "First Officer"}</Text>
        </View>
        <View className="w-1/2 items-end">
          <Text className="text-slate-400 text-xs mb-0.5">Equipment</Text>
          <Text className="text-white font-semibold text-sm">{equipment ?? "B757/767"}</Text>
        </View>
      </View>

      <View className="mt-3 bg-blue-500/20 px-2 py-1 rounded">
        <Text className="text-blue-300 text-xs italic">
          · Earnings visualization for planning & tracking
        </Text>
      </View>
    </View>
  );
}

// Section Header
function SectionHeader({
  title,
  subtitle,
  color = "#f59e0b",
}: {
  title: string;
  subtitle: string;
  color?: string;
}) {
  return (
    <View
      className="px-4 py-2 flex-row items-center justify-between"
      style={{ backgroundColor: color + "20" }}
    >
      <Text className="font-bold text-white">{title}</Text>
      <Text className="text-slate-400 text-xs italic flex-1 ml-2 text-right" numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

// Table Row Component
function TableRow({
  label,
  rate,
  amount,
  isEven = false,
  isTotal = false,
  amountColor = "#ffffff",
  onPress,
}: {
  label: string;
  rate?: string;
  amount: number;
  isEven?: boolean;
  isTotal?: boolean;
  amountColor?: string;
  onPress?: () => void;
}) {
  const bgColor = isTotal ? "bg-slate-700/60" : isEven ? "bg-slate-800/40" : "bg-slate-800/80";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center px-4 py-2.5 ${bgColor} ${onPress ? "active:opacity-70" : ""}`}
    >
      <View className="flex-1 flex-row items-center">
        <Text className={`${isTotal ? "text-white font-bold" : "text-slate-300"}`}>
          {label}
        </Text>
        {onPress && <ChevronRight size={14} color="#64748b" style={{ marginLeft: 4 }} />}
      </View>
      {rate && (
        <Text className="text-slate-500 text-sm mr-6 w-16 text-right">{rate}</Text>
      )}
      <Text
        className={`w-28 text-right font-semibold ${isTotal ? "text-lg" : ""}`}
        style={{ color: amountColor }}
        numberOfLines={1}
      >
        {formatCurrency(amount)}
      </Text>
    </Pressable>
  );
}

// Two Column Table Row (for YTD)
function TwoColumnRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  isEven = false,
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  isEven?: boolean;
}) {
  const bgColor = isEven ? "bg-slate-800/40" : "bg-slate-800/80";

  return (
    <View className={`flex-row px-4 py-2.5 ${bgColor}`}>
      <View className="flex-1 flex-row justify-between pr-4">
        <Text className="text-slate-300">{leftLabel}</Text>
        <Text className="text-white font-semibold">{formatCurrencyWhole(leftValue)}</Text>
      </View>
      <View className="w-px bg-slate-600" />
      <View className="flex-1 flex-row justify-between pl-4">
        <Text className="text-slate-300">{rightLabel}</Text>
        <Text className="text-white font-semibold">{formatCurrencyWhole(rightValue)}</Text>
      </View>
    </View>
  );
}

// Net Pay Hero Card
function NetPayCard({
  netPayCents,
  grossPayCents,
  checkTypeState,
  guaranteeBreakdown,
}: {
  netPayCents: number;
  grossPayCents: number;
  checkTypeState?: CheckTypeState;
  guaranteeBreakdown?: GuaranteeBreakdown;
}) {
  const takeHomePercent = grossPayCents > 0 ? (netPayCents / grossPayCents) * 100 : 0;

  // Dynamic label based on check type
  const netPayLabel = checkTypeState
    ? `Estimated Net Pay (${CHECK_TYPE_INFO[checkTypeState.checkType].shortLabel})`
    : "Estimated Net Pay";

  const isBigCheck = checkTypeState?.checkType === 'big';
  const showGuarantee = isBigCheck && guaranteeBreakdown;
  const isOnGuarantee = guaranteeBreakdown?.isOnGuarantee ?? false;
  const fmt = (h: number) => h.toFixed(1);

  return (
    <View className="mx-4 my-4">
      <LinearGradient
        colors={["#065f46", "#047857", "#10b981"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 16, padding: 20 }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-emerald-200 text-sm font-medium mb-1">
              {netPayLabel}
            </Text>
            <Text className="text-white text-3xl font-bold">
              {formatCurrency(netPayCents)}
            </Text>
            <Text className="text-emerald-200/80 text-sm mt-1">
              {takeHomePercent.toFixed(1)}% take-home rate
            </Text>

            {/* Guarantee hours row — only on Settlement view */}
            {showGuarantee && (
              <View className="mt-3 pt-3 border-t border-white/15">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-emerald-300/70 text-xs">Paid Hours</Text>
                  <Text className="text-white font-bold text-xs">
                    {fmt(guaranteeBreakdown!.paidHours)} hrs
                  </Text>
                </View>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-emerald-300/70 text-xs">Line Credit</Text>
                  <Text className="text-emerald-200/80 text-xs">
                    {fmt(guaranteeBreakdown!.lineCreditHours)} hrs
                  </Text>
                </View>
                {isOnGuarantee ? (
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center">
                      <Text className="text-amber-300 text-xs font-semibold">Buffer Pay</Text>
                    </View>
                    <View className="bg-amber-400/20 px-2 py-0.5 rounded-full">
                      <Text className="text-amber-300 text-xs font-bold">
                        +{fmt(guaranteeBreakdown!.bufferPayHours)} hrs
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View className="flex-row items-center justify-between">
                    <Text className="text-emerald-300/50 text-xs">Buffer Pay</Text>
                    <Text className="text-emerald-300/50 text-xs">+0.0 hrs</Text>
                  </View>
                )}
              </View>
            )}

            {/* Helper text */}
            <Text className="text-emerald-300/60 text-xs mt-2 italic">
              Based on your saved tax & deduction settings
            </Text>
          </View>
          <View className="w-16 h-16 rounded-full bg-white/10 items-center justify-center ml-4">
            <DollarSign size={32} color="#ffffff" />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

// Disclaimer Section
function DisclaimerSection() {
  return (
    <View className="bg-amber-500/10 border-t border-b border-amber-500/30 px-4 py-3">
      <View className="flex-row items-start">
        <AlertTriangle size={18} color="#f59e0b" style={{ marginTop: 2, marginRight: 10 }} />
        <View className="flex-1">
          <Text className="text-amber-400 font-bold text-sm mb-2">IMPORTANT DISCLAIMER</Text>
          <Text className="text-amber-200/80 text-xs leading-5">
            Estimated net pay based on uploaded trips, saved settings, and deduction assumptions.
            Actual paycheck may vary.
          </Text>
          <Text className="text-amber-200/80 text-xs leading-5 mt-2">
            • This Pay Summary is not an official payroll document, not a tax document, and not affiliated
            with any airline, employer, payroll provider, or government agency.
          </Text>
          <Text className="text-amber-200/80 text-xs leading-5 mt-1">
            • All calculations are based on user-provided inputs and estimates and should not be relied
            upon for tax filing, payroll verification, or legal purposes.
          </Text>
        </View>
      </View>
    </View>
  );
}

// Footer
function StatementFooter() {
  return (
    <View className="bg-slate-900 py-4 px-4 rounded-b-2xl">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="w-8 h-8 rounded-lg bg-amber-500 items-center justify-center mr-2">
            <Plane size={16} color="#0f172a" />
          </View>
          <View>
            <View className="flex-row items-baseline">
              <Text className="text-white font-bold">Pilot</Text>
              <Text className="text-amber-400 font-bold">Pay</Text>
              <Text className="text-white font-bold"> Tracker</Text>
            </View>
          </View>
        </View>
        <Text className="text-slate-400 text-xs italic">Know your pay. Own your numbers.</Text>
      </View>
    </View>
  );
}

// Empty State
function EmptyState({
  onUploadSchedule,
  onSetupDeductions,
}: {
  onUploadSchedule: () => void;
  onSetupDeductions: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      <View className="w-20 h-20 rounded-full bg-slate-800/60 items-center justify-center mb-6">
        <Plane size={36} color="#64748b" />
      </View>
      <Text className="text-white text-xl font-bold text-center mb-2">
        No Pay Data Yet
      </Text>
      <Text className="text-slate-400 text-center mb-8">
        Your Pay Summary is generated automatically from your uploaded schedules and trips.
      </Text>

      <View className="w-full gap-3">
        <Pressable
          onPress={onUploadSchedule}
          className="bg-amber-500 rounded-2xl py-4 px-6 flex-row items-center justify-center active:opacity-80"
        >
          <Upload size={18} color="#0f172a" />
          <Text className="text-slate-900 font-bold ml-2">Upload Schedule</Text>
        </Pressable>

        <Pressable
          onPress={onSetupDeductions}
          className="bg-slate-800/60 border border-slate-700/50 rounded-2xl py-4 px-6 flex-row items-center justify-center active:opacity-80"
        >
          <Sliders size={18} color="#94a3b8" />
          <Text className="text-slate-300 font-semibold ml-2">Set Up Deductions</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Period Selector
function PeriodSelector({
  periods,
  selectedPeriod,
  onSelect,
}: {
  periods: PayPeriod[];
  selectedPeriod: PayPeriod | null;
  onSelect: (period: PayPeriod) => void;
}) {
  if (!selectedPeriod) return null;

  const currentIndex = periods.findIndex(
    (p) =>
      p.year === selectedPeriod.year &&
      p.periodNumber === selectedPeriod.periodNumber &&
      p.payType === selectedPeriod.payType
  );

  const canGoPrev = currentIndex < periods.length - 1;
  const canGoNext = currentIndex > 0;

  const checkLabel = selectedPeriod.payType === 'standard' ? 'Advance' : 'Settlement';

  return (
    <View className="flex-row items-center justify-center mb-4 px-5">
      <Pressable
        onPress={() => {
          if (canGoPrev) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(periods[currentIndex + 1]);
          }
        }}
        disabled={!canGoPrev}
        className={`p-2 ${!canGoPrev ? "opacity-30" : ""}`}
      >
        <ChevronLeft size={24} color="#f59e0b" />
      </Pressable>

      <View className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-5 py-2 mx-4 flex-row items-center">
        <Calendar size={16} color="#f59e0b" />
        <Text className="text-white font-bold ml-2">
          Period {selectedPeriod.periodNumber} — {checkLabel}
        </Text>
      </View>

      <Pressable
        onPress={() => {
          if (canGoNext) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(periods[currentIndex - 1]);
          }
        }}
        disabled={!canGoNext}
        className={`p-2 ${!canGoNext ? "opacity-30" : ""}`}
      >
        <ChevronRight size={24} color="#f59e0b" />
      </Pressable>
    </View>
  );
}

// ============================================
// GUARANTEE BREAKDOWN CARD
// ============================================

/**
 * Shows Line Credit / Guarantee / Paid Hours / Buffer Pay inline.
 * Only rendered on the Big Check (Settlement) view where the full
 * bid-period guarantee reconciliation takes place.
 */
function GuaranteeBreakdownCard({
  breakdown,
  onInfoPress,
}: {
  breakdown: GuaranteeBreakdown;
  onInfoPress?: () => void;
}) {
  const isOnGuarantee = breakdown.isOnGuarantee;

  const fmt = (h: number) => h.toFixed(1);

  return (
    <View className="mx-4 mb-3">
      {/* Card */}
      <View
        className={`rounded-xl border overflow-hidden ${
          isOnGuarantee
            ? "border-amber-500/40 bg-amber-950/30"
            : "border-slate-700/50 bg-slate-800/40"
        }`}
      >
        {/* Header row */}
        <Pressable
          onPress={onInfoPress}
          className="flex-row items-center justify-between px-4 py-2.5 border-b border-slate-700/30 active:opacity-70"
        >
          <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Contract Guarantee Summary
          </Text>
          <View className="flex-row items-center">
            {isOnGuarantee && (
              <View className="bg-amber-500/20 px-2 py-0.5 rounded mr-2">
                <Text className="text-amber-400 text-xs font-semibold">On Guarantee</Text>
              </View>
            )}
            <Info size={14} color="#64748b" />
          </View>
        </Pressable>

        {/* Data rows */}
        <View className="px-4 py-3 gap-2">
          {/* Line Credit */}
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-400 text-sm">Line Credit</Text>
            <Text className="text-white font-semibold text-sm">
              {fmt(breakdown.lineCreditHours)} hrs
            </Text>
          </View>

          {/* Guarantee */}
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-400 text-sm">
              Guarantee ({breakdown.periodType === '28_DAY' ? '28-day' : '35-day'})
            </Text>
            <Text className="text-white font-semibold text-sm">
              {fmt(breakdown.guaranteeHours)} hrs
            </Text>
          </View>

          {/* Divider */}
          <View className="h-px bg-slate-700/40 my-0.5" />

          {/* Paid Hours */}
          <View className="flex-row items-center justify-between">
            <Text className="text-white text-sm font-semibold">Paid Hours</Text>
            <Text className="text-emerald-400 font-bold text-sm">
              {fmt(breakdown.paidHours)} hrs
            </Text>
          </View>

          {/* Buffer Pay */}
          <View className="flex-row items-center justify-between">
            <Text className={`text-sm font-medium ${isOnGuarantee ? "text-amber-400" : "text-slate-500"}`}>
              Buffer Pay
            </Text>
            <Text
              className={`font-bold text-sm ${
                isOnGuarantee ? "text-amber-400" : "text-slate-500"
              }`}
            >
              +{fmt(breakdown.bufferPayHours)} hrs
            </Text>
          </View>
        </View>

        {/* Buffer pay explanation banner (only when on guarantee) */}
        {isOnGuarantee && (
          <View className="bg-amber-500/10 border-t border-amber-500/20 px-4 py-2.5 flex-row items-start">
            <Info size={13} color="#f59e0b" style={{ marginTop: 1, marginRight: 6, flexShrink: 0 }} />
            <Text className="text-amber-300/90 text-xs leading-5 flex-1">
              Your line credit ({fmt(breakdown.lineCreditHours)} hrs) is below the{" "}
              {fmt(breakdown.guaranteeHours)}-hr guarantee. You are still paid{" "}
              {fmt(breakdown.guaranteeHours)} hrs — the extra{" "}
              +{fmt(breakdown.bufferPayHours)} hrs is Buffer Pay.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function PaySummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  // Auto-show tutorial on first visit
  const { TutorialModalComponent } = useAutoTutorial("pay_summary");

  // Profile data
  const profile = useProfile();
  const pilotName = usePilotName();
  const hourlyRateCents = useHourlyRateCents();
  const airline = useAirline();

  // Phase 5: Get airline-specific pay configuration
  const airlineConfig = useMemo(() => getAirlineConfig(airline), [airline]);

  // Payroll profile (uploaded paystub data)
  const { data: payrollProfileData } = usePayrollProfile();
  const payrollProfile = payrollProfileData?.profile;

  // Tax data
  const lastBreakdown = useLastBreakdown();
  const calculateNetPayMutation = useCalculateNetPay();

  // Pay period data
  const { data: periodsData, isLoading: periodsLoading, refetch: refetchPeriods } = usePayPeriods();
  const { data: stats, refetch: refetchStats } = useProfileStats();
  const { data: sickBank } = useSickBank();

  // State
  const [selectedPeriod, setSelectedPeriod] = useState<PayPeriod | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detailModalItem, setDetailModalItem] = useState<EarningsLineItem | null>(null);
  const [includeOverrideTrips, setIncludeOverrideTrips] = useState(false); // Override trips excluded by default

  // Check type state and tooltip
  const [checkTypeState, setCheckTypeState] = useState<CheckTypeState>({
    checkType: 'big',
    confirmation: 'expected',
  });
  const [paycheckClassification, setPaycheckClassification] = useState<PaycheckClassification>({
    paycheckType: 'UNKNOWN',
    confidence: 'low',
    source: 'FALLBACK',
    reason: 'Initial state',
  });
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<{ title: string; content: string } | null>(null);

  // Show tooltip helper
  const showTooltip = useCallback((title: string, content: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTooltip({ title, content });
    setTooltipVisible(true);
  }, []);

  // Show check type info tooltip
  const showCheckTypeInfo = useCallback(() => {
    const info = CHECK_TYPE_INFO[checkTypeState.checkType];
    showTooltip(info.tooltipTitle, info.tooltipContent);
  }, [checkTypeState.checkType, showTooltip]);

  // Show small check info tooltip
  const showSmallCheckInfo = useCallback(() => {
    showTooltip(TOOLTIPS.smallCheckWhy.title, TOOLTIPS.smallCheckWhy.content);
  }, [showTooltip]);

  // Show big check info tooltip
  const showBigCheckInfo = useCallback(() => {
    showTooltip(TOOLTIPS.bigCheckPremiums.title, TOOLTIPS.bigCheckPremiums.content);
  }, [showTooltip]);

  // Show contract guarantee tooltip
  const showGuaranteeInfo = useCallback(() => {
    showTooltip(TOOLTIPS.contractGuarantee.title, TOOLTIPS.contractGuarantee.content);
  }, [showTooltip]);

  // Phase 3: Calculate upcoming pay dates with check types
  const upcomingPayDates = useMemo<ScheduledPayDate[]>(() => {
    if (!periodsData?.periods) return [];

    const today = new Date().toISOString().split('T')[0];

    // Get all pay dates from periods
    const allPayDates = periodsData.periods.map((p) => ({
      payDate: p.payDate,
      periodNumber: p.periodNumber,
    }));

    return getUpcomingPayDates(allPayDates, today, 3);
  }, [periodsData]);

  // Get trips for selected period
  const { data: tripsData, refetch: refetchTrips } = useTrips({
    startDate: selectedPeriod?.startDate,
    endDate: selectedPeriod?.endDate,
  });

  // Get pay events for selected period
  const { data: payEventsData } = usePayEvents({
    startDate: selectedPeriod?.startDate,
    endDate: selectedPeriod?.endDate,
  });

  // Set initial period — default to the period whose work dates CONTAIN today.
  // This ensures users always see their current period's trips, not a past period
  // whose pay date happens to be today (which would have no new trips → $0).
  useEffect(() => {
    if (periodsData?.periods && !selectedPeriod) {
      const today = new Date().toISOString().split("T")[0] ?? "";

      // Deduplicate by startDate+endDate so each work period appears once
      const seen = new Set<string>();
      const uniquePeriods = periodsData.periods.filter((p) => {
        const key = `${p.startDate}_${p.endDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Prefer the work period that contains today (startDate <= today <= endDate)
      const current = uniquePeriods.find(
        (p) => today >= p.startDate && today <= p.endDate
      );

      if (current) {
        // Use the "remainder" (settlement) entry for this period if available,
        // otherwise use whichever entry we found
        const settlement = periodsData.periods.find(
          (p) =>
            p.startDate === current.startDate &&
            p.endDate === current.endDate &&
            p.payType === "remainder"
        );
        setSelectedPeriod(settlement ?? current);
      } else {
        // Today is between periods — pick the upcoming work period
        const sortedByStart = [...uniquePeriods].sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
        const upcoming = sortedByStart.find((p) => p.startDate > today);
        if (upcoming) {
          setSelectedPeriod(upcoming);
        } else {
          // All periods are in the past — show the most recent
          const mostRecent = sortedByStart[sortedByStart.length - 1];
          setSelectedPeriod(mostRecent ?? periodsData.periods[0]);
        }
      }
    }
  }, [periodsData, selectedPeriod]);

  // Calculate earnings from trips (with demo fallback if no data)
  // Phase 2: This now calculates raw data, then generates check-type-specific earnings
  const { earnings, rawPayData } = useMemo<{
    earnings: EarningsLineItem[];
    rawPayData: {
      totalCreditMinutes: number;
      premiumPayCents: number;
      juniorPayCents: number;
      juniorCreditMinutes: number;
      perDiemCents: number;
      adjustmentsCents: number;
      tripIds: string[];
      hasRealData: boolean;
    };
  }>(() => {
    const items: EarningsLineItem[] = [];

    // Check if we have real trip data
    const hasRealTrips = tripsData?.trips && tripsData.trips.length > 0;
    const effectiveRate = hourlyRateCents > 0 ? hourlyRateCents : 32500;

    // Raw pay data to be used for check-type calculations
    let rawData = {
      totalCreditMinutes: 0,
      premiumPayCents: 0,
      juniorPayCents: 0,
      juniorCreditMinutes: 0,
      perDiemCents: 0,
      adjustmentsCents: 0,
      tripIds: [] as string[],
      hasRealData: false as boolean,
    };

    if (hasRealTrips && tripsData?.trips) {
      rawData.hasRealData = true;
      // Filter trips based on override setting
      const activeTrips = includeOverrideTrips
        ? tripsData.trips
        : tripsData.trips.filter((trip) => trip.status !== "override" && trip.status !== "review");

      // Calculate raw totals from trips
      activeTrips.forEach((trip) => {
        rawData.totalCreditMinutes += trip.payCreditMinutes || trip.totalCreditMinutes || 0;
        rawData.tripIds.push(trip.id);
      });

      // Premium pay from pay events — separate Junior Assignment from other premiums
      const premiumEvents = payEventsData?.events.filter(
        (e) => e.payDifferenceCents && e.payDifferenceCents > 0
      );
      premiumEvents?.forEach((event) => {
        if (event.eventType === 'JUNIOR_ASSIGNMENT') {
          rawData.juniorPayCents += event.payDifferenceCents ?? 0;
          // Use newCreditMinutes if available; otherwise back-calculate from pay at 50% premium
          if (event.newCreditMinutes) {
            rawData.juniorCreditMinutes += event.newCreditMinutes;
          } else if (event.payDifferenceCents && effectiveRate > 0) {
            // payDifferenceCents = hours * rate * 0.5 → hours = payDiff / (rate * 0.5)
            rawData.juniorCreditMinutes += Math.round(
              (event.payDifferenceCents / effectiveRate / 0.5) * 60
            );
          }
        } else {
          rawData.premiumPayCents += event.payDifferenceCents ?? 0;
        }
      });

      // Per diem is not included in the Pay Summary estimate.
      // It appears on real Dayforce paystubs but varies too much to estimate reliably here.
      rawData.perDiemCents = 0;

      // Adjustments (currently always 0, future feature)
      rawData.adjustmentsCents = 0;
    } else {
      // Demo data for sample display
      rawData.totalCreditMinutes = 85 * 60; // 85 hours
      rawData.premiumPayCents = Math.round((rawData.totalCreditMinutes / 60) * effectiveRate * 0.05);
      rawData.perDiemCents = 0; // Per diem excluded from Pay Summary
      rawData.adjustmentsCents = 0;
      rawData.hasRealData = false;
    }

    // Generate earnings based on check type.
    // Small Check: only the 37.5-hr guarantee advance — nothing else.
    // Big Check: guarantee settlement + over-guarantee + premiums + adjustments.
    const isBigCheck = checkTypeState.checkType === 'big';
    const checkItems = isBigCheck
      ? generateBigCheckEarnings(
          effectiveRate,
          rawData.totalCreditMinutes,
          rawData.premiumPayCents,
          0, // per diem excluded from Pay Summary
          rawData.adjustmentsCents,
          rawData.tripIds,
          airlineConfig,
          rawData.juniorPayCents,
          rawData.juniorCreditMinutes
        )
      : generateSmallCheckEarnings(effectiveRate, airlineConfig);

    // Convert to EarningsLineItem format with sample indicator
    checkItems.forEach((item) => {
      items.push({
        id: item.id,
        label: item.label,
        description: rawData.hasRealData ? item.description : `${item.description} (sample)`,
        amountCents: item.amountCents,
        creditMinutes: item.creditMinutes,
        isUserAdded: item.isUserAdded,
        trips: item.trips,
      });
    });

    return { earnings: items, rawPayData: rawData };
  }, [tripsData, payEventsData, hourlyRateCents, includeOverrideTrips, airlineConfig, checkTypeState.checkType]);

  // Contract guarantee breakdown
  // lineCreditHours = total trip credit minutes ÷ 60 for the period
  // Period type comes from profile's creditCapPeriodType field
  const guaranteeBreakdown = useMemo<GuaranteeBreakdown>(() => {
    const lineCreditHours = rawPayData.totalCreditMinutes / 60;
    const periodType = resolveBidPeriodType(profile?.creditCapPeriodType);
    return calculateGuaranteeBreakdown(lineCreditHours, periodType);
  }, [rawPayData.totalCreditMinutes, profile?.creditCapPeriodType]);

  // Calculate totals
  const grossEarningsCents = useMemo(() => {
    return earnings
      .filter((e) => e.id !== "per-diem")
      .reduce((acc, item) => acc + item.amountCents, 0);
  }, [earnings]);

  const perDiemCents = useMemo(() => {
    return earnings.find((e) => e.id === "per-diem")?.amountCents ?? 0;
  }, [earnings]);

  const totalEarningsCents = grossEarningsCents + perDiemCents;

  // Phase 6: Calculate check-specific gross pay
  const checkSpecificGross = useMemo(() => {
    const effectiveRate = hourlyRateCents > 0 ? hourlyRateCents : 32500;

    return calculateCheckGrossForType(
      checkTypeState.checkType,
      effectiveRate,
      rawPayData.totalCreditMinutes,
      rawPayData.premiumPayCents + rawPayData.juniorPayCents,
      rawPayData.perDiemCents, // Taxable per diem for gross
      rawPayData.adjustmentsCents,
      airlineConfig
    );
  }, [checkTypeState.checkType, hourlyRateCents, rawPayData, airlineConfig]);

  // Determine check type based on pay date and earnings content
  // Phase 3: Uses pay date scheduling for expected type, content for confirmation
  // Phase 5: Uses airline-specific configuration
  useEffect(() => {
    // Derive expected check type directly from the selected period's payType.
    // 'standard' (~1st of month) = Advance (small check)
    // 'remainder' (~15th of month) = Settlement (big check)
    let expectedCheckType: CheckType = 'big';
    if (selectedPeriod) {
      expectedCheckType = selectedPeriod.payType === 'standard' ? 'small' : 'big';
    } else if (upcomingPayDates.length > 0) {
      expectedCheckType = upcomingPayDates[0].checkType;
    }

    // Phase 5: Use airline config for credit above guarantee calculation
    const creditAboveGuaranteeMinutes = calculateCreditAboveGuarantee(
      rawPayData.totalCreditMinutes,
      airlineConfig
    );

    // Content-based check type determination
    // If we have premium pay OR credit above guarantee, it's definitely a Big Check
    // Content overrides date-based expectation
    const { checkType, confirmation } = getCheckTypeFromContent(
      rawPayData.premiumPayCents + rawPayData.juniorPayCents,
      creditAboveGuaranteeMinutes,
      expectedCheckType // Use pay date-based expectation
    );

    setCheckTypeState({ checkType, confirmation });

    // ── PaycheckClassification (ADVANCE / SETTLEMENT / UNKNOWN) ──────────
    // Collect earnings labels from current earnings items for paystub-label scan.
    // This is done inside the effect so we have access to both rawPayData and earnings.
    const earningsLabels = earnings.map((e) => e.label);

    const classification = classifyPaycheckType(
      earningsLabels,
      checkType, // use the calendar/content-resolved CheckType as calendar signal
      rawPayData.hasRealData,
      rawPayData.premiumPayCents + rawPayData.juniorPayCents,
      creditAboveGuaranteeMinutes
    );

    setPaycheckClassification(classification);
  }, [rawPayData, upcomingPayDates, airlineConfig, earnings, selectedPeriod]);

  // Phase 6: Calculate net pay when check-specific gross changes
  useEffect(() => {
    // Use check-specific gross for accurate per-check net pay
    if (checkSpecificGross.taxableGrossCents > 0 && isAuthenticated) {
      calculateNetPayMutation.mutate({
        grossPayCents: checkSpecificGross.taxableGrossCents,
        ytdWagesCents: stats?.currentYear.totalPayCents ?? 0,
      });
    }
  }, [checkSpecificGross.taxableGrossCents, isAuthenticated]);

  // Build ALL deduction line items following UPS payroll order:
  // 1. Taxable benefits (add to taxable wages)
  // 2. Pre-tax deductions (reduce taxable wages)
  // 3. Taxes (federal, SS, Medicare)
  // 4. Post-tax deductions

  const allDeductions = useMemo<{
    taxableBenefits: DeductionLineItem[];
    preTaxDeductions: DeductionLineItem[];
    taxDeductions: DeductionLineItem[];
    postTaxDeductions: DeductionLineItem[];
    totalDeductions: number;
    effectiveTaxableWages: number;
    computedNetPay: number;
  }>(() => {
    const effectiveRate = hourlyRateCents > 0 ? hourlyRateCents : 32500;
    void effectiveRate; // used implicitly via checkSpecificGross
    const grossTaxable = checkSpecificGross.taxableGrossCents;
    // Use per diem from the earnings array — already zeroed out for small checks
    const grossNonTaxable = perDiemCents; // Per diem is non-taxable; 0 on small check

    // UPS DEFAULT deductions (from real paystub example or learned profile)
    const excessLifeCents   = payrollProfile?.excessLifeCents   ?? 208;    // $2.08
    const pretaxFlexCents   = payrollProfile?.pretaxFlexCents   ?? 22157;  // $221.57
    const vebaCents         = payrollProfile?.vebaCents         ?? 7400;   // $74.00
    const ltdCents          = payrollProfile?.ltdCents          ?? 15461;  // $154.61
    const mutualAidCents    = payrollProfile?.mutualAidCents    ?? 11000;  // $110.00
    const unionDuesCents    = payrollProfile?.unionDuesCents    ?? 13102;  // $131.02
    const roth401kCents     = payrollProfile?.roth401kCents     ?? 0;

    // Step 1: Taxable benefits (increase taxable wages)
    const taxableBenefits: DeductionLineItem[] = [];
    if (excessLifeCents > 0) {
      taxableBenefits.push({ id: "excess-life", name: "Excess Life", amountCents: excessLifeCents });
    }
    const taxableBenefitsTotal = taxableBenefits.reduce((s, d) => s + d.amountCents, 0);

    // Step 2: Pre-tax deductions (reduce taxable wages)
    const preTaxDeductions: DeductionLineItem[] = [];
    if (pretaxFlexCents > 0) {
      preTaxDeductions.push({ id: "pretax-flex", name: "Pretax Flex", amountCents: pretaxFlexCents });
    }
    if (vebaCents > 0) {
      preTaxDeductions.push({ id: "veba", name: "VEBA", amountCents: vebaCents });
    }
    const preTaxTotal = preTaxDeductions.reduce((s, d) => s + d.amountCents, 0);

    // Step 3: Taxable wages = grossTaxable + taxableBenefits - preTaxDeductions
    const taxableWages = Math.max(0, grossTaxable + taxableBenefitsTotal - preTaxTotal);

    // Step 4: Taxes — always applied to adjusted taxableWages (not raw gross)
    let federalCents = 0;
    let ssCents = 0;
    let medicareCents = 0;

    if (lastBreakdown) {
      // Use the effective federal rate from the tax settings breakdown,
      // but re-apply it to our locally-adjusted taxableWages so pretax deductions
      // (Pretax Flex, VEBA) correctly reduce the federal withholding base.
      const effectiveRate = lastBreakdown.effectiveFederalRate / 100;
      federalCents = Math.round(taxableWages * effectiveRate);

      // Always compute SS and Medicare from our adjusted taxableWages, not the API value
      // which was derived from raw gross without UPS pretax deductions applied.
      const ytdCents = stats?.currentYear.totalPayCents ?? 0;
      let ssWages = taxableWages;
      if (ytdCents >= SS_WAGE_CAP_CENTS) {
        ssWages = 0;
      } else if (ytdCents + taxableWages > SS_WAGE_CAP_CENTS) {
        ssWages = SS_WAGE_CAP_CENTS - ytdCents;
      }
      ssCents = Math.round(ssWages * 0.062);
      medicareCents = Math.round(taxableWages * 0.0145);
    } else {
      // W-4 Percentage Method (bi-weekly) fallback — applied to adjusted taxableWages
      const annualTaxableWages = (taxableWages / 100) * 26;
      const standardDeduction = 15000; // 2025 single
      const taxableIncome = Math.max(0, annualTaxableWages - standardDeduction);

      // 2025 single brackets, simplified
      let annualTax = 0;
      if (taxableIncome <= 11925) annualTax = taxableIncome * 0.10;
      else if (taxableIncome <= 48475) annualTax = 1192.50 + (taxableIncome - 11925) * 0.12;
      else if (taxableIncome <= 103350) annualTax = 5578.50 + (taxableIncome - 48475) * 0.22;
      else if (taxableIncome <= 197300) annualTax = 17651 + (taxableIncome - 103350) * 0.24;
      else if (taxableIncome <= 250500) annualTax = 40199 + (taxableIncome - 197300) * 0.32;
      else if (taxableIncome <= 626350) annualTax = 57223 + (taxableIncome - 250500) * 0.35;
      else annualTax = 188770.75 + (taxableIncome - 626350) * 0.37;

      federalCents = Math.round((annualTax * 100) / 26);

      const ytdCentsElse = stats?.currentYear.totalPayCents ?? 0;
      let ssWages = taxableWages;
      if (ytdCentsElse >= SS_WAGE_CAP_CENTS) {
        ssWages = 0;
      } else if (ytdCentsElse + taxableWages > SS_WAGE_CAP_CENTS) {
        ssWages = SS_WAGE_CAP_CENTS - ytdCentsElse;
      }
      ssCents = Math.round(ssWages * 0.062);
      medicareCents = Math.round(taxableWages * 0.0145);
    }

    const taxDeductions: DeductionLineItem[] = [
      { id: "federal", name: "Federal W/H", rate: lastBreakdown ? `${lastBreakdown.effectiveFederalRate.toFixed(0)}%` : undefined, amountCents: federalCents },
      { id: "ss", name: "Social Security (FICA)", rate: "6.2%", amountCents: ssCents },
      { id: "medicare", name: "Medicare", rate: "1.45%", amountCents: medicareCents },
    ];

    if (lastBreakdown?.stateWithholdingCents && lastBreakdown.stateWithholdingCents > 0) {
      taxDeductions.push({
        id: "state",
        name: `State Tax (${lastBreakdown.stateInfo?.code ?? "Est."})`,
        rate: `${lastBreakdown.effectiveStateRate?.toFixed(0) ?? 0}%`,
        amountCents: lastBreakdown.stateWithholdingCents,
      });
    }
    const taxTotal = taxDeductions.reduce((s, d) => s + d.amountCents, 0);

    // Step 5: Post-tax deductions
    const postTaxDeductions: DeductionLineItem[] = [];
    if (ltdCents > 0) {
      postTaxDeductions.push({ id: "ltd", name: "Long Term Disability", amountCents: ltdCents });
    }
    if (mutualAidCents > 0) {
      postTaxDeductions.push({ id: "mutual-aid", name: "Mutual Aid", amountCents: mutualAidCents });
    }
    if (unionDuesCents > 0) {
      postTaxDeductions.push({ id: "union-dues", name: "Union Dues", amountCents: unionDuesCents });
    }
    if (roth401kCents > 0) {
      postTaxDeductions.push({ id: "roth-401k", name: "Roth 401(k)", amountCents: roth401kCents });
    }
    const postTaxTotal = postTaxDeductions.reduce((s, d) => s + d.amountCents, 0);

    // Total deductions
    const totalDeductions = preTaxTotal + taxTotal + postTaxTotal;

    // Net pay = grossTaxable + grossNonTaxable - preTax - taxes - postTax
    // (taxable benefits don't reduce net pay, they just increase the taxable wage base)
    const computedNetPay = grossTaxable + grossNonTaxable - preTaxTotal - taxTotal - postTaxTotal;

    return {
      taxableBenefits,
      preTaxDeductions,
      taxDeductions,
      postTaxDeductions,
      totalDeductions,
      effectiveTaxableWages: taxableWages,
      computedNetPay: Math.max(0, computedNetPay),
    };
  }, [lastBreakdown, checkSpecificGross, rawPayData, payrollProfile, hourlyRateCents, perDiemCents, stats]);

  const { taxableBenefits, preTaxDeductions, taxDeductions, postTaxDeductions, totalDeductions, computedNetPay } = allDeductions;

  // YTD summary
  const ytdSummary = useMemo<YTDSummary>(() => {
    const grossYTD = stats?.currentYear.totalPayCents ?? 0;
    const estimatedTaxRate = 0.27;
    const estimatedTaxes = Math.round(grossYTD * estimatedTaxRate);
    const estimated401k = Math.round(grossYTD * 0.10);

    return {
      grossEarningsCents: grossYTD,
      estimatedTaxesCents: estimatedTaxes,
      estimatedDeductionsCents: estimated401k,
      estimatedNetCents: grossYTD - estimatedTaxes - estimated401k,
      ssWagesCents: Math.min(grossYTD, SS_WAGE_CAP_CENTS),
      ssCapCents: SS_WAGE_CAP_CENTS,
      contribution401kCents: estimated401k,
    };
  }, [stats]);

  // Phase 6: Net pay scoped to specific check type
  // Always use our locally computed net pay which correctly applies the full UPS deduction
  // stack (pretax flex, VEBA, taxes on adjusted taxableWages, LTD, mutual aid, union dues).
  // lastBreakdown is used only to inform the federal effective rate, not the final net.
  const netPayCents = computedNetPay;

  // Phase 6: Calculate estimated net pay range for uncertainty display
  const netPayRange = useMemo(() => {
    return estimateNetPayRange(checkSpecificGross.taxableGrossCents);
  }, [checkSpecificGross.taxableGrossCents]);

  // Check if using sample data (use rawPayData.hasRealData from Phase 2)
  const usingSampleData = !rawPayData.hasRealData || !isAuthenticated;

  // Export handler
  const handleExport = async () => {
    if (!selectedPeriod) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let content = `PAY SUMMARY - PilotPay Tracker\n`;
    content += `${"=".repeat(40)}\n\n`;
    content += `Period ${selectedPeriod.periodNumber} — ${selectedPeriod.payType === 'standard' ? 'Advance' : 'Settlement'}, ${selectedPeriod.year}\n`;
    content += `${formatDateShort(selectedPeriod.startDate)} - ${formatDateShort(selectedPeriod.endDate)}\n\n`;
    content += `Pilot: ${pilotName ?? "Pilot"}\n`;
    content += `Position: ${profile?.position === "CPT" ? "Captain" : "First Officer"}\n\n`;

    content += `--- ESTIMATED EARNINGS ---\n`;
    earnings.forEach((e) => {
      if (e.amountCents > 0) {
        content += `${e.label}: ${formatCurrency(e.amountCents)}\n`;
      }
    });
    content += `\nTotal Estimated Earnings: ${formatCurrency(totalEarningsCents)}\n\n`;

    content += `--- ESTIMATED DEDUCTIONS ---\n`;
    [...preTaxDeductions, ...taxDeductions, ...postTaxDeductions].forEach((d) => {
      content += `${d.name}: ${formatCurrency(d.amountCents)}\n`;
    });
    content += `\nTotal Estimated Deductions: ${formatCurrency(totalDeductions)}\n\n`;

    content += `--- ESTIMATED NET PAY ---\n`;
    content += `${formatCurrency(netPayCents)}\n\n`;

    content += `--- DISCLAIMER ---\n`;
    content += `This Pay Summary is for informational purposes only. `;
    content += `Not an official payroll or tax document.\n\n`;
    content += `PilotPay Tracker - Know your pay. Own your numbers.`;

    try {
      await Share.share({
        message: content,
        title: `Pay Summary - Period ${selectedPeriod.periodNumber} ${selectedPeriod.payType === 'standard' ? 'Advance' : 'Settlement'}`,
      });
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Promise.all([
        refetchPeriods(),
        refetchStats(),
        refetchTrips(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchPeriods, refetchStats, refetchTrips]);

  const hasData = earnings.length > 0 && earnings.some((e) => e.amountCents > 0);
  const isLoading = periodsLoading;

  // Sample data banner component
  const SampleDataBanner = () => (
    <View className="bg-amber-500/20 border border-amber-500/40 rounded-xl p-3 mb-4 flex-row items-center">
      <AlertTriangle size={18} color="#f59e0b" style={{ marginRight: 10 }} />
      <View className="flex-1">
        <Text className="text-amber-400 font-semibold text-sm">Sample Data Preview</Text>
        <Text className="text-amber-200/80 text-xs mt-0.5">
          {isAuthenticated
            ? "Upload your schedule to see real pay calculations"
            : "Sign in & upload schedule for real pay data"}
        </Text>
      </View>
      <Pressable
        onPress={() => router.push(isAuthenticated ? "/trips" : "/welcome")}
        className="bg-amber-500 px-3 py-1.5 rounded-lg active:opacity-80"
      >
        <Text className="text-slate-900 font-semibold text-xs">
          {isAuthenticated ? "Upload" : "Sign In"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={["#0f172a", "#1e293b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#f59e0b"
              colors={["#f59e0b"]}
            />
          }
        >
          {/* Header Navigation */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center justify-between mb-4">
              <Pressable
                onPress={() => router.back()}
                className="flex-row items-center active:opacity-70"
              >
                <ChevronLeft size={20} color="#f59e0b" />
                <Text className="text-amber-500 text-base ml-1">Back</Text>
              </Pressable>

              <View className="flex-row items-center gap-2">
                <HelpButton tutorialId="pay_summary" size="medium" />
                <Pressable
                  onPress={() => router.push("/tax-settings")}
                  className="w-10 h-10 rounded-full bg-slate-800/60 border border-slate-700/50 items-center justify-center active:opacity-70"
                >
                  <Sliders size={18} color="#94a3b8" />
                </Pressable>
                <Pressable
                  onPress={handleExport}
                  className="w-10 h-10 rounded-full bg-slate-800/60 border border-slate-700/50 items-center justify-center active:opacity-70"
                >
                  <Share2 size={18} color="#94a3b8" />
                </Pressable>
              </View>
            </View>
          </Animated.View>

          {/* Loading */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading pay data...</Text>
            </View>
          )}

          {/* Main Content */}
          {!isLoading && (
            <>
              {/* Period Selector */}
              <Animated.View entering={FadeInDown.duration(600).delay(150)}>
                <PeriodSelector
                  periods={periodsData?.periods ?? []}
                  selectedPeriod={selectedPeriod}
                  onSelect={setSelectedPeriod}
                />
              </Animated.View>

              {hasData ? (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(200)}
                  className="mx-4"
                >
                  {/* Sample Data Banner */}
                  {usingSampleData && <SampleDataBanner />}

                  {/* Phase 3: Next Pay Date Info */}
                  <NextPayDateInfo
                    upcomingPayDates={upcomingPayDates}
                    onSmallCheckInfo={showSmallCheckInfo}
                    onBigCheckInfo={showBigCheckInfo}
                  />

                  {/* Statement Card */}
                  <View className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-700/50 shadow-2xl">
                    {/* Header with Sky Gradient */}
                    {selectedPeriod && (
                      <StatementHeader
                        periodStart={selectedPeriod.startDate}
                        periodEnd={selectedPeriod.endDate}
                        generatedAt={new Date()}
                      />
                    )}

                    {/* Title Bar */}
                    <TitleBar
                      checkTypeState={checkTypeState}
                      paycheckClassification={paycheckClassification}
                      onCheckTypeInfo={showCheckTypeInfo}
                    />

                    {/* Pilot Info */}
                    {selectedPeriod && (
                      <PilotInfoSection
                        pilotName={pilotName}
                        gemsId={profile?.gemsId ?? null}
                        position={profile?.position ?? null}
                        equipment={profile?.base ?? null}
                        periodStart={selectedPeriod.startDate}
                        periodEnd={selectedPeriod.endDate}
                        generatedAt={new Date()}
                      />
                    )}

                    {/* Contract Guarantee Breakdown — shown on Settlement (Big Check) always */}
                    {checkTypeState.checkType === 'big' && (
                      <View className="pt-3">
                        <GuaranteeBreakdownCard
                          breakdown={guaranteeBreakdown}
                          onInfoPress={showGuaranteeInfo}
                        />
                      </View>
                    )}

                    {/* Estimated Earnings */}
                    <SectionHeader
                      title="Estimated Earnings Breakdown"
                      subtitle="Auto-calculated from uploaded schedules"
                      color="#22c55e"
                    />
                    <View className="border-b border-slate-700/50">
                      {/* Column Headers */}
                      <View className="flex-row px-4 py-2 bg-slate-800/60 border-b border-slate-700/30">
                        <Text className="flex-1 text-slate-400 text-xs font-semibold">Description</Text>
                        <Text className="text-slate-400 text-xs font-semibold w-16 text-right mr-6">Rate</Text>
                        <Text className="text-slate-400 text-xs font-semibold w-28 text-right">Amount</Text>
                      </View>

                      {earnings.map((item, index) => (
                        <TableRow
                          key={item.id}
                          label={item.label}
                          amount={item.amountCents}
                          isEven={index % 2 === 1}
                          amountColor={item.amountCents > 0 ? "#4ade80" : "#64748b"}
                          onPress={item.amountCents > 0 ? () => setDetailModalItem(item) : undefined}
                        />
                      ))}

                      {/* Total Row */}
                      <TableRow
                        label="Total Estimated Earnings"
                        amount={totalEarningsCents}
                        isTotal={true}
                        amountColor="#4ade80"
                      />
                    </View>

                    {/* Estimated Deductions */}
                    <SectionHeader
                      title="Estimated Deductions"
                      subtitle="User-configurable from Tax Settings"
                      color="#ef4444"
                    />
                    <View className="border-b border-slate-700/50">
                      {/* Column Headers */}
                      <View className="flex-row px-4 py-2 bg-slate-800/60 border-b border-slate-700/30">
                        <Text className="flex-1 text-slate-400 text-xs font-semibold">Description</Text>
                        <Text className="text-slate-400 text-xs font-semibold w-16 text-right mr-6">Rate</Text>
                        <Text className="text-slate-400 text-xs font-semibold w-28 text-right">Amount</Text>
                      </View>

                      {/* Estimation Source Label */}
                      <View className="px-4 py-2 bg-slate-800/30 border-b border-slate-700/20">
                        <Text className="text-slate-500 text-xs italic">
                          {payrollProfile && payrollProfile.paystubCount >= 2
                            ? `Estimate based on ${payrollProfile.paystubCount} uploaded paystubs and trip data`
                            : payrollProfile && payrollProfile.paystubCount === 1
                            ? "Estimate based on 1 uploaded paystub and trip data"
                            : "Estimate based on UPS contract defaults and saved tax settings"}
                        </Text>
                      </View>
                      {taxableBenefits.length > 0 && taxableBenefits.map((item, index) => (
                        <TableRow
                          key={item.id}
                          label={item.name}
                          rate={item.rate}
                          amount={item.amountCents}
                          isEven={index % 2 === 1}
                          amountColor="#f59e0b"
                        />
                      ))}

                      {/* Pre-Tax Deductions */}
                      {preTaxDeductions.map((item, index) => (
                        <TableRow
                          key={item.id}
                          label={item.name}
                          rate={item.rate}
                          amount={item.amountCents}
                          isEven={(taxableBenefits.length + index) % 2 === 1}
                          amountColor="#60a5fa"
                        />
                      ))}

                      {/* Taxes */}
                      {taxDeductions.map((item, index) => (
                        <TableRow
                          key={item.id}
                          label={item.name}
                          rate={item.rate}
                          amount={item.amountCents}
                          isEven={(taxableBenefits.length + preTaxDeductions.length + index) % 2 === 1}
                          amountColor="#f87171"
                        />
                      ))}

                      {/* Post-Tax Deductions */}
                      {postTaxDeductions.map((item, index) => (
                        <TableRow
                          key={item.id}
                          label={item.name}
                          rate={item.rate}
                          amount={item.amountCents}
                          isEven={(taxableBenefits.length + preTaxDeductions.length + taxDeductions.length + index) % 2 === 1}
                          amountColor="#fb923c"
                        />
                      ))}

                      {/* Total Row */}
                      <TableRow
                        label="Total Estimated Deductions"
                        amount={totalDeductions}
                        isTotal={true}
                        amountColor="#f87171"
                      />
                    </View>

                    {/* Net Pay Card */}
                    <NetPayCard
                      netPayCents={netPayCents}
                      grossPayCents={grossEarningsCents}
                      checkTypeState={checkTypeState}
                      guaranteeBreakdown={checkTypeState.checkType === 'big' ? guaranteeBreakdown : undefined}
                    />

                    {/* Year-to-Date Tracking */}
                    <SectionHeader
                      title="Year-to-Date Tracking"
                      subtitle={`${new Date().getFullYear()} cumulative totals`}
                      color="#3b82f6"
                    />
                    <View className="border-b border-slate-700/50">
                      <TwoColumnRow
                        leftLabel="Gross Earnings"
                        leftValue={ytdSummary.grossEarningsCents}
                        rightLabel="Estimated Taxes"
                        rightValue={ytdSummary.estimatedTaxesCents}
                        isEven={false}
                      />
                      <TwoColumnRow
                        leftLabel="401(k) Contributions"
                        leftValue={ytdSummary.contribution401kCents}
                        rightLabel="401(k) Contributions"
                        rightValue={ytdSummary.contribution401kCents}
                        isEven={true}
                      />
                      <View className="bg-slate-800/80 px-4 py-3 border-t border-slate-700/30">
                        <View className="flex-row justify-between items-center">
                          <Text className="text-white font-semibold">Estimated Net YTD</Text>
                          <Text className="text-green-400 font-bold text-lg">
                            {formatCurrencyWhole(ytdSummary.estimatedNetCents)}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* Sick Usage Summary */}
                    <View className="mt-6 mb-4">
                      {/* Sick Bank Balance */}
                      {sickBank && (
                        <View className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-3">
                          <View className="flex-row items-center justify-between">
                            <View className="flex-row items-center gap-2">
                              <View className="w-8 h-8 rounded-lg bg-red-500/20 items-center justify-center">
                                <Text style={{ fontSize: 16 }}>🏥</Text>
                              </View>
                              <Text className="text-white font-semibold text-sm">Sick Time Balance</Text>
                            </View>
                            <Text className="text-red-400 font-bold text-xl" style={{ fontFamily: 'JetBrainsMono_700Bold' }}>
                              {sickBank.balanceHours.toFixed(1)} hrs
                            </Text>
                          </View>
                          <View className="flex-row justify-between mt-3 pt-3 border-t border-red-500/20">
                            <Text className="text-slate-400 text-xs">Accrual Rate</Text>
                            <Text className="text-slate-300 text-xs font-medium">{sickBank.accrualRateHours} hrs/month</Text>
                          </View>
                        </View>
                      )}
                      <SickSummaryCard />
                    </View>

                    {/* Disclaimer */}
                    <DisclaimerSection />

                    {/* Footer */}
                    <StatementFooter />
                  </View>
                </Animated.View>
              ) : (
                <EmptyState
                  onUploadSchedule={() => router.push("/trips")}
                  onSetupDeductions={() => router.push("/tax-settings")}
                />
              )}
            </>
          )}
        </ScrollView>
      </LinearGradient>

      {/* Item Detail Modal */}
      <Modal visible={!!detailModalItem} animationType="slide" transparent>
        <View className="flex-1 bg-black/60">
          <Pressable className="flex-1" onPress={() => setDetailModalItem(null)} />
          <View
            className="bg-slate-900 rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <View className="px-5 py-4 border-b border-slate-700/50">
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-lg font-semibold">Earnings Detail</Text>
                <Pressable onPress={() => setDetailModalItem(null)}>
                  <X size={20} color="#64748b" />
                </Pressable>
              </View>
            </View>

            {detailModalItem && (
              <View className="px-5 py-4">
                <Text className="text-white text-xl font-bold mb-2">
                  {detailModalItem.label}
                </Text>
                <Text className="text-slate-400 mb-4">{detailModalItem.description}</Text>

                <View className="bg-slate-800/50 rounded-xl p-4 mb-4">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-slate-400">Amount</Text>
                    <Text className="text-green-400 font-bold text-lg">
                      {formatCurrency(detailModalItem.amountCents)}
                    </Text>
                  </View>
                  {detailModalItem.creditMinutes && (
                    <View className="flex-row justify-between items-center mt-2">
                      <Text className="text-slate-400">Credit Hours</Text>
                      <Text className="text-white font-semibold">
                        {formatMinutes(detailModalItem.creditMinutes)}
                      </Text>
                    </View>
                  )}
                </View>

                {detailModalItem.trips && detailModalItem.trips.length > 0 && (
                  <View>
                    <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">
                      Contributing Trips
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      {detailModalItem.trips.length} trip
                      {detailModalItem.trips.length !== 1 ? "s" : ""} in this period
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Tooltip Modal for Help Info */}
      <TooltipModal
        visible={tooltipVisible}
        onClose={() => setTooltipVisible(false)}
        title={activeTooltip?.title ?? ""}
        content={activeTooltip?.content ?? ""}
      />

      {/* Auto Tutorial Modal */}
      {TutorialModalComponent}
    </View>
  );
}
