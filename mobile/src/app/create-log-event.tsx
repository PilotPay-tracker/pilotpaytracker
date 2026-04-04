/**
 * PHASE 7 — CREATE LOG EVENT SCREEN
 *
 * One-tap Log Event creation with:
 * - Premium code chips (auto-selectable)
 * - Fixed premium auto-calculation (+HH:MM)
 * - Multiplier premium calculator (LP1, LP2, RJA)
 * - Auto-attached screenshots
 * - Audit-ready documentation
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  X,
  Shield,
  Clock,
  DollarSign,
  Plus,
  Minus,
  FileText,
  Camera,
  Image,
  CheckCircle2,
  Info,
  AlertTriangle,
  Plane,
  Calculator,
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, FadeInRight } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useTrip, useTrips, type BackendTrip, type BackendLeg } from '@/lib/useTripsData';
import { useHourlyRateCents } from '@/lib/state/profile-store';

// ============================================
// TYPES
// ============================================

interface PremiumCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  eligibilityText: string | null;
  premiumType: 'fixed_minutes' | 'multiplier';
  premiumMinutes: number | null;
  premiumMultiplier: number | null;
  contractRef: string | null;
  notes: string | null;
  hasVariants: boolean;
  variantDescription: string | null;
  variantMinutes: number | null;
}

interface SelectedPremium {
  code: PremiumCode;
  minutes: number; // For fixed premiums
  useVariant: boolean;
  // For multiplier premiums
  scheduledEndTime?: string;
  actualArrivalTime?: string;
  calculatedPremium?: number;
}

// ============================================
// HOOKS
// ============================================

function usePremiumCodes() {
  return useQuery({
    queryKey: ['premium-codes'],
    queryFn: async () => {
      const response = await api.get('/api/premium-codes');
      return response as { premiumCodes: PremiumCode[] };
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

function useSuggestPremiums(changeType: string | undefined) {
  return useQuery({
    queryKey: ['premium-suggestions', changeType],
    queryFn: async () => {
      if (!changeType) return { suggestions: [] };
      const response = await api.post('/api/premium-codes/suggest', {
        changeType,
      });
      return response as {
        suggestions: Array<{
          code: string;
          name: string;
          confidence: 'high' | 'medium' | 'low';
          reason: string;
          premiumMinutes: number | null;
        }>;
      };
    },
    enabled: !!changeType,
  });
}

// ============================================
// HELPERS
// ============================================

function formatMinutesToTime(minutes: number): string {
  if (!minutes || minutes <= 0) return '0:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

function formatCentsToCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ============================================
// COMPONENTS
// ============================================

/**
 * Premium Code Row - Full-width selectable row with name and value
 */
function PremiumCodeRow({
  code,
  isSelected,
  onPress,
  hourlyRateCents,
}: {
  code: PremiumCode;
  isSelected: boolean;
  onPress: () => void;
  hourlyRateCents: number;
}) {
  const isFixed = code.premiumType === 'fixed_minutes';
  const hasMinutes = code.premiumMinutes && code.premiumMinutes > 0;
  const estimatedPayCents = hasMinutes
    ? Math.round((code.premiumMinutes! / 60) * hourlyRateCents)
    : 0;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 6,
        borderRadius: 12,
        backgroundColor: isSelected ? 'rgba(16,185,129,0.12)' : 'rgba(30,41,59,0.6)',
        borderWidth: isSelected ? 1.5 : 1,
        borderColor: isSelected ? '#10b981' : 'rgba(51,65,85,0.5)',
      }}
    >
      {/* Code badge */}
      <View
        style={{
          backgroundColor: isSelected ? 'rgba(16,185,129,0.2)' : 'rgba(51,65,85,0.8)',
          borderRadius: 6,
          paddingHorizontal: 7,
          paddingVertical: 3,
          marginRight: 12,
          minWidth: 42,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: isSelected ? '#10b981' : '#94a3b8',
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.5,
          }}
        >
          {code.code}
        </Text>
      </View>

      {/* Name */}
      <Text
        style={{
          flex: 1,
          color: isSelected ? '#f1f5f9' : '#cbd5e1',
          fontSize: 14,
          fontWeight: isSelected ? '600' : '400',
        }}
        numberOfLines={2}
      >
        {code.name}
      </Text>

      {/* Value */}
      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
        {isFixed && hasMinutes ? (
          <>
            <Text style={{ color: isSelected ? '#34d399' : '#10b981', fontSize: 13, fontWeight: '700' }}>
              +{formatMinutesToTime(code.premiumMinutes!)}
            </Text>
            <Text style={{ color: '#64748b', fontSize: 10 }}>
              ≈{formatCentsToCurrency(estimatedPayCents)}
            </Text>
          </>
        ) : (
          <Text style={{ color: isSelected ? '#fbbf24' : '#f59e0b', fontSize: 13, fontWeight: '700' }}>
            {code.premiumMultiplier}x
          </Text>
        )}
      </View>

      {/* Checkmark */}
      {isSelected && (
        <View style={{ marginLeft: 10 }}>
          <CheckCircle2 size={18} color="#10b981" />
        </View>
      )}
    </Pressable>
  );
}

