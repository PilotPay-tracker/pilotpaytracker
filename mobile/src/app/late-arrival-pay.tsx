/**
 * Late Arrival Pay (LP) Calculator — UPS Only
 *
 * UPDATED: Leg-Level OOOI Integration
 *
 * Premium codes:
 * - LP1: 150% multiplier — delay > 4h from scheduled trip end (13.E.4.e.(1),(2))
 * - LP2: 250% multiplier — delay > 25h domestic / > 50h intl (13.E.5.c)
 * - RJA: 150% multiplier — > 2h into calendar day off (13.B.6.c.(2)(a))
 *
 * Features:
 * - Trip selector with leg-level expansion
 * - OOOI auto-fetch on leg select
 * - Leg-scoped proof uploads
 * - Time source tracking (OOOI/actual/scheduled/manual)
 * - Manual override with audit logging
 * - Live calculation with results card
 * - Save as Log Event draft
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, Stack } from "expo-router";
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  Save,
  Info,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Plane,
  FileText,
  Camera,
  Image as ImageIcon,
  Trash2,
  Paperclip,
  Radio,
  Upload,
  Edit3,
  Database,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";

import { api, uploadImageBase64 } from "@/lib/api";
import { useProfile, useHourlyRateCents } from "@/lib/state/profile-store";
import {
  useTrips,
  useTrip,
  type BackendTrip,
  type BackendTripDutyDay,
  type BackendTripDutyLeg,
} from "@/lib/useTripsData";
import { cn } from "@/lib/cn";

// ============================================
// TYPES & CONSTANTS
// ============================================

type PremiumCode = "LP1" | "LP2" | "RJA" | null;
type TripType = "domestic" | "international";
type DelayReason = "WX" | "MX" | "OTHER";
type BasisType = "auto" | "leg" | "duty_rig" | "trip_rig" | "manual";
type TimeSource = "OOOI" | "actual" | "scheduled" | "manual";

interface CodeDefinition {
  code: PremiumCode;
  name: string;
  multiplier: number;
  contractRef: string;
  description: string;
}

const CODE_DEFINITIONS: Record<string, CodeDefinition> = {
  LP1: {
    code: "LP1",
    name: "Late Arrival Pay 1",
    multiplier: 1.5,
    contractRef: "13.E.4.e.(1),(2)",
    description: "Delay > 4 hours from scheduled trip end",
  },
  LP2: {
    code: "LP2",
    name: "Late Arrival Pay 2",
    multiplier: 2.5,
    contractRef: "13.E.5.c",
    description: "Delay > 25h domestic / > 50h international",
  },
  RJA: {
    code: "RJA",
    name: "Rest Infringement Pay",
    multiplier: 1.5,
    contractRef: "13.B.6.c.(2)(a)",
    description: "Arrival > 2 hours into calendar day off",
  },
};

interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  legId?: string;
}

interface OOOITimes {
  out: string | null;
  off: string | null;
  on: string | null;
  in: string | null;
  source: TimeSource;
  confidence?: number;
}

interface SelectedLeg {
  leg: BackendTripDutyLeg;
  dutyDay: BackendTripDutyDay;
  oooi: OOOITimes | null;
  hasOOOI: boolean;
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

function formatMinutesAsTime(minutes: number): string {
  const hrs = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  return `${sign}${hrs}:${mins.toString().padStart(2, "0")}`;
}

function formatDateTimeLocal(isoString: string | null | Date): string {
  if (!isoString) return "Not set";
  const date = typeof isoString === "string" ? new Date(isoString) : isoString;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeOnly(isoString: string | null): string {
  if (!isoString) return "--:--";
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseTimeToMinutes(timeStr: string): number {
  const [hours, mins] = timeStr.split(":").map(Number);
  return (hours || 0) * 60 + (mins || 0);
}

function minutesToTimeStr(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

// Check if leg has complete OOOI times
function legHasOOOI(leg: BackendTripDutyLeg): boolean {
  return !!(leg.actualOutISO && leg.actualInISO);
}

// Extract OOOI times from leg
function extractOOOI(leg: BackendTripDutyLeg): OOOITimes | null {
  if (!leg.actualOutISO && !leg.actualInISO) return null;
  return {
    out: leg.actualOutISO,
    off: leg.actualOffISO,
    on: leg.actualOnISO,
    in: leg.actualInISO,
    source: leg.actualOutISO && leg.actualInISO ? "OOOI" : "actual",
  };
}

// ============================================
// SEGMENTED CONTROL COMPONENT
// ============================================

function SegmentedControl<T extends string>({
  options,
  selected,
  onSelect,
  labels,
}: {
  options: T[];
  selected: T;
  onSelect: (val: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <View className="flex-row bg-slate-800/60 rounded-xl p-1">
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(opt);
          }}
          className={cn(
            "flex-1 py-2 px-3 rounded-lg items-center justify-center",
            selected === opt ? "bg-slate-700" : ""
          )}
        >
          <Text
            className={cn(
              "text-sm font-medium",
              selected === opt ? "text-white" : "text-slate-400"
            )}
          >
            {labels[opt]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ============================================
// TOGGLE COMPONENT
// ============================================

function Toggle({
  label,
  value,
  onToggle,
  description,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  description?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      className="flex-row items-center justify-between py-3 active:opacity-80"
    >
      <View className="flex-1 mr-4">
        <Text className="text-white font-medium">{label}</Text>
        {description && (
          <Text className="text-slate-400 text-xs mt-0.5">{description}</Text>
        )}
      </View>
      <View
        className={cn(
          "w-12 h-7 rounded-full justify-center",
          value ? "bg-green-500" : "bg-slate-600"
        )}
      >
        <View
          className={cn(
            "w-5 h-5 rounded-full bg-white mx-1",
            value ? "ml-6" : ""
          )}
        />
      </View>
    </Pressable>
  );
}

// ============================================
// TIME INPUT COMPONENT
// ============================================

function TimeInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  timeSource,
  onOverride,
}: {
  label: string;
  value: Date | null;
  onChange: (val: Date) => void;
  placeholder?: string;
  required?: boolean;
  timeSource?: TimeSource;
  onOverride?: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const dateValue = value ?? new Date();

  const sourceColors: Record<TimeSource, string> = {
    OOOI: "bg-green-500/20 border-green-500/50",
    actual: "bg-blue-500/20 border-blue-500/50",
    scheduled: "bg-amber-500/20 border-amber-500/50",
    manual: "bg-purple-500/20 border-purple-500/50",
  };

  const sourceTextColors: Record<TimeSource, string> = {
    OOOI: "text-green-400",
    actual: "text-blue-400",
    scheduled: "text-amber-400",
    manual: "text-purple-400",
  };

  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Text className="text-slate-400 text-sm">{label}</Text>
          {required && <Text className="text-red-400 ml-1">*</Text>}
        </View>
        {timeSource && (
          <View className={cn("px-2 py-0.5 rounded-full border", sourceColors[timeSource])}>
            <Text className={cn("text-xs font-medium", sourceTextColors[timeSource])}>
              {timeSource}
            </Text>
          </View>
        )}
      </View>
      <Pressable
        onPress={() => setShowPicker(true)}
        className="bg-slate-700/50 rounded-xl px-4 py-3 border border-slate-600 flex-row items-center justify-between"
      >
        <Text className={value ? "text-white" : "text-slate-500"}>
          {value ? formatDateTimeLocal(value) : placeholder ?? "Tap to select"}
        </Text>
        {onOverride && value && (
          <Pressable onPress={onOverride} className="p-1">
            <Edit3 size={16} color="#a78bfa" />
          </Pressable>
        )}
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={dateValue}
          mode="datetime"
          display="spinner"
          onChange={(_, selectedDate) => {
            setShowPicker(false);
            if (selectedDate) {
              onChange(selectedDate);
            }
          }}
        />
      )}
    </View>
  );
}

// ============================================
// OOOI BADGE COMPONENT
// ============================================

function OOOIBadge({ hasOOOI }: { hasOOOI: boolean }) {
  return (
    <View
      className={cn(
        "px-2 py-0.5 rounded-full border flex-row items-center",
        hasOOOI
          ? "bg-green-500/20 border-green-500/50"
          : "bg-slate-700/50 border-slate-600"
      )}
    >
      {hasOOOI ? (
        <Database size={10} color="#22c55e" />
      ) : (
        <XCircle size={10} color="#64748b" />
      )}
      <Text
        className={cn(
          "text-xs font-medium ml-1",
          hasOOOI ? "text-green-400" : "text-slate-500"
        )}
      >
        {hasOOOI ? "OOOI" : "No OOOI"}
      </Text>
    </View>
  );
}

// ============================================
// LEG ITEM COMPONENT
// ============================================

function LegItem({
  leg,
  isSelected,
  onSelect,
}: {
  leg: BackendTripDutyLeg;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasOOOI = legHasOOOI(leg);
  const route = `${leg.origin || "???"} → ${leg.destination || "???"}`;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect();
      }}
      className={cn(
        "p-3 rounded-xl border mb-2 active:opacity-80",
        isSelected
          ? "bg-blue-500/20 border-blue-500/50"
          : "bg-slate-800/40 border-slate-700/50"
      )}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View
            className={cn(
              "w-5 h-5 rounded-full border-2 items-center justify-center mr-3",
              isSelected ? "border-blue-500 bg-blue-500" : "border-slate-500"
            )}
          >
            {isSelected && <CheckCircle size={12} color="#fff" />}
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-white font-semibold">
                {leg.flightNumber || "Flight"}
              </Text>
              <Text className="text-slate-400 text-sm ml-2">{route}</Text>
            </View>
            {hasOOOI && (
              <View className="flex-row items-center mt-1">
                <Text className="text-slate-500 text-xs">
                  OUT {formatTimeOnly(leg.actualOutISO)} • IN{" "}
                  {formatTimeOnly(leg.actualInISO)}
                </Text>
              </View>
            )}
          </View>
        </View>
        <OOOIBadge hasOOOI={hasOOOI} />
      </View>
    </Pressable>
  );
}

// ============================================
// TRIP SELECTOR WITH LEG EXPANSION
// ============================================

function TripSelectorWithLegs({
  visible,
  trips,
  selectedTrip,
  onSelectTrip,
  selectedLegId,
  onSelectLeg,
  onClose,
}: {
  visible: boolean;
  trips: BackendTrip[];
  selectedTrip: BackendTrip | null;
  onSelectTrip: (trip: BackendTrip) => void;
  selectedLegId: string | null;
  onSelectLeg: (leg: BackendTripDutyLeg, dutyDay: BackendTripDutyDay) => void;
  onClose: () => void;
}) {
  const [expandedTripId, setExpandedTripId] = useState<string | null>(
    selectedTrip?.id ?? null
  );

  // Auto-expand selected trip
  useEffect(() => {
    if (selectedTrip) {
      setExpandedTripId(selectedTrip.id);
    }
  }, [selectedTrip]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-slate-900 rounded-t-3xl max-h-[80%]">
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-800">
            <Text className="text-white text-lg font-semibold">
              Select Trip & Flight Leg
            </Text>
            <Pressable onPress={onClose}>
              <XCircle size={24} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView className="px-5 py-3">
            {trips.length === 0 ? (
              <Text className="text-slate-400 text-center py-8">
                No trips available
              </Text>
            ) : (
              trips.map((trip) => {
                const isExpanded = expandedTripId === trip.id;
                const legs = trip.tripDutyDays?.flatMap((dd) =>
                  dd.legs.map((leg) => ({ leg, dutyDay: dd }))
                ) ?? [];

                return (
                  <View key={trip.id} className="mb-3">
                    {/* Trip Header */}
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onSelectTrip(trip);
                        setExpandedTripId(isExpanded ? null : trip.id);
                      }}
                      className={cn(
                        "rounded-xl p-4 border active:opacity-80",
                        selectedTrip?.id === trip.id
                          ? "bg-blue-500/10 border-blue-500/50"
                          : "bg-slate-800/60 border-slate-700/50"
                      )}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center flex-1">
                          <Plane size={18} color="#f59e0b" />
                          <Text className="text-white font-semibold ml-2">
                            {trip.tripNumber || "Trip"}
                          </Text>
                          <Text className="text-slate-400 text-sm ml-2">
                            {trip.startDate}
                          </Text>
                        </View>
                        <View className="flex-row items-center">
                          {legs.length > 0 && (
                            <View className="bg-slate-700/50 rounded-full px-2 py-0.5 mr-2">
                              <Text className="text-slate-400 text-xs">
                                {legs.length} leg{legs.length !== 1 ? "s" : ""}
                              </Text>
                            </View>
                          )}
                          <ChevronDown
                            size={20}
                            color="#64748b"
                            style={{
                              transform: [{ rotate: isExpanded ? "180deg" : "0deg" }],
                            }}
                          />
                        </View>
                      </View>
                    </Pressable>

                    {/* Expanded Legs */}
                    {isExpanded && legs.length > 0 && (
                      <Animated.View
                        entering={FadeInDown.duration(200)}
                        className="mt-2 ml-4"
                      >
                        <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
                          Select Flight Leg
                        </Text>
                        {legs.map(({ leg, dutyDay }) => (
                          <LegItem
                            key={leg.id}
                            leg={leg}
                            isSelected={selectedLegId === leg.id}
                            onSelect={() => {
                              onSelectLeg(leg, dutyDay);
                              onClose();
                            }}
                          />
                        ))}
                      </Animated.View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
          <View className="h-8" />
        </View>
      </View>
    </Modal>
  );
}

