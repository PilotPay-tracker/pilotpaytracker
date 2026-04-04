/**
 * useLayoverCountdown Hook
 *
 * Provides live countdown functionality for layovers.
 * Calculates remaining rest time until next report based on:
 * 1. Authoritative OCR values (Crew Access or Trip Board)
 * 2. Calculated from nextReportLocalTime - currentLocalTime
 *
 * Updates every 60 seconds to show real-time countdown.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type LayoverSource = 'CREW_ACCESS' | 'TRIP_BOARD' | 'CALCULATED_FALLBACK' | 'UNKNOWN';

export interface LayoverCountdownData {
  /** Remaining minutes until report */
  remainingMinutes: number;
  /** Formatted HH:MM string */
  formattedTime: string;
  /** Whether countdown is active (> 0 minutes) */
  isActive: boolean;
  /** Whether it's time to report (<=0 minutes) */
  isReportTime: boolean;
  /** Whether warning threshold reached (<=60 minutes) */
  isWarning: boolean;
  /** Whether urgent threshold reached (<=10 minutes) */
  isUrgent: boolean;
  /** Source of the layover data */
  source: LayoverSource;
  /** Next report time ISO string (if known) */
  nextReportISO: string | null;
  /** Station where layover is occurring */
  station: string | null;
}

interface UseLayoverCountdownOptions {
  /** Authoritative rest minutes from OCR (overrides calculation) */
  authoritativeRestMinutes?: number;
  /** Source of authoritative data */
  authoritativeSource?: LayoverSource;
  /** Next report time in ISO format (for calculated fallback) */
  nextReportISO?: string | null;
  /** Station/airport code */
  station?: string | null;
  /** Update interval in milliseconds (default: 60000 = 1 minute) */
  updateInterval?: number;
  /** Whether to enable the countdown (default: true) */
  enabled?: boolean;
}

/**
 * Format minutes to HH:MM string
 */
function formatMinutesToHHMM(totalMinutes: number): string {
  if (totalMinutes < 0) return '00:00';
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.abs(totalMinutes) % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Calculate remaining minutes from now until report time
 */
function calculateRemainingMinutes(nextReportISO: string | null): number {
  if (!nextReportISO) return 0;

  try {
    const reportTime = new Date(nextReportISO);
    const now = new Date();
    const diffMs = reportTime.getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60));
  } catch {
    return 0;
  }
}

/**
 * Hook for live layover countdown
 */
export function useLayoverCountdown(options: UseLayoverCountdownOptions = {}): LayoverCountdownData {
  const {
    authoritativeRestMinutes,
    authoritativeSource = 'UNKNOWN',
    nextReportISO,
    station = null,
    updateInterval = 60000, // 1 minute
    enabled = true,
  } = options;

  // Track when we first received authoritative data
  const authoritativeStartTime = useRef<number | null>(null);
  const authoritativeStartMinutes = useRef<number | null>(null);

  const [countdownData, setCountdownData] = useState<LayoverCountdownData>(() => {
    const reportISO = nextReportISO ?? null;
    const initialMinutes = authoritativeRestMinutes ?? calculateRemainingMinutes(reportISO);
    return {
      remainingMinutes: initialMinutes,
      formattedTime: formatMinutesToHHMM(initialMinutes),
      isActive: initialMinutes > 0,
      isReportTime: initialMinutes <= 0,
      isWarning: initialMinutes <= 60 && initialMinutes > 0,
      isUrgent: initialMinutes <= 10 && initialMinutes > 0,
      source: authoritativeRestMinutes !== undefined ? authoritativeSource : 'CALCULATED_FALLBACK',
      nextReportISO: reportISO,
      station: station ?? null,
    };
  });

  // Calculate remaining minutes based on source
  const calculateCurrentMinutes = useCallback((): number => {
    // If we have authoritative data, calculate elapsed time since we received it
    if (authoritativeRestMinutes !== undefined && authoritativeStartTime.current !== null && authoritativeStartMinutes.current !== null) {
      const elapsedMs = Date.now() - authoritativeStartTime.current;
      const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
      return Math.max(0, authoritativeStartMinutes.current - elapsedMinutes);
    }

    // Otherwise calculate from report time
    return calculateRemainingMinutes(nextReportISO ?? null);
  }, [authoritativeRestMinutes, nextReportISO]);

  // Initialize authoritative tracking
  useEffect(() => {
    if (authoritativeRestMinutes !== undefined && authoritativeStartTime.current === null) {
      authoritativeStartTime.current = Date.now();
      authoritativeStartMinutes.current = authoritativeRestMinutes;
    }
  }, [authoritativeRestMinutes]);

  // Update countdown every interval
  useEffect(() => {
    if (!enabled) return;

    const updateCountdown = () => {
      const remainingMinutes = calculateCurrentMinutes();

      setCountdownData({
        remainingMinutes,
        formattedTime: formatMinutesToHHMM(remainingMinutes),
        isActive: remainingMinutes > 0,
        isReportTime: remainingMinutes <= 0,
        isWarning: remainingMinutes <= 60 && remainingMinutes > 0,
        isUrgent: remainingMinutes <= 10 && remainingMinutes > 0,
        source: authoritativeRestMinutes !== undefined ? authoritativeSource : 'CALCULATED_FALLBACK',
        nextReportISO: nextReportISO ?? null,
        station: station ?? null,
      });
    };

    // Initial update
    updateCountdown();

    // Set up interval
    const intervalId = setInterval(updateCountdown, updateInterval);

    return () => clearInterval(intervalId);
  }, [enabled, calculateCurrentMinutes, authoritativeRestMinutes, authoritativeSource, nextReportISO, station, updateInterval]);

  return countdownData;
}

/**
 * Parse OCR text for rest time from Crew Access
 * Looks for patterns like "Rest: 15:24" or "REST 09:45"
 */
export function parseCrewAccessRestTime(ocrText: string): number | null {
  // Pattern: "Rest:" followed by HH:MM
  const restPattern = /rest[:\s]+(\d{1,2}):(\d{2})/i;
  const match = ocrText.match(restPattern);

  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Parse OCR text for layover time from Trip Board
 * Looks for patterns like "L/O 38:12" or "Layover 12:44"
 */
export function parseTripBoardLayoverTime(ocrText: string): number | null {
  // Pattern: "L/O" or "Layover" followed by HH:MM
  const layoverPattern = /(?:l\/o|layover)[:\s]+(\d{1,2}):(\d{2})/i;
  const match = ocrText.match(layoverPattern);

  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours * 60 + minutes;
  }

  return null;
}

/**
 * Extract rest/layover time from OCR text
 * Tries Crew Access first, then Trip Board format
 */
export function extractRestTimeFromOCR(ocrText: string): { minutes: number; source: LayoverSource } | null {
  // Try Crew Access format first (authoritative)
  const crewAccessMinutes = parseCrewAccessRestTime(ocrText);
  if (crewAccessMinutes !== null) {
    return { minutes: crewAccessMinutes, source: 'CREW_ACCESS' };
  }

  // Try Trip Board format
  const tripBoardMinutes = parseTripBoardLayoverTime(ocrText);
  if (tripBoardMinutes !== null) {
    return { minutes: tripBoardMinutes, source: 'TRIP_BOARD' };
  }

  return null;
}
