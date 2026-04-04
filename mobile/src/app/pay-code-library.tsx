/**
 * Pay Code Library Screen
 *
 * Reference-only library of pay codes based on:
 * 1. Airline terminology pack (seed data)
 * 2. User-uploaded contract references
 *
 * Shows airline-specific pay code definitions with contract links.
 */

import { useState, useCallback, useEffect } from "react";
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
  Link2,
  Star,
  Shield,
  ShieldCheck,
  RefreshCw,
  Clock,
  GraduationCap,
  Plane,
  AlertTriangle,
  DollarSign,
  HelpCircle,
  X,
  Upload,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { usePayCodes, getCategoryDisplay, PAY_CODE_FILTER_CHIPS } from "@/lib/usePayCodes";
import { useProfile } from "@/lib/state/profile-store";
import { useContracts } from "@/lib/useContracts";
import { cn } from "@/lib/cn";
import type { UserPayCode, PayCodeCategory } from "@/lib/contracts";

// ============================================
// ICON MAPPING
// ============================================

const CategoryIcon: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Star,
  Shield,
  ShieldCheck,
  RefreshCw,
  Clock,
  GraduationCap,
  Plane,
  AlertTriangle,
  DollarSign,
  HelpCircle,
};

function getCategoryIcon(iconName: string) {
  return CategoryIcon[iconName] ?? HelpCircle;
}

// ============================================
// FILTER CHIPS
// ============================================

interface FilterChipsProps {
  selected: PayCodeCategory | "ALL";
  onSelect: (category: PayCodeCategory | "ALL") => void;
}

function FilterChips({ selected, onSelect }: FilterChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {PAY_CODE_FILTER_CHIPS.map((chip) => {
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
// PAY CODE CARD
// ============================================

interface PayCodeCardProps {
  code: UserPayCode;
  index: number;
  onPress: () => void;
}

function PayCodeCard({ code, index, onPress }: PayCodeCardProps) {
  const categoryDisplay = getCategoryDisplay(code.category);
  const Icon = getCategoryIcon(categoryDisplay.icon);

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 30)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 active:bg-slate-800/80"
      >
        <View className="flex-row items-start">
          {/* Icon */}
          <View
            className={cn("w-10 h-10 rounded-xl items-center justify-center mr-3", categoryDisplay.bgColor)}
          >
            <Icon size={20} color={categoryDisplay.color} />
          </View>

          {/* Content */}
          <View className="flex-1">
            {/* Header */}
            <View className="flex-row items-center mb-1">
              <Text className="text-white text-base font-semibold flex-1" numberOfLines={1}>
                {code.displayName}
              </Text>
              {code.shortCode && (
                <View className="bg-slate-700/50 px-2 py-0.5 rounded ml-2">
                  <Text className="text-slate-300 text-xs font-mono">{code.shortCode}</Text>
                </View>
              )}
            </View>

            {/* Description */}
            {code.summary && (
              <Text className="text-slate-400 text-sm mb-2" numberOfLines={2}>
                {code.summary}
              </Text>
            )}

            {/* Tags */}
            <View className="flex-row flex-wrap gap-2">
              {code.hasContractReferences ? (
                <View className="flex-row items-center bg-green-500/20 px-2 py-1 rounded-lg">
                  <Link2 size={10} color="#22c55e" />
                  <Text className="text-green-400 text-xs font-medium ml-1">Contract Linked</Text>
                </View>
              ) : (
                <View className="flex-row items-center bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Text className="text-slate-400 text-xs">No Reference</Text>
                </View>
              )}
              {code.isFromTerminologyPack && (
                <View className="bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Text className="text-slate-400 text-xs">Common term</Text>
                </View>
              )}
            </View>
          </View>

          {/* Chevron */}
          <View className="ml-2 justify-center">
            <ChevronRight size={16} color="#64748b" />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState({
  hasSearch,
  hasContracts,
  onUploadContract,
}: {
  hasSearch: boolean;
  hasContracts: boolean;
  onUploadContract: () => void;
}) {
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
      <Text className="text-white text-lg font-semibold mt-4">No Pay Codes</Text>
      <Text className="text-slate-400 text-center mt-2">
        {hasContracts
          ? "No pay codes found for your airline"
          : "Upload your contract to unlock contract-linked references"}
      </Text>
      {!hasContracts && (
        <Pressable
          onPress={onUploadContract}
          className="bg-amber-500 rounded-2xl px-6 py-3 mt-4 flex-row items-center active:opacity-80"
        >
          <Upload size={18} color="#0f172a" />
          <Text className="text-slate-900 font-bold ml-2">Upload Contract</Text>
        </Pressable>
      )}
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function PayCodeLibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const { data: contractsData } = useContracts();
  const params = useLocalSearchParams<{ category?: string }>();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PayCodeCategory | "ALL">("ALL");

  // Set category from URL params (for deep linking from Related Pay Codes)
  useEffect(() => {
    if (params.category) {
      const cat = params.category as PayCodeCategory;
      setSelectedCategory(cat);
    }
  }, [params.category]);

  const airlineName = profile?.airline ?? "Your Airline";
  const hasContracts = contractsData?.hasActiveDocuments ?? false;

  // Build filter options
  const filterOptions = {
    search: searchQuery || undefined,
    category: selectedCategory !== "ALL" ? selectedCategory : undefined,
  };

  const { data, isLoading } = usePayCodes(filterOptions);
  const codes = data?.codes ?? [];

  const handleCodePress = useCallback(
    (code: UserPayCode) => {
      router.push({
        pathname: "/pay-code-detail",
        params: { codeId: code.id, codeKey: code.codeKey },
      });
    },
    [router]
  );

  const handleUploadContract = useCallback(() => {
    router.push("/contract-references");
  }, [router]);

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
              <Text className="text-amber-500 text-base font-medium ml-1">Tools</Text>
            </Pressable>

            <View className="flex-row items-center mb-2">
              <Book size={24} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-semibold ml-2">
                Reference
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">Pay Code Library</Text>
            <Text className="text-slate-400 text-base mt-1">
              {airlineName} • {codes.length} codes
            </Text>
          </Animated.View>

          {/* Disclaimer Banner */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-4"
          >
            <View className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
              <Text className="text-slate-400 text-xs text-center">
                Reference-only. Based on your airline + uploaded documents.
              </Text>
            </View>
          </Animated.View>

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
                placeholder="Search code or keyword (e.g., JA, Override)"
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

          {/* Loading State */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading pay codes...</Text>
            </View>
          )}

          {/* Content */}
          {!isLoading && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(300)}
              className="mx-5 mt-6 gap-3"
            >
              {codes.length > 0 ? (
                codes.map((code, index) => (
                  <PayCodeCard
                    key={code.id}
                    code={code}
                    index={index}
                    onPress={() => handleCodePress(code)}
                  />
                ))
              ) : (
                <EmptyState
                  hasSearch={!!searchQuery || selectedCategory !== "ALL"}
                  hasContracts={hasContracts}
                  onUploadContract={handleUploadContract}
                />
              )}
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
