/**
 * Pay Statements Screen
 *
 * View and export pay records by pay period. Shows detailed breakdown
 * of flights, credit time, and earnings for each pay period.
 *
 * Supports offline viewing with cached data.
 */

import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Share,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  DollarSign,
  Plane,
  Download,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { offlineCache } from "@/lib/offlineStorage";
import { useIsOnline, useAutoRefreshOnReconnect } from "@/lib/useNetworkStatus";
import { OfflineIndicator } from "@/components/OfflineIndicator";

// Types
interface PayPeriod {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
}

interface PeriodFlight {
  id: string;
  dateISO: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  blockMinutes: number;
  creditMinutes: number;
  totalPayCents: number;
}

interface PeriodDetail {
  period: PayPeriod & { payDates: Array<{ payDate: string; payType: string }> };
  totals: {
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  } | null;
  flights: PeriodFlight[];
}

// Hooks
function usePayPeriods() {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-periods", isOnline],
    queryFn: async () => {
      // If offline, try cached data
      if (!isOnline) {
        const cached = await offlineCache.getPayPeriods<{ periods: PayPeriod[] }>();
        if (cached) {
          console.log("[usePayPeriods] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached data available");
      }

      // Online - fetch and cache
      const response = await api.get<{ periods: PayPeriod[] }>("/api/pay-periods");
      await offlineCache.savePayPeriods(response);
      return response;
    },
    retry: isOnline ? 3 : 0,
  });
}

