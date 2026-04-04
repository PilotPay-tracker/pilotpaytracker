// src/lib/oooi/scanHistoryStore.ts
// Tracks all ACARS scans with method used and links to legs

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ParseMethod = 'ocr' | 'openai' | 'manual';

export interface ScanHistoryEntry {
  id: string;
  timestamp: number;
  method: ParseMethod;
  confidence: number;
  rawText?: string;
  imageUri?: string;

  // Parsed data
  flightNumber?: string;
  origin?: string;
  destination?: string;
  date?: string;
  outTime?: string;
  offTime?: string;
  onTime?: string;
  inTime?: string;

  // Link to leg if applied
  linkedLegId?: string;
  linkedDutyDayId?: string;
  linkedTripId?: string;

  // Status
  wasApplied: boolean;
  errorMessage?: string;
}

interface ScanHistoryState {
  entries: ScanHistoryEntry[];

  // Actions
  addScan: (entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>) => string;
  linkToLeg: (scanId: string, legId: string, dutyDayId: string, tripId: string) => void;
  markAsApplied: (scanId: string) => void;
  deleteScan: (scanId: string) => void;
  clearHistory: () => void;

  // Queries
  getRecentScans: (limit?: number) => ScanHistoryEntry[];
  getScansByMethod: (method: ParseMethod) => ScanHistoryEntry[];
  getScansForLeg: (legId: string) => ScanHistoryEntry[];
  getUnappliedScans: () => ScanHistoryEntry[];
}

export const useScanHistoryStore = create<ScanHistoryState>()(
  persist(
    (set, get) => ({
      entries: [],

      addScan: (entry) => {
        const id = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newEntry: ScanHistoryEntry = {
          ...entry,
          id,
          timestamp: Date.now(),
        };

        set((state) => ({
          entries: [newEntry, ...state.entries].slice(0, 500), // Keep last 500 entries
        }));

        return id;
      },

      linkToLeg: (scanId, legId, dutyDayId, tripId) => {
        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === scanId
              ? {
                  ...entry,
                  linkedLegId: legId,
                  linkedDutyDayId: dutyDayId,
                  linkedTripId: tripId,
                  wasApplied: true,
                }
              : entry
          ),
        }));
      },

      markAsApplied: (scanId) => {
        set((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === scanId ? { ...entry, wasApplied: true } : entry
          ),
        }));
      },

      deleteScan: (scanId) => {
        set((state) => ({
          entries: state.entries.filter((entry) => entry.id !== scanId),
        }));
      },

      clearHistory: () => {
        set({ entries: [] });
      },

      getRecentScans: (limit = 50) => {
        return get().entries.slice(0, limit);
      },

      getScansByMethod: (method) => {
        return get().entries.filter((entry) => entry.method === method);
      },

      getScansForLeg: (legId) => {
        return get().entries.filter((entry) => entry.linkedLegId === legId);
      },

      getUnappliedScans: () => {
        return get().entries.filter((entry) => !entry.wasApplied);
      },
    }),
    {
      name: 'scan-history-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
