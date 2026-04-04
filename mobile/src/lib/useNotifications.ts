/**
 * useNotifications Hook
 *
 * React Query-based hook for managing notifications.
 * Automatically schedules notifications when trips change.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  scheduleNotificationsForTrip,
  schedulePayPeriodEndingReminders,
  schedulePaydayReminders,
  scheduleRSVReportTimeReminder,
  cancelRSVNotifications,
  getScheduledNotificationStats,
  updateNotificationSettingsCache,
  type TripDutyDayForNotification,
  type PayPeriodData,
  type PaydayData,
  type RSVReportTimeData,
} from "@/lib/notificationService";
import type {
  GetNotificationSettingsResponse,
  UpdateNotificationSettingsRequest,
  UpdateNotificationSettingsResponse,
} from "@/lib/contracts";

// ============================================
// QUERY KEYS
// ============================================

export const notificationKeys = {
  all: ["notifications"] as const,
  settings: () => [...notificationKeys.all, "settings"] as const,
  scheduled: () => [...notificationKeys.all, "scheduled"] as const,
  stats: () => [...notificationKeys.all, "stats"] as const,
};

// ============================================
// SETTINGS HOOKS
// ============================================

export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationKeys.settings(),
    queryFn: async () => {
      const response = await api.get<GetNotificationSettingsResponse>(
        "/api/notifications/settings"
      );
      // Update local cache
      await updateNotificationSettingsCache(response.settings);
      return response.settings;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateNotificationSettingsRequest) => {
      const response = await api.put<UpdateNotificationSettingsResponse>(
        "/api/notifications/settings",
        data
      );
      // Update local cache
      await updateNotificationSettingsCache(response.settings);
      return response.settings;
    },
    onSuccess: (newSettings) => {
      queryClient.setQueryData(notificationKeys.settings(), newSettings);
    },
  });
}

// ============================================
// NOTIFICATION STATS
// ============================================

export function useNotificationStats() {
  return useQuery({
    queryKey: notificationKeys.stats(),
    queryFn: async () => {
      return getScheduledNotificationStats();
    },
    staleTime: 30 * 1000, // 30 seconds
  });
}

// ============================================
// TRIP NOTIFICATION SCHEDULING
// ============================================

interface TripForNotification {
  id: string;
  tripNumber: string | null;
  dutyDays: TripDutyDayForNotification[];
}

/**
 * Hook that automatically schedules notifications for trips
 */
export function useTripNotificationScheduler(trips: TripForNotification[] | undefined) {
  const { data: settings } = useNotificationSettings();

  useEffect(() => {
    if (!trips || !settings?.pushPermissionGranted || !settings?.reportTimeReminderEnabled) {
      return;
    }

    // Schedule notifications for all trips
    const scheduleAll = async () => {
      for (const trip of trips) {
        if (trip.dutyDays && trip.dutyDays.length > 0) {
          await scheduleNotificationsForTrip(trip.id, trip.tripNumber, trip.dutyDays);
        }
      }
    };

    scheduleAll().catch(console.error);
  }, [trips, settings?.pushPermissionGranted, settings?.reportTimeReminderEnabled]);
}

// ============================================
// PAY PERIOD NOTIFICATION SCHEDULING
// ============================================

interface PayPeriodInfo {
  year: number;
  periodNumber: number;
  startDate: string;
  endDate: string;
  payDate: string;
  payType?: "standard" | "remainder";
}

/**
 * Hook that schedules pay period and payday notifications
 */