function usePayPeriodDetail(year: number, period: number) {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-period", year, period, isOnline],
    queryFn: async () => {
      // If offline, try cached data
      if (!isOnline) {
        const cached = await offlineCache.getPayPeriodDetail<PeriodDetail>(year, period);
        if (cached) {
          console.log(`[usePayPeriodDetail] Using cached data (offline) for ${year}-${period}`);
          return cached;
        }
        throw new Error("No cached data available for this period");
      }

      // Online - fetch and cache
      const response = await api.get<PeriodDetail>(`/api/pay-periods/${year}/${period}`);
      await offlineCache.savePayPeriodDetail(year, period, response);
      return response;
    },
    enabled: year > 0 && period > 0,
    retry: isOnline ? 3 : 0,
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  const startStr = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endStr = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${startStr} - ${endStr}`;
}

// Components
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View className="flex-1 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
      <View className="flex-row items-center mb-1">
        {icon}
        <Text className="text-slate-400 text-xs ml-1.5">{label}</Text>
      </View>
      <Text className={`text-lg font-bold ${color}`}>{value}</Text>
    </View>
  );
}

function FlightRow({ flight }: { flight: PeriodFlight }) {
  return (
    <View className="flex-row items-center py-3 border-b border-slate-700/30">
      <View className="w-16">
        <Text className="text-slate-400 text-xs">
          {formatDate(flight.dateISO)}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="text-white text-sm font-medium">
          {flight.origin ?? "---"} → {flight.destination ?? "---"}
        </Text>
        {flight.flightNumber && (
          <Text className="text-slate-500 text-xs">{flight.flightNumber}</Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-slate-300 text-sm">
          {formatMinutes(flight.creditMinutes)}
        </Text>
        <Text className="text-green-400 text-xs">
          {formatCurrency(flight.totalPayCents)}
        </Text>
      </View>
    </View>
  );
}

function PeriodCard({
  period,
  isSelected,
  onSelect,
}: {
  period: PayPeriod;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onSelect();
      }}
      className={`px-4 py-2 rounded-xl mr-2 ${
        isSelected
          ? "bg-amber-500"
          : "bg-slate-800/60 border border-slate-700/50"
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          isSelected ? "text-black" : "text-slate-300"
        }`}
      >
        Period {period.periodNumber}
      </Text>
      <Text
        className={`text-xs ${isSelected ? "text-black/70" : "text-slate-500"}`}
      >
        {formatDateRange(period.startDate, period.endDate)}
      </Text>
    </Pressable>
  );
}

export default function PayStatementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isOnline = useIsOnline();

  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const [expandedFlights, setExpandedFlights] = useState(false);

  // Auto-refresh when back online
  useAutoRefreshOnReconnect([["pay-periods"], ["pay-period"]]);

  const { data: periodsData, isLoading: periodsLoading } = usePayPeriods();
  const { data: detailData, isLoading: detailLoading } = usePayPeriodDetail(
    selectedYear,
    selectedPeriod ?? 0
  );

  // Get periods for selected year
  const yearPeriods = useMemo(() => {
    if (!periodsData?.periods) return [];
    return periodsData.periods
      .filter((p) => p.year === selectedYear)
      .sort((a, b) => a.periodNumber - b.periodNumber);
  }, [periodsData, selectedYear]);

  // Auto-select current period on load
  useMemo(() => {
    if (yearPeriods.length > 0 && selectedPeriod === null) {
      const today = new Date().toISOString().split("T")[0];
      const current = yearPeriods.find(
        (p) => p.startDate <= today && p.endDate >= today
      );
      setSelectedPeriod(current?.periodNumber ?? yearPeriods[0]?.periodNumber ?? 1);
    }
  }, [yearPeriods, selectedPeriod]);

  // Export statement
  const handleExport = async () => {
    if (!detailData) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { period, totals, flights } = detailData;

    let content = `PAY STATEMENT - Period ${period.periodNumber}, ${period.year}\n`;
    content += `Date Range: ${formatDateRange(period.startDate, period.endDate)}\n`;
    content += `Pay Date: ${formatDate(period.payDates[0]?.payDate ?? period.startDate)}\n`;
    content += `\n--- SUMMARY ---\n`;
    content += `Flights: ${totals?.flightCount ?? 0}\n`;
    content += `Block Time: ${formatMinutes(totals?.blockMinutes ?? 0)}\n`;
    content += `Credit Time: ${formatMinutes(totals?.creditMinutes ?? 0)}\n`;
    content += `Total Pay: ${formatCurrency(totals?.totalPayCents ?? 0)}\n`;

    if (flights.length > 0) {
      content += `\n--- FLIGHT DETAILS ---\n`;
      flights.forEach((f) => {
        content += `${formatDate(f.dateISO)} | ${f.origin ?? "---"}-${f.destination ?? "---"} | ${formatMinutes(f.creditMinutes)} | ${formatCurrency(f.totalPayCents)}\n`;
      });
    }

    try {
      await Share.share({
        message: content,
        title: `Pay Statement - Period ${period.periodNumber}`,
      });
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

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
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center mb-4"
            >
              <Text className="text-amber-500 text-base">← Back</Text>
            </Pressable>

            <View className="flex-row items-center mb-2">
              <FileText size={24} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-semibold ml-2">
                Documents
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">Pay Statements</Text>
            <Text className="text-slate-400 text-base mt-1">
              View and export pay records by period
            </Text>
          </Animated.View>

          {/* Offline Indicator */}
          <View className="mt-4">
            <OfflineIndicator
              message="Viewing cached statements"
              showSyncStatus={false}
            />
          </View>

          {/* Year Selector */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="flex-row items-center justify-center mt-6 px-5"
          >
            <Pressable
              onPress={() => setSelectedYear((y) => y - 1)}
              className="p-2"
            >
              <ChevronLeft size={24} color="#64748b" />
            </Pressable>
            <View className="bg-slate-800/60 px-6 py-2 rounded-xl mx-4">
              <Text className="text-white text-lg font-bold">{selectedYear}</Text>
            </View>
            <Pressable
              onPress={() => setSelectedYear((y) => y + 1)}
              className="p-2"
            >
              <ChevronRightIcon size={24} color="#64748b" />
            </Pressable>
          </Animated.View>

          {/* Period Selector */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mt-4"
          >
            {periodsLoading ? (
              <View className="items-center py-8">
                <ActivityIndicator color="#f59e0b" />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20 }}
                style={{ flexGrow: 0 }}
              >
                {yearPeriods.map((period) => (
                  <PeriodCard
                    key={`${period.year}-${period.periodNumber}`}
                    period={period}
                    isSelected={selectedPeriod === period.periodNumber}
                    onSelect={() => setSelectedPeriod(period.periodNumber)}
                  />
                ))}
              </ScrollView>
            )}
          </Animated.View>

          {/* Period Detail */}
          {selectedPeriod && (
            <Animated.View
              entering={FadeIn.duration(400)}
              className="mx-5 mt-6"
            >
              {detailLoading ? (
                <View className="items-center py-12">
                  <ActivityIndicator color="#f59e0b" />
                  <Text className="text-slate-400 text-sm mt-2">
                    Loading statement...
                  </Text>
                </View>
              ) : detailData ? (
                <>
                  {/* Period Header */}
                  <View className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50 mb-4">
                    <View className="flex-row items-center justify-between mb-3">
                      <View>
                        <Text className="text-white text-lg font-bold">
                          Period {detailData.period.periodNumber}
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          {formatDateRange(
                            detailData.period.startDate,
                            detailData.period.endDate
                          )}
                        </Text>
                      </View>
                      <Pressable
                        onPress={handleExport}
                        className="bg-amber-500/20 px-4 py-2 rounded-xl flex-row items-center"
                      >
                        <Download size={16} color="#f59e0b" />
                        <Text className="text-amber-500 font-semibold ml-2">
                          Export
                        </Text>
                      </Pressable>
                    </View>

                    {/* Pay Dates */}
                    <View className="flex-row items-center">
                      <Calendar size={14} color="#64748b" />
                      <Text className="text-slate-500 text-xs ml-1.5">
                        Pay Date:{" "}
                        {detailData.period.payDates
                          .map((pd) => formatDate(pd.payDate))
                          .join(", ")}
                      </Text>
                    </View>
                  </View>

                  {/* Stats Grid */}
                  <View className="flex-row gap-3 mb-4">
                    <StatCard
                      icon={<Plane size={14} color="#3b82f6" />}
                      label="Flights"
                      value={String(detailData.totals?.flightCount ?? 0)}
                      color="text-blue-400"
                    />
                    <StatCard
                      icon={<Clock size={14} color="#a78bfa" />}
                      label="Credit"
                      value={formatMinutes(detailData.totals?.creditMinutes ?? 0)}
                      color="text-purple-400"
                    />
                  </View>
                  <View className="flex-row gap-3 mb-4">
                    <StatCard
                      icon={<Clock size={14} color="#64748b" />}
                      label="Block"
                      value={formatMinutes(detailData.totals?.blockMinutes ?? 0)}
                      color="text-slate-300"
                    />
                    <StatCard
                      icon={<DollarSign size={14} color="#22c55e" />}
                      label="Total Pay"
                      value={formatCurrency(detailData.totals?.totalPayCents ?? 0)}
                      color="text-green-400"
                    />
                  </View>

                  {/* Flights List */}
                  <View className="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setExpandedFlights(!expandedFlights);
                      }}
                      className="flex-row items-center justify-between p-4"
                    >
                      <Text className="text-white font-semibold">
                        Flight Details ({detailData.flights.length})
                      </Text>
                      {expandedFlights ? (
                        <ChevronUp size={20} color="#64748b" />
                      ) : (
                        <ChevronDown size={20} color="#64748b" />
                      )}
                    </Pressable>

                    {expandedFlights && (
                      <View className="px-4 pb-4">
                        {detailData.flights.length === 0 ? (
                          <Text className="text-slate-500 text-sm text-center py-4">
                            No flights recorded this period
                          </Text>
                        ) : (
                          detailData.flights.map((flight) => (
                            <FlightRow key={flight.id} flight={flight} />
                          ))
                        )}
                      </View>
                    )}
                  </View>
                </>
              ) : (
                <View className="items-center py-12">
                  <FileText size={48} color="#334155" />
                  <Text className="text-slate-500 text-base mt-4">
                    Select a pay period to view statement
                  </Text>
                </View>
              )}
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
