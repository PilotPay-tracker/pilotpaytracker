/**
 * ApplyPremiumSheet
 *
 * Lightweight bottom sheet that shows a pay preview and confirms applying
 * a premium code directly to a trip.
 *
 * Triggered when a user taps a premium code from the Premium Code Library
 * while a trip context is active.
 */

import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { useState } from 'react';
import {
  Zap,
  X,
  Check,
  DollarSign,
  Clock,
  Percent,
  ChevronRight,
  Shield,
} from 'lucide-react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatCentsToCurrency, formatMinutesToTime } from '@/lib/useTripsData';
import { tripPayEngineKeys } from '@/lib/useTripPayEngine';
import type { PremiumCode } from '@/lib/contracts';

// ============================================
// TYPES
// ============================================

export interface TripPremiumContext {
  tripId: string;
  tripNumber: string | null;
  baseCreditMinutes: number;
  basePayCents: number;
  startDate?: string;
  endDate?: string;
  aircraftType?: string;
  position?: string;
}

interface ApplyPremiumSheetProps {
  visible: boolean;
  premiumCode: PremiumCode | null;
  tripContext: TripPremiumContext | null;
  hourlyRateCents: number;
  onClose: () => void;
  onApplied: () => void;
}

// ============================================
// HELPERS
// ============================================

