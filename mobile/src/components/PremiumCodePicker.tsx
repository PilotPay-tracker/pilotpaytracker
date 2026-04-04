/**
 * Premium Code Picker Component (Phase 3)
 *
 * A compact, fast picker for UPS premium codes.
 * Features:
 * - Search bar
 * - Category chips
 * - "Most Used" quick access row
 * - Premium result display (+HH:MM or %)
 * - Variant selection when applicable
 *
 * Used in Log Event page when:
 * - Premium Trigger selected
 * - Reassignment selected
 * - Schedule Change selected
 */

import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  ActivityIndicator,
} from "react-native";
import {
  Search,
  X,
  ChevronRight,
  Clock,
  Percent,
  Edit3,
  Sparkles,
  CheckCircle,
  ChevronDown,
  Info,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  usePremiumCodes,
  PREMIUM_FILTER_CHIPS,
  MOST_USED_CODES,
  getCategoryConfig,
  formatPremiumResult,
} from "@/lib/usePremiumCodes";
import { cn } from "@/lib/cn";
import type { PremiumCode, PremiumCodeCategory, PremiumVariant } from "@/lib/contracts";

// ============================================
// TYPES
// ============================================

export interface SelectedPremiumCode {
  code: PremiumCode;
  variant?: PremiumVariant;
  premiumMinutes: number;
  formattedPremium: string;
}

export interface PremiumCodePickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (selection: SelectedPremiumCode) => void;
  selectedCode?: string | null;
  changeType?: string; // For suggestions context
}

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
// CATEGORY CHIP
// ============================================

interface CategoryChipProps {
  label: string;
  category: PremiumCodeCategory | "ALL";
  isSelected: boolean;
  onPress: () => void;
}

function CategoryChip({ label, isSelected, onPress }: CategoryChipProps) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={cn(
        "px-3 py-1.5 rounded-full border mr-2",
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
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================
// MOST USED CODE CHIP
// ============================================

interface MostUsedChipProps {
  code: PremiumCode;
  isSelected: boolean;
  onPress: () => void;
}

function MostUsedChip({ code, isSelected, onPress }: MostUsedChipProps) {
  const premiumDisplay = formatPremiumResult(code);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={cn(
        "px-3 py-2 rounded-xl mr-2 border",
        isSelected
          ? "bg-emerald-500/20 border-emerald-500"
          : "bg-slate-800/60 border-slate-700/50"
      )}
    >
      <View className="flex-row items-center">
        <Text
          className={cn(
            "font-bold text-sm mr-1.5",
            isSelected ? "text-emerald-400" : "text-white"
          )}
        >
          {code.code}
        </Text>
        <Text
          className={cn(
            "text-xs",
            code.premiumType === "minutes"
              ? isSelected
                ? "text-emerald-400/80"
                : "text-emerald-400/60"
              : code.premiumType === "multiplier"
                ? isSelected
                  ? "text-blue-400/80"
                  : "text-blue-400/60"
                : isSelected
                  ? "text-amber-400/80"
                  : "text-amber-400/60"
          )}
        >
          {premiumDisplay}
        </Text>
      </View>
    </Pressable>
  );
}

// ============================================
// PREMIUM CODE ROW
// ============================================

interface PremiumCodeRowProps {
  code: PremiumCode;
  isSelected: boolean;
  onPress: () => void;
}

function PremiumCodeRow({ code, isSelected, onPress }: PremiumCodeRowProps) {
  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);
  const premiumDisplay = formatPremiumResult(code);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={cn(
        "flex-row items-center p-3 rounded-xl mb-2 border",
        isSelected
          ? "bg-emerald-500/10 border-emerald-500/50"
          : "bg-slate-800/60 border-slate-700/50 active:bg-slate-800/80"
      )}
    >
      {/* Code Badge */}
      <View
        className={cn(
          "w-12 h-12 rounded-lg items-center justify-center mr-3",
          categoryConfig.bgColor
        )}
      >
        <Text className="font-bold text-sm" style={{ color: categoryConfig.color }}>
          {code.code}
        </Text>
      </View>

      {/* Info */}
      <View className="flex-1">
        <Text className="text-white font-medium" numberOfLines={1}>
          {code.title}
        </Text>
        <View className="flex-row items-center mt-1">
          <PremiumTypeBadge type={code.premiumType} />
          {code.hasVariants && (
            <View className="bg-purple-500/20 px-2 py-0.5 rounded-lg ml-2">
              <Text className="text-purple-400 text-xs">Variants</Text>
            </View>
          )}
        </View>
      </View>

      {/* Premium Value */}
      <View className="items-end">
        <Text
          className={cn(
            "text-lg font-bold",
            code.premiumType === "minutes"
              ? "text-emerald-400"
              : code.premiumType === "multiplier"
                ? "text-blue-400"
                : "text-amber-400"
          )}
        >
          {premiumDisplay}
        </Text>
        {isSelected && (
          <CheckCircle size={16} color="#10b981" />
        )}
      </View>
    </Pressable>
  );
}

