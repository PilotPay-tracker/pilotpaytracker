/**
 * TripPremiumSummary Component
 *
 * Shows premium pay roll-up for a trip with leg-level breakdown.
 * Displays total premiums and allows expanding to see per-leg details.
 */

import { View, Text, Pressable } from 'react-native';
import { useState, useCallback } from 'react';
import {
  DollarSign,
  ChevronDown,
  ChevronUp,
  Plane,
  FileText,
  AlertCircle,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { cn } from '@/lib/cn';
import { useTripLogEventSummary, formatPremiumMinutes } from '@/lib/useLogEvents';

// ============================================
// Types
// ============================================

interface TripPremiumSummaryProps {
  tripId: string;
  tripNumber: string | null;
  baseCreditMinutes: number;
  compact?: boolean;
  onViewLogEvents?: () => void;
}

// ============================================
// Helper Components
// ============================================

function PremiumCodeChip({
  code,
  count,
  totalMinutes,
}: {
  code: string;
  count: number;
  totalMinutes: number;
}) {
  return (
    <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2 py-1 flex-row items-center mr-2 mb-2">
      <DollarSign size={12} color="#10b981" />
      <Text className="text-emerald-400 font-bold text-xs ml-1">{code}</Text>
      {count > 1 && (
        <Text className="text-emerald-400/60 text-[10px] ml-1">×{count}</Text>
      )}
      <Text className="text-emerald-400/80 text-xs ml-1">
        {formatPremiumMinutes(totalMinutes)}
      </Text>
    </View>
  );
}

function LegPremiumRow({
  origin,
  destination,
  flightNumber,
  premiumCode,
  premiumMinutes,
}: {
  origin: string;
  destination: string;
  flightNumber: string | null;
  premiumCode: string;
  premiumMinutes: number;
}) {
  return (
    <View className="flex-row items-center justify-between py-2 border-b border-slate-700/30">
      <View className="flex-row items-center flex-1">
        <Plane size={12} color="#64748b" />
        <Text className="text-slate-300 text-sm ml-2">
          {origin}–{destination}
        </Text>
        {flightNumber && (
          <Text className="text-slate-500 text-xs ml-2">FLT {flightNumber}</Text>
        )}
      </View>
      <View className="flex-row items-center">
        <View className="bg-emerald-500/10 px-1.5 py-0.5 rounded">
          <Text className="text-emerald-400 text-xs font-bold">{premiumCode}</Text>
        </View>
        <Text className="text-emerald-400 font-medium text-sm ml-2">
          {formatPremiumMinutes(premiumMinutes)}
        </Text>
      </View>
    </View>
  );
}

// ============================================
// Main Component
// ============================================

export function TripPremiumSummary({
  tripId,
  tripNumber,
  baseCreditMinutes,
  compact = false,
  onViewLogEvents,
}: TripPremiumSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: summary, isLoading, error } = useTripLogEventSummary(tripId);

  const handleToggleExpand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => !prev);
  }, []);

  const handleViewLogEvents = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onViewLogEvents?.();
  }, [onViewLogEvents]);

  // No premiums - don't show anything in compact mode
  if (compact && (!summary || summary.totalPremiumMinutes === 0)) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <View className="bg-slate-800/30 rounded-xl p-3 animate-pulse">
        <View className="h-4 w-24 bg-slate-700 rounded" />
      </View>
    );
  }

  // Error state
  if (error) {
    return null;
  }

  // No premiums recorded
  if (!summary || summary.totalPremiumMinutes === 0) {
    return (
      <View className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
        <View className="flex-row items-center">
          <DollarSign size={16} color="#64748b" />
          <Text className="text-slate-500 text-sm ml-2">No premiums recorded</Text>
        </View>
      </View>
    );
  }

  const { totalPremiumMinutes, totalCreditWithPremiums, premiumsByCode, premiumsByLeg, eventCount } = summary;

  // Compact view - just show total premium
  if (compact) {
    return (
      <Pressable
        onPress={handleToggleExpand}
        className="bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/30 flex-row items-center justify-between"
      >
        <View className="flex-row items-center">
          <DollarSign size={14} color="#10b981" />
          <Text className="text-emerald-400 font-medium text-sm ml-1">Premiums</Text>
        </View>
        <Text className="text-emerald-400 font-bold">
          {formatPremiumMinutes(totalPremiumMinutes)}
        </Text>
      </Pressable>
    );
  }

  // Full view with expandable details
  return (
    <View className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header - Always visible */}
      <Pressable
        onPress={handleToggleExpand}
        className="p-4 flex-row items-center justify-between"
      >
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-xl items-center justify-center bg-emerald-500/20">
            <DollarSign size={20} color="#10b981" />
          </View>
          <View className="ml-3">
            <Text className="text-white font-semibold">Premium Pay</Text>
            <Text className="text-slate-500 text-xs">
              {eventCount} log event{eventCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center">
          <View className="items-end mr-3">
            <Text className="text-emerald-400 font-bold text-lg">
              {formatPremiumMinutes(totalPremiumMinutes)}
            </Text>
            <Text className="text-slate-500 text-xs">
              Total: {formatPremiumMinutes(totalCreditWithPremiums)}
            </Text>
          </View>
          {expanded ? (
            <ChevronUp size={18} color="#64748b" />
          ) : (
            <ChevronDown size={18} color="#64748b" />
          )}
        </View>
      </Pressable>

      {/* Expanded Details */}
      {expanded && (
        <Animated.View entering={FadeIn.duration(200)} exiting={webSafeExit(FadeOut.duration(150))}>
          {/* Premium Codes Summary */}
          {premiumsByCode.length > 0 && (
            <View className="px-4 pb-3">
              <Text className="text-slate-400 text-xs font-medium mb-2">BY CODE</Text>
              <View className="flex-row flex-wrap">
                {premiumsByCode.map((item) => (
                  <PremiumCodeChip
                    key={item.code}
                    code={item.code}
                    count={item.count}
                    totalMinutes={item.totalMinutes}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Per-Leg Breakdown */}
          {premiumsByLeg.length > 0 && (
            <View className="px-4 pb-3">
              <Text className="text-slate-400 text-xs font-medium mb-2">BY LEG</Text>
              <View className="bg-slate-900/50 rounded-lg px-3">
                {premiumsByLeg.map((item, idx) => (
                  <LegPremiumRow
                    key={`${item.legId}-${idx}`}
                    origin={item.origin}
                    destination={item.destination}
                    flightNumber={item.flightNumber}
                    premiumCode={item.premiumCode}
                    premiumMinutes={item.premiumMinutes}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Credit Summary */}
          <View className="px-4 pb-4 pt-2 border-t border-slate-700/30 mx-4">
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-slate-400 text-sm">Base Credit</Text>
              <Text className="text-slate-300">{formatPremiumMinutes(baseCreditMinutes).replace('+', '')}</Text>
            </View>
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-emerald-400 text-sm">+ Premiums</Text>
              <Text className="text-emerald-400 font-medium">{formatPremiumMinutes(totalPremiumMinutes)}</Text>
            </View>
            <View className="h-px bg-slate-700 my-2" />
            <View className="flex-row justify-between items-center">
              <Text className="text-white font-semibold">Total Credit</Text>
              <Text className="text-white font-bold text-lg">{formatPremiumMinutes(totalCreditWithPremiums).replace('+', '')}</Text>
            </View>
          </View>

          {/* View Log Events Link */}
          {onViewLogEvents && (
            <Pressable
              onPress={handleViewLogEvents}
              className="mx-4 mb-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 flex-row items-center justify-center active:opacity-70"
            >
              <FileText size={14} color="#3b82f6" />
              <Text className="text-blue-400 font-medium text-sm ml-2">View Log Events</Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// ============================================
// Inline Premium Badge (for trip cards)
// ============================================

export function TripPremiumBadge({
  tripId,
}: {
  tripId: string;
}) {
  const { data: summary, isLoading } = useTripLogEventSummary(tripId);

  if (isLoading || !summary || summary.totalPremiumMinutes === 0) {
    return null;
  }

  return (
    <View className="bg-emerald-500/20 rounded px-1.5 py-0.5 flex-row items-center">
      <DollarSign size={10} color="#10b981" />
      <Text className="text-emerald-400 text-[10px] font-bold ml-0.5">
        {formatPremiumMinutes(summary.totalPremiumMinutes)}
      </Text>
    </View>
  );
}

// ============================================
// Empty State Component
// ============================================

export function NoPremiumsRecorded({
  tripId,
  onAddPremium,
}: {
  tripId: string;
  onAddPremium?: () => void;
}) {
  return (
    <View className="bg-slate-800/30 rounded-xl p-4 border border-dashed border-slate-600 items-center">
      <AlertCircle size={24} color="#64748b" />
      <Text className="text-slate-400 text-sm mt-2 text-center">
        No premium pay recorded for this trip
      </Text>
      {onAddPremium && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAddPremium();
          }}
          className="mt-3 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30"
        >
          <Text className="text-emerald-400 font-medium text-sm">Add Premium</Text>
        </Pressable>
      )}
    </View>
  );
}
