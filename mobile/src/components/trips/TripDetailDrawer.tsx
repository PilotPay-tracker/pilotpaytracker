/**
 * Trip Detail Drawer Component
 * Full trip details with tabs: Segments, Pay, Events, Proof, Notes
 */

import { View, Text, Pressable, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  X,
  Plane,
  Calendar,
  Trash2,
  Plus,
  Camera,
  DollarSign,
  FileText,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Edit3,
  Image as ImageIcon,
  MessageSquare,
  GripVertical,
  Building2,
  Phone,
  Pencil,
  Heart,
  Zap,
  RefreshCw,
  BarChart2,
  ClipboardList,
  FileCheck,
  AlertTriangle,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Layout,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/cn';
import type { BackendTrip, BackendLeg, BackendDutyDay, BackendTripDutyDay } from '@/lib/useTripsData';
import { formatMinutesToTime, formatCentsToCurrency, useUpdateTrip, useApplyScheduleChange, useUpdateLegPremium, useMarkPickupType } from '@/lib/useTripsData';
import { useLayoverCountdown } from '@/lib/useLayoverCountdown';
import { CanonicalTripBreakdown, type LegOOOIContext, type LegPremiumContext } from './CanonicalTripBreakdown';
import { ScheduleChangeModal, type ScheduleChangeData } from './ScheduleChangeModal';
import { LegPremiumLogger } from './LegPremiumLogger';
import {
  ScheduleChangeLogEventModal,
  type ScheduleChangeContext,
  type SaveLogEventData,
} from './ScheduleChangeLogEventModal';
import { useCreateLogEventFromChange, usePremiumSuggestions, useDeleteLogEvent } from '@/lib/useLogEvents';
import { TripPremiumSummary } from './TripPremiumSummary';
import { LogEventListCard, LogEventsEmptyState, LogEventsSectionHeader } from './LogEventListCard';
import { useLogEvents } from '@/lib/useLogEvents';
import { SegmentEditor, type SegmentEditorContext } from './SegmentEditor';
import { SickMarkingModal } from './SickMarkingModal';
import { useTripSickInfo, useUndoSick, type TripSickInfo } from '@/lib/useSickTracking';
import { TripSikBadge } from './SikBadge';
import { useTripPayBreakdown, useRecalculateTripPay, detectPayTriggers } from '@/lib/useTripPayEngine';

type TabType = 'segments' | 'pay' | 'events' | 'proof' | 'notes';

// Helper to parse HH:MM to minutes
function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  const hours = parseInt(parts[0] || '0', 10);
  const minutes = parseInt(parts[1] || '0', 10);
  return hours * 60 + minutes;
}

// Helper to format minutes to HH:MM
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Calculate report time ISO from departure time minus offset
 * Domestic: 60 min before, International: 90 min before
 */