// ============================================
// VARIANT PICKER MODAL
// ============================================

interface VariantPickerProps {
  visible: boolean;
  code: PremiumCode;
  variants: PremiumVariant[];
  onSelect: (variant: PremiumVariant | null) => void;
  onClose: () => void;
}

function VariantPicker({ visible, code, variants, onSelect, onClose }: VariantPickerProps) {
  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);
  const basePremium = formatPremiumResult(code);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/70 justify-end"
        onPress={onClose}
      >
        <Pressable
          className="bg-slate-900 rounded-t-3xl max-h-[70%]"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View className="p-4 border-b border-slate-700/50">
            <View className="flex-row items-center">
              <View
                className={cn(
                  "w-12 h-12 rounded-lg items-center justify-center mr-3",
                  categoryConfig.bgColor
                )}
              >
                <Text className="font-bold" style={{ color: categoryConfig.color }}>
                  {code.code}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold text-lg">{code.title}</Text>
                <Text className="text-slate-400 text-sm">Select a variant</Text>
              </View>
            </View>
          </View>

          <ScrollView className="p-4">
            {/* Default Option */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(null);
              }}
              className="bg-slate-800/60 rounded-xl p-4 mb-3 border border-slate-700/50 active:bg-slate-700/50"
            >
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-white font-medium">Standard Premium</Text>
                  <Text className="text-slate-400 text-sm mt-1">Default contract rate</Text>
                </View>
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
                  {basePremium}
                </Text>
              </View>
            </Pressable>

            {/* Variants */}
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
                    onSelect(variant);
                  }}
                  className="bg-slate-800/60 rounded-xl p-4 mb-3 border border-slate-700/50 active:bg-slate-700/50"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 mr-3">
                      <Text className="text-white font-medium">{variant.label}</Text>
                      {variant.notes && (
                        <Text className="text-slate-400 text-sm mt-1" numberOfLines={2}>
                          {variant.notes}
                        </Text>
                      )}
                    </View>
                    <Text
                      className={cn(
                        "text-xl font-bold",
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
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Cancel Button */}
          <View className="p-4 pb-8">
            <Pressable
              onPress={onClose}
              className="bg-slate-800 rounded-xl p-4 active:bg-slate-700"
            >
              <Text className="text-slate-400 text-center font-semibold">Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ============================================
// MAIN PICKER
// ============================================

export function PremiumCodePicker({
  visible,
  onClose,
  onSelect,
  selectedCode,
}: PremiumCodePickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PremiumCodeCategory | "ALL">("ALL");
  const [selectedForVariant, setSelectedForVariant] = useState<PremiumCode | null>(null);

  // Fetch premium codes
  const { data, isLoading } = usePremiumCodes({
    search: searchQuery || undefined,
    category: selectedCategory !== "ALL" ? selectedCategory : undefined,
  });
  const codes = data?.codes ?? [];

  // Get most used codes
  const mostUsedCodes = useMemo(() => {
    if (searchQuery || selectedCategory !== "ALL") return [];
    return codes.filter((c) => MOST_USED_CODES.includes(c.code));
  }, [codes, searchQuery, selectedCategory]);

  // Parse variants from JSON
  const parseVariants = useCallback((code: PremiumCode): PremiumVariant[] => {
    if (!code.variantsJson) return [];
    try {
      return JSON.parse(code.variantsJson) as PremiumVariant[];
    } catch {
      return [];
    }
  }, []);

  // Handle code selection
  const handleCodeSelect = useCallback(
    (code: PremiumCode) => {
      const variants = parseVariants(code);

      // If code has variants, show variant picker
      if (code.hasVariants && variants.length > 0) {
        setSelectedForVariant(code);
        return;
      }

      // Otherwise, select directly
      const premiumMinutes = code.premiumMinutes ?? 0;
      const formattedPremium = formatPremiumResult(code);

      onSelect({
        code,
        premiumMinutes,
        formattedPremium,
      });
      onClose();
    },
    [onSelect, onClose, parseVariants]
  );

  // Handle variant selection
  const handleVariantSelect = useCallback(
    (variant: PremiumVariant | null) => {
      if (!selectedForVariant) return;

      const code = selectedForVariant;
      let premiumMinutes: number;
      let formattedPremium: string;

      if (variant) {
        premiumMinutes = variant.premium_minutes ?? 0;
        formattedPremium = formatPremiumResult({
          premiumType: variant.premium_type,
          premiumMinutes: variant.premium_minutes,
          premiumMultiplier: variant.premium_multiplier,
        });
      } else {
        premiumMinutes = code.premiumMinutes ?? 0;
        formattedPremium = formatPremiumResult(code);
      }

      onSelect({
        code,
        variant: variant ?? undefined,
        premiumMinutes,
        formattedPremium,
      });
      setSelectedForVariant(null);
      onClose();
    },
    [selectedForVariant, onSelect, onClose]
  );

  const handleClose = useCallback(() => {
    setSearchQuery("");
    setSelectedCategory("ALL");
    setSelectedForVariant(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-slate-950">
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(300)}
          className="bg-slate-900 border-b border-slate-700/50 pt-14 pb-4 px-4"
        >
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-white text-xl font-bold">Select Premium Code</Text>
            <Pressable
              onPress={handleClose}
              className="p-2 bg-slate-800 rounded-full active:bg-slate-700"
            >
              <X size={20} color="#94a3b8" />
            </Pressable>
          </View>

          {/* Search Bar */}
          <View className="flex-row items-center bg-slate-800/60 rounded-xl px-3 py-2 border border-slate-700/50">
            <Search size={18} color="#64748b" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search code or keyword (AP0, LRP)"
              placeholderTextColor="#64748b"
              className="flex-1 text-white text-base ml-2"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} className="p-1">
                <X size={16} color="#64748b" />
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* Category Chips */}
        <Animated.View entering={FadeIn.duration(300).delay(100)} className="py-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {PREMIUM_FILTER_CHIPS.map((chip) => (
              <CategoryChip
                key={chip.category}
                label={chip.label}
                category={chip.category}
                isSelected={selectedCategory === chip.category}
                onPress={() => setSelectedCategory(chip.category)}
              />
            ))}
          </ScrollView>
        </Animated.View>

        {/* Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Loading */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading codes...</Text>
            </View>
          )}

          {!isLoading && (
            <>
              {/* Most Used - Only show when no filters */}
              {mostUsedCodes.length > 0 && (
                <Animated.View entering={FadeInDown.duration(300)} className="mb-4">
                  <View className="flex-row items-center mb-2">
                    <Sparkles size={14} color="#f59e0b" />
                    <Text className="text-amber-400 text-sm font-medium ml-1.5">
                      Most Used
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingRight: 16 }}
                  >
                    {mostUsedCodes.map((code) => (
                      <MostUsedChip
                        key={code.code}
                        code={code}
                        isSelected={selectedCode === code.code}
                        onPress={() => handleCodeSelect(code)}
                      />
                    ))}
                  </ScrollView>
                </Animated.View>
              )}

              {/* All Codes */}
              <View className="mb-2">
                <Text className="text-slate-400 text-sm font-medium mb-3">
                  {searchQuery || selectedCategory !== "ALL"
                    ? `${codes.length} results`
                    : "All Premium Codes"}
                </Text>
              </View>

              {codes.length > 0 ? (
                codes.map((code) => (
                  <PremiumCodeRow
                    key={code.code}
                    code={code}
                    isSelected={selectedCode === code.code}
                    onPress={() => handleCodeSelect(code)}
                  />
                ))
              ) : (
                <View className="items-center py-12">
                  <Search size={40} color="#64748b" />
                  <Text className="text-white text-lg font-semibold mt-4">
                    No Results
                  </Text>
                  <Text className="text-slate-400 text-center mt-2">
                    Try another search term or category
                  </Text>
                </View>
              )}

              {/* Tip */}
              <View className="mt-4 bg-slate-800/40 rounded-xl p-3 flex-row items-start">
                <Info size={16} color="#64748b" className="mt-0.5" />
                <Text className="text-slate-400 text-xs ml-2 flex-1">
                  Premium codes are based on UPS CBA contract. Select a code to apply it to your log event.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>

      {/* Variant Picker */}
      {selectedForVariant && (
        <VariantPicker
          visible={!!selectedForVariant}
          code={selectedForVariant}
          variants={parseVariants(selectedForVariant)}
          onSelect={handleVariantSelect}
          onClose={() => setSelectedForVariant(null)}
        />
      )}
    </Modal>
  );
}

