/**
 * Pay Rules Screen - User-configurable pay rules
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import {
  ChevronLeft,
  BookOpen,
  Plus,
  Settings2,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  usePayRules,
  useInitDefaultRules,
  useTogglePayRule,
  useDeletePayRule,
  parseValueConfig,
  formatRuleType,
  formatRuleScope,
  getRuleDisplayName,
} from "@/lib/usePayRules";
import type { PayRule, PayRuleCategory } from "@/lib/contracts";

// Format minutes to HH:MM
function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

// Format cents to currency
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Rule value display
function getRuleValueDisplay(rule: PayRule): string {
  const config = parseValueConfig(rule.valueConfig);

  switch (rule.ruleType) {
    case "GUARANTEE":
      if (config.creditMinutes) return `Min ${formatMinutes(config.creditMinutes as number)}`;
      if (config.payCents) return `Min ${formatCents(config.payCents as number)}`;
      return "Configured";

    case "PREMIUM_ADD":
      if (config.addMinutes) return `+${formatMinutes(config.addMinutes as number)}`;
      if (config.addCents) return `+${formatCents(config.addCents as number)}`;
      return "Add";

    case "PREMIUM_MULTIPLY":
      if (config.multiplier) return `${config.multiplier}x`;
      return "Multiply";

    case "THRESHOLD":
      if (config.triggerMinutes) return `> ${formatMinutes(config.triggerMinutes as number)}`;
      return "Threshold";

    case "LIMIT":
      if (config.maxMinutes) return `Max ${formatMinutes(config.maxMinutes as number)}`;
      if (config.maxCents) return `Max ${formatCents(config.maxCents as number)}`;
      return "Limit";

    default:
      return "Custom";
  }
}

// Category accordion component
function CategorySection({
  category,
  rules,
  expanded,
  onToggleExpand,
  onToggleRule,
  onDeleteRule,
}: {
  category: PayRuleCategory | null;
  rules: PayRule[];
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleRule: (ruleId: string, isActive: boolean) => void;
  onDeleteRule: (ruleId: string, ruleName: string) => void;
}) {
  const categoryName = category?.name ?? "Uncategorized";
  const activeCount = rules.filter((r) => r.isActive).length;

  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      className="mx-5 mt-4"
    >
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleExpand();
        }}
        className="flex-row items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3 active:opacity-70"
      >
        <View className="flex-row items-center flex-1">
          <BookOpen size={18} color="#f59e0b" />
          <Text className="text-white font-semibold text-base ml-3">
            {categoryName}
          </Text>
          <View className="ml-2 bg-amber-500/20 px-2 py-0.5 rounded-full">
            <Text className="text-amber-400 text-xs font-medium">
              {activeCount}/{rules.length}
            </Text>
          </View>
        </View>
        {expanded ? (
          <ChevronUp size={20} color="#64748b" />
        ) : (
          <ChevronDown size={20} color="#64748b" />
        )}
      </Pressable>

      {expanded && (
        <View className="bg-slate-900/60 rounded-xl mt-2 border border-slate-700/50 overflow-hidden">
          {rules.map((rule, index) => (
            <View key={rule.id}>
              {index > 0 && <View className="h-px bg-slate-700/50" />}
              <RuleItem
                rule={rule}
                onToggle={(isActive) => onToggleRule(rule.id, isActive)}
                onDelete={() => onDeleteRule(rule.id, rule.name)}
              />
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

// Individual rule item
function RuleItem({
  rule,
  onToggle,
  onDelete,
}: {
  rule: PayRule;
  onToggle: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  const router = useRouter();

  return (
    <View className="flex-row items-center px-4 py-3">
      <View className="flex-1 mr-3">
        <View className="flex-row items-center">
          {rule.isActive ? (
            <CheckCircle2 size={14} color="#22c55e" />
          ) : (
            <XCircle size={14} color="#64748b" />
          )}
          <Text
            className={`ml-2 font-medium ${
              rule.isActive ? "text-white" : "text-slate-500"
            }`}
          >
            {rule.code ? `${rule.code} - ` : ""}
            {rule.name}
          </Text>
        </View>
        <View className="flex-row items-center mt-1 flex-wrap">
          <Text className="text-amber-400 text-xs font-medium">
            {getRuleValueDisplay(rule)}
          </Text>
          <Text className="text-slate-500 text-xs mx-2">•</Text>
          <Text className="text-slate-400 text-xs">
            {formatRuleScope(rule.scope)}
          </Text>
          {rule.rollingWindowDays && (
            <>
              <Text className="text-slate-500 text-xs mx-2">•</Text>
              <Text className="text-slate-400 text-xs">
                {rule.rollingWindowDays} days
              </Text>
            </>
          )}
        </View>
        {rule.description && (
          <Text className="text-slate-500 text-xs mt-1" numberOfLines={1}>
            {rule.description}
          </Text>
        )}
      </View>

      <View className="flex-row items-center">
        <Switch
          value={rule.isActive}
          onValueChange={onToggle}
          trackColor={{ false: "#334155", true: "#f59e0b" }}
          thumbColor={rule.isActive ? "#fff" : "#94a3b8"}
          ios_backgroundColor="#334155"
          style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
        />
        {!rule.isBuiltIn && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete();
            }}
            className="ml-2 p-2 active:opacity-70"
          >
            <Trash2 size={16} color="#64748b" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function PayRulesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Data
  const { data, isLoading, refetch } = usePayRules();
  const initDefaultsMutation = useInitDefaultRules();
  const toggleRuleMutation = useTogglePayRule();
  const deleteRuleMutation = useDeletePayRule();

  // State
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Group rules by category
  const rulesByCategory = (data?.rules ?? []).reduce<Record<string, PayRule[]>>(
    (acc, rule) => {
      const key = rule.categoryId ?? "uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(rule);
      return acc;
    },
    {}
  );

  const categories = data?.categories ?? [];
  const hasRules = (data?.rules ?? []).length > 0;

  // Auto-expand first category
  useEffect(() => {
    if (categories.length > 0 && expandedCategories.size === 0) {
      setExpandedCategories(new Set([categories[0].id]));
    }
  }, [categories]);

  // Handlers
  const handleInitDefaults = async () => {
    try {
      await initDefaultsMutation.mutateAsync(undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refetch();
    } catch (error) {
      console.error("Failed to initialize defaults:", error);
      Alert.alert("Error", "Failed to create default rules. Please try again.");
    }
  };

  const handleToggleRule = async (ruleId: string, isActive: boolean) => {
    try {
      await toggleRuleMutation.mutateAsync({ ruleId, isActive });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error("Failed to toggle rule:", error);
    }
  };

  const handleDeleteRule = (ruleId: string, ruleName: string) => {
    Alert.alert(
      "Delete Rule",
      `Are you sure you want to delete "${ruleName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRuleMutation.mutateAsync(ruleId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error("Failed to delete rule:", error);
            }
          },
        },
      ]
    );
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
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
          >
            {/* Header */}
            <View style={{ paddingTop: insets.top + 8 }} className="px-5">
              <View className="flex-row items-center justify-between mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.back();
                  }}
                  className="flex-row items-center active:opacity-70"
                >
                  <ChevronLeft size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base ml-1">Back</Text>
                </Pressable>
              </View>

              <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                <View className="flex-row items-center mb-2">
                  <Settings2 size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Configuration
                  </Text>
                </View>
                <Text className="text-white text-3xl font-bold">Pay Rules</Text>
                <Text className="text-slate-400 text-base mt-1">
                  Define your pay calculation rules
                </Text>
              </Animated.View>
            </View>

            {/* Loading */}
            {isLoading && (
              <View className="items-center justify-center py-20">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4">Loading rules...</Text>
              </View>
            )}

            {/* Empty State - Init Defaults */}
            {!isLoading && !hasRules && (
              <Animated.View
                entering={FadeIn.duration(600)}
                className="mx-5 mt-8"
              >
                <View className="bg-slate-900/60 rounded-2xl p-6 border border-slate-700/50 items-center">
                  <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                    <Sparkles size={32} color="#f59e0b" />
                  </View>
                  <Text className="text-white text-xl font-bold text-center">
                    Get Started
                  </Text>
                  <Text className="text-slate-400 text-center mt-2 mb-6">
                    Create default pay rules based on common airline contracts.
                    You can customize them to match your specific situation.
                  </Text>
                  <Pressable
                    onPress={handleInitDefaults}
                    disabled={initDefaultsMutation.isPending}
                    className="bg-amber-500 rounded-xl px-6 py-3 flex-row items-center active:opacity-80"
                  >
                    {initDefaultsMutation.isPending ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <Plus size={20} color="#000" />
                        <Text className="text-slate-950 font-semibold text-base ml-2">
                          Create Default Rules
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Rules by Category */}
            {!isLoading && hasRules && (
              <>
                {/* Info Banner */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(150)}
                  className="mx-5 mt-6"
                >
                  <View className="bg-blue-900/30 rounded-xl p-4 border border-blue-700/30">
                    <Text className="text-blue-300 text-sm">
                      These rules drive your pay calculations. Toggle rules on/off
                      or customize values to match your contract.
                    </Text>
                  </View>
                </Animated.View>

                {/* Categories */}
                {categories.map((category) => (
                  <CategorySection
                    key={category.id}
                    category={category}
                    rules={rulesByCategory[category.id] ?? []}
                    expanded={expandedCategories.has(category.id)}
                    onToggleExpand={() => toggleCategory(category.id)}
                    onToggleRule={handleToggleRule}
                    onDeleteRule={handleDeleteRule}
                  />
                ))}

                {/* Uncategorized rules */}
                {rulesByCategory["uncategorized"]?.length > 0 && (
                  <CategorySection
                    category={null}
                    rules={rulesByCategory["uncategorized"]}
                    expanded={expandedCategories.has("uncategorized")}
                    onToggleExpand={() => toggleCategory("uncategorized")}
                    onToggleRule={handleToggleRule}
                    onDeleteRule={handleDeleteRule}
                  />
                )}

                {/* Summary */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(300)}
                  className="mx-5 mt-6"
                >
                  <View className="bg-slate-900/40 rounded-xl p-4 border border-slate-700/30">
                    <Text className="text-slate-400 text-sm text-center">
                      {data?.rules?.filter((r) => r.isActive).length ?? 0} of{" "}
                      {data?.rules?.length ?? 0} rules active
                    </Text>
                  </View>
                </Animated.View>
              </>
            )}
          </ScrollView>
        </LinearGradient>
      </View>
    </>
  );
}
