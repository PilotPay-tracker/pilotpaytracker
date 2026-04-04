/**
 * Comprehensive Notification Service
 *
 * Manages all app notifications:
 * - Report Time Reminders (60m domestic / 90m international)
 * - Pay Period Ending Reminders (48h / 24h before)
 * - Payday Reminders (2 days / 1 day / morning of) with Big/Small Check labels
 * - Arrival Welcome notifications
 * - Pay Statement Ready notifications
 *
 * Supports quiet hours and confidence filtering.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ============================================
// CONFIGURATION
// ============================================

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Storage keys
const NOTIFICATION_SETTINGS_KEY = "notification_settings_cache";
const SCHEDULED_NOTIFICATIONS_KEY = "scheduled_notifications";

// ============================================
// TYPES
// ============================================

export type NotificationType =
  | "report_time"
  | "rsv_report_time"
  | "pay_period_ending"
  | "payday"
  | "arrival_welcome"
  | "pay_statement_ready"
  | "showtime"
  | "warning";

export interface NotificationSettings {
  pushPermissionGranted: boolean;
  reportTimeReminderEnabled: boolean;
  reportTimeLeadMinutes: number;
  payPeriodEndingEnabled: boolean;
  payPeriodEndingHours48: boolean;
  payPeriodEndingHours24: boolean;
  paydayReminderEnabled: boolean;
  paydayReminder2DaysBefore: boolean;
  paydayReminder1DayBefore: boolean;
  paydayReminderMorningOf: boolean;
  arrivalWelcomeEnabled: boolean;
  arrivalHighConfidenceOnly: boolean;
  payStatementReadyEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursAction: "delay" | "skip";
  highConfidenceOnly: boolean;
}

export interface ReportTimeData {
  tripId: string;
  tripNumber: string | null;
  dutyDayId: string;
  reportTimeISO: string;
  station: string | null;
  flightNumber?: string | null;
  destination?: string | null;
  isInternational: boolean;
}

/**
 * RSV (Reserve Schedule) Report Time Data
 * Uses report_for_duty_minutes instead of standard lead times
 */
export interface RSVReportTimeData {
  reserveScheduleEventId: string;
  scheduleType: string; // RSVA, RSVB, RSVC, RSVD, HOT, LCO, etc.
  domicile: string;
  windowStartISO: string; // When the reserve window starts
  reportForDutyMinutes: number; // SDF=90, others=120, LCO=960
  isInternational: boolean;
}

export interface PayPeriodData {
  periodNumber: number;
  year: number;
  endDate: string;
}

export interface PaydayData {
  payDate: string;
  payType: "standard" | "remainder"; // standard = Small Check (Advance), remainder = Big Check (Settlement)
  periodNumber: number;
  year: number;
  estimatedPayCents?: number; // Optional: estimated pay for this period for notification
}

export interface ArrivalData {
  tripId: string;
  legId: string;
  destination: string;
  arrivalTimeISO: string;
  confidence: "low" | "medium" | "high";
}

// Default settings
const DEFAULT_SETTINGS: NotificationSettings = {
  pushPermissionGranted: false,
  reportTimeReminderEnabled: true,
  reportTimeLeadMinutes: 60,
  payPeriodEndingEnabled: true,
  payPeriodEndingHours48: true,
  payPeriodEndingHours24: false,
  paydayReminderEnabled: true,
  paydayReminder2DaysBefore: false,
  paydayReminder1DayBefore: true,
  paydayReminderMorningOf: true,
  arrivalWelcomeEnabled: true,
  arrivalHighConfidenceOnly: true,
  payStatementReadyEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  quietHoursAction: "delay",
  highConfidenceOnly: true,
};

// ============================================
// SETTINGS MANAGEMENT
// ============================================

let cachedSettings: NotificationSettings | null = null;

export async function getNotificationSettings(): Promise<NotificationSettings> {
  if (cachedSettings) return cachedSettings;

  try {
    const stored = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (stored) {
      const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } as NotificationSettings;
      cachedSettings = parsed;
      return parsed;
    }
  } catch (error) {
    console.error("[NotificationService] Error loading settings:", error);
  }

  return DEFAULT_SETTINGS;
}

