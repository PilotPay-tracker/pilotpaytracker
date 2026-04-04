import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  GetDashboardResponse,
  GetProfileResponse,
  PilotProfile,
  GetUserSettingsResponse,
} from '@shared/contracts';

// ============================================
// Dashboard
// ============================================
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<GetDashboardResponse>('/api/dashboard'),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Profile
// ============================================
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<GetProfileResponse>('/api/profile'),
    staleTime: 10 * 60 * 1000,
  });
}

// ============================================
// Settings
// ============================================
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<GetUserSettingsResponse>('/api/settings'),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { hourlyRateCents?: number; airline?: string }) =>
      api.put<GetUserSettingsResponse>('/api/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ============================================
// Trips — types match backend Prisma response
// ============================================

/** Canonical leg from TripDutyDay → TripLeg (backend tripDutyDays relation) */
export interface BackendCanonicalLeg {
  id: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  equipment: string | null;
  isDeadhead: boolean;
  scheduledOutISO: string | null;
  actualOutISO: string | null;
  scheduledInISO: string | null;
  actualInISO: string | null;
  plannedBlockMinutes: number;
  actualBlockMinutes: number;
  plannedCreditMinutes: number;
  creditMinutes: number;
  legIndex: number;
}

/** Canonical layover from TripDutyDay → TripLayover */
export interface BackendCanonicalLayover {
  id: string;
  station: string | null;
  hotelName: string | null;
  restMinutes: number | null;
}

/** Canonical duty day from tripDutyDays relation */
export interface BackendCanonicalDutyDay {
  id: string;
  dutyDayIndex: number;
  dutyDate: string;
  reportTimeISO: string | null;
  releaseTimeISO: string | null;
  dutyMinutes: number;
  blockMinutes: number;
  creditMinutes: number;
  restAfterMinutes: number | null;
  layoverStation: string | null;
  legs: BackendCanonicalLeg[];
  layover: BackendCanonicalLayover | null;
}

/** Raw Prisma DutyDay → Leg (from dutyDays relation) */
export interface BackendRawLeg {
  id: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  equipment: string | null;
  isDeadhead: boolean;
  scheduledOutISO: string | null;
  actualOutISO: string | null;
  scheduledInISO: string | null;
  actualInISO: string | null;
  plannedBlockMinutes: number;
  actualBlockMinutes: number;
  plannedCreditMinutes: number;
  creditMinutes: number;
}

export interface BackendRawDutyDay {
  id: string;
  dutyDate: string;
  dutyStartISO: string | null;
  dutyEndISO: string | null;
  actualBlockMinutes: number;
  actualCreditMinutes: number;
  plannedBlockMinutes: number;
  plannedCreditMinutes: number;
  finalCreditMinutes: number;
  totalPayCents: number;
  legs: BackendRawLeg[];
}

export interface BackendTrip {
  id: string;
  tripNumber: string | null;
  baseFleet: string | null;
  startDate: string;
  endDate: string;
  totalBlockMinutes: number;
  totalCreditMinutes: number;
  totalPayCents: number;
  totalTafbMinutes: number;
  totalPdiemCents: number;  // Note: Prisma field is "totalPdiemCents" not "totalPerDiemCents"
  premiumCents: number;
  status: string;
  needsReview: boolean;
  source: string;
  tripActionType: string | null;
  pickupType: string | null;
  protectedCreditMinutes: number;
  currentCreditMinutes: number;
  payCreditMinutes: number;
  legCount: number;
  dutyDaysCount: number;
  // Raw Prisma dutyDays
  dutyDays: BackendRawDutyDay[];
  // Canonical tripDutyDays (preferred for display)
  tripDutyDays: BackendCanonicalDutyDay[];
}

interface TripsResponse {
  trips: BackendTrip[];
}

export function useTrips(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['trips', startDate, endDate],
    queryFn: () =>
      api.get<TripsResponse>(
        `/api/trips?startDate=${startDate}&endDate=${endDate}`
      ),
    staleTime: 60 * 1000,
  });
}

// ============================================
// Pay Periods
// ============================================
interface PayPeriod {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
  payType: 'standard' | 'remainder';
}

export function usePayPeriods() {
  return useQuery({
    queryKey: ['pay-periods'],
    queryFn: () => api.get<{ periods: PayPeriod[] }>('/api/pay-periods'),
    staleTime: 60 * 60 * 1000,
  });
}

