/**
 * useTripPayEngine
 *
 * React Query hooks for the trip pay calculation engine.
 * Connects log events → pay modifiers → trip pay state.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { logEventKeys } from '@/lib/useLogEvents';

// ============================================
// TYPES
// ============================================

export interface PayModifierAppliedRule {
  eventId: string;
  premiumCode: string | null;
  description: string;
  creditDeltaMinutes: number;
  payDeltaCents: number;
  applicationStatus: string | null;
  contractReference: string | null;
  proofStatus: string | null;
}

export interface TripPayBreakdown {
  tripId: string;
  tripNumber: string | null;
  baseCreditMinutes: number;
  basePayCents: number;
  premiumCreditMinutes: number;
  premiumPayCents: number;
  totalCreditMinutes: number;
  totalPayCents: number;
  hourlyRateCents: number;
  appliedRules: PayModifierAppliedRule[];
  payEventCount: number;
  tripPayState: 'normal' | 'event_logged' | 'premium_applied' | 'needs_review';
  hasNeedsProof: boolean;
  hasReview: boolean;
}

export type TripPayState = 'normal' | 'event_logged' | 'premium_applied' | 'needs_review';

// ============================================
// QUERY KEYS
// ============================================

export const tripPayEngineKeys = {
  all: ['trip-pay-engine'] as const,
  breakdown: (tripId: string) => [...tripPayEngineKeys.all, 'breakdown', tripId] as const,
};

// ============================================
// GET TRIP PAY BREAKDOWN
// Fetches the recalculated pay with premium modifiers
// ============================================

export function useTripPayBreakdown(tripId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: tripPayEngineKeys.breakdown(tripId || ''),
    queryFn: async (): Promise<TripPayBreakdown> => {
      const result = await api.post<TripPayBreakdown>(`/api/log-events/recalculate/${tripId}`, {});
      return result;
    },
    enabled: !!tripId && enabled,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// ============================================
// RECALCULATE TRIP PAY
// Manual trigger to refresh pay calculation
// ============================================

export function useRecalculateTripPay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string): Promise<TripPayBreakdown> => {
      return api.post<TripPayBreakdown>(`/api/log-events/recalculate/${tripId}`, {});
    },
    onSuccess: (data) => {
      // Update cached data
      queryClient.setQueryData(tripPayEngineKeys.breakdown(data.tripId), data);
      // Also invalidate log event summaries for this trip
      queryClient.invalidateQueries({
        queryKey: logEventKeys.tripSummary(data.tripId),
      });
    },
  });
}

// ============================================
// UPDATE LOG EVENT APPLICATION STATUS
// Promotes an event from logged → applied etc.
// ============================================

export interface UpdateLogEventStatusPayload {
  eventId: string;
  applicationStatus: 'logged' | 'needs_proof' | 'ready_to_apply' | 'applied' | 'review';
  proofStatus?: 'attached' | 'missing' | 'not_required';
}

export function useUpdateLogEventStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ eventId, applicationStatus, proofStatus }: UpdateLogEventStatusPayload) => {
      return api.put<{ success: boolean }>(`/api/log-events/${eventId}`, {
        applicationStatus,
        ...(proofStatus ? { proofStatus } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logEventKeys.all });
      queryClient.invalidateQueries({ queryKey: tripPayEngineKeys.all });
    },
  });
}

// ============================================
// SMART ASSIST - Detect possible pay triggers
// ============================================

export interface PayTriggerSuggestion {
  type: string;
  label: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  suggestedCode?: string;
  suggestedMultiplier?: number;
}

/**
 * Heuristic-based pay trigger detection.
 * Runs client-side from trip data; no network call needed.
 */
export function detectPayTriggers(trip: {
  dutyDays?: Array<{
    hasScheduleChange?: boolean;
    hasOverride?: boolean;
    premiumCode?: string | null;
    legs?: Array<{
      isDeadhead?: boolean;
      premiumCode?: string | null;
      actualBlockMinutes?: number;
      plannedBlockMinutes?: number;
    }>;
  }>;
  tripDutyDays?: Array<{
    hasScheduleChange?: boolean;
    isDeadhead?: boolean;
    premiumCode?: string | null;
  }>;
  status?: string;
}): PayTriggerSuggestion[] {
  const triggers: PayTriggerSuggestion[] = [];

  const dutyDays = trip.dutyDays ?? [];
  const allLegs = dutyDays.flatMap(dd => dd.legs ?? []);

  // JA (Junior Assignment) heuristic:
  // A deadhead leg in a trip suggests potential junior assignment
  const hasDeadhead = allLegs.some(l => l.isDeadhead);
  if (hasDeadhead) {
    triggers.push({
      type: 'junior_assignment',
      label: 'JA Possible',
      reason: 'Trip contains deadhead leg — possible junior/senior assignment',
      confidence: 'medium',
      suggestedCode: 'JA',
      suggestedMultiplier: 1.5,
    });
  }

  // Schedule change detected
  const hasScheduleChange = dutyDays.some(dd => dd.hasScheduleChange);
  if (hasScheduleChange) {
    triggers.push({
      type: 'schedule_change',
      label: 'AP1 Possible',
      reason: 'Schedule change detected — check if reassignment premium applies',
      confidence: 'high',
      suggestedCode: 'AP1',
    });
  }

  // Duty extension heuristic: actual block > planned block by more than 30 min
  const hasExtension = allLegs.some(l => {
    const actual = l.actualBlockMinutes ?? 0;
    const planned = l.plannedBlockMinutes ?? 0;
    return actual > 0 && planned > 0 && (actual - planned) > 30;
  });
  if (hasExtension) {
    triggers.push({
      type: 'duty_extension',
      label: 'Duty Extension Possible',
      reason: 'Actual block time exceeds planned — duty extension premium may apply',
      confidence: 'medium',
      suggestedCode: 'AP4',
    });
  }

  return triggers;
}