export async function updateNotificationSettingsCache(
  settings: Partial<NotificationSettings>
): Promise<void> {
  const current = await getNotificationSettings();
  cachedSettings = { ...current, ...settings };
  await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(cachedSettings));
}

// ============================================
// PERMISSION HANDLING
// ============================================

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === "granted") {
    await updateNotificationSettingsCache({ pushPermissionGranted: true });
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  const granted = status === "granted";
  await updateNotificationSettingsCache({ pushPermissionGranted: granted });
  return granted;
}

export async function checkNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

// ============================================
// QUIET HOURS LOGIC
// ============================================

function isInQuietHours(date: Date, settings: NotificationSettings): boolean {
  if (!settings.quietHoursEnabled) return false;

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const currentTime = hours * 60 + minutes;

  const [startH, startM] = settings.quietHoursStart.split(":").map(Number);
  const [endH, endM] = settings.quietHoursEnd.split(":").map(Number);
  const startTime = (startH ?? 22) * 60 + (startM ?? 0);
  const endTime = (endH ?? 7) * 60 + (endM ?? 0);

  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

function getQuietHoursEndTime(date: Date, settings: NotificationSettings): Date {
  const [endH, endM] = settings.quietHoursEnd.split(":").map(Number);
  const result = new Date(date);
  result.setHours(endH ?? 7, endM ?? 0, 0, 0);

  // If end time is earlier than current time, it's the next day
  if (result <= date) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

function adjustForQuietHours(
  scheduledTime: Date,
  settings: NotificationSettings
): Date | null {
  if (!isInQuietHours(scheduledTime, settings)) {
    return scheduledTime;
  }

  if (settings.quietHoursAction === "skip") {
    return null;
  }

  // Delay to end of quiet hours
  return getQuietHoursEndTime(scheduledTime, settings);
}

// ============================================
// REPORT TIME REMINDERS (Phase 2)
// ============================================

export async function scheduleReportTimeReminder(
  data: ReportTimeData
): Promise<string | null> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.reportTimeReminderEnabled) {
    return null;
  }

  try {
    const reportTime = new Date(data.reportTimeISO);
    const now = new Date();

    if (reportTime <= now) {
      return null;
    }

    // Determine lead time: 60m domestic, 90m international
    const leadMinutes = data.isInternational ? 90 : 60;
    let notifyTime = new Date(reportTime.getTime() - leadMinutes * 60 * 1000);

    // Check quiet hours
    const adjustedTime = adjustForQuietHours(notifyTime, settings);
    if (!adjustedTime) {
      console.log("[NotificationService] Report reminder skipped due to quiet hours");
      return null;
    }
    notifyTime = adjustedTime;

    if (notifyTime <= now) {
      return null;
    }

    // Build notification content
    const leadText = data.isInternational ? "90 minutes" : "60 minutes";
    const flightInfo = data.flightNumber ? `FLT ${data.flightNumber}` : "Your flight";
    const routeInfo =
      data.station && data.destination ? `${data.station}→${data.destination}` : data.station ?? "";

    // Format time HH:MM
    const timeStr = reportTime.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Report Time Reminder",
        body: `Report in ${leadText} — ${flightInfo} ${routeInfo} at ${timeStr}`,
        data: {
          type: "report_time" as NotificationType,
          tripId: data.tripId,
          dutyDayId: data.dutyDayId,
          isInternational: data.isInternational,
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifyTime,
      },
    });

    console.log(
      `[NotificationService] Scheduled report reminder for ${notifyTime.toISOString()}`
    );
    return notificationId;
  } catch (error) {
    console.error("[NotificationService] Failed to schedule report reminder:", error);
    return null;
  }
}

// ============================================
// RSV REPORT-FOR-DUTY REMINDERS (Phase 2 - Reserve Schedule)
// Uses report_for_duty_minutes: SDF=90, others=120, LCO=960
// ============================================

