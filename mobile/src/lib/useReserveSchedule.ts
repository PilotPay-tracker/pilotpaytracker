/**
 * Reserve Schedule API Hooks
 * Handles reserve/standby/training schedule events (RSVA, RSVB, RSVC, RSVD, HOT, LCO, RCID, TRNG)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { offlineCache } from './offlineStorage';
import { useIsOnline } from './useNetworkStatus';
import NetInfo from "@react-native-community/netinfo";
import type {
  ReserveScheduleEvent,
  ActivationLeg,
  ReserveScheduleType,
  ActivationStatus,
  ReserveWindowConfig,
} from '@/lib/contracts';

// Re-export types for convenience
export type {
  ReserveScheduleEvent,
  ActivationLeg,
  ReserveScheduleType,
  ActivationStatus,
  ReserveWindowConfig,
};

// ============================================
// Query Keys
// ============================================

export const reserveScheduleKeys = {
  all: ['reserve-schedule'] as const,
  lists: () => [...reserveScheduleKeys.all, 'list'] as const,
  list: (filters: {
    startDate?: string;
    endDate?: string;
    scheduleType?: ReserveScheduleType;
    activationStatus?: ActivationStatus;
    includeLegs?: boolean;
  }) => [...reserveScheduleKeys.lists(), filters] as const,
  details: () => [...reserveScheduleKeys.all, 'detail'] as const,
  detail: (id: string) => [...reserveScheduleKeys.details(), id] as const,
  windowConfigs: () => [...reserveScheduleKeys.all, 'window-configs'] as const,
  auditLog: () => [...reserveScheduleKeys.all, 'audit-log'] as const,
};

// ============================================
// API Functions
// ============================================

interface ListReserveScheduleParams {
  startDate?: string;
  endDate?: string;
  scheduleType?: ReserveScheduleType;
  activationStatus?: ActivationStatus;
  includeLegs?: boolean;
}

interface ListReserveScheduleResponse {
  events: ReserveScheduleEvent[];
  totalCount: number;
}

async function listReserveSchedule(
  params: ListReserveScheduleParams
): Promise<ListReserveScheduleResponse> {
  const queryParams = new URLSearchParams();
  if (params.startDate) queryParams.set('startDate', params.startDate);
  if (params.endDate) queryParams.set('endDate', params.endDate);
  if (params.scheduleType) queryParams.set('scheduleType', params.scheduleType);
  if (params.activationStatus) queryParams.set('activationStatus', params.activationStatus);
  if (params.includeLegs) queryParams.set('includeLegs', 'true');

  const url = `/api/reserve-schedule?${queryParams.toString()}`;
  return api.get(url);
}

async function getReserveScheduleEvent(id: string): Promise<{ event: ReserveScheduleEvent }> {
  return api.get(`/api/reserve-schedule/${id}`);
}

interface CreateReserveScheduleRequest {
  scheduleType: ReserveScheduleType;
  domicile: string;
  startDtLocal: string;
  endDtLocal: string;
  creditHours: number;
  notes?: string;
  sourceUploadId?: string;
}

async function createReserveSchedule(
  data: CreateReserveScheduleRequest
): Promise<{ success: boolean; event: ReserveScheduleEvent }> {
  return api.post('/api/reserve-schedule', data);
}

interface UpdateReserveScheduleRequest {
  domicile?: string;
  startDtLocal?: string;
  endDtLocal?: string;
  creditHours?: number;
  notes?: string;
}

async function updateReserveSchedule(
  id: string,
  data: UpdateReserveScheduleRequest
): Promise<{ success: boolean; event: ReserveScheduleEvent; creditLockViolation?: boolean }> {
  return api.put(`/api/reserve-schedule/${id}`, data);
}

async function deleteReserveSchedule(id: string): Promise<{ success: boolean }> {
  return api.delete(`/api/reserve-schedule/${id}`);
}

interface ActivateLegData {
  flightNumber?: string;
  origin: string;
  destination: string;
  depDtLocal: string;
  arrDtLocal: string;
  blockMinutes?: number;
  equipment?: string;
  tailNumber?: string;
  isDeadhead?: boolean;
  actualOutISO?: string;
  actualOffISO?: string;
  actualOnISO?: string;
  actualInISO?: string;
}

interface ActivateReserveScheduleRequest {
  legs: ActivateLegData[];
  sourceUploadId?: string;
}

interface ActivateReserveScheduleResponse {
  success: boolean;
  event: ReserveScheduleEvent;
  legsAdded: number;
  blockHoursUpdated: number;
  creditLocked: boolean;
}

async function activateReserveSchedule(
  id: string,
  data: ActivateReserveScheduleRequest
): Promise<ActivateReserveScheduleResponse> {
  return api.post(`/api/reserve-schedule/${id}/activate`, data);
}

interface MatchActivationRequest {
  legs: Array<{
    flightNumber?: string;
    origin: string;
    destination: string;
    depDtLocal: string;
    arrDtLocal: string;
    blockMinutes?: number;
    equipment?: string;
  }>;
  sourceUploadId?: string;
}

interface MatchActivationResponse {
  matched: boolean;
  matchedEvent: ReserveScheduleEvent | null;
  reason: string;
}

async function matchActivation(data: MatchActivationRequest): Promise<MatchActivationResponse> {
  return api.post('/api/reserve-schedule/match-activation', data);
}

async function getWindowConfigs(): Promise<{ configs: ReserveWindowConfig[] }> {
  return api.get('/api/reserve-schedule/window-configs');
}

interface CreditLockAuditLog {
  id: string;
  userId: string;
  reserveScheduleEventId: string;
  attemptedCreditHours: number;
  originalCreditHours: number;
  actionTaken: string;
  reason: string | null;
  createdAt: string;
}

async function getAuditLog(): Promise<{ logs: CreditLockAuditLog[]; totalCount: number }> {
  return api.get('/api/reserve-schedule/audit-log');
}

/**
 * Seed test data for RSV/LCO/HOT/RCID (development only)
 */
