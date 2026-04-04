/**
 * Sick Summary Card Component
 * Displays rolling 12-month sick usage summary with legal disclaimer
 * Uses red/white color scheme for sick indicators
 */

import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Heart, Calendar, Clock, ChevronRight, AlertTriangle } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import { useSickSummary, useSickHistory, type SickCallEvent } from '@/lib/useSickTracking';

interface SickSummaryCardProps {
  onViewHistory?: () => void;
  className?: string;
}

/**
 * Format date for display (e.g., "Jan 15, 2025")
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Main sick summary card for displaying rolling 12-month sick stats
 */
export function SickSummaryCard({ onViewHistory, className }: SickSummaryCardProps) {
  const { data: summary, isLoading, error } = useSickSummary();

  if (isLoading) {
    return (
      <View className={cn('bg-slate-800/60 rounded-2xl p-4', className)}>
        <View className="flex-row items-center mb-3">
          <Heart size={20} color="#ef4444" fill="white" />
          <Text className="text-white font-semibold text-base ml-2">Sick Summary</Text>
        </View>
        <View className="items-center py-6">
          <ActivityIndicator color="#ef4444" />
          <Text className="text-slate-400 text-sm mt-2">Loading...</Text>
        </View>
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View className={cn('bg-slate-800/60 rounded-2xl p-4', className)}>
        <View className="flex-row items-center mb-3">
          <Heart size={20} color="#ef4444" fill="white" />
          <Text className="text-white font-semibold text-base ml-2">Sick Summary</Text>
        </View>
        <View className="items-center py-4">
          <AlertTriangle size={24} color="#f59e0b" />
          <Text className="text-amber-400 text-sm mt-2">Unable to load sick summary</Text>
        </View>
      </View>
    );
  }

  const { sickCallsCount, sickDaysCovered, sickCreditFormatted } = summary.summary;
  const { startDate, endDate } = summary.rollingWindow;

  const handleViewHistory = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onViewHistory?.();
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400).springify()}
      className={cn('bg-red-500/10 border border-red-500/30 rounded-2xl p-4', className)}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-4">
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-xl bg-red-500/20 items-center justify-center">
            <Heart size={22} color="#ef4444" fill="white" />
          </View>
          <View className="ml-3">
            <Text className="text-white font-semibold text-base">Sick Usage Summary</Text>
            <Text className="text-red-400/80 text-xs">Rolling 12-Month Window</Text>
          </View>
        </View>
        {onViewHistory && (
          <Pressable
            onPress={handleViewHistory}
            className="flex-row items-center bg-red-500/20 px-3 py-2 rounded-lg active:bg-red-500/30"
          >
            <Text className="text-red-400 text-sm font-medium">History</Text>
            <ChevronRight size={16} color="#ef4444" />
          </Pressable>
        )}
      </View>

      {/* Window dates */}
      <View className="flex-row items-center mb-4 bg-slate-900/50 rounded-lg px-3 py-2">
        <Calendar size={14} color="#64748b" />
        <Text className="text-slate-400 text-xs ml-2">
          {formatDate(startDate)} — {formatDate(endDate)}
        </Text>
      </View>

      {/* Stats Grid */}
      <View className="flex-row gap-2 mb-4">
        {/* Sick Calls */}
        <View className="flex-1 bg-slate-900/50 rounded-xl p-3">
          <Text className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">Sick Calls</Text>
          <Text className="text-white text-2xl font-bold" style={{ fontFamily: 'JetBrainsMono_700Bold' }}>
            {sickCallsCount}
          </Text>
          <Text className="text-slate-500 text-[10px]">distinct events</Text>
        </View>

        {/* Days Covered */}
        <View className="flex-1 bg-slate-900/50 rounded-xl p-3">
          <Text className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">Days Covered</Text>
          <Text className="text-white text-2xl font-bold" style={{ fontFamily: 'JetBrainsMono_700Bold' }}>
            {sickDaysCovered}
          </Text>
          <Text className="text-slate-500 text-[10px]">unique dates</Text>
        </View>

        {/* Sick Credit */}
        <View className="flex-1 bg-slate-900/50 rounded-xl p-3">
          <Text className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">Sick Credit</Text>
          <Text className="text-red-400 text-2xl font-bold" style={{ fontFamily: 'JetBrainsMono_700Bold' }}>
            {sickCreditFormatted}
          </Text>
          <Text className="text-slate-500 text-[10px]">hours</Text>
        </View>
      </View>

      {/* Empty State */}
      {sickCallsCount === 0 && (
        <View className="bg-slate-900/30 rounded-lg px-3 py-2 mb-4">
          <Text className="text-red-400 text-sm text-center">
            No sick events recorded in the past 12 months
          </Text>
        </View>
      )}

      {/* Legal Disclaimer */}
      <View className="bg-slate-900/30 rounded-lg px-3 py-2">
        <Text className="text-slate-500 text-[10px] leading-tight text-center">
          {summary.disclaimer}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Compact sick summary widget for dashboard/home screen
 */
