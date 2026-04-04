/**
 * Sick Tracking API Hooks
 * Handles marking trips/days/legs as SIK (Sick)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// ============================================
// Types
// ============================================

export interface SickCallEvent {
  id: string;
  userId: string;
  tripId: string;
  sickCallGroupId: string;
  scope: 'entire_trip' | 'day' | 'legs';
  startDateLocal: string | null;
  endDateLocal: string | null;
  sickCreditMinutes: number;
  sickDaysCount: number;
  autoNotes: string | null;
  userNotes: string | null;
  status: 'active' | 'voided';
  voidedAt: string | null;
  voidedReason: string | null;
  logEventId: string | null;
  createdAt: string;
  linkedLegs?: SickCallLegLink[];
}

export interface SickCallLegLink {
  id: string;
  sickCallEventId: string;
  tripDutyLegId: string;
  legCreditMinutes: number;
  legDateLocal: string | null;
  tripDutyLeg?: {
    flightNumber: string | null;
    origin: string | null;
    destination: string | null;
  };
}

export interface TripSickInfo {
  tripId: string;
  tripSickStatus: 'FLY' | 'SIK' | 'PARTIAL';
  breakdown: {
    totalCreditMinutes: number;
    earnedCreditMinutes: number;
    sickCreditMinutes: number;
  };
  dayStatuses: Record<string, { status: string; sickLegs: number; totalLegs: number }>;
  legStatuses: Record<string, { status: string; creditMinutes: number }>;
  sickCallEvents: SickCallEvent[];
  disclaimer: string;
}

export interface SickSummary {
  rollingWindow: {
    startDate: string;
    endDate: string;
  };
  summary: {
    sickCallsCount: number;
    sickDaysCovered: number;
    sickCreditMinutes: number;
    sickCreditFormatted: string;
  };
  disclaimer: string;
}

export interface MarkSickRequest {
  tripId: string;
  scope: 'entire_trip' | 'day' | 'legs';
  dutyDayIds?: string[];
  legIds?: string[];
  userNotes?: string;
}

export interface MarkSickResponse {
  success: boolean;
  sickCallEvent: SickCallEvent;
  logEventId: string;
  summary: {
    legsMarked: number;
    sickCreditMinutes: number;
    sickDaysCount: number;
  };
}

export interface UndoSickRequest {
  sickCallEventId: string;
  voidedReason?: string;
}

export interface UndoSickResponse {
  success: boolean;
  message: string;
  legsRestored: number;
}

// ============================================
// Query Keys
// ============================================

export const sickKeys = {
  all: ['sick'] as const,
  tripSick: (tripId: string) => ['sick', 'trip', tripId] as const,
  summary: () => ['sick', 'summary'] as const,
  history: () => ['sick', 'history'] as const,
};

// ============================================
// Hooks
// ============================================

/**
 * Get sick info for a specific trip
 */