async function seedTestData(): Promise<{
  success: boolean;
  createdCount: number;
  skippedCount: number;
  events: ReserveScheduleEvent[];
  skipped: Array<{ scheduleType: string; startDtLocal: string; reason: string }>;
}> {
  return api.post('/api/reserve-schedule/seed-test-data', {});
}

// ============================================
// React Query Hooks
// ============================================

/**
 * Hook to list reserve schedule events
 */
export function useReserveSchedule(params: ListReserveScheduleParams = {}) {
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: [...reserveScheduleKeys.list(params)],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const start = params.startDate ?? "";
        const end = params.endDate ?? "";
        const cached = await offlineCache.getReserveSchedule<ListReserveScheduleResponse>(start, end);
        if (cached) {
          console.log("[useReserveSchedule] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached reserve schedule available offline");
      }
      const response = await listReserveSchedule(params);
      if (params.startDate && params.endDate) {
        await offlineCache.saveReserveSchedule(params.startDate, params.endDate, response);
      }
      return response;
    },
    staleTime: 30000, // 30 seconds
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Hook to get a single reserve schedule event
 */
export function useReserveScheduleEvent(id: string | null) {
  return useQuery({
    queryKey: reserveScheduleKeys.detail(id ?? ''),
    queryFn: () => getReserveScheduleEvent(id!),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to get reserve window configurations
 */
export function useReserveWindowConfigs() {
  return useQuery({
    queryKey: reserveScheduleKeys.windowConfigs(),
    queryFn: getWindowConfigs,
    staleTime: Infinity, // Static data, never stale
  });
}

/**
 * Hook to get credit lock audit log
 */
export function useCreditLockAuditLog() {
  return useQuery({
    queryKey: reserveScheduleKeys.auditLog(),
    queryFn: getAuditLog,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to create a reserve schedule event
 */
export function useCreateReserveSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createReserveSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.lists() });
    },
  });
}

/**
 * Hook to update a reserve schedule event
 * NOTE: If creditLockViolation is true in response, the credit update was blocked
 */
export function useUpdateReserveSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReserveScheduleRequest }) =>
      updateReserveSchedule(id, data),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.detail(variables.id) });
      if (result.creditLockViolation) {
        queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.auditLog() });
      }
    },
  });
}

/**
 * Hook to delete a reserve schedule event
 */
export function useDeleteReserveSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteReserveSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.lists() });
    },
  });
}

/**
 * Hook to activate a reserve schedule event (attach flying legs)
 */
export function useActivateReserveSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ActivateReserveScheduleRequest }) =>
      activateReserveSchedule(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.detail(variables.id) });
    },
  });
}

/**
 * Hook to match activation legs to existing RSV events
 */
export function useMatchActivation() {
  return useMutation({
    mutationFn: matchActivation,
  });
}

/**
 * Hook to seed test data for RSV/LCO/HOT/RCID (development only)
 */
export function useSeedTestData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: seedTestData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reserveScheduleKeys.lists() });
    },
  });
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get display name for schedule type
 */
export function getScheduleTypeDisplayName(type: ReserveScheduleType): string {
  const names: Record<ReserveScheduleType, string> = {
    RSVA: 'Reserve A',
    RSVB: 'Reserve B',
    RSVC: 'Reserve C',
    RSVD: 'Reserve D',
    HOT: 'Airport Standby (HOT)',
    LCO: 'Long Call Out',
    RCID: 'RCID',
    TRNG: 'Training',
  };
  return names[type] ?? type;
}

/**
 * Get short name for schedule type (for badges)
 */
export function getScheduleTypeShortName(type: ReserveScheduleType): string {
  const names: Record<ReserveScheduleType, string> = {
    RSVA: 'RSV-A',
    RSVB: 'RSV-B',
    RSVC: 'RSV-C',
    RSVD: 'RSV-D',
    HOT: 'HOT',
    LCO: 'LCO',
    RCID: 'RCID',
    TRNG: 'TRNG',
  };
  return names[type] ?? type;
}

/**
 * Check if schedule type is a reserve type (has credit lock)
 */
export function isReserveType(type: ReserveScheduleType): boolean {
  return ['RSVA', 'RSVB', 'RSVC', 'RSVD'].includes(type);
}

/**
 * Format activation status for display
 */
export function formatActivationStatus(status: ActivationStatus): string {
  const labels: Record<ActivationStatus, string> = {
    UNACTIVATED: 'Unactivated',
    PARTIAL: 'Partial',
    ACTIVATED: 'Activated',
  };
  return labels[status] ?? status;
}

/**
 * Get color for activation status badge
 */
export function getActivationStatusColor(status: ActivationStatus): {
  bg: string;
  text: string;
} {
  const colors: Record<ActivationStatus, { bg: string; text: string }> = {
    UNACTIVATED: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    PARTIAL: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
    ACTIVATED: { bg: 'bg-green-500/20', text: 'text-green-400' },
  };
  return colors[status] ?? colors.UNACTIVATED;
}

/**
 * Format reserve window time (e.g., "2400" -> "00:00" or "1200" -> "12:00")
 */
export function formatWindowTime(time: string | null): string {
  if (!time) return '--:--';
  // Handle "2400" as "00:00"
  if (time === '2400') return '00:00';
  // Format HHmm to HH:mm
  const padded = time.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}