function calcPremiumImpact(
  code: PremiumCode,
  baseCreditMinutes: number,
  hourlyRateCents: number
): {
  creditDeltaMinutes: number;
  payDeltaCents: number;
  newPayCents: number;
  label: string;
  chipLabel: string;
} {
  const basePayCents = Math.round((baseCreditMinutes / 60) * hourlyRateCents);

  if (code.premiumType === 'multiplier' && code.premiumMultiplier) {
    const multipliedCredit = Math.round(baseCreditMinutes * code.premiumMultiplier);
    const creditDelta = multipliedCredit - baseCreditMinutes;
    const payDelta = Math.round((creditDelta / 60) * hourlyRateCents);
    return {
      creditDeltaMinutes: creditDelta,
      payDeltaCents: payDelta,
      newPayCents: basePayCents + payDelta,
      label: `${(code.premiumMultiplier * 100).toFixed(0)}% of base pay`,
      chipLabel: `${code.code} ${(code.premiumMultiplier * 100).toFixed(0)}%`,
    };
  }

  if (code.premiumType === 'minutes' && code.premiumMinutes) {
    const payDelta = Math.round((code.premiumMinutes / 60) * hourlyRateCents);
    return {
      creditDeltaMinutes: code.premiumMinutes,
      payDeltaCents: payDelta,
      newPayCents: basePayCents + payDelta,
      label: `+${formatMinutesToTime(code.premiumMinutes)} credit`,
      chipLabel: `${code.code} +${formatMinutesToTime(code.premiumMinutes)}`,
    };
  }

  return {
    creditDeltaMinutes: 0,
    payDeltaCents: 0,
    newPayCents: basePayCents,
    label: 'Manual entry required',
    chipLabel: code.code,
  };
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ApplyPremiumSheet({
  visible,
  premiumCode,
  tripContext,
  hourlyRateCents,
  onClose,
  onApplied,
}: ApplyPremiumSheetProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [applied, setApplied] = useState(false);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!premiumCode || !tripContext) throw new Error('Missing context');

      const payload: Record<string, unknown> = {
        tripId: tripContext.tripId,
        premiumCode: premiumCode.code,
        premiumName: premiumCode.title,
        premiumType: premiumCode.premiumType,
        originalPayCents: tripContext.basePayCents,
        contractReference: premiumCode.contractRef,
      };

      if (premiumCode.premiumType === 'multiplier' && premiumCode.premiumMultiplier) {
        payload.multiplierValue = premiumCode.premiumMultiplier;
      } else if (premiumCode.premiumType === 'minutes' && premiumCode.premiumMinutes) {
        payload.creditMinutesDelta = premiumCode.premiumMinutes;
      }

      return api.post<{ success: boolean; logEvent: Record<string, unknown>; payImpact: Record<string, unknown> }>(
        '/api/log-events/apply-premium',
        payload
      );
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setApplied(true);
      // Invalidate trip pay breakdown so the card refreshes
      if (tripContext?.tripId) {
        queryClient.invalidateQueries({
          queryKey: tripPayEngineKeys.breakdown(tripContext.tripId),
        });
      }
      setTimeout(() => {
        setApplied(false);
        onApplied();
      }, 900);
    },
  });

  if (!premiumCode || !tripContext) return null;

  const impact = calcPremiumImpact(premiumCode, tripContext.baseCreditMinutes, hourlyRateCents);
  const originalPayCents = Math.round((tripContext.baseCreditMinutes / 60) * hourlyRateCents);

  const isMultiplier = premiumCode.premiumType === 'multiplier';
  const isFixed = premiumCode.premiumType === 'minutes';
  const isManual = premiumCode.premiumType === 'manual';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={webSafeExit(FadeOut.duration(200))}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        {/* Sheet */}
        <Animated.View
          entering={SlideInDown.springify().damping(24).stiffness(300)}
          exiting={webSafeExit(SlideOutDown.duration(250))}
          style={{
            backgroundColor: '#0f172a',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: 'rgba(139,92,246,0.3)',
            paddingBottom: insets.bottom + 16,
          }}
        >
          {/* Handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-slate-700" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 py-3">
            <View className="flex-row items-center">
              <View className="bg-purple-500/20 p-2 rounded-xl mr-3">
                <Zap size={20} color="#a855f7" />
              </View>
              <View>
                <Text className="text-white font-bold text-lg" style={{ fontFamily: 'DMSans_700Bold' }}>
                  Apply Premium
                </Text>
                <Text className="text-slate-400 text-xs">
                  Trip {tripContext.tripNumber || tripContext.tripId.slice(-6).toUpperCase()}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              className="p-2 rounded-xl bg-slate-800 active:bg-slate-700"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={18} color="#94a3b8" />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
          >
            {/* Premium Code Card */}
            <View
              className="bg-slate-800/80 rounded-2xl p-4 mb-4 border border-purple-500/20"
            >
              <View className="flex-row items-start justify-between mb-2">
                <View className="flex-1">
                  <View className="flex-row items-center mb-1">
                    <View className="bg-purple-500/25 px-2.5 py-1 rounded-lg mr-2">
                      <Text
                        className="text-purple-300 font-bold text-base"
                        style={{ fontFamily: 'JetBrainsMono_400Regular' }}
                      >
                        {premiumCode.code}
                      </Text>
                    </View>
                    {isMultiplier && (
                      <View className="flex-row items-center bg-blue-500/20 px-2 py-0.5 rounded-lg">
                        <Percent size={10} color="#60a5fa" />
                        <Text className="text-blue-400 text-xs ml-1">Multiplier</Text>
                      </View>
                    )}
                    {isFixed && (
                      <View className="flex-row items-center bg-emerald-500/20 px-2 py-0.5 rounded-lg">
                        <Clock size={10} color="#34d399" />
                        <Text className="text-emerald-400 text-xs ml-1">Fixed Credit</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-white font-semibold text-sm" style={{ fontFamily: 'DMSans_600SemiBold' }}>
                    {premiumCode.title}
                  </Text>
                  {premiumCode.contractRef && (
                    <Text className="text-slate-500 text-xs mt-0.5">§ {premiumCode.contractRef}</Text>
                  )}
                </View>

                {/* Value pill */}
                <View className="ml-3 items-end">
                  {isMultiplier && premiumCode.premiumMultiplier ? (
                    <View className="bg-purple-500/20 px-3 py-1.5 rounded-xl items-center">
                      <Text className="text-purple-300 font-bold text-lg" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                        {(premiumCode.premiumMultiplier * 100).toFixed(0)}%
                      </Text>
                    </View>
                  ) : isFixed && premiumCode.premiumMinutes ? (
                    <View className="bg-emerald-500/20 px-3 py-1.5 rounded-xl items-center">
                      <Text className="text-emerald-300 font-bold text-lg" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                        +{formatMinutesToTime(premiumCode.premiumMinutes)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Pay Breakdown */}
            {!isManual && (
              <View className="bg-slate-800/60 rounded-2xl p-4 mb-4 border border-slate-700/50">
                <Text className="text-slate-400 text-xs uppercase font-semibold mb-3" style={{ letterSpacing: 1 }}>
                  Pay Impact
                </Text>

                {/* Base Pay Row */}
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <DollarSign size={14} color="#64748b" />
                    <Text className="text-slate-400 text-sm ml-1.5">Base Pay</Text>
                  </View>
                  <Text className="text-slate-300 text-sm font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                    {formatCentsToCurrency(originalPayCents)}
                  </Text>
                </View>

                {/* Premium Row */}
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center flex-1">
                    {isMultiplier ? (
                      <Percent size={14} color="#a855f7" />
                    ) : (
                      <Clock size={14} color="#a855f7" />
                    )}
                    <Text className="text-purple-400 text-sm ml-1.5">
                      {premiumCode.code} {isMultiplier
                        ? `${(premiumCode.premiumMultiplier! * 100).toFixed(0)}% Premium`
                        : `+${formatMinutesToTime(premiumCode.premiumMinutes ?? 0)} Premium`}
                    </Text>
                  </View>
                  <Text
                    className="text-purple-400 text-sm font-semibold"
                    style={{ fontFamily: 'JetBrainsMono_400Regular' }}
                  >
                    +{formatCentsToCurrency(impact.payDeltaCents)}
                  </Text>
                </View>

                {/* Divider */}
                <View className="border-t border-slate-700/60 mb-3" />

                {/* New Estimated Pay */}
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Shield size={15} color="#34d399" />
                    <Text className="text-emerald-400 text-sm font-bold ml-1.5">Estimated Pay After</Text>
                  </View>
                  <Text
                    className="text-emerald-400 text-xl font-bold"
                    style={{ fontFamily: 'JetBrainsMono_400Regular' }}
                  >
                    {formatCentsToCurrency(impact.newPayCents)}
                  </Text>
                </View>

                {/* Credit breakdown */}
                <View className="flex-row items-center mt-2 bg-slate-900/60 rounded-xl px-3 py-2">
                  <Text className="text-slate-500 text-xs">
                    {formatMinutesToTime(tripContext.baseCreditMinutes)} base credit
                  </Text>
                  <ChevronRight size={12} color="#475569" style={{ marginHorizontal: 4 }} />
                  <Text className="text-slate-300 text-xs font-semibold">
                    {formatMinutesToTime(tripContext.baseCreditMinutes + impact.creditDeltaMinutes)} pay credit
                  </Text>
                  <Text className="text-purple-400 text-xs ml-1">
                    (+{formatMinutesToTime(impact.creditDeltaMinutes)})
                  </Text>
                </View>
              </View>
            )}

            {isManual && (
              <View className="bg-amber-500/10 rounded-2xl p-4 mb-4 border border-amber-500/20">
                <Text className="text-amber-400 text-sm font-semibold mb-1">Manual Entry Required</Text>
                <Text className="text-amber-400/70 text-xs">
                  This premium requires additional inputs (e.g., actual arrival times). Applying it will log the event for manual calculation.
                </Text>
              </View>
            )}

            {applyMutation.error && (
              <View className="bg-red-500/10 rounded-xl p-3 mb-4 border border-red-500/20">
                <Text className="text-red-400 text-sm">
                  Failed to apply premium. Please try again.
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View className="px-5 pt-2 gap-3">
            {/* Apply Button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                applyMutation.mutate();
              }}
              disabled={applyMutation.isPending || applied}
              className="rounded-2xl overflow-hidden active:opacity-90"
              style={{
                backgroundColor: applied ? '#22c55e' : '#7c3aed',
                opacity: (applyMutation.isPending || applied) ? 0.9 : 1,
              }}
            >
              <View className="flex-row items-center justify-center py-4 gap-2">
                {applyMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : applied ? (
                  <Check size={20} color="#fff" />
                ) : (
                  <Zap size={20} color="#fff" />
                )}
                <Text className="text-white font-bold text-base" style={{ fontFamily: 'DMSans_700Bold' }}>
                  {applyMutation.isPending ? 'Applying…' : applied ? 'Premium Applied!' : 'Apply Premium'}
                </Text>
              </View>
            </Pressable>

            {/* Cancel */}
            <Pressable
              onPress={onClose}
              className="rounded-2xl bg-slate-800 active:bg-slate-700 py-3.5"
            >
              <Text className="text-slate-400 font-semibold text-center text-base">Cancel</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
