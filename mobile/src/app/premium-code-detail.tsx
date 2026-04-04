/**
 * UPS Premium Code Detail Screen (Phase 2)
 *
 * Shows full details for a single premium code including:
 * - Big premium result at top
 * - Description + Eligibility + Trip Type
 * - Contract reference
 * - Variants section (if any)
 * - Button to create Log Event with code preselected
 */

import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  FileText,
  Clock,
  Percent,
  Edit3,
  Info,
  BookOpen,
  Users,
  Plane,
  Layers,
  Plus,
  ChevronRight,
  AlertCircle,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  usePremiumCode,
  getCategoryConfig,
  formatPremiumResult,
} from "@/lib/usePremiumCodes";
import { cn } from "@/lib/cn";
import type { PremiumCodeCategory, PremiumVariant } from "@/lib/contracts";

// ============================================
// BIG PREMIUM DISPLAY
// ============================================

function BigPremiumDisplay({
  premiumType,
  premiumMinutes,
  premiumMultiplier,
}: {
  premiumType: string;
  premiumMinutes?: number | null;
  premiumMultiplier?: number | null;
}) {
  const formatted = formatPremiumResult({ premiumType, premiumMinutes, premiumMultiplier });

  let Icon = Edit3;
  let color = "#f59e0b";
  let bgColor = "bg-amber-500/20";
  let label = "Manual Entry Required";

  if (premiumType === "minutes") {
    Icon = Clock;
    color = "#10b981";
    bgColor = "bg-emerald-500/20";
    label = "Fixed Credit";
  } else if (premiumType === "multiplier") {
    Icon = Percent;
    color = "#3b82f6";
    bgColor = "bg-blue-500/20";
    label = "Multiplier Rate";
  }

  return (
    <View className={cn("rounded-2xl p-6 items-center", bgColor)}>
      <Icon size={32} color={color} />
      <Text className="text-5xl font-bold mt-3" style={{ color }}>
        {formatted}
      </Text>
      <Text className="text-slate-400 text-sm mt-2">{label}</Text>
    </View>
  );
}

// ============================================
// INFO ROW
// ============================================

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;

  return (
    <View className="flex-row items-start py-3 border-b border-slate-700/30">
      <Icon size={18} color="#64748b" />
      <View className="flex-1 ml-3">
        <Text className="text-slate-400 text-xs uppercase tracking-wide">{label}</Text>
        <Text className="text-white text-base mt-0.5">{value}</Text>
      </View>
    </View>
  );
}

// ============================================
// VARIANTS SECTION
// ============================================

interface VariantsSectionProps {
  variants: PremiumVariant[];
  onSelectVariant?: (variant: PremiumVariant) => void;
}