// ============================================
// OOOI DISPLAY CARD
// ============================================

function OOOIDisplayCard({
  oooi,
  onUploadProof,
  onManualEntry,
  isUploading,
}: {
  oooi: OOOITimes | null;
  onUploadProof: () => void;
  onManualEntry: () => void;
  isUploading: boolean;
}) {
  if (!oooi) {
    return (
      <View className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/30">
        <View className="flex-row items-center mb-3">
          <AlertTriangle size={20} color="#f59e0b" />
          <Text className="text-amber-400 font-semibold ml-2">OOOI Missing</Text>
        </View>
        <Text className="text-slate-400 text-sm mb-4">
          No OOOI times found for this leg. Upload proof to extract times
          automatically.
        </Text>

        <View className="flex-row gap-3">
          <Pressable
            onPress={onUploadProof}
            disabled={isUploading}
            className="flex-1 bg-amber-500/20 border border-amber-500/50 rounded-xl py-3 flex-row items-center justify-center active:opacity-70"
          >
            {isUploading ? (
              <ActivityIndicator size="small" color="#f59e0b" />
            ) : (
              <>
                <Upload size={16} color="#f59e0b" />
                <Text className="text-amber-400 font-medium ml-2">
                  Upload Proof
                </Text>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={onManualEntry}
            className="flex-1 bg-slate-700/50 border border-slate-600 rounded-xl py-3 flex-row items-center justify-center active:opacity-70"
          >
            <Edit3 size={16} color="#94a3b8" />
            <Text className="text-slate-300 font-medium ml-2">Manual</Text>
          </Pressable>
        </View>

        <Text className="text-slate-500 text-xs mt-3 text-center">
          Tip: Upload your ACARS or Crew Access screenshot — we'll extract OUT /
          OFF / ON / IN automatically.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-green-500/10 rounded-2xl p-4 border border-green-500/30">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <Database size={20} color="#22c55e" />
          <Text className="text-green-400 font-semibold ml-2">OOOI Detected</Text>
        </View>
        <View
          className={cn(
            "px-2 py-0.5 rounded-full",
            oooi.source === "OOOI"
              ? "bg-green-500/20"
              : oooi.source === "manual"
              ? "bg-purple-500/20"
              : "bg-blue-500/20"
          )}
        >
          <Text
            className={cn(
              "text-xs font-medium",
              oooi.source === "OOOI"
                ? "text-green-400"
                : oooi.source === "manual"
                ? "text-purple-400"
                : "text-blue-400"
            )}
          >
            Source: {oooi.source}
          </Text>
        </View>
      </View>

      <View className="flex-row">
        <View className="flex-1 items-center py-2">
          <Text className="text-slate-500 text-xs uppercase">OUT</Text>
          <Text className="text-white text-lg font-mono font-bold mt-1">
            {formatTimeOnly(oooi.out)}
          </Text>
        </View>
        <View className="flex-1 items-center py-2 border-l border-slate-700">
          <Text className="text-slate-500 text-xs uppercase">OFF</Text>
          <Text className="text-white text-lg font-mono font-bold mt-1">
            {formatTimeOnly(oooi.off)}
          </Text>
        </View>
        <View className="flex-1 items-center py-2 border-l border-slate-700">
          <Text className="text-slate-500 text-xs uppercase">ON</Text>
          <Text className="text-white text-lg font-mono font-bold mt-1">
            {formatTimeOnly(oooi.on)}
          </Text>
        </View>
        <View className="flex-1 items-center py-2 border-l border-slate-700">
          <Text className="text-slate-500 text-xs uppercase">IN</Text>
          <Text className="text-white text-lg font-mono font-bold mt-1">
            {formatTimeOnly(oooi.in)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ============================================
// RESULTS CARD
// ============================================

interface CalculationResult {
  recommendedCode: PremiumCode;
  reason: string;
  multiplier: number;
  hoursLate: number;
  intoDayOff: number | null;
  basisHoursMinutes: number;
  estimatedPremiumCents: number;
  contractRef: string;
  confidence: "exact" | "needs_basis" | "not_eligible";
  timeSourceUsed: TimeSource;
}

function ResultsCard({
  result,
  hourlyRateCents,
}: {
  result: CalculationResult | null;
  hourlyRateCents: number;
}) {
  if (!result) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700/50">
        <View className="flex-row items-center justify-center py-4">
          <Clock size={24} color="#64748b" />
          <Text className="text-slate-400 ml-3">
            Select a flight leg to calculate LP eligibility
          </Text>
        </View>
      </View>
    );
  }

  if (result.confidence === "not_eligible" || !result.recommendedCode) {
    return (
      <View className="bg-red-500/10 rounded-2xl p-5 border border-red-500/30">
        <View className="flex-row items-center mb-3">
          <XCircle size={24} color="#ef4444" />
          <Text className="text-red-400 font-semibold text-lg ml-2">
            Not Eligible
          </Text>
        </View>
        <Text className="text-slate-300">{result.reason}</Text>
        <Text className="text-slate-500 text-sm mt-2">
          Hours Late: {formatMinutesAsTime(result.hoursLate * 60)}
        </Text>
      </View>
    );
  }

  const codeDef = CODE_DEFINITIONS[result.recommendedCode];
  const isExact = result.confidence === "exact";

  return (
    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Header with code */}
      <LinearGradient
        colors={
          result.recommendedCode === "LP2"
            ? ["#854d0e", "#713f12"]
            : ["#065f46", "#064e3b"]
        }
        style={{ padding: 16 }}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <View className="flex-row items-center">
              <Text className="text-white text-2xl font-bold">
                {result.recommendedCode}
              </Text>
              <View className="bg-white/20 rounded-full px-2 py-1 ml-2">
                <Text className="text-white text-xs font-medium">
                  {result.multiplier * 100}%
                </Text>
              </View>
            </View>
            <Text className="text-white/80 text-sm mt-1">{codeDef.name}</Text>
          </View>
          <View className="items-end">
            <Text className="text-white/60 text-xs uppercase">Est. Premium</Text>
            <Text className="text-white text-2xl font-bold">
              {formatCurrency(result.estimatedPremiumCents)}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Details */}
      <View className="p-4">
        {/* Why this code */}
        <View className="bg-slate-700/30 rounded-xl p-3 mb-4">
          <View className="flex-row items-start">
            <Info size={16} color="#f59e0b" className="mt-0.5" />
            <Text className="text-amber-400 text-sm ml-2 flex-1">
              {result.reason}
            </Text>
          </View>
        </View>

        {/* Stats grid */}
        <View className="flex-row mb-3">
          <View className="flex-1 bg-slate-700/30 rounded-xl p-3 mr-2">
            <Text className="text-slate-400 text-xs uppercase">Hours Late</Text>
            <Text className="text-white text-lg font-bold mt-1">
              {formatMinutesAsTime(result.hoursLate * 60)}
            </Text>
          </View>
          {result.intoDayOff !== null && (
            <View className="flex-1 bg-slate-700/30 rounded-xl p-3 ml-2">
              <Text className="text-slate-400 text-xs uppercase">
                Into Day Off
              </Text>
              <Text className="text-white text-lg font-bold mt-1">
                {formatMinutesAsTime(result.intoDayOff * 60)}
              </Text>
            </View>
          )}
        </View>

        {/* Basis Hours */}
        <View className="flex-row items-center justify-between py-2 border-b border-slate-700/50">
          <Text className="text-slate-400">Basis Hours</Text>
          <Text className="text-white font-medium">
            {formatMinutesAsTime(result.basisHoursMinutes)}
          </Text>
        </View>

        {/* Calculation breakdown */}
        <View className="flex-row items-center justify-between py-2 border-b border-slate-700/50">
          <Text className="text-slate-400">Hourly Rate</Text>
          <Text className="text-white font-medium">
            {formatCurrency(hourlyRateCents)}/hr
          </Text>
        </View>

        {/* Time Source */}
        <View className="flex-row items-center justify-between py-2 border-b border-slate-700/50">
          <Text className="text-slate-400">Time Source</Text>
          <View
            className={cn(
              "px-2 py-0.5 rounded-full",
              result.timeSourceUsed === "OOOI"
                ? "bg-green-500/20"
                : result.timeSourceUsed === "manual"
                ? "bg-purple-500/20"
                : "bg-amber-500/20"
            )}
          >
            <Text
              className={cn(
                "text-xs font-medium",
                result.timeSourceUsed === "OOOI"
                  ? "text-green-400"
                  : result.timeSourceUsed === "manual"
                  ? "text-purple-400"
                  : "text-amber-400"
              )}
            >
              {result.timeSourceUsed}
            </Text>
          </View>
        </View>

        {/* Contract Reference */}
        <View className="flex-row items-center justify-between py-2">
          <Text className="text-slate-400">Contract Ref</Text>
          <Text className="text-slate-300 text-sm">{result.contractRef}</Text>
        </View>

        {/* Confidence badge */}
        <View className="mt-3">
          <View
            className={cn(
              "rounded-xl p-3 flex-row items-center",
              isExact
                ? "bg-green-500/20 border border-green-500/50"
                : "bg-amber-500/20 border border-amber-500/50"
            )}
          >
            {isExact ? (
              <CheckCircle size={16} color="#22c55e" />
            ) : (
              <AlertTriangle size={16} color="#f59e0b" />
            )}
            <Text
              className={cn(
                "text-sm ml-2",
                isExact ? "text-green-400" : "text-amber-400"
              )}
            >
              {isExact ? "Exact calculation" : "Needs basis hours for $ estimate"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ============================================
// PROOF ATTACHMENTS (LEG-SCOPED)
// ============================================

function ProofAttachments({
  attachments,
  selectedLegId,
  onAdd,
  onRemove,
  isUploading,
}: {
  attachments: Attachment[];
  selectedLegId: string | null;
  onAdd: (type: "camera" | "gallery") => void;
  onRemove: (id: string) => void;
  isUploading: boolean;
}) {
  // Filter to show only attachments for selected leg
  const legAttachments = selectedLegId
    ? attachments.filter((a) => a.legId === selectedLegId)
    : attachments;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-white font-semibold">Proof Attachments</Text>
        <Text className="text-slate-400 text-sm">
          {legAttachments.length} file(s)
        </Text>
      </View>

      {selectedLegId && (
        <View className="bg-slate-700/30 rounded-lg px-3 py-2 mb-3 flex-row items-center">
          <Info size={14} color="#64748b" />
          <Text className="text-slate-400 text-xs ml-2">
            Uploads are tied to the selected leg for audit trail
          </Text>
        </View>
      )}

      {legAttachments.length > 0 && (
        <View className="mb-3">
          {legAttachments.map((att) => (
            <View
              key={att.id}
              className="flex-row items-center bg-slate-700/50 rounded-lg p-3 mb-2"
            >
              <Paperclip size={16} color="#94a3b8" />
              <Text className="text-white flex-1 ml-2" numberOfLines={1}>
                {att.fileName}
              </Text>
              <Pressable onPress={() => onRemove(att.id)} className="p-1">
                <Trash2 size={16} color="#ef4444" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View className="flex-row gap-3">
        <Pressable
          onPress={() => onAdd("camera")}
          disabled={isUploading}
          className="flex-1 bg-slate-700/50 rounded-xl py-3 flex-row items-center justify-center active:opacity-70"
        >
          <Camera size={18} color="#94a3b8" />
          <Text className="text-slate-300 ml-2">Camera</Text>
        </Pressable>
        <Pressable
          onPress={() => onAdd("gallery")}
          disabled={isUploading}
          className="flex-1 bg-slate-700/50 rounded-xl py-3 flex-row items-center justify-center active:opacity-70"
        >
          <ImageIcon size={18} color="#94a3b8" />
          <Text className="text-slate-300 ml-2">Gallery</Text>
        </Pressable>
      </View>

      {isUploading && (
        <View className="flex-row items-center justify-center mt-3">
          <ActivityIndicator size="small" color="#f59e0b" />
          <Text className="text-amber-400 text-sm ml-2">Uploading...</Text>
        </View>
      )}
    </View>
  );
}

// ============================================
// MANUAL OOOI ENTRY MODAL
// ============================================

function ManualOOOIModal({
  visible,
  onClose,
  onSave,
  initialOOOI,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (oooi: OOOITimes, overrideReason: string) => void;
  initialOOOI: OOOITimes | null;
}) {
  const [outTime, setOutTime] = useState<Date | null>(
    initialOOOI?.out ? new Date(initialOOOI.out) : null
  );
  const [offTime, setOffTime] = useState<Date | null>(
    initialOOOI?.off ? new Date(initialOOOI.off) : null
  );
  const [onTime, setOnTime] = useState<Date | null>(
    initialOOOI?.on ? new Date(initialOOOI.on) : null
  );
  const [inTime, setInTime] = useState<Date | null>(
    initialOOOI?.in ? new Date(initialOOOI.in) : null
  );
  const [overrideReason, setOverrideReason] = useState("");

  const handleSave = () => {
    const oooi: OOOITimes = {
      out: outTime?.toISOString() ?? null,
      off: offTime?.toISOString() ?? null,
      on: onTime?.toISOString() ?? null,
      in: inTime?.toISOString() ?? null,
      source: "manual",
    };
    onSave(oooi, overrideReason);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/60 justify-end">
        <View className="bg-slate-900 rounded-t-3xl">
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-800">
            <Text className="text-white text-lg font-semibold">
              Manual OOOI Entry
            </Text>
            <Pressable onPress={onClose}>
              <XCircle size={24} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView className="px-5 py-4">
            {initialOOOI && (
              <View className="bg-amber-500/10 rounded-xl p-3 mb-4 border border-amber-500/30">
                <View className="flex-row items-center">
                  <AlertTriangle size={16} color="#f59e0b" />
                  <Text className="text-amber-400 text-sm ml-2">
                    Overriding existing OOOI data
                  </Text>
                </View>
              </View>
            )}

            <TimeInput
              label="OUT Time"
              value={outTime}
              onChange={setOutTime}
              placeholder="Wheels release / push"
            />
            <TimeInput
              label="OFF Time"
              value={offTime}
              onChange={setOffTime}
              placeholder="Takeoff"
            />
            <TimeInput
              label="ON Time"
              value={onTime}
              onChange={setOnTime}
              placeholder="Touchdown"
            />
            <TimeInput
              label="IN Time"
              value={inTime}
              onChange={setInTime}
              placeholder="Blocks in"
            />

            <View className="mt-4">
              <Text className="text-slate-400 text-sm mb-2">
                Override Reason {initialOOOI && <Text className="text-red-400">*</Text>}
              </Text>
              <TextInput
                value={overrideReason}
                onChangeText={setOverrideReason}
                placeholder="Why are you entering times manually?"
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={2}
                className="bg-slate-700/50 rounded-xl px-4 py-3 text-white border border-slate-600"
                style={{ minHeight: 60, textAlignVertical: "top" }}
              />
            </View>
          </ScrollView>

          <View className="px-5 py-4 border-t border-slate-800">
            <Pressable
              onPress={handleSave}
              disabled={initialOOOI && !overrideReason}
              className={cn(
                "rounded-xl py-4 items-center",
                initialOOOI && !overrideReason
                  ? "bg-slate-700"
                  : "bg-blue-500 active:bg-blue-600"
              )}
            >
              <Text
                className={cn(
                  "font-bold text-lg",
                  initialOOOI && !overrideReason ? "text-slate-500" : "text-white"
                )}
              >
                Save OOOI Times
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function LateArrivalPayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string; legId?: string }>();
  const queryClient = useQueryClient();

  const profile = useProfile();
  const hourlyRateCents = useHourlyRateCents() || 32500;

  // Fetch trips for selector
  const { data: tripsData } = useTrips();
  const trips = tripsData?.trips ?? [];

  // Selected trip and leg
  const [selectedTripId, setSelectedTripId] = useState<string | null>(
    params.tripId ?? null
  );
  const { data: tripData } = useTrip(selectedTripId);
  const selectedTrip = tripData?.trip ?? null;

  const [selectedLeg, setSelectedLeg] = useState<SelectedLeg | null>(null);

  // UI state
  const [showTripSelector, setShowTripSelector] = useState(false);
  const [showManualOOOI, setShowManualOOOI] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Form state - Code selection
  const [autoSelect, setAutoSelect] = useState(true);
  const [manualCode, setManualCode] = useState<PremiumCode>("LP1");

  // Form state - Trip details
  const [tripType, setTripType] = useState<TripType>("domestic");
  const [delayReason, setDelayReason] = useState<DelayReason>("OTHER");
  const [isEdw, setIsEdw] = useState(false);

  // Form state - Times (auto-filled from OOOI or manual)
  const [scheduledTripEnd, setScheduledTripEnd] = useState<Date | null>(null);
  const [dayOffStart, setDayOffStart] = useState<Date | null>(null);
  const [actualTripEnd, setActualTripEnd] = useState<Date | null>(null);
  const [timeSource, setTimeSource] = useState<TimeSource>("scheduled");

  // OOOI state
  const [currentOOOI, setCurrentOOOI] = useState<OOOITimes | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Pay inputs
  const [basisType, setBasisType] = useState<BasisType>("auto");
  const [manualBasisMinutes, setManualBasisMinutes] = useState("");

  // Attachments (leg-scoped)
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Notes
  const [pilotNotes, setPilotNotes] = useState("");

  // Handle leg selection - auto-fetch OOOI
  const handleSelectLeg = useCallback(
    (leg: BackendTripDutyLeg, dutyDay: BackendTripDutyDay) => {
      const hasOOOI = legHasOOOI(leg);
      const oooi = extractOOOI(leg);

      setSelectedLeg({ leg, dutyDay, oooi, hasOOOI });
      setCurrentOOOI(oooi);

      // Auto-fill times from OOOI if available
      if (oooi?.in) {
        setActualTripEnd(new Date(oooi.in));
        setTimeSource("OOOI");
      } else if (leg.scheduledInISO) {
        setActualTripEnd(new Date(leg.scheduledInISO));
        setTimeSource("scheduled");
      }

      // Set scheduled end from duty day release time
      if (dutyDay.releaseTimeISO) {
        setScheduledTripEnd(new Date(dutyDay.releaseTimeISO));
      } else if (leg.scheduledInISO) {
        setScheduledTripEnd(new Date(leg.scheduledInISO));
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    []
  );

  // Handle trip selection
  const handleSelectTrip = useCallback((trip: BackendTrip) => {
    setSelectedTripId(trip.id);

    // Determine trip type from routes
    const legs = trip.tripDutyDays?.flatMap((dd) => dd.legs) ?? [];
    const hasIntlRoute = legs.some(
      (leg) =>
        leg.origin?.length === 4 ||
        leg.destination?.length === 4 ||
        (leg.origin && !leg.origin.startsWith("K")) ||
        (leg.destination && !leg.destination.startsWith("K"))
    );
    if (hasIntlRoute) {
      setTripType("international");
    } else {
      setTripType("domestic");
    }
  }, []);

  // Handle manual OOOI save
  const handleSaveManualOOOI = useCallback(
    (oooi: OOOITimes, reason: string) => {
      setCurrentOOOI(oooi);
      setOverrideReason(reason);
      setTimeSource("manual");

      if (oooi.in) {
        setActualTripEnd(new Date(oooi.in));
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    []
  );

  // Handle proof upload
  const handleAddProof = useCallback(
    async (type: "camera" | "gallery") => {
      try {
        let result;
        if (type === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            return;
          }
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            base64: true,
          });
        } else {
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            base64: true,
          });
        }

        if (result.canceled || !result.assets[0].base64) return;

        setIsUploading(true);
        const asset = result.assets[0];
        const base64Data = asset.base64 as string;
        const uploadResult = await uploadImageBase64(
          base64Data,
          asset.mimeType ?? "image/jpeg"
        );

        setAttachments((prev) => [
          ...prev,
          {
            id: `proof-${Date.now()}`,
            fileName: uploadResult.filename,
            fileUrl: uploadResult.url,
            mimeType: asset.mimeType ?? "image/jpeg",
            legId: selectedLeg?.leg.id,
          },
        ]);

        // TODO: Trigger OCR extraction for OOOI times from uploaded image
      } catch (error) {
        console.error("Upload error:", error);
      } finally {
        setIsUploading(false);
      }
    },
    [selectedLeg]
  );

  // Handle proof removal
  const handleRemoveProof = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Calculate basis from trip
  const tripBasisMinutes = useMemo(() => {
    if (!selectedTrip?.tripDutyDays) return 0;
    return selectedTrip.tripDutyDays.reduce(
      (sum, dd) => sum + (dd.creditMinutes || 0),
      0
    );
  }, [selectedTrip]);

  // Calculate result
  const calculationResult = useMemo((): CalculationResult | null => {
    if (!scheduledTripEnd || !actualTripEnd) {
      return null;
    }

    // Calculate late minutes from scheduled trip end
    const lateMinutes =
      (actualTripEnd.getTime() - scheduledTripEnd.getTime()) / (1000 * 60);
    const lateHours = lateMinutes / 60;

    // Calculate into day off (if day off start provided)
    let intoDayOffMinutes: number | null = null;
    let intoDayOffHours: number | null = null;
    if (dayOffStart) {
      intoDayOffMinutes =
        (actualTripEnd.getTime() - dayOffStart.getTime()) / (1000 * 60);
      intoDayOffHours = intoDayOffMinutes / 60;
    }

    // Determine code eligibility
    let recommendedCode: PremiumCode = null;
    let reason = "";

    // Check RJA first (highest priority if triggered)
    if (intoDayOffHours !== null && intoDayOffHours > 2) {
      recommendedCode = "RJA";
      reason = `Arrival ${intoDayOffHours.toFixed(1)}h into calendar day off (> 2h threshold)`;
    }
    // Check LP2 (domestic > 25h, intl > 50h)
    else if (tripType === "domestic" && lateHours > 25) {
      recommendedCode = "LP2";
      reason = `Domestic delay of ${lateHours.toFixed(1)}h (> 25h threshold)`;
    } else if (tripType === "international" && lateHours > 50) {
      recommendedCode = "LP2";
      reason = `International delay of ${lateHours.toFixed(1)}h (> 50h threshold)`;
    }
    // Check LP1 (> 4h late)
    else if (lateHours > 4) {
      recommendedCode = "LP1";
      reason = `Delay of ${lateHours.toFixed(1)}h from scheduled trip end (> 4h threshold)`;
    } else {
      // Not eligible
      return {
        recommendedCode: null,
        reason: `Delay of ${lateHours.toFixed(1)}h does not meet minimum 4h threshold for LP1`,
        multiplier: 1,
        hoursLate: lateHours,
        intoDayOff: intoDayOffHours,
        basisHoursMinutes: 0,
        estimatedPremiumCents: 0,
        contractRef: "",
        confidence: "not_eligible",
        timeSourceUsed: timeSource,
      };
    }

    // If manual code selected, use that instead
    const finalCode = autoSelect ? recommendedCode : manualCode;
    if (!finalCode) {
      return {
        recommendedCode: null,
        reason: "Please select a premium code",
        multiplier: 1,
        hoursLate: lateHours,
        intoDayOff: intoDayOffHours,
        basisHoursMinutes: 0,
        estimatedPremiumCents: 0,
        contractRef: "",
        confidence: "not_eligible",
        timeSourceUsed: timeSource,
      };
    }

    const codeDef = CODE_DEFINITIONS[finalCode];

    // Calculate basis hours
    let basisMinutes = 0;
    if (basisType === "manual" && manualBasisMinutes) {
      basisMinutes = parseTimeToMinutes(manualBasisMinutes);
    } else {
      basisMinutes = tripBasisMinutes;
    }

    // Calculate premium pay
    const basisHours = basisMinutes / 60;
    const premiumCents = Math.round(
      basisHours * codeDef.multiplier * hourlyRateCents
    );

    const confidence: "exact" | "needs_basis" =
      basisMinutes > 0 ? "exact" : "needs_basis";

    return {
      recommendedCode: finalCode,
      reason: autoSelect ? reason : `Manual selection: ${codeDef.name}`,
      multiplier: codeDef.multiplier,
      hoursLate: lateHours,
      intoDayOff: intoDayOffHours,
      basisHoursMinutes: basisMinutes,
      estimatedPremiumCents: premiumCents,
      contractRef: codeDef.contractRef,
      confidence,
      timeSourceUsed: timeSource,
    };
  }, [
    scheduledTripEnd,
    actualTripEnd,
    dayOffStart,
    tripType,
    autoSelect,
    manualCode,
    basisType,
    manualBasisMinutes,
    tripBasisMinutes,
    hourlyRateCents,
    timeSource,
  ]);

  // Save as Log Event mutation
  const createLogEventMutation = useMutation({
    mutationFn: async () => {
      if (!calculationResult || !calculationResult.recommendedCode) {
        throw new Error("No valid calculation");
      }

      const code = calculationResult.recommendedCode;
      const codeDef = CODE_DEFINITIONS[code];

      // Build notes with leg and OOOI info
      const notesLines = [
        `Trip ID: ${selectedTripId || "Manual Entry"}`,
        selectedLeg
          ? `Flight Leg: ${selectedLeg.leg.flightNumber} (${selectedLeg.leg.origin} → ${selectedLeg.leg.destination})`
          : null,
        `Trip Type: ${tripType === "domestic" ? "Domestic" : "International"}`,
        `Time Source: ${timeSource}`,
        currentOOOI
          ? `OOOI: OUT ${formatTimeOnly(currentOOOI.out)} / OFF ${formatTimeOnly(currentOOOI.off)} / ON ${formatTimeOnly(currentOOOI.on)} / IN ${formatTimeOnly(currentOOOI.in)}`
          : null,
        overrideReason ? `Override Reason: ${overrideReason}` : null,
        `Scheduled Trip End: ${scheduledTripEnd ? formatDateTimeLocal(scheduledTripEnd) : "N/A"}`,
        `Actual Trip End: ${actualTripEnd ? formatDateTimeLocal(actualTripEnd) : "N/A"}`,
        `Hours Late: ${formatMinutesAsTime(calculationResult.hoursLate * 60)}`,
        calculationResult.intoDayOff !== null
          ? `Into Day Off: ${formatMinutesAsTime(calculationResult.intoDayOff * 60)}`
          : null,
        `Basis Hours: ${formatMinutesAsTime(calculationResult.basisHoursMinutes)}`,
        `Hourly Rate: ${formatCurrency(hourlyRateCents)}`,
        `Estimated Premium: ${formatCurrency(calculationResult.estimatedPremiumCents)}`,
        `Delay Reason: ${delayReason}`,
        isEdw ? "EDW Duty: Yes" : null,
        `Contract Ref: ${codeDef.contractRef}`,
        pilotNotes ? `\nPilot Notes: ${pilotNotes}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      // Create pay event
      const eventData = {
        eventType: "PREMIUM_TRIGGER" as const,
        title: `${code} - Late Arrival Pay`,
        description: notesLines,
        eventDateISO: new Date().toISOString().split("T")[0],
        tripId: selectedTripId ?? undefined,
        newCreditMinutes: Math.round(
          calculationResult.basisHoursMinutes * calculationResult.multiplier
        ),
      };

      const response = (await api.post("/api/pay-events", eventData)) as {
        success: boolean;
        event?: { id: string };
      };

      // Attach proof documents
      if (attachments.length > 0 && response?.event?.id) {
        for (const att of attachments) {
          await api.post(`/api/pay-events/${response.event.id}/documents`, {
            docType: "screenshot",
            content: `Late Arrival Pay proof: ${att.fileName}${att.legId ? ` (Leg: ${att.legId})` : ""}`,
            attachmentUrl: att.fileUrl,
          });
        }
      }

      return response;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      router.back();
    },
    onError: (error) => {
      console.error("Failed to create log event:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  // Reset form
  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedTripId(params.tripId ?? null);
    setSelectedLeg(null);
    setAutoSelect(true);
    setManualCode("LP1");
    setTripType("domestic");
    setDelayReason("OTHER");
    setIsEdw(false);
    setScheduledTripEnd(null);
    setDayOffStart(null);
    setActualTripEnd(null);
    setTimeSource("scheduled");
    setCurrentOOOI(null);
    setOverrideReason("");
    setBasisType("auto");
    setManualBasisMinutes("");
    setAttachments([]);
    setPilotNotes("");
  }, [params.tripId]);

  const isSaving = createLogEventMutation.isPending;
  const canSave =
    calculationResult?.confidence !== "not_eligible" &&
    calculationResult?.recommendedCode &&
    scheduledTripEnd &&
    actualTripEnd;

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

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
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <Animated.View
              entering={FadeInDown.duration(400)}
              style={{ paddingTop: insets.top + 8 }}
              className="px-5"
            >
              <View className="flex-row items-center justify-between mb-4">
                <Pressable
                  onPress={() => router.back()}
                  className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center"
                >
                  <ChevronLeft size={24} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={handleReset}
                  className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center"
                >
                  <RotateCcw size={20} color="#94a3b8" />
                </Pressable>
              </View>

              <View className="flex-row items-center mb-2">
                <Clock size={24} color="#3b82f6" />
                <Text className="text-blue-400 text-base font-semibold ml-2">
                  UPS Premium Calculator
                </Text>
              </View>
              <Text className="text-white text-3xl font-bold">
                Late Arrival Pay
              </Text>
              <Text className="text-slate-400 mt-1">
                LP1 • LP2 • RJA — Select a flight leg to calculate
              </Text>
            </Animated.View>

            {/* Results Card */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(100)}
              className="mx-5 mt-5"
            >
              <ResultsCard
                result={calculationResult}
                hourlyRateCents={hourlyRateCents}
              />
            </Animated.View>

            {/* Trip & Leg Selector */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(150)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Trip & Flight Leg
              </Text>
              <Pressable
                onPress={() => setShowTripSelector(true)}
                className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 active:opacity-80"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <Plane size={20} color="#f59e0b" />
                    <View className="ml-3 flex-1">
                      <Text className="text-white font-medium">
                        {selectedTrip
                          ? selectedTrip.tripNumber || "Trip Selected"
                          : "Select Trip & Leg"}
                      </Text>
                      {selectedLeg && (
                        <View className="flex-row items-center mt-1">
                          <Text className="text-slate-400 text-sm">
                            {selectedLeg.leg.flightNumber} •{" "}
                            {selectedLeg.leg.origin} →{" "}
                            {selectedLeg.leg.destination}
                          </Text>
                          <View className="ml-2">
                            <OOOIBadge hasOOOI={selectedLeg.hasOOOI} />
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                  <ChevronRight size={20} color="#64748b" />
                </View>
              </Pressable>
            </Animated.View>

            {/* OOOI Display (when leg is selected) */}
            {selectedLeg && (
              <Animated.View
                entering={FadeInDown.duration(400).delay(200)}
                className="mx-5 mt-5"
              >
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  OOOI Times
                </Text>
                <OOOIDisplayCard
                  oooi={currentOOOI}
                  onUploadProof={() => handleAddProof("gallery")}
                  onManualEntry={() => setShowManualOOOI(true)}
                  isUploading={isUploading}
                />
              </Animated.View>
            )}

            {/* Code Selection */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(250)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Premium Code
              </Text>
              <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                <Toggle
                  label="Auto Select"
                  value={autoSelect}
                  onToggle={() => setAutoSelect(!autoSelect)}
                  description="Automatically choose LP1, LP2, or RJA based on times"
                />

                {!autoSelect && (
                  <View className="mt-3">
                    <SegmentedControl
                      options={["LP1", "LP2", "RJA"]}
                      selected={manualCode ?? "LP1"}
                      onSelect={(val) => setManualCode(val as PremiumCode)}
                      labels={{
                        LP1: "LP1 (150%)",
                        LP2: "LP2 (250%)",
                        RJA: "RJA (150%)",
                      }}
                    />
                  </View>
                )}
              </View>
            </Animated.View>

            {/* Trip Type & Options */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(300)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Trip Details
              </Text>
              <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                <Text className="text-slate-400 text-sm mb-2">Trip Type</Text>
                <SegmentedControl
                  options={["domestic", "international"] as TripType[]}
                  selected={tripType}
                  onSelect={setTripType}
                  labels={{
                    domestic: "Domestic",
                    international: "International",
                  }}
                />

                <View className="h-px bg-slate-700/50 my-4" />

                <Text className="text-slate-400 text-sm mb-2">Delay Reason</Text>
                <SegmentedControl
                  options={["WX", "MX", "OTHER"] as DelayReason[]}
                  selected={delayReason}
                  onSelect={setDelayReason}
                  labels={{
                    WX: "Weather",
                    MX: "Maintenance",
                    OTHER: "Other",
                  }}
                />

                <View className="h-px bg-slate-700/50 my-4" />

                <Toggle
                  label="EDW Duty"
                  value={isEdw}
                  onToggle={() => setIsEdw(!isEdw)}
                  description="Extended Duty Workday (stored in notes)"
                />
              </View>
            </Animated.View>

            {/* Required Times */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(350)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Required Times
              </Text>
              <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                <TimeInput
                  label="Scheduled Trip End Time"
                  value={scheduledTripEnd}
                  onChange={(d) => {
                    setScheduledTripEnd(d);
                    if (timeSource !== "manual") setTimeSource("scheduled");
                  }}
                  placeholder="When trip was scheduled to end"
                  required
                  timeSource="scheduled"
                />
                <TimeInput
                  label="Actual Trip End Time"
                  value={actualTripEnd}
                  onChange={(d) => {
                    setActualTripEnd(d);
                    setTimeSource("manual");
                  }}
                  placeholder="When trip actually ended"
                  required
                  timeSource={timeSource}
                  onOverride={() => setShowManualOOOI(true)}
                />

                {/* Day Off Start - only show for RJA or auto-select */}
                {(autoSelect || manualCode === "RJA") && (
                  <TimeInput
                    label="Day Off Start Time"
                    value={dayOffStart}
                    onChange={setDayOffStart}
                    placeholder="Start of your calendar day off (for RJA)"
                  />
                )}
              </View>
            </Animated.View>

            {/* Basis Hours */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(400)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Basis Hours
              </Text>
              <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                <SegmentedControl
                  options={["auto", "manual"] as BasisType[]}
                  selected={basisType}
                  onSelect={setBasisType}
                  labels={{
                    auto: "Auto (from trip)",
                    leg: "Leg Time",
                    duty_rig: "Duty Rig",
                    trip_rig: "Trip Rig",
                    manual: "Manual",
                  }}
                />

                {basisType === "auto" && tripBasisMinutes > 0 && (
                  <View className="mt-3 bg-slate-700/30 rounded-xl p-3 flex-row items-center justify-between">
                    <Text className="text-slate-400 text-sm">Trip Credit</Text>
                    <Text className="text-white font-medium">
                      {formatMinutesAsTime(tripBasisMinutes)}
                    </Text>
                  </View>
                )}

                {basisType === "manual" && (
                  <View className="mt-4">
                    <Text className="text-slate-400 text-sm mb-2">
                      Enter Basis Hours (HH:MM)
                    </Text>
                    <TextInput
                      value={manualBasisMinutes}
                      onChangeText={setManualBasisMinutes}
                      placeholder="e.g. 5:30"
                      placeholderTextColor="#64748b"
                      className="bg-slate-700/50 rounded-xl px-4 py-3 text-white border border-slate-600"
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                )}
              </View>
            </Animated.View>

            {/* Proof Attachments */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(450)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Documentation
              </Text>
              <ProofAttachments
                attachments={attachments}
                selectedLegId={selectedLeg?.leg.id ?? null}
                onAdd={handleAddProof}
                onRemove={handleRemoveProof}
                isUploading={isUploading}
              />
            </Animated.View>

            {/* Notes */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(500)}
              className="mx-5 mt-5"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Pilot Notes
              </Text>
              <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                <TextInput
                  value={pilotNotes}
                  onChangeText={setPilotNotes}
                  placeholder="Add notes about this delay..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={3}
                  className="text-white"
                  style={{ minHeight: 80, textAlignVertical: "top" }}
                />
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Save Button */}
        <View
          className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-5 py-4"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <Pressable
            onPress={() => createLogEventMutation.mutate()}
            disabled={!canSave || isSaving}
            className={cn(
              "rounded-xl py-4 flex-row items-center justify-center",
              canSave && !isSaving
                ? "bg-blue-500 active:bg-blue-600"
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
                    "font-bold text-lg ml-2",
                    canSave ? "text-white" : "text-slate-500"
                  )}
                >
                  Save Log Event
                </Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Trip Selector Modal */}
        <TripSelectorWithLegs
          visible={showTripSelector}
          trips={trips}
          selectedTrip={selectedTrip}
          onSelectTrip={handleSelectTrip}
          selectedLegId={selectedLeg?.leg.id ?? null}
          onSelectLeg={handleSelectLeg}
          onClose={() => setShowTripSelector(false)}
        />

        {/* Manual OOOI Entry Modal */}
        <ManualOOOIModal
          visible={showManualOOOI}
          onClose={() => setShowManualOOOI(false)}
          onSave={handleSaveManualOOOI}
          initialOOOI={currentOOOI}
        />
      </LinearGradient>
    </View>
  );
}