export function useTripSickInfo(tripId: string | null) {
  return useQuery({
    queryKey: sickKeys.tripSick(tripId ?? ''),
    queryFn: async () => {
      if (!tripId) return null;
      const response = await api.get<TripSickInfo>(`/api/sick/trip/${tripId}`);
      return response;
    },
    enabled: !!tripId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Get rolling 12-month sick summary
 */
export function useSickSummary() {
  return useQuery({
    queryKey: sickKeys.summary(),
    queryFn: async () => {
      const response = await api.get<SickSummary>('/api/sick/summary');
      return response;
    },
    staleTime: 0,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get sick call event history
 */
export function useSickHistory(options?: { limit?: number; includeVoided?: boolean }) {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.includeVoided) params.append('includeVoided', 'true');

  return useQuery({
    queryKey: [...sickKeys.history(), options],
    queryFn: async () => {
      const url = `/api/sick/history${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await api.get<{ events: SickCallEvent[]; count: number; disclaimer: string }>(url);
      return response;
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Mark legs/days/trip as SIK
 */
export function useMarkSick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: MarkSickRequest) => {
      const response = await api.post<MarkSickResponse>('/api/sick/mark', request);
      return response;
    },
    onSuccess: (data, variables) => {
      // Invalidate trip-specific sick info
      queryClient.invalidateQueries({ queryKey: sickKeys.tripSick(variables.tripId) });
      // Invalidate summary
      queryClient.invalidateQueries({ queryKey: sickKeys.summary() });
      // Invalidate history
      queryClient.invalidateQueries({ queryKey: sickKeys.history() });
      // Invalidate trips list to update badges
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      // Cross-invalidate sick time tracker bank & summary
      queryClient.invalidateQueries({ queryKey: ['sick-tracker'] });
    },
  });
}

/**
 * Undo (void) a sick call
 */
export function useUndoSick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: UndoSickRequest) => {
      const response = await api.post<UndoSickResponse>('/api/sick/undo', request);
      return response;
    },
    onSuccess: () => {
      // Invalidate all sick-related queries
      queryClient.invalidateQueries({ queryKey: sickKeys.all });
      // Invalidate trips list to update badges
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      // Cross-invalidate sick time tracker bank & summary
      queryClient.invalidateQueries({ queryKey: ['sick-tracker'] });
    },
  });
}

// ============================================
// Phase 2: Edit SIK Scope with Reconciliation
// ============================================

export interface EditScopeRequest {
  sickCallEventId: string;
  newLegIds: string[];
  userNotes?: string;
}

export interface EditScopeResponse {
  success: boolean;
  message: string;
  changes: {
    legsRemoved: number;
    legsAdded: number;
    creditMinutesBefore: number;
    creditMinutesAfter: number;
    deltaMinutes: number;
  };
  bankReconciliation: {
    balanceBefore: number;
    balanceAfter: number;
    delta: number;
  } | null;
  auditRecord: string;
}

/**
 * Edit SIK scope with delta reconciliation (Phase 2)
 * Changes which legs are marked SIK without double-deducting
 */
export function useEditSickScope() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: EditScopeRequest) => {
      const response = await api.post<EditScopeResponse>('/api/sick/edit-scope', request);
      return response;
    },
    onSuccess: () => {
      // Invalidate all sick-related queries
      queryClient.invalidateQueries({ queryKey: sickKeys.all });
      // Invalidate trips list to update badges
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}

// ============================================
// Utility Functions
// ============================================

// ============================================
// Upload-Detected SIK Types (Phase 1)
// ============================================

export interface SikDetectedData {
  detected: boolean;
  dateRange?: { startDate: string; endDate: string } | null;
  station?: string | null;
  // NOTE: tafbHours is TAFB (Time Away From Base), NOT sick hours to deduct!
  // Actual sick credit comes from the trip's leg credit hours.
  tafbHours?: number | null;
  rawText?: string | null;
}

export interface SikPreviewResponse {
  preview: {
    dateRange: { startDate: string; endDate: string };
    station: string | null;
    tafbHoursFromUpload: number | null; // TAFB reference only, not for deduction
    matchingTrips: Array<{
      id: string;
      tripNumber: string | null;
      startDate: string;
      endDate: string;
    }>;
    legsToMark: number;
    legsAlreadyMarked: number;
    targetLegs: Array<{
      legId: string;
      tripId: string;
      tripNumber: string | null;
      dutyDate: string;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
      creditMinutes: number;
      alreadyMarkedSik: boolean;
    }>;
  };
  deductionPreview: {
    hoursToDeduct: number;
    bankBalanceBefore: number;
    bankBalanceAfter: number;
    coveredHours: number;
    unpaidHours: number;
    coverageOutcome: 'PAID' | 'PARTIAL' | 'UNPAID';
  };
  canApply: boolean;
  alreadyMarkedMessage: string | null;
}

export interface ApplyDetectedSikRequest {
  sikDetected: SikDetectedData;
  legIds?: string[];
  scheduleEvidenceId?: string;
  imageUrls?: string[];
  userNotes?: string;
}

export interface ApplyDetectedSikResponse {
  success: boolean;
  message: string;
  legsMarked: number;
  results: Array<{ tripId: string; sickCallEventId: string; legsMarked: number }>;
  source: string;
}

// ============================================
// Upload-Detected SIK Hooks (Phase 1)
// ============================================

/**
 * Preview detected SIK from upload
 */
export function usePreviewDetectedSik() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: {
      sikDetected: SikDetectedData;
      tripId?: string;
      scheduleEvidenceId?: string;
      imageUrls?: string[];
    }) => {
      const response = await api.post<SikPreviewResponse>('/api/sick/preview-detected', request);
      return response;
    },
  });
}

/**
 * Apply detected SIK from upload
 */
export function useApplyDetectedSik() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: ApplyDetectedSikRequest) => {
      const response = await api.post<ApplyDetectedSikResponse>('/api/sick/apply-detected', request);
      return response;
    },
    onSuccess: () => {
      // Invalidate all sick-related queries
      queryClient.invalidateQueries({ queryKey: sickKeys.all });
      // Invalidate trips list to update badges
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format sick status for display
 * Only shows Sick or Flying (no partial)
 */
export function formatSickStatus(status: 'FLY' | 'SIK' | 'PARTIAL'): string {
  switch (status) {
    case 'SIK':
      return 'Sick';
    default:
      return 'Flying';
  }
}

/**
 * Get color for sick status
 * Uses red/white for sick only
 */
export function getSickStatusColor(status: 'FLY' | 'SIK' | 'PARTIAL'): {
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'SIK':
      return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' };
    default:
      return { bg: 'bg-slate-800/60', text: 'text-slate-400', border: 'border-slate-700' };
  }
}
