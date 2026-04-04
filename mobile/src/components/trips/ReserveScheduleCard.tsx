/**
 * ReserveScheduleCard - Display component for reserve/standby schedule events
 * Shows: RSVA, RSVB, RSVC, RSVD, HOT, LCO, RCID, TRNG events
 *
 * Features:
 * - Reserve window times display
 * - Credit hours (locked badge for RSV)
 * - Block hours (from activation legs)
 * - Activation status badge
 * - Nested activation legs display when activated
 */

import { View, Text, Pressable } from 'react-native';
import {
  Clock,
  Calendar,
  Plane,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Timer,
  MapPin,
  Trash2,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/cn';
import type { ReserveScheduleEvent, ActivationLeg } from '@/lib/useReserveSchedule';
import {
  getScheduleTypeDisplayName,
  getScheduleTypeShortName,
  formatActivationStatus,
  getActivationStatusColor,
  formatWindowTime,
  isReserveType,
} from '@/lib/useReserveSchedule';

interface ReserveScheduleCardProps {
  event: ReserveScheduleEvent;
  onPress?: () => void;
  onDelete?: () => void;
  index?: number;
}

/**
 * Format hours for display (e.g., 4.5 -> "4:30")
 */
function formatHoursToTime(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format time from ISO string
 */
function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Schedule type badge with color coding
 */
function ScheduleTypeBadge({ type }: { type: string }) {
  const isRSV = isReserveType(type as any);
  const shortName = getScheduleTypeShortName(type as any);

  // Color coding by type
  const colorClasses = useMemo(() => {
    if (type.startsWith('RSV')) {
      return 'bg-violet-500/20 border-violet-500/30';
    }
    switch (type) {
      case 'HOT':
        return 'bg-orange-500/20 border-orange-500/30';
      case 'LCO':
        return 'bg-blue-500/20 border-blue-500/30';
      case 'RCID':
        return 'bg-cyan-500/20 border-cyan-500/30';
      case 'TRNG':
        return 'bg-green-500/20 border-green-500/30';
      default:
        return 'bg-gray-500/20 border-gray-500/30';
    }
  }, [type]);

  const textColor = useMemo(() => {
    if (type.startsWith('RSV')) return 'text-violet-400';
    switch (type) {
      case 'HOT':
        return 'text-orange-400';
      case 'LCO':
        return 'text-blue-400';
      case 'RCID':
        return 'text-cyan-400';
      case 'TRNG':
        return 'text-green-400';
      default:
        return 'text-gray-400';
    }
  }, [type]);

  return (
    <View className={cn('px-2 py-1 rounded-md border', colorClasses)}>
      <Text className={cn('text-xs font-semibold', textColor)}>{shortName}</Text>
    </View>
  );
}

/**
 * Activation status badge
 */
function ActivationStatusBadge({ status }: { status: string }) {
  const colors = getActivationStatusColor(status as any);
  const label = formatActivationStatus(status as any);

  return (
    <View className={cn('px-2 py-1 rounded-md', colors.bg)}>
      <Text className={cn('text-xs font-medium', colors.text)}>{label}</Text>
    </View>
  );
}

/**
 * Credit locked badge - shows when RSV credit is immutable
 */
function CreditLockedBadge() {
  return (
    <View className="flex-row items-center bg-amber-500/20 px-2 py-1 rounded-md">
      <Lock size={10} color="#fbbf24" />
      <Text className="text-xs text-amber-400 ml-1 font-medium">Credit Locked</Text>
    </View>
  );
}

/**
 * Single activation leg row
 */
function ActivationLegRow({ leg, index }: { leg: ActivationLeg; index: number }) {
  const blockHours = leg.blockMinutes / 60;

  return (
    <View className="flex-row items-center py-2 border-b border-white/5 last:border-b-0">
      {/* Leg index */}
      <View className="w-6 items-center">
        <Text className="text-xs text-gray-500">{index + 1}</Text>
      </View>

      {/* Flight info */}
      <View className="flex-1 flex-row items-center">
        <Plane size={12} color="#9ca3af" />
        <Text className="text-sm text-white ml-1">
          {leg.flightNumber || 'N/A'}
        </Text>
        <Text className="text-xs text-gray-400 ml-2">
          {leg.origin} → {leg.destination}
        </Text>
      </View>

      {/* Times */}
      <View className="items-end">
        <Text className="text-xs text-gray-400">
          {formatTime(leg.depDtLocal)} - {formatTime(leg.arrDtLocal)}
        </Text>
        <Text className="text-xs text-gray-500">
          {blockHours.toFixed(1)}h block
        </Text>
      </View>
    </View>
  );
}

export function ReserveScheduleCard({ event, onPress, onDelete, index = 0 }: ReserveScheduleCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rotation = useSharedValue(0);

  const hasLegs = event.activationLegs && event.activationLegs.length > 0;
  const isRSV = isReserveType(event.scheduleType as any);
  const isActivated = event.activationStatus === 'ACTIVATED';

  // Animated chevron rotation
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const handleToggleExpand = () => {
    if (!hasLegs) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsExpanded(!isExpanded);
    rotation.value = withSpring(isExpanded ? 0 : 90);
  };

  const handleDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete?.();
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      className="mx-4 mb-3"
    >
      <Pressable onPress={handlePress}>
        <LinearGradient
          colors={['rgba(30, 30, 40, 0.95)', 'rgba(20, 20, 30, 0.98)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.08)',
          }}
        >
          <View className="p-4">
            {/* Header Row */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center flex-1">
                <ScheduleTypeBadge type={event.scheduleType} />
                <Text className="text-white font-semibold ml-2 text-base">
                  {event.domicile}
                </Text>
              </View>

              <View className="flex-row items-center space-x-2">
                <ActivationStatusBadge status={event.activationStatus} />
                {event.creditLocked && <CreditLockedBadge />}
                {onDelete && (
                  <Pressable
                    onPress={handleDelete}
                    className="ml-2 p-2 rounded-lg bg-red-500/10 active:bg-red-500/20"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Trash2 size={16} color="#ef4444" />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Date and Window Times */}
            <View className="flex-row items-center mb-3">
              <Calendar size={14} color="#9ca3af" />
              <Text className="text-sm text-gray-300 ml-2">
                {formatDate(event.startDtLocal)}
              </Text>

              {event.windowStartLocal && event.windowEndLocal && (
                <View className="flex-row items-center ml-4">
                  <Clock size={14} color="#9ca3af" />
                  <Text className="text-sm text-gray-400 ml-1">
                    {formatWindowTime(event.windowStartLocal)} – {formatWindowTime(event.windowEndLocal)}
                  </Text>
                </View>
              )}
            </View>

            {/* Credit and Block Info */}
            <View className="flex-row items-center justify-between bg-white/5 rounded-lg p-3">
              {/* Credit Hours */}
              <View className="items-center flex-1">
                <Text className="text-xs text-gray-500 mb-1">Credit</Text>
                <View className="flex-row items-center">
                  <Text className="text-lg font-bold text-white">
                    {formatHoursToTime(event.creditHours)}
                  </Text>
                  {event.creditLocked && (
                    <Lock size={12} color="#fbbf24" className="ml-1" />
                  )}
                </View>
              </View>

              {/* Divider */}
              <View className="w-px h-8 bg-white/10" />

              {/* Block Hours */}
              <View className="items-center flex-1">
                <Text className="text-xs text-gray-500 mb-1">Block</Text>
                <Text className="text-lg font-bold text-white">
                  {event.blockHours > 0 ? formatHoursToTime(event.blockHours) : '--:--'}
                </Text>
              </View>

              {/* Divider */}
              <View className="w-px h-8 bg-white/10" />

              {/* Report Requirement */}
              <View className="items-center flex-1">
                <Text className="text-xs text-gray-500 mb-1">Report</Text>
                <Text className="text-lg font-bold text-white">
                  {event.reportForDutyMinutes
                    ? `${event.reportForDutyMinutes}m`
                    : '--'}
                </Text>
              </View>
            </View>

            {/* RSV Activated Badge */}
            {isRSV && isActivated && (
              <View className="mt-3 bg-green-500/10 border border-green-500/20 rounded-lg p-2 flex-row items-center justify-center">
                <CheckCircle2 size={14} color="#22c55e" />
                <Text className="text-green-400 text-xs font-medium ml-1">
                  Activated — Credit Locked (RSV)
                </Text>
              </View>
            )}

            {/* Activation Legs Section (Expandable) */}
            {hasLegs && (
              <View className="mt-3">
                <Pressable
                  onPress={handleToggleExpand}
                  className="flex-row items-center justify-between py-2 border-t border-white/10"
                >
                  <View className="flex-row items-center">
                    <Plane size={14} color="#9ca3af" />
                    <Text className="text-sm text-gray-300 ml-2">
                      {event.activationLegs?.length} Activation Leg{event.activationLegs?.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Animated.View style={chevronStyle}>
                    <ChevronRight size={16} color="#9ca3af" />
                  </Animated.View>
                </Pressable>

                {isExpanded && (
                  <View className="mt-2 bg-black/20 rounded-lg p-2">
                    {event.activationLegs?.map((leg, idx) => (
                      <ActivationLegRow key={leg.id} leg={leg} index={idx} />
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Notes */}
            {event.notes && (
              <View className="mt-3 pt-3 border-t border-white/10">
                <Text className="text-xs text-gray-400">{event.notes}</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export default ReserveScheduleCard;
