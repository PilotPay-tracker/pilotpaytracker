/**
 * Review Changes Screen - Phase 6
 * Crew Access Style comparison of old vs new roster
 *
 * Required when:
 * - acknowledgment_required = true
 * - OR user manually chooses to review changes
 *
 * Features:
 * - Left/Right column comparison (Original vs Current)
 * - Change summary at top
 * - Credit explanation box (mandatory)
 * - Acknowledgment flow for Moderate/Major changes
 */

import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, useMemo, useCallback, useEffect } from 'react';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  Shield,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Clock,
  Plane,
  FileWarning,
  Info,
  FileText,
  DollarSign,
} from 'lucide-react-native';
import { QuickFeedback } from '@/components/FeedbackComponents';
import {
  useFonts,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';

import { useTrip, useTrips } from '@/lib/useTripsData';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================
// TYPES
// ============================================

interface RosterSnapshot {
  dutyDays: DutyDaySnapshot[];
  totalCreditMinutes: number;
  legCount: number;
  dutyDaysCount: number;
}

interface DutyDaySnapshot {
  dayIndex: number;
  dutyDate: string;
  reportTimeISO?: string;
  releaseTimeISO?: string;
  legs: LegSnapshot[];
  layover?: {
    station: string;
    restMinutes: number;
  };
}

interface LegSnapshot {
  legIndex: number;
  flightNumber?: string;
  origin: string;
  destination: string;
  scheduledOutISO?: string;
  scheduledInISO?: string;
  equipment?: string;
  isDeadhead: boolean;
}

// ============================================
// HELPERS
// ============================================

function formatMinutesToTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

function formatTimeFromISO(iso: string | undefined): string {
  if (!iso) return '--:--';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    });
  } catch {
    return '--:--';
  }
}

function formatDateShort(dateString: string): string {
  try {
    const date = new Date(dateString + 'T00:00:00Z');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateString;
  }
}

// Severity colors and labels
const SEVERITY_CONFIG = {
  none: { color: '#64748b', bg: '#64748b20', label: 'No Changes' },
  minor: { color: '#22c55e', bg: '#22c55e20', label: 'Minor' },
  moderate: { color: '#f59e0b', bg: '#f59e0b20', label: 'Moderate' },
  moderate_ack: { color: '#f59e0b', bg: '#f59e0b20', label: 'Moderate' },
  major: { color: '#ef4444', bg: '#ef444420', label: 'Major' },
  major_ack: { color: '#ef4444', bg: '#ef444420', label: 'Major' },
} as const;

// ============================================
// COMPONENTS
// ============================================

/**
 * Change Summary Card - Shows list of changes in plain English
 */