// ============================================
// SELECTED CODE CHIP (for display in forms)
// ============================================

export interface PremiumCodeChipProps {
  selection: SelectedPremiumCode;
  onPress?: () => void;
  onRemove?: () => void;
}

export function PremiumCodeChip({ selection, onPress, onRemove }: PremiumCodeChipProps) {
  const { code, variant, formattedPremium } = selection;
  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center px-3 py-2 rounded-xl border",
        "bg-emerald-500/10 border-emerald-500/30 active:bg-emerald-500/20"
      )}
    >
      {/* Code Badge */}
      <View
        className={cn("px-2 py-1 rounded-lg mr-2", categoryConfig.bgColor)}
      >
        <Text className="font-bold text-sm" style={{ color: categoryConfig.color }}>
          {code.code}
        </Text>
      </View>

      {/* Premium Display */}
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
        {formattedPremium}
      </Text>

      {/* Variant indicator */}
      {variant && (
        <Text className="text-purple-400 text-xs ml-2">
          ({variant.label})
        </Text>
      )}

      {/* Remove button */}
      {onRemove && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRemove();
          }}
          className="ml-2 p-1 active:opacity-50"
        >
          <X size={14} color="#94a3b8" />
        </Pressable>
      )}

      {/* Edit indicator */}
      {!onRemove && (
        <ChevronDown size={14} color="#64748b" className="ml-1" />
      )}
    </Pressable>
  );
}

export default PremiumCodePicker;
