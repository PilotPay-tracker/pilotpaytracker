/**
 * Schedule Store - Zustand store for pilot schedule management
 *
 * Features:
 * - Batch-based schedule storage
 * - Event management (flights, layovers, hotels, transport)
 * - Credit time tracking
 * - Monthly summaries
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

// ============================================
// Types
// ============================================

export type ScheduleSourceType = 'crew_access' | 'trip_board' | 'unknown';

export type EventType =
  | 'REPORT'
  | 'FLIGHT'
  | 'DEADHEAD'
  | 'LAYOVER'
  | 'HOTEL'
  | 'TRANSPORT'
  | 'RELEASE';

export interface ScheduleEvent {
  eventId: string;
  batchId: string;
  eventType: EventType;
  dateLocal: string; // YYYY-MM-DD
  startTimeLocal?: string; // HH:MM
  endTimeLocal?: string; // HH:MM
  depAirport?: string;
  arrAirport?: string;
  flightNumber?: string;
  equipment?: string;
  blockMinutes?: number;
  creditMinutes?: number;
  layoverMinutes?: number;
  station?: string;
  hotelName?: string;
  hotelPhone?: string;
  hotelAddress?: string;
  hotelBooked?: boolean;
  transportNotes?: string;
  transportPhone?: string;
  confidence: number; // 0-1
  rawText?: string;
  notes?: string;
}

export interface ScheduleBatch {
  batchId: string;
  sourceType: ScheduleSourceType;
  importedAt: string;
  dateRange: {
    start: string; // YYYY-MM-DD
    end: string;
  };
  events: ScheduleEvent[];
  totalCreditMinutes: number;
  confidence: number;
}

export interface DutyDaySummary {
  date: string;
  events: ScheduleEvent[];
  totalBlockMinutes: number;
  totalCreditMinutes: number;
  reportTime?: string;
  releaseTime?: string;
  dutyMinutes?: number;
  isGreen: boolean; // Credit meets/exceeds minimum
}

export interface MonthlyCreditSummary {
  yearMonth: string;
  dutyDays: number;
  totalCreditMinutes: number;
  targetCreditMinutes: number;
  percentComplete: number;
  isGreen: boolean;
  projectedMonthly?: number;
}

export interface ReplacePreview {
  existingBatches: ScheduleBatch[];
  overlappingDates: string[];
  newBatch: ScheduleBatch;
  willReplace: boolean;
}

// ============================================
// Store Interface
// ============================================

interface ScheduleStore {
  batches: ScheduleBatch[];

  // Actions
  addBatch: (batch: ScheduleBatch) => void;
  replaceBatch: (batch: ScheduleBatch, replaceOverlapping: boolean) => void;
  deleteBatch: (batchId: string) => void;
  deleteEvent: (batchId: string, eventId: string) => void;
  clearMonth: (yearMonth: string) => void;
  clearAll: () => void;

  // Queries
  getEventsForDate: (date: string) => ScheduleEvent[];
  getDutyDaySummary: (date: string) => DutyDaySummary;
  getMonthlyCreditSummary: (yearMonth: string) => MonthlyCreditSummary;
  getDatesWithEvents: (yearMonth: string) => Set<string>;
  generateReplacePreview: (newBatch: ScheduleBatch) => ReplacePreview | null;
}

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getYearMonth(date: string): string {
  return date.substring(0, 7); // YYYY-MM
}

function getAllEventsFromBatches(batches: ScheduleBatch[]): ScheduleEvent[] {
  return batches.flatMap(b => b.events);
}

// Monthly credit target (adjust based on airline requirements)
const MONTHLY_CREDIT_TARGET_MINUTES = 75 * 60; // 75 hours

// ============================================
// Store Implementation
// ============================================

export const useScheduleStore = create<ScheduleStore>()(
  persist(
    (set, get) => ({
      batches: [],

      addBatch: (batch) => {
        set((state) => ({
          batches: [...state.batches, batch],
        }));
      },

      replaceBatch: (batch, replaceOverlapping) => {
        set((state) => {
          if (!replaceOverlapping) {
            return { batches: [...state.batches, batch] };
          }

          // Find batches with overlapping dates
          const newDates = new Set(batch.events.map(e => e.dateLocal));
          const filteredBatches = state.batches.filter(existingBatch => {
            const hasOverlap = existingBatch.events.some(e => newDates.has(e.dateLocal));
            return !hasOverlap;
          });

          return { batches: [...filteredBatches, batch] };
        });
      },

      deleteBatch: (batchId) => {
        set((state) => ({
          batches: state.batches.filter(b => b.batchId !== batchId),
        }));
      },

      deleteEvent: (batchId, eventId) => {
        set((state) => ({
          batches: state.batches.map(batch => {
            if (batch.batchId !== batchId) return batch;
            return {
              ...batch,
              events: batch.events.filter(e => e.eventId !== eventId),
            };
          }).filter(batch => batch.events.length > 0), // Remove empty batches
        }));
      },

      clearMonth: (yearMonth) => {
        set((state) => ({
          batches: state.batches.map(batch => ({
            ...batch,
            events: batch.events.filter(e => getYearMonth(e.dateLocal) !== yearMonth),
          })).filter(batch => batch.events.length > 0),
        }));
      },

      clearAll: () => {
        set({ batches: [] });
      },

      getEventsForDate: (date) => {
        const { batches } = get();
        return getAllEventsFromBatches(batches)
          .filter(e => e.dateLocal === date)
          .sort((a, b) => {
            // Sort by time, then by event type priority
            const timeA = a.startTimeLocal || '00:00';
            const timeB = b.startTimeLocal || '00:00';
            if (timeA !== timeB) return timeA.localeCompare(timeB);

            const priority: Record<EventType, number> = {
              REPORT: 0,
              FLIGHT: 1,
              DEADHEAD: 2,
              LAYOVER: 3,
              HOTEL: 4,
              TRANSPORT: 5,
              RELEASE: 6,
            };
            return (priority[a.eventType] || 99) - (priority[b.eventType] || 99);
          });
      },

      getDutyDaySummary: (date) => {
        const events = get().getEventsForDate(date);

        let totalBlockMinutes = 0;
        let totalCreditMinutes = 0;
        let reportTime: string | undefined;
        let releaseTime: string | undefined;

        for (const event of events) {
          if (event.eventType === 'REPORT') {
            reportTime = event.startTimeLocal;
          }
          if (event.eventType === 'RELEASE') {
            releaseTime = event.endTimeLocal || event.startTimeLocal;
          }
          if (event.blockMinutes) {
            totalBlockMinutes += event.blockMinutes;
          }
          if (event.creditMinutes) {
            totalCreditMinutes += event.creditMinutes;
          }
        }

        // Calculate duty minutes if we have report/release times
        let dutyMinutes: number | undefined;
        if (reportTime && releaseTime) {
          const [rH, rM] = reportTime.split(':').map(Number);
          const [eH, eM] = releaseTime.split(':').map(Number);
          dutyMinutes = (eH * 60 + eM) - (rH * 60 + rM);
          if (dutyMinutes < 0) dutyMinutes += 24 * 60; // Handle overnight
        }

        // "In the green" = credit time >= 4 hours for a duty day
        const MIN_DAILY_CREDIT = 4 * 60;
        const isGreen = totalCreditMinutes >= MIN_DAILY_CREDIT || events.length === 0;

        return {
          date,
          events,
          totalBlockMinutes,
          totalCreditMinutes,
          reportTime,
          releaseTime,
          dutyMinutes,
          isGreen,
        };
      },

      getMonthlyCreditSummary: (yearMonth) => {
        const { batches } = get();
        const allEvents = getAllEventsFromBatches(batches);
        const monthEvents = allEvents.filter(e => getYearMonth(e.dateLocal) === yearMonth);

        // Get unique duty days
        const dutyDates = new Set<string>();
        let totalCreditMinutes = 0;

        for (const event of monthEvents) {
          if (event.eventType === 'FLIGHT' || event.eventType === 'DEADHEAD' || event.eventType === 'REPORT') {
            dutyDates.add(event.dateLocal);
          }
          if (event.creditMinutes) {
            totalCreditMinutes += event.creditMinutes;
          }
        }

        const percentComplete = Math.min(100, (totalCreditMinutes / MONTHLY_CREDIT_TARGET_MINUTES) * 100);
        const isGreen = totalCreditMinutes >= MONTHLY_CREDIT_TARGET_MINUTES;

        // Project monthly based on days elapsed
        const now = new Date();
        const [year, month] = yearMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const dayOfMonth = now.getFullYear() === year && now.getMonth() + 1 === month
          ? now.getDate()
          : daysInMonth;
        const projectedMonthly = dayOfMonth > 0
          ? Math.round((totalCreditMinutes / dayOfMonth) * daysInMonth)
          : 0;

        return {
          yearMonth,
          dutyDays: dutyDates.size,
          totalCreditMinutes,
          targetCreditMinutes: MONTHLY_CREDIT_TARGET_MINUTES,
          percentComplete,
          isGreen,
          projectedMonthly,
        };
      },

      getDatesWithEvents: (yearMonth) => {
        const { batches } = get();
        const allEvents = getAllEventsFromBatches(batches);
        const dates = new Set<string>();

        for (const event of allEvents) {
          if (getYearMonth(event.dateLocal) === yearMonth) {
            dates.add(event.dateLocal);
          }
        }

        return dates;
      },

      generateReplacePreview: (newBatch) => {
        const { batches } = get();
        const newDates = new Set(newBatch.events.map(e => e.dateLocal));

        const overlappingBatches: ScheduleBatch[] = [];
        const overlappingDates: string[] = [];

        for (const existingBatch of batches) {
          for (const event of existingBatch.events) {
            if (newDates.has(event.dateLocal)) {
              if (!overlappingBatches.includes(existingBatch)) {
                overlappingBatches.push(existingBatch);
              }
              if (!overlappingDates.includes(event.dateLocal)) {
                overlappingDates.push(event.dateLocal);
              }
            }
          }
        }

        if (overlappingBatches.length === 0) {
          return null;
        }

        return {
          existingBatches: overlappingBatches,
          overlappingDates: overlappingDates.sort(),
          newBatch,
          willReplace: true,
        };
      },
    }),
    {
      name: 'schedule-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// ============================================
// Image Import Function
// ============================================

export interface ImageInput {
  base64: string;
  mimeType: string;
  uri: string;
}

export interface ImportResult {
  success: boolean;
  batch?: ScheduleBatch;
  error?: string;
}

/**
 * Import schedule from images using OCR/AI parsing
 * This is a placeholder - the actual implementation would call an API
 */
export async function importScheduleImages(
  images: ImageInput[],
  forcedSourceType?: ScheduleSourceType
): Promise<ImportResult> {
  // For now, return a mock result
  // In a real implementation, this would:
  // 1. Upload images to backend
  // 2. Call OCR/AI service to parse schedule
  // 3. Return parsed events

  const batchId = generateId();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Mock batch for demonstration
  const mockBatch: ScheduleBatch = {
    batchId,
    sourceType: forcedSourceType || 'unknown',
    importedAt: new Date().toISOString(),
    dateRange: {
      start: todayStr,
      end: todayStr,
    },
    events: [],
    totalCreditMinutes: 0,
    confidence: 0,
  };

  return {
    success: true,
    batch: mockBatch,
  };
}
