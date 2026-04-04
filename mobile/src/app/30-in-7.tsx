/**
 * 30-in-7 Tracker Screen - Monitor block time compliance
 */

import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import {
  ChevronLeft,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingUp,
  Plane,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Format minutes to HH:MM
function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, "0")}`;
}

// Status color mapping
function getStatusColor(status: string): string {
  switch (status) {
    case "green":
      return "#22c55e";
    case "yellow":
      return "#f59e0b";
    case "red":
      return "#ef4444";
    default:
      return "#64748b";
  }
}

function getStatusBg(status: string): string {
  switch (status) {
    case "green":
      return "bg-green-500/20";
    case "yellow":
      return "bg-amber-500/20";
    case "red":
      return "bg-red-500/20";
    default:
      return "bg-slate-500/20";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "green":
      return <CheckCircle size={24} color="#22c55e" />;
    case "yellow":
      return <AlertTriangle size={24} color="#f59e0b" />;
    case "red":
      return <XCircle size={24} color="#ef4444" />;
    default:
      return <Clock size={24} color="#64748b" />;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "green":
      return "Safe";
    case "yellow":
      return "Caution";
    case "red":
      return "Over Limit";
    default:
      return "Unknown";
  }
}

// Progress bar component
function ProgressBar({
  current,
  max,
  status,
}: {
  current: number;
  max: number;
  status: string;
}) {
  const percentage = Math.min((current / max) * 100, 100);

  return (
    <View className="h-4 bg-slate-800 rounded-full overflow-hidden">
      <Animated.View
        className={`h-full rounded-full ${
          status === "green"
            ? "bg-green-500"
            : status === "yellow"
            ? "bg-amber-500"
            : "bg-red-500"
        }`}
        style={{ width: `${percentage}%` }}
      />
      {/* Warning threshold marker at 90% (27h) */}
      <View
        className="absolute top-0 bottom-0 w-0.5 bg-amber-500/50"
        style={{ left: "90%" }}
      />
    </View>
  );
}

// Daily breakdown item
function DayItem({
  date,
  blockMinutes,
  formatted,
  isToday,
}: {
  date: string;
  blockMinutes: number;
  formatted: string;
  isToday: boolean;
}) {
  const dayName = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
  });
  const dayNum = new Date(date + "T12:00:00Z").getDate();
  const hasFlying = blockMinutes > 0;

  return (
    <View
      className={`flex-row items-center py-3 ${
        isToday ? "bg-amber-500/10 -mx-4 px-4 rounded-xl" : ""
      }`}
    >
      <View className="w-12 items-center">
        <Text className={`text-xs ${isToday ? "text-amber-400" : "text-slate-500"}`}>
          {dayName}
        </Text>
        <Text className={`text-lg font-bold ${isToday ? "text-amber-400" : "text-white"}`}>
          {dayNum}
        </Text>
      </View>
      <View className="flex-1 mx-4 h-2 bg-slate-800 rounded-full overflow-hidden">
        {hasFlying && (
          <View
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${Math.min((blockMinutes / 600) * 100, 100)}%` }}
          />
        )}
      </View>
      <View className="w-16 items-end">
        {hasFlying ? (
          <View className="flex-row items-center">
            <Plane size={12} color="#3b82f6" />
            <Text className="text-white font-medium ml-1">{formatted}</Text>
          </View>
        ) : (
          <Text className="text-slate-600 text-sm">-</Text>
        )}
      </View>
    </View>
  );
}

