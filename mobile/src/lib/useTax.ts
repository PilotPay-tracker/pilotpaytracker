/**
 * Tax Profile & Deductions Hooks
 *
 * React Query hooks for tax profile and deductions API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './useSession';
import { offlineCache } from './offlineStorage';
import { useIsOnline } from './useNetworkStatus';
import NetInfo from "@react-native-community/netinfo";
import {
  useTaxStore,
  type TaxProfile,
  type Deduction,
  type TaxBreakdown,
} from './state/tax-store';

// ============================================
// TYPES
// ============================================

interface StateOption {
  code: string;
  name: string;
  hasIncomeTax: boolean;
  defaultRate?: number;
}

interface TaxProfileResponse {
  profile: TaxProfile;
}

interface DeductionsResponse {
  deductions: Deduction[];
}

interface StatesResponse {
  states: StateOption[];
  noTaxStates: string[];
}

interface TaxCalculateResponse {
  breakdown: TaxBreakdown;
}

// ============================================
// QUERIES
// ============================================

// Get tax profile
export function useTaxProfile() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const setProfile = useTaxStore((s) => s.setProfile);
  const isOnline = useIsOnline();

  return useQuery({
    queryKey: ['tax-profile'],
    queryFn: async () => {
      const netState = await NetInfo.fetch();
      const currentlyOnline = (netState.isConnected ?? true) && netState.isInternetReachable !== false;
      if (!currentlyOnline) {
        const cached = await offlineCache.getTaxProfile<TaxProfileResponse>();
        if (cached) {
          console.log("[useTaxProfile] Using cached data (offline)");
          setProfile(cached.profile);
          return cached.profile;
        }
        throw new Error("No cached tax profile available offline");
      }
      const response = await api.get<TaxProfileResponse>('/api/tax/profile');
      await offlineCache.saveTaxProfile(response);
      // Sync to store
      setProfile(response.profile);
      return response.profile;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: isOnline ? 3 : 0,
    placeholderData: (previousData) => previousData,
  });
}

// Get deductions
export function useDeductions() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const setDeductions = useTaxStore((s) => s.setDeductions);

  return useQuery({
    queryKey: ['tax-deductions'],
    queryFn: async () => {
      const response = await api.get<DeductionsResponse>('/api/tax/deductions');
      // Sync to store
      setDeductions(response.deductions);
      return response.deductions;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}

// Get states list
export function useStates() {
  return useQuery({
    queryKey: ['tax-states'],
    queryFn: async () => {
      const response = await api.get<StatesResponse>('/api/tax/states');
      return response;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24 hours (static data)
  });
}

// ============================================
// MUTATIONS
// ============================================

// Update tax profile
export function useUpdateTaxProfile() {
  const queryClient = useQueryClient();
  const setProfile = useTaxStore((s) => s.setProfile);

  return useMutation({
    mutationFn: async (profile: Partial<TaxProfile>) => {
      const response = await api.put<{ success: boolean; profile: TaxProfile }>(
        '/api/tax/profile',
        profile
      );
      return response.profile;
    },
    onSuccess: (profile) => {
      setProfile(profile);
      queryClient.invalidateQueries({ queryKey: ['tax-profile'] });
    },
  });
}

// Create deduction
export function useCreateDeduction() {
  const queryClient = useQueryClient();
  const addDeduction = useTaxStore((s) => s.addDeduction);

  return useMutation({
    mutationFn: async (data: Omit<Deduction, 'id' | 'sortOrder'>) => {
      const response = await api.post<{ success: boolean; deduction: Deduction }>(
        '/api/tax/deductions',
        data
      );
      return response.deduction;
    },
    onSuccess: (deduction) => {
      addDeduction(deduction);
      queryClient.invalidateQueries({ queryKey: ['tax-deductions'] });
    },
  });
}

// Update deduction
export function useUpdateDeduction() {
  const queryClient = useQueryClient();
  const updateDeduction = useTaxStore((s) => s.updateDeduction);

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: Partial<Deduction> & { id: string }) => {
      const response = await api.put<{ success: boolean; deduction: Deduction }>(
        `/api/tax/deductions/${id}`,
        data
      );
      return response.deduction;
    },
    onSuccess: (deduction) => {
      updateDeduction(deduction.id, deduction);
      queryClient.invalidateQueries({ queryKey: ['tax-deductions'] });
    },
  });
}

// Delete deduction
export function useDeleteDeduction() {
  const queryClient = useQueryClient();
  const removeDeduction = useTaxStore((s) => s.removeDeduction);

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/tax/deductions/${id}`);
      return id;
    },
    onSuccess: (id) => {
      removeDeduction(id);
      queryClient.invalidateQueries({ queryKey: ['tax-deductions'] });
    },
  });
}

// Calculate net pay
export function useCalculateNetPay() {
  const setLastBreakdown = useTaxStore((s) => s.setLastBreakdown);

  return useMutation({
    mutationFn: async ({
      grossPayCents,
      ytdWagesCents = 0,
    }: {
      grossPayCents: number;
      ytdWagesCents?: number;
    }) => {
      const response = await api.post<TaxCalculateResponse>('/api/tax/calculate', {
        grossPayCents,
        ytdWagesCents,
      });
      return response.breakdown;
    },
    onSuccess: (breakdown) => {
      setLastBreakdown(breakdown);
    },
  });
}

// ============================================
// COMBINED DATA HOOK
// ============================================

/**
 * Combined hook that fetches both tax profile and deductions
 * and provides a calculate function
 */
export function useTaxSettings() {
  const profileQuery = useTaxProfile();
  const deductionsQuery = useDeductions();
  const statesQuery = useStates();
  const updateProfileMutation = useUpdateTaxProfile();
  const createDeductionMutation = useCreateDeduction();
  const updateDeductionMutation = useUpdateDeduction();
  const deleteDeductionMutation = useDeleteDeduction();
  const calculateMutation = useCalculateNetPay();

  return {
    // Data
    profile: profileQuery.data,
    deductions: deductionsQuery.data ?? [],
    states: statesQuery.data?.states ?? [],
    noTaxStates: statesQuery.data?.noTaxStates ?? [],

    // Loading states
    isLoading:
      profileQuery.isLoading ||
      deductionsQuery.isLoading ||
      statesQuery.isLoading,
    isUpdating:
      updateProfileMutation.isPending ||
      createDeductionMutation.isPending ||
      updateDeductionMutation.isPending ||
      deleteDeductionMutation.isPending,

    // Error states
    error:
      profileQuery.error?.message ||
      deductionsQuery.error?.message ||
      statesQuery.error?.message,

    // Mutations
    updateProfile: updateProfileMutation.mutateAsync,
    createDeduction: createDeductionMutation.mutateAsync,
    updateDeduction: updateDeductionMutation.mutateAsync,
    deleteDeduction: deleteDeductionMutation.mutateAsync,
    calculateNetPay: calculateMutation.mutateAsync,

    // Mutation states
    calculatePending: calculateMutation.isPending,
    lastBreakdown: calculateMutation.data,
  };
}
