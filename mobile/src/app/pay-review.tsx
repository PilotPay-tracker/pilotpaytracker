/**
 * Pay Review Screen - Statement Mirror
 *
 * View projected pay statement, compare with actual, run reconciliation
 * and audit checks. A comprehensive pay review experience.
 */

import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  Receipt,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Scale,
  ClipboardCheck,
  FileUp,
  RefreshCw,
  ArrowUpRight,
  Sparkles,
  CircleDot,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  SlideInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, BACKEND_URL } from "@/lib/api";
import type {
  ProjectedStatement,
  StatementDiff,
  ReconciliationResult,
  PayAuditChecklist,
  PayStatementParsed,
  DiffReason,
} from "@/lib/contracts";

// ============================================
// TYPES
// ============================================

interface PayPeriod {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
}

type TabType = "projected" | "reconcile" | "audit" | "changes";

// ============================================
// HOOKS
// ============================================

function usePayPeriods() {
  return useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => api.get<{ periods: PayPeriod[] }>("/api/pay-periods"),
  });
}

function useProjectedStatement(payPeriodId: string) {
  return useQuery({
    queryKey: ["projected-statement", payPeriodId],
    queryFn: () =>
      api.get<{ projected: ProjectedStatement }>(
        `/api/pay-statements/pay-periods/${payPeriodId}/projected-statement`
      ),
    enabled: !!payPeriodId,
  });
}

function useActualStatement(payPeriodId: string) {
  return useQuery({
    queryKey: ["actual-statement", payPeriodId],
    queryFn: () =>
      api.get<{ parsed: PayStatementParsed | null }>(
        `/api/pay-statements/pay-periods/${payPeriodId}/actual-statement`
      ),
    enabled: !!payPeriodId,
  });
}

function useRecalculate(payPeriodId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: DiffReason) =>
      api.post<{ projected: ProjectedStatement; diff: StatementDiff }>(
        `/api/pay-statements/pay-periods/${payPeriodId}/projected-statement/recalculate`,
        { reason }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projected-statement", payPeriodId] });
    },
  });
}

function useReconciliation(payPeriodId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ reconciliation: ReconciliationResult }>(
        `/api/pay-statements/pay-periods/${payPeriodId}/reconciliation/run`
      ),
  });
}

function useAudit(payPeriodId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<{ audit: PayAuditChecklist }>(
        `/api/pay-statements/pay-periods/${payPeriodId}/audit/run`
      ),
  });
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(amount: number): string {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  return `${isNegative ? "-" : ""}$${absAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatHours(hours: number | undefined): string {
  if (!hours) return "0:00";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function getConfidenceColor(confidence: string): string {
  switch (confidence) {
    case "high":
      return "#22c55e";
    case "medium":
      return "#f59e0b";
    case "low":
      return "#ef4444";
    default:
      return "#64748b";
  }
}

function getStatusIcon(status: "pass" | "warn" | "fail") {
  switch (status) {
    case "pass":
      return <CheckCircle2 size={20} color="#22c55e" />;
    case "warn":
      return <AlertTriangle size={20} color="#f59e0b" />;
    case "fail":
      return <XCircle size={20} color="#ef4444" />;
  }
}

// ============================================
// COMPONENTS
// ============================================

function GlassCard({
  children,
  className = "",
  intensity = 40,
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}) {
  return (
    <View className={`overflow-hidden rounded-2xl ${className}`}>
      <BlurView intensity={intensity} tint="dark" style={{ flex: 1 }}>
        <View className="bg-white/5 border border-white/10 rounded-2xl">
          {children}
        </View>
      </BlurView>
    </View>
  );
}

function TabButton({
  label,
  icon,
  isActive,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={`flex-1 items-center py-3 rounded-xl ${
        isActive ? "bg-emerald-500/20" : ""
      }`}
    >
      <View className="mb-1">{icon}</View>
      <Text
        className={`text-xs font-medium ${
          isActive ? "text-emerald-400" : "text-slate-500"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function HealthScoreRing({ score }: { score: number }) {
  const rotation = useSharedValue(0);

  const ringStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
    };
  });

  useState(() => {
    rotation.value = withSpring(score * 3.6);
  });

  const getScoreColor = () => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <View className="items-center justify-center w-28 h-28">
      <View
        className="absolute w-28 h-28 rounded-full border-4 border-slate-700/50"
        style={{
          borderTopColor: getScoreColor(),
          borderRightColor: score > 25 ? getScoreColor() : "transparent",
          borderBottomColor: score > 50 ? getScoreColor() : "transparent",
          borderLeftColor: score > 75 ? getScoreColor() : "transparent",
        }}
      />
      <Text className="text-3xl font-bold text-white">{score}</Text>
      <Text className="text-xs text-slate-400">Health</Text>
    </View>
  );
}

