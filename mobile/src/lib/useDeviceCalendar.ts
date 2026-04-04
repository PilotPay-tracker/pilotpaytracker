/**
 * Device Calendar Hook
 *
 * Provides access to the device's native calendars using expo-calendar.
 * This connects to Apple Calendar, Google Calendar, Outlook, etc.
 * that are already configured on the user's phone.
 */

import { useState, useCallback, useEffect } from 'react';
import * as Calendar from 'expo-calendar';
import { Platform, Alert, Linking } from 'react-native';
import * as Haptics from 'expo-haptics';

export interface DeviceCalendar {
  id: string;
  title: string;
  source: {
    name: string;
    type: string;
  };
  color: string;
  isPrimary: boolean;
  allowsModifications: boolean;
  accountName?: string;
  ownerAccount?: string;
}

export interface DeviceCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
  allDay: boolean;
}

export interface UseDeviceCalendarResult {
  // Permission state
  hasPermission: boolean;
  permissionStatus: Calendar.PermissionStatus | null;
  isCheckingPermission: boolean;

  // Calendars
  calendars: DeviceCalendar[];
  isLoadingCalendars: boolean;

  // Events
  events: DeviceCalendarEvent[];
  isLoadingEvents: boolean;

  // Actions
  requestPermission: () => Promise<boolean>;
  openSettings: () => void;
  loadCalendars: () => Promise<DeviceCalendar[]>;
  loadEvents: (
    calendarIds: string[],
    startDate: Date,
    endDate: Date
  ) => Promise<DeviceCalendarEvent[]>;
  refreshAll: () => Promise<void>;
}

// Map calendar source types to friendly names
function getProviderFromSource(source: { type: string; name: string }): string {
  const sourceType = source.type?.toLowerCase() || '';
  const sourceName = source.name?.toLowerCase() || '';

  if (
    sourceType.includes('icloud') ||
    sourceName.includes('icloud') ||
    sourceType === 'caldav' && sourceName.includes('apple')
  ) {
    return 'Apple iCloud';
  }

  if (
    sourceType.includes('google') ||
    sourceName.includes('google') ||
    sourceName.includes('gmail')
  ) {
    return 'Google';
  }

  if (
    sourceType.includes('exchange') ||
    sourceType.includes('microsoft') ||
    sourceName.includes('outlook') ||
    sourceName.includes('exchange') ||
    sourceName.includes('office365') ||
    sourceName.includes('microsoft')
  ) {
    return 'Outlook/Exchange';
  }

  if (sourceType === 'local') {
    return 'Local Calendar';
  }

  if (sourceType === 'caldav') {
    return 'CalDAV';
  }

  return source.name || 'Other';
}

// Get color for provider
export function getProviderColor(provider: string): string {
  if (provider.includes('Apple') || provider.includes('iCloud')) {
    return '#000000';
  }
  if (provider.includes('Google') || provider.includes('Gmail')) {
    return '#4285F4';
  }
  if (
    provider.includes('Outlook') ||
    provider.includes('Exchange') ||
    provider.includes('Microsoft')
  ) {
    return '#0078D4';
  }
  return '#6B7280';
}

