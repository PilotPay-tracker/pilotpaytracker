/**
 * Tax Profile Store
 *
 * Manages tax profile settings for net pay estimation.
 * Persists to backend via API calls.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Types matching backend
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';
export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface TaxProfile {
  stateOfResidence: string;
  filingStatus: FilingStatus;
  payFrequency: PayFrequency;
  dependents: number;
  additionalCreditsCents: number;
  extraWithholdingType: 'fixed' | 'percent';
  extraWithholdingValue: number;
  stateWithholdingOverride?: number;
  taxYear: number;
}

export interface Deduction {
  id: string;
  name: string;
  deductionType: 'fixed' | 'percent';
  amount: number;
  timing: 'pretax' | 'posttax';
  frequency: 'per_paycheck' | 'monthly';
  isEnabled: boolean;
  sortOrder: number;
}

export interface TaxBreakdown {
  grossPayCents: number;
  pretaxDeductionsCents: number;
  taxableWagesCents: number;
  federalWithholdingCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  additionalMedicareCents: number;
  stateWithholdingCents: number;
  posttaxDeductionsCents: number;
  extraWithholdingCents: number;
  netPayCents: number;
  effectiveFederalRate: number;
  effectiveStateRate: number;
  effectiveTotalRate: number;
  pretaxDeductions: Array<{ name: string; amountCents: number }>;
  posttaxDeductions: Array<{ name: string; amountCents: number }>;
  stateInfo: { code: string; name: string; hasIncomeTax: boolean };
}

// Default tax profile
const DEFAULT_TAX_PROFILE: TaxProfile = {
  stateOfResidence: 'TX',
  filingStatus: 'single',
  payFrequency: 'biweekly',
  dependents: 0,
  additionalCreditsCents: 0,
  extraWithholdingType: 'fixed',
  extraWithholdingValue: 0,
  taxYear: 2024,
};

interface TaxState {
  // State
  profile: TaxProfile;
  deductions: Deduction[];
  showNetPay: boolean; // Toggle for Gross/Net
  lastBreakdown: TaxBreakdown | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setProfile: (profile: TaxProfile) => void;
  updateProfile: (updates: Partial<TaxProfile>) => void;
  setDeductions: (deductions: Deduction[]) => void;
  addDeduction: (deduction: Deduction) => void;
  updateDeduction: (id: string, updates: Partial<Deduction>) => void;
  removeDeduction: (id: string) => void;
  toggleShowNetPay: () => void;
  setShowNetPay: (show: boolean) => void;
  setLastBreakdown: (breakdown: TaxBreakdown | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useTaxStore = create<TaxState>()(
  persist(
    (set) => ({
      profile: DEFAULT_TAX_PROFILE,
      deductions: [],
      showNetPay: false,
      lastBreakdown: null,
      isLoading: false,
      error: null,

      setProfile: (profile) => set({ profile, error: null }),

      updateProfile: (updates) =>
        set((state) => ({
          profile: { ...state.profile, ...updates },
          error: null,
        })),

      setDeductions: (deductions) => set({ deductions }),

      addDeduction: (deduction) =>
        set((state) => ({
          deductions: [...state.deductions, deduction],
        })),

      updateDeduction: (id, updates) =>
        set((state) => ({
          deductions: state.deductions.map((d) =>
            d.id === id ? { ...d, ...updates } : d
          ),
        })),

      removeDeduction: (id) =>
        set((state) => ({
          deductions: state.deductions.filter((d) => d.id !== id),
        })),

      toggleShowNetPay: () =>
        set((state) => ({ showNetPay: !state.showNetPay })),

      setShowNetPay: (show) => set({ showNetPay: show }),

      setLastBreakdown: (breakdown) => set({ lastBreakdown: breakdown }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error, isLoading: false }),

      reset: () =>
        set({
          profile: DEFAULT_TAX_PROFILE,
          deductions: [],
          showNetPay: false,
          lastBreakdown: null,
          isLoading: false,
          error: null,
        }),
    }),
    {
      name: 'tax-settings-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profile: state.profile,
        deductions: state.deductions,
        showNetPay: state.showNetPay,
      }),
    }
  )
);

// Selectors
export const useTaxProfile = () => useTaxStore((s) => s.profile);
export const useDeductions = () => useTaxStore((s) => s.deductions);
export const useShowNetPay = () => useTaxStore((s) => s.showNetPay);
export const useLastBreakdown = () => useTaxStore((s) => s.lastBreakdown);
export const useTaxLoading = () => useTaxStore((s) => s.isLoading);
export const useTaxError = () => useTaxStore((s) => s.error);

// Actions selector
export const useTaxActions = () =>
  useTaxStore((s) => ({
    setProfile: s.setProfile,
    updateProfile: s.updateProfile,
    setDeductions: s.setDeductions,
    addDeduction: s.addDeduction,
    updateDeduction: s.updateDeduction,
    removeDeduction: s.removeDeduction,
    toggleShowNetPay: s.toggleShowNetPay,
    setShowNetPay: s.setShowNetPay,
    setLastBreakdown: s.setLastBreakdown,
    setLoading: s.setLoading,
    setError: s.setError,
    reset: s.reset,
  }));

// Filing status display labels
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married Filing Jointly',
  mfs: 'Married Filing Separately',
  hoh: 'Head of Household',
};

// Pay frequency display labels
export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly (52/year)',
  biweekly: 'Bi-weekly (26/year)',
  semimonthly: 'Semi-monthly (24/year)',
  monthly: 'Monthly (12/year)',
};
