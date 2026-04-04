/**
 * UPS Premium Code Library Screen (Phase 2)
 *
 * Reference-only library of UPS premium codes.
 * Reads from the PremiumCodes single source of truth (backend).
 *
 * Features:
 * - Search by code or keyword
 * - Filter by category (Reassignment, Reserve, Late Arrival, etc.)
 * - Toggle to show only fixed credit codes
 * - Most used codes quick access
 * - Deep link to detail page
 */

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  Book,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
  Clock,
  Percent,
  Edit3,
  X,
  Sparkles,
  Filter,
  Zap,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  usePremiumCodes,
  PREMIUM_FILTER_CHIPS,
  MOST_USED_CODES,
  getCategoryConfig,
  formatPremiumResult,
} from "@/lib/usePremiumCodes";
import { cn } from "@/lib/cn";
import type { PremiumCode, PremiumCodeCategory } from "@/lib/contracts";
import { ApplyPremiumSheet, type TripPremiumContext } from "@/components/trips/ApplyPremiumSheet";
import { useHourlyRateCents } from "@/lib/state/profile-store";
import { useTripPayBreakdown } from "@/lib/useTripPayEngine";

// ============================================
// PREMIUM TYPE BADGE
// ============================================

function PremiumTypeBadge({ type }: { type: string }) {
  if (type === "minutes") {
    return (
      <View className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg">
        <Clock size={10} color="#10b981" />
        <Text className="text-emerald-400 text-xs font-medium ml-1">Fixed</Text>
      </View>
    );
  }
  if (type === "multiplier") {
    return (
      <View className="flex-row items-center bg-blue-500/20 px-2 py-1 rounded-lg">
        <Percent size={10} color="#3b82f6" />
        <Text className="text-blue-400 text-xs font-medium ml-1">Multiplier</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center bg-amber-500/20 px-2 py-1 rounded-lg">
      <Edit3 size={10} color="#f59e0b" />
      <Text className="text-amber-400 text-xs font-medium ml-1">Manual</Text>
    </View>
  );
}

// ============================================
// FILTER CHIPS
// ============================================

interface FilterChipsProps {
  selected: PremiumCodeCategory | "ALL";
  onSelect: (category: PremiumCodeCategory | "ALL") => void;
}

function FilterChips({ selected, onSelect }: FilterChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {PREMIUM_FILTER_CHIPS.map((chip) => {
        const isSelected = selected === chip.category;
        return (
          <Pressable
            key={chip.category}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(chip.category);
            }}
            className={cn(
              "px-4 py-2 rounded-full border",
              isSelected
                ? "bg-amber-500 border-amber-500"
                : "bg-slate-800/60 border-slate-700/50"
            )}
          >
            <Text
              className={cn(
                "text-sm font-medium",
                isSelected ? "text-slate-900" : "text-slate-300"
              )}
            >
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ============================================
// MOST USED CODES
// ============================================

interface MostUsedCodesProps {
  codes: PremiumCode[];
  onSelect: (code: PremiumCode) => void;
}

function MostUsedCodes({ codes, onSelect }: MostUsedCodesProps) {
  if (codes.length === 0) return null;

  return (
    <View className="mb-4">
      <View className="flex-row items-center px-5 mb-2">
        <Sparkles size={14} color="#f59e0b" />
        <Text className="text-slate-400 text-xs font-medium ml-1.5">Most Used</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
        style={{ flexGrow: 0 }}
      >
        {codes.map((code) => (
          <Pressable
            key={code.code}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(code);
            }}
            className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2 active:bg-slate-700/80"
          >
            <View className="flex-row items-center">
              <View className="bg-amber-500/20 px-1.5 py-0.5 rounded mr-2">
                <Text className="text-amber-400 text-xs font-bold">{code.code}</Text>
              </View>
              <Text className="text-white text-sm font-medium">
                {formatPremiumResult(code)}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ============================================
// PREMIUM CODE CARD
// ============================================

interface PremiumCodeCardProps {
  code: PremiumCode;
  index: number;
  onPress: () => void;
  actionMode?: boolean;
}

function PremiumCodeCard({ code, index, onPress, actionMode }: PremiumCodeCardProps) {
  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);
  const premiumDisplay = formatPremiumResult(code);

  // Build subtitle parts
  const subtitleParts: string[] = [];
  if (code.eligibility) subtitleParts.push(code.eligibility);
  if (code.tripType) subtitleParts.push(code.tripType);
  if (code.contractRef) subtitleParts.push(code.contractRef);

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 30)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className={cn(
          "rounded-2xl p-4 border active:bg-slate-800/80",
          actionMode
            ? "bg-slate-800/60 border-purple-500/20"
            : "bg-slate-800/60 border-slate-700/50"
        )}
      >
        <View className="flex-row items-start">
          {/* Code Badge */}
          <View
            className={cn(
              "w-14 h-14 rounded-xl items-center justify-center mr-3",
              categoryConfig.bgColor
            )}
          >
            <Text
              className="text-base font-bold"
              style={{ color: categoryConfig.color }}
            >
              {code.code}
            </Text>
          </View>

          {/* Content */}
          <View className="flex-1">
            {/* Title */}
            <Text className="text-white text-base font-semibold" numberOfLines={1}>
              {code.title}
            </Text>

            {/* Subtitle */}
            {subtitleParts.length > 0 && (
              <Text className="text-slate-400 text-xs mt-0.5" numberOfLines={1}>
                {subtitleParts.join(" • ")}
              </Text>
            )}

            {/* Tags */}
            <View className="flex-row flex-wrap gap-2 mt-2">
              <PremiumTypeBadge type={code.premiumType} />
              {code.hasVariants && (
                <View className="bg-purple-500/20 px-2 py-1 rounded-lg">
                  <Text className="text-purple-400 text-xs">Has Variants</Text>
                </View>
              )}
              {code.contractRef && (
                <View className="bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Text className="text-slate-400 text-xs">{code.contractRef}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Premium Result / Action */}
          <View className="ml-2 items-end">
            <Text
              className={cn(
                "text-xl font-bold",
                code.premiumType === "minutes"
                  ? "text-emerald-400"
                  : code.premiumType === "multiplier"
                    ? "text-blue-400"
                    : "text-amber-400"
              )}
            >
              {premiumDisplay}
            </Text>
            {actionMode ? (
              <View className="flex-row items-center bg-purple-500/20 px-2 py-1 rounded-lg mt-1">
                <Zap size={10} color="#a855f7" />
                <Text className="text-purple-400 text-[10px] font-bold ml-0.5">Apply</Text>
              </View>
            ) : (
              <ChevronRight size={16} color="#64748b" />
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <View className="items-center py-12 px-6">
        <Search size={40} color="#64748b" />
        <Text className="text-white text-lg font-semibold mt-4">No Results</Text>
        <Text className="text-slate-400 text-center mt-2">
          Try another keyword or adjust your filters
        </Text>
      </View>
    );
  }

  return (
    <View className="items-center py-12 px-6">
      <Book size={40} color="#64748b" />
      <Text className="text-white text-lg font-semibold mt-4">No Premium Codes</Text>
      <Text className="text-slate-400 text-center mt-2">
        Unable to load premium codes. Please try again.
      </Text>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function PremiumCodeLibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hourlyRateCents = useHourlyRateCents();

  // Read trip context params (action mode when tripId is present)
  const params = useLocalSearchParams<{
    tripId?: string;
    tripNumber?: string;
    baseCreditMinutes?: string;
    basePayCents?: string;
    startDate?: string;
    endDate?: string;
    aircraftType?: string;
  }>();

  const actionMode = !!params.tripId;
  const tripContext: TripPremiumContext | null = actionMode
    ? {
        tripId: params.tripId!,
        tripNumber: params.tripNumber ?? null,
        baseCreditMinutes: parseInt(params.baseCreditMinutes ?? '0', 10),
        basePayCents: parseInt(params.basePayCents ?? '0', 10),
        startDate: params.startDate,
        endDate: params.endDate,
        aircraftType: params.aircraftType,
      }
    : null;

  // Fetch live pay breakdown if in action mode (to get accurate base credit)
  const { data: payBreakdown } = useTripPayBreakdown(actionMode ? params.tripId : null);

  // Build effective trip context with live data if available
  const effectiveTripContext: TripPremiumContext | null = tripContext
    ? {
        ...tripContext,
        baseCreditMinutes: payBreakdown?.baseCreditMinutes ?? tripContext.baseCreditMinutes,
        basePayCents: payBreakdown?.basePayCents ?? tripContext.basePayCents,
      }
    : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PremiumCodeCategory | "ALL">("ALL");
  const [fixedCreditOnly, setFixedCreditOnly] = useState(false);

  // Apply premium sheet state
  const [applySheetCode, setApplySheetCode] = useState<PremiumCode | null>(null);

  // Build filter options
  const filterOptions = useMemo(
    () => ({
      search: searchQuery || undefined,
      category: selectedCategory !== "ALL" ? selectedCategory : undefined,
      fixedCreditOnly: fixedCreditOnly || undefined,
    }),
    [searchQuery, selectedCategory, fixedCreditOnly]
  );

  const { data, isLoading } = usePremiumCodes(filterOptions);
  const codes = data?.codes ?? [];

  // Get most used codes (only when no filters applied)
  const mostUsedCodes = useMemo(() => {
    if (searchQuery || selectedCategory !== "ALL" || fixedCreditOnly) return [];
    return codes.filter((c) => MOST_USED_CODES.includes(c.code)).slice(0, 8);
  }, [codes, searchQuery, selectedCategory, fixedCreditOnly]);

  const handleCodePress = useCallback(
    (code: PremiumCode) => {
      if (actionMode) {
        // In action mode: show the Apply Premium sheet
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setApplySheetCode(code);
      } else {
        // In reference mode: navigate to detail
        router.push({
          pathname: "/premium-code-detail",
          params: { code: code.code },
        } as never);
      }
    },
    [router, actionMode]
  );

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {/* Apply Premium Sheet (action mode only) */}
      <ApplyPremiumSheet
        visible={!!applySheetCode && actionMode}
        premiumCode={applySheetCode}
        tripContext={effectiveTripContext}
        hourlyRateCents={hourlyRateCents}
        onClose={() => setApplySheetCode(null)}
        onApplied={() => {
          setApplySheetCode(null);
          router.back();
        }}
      />

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
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            {/* Back Button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }}
              className="flex-row items-center mb-4"
            >
              <ChevronLeft size={20} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-medium ml-1">
                {actionMode ? 'Back to Trip' : 'Tools'}
              </Text>
            </Pressable>

            <View className="flex-row items-center mb-2">
              {actionMode ? (
                <Zap size={24} color="#a855f7" />
              ) : (
                <FileText size={24} color="#f59e0b" />
              )}
              <Text
                className={cn(
                  "text-base font-semibold ml-2",
                  actionMode ? "text-purple-400" : "text-amber-500"
                )}
              >
                {actionMode
                  ? `Trip ${params.tripNumber || 'Context'}`
                  : 'UPS Contract'}
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">
              {actionMode ? 'Apply a Premium' : 'Premium Code Library'}
            </Text>
            <Text className="text-slate-400 text-base mt-1">
              {actionMode
                ? 'Tap a code to preview and apply to this trip'
                : `Single source of truth • ${codes.length} codes`}
            </Text>
          </Animated.View>

          {/* Action Mode Context Banner */}
          {actionMode && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(150)}
              className="mx-5 mt-4"
            >
              <View className="bg-purple-500/10 rounded-xl p-3 border border-purple-500/25 flex-row items-center">
                <Zap size={16} color="#a855f7" />
                <View className="ml-2 flex-1">
                  <Text className="text-purple-300 text-sm font-semibold">
                    Premium Application Mode
                  </Text>
                  <Text className="text-purple-400/70 text-xs mt-0.5">
                    Select any code to preview pay impact and apply directly to this trip
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Disclaimer Banner (reference mode only) */}
          {!actionMode && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(150)}
              className="mx-5 mt-4"
            >
              <View className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                <Text className="text-slate-400 text-xs text-center">
                  Reference-only. Based on UPS CBA contract premiums.
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Search Bar */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-5 mt-4"
          >
            <View className="flex-row items-center bg-slate-800/60 rounded-2xl px-4 py-3 border border-slate-700/50">
              <Search size={18} color="#64748b" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search code or keyword (AP0, LRP, layover)"
                placeholderTextColor="#64748b"
                className="flex-1 text-white text-base ml-3"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  className="p-1 active:opacity-50"
                >
                  <X size={18} color="#64748b" />
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Filter Chips */}
          <Animated.View entering={FadeInDown.duration(600).delay(250)} className="mt-4">
            <FilterChips selected={selectedCategory} onSelect={setSelectedCategory} />
          </Animated.View>

          {/* Fixed Credit Toggle */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(275)}
            className="mx-5 mt-3"
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFixedCreditOnly(!fixedCreditOnly);
              }}
              className={cn(
                "flex-row items-center justify-center py-2 px-4 rounded-xl border",
                fixedCreditOnly
                  ? "bg-emerald-500/20 border-emerald-500/30"
                  : "bg-slate-800/40 border-slate-700/30"
              )}
            >
              <Filter size={14} color={fixedCreditOnly ? "#10b981" : "#64748b"} />
              <Text
                className={cn(
                  "text-sm font-medium ml-2",
                  fixedCreditOnly ? "text-emerald-400" : "text-slate-400"
                )}
              >
                Show only fixed credit
              </Text>
            </Pressable>
          </Animated.View>

          {/* Loading State */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading premium codes...</Text>
            </View>
          )}

          {/* Most Used Codes */}
          {!isLoading && mostUsedCodes.length > 0 && (
            <Animated.View entering={FadeInDown.duration(600).delay(300)} className="mt-4">
              <MostUsedCodes codes={mostUsedCodes} onSelect={handleCodePress} />
            </Animated.View>
          )}

          {/* Content */}
          {!isLoading && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(350)}
              className="mx-5 mt-2 gap-3"
            >
              {codes.length > 0 ? (
                codes.map((code, index) => (
                  <PremiumCodeCard
                    key={code.code}
                    code={code}
                    index={index}
                    onPress={() => handleCodePress(code)}
                    actionMode={actionMode}
                  />
                ))
              ) : (
                <EmptyState hasSearch={!!searchQuery || selectedCategory !== "ALL"} />
              )}
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
