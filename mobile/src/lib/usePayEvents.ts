/**
 * Pay Events Hooks
 * React Query hooks for pay events management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useSession } from "./useSession";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import { syncQueue } from "./syncQueue";
import type {
  GetPayEventsResponse,
  GetPayEventResponse,
  CreatePayEventRequest,
  CreatePayEventResponse,
  UpdatePayEventRequest,
  UpdatePayEventResponse,
  DeletePayEventResponse,
  CreatePayEventDocumentRequest,
  CreatePayEventDocumentResponse,
  DeletePayEventDocumentResponse,
  PayEvent,
  PayEventType,
  PayEventStatus,
  PayEventDocType,
} from "@/lib/contracts";

// ============================================
// PAY EVENTS
// ============================================

export function usePayEvents(options?: {
  startDate?: string;
  endDate?: string;
  eventType?: PayEventType;
  tripId?: string;
  status?: PayEventStatus;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["pay-events", options],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = options?.startDate && options?.endDate
          ? await offlineCache.getPayEventsForDate<GetPayEventsResponse>(options.startDate, options.endDate)
          : await offlineCache.getPayEvents<GetPayEventsResponse>();
        if (cached) {
          console.log("[usePayEvents] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached pay events available offline");
      }

      const params = new URLSearchParams();
      if (options?.startDate) params.set("startDate", options.startDate);
      if (options?.endDate) params.set("endDate", options.endDate);
      if (options?.eventType) params.set("eventType", options.eventType);
      if (options?.tripId) params.set("tripId", options.tripId);
      if (options?.status) params.set("status", options.status);
      const queryString = params.toString();
      const url = queryString ? `/api/pay-events?${queryString}` : "/api/pay-events";
      const response = await api.get<GetPayEventsResponse>(url);

      // Cache for offline use
      if (options?.startDate && options?.endDate) {
        await offlineCache.savePayEventsForDate(options.startDate, options.endDate, response);
      } else {
        await offlineCache.savePayEvents(response);
      }

      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes — pay events don't change without user action
    retry: isOnline ? 2 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

export function usePayEvent(eventId: string | undefined) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["pay-event", eventId],
    queryFn: async () => {
      if (!eventId) throw new Error("Event ID is required");
      const response = await api.get<GetPayEventResponse>(`/api/pay-events/${eventId}`);
      return response.event;
    },
    enabled: isAuthenticated && !!eventId,
  });
}

export function useCreatePayEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (data: CreatePayEventRequest) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "CREATE_PAY_EVENT",
          "/api/pay-events",
          "POST",
          `Log pay event: ${data.eventType}`,
          data as unknown as object
        );
        // Return a stub so callers don't break
        return { event: { ...data, id: `pending_${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } as unknown as CreatePayEventResponse;
      }
      const response = await api.post<CreatePayEventResponse>("/api/pay-events", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdatePayEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async ({ eventId, data }: { eventId: string; data: UpdatePayEventRequest }) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "UPDATE_PAY_EVENT",
          `/api/pay-events/${eventId}`,
          "PUT",
          `Update pay event`,
          data as unknown as object
        );
        return { event: { id: eventId, ...data } } as unknown as UpdatePayEventResponse;
      }
      const response = await api.put<UpdatePayEventResponse>(`/api/pay-events/${eventId}`, data);
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["pay-event", variables.eventId] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeletePayEvent() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (eventId: string) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "DELETE_PAY_EVENT",
          `/api/pay-events/${eventId}`,
          "DELETE",
          `Delete pay event`
        );
        return { success: true } as unknown as DeletePayEventResponse;
      }
      const response = await api.delete<DeletePayEventResponse>(`/api/pay-events/${eventId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ============================================
// DELETE ALL PAY EVENTS
// ============================================

export function useDeleteAllPayEvents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.delete<{ success: boolean; deletedCount: number; message: string }>(
        "/api/pay-events"
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// PAY EVENT DOCUMENTS
// ============================================

export function useAddPayEventDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ eventId, data }: { eventId: string; data: CreatePayEventDocumentRequest }) => {
      const response = await api.post<CreatePayEventDocumentResponse>(
        `/api/pay-events/${eventId}/documents`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["pay-event", variables.eventId] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeletePayEventDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ eventId, docId }: { eventId: string; docId: string }) => {
      const response = await api.delete<DeletePayEventDocumentResponse>(
        `/api/pay-events/${eventId}/documents/${docId}`
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["pay-event", variables.eventId] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ============================================
// PAY EVENTS SUMMARY
// ============================================

interface PayEventSummary {
  totalEvents: number;
  byType: Record<string, { count: number; totalCreditMinutes: number; totalPayCents: number }>;
  byStatus: Record<string, number>;
}

export function usePayEventsSummary(options?: {
  startDate?: string;
  endDate?: string;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return useQuery({
    queryKey: ["pay-events-summary", options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.startDate) params.set("startDate", options.startDate);
      if (options?.endDate) params.set("endDate", options.endDate);
      const queryString = params.toString();
      const url = queryString ? `/api/pay-events/summary?${queryString}` : "/api/pay-events/summary";
      const response = await api.get<PayEventSummary>(url);
      return response;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });
}

// ============================================
// HELPERS
// ============================================

/**
 * Format event type for display
 */