export default function ThirtyInSevenScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Get current date
  const today = new Date().toISOString().split("T")[0] ?? "";

  // Type definitions
  type ComplianceData = {
    asOfDate: string;
    rolling7DayMinutes: number;
    rolling7DayFormatted: string;
    limitMinutes: number;
    limitFormatted: string;
    remainingMinutes: number;
    remainingFormatted: string;
    status: "green" | "yellow" | "red";
    dailyBreakdown: Array<{
      date: string;
      blockMinutes: number;
      formatted: string;
    }>;
  };

  type ProjectionData = {
    projection: Array<{
      date: string;
      projectedMinutes: number;
      projectedStatus: "green" | "yellow" | "red";
      scheduledFlights: number;
    }>;
  };

  // Fetch 30-in-7 data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["compliance", "30-in-7", today],
    queryFn: () => api.get<ComplianceData>(`/api/compliance/30-in-7?date=${today}`),
  });

  // Fetch projection data
  const { data: projectionData } = useQuery({
    queryKey: ["compliance", "30-in-7", "projection", today],
    queryFn: () =>
      api.get<ProjectionData>(
        `/api/compliance/30-in-7/projection?startDate=${today}&days=7`
      ),
  });

  const status = data?.status ?? "green";
  const currentMinutes = data?.rolling7DayMinutes ?? 0;
  const limitMinutes = data?.limitMinutes ?? 1800;
  const remainingMinutes = data?.remainingMinutes ?? 1800;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
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
                  <Clock size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Compliance
                  </Text>
                </View>
                <Text className="text-white text-3xl font-bold">30-in-7 Tracker</Text>
                <Text className="text-slate-400 text-base mt-1">
                  FAR 117.23 block time limits
                </Text>
              </Animated.View>
            </View>

            {isLoading ? (
              <View className="items-center justify-center py-20">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4">Loading compliance data...</Text>
              </View>
            ) : (
              <>
                {/* Status Card */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(150)}
                  className="mx-5 mt-6"
                >
                  <View
                    className={`rounded-2xl p-5 border ${
                      status === "green"
                        ? "bg-green-900/20 border-green-700/30"
                        : status === "yellow"
                        ? "bg-amber-900/20 border-amber-700/30"
                        : "bg-red-900/20 border-red-700/30"
                    }`}
                  >
                    <View className="flex-row items-center justify-between mb-4">
                      <View className="flex-row items-center">
                        {getStatusIcon(status)}
                        <Text
                          className={`text-lg font-semibold ml-2 ${
                            status === "green"
                              ? "text-green-400"
                              : status === "yellow"
                              ? "text-amber-400"
                              : "text-red-400"
                          }`}
                        >
                          {getStatusLabel(status)}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-white text-2xl font-bold">
                          {data?.rolling7DayFormatted ?? "0:00"}
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          of {data?.limitFormatted ?? "30:00"}
                        </Text>
                      </View>
                    </View>

                    <ProgressBar current={currentMinutes} max={limitMinutes} status={status} />

                    <View className="flex-row justify-between mt-4">
                      <View>
                        <Text className="text-slate-400 text-sm">Remaining</Text>
                        <Text className="text-white text-lg font-semibold">
                          {data?.remainingFormatted ?? "30:00"}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-slate-400 text-sm">Usage</Text>
                        <Text className="text-white text-lg font-semibold">
                          {Math.round((currentMinutes / limitMinutes) * 100)}%
                        </Text>
                      </View>
                    </View>
                  </View>
                </Animated.View>

                {/* Daily Breakdown */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(200)}
                  className="mx-5 mt-6"
                >
                  <View className="flex-row items-center mb-3">
                    <Calendar size={18} color="#64748b" />
                    <Text className="text-slate-400 text-sm font-semibold ml-2 uppercase tracking-wider">
                      Rolling 7-Day Window
                    </Text>
                  </View>
                  <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                    {data?.dailyBreakdown?.map((day, index) => (
                      <View key={day.date}>
                        {index > 0 && <View className="h-px bg-slate-700/30 my-1" />}
                        <DayItem
                          date={day.date}
                          blockMinutes={day.blockMinutes}
                          formatted={day.formatted}
                          isToday={day.date === today}
                        />
                      </View>
                    ))}
                  </View>
                </Animated.View>

                {/* Projection */}
                {projectionData?.projection && projectionData.projection.length > 0 && (
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(250)}
                    className="mx-5 mt-6"
                  >
                    <View className="flex-row items-center mb-3">
                      <TrendingUp size={18} color="#64748b" />
                      <Text className="text-slate-400 text-sm font-semibold ml-2 uppercase tracking-wider">
                        7-Day Projection
                      </Text>
                    </View>
                    <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                      {projectionData.projection.map((day, index) => {
                        const dayName = new Date(day.date + "T12:00:00Z").toLocaleDateString(
                          "en-US",
                          { weekday: "short", month: "short", day: "numeric" }
                        );
                        return (
                          <View key={day.date}>
                            {index > 0 && <View className="h-px bg-slate-700/30 my-2" />}
                            <View className="flex-row items-center justify-between py-2">
                              <Text className="text-slate-400">{dayName}</Text>
                              <View className="flex-row items-center">
                                {day.scheduledFlights > 0 && (
                                  <View className="flex-row items-center mr-3 bg-blue-500/20 px-2 py-1 rounded-full">
                                    <Plane size={12} color="#3b82f6" />
                                    <Text className="text-blue-400 text-xs ml-1">
                                      {day.scheduledFlights} leg
                                      {day.scheduledFlights > 1 ? "s" : ""}
                                    </Text>
                                  </View>
                                )}
                                <View
                                  className={`px-2 py-1 rounded-full ${getStatusBg(
                                    day.projectedStatus
                                  )}`}
                                >
                                  <Text
                                    style={{ color: getStatusColor(day.projectedStatus) }}
                                    className="text-xs font-medium"
                                  >
                                    {formatMinutes(day.projectedMinutes)}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </Animated.View>
                )}

                {/* Info */}
                <Animated.View
                  entering={FadeInDown.duration(600).delay(300)}
                  className="mx-5 mt-6"
                >
                  <View className="bg-blue-900/20 rounded-xl p-4 border border-blue-700/30">
                    <Text className="text-blue-300 text-sm">
                      FAR 117.23 limits flight crew to 30 hours of flight time in any
                      consecutive 7-day period. Yellow warning appears at 27 hours (90%).
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