function ChangeSummaryCard({ changes }: { changes: string[] }) {
  if (!changes || changes.length === 0) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(100)}
      className="bg-slate-800/80 rounded-xl p-4 mb-4"
    >
      <View className="flex-row items-center mb-3">
        <AlertTriangle size={16} color="#f59e0b" />
        <Text className="text-amber-400 text-sm font-semibold ml-2">
          Changes Detected ({changes.length})
        </Text>
      </View>
      {changes.map((change, index) => (
        <View key={index} className="flex-row items-start mb-2">
          <View className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 mr-2" />
          <Text className="text-slate-300 text-sm flex-1">{change}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

/**
 * Credit Explanation Box - MANDATORY per Phase 6
 */
function CreditExplanationBox({
  protectedCredit,
  currentCredit,
  payCredit,
}: {
  protectedCredit: number;
  currentCredit: number;
  payCredit: number;
}) {
  const isProtected = protectedCredit > currentCredit;

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(200)}
      className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-4"
    >
      <View className="flex-row items-center mb-3">
        <Shield size={18} color="#10b981" />
        <Text className="text-emerald-400 text-base font-bold ml-2">
          Pay Credit Calculation
        </Text>
      </View>

      {/* Credit breakdown */}
      <View className="bg-slate-900/50 rounded-lg p-3 mb-3">
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Protected Credit (Awarded)</Text>
          <Text className="text-white text-sm font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(protectedCredit)}
          </Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">New Roster Credit</Text>
          <Text className={`text-sm font-bold ${currentCredit < protectedCredit ? 'text-red-400' : 'text-white'}`} style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(currentCredit)}
            {currentCredit < protectedCredit && (
              <Text className="text-red-400/70 text-xs"> (−{formatMinutesToTime(protectedCredit - currentCredit)})</Text>
            )}
          </Text>
        </View>
        <View className="h-px bg-slate-700 my-2" />
        <View className="flex-row justify-between">
          <Text className="text-emerald-400 text-sm font-semibold">Pay Credit Used</Text>
          <Text className="text-emerald-400 text-sm font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(payCredit)}
            {isProtected && (
              <Text className="text-emerald-400/70 text-xs"> (protected)</Text>
            )}
          </Text>
        </View>
      </View>

      {/* Explanation text */}
      <View className="flex-row items-start">
        <Info size={14} color="#64748b" className="mt-0.5" />
        <Text className="text-slate-400 text-xs ml-2 flex-1 leading-5">
          We always use the higher of your awarded credit or your current roster credit.{' '}
          <Text className="text-emerald-400 font-semibold">
            Company changes cannot reduce your awarded trip credit.
          </Text>
        </Text>
      </View>

      {/* Feedback for AI explanation */}
      <View className="flex-row items-center justify-end mt-3 pt-2 border-t border-emerald-500/20">
        <QuickFeedback
          explanationType="roster_change"
          entityId={`credit_explanation_${protectedCredit}_${currentCredit}`}
          size="sm"
          label="Was this clear?"
        />
      </View>
    </Animated.View>
  );
}

/**
 * Roster Comparison View - Side by side old vs new
 */
