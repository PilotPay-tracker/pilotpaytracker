/**
 * useRosterChanges Hook
 *
 * React Query hooks for the roster change detection system.
 * Provides data for:
 * - Pending changes for a trip
 * - Pay protection status
 * - Trip versions
 * - Premium candidates
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useIsOnline } from "@/lib/useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";

// Types
export interface RosterChange {
  id: string;
  tripId: string;
  changeType: string;
  severity: "minor" | "moderate" | "major";
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  changeSummary: string;
  creditDiffMinutes: number;
  estimatedPayDiffCents: number;
  isPremiumCandidate: boolean;
  premiumCandidateType?: string;
  premiumConfidence?: string;
  requiresAck: boolean;
  acknowledged: boolean;
  acknowledgedAt?: string;
  logEventId?: string;
  logEventStatus?: string;
  createdAt: string;
}

export interface PayProtection {
  tripId: string;
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;
  payCreditSource: "protected" | "current";
  isPayProtected: boolean;
  protectedAt?: string;
  lastEvaluatedAt?: string;
}

export interface TripVersion {
  id: string;
  tripId: string;
  versionNumber: number;
  isActiveVersion: boolean;
  isBaselineVersion: boolean;
  totalCreditMinutes: number;
  createdAt: string;
}

export interface TripChangeStatus {
  hasChangePending: boolean;
  changePendingSince?: string;
  pendingVersionId?: string;
  activeVersionId?: string;
  pendingChanges: RosterChange[];
  payProtection?: PayProtection;
}

export interface PremiumCandidate {
  rosterChangeId: string;
  changeType: string;
  severity: "minor" | "moderate" | "major";
  premiumType: string;
  confidence: "high" | "medium" | "low";
  suggestedEventType: string;
  suggestedTitle: string;
  suggestedDescription: string;
  estimatedPayImpactCents: number;
  creditDiffMinutes: number;
}

// ============================================
// HOOKS
// ============================================

/**
 * Get pending roster changes for a trip
 */
export function usePendingChanges(tripId: string | undefined) {
  return useQuery({
    queryKey: ["roster-changes", tripId, "pending"],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<{ changes: RosterChange[] }>(
        `/api/roster-changes/trip/${tripId}/pending`
      );
      return response.changes;
    },
    enabled: !!tripId,
  });
}

/**
 * Get trip change status (includes pending changes and pay protection)
 */
export function useTripChangeStatus(tripId: string | undefined) {
  return useQuery({
    queryKey: ["trip-change-status", tripId],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<TripChangeStatus>(
        `/api/trips/${tripId}/versions/status`
      );
      return response;
    },
    enabled: !!tripId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Get pay protection info for a trip
 */
export function usePayProtection(tripId: string | undefined) {
  return useQuery({
    queryKey: ["pay-protection", tripId],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<{ payProtection: PayProtection }>(
        `/api/trips/${tripId}/versions/pay-protection`
      );
      return response.payProtection;
    },
    enabled: !!tripId,
  });
}

/**
 * Get all versions for a trip
 */
export function useTripVersions(tripId: string | undefined) {
  return useQuery({
    queryKey: ["trip-versions", tripId],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<{ versions: TripVersion[] }>(
        `/api/trips/${tripId}/versions`
      );
      return response.versions;
    },
    enabled: !!tripId,
  });
}

/**
 * Get premium candidates for a trip
 */
export function usePremiumCandidates(tripId: string | undefined) {
  return useQuery({
    queryKey: ["premium-candidates", tripId],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<{ data: PremiumCandidate[] }>(
        `/api/premium-events/trips/${tripId}/candidates`
      );
      return response.data;
    },
    enabled: !!tripId,
  });
}

/**
 * Get all premium candidates for the user (dashboard)
 */
export function useAllPremiumCandidates() {
  return useQuery({
    queryKey: ["premium-candidates", "all"],
    queryFn: async () => {
      const response = await api.get<{
        data: { tripId: string; tripNumber: string | null; candidates: PremiumCandidate[] }[];
        totalCandidates: number;
      }>("/api/premium-events/candidates");
      return response;
    },
  });
}

/**
 * Acknowledge roster changes
 */
export function useAcknowledgeChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      changeIds,
    }: {
      tripId: string;
      changeIds: string[];
    }) => {
      const response = await api.post("/api/roster-changes/acknowledge", {
        tripId,
        changeIds,
      });
      return response;
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip", variables.tripId] });
      queryClient.invalidateQueries({
        queryKey: ["roster-changes", variables.tripId],
      });
      queryClient.invalidateQueries({
        queryKey: ["trip-change-status", variables.tripId],
      });
    },
  });
}