function VariantsSection({ variants, onSelectVariant }: VariantsSectionProps) {
  if (variants.length === 0) return null;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-4">
        <Layers size={18} color="#8b5cf6" />
        <Text className="text-white font-semibold text-base ml-2">
          Variants
        </Text>
        <View className="ml-2 bg-purple-500/20 px-2 py-0.5 rounded-full">
          <Text className="text-purple-400 text-xs font-medium">{variants.length}</Text>
        </View>
      </View>

      <View className="gap-3">
        {variants.map((variant) => {
          const variantPremium = formatPremiumResult({
            premiumType: variant.premium_type,
            premiumMinutes: variant.premium_minutes,
            premiumMultiplier: variant.premium_multiplier,
          });

          return (
            <Pressable
              key={variant.variant_key}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectVariant?.(variant);
              }}
              className="bg-slate-700/30 rounded-xl p-3 active:bg-slate-700/50"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-white font-medium">{variant.label}</Text>
                  {variant.notes && (
                    <Text className="text-slate-400 text-sm mt-1" numberOfLines={2}>
                      {variant.notes}
                    </Text>
                  )}
                </View>
                <View className="ml-3 items-end">
                  <Text
                    className={cn(
                      "text-lg font-bold",
                      variant.premium_type === "minutes"
                        ? "text-emerald-400"
                        : variant.premium_type === "multiplier"
                          ? "text-blue-400"
                          : "text-amber-400"
                    )}
                  >
                    {variantPremium}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ============================================
// REQUIRED INPUTS SECTION
// ============================================

function RequiredInputsSection({ inputs }: { inputs: string[] }) {
  if (inputs.length === 0) return null;

  // Map input keys to human-readable labels
  const inputLabels: Record<string, string> = {
    scheduled_trip_end: "Scheduled Trip End Time",
    actual_release: "Actual Release Time",
    day_off_start: "Day Off Start Time",
    hourly_rate: "Hourly Rate",
    trip_type: "Trip Type (Dom/Intl)",
    layover_change_type: "Layover Change Type",
    original_layover_city: "Original Layover City",
    new_layover_city: "New Layover City",
    swap_reason: "Swap Reason",
    credit_minutes: "Credit Minutes",
    segment_origin: "Segment Origin",
    segment_destination: "Segment Destination",
    original_start_time: "Original Start Time",
    new_start_time: "New Start Time",
    soft_max_type: "Soft Max Type",
    scheduled_value: "Scheduled Value",
    actual_value: "Actual Value",
    peak_period_dates: "Peak Period Dates",
    turnout_count: "Turnout Count",
  };

  return (
    <View className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/20">
      <View className="flex-row items-center mb-3">
        <AlertCircle size={18} color="#f59e0b" />
        <Text className="text-amber-400 font-semibold text-base ml-2">
          Required Inputs
        </Text>
      </View>
      <Text className="text-slate-400 text-sm mb-3">
        This premium requires the following information to calculate:
      </Text>
      <View className="gap-2">
        {inputs.map((input) => (
          <View key={input} className="flex-row items-center">
            <View className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-2" />
            <Text className="text-slate-300 text-sm">
              {inputLabels[input] ?? input.replace(/_/g, " ")}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function PremiumCodeDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();

  const codeString = params.code ?? null;
  const { data, isLoading, error } = usePremiumCode(codeString);

  const code = data?.code;
  const variants = data?.variants ?? [];
  const requiresInputs = data?.requiresInputs ?? [];
  const categoryConfig = code
    ? getCategoryConfig(code.category as PremiumCodeCategory)
    : null;

  const handleCreateLogEvent = useCallback(() => {
    if (!code) return;
    // Deep link to Log Event with premium code preselected
    router.push({
      pathname: "/add",
      params: {
        premiumCode: code.code,
        premiumTitle: code.title,
      },
    });
  }, [router, code]);

  const handleSelectVariant = useCallback(
    (variant: PremiumVariant) => {
      if (!code) return;
      router.push({
        pathname: "/add",
        params: {
          premiumCode: code.code,
          premiumTitle: code.title,
          variantKey: variant.variant_key,
          variantMinutes: variant.premium_minutes?.toString(),
        },
      });
    },
    [router, code]
  );

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen
        options={{
          headerShown: false,
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
                Premium Code Library
              </Text>
            </Pressable>

            {/* Loading */}
            {isLoading && (
              <View className="items-center py-12">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-3">Loading...</Text>
              </View>
            )}

            {/* Error */}
            {error && !isLoading && (
              <View className="items-center py-12">
                <AlertCircle size={40} color="#ef4444" />
                <Text className="text-white text-lg font-semibold mt-4">
                  Code Not Found
                </Text>
                <Text className="text-slate-400 text-center mt-2">
                  {codeString ? `"${codeString}" not found` : "No code specified"}
                </Text>
              </View>
            )}

            {/* Code Header */}
            {code && categoryConfig && (
              <View className="flex-row items-start">
                <View
                  className={cn(
                    "w-16 h-16 rounded-xl items-center justify-center mr-4",
                    categoryConfig.bgColor
                  )}
                >
                  <Text
                    className="text-xl font-bold"
                    style={{ color: categoryConfig.color }}
                  >
                    {code.code}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white text-2xl font-bold">
                    {code.title}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <View
                      className={cn("px-2 py-0.5 rounded", categoryConfig.bgColor)}
                    >
                      <Text
                        className="text-xs font-medium"
                        style={{ color: categoryConfig.color }}
                      >
                        {categoryConfig.label}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </Animated.View>

          {code && (
            <>
              {/* Big Premium Display */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-6"
              >
                <BigPremiumDisplay
                  premiumType={code.premiumType}
                  premiumMinutes={code.premiumMinutes}
                  premiumMultiplier={code.premiumMultiplier}
                />
              </Animated.View>

              {/* Description */}
              {code.description && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(200)}
                  className="mx-5 mt-4"
                >
                  <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                    <View className="flex-row items-center mb-3">
                      <Info size={18} color="#f59e0b" />
                      <Text className="text-white font-semibold text-base ml-2">
                        Description
                      </Text>
                    </View>
                    <Text className="text-slate-300 text-sm leading-relaxed">
                      {code.description}
                    </Text>
                  </View>
                </Animated.View>
              )}

              {/* Details */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="mx-5 mt-4"
              >
                <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                  <InfoRow
                    icon={Users}
                    label="Eligibility"
                    value={code.eligibility}
                  />
                  <InfoRow icon={Plane} label="Trip Type" value={code.tripType} />
                  <InfoRow
                    icon={BookOpen}
                    label="Contract Reference"
                    value={code.contractRef}
                  />
                  {code.notes && (
                    <View className="pt-3">
                      <Text className="text-slate-400 text-xs uppercase tracking-wide">
                        Notes
                      </Text>
                      <Text className="text-slate-300 text-sm mt-1">
                        {code.notes}
                      </Text>
                    </View>
                  )}
                </View>
              </Animated.View>

              {/* Required Inputs (for manual/multiplier types) */}
              {requiresInputs.length > 0 && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(300)}
                  className="mx-5 mt-4"
                >
                  <RequiredInputsSection inputs={requiresInputs} />
                </Animated.View>
              )}

              {/* Variants */}
              {variants.length > 0 && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(350)}
                  className="mx-5 mt-4"
                >
                  <VariantsSection
                    variants={variants}
                    onSelectVariant={handleSelectVariant}
                  />
                </Animated.View>
              )}

              {/* Use This Code Button */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(400)}
                className="mx-5 mt-6 gap-3"
              >
                {/* Primary: Use in Log Event (navigates to create-log-event with code preselected) */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    if (!code) return;
                    router.push({
                      pathname: '/create-log-event',
                      params: {
                        preselectedCode: code.code,
                        preselectedMultiplier: code.premiumMultiplier?.toString(),
                        changeType: 'PREMIUM_TRIGGER',
                      },
                    } as never);
                  }}
                  className="bg-amber-500 rounded-2xl px-6 py-4 flex-row items-center justify-center active:opacity-80"
                >
                  <Plus size={20} color="#0f172a" />
                  <Text className="text-slate-900 font-bold text-lg ml-2">
                    Use in Log Event
                  </Text>
                </Pressable>
                <Text className="text-slate-500 text-xs text-center -mt-1">
                  Opens Log Event creator with {code.code} preselected
                </Text>
              </Animated.View>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