/**
 * Schedule RSV (Reserve Schedule) report-for-duty reminder
 *
 * For RSV events, we use the specific report_for_duty_minutes value
 * - SDF domicile: 90 minutes before window start
 * - Other domiciles: 120 minutes before window start
 * - LCO: 960 minutes (16 hours) before
 *
 * The notification fires report_for_duty_minutes BEFORE the window start time.
 */
export async function scheduleRSVReportTimeReminder(
  data: RSVReportTimeData
): Promise<string | null> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.reportTimeReminderEnabled) {
    return null;
  }

  try {
    const windowStart = new Date(data.windowStartISO);
    const now = new Date();

    if (windowStart <= now) {
      return null;
    }

    // Calculate notification time: window start - report_for_duty_minutes
    let notifyTime = new Date(windowStart.getTime() - data.reportForDutyMinutes * 60 * 1000);

    // Check quiet hours
    const adjustedTime = adjustForQuietHours(notifyTime, settings);
    if (!adjustedTime) {
      console.log("[NotificationService] RSV report reminder skipped due to quiet hours");
      return null;
    }
    notifyTime = adjustedTime;

    if (notifyTime <= now) {
      return null;
    }

    // Build notification content
    const scheduleTypeDisplay = getScheduleTypeDisplayLabel(data.scheduleType);
    const leadHours = Math.floor(data.reportForDutyMinutes / 60);
    const leadMins = data.reportForDutyMinutes % 60;
    const leadText = leadMins > 0
      ? `${leadHours}h ${leadMins}m`
      : `${leadHours} hour${leadHours > 1 ? 's' : ''}`;

    // Format window start time HH:MM
    const timeStr = windowStart.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${scheduleTypeDisplay} Report Reminder`,
        body: `Report for ${data.scheduleType} at ${data.domicile} in ${leadText} — Window opens ${timeStr}`,
        data: {
          type: "rsv_report_time" as NotificationType,
          reserveScheduleEventId: data.reserveScheduleEventId,
          scheduleType: data.scheduleType,
          domicile: data.domicile,
          reportForDutyMinutes: data.reportForDutyMinutes,
          isInternational: data.isInternational,
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifyTime,
      },
    });

    console.log(
      `[NotificationService] Scheduled RSV report reminder for ${data.scheduleType} at ${notifyTime.toISOString()}`
    );
    return notificationId;
  } catch (error) {
    console.error("[NotificationService] Failed to schedule RSV report reminder:", error);
    return null;
  }
}

/**
 * Get user-friendly display label for schedule type
 */
function getScheduleTypeDisplayLabel(scheduleType: string): string {
  const labels: Record<string, string> = {
    RSVA: "Reserve A",
    RSVB: "Reserve B",
    RSVC: "Reserve C",
    RSVD: "Reserve D",
    HOT: "Airport Standby",
    LCO: "Long Call Out",
    RCID: "RCID",
    TRNG: "Training",
  };
  return labels[scheduleType] ?? scheduleType;
}

/**
 * Cancel all RSV notifications for a specific reserve schedule event
 */
export async function cancelRSVNotifications(reserveScheduleEventId: string): Promise<void> {
  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduledNotifications) {
      const data = notification.content.data as { reserveScheduleEventId?: string } | null;
      if (data?.reserveScheduleEventId === reserveScheduleEventId) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    console.log(`[NotificationService] Cancelled RSV notifications for ${reserveScheduleEventId}`);
  } catch (error) {
    console.error("[NotificationService] Failed to cancel RSV notifications:", error);
  }
}

// ============================================
// PAY PERIOD ENDING REMINDERS (Phase 3)
// ============================================

export async function schedulePayPeriodEndingReminders(
  data: PayPeriodData
): Promise<string[]> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.payPeriodEndingEnabled) {
    return [];
  }

  const notificationIds: string[] = [];
  const endDate = new Date(data.endDate + "T23:59:59");
  const now = new Date();

  try {
    // 48 hours before
    if (settings.payPeriodEndingHours48) {
      let notifyTime = new Date(endDate.getTime() - 48 * 60 * 60 * 1000);
      notifyTime.setHours(9, 0, 0, 0); // 9 AM

      const adjustedTime = adjustForQuietHours(notifyTime, settings);
      if (adjustedTime && adjustedTime > now) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: "Pay Period Closing",
            body: "Pay period ends in 48 hours — review premium events and missing flight proof.",
            data: {
              type: "pay_period_ending" as NotificationType,
              periodNumber: data.periodNumber,
              year: data.year,
              hoursRemaining: 48,
            },
            sound: true,
            priority: Notifications.AndroidNotificationPriority.DEFAULT,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: adjustedTime,
          },
        });
        notificationIds.push(id);
      }
    }

    // 24 hours before
    if (settings.payPeriodEndingHours24) {
      let notifyTime = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      notifyTime.setHours(9, 0, 0, 0); // 9 AM

      const adjustedTime = adjustForQuietHours(notifyTime, settings);
      if (adjustedTime && adjustedTime > now) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: "Pay Period Closing Soon",
            body: "Pay period ends in 24 hours — final chance to review premiums.",
            data: {
              type: "pay_period_ending" as NotificationType,
              periodNumber: data.periodNumber,
              year: data.year,
              hoursRemaining: 24,
            },
            sound: true,
            priority: Notifications.AndroidNotificationPriority.HIGH,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: adjustedTime,
          },
        });
        notificationIds.push(id);
      }
    }

    console.log(
      `[NotificationService] Scheduled ${notificationIds.length} pay period reminders`
    );
    return notificationIds;
  } catch (error) {
    console.error("[NotificationService] Failed to schedule pay period reminders:", error);
    return [];
  }
}

// ============================================
// PAYDAY REMINDERS (Phase 4)
// ============================================

/**
 * Format cents to dollar string (e.g., 123456 -> "$1,234.56")
 */
function formatCentsToDollars(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(dollars);
}

export async function schedulePaydayReminders(data: PaydayData): Promise<string[]> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.paydayReminderEnabled) {
    return [];
  }

  const notificationIds: string[] = [];
  const payDate = new Date(data.payDate + "T00:00:00");
  const now = new Date();

  // Determine check type
  // standard = 1st of month = Small Check (Advance)
  // remainder = 15th of month = Big Check (Settlement)
  const isBigCheck = data.payType === "remainder";
  const checkLabel = isBigCheck ? "Big Check" : "Small Check";
  const checkDescription = isBigCheck
    ? "Settlement pay posts"
    : "Advance pay posts";
  const reviewText = isBigCheck
    ? "Review Pay Summary for codes & premiums."
    : "Verify hours and per diem.";

  // Add estimate info if available
  const estimateText = data.estimatedPayCents
    ? ` Est: ${formatCentsToDollars(data.estimatedPayCents)}.`
    : "";

  try {
    // 2 days before
    if (settings.paydayReminder2DaysBefore) {
      let notifyTime = new Date(payDate.getTime() - 2 * 24 * 60 * 60 * 1000);
      notifyTime.setHours(9, 0, 0, 0);

      const adjustedTime = adjustForQuietHours(notifyTime, settings);
      if (adjustedTime && adjustedTime > now) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Payday in 2 Days — ${checkLabel}`,
            body: `${checkDescription} in 2 days.${estimateText} ${reviewText}`,
            data: {
              type: "payday" as NotificationType,
              payDate: data.payDate,
              payType: data.payType,
              isBigCheck,
              daysUntil: 2,
              estimatedPayCents: data.estimatedPayCents,
            },
            sound: true,
            priority: Notifications.AndroidNotificationPriority.DEFAULT,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: adjustedTime,
          },
        });
        notificationIds.push(id);
      }
    }

    // 1 day before
    if (settings.paydayReminder1DayBefore) {
      let notifyTime = new Date(payDate.getTime() - 1 * 24 * 60 * 60 * 1000);
      notifyTime.setHours(9, 0, 0, 0);

      const adjustedTime = adjustForQuietHours(notifyTime, settings);
      if (adjustedTime && adjustedTime > now) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Payday Tomorrow — ${checkLabel}`,
            body: `${checkDescription} tomorrow.${estimateText} ${reviewText}`,
            data: {
              type: "payday" as NotificationType,
              payDate: data.payDate,
              payType: data.payType,
              isBigCheck,
              daysUntil: 1,
              estimatedPayCents: data.estimatedPayCents,
            },
            sound: true,
            priority: Notifications.AndroidNotificationPriority.HIGH,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: adjustedTime,
          },
        });
        notificationIds.push(id);
      }
    }

    // Morning of payday
    if (settings.paydayReminderMorningOf) {
      let notifyTime = new Date(payDate);
      notifyTime.setHours(7, 0, 0, 0);

      const adjustedTime = adjustForQuietHours(notifyTime, settings);
      if (adjustedTime && adjustedTime > now) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Payday — ${checkLabel}`,
            body: `${checkDescription} today!${estimateText} Check your bank account.`,
            data: {
              type: "payday" as NotificationType,
              payDate: data.payDate,
              payType: data.payType,
              isBigCheck,
              daysUntil: 0,
              estimatedPayCents: data.estimatedPayCents,
            },
            sound: true,
            priority: Notifications.AndroidNotificationPriority.HIGH,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: adjustedTime,
          },
        });
        notificationIds.push(id);
      }
    }

    console.log(
      `[NotificationService] Scheduled ${notificationIds.length} payday reminders for ${data.payDate}`
    );
    return notificationIds;
  } catch (error) {
    console.error("[NotificationService] Failed to schedule payday reminders:", error);
    return [];
  }
}