export function usePayNotificationScheduler(
  currentPeriod: PayPeriodInfo | undefined,
  upcomingPayDates: Array<{ payDate: string; payType: "standard" | "remainder" }> | undefined
) {
  const { data: settings } = useNotificationSettings();

  useEffect(() => {
    if (!settings?.pushPermissionGranted) {
      return;
    }

    const schedulePayNotifications = async () => {
      // Schedule pay period ending reminders
      if (currentPeriod && settings.payPeriodEndingEnabled) {
        const periodData: PayPeriodData = {
          periodNumber: currentPeriod.periodNumber,
          year: currentPeriod.year,
          endDate: currentPeriod.endDate,
        };
        await schedulePayPeriodEndingReminders(periodData);
      }

      // Schedule payday reminders for upcoming pay dates
      if (upcomingPayDates && settings.paydayReminderEnabled) {
        for (const payInfo of upcomingPayDates.slice(0, 4)) {
          // Next 4 pay dates
          const paydayData: PaydayData = {
            payDate: payInfo.payDate,
            payType: payInfo.payType,
            periodNumber: currentPeriod?.periodNumber ?? 0,
            year: currentPeriod?.year ?? new Date().getFullYear(),
          };
          await schedulePaydayReminders(paydayData);
        }
      }
    };

    schedulePayNotifications().catch(console.error);
  }, [
    currentPeriod?.periodNumber,
    currentPeriod?.endDate,
    upcomingPayDates,
    settings?.pushPermissionGranted,
    settings?.payPeriodEndingEnabled,
    settings?.paydayReminderEnabled,
  ]);
}

// ============================================
// RSV (RESERVE SCHEDULE) NOTIFICATION SCHEDULING
// ============================================

interface ReserveScheduleEventForNotification {
  id: string;
  scheduleType: string;
  domicile: string;
  startDtLocal: string;
  windowStartLocal: string | null;
  windowEndLocal: string | null;
  reportForDutyMinutes: number | null;
  activationStatus: string;
}

/**
 * Determine if reserve domicile is international
 * ANC (Anchorage) serves international routes
 */
function isInternationalDomicile(domicile: string): boolean {
  // ANC primarily serves Pacific/Asian routes
  return domicile === "ANC";
}

/**
 * Convert window time string (HHmm) to ISO datetime for a given date
 */
function windowTimeToISO(dateStr: string, windowTime: string | null): string | null {
  if (!windowTime) return null;

  // Handle "2400" as midnight (00:00)
  const time = windowTime === "2400" ? "0000" : windowTime.padStart(4, "0");
  const hours = time.slice(0, 2);
  const mins = time.slice(2);

  // Extract date portion
  const datePart = dateStr.split("T")[0];

  return `${datePart}T${hours}:${mins}:00`;
}

/**
 * Hook that automatically schedules RSV report-for-duty notifications
 * Uses report_for_duty_minutes: SDF=90min, others=120min, LCO=960min
 */
export function useRSVNotificationScheduler(
  reserveEvents: ReserveScheduleEventForNotification[] | undefined
) {
  const { data: settings } = useNotificationSettings();

  useEffect(() => {
    if (!reserveEvents || !settings?.pushPermissionGranted || !settings?.reportTimeReminderEnabled) {
      return;
    }

    const scheduleAllRSV = async () => {
      for (const event of reserveEvents) {
        // Skip if already activated (don't need reminders for past events)
        if (event.activationStatus === "ACTIVATED") {
          continue;
        }

        // Skip if no report-for-duty time configured
        if (!event.reportForDutyMinutes) {
          continue;
        }

        // Calculate window start ISO
        const windowStartISO = windowTimeToISO(event.startDtLocal, event.windowStartLocal);
        if (!windowStartISO) {
          // Fallback to start time if no window
          continue;
        }

        // First cancel any existing notifications for this event
        await cancelRSVNotifications(event.id);

        const data: RSVReportTimeData = {
          reserveScheduleEventId: event.id,
          scheduleType: event.scheduleType,
          domicile: event.domicile,
          windowStartISO,
          reportForDutyMinutes: event.reportForDutyMinutes,
          isInternational: isInternationalDomicile(event.domicile),
        };

        await scheduleRSVReportTimeReminder(data);
      }
    };

    scheduleAllRSV().catch(console.error);
  }, [reserveEvents, settings?.pushPermissionGranted, settings?.reportTimeReminderEnabled]);
}

// Re-export types for convenience
export type { RSVReportTimeData };
