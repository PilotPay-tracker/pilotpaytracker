/**
 * Calendar View Component
 * Month calendar showing daily flight breakdown for each trip
 * Shows individual legs for each day instead of trip-spanning blocks
 */

import { View, Text, Pressable, ScrollView } from 'react-native';
import { Plane } from 'lucide-react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import type { BackendTrip, BackendLeg, BackendDutyDay, BackendTripDutyDay, BackendTripDutyLeg } from '@/lib/useTripsData';

interface CalendarViewProps {
  currentMonth: Date;
  trips: BackendTrip[];
  onTripPress: (trip: BackendTrip) => void;
  onDayPress?: (date: Date) => void;
}

type TripStatus = 'scheduled' | 'flown' | 'verified' | 'needs_review' | 'dropped' | 'company_removed';

interface DayFlight {
  tripId: string;
  tripNumber: string | null;
  dutyDayId: string;
  dutyDate: string;
  legs: Array<{
    flightNumber: string | null;
    origin: string | null;
    destination: string | null;
    scheduledOut: string | null;
    isDeadhead: boolean;
  }>;
  creditMinutes: number;
  status: TripStatus;
  trip: BackendTrip;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  flights: DayFlight[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_COLORS: Record<TripStatus, { bg: string; border: string; text: string }> = {
  scheduled: { bg: 'bg-blue-500/20', border: 'border-blue-500/40', text: 'text-blue-400' },
  flown: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400' },
  verified: { bg: 'bg-green-500/20', border: 'border-green-500/40', text: 'text-green-400' },
  needs_review: { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-400' },
  dropped: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400/60' },
  company_removed: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400/60' },
};

/**
 * Format minutes to H:MM display
 */
function formatTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${String(mins).padStart(2, '0')}`;
}

/**
 * Format ISO time to HH:MM
 * Handles both UTC (with Z suffix) and local (without Z suffix) times
 */
function formatTimeFromISO(isoString: string | null): string {
  if (!isoString) return '';
  try {
    // Check if the ISO string ends with Z (UTC) - legacy data
    const isUTC = isoString.endsWith('Z');

    if (isUTC) {
      // Legacy UTC data
      const date = new Date(isoString);
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const mins = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${mins}`;
    } else {
      // New format - times are already LOCAL, just extract HH:MM
      const timePart = isoString.split('T')[1];
      if (timePart) {
        const [hours, mins] = timePart.split(':');
        return `${hours}:${mins}`;
      }
      return '';
    }
  } catch {
    return '';
  }
}

function getTripStatus(trip: BackendTrip): TripStatus {
  if (trip.status === 'dropped') return 'dropped';
  if (trip.status === 'company_removed') return 'company_removed';
  if (trip.needsReview) return 'needs_review';
  if (trip.status === 'completed') {
    const hasProof = trip.dutyDays?.some(dd => dd.proofCount > 0);
    return hasProof ? 'verified' : 'flown';
  }
  return 'scheduled';
}

function getCalendarDays(year: number, month: number): CalendarDay[] {
  const days: CalendarDay[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Days from previous month
  const firstDayOfWeek = firstDay.getDay();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    days.push({
      date,
      isCurrentMonth: false,
      isToday: date.getTime() === today.getTime(),
      flights: [],
    });
  }

  // Days of current month
  for (let i = 1; i <= lastDay.getDate(); i++) {
    const date = new Date(year, month, i);
    days.push({
      date,
      isCurrentMonth: true,
      isToday: date.getTime() === today.getTime(),
      flights: [],
    });
  }

  // Fill remaining days from next month
  const remainingDays = 42 - days.length; // 6 weeks
  for (let i = 1; i <= remainingDays; i++) {
    const date = new Date(year, month + 1, i);
    days.push({
      date,
      isCurrentMonth: false,
      isToday: date.getTime() === today.getTime(),
      flights: [],
    });
  }

  return days;
}

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extract daily flights from trips
 * Creates a DayFlight for each duty day showing all legs for that specific day
 */
function extractDailyFlights(trips: BackendTrip[]): Map<string, DayFlight[]> {
  const dailyFlights = new Map<string, DayFlight[]>();

  trips.forEach(trip => {
    const status = getTripStatus(trip);

    // Use tripDutyDays (canonical) if available, fallback to dutyDays
    const dutyDays = trip.tripDutyDays ?? trip.dutyDays ?? [];

    dutyDays.forEach((dd: BackendTripDutyDay | BackendDutyDay) => {
      const dutyDate = dd.dutyDate?.split('T')[0] ?? '';
      if (!dutyDate) return;

      // Get legs from the duty day
      const legs = dd.legs?.map((leg: BackendTripDutyLeg | BackendLeg) => ({
        flightNumber: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        scheduledOut: leg.scheduledOutISO,
        isDeadhead: leg.isDeadhead,
      })) ?? [];

      // Calculate credit for this duty day
      let creditMinutes = 0;
      if ('creditMinutes' in dd) {
        creditMinutes = dd.creditMinutes ?? 0;
      } else if ('finalCreditMinutes' in dd) {
        creditMinutes = dd.finalCreditMinutes ?? dd.actualCreditMinutes ?? dd.plannedCreditMinutes ?? 0;
      }

      const dayFlight: DayFlight = {
        tripId: trip.id,
        tripNumber: trip.tripNumber,
        dutyDayId: dd.id,
        dutyDate,
        legs,
        creditMinutes,
        status,
        trip,
      };

      const existing = dailyFlights.get(dutyDate) ?? [];
      existing.push(dayFlight);
      dailyFlights.set(dutyDate, existing);
    });
  });

  return dailyFlights;
}

