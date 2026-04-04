/**
 * SIK Badge Component
 * Displays sick status badges on trips, duty days, and legs
 * Uses red/white color scheme for sick indicators
 * Only shows when fully sick (SIK) - no partial status
 */

import { View, Text } from 'react-native';
import { Heart } from 'lucide-react-native';
import { cn } from '@/lib/cn';

type SickStatus = 'FLY' | 'SIK';

interface SikBadgeProps {
  status: SickStatus | 'PARTIAL'; // Accept PARTIAL but treat as FLY (not shown)
  size?: 'xs' | 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

/**
 * SIK Badge - Shows sick status indicator
 *
 * - SIK: Red/white badge (fully sick)
 * - FLY/PARTIAL: Hidden (only show when fully sick)
 */
export function SikBadge({ status, size = 'sm', showLabel = true, className }: SikBadgeProps) {
  // Only show badge when fully sick
  if (status !== 'SIK') return null;

  const sizeClasses = {
    xs: {
      container: 'px-1 py-0.5',
      icon: 8,
      text: 'text-[8px]',
    },
    sm: {
      container: 'px-1.5 py-0.5',
      icon: 10,
      text: 'text-[10px]',
    },
    md: {
      container: 'px-2 py-1',
      icon: 12,
      text: 'text-xs',
    },
  };

  const currentSize = sizeClasses[size];

  return (
    <View
      className={cn(
        'flex-row items-center rounded bg-red-500/20',
        currentSize.container,
        className
      )}
    >
      <Heart
        size={currentSize.icon}
        color="#ef4444"
        fill="white"
      />
      {showLabel && (
        <Text
          className={cn(
            'font-bold ml-0.5 text-red-400',
            currentSize.text
          )}
        >
          SIK
        </Text>
      )}
    </View>
  );
}

/**
 * Compact SIK indicator (icon only)
 * Only shows for fully sick status
 */
export function SikIndicator({ status, size = 14 }: { status: 'FLY' | 'SIK' | 'PARTIAL'; size?: number }) {
  // Only show for fully sick
  if (status !== 'SIK') return null;

  return (
    <Heart
      size={size}
      color="#ef4444"
      fill="white"
    />
  );
}

/**
 * Leg SIK tag - small tag for leg rows
 */
export function LegSikTag({ isSick }: { isSick: boolean }) {
  if (!isSick) return null;

  return (
    <View className="bg-red-500/20 px-1 py-0.5 rounded ml-1">
      <Text className="text-red-400 text-[8px] font-bold">SIK</Text>
    </View>
  );
}

/**
 * Day SIK badge - for duty day headers
 * Only shows when ALL legs in day are sick
 */
export function DaySikBadge({ status }: { status: 'FLY' | 'SIK' | 'PARTIAL' }) {
  // Only show for fully sick days
  if (status !== 'SIK') return null;

  return (
    <View className="flex-row items-center px-1.5 py-0.5 rounded ml-2 bg-red-500/20">
      <Heart
        size={10}
        color="#ef4444"
        fill="white"
      />
      <Text className="text-[10px] font-bold ml-0.5 text-red-400">
        SIK
      </Text>
    </View>
  );
}

/**
 * Trip SIK badge - for trip cards in list
 * Only shows when ALL legs in trip are sick
 */
export function TripSikBadge({ status }: { status: 'FLY' | 'SIK' | 'PARTIAL' }) {
  // Only show for fully sick trips
  if (status !== 'SIK') return null;

  return (
    <View className="flex-row items-center px-2 py-1 rounded-lg bg-red-500/20 border border-red-500/30">
      <Heart
        size={12}
        color="#ef4444"
        fill="white"
      />
      <Text className="text-xs font-bold ml-1 text-red-400">
        SICK
      </Text>
    </View>
  );
}