// ============================================
// ARRIVAL WELCOME (Phase 5)
// ============================================

export async function triggerArrivalWelcome(data: ArrivalData): Promise<string | null> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.arrivalWelcomeEnabled) {
    return null;
  }

  // Check confidence requirement - ALWAYS HIGH for arrivals
  if (settings.arrivalHighConfidenceOnly && data.confidence !== "high") {
    console.log("[NotificationService] Arrival skipped - confidence not high");
    return null;
  }

  try {
    // Check if we already sent this notification (idempotency)
    const sentKey = `arrival_sent_${data.legId}`;
    const alreadySent = await AsyncStorage.getItem(sentKey);
    if (alreadySent) {
      console.log("[NotificationService] Arrival already sent for leg", data.legId);
      return null;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Arrived — Welcome to ${data.destination}`,
        body: `Welcome to ${data.destination}. Tap to log premiums or add notes.`,
        data: {
          type: "arrival_welcome" as NotificationType,
          tripId: data.tripId,
          legId: data.legId,
          destination: data.destination,
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
      },
      trigger: null, // Immediate
    });

    // Mark as sent
    await AsyncStorage.setItem(sentKey, new Date().toISOString());

    console.log(`[NotificationService] Sent arrival welcome for ${data.destination}`);
    return notificationId;
  } catch (error) {
    console.error("[NotificationService] Failed to send arrival welcome:", error);
    return null;
  }
}

// ============================================
// PAY STATEMENT READY (Phase 6)
// ============================================

export async function triggerPayStatementReady(periodNumber: number, year: number): Promise<string | null> {
  const settings = await getNotificationSettings();

  if (!settings.pushPermissionGranted || !settings.payStatementReadyEnabled) {
    return null;
  }

  try {
    // Check idempotency
    const sentKey = `pay_statement_${year}_${periodNumber}`;
    const alreadySent = await AsyncStorage.getItem(sentKey);
    if (alreadySent) {
      return null;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Pay Summary Ready",
        body: "Your Pay Summary is ready — see what's coming and why.",
        data: {
          type: "pay_statement_ready" as NotificationType,
          periodNumber,
          year,
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Immediate
    });

    await AsyncStorage.setItem(sentKey, new Date().toISOString());

    console.log(`[NotificationService] Sent pay statement ready for period ${periodNumber}`);
    return notificationId;
  } catch (error) {
    console.error("[NotificationService] Failed to send pay statement ready:", error);
    return null;
  }
}

// ============================================
// CANCELLATION UTILITIES
// ============================================

export async function cancelNotificationsByType(type: NotificationType): Promise<void> {
  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduledNotifications) {
      const data = notification.content.data as { type?: string } | null;
      if (data?.type === type) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    console.log(`[NotificationService] Cancelled all ${type} notifications`);
  } catch (error) {
    console.error("[NotificationService] Failed to cancel notifications:", error);
  }
}

export async function cancelTripNotifications(tripId: string): Promise<void> {
  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduledNotifications) {
      const data = notification.content.data as { tripId?: string } | null;
      if (data?.tripId === tripId) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    console.log(`[NotificationService] Cancelled notifications for trip ${tripId}`);
  } catch (error) {
    console.error("[NotificationService] Failed to cancel trip notifications:", error);
  }
}

export async function cancelAllScheduledNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log("[NotificationService] Cancelled all scheduled notifications");
  } catch (error) {
    console.error("[NotificationService] Failed to cancel all notifications:", error);
  }
}

// ============================================
// STATISTICS
// ============================================

export async function getScheduledNotificationStats(): Promise<{
  total: number;
  byType: Record<string, number>;
}> {
  try {
    const notifications = await Notifications.getAllScheduledNotificationsAsync();

    const byType: Record<string, number> = {};
    for (const n of notifications) {
      const type = (n.content.data as { type?: string } | null)?.type ?? "unknown";
      byType[type] = (byType[type] ?? 0) + 1;
    }

    return { total: notifications.length, byType };
  } catch {
    return { total: 0, byType: {} };
  }
}

// ============================================
// BATCH SCHEDULING FOR TRIPS
// ============================================

export interface TripDutyDayForNotification {
  id: string;
  dutyDate: string;
  reportTimeISO: string | null;
  legs: Array<{
    origin: string | null;
    destination: string | null;
    flightNumber: string | null;
    scheduledOutISO: string | null;
  }>;
}

/**
 * Determine if a trip is international based on destinations
 */
function isInternationalTrip(
  dutyDays: TripDutyDayForNotification[]
): boolean {
  // List of common US airport codes
  const usAirports = new Set([
    "ANC", "ONT", "SDF", "MIA", "LAX", "JFK", "ORD", "DFW", "ATL", "SEA",
    "PHX", "DEN", "SFO", "LAS", "MCO", "EWR", "BOS", "IAH", "MSP", "DTW",
    "PHL", "CLT", "FLL", "BWI", "SLC", "DCA", "IAD", "SAN", "TPA", "PDX",
    "STL", "HNL", "BNA", "AUS", "RDU", "MCI", "SMF", "SJC", "OAK", "CLE",
    "IND", "CVG", "PIT", "CMH", "MKE", "SAT", "RSW", "BDL", "JAX", "OKC",
    "MEM", "RIC", "ABQ", "TUL", "OMA", "BUF", "PBI", "BOI", "ELP", "TUS",
    "SNA", "ONT", "BUR", "SDF", "CVG", "DAY", "LUK", "RFD", "ROC",
  ]);

  for (const day of dutyDays) {
    for (const leg of day.legs) {
      const origin = leg.origin?.toUpperCase();
      const dest = leg.destination?.toUpperCase();

      if (origin && !usAirports.has(origin)) return true;
      if (dest && !usAirports.has(dest)) return true;
    }
  }

  return false;
}

export async function scheduleNotificationsForTrip(
  tripId: string,
  tripNumber: string | null,
  dutyDays: TripDutyDayForNotification[]
): Promise<string[]> {
  // First cancel any existing notifications for this trip
  await cancelTripNotifications(tripId);

  const allNotificationIds: string[] = [];
  const isIntl = isInternationalTrip(dutyDays);

  for (const dutyDay of dutyDays) {
    const firstLeg = dutyDay.legs[0];
    const reportTimeISO = dutyDay.reportTimeISO ?? firstLeg?.scheduledOutISO;

    if (!reportTimeISO) continue;

    const id = await scheduleReportTimeReminder({
      tripId,
      tripNumber,
      dutyDayId: dutyDay.id,
      reportTimeISO,
      station: firstLeg?.origin ?? null,
      flightNumber: firstLeg?.flightNumber,
      destination: firstLeg?.destination,
      isInternational: isIntl,
    });

    if (id) {
      allNotificationIds.push(id);
    }
  }

  return allNotificationIds;
}
