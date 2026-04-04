/**
 * useLogEvents Hook
 *
 * React Query hooks for managing Log Events with leg-level linking.
 * Provides CRUD operations, premium suggestions, and trip summaries.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useIsOnline } from '@/lib/useNetworkStatus';
import { syncQueue } from '@/lib/syncQueue';
import type {
  GetLogEventsResponse,
  GetLogEventResponse,
  CreateLogEventRequest,
  CreateLogEventResponse,
  CreateLogEventFromChangeRequest,
  CreateLogEventFromChangeResponse,
  UpdateLogEventRequest,
  UpdateLogEventResponse,
  GetTripLogEventSummaryResponse,
  SimplePremiumSuggestion,
} from '@/lib/contracts';

// ============================================
// Query Keys
// ============================================

export const logEventKeys = {
  all: ['log-events'] as const,
  lists: () => [...logEventKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...logEventKeys.lists(), filters] as const,
  details: () => [...logEventKeys.all, 'detail'] as const,
  detail: (id: string) => [...logEventKeys.details(), id] as const,
  summaries: () => [...logEventKeys.all, 'summary'] as const,
  tripSummary: (tripId: string) => [...logEventKeys.summaries(), 'trip', tripId] as const,
  premiumSuggestions: (changeType: string) => [...logEventKeys.all, 'premium-suggestions', changeType] as const,
};

// ============================================
// List Log Events
// ============================================

export interface UseLogEventsParams {
  tripId?: string;
  eventType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

export function useLogEvents(params: UseLogEventsParams = {}) {
  const { enabled = true, ...queryParams } = params;

  return useQuery({
    queryKey: logEventKeys.list(queryParams),
    queryFn: async (): Promise<GetLogEventsResponse> => {
      const searchParams = new URLSearchParams();
      if (queryParams.tripId) searchParams.set('tripId', queryParams.tripId);
      if (queryParams.eventType) searchParams.set('eventType', queryParams.eventType);
      if (queryParams.status) searchParams.set('status', queryParams.status);
      if (queryParams.startDate) searchParams.set('startDate', queryParams.startDate);
      if (queryParams.endDate) searchParams.set('endDate', queryParams.endDate);
      if (queryParams.limit) searchParams.set('limit', queryParams.limit.toString());
      if (queryParams.offset) searchParams.set('offset', queryParams.offset.toString());

      const queryString = searchParams.toString();
      const url = queryString ? `/api/log-events?${queryString}` : '/api/log-events';

      return api.get<GetLogEventsResponse>(url);
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// ============================================
// Get Single Log Event
// ============================================

export function useLogEvent(id: string | null | undefined) {
  return useQuery({
    queryKey: logEventKeys.detail(id || ''),
    queryFn: async (): Promise<GetLogEventResponse> => {
      return api.get<GetLogEventResponse>(`/api/log-events/${id}`);
    },
    enabled: !!id,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ============================================
// Create Log Event
// ============================================

export function useCreateLogEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (data: CreateLogEventRequest): Promise<CreateLogEventResponse> => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "CREATE_LOG_EVENT",
          '/api/log-events',
          "POST",
          `Log event: ${data.eventType ?? "event"}`,
          data as unknown as object
        );
        return { event: { ...data, id: `pending_${Date.now()}` } } as unknown as CreateLogEventResponse;
      }
      return api.post<CreateLogEventResponse>('/api/log-events', data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.lists() });
      if (variables.tripId) {
        queryClient.invalidateQueries({ queryKey: logEventKeys.tripSummary(variables.tripId) });
      }
    },
  });
}

// ============================================
// Create Log Event from Schedule Change
// ============================================

export function useCreateLogEventFromChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateLogEventFromChangeRequest): Promise<CreateLogEventFromChangeResponse> => {
      return api.post<CreateLogEventFromChangeResponse>('/api/log-events/from-change', data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.lists() });
      if (variables.tripId) {
        queryClient.invalidateQueries({ queryKey: logEventKeys.tripSummary(variables.tripId) });
      }
    },
  });
}

// ============================================
// Update Log Event
// ============================================

export function useUpdateLogEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateLogEventRequest & { id: string }): Promise<UpdateLogEventResponse> => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "UPDATE_LOG_EVENT",
          `/api/log-events/${id}`,
          "PUT",
          `Update log event`,
          data as unknown as object
        );
        return { event: { id, ...data } } as unknown as UpdateLogEventResponse;
      }
      return api.put<UpdateLogEventResponse>(`/api/log-events/${id}`, data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.lists() });
      queryClient.invalidateQueries({ queryKey: logEventKeys.detail(result.event.id) });
      if (result.event.tripId) {
        queryClient.invalidateQueries({ queryKey: logEventKeys.tripSummary(result.event.tripId) });
      }
    },
  });
}

export function useDeleteLogEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (id: string): Promise<{ success: boolean }> => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "DELETE_LOG_EVENT",
          `/api/log-events/${id}`,
          "DELETE",
          `Delete log event`
        );
        return { success: true };
      }
      return api.delete<{ success: boolean }>(`/api/log-events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.lists() });
      queryClient.invalidateQueries({ queryKey: logEventKeys.summaries() });
    },
  });
}

// ============================================
// Get Trip Premium Summary
// ============================================

export function useTripLogEventSummary(tripId: string | null | undefined) {
  return useQuery({
    queryKey: logEventKeys.tripSummary(tripId || ''),
    queryFn: async (): Promise<GetTripLogEventSummaryResponse> => {
      return api.get<GetTripLogEventSummaryResponse>(`/api/log-events/summary/by-trip/${tripId}`);
    },
    enabled: !!tripId,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ============================================
// Get Premium Suggestions for Change Type
// ============================================

export function usePremiumSuggestions(changeType: string | null | undefined) {
  return useQuery({
    queryKey: logEventKeys.premiumSuggestions(changeType || ''),
    queryFn: async (): Promise<{ suggestions: SimplePremiumSuggestion[] }> => {
      try {
        return await api.get<{ suggestions: SimplePremiumSuggestion[] }>(`/api/log-events/premium-suggestions/${changeType}`);
      } catch {
        // Return empty suggestions on error
        return { suggestions: [] };
      }
    },
    enabled: !!changeType,
    staleTime: 5 * 60 * 1000, // 5 minutes (suggestions are static)
  });
}

// ============================================
// Link Legs to Log Event
// ============================================

export function useLinkLegsToLogEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      eventId,
      legIds,
      primaryLegId,
      changeSummaries,
    }: {
      eventId: string;
      legIds: string[];
      primaryLegId?: string;
      changeSummaries?: Record<string, unknown>;
    }): Promise<{ success: boolean; linkedCount: number }> => {
      return api.post<{ success: boolean; linkedCount: number }>(`/api/log-events/${eventId}/legs`, {
        legIds,
        primaryLegId,
        changeSummaries,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.detail(variables.eventId) });
      queryClient.invalidateQueries({ queryKey: logEventKeys.lists() });
    },
  });
}

// ============================================
// Helpers
// ============================================

/**
 * Format premium minutes as HH:MM
 */
export function formatPremiumMinutes(minutes: number | null | undefined): string {
  if (!minutes && minutes !== 0) return '--:--';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Get event type display label
 */
export function getEventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    schedule_change: 'Schedule Change',
    reassignment: 'Reassignment',
    premium: 'Premium',
    pay_protection: 'Pay Protection',
    duty_extension: 'Duty Extension',
    late_arrival: 'Late Arrival',
    other: 'Other',
  };
  return labels[eventType] || eventType;
}

/**
 * Get status badge color
 */
export function getStatusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'draft':
      return { bg: 'bg-slate-500/20', text: 'text-slate-400' };
    case 'saved':
      return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
    case 'exported':
      return { bg: 'bg-blue-500/20', text: 'text-blue-400' };
    default:
      return { bg: 'bg-slate-500/20', text: 'text-slate-400' };
  }
}
