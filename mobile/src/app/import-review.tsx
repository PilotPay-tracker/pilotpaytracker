/**
 * Import Review Screen
 * Phase 6: Validation Gate UI
 *
 * Displays imports that need manual review before being saved to the schedule.
 * Users can:
 * - Review parsed trip data
 * - Confirm import (save to database)
 * - Dismiss import (discard)
 * - See validation warnings/errors
 */

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plane,
  Calendar,
  FileWarning,
  Trash2,
  Check,
  MapPin,
  Timer,
  Hotel,
  RefreshCw,
} from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getPendingReviews,
  confirmReviewedImport,
  dismissReview,
  type PendingReview,
  type RobustParsedTrip,
  type RobustParsedDutyDay,
  type RobustParsedLeg,
} from "@/lib/api";
import { cn } from "@/lib/cn";

// Format minutes to HH:MM
function formatMinutes(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "--:--";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

// Format time from ISO or HH:MM string
function formatTime(time: string | undefined): string {
  if (!time) return "--:--";
  // If it's already in HH:MM format
  if (/^\d{2}:\d{2}$/.test(time)) return time;
  // If it's an ISO string
  try {
    const date = new Date(time);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return time.substring(0, 5) || "--:--";
  }
}

// Leg row component
function LegRow({ leg, index }: { leg: RobustParsedLeg; index: number }) {
  const blockTime = formatMinutes(leg.blockMinutes);

  return (
    <View className="bg-slate-800/40 rounded-lg p-3 mb-2 border border-slate-700/50">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className={cn(
            "w-6 h-6 rounded-full items-center justify-center mr-2",
            leg.isDeadhead ? "bg-slate-600" : "bg-cyan-500/20"
          )}>
            <Text className={cn(
              "text-xs font-bold",
              leg.isDeadhead ? "text-slate-400" : "text-cyan-400"
            )}>
              {index + 1}
            </Text>
          </View>

          <View className="flex-1">
            <View className="flex-row items-center flex-wrap">
              <Text className="text-white font-semibold">
                {leg.departureAirport}
              </Text>
              <ChevronRight size={14} color="#64748b" />
              <Text className="text-white font-semibold">
                {leg.arrivalAirport}
              </Text>
              {leg.flightNumber && (
                <Text className="text-slate-500 text-xs ml-2">
                  {leg.flightNumber}
                </Text>
              )}
              {leg.equipment && (
                <View className="bg-slate-700/70 rounded px-1.5 py-0.5 ml-2">
                  <Text className="text-slate-300 text-[10px] font-bold">
                    {leg.equipment}
                  </Text>
                </View>
              )}
              {leg.isDeadhead && (
                <View className="bg-slate-600 rounded px-1.5 py-0.5 ml-2">
                  <Text className="text-slate-300 text-[10px] font-medium">DH</Text>
                </View>
              )}
            </View>

            <View className="flex-row items-center mt-1">
              <Clock size={12} color="#64748b" />
              <Text className="text-slate-400 text-xs ml-1">
                {formatTime(leg.departureTimeLocal)} - {formatTime(leg.arrivalTimeLocal)}
              </Text>
              <View className="w-1 h-1 bg-slate-600 rounded-full mx-2" />
              <Timer size={12} color="#64748b" />
              <Text className={cn(
                "text-xs ml-1",
                leg.blockMinutes > 0 ? "text-cyan-400" : "text-red-400"
              )}>
                BLK {blockTime}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Validation warning for 0 block time */}
      {leg.blockMinutes === 0 && !leg.isDeadhead && (
        <View className="flex-row items-center mt-2 bg-amber-500/10 rounded p-2">
          <AlertTriangle size={14} color="#f59e0b" />
          <Text className="text-amber-400 text-xs ml-2">
            Block time is 0:00 - verify departure/arrival times
          </Text>
        </View>
      )}
    </View>
  );
}