export function SickSummaryWidget({ onPress, className }: { onPress?: () => void; className?: string }) {
  const { data: summary, isLoading } = useSickSummary();

  if (isLoading || !summary) {
    return null;
  }

  const { sickCallsCount, sickCreditFormatted } = summary.summary;

  // Don't show widget if no sick events
  if (sickCallsCount === 0) {
    return null;
  }

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 active:bg-red-500/20',
        className
      )}
    >
      <Heart size={16} color="#ef4444" fill="white" />
      <Text className="text-red-400 text-sm font-medium ml-2">
        {sickCallsCount} sick call{sickCallsCount !== 1 ? 's' : ''} • {sickCreditFormatted}
      </Text>
      <View className="flex-1" />
      <ChevronRight size={16} color="#ef4444" />
    </Pressable>
  );
}

/**
 * Sick history list for viewing past sick events
 */
export function SickHistoryList({ limit = 50 }: { limit?: number }) {
  const { data, isLoading, error } = useSickHistory({ limit, includeVoided: false });

  if (isLoading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color="#ef4444" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View className="items-center py-8">
        <AlertTriangle size={24} color="#f59e0b" />
        <Text className="text-amber-400 text-sm mt-2">Unable to load history</Text>
      </View>
    );
  }

  if (data.events.length === 0) {
    return (
      <View className="items-center py-8">
        <Heart size={32} color="#64748b" />
        <Text className="text-slate-400 text-sm mt-2">No sick events recorded</Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      {data.events.map((event, index) => (
        <SickEventCard key={event.id} event={event} index={index} />
      ))}

      {/* Disclaimer at bottom */}
      <View className="bg-slate-900/30 rounded-lg px-3 py-2 mt-2">
        <Text className="text-slate-500 text-[10px] leading-tight text-center">
          {data.disclaimer}
        </Text>
      </View>
    </View>
  );
}

/**
 * Individual sick event card
 */
function SickEventCard({ event, index }: { event: SickCallEvent; index: number }) {
  const dateStr = event.startDateLocal
    ? event.endDateLocal && event.startDateLocal !== event.endDateLocal
      ? `${formatDate(event.startDateLocal)} - ${formatDate(event.endDateLocal)}`
      : formatDate(event.startDateLocal)
    : 'Unknown date';

  const formatMinutes = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
  };

  // Parse legs from linkedLegs
  const legSummary = event.linkedLegs?.map(link => {
    const leg = link.tripDutyLeg;
    if (leg) {
      return `${leg.origin || '?'}-${leg.destination || '?'}`;
    }
    return null;
  }).filter(Boolean).join(', ') || null;

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(index * 50)}
      className="bg-slate-800/60 rounded-xl p-3"
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Heart size={14} color="#ef4444" fill="white" />
          <Text className="text-white font-medium ml-2">{dateStr}</Text>
        </View>
        <View className="bg-red-500/20 px-2 py-0.5 rounded">
          <Text className="text-red-400 text-xs font-bold">{formatMinutes(event.sickCreditMinutes)}</Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <View className="flex-row items-center bg-slate-700/40 px-2 py-1 rounded">
          <Calendar size={12} color="#64748b" />
          <Text className="text-slate-400 text-xs ml-1">{event.sickDaysCount} day{event.sickDaysCount !== 1 ? 's' : ''}</Text>
        </View>
        <View className="flex-row items-center bg-slate-700/40 px-2 py-1 rounded">
          <Text className="text-slate-400 text-xs">{event.scope.replace('_', ' ')}</Text>
        </View>
      </View>

      {legSummary && (
        <Text className="text-slate-500 text-xs mt-2">{legSummary}</Text>
      )}

      {event.userNotes && (
        <Text className="text-slate-400 text-xs mt-2 italic">"{event.userNotes}"</Text>
      )}
    </Animated.View>
  );
}
