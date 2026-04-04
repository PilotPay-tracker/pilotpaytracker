/**
 * Schedule Snapshot Hooks
 *
 * React Query hooks for managing Trip Board snapshots and schedule change detection.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useIsOnline } from './useNetworkStatus';
import NetInfo from "@react-native-community/netinfo";
import type {
  CreateSnapshotResponse,
  GetSnapshotsResponse,
  GetSnapshotResponse,
  GetChangesResponse,
  AcknowledgeChangeResponse,
  UpdateReminderSettingsResponse,
  GetReminderStatusResponse,
  ScheduleSnapshot,
  ScheduleChange,
  ScheduleReminderSettings,
} from '@/lib/contracts';

// Query keys
export const snapshotKeys = {
  all: ['snapshots'] as const,
  lists: () => [...snapshotKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...snapshotKeys.lists(), filters] as const,
  details: () => [...snapshotKeys.all, 'detail'] as const,
  detail: (id: string) => [...snapshotKeys.details(), id] as const,
  changes: () => ['schedule-changes'] as const,
  changesList: (filters: Record<string, unknown>) => [...snapshotKeys.changes(), filters] as const,
  reminderStatus: () => ['reminder-status'] as const,
};

// Hook: Get list of snapshots
export function useSnapshots(limit?: number) {
  const isOnline = useIsOnline();
  return useQuery({
    queryKey: snapshotKeys.list({ limit }),
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        return { snapshots: [], reminderSettings: null } as GetSnapshotsResponse;
      }
      const params = limit ? `?limit=${limit}` : '';
      return api.get<GetSnapshotsResponse>(`/api/schedule/snapshots${params}`);
    },
    retry: isOnline ? 3 : 0,
  });
}

// Hook: Get single snapshot with changes
export function useSnapshot(snapshotId: string | null) {
  return useQuery({
    queryKey: snapshotKeys.detail(snapshotId || ''),
    queryFn: async () => {
      if (!snapshotId) throw new Error('No snapshot ID');
      return api.get<GetSnapshotResponse>(`/api/schedule/snapshots/${snapshotId}`);
    },
    enabled: !!snapshotId,
  });
}

// Hook: Create new snapshot
export function useCreateSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { images: string[]; sourceType?: 'trip_board_browser' | 'trip_board_trip_details' }) => {
      return api.post<CreateSnapshotResponse>('/api/schedule/snapshot', data);
    },
    onSuccess: () => {
      // Invalidate snapshots and changes lists
      queryClient.invalidateQueries({ queryKey: snapshotKeys.all });
      queryClient.invalidateQueries({ queryKey: snapshotKeys.changes() });
      queryClient.invalidateQueries({ queryKey: snapshotKeys.reminderStatus() });
    },
  });
}

// Hook: Get schedule changes
export function useScheduleChanges(filters?: { acknowledged?: boolean; severity?: string }) {
  const isOnline = useIsOnline();
  return useQuery({
    queryKey: snapshotKeys.changesList({ ...(filters || {}) }),
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        return { changes: [], summary: { totalChanges: 0, unacknowledged: 0, payImpactCount: 0, totalPayImpactCents: 0 } } as GetChangesResponse;
      }
      const params = new URLSearchParams();
      if (filters?.acknowledged !== undefined) {
        params.append('acknowledged', String(filters.acknowledged));
      }
      if (filters?.severity) {
        params.append('severity', filters.severity);
      }
      const queryString = params.toString();
      return api.get<GetChangesResponse>(`/api/schedule/changes${queryString ? `?${queryString}` : ''}`);
    },
    retry: isOnline ? 3 : 0,
  });
}

// Hook: Get unacknowledged changes count
export function useUnacknowledgedChangesCount() {
  const { data } = useScheduleChanges({ acknowledged: false });
  return data?.summary?.unacknowledged ?? 0;
}

// Hook: Acknowledge a change
export function useAcknowledgeChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      changeId: string;
      createPayEvent?: boolean;
      payEventData?: {
        eventType: string;
        title: string;
        description?: string;
        eventDateISO?: string;
      };
    }) => {
      const { changeId, ...body } = data;
      return api.post<AcknowledgeChangeResponse>(`/api/schedule/changes/${changeId}/acknowledge`, body);
    },
    onSuccess: () => {
      // Invalidate changes list
      queryClient.invalidateQueries({ queryKey: snapshotKeys.changes() });
    },
  });
}

// Hook: Acknowledge all unacknowledged changes
export function useAcknowledgeAllChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return api.post<{ success: boolean; acknowledgedCount: number; message: string }>(
        '/api/schedule/changes/acknowledge-all',
        {}
      );
    },
    onSuccess: () => {
      // Invalidate changes list and related queries
      queryClient.invalidateQueries({ queryKey: snapshotKeys.changes() });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['pay-events'] });
      queryClient.invalidateQueries({ queryKey: ['roster-changes'] });
    },
  });
}

// Hook: Acknowledge a roster change (from version-aware import system)
export function useAcknowledgeRosterChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { tripId: string; changeId: string; createLogEvent?: boolean }) => {
      const { tripId, changeId, createLogEvent } = data;
      return api.post<{ success: boolean; change: unknown; logEventId?: string }>(
        `/api/trips/${tripId}/changes/${changeId}/acknowledge`,
        { createLogEvent }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.changes() });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['roster-changes'] });
    },
  });
}

// Hook: Acknowledge all roster changes for all trips
export function useAcknowledgeAllRosterChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return api.post<{ success: boolean; acknowledgedCount: number }>(
        '/api/roster-changes/acknowledge-all',
        {}
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.changes() });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['roster-changes'] });
    },
  });
}

// Hook: Get reminder status
export function useReminderStatus() {
  return useQuery({
    queryKey: snapshotKeys.reminderStatus(),
    queryFn: async () => {
      return api.get<GetReminderStatusResponse>('/api/schedule/reminder-status');
    },
    // Refetch every 5 minutes to keep status fresh
    refetchInterval: 5 * 60 * 1000,
  });
}

// Hook: Update reminder settings
export function useUpdateReminderSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      enabled?: boolean;
      frequencyHours?: number;
      reminderTimes?: string[];
      beforeReport?: boolean;
      beforeReportHours?: number;
    }) => {
      return api.put<UpdateReminderSettingsResponse>('/api/schedule/reminder-settings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: snapshotKeys.reminderStatus() });
      queryClient.invalidateQueries({ queryKey: snapshotKeys.lists() });
    },
  });
}

// Derived types for components
export type { ScheduleSnapshot, ScheduleChange, ScheduleReminderSettings };