// Duty day section
function DutyDaySection({ dutyDay, dayIndex }: { dutyDay: RobustParsedDutyDay; dayIndex: number }) {
  const totalBlock = dutyDay.legs.reduce((sum, leg) => sum + (leg.blockMinutes || 0), 0);

  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Calendar size={14} color="#f59e0b" />
          <Text className="text-amber-400 font-semibold ml-2">
            Day {dayIndex + 1} - {dutyDay.date}
          </Text>
        </View>
        <Text className="text-slate-400 text-xs">
          {dutyDay.legs.length} leg{dutyDay.legs.length !== 1 ? "s" : ""} • BLK {formatMinutes(totalBlock)}
        </Text>
      </View>

      {/* Legs */}
      {dutyDay.legs.map((leg, legIndex) => (
        <LegRow key={`${dutyDay.date}-${legIndex}`} leg={leg} index={legIndex} />
      ))}

      {/* Layover info */}
      {dutyDay.layover && (
        <View className="bg-indigo-500/10 rounded-lg p-3 mt-2 border border-indigo-500/30">
          <View className="flex-row items-center">
            <Hotel size={14} color="#818cf8" />
            <Text className="text-indigo-300 font-medium ml-2">
              Layover at {dutyDay.layover.airport}
            </Text>
          </View>
          {dutyDay.layover.hotelName && (
            <Text className="text-slate-400 text-xs mt-1 ml-5">
              {dutyDay.layover.hotelName}
              {dutyDay.layover.hotelPhone && ` • ${dutyDay.layover.hotelPhone}`}
            </Text>
          )}
          {dutyDay.layover.restHours && (
            <Text className="text-indigo-400 text-xs mt-1 ml-5">
              Rest: {dutyDay.layover.restHours.toFixed(1)} hours
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// Trip review card
function TripReviewCard({
  review,
  trip,
  onConfirm,
  onDismiss,
  isConfirming,
  isDismissing,
}: {
  review: PendingReview;
  trip: RobustParsedTrip;
  onConfirm: () => void;
  onDismiss: () => void;
  isConfirming: boolean;
  isDismissing: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  const totalLegs = trip.dutyDays.reduce((sum, dd) => sum + dd.legs.length, 0);
  const hasZeroBlockLegs = trip.dutyDays.some(dd =>
    dd.legs.some(leg => leg.blockMinutes === 0 && !leg.isDeadhead)
  );

  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      className="bg-slate-900/80 rounded-2xl border border-slate-700/50 mb-4 overflow-hidden"
    >
      {/* Header */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setExpanded(!expanded);
        }}
        className="p-4 flex-row items-center justify-between"
      >
        <View className="flex-1">
          <View className="flex-row items-center flex-wrap">
            <Plane size={18} color="#06b6d4" />
            <Text className="text-white text-lg font-bold ml-2">
              Trip {trip.tripNumber}
            </Text>
            {trip.base && (
              <View className="bg-slate-700 rounded px-2 py-0.5 ml-2">
                <Text className="text-slate-300 text-xs">{trip.base}</Text>
              </View>
            )}
            {trip.equipment && (
              <View className="bg-cyan-500/20 rounded px-2 py-0.5 ml-2">
                <Text className="text-cyan-400 text-xs font-bold">{trip.equipment}</Text>
              </View>
            )}
          </View>

          <View className="flex-row items-center mt-1">
            <Text className="text-slate-400 text-sm">
              {trip.startDate} - {trip.endDate}
            </Text>
            <View className="w-1 h-1 bg-slate-600 rounded-full mx-2" />
            <Text className="text-slate-400 text-sm">
              {trip.dutyDays.length} days • {totalLegs} legs
            </Text>
          </View>

          {/* Confidence indicator */}
          <View className="flex-row items-center mt-2">
            <View className={cn(
              "px-2 py-0.5 rounded-full flex-row items-center",
              review.confidence >= 80 ? "bg-green-500/20" :
              review.confidence >= 60 ? "bg-amber-500/20" : "bg-red-500/20"
            )}>
              {review.confidence >= 80 ? (
                <CheckCircle size={12} color="#22c55e" />
              ) : review.confidence >= 60 ? (
                <AlertTriangle size={12} color="#f59e0b" />
              ) : (
                <XCircle size={12} color="#ef4444" />
              )}
              <Text className={cn(
                "text-xs font-medium ml-1",
                review.confidence >= 80 ? "text-green-400" :
                review.confidence >= 60 ? "text-amber-400" : "text-red-400"
              )}>
                {review.confidence}% confidence
              </Text>
            </View>

            <Text className="text-slate-500 text-xs ml-2">
              {review.templateType}
            </Text>
          </View>
        </View>

        <ChevronRight
          size={20}
          color="#64748b"
          style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
        />
      </Pressable>

      {/* Expanded content */}
      {expanded && (
        <View className="px-4 pb-4">
          {/* Warnings */}
          {review.warnings.length > 0 && (
            <View className="bg-amber-500/10 rounded-lg p-3 mb-4 border border-amber-500/30">
              <View className="flex-row items-center mb-2">
                <AlertTriangle size={16} color="#f59e0b" />
                <Text className="text-amber-400 font-semibold ml-2">
                  Warnings ({review.warnings.length})
                </Text>
              </View>
              {review.warnings.map((warning, i) => (
                <Text key={i} className="text-amber-300 text-sm mb-1">
                  • {warning}
                </Text>
              ))}
            </View>
          )}

          {/* Errors */}
          {review.errors.length > 0 && (
            <View className="bg-red-500/10 rounded-lg p-3 mb-4 border border-red-500/30">
              <View className="flex-row items-center mb-2">
                <XCircle size={16} color="#ef4444" />
                <Text className="text-red-400 font-semibold ml-2">
                  Errors ({review.errors.length})
                </Text>
              </View>
              {review.errors.map((error, i) => (
                <Text key={i} className="text-red-300 text-sm mb-1">
                  • {error}
                </Text>
              ))}
            </View>
          )}

          {/* Zero block warning */}
          {hasZeroBlockLegs && (
            <View className="bg-red-500/10 rounded-lg p-3 mb-4 border border-red-500/30">
              <View className="flex-row items-center">
                <FileWarning size={16} color="#ef4444" />
                <Text className="text-red-400 font-medium ml-2">
                  Some legs have 0:00 block time
                </Text>
              </View>
              <Text className="text-red-300 text-xs mt-1">
                This may indicate parsing errors. Please verify the times are correct.
              </Text>
            </View>
          )}

          {/* Totals */}
          <View className="flex-row justify-between bg-slate-800/60 rounded-lg p-3 mb-4">
            <View className="items-center">
              <Text className="text-slate-500 text-xs">Credit</Text>
              <Text className="text-cyan-400 font-bold">
                {formatMinutes(trip.creditMinutes)}
              </Text>
            </View>
            <View className="items-center">
              <Text className="text-slate-500 text-xs">Block</Text>
              <Text className="text-white font-bold">
                {formatMinutes(trip.blockMinutes)}
              </Text>
            </View>
            <View className="items-center">
              <Text className="text-slate-500 text-xs">TAFB</Text>
              <Text className="text-slate-300 font-bold">
                {formatMinutes(trip.tafbMinutes)}
              </Text>
            </View>
            <View className="items-center">
              <Text className="text-slate-500 text-xs">Days</Text>
              <Text className="text-slate-300 font-bold">
                {trip.dutyDays.length}
              </Text>
            </View>
          </View>

          {/* Duty days */}
          {trip.dutyDays.map((dutyDay, dayIndex) => (
            <DutyDaySection
              key={`${trip.tripNumber}-${dayIndex}`}
              dutyDay={dutyDay}
              dayIndex={dayIndex}
            />
          ))}

          {/* Actions */}
          <View className="flex-row mt-4 gap-3">
            <Pressable
              onPress={onDismiss}
              disabled={isDismissing || isConfirming}
              className={cn(
                "flex-1 flex-row items-center justify-center py-3 rounded-xl border",
                isDismissing ? "bg-slate-800 border-slate-700" : "bg-slate-800/60 border-slate-700/50 active:bg-slate-700"
              )}
            >
              {isDismissing ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <>
                  <Trash2 size={18} color="#ef4444" />
                  <Text className="text-red-400 font-semibold ml-2">Dismiss</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={onConfirm}
              disabled={isConfirming || isDismissing}
              className={cn(
                "flex-1 flex-row items-center justify-center py-3 rounded-xl",
                isConfirming ? "bg-cyan-700" : "bg-cyan-500 active:bg-cyan-600"
              )}
            >
              {isConfirming ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <>
                  <Check size={18} color="#0f172a" />
                  <Text className="text-slate-900 font-bold ml-2">Confirm Import</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

export default function ImportReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // Fetch pending reviews
  const {
    data: reviewsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["pending-reviews"],
    queryFn: getPendingReviews,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: confirmReviewedImport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error: Error) => {
      Alert.alert("Error", error.message || "Failed to confirm import");
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: dismissReview,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-reviews"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error: Error) => {
      Alert.alert("Error", error.message || "Failed to dismiss review");
    },
  });

  const { mutateAsync: confirmMutateAsync } = confirmMutation;
  const { mutateAsync: dismissMutateAsync } = dismissMutation;

  const handleConfirm = useCallback(async (reviewId: string) => {
    setConfirmingId(reviewId);
    try {
      await confirmMutateAsync(reviewId);
      Alert.alert("Success", "Trip imported successfully!");
    } finally {
      setConfirmingId(null);
    }
  }, [confirmMutateAsync]);

  const handleDismiss = useCallback(async (reviewId: string) => {
    Alert.alert(
      "Dismiss Import",
      "Are you sure you want to discard this import? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss",
          style: "destructive",
          onPress: async () => {
            setDismissingId(reviewId);
            try {
              await dismissMutateAsync(reviewId);
            } finally {
              setDismissingId(null);
            }
          },
        },
      ]
    );
  }, [dismissMutateAsync]);

  const reviews = reviewsData?.reviews ?? [];

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e293b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View
          style={{ paddingTop: insets.top + 8 }}
          className="px-5 pb-4 border-b border-slate-800/50"
        >
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:bg-slate-700"
            >
              <ChevronLeft size={24} color="#94a3b8" />
            </Pressable>

            <View className="flex-1 items-center">
              <Text className="text-white text-xl font-bold">Review Imports</Text>
              <Text className="text-slate-400 text-sm">
                {reviews.length} pending review{reviews.length !== 1 ? "s" : ""}
              </Text>
            </View>

            <Pressable
              onPress={() => refetch()}
              disabled={isRefetching}
              className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:bg-slate-700"
            >
              <RefreshCw
                size={20}
                color="#94a3b8"
                style={isRefetching ? { opacity: 0.5 } : undefined}
              />
            </Pressable>
          </View>
        </View>

        {/* Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#06b6d4"
            />
          }
        >
          {isLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" color="#06b6d4" />
              <Text className="text-slate-400 mt-4">Loading reviews...</Text>
            </View>
          ) : reviews.length === 0 ? (
            <Animated.View
              entering={FadeIn.duration(400)}
              className="flex-1 items-center justify-center py-20"
            >
              <View className="w-20 h-20 rounded-full bg-green-500/10 items-center justify-center mb-4">
                <CheckCircle size={40} color="#22c55e" />
              </View>
              <Text className="text-white text-xl font-bold mb-2">All Clear!</Text>
              <Text className="text-slate-400 text-center px-8">
                No imports need review. All your schedule imports have been processed successfully.
              </Text>
              <Pressable
                onPress={() => router.back()}
                className="mt-6 bg-cyan-500 px-6 py-3 rounded-xl active:bg-cyan-600"
              >
                <Text className="text-slate-900 font-bold">Back to Trips</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <>
              {/* Info banner */}
              <View className="bg-amber-500/10 rounded-xl p-4 mb-4 border border-amber-500/30">
                <View className="flex-row items-center mb-2">
                  <AlertTriangle size={18} color="#f59e0b" />
                  <Text className="text-amber-400 font-semibold ml-2">
                    Review Required
                  </Text>
                </View>
                <Text className="text-amber-300/80 text-sm">
                  These imports had low confidence scores or validation issues.
                  Please review the data before confirming.
                </Text>
              </View>

              {/* Review cards */}
              {reviews.map((review) => {
                // Parse the stored data
                const trips = review.parsedData as RobustParsedTrip[];
                return trips.map((trip, tripIndex) => (
                  <TripReviewCard
                    key={`${review.id}-${tripIndex}`}
                    review={review}
                    trip={trip}
                    onConfirm={() => handleConfirm(review.id)}
                    onDismiss={() => handleDismiss(review.id)}
                    isConfirming={confirmingId === review.id}
                    isDismissing={dismissingId === review.id}
                  />
                ));
              })}
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
