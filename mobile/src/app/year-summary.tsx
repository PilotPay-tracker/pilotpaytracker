/**
 * Year Summary Screen
 *
 * Annual flight totals with month-by-month breakdown, charts,
 * and year-over-year comparisons.
 */

import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  CalendarDays,
  TrendingUp,
  Clock,
  DollarSign,
  Plane,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Types
interface ProfileStats {
  allTime: {
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  currentYear: {
    year: number;
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  currentMonth: {
    month: string;
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  trips: {
    scheduled: number;
    inProgress: number;
    completed: number;
  };
}

interface MonthHistoryItem {
  year: number;
  month: number;
  monthName: string;
  creditMinutes: number;
  payCents: number;
  flights: number;
}

interface HistoryResponse {
  history: MonthHistoryItem[];
  averages: {
    monthlyCents: number;
    monthlyCreditMinutes: number;
  };
}

// Hooks
function useProfileStats() {
  return useQuery({
    queryKey: ["profile-stats"],
    queryFn: () => api.get<ProfileStats>("/api/profile/stats"),
  });
}

function useProjectionHistory() {
  return useQuery({
    queryKey: ["projection-history-all"],
    queryFn: () => api.get<HistoryResponse>("/api/projections/history?months=all"),
  });
}

// Helpers
function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatCurrencyFull(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Components
function StatCard({
  icon,
  label,
  value,
  subvalue,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subvalue?: string;
  color: string;
}) {
  return (
    <View className="flex-1 bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-2">
        {icon}
        <Text className="text-slate-400 text-xs ml-1.5 uppercase tracking-wider">
          {label}
        </Text>
      </View>
      <Text className={`text-2xl font-bold ${color}`}>{value}</Text>
      {subvalue && (
        <Text className="text-slate-500 text-xs mt-1">{subvalue}</Text>
      )}
    </View>
  );
}

function MonthBar({
  month,
  value,
  maxValue,
  isCurrentMonth,
}: {
  month: string;
  value: number;
  maxValue: number;
  isCurrentMonth: boolean;
}) {
  const barHeight = maxValue > 0 ? (value / maxValue) * 100 : 0;

  return (
    <View className="items-center flex-1">
      <View className="h-24 w-full items-center justify-end">
        <View
          className={`w-6 rounded-t ${
            isCurrentMonth ? "bg-amber-500" : "bg-blue-500/60"
          }`}
          style={{ height: `${Math.max(barHeight, 4)}%` }}
        />
      </View>
      <Text
        className={`text-xs mt-1 ${
          isCurrentMonth ? "text-amber-500 font-semibold" : "text-slate-500"
        }`}
      >
        {month}
      </Text>
    </View>
  );
}

function MonthRow({
  item,
  isCurrentMonth,
}: {
  item: MonthHistoryItem;
  isCurrentMonth: boolean;
}) {
  return (
    <View
      className={`flex-row items-center py-3 px-4 ${
        isCurrentMonth ? "bg-amber-500/10" : ""
      } border-b border-slate-700/30`}
    >
      <View className="w-20">
        <Text
          className={`font-semibold ${
            isCurrentMonth ? "text-amber-500" : "text-white"
          }`}
        >
          {item.monthName}
        </Text>
      </View>
      <View className="flex-1 flex-row items-center">
        <Plane size={12} color="#64748b" />
        <Text className="text-slate-400 text-sm ml-1">{item.flights}</Text>
      </View>
      <View className="flex-1 flex-row items-center">
        <Clock size={12} color="#64748b" />
        <Text className="text-slate-400 text-sm ml-1">
          {formatMinutes(item.creditMinutes)}
        </Text>
      </View>
      <View className="w-24 items-end">
        <Text className="text-green-400 font-semibold">
          {formatCurrency(item.payCents)}
        </Text>
      </View>
    </View>
  );
}

export default function YearSummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { TutorialModalComponent } = useAutoTutorial("year_summary");

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data: statsData, isLoading: statsLoading } = useProfileStats();
  const { data: historyData, isLoading: historyLoading } =
    useProjectionHistory();

  // Filter history for selected year
  const yearHistory = useMemo(() => {
    if (!historyData?.history) return [];
    return historyData.history
      .filter((h) => h.year === selectedYear)
      .sort((a, b) => a.month - b.month);
  }, [historyData, selectedYear]);

  // Calculate year totals
  const yearTotals = useMemo(() => {
    return yearHistory.reduce(
      (acc, h) => ({
        flights: acc.flights + h.flights,
        creditMinutes: acc.creditMinutes + h.creditMinutes,
        payCents: acc.payCents + h.payCents,
      }),
      { flights: 0, creditMinutes: 0, payCents: 0 }
    );
  }, [yearHistory]);

  // Get max value for chart scaling
  const maxMonthPay = useMemo(() => {
    if (yearHistory.length === 0) return 100000;
    return Math.max(...yearHistory.map((h) => h.payCents));
  }, [yearHistory]);

  // Fill in all 12 months for chart
  const chartData = useMemo(() => {
    const data: Array<{ month: string; value: number; monthNum: number }> = [];
    for (let i = 0; i < 12; i++) {
      const monthData = yearHistory.find((h) => h.month === i + 1);
      data.push({
        month: MONTH_NAMES[i] ?? "",
        value: monthData?.payCents ?? 0,
        monthNum: i,
      });
    }
    return data;
  }, [yearHistory]);

  const isLoading = statsLoading || historyLoading;

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={["#0f172a", "#1a2744", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center justify-between mb-4">
              <Pressable
                onPress={() => router.back()}
                className="flex-row items-center"
              >
                <Text className="text-amber-500 text-base">← Back</Text>
              </Pressable>
              <HelpButton tutorialId="year_summary" />
            </View>

            <View className="flex-row items-center mb-2">
              <CalendarDays size={24} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-semibold ml-2">
                Documents
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">Year Summary</Text>
            <Text className="text-slate-400 text-base mt-1">
              Annual flight totals and trends
            </Text>
          </Animated.View>

          {/* Year Selector */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="flex-row items-center justify-center mt-6 px-5"
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedYear((y) => y - 1);
              }}
              className="p-2"
            >
              <ChevronLeft size={24} color="#64748b" />
            </Pressable>
            <View className="bg-slate-800/60 px-8 py-3 rounded-xl mx-4">
              <Text className="text-white text-2xl font-bold">
                {selectedYear}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedYear((y) => y + 1);
              }}
              className="p-2"
            >
              <ChevronRight size={24} color="#64748b" />
            </Pressable>
          </Animated.View>

          {isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#f59e0b" />
              <Text className="text-slate-400 text-sm mt-2">
                Loading summary...
              </Text>
            </View>
          ) : (
            <>
              {/* Year Totals */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(200)}
                className="px-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                  {selectedYear} Totals
                </Text>
                <View className="flex-row gap-3 mb-3">
                  <StatCard
                    icon={<Plane size={14} color="#3b82f6" />}
                    label="Flights"
                    value={String(yearTotals.flights)}
                    color="text-blue-400"
                  />
                  <StatCard
                    icon={<Clock size={14} color="#a78bfa" />}
                    label="Credit"
                    value={formatMinutes(yearTotals.creditMinutes)}
                    subvalue={`${Math.round(yearTotals.creditMinutes / 60)} hrs`}
                    color="text-purple-400"
                  />
                </View>
                <View className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <View className="flex-row items-center mb-2">
                    <DollarSign size={14} color="#22c55e" />
                    <Text className="text-slate-400 text-xs ml-1.5 uppercase tracking-wider">
                      Total Earnings
                    </Text>
                  </View>
                  <Text className="text-green-400 text-3xl font-bold">
                    {formatCurrencyFull(yearTotals.payCents)}
                  </Text>
                  {historyData?.averages && (
                    <Text className="text-slate-500 text-sm mt-1">
                      Monthly avg: {formatCurrency(historyData.averages.monthlyCents)}
                    </Text>
                  )}
                </View>
              </Animated.View>

              {/* Monthly Chart */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="px-5 mt-6"
              >
                <View className="flex-row items-center mb-3">
                  <BarChart3 size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider ml-2">
                    Monthly Earnings
                  </Text>
                </View>
                <View className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50">
                  <View className="flex-row items-end">
                    {chartData.map((d) => (
                      <MonthBar
                        key={d.month}
                        month={d.month}
                        value={d.value}
                        maxValue={maxMonthPay}
                        isCurrentMonth={
                          selectedYear === currentYear &&
                          d.monthNum === currentMonth
                        }
                      />
                    ))}
                  </View>
                </View>
              </Animated.View>

              {/* Month-by-Month Breakdown */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(300)}
                className="px-5 mt-6"
              >
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                  Month-by-Month
                </Text>
                <View className="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden">
                  {/* Header */}
                  <View className="flex-row items-center py-2 px-4 bg-slate-800/60 border-b border-slate-700/50">
                    <View className="w-20">
                      <Text className="text-slate-500 text-xs font-semibold">
                        Month
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-500 text-xs font-semibold">
                        Flights
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-500 text-xs font-semibold">
                        Credit
                      </Text>
                    </View>
                    <View className="w-24 items-end">
                      <Text className="text-slate-500 text-xs font-semibold">
                        Pay
                      </Text>
                    </View>
                  </View>

                  {yearHistory.length === 0 ? (
                    <View className="py-8 items-center">
                      <CalendarDays size={32} color="#334155" />
                      <Text className="text-slate-500 text-sm mt-2">
                        No data for {selectedYear}
                      </Text>
                    </View>
                  ) : (
                    yearHistory.map((item) => (
                      <MonthRow
                        key={`${item.year}-${item.month}`}
                        item={item}
                        isCurrentMonth={
                          selectedYear === currentYear &&
                          item.month === currentMonth + 1
                        }
                      />
                    ))
                  )}
                </View>
              </Animated.View>

              {/* All-Time Stats */}
              {statsData && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(350)}
                  className="px-5 mt-6 mb-4"
                >
                  <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                    All Time Career At UPS
                  </Text>
                  <View className="rounded-2xl border border-amber-500/20 overflow-hidden" style={{ backgroundColor: 'rgba(15,23,42,0.9)' }}>
                    {/* Career Earnings - Hero */}
                    <View style={{ backgroundColor: 'rgba(34,197,94,0.08)' }} className="px-5 py-4 border-b border-slate-700/40">
                      <View className="flex-row items-center justify-between">
                        <View>
                          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Career Earnings</Text>
                          <Text className="text-green-400 text-3xl font-bold">
                            {formatCurrencyFull(statsData.allTime.totalPayCents)}
                          </Text>
                        </View>
                        <View style={{ backgroundColor: 'rgba(34,197,94,0.15)' }} className="rounded-xl p-3">
                          <TrendingUp size={24} color="#22c55e" />
                        </View>
                      </View>
                    </View>

                    {/* Stats Row */}
                    <View className="flex-row">
                      <View className="flex-1 items-center py-4 border-r border-slate-700/40">
                        <Plane size={14} color="#3b82f6" />
                        <Text className="text-white text-2xl font-bold mt-1">
                          {statsData.allTime.flightCount.toLocaleString()}
                        </Text>
                        <Text className="text-slate-500 text-xs mt-0.5">Total Flights</Text>
                      </View>
                      <View className="flex-1 items-center py-4 border-r border-slate-700/40">
                        <Clock size={14} color="#a78bfa" />
                        <Text className="text-white text-2xl font-bold mt-1">
                          {formatMinutes(statsData.allTime.blockMinutes)}
                        </Text>
                        <Text className="text-slate-500 text-xs mt-0.5">Block Time</Text>
                      </View>
                      <View className="flex-1 items-center py-4">
                        <Clock size={14} color="#f59e0b" />
                        <Text className="text-white text-2xl font-bold mt-1">
                          {formatMinutes(statsData.allTime.creditMinutes)}
                        </Text>
                        <Text className="text-slate-500 text-xs mt-0.5">Credit Time</Text>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              )}
            </>
          )}
        </ScrollView>
      </LinearGradient>
      {TutorialModalComponent}
    </View>
  );
}