export function CalendarView({
  currentMonth,
  trips,
  onTripPress,
  onDayPress,
}: CalendarViewProps) {
  // Extract all daily flights from trips
  const dailyFlightsMap = useMemo(() => extractDailyFlights(trips), [trips]);

  const calendarDays = useMemo(() => {
    const days = getCalendarDays(currentMonth.getFullYear(), currentMonth.getMonth());

    // Assign flights to calendar days
    days.forEach(day => {
      const dateStr = formatDateToYYYYMMDD(day.date);
      const flights = dailyFlightsMap.get(dateStr) ?? [];
      day.flights = flights;
    });

    return days;
  }, [currentMonth, dailyFlightsMap]);

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <Animated.View entering={FadeIn.duration(300)} className="p-3">
        {/* Weekday Headers */}
        <View className="flex-row mb-2">
          {WEEKDAYS.map((day) => (
            <View key={day} className="flex-1 items-center py-2">
              <Text className="text-slate-500 text-xs font-semibold">{day}</Text>
            </View>
          ))}
        </View>

        {/* Calendar Grid */}
        {weeks.map((week, weekIndex) => (
          <View key={weekIndex} className="mb-1">
            {/* Day Numbers Row */}
            <View className="flex-row">
              {week.map((day, dayIndex) => (
                <Pressable
                  key={dayIndex}
                  onPress={() => {
                    if (onDayPress) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onDayPress(day.date);
                    }
                  }}
                  className={cn(
                    'flex-1 items-center py-1.5',
                    !day.isCurrentMonth && 'opacity-40'
                  )}
                >
                  <View
                    className={cn(
                      'w-7 h-7 rounded-full items-center justify-center',
                      day.isToday && 'bg-amber-500'
                    )}
                  >
                    <Text
                      className={cn(
                        'text-sm font-medium',
                        day.isToday ? 'text-slate-900' : 'text-white'
                      )}
                    >
                      {day.date.getDate()}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>

            {/* Daily Flights Row - Each day shows its flights vertically */}
            <View className="flex-row min-h-[70px]">
              {week.map((day, dayIndex) => (
                <View
                  key={dayIndex}
                  className={cn(
                    'flex-1 px-0.5',
                    !day.isCurrentMonth && 'opacity-40'
                  )}
                >
                  {day.flights.map((flight, flightIndex) => {
                    const statusColors = STATUS_COLORS[flight.status];

                    // Build route string from legs
                    const routeParts: string[] = [];
                    flight.legs.forEach((leg, legIndex) => {
                      if (legIndex === 0 && leg.origin) {
                        routeParts.push(leg.origin);
                      }
                      if (leg.destination) {
                        routeParts.push(leg.destination);
                      }
                    });
                    const routeStr = routeParts.join('-');

                    // Get first leg departure time
                    const firstLeg = flight.legs[0];
                    const depTime = firstLeg?.scheduledOut ? formatTimeFromISO(firstLeg.scheduledOut) : '';

                    // Get flight numbers (combine all non-deadhead legs)
                    const flightNumbers = flight.legs
                      .filter(l => !l.isDeadhead && l.flightNumber)
                      .map(l => l.flightNumber)
                      .slice(0, 2); // Max 2 flight numbers
                    const flightNumStr = flightNumbers.length > 0
                      ? flightNumbers.join('/')
                      : (flight.legs.some(l => l.isDeadhead) ? 'DH' : '');

                    return (
                      <Animated.View
                        key={`${flight.tripId}-${flight.dutyDayId}`}
                        entering={FadeInUp.duration(200).delay(flightIndex * 30)}
                      >
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            onTripPress(flight.trip);
                          }}
                          className={cn(
                            'mb-1 p-1.5 rounded-md border',
                            statusColors.bg,
                            statusColors.border,
                            'active:opacity-80'
                          )}
                        >
                          {/* Trip Number */}
                          <Text
                            className={cn('text-[9px] font-bold', statusColors.text)}
                            numberOfLines={1}
                          >
                            {flight.tripNumber ?? 'Trip'}
                          </Text>

                          {/* Route */}
                          {routeStr && (
                            <View className="flex-row items-center">
                              <Plane size={8} color="#94a3b8" />
                              <Text className="text-slate-400 text-[8px] ml-0.5" numberOfLines={1}>
                                {routeStr}
                              </Text>
                            </View>
                          )}

                          {/* Flight numbers & time */}
                          <View className="flex-row items-center justify-between mt-0.5">
                            {flightNumStr ? (
                              <Text className="text-slate-500 text-[7px]" numberOfLines={1}>
                                {flightNumStr}
                              </Text>
                            ) : (
                              <View />
                            )}
                            {depTime && (
                              <Text className="text-slate-500 text-[7px]">
                                {depTime}
                              </Text>
                            )}
                          </View>

                          {/* Credit */}
                          <Text className="text-slate-500 text-[7px] mt-0.5">
                            {formatTime(flight.creditMinutes)} cr
                          </Text>
                        </Pressable>
                      </Animated.View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Legend */}
        <View className="flex-row flex-wrap justify-center mt-4 pt-4 border-t border-slate-800/50">
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <View key={status} className="flex-row items-center mr-4 mb-2">
              <View className={cn('w-3 h-3 rounded', colors.bg, 'border', colors.border)} />
              <Text className="text-slate-400 text-xs ml-1.5 capitalize">
                {status.replace('_', ' ')}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </ScrollView>
  );
}
