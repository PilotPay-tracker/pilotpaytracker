/**
 * Sick Marking Modal Component
 * Allows users to mark trips/days/legs as SIK (Sick)
 * Shows schedule view with times and credit hours
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import {
  X,
  Heart,
  Calendar,
  Clock,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import type { BackendTrip, BackendTripDutyDay } from '@/lib/useTripsData';
import { formatMinutesToTime } from '@/lib/useTripsData';
import { useMarkSick, useTripSickInfo } from '@/lib/useSickTracking';
import { useSickBank, sickTrackerKeys } from '@/lib/useSickTimeTracker';
import { useQueryClient } from '@tanstack/react-query';

// ============================================
// Types
// ============================================

interface SickMarkingModalProps {
  visible: boolean;
  onClose: () => void;
  trip: BackendTrip;
  onSuccess?: () => void;
}

type ScopeType = 'entire_trip' | 'day' | 'legs';

interface LegOption {
  id: string;
  dutyDayId: string;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  creditMinutes: number;
  dateLocal: string;
  legIndex: number;
  isCompleted: boolean;
}

interface DayOption {
  id: string;
  dutyDayIndex: number;
  dutyDate: string;
  creditMinutes: number;
  legCount: number;
  legs: LegOption[];
}

// ============================================
// Helper Functions
// ============================================

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getDayCode(dateStr: string, index: number): string {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const dayName = dayNames[date.getDay()];
    return `${dayName}${String(index + 1).padStart(2, '0')}`;
  } catch {
    return `D${index + 1}`;
  }
}

function isTripInProgress(trip: BackendTrip): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return trip.startDate <= today && trip.endDate >= today;
}

function isTripNotStarted(trip: BackendTrip): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return trip.startDate > today;
}

// ============================================
// Main Component
// ============================================

export function SickMarkingModal({
  visible,
  onClose,
  trip,
  onSuccess,
}: SickMarkingModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const markSickMutation = useMarkSick();
  const { data: sickInfo } = useTripSickInfo(visible ? trip.id : null);
  const { data: sickBank } = useSickBank();

  // State
  const [scope, setScope] = useState<ScopeType>('entire_trip');
  const [selectedDayIds, setSelectedDayIds] = useState<string[]>([]);
  const [selectedLegIds, setSelectedLegIds] = useState<string[]>([]);
  const [userNotes, setUserNotes] = useState('');
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [showCompletedWarning, setShowCompletedWarning] = useState(false);
  const [confirmedCompletedLegs, setConfirmedCompletedLegs] = useState(false);

  // Build day and leg options from trip data
  const { dayOptions, legOptions } = useMemo(() => {
    const days: DayOption[] = [];
    const legs: LegOption[] = [];

    const dutyDays = trip.tripDutyDays || [];
    dutyDays.forEach((dd, idx) => {
      const dayLegs: LegOption[] = [];

      (dd.legs || []).forEach((leg, legIdx) => {
        const legOpt: LegOption = {
          id: leg.id,
          dutyDayId: dd.id,
          flightNumber: leg.flightNumber,
          origin: leg.origin,
          destination: leg.destination,
          creditMinutes: leg.creditMinutes,
          dateLocal: dd.dutyDate,
          legIndex: legIdx,
          isCompleted: !!(leg.actualInISO), // Has actual arrival = completed
        };
        dayLegs.push(legOpt);
        legs.push(legOpt);
      });

      days.push({
        id: dd.id,
        dutyDayIndex: dd.dutyDayIndex,
        dutyDate: dd.dutyDate,
        creditMinutes: dd.creditMinutes,
        legCount: dayLegs.length,
        legs: dayLegs,
      });
    });

    return { dayOptions: days, legOptions: legs };
  }, [trip]);

  // Default selection logic
  useEffect(() => {
    if (!visible) return;

    const today = new Date().toISOString().slice(0, 10);

    if (isTripNotStarted(trip)) {
      // Trip hasn't started: default to entire trip
      setScope('entire_trip');
      setSelectedDayIds([]);
      setSelectedLegIds([]);
    } else if (isTripInProgress(trip)) {
      // Trip in progress: default to today + future legs
      setScope('legs');
      const todayAndFutureLegs = legOptions.filter(l => l.dateLocal >= today);
      setSelectedLegIds(todayAndFutureLegs.map(l => l.id));
      setSelectedDayIds([]);
    } else {
      // Trip completed: user must pick manually
      setScope('legs');
      setSelectedDayIds([]);
      setSelectedLegIds([]);
    }

    setUserNotes('');
    setConfirmedCompletedLegs(false);
    setExpandedDays([]);
  }, [visible, trip, legOptions]);

  // Check for completed legs in selection
  const hasCompletedLegsSelected = useMemo(() => {
    if (scope === 'entire_trip') {
      return legOptions.some(l => l.isCompleted);
    } else if (scope === 'day') {
      const selectedLegs = legOptions.filter(l => selectedDayIds.includes(l.dutyDayId));
      return selectedLegs.some(l => l.isCompleted);
    } else {
      return legOptions.filter(l => selectedLegIds.includes(l.id)).some(l => l.isCompleted);
    }
  }, [scope, selectedDayIds, selectedLegIds, legOptions]);

  // Calculate credit summary
  const selectedCreditMinutes = useMemo(() => {
    if (scope === 'entire_trip') {
      return trip.totalCreditMinutes;
    } else if (scope === 'day') {
      return dayOptions
        .filter(d => selectedDayIds.includes(d.id))
        .reduce((sum, d) => sum + d.creditMinutes, 0);
    } else {
      return legOptions
        .filter(l => selectedLegIds.includes(l.id))
        .reduce((sum, l) => sum + l.creditMinutes, 0);
    }
  }, [scope, selectedDayIds, selectedLegIds, trip, dayOptions, legOptions]);

  // Handlers
  const toggleDaySelection = useCallback((dayId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDayIds(prev =>
      prev.includes(dayId) ? prev.filter(id => id !== dayId) : [...prev, dayId]
    );
  }, []);

  const toggleLegSelection = useCallback((legId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLegIds(prev =>
      prev.includes(legId) ? prev.filter(id => id !== legId) : [...prev, legId]
    );
  }, []);

  const toggleDayExpanded = useCallback((dayId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedDays(prev =>
      prev.includes(dayId) ? prev.filter(id => id !== dayId) : [...prev, dayId]
    );
  }, []);

  const selectAllLegsInDay = useCallback((dayId: string) => {
    const day = dayOptions.find(d => d.id === dayId);
    if (!day) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLegIds(prev => {
      const dayLegIds = day.legs.map(l => l.id);
      const allSelected = dayLegIds.every(id => prev.includes(id));
      if (allSelected) {
        return prev.filter(id => !dayLegIds.includes(id));
      } else {
        return [...new Set([...prev, ...dayLegIds])];
      }
    });
  }, [dayOptions]);

  const handleSubmit = useCallback(async () => {
    // Check for completed legs warning
    if (hasCompletedLegsSelected && !confirmedCompletedLegs) {
      setShowCompletedWarning(true);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await markSickMutation.mutateAsync({
        tripId: trip.id,
        scope,
        dutyDayIds: scope === 'day' ? selectedDayIds : undefined,
        legIds: scope === 'legs' ? selectedLegIds : undefined,
        userNotes: userNotes.trim() || undefined,
      });

      // Invalidate sick bank queries to reflect the deduction
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.bank() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.summary() });
      queryClient.invalidateQueries({ queryKey: sickTrackerKeys.usage() });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('[SickMarking] Error marking sick:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [
    scope,
    selectedDayIds,
    selectedLegIds,
    userNotes,
    trip.id,
    hasCompletedLegsSelected,
    confirmedCompletedLegs,
    markSickMutation,
    queryClient,
    onSuccess,
    onClose,
  ]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const canSubmit = useMemo(() => {
    if (scope === 'entire_trip') return true;
    if (scope === 'day') return selectedDayIds.length > 0;
    return selectedLegIds.length > 0;
  }, [scope, selectedDayIds, selectedLegIds]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/70">
        <Animated.View
          entering={SlideInDown.duration(300)}
          className="flex-1 bg-slate-950 mt-16 rounded-t-3xl overflow-hidden"
          style={{ paddingBottom: insets.bottom }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className="w-12 h-12 rounded-xl bg-red-500/20 items-center justify-center">
                <Heart size={24} color="#ef4444" fill="white" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-white font-bold text-xl">Mark Sick (SIK)</Text>
                <Text className="text-slate-400 text-sm">
                  Trip {trip.tripNumber || 'Unknown'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Scope Selection */}
            <View className="mb-6">
              <Text className="text-slate-400 text-sm font-medium mb-3">Apply Sick To:</Text>
              <View className="flex-row flex-wrap gap-2">
                {/* Entire Trip */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setScope('entire_trip');
                  }}
                  className={cn(
                    'flex-row items-center px-4 py-2.5 rounded-xl border',
                    scope === 'entire_trip'
                      ? 'bg-red-500/20 border-red-500/40'
                      : 'bg-slate-800/60 border-slate-700'
                  )}
                >
                  <Calendar size={16} color={scope === 'entire_trip' ? '#ef4444' : '#64748b'} />
                  <Text
                    className={cn(
                      'ml-2 font-medium',
                      scope === 'entire_trip' ? 'text-red-400' : 'text-slate-300'
                    )}
                  >
                    Entire Trip
                  </Text>
                </Pressable>

                {/* Specific Days */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setScope('day');
                  }}
                  className={cn(
                    'flex-row items-center px-4 py-2.5 rounded-xl border',
                    scope === 'day'
                      ? 'bg-red-500/20 border-red-500/40'
                      : 'bg-slate-800/60 border-slate-700'
                  )}
                >
                  <Calendar size={16} color={scope === 'day' ? '#ef4444' : '#64748b'} />
                  <Text
                    className={cn(
                      'ml-2 font-medium',
                      scope === 'day' ? 'text-red-400' : 'text-slate-300'
                    )}
                  >
                    Specific Day(s)
                  </Text>
                </Pressable>

                {/* Specific Legs */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setScope('legs');
                  }}
                  className={cn(
                    'flex-row items-center px-4 py-2.5 rounded-xl border',
                    scope === 'legs'
                      ? 'bg-red-500/20 border-red-500/40'
                      : 'bg-slate-800/60 border-slate-700'
                  )}
                >
                  <Clock size={16} color={scope === 'legs' ? '#ef4444' : '#64748b'} />
                  <Text
                    className={cn(
                      'ml-2 font-medium',
                      scope === 'legs' ? 'text-red-400' : 'text-slate-300'
                    )}
                  >
                    Specific Leg(s)
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Day/Leg Selection */}
            {scope === 'day' && (
              <View className="mb-6">
                <Text className="text-slate-400 text-sm font-medium mb-3">Select Days:</Text>
                {dayOptions.map(day => (
                  <Pressable
                    key={day.id}
                    onPress={() => toggleDaySelection(day.id)}
                    className={cn(
                      'flex-row items-center p-3 rounded-xl border mb-2',
                      selectedDayIds.includes(day.id)
                        ? 'bg-red-500/20 border-red-500/40'
                        : 'bg-slate-800/60 border-slate-700'
                    )}
                  >
                    <View
                      className={cn(
                        'w-6 h-6 rounded-md items-center justify-center mr-3',
                        selectedDayIds.includes(day.id) ? 'bg-red-500' : 'bg-slate-700'
                      )}
                    >
                      {selectedDayIds.includes(day.id) && <Check size={14} color="white" />}
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center">
                        <Text className="text-white font-bold">
                          {getDayCode(day.dutyDate, day.dutyDayIndex)}
                        </Text>
                        <Text className="text-slate-400 ml-2">{formatDate(day.dutyDate)}</Text>
                      </View>
                      <Text className="text-slate-500 text-sm">
                        {day.legCount} leg{day.legCount !== 1 ? 's' : ''} • {formatMinutesToTime(day.creditMinutes)} credit
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {scope === 'legs' && (
              <View className="mb-6">
                <Text className="text-slate-400 text-sm font-medium mb-3">Select Legs:</Text>
                {dayOptions.map(day => {
                  const isExpanded = expandedDays.includes(day.id);
                  const dayLegIds = day.legs.map(l => l.id);
                  const selectedCount = dayLegIds.filter(id => selectedLegIds.includes(id)).length;
                  const allSelected = selectedCount === day.legs.length && day.legs.length > 0;

                  return (
                    <View key={day.id} className="mb-3">
                      {/* Day Header */}
                      <View className="flex-row items-center">
                        <Pressable
                          onPress={() => selectAllLegsInDay(day.id)}
                          className={cn(
                            'flex-row items-center flex-1 p-3 rounded-xl border',
                            allSelected
                              ? 'bg-red-500/20 border-red-500/40'
                              : 'bg-slate-800/60 border-slate-700'
                          )}
                        >
                          <View
                            className={cn(
                              'w-6 h-6 rounded-md items-center justify-center mr-3',
                              allSelected ? 'bg-red-500' : 'bg-slate-700'
                            )}
                          >
                            {allSelected && <Check size={14} color="white" />}
                          </View>
                          <View className="flex-1">
                            <View className="flex-row items-center">
                              <Text className="text-white font-bold">
                                {getDayCode(day.dutyDate, day.dutyDayIndex)}
                              </Text>
                              <Text className="text-slate-400 ml-2 text-sm">
                                {formatDate(day.dutyDate)}
                              </Text>
                              {selectedCount > 0 && selectedCount < day.legs.length && (
                                <View className="bg-amber-500/20 px-1.5 py-0.5 rounded ml-2">
                                  <Text className="text-amber-400 text-[10px] font-bold">
                                    {selectedCount}/{day.legs.length}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => toggleDayExpanded(day.id)}
                          className="w-10 h-10 items-center justify-center ml-2"
                        >
                          {isExpanded ? (
                            <ChevronUp size={20} color="#64748b" />
                          ) : (
                            <ChevronDown size={20} color="#64748b" />
                          )}
                        </Pressable>
                      </View>

                      {/* Expanded Legs */}
                      {isExpanded && (
                        <View className="ml-4 mt-2 border-l border-slate-700 pl-3">
                          {day.legs.map(leg => (
                            <Pressable
                              key={leg.id}
                              onPress={() => toggleLegSelection(leg.id)}
                              className={cn(
                                'flex-row items-center p-2.5 rounded-lg mb-1.5',
                                selectedLegIds.includes(leg.id)
                                  ? 'bg-red-500/15'
                                  : 'bg-slate-800/40'
                              )}
                            >
                              <View
                                className={cn(
                                  'w-5 h-5 rounded items-center justify-center mr-2.5',
                                  selectedLegIds.includes(leg.id) ? 'bg-red-500' : 'bg-slate-700'
                                )}
                              >
                                {selectedLegIds.includes(leg.id) && (
                                  <Check size={12} color="white" />
                                )}
                              </View>
                              <View className="flex-1">
                                <Text className="text-white text-sm">
                                  {leg.origin || '?'} → {leg.destination || '?'}
                                  {leg.flightNumber && (
                                    <Text className="text-slate-400"> • FLT {leg.flightNumber}</Text>
                                  )}
                                </Text>
                                <Text className="text-slate-500 text-xs">
                                  {formatMinutesToTime(leg.creditMinutes)} credit
                                  {leg.isCompleted && (
                                    <Text className="text-amber-400"> • Completed</Text>
                                  )}
                                </Text>
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Credit Summary with Bank Deduction Preview */}
            <View className="bg-slate-800/60 rounded-xl p-4 mb-6">
              <Text className="text-slate-400 text-sm font-medium mb-3">Credit & Bank Summary</Text>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-white">Sick Credit:</Text>
                <Text className="text-red-400 font-bold text-lg">
                  {formatMinutesToTime(selectedCreditMinutes)}
                </Text>
              </View>

              {/* Sick Bank Deduction Preview */}
              {sickBank && (
                <View className="border-t border-slate-700 pt-3 mt-2">
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-slate-400 text-sm">Current Bank Balance:</Text>
                    <Text className="text-white font-medium">
                      {sickBank.balanceHours.toFixed(1)} hrs
                    </Text>
                  </View>
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-slate-400 text-sm">Hours to Deduct:</Text>
                    <Text className="text-amber-400 font-medium">
                      -{(selectedCreditMinutes / 60).toFixed(1)} hrs
                    </Text>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-slate-400 text-sm">Balance After:</Text>
                    <Text className={cn(
                      'font-bold',
                      Math.max(0, sickBank.balanceHours - selectedCreditMinutes / 60) <= 0
                        ? 'text-red-400'
                        : 'text-emerald-400'
                    )}>
                      {Math.max(0, sickBank.balanceHours - selectedCreditMinutes / 60).toFixed(1)} hrs
                    </Text>
                  </View>

                  {/* Warning if not enough hours */}
                  {sickBank.balanceHours < selectedCreditMinutes / 60 && (
                    <View className="flex-row items-center mt-3 bg-amber-500/10 rounded-lg p-2">
                      <AlertTriangle size={14} color="#f59e0b" />
                      <Text className="text-amber-400 text-xs ml-2 flex-1">
                        Partial coverage — only {sickBank.balanceHours.toFixed(1)} hrs available in bank
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Notes Input */}
            <View className="mb-6">
              <Text className="text-slate-400 text-sm font-medium mb-2">Notes (Optional)</Text>
              <TextInput
                value={userNotes}
                onChangeText={setUserNotes}
                placeholder="Add any notes about this sick call..."
                placeholderTextColor="#64748b"
                multiline
                className="bg-slate-800/60 rounded-xl p-4 text-white min-h-[80px]"
                textAlignVertical="top"
              />
            </View>

            {/* Disclaimer */}
            <View className="flex-row items-start bg-slate-800/40 rounded-xl p-3 mb-4">
              <Info size={16} color="#64748b" style={{ marginTop: 2 }} />
              <Text className="text-slate-500 text-xs flex-1 ml-2">
                This is a personal historical record based on logged events. It does not
                represent an official sick bank, balance, or employer record.
              </Text>
            </View>
          </ScrollView>

          {/* Bottom Action Bar */}
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-800 p-4"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleClose}
                className="flex-1 py-3.5 rounded-xl bg-slate-800 items-center active:opacity-70"
              >
                <Text className="text-slate-300 font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit || markSickMutation.isPending}
                className={cn(
                  'flex-1 py-3.5 rounded-xl items-center flex-row justify-center',
                  canSubmit && !markSickMutation.isPending
                    ? 'bg-red-500 active:bg-red-600'
                    : 'bg-slate-700'
                )}
              >
                {markSickMutation.isPending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Heart size={18} color="white" fill="white" style={{ marginRight: 8 }} />
                    <Text className="text-white font-semibold">Mark SIK</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Completed Legs Warning Modal */}
      <Modal
        visible={showCompletedWarning}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCompletedWarning(false)}
      >
        <View className="flex-1 bg-black/80 items-center justify-center p-4">
          <Animated.View
            entering={FadeIn.duration(200)}
            className="bg-slate-900 rounded-2xl p-5 w-full max-w-sm"
          >
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full bg-amber-500/20 items-center justify-center mb-3">
                <AlertTriangle size={28} color="#f59e0b" />
              </View>
              <Text className="text-white font-bold text-lg text-center">Completed Leg Warning</Text>
            </View>
            <Text className="text-slate-400 text-center mb-6">
              One or more selected legs appear to be completed (have actual arrival times). Mark
              as sick anyway?
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setShowCompletedWarning(false)}
                className="flex-1 py-3 rounded-xl bg-slate-800 items-center"
              >
                <Text className="text-slate-300 font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setShowCompletedWarning(false);
                  setConfirmedCompletedLegs(true);
                  handleSubmit();
                }}
                className="flex-1 py-3 rounded-xl bg-amber-500 items-center"
              >
                <Text className="text-white font-semibold">Continue</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </Modal>
  );
}
