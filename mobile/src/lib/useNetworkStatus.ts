/**
 * Network Status Hook
 *
 * Monitors network connectivity and provides offline state.
 * Auto-refreshes data when coming back online.
 */

import { useEffect, useState, useCallback } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";

interface NetworkStatus {
  isOnline: boolean;
  isInternetReachable: boolean | null;
  connectionType: string | null;
}

/**
 * Hook to monitor network connectivity
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isInternetReachable: true,
    connectionType: null,
  });

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then((state) => {
      setStatus({
        isOnline: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable,
        connectionType: state.type,
      });
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setStatus({
        isOnline: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable,
        connectionType: state.type,
      });
    });

    return () => unsubscribe();
  }, []);

  return status;
}

/**
 * Hook that returns simple online/offline boolean
 */
export function useIsOnline(): boolean {
  const { isOnline, isInternetReachable } = useNetworkStatus();
  // Consider offline if no connection OR internet is explicitly not reachable
  return isOnline && isInternetReachable !== false;
}

/**
 * Hook that auto-refreshes queries when coming back online
 */
export function useAutoRefreshOnReconnect(queryKeys?: string[][]): void {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline && isOnline) {
      // Just came back online - refresh data
      console.log("[Network] Back online - refreshing data...");

      if (queryKeys && queryKeys.length > 0) {
        // Refresh specific queries
        queryKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      } else {
        // Refresh all queries
        queryClient.invalidateQueries();
      }

      setWasOffline(false);
    }
  }, [isOnline, wasOffline, queryClient, queryKeys]);
}

/**
 * Format last sync time for display
 */
export function formatLastSync(date: Date | null): string {
  if (!date) return "Never synced";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default useNetworkStatus;
