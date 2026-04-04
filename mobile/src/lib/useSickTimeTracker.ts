/**
 * Sick Time Tracker Hooks
 *
 * IMPORTANT: For PERSONAL RECORD-KEEPING ONLY
 * Does NOT submit, modify, validate, or sync with payroll, scheduling, or company systems
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// ============================================================
// Types
// ============================================================

export interface SickBank {
  id: string;
  userId: string;
  balanceHours: number;
  capHours: number;
  capReached: boolean;
  accrualRateHours: number;
  hourlyRateCentsOverride: number | null;
  createdAt: string;
  updatedAt: string;
  payoutEstimate: {
    eligibleHours: number;
    estimatedPayoutCents: number;
    hourlyRateCents: number;
    note: string;
  };
}

export interface SickAccrual {
  id: string;
  userId: string;
  periodMonth: string;
  accruedHours: number;
  ytdTotalHours: number;
  balanceAfter: number;
  blockedByCap: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SickUsageAttachment {
  id: string;
  sickUsageId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  description: string | null;
  uploadedAt: string;
}

export interface SickUsage {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  hoursUsed: number;
  tripId: string | null;
  tripNumber: string | null;
  coverageStatus: 'FULL' | 'PARTIAL' | 'NONE';
  balanceBefore: number;
  balanceAfter: number;
  continuousCallId: string;
  userNotes: string | null;
  autoSummary: string | null;
  status: 'active' | 'voided';
  voidedAt: string | null;
  voidedReason: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: SickUsageAttachment[];
}

export interface SickSummary {
  rolling12Month: {
    eventCount: number;
    totalHoursUsed: number;
    avgHoursPerEvent: number;
    windowStartDate: string;
    windowEndDate: string;
  };
  currentBalance: number;
  capReached: boolean;
  recentEvents: Array<{
    id: string;
    startDate: string;
    endDate: string;
    hoursUsed: number;
    coverageStatus: string;
    tripNumber: string | null;
  }>;
}

// ============================================================
// Query Keys
// ============================================================

export const sickTrackerKeys = {
  all: ['sick-tracker'] as const,
  bank: () => [...sickTrackerKeys.all, 'bank'] as const,
  accruals: () => [...sickTrackerKeys.all, 'accruals'] as const,
  usage: () => [...sickTrackerKeys.all, 'usage'] as const,
  summary: () => [...sickTrackerKeys.all, 'summary'] as const,
};

// ============================================================
// Hooks
// ============================================================

/**
 * Get user's sick bank (balance, settings, payout estimate)
 */
export function useSickBank() {
  return useQuery({
    queryKey: sickTrackerKeys.bank(),
    queryFn: () => api.get<SickBank>('/api/sick-tracker/bank'),
    staleTime: 0,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Update sick bank balance or settings
 */
export function useUpdateSickBank() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      balanceHours?: number;
      accrualRateHours?: number;
      hourlyRateCentsOverride?: number | null;
      capHours?: number;
    }) => api.put<SickBank>('/api/sick-tracker/bank', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.bank() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.summary() });
      // Cross-invalidate sick call summary in pay summary
      queryClient.invalidateQueries({ queryKey: ['sick'] });
    },
  });
}

/**
 * Get accrual history
 */
export function useSickAccruals() {
  return useQuery({
    queryKey: sickTrackerKeys.accruals(),
    queryFn: () => api.get<{ accruals: SickAccrual[] }>('/api/sick-tracker/accruals'),
    select: (data) => data.accruals,
  });
}

/**
 * Record an accrual
 */
export function useRecordAccrual() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      periodMonth: string;
      accruedHours: number;
      notes?: string;
    }) => api.post<{ accrual: SickAccrual; sickBank: { balanceHours: number; capReached: boolean } }>('/api/sick-tracker/accruals', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.bank() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.accruals() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.summary() });
      queryClient.invalidateQueries({ queryKey: ['sick'] });
    },
  });
}

/**
 * Get sick usage history
 */
export function useSickUsage() {
  return useQuery({
    queryKey: sickTrackerKeys.usage(),
    queryFn: () => api.get<{ usage: SickUsage[] }>('/api/sick-tracker/usage'),
    select: (data) => data.usage,
  });
}

/**
 * Record sick usage (deduction)
 */
export function useRecordSickUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      startDate: string;
      endDate: string;
      hoursUsed: number;
      tripId?: string;
      tripNumber?: string;
      continuousCallId?: string;
      userNotes?: string;
      autoSummary?: string;
    }) => api.post<{ usageLog: SickUsage; sickBank: { balanceHours: number; balanceBefore: number; capReached: boolean } }>('/api/sick-tracker/usage', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.bank() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.usage() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.summary() });
      queryClient.invalidateQueries({ queryKey: ['sick'] });
    },
  });
}

/**
 * Get rolling 12-month summary
 */
export function useSickSummary() {
  return useQuery({
    queryKey: sickTrackerKeys.summary(),
    queryFn: () => api.get<SickSummary>('/api/sick-tracker/summary'),
    staleTime: 0,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Add attachment to sick usage
 */
export function useAddSickAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ usageId, ...data }: {
      usageId: string;
      fileName: string;
      fileUrl: string;
      mimeType?: string;
      fileSize?: number;
      description?: string;
    }) => api.post<{ attachment: SickUsageAttachment }>(`/api/sick-tracker/usage/${usageId}/attachments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.usage() });
    },
  });
}

/**
 * Delete attachment from sick usage
 */
export function useDeleteSickAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ usageId, attachmentId }: { usageId: string; attachmentId: string }) =>
      api.delete<{ success: boolean }>(`/api/sick-tracker/usage/${usageId}/attachments/${attachmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.usage() });
    },
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Format hours as "HH:MM" or just "X hrs"
 */
export function formatSickHours(hours: number, format: 'hours' | 'time' = 'hours'): string {
  if (format === 'time') {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  }
  return `${hours.toFixed(1)} hrs`;
}

/**
 * Format currency from cents
 */
export function formatSickPayout(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Get coverage status color
 */
export function getCoverageColor(status: 'FULL' | 'PARTIAL' | 'NONE'): { bg: string; text: string; border: string } {
  switch (status) {
    case 'FULL':
      return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40' };
    case 'PARTIAL':
      return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40' };
    case 'NONE':
      return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' };
    default:
      return { bg: 'bg-slate-700/60', text: 'text-slate-400', border: 'border-slate-700' };
  }
}
