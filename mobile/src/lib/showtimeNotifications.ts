/**
 * Showtime Notifications
 *
 * Schedules push notifications for:
 * 1. SHOWTIME ALERT: 10 minutes before report time
 * 2. FINAL WARNING: 60 minutes before report time
 *
 * Uses LOCAL time of report station.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

export interface ShowtimeNotificationData {
  tripId: string;
  tripNumber: string | null;
  dutyDayId: string;
  reportTimeISO: string;
  station: string | null;
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === 'granted') {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule showtime notifications for a trip
 *
 * @param data - Notification data including report time
 * @returns Array of scheduled notification IDs
 */
export async function scheduleShowtimeNotifications(
  data: ShowtimeNotificationData
): Promise<string[]> {
  const notificationIds: string[] = [];

  try {
    const reportTime = new Date(data.reportTimeISO);
    const now = new Date();

    // Don't schedule if report time is in the past
    if (reportTime <= now) {
      return [];
    }

    const tripLabel = data.tripNumber ? `Trip ${data.tripNumber}` : 'Your trip';
    const stationLabel = data.station ? ` at ${data.station}` : '';

    // 1. SHOWTIME ALERT - 10 minutes before report
    const showtimeTime = new Date(reportTime.getTime() - 10 * 60 * 1000);
    if (showtimeTime > now) {
      const showtimeId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Showtime',
          body: `Report in 10 minutes${stationLabel}`,
          data: {
            type: 'showtime',
            tripId: data.tripId,
            dutyDayId: data.dutyDayId,
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: showtimeTime,
        },
      });
      notificationIds.push(showtimeId);
    }

    // 2. FINAL WARNING - 60 minutes before report
    const warningTime = new Date(reportTime.getTime() - 60 * 60 * 1000);
    if (warningTime > now) {
      const warningId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Report Coming Up',
          body: `1 hour until report${stationLabel}`,
          data: {
            type: 'warning',
            tripId: data.tripId,
            dutyDayId: data.dutyDayId,
          },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.DEFAULT,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: warningTime,
        },
      });
      notificationIds.push(warningId);
    }

    console.log(`[Notifications] Scheduled ${notificationIds.length} notifications for ${tripLabel}`);
    return notificationIds;
  } catch (error) {
    console.error('[Notifications] Failed to schedule notifications:', error);
    return [];
  }
}

/**
 * Cancel all scheduled notifications for a specific trip
 */
export async function cancelTripNotifications(tripId: string): Promise<void> {
  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduledNotifications) {
      const data = notification.content.data as { tripId?: string } | null;
      if (data?.tripId === tripId) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    console.log(`[Notifications] Cancelled notifications for trip ${tripId}`);
  } catch (error) {
    console.error('[Notifications] Failed to cancel notifications:', error);
  }
}

/**
 * Cancel all scheduled showtime notifications
 */
export async function cancelAllShowtimeNotifications(): Promise<void> {
  try {
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const notification of scheduledNotifications) {
      const data = notification.content.data as { type?: string } | null;
      if (data?.type === 'showtime' || data?.type === 'warning') {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }

    console.log('[Notifications] Cancelled all showtime notifications');
  } catch (error) {
    console.error('[Notifications] Failed to cancel all notifications:', error);
  }
}

/**
 * Schedule notifications for all upcoming duty days in a trip
 */
export async function scheduleNotificationsForTrip(
  tripId: string,
  tripNumber: string | null,
  dutyDays: Array<{
    id: string;
    dutyDate: string;
    dutyStartISO: string | null;
    legs: Array<{
      origin: string | null;
      scheduledOutISO: string | null;
    }>;
  }>
): Promise<string[]> {
  // First cancel any existing notifications for this trip
  await cancelTripNotifications(tripId);

  const allNotificationIds: string[] = [];

  for (const dutyDay of dutyDays) {
    // Get report time from first leg's scheduled out time or duty start
    const firstLeg = dutyDay.legs[0];
    const reportTimeISO = firstLeg?.scheduledOutISO ?? dutyDay.dutyStartISO;

    if (!reportTimeISO) continue;

    const station = firstLeg?.origin ?? null;

    const ids = await scheduleShowtimeNotifications({
      tripId,
      tripNumber,
      dutyDayId: dutyDay.id,
      reportTimeISO,
      station,
    });

    allNotificationIds.push(...ids);
  }

  return allNotificationIds;
}

/**
 * Get count of scheduled notifications
 */
export async function getScheduledNotificationCount(): Promise<number> {
  try {
    const notifications = await Notifications.getAllScheduledNotificationsAsync();
    return notifications.filter((n) => {
      const data = n.content.data as { type?: string } | null;
      return data?.type === 'showtime' || data?.type === 'warning';
    }).length;
  } catch {
    return 0;
  }
}