export function useDeviceCalendar(): UseDeviceCalendarResult {
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<Calendar.PermissionStatus | null>(null);
  const [isCheckingPermission, setIsCheckingPermission] = useState(true);
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);
  const [events, setEvents] = useState<DeviceCalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // Check current permission status
  const checkPermission = useCallback(async () => {
    try {
      setIsCheckingPermission(true);
      const { status } = await Calendar.getCalendarPermissionsAsync();
      setPermissionStatus(status);
      setHasPermission(status === Calendar.PermissionStatus.GRANTED);
      return status === Calendar.PermissionStatus.GRANTED;
    } catch (error) {
      console.error('Error checking calendar permission:', error);
      setHasPermission(false);
      return false;
    } finally {
      setIsCheckingPermission(false);
    }
  }, []);

  // Request permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setPermissionStatus(status);
      const granted = status === Calendar.PermissionStatus.GRANTED;
      setHasPermission(granted);

      if (!granted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          'Calendar Access Required',
          'To sync your schedule, please allow calendar access in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      return granted;
    } catch (error) {
      console.error('Error requesting calendar permission:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
  }, []);

  // Open device settings
  const openSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  // Load all calendars from device
  const loadCalendars = useCallback(async (): Promise<DeviceCalendar[]> => {
    if (!hasPermission) {
      console.log('No calendar permission, cannot load calendars');
      return [];
    }

    try {
      setIsLoadingCalendars(true);
      const rawCalendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT
      );

      const deviceCalendars: DeviceCalendar[] = rawCalendars
        .filter((cal) => cal.allowsModifications !== false) // Filter out read-only system calendars
        .map((cal) => ({
          id: cal.id,
          title: cal.title || 'Untitled Calendar',
          source: {
            name: cal.source?.name || 'Unknown',
            type: cal.source?.type || 'unknown',
          },
          color: cal.color || '#6B7280',
          isPrimary: cal.isPrimary || false,
          allowsModifications: cal.allowsModifications ?? true,
          accountName: cal.source?.name,
          ownerAccount: cal.ownerAccount,
        }));

      // Sort: primary first, then by provider, then alphabetically
      deviceCalendars.sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.title.localeCompare(b.title);
      });

      setCalendars(deviceCalendars);
      console.log(`Loaded ${deviceCalendars.length} calendars from device`);
      return deviceCalendars;
    } catch (error) {
      console.error('Error loading calendars:', error);
      return [];
    } finally {
      setIsLoadingCalendars(false);
    }
  }, [hasPermission]);

  // Load events from specific calendars within date range
  const loadEvents = useCallback(
    async (
      calendarIds: string[],
      startDate: Date,
      endDate: Date
    ): Promise<DeviceCalendarEvent[]> => {
      if (!hasPermission) {
        console.log('No calendar permission, cannot load events');
        return [];
      }

      if (calendarIds.length === 0) {
        console.log('No calendar IDs provided');
        return [];
      }

      try {
        setIsLoadingEvents(true);
        const rawEvents = await Calendar.getEventsAsync(
          calendarIds,
          startDate,
          endDate
        );

        const deviceEvents: DeviceCalendarEvent[] = rawEvents.map((event) => ({
          id: event.id,
          calendarId: event.calendarId,
          title: event.title || 'Untitled Event',
          startDate: new Date(event.startDate),
          endDate: new Date(event.endDate),
          location: event.location || undefined,
          notes: event.notes || undefined,
          allDay: event.allDay || false,
        }));

        // Sort by start date
        deviceEvents.sort(
          (a, b) => a.startDate.getTime() - b.startDate.getTime()
        );

        setEvents(deviceEvents);
        console.log(`Loaded ${deviceEvents.length} events from device calendars`);
        return deviceEvents;
      } catch (error) {
        console.error('Error loading events:', error);
        return [];
      } finally {
        setIsLoadingEvents(false);
      }
    },
    [hasPermission]
  );

  // Refresh all - permissions, calendars
  const refreshAll = useCallback(async () => {
    const granted = await checkPermission();
    if (granted) {
      await loadCalendars();
    }
  }, [checkPermission, loadCalendars]);

  // Check permission on mount
  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Load calendars when permission is granted
  useEffect(() => {
    if (hasPermission && calendars.length === 0) {
      loadCalendars();
    }
  }, [hasPermission, calendars.length, loadCalendars]);

  return {
    hasPermission,
    permissionStatus,
    isCheckingPermission,
    calendars,
    isLoadingCalendars,
    events,
    isLoadingEvents,
    requestPermission,
    openSettings,
    loadCalendars,
    loadEvents,
    refreshAll,
  };
}

// Helper to get provider name from a DeviceCalendar
export function getCalendarProviderName(calendar: DeviceCalendar): string {
  return getProviderFromSource(calendar.source);
}

// Helper to group calendars by provider
export function groupCalendarsByProvider(
  calendars: DeviceCalendar[]
): Map<string, DeviceCalendar[]> {
  const grouped = new Map<string, DeviceCalendar[]>();

  for (const calendar of calendars) {
    const provider = getCalendarProviderName(calendar);
    const existing = grouped.get(provider) || [];
    existing.push(calendar);
    grouped.set(provider, existing);
  }

  return grouped;
}