function RosterComparisonView({
  original,
  current,
}: {
  original: RosterSnapshot | null;
  current: RosterSnapshot | null;
}) {
  if (!original || !current) {
    return (
      <View className="bg-slate-800/50 rounded-xl p-4 items-center">
        <Text className="text-slate-400">No roster data available for comparison</Text>
      </View>
    );
  }

  const maxDays = Math.max(original.dutyDays.length, current.dutyDays.length);

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(300)}
      className="mb-4"
    >
      {/* Header */}
      <View className="flex-row mb-2">
        <View className="flex-1 mr-1">
          <View className="bg-slate-700/60 rounded-t-lg px-3 py-2">
            <Text className="text-slate-300 text-xs font-semibold text-center">
              ORIGINAL ROSTER
            </Text>
          </View>
        </View>
        <View className="flex-1 ml-1">
          <View className="bg-amber-500/20 rounded-t-lg px-3 py-2">
            <Text className="text-amber-400 text-xs font-semibold text-center">
              NEW ROSTER
            </Text>
          </View>
        </View>
      </View>

      {/* Day-by-day comparison */}
      {Array.from({ length: maxDays }).map((_, dayIndex) => {
        const origDay = original.dutyDays[dayIndex];
        const currDay = current.dutyDays[dayIndex];

        return (
          <View key={dayIndex} className="flex-row mb-2">
            {/* Original column */}
            <View className="flex-1 mr-1 bg-slate-800/60 rounded-lg p-2">
              {origDay ? (
                <>
                  <Text className="text-slate-400 text-[10px] font-semibold mb-1">
                    Day {origDay.dayIndex} • {formatDateShort(origDay.dutyDate)}
                  </Text>
                  <Text className="text-slate-500 text-[9px] mb-1">
                    Report: {formatTimeFromISO(origDay.reportTimeISO)} • Release: {formatTimeFromISO(origDay.releaseTimeISO)}
                  </Text>
                  {origDay.legs.map((leg, legIdx) => (
                    <View key={legIdx} className="flex-row items-center py-0.5">
                      <Plane size={10} color={leg.isDeadhead ? '#94a3b8' : '#06b6d4'} />
                      <Text className="text-slate-300 text-[10px] ml-1" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                        {leg.flightNumber || 'DH'} {leg.origin}-{leg.destination}
                      </Text>
                    </View>
                  ))}
                  {origDay.layover && (
                    <Text className="text-purple-400 text-[9px] mt-1">
                      ✈ Layover: {origDay.layover.station} ({formatMinutesToTime(origDay.layover.restMinutes)})
                    </Text>
                  )}
                </>
              ) : (
                <Text className="text-slate-600 text-xs italic">—</Text>
              )}
            </View>

            {/* Arrow indicator */}
            <View className="justify-center px-1">
              <ArrowRight size={14} color="#64748b" />
            </View>

            {/* Current column */}
            <View className="flex-1 ml-1 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
              {currDay ? (
                <>
                  <Text className="text-amber-400 text-[10px] font-semibold mb-1">
                    Day {currDay.dayIndex} • {formatDateShort(currDay.dutyDate)}
                  </Text>
                  <Text className="text-amber-400/60 text-[9px] mb-1">
                    Report: {formatTimeFromISO(currDay.reportTimeISO)} • Release: {formatTimeFromISO(currDay.releaseTimeISO)}
                  </Text>
                  {currDay.legs.map((leg, legIdx) => (
                    <View key={legIdx} className="flex-row items-center py-0.5">
                      <Plane size={10} color={leg.isDeadhead ? '#94a3b8' : '#f59e0b'} />
                      <Text className="text-amber-300 text-[10px] ml-1" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                        {leg.flightNumber || 'DH'} {leg.origin}-{leg.destination}
                      </Text>
                    </View>
                  ))}
                  {currDay.layover && (
                    <Text className="text-purple-400 text-[9px] mt-1">
                      ✈ Layover: {currDay.layover.station} ({formatMinutesToTime(currDay.layover.restMinutes)})
                    </Text>
                  )}
                </>
              ) : (
                <Text className="text-red-400 text-xs italic">Removed</Text>
              )}
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

/**
 * Acknowledgment Button - Disabled until user confirms for Moderate/Major changes
 */
function AcknowledgmentButton({
  severity,
  isAcknowledging,
  onAcknowledge,
}: {
  severity: string;
  isAcknowledging: boolean;
  onAcknowledge: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const requiresConfirmation = severity === 'moderate' || severity === 'moderate_ack' || severity === 'major' || severity === 'major_ack';
  const isMinor = severity === 'minor' || severity === 'none';

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (requiresConfirmation && !confirmed) {
      setConfirmed(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      onAcknowledge();
    }
  }, [requiresConfirmation, confirmed, onAcknowledge]);

  // For minor changes, just show "Apply Update" (no acknowledgment required)
  if (isMinor) {
    return (
      <Pressable
        onPress={onAcknowledge}
        disabled={isAcknowledging}
        className="bg-cyan-500 rounded-xl py-4 items-center active:bg-cyan-600"
      >
        <Text className="text-white text-base font-bold">
          {isAcknowledging ? 'Applying...' : 'Apply Update'}
        </Text>
      </Pressable>
    );
  }

  // For Moderate/Major changes, require acknowledgment
  return (
    <View>
      {!confirmed ? (
        <Pressable
          onPress={handlePress}
          className="bg-slate-700 rounded-xl py-4 items-center active:bg-slate-600"
        >
          <View className="flex-row items-center">
            <FileWarning size={18} color="#f59e0b" />
            <Text className="text-amber-400 text-base font-bold ml-2">
              Review Required — Tap to Confirm
            </Text>
          </View>
          <Text className="text-slate-400 text-xs mt-1">
            Please confirm you have reviewed all changes
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={handlePress}
          disabled={isAcknowledging}
          className="bg-amber-500 rounded-xl py-4 items-center active:bg-amber-600"
        >
          <View className="flex-row items-center">
            <CheckCircle2 size={18} color="#fff" />
            <Text className="text-white text-base font-bold ml-2">
              {isAcknowledging ? 'Acknowledging...' : 'Acknowledge & Apply Update'}
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ReviewChangesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId: string }>();
  const tripId = params.tripId;
  const queryClient = useQueryClient();

  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  // Fetch trip data
  const { data: tripData, isLoading, error: tripError, refetch } = useTrip(tripId ?? null);
  const trip = tripData?.trip;

  // Auto-dismiss stale action item and return to dashboard when trip is not found (404)
  useEffect(() => {
    const is404 = (tripError as any)?.status === 404 ||
      (tripError as any)?.message?.includes('404') ||
      (tripError as any)?.message?.includes('not found');
    if (is404 && tripId) {
      // Invalidate trips cache so dashboard refreshes and removes stale action item
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trips-period'] });
      // Navigate back to dashboard
      router.replace('/(tabs)');
    }
  }, [tripError, tripId, queryClient, router]);

  // Parse roster snapshots from trip data
  const originalSnapshot = useMemo<RosterSnapshot | null>(() => {
    if (!trip) return null;
    const raw = (trip as any).originalRosterSnapshot;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }, [trip]);

  const currentSnapshot = useMemo<RosterSnapshot | null>(() => {
    if (!trip) return null;
    const raw = (trip as any).currentRosterSnapshot;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }, [trip]);

  // Parse change summary
  const changeSummary = useMemo<string[]>(() => {
    if (!trip) return [];
    const raw = (trip as any).changeSummary;
    if (!raw) return [];
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return [];
    }
  }, [trip]);

  // Get severity and acknowledgment state
  const changeSeverity = ((trip as any)?.changeSeverity as string) ?? 'none';
  const acknowledgmentRequired = ((trip as any)?.acknowledgmentRequired as boolean) ?? false;
  const acknowledgedAt = ((trip as any)?.acknowledgedAt as string | null) ?? null;

  // Credit values
  const protectedCredit = ((trip as any)?.protectedCreditMinutes as number) ?? 0;
  const currentCredit = ((trip as any)?.currentCreditMinutes as number) ?? trip?.totalCreditMinutes ?? 0;
  const payCredit = ((trip as any)?.payCreditMinutes as number) ?? Math.max(protectedCredit, currentCredit);

  // Acknowledgment mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/api/trips/${tripId}/acknowledge`, {});
      return response;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trips-period'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-changes'] });
      queryClient.invalidateQueries({ queryKey: ['roster-changes'] });
      Alert.alert(
        'Update Applied',
        'The roster change has been acknowledged and applied.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)') }]
      );
    },
    onError: (error) => {
      console.error('Acknowledge failed:', error);
      Alert.alert('Error', 'Failed to acknowledge the change. Please try again.');
    },
  });

  const { mutate: acknowledgeTrip, isPending: isAcknowledging } = acknowledgeMutation;

  // Mark as reviewed (clears needsReview flag) when acknowledgmentRequired is false
  const { mutate: markReviewed } = useMutation({
    mutationFn: async () => {
      return api.post(`/api/trips/${tripId}/mark-reviewed`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trips-period'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-changes'] });
    },
  });

  const handleAcknowledge = useCallback(() => {
    acknowledgeTrip();
  }, [acknowledgeTrip]);

  const handleGoBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // If trip still needs review but no formal acknowledgment required, clear it now
    const tripNeedsReview = (trip as any)?.needsReview as boolean;
    if (tripNeedsReview && !acknowledgmentRequired && !acknowledgedAt) {
      markReviewed();
    }
    router.replace('/(tabs)');
  }, [router, trip, acknowledgmentRequired, acknowledgedAt, markReviewed]);

  const severityConfig = SEVERITY_CONFIG[changeSeverity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.none;

  if (!fontsLoaded) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Text className="text-slate-400">Loading...</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Text className="text-slate-400">Loading trip data...</Text>
      </View>
    );
  }

  if (!trip) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Text className="text-slate-400">Trip not found</Text>
        <Pressable onPress={handleGoBack} className="mt-4 bg-slate-800 px-4 py-2 rounded-lg">
          <Text className="text-white">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0f172a', '#020617']}
        style={{ flex: 1, paddingTop: insets.top }}
      >
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
          <Pressable
            onPress={handleGoBack}
            className="p-2 -ml-2 rounded-lg active:bg-slate-800"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color="#fff" />
          </Pressable>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-bold" style={{ fontFamily: 'DMSans_700Bold' }}>
              Review Changes
            </Text>
            <Text className="text-slate-400 text-xs">
              {trip.tripNumber || 'Trip'} • {trip.startDate}
            </Text>
          </View>
          {/* Severity badge */}
          <View
            className="px-3 py-1.5 rounded-full"
            style={{ backgroundColor: severityConfig.bg }}
          >
            <Text style={{ color: severityConfig.color }} className="text-xs font-bold">
              {severityConfig.label}
            </Text>
          </View>
        </View>

        {/* Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Already acknowledged notice */}
          {acknowledgedAt && (
            <Animated.View
              entering={FadeIn.duration(300)}
              className="bg-emerald-500/20 border border-emerald-500/30 rounded-xl p-4 mb-4"
            >
              <View className="flex-row items-center">
                <CheckCircle2 size={18} color="#10b981" />
                <Text className="text-emerald-400 text-sm font-semibold ml-2">
                  Changes Acknowledged
                </Text>
              </View>
              <Text className="text-emerald-400/70 text-xs mt-1">
                Acknowledged on {new Date(acknowledgedAt).toLocaleDateString()}
              </Text>
            </Animated.View>
          )}

          {/* Change Summary */}
          <ChangeSummaryCard changes={changeSummary} />

          {/* Credit Explanation Box - MANDATORY */}
          <CreditExplanationBox
            protectedCredit={protectedCredit}
            currentCredit={currentCredit}
            payCredit={payCredit}
          />

          {/* Roster Comparison */}
          <Text className="text-white text-sm font-semibold mb-2">Roster Comparison</Text>
          <RosterComparisonView
            original={originalSnapshot}
            current={currentSnapshot}
          />

          {/* PHASE 7: Create Log Event Draft CTA */}
          {changeSummary.length > 0 && (
            <Animated.View
              entering={FadeInDown.duration(300).delay(400)}
              className="mt-4 mb-4"
            >
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  // Navigate to create-log-event with trip context
                  router.push({
                    pathname: '/create-log-event',
                    params: {
                      tripId: tripId,
                      changeType: changeSeverity === 'major' ? 'schedule_change' :
                                  changeSeverity === 'moderate' ? 'timing_change' : 'minor_change',
                    },
                  });
                }}
                className="bg-emerald-500/20 border border-emerald-500/40 rounded-xl p-4 active:bg-emerald-500/30"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="w-10 h-10 rounded-xl bg-emerald-500/30 items-center justify-center">
                      <FileText size={20} color="#10b981" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-emerald-400 text-base font-semibold">
                        Create Log Event Draft
                      </Text>
                      <Text className="text-emerald-400/70 text-xs mt-0.5">
                        Document this change with premium codes
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center bg-emerald-500/30 px-3 py-1.5 rounded-lg">
                    <DollarSign size={14} color="#10b981" />
                    <Text className="text-emerald-400 text-xs font-semibold ml-1">Premium</Text>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>

        {/* Fixed bottom action area */}
        {!acknowledgedAt && acknowledgmentRequired && (
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <AcknowledgmentButton
              severity={changeSeverity}
              isAcknowledging={isAcknowledging}
              onAcknowledge={handleAcknowledge}
            />
          </View>
        )}

        {/* For already acknowledged or no acknowledgment required */}
        {(acknowledgedAt || !acknowledgmentRequired) && (
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Pressable
              onPress={handleGoBack}
              className="bg-slate-700 rounded-xl py-4 items-center active:bg-slate-600"
            >
              <Text className="text-white text-base font-semibold">Done</Text>
            </Pressable>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}
