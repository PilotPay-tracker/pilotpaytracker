/**
 * Calendar Sync Hooks
 *
 * React Query hooks for calendar connections, sync operations,
 * and pending change management.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import type {
  GetCalendarConnectionsResponse,
  CreateCalendarConnectionRequest,
  CreateCalendarConnectionResponse,
  DeleteCalendarConnectionResponse,
  TriggerCalendarSyncRequest,
  TriggerCalendarSyncResponse,
  GetPendingCalendarChangesResponse,
  ApplyCalendarChangeRequest,
  ApplyCalendarChangeResponse,
  CalendarProvider as CalendarProviderType,
  CalendarConnection,
  DetectedScheduleChange,
} from "@/lib/contracts";

// Re-export the type for external use
export type CalendarProvider = CalendarProviderType;

// Query keys
export const calendarSyncKeys = {
  all: ["calendarSync"] as const,
  connections: () => [...calendarSyncKeys.all, "connections"] as const,
  pendingChanges: () => [...calendarSyncKeys.all, "pendingChanges"] as const,
};

// ============================================
// CALENDAR CONNECTIONS
// ============================================

export function useCalendarConnections() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: calendarSyncKeys.connections(),
    queryFn: () =>
      api.get<GetCalendarConnectionsResponse>("/api/calendar/connections"),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useCreateCalendarConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateCalendarConnectionRequest) => {
      return api.post<CreateCalendarConnectionResponse>(
        "/api/calendar/connections",
        params
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: calendarSyncKeys.connections(),
      });
    },
  });
}

export function useDeleteCalendarConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      return api.delete<DeleteCalendarConnectionResponse>(
        `/api/calendar/connections/${connectionId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: calendarSyncKeys.connections(),
      });
    },
  });
}

// ============================================
// CALENDAR SYNC
// ============================================

export function useTriggerCalendarSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: TriggerCalendarSyncRequest) => {
      return api.post<TriggerCalendarSyncResponse>(
        "/api/calendar/sync",
        params || {}
      );
    },
    onSuccess: () => {
      // Invalidate both connections (for lastSyncAt) and pending changes
      queryClient.invalidateQueries({
        queryKey: calendarSyncKeys.all,
      });
    },
  });
}

// ============================================
// PENDING CHANGES
// ============================================

export function usePendingCalendarChanges() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: calendarSyncKeys.pendingChanges(),
    queryFn: () =>
      api.get<GetPendingCalendarChangesResponse>("/api/calendar/pending-changes"),
    enabled: isAuthenticated,
    staleTime: 10 * 1000, // 10 seconds
  });
}

export function useApplyCalendarChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      changeId,
      params,
    }: {
      changeId: string;
      params: ApplyCalendarChangeRequest;
    }) => {
      return api.post<ApplyCalendarChangeResponse>(
        `/api/calendar/changes/${changeId}/apply`,
        params
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: calendarSyncKeys.pendingChanges(),
      });
      queryClient.invalidateQueries({
        queryKey: calendarSyncKeys.connections(),
      });
    },
  });
}

// ============================================
// HELPERS
// ============================================

// Format provider name for display
export function formatProviderName(provider: CalendarProvider): string {
  const names: Record<CalendarProvider, string> = {
    apple: "Apple Calendar",
    google: "Google Calendar",
    outlook: "Outlook",
    ics_feed: "ICS Feed",
  };
  return names[provider];
}

// Get provider icon name
export function getProviderIcon(provider: CalendarProvider): string {
  const icons: Record<CalendarProvider, string> = {
    apple: "apple",
    google: "calendar",
    outlook: "mail",
    ics_feed: "link",
  };
  return icons[provider];
}

// Get provider color
export function getProviderColor(provider: CalendarProvider): string {
  const colors: Record<CalendarProvider, string> = {
    apple: "#000000",
    google: "#4285F4",
    outlook: "#0078D4",
    ics_feed: "#6B7280",
  };
  return colors[provider];
}

// Format last sync time
export function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never synced";

  const syncDate = new Date(lastSyncAt);
  const now = new Date();
  const diffMs = now.getTime() - syncDate.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return syncDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Format change type for display
export function formatChangeType(
  changeType: string
): { label: string; color: string; bgColor: string } {
  const configs: Record<string, { label: string; color: string; bgColor: string }> = {
    TRIP_ADDED: { label: "Trip Added", color: "#22c55e", bgColor: "bg-green-500/20" },
    TRIP_REMOVED: { label: "Trip Removed", color: "#ef4444", bgColor: "bg-red-500/20" },
    TRIP_MODIFIED: { label: "Trip Modified", color: "#f59e0b", bgColor: "bg-amber-500/20" },
    LEG_ADDED: { label: "Leg Added", color: "#22c55e", bgColor: "bg-green-500/20" },
    LEG_REMOVED: { label: "Leg Removed", color: "#ef4444", bgColor: "bg-red-500/20" },
    LEG_MODIFIED: { label: "Leg Modified", color: "#f59e0b", bgColor: "bg-amber-500/20" },
    TIME_CHANGE: { label: "Time Changed", color: "#3b82f6", bgColor: "bg-blue-500/20" },
    DH_CHANGE: { label: "Deadhead Changed", color: "#8b5cf6", bgColor: "bg-violet-500/20" },
    CREDIT_CHANGE: { label: "Credit Changed", color: "#06b6d4", bgColor: "bg-cyan-500/20" },
  };

  return (
    configs[changeType] || {
      label: changeType.replace(/_/g, " "),
      color: "#64748b",
      bgColor: "bg-slate-500/20",
    }
  );
}

// Get count of pending changes with pay impact
export function usePendingChangesCount() {
  const { data } = usePendingCalendarChanges();
  return data?.totalCount ?? 0;
}

// Check if calendar sync is connected
export function useIsCalendarConnected() {
  const { data } = useCalendarConnections();
  return (data?.connections?.length ?? 0) > 0;
}
