/**
 * LogEventListCard Component
 *
 * Displays a log event with leg-level headline format:
 * "MCO–RFD • FLT #### • Date"
 *
 * Shows premium pay badges and linked legs for detailed tracking.
 * Supports swipe-to-delete gesture.
 */

import { View, Text, Pressable, Alert } from 'react-native';
import {
  FileText,
  Plane,
  DollarSign,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
  Link2,
  Trash2,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { formatPremiumMinutes, getEventTypeLabel, getStatusColor } from '@/lib/useLogEvents';
import type { LogEventListItem, LogEventLegSummary } from '@/lib/contracts';

// ============================================
// Types
// ============================================

interface LogEventListCardProps {
  event: LogEventListItem;
  onPress?: () => void;
  onDelete?: (eventId: string) => void;
  compact?: boolean;
}

interface LegLineProps {
  leg: LogEventLegSummary;
}

// ============================================
// Helper Components
// ============================================

/**
 * Formats a date string to "Mon, Jan 1" format
 */
function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Single leg line with route and flight info
 */
function LegLine({ leg }: LegLineProps) {
  return (
    <View className="flex-row items-center mt-1.5">
      <View className="w-4 h-4 rounded items-center justify-center bg-slate-700/50 mr-2">
        <Plane size={10} color="#64748b" />
      </View>
      <Text className="text-slate-300 text-sm font-medium">
        {leg.origin}–{leg.destination}
      </Text>
      {leg.flightNumber && (
        <Text className="text-slate-500 text-xs ml-2">
          FLT {leg.flightNumber}
        </Text>
      )}
      {leg.isPrimary && (
        <View className="ml-2 bg-amber-500/20 px-1.5 py-0.5 rounded">
          <Text className="text-amber-400 text-[9px] font-bold">PRIMARY</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Premium badge showing code and time
 */
function PremiumBadge({
  code,
  minutes,
}: {
  code: string | null;
  minutes: number;
}) {
  if (!code || !minutes) return null;

  return (
    <View className="flex-row items-center bg-emerald-500/15 border border-emerald-500/30 rounded-lg px-2 py-1 mr-2">
      <DollarSign size={12} color="#10b981" />
      <Text className="text-emerald-400 font-bold text-xs ml-0.5">{code}</Text>
      <Text className="text-emerald-400/70 text-xs ml-1">
        {formatPremiumMinutes(minutes)}
      </Text>
    </View>
  );
}

/**
 * Status badge with color coding
 */
function StatusBadge({ status }: { status: string }) {
  const colors = getStatusColor(status);

  const icons: Record<string, React.ReactNode> = {
    draft: <Clock size={10} color="#94a3b8" />,
    saved: <CheckCircle2 size={10} color="#10b981" />,
    exported: <FileText size={10} color="#3b82f6" />,
  };

  const labels: Record<string, string> = {
    draft: 'Draft',
    saved: 'Saved',
    exported: 'Exported',
  };

  return (
    <View className={cn('flex-row items-center px-2 py-0.5 rounded-full ml-2', colors.bg)}>
      {icons[status]}
      <Text className={cn('text-[10px] font-medium ml-1', colors.text)}>
        {labels[status] || status}
      </Text>
    </View>
  );
}

// ============================================
// Main Component
// ============================================

export function LogEventListCard({
  event,
  onPress,
  onDelete,
  compact = false,
}: LogEventListCardProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const handleDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete Event',
      'Are you sure you want to delete this log event? This cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            swipeableRef.current?.close();
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete?.(event.id),
        },
      ]
    );
  };

  const premiumMinutes = event.premiumMinutesDelta ?? 0;
  const hasPremium = event.premiumCode && premiumMinutes > 0;
  const hasLinkedLegs = event.legs && event.legs.length > 0;

  // Use headline from event
  const headline = event.headline;

  // Extract date from tripDates or createdAt
  const displayDate = event.tripDates?.split(' – ')[0] || formatDateShort(event.createdAt);

  const renderRightActions = () => {
    return (
      <Pressable
        onPress={handleDelete}
        className="bg-red-500 rounded-xl ml-2 justify-center items-center px-6"
      >
        <Trash2 size={22} color="#fff" />
        <Text className="text-white text-xs font-semibold mt-1">Delete</Text>
      </Pressable>
    );
  };

  const cardContent = (
    <View className="p-4">
      {/* Header Row */}
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          {/* Event Type Tag */}
          <View className="flex-row items-center mb-2">
            <View className={cn(
              'px-2 py-0.5 rounded',
              event.eventType === 'schedule_change' ? 'bg-amber-500/20' :
              event.eventType === 'premium' ? 'bg-emerald-500/20' :
              event.eventType === 'reassignment' ? 'bg-blue-500/20' :
              'bg-slate-700/50'
            )}>
              <Text className={cn(
                'text-[10px] font-bold uppercase',
                event.eventType === 'schedule_change' ? 'text-amber-400' :
                event.eventType === 'premium' ? 'text-emerald-400' :
                event.eventType === 'reassignment' ? 'text-blue-400' :
                'text-slate-400'
              )}>
                {getEventTypeLabel(event.eventType)}
              </Text>
            </View>
            <StatusBadge status={event.status} />
          </View>

          {/* Headline */}
          <Text className="text-white font-semibold text-base" numberOfLines={2}>
            {headline}
          </Text>

          {/* Date */}
          <Text className="text-slate-500 text-xs mt-1">
            {displayDate}
          </Text>
        </View>

        {/* Right Side - Premium or Chevron */}
        <View className="items-end">
          {hasPremium ? (
            <View className="items-end">
              <Text className="text-emerald-400 font-bold text-lg">
                {formatPremiumMinutes(premiumMinutes)}
              </Text>
              <Text className="text-emerald-400/60 text-xs">
                {event.premiumCode}
              </Text>
            </View>
          ) : (
            onPress && <ChevronRight size={18} color="#64748b" />
          )}
        </View>
      </View>

      {/* Linked Legs (if not compact) */}
      {!compact && hasLinkedLegs && (
        <View className="mt-3 pt-3 border-t border-slate-700/30">
          <View className="flex-row items-center mb-1">
            <Link2 size={12} color="#64748b" />
            <Text className="text-slate-500 text-xs ml-1.5">
              Linked Legs ({event.legCount})
            </Text>
          </View>
          {event.legs.slice(0, 3).map((leg, idx) => (
            <LegLine key={`${leg.id}-${idx}`} leg={leg} />
          ))}
          {event.legCount > 3 && (
            <Text className="text-slate-600 text-xs mt-1 ml-6">
              +{event.legCount - 3} more leg(s)
            </Text>
          )}
        </View>
      )}

      {/* Notes preview (if not compact) */}
      {!compact && event.notes && (
        <Text className="text-slate-400 text-sm mt-2" numberOfLines={2}>
          {event.notes}
        </Text>
      )}

      {/* Premium row for compact mode */}
      {compact && hasPremium && (
        <View className="flex-row items-center mt-2">
          <PremiumBadge code={event.premiumCode} minutes={premiumMinutes} />
        </View>
      )}
    </View>
  );

  const card = (
    <Pressable
      onPress={handlePress}
      disabled={!onPress}
      className={cn(
        'rounded-xl border active:opacity-80',
        hasPremium
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-slate-800/50 border-slate-700/50'
      )}
    >
      {cardContent}
    </Pressable>
  );

  // If no delete handler, render without swipeable
  if (!onDelete) {
    return (
      <Animated.View entering={FadeIn.duration(200)} exiting={webSafeExit(FadeOut.duration(200))} className="mb-3">
        {card}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={webSafeExit(FadeOut.duration(200))} className="mb-3">
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        overshootRight={false}
        friction={2}
        onSwipeableOpen={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        {card}
      </Swipeable>
    </Animated.View>
  );
}

// ============================================
// Log Events List Empty State
// ============================================

export function LogEventsEmptyState({
  tripId,
  onCreateEvent,
}: {
  tripId?: string;
  onCreateEvent?: () => void;
}) {
  return (
    <View className="bg-slate-800/30 rounded-xl p-6 border border-dashed border-slate-600 items-center">
      <View className="w-14 h-14 rounded-full bg-slate-700/50 items-center justify-center mb-4">
        <FileText size={28} color="#64748b" />
      </View>
      <Text className="text-white font-semibold text-lg text-center">
        No Log Events Yet
      </Text>
      <Text className="text-slate-400 text-sm text-center mt-2 mb-4 px-4">
        Log events track schedule changes, premiums, and pay-affecting situations
        for audit-ready documentation.
      </Text>
      {onCreateEvent && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onCreateEvent();
          }}
          className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-3 flex-row items-center active:opacity-70"
        >
          <AlertCircle size={16} color="#f59e0b" />
          <Text className="text-amber-400 font-semibold ml-2">Create Log Event</Text>
        </Pressable>
      )}
    </View>
  );
}

