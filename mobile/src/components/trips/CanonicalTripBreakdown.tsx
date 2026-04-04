/**
 * Canonical Trip Breakdown Component
 *
 * Displays the Trip Information-style breakdown:
 * Trip → Duty Days → Legs → Layovers with hotels
 *
 * Matches Trip Information output exactly when available.
 * Shows correct rest times calculated as: next duty start - prior duty end
 *
 * Now includes Schedule Change and Override indicators:
 * - Amber/orange border + "Changed" tag for schedule changes
 * - Blue/purple border + lock icon for overrides
 * - Premium pay display with additive credit
 */

import { View, Text, Pressable, ScrollView, Linking, Alert } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import {
  Plane,
  Clock,
  MapPin,
  Building2,
  Phone,
  ChevronDown,
  ChevronUp,
  Bed,
  AlertCircle,
  CheckCircle2,
  Edit3,
  Pencil,
  Lock,
  DollarSign,
  Camera,
  Car,
} from 'lucide-react-native';
import Animated, { FadeIn, Layout } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import type { BackendTripDutyDay, BackendTripDutyLeg, BackendTripLayover } from '@/lib/useTripsData';
import { useAirportDb } from '@/lib/useAirportDb';
import { safeZuluToLocal } from '@/utils/time';
import type { AirportDb } from '@/utils/airportDb';
import { DaySikBadge, LegSikTag } from './SikBadge';

// ============================================
// Types
// ============================================

export interface LegOOOIContext {
  legId: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  dutyDayIndex: number;
  scheduledOutISO: string | null;
  scheduledInISO: string | null;
}

// Phase 4: Leg premium context for premium logging
export interface LegPremiumContext {
  legId: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  premiumCode: string | null;
  scheduledOutISO: string | null;
  scheduledInISO: string | null;
  actualOutISO: string | null;
  actualInISO: string | null;
  creditMinutes: number;
}

interface CanonicalTripBreakdownProps {
  tripNumber?: string | null;
  baseFleet?: string | null;
  tripDutyDays: BackendTripDutyDay[];
  onLayoverHotelAction?: (layoverId: string, action: 'confirm' | 'edit' | 'reject') => void;
  onScheduleChange?: (dutyDay: BackendTripDutyDay) => void;
  onCaptureOOOI?: (legContext: LegOOOIContext) => void;
  onLogLegPremium?: (legContext: LegPremiumContext) => void; // Phase 4
  /** Initial duty day index to expand and scroll to (1-indexed) */
  initialDutyDayIndex?: number;
}

// ============================================
// Helpers
// ============================================

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Format time in LOCAL timezone based on airport code
 * Times are now stored as LOCAL times (without Z suffix), so we just extract them directly
 * Returns time as HH:MM in local time of the specified airport
 */
function formatTimeLocal(
  isoString: string | null | undefined,
  airportCode: string | null | undefined,
  airportDb: AirportDb
): string {
  if (!isoString) return '--:--';

  try {
    // Check if the ISO string ends with Z (UTC) - legacy data
    const isUTC = isoString.endsWith('Z');

    if (isUTC && airportCode) {
      // Legacy UTC data - convert from Zulu to local
      const date = new Date(isoString);
      const dateISO = isoString.split('T')[0] || '';
      const zuluHHMM = `${date.getUTCHours().toString().padStart(2, '0')}${date.getUTCMinutes().toString().padStart(2, '0')}`;

      const localTime = safeZuluToLocal({
        airportDb,
        dateISO,
        zuluHHMM,
        stationCode: airportCode,
      });

      return localTime;
    } else {
      // New format - times are already LOCAL, just extract HH:MM
      // ISO string format: "2026-01-31T06:30:00" (no Z = local time)
      const timePart = isoString.split('T')[1];
      if (timePart) {
        const [hours, mins] = timePart.split(':');
        return `${hours}:${mins}`;
      }
      return '--:--';
    }
  } catch {
    return '--:--';
  }
}

function formatTimeZulu(isoString: string | null | undefined): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    const hh = date.getUTCHours().toString().padStart(2, '0');
    const mm = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '--:--';
  }
}

