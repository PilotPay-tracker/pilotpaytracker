/**
 * Offline Sync Queue
 *
 * Persists write operations (create/update/delete) made while offline.
 * Automatically replays them in order when connectivity is restored.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "offline_sync_queue";

export type SyncOperation =
  | "CREATE_PAY_EVENT"
  | "UPDATE_PAY_EVENT"
  | "DELETE_PAY_EVENT"
  | "CREATE_TRIP"
  | "UPDATE_TRIP"
  | "DELETE_TRIP"
  | "CREATE_LOG_EVENT"
  | "UPDATE_LOG_EVENT"
  | "DELETE_LOG_EVENT";

export interface SyncQueueItem {
  id: string;
  operation: SyncOperation;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: object;
  /** Temporary optimistic ID used locally before server confirms */
  tempId?: string;
  createdAt: number;
  retryCount: number;
  /** Human-readable label for UI */
  label: string;
}

function generateId(): string {
  return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readQueue(): Promise<SyncQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SyncQueueItem[];
  } catch {
    return [];
  }
}

async function writeQueue(items: SyncQueueItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error("[SyncQueue] Failed to write queue:", err);
  }
}

export const syncQueue = {
  /** Enqueue a write operation to be synced later */
  enqueue: async (
    operation: SyncOperation,
    endpoint: string,
    method: SyncQueueItem["method"],
    label: string,
    body?: object,
    tempId?: string
  ): Promise<SyncQueueItem> => {
    const item: SyncQueueItem = {
      id: generateId(),
      operation,
      endpoint,
      method,
      body,
      tempId,
      createdAt: Date.now(),
      retryCount: 0,
      label,
    };
    const queue = await readQueue();
    queue.push(item);
    await writeQueue(queue);
    console.log(`[SyncQueue] Enqueued: ${operation} (${item.id})`);
    return item;
  },

  /** Remove a successfully synced item */
  remove: async (id: string): Promise<void> => {
    const queue = await readQueue();
    const filtered = queue.filter((i) => i.id !== id);
    await writeQueue(filtered);
  },

  /** Increment retry count on failure */
  incrementRetry: async (id: string): Promise<void> => {
    const queue = await readQueue();
    const updated = queue.map((i) =>
      i.id === id ? { ...i, retryCount: i.retryCount + 1 } : i
    );
    await writeQueue(updated);
  },

  /** Get all pending items */
  getAll: (): Promise<SyncQueueItem[]> => readQueue(),

  /** Get count of pending items */
  count: async (): Promise<number> => {
    const q = await readQueue();
    return q.length;
  },

  /** Clear the entire queue (e.g. on logout) */
  clear: async (): Promise<void> => {
    await AsyncStorage.removeItem(QUEUE_KEY);
  },
};

export default syncQueue;
