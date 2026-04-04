/**
 * Offline Indicator Component
 *
 * Shows a banner when the user is offline, with last sync time.
 * Appears at the top of screens to inform users about connectivity.
 */

import { View, Text, Pressable } from "react-native";
import { WifiOff, RefreshCw, CheckCircle2, CloudOff } from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect, useRef, useState } from "react";
import { useIsOnline, formatLastSync } from "@/lib/useNetworkStatus";
import { webSafeExit } from '@/lib/webSafeAnimation';
import { offlineCache } from "@/lib/offlineStorage";
import { syncQueue } from "@/lib/syncQueue";

interface OfflineIndicatorProps {
  /** Custom message to show when offline */
  message?: string;
  /** Show sync status even when online */
  showSyncStatus?: boolean;
  /** Callback when refresh is pressed */
  onRefresh?: () => void;
}

export function OfflineIndicator({
  message,
  showSyncStatus = false,
  onRefresh,
}: OfflineIndicatorProps) {
  const isOnline = useIsOnline();
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [justCameOnline, setJustCameOnline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const prevOnlineRef = useRef(isOnline);

  // Spinning animation for refresh icon
  const rotation = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  useEffect(() => {
    if (!isOnline) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 2000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = withTiming(0, { duration: 300 });
    }
  }, [isOnline, rotation]);

  // Fetch last sync time whenever connectivity changes
  useEffect(() => {
    offlineCache.getLastSync().then(setLastSync);
    syncQueue.count().then(setPendingCount);
  }, [isOnline]);

  // Show "Back online" briefly when reconnecting from offline
  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (isOnline && wasOffline) {
      setJustCameOnline(true);
      const timer = setTimeout(() => setJustCameOnline(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  // Don't show anything if online and not showing sync status
  if (isOnline && !showSyncStatus && !justCameOnline) {
    return null;
  }

  // Show "Back online" message briefly
  if (justCameOnline) {
    return (
      <Animated.View
        entering={FadeInDown.duration(300)}
        exiting={webSafeExit(FadeOutUp.duration(300))}
        className="mx-5 mb-3"
      >
        <View className="bg-green-500/15 border border-green-500/30 rounded-xl px-4 py-3 flex-row items-center">
          <CheckCircle2 size={18} color="#22c55e" />
          <Text className="text-green-400 text-sm font-medium ml-2 flex-1">
            Back online
          </Text>
          <Text className="text-green-400/70 text-xs">
            {pendingCount > 0 ? `Syncing ${pendingCount} change${pendingCount > 1 ? "s" : ""}...` : "Syncing data..."}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // Show offline banner
  if (!isOnline) {
    return (
      <Animated.View
        entering={FadeInDown.duration(300)}
        exiting={webSafeExit(FadeOutUp.duration(300))}
        className="mx-5 mb-3"
      >
        <View className="bg-amber-500/15 border border-amber-500/30 rounded-xl px-4 py-3 flex-row items-center">
          <CloudOff size={18} color="#f59e0b" />
          <View className="flex-1 ml-3">
            <Text className="text-amber-400 text-sm font-medium">
              {message ?? "You're offline"}
            </Text>
            <Text className="text-amber-400/70 text-xs mt-0.5">
              {pendingCount > 0
                ? `${pendingCount} change${pendingCount > 1 ? "s" : ""} queued — will sync when online`
                : lastSync
                ? `Cached data from ${formatLastSync(lastSync)}`
                : "Showing cached data"}
            </Text>
          </View>
          {pendingCount > 0 && (
            <View className="bg-amber-500/20 rounded-full px-2 py-0.5 ml-2">
              <Text className="text-amber-400 text-xs font-bold">{pendingCount}</Text>
            </View>
          )}
          {onRefresh && (
            <Pressable onPress={onRefresh} hitSlop={8} className="p-2 active:opacity-70">
              <Animated.View style={animatedStyle}>
                <RefreshCw size={16} color="#f59e0b" />
              </Animated.View>
            </Pressable>
          )}
        </View>
      </Animated.View>
    );
  }

  // Show sync status when online (optional)
  if (showSyncStatus && lastSync) {
    return (
      <View className="mx-5 mb-2">
        <Text className="text-slate-500 text-xs text-center">
          Last synced: {formatLastSync(lastSync)}
        </Text>
      </View>
    );
  }

  return null;
}

/**
 * Compact offline indicator for headers
 */
export function OfflineBadge() {
  const isOnline = useIsOnline();

  if (isOnline) return null;

  return (
    <View className="flex-row items-center bg-amber-500/20 px-2 py-1 rounded-full">
      <WifiOff size={12} color="#f59e0b" />
      <Text className="text-amber-500 text-xs font-medium ml-1">Offline</Text>
    </View>
  );
}

export default OfflineIndicator;