export function formatEventType(eventType: PayEventType): string {
  const labels: Record<PayEventType, string> = {
    SCHEDULE_CHANGE: "Schedule Change",
    DUTY_EXTENSION: "Duty Extension",
    REASSIGNMENT: "Reassignment",
    PREMIUM_TRIGGER: "Premium Trigger",
    PAY_PROTECTION: "Pay Protection",
    JUNIOR_ASSIGNMENT: "Junior Assignment",
    TRAINING: "Training",
    DEADHEAD: "Deadhead",
    RESERVE_ACTIVATION: "Reserve Activation",
    OTHER: "Other",
  };
  return labels[eventType] || eventType;
}

/**
 * Get event type icon name (for Lucide)
 */
export function getEventTypeIcon(eventType: PayEventType): string {
  const icons: Record<PayEventType, string> = {
    SCHEDULE_CHANGE: "CalendarX",
    DUTY_EXTENSION: "Clock",
    REASSIGNMENT: "Shuffle",
    PREMIUM_TRIGGER: "DollarSign",
    PAY_PROTECTION: "Shield",
    JUNIOR_ASSIGNMENT: "UserMinus",
    TRAINING: "GraduationCap",
    DEADHEAD: "Plane",
    RESERVE_ACTIVATION: "PhoneCall",
    OTHER: "MoreHorizontal",
  };
  return icons[eventType] || "Circle";
}

/**
 * Get event type color
 */
export function getEventTypeColor(eventType: PayEventType): string {
  const colors: Record<PayEventType, string> = {
    SCHEDULE_CHANGE: "#ef4444", // red
    DUTY_EXTENSION: "#f97316", // orange
    REASSIGNMENT: "#eab308", // yellow
    PREMIUM_TRIGGER: "#22c55e", // green
    PAY_PROTECTION: "#3b82f6", // blue
    JUNIOR_ASSIGNMENT: "#a855f7", // purple
    TRAINING: "#06b6d4", // cyan
    DEADHEAD: "#64748b", // slate
    RESERVE_ACTIVATION: "#ec4899", // pink
    OTHER: "#6b7280", // gray
  };
  return colors[eventType] || "#6b7280";
}

/**
 * Format event status for display
 */
export function formatEventStatus(status: PayEventStatus): string {
  const labels: Record<PayEventStatus, string> = {
    open: "Open",
    disputed: "Disputed",
    resolved: "Resolved",
  };
  return labels[status] || status;
}

/**
 * Get status badge color
 */
export function getStatusColor(status: PayEventStatus): { bg: string; text: string } {
  const colors: Record<PayEventStatus, { bg: string; text: string }> = {
    open: { bg: "bg-amber-900/50", text: "text-amber-400" },
    disputed: { bg: "bg-red-900/50", text: "text-red-400" },
    resolved: { bg: "bg-green-900/50", text: "text-green-400" },
  };
  return colors[status] || { bg: "bg-slate-700", text: "text-slate-300" };
}

/**
 * Format document type for display
 */
export function formatDocType(docType: PayEventDocType): string {
  const labels: Record<PayEventDocType, string> = {
    NOTE: "Note",
    CALL_LOG: "Call Log",
    EMAIL: "Email",
    SCREENSHOT: "Screenshot",
    ATTACHMENT: "Attachment",
  };
  return labels[docType] || docType;
}

/**
 * Get document type icon
 */
export function getDocTypeIcon(docType: PayEventDocType): string {
  const icons: Record<PayEventDocType, string> = {
    NOTE: "FileText",
    CALL_LOG: "Phone",
    EMAIL: "Mail",
    SCREENSHOT: "Image",
    ATTACHMENT: "Paperclip",
  };
  return icons[docType] || "File";
}

/**
 * Format minutes as hours:minutes string
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "-";
  const sign = minutes < 0 ? "-" : "+";
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `${sign}${hours}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Format cents as currency
 */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "-";
  const sign = cents < 0 ? "-" : "+";
  const absCents = Math.abs(cents);
  return `${sign}$${(absCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
