/**
 * React Query hooks for Trip management
 * Connects frontend to backend /api/trips endpoints
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import { useSession } from "./useSession";
import { useAuth } from "./BetterAuthProvider";
import { offlineCache } from "./offlineStorage";
import { useIsOnline } from "./useNetworkStatus";
import NetInfo from "@react-native-community/netinfo";
import { syncQueue } from "./syncQueue";
import type {
  GetTripsResponse,
  GetTripResponse,
  CreateTripRequest,
  CreateTripResponse,
  UpdateTripRequest,
  UpdateTripResponse,
  DeleteTripResponse,
  Trip,
} from "@/lib/contracts";

// ============================================
// TYPES FOR DUTY DAYS & LEGS
// ============================================

export interface BackendLeg {
  id: string;
  dutyDayId: string;
  legIndex: number;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  equipment: string | null;
  tailNumber: string | null;
  isDeadhead: boolean;
  scheduledOutISO: string | null;
  scheduledInISO: string | null;
  plannedBlockMinutes: number;
  plannedCreditMinutes: number;
  actualOutISO: string | null;
  actualOffISO: string | null;
  actualOnISO: string | null;
  actualInISO: string | null;
  actualFlightMinutes: number;
  actualBlockMinutes: number;
  creditMinutes: number;
  premiumCode: string | null;
  premiumAmountCents: number;
  calculatedPayCents: number;
  source: string;
  ooiProofUri: string | null;
  ooiProofTimestamp: string | null;
  wasEdited: boolean;
  editedAt: string | null;
  needsReview: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDutyDay {
  id: string;
  tripId: string;
  dutyDate: string;
  dutyStartISO: string | null;
  dutyEndISO: string | null;
  plannedCreditMinutes: number;
  actualBlockMinutes: number;
  actualCreditMinutes: number;
  finalCreditMinutes: number;
  minCreditMinutes: number;
  totalPayCents: number;
  proofCount: number;
  hasAllActuals: boolean;
  hasPartialActuals: boolean;

  // Schedule Change & Override fields
  hasScheduleChange: boolean;
  scheduleChangeAt: string | null;
  scheduleChangeReason: string | null;
  scheduleChangeNotes: string | null;
  originalData: string | null;

  hasOverride: boolean;
  overrideAt: string | null;
  overrideReason: string | null;
  overridePersist: boolean;

  // Premium Pay fields
  premiumCode: string | null;
  premiumCreditMinutes: number;
  premiumPayCents: number;
  premiumAppliedAt: string | null;

  createdAt: string;
  updatedAt: string;
  legs: BackendLeg[];
}

export interface BackendTripEvent {
  id: string;
  tripId: string;
  dutyDayId: string | null;
  eventType: 'HOTEL' | 'LAYOVER' | 'REPORT' | 'FLIGHT' | 'DEADHEAD' | 'TRANSPORT' | 'COMMUTE' | 'OTHER';
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  startTimeUtc: string | null;
  endTimeUtc: string | null;
  timezone: string | null;
  depAirport: string | null;
  arrAirport: string | null;
  station: string | null;
  flightMetadata: string | null;
  layoverMinutes: number | null;
  hotelName: string | null;
  hotelPhone: string | null;
  hotelBooked: boolean;
  hotelAddress: string | null;
  transportNotes: string | null;
  transportPhone: string | null;
  creditMinutes: number;
  rawCreditText: string | null;
  minGuarantee: boolean;
  sortOrder: number;
  sourceType: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// CANONICAL TRIP BREAKDOWN TYPES
// ============================================

export interface BackendTripDutyLeg {
  id: string;
  tripDutyDayId: string;
  legIndex: number;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  equipment: string | null;
  isDeadhead: boolean;
  scheduledOutISO: string | null;
  scheduledInISO: string | null;
  actualOutISO: string | null;
  actualOffISO: string | null;
  actualOnISO: string | null;
  actualInISO: string | null;
  plannedBlockMinutes: number;
  plannedCreditMinutes: number;
  actualBlockMinutes: number;
  creditMinutes: number;
  // Phase 4: Premium fields
  premiumCode: string | null;
  premiumAmountCents: number;
  // SIK (Sick) tracking fields
  legStatus?: 'FLY' | 'SIK';
  legCompleted?: boolean;
  legDateLocal?: string | null;
}

export interface BackendTripLayover {
  id: string;
  tripDutyDayId: string;
  station: string;
  restMinutes: number;
  hotelName: string | null;
  hotelPhone: string | null;
  hotelAddress: string | null;
  hotelStatus: string | null;
  hotelSource: string | null;
  hotelConfidence: number;
  transportNotes: string | null;
  transportPhone: string | null;
}

export interface BackendTripDutyDay {
  id: string;
  tripId: string;
  dutyDayIndex: number;
  dutyDate: string;
  reportTimeISO: string | null;
  releaseTimeISO: string | null;
  dutyMinutes: number;
  blockMinutes: number;
  creditMinutes: number;
  restAfterMinutes: number | null;
  layoverStation: string | null;

  // Schedule Change & Override fields
  hasScheduleChange: boolean;
  scheduleChangeAt: string | null;
  scheduleChangeReason: string | null;
  scheduleChangeNotes: string | null;
  originalData: string | null;

  hasOverride: boolean;
  overrideAt: string | null;
  overrideReason: string | null;
  overridePersist: boolean;

  // Premium Pay fields
  premiumCode: string | null;
  premiumCreditMinutes: number;
  premiumPayCents: number;
  premiumAppliedAt: string | null;

  legs: BackendTripDutyLeg[];
  layover: BackendTripLayover | null;
}

export interface BackendTrip extends Trip {
  dutyDays?: BackendDutyDay[];
  events?: BackendTripEvent[];
  tripDutyDays?: BackendTripDutyDay[];  // Canonical trip breakdown
}

export interface CreateLegRequest {
  legIndex?: number;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  equipment?: string;
  tailNumber?: string;
  isDeadhead?: boolean;
  scheduledOutISO?: string;
  scheduledInISO?: string;
  plannedBlockMinutes?: number;
  plannedCreditMinutes?: number;
  actualOutISO?: string;
  actualOffISO?: string;
  actualOnISO?: string;
  actualInISO?: string;
  actualFlightMinutes?: number;
  actualBlockMinutes?: number;
  creditMinutes?: number;
  premiumCode?: string;
  premiumAmountCents?: number;
  source?: "import" | "oooi" | "manual";
  ooiProofUri?: string;
  notes?: string;
}

export interface UpdateLegRequest extends Partial<CreateLegRequest> {}

export interface CreateDutyDayRequest {
  dutyDate: string;
  dutyStartISO?: string;
  dutyEndISO?: string;
  plannedCreditMinutes?: number;
}

// ============================================
// GET TRIPS
// ============================================

export function useTrips(options?: {
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const { isProfileReady, isOptimisticallyAuthenticated } = useAuth();
  const isOnline = useIsOnline();
  const enabled = (isAuthenticated || isOptimisticallyAuthenticated) && isProfileReady;

  useEffect(() => {
    console.log(`[useTrips] enabled=${enabled} (isAuthenticated=${isAuthenticated}, isProfileReady=${isProfileReady})`);
  }, [enabled, isAuthenticated, isProfileReady]);

  return useQuery({
    queryKey: ["trips", options?.startDate, options?.endDate, options?.status],
    queryFn: async () => {
      console.log("[useTrips] queryFn FIRED — fetching trips", options?.startDate, options?.endDate, options?.status);
      // Check network inside queryFn so query key stays stable
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;

      // If offline, try to serve cached data
      if (!currentlyOnline) {
        const cacheKey = options?.startDate && options?.endDate
          ? `${options.startDate}_${options.endDate}`
          : null;
        const cached = cacheKey
          ? await offlineCache.getTripsForDate<{ trips: BackendTrip[] }>(options!.startDate!, options!.endDate!)
          : await offlineCache.getTrips<{ trips: BackendTrip[] }>();
        if (cached) {
          console.log("[useTrips] Using cached data (offline)");
          return cached;
        }
        throw new Error("No cached trips available offline");
      }

      const params = new URLSearchParams();
      if (options?.startDate) params.set("startDate", options.startDate);
      if (options?.endDate) params.set("endDate", options.endDate);
      if (options?.status) params.set("status", options.status);
      const queryString = params.toString();
      const url = queryString ? `/api/trips?${queryString}` : "/api/trips";
      const response = await api.get<{ trips: BackendTrip[] }>(url);

      // Cache the response for offline use
      if (options?.startDate && options?.endDate) {
        await offlineCache.saveTripsForDate(options.startDate, options.endDate, response);
      } else {
        await offlineCache.saveTrips(response);
      }

      return response;
    },
    enabled: (isAuthenticated || isOptimisticallyAuthenticated) && isProfileReady,
    staleTime: 1000 * 60 * 5, // 5 minutes - cached data shown immediately on app open
    gcTime: 1000 * 60 * 15,   // Keep in cache for 15 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });
}

// ============================================
// GET SINGLE TRIP
// ============================================

export function useTrip(tripId: string | null) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ["trip", tripId],
    queryFn: async () => {
      if (!tripId) throw new Error("No trip ID");

      // Check network inside queryFn so query key stays stable
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;

      // If offline, try to serve from the trips cache
      if (!currentlyOnline) {
        const cached = await offlineCache.getTrips<{ trips: BackendTrip[] }>();
        if (cached) {
          const trip = cached.trips.find((t) => t.id === tripId);
          if (trip) {
            console.log("[useTrip] Using cached trip (offline)");
            return { trip };
          }
        }
        throw new Error("No cached trip available offline");
      }

      const response = await api.get<{ trip: BackendTrip }>(`/api/trips/${tripId}`);
      return response;
    },
    enabled: isAuthenticated && !!tripId,
    staleTime: 1000 * 60, // 1 minute
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
    // Don't retry on 404 (stale trip ID) — only retry transient errors
    retry: (failureCount, error: any) => {
      if (error?.status === 404 || error?.message?.includes('404') || error?.message?.includes('not found')) return false;
      return failureCount < 2;
    },
  });
}

// ============================================
// CREATE TRIP
// ============================================

export function useCreateTrip() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (data: CreateTripRequest) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "CREATE_TRIP",
          "/api/trips",
          "POST",
          `Create trip: ${(data as any).tripNumber ?? "new trip"}`,
          data as unknown as object
        );
        return { trip: { ...data, id: `pending_${Date.now()}` } } as unknown as CreateTripResponse;
      }
      const response = await api.post<CreateTripResponse>("/api/trips", data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// UPDATE TRIP
// ============================================

export function useUpdateTrip() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async ({ tripId, data }: { tripId: string; data: UpdateTripRequest }) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "UPDATE_TRIP",
          `/api/trips/${tripId}`,
          "PUT",
          `Update trip`,
          data as unknown as object
        );
        return { trip: { id: tripId, ...data } } as unknown as UpdateTripResponse;
      }
      const response = await api.put<UpdateTripResponse>(`/api/trips/${tripId}`, data);
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip", variables.tripId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// MARK TRIP REVIEWED
// ============================================

export function useMarkTripReviewed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string) => {
      const response = await api.post<{ success: boolean; message: string }>(`/api/trips/${tripId}/mark-reviewed`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// DELETE TRIP
// ============================================

export function useDeleteTrip() {
  const queryClient = useQueryClient();
  const isOnline = useIsOnline();

  return useMutation({
    mutationFn: async (tripId: string) => {
      if (!isOnline) {
        await syncQueue.enqueue(
          "DELETE_TRIP",
          `/api/trips/${tripId}`,
          "DELETE",
          `Delete trip`
        );
        return { success: true } as unknown as DeleteTripResponse;
      }
      const response = await api.delete<DeleteTripResponse>(`/api/trips/${tripId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// COMPANY REMOVE TRIP (company-caused removal — preserves pay credit)
// ============================================

export function useCompanyRemoveTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string) => {
      const response = await api.patch<{ success: boolean; trip: { id: string } }>(
        `/api/trips/${tripId}/company-remove`,
        {}
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// MARK PICKUP TYPE (straight or JA)
// ============================================

export function useMarkPickupType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tripId, pickupType }: { tripId: string; pickupType: "none" | "straight" | "ja" }) => {
      const response = await api.patch<{ success: boolean; trip: { id: string; pickupType: string } }>(
        `/api/trips/${tripId}/mark-pickup`,
        { pickupType }
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// DROP TRIP (user-caused removal)
// ============================================

export function useDropTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string) => {
      const response = await api.patch<{ success: boolean; trip: { id: string } }>(
        `/api/trips/${tripId}/drop`,
        {}
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// DELETE ALL TRIPS
// ============================================

export function useDeleteAllTrips() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.delete<{ success: boolean; deletedCount: number; message: string }>(
        "/api/trips/all"
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
      queryClient.invalidateQueries({ queryKey: ["roster-changes"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-changes"] });
    },
  });
}

// ============================================
// ADD DUTY DAY
// ============================================

export function useAddDutyDay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tripId, data }: { tripId: string; data: CreateDutyDayRequest }) => {
      const response = await api.post<{ success: boolean; dutyDay: BackendDutyDay }>(
        `/api/trips/${tripId}/duty-days`,
        data
      );
      return response;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip", variables.tripId] });
    },
  });
}

// ============================================
// ADD LEG
// ============================================

export function useAddLeg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dutyDayId, data }: { dutyDayId: string; data: CreateLegRequest }) => {
      const response = await api.post<{ success: boolean; leg: BackendLeg }>(
        `/api/trips/duty-days/${dutyDayId}/legs`,
        data
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// UPDATE LEG
// ============================================

export function useUpdateLeg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ legId, data }: { legId: string; data: UpdateLegRequest }) => {
      const response = await api.put<{ success: boolean; leg: BackendLeg }>(
        `/api/trips/legs/${legId}`,
        data
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// UPDATE LEG PREMIUM (Phase 4)
// ============================================

export interface UpdateLegPremiumRequest {
  premiumCode: string;
  premiumMinutes: number;
  premiumAmountCents: number;
  notes?: string;
}

export function useUpdateLegPremium() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ legId, data }: { legId: string; data: UpdateLegPremiumRequest }) => {
      const response = await api.put<{ success: boolean; leg: BackendTripDutyLeg }>(
        `/api/trips/trip-duty-legs/${legId}/premium`,
        data
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// DELETE LEG
// ============================================

export function useDeleteLeg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (legId: string) => {
      const response = await api.delete<{ success: boolean }>(`/api/trips/legs/${legId}`);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// UPDATE TRIP DUTY LEG (Canonical breakdown legs)
// ============================================

export interface UpdateTripDutyLegRequest {
  actualOutISO?: string | null;
  actualOffISO?: string | null;
  actualOnISO?: string | null;
  actualInISO?: string | null;
  actualBlockMinutes?: number;
  creditMinutes?: number;
}

export function useUpdateTripDutyLeg() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ legId, data }: { legId: string; data: UpdateTripDutyLegRequest }) => {
      const response = await api.put<{ success: boolean; leg: BackendTripDutyLeg }>(
        `/api/trips/trip-duty-legs/${legId}`,
        data
      );
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// HELPER: Format minutes to time string
// ============================================

export function formatMinutesToTime(minutes: number): string {
  if (!minutes || minutes < 0) return "0:00";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

// ============================================
// HELPER: Format cents to currency
// ============================================

export function formatCentsToCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ============================================
// HELPER: Get trip status display
// ============================================

export function getTripStatusDisplay(status: string): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case "active":
      return { label: "Active", color: "text-emerald-400", bgColor: "bg-emerald-500/20" };
    case "completed":
      return { label: "Completed", color: "text-blue-400", bgColor: "bg-blue-500/20" };
    case "dropped":
      return { label: "Dropped", color: "text-red-400", bgColor: "bg-red-500/20" };
    default:
      return { label: status, color: "text-slate-400", bgColor: "bg-slate-500/20" };
  }
}

// ============================================
// BACKFILL TRIPS - Create DutyDays/Legs for existing trips
// ============================================

export function useBackfillTrips() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        success: boolean;
        tripsBackfilled: number;
        dutyDaysCreated: number;
        legsCreated: number;
      }>("/api/schedule/backfill");
      return response;
    },
    onSuccess: (data) => {
      // Only invalidate if we actually backfilled something
      if (data.tripsBackfilled > 0) {
        queryClient.invalidateQueries({ queryKey: ["trips"] });
        queryClient.invalidateQueries({ queryKey: ["trip"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["projections"] });
        console.log(
          `[useTripsData] Backfilled ${data.tripsBackfilled} trips with ${data.dutyDaysCreated} duty days and ${data.legsCreated} legs`
        );
      }
    },
  });
}

// ============================================
// FIX LEG CREDIT MINUTES - Fix existing legs with creditMinutes = 0
// ============================================

export function useFixLegCreditMinutes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        success: boolean;
        fixedLegs: number;
        dutyDaysUpdated: number;
      }>("/api/trips/fix-leg-credit-minutes");
      return response;
    },
    onSuccess: (data) => {
      console.log(`[useTripsData] Fixed ${data.fixedLegs} legs and ${data.dutyDaysUpdated} duty days`);
      // Invalidate all related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}

// ============================================
// SCHEDULE CHANGE - Apply schedule changes or overrides
// ============================================

export type ScheduleChangeReason =
  | 'reassignment'
  | 'reroute'
  | 'timing_change'
  | 'leg_added'
  | 'leg_removed'
  | 'other';

export type PremiumPayCode = 'JA' | 'RA' | 'EXT' | 'LA' | null;

export interface ScheduleChangeRequest {
  reason: ScheduleChangeReason;
  notes?: string;
  creditMinutes?: number;
  blockMinutes?: number;
  premiumCode?: PremiumPayCode;
  premiumCreditMinutes?: number;
  isOverride: boolean;
}

export function useApplyScheduleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dutyDayId,
      data,
    }: {
      dutyDayId: string;
      data: ScheduleChangeRequest;
    }) => {
      const response = await api.put<{
        success: boolean;
        dutyDay: BackendTripDutyDay | BackendDutyDay;
        eventType: string;
      }>(`/api/trips/duty-days/${dutyDayId}/schedule-change`, data);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projections"] });
    },
  });
}
