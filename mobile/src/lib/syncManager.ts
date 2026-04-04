/**
 * Sync Manager
 *
 * Processes the offline sync queue when connectivity is restored.
 * Subscribes to network changes and replays queued mutations in order.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api";
import { syncQueue } from "./syncQueue";
import { offlineCache } from "./offlineStorage";

const MAX_RETRIES = 3;

/** How many pending ops are queued - updates reactively */
export function useSyncQueueCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    syncQueue.count().then((c) => { if (mounted) setCount(c); });
    return () => { mounted = false; };
  }, []);

  const refresh = useCallback(async () => {
    const c = await syncQueue.count();
    setCount(c);
  }, []);

  return { count, refresh };
}

/**
 * useSyncManager - mount once at app root.
 * Drains the queue every time the device comes back online.
 */
export function useSyncManager() {
  const queryClient = useQueryClient();
  const isSyncing = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncingState, setIsSyncingState] = useState(false);

  const refreshCount = useCallback(async () => {
    const c = await syncQueue.count();
    setPendingCount(c);
  }, []);

  const drainQueue = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    setIsSyncingState(true);

    try {
      const items = await syncQueue.getAll();
      if (items.length === 0) {
        isSyncing.current = false;
        setIsSyncingState(false);
        return;
      }

      console.log(`[SyncManager] Draining ${items.length} queued operations...`);

      for (const item of items) {
        if (item.retryCount >= MAX_RETRIES) {
          console.warn(`[SyncManager] Dropping ${item.id} after ${MAX_RETRIES} retries`);
          await syncQueue.remove(item.id);
          continue;
        }

        try {
          if (item.method === "POST") {
            await api.post(item.endpoint, item.body);
          } else if (item.method === "PUT") {
            await api.put(item.endpoint, item.body);
          } else if (item.method === "PATCH") {
            await api.patch(item.endpoint, item.body);
          } else if (item.method === "DELETE") {
            await api.delete(item.endpoint);
          }

          await syncQueue.remove(item.id);
          console.log(`[SyncManager] Synced: ${item.operation} (${item.id})`);
        } catch (err: any) {
          console.warn(`[SyncManager] Failed to sync ${item.id}:`, err?.message);
          await syncQueue.incrementRetry(item.id);
        }
      }

      // Save last sync time & invalidate all queries so UI refreshes
      await offlineCache.saveLastSync();
      queryClient.invalidateQueries();
      console.log("[SyncManager] Queue drain complete, queries invalidated");
    } finally {
      isSyncing.current = false;
      setIsSyncingState(false);
      await refreshCount();
    }
  }, [queryClient, refreshCount]);

  useEffect(() => {
    // Load initial count
    refreshCount();

    let wasOffline = false;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = (state.isConnected ?? false) && state.isInternetReachable !== false;

      if (!online) {
        wasOffline = true;
      } else if (wasOffline && online) {
        wasOffline = false;
        console.log("[SyncManager] Came back online — draining queue");
        drainQueue();
      }
    });

    // Also try to drain on mount in case we're already online with queued items
    drainQueue();

    return () => unsubscribe();
  }, [drainQueue, refreshCount]);

  return { pendingCount, isSyncing: isSyncingState, drainQueue };
}

export default useSyncManager;