/**
 * Late Arrival Calculator - For LP1, LP2, RJA multiplier premiums
 */
function LateArrivalCalculator({
  code,
  hourlyRateCents,
  onCalculate,
}: {
  code: PremiumCode;
  hourlyRateCents: number;
  onCalculate: (minutes: number, payCents: number) => void;
}) {
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [actualArrival, setActualArrival] = useState('');
  const [calculation, setCalculation] = useState<{
    lateMinutes: number;
    basePayCents: number;
    premiumPayCents: number;
    totalPayCents: number;
  } | null>(null);

  const handleCalculate = () => {
    if (!scheduledEnd || !actualArrival) return;

    // Parse times (HH:MM format)
    const [schedHours, schedMins] = scheduledEnd.split(':').map(Number);
    const [actualHours, actualMins] = actualArrival.split(':').map(Number);

    // Calculate late minutes (simple same-day calculation)
    let lateMinutes = (actualHours * 60 + actualMins) - (schedHours * 60 + schedMins);

    // Handle next-day arrival
    if (lateMinutes < 0) {
      lateMinutes += 24 * 60; // Add 24 hours
    }

    // Calculate pay
    const multiplier = code.premiumMultiplier ?? 1.5;
    const basePayCents = Math.round((lateMinutes / 60) * hourlyRateCents);
    const premiumPayCents = Math.round(basePayCents * (multiplier - 1));
    const totalPayCents = basePayCents + premiumPayCents;

    setCalculation({
      lateMinutes,
      basePayCents,
      premiumPayCents,
      totalPayCents,
    });

    onCalculate(lateMinutes, premiumPayCents);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mt-4"
    >
      <View className="flex-row items-center mb-3">
        <Calculator size={18} color="#f59e0b" />
        <Text className="text-amber-400 text-sm font-semibold ml-2">
          Late Arrival Calculator — {code.code}
        </Text>
      </View>

      <Text className="text-slate-400 text-xs mb-3">
        {code.name} • {code.premiumMultiplier}x multiplier
      </Text>

      <View className="flex-row mb-3">
        <View className="flex-1 mr-2">
          <Text className="text-slate-400 text-xs mb-1">Scheduled End</Text>
          <TextInput
            value={scheduledEnd}
            onChangeText={setScheduledEnd}
            placeholder="HH:MM"
            placeholderTextColor="#64748b"
            className="bg-slate-800/60 rounded-lg px-3 py-2 text-white text-center"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View className="flex-1 ml-2">
          <Text className="text-slate-400 text-xs mb-1">Actual Arrival</Text>
          <TextInput
            value={actualArrival}
            onChangeText={setActualArrival}
            placeholder="HH:MM"
            placeholderTextColor="#64748b"
            className="bg-slate-800/60 rounded-lg px-3 py-2 text-white text-center"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>

      <Pressable
        onPress={handleCalculate}
        disabled={!scheduledEnd || !actualArrival}
        className={`rounded-xl py-3 items-center ${
          scheduledEnd && actualArrival
            ? 'bg-amber-500 active:bg-amber-600'
            : 'bg-slate-700'
        }`}
      >
        <Text className={`font-semibold ${scheduledEnd && actualArrival ? 'text-slate-900' : 'text-slate-500'}`}>
          Calculate Premium
        </Text>
      </Pressable>

      {calculation && (
        <View className="mt-4 bg-slate-900/50 rounded-lg p-3">
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-400 text-sm">Late Time</Text>
            <Text className="text-white font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
              {formatMinutesToTime(calculation.lateMinutes)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-400 text-sm">Base Pay</Text>
            <Text className="text-white">{formatCentsToCurrency(calculation.basePayCents)}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-slate-400 text-sm">Premium ({code.premiumMultiplier}x - 1)</Text>
            <Text className="text-emerald-400 font-bold">{formatCentsToCurrency(calculation.premiumPayCents)}</Text>
          </View>
          <View className="h-px bg-slate-700 my-2" />
          <View className="flex-row justify-between">
            <Text className="text-emerald-400 text-sm font-semibold">Total Pay</Text>
            <Text className="text-emerald-400 font-bold">{formatCentsToCurrency(calculation.totalPayCents)}</Text>
          </View>
          {code.contractRef && (
            <Text className="text-slate-500 text-xs mt-2">Contract: {code.contractRef}</Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}

/**
 * Credit Impact Display
 */
function CreditImpactDisplay({
  premiumMinutes,
  hourlyRateCents,
}: {
  premiumMinutes: number;
  hourlyRateCents: number;
}) {
  const premiumPayCents = Math.round((premiumMinutes / 60) * hourlyRateCents);

  return (
    <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Shield size={18} color="#10b981" />
          <Text className="text-emerald-400 text-sm font-semibold ml-2">Premium Credit</Text>
        </View>
        <View className="items-end">
          <Text
            className="text-emerald-400 text-xl font-bold"
            style={{ fontFamily: 'JetBrainsMono_400Regular' }}
          >
            +{formatMinutesToTime(premiumMinutes)}
          </Text>
          <Text className="text-emerald-400/70 text-xs">
            ≈ {formatCentsToCurrency(premiumPayCents)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ============================================
// TRIP PICKER MODAL
// ============================================

function TripPickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (title: string) => void;
}) {
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Load all trips for a wide window so the pilot sees their full schedule
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString().split('T')[0]!;
  const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0)
    .toISOString().split('T')[0]!;

  const { data: tripsData, isLoading } = useTrips({ startDate, endDate });
  const trips = tripsData?.trips ?? [];

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return trips;
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if ((t.tripNumber ?? '').toLowerCase().includes(q)) return true;
      // also match any flight number in the trip
      return t.dutyDays?.some((d) =>
        d.legs?.some(
          (l) =>
            (l.flightNumber ?? '').toLowerCase().includes(q) ||
            (l.origin ?? '').toLowerCase().includes(q) ||
            (l.destination ?? '').toLowerCase().includes(q)
        )
      );
    });
  }, [trips, search]);

  const handleSelectTrip = useCallback(
    (trip: BackendTrip) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const tripNum = trip.tripNumber ?? 'Trip';
      // Build a compact route summary from first + last leg
      const allLegs: BackendLeg[] =
        trip.dutyDays?.flatMap((d) => d.legs ?? []) ?? [];
      const first = allLegs[0];
      const last = allLegs[allLegs.length - 1];
      let route = '';
      if (first?.origin && last?.destination) {
        route = ` ${first.origin}–${last.destination}`;
      }
      onSelect(`${tripNum}${route}`);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleSelectLeg = useCallback(
    (trip: BackendTrip, leg: BackendLeg) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const tripNum = trip.tripNumber ?? 'Trip';
      const flt = leg.flightNumber ? `Flt ${leg.flightNumber}` : '';
      const route =
        leg.origin && leg.destination ? `${leg.origin}–${leg.destination}` : '';
      const parts = [tripNum, flt, route].filter(Boolean);
      onSelect(parts.join(' — '));
      onClose();
    },
    [onSelect, onClose]
  );

  // Format a duty date nicely
  const fmtDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-slate-900 rounded-t-3xl" style={{ maxHeight: '85%' }}>
          {/* Handle */}
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 rounded-full bg-slate-600" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 py-3">
            <Text className="text-white text-lg font-bold">Select Trip or Leg</Text>
            <Pressable
              onPress={onClose}
              className="w-8 h-8 items-center justify-center rounded-full bg-slate-800 active:opacity-70"
            >
              <X size={16} color="#94a3b8" />
            </Pressable>
          </View>

          {/* Search */}
          <View className="mx-5 mb-3 flex-row items-center bg-slate-800/80 rounded-xl px-3 border border-slate-700/50">
            <Search size={15} color="#64748b" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search trip # or flight..."
              placeholderTextColor="#475569"
              className="flex-1 text-white text-sm py-2.5 pl-2"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <X size={14} color="#64748b" />
              </Pressable>
            )}
          </View>

          {/* Trip list */}
          {isLoading ? (
            <View className="items-center py-12">
              <ActivityIndicator color="#10b981" />
              <Text className="text-slate-400 text-sm mt-3">Loading trips...</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View className="items-center py-12 px-6">
              <Plane size={36} color="#334155" />
              <Text className="text-slate-500 text-sm mt-3 text-center">
                No trips found. Add trips in the Trips tab first.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(t) => t.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: trip }) => {
                const isExpanded = expandedTripId === trip.id;
                const allLegs: BackendLeg[] =
                  trip.dutyDays?.flatMap((d) => d.legs ?? []) ?? [];
                const firstDate = trip.dutyDays?.[0]?.dutyDate;
                const lastDate = trip.dutyDays?.[trip.dutyDays.length - 1]?.dutyDate;
                const dateRange =
                  firstDate && lastDate
                    ? firstDate === lastDate
                      ? fmtDate(firstDate)
                      : `${fmtDate(firstDate)} – ${fmtDate(lastDate)}`
                    : '';
                const firstLeg = allLegs[0];
                const lastLeg = allLegs[allLegs.length - 1];
                const routeSummary =
                  firstLeg?.origin && lastLeg?.destination
                    ? `${firstLeg.origin} → ${lastLeg.destination}`
                    : '';

                return (
                  <View className="mb-2">
                    {/* Trip row */}
                    <Pressable
                      className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden active:opacity-80"
                      onPress={() => handleSelectTrip(trip)}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setExpandedTripId(isExpanded ? null : trip.id);
                      }}
                    >
                      <View className="flex-row items-center px-4 py-3">
                        {/* Trip number badge */}
                        <View className="bg-slate-700 rounded-lg px-2.5 py-1 mr-3">
                          <Text className="text-white font-bold text-sm">
                            {trip.tripNumber ?? '—'}
                          </Text>
                        </View>

                        {/* Trip info */}
                        <View className="flex-1">
                          <Text className="text-white font-semibold text-sm">
                            {routeSummary || 'Multi-leg trip'}
                          </Text>
                          {dateRange ? (
                            <Text className="text-slate-400 text-xs mt-0.5">{dateRange}</Text>
                          ) : null}
                        </View>

                        {/* Leg count + expand hint */}
                        <View className="flex-row items-center gap-2">
                          {allLegs.length > 0 && (
                            <View className="bg-emerald-500/15 rounded-full px-2 py-0.5">
                              <Text className="text-emerald-400 text-xs font-medium">
                                {allLegs.length} leg{allLegs.length !== 1 ? 's' : ''}
                              </Text>
                            </View>
                          )}
                          <Pressable
                            onPress={() =>
                              setExpandedTripId(isExpanded ? null : trip.id)
                            }
                            hitSlop={12}
                            className="active:opacity-60"
                          >
                            {isExpanded ? (
                              <ChevronDown size={16} color="#64748b" />
                            ) : (
                              <ChevronRight size={16} color="#64748b" />
                            )}
                          </Pressable>
                        </View>
                      </View>

                      {/* Leg rows (expanded) */}
                      {isExpanded && allLegs.length > 0 && (
                        <View className="border-t border-slate-700/50">
                          {allLegs.map((leg, idx) => {
                            const isDH = leg.isDeadhead;
                            return (
                              <Pressable
                                key={leg.id}
                                onPress={() => handleSelectLeg(trip, leg)}
                                className={`flex-row items-center px-4 py-2.5 active:opacity-70 ${
                                  idx < allLegs.length - 1
                                    ? 'border-b border-slate-700/30'
                                    : ''
                                }`}
                                style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
                              >
                                {/* Flight number */}
                                <View
                                  className={`rounded px-2 py-0.5 mr-3 ${
                                    isDH ? 'bg-orange-500/20' : 'bg-sky-500/20'
                                  }`}
                                >
                                  <Text
                                    className={`text-xs font-bold ${
                                      isDH ? 'text-orange-400' : 'text-sky-400'
                                    }`}
                                  >
                                    {isDH ? 'DH' : leg.flightNumber ?? '—'}
                                  </Text>
                                </View>

                                {/* Route */}
                                <Text className="text-white text-sm font-medium flex-1">
                                  {leg.origin ?? '?'} → {leg.destination ?? '?'}
                                </Text>

                                {/* Equipment */}
                                {leg.equipment && (
                                  <Text className="text-slate-500 text-xs mr-2">
                                    {leg.equipment}
                                  </Text>
                                )}

                                <ChevronRight size={13} color="#475569" />
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </Pressable>

                    {/* Hint text */}
                    {!isExpanded && allLegs.length > 0 && (
                      <Text className="text-slate-600 text-xs ml-1 mt-1">
                        Tap to use trip · expand for individual legs
                      </Text>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function CreateLogEventScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    tripId?: string;
    changeType?: string;
    screenshotUris?: string;
    // Trip context for prefill
    tripNumber?: string;
    tripStartDate?: string;
    tripEndDate?: string;
    dutyDayDate?: string;
    aircraftType?: string;
    position?: string;
    // Premium code preselect
    preselectedCode?: string;
    preselectedMultiplier?: string;
  }>();

  const hourlyRateCents = useHourlyRateCents();

  // Fetch trip data if tripId provided
  const { data: tripData, isLoading: tripLoading } = useTrip(params.tripId ?? null);
  const trip = tripData?.trip;

  // Fetch premium codes
  const { data: codesData, isLoading: codesLoading } = usePremiumCodes();
  const premiumCodes = codesData?.premiumCodes ?? [];

  // Get suggestions based on change type
  const { data: suggestionsData } = useSuggestPremiums(params.changeType);
  const suggestions = suggestionsData?.suggestions ?? [];

  // Form state
  const [selectedCodes, setSelectedCodes] = useState<SelectedPremium[]>([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tripPickerVisible, setTripPickerVisible] = useState(false);

  // Parse screenshot URIs from params
  const screenshotUris = useMemo(() => {
    if (!params.screenshotUris) return [];
    try {
      return JSON.parse(params.screenshotUris) as string[];
    } catch {
      return [];
    }
  }, [params.screenshotUris]);

  // Auto-generate title based on trip and change type
  useEffect(() => {
    if (trip && !title) {
      const tripNumber = trip.tripNumber || 'Trip';
      const changeDesc = params.changeType?.replace(/_/g, ' ') || 'Schedule Change';
      setTitle(`${tripNumber} — ${changeDesc}`);
    }
  }, [trip, params.changeType, title]);

  // Auto-select preselected premium code from params
  useEffect(() => {
    if (params.preselectedCode && premiumCodes.length > 0 && selectedCodes.length === 0) {
      const targetCode = premiumCodes.find(c => c.code === params.preselectedCode);
      if (targetCode) {
        setSelectedCodes([{
          code: targetCode,
          minutes: targetCode.premiumMinutes ?? 0,
          useVariant: false,
        }]);
      }
    }
  }, [params.preselectedCode, premiumCodes]);

  // Calculate total premium minutes
  const totalPremiumMinutes = useMemo(() => {
    return selectedCodes.reduce((sum, sp) => sum + sp.minutes, 0);
  }, [selectedCodes]);

  // Toggle premium code selection
  const handleToggleCode = (code: PremiumCode) => {
    const existing = selectedCodes.find((sp) => sp.code.code === code.code);

    if (existing) {
      // Remove code
      setSelectedCodes(selectedCodes.filter((sp) => sp.code.code !== code.code));
    } else {
      // Add code
      setSelectedCodes([
        ...selectedCodes,
        {
          code,
          minutes: code.premiumMinutes ?? 0,
          useVariant: false,
        },
      ]);
    }
  };

  // Update premium minutes for a code
  const handleUpdateMinutes = (codeId: string, minutes: number) => {
    setSelectedCodes(
      selectedCodes.map((sp) =>
        sp.code.code === codeId ? { ...sp, minutes } : sp
      )
    );
  };

  // Handle late arrival calculator result
  const handleLateArrivalCalculate = (codeId: string, minutes: number, payCents: number) => {
    setSelectedCodes(
      selectedCodes.map((sp) =>
        sp.code.code === codeId
          ? { ...sp, minutes, calculatedPremium: payCents }
          : sp
      )
    );
  };

  // Create mutation — now uses log-events API with pay modifier fields
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!params.tripId) {
        throw new Error('Trip ID is required to log a pay event');
      }

      // Find the first selected code to determine pay impact
      const primaryCode = selectedCodes[0];
      const isPayAffecting = selectedCodes.length > 0;
      const hasMultiplier = primaryCode?.code.premiumType === 'multiplier' && primaryCode.code.premiumMultiplier !== null;
      const hasProof = screenshotUris.length > 0;

      // Determine application status
      const applicationStatus = isPayAffecting
        ? hasProof ? 'ready_to_apply' : 'needs_proof'
        : 'logged';

      const logEventData = {
        tripId: params.tripId,
        eventType: isPayAffecting ? 'PREMIUM_TRIGGER' : (params.changeType ?? 'OTHER'),
        premiumCode: primaryCode?.code.code ?? undefined,
        premiumMinutesDelta: hasMultiplier ? (primaryCode?.calculatedPremium ?? undefined) : (totalPremiumMinutes > 0 ? totalPremiumMinutes : undefined),
        premiumMultiplier: hasMultiplier ? (primaryCode.code.premiumMultiplier ?? undefined) : undefined,
        notes: notes || undefined,
        autoGeneratedNotes: title || undefined,
        status: 'saved' as const,
        // Pay modifier fields
        appliesTo: 'trip' as const,
        contractReference: primaryCode?.code.contractRef ?? undefined,
        proofStatus: hasProof ? 'attached' as const : (isPayAffecting ? 'missing' as const : 'not_required' as const),
        applicationStatus: applicationStatus as 'logged' | 'needs_proof' | 'ready_to_apply' | 'applied' | 'review',
        eventDate: new Date().toISOString().split('T')[0],
        isPayAffecting,
        payDeltaCents: isPayAffecting
          ? Math.round((totalPremiumMinutes / 60) * hourlyRateCents)
          : undefined,
        // Context fields
        dutyDayDate: params.dutyDayDate ?? undefined,
        aircraftType: params.aircraftType ?? (trip ? (trip as any).baseFleet ?? undefined : undefined),
        position: params.position ?? undefined,
        // Attachments
        attachmentUrls: screenshotUris.length > 0 ? screenshotUris : undefined,
      };

      const response = await api.post('/api/log-events', logEventData);
      return response;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['log-events'] });
      queryClient.invalidateQueries({ queryKey: ['projections'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['trip-pay-engine'] });
      queryClient.invalidateQueries({ queryKey: ['trip', params.tripId] });
      router.back();
    },
    onError: (error) => {
      console.error('Failed to create log event:', error);
      Alert.alert('Error', 'Failed to create log event. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for this event.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    createMutation.mutate();
  };

  const handleGoBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  // Get suggested code objects
  const suggestedCodes = useMemo(() => {
    return suggestions
      .filter((s) => s.confidence === 'high' || s.confidence === 'medium')
      .map((s) => premiumCodes.find((c) => c.code === s.code))
      .filter((c): c is PremiumCode => c !== undefined);
  }, [suggestions, premiumCodes]);

  const isLoading = tripLoading || codesLoading;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={['#0f172a', '#020617']}
          style={{ flex: 1, paddingTop: insets.top }}
        >
          {/* Header */}
          <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={handleGoBack}
              className="p-2 -ml-2 rounded-lg active:bg-slate-800"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <ChevronLeft size={24} color="#fff" />
            </Pressable>
            <View className="flex-1 ml-2">
              <Text className="text-white text-lg font-bold">Log Pay Event</Text>
              {(trip || params.tripNumber) && (
                <View className="flex-row items-center flex-wrap gap-1 mt-0.5">
                  <View className="bg-slate-700/60 px-2 py-0.5 rounded">
                    <Text className="text-slate-300 text-xs font-semibold">
                      {trip?.tripNumber ?? params.tripNumber}
                    </Text>
                  </View>
                  {(trip?.startDate ?? params.tripStartDate) && (
                    <Text className="text-slate-500 text-xs">
                      {trip?.startDate ?? params.tripStartDate}
                      {(trip?.endDate ?? params.tripEndDate) && ` – ${trip?.endDate ?? params.tripEndDate}`}
                    </Text>
                  )}
                  {params.dutyDayDate && (
                    <View className="bg-amber-500/20 px-2 py-0.5 rounded">
                      <Text className="text-amber-400 text-[10px]">{params.dutyDayDate}</Text>
                    </View>
                  )}
                  {params.aircraftType && (
                    <View className="bg-slate-700/60 px-2 py-0.5 rounded">
                      <Text className="text-slate-400 text-[10px]">{params.aircraftType}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {isLoading ? (
                <View className="items-center justify-center py-20">
                  <ActivityIndicator size="large" color="#10b981" />
                  <Text className="text-slate-400 mt-4">Loading...</Text>
                </View>
              ) : (
                <>
                  {/* Title */}
                  <Animated.View entering={FadeInDown.duration(300)}>
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                      Event Title
                    </Text>

                    {/* Trip picker trigger */}
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setTripPickerVisible(true);
                      }}
                      className="flex-row items-center bg-slate-800/60 rounded-xl border border-slate-700/50 px-4 py-3 mb-2 active:opacity-70"
                    >
                      <Plane size={15} color="#10b981" style={{ marginRight: 8 }} />
                      <Text className="text-emerald-400 text-sm font-medium flex-1">
                        Select from my trips & legs
                      </Text>
                      <ChevronRight size={15} color="#475569" />
                    </Pressable>

                    {/* Manual title input */}
                    <View className="bg-slate-800/60 rounded-xl border border-slate-700/50">
                      <TextInput
                        value={title}
                        onChangeText={setTitle}
                        placeholder="e.g., Trip 1234 — Layover Shortened"
                        placeholderTextColor="#64748b"
                        className="text-white text-base p-4"
                      />
                    </View>
                  </Animated.View>

                  {/* Trip Picker Modal */}
                  <TripPickerModal
                    visible={tripPickerVisible}
                    onClose={() => setTripPickerVisible(false)}
                    onSelect={(t) => setTitle(t)}
                  />

                  {/* Suggested Premium Codes */}
                  {suggestedCodes.length > 0 && (
                    <Animated.View entering={FadeInDown.duration(300).delay(100)} className="mt-6">
                      <View className="flex-row items-center mb-3">
                        <AlertTriangle size={16} color="#f59e0b" />
                        <Text className="text-amber-400 text-sm font-semibold ml-2">
                          Suggested Premiums
                        </Text>
                      </View>
                      <View>
                        {suggestedCodes.map((code) => (
                          <PremiumCodeRow
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some((sp) => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                      </View>
                    </Animated.View>
                  )}

                  {/* Reassignment Premiums (AP0–AP9, JA) */}
                  <Animated.View entering={FadeInDown.duration(300).delay(200)} className="mt-6">
                    <View className="flex-row items-center mb-3">
                      <Clock size={16} color="#10b981" />
                      <Text className="text-emerald-400 text-sm font-semibold ml-2">
                        Reassignment &amp; Assignment
                      </Text>
                    </View>
                    <View>
                      {premiumCodes
                        .filter((c) => ['JA','AP0','AP1','AP2','AP3','AP4','AP5','AP6','AP7','AP8','AP9'].includes(c.code))
                        .map((code) => (
                          <PremiumCodeRow
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some((sp) => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                    </View>
                  </Animated.View>

                  {/* Reserve Premiums */}
                  <Animated.View entering={FadeInDown.duration(300).delay(250)} className="mt-6">
                    <View className="flex-row items-center mb-3">
                      <Shield size={16} color="#818cf8" />
                      <Text className="text-indigo-400 text-sm font-semibold ml-2">
                        Reserve
                      </Text>
                    </View>
                    <View>
                      {premiumCodes
                        .filter((c) => ['SVT','RT1'].includes(c.code))
                        .map((code) => (
                          <PremiumCodeRow
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some((sp) => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                    </View>
                  </Animated.View>

                  {/* Schedule Revision & Other Fixed */}
                  <Animated.View entering={FadeInDown.duration(300).delay(280)} className="mt-6">
                    <View className="flex-row items-center mb-3">
                      <FileText size={16} color="#64748b" />
                      <Text className="text-slate-400 text-sm font-semibold ml-2">
                        Schedule Revision &amp; Other
                      </Text>
                    </View>
                    <View>
                      {premiumCodes
                        .filter((c) => ['LRP','PRM','GT1','APE','DOD_JS'].includes(c.code))
                        .map((code) => (
                          <PremiumCodeRow
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some((sp) => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                    </View>
                  </Animated.View>

                  {/* Late Arrival Premiums */}
                  <Animated.View entering={FadeInDown.duration(300).delay(300)} className="mt-6">
                    <View className="flex-row items-center mb-3">
                      <DollarSign size={16} color="#f59e0b" />
                      <Text className="text-amber-400 text-sm font-semibold ml-2">
                        Late Arrival Premiums
                      </Text>
                    </View>
                    <View>
                      {premiumCodes
                        .filter((c) => ['LP1','LP2','RJA'].includes(c.code))
                        .map((code) => (
                          <PremiumCodeRow
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some((sp) => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                    </View>
                  </Animated.View>

                  {/* Late Arrival Calculators */}
                  {selectedCodes
                    .filter((sp) => sp.code.premiumType === 'multiplier')
                    .map((sp) => (
                      <LateArrivalCalculator
                        key={sp.code.code}
                        code={sp.code}
                        hourlyRateCents={hourlyRateCents}
                        onCalculate={(minutes, payCents) =>
                          handleLateArrivalCalculate(sp.code.code, minutes, payCents)
                        }
                      />
                    ))}

                  {/* Credit Impact */}
                  {totalPremiumMinutes > 0 && (
                    <Animated.View entering={FadeIn.duration(300)} className="mt-6">
                      <CreditImpactDisplay
                        premiumMinutes={totalPremiumMinutes}
                        hourlyRateCents={hourlyRateCents}
                      />
                    </Animated.View>
                  )}

                  {/* Screenshots */}
                  {screenshotUris.length > 0 && (
                    <Animated.View entering={FadeInDown.duration(300).delay(400)} className="mt-6">
                      <View className="flex-row items-center mb-3">
                        <Camera size={16} color="#64748b" />
                        <Text className="text-slate-400 text-sm ml-2">
                          {screenshotUris.length} Screenshot{screenshotUris.length !== 1 ? 's' : ''} Attached
                        </Text>
                      </View>
                      <View className="flex-row">
                        {screenshotUris.map((uri, idx) => (
                          <View
                            key={idx}
                            className="w-20 h-20 bg-slate-800/60 rounded-lg mr-2 items-center justify-center border border-slate-700/50"
                          >
                            <Image size={24} color="#64748b" />
                            <Text className="text-slate-500 text-[10px] mt-1">Image {idx + 1}</Text>
                          </View>
                        ))}
                      </View>
                    </Animated.View>
                  )}

                  {/* Notes */}
                  <Animated.View entering={FadeInDown.duration(300).delay(500)} className="mt-6">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                      Additional Notes
                    </Text>
                    <View className="bg-slate-800/60 rounded-xl border border-slate-700/50">
                      <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Rep name, call time, details..."
                        placeholderTextColor="#64748b"
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        className="text-white text-base p-4"
                        style={{ minHeight: 80 }}
                      />
                    </View>
                  </Animated.View>

                  {/* Contract Reference */}
                  {selectedCodes.length > 0 && (
                    <Animated.View entering={FadeIn.duration(300)} className="mt-4">
                      <View className="bg-slate-800/50 rounded-lg p-3">
                        <View className="flex-row items-center mb-2">
                          <Info size={14} color="#64748b" />
                          <Text className="text-slate-400 text-xs ml-2">Contract References</Text>
                        </View>
                        {selectedCodes
                          .filter((sp) => sp.code.contractRef)
                          .map((sp) => (
                            <Text key={sp.code.code} className="text-slate-500 text-xs">
                              {sp.code.code}: {sp.code.contractRef}
                            </Text>
                          ))}
                      </View>
                    </Animated.View>
                  )}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Submit Button */}
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Pressable
              onPress={handleSubmit}
              disabled={createMutation.isPending || !title.trim()}
              className={`rounded-xl py-4 flex-row items-center justify-center ${
                title.trim() && !createMutation.isPending
                  ? 'bg-emerald-500 active:bg-emerald-600'
                  : 'bg-slate-700'
              }`}
            >
              {createMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <FileText size={20} color={title.trim() ? '#fff' : '#64748b'} />
                  <Text
                    className={`font-bold text-lg ml-2 ${title.trim() ? 'text-white' : 'text-slate-500'}`}
                  >
                    Create Log Event
                  </Text>
                  {totalPremiumMinutes > 0 && (
                    <Text className="text-emerald-200 text-sm ml-2">
                      (+{formatMinutesToTime(totalPremiumMinutes)})
                    </Text>
                  )}
                </>
              )}
            </Pressable>
          </View>
        </LinearGradient>
      </View>
    </>
  );
}
