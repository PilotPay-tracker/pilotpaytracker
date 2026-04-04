/**
 * FilterChips - Horizontal scrolling filter chips for audit trail
 * Updated to use audit-focused categories: All / Earnings / Pay Events / Open (Action Needed) / Pay Summary
 */

import { ScrollView, View, Text, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";

// New audit-focused filter types
export type AuditFilterCategory = "ALL" | "EARNINGS" | "PAY_EVENTS" | "TRIP_CHANGES" | "PAY_SUMMARY";

interface FilterChipsProps {
  selectedCategory: AuditFilterCategory;
  onCategoryChange: (category: AuditFilterCategory) => void;
  tripChangeCount?: number;
}

interface FilterChip {
  label: string;
  category: AuditFilterCategory;
  badge?: number;
}

export function FilterChips({ selectedCategory, onCategoryChange, tripChangeCount = 0 }: FilterChipsProps) {
  const chips: FilterChip[] = [
    { label: "All", category: "ALL" },
    { label: "Earnings", category: "EARNINGS" },
    { label: "Pay Events", category: "PAY_EVENTS" },
    { label: tripChangeCount > 0 ? `Trip Change Log (${tripChangeCount})` : "Trip Change Log", category: "TRIP_CHANGES", badge: tripChangeCount },
    { label: "Pay Summary", category: "PAY_SUMMARY" },
  ];

  const handleChipPress = (chip: FilterChip) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCategoryChange(chip.category);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {chips.map((chip) => {
        const isSelected = selectedCategory === chip.category;
        const isChangeLogWithBadge = chip.category === "TRIP_CHANGES" && chip.badge && chip.badge > 0;

        return (
          <Pressable
            key={chip.category}
            onPress={() => handleChipPress(chip)}
            className={cn(
              "px-4 py-2 rounded-full border flex-row items-center",
              isSelected
                ? chip.category === "TRIP_CHANGES" && chip.badge
                  ? "bg-amber-500 border-amber-500"
                  : "bg-amber-500 border-amber-500"
                : isChangeLogWithBadge
                  ? "bg-amber-500/20 border-amber-500/40"
                  : "bg-slate-800/60 border-slate-700/50"
            )}
          >
            <Text
              className={cn(
                "text-sm font-medium",
                isSelected
                  ? "text-slate-900"
                  : isChangeLogWithBadge
                    ? "text-amber-400"
                    : "text-slate-300"
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
