/**
 * RelatedPayCodes - Shows relevant pay codes based on event type or context
 * Entry point to Pay Code Library from Events/Changes
 */

import { View, Text, Pressable, ScrollView } from "react-native";
import { BookOpen, ChevronRight, Info } from "lucide-react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import { cn } from "@/lib/cn";
import type { PayEventType } from "@/lib/contracts";
import { PAY_CODE_CATEGORY_DISPLAY } from "@/lib/usePayCodes";
import type { PayCodeCategory } from "@/lib/contracts";

interface RelatedPayCodesProps {
  eventType?: PayEventType;
  changeType?: string;
  showTitle?: boolean;
  maxCodes?: number;
  className?: string;
}

// Map event types to relevant pay code categories
const EVENT_TO_CATEGORIES: Record<PayEventType, PayCodeCategory[]> = {
  SCHEDULE_CHANGE: ["REASSIGNMENT", "PROTECTION"],
  DUTY_EXTENSION: ["PREMIUM", "LIMITS"],
  REASSIGNMENT: ["REASSIGNMENT", "PROTECTION"],
  PREMIUM_TRIGGER: ["PREMIUM"],
  PAY_PROTECTION: ["PROTECTION", "GUARANTEE"],
  JUNIOR_ASSIGNMENT: ["REASSIGNMENT"],
  TRAINING: ["TRAINING"],
  DEADHEAD: ["DEADHEAD"],
  RESERVE_ACTIVATION: ["RESERVE"],
  OTHER: ["OTHER"],
};

// Map change types to categories
const CHANGE_TO_CATEGORIES: Record<string, PayCodeCategory[]> = {
  TRIP_ADDED: ["REASSIGNMENT", "RESERVE"],
  TRIP_REMOVED: ["PROTECTION", "GUARANTEE"],
  LEG_ADDED: ["REASSIGNMENT", "DEADHEAD"],
  LEG_REMOVED: ["PROTECTION"],
  TIME_CHANGE: ["PREMIUM", "LIMITS"],
  DH_CHANGE: ["DEADHEAD"],
  CREDIT_CHANGE: ["GUARANTEE", "PROTECTION"],
};

interface QuickCodeChip {
  category: PayCodeCategory;
  label: string;
  color: string;
  bgColor: string;
}

function getRelevantCategories(eventType?: PayEventType, changeType?: string): QuickCodeChip[] {
  let categories: PayCodeCategory[] = [];

  if (eventType && EVENT_TO_CATEGORIES[eventType]) {
    categories = EVENT_TO_CATEGORIES[eventType];
  } else if (changeType && CHANGE_TO_CATEGORIES[changeType]) {
    categories = CHANGE_TO_CATEGORIES[changeType];
  } else {
    // Default to most common categories
    categories = ["PREMIUM", "PROTECTION", "REASSIGNMENT"];
  }

  // Map to display info
  return categories.slice(0, 4).map((cat) => ({
    category: cat,
    label: PAY_CODE_CATEGORY_DISPLAY[cat]?.label ?? cat,
    color: PAY_CODE_CATEGORY_DISPLAY[cat]?.color ?? "#f59e0b",
    bgColor: PAY_CODE_CATEGORY_DISPLAY[cat]?.bgColor ?? "bg-amber-500/20",
  }));
}

export function RelatedPayCodes({
  eventType,
  changeType,
  showTitle = true,
  maxCodes = 4,
  className,
}: RelatedPayCodesProps) {
  const router = useRouter();
  const relevantCategories = getRelevantCategories(eventType, changeType);

  const handleCategoryPress = (category: PayCodeCategory) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/pay-code-library?category=${category}`);
  };

  const handleViewAllPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/pay-code-library");
  };

  if (relevantCategories.length === 0) return null;

  return (
    <View className={cn("", className)}>
      {showTitle && (
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center">
            <BookOpen size={14} color="#f59e0b" />
            <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider ml-2">
              Related Pay Codes
            </Text>
          </View>
          <Pressable
            onPress={handleViewAllPress}
            className="flex-row items-center active:opacity-70"
          >
            <Text className="text-amber-500 text-xs font-medium">View All</Text>
            <ChevronRight size={12} color="#f59e0b" />
          </Pressable>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
        style={{ flexGrow: 0 }}
      >
        {relevantCategories.map((cat) => (
          <Pressable
            key={cat.category}
            onPress={() => handleCategoryPress(cat.category)}
            className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50 active:bg-slate-800/80"
          >
            <View className="flex-row items-center">
              <View
                className="w-2 h-2 rounded-full mr-2"
                style={{ backgroundColor: cat.color }}
              />
              <Text className="text-white text-sm font-medium">{cat.label}</Text>
            </View>
            <Text className="text-slate-500 text-xs mt-1">Tap to explore</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Reference Disclaimer */}
      <View className="flex-row items-start mt-3 bg-slate-800/30 rounded-lg px-3 py-2">
        <Info size={12} color="#64748b" />
        <Text className="text-slate-500 text-xs flex-1 ml-2">
          Reference only. Check your contract for specific terms.
        </Text>
      </View>
    </View>
  );
}

// Compact inline version for cards
export function RelatedPayCodesInline({
  eventType,
  changeType,
}: {
  eventType?: PayEventType;
  changeType?: string;
}) {
  const router = useRouter();
  const relevantCategories = getRelevantCategories(eventType, changeType);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const firstCategory = relevantCategories[0]?.category;
    if (firstCategory) {
      router.push(`/pay-code-library?category=${firstCategory}`);
    } else {
      router.push("/pay-code-library");
    }
  };

  if (relevantCategories.length === 0) return null;

  return (
    <Pressable
      onPress={handlePress}
      className="flex-row items-center mt-2 active:opacity-70"
    >
      <BookOpen size={12} color="#f59e0b" />
      <Text className="text-amber-500/80 text-xs ml-1">
        View {relevantCategories[0]?.label} codes
      </Text>
      <ChevronRight size={10} color="#f59e0b" />
    </Pressable>
  );
}
