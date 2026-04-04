/**
 * Contract Patterns Screen
 *
 * Phase 5: Displays detected patterns with safe, non-advisory language.
 * Pattern awareness is informational and optional.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  TrendingUp,
  FileText,
  Calendar,
  Check,
  AlertCircle,
  Info,
  ChevronRight,
  ClipboardList,
  CalendarDays,
  ArrowRight,
} from "lucide-react-native";
import { format, parseISO } from "date-fns";

import {
  useContractPatterns,
  useAcknowledgePattern,
  getPatternDescription,
} from "@/lib/useContracts";
import type { ContractPatternDetection, ContractTriggerPattern } from "@/lib/contracts";

// ============================================
// HELPERS
// ============================================

function getPatternIcon(patternType: ContractTriggerPattern) {
  switch (patternType) {
    case "RESERVE_EXTENSION":
      return Calendar;
    case "SCHEDULE_CHANGE":
      return TrendingUp;
    case "JUNIOR_ASSIGNMENT":
      return AlertCircle;
    default:
      return FileText;
  }
}

function getPatternColor(patternType: ContractTriggerPattern): {
  bg: string;
  text: string;
  border: string;
} {
  switch (patternType) {
    case "RESERVE_EXTENSION":
      return { bg: "bg-amber-500/20", text: "#f59e0b", border: "border-amber-500/30" };
    case "SCHEDULE_CHANGE":
      return { bg: "bg-blue-500/20", text: "#3b82f6", border: "border-blue-500/30" };
    case "JUNIOR_ASSIGNMENT":
      return { bg: "bg-purple-500/20", text: "#a855f7", border: "border-purple-500/30" };
    case "DUTY_EXTENSION":
      return { bg: "bg-orange-500/20", text: "#f97316", border: "border-orange-500/30" };
    case "CREDIT_PROTECTED_RESERVE":
      return { bg: "bg-green-500/20", text: "#22c55e", border: "border-green-500/30" };
    default:
      return { bg: "bg-slate-700/50", text: "#94a3b8", border: "border-slate-700/50" };
  }
}

function formatPatternType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================
// PATTERN CARD COMPONENT
// ============================================

interface PatternCardProps {
  pattern: ContractPatternDetection;
  onAcknowledge: () => void;
  onViewRelated: () => void;
  isAcknowledging: boolean;
}

function PatternCard({
  pattern,
  onAcknowledge,
  onViewRelated,
  isAcknowledging,
}: PatternCardProps) {
  const colors = getPatternColor(pattern.patternType as ContractTriggerPattern);
  const Icon = getPatternIcon(pattern.patternType as ContractTriggerPattern);

  return (
    <Animated.View
      entering={FadeInUp.duration(300)}
      className={`${colors.bg} rounded-2xl border ${colors.border} overflow-hidden`}
    >
      {/* Main content */}
      <View className="p-4">
        <View className="flex-row items-start">
          <View
            className={`w-12 h-12 rounded-xl ${colors.bg} items-center justify-center`}
            style={{ borderWidth: 1, borderColor: colors.text + "40" }}
          >
            <Icon size={24} color={colors.text} />
          </View>

          <View className="flex-1 ml-3">
            <Text className="text-white font-semibold text-lg">
              {formatPatternType(pattern.patternType)}
            </Text>

            {/* Pattern description (safe language) */}
            <Text className="text-slate-300 text-sm mt-1 leading-relaxed">
              {pattern.patternDescription ||
                getPatternDescription(
                  pattern.patternType,
                  pattern.occurrenceCount,
                  pattern.rollingWindowMonths
                )}
            </Text>

            {/* Date range */}
            <View className="flex-row items-center mt-2">
              <Calendar size={12} color="#64748b" />
              <Text className="text-slate-500 text-xs ml-1.5">
                {format(parseISO(pattern.firstOccurrence), "MMM d, yyyy")} -{" "}
                {format(parseISO(pattern.lastOccurrence), "MMM d, yyyy")}
              </Text>
            </View>
          </View>

          {/* Count badge */}
          <View
            className={`${colors.bg} rounded-full px-3 py-1.5`}
            style={{ borderWidth: 1, borderColor: colors.text + "40" }}
          >
            <Text style={{ color: colors.text }} className="font-bold text-lg">
              {pattern.occurrenceCount}
            </Text>
          </View>
        </View>
      </View>

      {/* Actions footer */}
      <View className="px-4 py-3 border-t border-slate-700/30 flex-row items-center">
        {pattern.isAcknowledged ? (
          <View className="flex-row items-center flex-1">
            <Check size={14} color="#22c55e" />
            <Text className="text-green-400 text-sm ml-1.5">
              Acknowledged{" "}
              {pattern.acknowledgedAt &&
                format(parseISO(pattern.acknowledgedAt), "MMM d")}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={onAcknowledge}
            disabled={isAcknowledging}
            className="flex-row items-center flex-1 active:opacity-70"
          >
            {isAcknowledging ? (
              <ActivityIndicator size="small" color="#f59e0b" />
            ) : (
              <>
                <Check size={14} color="#f59e0b" />
                <Text className="text-amber-500 text-sm font-medium ml-1.5">
                  Acknowledge
                </Text>
              </>
            )}
          </Pressable>
        )}

        <Pressable
          onPress={onViewRelated}
          className="flex-row items-center ml-4 active:opacity-70"
        >
          <Text className="text-slate-400 text-sm">View Related</Text>
          <ChevronRight size={16} color="#64748b" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState({ onLogPayEvent, onImportSchedule }: { onLogPayEvent: () => void; onImportSchedule: () => void }) {
  return (
    <View className="px-1">
      <View className="items-center py-8 px-4">
        <View className="w-20 h-20 rounded-full bg-amber-500/15 items-center justify-center mb-4"
          style={{ borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" }}>
          <TrendingUp size={36} color="#f59e0b" />
        </View>
        <Text className="text-white text-xl font-bold text-center">
          No Patterns Yet
        </Text>
        <Text className="text-slate-400 text-center mt-2 text-sm leading-relaxed">
          Patterns are detected from your logged pay events and imported schedules.
          Start building your history and patterns will surface automatically.
        </Text>
      </View>

      {/* What gets detected */}
      <View className="bg-slate-800/50 rounded-2xl p-4 mb-4 border border-slate-700/40">
        <Text className="text-slate-300 text-sm font-semibold mb-3 uppercase tracking-wider">
          Detected automatically from
        </Text>
        {[
          { icon: ClipboardList, color: "#a855f7", label: "Pay events you log", sub: "Junior assignments, reassignments, premium pay" },
          { icon: CalendarDays, color: "#3b82f6", label: "Schedule changes", sub: "Trips added, removed, or modified" },
          { icon: TrendingUp, color: "#f59e0b", label: "Recurring patterns", sub: "2+ similar events in a 12-month window" },
        ].map(({ icon: Icon, color, label, sub }) => (
          <View key={label} className="flex-row items-center mb-3 last:mb-0">
            <View className="w-9 h-9 rounded-xl items-center justify-center mr-3"
              style={{ backgroundColor: color + "22" }}>
              <Icon size={18} color={color} />
            </View>
            <View className="flex-1">
              <Text className="text-white text-sm font-medium">{label}</Text>
              <Text className="text-slate-500 text-xs mt-0.5">{sub}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTAs */}
      <Text className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-3 px-1">
        Get started
      </Text>
      <Pressable
        onPress={onLogPayEvent}
        className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-3 flex-row items-center active:opacity-75"
      >
        <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center mr-3">
          <ClipboardList size={20} color="#f59e0b" />
        </View>
        <View className="flex-1">
          <Text className="text-white font-semibold">Log a Pay Event</Text>
          <Text className="text-slate-400 text-sm">Record schedule changes, JAs, or premium pay</Text>
        </View>
        <ArrowRight size={18} color="#f59e0b" />
      </Pressable>

      <Pressable
        onPress={onImportSchedule}
        className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4 flex-row items-center active:opacity-75"
      >
        <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center mr-3">
          <CalendarDays size={20} color="#3b82f6" />
        </View>
        <View className="flex-1">
          <Text className="text-white font-semibold">Import Schedule</Text>
          <Text className="text-slate-400 text-sm">Sync your schedule to detect changes over time</Text>
        </View>
        <ArrowRight size={18} color="#3b82f6" />
      </Pressable>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ContractPatternsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useContractPatterns();
  const acknowledgeMutation = useAcknowledgePattern();

  const patterns = data?.patterns ?? [];

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleAcknowledge = useCallback(
    async (patternId: string) => {
      setAcknowledgingId(patternId);
      try {
        await acknowledgeMutation.mutateAsync(patternId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Error", "Failed to acknowledge pattern");
      } finally {
        setAcknowledgingId(null);
      }
    },
    [acknowledgeMutation]
  );

  const handleViewRelated = useCallback(
    (pattern: ContractPatternDetection) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Navigate to relevant contract search with pattern context
      router.push({
        pathname: "/search-contract",
        params: {
          query: formatPatternType(pattern.patternType).toLowerCase(),
        },
      });
    },
    [router]
  );

  return (
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
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
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <TrendingUp size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">
              Schedule Patterns
            </Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              Informational pattern awareness
            </Text>
          </Animated.View>

          {/* Info Banner */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-4"
          >
            <View className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <View className="flex-row items-start">
                <Info size={18} color="#3b82f6" />
                <Text className="text-blue-300 text-sm flex-1 ml-2 leading-relaxed">
                  Pattern detection is informational only. These patterns are
                  based on how you've recorded your schedules. No conclusions
                  or recommendations are made.
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Loading State */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading patterns...</Text>
            </View>
          )}

          {/* Empty State */}
          {!isLoading && patterns.length === 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <EmptyState
                onLogPayEvent={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/create-log-event");
                }}
                onImportSchedule={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/import-review");
                }}
              />
            </Animated.View>
          )}

          {/* Pattern Cards */}
          {!isLoading && patterns.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              {/* Summary */}
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                  {patterns.length} Pattern{patterns.length !== 1 ? "s" : ""} Detected
                </Text>
                <Text className="text-slate-500 text-xs">
                  Rolling 12-month window
                </Text>
              </View>

              {/* Pattern list */}
              <View className="gap-4">
                {patterns.map((pattern, index) => (
                  <Animated.View
                    key={pattern.id}
                    entering={FadeInUp.duration(300).delay(index * 50)}
                  >
                    <PatternCard
                      pattern={pattern}
                      onAcknowledge={() => handleAcknowledge(pattern.id)}
                      onViewRelated={() => handleViewRelated(pattern)}
                      isAcknowledging={acknowledgingId === pattern.id}
                    />
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Language Notice */}
          <Animated.View
            entering={FadeInUp.duration(600).delay(400)}
            className="mx-5 mt-6"
          >
            <View className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
              <Text className="text-slate-500 text-xs text-center leading-relaxed">
                This feature uses only informational language. Terms like
                "violation," "illegal," or "excessive" are never used. Pattern
                data is for your personal awareness only.
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