// ============================================
// Log Events Section Header
// ============================================

export function LogEventsSectionHeader({
  count,
  totalPremiumMinutes,
  onViewAll,
}: {
  count: number;
  totalPremiumMinutes?: number;
  onViewAll?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between mb-3">
      <View className="flex-row items-center">
        <FileText size={18} color="#f59e0b" />
        <Text className="text-amber-400 font-semibold text-sm ml-2">
          Log Events
        </Text>
        <View className="bg-slate-700 rounded-full px-2 py-0.5 ml-2">
          <Text className="text-slate-300 text-xs font-medium">{count}</Text>
        </View>
      </View>
      <View className="flex-row items-center">
        {totalPremiumMinutes != null && totalPremiumMinutes > 0 && (
          <View className="flex-row items-center mr-3">
            <DollarSign size={14} color="#10b981" />
            <Text className="text-emerald-400 font-bold text-sm ml-0.5">
              {formatPremiumMinutes(totalPremiumMinutes)}
            </Text>
          </View>
        )}
        {onViewAll && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onViewAll();
            }}
            className="flex-row items-center active:opacity-70"
          >
            <Text className="text-slate-400 text-xs">View All</Text>
            <ChevronRight size={14} color="#64748b" />
          </Pressable>
        )}
      </View>
    </View>
  );
}