function formatDateFromISO(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

function getDayCode(date: string): string {
  const d = new Date(date);
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const day = d.getDate().toString().padStart(2, '0');
  return `${days[d.getDay()]}${day}`;
}

/**
 * Compute the sick status for a duty day based on its legs
 */
function getDaySickStatus(legs: BackendTripDutyLeg[]): 'FLY' | 'SIK' | 'PARTIAL' {
  if (!legs || legs.length === 0) return 'FLY';
  const sickLegs = legs.filter(l => l.legStatus === 'SIK').length;
  if (sickLegs === 0) return 'FLY';
  if (sickLegs === legs.length) return 'SIK';
  return 'PARTIAL';
}

// ============================================
// Leg Row Component
// ============================================

function LegRow({
  leg,
  isFirst,
  dutyDayIndex,
  airportDb,
  onCaptureOOOI,
  onLogLegPremium,
}: {
  leg: BackendTripDutyLeg;
  isFirst: boolean;
  dutyDayIndex: number;
  airportDb: AirportDb;
  onCaptureOOOI?: (legContext: LegOOOIContext) => void;
  onLogLegPremium?: (legContext: LegPremiumContext) => void;
}) {
  const depTime = formatTimeLocal(leg.scheduledOutISO, leg.origin, airportDb);
  const arrTime = formatTimeLocal(leg.scheduledInISO, leg.destination, airportDb);

  // Check if leg has OOOI data captured
  const hasOOOI = !!(leg.actualOutISO && leg.actualOffISO && leg.actualOnISO && leg.actualInISO);
  const hasPartialOOOI = !!(leg.actualOutISO || leg.actualOffISO || leg.actualOnISO || leg.actualInISO);

  // Phase 4: Check if leg has premium code attached
  const hasPremium = !!leg.premiumCode;

  return (
    <Pressable
      onLongPress={() => {
        if (onLogLegPremium) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onLogLegPremium({
            legId: leg.id,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            premiumCode: leg.premiumCode,
            scheduledOutISO: leg.scheduledOutISO,
            scheduledInISO: leg.scheduledInISO,
            actualOutISO: leg.actualOutISO,
            actualInISO: leg.actualInISO,
            creditMinutes: (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : leg.plannedCreditMinutes,
          });
        }
      }}
      delayLongPress={400}
      className="flex-row items-center py-2 px-3 bg-zinc-900/30 rounded-lg mb-1"
    >
      {/* Flight Number + Premium Badge */}
      <View className="w-14">
        <Text className="text-white font-medium text-sm">
          {leg.flightNumber || '-'}
        </Text>
        {leg.isDeadhead ? (
          <Text className="text-amber-400 text-xs">DH</Text>
        ) : hasPremium ? (
          <View className="bg-emerald-500/30 rounded px-1">
            <Text className="text-emerald-400 text-xs font-bold">{leg.premiumCode}</Text>
          </View>
        ) : null}
      </View>

      {/* Route */}
      <View className="flex-1 flex-row items-center gap-1 flex-wrap">
        <Text className="text-white text-sm font-medium">
          {leg.origin || '???'}
        </Text>
        <Plane size={12} color="#71717a" />
        <Text className="text-white text-sm font-medium">
          {leg.destination || '???'}
        </Text>
        {leg.equipment && (
          <View className="bg-zinc-700/60 rounded px-1 py-0.5">
            <Text className="text-zinc-400 text-[10px] font-bold">{leg.equipment}</Text>
          </View>
        )}
        {/* SIK indicator */}
        <LegSikTag isSick={leg.legStatus === 'SIK'} />
      </View>

      {/* Times */}
      <View className="flex-row items-center gap-2">
        <Text className="text-zinc-400 text-xs">
          {depTime || '--:--'}
        </Text>
        <Text className="text-zinc-500">→</Text>
        <Text className="text-zinc-400 text-xs">
          {arrTime || '--:--'}
        </Text>
      </View>

      {/* Block/Credit */}
      <View className="w-12 items-end">
        <Text className="text-emerald-400 text-xs font-medium">
          {formatMinutes((leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : leg.plannedCreditMinutes)}
        </Text>
        {leg.plannedBlockMinutes > 0 && leg.plannedBlockMinutes !== (leg.creditMinutes || leg.plannedCreditMinutes) && (
          <Text className="text-zinc-500 text-xs">
            {formatMinutes(leg.plannedBlockMinutes)}
          </Text>
        )}
      </View>

      {/* OOOI Camera Button */}
      {onCaptureOOOI && (
        <Pressable
          onPress={() => {
            console.log('[OOOI Camera] Button pressed for leg:', leg.id, leg.origin, '->', leg.destination);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onCaptureOOOI({
              legId: leg.id,
              flightNumber: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              dutyDayIndex,
              scheduledOutISO: leg.scheduledOutISO,
              scheduledInISO: leg.scheduledInISO,
            });
          }}
          className={cn(
            "ml-2 p-1.5 rounded-lg",
            hasOOOI ? "bg-emerald-500/20" : hasPartialOOOI ? "bg-amber-500/20" : "bg-zinc-700/60"
          )}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {hasOOOI ? (
            <CheckCircle2 size={14} color="#10b981" />
          ) : (
            <Camera size={14} color={hasPartialOOOI ? "#f59e0b" : "#a1a1aa"} />
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

// ============================================
// Layover Card Component - with countdown logic
// ============================================

function LayoverCard({
  layover,
  nextDutyStartISO,
  prevDutyEndISO,
  onAction
}: {
  layover: BackendTripLayover;
  nextDutyStartISO?: string | null;
  prevDutyEndISO?: string | null;
  onAction?: (action: 'confirm' | 'edit' | 'reject') => void;
}) {
  const needsReview = layover.hotelConfidence < 0.7 && layover.hotelName;
  const hasHotel = !!layover.hotelName;

  // Countdown state
  // Complete = rest period has ended (prevDutyEnd + restMinutes in past)
  // Use prevDutyEndISO + restMinutes as authoritative rest-end anchor.
  // Times without Z are stored as local station times; treat them as local.
  // nextDutyStartISO may have incorrect dates from import, so we don't rely on it.
  const getRestEndMs = useCallback((): number | null => {
    if (!prevDutyEndISO) return null;
    // Local ISO string without Z — parse as-is (JS treats no-Z as local on iOS)
    const prevDutyEnd = new Date(prevDutyEndISO).getTime();
    if (isNaN(prevDutyEnd)) return null;
    return prevDutyEnd + layover.restMinutes * 60 * 1000;
  }, [prevDutyEndISO, layover.restMinutes]);

  const calculateRemaining = useCallback((): number => {
    const now = Date.now();
    const restEndMs = getRestEndMs();

    if (restEndMs !== null) {
      if (now >= restEndMs) return 0; // Rest over → Complete
      const remainingMs = restEndMs - now;
      const prevDutyEnd = new Date(prevDutyEndISO!).getTime();
      if (now >= prevDutyEnd) {
        // We're in the active layover window — show live countdown
        return Math.floor(remainingMs / 60000);
      }
      // Still in duty (shouldn't normally happen) — show planned rest
      return layover.restMinutes;
    }

    // No prevDutyEnd — show planned rest as static display
    return layover.restMinutes;
  }, [getRestEndMs, prevDutyEndISO, layover.restMinutes]);

  const [remainingMinutes, setRemainingMinutes] = useState<number>(() => calculateRemaining());

  // Update countdown every minute
  useEffect(() => {
    const updateCountdown = () => {
      setRemainingMinutes(calculateRemaining());
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [calculateRemaining]);

  // Determine status and colors
  const isComplete = remainingMinutes <= 0;
  const isUrgent = remainingMinutes > 0 && remainingMinutes <= 60;
  const isWarning = remainingMinutes > 60 && remainingMinutes <= 120;

  const getTimeColors = () => {
    if (isComplete) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '#10b981' };
    if (isUrgent) return { bg: 'bg-red-500/20', text: 'text-red-400', icon: '#ef4444' };
    if (isWarning) return { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: '#f59e0b' };
    return { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '#3b82f6' };
  };

  const timeColors = getTimeColors();
  const displayTime = isComplete ? 'Complete' : formatMinutes(remainingMinutes);

  const handleCallHotel = useCallback(() => {
    if (layover.hotelPhone) {
      Linking.openURL(`tel:${layover.hotelPhone}`);
    }
  }, [layover.hotelPhone]);

  const handleCallTransport = useCallback(() => {
    if (layover.transportPhone) {
      Linking.openURL(`tel:${layover.transportPhone}`);
    }
  }, [layover.transportPhone]);

  return (
    <View className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-3 my-2">
      {/* Rest Time Header with countdown */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <Bed size={16} color={timeColors.icon} />
          <View>
            <Text className={cn("font-semibold text-sm", timeColors.text)}>
              {isComplete ? 'Layover Complete' : `Rest: ${displayTime}`}
            </Text>
            {!isComplete && (
              <Text className="text-zinc-500 text-[10px]">Time Until Report</Text>
            )}
          </View>
        </View>
        <View className="flex-row items-center gap-1 bg-blue-500/20 px-2 py-0.5 rounded">
          <MapPin size={12} color="#60a5fa" />
          <Text className="text-blue-300 text-xs font-medium">
            {layover.station}
          </Text>
        </View>
      </View>

      {/* Hotel Info */}
      {hasHotel ? (
        <View className="bg-zinc-900/50 rounded-lg p-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1">
              <Building2 size={14} color="#f59e0b" />
              <Text className="text-amber-400 text-sm flex-1 font-medium" numberOfLines={1}>
                {layover.hotelName}
              </Text>
            </View>

            {layover.hotelStatus && (
              <View className={cn(
                "px-2 py-0.5 rounded",
                layover.hotelStatus === 'BOOKED' ? 'bg-emerald-500/20' : 'bg-amber-500/20'
              )}>
                <Text className={cn(
                  "text-xs font-medium",
                  layover.hotelStatus === 'BOOKED' ? 'text-emerald-400' : 'text-amber-400'
                )}>
                  {layover.hotelStatus}
                </Text>
              </View>
            )}
          </View>

          {layover.hotelPhone && (
            <Pressable
              onPress={handleCallHotel}
              className="flex-row items-center justify-between mt-2"
            >
              <View className="flex-row items-center gap-2">
                <Phone size={12} color="#60a5fa" />
                <Text className="text-slate-400 text-xs">
                  {layover.hotelPhone}
                </Text>
              </View>
              <View className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg">
                <Phone size={12} color="#10b981" />
                <Text className="text-emerald-400 text-[10px] font-semibold ml-1">Call</Text>
              </View>
            </Pressable>
          )}

          {/* Confidence Indicator & Actions */}
          {needsReview && onAction && (
            <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-zinc-700">
              <View className="flex-row items-center gap-1">
                <AlertCircle size={12} color="#f59e0b" />
                <Text className="text-amber-400 text-xs">
                  {Math.round(layover.hotelConfidence * 100)}% match
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onAction('confirm');
                  }}
                  className="bg-emerald-500/20 px-2 py-1 rounded"
                >
                  <Text className="text-emerald-400 text-xs">Confirm</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onAction('edit');
                  }}
                  className="bg-blue-500/20 px-2 py-1 rounded"
                >
                  <Text className="text-blue-400 text-xs">Edit</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Hotel Source Badge */}
          {layover.hotelSource && (
            <View className="mt-1">
              <Text className="text-zinc-500 text-xs">
                Source: {layover.hotelSource === 'trip_info' ? 'Trip Info' :
                         layover.hotelSource === 'directory' ? 'Your Directory' :
                         layover.hotelSource === 'shared_directory' ? 'Shared Directory' :
                         'Manual'}
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View className="bg-zinc-900/30 rounded-lg p-2 flex-row items-center justify-between">
          <Text className="text-zinc-500 text-sm">No hotel info</Text>
          {onAction && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onAction('edit');
              }}
              className="flex-row items-center gap-1"
            >
              <Edit3 size={12} color="#3b82f6" />
              <Text className="text-blue-400 text-xs">Add Hotel</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Transport Notes with Call Button */}
      {(layover.transportNotes || layover.transportPhone) && (
        <View className="mt-2 bg-zinc-900/30 rounded-lg p-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2 flex-1">
              <Car size={14} color="#60a5fa" />
              <Text className="text-blue-400 text-xs font-medium flex-1" numberOfLines={1}>
                {layover.transportNotes || 'Transportation'}
              </Text>
            </View>
            {layover.transportPhone && (
              <Pressable
                onPress={handleCallTransport}
                className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg ml-2"
              >
                <Phone size={12} color="#10b981" />
                <Text className="text-emerald-400 text-[10px] font-semibold ml-1">Call</Text>
              </Pressable>
            )}
          </View>
          {layover.transportPhone && (
            <Pressable onPress={handleCallTransport} className="mt-1">
              <Text className="text-slate-500 text-[10px]">{layover.transportPhone}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ============================================
// Duty Day Card Component
// ============================================

function DutyDayCard({
  dutyDay,
  nextDutyDay,
  isExpanded,
  onToggle,
  onLayoverAction,
  onScheduleChange,
  onCaptureOOOI,
  onLogLegPremium,
  airportDb,
}: {
  dutyDay: BackendTripDutyDay;
  nextDutyDay?: BackendTripDutyDay | null;
  isExpanded: boolean;
  onToggle: () => void;
  onLayoverAction?: (layoverId: string, action: 'confirm' | 'edit' | 'reject') => void;
  onScheduleChange?: () => void;
  onCaptureOOOI?: (legContext: LegOOOIContext) => void;
  onLogLegPremium?: (legContext: LegPremiumContext) => void;
  airportDb: AirportDb;
}) {
  const dayCode = getDayCode(dutyDay.dutyDate);
  // Use first leg origin for report time, last leg destination for release time
  const firstLeg = dutyDay.legs[0];
  const lastLeg = dutyDay.legs[dutyDay.legs.length - 1];
  const reportTime = formatTimeLocal(dutyDay.reportTimeISO, firstLeg?.origin, airportDb);
  const releaseTime = formatTimeLocal(dutyDay.releaseTimeISO, lastLeg?.destination, airportDb);
  const dateStr = formatDateFromISO(dutyDay.dutyDate);

  // Get route from first to last leg
  const route = firstLeg && lastLeg
    ? `${firstLeg.origin || '?'} → ${lastLeg.destination || '?'}`
    : 'No legs';

  // Determine card border color based on status
  const hasScheduleChange = dutyDay.hasScheduleChange;
  const hasOverride = dutyDay.hasOverride;
  const hasPremium = !!dutyDay.premiumCode;
  const daySickStatus = getDaySickStatus(dutyDay.legs);

  // Calculate total credit including premium
  // If day-level credit is 0, sum from legs as fallback
  const dayLevelCredit = dutyDay.creditMinutes ?? 0;
  const legsSumCredit = dutyDay.legs.reduce((sum, leg) => {
    const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
    return sum + legCredit;
  }, 0);
  const baseCredit = dayLevelCredit > 0 ? dayLevelCredit : legsSumCredit;
  const premiumCredit = dutyDay.premiumCreditMinutes || 0;
  const totalCredit = baseCredit + premiumCredit;

  // Border colors: Override (violet) > Schedule Change (amber) > Default
  const borderColor = hasOverride
    ? 'border-violet-500/60'
    : hasScheduleChange
    ? 'border-amber-500/60'
    : 'border-transparent';

  const bgColor = hasOverride
    ? 'bg-violet-900/10'
    : hasScheduleChange
    ? 'bg-amber-900/10'
    : 'bg-zinc-800/50';

  return (
    <Animated.View
      entering={FadeIn}
      layout={Layout}
      className={cn("rounded-xl mb-3 overflow-hidden border-2", borderColor, bgColor)}
    >
      {/* Header */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggle();
        }}
        className={cn(
          "flex-row items-center justify-between p-3",
          hasOverride ? "bg-violet-900/20" : hasScheduleChange ? "bg-amber-900/20" : "bg-zinc-800/80"
        )}
      >
        <View className="flex-row items-center gap-3">
          {/* Day Code */}
          <View className={cn(
            "px-2 py-1 rounded",
            hasOverride ? "bg-violet-500/20" : hasScheduleChange ? "bg-amber-500/20" : "bg-emerald-500/20"
          )}>
            <Text className={cn(
              "font-bold text-sm",
              hasOverride ? "text-violet-400" : hasScheduleChange ? "text-amber-400" : "text-emerald-400"
            )}>
              DAY {dutyDay.dutyDayIndex}
            </Text>
          </View>

          {/* Date & Route */}
          <View>
            <View className="flex-row items-center gap-2">
              <Text className="text-white font-medium text-sm">
                {dayCode} - {dateStr}
              </Text>
              {/* Status Tags */}
              {hasOverride && (
                <View className="flex-row items-center bg-violet-500/20 px-1.5 py-0.5 rounded">
                  <Lock size={10} color="#8b5cf6" />
                  <Text className="text-violet-400 text-[10px] font-bold ml-0.5">OVERRIDE</Text>
                </View>
              )}
              {hasScheduleChange && !hasOverride && (
                <View className="flex-row items-center bg-amber-500/20 px-1.5 py-0.5 rounded">
                  <Pencil size={10} color="#f59e0b" />
                  <Text className="text-amber-400 text-[10px] font-bold ml-0.5">CHANGED</Text>
                </View>
              )}
              {hasPremium && (
                <View className="flex-row items-center bg-emerald-500/20 px-1.5 py-0.5 rounded">
                  <DollarSign size={10} color="#10b981" />
                  <Text className="text-emerald-400 text-[10px] font-bold ml-0.5">{dutyDay.premiumCode}</Text>
                </View>
              )}
              {/* SIK Badge */}
              <DaySikBadge status={daySickStatus} />
            </View>
            <Text className="text-zinc-400 text-xs">
              {route}
            </Text>
          </View>
        </View>

        {/* Right side: Schedule Change Icon + Credit + Expand */}
        <View className="flex-row items-center gap-2">
          {/* Schedule Change Edit Icon */}
          {onScheduleChange && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onScheduleChange();
              }}
              className={cn(
                "p-1.5 rounded-lg",
                hasOverride ? "bg-violet-500/20" : hasScheduleChange ? "bg-amber-500/20" : "bg-zinc-700/60"
              )}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {hasOverride ? (
                <Lock size={14} color="#8b5cf6" />
              ) : (
                <Pencil size={14} color={hasScheduleChange ? "#f59e0b" : "#a1a1aa"} />
              )}
            </Pressable>
          )}

          {/* Credit Display */}
          <View className="items-end">
            <View className="flex-row items-center">
              <Text className="text-emerald-400 font-semibold text-sm">
                {formatMinutes(totalCredit)}
              </Text>
              {premiumCredit > 0 && (
                <Text className="text-emerald-400/60 text-xs ml-1">
                  (+{formatMinutes(premiumCredit)})
                </Text>
              )}
            </View>
            <Text className="text-zinc-500 text-xs">
              {dutyDay.legs.length} leg{dutyDay.legs.length !== 1 ? 's' : ''}
            </Text>
          </View>

          {/* Expand/Collapse */}
          {isExpanded ? (
            <ChevronUp size={18} color="#71717a" />
          ) : (
            <ChevronDown size={18} color="#71717a" />
          )}
        </View>
      </Pressable>

      {/* Expanded Content */}
      {isExpanded && (
        <View className="p-3 border-t border-zinc-700/50">
          {/* Report & Release Times */}
          <View className="flex-row justify-between mb-3">
            <View className="flex-row items-center gap-1">
              <Clock size={12} color="#10b981" />
              <Text className="text-zinc-400 text-xs">
                Report: <Text className="text-emerald-400">{reportTime || '--:--'}</Text>
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Clock size={12} color="#ef4444" />
              <Text className="text-zinc-400 text-xs">
                Release: <Text className="text-red-400">{releaseTime || '--:--'}</Text>
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-zinc-400 text-xs">
                Duty: <Text className="text-white">{(dutyDay.dutyMinutes ?? 0) > 0 ? formatMinutes(dutyDay.dutyMinutes) : '--:--'}</Text>
              </Text>
            </View>
          </View>

          {/* Premium Pay Display */}
          {hasPremium && (
            <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 mb-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <DollarSign size={14} color="#10b981" />
                  <Text className="text-emerald-400 font-medium text-sm">
                    Premium Pay ({dutyDay.premiumCode})
                  </Text>
                </View>
                <Text className="text-emerald-400 font-bold">
                  +{formatMinutes(premiumCredit)}
                </Text>
              </View>
              <Text className="text-zinc-500 text-xs mt-1">
                Base: {formatMinutes(baseCredit)} + Premium: {formatMinutes(premiumCredit)} = Total: {formatMinutes(totalCredit)}
              </Text>
            </View>
          )}

          {/* Legs */}
          <View className="mb-2">
            {dutyDay.legs.map((leg, index) => (
              <LegRow
                key={leg.id}
                leg={leg}
                isFirst={index === 0}
                dutyDayIndex={dutyDay.dutyDayIndex}
                airportDb={airportDb}
                onCaptureOOOI={onCaptureOOOI}
                onLogLegPremium={onLogLegPremium}
              />
            ))}
          </View>

          {/* Layover (if exists) */}
          {dutyDay.layover && (
            <LayoverCard
              layover={dutyDay.layover}
              nextDutyStartISO={nextDutyDay?.reportTimeISO ?? nextDutyDay?.legs?.[0]?.scheduledOutISO}
              prevDutyEndISO={dutyDay.releaseTimeISO ?? dutyDay.legs?.[dutyDay.legs.length - 1]?.scheduledInISO}
              onAction={onLayoverAction ? (action) => onLayoverAction(dutyDay.layover!.id, action) : undefined}
            />
          )}

          {/* Rest indicator (if no layover object but has rest time) */}
          {!dutyDay.layover && dutyDay.restAfterMinutes && dutyDay.restAfterMinutes > 0 && (
            <View className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-2 mt-2">
              <View className="flex-row items-center gap-2">
                <Bed size={14} color="#3b82f6" />
                <Text className="text-blue-400 text-sm">
                  Rest: {formatMinutes(dutyDay.restAfterMinutes)}
                </Text>
                {dutyDay.layoverStation && (
                  <View className="flex-row items-center gap-1 ml-auto">
                    <MapPin size={12} color="#60a5fa" />
                    <Text className="text-blue-300 text-xs">{dutyDay.layoverStation}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Schedule Change Notes */}
          {(hasScheduleChange || hasOverride) && dutyDay.scheduleChangeNotes && (
            <View className={cn(
              "rounded-lg p-2 mt-2 border",
              hasOverride ? "bg-violet-900/10 border-violet-500/30" : "bg-amber-900/10 border-amber-500/30"
            )}>
              <Text className={cn(
                "text-xs",
                hasOverride ? "text-violet-400" : "text-amber-400"
              )}>
                {hasOverride ? 'Override' : 'Change'} Note: {dutyDay.scheduleChangeNotes}
              </Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

// ============================================
// Main Component
// ============================================

export function CanonicalTripBreakdown({
  tripNumber,
  baseFleet,
  tripDutyDays,
  onLayoverHotelAction,
  onScheduleChange,
  onCaptureOOOI,
  onLogLegPremium,
  initialDutyDayIndex,
}: CanonicalTripBreakdownProps) {
  // Get airport database for timezone conversions
  const { airportDb } = useAirportDb();

  // If initialDutyDayIndex is provided, start with that day expanded, otherwise day 1
  const [expandedDays, setExpandedDays] = useState<Set<number>>(
    new Set([initialDutyDayIndex ?? 1])
  );

  // Update expanded days when initialDutyDayIndex changes (drawer reopens with new selection)
  useEffect(() => {
    if (initialDutyDayIndex !== undefined) {
      setExpandedDays(new Set([initialDutyDayIndex]));
    }
  }, [initialDutyDayIndex]);

  const toggleDay = useCallback((dayIndex: number) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayIndex)) {
        next.delete(dayIndex);
      } else {
        next.add(dayIndex);
      }
      return next;
    });
  }, []);

  // Sort duty days by index
  const sortedDays = [...tripDutyDays].sort((a, b) => a.dutyDayIndex - b.dutyDayIndex);

  // Calculate totals including premium
  // For credit: use day-level credit if > 0, otherwise sum leg credits
  const totals = sortedDays.reduce((acc, day) => {
    const dayLevelCredit = day.creditMinutes ?? 0;
    const legsSumCredit = day.legs.reduce((sum, leg) => {
      const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
      return sum + legCredit;
    }, 0);
    const effectiveCredit = dayLevelCredit > 0 ? dayLevelCredit : legsSumCredit;

    // For block: use day-level block if > 0, otherwise sum leg blocks
    const dayLevelBlock = day.blockMinutes ?? 0;
    const legsSumBlock = day.legs.reduce((sum, leg) => {
      const legBlock = (leg.actualBlockMinutes ?? 0) > 0 ? leg.actualBlockMinutes : (leg.plannedBlockMinutes ?? 0);
      return sum + legBlock;
    }, 0);
    const effectiveBlock = dayLevelBlock > 0 ? dayLevelBlock : legsSumBlock;

    // For duty: only count positive values
    const effectiveDuty = (day.dutyMinutes ?? 0) > 0 ? day.dutyMinutes : 0;

    return {
      creditMinutes: acc.creditMinutes + effectiveCredit + (day.premiumCreditMinutes || 0),
      blockMinutes: acc.blockMinutes + effectiveBlock,
      dutyMinutes: acc.dutyMinutes + effectiveDuty,
      premiumMinutes: acc.premiumMinutes + (day.premiumCreditMinutes || 0),
      legs: acc.legs + day.legs.length,
      hasChanges: acc.hasChanges || day.hasScheduleChange || day.hasOverride,
      hasPremium: acc.hasPremium || !!day.premiumCode,
    };
  }, { creditMinutes: 0, blockMinutes: 0, dutyMinutes: 0, premiumMinutes: 0, legs: 0, hasChanges: false, hasPremium: false });

  if (sortedDays.length === 0) {
    return (
      <View className="p-4 bg-zinc-800/30 rounded-xl">
        <Text className="text-zinc-500 text-center">
          No canonical breakdown available
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/* Trip Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View>
          <View className="flex-row items-center gap-2">
            <Text className="text-white font-bold text-lg">
              Trip {tripNumber || 'Details'}
            </Text>
            {/* Trip-level status indicators */}
            {totals.hasChanges && (
              <View className="flex-row items-center bg-amber-500/20 px-1.5 py-0.5 rounded">
                <Pencil size={10} color="#f59e0b" />
                <Text className="text-amber-400 text-[10px] font-bold ml-0.5">MODIFIED</Text>
              </View>
            )}
            {totals.hasPremium && (
              <View className="flex-row items-center bg-emerald-500/20 px-1.5 py-0.5 rounded">
                <DollarSign size={10} color="#10b981" />
                <Text className="text-emerald-400 text-[10px] font-bold ml-0.5">PREMIUM</Text>
              </View>
            )}
          </View>
          {baseFleet && (
            <Text className="text-zinc-400 text-xs">{baseFleet}</Text>
          )}
        </View>
        <View className="items-end">
          <View className="flex-row items-center">
            <Text className="text-emerald-400 font-semibold">
              {formatMinutes(totals.creditMinutes)} Credit
            </Text>
            {totals.premiumMinutes > 0 && (
              <Text className="text-emerald-400/60 text-xs ml-1">
                (+{formatMinutes(totals.premiumMinutes)})
              </Text>
            )}
          </View>
          <Text className="text-zinc-500 text-xs">
            {sortedDays.length} day{sortedDays.length !== 1 ? 's' : ''} · {totals.legs} leg{totals.legs !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Duty Days */}
      {sortedDays.map((dutyDay, index) => (
        <DutyDayCard
          key={dutyDay.id}
          dutyDay={dutyDay}
          nextDutyDay={sortedDays[index + 1] ?? null}
          isExpanded={expandedDays.has(dutyDay.dutyDayIndex)}
          onToggle={() => toggleDay(dutyDay.dutyDayIndex)}
          onLayoverAction={onLayoverHotelAction}
          onScheduleChange={onScheduleChange ? () => onScheduleChange(dutyDay) : undefined}
          onCaptureOOOI={onCaptureOOOI}
          onLogLegPremium={onLogLegPremium}
          airportDb={airportDb}
        />
      ))}

      {/* Totals Footer */}
      <View className="bg-zinc-900/50 rounded-xl p-3 mt-2">
        <View className="flex-row justify-between">
          <View>
            <Text className="text-zinc-500 text-xs">Total Credit</Text>
            <View className="flex-row items-center">
              <Text className="text-emerald-400 font-bold text-lg">
                {formatMinutes(totals.creditMinutes)}
              </Text>
              {totals.premiumMinutes > 0 && (
                <Text className="text-emerald-400/60 text-sm ml-1">
                  (incl. +{formatMinutes(totals.premiumMinutes)} premium)
                </Text>
              )}
            </View>
          </View>
          <View className="items-center">
            <Text className="text-zinc-500 text-xs">Block</Text>
            <Text className="text-white font-medium">
              {formatMinutes(totals.blockMinutes)}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-zinc-500 text-xs">Duty</Text>
            <Text className="text-white font-medium">
              {formatMinutes(totals.dutyMinutes)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