/**
 * Create a draft log event from a premium candidate
 */
export function useCreatePremiumDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      rosterChangeId,
    }: {
      tripId: string;
      rosterChangeId: string;
    }) => {
      const response = await api.post<{ draftId: string; message: string }>(
        "/api/premium-events/draft",
        { tripId, rosterChangeId }
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["premium-candidates", variables.tripId],
      });
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
    },
  });
}

/**
 * Get draft log events
 */
export function useDraftLogEvents() {
  return useQuery({
    queryKey: ["draft-log-events"],
    queryFn: async () => {
      const response = await api.get<{ data: any[] }>("/api/premium-events/drafts");
      return response.data;
    },
  });
}

/**
 * Submit a draft log event
 */
export function useSubmitDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      draftId,
      updates,
    }: {
      draftId: string;
      updates?: {
        title?: string;
        description?: string;
        creditDifferenceMinutes?: number;
      };
    }) => {
      const response = await api.post(
        `/api/premium-events/drafts/${draftId}/submit`,
        updates || {}
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["draft-log-events"] });
      queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      queryClient.invalidateQueries({ queryKey: ["premium-candidates"] });
    },
  });
}

/**
 * Dismiss a draft log event
 */
export function useDismissDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      draftId,
      reason,
    }: {
      draftId: string;
      reason?: string;
    }) => {
      const response = await api.post(
        `/api/premium-events/drafts/${draftId}/dismiss`,
        { reason }
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["draft-log-events"] });
      queryClient.invalidateQueries({ queryKey: ["premium-candidates"] });
    },
  });
}

// Extended type with trip info
export interface RosterChangeWithTrip extends RosterChange {
  tripNumber: string | null;
  tripStartDate: string;
}

/**
 * Get ALL pending roster changes across all trips
 * Used for the Records/Audit Trail screen
 */
export function useAllPendingRosterChanges(severityFilter?: "minor" | "moderate" | "major") {
  const isOnline = useIsOnline();
  return useQuery({
    queryKey: ["roster-changes", "all-pending", { severityFilter }],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        return { changes: [] as RosterChangeWithTrip[], totalCount: 0, byTrip: [] };
      }
      const params = severityFilter ? `?severityFilter=${severityFilter}` : "";
      const response = await api.get<{
        changes: RosterChangeWithTrip[];
        totalCount: number;
        byTrip: { tripId: string; tripNumber: string | null; changeCount: number; severity: string }[];
      }>(`/api/roster-changes/pending${params}`);
      return response;
    },
    retry: isOnline ? 3 : 0,
  });
}

/**
 * Get count of all pending roster changes
 */
export function useAllPendingRosterChangesCount() {
  const { data } = useAllPendingRosterChanges();
  return data?.totalCount ?? 0;
}

/**
 * Get ALL roster changes for a trip (including acknowledged ones)
 */
export function useAllTripRosterChanges(tripId: string | undefined) {
  return useQuery({
    queryKey: ["roster-changes", tripId, "all"],
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<{
        changes: RosterChange[];
        pendingAckCount: number;
        hasPremiumCandidates: boolean;
      }>(`/api/trips/${tripId}/changes`);
      return response;
    },
    enabled: !!tripId,
  });
}

/**
 * Format roster change type for display
 */
export function formatRosterChangeType(changeType: string): string {
  const labels: Record<string, string> = {
    duty_day_added: "Duty Day Added",
    duty_day_removed: "Duty Day Removed",
    leg_added: "Leg Added",
    leg_removed: "Leg Removed",
    time_change: "Time Changed",
    route_change: "Route Changed",
    credit_change: "Credit Changed",
    layover_change: "Layover Changed",
    deadhead_change: "Deadhead Changed",
    flight_number_change: "Flight Number Changed",
  };
  return labels[changeType] || changeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get severity display info
 */
export function getSeverityDisplay(severity: string): { label: string; color: string; bgColor: string } {
  const displays: Record<string, { label: string; color: string; bgColor: string }> = {
    minor: { label: "Minor", color: "#22c55e", bgColor: "bg-green-500/20" },
    moderate: { label: "Moderate", color: "#f59e0b", bgColor: "bg-amber-500/20" },
    major: { label: "Major", color: "#ef4444", bgColor: "bg-red-500/20" },
  };
  return displays[severity] || { label: severity, color: "#64748b", bgColor: "bg-slate-500/20" };
}