// ============================================
// Profile Stats — matches actual backend response shape
// ============================================
export interface ProfileStatsResponse {
  allTime: {
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  currentYear: {
    year: number;
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  currentMonth: {
    month: string;
    flightCount: number;
    blockMinutes: number;
    creditMinutes: number;
    totalPayCents: number;
  };
  trips: {
    scheduled: number;
    inProgress: number;
    completed: number;
  };
}

export function useProfileStats() {
  return useQuery({
    queryKey: ['profile-stats'],
    queryFn: () => api.get<ProfileStatsResponse>('/api/profile/stats'),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Career — Projections
// ============================================

export interface PeriodProjection {
  actual: { payCents: number; creditMinutes: number; flights: number };
  projectedCents: number;
  projectedCreditMinutes: number;
  daysElapsed: number;
  daysRemaining: number;
  daysTotal: number;
  dailyAvgCents: number;
}

export interface GetProjectionsResponse {
  payPeriod: PeriodProjection;
  month: PeriodProjection;
  year: PeriodProjection;
}

export function useProjections() {
  return useQuery({
    queryKey: ['projections'],
    queryFn: () => api.get<GetProjectionsResponse>('/api/projections'),
    staleTime: 0,
    refetchOnMount: 'always' as const,
  });
}

export interface CalculateGoalRequest {
  targetCents: number;
  scope: 'YEAR' | 'MONTH' | 'PAY_PERIOD';
}

export interface CalculateGoalResponse {
  scope: string;
  targetCents: number;
  currentCents: number;
  remainingCents: number;
  progressPercent: number;
  requiredDailyPaceCents: number;
  requiredWeeklyPaceCents: number;
  daysRemaining: number;
  isAchievable: boolean;
}

export function useCalculateGoal() {
  return useMutation({
    mutationFn: (data: CalculateGoalRequest) =>
      api.post<CalculateGoalResponse>('/api/projections/goal', data),
  });
}

export interface WhatIfRequest {
  additionalCreditMinutes?: number;
  additionalTrips?: number;
  scope: 'YEAR' | 'MONTH' | 'PAY_PERIOD';
}

export interface WhatIfResponse {
  scope: string;
  currentCents: number;
  projectedCents: number;
  differenceCents: number;
  currentCreditMinutes: number;
  newCreditMinutes: number;
}

export function useWhatIf() {
  return useMutation({
    mutationFn: (data: WhatIfRequest) =>
      api.post<WhatIfResponse>('/api/projections/what-if', data),
  });
}

// ============================================
// Career — Projection History
// ============================================

export interface ProjectionHistoryMonth {
  month: string;
  year: number;
  monthNum: number;
  creditMinutes: number;
  blockMinutes: number;
  payCents: number;
  flights: number;
}

export function useProjectionHistory(months: number | 'all' = 'all') {
  return useQuery({
    queryKey: ['projection-history', months],
    queryFn: () =>
      api.get<{ months: ProjectionHistoryMonth[] }>(
        `/api/projections/history?months=${months}`
      ),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Career — Benchmarks
// ============================================

export interface UserComparisonResponse {
  hasBenchmarks: boolean;
  message?: string;
  userProfile?: {
    airline: string;
    position: string;
    yearOfService: number;
    hourlyRateCents: number;
  };
  currentBenchmark?: {
    seat: string;
    yearOfService: number;
    hourlyRateCents: number;
    payAtGuaranteeCents: number;
    avgLinePayCents: number;
    avgTotalPayCents: number;
    sourceNote: string | null;
    effectiveDate: string;
  };
  userPerformance?: {
    ytdPayCents: number;
    projectedAnnualCents: number;
    dayOfYear: number;
    percentOfBenchmarkGuarantee: number | null;
    percentOfBenchmarkAvgLine: number | null;
    percentOfBenchmarkAvgTotal: number | null;
    deltaFromGuaranteeCents: number | null;
    deltaFromAvgLineCents: number | null;
    utilizationPercent?: number;
    premiumPercentOfEarnings?: number;
  };
  upgradeSimulation?: {
    captainYearHourlyCents: number;
    captainYearAvgTotalCents: number;
    potentialIncreaseCents: number;
    percentIncrease: number | null;
    captainYear: number;
  };
  foEquivalentCents?: number | null;
}

export function useUserBenchmarkComparison() {
  return useQuery({
    queryKey: ['pay-benchmarks', 'user-comparison'],
    queryFn: () => api.get<UserComparisonResponse>('/api/pay-benchmarks/user-comparison'),
    staleTime: 5 * 60 * 1000,
  });
}

export interface UpgradeScenarioResponse {
  foYear: number;
  foAvgTotalCents: number;
  foHourlyCents: number;
  captainYear: number;
  captainAvgTotalCents: number;
  captainHourlyCents: number;
  netDifferenceCents: number;
  percentIncrease: number;
}

export function useUpgradeScenario(upgradeToYear: number, compareAgainstFoYear: number) {
  return useQuery({
    queryKey: ['pay-benchmarks', 'upgrade-scenario', upgradeToYear, compareAgainstFoYear],
    queryFn: () =>
      api.get<UpgradeScenarioResponse>(
        `/api/pay-benchmarks/upgrade-scenario?upgradeToYear=${upgradeToYear}&compareAgainstFoYear=${compareAgainstFoYear}`
      ),
    enabled: upgradeToYear > 0 && compareAgainstFoYear > 0,
  });
}

export interface CareerInsight {
  type: string;
  priority: number;
  title: string;
  message: string;
}

export function useCareerInsight() {
  return useQuery({
    queryKey: ['pay-benchmarks', 'career-insight'],
    queryFn: () => api.get<CareerInsight>('/api/pay-benchmarks/career-insight'),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Career — Lifetime Earnings
// ============================================

export interface LifetimeEarningsYear {
  id: string;
  year: number;
  grossEarningsCents: number;
  source: 'user' | 'app';
  isFinalized: boolean;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LifetimeEarningsSummary {
  totalCareerEarningsCents: number;
  yearsActive: number;
  averageAnnualEarningsCents: number;
  highestEarningYear?: { year: number; grossEarningsCents: number } | null;
  lowestEarningYear?: { year: number; grossEarningsCents: number } | null;
  currentYearEarningsCents: number;
  currentYearIsInProgress: boolean;
}

export interface LifetimeEarningsResponse {
  config: { airline: string; startYear: number };
  years: LifetimeEarningsYear[];
  summary: LifetimeEarningsSummary;
  airlineName: string;
}

export function useLifetimeEarnings() {
  return useQuery({
    queryKey: ['lifetime-earnings'],
    queryFn: () => api.get<LifetimeEarningsResponse>('/api/lifetime-earnings'),
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================
// Subscription Status
// ============================================

export interface SubscriptionStatusResponse {
  status: string;
  tier: string;
  trialStatus: string | null;
  trialDaysRemaining: number | null;
}

export function useSubscriptionStatus() {
  return useQuery({
    queryKey: ['subscription-status'],
    queryFn: () => api.get<SubscriptionStatusResponse>('/api/subscription/status'),
    staleTime: 10 * 60 * 1000,
  });
}