function SectionCard({
  section,
}: {
  section: {
    section: string;
    headerText: string;
    lineItems: Array<{
      label: string;
      amount: number;
      units?: number;
      rate?: number;
      unitsLabel?: string;
    }>;
  };
}) {
  return (
    <GlassCard className="mb-3">
      <View className="p-4">
        <Text className="text-emerald-400 text-sm font-semibold mb-3 tracking-wide uppercase">
          {section.headerText}
        </Text>
        {section.lineItems.map((item, idx) => (
          <View
            key={`${item.label}-${idx}`}
            className={`flex-row justify-between items-start py-2 ${
              idx > 0 ? "border-t border-white/5" : ""
            }`}
          >
            <View className="flex-1 pr-4">
              <Text className="text-white text-sm font-medium">{item.label}</Text>
              {(item.units !== undefined || item.rate !== undefined) && (
                <Text className="text-slate-500 text-xs mt-0.5">
                  {item.units !== undefined
                    ? `${formatHours(item.units)} ${item.unitsLabel ?? ""}`
                    : ""}
                  {item.rate !== undefined ? ` @ $${item.rate.toFixed(2)}/hr` : ""}
                </Text>
              )}
            </View>
            <Text
              className={`text-base font-semibold ${
                item.amount < 0 ? "text-red-400" : "text-white"
              }`}
            >
              {formatCurrency(item.amount)}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

function DiffCard({
  change,
}: {
  change: {
    section: string;
    label: string;
    deltaAmount: number;
    why: string;
    before?: { amount: number };
    after?: { amount: number };
  };
}) {
  const isPositive = change.deltaAmount >= 0;

  return (
    <GlassCard className="mb-3">
      <View className="p-4">
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            {isPositive ? (
              <TrendingUp size={16} color="#22c55e" />
            ) : (
              <TrendingDown size={16} color="#ef4444" />
            )}
            <Text className="text-slate-400 text-xs ml-2 uppercase tracking-wide">
              {change.section}
            </Text>
          </View>
          <Text
            className={`font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}
          >
            {isPositive ? "+" : ""}
            {formatCurrency(change.deltaAmount)}
          </Text>
        </View>
        <Text className="text-white font-medium mb-2">{change.label}</Text>
        <Text className="text-slate-500 text-sm">{change.why}</Text>
        <View className="flex-row mt-3 pt-2 border-t border-white/5">
          <Text className="text-slate-500 text-xs">
            Before: {formatCurrency(change.before?.amount ?? 0)}
          </Text>
          <Text className="text-slate-600 mx-2">→</Text>
          <Text className="text-slate-400 text-xs">
            After: {formatCurrency(change.after?.amount ?? 0)}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

function ReconcileCard({
  item,
}: {
  item: {
    actual: { label: string; amount: number; section: string };
    projected?: { label: string; amount: number };
    status: string;
    note: string;
    suggestion?: string;
  };
}) {
  const getStatusStyle = () => {
    switch (item.status) {
      case "matched":
        return { bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: <CheckCircle2 size={16} color="#22c55e" /> };
      case "missing_in_app":
        return { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: <AlertTriangle size={16} color="#f59e0b" /> };
      case "unmatched_needs_review":
        return { bg: "bg-red-500/10", border: "border-red-500/30", icon: <XCircle size={16} color="#ef4444" /> };
      default:
        return { bg: "bg-slate-500/10", border: "border-slate-500/30", icon: <CircleDot size={16} color="#64748b" /> };
    }
  };

  const style = getStatusStyle();

  return (
    <View className={`rounded-xl p-4 mb-3 border ${style.bg} ${style.border}`}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          {style.icon}
          <Text className="text-slate-400 text-xs ml-2 uppercase tracking-wide">
            {item.actual.section}
          </Text>
        </View>
        <Text className="text-white font-semibold">
          {formatCurrency(item.actual.amount)}
        </Text>
      </View>
      <Text className="text-white font-medium mb-2">{item.actual.label}</Text>
      <Text className="text-slate-500 text-sm">{item.note}</Text>
      {item.suggestion && (
        <View className="mt-2 pt-2 border-t border-white/5">
          <Text className="text-amber-400/80 text-xs">{item.suggestion}</Text>
        </View>
      )}
    </View>
  );
}

function AuditCheckCard({
  check,
}: {
  check: {
    id: string;
    title: string;
    status: "pass" | "warn" | "fail";
    detail: string;
    action?: { label: string; deepLink?: string };
  };
}) {
  const router = useRouter();

  return (
    <GlassCard className="mb-3">
      <View className="p-4">
        <View className="flex-row items-start">
          <View className="mt-0.5">{getStatusIcon(check.status)}</View>
          <View className="flex-1 ml-3">
            <Text className="text-white font-semibold mb-1">{check.title}</Text>
            <Text className="text-slate-400 text-sm">{check.detail}</Text>
            {check.action && (
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (check.action?.deepLink) {
                    router.push(check.action.deepLink as any);
                  }
                }}
                className="flex-row items-center mt-3"
              >
                <Text className="text-emerald-400 text-sm font-medium">
                  {check.action.label}
                </Text>
                <ArrowUpRight size={14} color="#34d399" className="ml-1" />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </GlassCard>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function PayReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ period?: string }>();

  const [activeTab, setActiveTab] = useState<TabType>("projected");
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(
    params.period ? parseInt(params.period, 10) : null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [diff, setDiff] = useState<StatementDiff | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [audit, setAudit] = useState<PayAuditChecklist | null>(null);

  const payPeriodId = selectedPeriod ? `${selectedYear}-${selectedPeriod}` : "";

  const { data: periodsData, isLoading: periodsLoading } = usePayPeriods();
  const { data: projectedData, isLoading: projectedLoading, refetch: refetchProjected } =
    useProjectedStatement(payPeriodId);
  const { data: actualData } = useActualStatement(payPeriodId);

  const recalculateMutation = useRecalculate(payPeriodId);
  const reconcileMutation = useReconciliation(payPeriodId);
  const auditMutation = useAudit(payPeriodId);

  // Get periods for selected year
  const yearPeriods = useMemo(() => {
    if (!periodsData?.periods) return [];
    return periodsData.periods
      .filter((p) => p.year === selectedYear)
      .sort((a, b) => a.periodNumber - b.periodNumber);
  }, [periodsData, selectedYear]);

  // Auto-select current period
  useMemo(() => {
    if (yearPeriods.length > 0 && selectedPeriod === null) {
      const today = new Date().toISOString().split("T")[0];
      const current = yearPeriods.find(
        (p) => p.startDate <= today && p.endDate >= today
      );
      setSelectedPeriod(current?.periodNumber ?? yearPeriods[0]?.periodNumber ?? 1);
    }
  }, [yearPeriods, selectedPeriod]);

  const selectedPeriodData = yearPeriods.find(
    (p) => p.periodNumber === selectedPeriod
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchProjected();
    setRefreshing(false);
  }, [refetchProjected]);

  const handleRecalculate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await recalculateMutation.mutateAsync("other");
      setDiff(result.diff);
      setActiveTab("changes");
    } catch (error) {
      Alert.alert("Error", "Failed to recalculate projection");
    }
  };

  const handleReconcile = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await reconcileMutation.mutateAsync();
      setReconciliation(result.reconciliation);
    } catch (error: any) {
      if (error.message?.includes("No actual statement")) {
        Alert.alert(
          "No Statement Uploaded",
          "Upload your actual pay statement first to run reconciliation."
        );
      } else {
        Alert.alert("Error", "Failed to run reconciliation");
      }
    }
  };

  const handleAudit = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await auditMutation.mutateAsync();
      setAudit(result.audit);
    } catch (error) {
      Alert.alert("Error", "Failed to run audit");
    }
  };

  const projected = projectedData?.projected;
  const hasActual = !!actualData?.parsed;

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Background Gradient */}
      <LinearGradient
        colors={["#0f172a", "#064e3b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", width: "100%", height: "100%" }}
      />

      {/* Ambient Glow */}
      <View
        className="absolute top-20 right-0 w-64 h-64 rounded-full opacity-20"
        style={{
          backgroundColor: "#10b981",
          shadowColor: "#10b981",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: 100,
        }}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#10b981"
          />
        }
      >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(600)}
          style={{ paddingTop: insets.top + 12 }}
          className="px-5"
        >
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center mb-4"
          >
            <ChevronLeft size={20} color="#10b981" />
            <Text className="text-emerald-500 text-base ml-1">Back</Text>
          </Pressable>

          <View className="flex-row items-center justify-between">
            <View>
              <View className="flex-row items-center mb-1">
                <Receipt size={20} color="#10b981" />
                <Text className="text-emerald-500 text-sm font-medium ml-2">
                  Pay Review
                </Text>
              </View>
              <Text className="text-white text-2xl font-bold">
                Statement Mirror
              </Text>
            </View>
            <Pressable
              onPress={() => router.push("/pay-statement-upload" as any)}
              className="bg-emerald-500/20 p-3 rounded-xl"
            >
              <FileUp size={20} color="#10b981" />
            </Pressable>
          </View>
        </Animated.View>

        {/* Period Selector */}
        <Animated.View
          entering={FadeInDown.duration(600).delay(100)}
          className="mt-4"
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20 }}
            style={{ flexGrow: 0 }}
          >
            {yearPeriods.map((period) => (
              <Pressable
                key={`${period.year}-${period.periodNumber}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedPeriod(period.periodNumber);
                  setDiff(null);
                  setReconciliation(null);
                  setAudit(null);
                }}
                className={`px-4 py-3 rounded-xl mr-2 ${
                  selectedPeriod === period.periodNumber
                    ? "bg-emerald-500"
                    : "bg-white/5 border border-white/10"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedPeriod === period.periodNumber
                      ? "text-black"
                      : "text-white"
                  }`}
                >
                  Period {period.periodNumber}
                </Text>
                <Text
                  className={`text-xs ${
                    selectedPeriod === period.periodNumber
                      ? "text-black/70"
                      : "text-slate-500"
                  }`}
                >
                  {formatDateRange(period.startDate, period.endDate)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Tab Navigation */}
        <Animated.View
          entering={FadeInDown.duration(600).delay(150)}
          className="mx-5 mt-4"
        >
          <GlassCard>
            <View className="flex-row p-1">
              <TabButton
                label="Projected"
                icon={
                  <Sparkles
                    size={18}
                    color={activeTab === "projected" ? "#34d399" : "#64748b"}
                  />
                }
                isActive={activeTab === "projected"}
                onPress={() => setActiveTab("projected")}
              />
              <TabButton
                label="Reconcile"
                icon={
                  <Scale
                    size={18}
                    color={activeTab === "reconcile" ? "#34d399" : "#64748b"}
                  />
                }
                isActive={activeTab === "reconcile"}
                onPress={() => setActiveTab("reconcile")}
              />
              <TabButton
                label="Audit"
                icon={
                  <ClipboardCheck
                    size={18}
                    color={activeTab === "audit" ? "#34d399" : "#64748b"}
                  />
                }
                isActive={activeTab === "audit"}
                onPress={() => setActiveTab("audit")}
              />
              <TabButton
                label="Changes"
                icon={
                  <TrendingUp
                    size={18}
                    color={activeTab === "changes" ? "#34d399" : "#64748b"}
                  />
                }
                isActive={activeTab === "changes"}
                onPress={() => setActiveTab("changes")}
              />
            </View>
          </GlassCard>
        </Animated.View>

        {/* Content */}
        <View className="px-5 mt-4">
          {projectedLoading ? (
            <View className="items-center py-16">
              <ActivityIndicator color="#10b981" size="large" />
              <Text className="text-slate-400 mt-3">Loading projection...</Text>
            </View>
          ) : !projected ? (
            <View className="items-center py-16">
              <Receipt size={48} color="#334155" />
              <Text className="text-slate-500 text-center mt-4">
                No projection available for this period
              </Text>
            </View>
          ) : (
            <>
              {/* PROJECTED TAB */}
              {activeTab === "projected" && (
                <Animated.View entering={FadeIn.duration(400)}>
                  {/* Summary Card */}
                  <GlassCard className="mb-4">
                    <View className="p-4">
                      <View className="flex-row items-center justify-between mb-4">
                        <View>
                          <Text className="text-slate-400 text-sm">
                            Estimated Gross
                          </Text>
                          <Text className="text-white text-3xl font-bold">
                            {formatCurrency(projected.totals.gross)}
                          </Text>
                        </View>
                        <View className="items-center">
                          <View
                            className="px-3 py-1 rounded-full"
                            style={{
                              backgroundColor: `${getConfidenceColor(projected.confidence)}20`,
                            }}
                          >
                            <Text
                              style={{ color: getConfidenceColor(projected.confidence) }}
                              className="text-xs font-semibold uppercase"
                            >
                              {projected.confidence} confidence
                            </Text>
                          </View>
                        </View>
                      </View>

                      <Pressable
                        onPress={handleRecalculate}
                        disabled={recalculateMutation.isPending}
                        className="flex-row items-center justify-center bg-emerald-500/20 py-3 rounded-xl"
                      >
                        {recalculateMutation.isPending ? (
                          <ActivityIndicator color="#10b981" size="small" />
                        ) : (
                          <>
                            <RefreshCw size={16} color="#10b981" />
                            <Text className="text-emerald-400 font-semibold ml-2">
                              What Changed?
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </GlassCard>

                  {/* Sections */}
                  {projected.sections.map((section, idx) => (
                    <Animated.View
                      key={section.section}
                      entering={SlideInRight.duration(400).delay(idx * 100)}
                    >
                      <SectionCard section={section} />
                    </Animated.View>
                  ))}

                  <Text className="text-slate-600 text-xs text-center mt-4 px-4">
                    Estimates are informational and may require review.
                    This is not official payroll documentation.
                  </Text>
                </Animated.View>
              )}

              {/* RECONCILE TAB */}
              {activeTab === "reconcile" && (
                <Animated.View entering={FadeIn.duration(400)}>
                  {!hasActual ? (
                    <GlassCard>
                      <View className="p-6 items-center">
                        <FileUp size={40} color="#64748b" />
                        <Text className="text-white font-semibold text-lg mt-4 mb-2">
                          Upload Your Statement
                        </Text>
                        <Text className="text-slate-400 text-center text-sm mb-4">
                          Upload your actual pay statement to compare with the projection
                        </Text>
                        <Pressable
                          onPress={() => router.push("/pay-statement-upload" as any)}
                          className="bg-emerald-500 px-6 py-3 rounded-xl"
                        >
                          <Text className="text-black font-semibold">
                            Upload Statement
                          </Text>
                        </Pressable>
                      </View>
                    </GlassCard>
                  ) : reconciliation ? (
                    <>
                      {/* Summary */}
                      <GlassCard className="mb-4">
                        <View className="p-4 flex-row justify-around">
                          <View className="items-center">
                            <Text className="text-emerald-400 text-2xl font-bold">
                              {reconciliation.summary.matchedCount}
                            </Text>
                            <Text className="text-slate-400 text-xs">Matched</Text>
                          </View>
                          <View className="items-center">
                            <Text className="text-amber-400 text-2xl font-bold">
                              {reconciliation.summary.missingInAppCount}
                            </Text>
                            <Text className="text-slate-400 text-xs">Missing</Text>
                          </View>
                          <View className="items-center">
                            <Text className="text-red-400 text-2xl font-bold">
                              {reconciliation.summary.unmatchedCount}
                            </Text>
                            <Text className="text-slate-400 text-xs">Review</Text>
                          </View>
                        </View>
                      </GlassCard>

                      {reconciliation.items.map((item, idx) => (
                        <Animated.View
                          key={idx}
                          entering={SlideInRight.duration(400).delay(idx * 50)}
                        >
                          <ReconcileCard item={item} />
                        </Animated.View>
                      ))}
                    </>
                  ) : (
                    <GlassCard>
                      <View className="p-6 items-center">
                        <Scale size={40} color="#10b981" />
                        <Text className="text-white font-semibold text-lg mt-4 mb-2">
                          Run Reconciliation
                        </Text>
                        <Text className="text-slate-400 text-center text-sm mb-4">
                          Compare your projected statement with the actual statement
                        </Text>
                        <Pressable
                          onPress={handleReconcile}
                          disabled={reconcileMutation.isPending}
                          className="bg-emerald-500 px-6 py-3 rounded-xl"
                        >
                          {reconcileMutation.isPending ? (
                            <ActivityIndicator color="#000" size="small" />
                          ) : (
                            <Text className="text-black font-semibold">
                              Run Reconciliation
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </GlassCard>
                  )}
                </Animated.View>
              )}

              {/* AUDIT TAB */}
              {activeTab === "audit" && (
                <Animated.View entering={FadeIn.duration(400)}>
                  {audit ? (
                    <>
                      {/* Health Score */}
                      <GlassCard className="mb-4">
                        <View className="p-4 items-center">
                          <HealthScoreRing score={audit.payHealthScore} />
                          <Text className="text-slate-400 text-sm mt-2">
                            Pay Health Score
                          </Text>
                        </View>
                      </GlassCard>

                      {/* Checks */}
                      {audit.checks.map((check, idx) => (
                        <Animated.View
                          key={check.id}
                          entering={SlideInRight.duration(400).delay(idx * 100)}
                        >
                          <AuditCheckCard check={check} />
                        </Animated.View>
                      ))}
                    </>
                  ) : (
                    <GlassCard>
                      <View className="p-6 items-center">
                        <ClipboardCheck size={40} color="#10b981" />
                        <Text className="text-white font-semibold text-lg mt-4 mb-2">
                          Run Pay Audit
                        </Text>
                        <Text className="text-slate-400 text-center text-sm mb-4">
                          Check your pay period for issues and get recommendations
                        </Text>
                        <Pressable
                          onPress={handleAudit}
                          disabled={auditMutation.isPending}
                          className="bg-emerald-500 px-6 py-3 rounded-xl"
                        >
                          {auditMutation.isPending ? (
                            <ActivityIndicator color="#000" size="small" />
                          ) : (
                            <Text className="text-black font-semibold">
                              Run Audit
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </GlassCard>
                  )}
                </Animated.View>
              )}

              {/* CHANGES TAB */}
              {activeTab === "changes" && (
                <Animated.View entering={FadeIn.duration(400)}>
                  {diff ? (
                    <>
                      {/* Summary */}
                      <GlassCard className="mb-4">
                        <View className="p-4">
                          <Text className="text-white font-semibold text-lg">
                            {diff.summaryLine}
                          </Text>
                          <Text className="text-slate-500 text-xs mt-1">
                            {new Date(diff.comparedAt).toLocaleString()}
                          </Text>
                        </View>
                      </GlassCard>

                      {diff.changes.length === 0 ? (
                        <View className="items-center py-8">
                          <CheckCircle2 size={40} color="#22c55e" />
                          <Text className="text-slate-400 mt-3">
                            No changes since last calculation
                          </Text>
                        </View>
                      ) : (
                        diff.changes.map((change, idx) => (
                          <Animated.View
                            key={idx}
                            entering={SlideInRight.duration(400).delay(idx * 100)}
                          >
                            <DiffCard change={change} />
                          </Animated.View>
                        ))
                      )}
                    </>
                  ) : (
                    <GlassCard>
                      <View className="p-6 items-center">
                        <TrendingUp size={40} color="#10b981" />
                        <Text className="text-white font-semibold text-lg mt-4 mb-2">
                          Track Changes
                        </Text>
                        <Text className="text-slate-400 text-center text-sm mb-4">
                          See what changed since your last projection
                        </Text>
                        <Pressable
                          onPress={handleRecalculate}
                          disabled={recalculateMutation.isPending}
                          className="bg-emerald-500 px-6 py-3 rounded-xl"
                        >
                          {recalculateMutation.isPending ? (
                            <ActivityIndicator color="#000" size="small" />
                          ) : (
                            <Text className="text-black font-semibold">
                              Calculate Changes
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </GlassCard>
                  )}
                </Animated.View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
