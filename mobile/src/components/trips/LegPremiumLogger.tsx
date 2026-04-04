/**
 * Leg Premium Logger Component (Phase 4)
 *
 * Flight-line premium logging with leg-level OOOI proof:
 * - Select a leg from the trip
 * - Choose applicable premium code
 * - OOOI times auto-populate for late arrival codes (LP1, LP2, RJA)
 * - Calculate premium credit in real-time
 * - Save premium to leg record
 *
 * Used from Trip Detail Drawer for per-leg premium documentation
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import {
  X,
  Plane,
  Clock,
  DollarSign,
  Award,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Calculator,
  Camera,
  FileText,
  Info,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cn } from "@/lib/cn";
import { usePremiumCodes, formatPremiumResult, getCategoryConfig } from "@/lib/usePremiumCodes";
import { QuickFeedback } from "@/components/FeedbackComponents";
import type { BackendLeg, BackendDutyDay } from "@/lib/useTripsData";
import type { PremiumCode, PremiumCodeCategory } from "@/lib/contracts";

// ============================================
// TYPES
// ============================================

export interface LegPremiumLoggerProps {
  visible: boolean;
  onClose: () => void;
  leg: BackendLeg | null;
  dutyDay: BackendDutyDay | null;
  onSavePremium: (data: {
    legId: string;
    premiumCode: string;
    premiumMinutes: number;
    premiumAmountCents: number;
    notes?: string;
  }) => void;
  onCaptureOOOI?: () => void;
  hourlyRateCents?: number;
  isSaving?: boolean;
}

// Late arrival codes that use OOOI proof
const LATE_ARRIVAL_CODES = ["LP1", "LP2", "RJA"];

// ============================================
// HELPERS
// ============================================

function formatTimeFromISO(iso: string | null): string {
  if (!iso) return "--:--";
  try {
    const date = new Date(iso);
    const h = date.getUTCHours().toString().padStart(2, "0");
    const m = date.getUTCMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "--:--";
  }
}

function formatMinutesToTime(minutes: number): string {
  if (!minutes || minutes < 0) return "0:00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatCentsToCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function calculateDelayMinutes(
  scheduledInISO: string | null,
  actualInISO: string | null
): number {
  if (!scheduledInISO || !actualInISO) return 0;
  try {
    const scheduled = new Date(scheduledInISO).getTime();
    const actual = new Date(actualInISO).getTime();
    const diffMs = actual - scheduled;
    return Math.max(0, Math.floor(diffMs / (1000 * 60)));
  } catch {
    return 0;
  }
}

// ============================================
// LEG INFO CARD
// ============================================

function LegInfoCard({ leg }: { leg: BackendLeg }) {
  const hasOOOI = !!(
    leg.actualOutISO &&
    leg.actualOffISO &&
    leg.actualOnISO &&
    leg.actualInISO
  );
  const hasPartialOOOI = !!(
    leg.actualOutISO ||
    leg.actualOffISO ||
    leg.actualOnISO ||
    leg.actualInISO
  );

  return (
    <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
      {/* Flight Info */}
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-lg bg-blue-500/20 items-center justify-center">
          <Plane size={18} color="#3b82f6" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-white font-bold text-lg">
            {leg.flightNumber || "----"}
          </Text>
          <Text className="text-slate-400 text-sm">
            {leg.origin || "---"} → {leg.destination || "---"}
          </Text>
        </View>
        {leg.isDeadhead && (
          <View className="bg-amber-500/20 px-2 py-1 rounded-lg">
            <Text className="text-amber-400 text-xs font-medium">DH</Text>
          </View>
        )}
      </View>

      {/* Times Row */}
      <View className="flex-row justify-between items-center py-2 border-t border-slate-700/50">
        <View>
          <Text className="text-slate-500 text-xs">Scheduled</Text>
          <Text className="text-slate-300 text-sm">
            {formatTimeFromISO(leg.scheduledOutISO)} →{" "}
            {formatTimeFromISO(leg.scheduledInISO)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-slate-500 text-xs">Actual</Text>
          <Text
            className={cn(
              "text-sm",
              hasOOOI
                ? "text-emerald-400"
                : hasPartialOOOI
                  ? "text-amber-400"
                  : "text-slate-500"
            )}
          >
            {hasPartialOOOI || hasOOOI
              ? `${formatTimeFromISO(leg.actualOutISO)} → ${formatTimeFromISO(leg.actualInISO)}`
              : "Not captured"}
          </Text>
        </View>
      </View>

      {/* OOOI Status */}
      <View className="flex-row items-center mt-2 pt-2 border-t border-slate-700/50">
        {hasOOOI ? (
          <>
            <CheckCircle size={14} color="#10b981" />
            <Text className="text-emerald-400 text-xs ml-1.5">
              OOOI Complete — Block: {formatMinutesToTime(leg.actualBlockMinutes)}
            </Text>
          </>
        ) : hasPartialOOOI ? (
          <>
            <AlertTriangle size={14} color="#f59e0b" />
            <Text className="text-amber-400 text-xs ml-1.5">
              OOOI Partial — Tap to complete
            </Text>
          </>
        ) : (
          <>
            <Camera size={14} color="#64748b" />
            <Text className="text-slate-500 text-xs ml-1.5">
              No OOOI captured
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

// ============================================
// PREMIUM CODE CARD
// ============================================

function PremiumCodeCard({
  code,
  isSelected,
  onSelect,
  hourlyRateCents,
}: {
  code: PremiumCode;
  isSelected: boolean;
  onSelect: () => void;
  hourlyRateCents: number;
}) {
  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);
  const premiumDisplay = formatPremiumResult(code);

  // Calculate estimated pay
  const estimatedPayCents =
    code.premiumType === "minutes" && code.premiumMinutes
      ? Math.round((code.premiumMinutes / 60) * hourlyRateCents)
      : 0;

  const isLateArrival = LATE_ARRIVAL_CODES.includes(code.code);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect();
      }}
      className={cn(
        "rounded-xl p-3 border mb-2",
        isSelected
          ? "bg-emerald-500/10 border-emerald-500/50"
          : "bg-slate-800/60 border-slate-700/50 active:bg-slate-800/80"
      )}
    >
      <View className="flex-row items-center">
        {/* Code Badge */}
        <View
          className={cn("px-2 py-1.5 rounded-lg mr-3", categoryConfig.bgColor)}
        >
          <Text
            className="font-bold text-sm"
            style={{ color: categoryConfig.color }}
          >
            {code.code}
          </Text>
        </View>

        {/* Info */}
        <View className="flex-1">
          <Text className="text-white font-medium" numberOfLines={1}>
            {code.title}
          </Text>
          <View className="flex-row items-center mt-0.5">
            {isLateArrival && (
              <View className="bg-blue-500/20 px-1.5 py-0.5 rounded mr-2">
                <Text className="text-blue-400 text-xs">Uses OOOI</Text>
              </View>
            )}
            {code.contractRef && (
              <Text className="text-slate-500 text-xs" numberOfLines={1}>
                {code.contractRef}
              </Text>
            )}
          </View>
        </View>

        {/* Premium */}
        <View className="items-end">
          <Text
            className={cn(
              "font-bold text-base",
              code.premiumType === "minutes"
                ? "text-emerald-400"
                : code.premiumType === "multiplier"
                  ? "text-blue-400"
                  : "text-amber-400"
            )}
          >
            {premiumDisplay}
          </Text>
          {estimatedPayCents > 0 && (
            <Text className="text-slate-500 text-xs">
              ≈ {formatCentsToCurrency(estimatedPayCents)}
            </Text>
          )}
        </View>

        {/* Selection indicator */}
        {isSelected && (
          <View className="ml-2">
            <CheckCircle size={18} color="#10b981" />
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ============================================
// LATE ARRIVAL CALCULATOR
// ============================================

function LateArrivalCalculator({
  leg,
  code,
  hourlyRateCents,
  onCalculate,
}: {
  leg: BackendLeg;
  code: PremiumCode;
  hourlyRateCents: number;
  onCalculate: (minutes: number, payCents: number) => void;
}) {
  const delayMinutes = calculateDelayMinutes(
    leg.scheduledInISO,
    leg.actualInISO
  );

  const hasOOOI = !!(leg.actualInISO && leg.scheduledInISO);

  // Calculate premium based on delay and multiplier
  const multiplier = code.premiumMultiplier ?? 1.5;
  const basePayCents = Math.round((delayMinutes / 60) * hourlyRateCents);
  const premiumPayCents = Math.round(basePayCents * (multiplier - 1));
  const totalPayCents = basePayCents + premiumPayCents;

  // Auto-calculate on mount if we have OOOI
  useEffect(() => {
    if (hasOOOI && delayMinutes > 0) {
      onCalculate(delayMinutes, premiumPayCents);
    }
  }, [hasOOOI, delayMinutes, premiumPayCents, onCalculate]);

  if (!hasOOOI) {
    return (
      <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mt-4">
        <View className="flex-row items-center mb-2">
          <AlertTriangle size={16} color="#f59e0b" />
          <Text className="text-amber-400 text-sm font-semibold ml-2">
            OOOI Required
          </Text>
        </View>
        <Text className="text-slate-400 text-sm">
          Capture OOOI times to automatically calculate late arrival premium for{" "}
          {code.code}.
        </Text>
      </View>
    );
  }

  if (delayMinutes <= 0) {
    return (
      <View className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 mt-4">
        <View className="flex-row items-center mb-2">
          <CheckCircle size={16} color="#10b981" />
          <Text className="text-emerald-400 text-sm font-semibold ml-2">
            On-Time Arrival
          </Text>
        </View>
        <Text className="text-slate-400 text-sm">
          No late arrival delay detected. {code.code} premium may not apply.
        </Text>
      </View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mt-4"
    >
      <View className="flex-row items-center mb-3">
        <Calculator size={16} color="#3b82f6" />
        <Text className="text-blue-400 text-sm font-semibold ml-2">
          Late Arrival Calculated — {code.code}
        </Text>
      </View>

      <View className="bg-slate-900/50 rounded-lg p-3">
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Scheduled Arrival</Text>
          <Text className="text-white font-medium">
            {formatTimeFromISO(leg.scheduledInISO)}
          </Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Actual Arrival</Text>
          <Text className="text-white font-medium">
            {formatTimeFromISO(leg.actualInISO)}
          </Text>
        </View>
        <View className="flex-row justify-between mb-2 pt-2 border-t border-slate-700">
          <Text className="text-slate-400 text-sm">Late Time</Text>
          <Text className="text-amber-400 font-bold">
            +{formatMinutesToTime(delayMinutes)}
          </Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Multiplier</Text>
          <Text className="text-blue-400 font-medium">{multiplier}x</Text>
        </View>
        <View className="h-px bg-slate-700 my-2" />
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Base Pay ({formatMinutesToTime(delayMinutes)})</Text>
          <Text className="text-white">{formatCentsToCurrency(basePayCents)}</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-emerald-400 text-sm font-semibold">
            Premium Pay ({multiplier}x - 1)
          </Text>
          <Text className="text-emerald-400 font-bold">
            +{formatCentsToCurrency(premiumPayCents)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-blue-500/20">
        <Text className="text-slate-400 text-sm">Contract Reference</Text>
        <Text className="text-slate-500 text-xs">{code.contractRef || "—"}</Text>
      </View>
    </Animated.View>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export function LegPremiumLogger({
  visible,
  onClose,
  leg,
  dutyDay,
  onSavePremium,
  onCaptureOOOI,
  hourlyRateCents = 32500,
  isSaving,
}: LegPremiumLoggerProps) {
  const insets = useSafeAreaInsets();

  // State
  const [selectedCode, setSelectedCode] = useState<PremiumCode | null>(null);
  const [calculatedMinutes, setCalculatedMinutes] = useState(0);
  const [calculatedPayCents, setCalculatedPayCents] = useState(0);
  const [notes, setNotes] = useState("");

  // Fetch premium codes - filter to late arrival and common leg-level codes
  const { data: codesData, isLoading } = usePremiumCodes({});
  const premiumCodes = useMemo(() => {
    const codes = codesData?.codes ?? [];
    // Show late arrival codes first, then other applicable codes
    const lateArrival = codes.filter((c) => LATE_ARRIVAL_CODES.includes(c.code));
    const others = codes.filter(
      (c) =>
        !LATE_ARRIVAL_CODES.includes(c.code) &&
        ["AP1", "AP2", "AP3", "AP6", "APE"].includes(c.code)
    );
    return [...lateArrival, ...others];
  }, [codesData]);

  // Check if selected code is late arrival type
  const isLateArrivalCode = selectedCode
    ? LATE_ARRIVAL_CODES.includes(selectedCode.code)
    : false;

  // Reset state when leg changes
  useEffect(() => {
    if (leg) {
      setSelectedCode(null);
      setCalculatedMinutes(0);
      setCalculatedPayCents(0);
      setNotes("");
    }
  }, [leg?.id]);

  // Handle late arrival calculation
  const handleLateArrivalCalculate = useCallback(
    (minutes: number, payCents: number) => {
      setCalculatedMinutes(minutes);
      setCalculatedPayCents(payCents);
    },
    []
  );

  // Get premium minutes based on code type
  const getPremiumMinutes = useCallback(() => {
    if (!selectedCode) return 0;
    if (isLateArrivalCode) {
      return calculatedMinutes;
    }
    return selectedCode.premiumMinutes ?? 0;
  }, [selectedCode, isLateArrivalCode, calculatedMinutes]);

  // Get premium pay cents based on code type
  const getPremiumPayCents = useCallback(() => {
    if (!selectedCode) return 0;
    if (isLateArrivalCode) {
      return calculatedPayCents;
    }
    if (selectedCode.premiumType === "minutes" && selectedCode.premiumMinutes) {
      return Math.round((selectedCode.premiumMinutes / 60) * hourlyRateCents);
    }
    return 0;
  }, [selectedCode, isLateArrivalCode, calculatedPayCents, hourlyRateCents]);

  // Handle save
  const handleSave = useCallback(() => {
    if (!leg || !selectedCode) return;

    const premiumMinutes = getPremiumMinutes();
    const premiumPayCents = getPremiumPayCents();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSavePremium({
      legId: leg.id,
      premiumCode: selectedCode.code,
      premiumMinutes,
      premiumAmountCents: premiumPayCents,
      notes: notes.trim() || undefined,
    });
  }, [leg, selectedCode, getPremiumMinutes, getPremiumPayCents, notes, onSavePremium]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  // Can save?
  const canSave = useMemo(() => {
    if (!selectedCode) return false;
    if (isLateArrivalCode && calculatedMinutes <= 0) return false;
    return true;
  }, [selectedCode, isLateArrivalCode, calculatedMinutes]);

  if (!leg) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-black/70 justify-end">
        <Animated.View
          entering={SlideInDown.duration(300)}
          className="bg-slate-900 rounded-t-3xl max-h-[90%]"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-5 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-xl bg-emerald-500/20 items-center justify-center">
                <Award size={20} color="#10b981" />
              </View>
              <View className="ml-3">
                <Text className="text-white font-bold text-lg">
                  Log Leg Premium
                </Text>
                <Text className="text-slate-400 text-sm">
                  Flight-line premium with OOOI proof
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 20 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Leg Info Card */}
            <LegInfoCard leg={leg} />

            {/* Capture OOOI Button */}
            {onCaptureOOOI && !(leg.actualOutISO && leg.actualInISO) && (
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onCaptureOOOI();
                }}
                className="bg-blue-500/20 border border-blue-500/40 rounded-xl py-3 flex-row items-center justify-center mt-4 active:opacity-80"
              >
                <Camera size={18} color="#3b82f6" />
                <Text className="text-blue-400 font-semibold ml-2">
                  Capture OOOI Times
                </Text>
              </Pressable>
            )}

            {/* Premium Code Selection */}
            <Animated.View
              entering={FadeInDown.duration(300).delay(100)}
              className="mt-6"
            >
              <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                Select Premium Code
              </Text>

              {isLoading ? (
                <View className="items-center py-8">
                  <ActivityIndicator size="small" color="#f59e0b" />
                </View>
              ) : (
                premiumCodes.map((code) => (
                  <PremiumCodeCard
                    key={code.code}
                    code={code}
                    isSelected={selectedCode?.code === code.code}
                    onSelect={() => setSelectedCode(code)}
                    hourlyRateCents={hourlyRateCents}
                  />
                ))
              )}
            </Animated.View>

            {/* Late Arrival Calculator (for LP1, LP2, RJA) */}
            {selectedCode && isLateArrivalCode && (
              <LateArrivalCalculator
                leg={leg}
                code={selectedCode}
                hourlyRateCents={hourlyRateCents}
                onCalculate={handleLateArrivalCalculate}
              />
            )}

            {/* Fixed Premium Display (for non-late-arrival codes) */}
            {selectedCode && !isLateArrivalCode && (
              <Animated.View
                entering={FadeIn.duration(300)}
                className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mt-4"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <DollarSign size={18} color="#10b981" />
                    <Text className="text-emerald-400 text-sm font-semibold ml-2">
                      Premium Credit
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-emerald-400 text-xl font-bold">
                      +{formatMinutesToTime(selectedCode.premiumMinutes ?? 0)}
                    </Text>
                    <Text className="text-emerald-400/70 text-xs">
                      ≈ {formatCentsToCurrency(getPremiumPayCents())}
                    </Text>
                  </View>
                </View>
              </Animated.View>
            )}

            {/* Notes */}
            {selectedCode && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(200)}
                className="mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">
                  Notes (Optional)
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Additional details, rep name, call time..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={2}
                  className="bg-slate-800/60 rounded-xl border border-slate-700/50 text-white p-4"
                  style={{ minHeight: 70 }}
                />
              </Animated.View>
            )}

            {/* Info banner */}
            <View className="mt-4 bg-slate-800/40 rounded-xl p-3 flex-row items-start">
              <Info size={14} color="#64748b" className="mt-0.5" />
              <Text className="text-slate-400 text-xs ml-2 flex-1">
                Premium is attached to this specific leg. OOOI times serve as
                proof for late arrival codes.
              </Text>
            </View>

            {/* AI Suggestion Feedback */}
            {selectedCode && (
              <View className="mt-3 flex-row items-center justify-end">
                <QuickFeedback
                  explanationType="pay_rule"
                  entityId={`premium_code_${selectedCode.code}_${leg.id}`}
                  size="sm"
                  label="Code suggestion helpful?"
                />
              </View>
            )}
          </ScrollView>

          {/* Save Button */}
          <View className="px-5 pt-4 border-t border-slate-800">
            <Pressable
              onPress={handleSave}
              disabled={!canSave || isSaving}
              className={cn(
                "rounded-xl py-4 flex-row items-center justify-center",
                canSave && !isSaving
                  ? "bg-emerald-500 active:bg-emerald-600"
                  : "bg-slate-700"
              )}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <FileText size={20} color={canSave ? "#fff" : "#64748b"} />
                  <Text
                    className={cn(
                      "font-bold text-base ml-2",
                      canSave ? "text-white" : "text-slate-500"
                    )}
                  >
                    {!selectedCode
                      ? "Select a Premium Code"
                      : isLateArrivalCode && calculatedMinutes <= 0
                        ? "Late Arrival Required"
                        : "Save Leg Premium"}
                  </Text>
                  {canSave && (
                    <Text className="text-emerald-200 text-sm ml-2">
                      (+{formatMinutesToTime(getPremiumMinutes())})
                    </Text>
                  )}
                </>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default LegPremiumLogger;