function calculateReportTimeISO(departureISO: string | null, isInternational = false): string | null {
  if (!departureISO) return null;
  try {
    const departureTime = new Date(departureISO);
    // Report offset: 60 min domestic, 90 min international
    const reportOffsetMinutes = isInternational ? 90 : 60;
    const reportTime = new Date(departureTime.getTime() - reportOffsetMinutes * 60 * 1000);
    return reportTime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Check if a destination is likely international
 */
function isInternationalDestination(origin: string | null, destination: string | null): boolean {
  if (!origin || !destination) return false;
  const intlPrefixes = ['C', 'E', 'L', 'M', 'O', 'P', 'R', 'S', 'U', 'V', 'W', 'Z'];
  const destPrefix = destination.charAt(0).toUpperCase();
  const originPrefix = origin.charAt(0).toUpperCase();
  return intlPrefixes.includes(destPrefix) && !intlPrefixes.includes(originPrefix);
}

/**
 * Determine if a layover should be shown between two duty days
 *
 * A layover should ONLY be shown when:
 * 1. Both duty days exist and have legs (actual flying duty)
 * 2. The previous day ends at a different station than the crew's base
 * 3. The next day starts at the same station where previous day ended (overnight at outstation)
 * 4. It's not the final return to base
 */
function shouldShowLayover(
  prevDay: BackendDutyDay,
  nextDay: BackendDutyDay,
  homeBase: string | null
): boolean {
  // Must have legs on both days
  if (!prevDay.legs?.length || !nextDay.legs?.length) {
    return false;
  }

  // Get where previous day ended (last leg destination)
  const sortedPrevLegs = [...prevDay.legs].sort((a, b) => a.legIndex - b.legIndex);
  const lastLegPrev = sortedPrevLegs[sortedPrevLegs.length - 1];
  const prevDayEndStation = lastLegPrev?.destination;

  // Get where next day starts (first leg origin)
  const sortedNextLegs = [...nextDay.legs].sort((a, b) => a.legIndex - b.legIndex);
  const firstLegNext = sortedNextLegs[0];
  const nextDayStartStation = firstLegNext?.origin;

  // No stations? Can't determine layover
  if (!prevDayEndStation || !nextDayStartStation) {
    return false;
  }

  // Standard layover: overnight rest at outstation between duty days
  return true;
}

/**
 * Get report offset in minutes based on trip type
 * Domestic: 60 minutes
 * International: 90 minutes
 */
function getReportOffsetMinutes(
  prevDayEndStation: string | null,
  nextDayStartStation: string | null
): number {
  const DOMESTIC_OFFSET = 60;
  const INTERNATIONAL_OFFSET = 90;

  if (!prevDayEndStation || !nextDayStartStation) {
    return DOMESTIC_OFFSET;
  }

  // International detection based on airport code patterns
  const intlPrefixes = ['C', 'E', 'L', 'M', 'O', 'P', 'R', 'S', 'U', 'V', 'W', 'Z'];
  const usCommonPrefixes = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'N', 'T', 'Y'];

  const stationPrefix = nextDayStartStation.charAt(0).toUpperCase();

  if (intlPrefixes.includes(stationPrefix) && !usCommonPrefixes.includes(stationPrefix)) {
    return INTERNATIONAL_OFFSET;
  }

  // Known international stations
  const knownInternational = [
    'ANC', 'HNL', 'OGG', 'LIH', 'KOA',
    'CGN', 'SDF747', 'MIA',
    'PEK', 'PVG', 'HKG', 'NRT', 'ICN',
    'FRA', 'LHR', 'CDG', 'AMS',
  ];

  if (knownInternational.includes(nextDayStartStation.toUpperCase())) {
    return INTERNATIONAL_OFFSET;
  }

  return DOMESTIC_OFFSET;
}

/**
 * Calculate rest time (layover) between two duty days
 * Layover = last leg arrival → next report time (NOT cumulative)
 */
function calculateLayoverMinutes(
  prevDay: BackendDutyDay,
  nextDay: BackendDutyDay,
  reportOffsetMinutes: number = 60
): number {
  // Get previous day's duty end time from last leg arrival
  let prevEndTime: Date | null = null;

  if (prevDay.dutyEndISO) {
    prevEndTime = new Date(prevDay.dutyEndISO);
  } else if (prevDay.legs && prevDay.legs.length > 0) {
    const sortedLegs = [...prevDay.legs].sort((a, b) => a.legIndex - b.legIndex);
    const lastLeg = sortedLegs[sortedLegs.length - 1];
    const arrivalISO = lastLeg.actualInISO || lastLeg.scheduledInISO;
    if (arrivalISO) {
      prevEndTime = new Date(arrivalISO);
    }
  }

  // Get next day's REPORT time (departure - offset)
  let nextReportTime: Date | null = null;

  if (nextDay.dutyStartISO) {
    nextReportTime = new Date(nextDay.dutyStartISO);
  } else if (nextDay.legs && nextDay.legs.length > 0) {
    const sortedLegs = [...nextDay.legs].sort((a, b) => a.legIndex - b.legIndex);
    const firstLeg = sortedLegs[0];
    const departureISO = firstLeg.actualOutISO || firstLeg.scheduledOutISO;
    if (departureISO) {
      const departureTime = new Date(departureISO);
      // Report time = departure - offset
      nextReportTime = new Date(departureTime.getTime() - reportOffsetMinutes * 60 * 1000);
    }
  }

  // Calculate the single gap: last leg arrival → next report time
  if (prevEndTime && nextReportTime) {
    const diffMs = nextReportTime.getTime() - prevEndTime.getTime();
    return Math.max(0, Math.round(diffMs / 60000));
  }

  // Fallback: estimate from dates
  const prevDate = new Date(prevDay.dutyDate);
  const nextDate = new Date(nextDay.dutyDate);
  const dayDiff = Math.round((nextDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

  if (dayDiff === 1) {
    return 10 * 60; // 10 hours default overnight rest
  } else if (dayDiff > 1) {
    return (dayDiff - 1) * 24 * 60 + 10 * 60;
  }

  return 0;
}

// ============================================
// Edit Trip Totals Modal
// ============================================
interface EditTripTotalsModalProps {
  visible: boolean;
  onClose: () => void;
  trip: BackendTrip;
  onSave: (data: { totalCreditMinutes?: number; totalBlockMinutes?: number }) => Promise<void>;
  isSaving: boolean;
  hourlyRateCents?: number;
}

function EditTripTotalsModal({
  visible,
  onClose,
  trip,
  onSave,
  isSaving,
  hourlyRateCents = 32500,
}: EditTripTotalsModalProps) {
  const insets = useSafeAreaInsets();
  const [creditHours, setCreditHours] = useState('');
  const [creditMinutes, setCreditMinutes] = useState('');
  const [blockHours, setBlockHours] = useState('');
  const [blockMinutes, setBlockMinutes] = useState('');

  // Initialize from trip values
  useEffect(() => {
    if (visible && trip) {
      const creditMins = trip.totalCreditMinutes || 0;
      const blockMins = trip.totalBlockMinutes || 0;
      setCreditHours(Math.floor(creditMins / 60).toString());
      setCreditMinutes((creditMins % 60).toString().padStart(2, '0'));
      setBlockHours(Math.floor(blockMins / 60).toString());
      setBlockMinutes((blockMins % 60).toString().padStart(2, '0'));
    }
  }, [visible, trip]);

  // Calculate estimated pay based on credit
  const totalCreditMins = parseInt(creditHours || '0') * 60 + parseInt(creditMinutes || '0');
  const estimatedPay = Math.round((totalCreditMins / 60) * hourlyRateCents);

  const handleSave = async () => {
    const totalCredit = parseInt(creditHours || '0') * 60 + parseInt(creditMinutes || '0');
    const totalBlock = parseInt(blockHours || '0') * 60 + parseInt(blockMinutes || '0');

    await onSave({
      totalCreditMinutes: totalCredit,
      totalBlockMinutes: totalBlock,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 bg-black/70 justify-end">
          <Animated.View
            entering={SlideInDown.duration(300)}
            className="bg-slate-900 rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                  <Pencil size={20} color="#f59e0b" />
                </View>
                <Text className="text-white font-bold text-lg ml-3">Edit Trip Totals</Text>
              </View>
              <Pressable
                onPress={onClose}
                className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
              >
                <X size={16} color="#64748b" />
              </Pressable>
            </View>

            <View className="p-4">
              {/* Credit Time Input */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Credit Time</Text>
                <View className="flex-row items-center">
                  <View className="flex-1 bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
                    <TextInput
                      value={creditHours}
                      onChangeText={(t) => setCreditHours(t.replace(/[^0-9]/g, ''))}
                      placeholder="0"
                      placeholderTextColor="#64748b"
                      keyboardType="number-pad"
                      className="text-amber-400 text-2xl font-bold flex-1 text-center"
                      maxLength={3}
                    />
                    <Text className="text-slate-500 text-lg mx-1">h</Text>
                    <Text className="text-slate-600 text-2xl font-bold">:</Text>
                    <TextInput
                      value={creditMinutes}
                      onChangeText={(t) => {
                        const num = t.replace(/[^0-9]/g, '');
                        if (parseInt(num) <= 59 || num === '') {
                          setCreditMinutes(num);
                        }
                      }}
                      placeholder="00"
                      placeholderTextColor="#64748b"
                      keyboardType="number-pad"
                      className="text-amber-400 text-2xl font-bold flex-1 text-center"
                      maxLength={2}
                    />
                    <Text className="text-slate-500 text-lg ml-1">m</Text>
                  </View>
                </View>
              </View>

              {/* Block Time Input */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Block Time</Text>
                <View className="flex-row items-center">
                  <View className="flex-1 bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
                    <TextInput
                      value={blockHours}
                      onChangeText={(t) => setBlockHours(t.replace(/[^0-9]/g, ''))}
                      placeholder="0"
                      placeholderTextColor="#64748b"
                      keyboardType="number-pad"
                      className="text-white text-2xl font-bold flex-1 text-center"
                      maxLength={3}
                    />
                    <Text className="text-slate-500 text-lg mx-1">h</Text>
                    <Text className="text-slate-600 text-2xl font-bold">:</Text>
                    <TextInput
                      value={blockMinutes}
                      onChangeText={(t) => {
                        const num = t.replace(/[^0-9]/g, '');
                        if (parseInt(num) <= 59 || num === '') {
                          setBlockMinutes(num);
                        }
                      }}
                      placeholder="00"
                      placeholderTextColor="#64748b"
                      keyboardType="number-pad"
                      className="text-white text-2xl font-bold flex-1 text-center"
                      maxLength={2}
                    />
                    <Text className="text-slate-500 text-lg ml-1">m</Text>
                  </View>
                </View>
              </View>

              {/* Estimated Pay Preview */}
              <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-6">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <DollarSign size={18} color="#10b981" />
                    <Text className="text-emerald-400 font-medium ml-2">Estimated Pay</Text>
                  </View>
                  <Text className="text-emerald-400 text-2xl font-bold">
                    {formatCentsToCurrency(estimatedPay)}
                  </Text>
                </View>
                <Text className="text-slate-500 text-xs mt-1">
                  Based on {formatCentsToCurrency(hourlyRateCents)}/hr rate
                </Text>
              </View>

              {/* Save Button */}
              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center active:opacity-80"
              >
                {isSaving ? (
                  <Text className="text-slate-900 font-bold text-lg">Saving...</Text>
                ) : (
                  <>
                    <CheckCircle2 size={20} color="#0f172a" />
                    <Text className="text-slate-900 font-bold text-lg ml-2">Save Changes</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface TripDetailDrawerProps {
  trip: BackendTrip | null;
  visible: boolean;
  onClose: () => void;
  onDelete?: () => void;
  onAddDutyDay?: () => void;
  onAddLeg?: (dutyDayId: string) => void;
  onEditLeg?: (leg: BackendLeg) => void;
  onCaptureProof?: (leg: BackendLeg) => void;
  onCaptureOOOI?: (legContext: LegOOOIContext) => void;
  onAddPayEvent?: () => void;
  onMarkFlown?: () => void;
  onVerifyPay?: () => void;
  isDeleting?: boolean;
  /** Initial duty day index to scroll to when drawer opens (1-indexed) */
  initialDutyDayIndex?: number;
}

const TABS: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: 'segments', label: 'Segments', icon: Plane },
  { id: 'pay', label: 'Pay', icon: DollarSign },
  { id: 'events', label: 'Log Events', icon: FileText },
  { id: 'proof', label: 'Proof', icon: Camera },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
];

function formatDate(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const end = new Date(endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (start === end) return start;
  return `${start} - ${end}`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

// Segment editor component
function LegEditor({
  leg,
  onEdit,
  onCapture,
}: {
  leg: BackendLeg;
  onEdit?: () => void;
  onCapture?: () => void;
}) {
  const hasOOOI = leg.actualOutISO && leg.actualInISO;
  const needsReview = leg.needsReview;

  return (
    <View className="bg-slate-800/60 rounded-xl p-3 mb-2 border border-slate-700/50">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <View className={cn(
            'px-2 py-0.5 rounded-md',
            leg.isDeadhead ? 'bg-orange-500/30' : 'bg-blue-500/30'
          )}>
            <Text className={cn('text-[10px] font-bold', leg.isDeadhead ? 'text-orange-400' : 'text-blue-400')}>
              {leg.isDeadhead ? 'DH' : 'FLT'}
            </Text>
          </View>
          <Text className="text-white font-semibold ml-2">{leg.flightNumber || '----'}</Text>
          {leg.equipment && (
            <View className="bg-slate-700/60 px-1.5 py-0.5 rounded ml-2">
              <Text className="text-slate-400 text-[10px]">{leg.equipment}</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center">
          {needsReview && <AlertCircle size={14} color="#f59e0b" />}
          {hasOOOI && <CheckCircle2 size={14} color="#22c55e" className="ml-1" />}
        </View>
      </View>

      {/* Route */}
      <View className="flex-row items-center justify-center py-2">
        <View className="items-center">
          <Text className="text-white text-lg font-bold">{leg.origin || '---'}</Text>
          <Text className="text-slate-500 text-xs">{formatTime(leg.scheduledOutISO)}</Text>
        </View>
        <View className="flex-row items-center mx-4">
          <View className="w-8 h-px bg-slate-600" />
          <Plane size={14} color="#64748b" style={{ marginHorizontal: 4, transform: [{ rotate: '90deg' }] }} />
          <View className="w-8 h-px bg-slate-600" />
        </View>
        <View className="items-center">
          <Text className="text-white text-lg font-bold">{leg.destination || '---'}</Text>
          <Text className="text-slate-500 text-xs">{formatTime(leg.scheduledInISO)}</Text>
        </View>
      </View>

      {/* OOOI Times */}
      <View className="bg-slate-900/50 rounded-lg p-2 mt-1">
        <View className="flex-row items-center justify-between">
          {['OUT', 'OFF', 'ON', 'IN'].map((label, i) => {
            const times = [leg.actualOutISO, leg.actualOffISO, leg.actualOnISO, leg.actualInISO];
            const hasTime = !!times[i];
            return (
              <View key={label} className="items-center flex-1">
                <Text className="text-slate-500 text-[9px] uppercase">{label}</Text>
                <Text className={cn('font-mono text-sm', hasTime ? 'text-emerald-400' : 'text-slate-600')}>
                  {formatTime(times[i])}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Actions */}
      <View className="flex-row items-center justify-end mt-2 pt-2 border-t border-slate-700/50">
        <Pressable
          onPress={onEdit}
          className="flex-row items-center px-3 py-1.5 bg-slate-700/60 rounded-lg mr-2 active:opacity-70"
        >
          <Edit3 size={12} color="#94a3b8" />
          <Text className="text-slate-300 text-xs ml-1">Edit</Text>
        </Pressable>
        {!hasOOOI && (
          <Pressable
            onPress={onCapture}
            className="flex-row items-center px-3 py-1.5 bg-amber-500/20 rounded-lg active:opacity-70"
          >
            <Camera size={12} color="#f59e0b" />
            <Text className="text-amber-400 text-xs ml-1">Capture</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * LayoverCard - Live countdown display for layovers
 * Uses useLayoverCountdown hook for real-time updates
 */
function LayoverCard({
  station,
  restMinutes,
  nextReportISO,
}: {
  station: string;
  restMinutes: number;
  nextReportISO?: string | null;
}) {
  // Use live countdown hook
  const countdown = useLayoverCountdown({
    nextReportISO,
    station,
    enabled: true,
  });

  // Determine color based on remaining time
  const getTimeColor = () => {
    if (countdown.isReportTime) return { bg: 'bg-red-500/20', text: 'text-red-400', icon: '#ef4444', border: '#ef4444' };
    if (countdown.isWarning) return { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: '#f59e0b', border: '#f59e0b' };
    return { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '#3b82f6', border: '#64748b' };
  };

  const colors = getTimeColor();

  // Use live countdown time if available, otherwise fallback to static
  const displayTime = countdown.isActive || countdown.isReportTime
    ? countdown.formattedTime
    : formatMinutesToTime(restMinutes);

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="mb-3"
    >
      <View className="bg-slate-800/80 rounded-2xl border border-slate-700/50 overflow-hidden">
        {/* Left Accent Border - color based on urgency */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.border }} />

        <View className="pl-4 pr-3 py-3">
          {/* Header: Type Badge */}
          <View className="flex-row items-center mb-2">
            <Building2 size={16} color="#64748b" />
            <View className="ml-2 px-2 py-0.5 rounded bg-slate-700/60">
              <Text className="text-slate-400 text-xs font-bold">LAYOVER</Text>
            </View>
          </View>

          {/* Station */}
          <Text className="text-white text-xl font-bold mb-2">
            Layover at {station}
          </Text>

          {/* Rest Time Badge - Live countdown */}
          <View className="flex-row items-center">
            <View className={cn('px-3 py-1.5 rounded-lg flex-row items-center', colors.bg)}>
              <Clock size={14} color={colors.icon} />
              <Text className={cn('text-base font-bold ml-1.5', colors.text)}>
                {countdown.isReportTime ? 'REPORT TIME' : displayTime}
              </Text>
            </View>
            <Text className="text-slate-500 text-sm ml-2">
              {countdown.isReportTime ? '' : 'Rest Time — Until Report'}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// Segments Tab - Redesigned with FlightLegCard style
// Shows canonical breakdown when available, falls back to legacy display
function SegmentsTab({
  trip,
  onAddDutyDay,
  onAddLeg,
  onEditLeg,
  onCaptureProof,
  onScheduleChange,
  onCaptureOOOI,
  onLogLegPremium,
  initialDutyDayIndex,
}: {
  trip: BackendTrip;
  onAddDutyDay?: () => void;
  onAddLeg?: (dutyDayId: string) => void;
  onEditLeg?: (leg: BackendLeg) => void;
  onCaptureProof?: (leg: BackendLeg) => void;
  onScheduleChange?: (dutyDay: BackendTripDutyDay) => void;
  onCaptureOOOI?: (legContext: LegOOOIContext) => void;
  onLogLegPremium?: (legContext: LegPremiumContext) => void;
  initialDutyDayIndex?: number;
}) {
  // Use canonical breakdown if available
  const tripDutyDays = trip.tripDutyDays || [];
  const hasCanonicalBreakdown = tripDutyDays.length > 0;

  // If we have canonical breakdown, show it
  if (hasCanonicalBreakdown) {
    return (
      <View>
        <CanonicalTripBreakdown
          tripNumber={trip.tripNumber}
          baseFleet={trip.baseFleet}
          tripDutyDays={tripDutyDays}
          onScheduleChange={onScheduleChange}
          onCaptureOOOI={onCaptureOOOI}
          onLogLegPremium={onLogLegPremium}
          initialDutyDayIndex={initialDutyDayIndex}
        />
        {/* Add leg button for new entries */}
        {trip.dutyDays && trip.dutyDays.length > 0 && (
          <View className="mt-4 flex-row justify-center">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const lastDutyDay = trip.dutyDays?.[trip.dutyDays.length - 1];
                if (lastDutyDay && onAddLeg) {
                  onAddLeg(lastDutyDay.id);
                }
              }}
              className="flex-row items-center px-4 py-2 bg-slate-700/60 rounded-xl"
            >
              <Plus size={16} color="#94a3b8" />
              <Text className="text-slate-300 font-medium ml-2">Add Leg</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Legacy display for trips without canonical breakdown
  const dutyDays = trip.dutyDays || [];

  // Flatten all legs with their duty day info for display
  const allSegments: Array<{
    type: 'flight' | 'layover';
    leg?: BackendLeg;
    dutyDay?: BackendDutyDay;
    station?: string;
    restMinutes?: number;
    nextReportISO?: string | null;
    isLastLegOfDay?: boolean;
    dayCreditMinutes?: number;
    dayMinGuarantee?: boolean;
  }> = [];

  // Sort duty days by date
  const sortedDutyDays = [...dutyDays].sort((a, b) => a.dutyDate.localeCompare(b.dutyDate));

  // Determine home base from trip's first leg origin
  const homeBase = sortedDutyDays[0]?.legs?.[0]?.origin ?? null;

  sortedDutyDays.forEach((dutyDay, dayIndex) => {
    const sortedLegs = [...dutyDay.legs].sort((a, b) => a.legIndex - b.legIndex);

    sortedLegs.forEach((leg, legIndex) => {
      const isLastLegOfDay = legIndex === sortedLegs.length - 1;
      allSegments.push({
        type: 'flight',
        leg,
        dutyDay,
        isLastLegOfDay,
        dayCreditMinutes: isLastLegOfDay ? (dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes) : 0,
        dayMinGuarantee: isLastLegOfDay && (dutyDay.minCreditMinutes > 0 && (dutyDay.finalCreditMinutes || 0) <= dutyDay.minCreditMinutes),
      });
    });

    // Add layover after last leg if not the last duty day
    // AND if both duty days have valid legs (proper overnight rest between duty days)
    if (dayIndex < sortedDutyDays.length - 1) {
      const nextDutyDay = sortedDutyDays[dayIndex + 1];

      // Only show layover if both duty days have legs (valid overnight rest)
      if (shouldShowLayover(dutyDay, nextDutyDay, homeBase)) {
        const lastLeg = sortedLegs[sortedLegs.length - 1];

        if (lastLeg?.destination) {
          // Get next duty day's first leg for calculating report time
          const nextDayLegs = [...nextDutyDay.legs].sort((a, b) => a.legIndex - b.legIndex);
          const nextDayFirstLeg = nextDayLegs[0];
          const nextDepartureISO = nextDayFirstLeg?.scheduledOutISO ?? nextDutyDay.dutyStartISO ?? null;

          // Get report offset based on trip type (60min domestic, 90min international)
          const reportOffset = getReportOffsetMinutes(
            lastLeg?.destination ?? null,
            nextDayFirstLeg?.origin ?? null
          );

          // Calculate rest minutes using proper duty day boundary logic with report offset
          // This is the SINGLE overnight rest period (NOT cumulative)
          const restMinutes = calculateLayoverMinutes(dutyDay, nextDutyDay, reportOffset);

          // Check if international (for display purposes)
          const isIntl = reportOffset === 90;

          // Calculate report time: departure - offset
          const nextReportISO = calculateReportTimeISO(nextDepartureISO, isIntl);

          allSegments.push({
            type: 'layover',
            station: lastLeg.destination,
            restMinutes: Math.max(restMinutes, 0),
            nextReportISO,
          });
        }
      }
    }
  });

  return (
    <View>
      {dutyDays.length === 0 ? (
        <View className="bg-slate-800/60 rounded-2xl p-8 items-center">
          <Calendar size={40} color="#64748b" />
          <Text className="text-slate-400 text-center mt-4">No duty days yet</Text>
          <Pressable
            onPress={onAddDutyDay}
            className="mt-4 bg-amber-500 px-4 py-2 rounded-xl flex-row items-center"
          >
            <Plus size={16} color="#0f172a" />
            <Text className="text-slate-900 font-bold ml-1">Add Duty Day</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {allSegments.map((segment, index) => {
            if (segment.type === 'flight' && segment.leg) {
              const leg = segment.leg;
              const hasOOOI = !!(leg.actualOutISO && leg.actualOffISO && leg.actualOnISO && leg.actualInISO);
              const blockMinutes = leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
              const accentColor = leg.isDeadhead ? '#f97316' : '#3b82f6';
              const accentBg = leg.isDeadhead ? 'bg-orange-500/20' : 'bg-blue-500/20';
              const accentText = leg.isDeadhead ? 'text-orange-400' : 'text-blue-400';

              return (
                <Animated.View
                  key={`flight-${leg.id}`}
                  entering={FadeIn.duration(300)}
                  className="mb-3"
                >
                  <View className="bg-slate-800/80 rounded-2xl border border-slate-700/50 overflow-hidden">
                    {/* Left Accent Border */}
                    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: accentColor }} />

                    <View className="pl-4 pr-3 py-3">
                      {/* Header: Type Badge + Flight Number + Aircraft Chip + OOOI Status */}
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center flex-wrap">
                          <Plane size={16} color={accentColor} />
                          <View className={cn('ml-2 px-2 py-0.5 rounded', accentBg)}>
                            <Text className={cn('text-xs font-bold', accentText)}>
                              {leg.isDeadhead ? 'DEADHEAD' : 'FLIGHT'}
                            </Text>
                          </View>
                          <Text className="text-slate-400 text-sm font-semibold ml-2">
                            {leg.flightNumber || '----'}
                          </Text>
                          {/* Aircraft chip next to flight number */}
                          {leg.equipment && (
                            <View className="ml-1.5 bg-slate-700/70 px-1.5 py-0.5 rounded">
                              <Text className="text-slate-400 text-[11px] font-bold">{leg.equipment}</Text>
                            </View>
                          )}
                          {hasOOOI && (
                            <View className="ml-2 flex-row items-center bg-green-500/20 px-1.5 py-0.5 rounded">
                              <CheckCircle2 size={10} color="#22c55e" />
                              <Text className="text-green-400 text-[10px] font-medium ml-0.5">OOOI</Text>
                            </View>
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            onCaptureProof?.(leg);
                          }}
                          className="p-2 -mr-1"
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Camera size={18} color="#64748b" />
                        </Pressable>
                      </View>

                      {/* Main Route Display: ORIGIN → DESTINATION */}
                      <View className="flex-row items-center mb-2">
                        <Text className="text-white text-2xl font-bold tracking-wide">
                          {leg.origin || '---'}
                        </Text>
                        <Text className="text-slate-500 text-2xl mx-2">→</Text>
                        <Text className="text-white text-2xl font-bold tracking-wide">
                          {leg.destination || '---'}
                        </Text>
                      </View>

                      {/* DEP / ARR / BLK - Headers ABOVE values with fixed widths */}
                      <View className="flex-row items-center mb-3">
                        <View className="flex-1 items-center">
                          <Text className="text-slate-500 text-xs font-black uppercase tracking-wider mb-1">DEP</Text>
                          <Text className="text-white text-lg font-bold">
                            {formatTime(leg.actualOutISO || leg.scheduledOutISO)}
                          </Text>
                        </View>
                        <View className="flex-1 items-center">
                          <Text className="text-slate-500 text-xs font-black uppercase tracking-wider mb-1">ARR</Text>
                          <Text className="text-white text-lg font-bold">
                            {formatTime(leg.actualInISO || leg.scheduledInISO)}
                          </Text>
                        </View>
                        <View className="flex-1 items-center">
                          <Text className="text-slate-500 text-xs font-black uppercase tracking-wider mb-1">BLK</Text>
                          <Text className="text-amber-400 text-lg font-bold">
                            {formatMinutesToTime(blockMinutes)}
                          </Text>
                        </View>
                      </View>

                      {/* Day Credit Section (shown at bottom of last leg of day) */}
                      {segment.isLastLegOfDay && segment.dayCreditMinutes && segment.dayCreditMinutes > 0 && (
                        <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-slate-700/50">
                          <View className="flex-row items-center">
                            <Text className="text-amber-500 text-lg">⚡</Text>
                            <Text className="text-white text-base font-semibold ml-1">
                              Day Credit: <Text className="text-amber-400">{formatMinutesToTime(segment.dayCreditMinutes)}</Text>
                            </Text>
                            {segment.dayMinGuarantee && (
                              <View className="ml-2 bg-amber-500/30 px-1.5 py-0.5 rounded">
                                <Text className="text-amber-400 text-[10px] font-bold">MIN</Text>
                              </View>
                            )}
                          </View>
                          <Pressable
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              onEditLeg?.(leg);
                            }}
                            className="flex-row items-center bg-slate-700/60 px-3 py-1.5 rounded-lg active:opacity-80"
                          >
                            <Edit3 size={14} color="#94a3b8" />
                            <Text className="text-slate-300 text-sm font-medium ml-1.5">Edit</Text>
                          </Pressable>
                        </View>
                      )}

                      {/* Proof Indicator */}
                      {leg.ooiProofUri && (
                        <View className="flex-row items-center mt-2">
                          <CheckCircle2 size={12} color="#22c55e" />
                          <Text className="text-green-400 text-xs font-medium ml-1">
                            1 OOOI proof attached
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Animated.View>
              );
            }

            if (segment.type === 'layover' && segment.station) {
              return (
                <LayoverCard
                  key={`layover-${index}`}
                  station={segment.station}
                  restMinutes={segment.restMinutes || 0}
                  nextReportISO={segment.nextReportISO}
                />
              );
            }

            return null;
          })}

          {/* Add Leg Button at Bottom */}
          {dutyDays.length > 0 && (
            <Pressable
              onPress={() => {
                // Add to last duty day
                const lastDutyDay = sortedDutyDays[sortedDutyDays.length - 1];
                if (lastDutyDay) onAddLeg?.(lastDutyDay.id);
              }}
              className="bg-slate-800 border border-slate-700 border-dashed rounded-xl py-4 flex-row items-center justify-center mt-2 active:opacity-80"
            >
              <Plus size={18} color="#64748b" />
              <Text className="text-slate-400 font-medium ml-2">Add Leg</Text>
            </Pressable>
          )}

          <Pressable
            onPress={onAddDutyDay}
            className="bg-slate-800 border border-slate-700 border-dashed rounded-xl py-4 flex-row items-center justify-center mt-2 active:opacity-80"
          >
            <Plus size={18} color="#64748b" />
            <Text className="text-slate-400 font-medium ml-2">Add Duty Day</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// Pay Tab
function PayTab({
  trip,
  protectedCreditMinutes,
  isPayProtected,
  onCreditPolicyChange,
  tripSickInfo,
  payBreakdown,
}: {
  trip: BackendTrip;
  protectedCreditMinutes?: number;
  isPayProtected?: boolean;
  onCreditPolicyChange?: (policy: 'use_current' | 'keep_protected' | 'manual', manualMinutes?: number) => void;
  tripSickInfo?: TripSickInfo | null;
  payBreakdown?: import('@/lib/useTripPayEngine').TripPayBreakdown | null;
}) {
  const expectedPay = trip.totalPayCents;
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCreditHours, setManualCreditHours] = useState('0');
  const [manualCreditMinutes, setManualCreditMinutes] = useState('00');

  // Check if pay protection is applicable (same pairing revision with credit decrease)
  const hasPayProtection = protectedCreditMinutes !== undefined && protectedCreditMinutes > 0;
  const currentCreditMinutes = trip.totalCreditMinutes ?? 0;
  const creditDeltaMinutes = hasPayProtection ? currentCreditMinutes - protectedCreditMinutes : 0;
  const showPayProtectionToggle = hasPayProtection && creditDeltaMinutes !== 0;

  // Calculate confidence based on data completeness
  const calculateConfidence = () => {
    let score = 0;
    let maxScore = 0;

    const dutyDays = trip.dutyDays || [];

    // Check if we have duty days
    maxScore += 20;
    if (dutyDays.length > 0) score += 20;

    // Check OOOI completeness across all legs
    const allLegs = dutyDays.flatMap(dd => dd.legs);
    if (allLegs.length > 0) {
      const legsWithOOOI = allLegs.filter(leg =>
        leg.actualOutISO && leg.actualInISO
      ).length;
      const ooiPercentage = legsWithOOOI / allLegs.length;
      maxScore += 40;
      score += Math.round(ooiPercentage * 40);

      // Check proof attachments
      const legsWithProof = allLegs.filter(leg => leg.ooiProofUri).length;
      const proofPercentage = legsWithProof / allLegs.length;
      maxScore += 30;
      score += Math.round(proofPercentage * 30);
    }

    // Check if trip has been flown (status completed)
    maxScore += 10;
    if (trip.status === 'completed') score += 10;

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  };

  const confidence = calculateConfidence();
  const confidenceColor = confidence >= 80 ? 'text-green-400' : confidence >= 50 ? 'text-amber-400' : 'text-red-400';
  const confidenceBgColor = confidence >= 80 ? 'bg-green-500' : confidence >= 50 ? 'bg-amber-500' : 'bg-red-500';

  // Premium pay from engine
  const hasPremiums = payBreakdown && payBreakdown.premiumPayCents > 0;
  const displayPayCents = hasPremiums ? payBreakdown.totalPayCents : (trip.totalPayCents ?? 0);
  const displayCreditMinutes = hasPremiums ? payBreakdown.totalCreditMinutes : (trip.totalCreditMinutes ?? 0);

  return (
    <View>
      {/* Pay Summary Card */}
      <View className="bg-slate-800/60 rounded-2xl p-4 mb-4">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Pay Summary</Text>

        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-slate-300">Expected Pay</Text>
          <Text className="text-white font-bold text-lg">{formatCentsToCurrency(displayPayCents)}</Text>
        </View>

        {hasPremiums && (
          <>
            <View className="flex-row items-center justify-between mb-1 pl-2">
              <Text className="text-slate-500 text-sm">Base Pay</Text>
              <Text className="text-slate-400 font-semibold">{formatCentsToCurrency(payBreakdown.basePayCents)}</Text>
            </View>
            <View className="flex-row items-center justify-between mb-3 pl-2">
              <Text className="text-emerald-400 text-sm">+ Premium</Text>
              <Text className="text-emerald-400 font-semibold">+{formatCentsToCurrency(payBreakdown.premiumPayCents)}</Text>
            </View>
          </>
        )}

        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-slate-300">Credit Time</Text>
          <Text className="text-emerald-400 font-bold text-lg">{formatMinutesToTime(displayCreditMinutes)}</Text>
        </View>

        {hasPremiums && (
          <View className="flex-row items-center justify-between mb-3 pl-2">
            <Text className="text-slate-500 text-sm">Base Credit</Text>
            <Text className="text-slate-400 font-semibold">{formatMinutesToTime(payBreakdown.baseCreditMinutes)}</Text>
          </View>
        )}

        <View className="h-px bg-slate-700 my-2" />

        <View className="flex-row items-center justify-between">
          <Text className="text-slate-300">Block Time</Text>
          <Text className="text-white font-bold text-lg">{formatMinutesToTime(trip.totalBlockMinutes)}</Text>
        </View>
      </View>

      {/* Applied Contract Drivers - Shows when log events have pay modifiers */}
      {payBreakdown && payBreakdown.appliedRules.length > 0 && (
        <View className="bg-purple-500/10 border border-purple-500/30 rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-8 h-8 rounded-lg bg-purple-500/20 items-center justify-center mr-3">
              <Zap size={18} color="#a855f7" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold">Applied Contract Drivers</Text>
              <Text className="text-purple-400 text-xs">{payBreakdown.appliedRules.length} modifier{payBreakdown.appliedRules.length !== 1 ? 's' : ''} affecting pay</Text>
            </View>
          </View>

          {payBreakdown.appliedRules.map((rule, idx) => (
            <View key={rule.eventId} className={cn('bg-slate-900/50 rounded-xl p-3', idx < payBreakdown.appliedRules.length - 1 && 'mb-2')}>
              <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center flex-1">
                  {rule.premiumCode && (
                    <View className="bg-purple-500/20 px-2 py-0.5 rounded mr-2">
                      <Text className="text-purple-300 text-xs font-bold" style={{ fontFamily: 'monospace' }}>{rule.premiumCode}</Text>
                    </View>
                  )}
                  <Text className="text-white text-sm font-medium flex-1" numberOfLines={1}>{rule.description}</Text>
                </View>
                <Text className="text-emerald-400 font-bold text-sm ml-2">
                  +{formatCentsToCurrency(rule.payDeltaCents)}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  {rule.contractReference && (
                    <Text className="text-slate-500 text-[10px]">§ {rule.contractReference}</Text>
                  )}
                  <View className={cn(
                    'px-1.5 py-0.5 rounded',
                    rule.proofStatus === 'attached' ? 'bg-green-500/20' :
                    rule.proofStatus === 'missing' ? 'bg-red-500/20' : 'bg-slate-700/60'
                  )}>
                    <Text className={cn(
                      'text-[9px] font-bold',
                      rule.proofStatus === 'attached' ? 'text-green-400' :
                      rule.proofStatus === 'missing' ? 'text-red-400' : 'text-slate-500'
                    )}>
                      {rule.proofStatus === 'attached' ? 'PROOF ✓' :
                       rule.proofStatus === 'missing' ? 'PROOF MISSING' : 'NO PROOF NEEDED'}
                    </Text>
                  </View>
                </View>
                <View className={cn(
                  'px-1.5 py-0.5 rounded',
                  rule.applicationStatus === 'applied' ? 'bg-purple-500/20' :
                  rule.applicationStatus === 'ready_to_apply' ? 'bg-amber-500/20' : 'bg-slate-700/60'
                )}>
                  <Text className={cn(
                    'text-[9px] font-bold uppercase',
                    rule.applicationStatus === 'applied' ? 'text-purple-400' :
                    rule.applicationStatus === 'ready_to_apply' ? 'text-amber-400' : 'text-slate-500'
                  )}>
                    {rule.applicationStatus?.replace(/_/g, ' ') ?? 'logged'}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Sick Credit Breakdown - Shows when trip has any SIK legs */}
      {tripSickInfo && tripSickInfo.tripSickStatus !== 'FLY' && (
        <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-8 h-8 rounded-lg bg-emerald-500/20 items-center justify-center mr-3">
              <Heart size={18} color="#10b981" fill="#10b981" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold">Pay/Credit Breakdown</Text>
              <Text className="text-emerald-400 text-xs">
                {tripSickInfo.tripSickStatus === 'SIK' ? 'Entire trip marked as sick' : 'Some legs marked as sick'}
              </Text>
            </View>
          </View>

          {/* Credit breakdown details */}
          <View className="bg-slate-900/50 rounded-xl p-3 mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-slate-400 text-sm">Earned Credit</Text>
              <Text className="text-white font-bold">
                {formatMinutesToTime(tripSickInfo.breakdown.earnedCreditMinutes)}
              </Text>
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center">
                <Heart size={12} color="#10b981" fill="#10b981" />
                <Text className="text-emerald-400 text-sm ml-1">Sick Credit</Text>
              </View>
              <Text className="text-emerald-400 font-bold">
                {formatMinutesToTime(tripSickInfo.breakdown.sickCreditMinutes)}
              </Text>
            </View>
            <View className="h-px bg-slate-700 my-2" />
            <View className="flex-row items-center justify-between">
              <Text className="text-slate-300 text-sm font-semibold">Total Credit</Text>
              <Text className="text-cyan-400 font-bold">
                {formatMinutesToTime(tripSickInfo.breakdown.totalCreditMinutes)}
              </Text>
            </View>
          </View>

          {/* Legal Disclaimer */}
          <Text className="text-slate-500 text-[10px] leading-tight">
            {tripSickInfo.disclaimer}
          </Text>
        </View>
      )}

      {/* Pay Protection Toggle - Shows when trip qualifies for protection */}
      {showPayProtectionToggle && (
        <View className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-8 h-8 rounded-lg bg-violet-500/20 items-center justify-center mr-3">
              <DollarSign size={18} color="#8b5cf6" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold">Pay Protection</Text>
              <Text className="text-violet-400 text-xs">
                {isPayProtected ? 'ON - Using protected credit' : 'OFF - Using current credit'}
              </Text>
            </View>
          </View>

          {/* Credit comparison */}
          <View className="bg-slate-900/50 rounded-xl p-3 mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-slate-400 text-sm">Protected Credit</Text>
              <Text className="text-violet-400 font-bold">{formatMinutesToTime(protectedCreditMinutes ?? 0)}</Text>
            </View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-slate-400 text-sm">Current Schedule Credit</Text>
              <Text className={cn(
                'font-bold',
                creditDeltaMinutes < 0 ? 'text-red-400' : 'text-emerald-400'
              )}>
                {formatMinutesToTime(currentCreditMinutes)}
              </Text>
            </View>
            <View className="h-px bg-slate-700 my-1" />
            <View className="flex-row items-center justify-between">
              <Text className="text-slate-500 text-sm">Difference</Text>
              <Text className={cn(
                'font-bold',
                creditDeltaMinutes < 0 ? 'text-red-400' : 'text-emerald-400'
              )}>
                {creditDeltaMinutes > 0 ? '+' : ''}{formatMinutesToTime(Math.abs(creditDeltaMinutes))}
              </Text>
            </View>
          </View>

          {/* Credit Policy Buttons */}
          <View className="gap-2">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onCreditPolicyChange?.('keep_protected');
              }}
              className={cn(
                'flex-row items-center justify-center px-4 py-3 rounded-xl',
                isPayProtected ? 'bg-violet-500' : 'bg-slate-700/60'
              )}
            >
              <Text className={cn(
                'font-semibold',
                isPayProtected ? 'text-white' : 'text-slate-300'
              )}>
                Keep Protected Credit ({formatMinutesToTime(protectedCreditMinutes ?? 0)})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onCreditPolicyChange?.('use_current');
              }}
              className={cn(
                'flex-row items-center justify-center px-4 py-3 rounded-xl',
                !isPayProtected && !showManualInput ? 'bg-slate-500' : 'bg-slate-700/60'
              )}
            >
              <Text className={cn(
                'font-semibold',
                !isPayProtected && !showManualInput ? 'text-white' : 'text-slate-300'
              )}>
                Use Current Credit ({formatMinutesToTime(currentCreditMinutes)})
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowManualInput(!showManualInput);
              }}
              className="flex-row items-center justify-center px-4 py-3 rounded-xl bg-slate-700/40"
            >
              <Text className="text-slate-400 font-medium">Set Manual Credit</Text>
            </Pressable>

            {showManualInput && (
              <View className="bg-slate-900/50 rounded-xl p-3 mt-2">
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={manualCreditHours}
                    onChangeText={setManualCreditHours}
                    keyboardType="number-pad"
                    maxLength={3}
                    placeholder="HH"
                    placeholderTextColor="#64748b"
                    className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-white text-center font-bold"
                  />
                  <Text className="text-slate-400 font-bold">:</Text>
                  <TextInput
                    value={manualCreditMinutes}
                    onChangeText={setManualCreditMinutes}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="MM"
                    placeholderTextColor="#64748b"
                    className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-white text-center font-bold"
                  />
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      const totalMinutes = parseInt(manualCreditHours || '0') * 60 + parseInt(manualCreditMinutes || '0');
                      onCreditPolicyChange?.('manual', totalMinutes);
                      setShowManualInput(false);
                    }}
                    className="bg-violet-500 px-4 py-2 rounded-lg"
                  >
                    <Text className="text-white font-bold">Set</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          <Text className="text-slate-500 text-xs mt-3 text-center">
            Changes will update month summary immediately
          </Text>
        </View>
      )}

      {/* Confidence Indicator */}
      <View className="bg-slate-800/60 rounded-2xl p-4 mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Data Confidence</Text>
          <Text className={cn('font-bold', confidenceColor)}>{confidence}%</Text>
        </View>
        <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <View
            className={cn('h-full rounded-full', confidenceBgColor)}
            style={{ width: `${confidence}%` }}
          />
        </View>
        <Text className="text-slate-500 text-xs mt-2">
          Based on OOOI completeness and proof attachments
        </Text>
      </View>

      {/* Confidence Breakdown */}
      {confidence < 100 && (
        <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
          <View className="flex-row items-center mb-2">
            <AlertCircle size={16} color="#f59e0b" />
            <Text className="text-amber-400 font-semibold ml-2">Improve Confidence</Text>
          </View>
          <Text className="text-slate-400 text-sm">
            {(() => {
              const suggestions: string[] = [];
              const dutyDays = trip.dutyDays || [];
              const allLegs = dutyDays.flatMap(dd => dd.legs);

              const legsWithOOOI = allLegs.filter(leg => leg.actualOutISO && leg.actualInISO).length;
              if (legsWithOOOI < allLegs.length) {
                suggestions.push(`Add OOOI times for ${allLegs.length - legsWithOOOI} leg(s)`);
              }

              const legsWithProof = allLegs.filter(leg => leg.ooiProofUri).length;
              if (legsWithProof < allLegs.length) {
                suggestions.push(`Attach proof for ${allLegs.length - legsWithProof} leg(s)`);
              }

              return suggestions.length > 0 ? suggestions.join('. ') + '.' : 'All data complete!';
            })()}
          </Text>
        </View>
      )}
    </View>
  );
}

// Log Events Tab - For documenting trip-related events and changes
function EventsTab({ trip, onAddPayEvent }: { trip: BackendTrip; onAddPayEvent?: () => void }) {
  // Get log events for this trip
  const { data: logEventsData, isLoading } = useLogEvents({ tripId: trip.id, enabled: true });
  const deleteLogEvent = useDeleteLogEvent();

  const logEvents = logEventsData?.events ?? [];
  const totalPremiumMinutes = logEvents.reduce((acc, e) => acc + (e.premiumMinutesDelta ?? 0), 0);

  // Smart Assist: detect possible pay triggers heuristically
  const payTriggers = detectPayTriggers(trip);

  const handleDeleteEvent = (eventId: string) => {
    deleteLogEvent.mutate(eventId, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      onError: (error) => {
        console.error('Failed to delete log event:', error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      },
    });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View>
        {/* Premium Summary - Only show if there are premiums */}
        <TripPremiumSummary
          tripId={trip.id}
          tripNumber={trip.tripNumber}
          baseCreditMinutes={trip.totalCreditMinutes ?? 0}
        />

        {/* Smart Assist - Possible Pay Triggers */}
        {payTriggers.length > 0 && (
          <View className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-3 mb-3 mt-3">
            <View className="flex-row items-center mb-2">
              <Zap size={14} color="#f59e0b" />
              <Text className="text-amber-400 font-semibold text-sm ml-1.5">Possible Pay Triggers</Text>
            </View>
            {payTriggers.map((trigger, idx) => (
              <Pressable
                key={trigger.type}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onAddPayEvent?.();
                }}
                className={cn(
                  'flex-row items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 active:opacity-70',
                  idx < payTriggers.length - 1 && 'mb-1.5'
                )}
              >
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <View className={cn(
                      'px-1.5 py-0.5 rounded mr-2',
                      trigger.confidence === 'high' ? 'bg-amber-500/30' : 'bg-slate-700/60'
                    )}>
                      <Text className={cn(
                        'text-[9px] font-bold',
                        trigger.confidence === 'high' ? 'text-amber-400' : 'text-slate-500'
                      )}>
                        {trigger.confidence.toUpperCase()}
                      </Text>
                    </View>
                    <Text className="text-white text-sm font-semibold">{trigger.label}</Text>
                    {trigger.suggestedCode && (
                      <View className="bg-purple-500/20 px-1.5 py-0.5 rounded ml-2">
                        <Text className="text-purple-300 text-[10px] font-bold">{trigger.suggestedCode}</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-slate-500 text-xs mt-0.5" numberOfLines={1}>{trigger.reason}</Text>
                </View>
                <View className="bg-amber-500/20 px-2 py-1 rounded-lg ml-2">
                  <Text className="text-amber-400 text-[10px] font-bold">LOG</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

      {/* Trip Source Info */}
      <View className="bg-slate-800/40 rounded-xl p-3 mb-3 mt-3 border border-slate-700/30">
        <View className="flex-row items-center mb-2">
          <View className="w-8 h-8 rounded-lg bg-purple-500/20 items-center justify-center">
            <FileText size={16} color="#a855f7" />
          </View>
          <Text className="text-white font-semibold ml-2">Trip Source</Text>
        </View>
        <Text className="text-slate-400 text-sm">
          Created from schedule upload on {new Date(trip.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </Text>
        <View className="flex-row items-center mt-2">
          <View className="bg-green-500/20 px-2 py-0.5 rounded">
            <Text className="text-green-400 text-[10px] font-semibold">LINKED</Text>
          </View>
          <Text className="text-slate-500 text-xs ml-2">Trip created from schedule import</Text>
        </View>
      </View>

      {/* Log Events Section */}
      {isLoading ? (
        <View className="bg-slate-800/30 rounded-xl p-4 animate-pulse">
          <View className="h-4 w-32 bg-slate-700 rounded mb-2" />
          <View className="h-20 w-full bg-slate-700 rounded" />
        </View>
      ) : logEvents.length === 0 ? (
        <LogEventsEmptyState tripId={trip.id} onCreateEvent={onAddPayEvent} />
      ) : (
        <>
          <LogEventsSectionHeader
            count={logEvents.length}
            totalPremiumMinutes={totalPremiumMinutes}
          />
          {logEvents.map((event) => (
            <LogEventListCard
              key={event.id}
              event={event}
              onPress={() => {
                // TODO: Navigate to log event detail
                console.log('View log event:', event.id);
              }}
              onDelete={handleDeleteEvent}
            />
          ))}
          <Pressable
            onPress={onAddPayEvent}
            className="bg-slate-800 border border-slate-700 border-dashed rounded-xl py-3 flex-row items-center justify-center mt-2 active:opacity-80"
          >
            <Plus size={16} color="#64748b" />
            <Text className="text-slate-400 font-medium ml-1">Log Event</Text>
          </Pressable>
        </>
      )}
      </View>
    </GestureHandlerRootView>
  );
}

// Proof Tab
function ProofTab({ trip, onCaptureProof }: { trip: BackendTrip; onCaptureProof?: (leg: BackendLeg) => void }) {
  const proofs: Array<{ legId: string; leg: BackendLeg; uri: string; matched: boolean }> = [];

  trip.dutyDays?.forEach(dd => {
    dd.legs.forEach(leg => {
      if (leg.ooiProofUri) {
        proofs.push({ legId: leg.id, leg, uri: leg.ooiProofUri, matched: true });
      }
    });
  });

  return (
    <View>
      {proofs.length === 0 ? (
        <View className="bg-slate-800/60 rounded-2xl p-8 items-center">
          <Camera size={40} color="#64748b" />
          <Text className="text-slate-400 text-center mt-4">No proof attached</Text>
          <Text className="text-slate-500 text-center text-sm mt-1">
            Capture ACARS screenshots to document your OOOI times
          </Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap">
          {proofs.map((proof) => (
            <View key={proof.legId} className="w-1/2 p-1">
              <View className="bg-slate-800/60 rounded-xl overflow-hidden">
                <View className="aspect-square bg-slate-700 items-center justify-center">
                  <ImageIcon size={32} color="#64748b" />
                </View>
                <View className="p-2">
                  <Text className="text-white text-xs font-medium">
                    {proof.leg.origin}-{proof.leg.destination}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    {proof.matched ? (
                      <CheckCircle2 size={10} color="#22c55e" />
                    ) : (
                      <AlertCircle size={10} color="#f59e0b" />
                    )}
                    <Text className={cn('text-[10px] ml-1', proof.matched ? 'text-green-400' : 'text-amber-400')}>
                      {proof.matched ? 'Matched' : 'Needs Match'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Notes Tab
function NotesTab({ trip }: { trip: BackendTrip }) {
  const [notes, setNotes] = useState('');

  return (
    <View>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Add notes about this trip..."
        placeholderTextColor="#64748b"
        multiline
        className="bg-slate-800/60 rounded-2xl p-4 text-white min-h-[200px]"
        textAlignVertical="top"
      />
    </View>
  );
}

export function TripDetailDrawer({
  trip,
  visible,
  onClose,
  onDelete,
  onAddDutyDay,
  onAddLeg,
  onEditLeg,
  onCaptureProof,
  onCaptureOOOI,
  onAddPayEvent,
  onMarkFlown,
  onVerifyPay,
  isDeleting,
  initialDutyDayIndex,
}: TripDetailDrawerProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>('segments');
  const [showEditTotals, setShowEditTotals] = useState(false);
  const [showScheduleChange, setShowScheduleChange] = useState(false);
  const [selectedDutyDay, setSelectedDutyDay] = useState<BackendTripDutyDay | null>(null);

  // Phase 4: Leg premium logging state
  const [showLegPremiumLogger, setShowLegPremiumLogger] = useState(false);
  const [selectedLegPremium, setSelectedLegPremium] = useState<LegPremiumContext | null>(null);
  const [selectedLegForPremium, setSelectedLegForPremium] = useState<BackendLeg | null>(null);
  const [selectedDutyDayForPremium, setSelectedDutyDayForPremium] = useState<BackendDutyDay | null>(null);

  // Phase 5: Schedule change log event modal state
  const [showLogEventModal, setShowLogEventModal] = useState(false);
  const [scheduleChangeContext, setScheduleChangeContext] = useState<ScheduleChangeContext | null>(null);

  // Phase 6: Unified Segment Editor state
  const [showSegmentEditor, setShowSegmentEditor] = useState(false);
  const [segmentEditorContext, setSegmentEditorContext] = useState<SegmentEditorContext | null>(null);

  // SIK (Sick) Tracking state
  const [showSickModal, setShowSickModal] = useState(false);

  // Hooks for mutations
  const updateTripMutation = useUpdateTrip();
  const scheduleChangeMutation = useApplyScheduleChange();
  const updateLegPremiumMutation = useUpdateLegPremium();
  const createLogEventMutation = useCreateLogEventFromChange();

  // SIK tracking hooks
  const { data: tripSickInfo } = useTripSickInfo(visible && trip ? trip.id : null);
  const undoSickMutation = useUndoSick();

  // Hook for premium suggestions based on change type
  const { data: premiumSuggestionsData } = usePremiumSuggestions(scheduleChangeContext?.changeType ?? null);

  // Pay engine hooks
  const { data: payBreakdown, refetch: refetchPayBreakdown } = useTripPayBreakdown(trip?.id, visible);
  const recalculatePayMutation = useRecalculateTripPay();
  const markPickupTypeMutation = useMarkPickupType();

  if (!trip) return null;

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const handleEditTotals = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowEditTotals(true);
  };

  const handleSaveTotals = async (data: { totalCreditMinutes?: number; totalBlockMinutes?: number }) => {
    try {
      await updateTripMutation.mutateAsync({
        tripId: trip.id,
        data,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowEditTotals(false);
    } catch (error) {
      console.error('Failed to update trip totals:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleScheduleChangeOpen = (dutyDay: BackendTripDutyDay) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open the unified SegmentEditor instead of the old modal
    setSegmentEditorContext({
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      dutyDay: dutyDay,
      dutyDayIndex: dutyDay.dutyDayIndex,
    });
    setShowSegmentEditor(true);
  };

  // Handler for closing the SegmentEditor
  const handleSegmentEditorClose = () => {
    setShowSegmentEditor(false);
    setSegmentEditorContext(null);
  };

  // Handler for when SegmentEditor saves successfully
  const handleSegmentEditorSave = () => {
    // The SegmentEditor handles its own mutation and closes itself
    // We just need to reset our state here
    setShowSegmentEditor(false);
    setSegmentEditorContext(null);
  };

  // Legacy schedule change handler (kept for backwards compatibility)
  const handleLegacyScheduleChangeOpen = (dutyDay: BackendTripDutyDay) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDutyDay(dutyDay);
    setShowScheduleChange(true);
  };

  const handleScheduleChangeSave = async (data: ScheduleChangeData) => {
    if (!selectedDutyDay) return;

    try {
      // Store original credit before mutation
      const originalCreditMinutes = selectedDutyDay.creditMinutes ?? 0;

      await scheduleChangeMutation.mutateAsync({
        dutyDayId: selectedDutyDay.id,
        data: {
          reason: data.reason,
          notes: data.notes,
          creditMinutes: data.creditMinutes,
          blockMinutes: data.blockMinutes,
          premiumCode: data.premiumCode,
          premiumCreditMinutes: data.premiumCreditMinutes,
          isOverride: data.isOverride,
        },
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowScheduleChange(false);

      // If a log event was included in the schedule change, show the log event modal
      // to allow capturing premiums and additional details
      if (data.logEvent) {
        const context: ScheduleChangeContext = {
          tripId: trip.id,
          tripNumber: trip.tripNumber,
          dutyDayId: selectedDutyDay.id,
          dutyDayIndex: selectedDutyDay.dutyDayIndex,
          dutyDate: selectedDutyDay.dutyDate,
          changeType: data.reason || 'schedule_change',
          before: {
            totalCreditMinutes: originalCreditMinutes,
            legCount: selectedDutyDay.legs?.length ?? 0,
          },
          after: {
            totalCreditMinutes: data.creditMinutes,
            legCount: selectedDutyDay.legs?.length ?? 0,
          },
          legChanges: (selectedDutyDay.legs ?? []).map((leg, idx) => ({
            legId: leg.id,
            legIndex: idx + 1,
            flightNumber: leg.flightNumber,
            origin: leg.origin,
            destination: leg.destination,
            before: {
              flightNumber: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              scheduledOut: leg.scheduledOutISO,
              scheduledIn: leg.scheduledInISO,
              creditMinutes: leg.creditMinutes,
            },
            after: {
              flightNumber: leg.flightNumber,
              origin: leg.origin,
              destination: leg.destination,
              scheduledOut: leg.scheduledOutISO,
              scheduledIn: leg.scheduledInISO,
              creditMinutes: leg.creditMinutes,
            },
            changeType: 'modified' as const,
          })),
        };
        setScheduleChangeContext(context);
        setShowLogEventModal(true);
      }

      setSelectedDutyDay(null);
    } catch (error) {
      console.error('Failed to save schedule change:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // Handle saving log event from the modal
  const handleSaveLogEvent = async (data: SaveLogEventData) => {
    try {
      await createLogEventMutation.mutateAsync({
        tripId: data.tripId,
        changeType: data.changeType,
        before: data.before,
        after: data.after,
        legIds: data.legIds,
        primaryLegId: data.primaryLegId,
        dutyDayId: scheduleChangeContext?.dutyDayId,
        attachmentUrls: data.attachmentUrls,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowLogEventModal(false);
      setScheduleChangeContext(null);
    } catch (error) {
      console.error('Failed to save log event:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleDiscardLogEvent = () => {
    setShowLogEventModal(false);
    setScheduleChangeContext(null);
  };

  // Phase 4: Handle leg premium logging
  const handleLegPremiumOpen = (legContext: LegPremiumContext) => {
    // Find the actual leg and duty day from trip data
    let foundLeg: BackendLeg | null = null;
    let foundDutyDay: BackendDutyDay | null = null;

    if (trip.dutyDays) {
      for (const dd of trip.dutyDays) {
        const leg = dd.legs.find(l => l.id === legContext.legId);
        if (leg) {
          foundLeg = leg;
          foundDutyDay = dd;
          break;
        }
      }
    }

    setSelectedLegPremium(legContext);
    setSelectedLegForPremium(foundLeg);
    setSelectedDutyDayForPremium(foundDutyDay);
    setShowLegPremiumLogger(true);
  };

  const handleLegPremiumClose = () => {
    setShowLegPremiumLogger(false);
    setSelectedLegPremium(null);
    setSelectedLegForPremium(null);
    setSelectedDutyDayForPremium(null);
  };

  const handleSaveLegPremium = async (data: {
    legId: string;
    premiumCode: string;
    premiumMinutes: number;
    premiumAmountCents: number;
    notes?: string;
  }) => {
    try {
      await updateLegPremiumMutation.mutateAsync({
        legId: data.legId,
        data: {
          premiumCode: data.premiumCode,
          premiumMinutes: data.premiumMinutes,
          premiumAmountCents: data.premiumAmountCents,
          notes: data.notes,
        },
      });
      console.log('[LegPremiumLogger] Saved leg premium:', data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      handleLegPremiumClose();
    } catch (error) {
      console.error('[LegPremiumLogger] Failed to save leg premium:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'segments':
        return (
          <SegmentsTab
            trip={trip}
            onAddDutyDay={onAddDutyDay}
            onAddLeg={onAddLeg}
            onEditLeg={onEditLeg}
            onCaptureProof={onCaptureProof}
            onScheduleChange={handleScheduleChangeOpen}
            onCaptureOOOI={onCaptureOOOI}
            onLogLegPremium={handleLegPremiumOpen}
            initialDutyDayIndex={initialDutyDayIndex}
          />
        );
      case 'pay':
        return <PayTab trip={trip} tripSickInfo={tripSickInfo} payBreakdown={payBreakdown ?? null} />;
      case 'events':
        return <EventsTab trip={trip} onAddPayEvent={onAddPayEvent} />;
      case 'proof':
        return <ProofTab trip={trip} onCaptureProof={onCaptureProof} />;
      case 'notes':
        return <NotesTab trip={trip} />;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70">
        <Animated.View
          entering={SlideInDown.duration(300)}
          className="flex-1 bg-slate-950 mt-12 rounded-t-3xl overflow-hidden"
          style={{ paddingBottom: insets.bottom }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className="w-12 h-12 rounded-xl bg-blue-500/20 items-center justify-center">
                <Plane size={24} color="#3b82f6" />
              </View>
              <View className="ml-3 flex-1">
                <View className="flex-row items-center">
                  <Text className="text-white font-bold text-xl">{trip.tripNumber || 'Trip'}</Text>
                  {tripSickInfo?.tripSickStatus && tripSickInfo.tripSickStatus !== 'FLY' && (
                    <TripSikBadge status={tripSickInfo.tripSickStatus} />
                  )}
                </View>
                <Text className="text-slate-400 text-sm">
                  {formatDateRange(trip.startDate, trip.endDate)}
                </Text>
              </View>
            </View>
            {/* Mark Sick Button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowSickModal(true);
              }}
              className="w-10 h-10 rounded-full bg-red-500/20 items-center justify-center active:opacity-70 mr-2"
            >
              <Heart size={20} color="#ef4444" fill="white" />
            </Pressable>
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          {/* Summary Stats - Now Tappable */}
          <Pressable
            onPress={handleEditTotals}
            className="flex-row items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800 active:bg-slate-800/50"
          >
            <View className="items-center flex-1">
              <Text className="text-slate-500 text-[10px] uppercase tracking-wider">Credit</Text>
              <View className="flex-row items-center">
                <Text className="text-amber-400 font-bold text-lg">
                  {formatMinutesToTime(trip.totalCreditMinutes)}
                </Text>
                <Pencil size={12} color="#64748b" style={{ marginLeft: 4 }} />
              </View>
            </View>
            <View className="w-px h-10 bg-slate-700" />
            <View className="items-center flex-1">
              <Text className="text-slate-500 text-[10px] uppercase tracking-wider">Block</Text>
              <View className="flex-row items-center">
                <Text className="text-white font-bold text-lg">
                  {formatMinutesToTime(trip.totalBlockMinutes)}
                </Text>
                <Pencil size={12} color="#64748b" style={{ marginLeft: 4 }} />
              </View>
            </View>
            <View className="w-px h-10 bg-slate-700" />
            <View className="items-center flex-1">
              <Text className="text-slate-500 text-[10px] uppercase tracking-wider">Pay</Text>
              <Text className="text-emerald-400 font-bold text-lg">
                {payBreakdown && payBreakdown.premiumPayCents > 0
                  ? formatCentsToCurrency(payBreakdown.totalPayCents)
                  : formatCentsToCurrency(trip.totalPayCents)
                }
              </Text>
            </View>
          </Pressable>

          {/* Quick Action Row */}
          <View className="flex-row items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onAddPayEvent?.();
              }}
              className="flex-1 mx-1 items-center bg-amber-500/15 border border-amber-500/30 rounded-xl py-2 active:opacity-70"
            >
              <ClipboardList size={14} color="#f59e0b" />
              <Text className="text-amber-400 text-[10px] font-semibold mt-0.5">Log Event</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab('proof');
              }}
              className="flex-1 mx-1 items-center bg-slate-800/80 border border-slate-700/50 rounded-xl py-2 active:opacity-70"
            >
              <Camera size={14} color="#64748b" />
              <Text className="text-slate-400 text-[10px] font-semibold mt-0.5">Add Proof</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                recalculatePayMutation.mutate(trip.id, {
                  onSuccess: () => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  },
                });
              }}
              className="flex-1 mx-1 items-center bg-slate-800/80 border border-slate-700/50 rounded-xl py-2 active:opacity-70"
            >
              <RefreshCw size={14} color={recalculatePayMutation.isPending ? '#f59e0b' : '#64748b'} />
              <Text className={`text-[10px] font-semibold mt-0.5 ${recalculatePayMutation.isPending ? 'text-amber-400' : 'text-slate-400'}`}>
                Recalculate
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveTab('pay');
              }}
              className="flex-1 mx-1 items-center bg-slate-800/80 border border-slate-700/50 rounded-xl py-2 active:opacity-70"
            >
              <BarChart2 size={14} color="#64748b" />
              <Text className="text-slate-400 text-[10px] font-semibold mt-0.5">Pay Detail</Text>
            </Pressable>
          </View>

          {/* Pickup Type Tagging Row */}
          <View className="flex-row items-center px-3 py-2 bg-slate-950 border-b border-slate-800/60">
            <Text className="text-slate-500 text-[10px] uppercase tracking-wider mr-2">Trip Type:</Text>
            {(['none', 'straight', 'ja'] as const).map((type) => {
              const isActive = (trip.pickupType ?? 'none') === type;
              const label = type === 'none' ? 'Base Line' : type === 'straight' ? 'Straight Pickup' : 'JA Pickup';
              const activeColor = type === 'none' ? '#3b82f6' : type === 'straight' ? '#22c55e' : '#f59e0b';
              const activeBg = type === 'none' ? 'rgba(59,130,246,0.15)' : type === 'straight' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)';
              return (
                <Pressable
                  key={type}
                  onPress={() => {
                    if (isActive) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    markPickupTypeMutation.mutate({ tripId: trip.id, pickupType: type });
                  }}
                  style={{
                    backgroundColor: isActive ? activeBg : 'rgba(30,41,59,0.5)',
                    borderColor: isActive ? activeColor : '#334155',
                    borderWidth: 1,
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    marginRight: 6,
                    opacity: markPickupTypeMutation.isPending ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: isActive ? activeColor : '#64748b', fontSize: 10, fontWeight: '600' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Tab Bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-b border-slate-800"
            contentContainerStyle={{ paddingHorizontal: 12 }}
            style={{ flexGrow: 0 }}
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    'flex-row items-center px-4 py-3 mr-1',
                    isActive && 'border-b-2 border-amber-500'
                  )}
                >
                  <Icon size={16} color={isActive ? '#f59e0b' : '#64748b'} />
                  <Text
                    className={cn(
                      'text-sm font-medium ml-1.5',
                      isActive ? 'text-amber-400' : 'text-slate-400'
                    )}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Tab Content */}
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
            {renderTabContent()}
          </ScrollView>
        </Animated.View>
      </View>

      {/* Edit Trip Totals Modal */}
      <EditTripTotalsModal
        visible={showEditTotals}
        onClose={() => setShowEditTotals(false)}
        trip={trip}
        onSave={handleSaveTotals}
        isSaving={updateTripMutation.isPending}
      />

      {/* Schedule Change Modal */}
      <ScheduleChangeModal
        visible={showScheduleChange}
        onClose={() => {
          setShowScheduleChange(false);
          setSelectedDutyDay(null);
        }}
        dutyDay={selectedDutyDay}
        dutyDayIndex={selectedDutyDay?.dutyDayIndex ?? 1}
        tripNumber={trip.tripNumber}
        onSave={handleScheduleChangeSave}
        isSaving={scheduleChangeMutation.isPending}
      />

      {/* Phase 4: Leg Premium Logger Modal */}
      <LegPremiumLogger
        visible={showLegPremiumLogger}
        onClose={handleLegPremiumClose}
        leg={selectedLegForPremium}
        dutyDay={selectedDutyDayForPremium}
        onSavePremium={handleSaveLegPremium}
        isSaving={updateLegPremiumMutation.isPending}
      />

      {/* Phase 5: Schedule Change Log Event Modal */}
      <ScheduleChangeLogEventModal
        visible={showLogEventModal}
        onClose={handleDiscardLogEvent}
        context={scheduleChangeContext}
        premiumSuggestions={premiumSuggestionsData?.suggestions ?? []}
        onSave={handleSaveLogEvent}
        onDiscard={handleDiscardLogEvent}
        isSaving={createLogEventMutation.isPending}
      />

      {/* Phase 6: Unified Segment Editor */}
      <SegmentEditor
        visible={showSegmentEditor}
        onClose={handleSegmentEditorClose}
        context={segmentEditorContext}
        onSave={handleSegmentEditorSave}
      />

      {/* SIK (Sick) Marking Modal */}
      <SickMarkingModal
        visible={showSickModal}
        onClose={() => setShowSickModal(false)}
        trip={trip}
        onSuccess={() => {
          // Refetch sick info after marking sick
        }}
      />
    </Modal>
  );
}
