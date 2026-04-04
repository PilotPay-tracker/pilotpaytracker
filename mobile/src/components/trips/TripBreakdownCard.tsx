/**
 * TripBreakdownCard - Comprehensive trip display like BidPro
 * Shows full trip breakdown with:
 * - Trip header (pairing, equipment, base)
 * - Each duty day with individual legs
 * - Layovers between duty days
 * - Daily totals
 * - Trip summary footer
 * - Credit delta badges for pay protection visibility
 */

import React, { memo } from 'react';
import { View, Text, Pressable, Alert, Linking, ScrollView, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Plane,
  Calendar,
  Clock,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Building2,
  MapPin,
  Timer,
  Trash2,
  RefreshCw,
  Lock,
  DollarSign,
  TrendingUp,
  Plus,
  TrendingDown,
  Shield,
  FileWarning,
  Eye,
  Phone,
  Car,
  Heart,
  Zap,
  FileCheck,
  Search,
  X as XIcon,
  Percent,
  ChevronLeft,
  Check,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { BackendTrip, BackendLeg, BackendDutyDay, BackendTripDutyLeg } from '@/lib/useTripsData';
import { formatMinutesToTime, formatCentsToCurrency } from '@/lib/useTripsData';
import { useHourlyRateCents, usePosition } from '@/lib/state/profile-store';
import { TripSikBadge } from './SikBadge';
import { useAirportDb } from '@/lib/useAirportDb';
import { safeZuluToLocal } from '@/utils/time';
import type { AirportDb } from '@/utils/airportDb';
import { cn } from '@/lib/cn';
import { PER_DIEM_DOMESTIC_CENTS_PER_HOUR, PER_DIEM_INTERNATIONAL_CENTS_PER_HOUR } from '@/lib/contracts';
import { useTripPayBreakdown, type TripPayState, type TripPayBreakdown, tripPayEngineKeys } from '@/lib/useTripPayEngine';
import { type TripPremiumContext } from './ApplyPremiumSheet';
import { usePremiumCodes } from '@/lib/usePremiumCodes';
import type { PremiumCode } from '@/lib/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ============================================
// PREMIUM PICKER MODAL
// Self-contained modal: list → apply sheet
// ============================================

interface PremiumPickerModalProps {
  visible: boolean;
  tripContext: TripPremiumContext;
  hourlyRateCents: number;
  onClose: () => void;
  onApplied: () => void;
}

function PremiumPickerModal({ visible, tripContext, hourlyRateCents, onClose, onApplied }: PremiumPickerModalProps) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'confirm'>('list');
  const [selectedCode, setSelectedCode] = useState<PremiumCode | null>(null);
  const [didApply, setDidApply] = useState(false);
  // Running total of extra credit minutes from all premiums applied this session
  const [sessionCreditDelta, setSessionCreditDelta] = useState(0);
  const [sessionAppliedCount, setSessionAppliedCount] = useState(0);

  const queryClient = useQueryClient();

  // Effective base = original base + whatever premiums we've stacked this session
  const effectiveBaseCreditMinutes = tripContext.baseCreditMinutes + sessionCreditDelta;
  const effectiveBasePayCents = Math.round((effectiveBaseCreditMinutes / 60) * hourlyRateCents);

  const filterOptions = useMemo(
    () => ({ search: search || undefined }),
    [search]
  );
  const { data, isLoading } = usePremiumCodes(filterOptions);
  const codes = data?.codes ?? [];

  const sortedCodes = useMemo(() => {
    const jaCodes = codes.filter(c => c.code === 'JA');
    const rest = codes.filter(c => c.code !== 'JA');
    return [...jaCodes, ...rest];
  }, [codes]);

  const insets = useSafeAreaInsets();

  // Reset session state whenever the modal opens fresh
  useEffect(() => {
    if (visible) {
      setView('list');
      setSelectedCode(null);
      setDidApply(false);
      setSessionCreditDelta(0);
      setSessionAppliedCount(0);
    }
  }, [visible]);
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCode) throw new Error('No code selected');
      const payload: Record<string, unknown> = {
        tripId: tripContext.tripId,
        premiumCode: selectedCode.code,
        premiumName: selectedCode.title,
        premiumType: selectedCode.premiumType,
        originalPayCents: effectiveBasePayCents,
        contractReference: selectedCode.contractRef,
      };
      if (selectedCode.premiumType === 'multiplier' && selectedCode.premiumMultiplier) {
        payload.multiplierValue = selectedCode.premiumMultiplier;
      } else if (selectedCode.premiumType === 'minutes' && selectedCode.premiumMinutes) {
        payload.creditMinutesDelta = selectedCode.premiumMinutes;
      }
      return api.post<{ success: boolean; payImpact?: { creditDeltaMinutes?: number } }>('/api/log-events/apply-premium', payload);
    },
    onSuccess: (result) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDidApply(true);
      // Accumulate session credit delta so next premium calculates on the updated base
      const delta = impact?.creditDelta ?? 0;
      setSessionCreditDelta(prev => prev + delta);
      setSessionAppliedCount(prev => prev + 1);
      // Invalidate all pay-related caches
      queryClient.invalidateQueries({ queryKey: tripPayEngineKeys.breakdown(tripContext.tripId) });
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projections'] });
      queryClient.invalidateQueries({ queryKey: ['year-plan-active'] });
      // After success animation, return to list — keep modal open for more premiums
      setTimeout(() => {
        setDidApply(false);
        setSelectedCode(null);
        setView('list');
        applyMutation.reset();
        onApplied(); // just triggers refetch, doesn't close modal
      }, 900);
    },
  });

  function handleClose() {
    setView('list');
    setSelectedCode(null);
    setDidApply(false);
    setSessionCreditDelta(0);
    setSessionAppliedCount(0);
    applyMutation.reset();
    onClose();
  }

  // Compute pay impact for confirm view — uses effective base (accounts for already-applied premiums)
  const impact = useMemo(() => {
    if (!selectedCode) return null;
    const basePay = effectiveBasePayCents;
    if (selectedCode.premiumType === 'multiplier' && selectedCode.premiumMultiplier) {
      // Multiplier applies to the effective current base credit
      const multiplied = Math.round(effectiveBaseCreditMinutes * selectedCode.premiumMultiplier);
      const creditDelta = multiplied - effectiveBaseCreditMinutes;
      const payDelta = Math.round((creditDelta / 60) * hourlyRateCents);
      return { basePay, payDelta, newPay: basePay + payDelta, creditDelta };
    }
    if (selectedCode.premiumType === 'minutes' && selectedCode.premiumMinutes) {
      const payDelta = Math.round((selectedCode.premiumMinutes / 60) * hourlyRateCents);
      return { basePay, payDelta, newPay: basePay + payDelta, creditDelta: selectedCode.premiumMinutes };
    }
    return { basePay, payDelta: 0, newPay: basePay, creditDelta: 0 };
  }, [selectedCode, effectiveBaseCreditMinutes, effectiveBasePayCents, hourlyRateCents]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: '#0f172a',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: 'rgba(139,92,246,0.3)',
            maxHeight: '88%',
            paddingBottom: insets.bottom + 8,
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#334155' }} />
          </View>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {view === 'confirm' && (
                <Pressable
                  onPress={() => { setView('list'); applyMutation.reset(); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={{ padding: 6, borderRadius: 10, backgroundColor: '#1e293b', marginRight: 10 }}
                >
                  <ChevronLeft size={18} color="#94a3b8" />
                </Pressable>
              )}
              <View style={{ backgroundColor: 'rgba(139,92,246,0.2)', padding: 8, borderRadius: 12, marginRight: 10 }}>
                <Zap size={20} color="#a855f7" />
              </View>
              <View>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18 }}>
                  {view === 'list' ? 'Apply a Premium' : 'Confirm Premium'}
                </Text>
                <Text style={{ color: '#64748b', fontSize: 12 }}>
                  Trip {tripContext.tripNumber || tripContext.tripId.slice(-6).toUpperCase()}
                  {sessionAppliedCount > 0 ? ` · ${sessionAppliedCount} applied` : ''}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ padding: 8, borderRadius: 12, backgroundColor: '#1e293b' }}
            >
              <XIcon size={18} color="#94a3b8" />
            </Pressable>
          </View>

          {/* LIST VIEW */}
          {view === 'list' && (
            <>
              {/* Running total banner — shown when premiums already applied this session */}
              {sessionAppliedCount > 0 ? (
                <View style={{ marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(52,211,153,0.1)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Check size={14} color="#34d399" />
                    <Text style={{ color: '#34d399', fontSize: 12, marginLeft: 6, fontWeight: '600' }}>
                      {sessionAppliedCount} premium{sessionAppliedCount > 1 ? 's' : ''} applied
                    </Text>
                  </View>
                  <Text style={{ color: '#34d399', fontSize: 12, fontWeight: '700' }}>
                    {formatMinutesToTime(effectiveBaseCreditMinutes)} current credit
                  </Text>
                </View>
              ) : (
                <View style={{ marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)', flexDirection: 'row', alignItems: 'center' }}>
                  <Zap size={14} color="#a855f7" />
                  <Text style={{ color: 'rgba(168,85,247,0.8)', fontSize: 12, marginLeft: 6, flex: 1 }}>
                    Tap a code to preview and apply pay changes
                  </Text>
                </View>
              )}

              {/* Search */}
              <View style={{ marginHorizontal: 20, marginBottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' }}>
                <Search size={16} color="#64748b" />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search premium code…"
                  placeholderTextColor="#64748b"
                  style={{ flex: 1, color: '#fff', fontSize: 15, marginLeft: 10 }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <XIcon size={16} color="#64748b" />
                  </Pressable>
                )}
              </View>

              {/* Code List */}
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 8 }}
              >
                {isLoading && (
                  <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                    <ActivityIndicator color="#a855f7" />
                  </View>
                )}
                {!isLoading && sortedCodes.map((code) => {
                  const isJA = code.code === 'JA';
                  const isMultiplier = code.premiumType === 'multiplier';
                  const valueDisplay = isMultiplier && code.premiumMultiplier
                    ? `${(code.premiumMultiplier * 100).toFixed(0)}%`
                    : code.premiumMinutes
                      ? `+${formatMinutesToTime(code.premiumMinutes)}`
                      : '';

                  return (
                    <Pressable
                      key={code.code}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setSelectedCode(code);
                        setView('confirm');
                      }}
                      style={{
                        backgroundColor: isJA ? 'rgba(139,92,246,0.12)' : '#1e293b',
                        borderRadius: 16,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: isJA ? 'rgba(139,92,246,0.4)' : '#334155',
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{
                        width: 52, height: 52, borderRadius: 12,
                        backgroundColor: isJA ? 'rgba(139,92,246,0.25)' : 'rgba(100,116,139,0.2)',
                        alignItems: 'center', justifyContent: 'center', marginRight: 12,
                      }}>
                        <Text style={{ color: isJA ? '#c084fc' : '#94a3b8', fontWeight: '700', fontSize: 14 }}>
                          {code.code}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                          {code.title}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 }}>
                          <View style={{
                            backgroundColor: isMultiplier ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)',
                            paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                            flexDirection: 'row', alignItems: 'center',
                          }}>
                            {isMultiplier
                              ? <Percent size={9} color="#60a5fa" />
                              : <Clock size={9} color="#34d399" />
                            }
                            <Text style={{ color: isMultiplier ? '#93c5fd' : '#6ee7b7', fontSize: 10, marginLeft: 3, fontWeight: '600' }}>
                              {isMultiplier ? 'Multiplier' : 'Fixed Credit'}
                            </Text>
                          </View>
                          {code.contractRef && (
                            <Text style={{ color: '#475569', fontSize: 10 }}>§ {code.contractRef}</Text>
                          )}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                        <Text style={{ color: isMultiplier ? '#93c5fd' : '#6ee7b7', fontWeight: '700', fontSize: 18 }}>
                          {valueDisplay}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(139,92,246,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 2 }}>
                          <Zap size={9} color="#a855f7" />
                          <Text style={{ color: '#c084fc', fontSize: 10, fontWeight: '700', marginLeft: 2 }}>Apply</Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {/* CONFIRM VIEW */}
          {view === 'confirm' && selectedCode && impact && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
            >
              {/* Code card */}
              <View style={{ backgroundColor: 'rgba(30,41,59,0.8)', borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <View style={{ backgroundColor: 'rgba(139,92,246,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 8 }}>
                    <Text style={{ color: '#c084fc', fontWeight: '700', fontSize: 16 }}>{selectedCode.code}</Text>
                  </View>
                  <View style={{ backgroundColor: selectedCode.premiumType === 'multiplier' ? 'rgba(59,130,246,0.2)' : 'rgba(16,185,129,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ color: selectedCode.premiumType === 'multiplier' ? '#93c5fd' : '#6ee7b7', fontSize: 11, fontWeight: '600' }}>
                      {selectedCode.premiumType === 'multiplier' ? 'Multiplier' : 'Fixed Credit'}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>{selectedCode.title}</Text>
                {selectedCode.contractRef && (
                  <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>§ {selectedCode.contractRef}</Text>
                )}
              </View>

              {/* Pay impact */}
              {selectedCode.premiumType !== 'manual' && (
                <View style={{ backgroundColor: 'rgba(30,41,59,0.6)', borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(51,65,85,0.5)' }}>
                  <Text style={{ color: '#64748b', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>Pay Impact</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <DollarSign size={14} color="#64748b" />
                      <Text style={{ color: '#94a3b8', fontSize: 14, marginLeft: 6 }}>Base Pay</Text>
                    </View>
                    <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '600' }}>{formatCentsToCurrency(impact.basePay)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Zap size={14} color="#a855f7" />
                      <Text style={{ color: '#c084fc', fontSize: 14, marginLeft: 6 }}>{selectedCode.code} Premium</Text>
                    </View>
                    <Text style={{ color: '#c084fc', fontSize: 14, fontWeight: '600' }}>+{formatCentsToCurrency(impact.payDelta)}</Text>
                  </View>
                  <View style={{ borderTopWidth: 1, borderColor: 'rgba(51,65,85,0.6)', paddingTop: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Shield size={15} color="#34d399" />
                        <Text style={{ color: '#34d399', fontSize: 14, fontWeight: '700', marginLeft: 6 }}>Estimated Pay After</Text>
                      </View>
                      <Text style={{ color: '#34d399', fontSize: 20, fontWeight: '700' }}>{formatCentsToCurrency(impact.newPay)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ color: '#475569', fontSize: 12 }}>{formatMinutesToTime(effectiveBaseCreditMinutes)} current</Text>
                      <ChevronRight size={12} color="#475569" style={{ marginHorizontal: 4 }} />
                      <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>
                        {formatMinutesToTime(effectiveBaseCreditMinutes + impact.creditDelta)} pay credit
                      </Text>
                      <Text style={{ color: '#a855f7', fontSize: 12, marginLeft: 4 }}>
                        (+{formatMinutesToTime(impact.creditDelta)})
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {applyMutation.error && (
                <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' }}>
                  <Text style={{ color: '#f87171', fontSize: 14 }}>Failed to apply premium. Please try again.</Text>
                </View>
              )}

              {/* Buttons */}
              <View style={{ gap: 10, marginTop: 4 }}>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    applyMutation.mutate();
                  }}
                  disabled={applyMutation.isPending || didApply}
                  style={{
                    backgroundColor: didApply ? '#22c55e' : '#7c3aed',
                    borderRadius: 18,
                    paddingVertical: 16,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: (applyMutation.isPending || didApply) ? 0.9 : 1,
                  }}
                >
                  {applyMutation.isPending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : didApply
                      ? <Check size={20} color="#fff" />
                      : <Zap size={20} color="#fff" />
                  }
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                    {applyMutation.isPending ? 'Applying…' : didApply ? 'Premium Applied!' : 'Apply Premium'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { setView('list'); applyMutation.reset(); }}
                  style={{ backgroundColor: '#1e293b', borderRadius: 18, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 15 }}>Back to List</Text>
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}


/**
 * Compute trip-level sick status from all legs
 * - 'SIK' if ALL legs are marked sick
 * - 'PARTIAL' if SOME legs are marked sick
 * - 'FLY' if NO legs are marked sick
 */
function getTripSickStatus(trip: BackendTrip): 'FLY' | 'SIK' | 'PARTIAL' {
  // Collect all legs from both dutyDays and tripDutyDays
  const allLegs: Array<{ legStatus?: string }> = [];

  // From dutyDays (standard format)
  if (trip.dutyDays && trip.dutyDays.length > 0) {
    for (const dd of trip.dutyDays) {
      if (dd.legs) {
        for (const leg of dd.legs) {
          allLegs.push(leg as any);
        }
      }
    }
  }

  // From tripDutyDays (canonical format)
  if (trip.tripDutyDays && trip.tripDutyDays.length > 0) {
    for (const tdd of trip.tripDutyDays) {
      if (tdd.legs) {
        for (const leg of tdd.legs) {
          allLegs.push(leg);
        }
      }
    }
  }

  if (allLegs.length === 0) return 'FLY';

  const sikCount = allLegs.filter(leg => leg.legStatus === 'SIK').length;

  if (sikCount === 0) return 'FLY';
  if (sikCount === allLegs.length) return 'SIK';
  return 'PARTIAL';
}

interface TripBreakdownCardProps {
  trip: BackendTrip;
  onPress: (dutyDayIndex?: number) => void;
  onDelete?: () => void;
  onReviewPress?: () => void; // Phase 6: Navigate to Review Changes screen
  onMarkSick?: () => void; // Handler for marking trip as sick
  onLogEvent?: () => void; // Quick log event from card
  index?: number;
  // Pay protection - credit delta display
  protectedCreditMinutes?: number;
  isPayProtected?: boolean;
}

/**
 * Credit Delta Badge - Shows credit hour and pay differences
 * Positive delta (credit increase): green "+HH:MM (+$X.XX)"
 * Negative delta with protection: violet "Protected +HH:MM (+$X.XX preserved)"
 * Negative delta without protection: red "-HH:MM (-$X.XX)"
 */
function CreditDeltaBadge({
  currentCreditMinutes,
  protectedCreditMinutes,
  isPayProtected,
  hourlyRateCents,
}: {
  currentCreditMinutes: number;
  protectedCreditMinutes: number;
  isPayProtected: boolean;
  hourlyRateCents: number;
}) {
  const deltaMinutes = currentCreditMinutes - protectedCreditMinutes;

  // No badge if no delta
  if (deltaMinutes === 0 || !protectedCreditMinutes) return null;

  const deltaPayCents = Math.round((Math.abs(deltaMinutes) / 60) * hourlyRateCents);
  const isPositive = deltaMinutes > 0;
  const isNegativeProtected = deltaMinutes < 0 && isPayProtected;

  // Format time delta
  const absMinutes = Math.abs(deltaMinutes);
  const hrs = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const timeStr = `${hrs}:${mins.toString().padStart(2, '0')}`;

  // Format pay delta
  const payStr = `$${(deltaPayCents / 100).toFixed(2)}`;

  if (isPositive) {
    // Credit increase - show as green
    return (
      <View className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg">
        <TrendingUp size={12} color="#10b981" />
        <Text className="text-emerald-400 text-xs font-bold ml-1">
          +{timeStr}
        </Text>
        <Text className="text-emerald-400/70 text-[10px] ml-1">
          (+{payStr})
        </Text>
      </View>
    );
  }

  if (isNegativeProtected) {
    // Credit decrease but protected - show as violet/protected
    return (
      <View className="flex-row items-center bg-violet-500/20 px-2 py-1 rounded-lg">
        <Shield size={12} color="#8b5cf6" />
        <Text className="text-violet-400 text-xs font-bold ml-1">
          Protected
        </Text>
        <Text className="text-violet-400/70 text-[10px] ml-1">
          (+{timeStr} / +{payStr} preserved)
        </Text>
      </View>
    );
  }

  // Credit decrease without protection - show as red
  return (
    <View className="flex-row items-center bg-red-500/20 px-2 py-1 rounded-lg">
      <TrendingDown size={12} color="#ef4444" />
      <Text className="text-red-400 text-xs font-bold ml-1">
        -{timeStr}
      </Text>
      <Text className="text-red-400/70 text-[10px] ml-1">
        (-{payStr})
      </Text>
    </View>
  );
}

// Format time in Zulu (like BidPro shows)
function formatTimeZulu(isoString: string | null | undefined): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const mins = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}${mins}`;
  } catch {
    return '--:--';
  }
}

/**
 * Format time in LOCAL timezone based on airport code
 * Times are now stored as LOCAL times (without Z suffix), so we just extract them directly
 * Returns time as HHMM in local time of the specified airport
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
      const dateISO = isoString.split('T')[0];
      const zuluHHMM = `${date.getUTCHours().toString().padStart(2, '0')}${date.getUTCMinutes().toString().padStart(2, '0')}`;

      const localTime = safeZuluToLocal({
        airportDb,
        dateISO,
        zuluHHMM,
        stationCode: airportCode,
      });

      return localTime.replace(':', '');
    } else {
      // New format - times are already LOCAL, just extract HH:MM
      // ISO string format: "2026-01-31T06:30:00" (no Z = local time)
      const timePart = isoString.split('T')[1];
      if (timePart) {
        const [hours, mins] = timePart.split(':');
        return `${hours}${mins}`;
      }
      return '--:--';
    }
  } catch {
    return '--:--';
  }
}

function formatDutyDate(dateString: string): string {
  try {
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  } catch {
    return dateString;
  }
}

function formatDateWithDay(dateString: string): string {
  try {
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Calculate rest time (layover) between two duty days
 *
 * Per CML Trip Information: Rest = next duty START − prior duty END
 *
 * This is the exact formula used by UPS for layover/rest calculation:
 * - Prior duty END = dutyEndISO or last leg arrival time
 * - Next duty START = dutyStartISO or first leg departure time
 * - NO offset subtraction - use explicit duty start/end datetimes only
 *
 * @returns layover minutes for this single rest period between duties
 */
function calculateLayoverMinutes(
  prevDay: BackendDutyDay,
  nextDay: BackendDutyDay
): number {
  // Get previous day's duty END time
  // Priority: dutyEndISO (authoritative) > last leg actual arrival > last leg scheduled arrival
  let prevDutyEndTime: Date | null = null;

  if (prevDay.dutyEndISO) {
    prevDutyEndTime = new Date(prevDay.dutyEndISO);
  } else if (prevDay.legs && prevDay.legs.length > 0) {
    // Fallback: use last leg's arrival time as duty end
    const sortedLegs = [...prevDay.legs].sort((a, b) => a.legIndex - b.legIndex);
    const lastLeg = sortedLegs[sortedLegs.length - 1];
    const arrivalISO = lastLeg.actualInISO || lastLeg.scheduledInISO;
    if (arrivalISO) {
      prevDutyEndTime = new Date(arrivalISO);
    }
  }

  // Get next day's duty START time
  // Priority: dutyStartISO (authoritative) > first leg actual departure > first leg scheduled departure
  // NOTE: Do NOT subtract any offset - use the actual duty start time directly
  let nextDutyStartTime: Date | null = null;

  if (nextDay.dutyStartISO) {
    // dutyStartISO is the authoritative duty start (report) time
    nextDutyStartTime = new Date(nextDay.dutyStartISO);
  } else if (nextDay.legs && nextDay.legs.length > 0) {
    // Fallback: use first leg's departure time as duty start
    // This is the departure time itself, NOT departure minus any offset
    const sortedLegs = [...nextDay.legs].sort((a, b) => a.legIndex - b.legIndex);
    const firstLeg = sortedLegs[0];
    const departureISO = firstLeg.actualOutISO || firstLeg.scheduledOutISO;
    if (departureISO) {
      nextDutyStartTime = new Date(departureISO);
    }
  }

  // Rest = next duty START − prior duty END
  if (prevDutyEndTime && nextDutyStartTime) {
    const diffMs = nextDutyStartTime.getTime() - prevDutyEndTime.getTime();
    return Math.max(0, Math.round(diffMs / 60000));
  }

  // Fallback: estimate from dates if explicit times not available
  const prevDate = new Date(prevDay.dutyDate);
  const nextDate = new Date(nextDay.dutyDate);
  const dayDiff = Math.round((nextDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

  // If consecutive days, estimate typical overnight rest (~10-12 hours)
  if (dayDiff === 1) {
    return 10 * 60; // 10 hours default overnight rest
  } else if (dayDiff > 1) {
    // Multiple days between - unusual, estimate longer rest
    return (dayDiff - 1) * 24 * 60 + 10 * 60; // Extra days + typical overnight
  }

  return 0;
}

/**
 * Determine if a layover should be shown between two duty days
 *
 * A layover should ONLY be shown when:
 * 1. Both duty days exist and have legs (actual flying duty)
 * 2. The previous day ends at a different station than the crew's base
 * 3. The next day starts at the same station where previous day ended (overnight at outstation)
 * 4. It's not the final return to base
 *
 * @param prevDay - The previous duty day
 * @param nextDay - The next duty day
 * @param isLastDay - Whether nextDay is the last duty day of the trip
 * @param homeBase - The crew's home base (where trip starts/ends)
 */
function shouldShowLayover(
  prevDay: BackendDutyDay,
  nextDay: BackendDutyDay,
  isLastDay: boolean,
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

  // The next day must start where the previous day ended (this confirms overnight at outstation)
  if (prevDayEndStation !== nextDayStartStation) {
    // Different stations - this might be a base transfer or data issue
    // Still show layover but this is unusual
    return true;
  }

  // If previous day ended at home base, this is end of trip, not a layover
  // (Unless there's another duty day starting from base, which would be a new pairing)
  if (homeBase && prevDayEndStation === homeBase) {
    // Ended at home base - check if this is truly end of duty sequence
    // If next day also starts at home base, it could be a through-base trip
    // For now, show layover since there IS a next duty day
    return true;
  }

  // Standard layover: ended at outstation, next day starts there
  return true;
}

/**
 * Check if a destination is likely international (outside continental US)
 * Simple heuristic: non-US 3-letter codes or known international airports
 */
function isInternationalDestination(origin: string | null, destination: string | null): boolean {
  if (!origin || !destination) return false;
  // Common international prefixes/patterns
  const intlPrefixes = ['C', 'E', 'L', 'M', 'O', 'P', 'R', 'S', 'U', 'V', 'W', 'Z'];
  // If destination starts with these and origin doesn't, likely international
  const destPrefix = destination.charAt(0).toUpperCase();
  const originPrefix = origin.charAt(0).toUpperCase();
  // US airports typically start with K (but shown as 3-letter), or are well-known codes
  // For now, assume domestic unless destination looks clearly international
  return intlPrefixes.includes(destPrefix) && !intlPrefixes.includes(originPrefix);
}

// Status colors
const STATUS_COLORS = {
  verified: { accent: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', label: 'VERIFIED' },
  complete: { accent: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', label: 'COMPLETE' },
  active: { accent: '#64748b', bg: 'rgba(100, 116, 139, 0.15)', label: 'SCHEDULED' },
  needs_review: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', label: 'REVIEW' },
  sick: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', label: 'SICK' },
  dropped: { accent: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', label: 'DROPPED' },
  company_removed: { accent: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', label: 'CO REMOVED' },
};

/**
 * Normalize equipment codes to readable aircraft types
 * Converts codes like 76P, 76W to 767, 75P to 757, etc.
 */
function normalizeEquipment(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase().trim();

  // Map common codes to readable aircraft types
  const equipmentMap: Record<string, string> = {
    // Boeing 767 variants
    '76P': '767',
    '76W': '767',
    '768': '767',
    '76F': '767',
    // Boeing 757 variants
    '75P': '757',
    '75W': '757',
    '75F': '757',
    // Boeing 747 variants
    '74F': '747',
    '744': '747',
    '747': '747',
    '748': '747-8',
    '74Y': '747',
    // Boeing 777 variants
    '77F': '777',
    '77W': '777',
    '777': '777',
    // Boeing 737 variants
    '73F': '737',
    '738': '737',
    '737': '737',
    // Airbus A350
    '350': 'A350',
    '35K': 'A350',
    'A350': 'A350',
    // MD-11
    'MD11': 'MD11',
    'MD1': 'MD11',
    // Already readable formats - return as-is
    '767': '767',
    '757': '757',
  };

  return equipmentMap[upper] ?? upper;
}

function getTripStatus(trip: BackendTrip): keyof typeof STATUS_COLORS {
  // Check dropped/company_removed first — always show these statuses
  if (trip.status === 'dropped') return 'dropped';
  if (trip.status === 'company_removed') return 'company_removed';

  // Check dutyDays first, then tripDutyDays
  const dutyDays = trip.dutyDays ?? [];
  const tripDutyDays = trip.tripDutyDays ?? [];

  // Check if trip is fully sick - should take priority over other statuses
  const sickStatus = getTripSickStatus(trip);
  if (sickStatus === 'SIK') return 'sick';

  const hasAllActuals = dutyDays.length > 0
    ? dutyDays.every(dd => dd.hasAllActuals)
    : false;
  const hasProof = dutyDays.some(dd => dd.proofCount > 0);
  const needsReview = dutyDays.some(dd => dd.legs.some(l => l.needsReview))
    || tripDutyDays.some(tdd => tdd.legs?.some(l => (l as any).needsReview));

  // Trip is complete if end date is in the past
  const todayStr = new Date().toISOString().split('T')[0] ?? '';
  const tripEndDate = trip.endDate?.split('T')[0] ?? '';
  const isPastTrip = tripEndDate !== '' && tripEndDate < todayStr;

  if (needsReview) return 'needs_review';
  if (hasAllActuals && hasProof) return 'verified';
  if (hasAllActuals || isPastTrip) return 'complete';
  return 'active';
}

/**
 * Single Flight Leg Row - Compact display like BidPro
 * Fixed-width columns for DEP/ARR/BLK to ensure alignment
 * Shows LOCAL times based on origin/destination airport timezones
 */
function LegRow({ leg, index, position, airportDb }: { leg: BackendLeg; index: number; position: string | null; airportDb: AirportDb }) {
  const isDeadhead = leg.isDeadhead;
  const blockMinutes = leg.actualBlockMinutes || leg.plannedBlockMinutes || 0;
  // Use position from profile (F/O or CPT), default to F/O
  const positionDisplay = isDeadhead ? 'DH' : (position === 'CPT' ? 'CPT' : 'F/O');

  // Get LOCAL departure time (based on origin airport timezone)
  const depTimeLocal = formatTimeLocal(
    leg.actualOutISO || leg.scheduledOutISO,
    leg.origin,
    airportDb
  );

  // Get LOCAL arrival time (based on destination airport timezone)
  const arrTimeLocal = formatTimeLocal(
    leg.actualInISO || leg.scheduledInISO,
    leg.destination,
    airportDb
  );

  return (
    <View
      className={cn(
        'flex-row items-center py-2 px-3 border-b border-slate-800/50',
        isDeadhead && 'bg-orange-500/5'
      )}
    >
      {/* Flight Number + Aircraft Chip - Fixed width container */}
      <View className="w-[72px] flex-row items-center">
        <Text
          className={cn(
            'text-sm font-semibold',
            isDeadhead ? 'text-orange-400' : 'text-white'
          )}
          style={{ fontFamily: 'JetBrainsMono_400Regular' }}
          numberOfLines={1}
        >
          {leg.flightNumber || '----'}
        </Text>
        {/* Aircraft chip next to flight number - normalized to readable format */}
        {leg.equipment && (
          <View className="ml-1.5 bg-slate-700/70 px-1 py-0.5 rounded">
            <Text
              className="text-slate-400 text-[10px] font-bold"
              style={{ fontFamily: 'JetBrainsMono_400Regular' }}
            >
              {normalizeEquipment(leg.equipment)}
            </Text>
          </View>
        )}
      </View>

      {/* Position Badge - Fixed width */}
      <View className="w-10">
        <View
          className={cn(
            'px-1.5 py-0.5 rounded',
            isDeadhead ? 'bg-orange-500/20' : 'bg-slate-700/60'
          )}
        >
          <Text
            className={cn(
              'text-[9px] font-bold text-center',
              isDeadhead ? 'text-orange-400' : 'text-slate-400'
            )}
          >
            {positionDisplay}
          </Text>
        </View>
      </View>

      {/* Route: Origin → Destination - Flex to fill space, truncate if needed */}
      <View className="flex-row items-center flex-1 min-w-0">
        <Text
          className="text-cyan-400 text-sm font-bold"
          style={{ fontFamily: 'JetBrainsMono_400Regular' }}
          numberOfLines={1}
        >
          {leg.origin || '---'}
        </Text>
        <Plane
          size={12}
          color={isDeadhead ? '#f97316' : '#06b6d4'}
          style={{ marginHorizontal: 4, transform: [{ rotate: '90deg' }] }}
        />
        <Text
          className="text-cyan-400 text-sm font-bold"
          style={{ fontFamily: 'JetBrainsMono_400Regular' }}
          numberOfLines={1}
        >
          {leg.destination || '---'}
        </Text>
      </View>

      {/* Departure Time (LOCAL) - Fixed width */}
      <View className="w-12 items-end">
        <Text className="text-slate-300 text-xs" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
          {depTimeLocal}
        </Text>
      </View>

      {/* Arrival Time (LOCAL) - Fixed width */}
      <View className="w-12 items-end">
        <Text className="text-slate-300 text-xs" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
          {arrTimeLocal}
        </Text>
      </View>

      {/* Block Time - Fixed width, NO aircraft chip here */}
      <View className="w-12 items-end">
        <Text className="text-amber-400 text-xs font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
          {formatMinutesToTime(blockMinutes)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Duty Day Section - Shows all legs for a single day with header
 */
function DutyDaySection({
  dutyDay,
  dayIndex,
  totalDays,
  hourlyRateCents,
  position,
  airportDb,
  onPress,
}: {
  dutyDay: BackendDutyDay;
  dayIndex: number;
  totalDays: number;
  hourlyRateCents: number;
  position: string | null;
  airportDb: AirportDb;
  onPress?: () => void;
}) {
  const legs = [...dutyDay.legs].sort((a, b) => a.legIndex - b.legIndex);

  // Calculate credit: use day-level if > 0, otherwise sum from legs
  const dayLevelCredit = dutyDay.finalCreditMinutes || dutyDay.actualCreditMinutes || dutyDay.plannedCreditMinutes || 0;
  const legsSumCredit = legs.reduce((sum, leg) => {
    const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
    return sum + legCredit;
  }, 0);
  const creditMinutes = dayLevelCredit > 0 ? dayLevelCredit : legsSumCredit;

  // Calculate block: use day-level if > 0, otherwise sum from legs
  const dayLevelBlock = dutyDay.actualBlockMinutes || 0;
  const legsSumBlock = legs.reduce((sum, leg) => {
    const legBlock = (leg.actualBlockMinutes ?? 0) > 0 ? leg.actualBlockMinutes : (leg.plannedBlockMinutes ?? 0);
    return sum + legBlock;
  }, 0);
  const blockMinutes = dayLevelBlock > 0 ? dayLevelBlock : legsSumBlock;

  // Calculate duty time
  let dutyMinutes = 0;
  if (dutyDay.dutyStartISO && dutyDay.dutyEndISO) {
    const start = new Date(dutyDay.dutyStartISO);
    const end = new Date(dutyDay.dutyEndISO);
    dutyMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  }

  const payCents = Math.round((creditMinutes / 60) * hourlyRateCents);

  const handlePress = () => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  return (
    <Pressable onPress={handlePress} className="mb-1">
      {/* Day Header */}
      <View className="flex-row items-center justify-between bg-slate-800/80 px-3 py-2">
        <View className="flex-row items-center">
          <Calendar size={14} color="#f59e0b" />
          <Text className="text-amber-400 font-semibold text-sm ml-2">
            {formatDateWithDay(dutyDay.dutyDate)}
          </Text>
          <Text className="text-slate-500 text-xs ml-2">
            Day {dayIndex + 1}/{totalDays}
          </Text>
        </View>

        {/* Day Totals */}
        <View className="flex-row items-center">
          <Text className="text-slate-500 text-xs mr-1">BLK</Text>
          <Text className="text-amber-400 text-xs font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(blockMinutes)}
          </Text>
          <Text className="text-slate-600 mx-2">|</Text>
          <Text className="text-slate-500 text-xs mr-1">CR</Text>
          <Text className="text-white text-xs font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(creditMinutes)}
          </Text>
          {dutyMinutes > 0 && (
            <>
              <Text className="text-slate-600 mx-2">|</Text>
              <Text className="text-slate-500 text-xs mr-1">DTY</Text>
              <Text className="text-slate-300 text-xs" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
                {formatMinutesToTime(dutyMinutes)}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Column Headers - Fixed widths matching LegRow */}
      <View className="flex-row items-center bg-slate-900/80 px-3 py-1.5 border-b border-slate-700/50">
        <Text className="text-slate-600 text-[9px] uppercase w-[72px]">Flight</Text>
        <Text className="text-slate-600 text-[9px] uppercase w-10">Pos</Text>
        <Text className="text-slate-600 text-[9px] uppercase flex-1">Route</Text>
        <Text className="text-slate-600 text-[9px] uppercase w-12 text-right">Dep(L)</Text>
        <Text className="text-slate-600 text-[9px] uppercase w-12 text-right">Arr(L)</Text>
        <Text className="text-slate-600 text-[9px] uppercase w-12 text-right">Blk</Text>
      </View>

      {/* Legs */}
      {legs.length > 0 ? (
        legs.map((leg, idx) => <LegRow key={leg.id} leg={leg} index={idx} position={position} airportDb={airportDb} />)
      ) : (
        <View className="py-4 items-center">
          <Text className="text-slate-500 text-sm">No flights scheduled</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Layover Card - Shows LIVE countdown until next duty starts
 * Includes hotel and transportation info with call buttons
 *
 * Logic:
 * - If layover is in the FUTURE (hasn't started yet): Show original rest duration
 * - If layover is ACTIVE (currently in layover): Show live countdown until next duty
 * - If layover is PAST (already reported for next duty): Show 0:00 or "Complete"
 *
 * The countdown counts down to when the next duty day's first flight departs.
 */
function LayoverSection({
  station,
  restMinutes,
  hotelName,
  hotelPhone,
  transportNotes,
  transportPhone,
  nextDutyStartISO,
  prevDutyEndISO,
}: {
  station: string;
  restMinutes: number;
  hotelName?: string | null;
  hotelPhone?: string | null;
  transportNotes?: string | null;
  transportPhone?: string | null;
  nextDutyStartISO?: string | null;
  prevDutyEndISO?: string | null;
}) {
  // Use prevDutyEndISO + restMinutes as authoritative rest-end anchor.
  // Times without Z are stored as local station times; treat as-is (JS parses no-Z as local on iOS).
  // nextDutyStartISO may have incorrect dates from import, so we don't rely on it for countdown.
  const calculateRemaining = useCallback((): number => {
    if (!prevDutyEndISO) return restMinutes;
    const now = Date.now();
    const prevDutyEnd = new Date(prevDutyEndISO).getTime();
    if (isNaN(prevDutyEnd)) return restMinutes;
    const restEndMs = prevDutyEnd + restMinutes * 60 * 1000;
    if (now >= restEndMs) return 0; // Rest over → Complete
    if (now >= prevDutyEnd) {
      // In active layover — show live countdown
      return Math.floor((restEndMs - now) / 60000);
    }
    // Still in duty — show planned rest
    return restMinutes;
  }, [prevDutyEndISO, restMinutes]);

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

  const getColors = () => {
    if (isComplete) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: '#10b981' };
    if (isUrgent) return { bg: 'bg-red-500/20', text: 'text-red-400', icon: '#ef4444' };
    if (isWarning) return { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: '#f59e0b' };
    return { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '#3b82f6' };
  };

  const colors = getColors();
  const displayTime = isComplete ? 'Complete' : formatMinutesToTime(remainingMinutes);

  // Handle phone calls
  const handleCallHotel = () => {
    if (hotelPhone) {
      Linking.openURL(`tel:${hotelPhone}`);
    }
  };

  const handleCallTransport = () => {
    if (transportPhone) {
      Linking.openURL(`tel:${transportPhone}`);
    }
  };

  return (
    <View className="bg-slate-800/50 border-l-4 border-slate-600 mx-2 my-2 rounded-r-lg overflow-hidden">
      {/* Header with station and countdown */}
      <View className="flex-row items-center px-3 py-2">
        <Building2 size={14} color="#64748b" />
        <Text className="text-slate-400 text-sm font-semibold ml-2">
          Layover at {station}
        </Text>
        <View className="flex-1" />
        <View className={cn('flex-row items-center px-2 py-1 rounded', colors.bg)}>
          <Clock size={12} color={colors.icon} />
          <Text className={cn('text-xs font-bold ml-1', colors.text)}>
            {displayTime}
          </Text>
        </View>
      </View>

      {/* Rest Time label */}
      <View className="px-3 pb-1">
        <Text className="text-slate-500 text-[10px]">
          {isComplete ? 'Layover Complete' : 'Time Until Report'}
        </Text>
      </View>

      {/* Hotel Info with Call Button */}
      {hotelName && (
        <View className="mx-3 mb-2 bg-zinc-900/50 rounded-lg p-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <MapPin size={14} color="#f59e0b" />
              <Text className="text-amber-400 text-xs font-medium ml-1.5 flex-1" numberOfLines={1}>
                {hotelName}
              </Text>
            </View>
            {hotelPhone && (
              <Pressable
                onPress={handleCallHotel}
                className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg ml-2 active:opacity-70"
              >
                <Phone size={12} color="#10b981" />
                <Text className="text-emerald-400 text-[10px] font-semibold ml-1">Call</Text>
              </Pressable>
            )}
          </View>
          {hotelPhone && (
            <Pressable onPress={handleCallHotel} className="mt-1 active:opacity-70">
              <Text className="text-blue-400 text-[10px] underline">{hotelPhone}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Transport Info with Call Button */}
      {(transportNotes || transportPhone) && (
        <View className="mx-3 mb-2 bg-zinc-900/50 rounded-lg p-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <Car size={14} color="#60a5fa" />
              <Text className="text-blue-400 text-xs font-medium ml-1.5 flex-1" numberOfLines={1}>
                {transportNotes || 'Transportation'}
              </Text>
            </View>
            {transportPhone && (
              <Pressable
                onPress={handleCallTransport}
                className="flex-row items-center bg-emerald-500/20 px-2 py-1 rounded-lg ml-2 active:opacity-70"
              >
                <Phone size={12} color="#10b981" />
                <Text className="text-emerald-400 text-[10px] font-semibold ml-1">Call</Text>
              </Pressable>
            )}
          </View>
          {transportPhone && (
            <Pressable onPress={handleCallTransport} className="mt-1 active:opacity-70">
              <Text className="text-blue-400 text-[10px] underline">{transportPhone}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Trip Summary Footer - Totals like BidPro
 * Uses trip-level totals from backend, with fallback to computed from duty days
 * Est Pay always calculated from: PAY CREDIT Hours × User's Hourly Rate
 *
 * PHASE 5: Uses payCreditMinutes (max of protected, current) for pay calculations
 * This ensures pilots are NEVER paid less than their originally awarded credit.
 */
function TripSummaryFooter({
  trip,
  hourlyRateCents,
  payBreakdown,
}: {
  trip: BackendTrip;
  hourlyRateCents: number;
  payBreakdown?: TripPayBreakdown | null;
}) {
  // Use dutyDays if available, otherwise use tripDutyDays
  const dutyDays = trip.dutyDays ?? [];
  const tripDutyDays = trip.tripDutyDays ?? [];
  const effectiveDutyDays = dutyDays.length > 0 ? dutyDays : tripDutyDays;

  // Calculate totals - prioritize trip-level data (from upload/parse), fallback to summing duty days
  const totalBlockMinutes = useMemo(() => {
    // Use trip-level if available (from backend/upload)
    if (trip.totalBlockMinutes && trip.totalBlockMinutes > 0) {
      return trip.totalBlockMinutes;
    }
    // Fallback: sum from effective duty days
    return effectiveDutyDays.reduce((sum, dd: any) => {
      const dayBlock = dd.actualBlockMinutes || dd.blockMinutes || 0;
      // Also sum from legs if duty day total is 0
      if (dayBlock === 0 && dd.legs?.length > 0) {
        return sum + dd.legs.reduce((legSum: number, leg: any) => {
          const legBlock = (leg.actualBlockMinutes ?? 0) > 0 ? leg.actualBlockMinutes : (leg.plannedBlockMinutes ?? 0);
          return legSum + legBlock;
        }, 0);
      }
      return sum + dayBlock;
    }, 0);
  }, [trip.totalBlockMinutes, effectiveDutyDays]);

  // PHASE 5: Use payCreditMinutes for pay calculations
  // This is max(protected_credit, current_credit) - ensures pay protection
  const payCreditMinutes = useMemo(() => {
    // Priority 1: Use payCreditMinutes from backend (Phase 5 calculated value)
    if (trip.payCreditMinutes && trip.payCreditMinutes > 0) {
      return trip.payCreditMinutes;
    }
    // Fallback: Use totalCreditMinutes (pre-Phase 5 behavior)
    if (trip.totalCreditMinutes && trip.totalCreditMinutes > 0) {
      return trip.totalCreditMinutes;
    }
    // Last fallback: sum from effective duty days, using leg-level credit if day-level is 0
    return effectiveDutyDays.reduce((sum, dd: any) => {
      const dayCredit = dd.finalCreditMinutes || dd.actualCreditMinutes || dd.plannedCreditMinutes || dd.creditMinutes || 0;
      if (dayCredit > 0) {
        return sum + dayCredit;
      }
      // Sum from legs if day-level credit is 0
      const legsCredit = (dd.legs ?? []).reduce((legSum: number, leg: any) => {
        const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
        return legSum + legCredit;
      }, 0);
      return sum + legsCredit;
    }, 0);
  }, [trip.payCreditMinutes, trip.totalCreditMinutes, effectiveDutyDays]);

  // Display credit (current roster credit for display)
  const displayCreditMinutes = useMemo(() => {
    if (trip.totalCreditMinutes && trip.totalCreditMinutes > 0) {
      return trip.totalCreditMinutes;
    }
    // Fallback: sum from duty days, using leg-level credit if day-level is 0
    return effectiveDutyDays.reduce((sum, dd: any) => {
      const dayCredit = dd.finalCreditMinutes || dd.actualCreditMinutes || dd.plannedCreditMinutes || dd.creditMinutes || 0;
      if (dayCredit > 0) {
        return sum + dayCredit;
      }
      // Sum from legs if day-level credit is 0
      const legsCredit = (dd.legs ?? []).reduce((legSum: number, leg: any) => {
        const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
        return legSum + legCredit;
      }, 0);
      return sum + legsCredit;
    }, 0);
  }, [trip.totalCreditMinutes, effectiveDutyDays]);

  // PHASE 5: Est Pay = PAY CREDIT Hours × Hourly Rate
  // When payBreakdown is available (has premiums applied), use it; otherwise use raw trip data
  const totalPayCents = useMemo(() => {
    // If payBreakdown has premiums, trust it completely
    if (payBreakdown && payBreakdown.appliedRules.length > 0) {
      return payBreakdown.totalPayCents;
    }
    // If backend already calculated pay and it matches expected, use it
    if (trip.totalPayCents && trip.totalPayCents > 0) {
      const calculatedPay = Math.round((payCreditMinutes / 60) * hourlyRateCents);
      const diff = Math.abs(trip.totalPayCents - calculatedPay);
      if (diff < calculatedPay * 0.01) {
        return trip.totalPayCents;
      }
    }
    return Math.round((payCreditMinutes / 60) * hourlyRateCents);
  }, [payBreakdown, trip.totalPayCents, payCreditMinutes, hourlyRateCents]);

  // Effective pay credit minutes — includes premium delta when applied
  const effectivePayCreditMinutes = useMemo(() => {
    if (payBreakdown && payBreakdown.appliedRules.length > 0) {
      return payBreakdown.totalCreditMinutes;
    }
    return payCreditMinutes;
  }, [payBreakdown, payCreditMinutes]);

  // Check if pay protection is active (current < protected)
  const isPayProtected = useMemo(() => {
    const protected_ = trip.protectedCreditMinutes ?? 0;
    const current = trip.currentCreditMinutes ?? trip.totalCreditMinutes ?? 0;
    return protected_ > 0 && current < protected_;
  }, [trip.protectedCreditMinutes, trip.currentCreditMinutes, trip.totalCreditMinutes]);

  // Calculate TAFB (Time Away From Base) - prefer stored value, fallback to computation
  const tafbMinutes = useMemo(() => {
    // Priority 1: Use stored totalTafbMinutes from backend (most accurate)
    if ((trip as any).totalTafbMinutes && (trip as any).totalTafbMinutes > 0) {
      return (trip as any).totalTafbMinutes as number;
    }

    const sortedDays = [...effectiveDutyDays].sort((a: any, b: any) => a.dutyDate.localeCompare(b.dutyDate));

    // Get all legs across all duty days, sorted by time
    const allLegs = sortedDays.flatMap((dd: any) => dd.legs || []);
    if (allLegs.length === 0) {
      // No legs - estimate from trip dates (number of days × 24 hours)
      if (trip.startDate && trip.endDate) {
        const start = new Date(trip.startDate);
        const end = new Date(trip.endDate);
        const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        // Rough TAFB estimate: days × 24 hours
        return days * 24 * 60;
      }
      return 0;
    }

    // Find first departure and last arrival times
    let firstDeparture: Date | null = null;
    let lastArrival: Date | null = null;

    for (const leg of allLegs) {
      const depTime = leg.actualOutISO || leg.scheduledOutISO;
      const arrTime = leg.actualInISO || leg.scheduledInISO;

      if (depTime) {
        const dep = new Date(depTime);
        if (!firstDeparture || dep < firstDeparture) {
          firstDeparture = dep;
        }
      }

      if (arrTime) {
        const arr = new Date(arrTime);
        if (!lastArrival || arr > lastArrival) {
          lastArrival = arr;
        }
      }
    }

    // Calculate TAFB from first departure to last arrival
    if (firstDeparture && lastArrival) {
      return Math.round((lastArrival.getTime() - firstDeparture.getTime()) / 60000);
    }

    // Fallback: use duty day start/end times
    const firstDay = sortedDays[0] as any;
    const lastDay = sortedDays[sortedDays.length - 1] as any;

    // Handle both dutyDays (dutyStartISO/dutyEndISO) and tripDutyDays (reportTimeISO/releaseTimeISO) schemas
    const firstDayStartISO = firstDay?.dutyStartISO || firstDay?.reportTimeISO;
    const lastDayEndISO = lastDay?.dutyEndISO || lastDay?.releaseTimeISO;

    if (firstDayStartISO && lastDayEndISO) {
      const start = new Date(firstDayStartISO);
      const end = new Date(lastDayEndISO);
      return Math.round((end.getTime() - start.getTime()) / 60000);
    }

    // Last fallback: estimate from dates
    if (trip.startDate && trip.endDate) {
      const days = Math.ceil(
        (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
      return days * 24 * 60;
    }

    return 0;
  }, [effectiveDutyDays, trip.startDate, trip.endDate]);

  // Determine if trip is international (OCONUS) by checking leg destinations
  const isInternational = useMemo(() => {
    // Check all legs across all duty days for international destinations
    for (const dd of effectiveDutyDays) {
      const legs = (dd as any).legs ?? [];
      for (const leg of legs) {
        if (isInternationalDestination(leg.origin, leg.destination)) {
          return true;
        }
      }
    }
    return false;
  }, [effectiveDutyDays]);

  // Per diem calculation
  // Domestic: $3.50/hr TAFB
  // International: $4.20/hr TAFB (default for non-region-specific)
  const perDiemRate = isInternational ? PER_DIEM_INTERNATIONAL_CENTS_PER_HOUR : PER_DIEM_DOMESTIC_CENTS_PER_HOUR;
  const perDiemCents = Math.round((tafbMinutes / 60) * perDiemRate);

  // Duty days count - use actual data from effectiveDutyDays
  const dutyDayCount = effectiveDutyDays.length > 0 ? effectiveDutyDays.length :
    (trip.startDate && trip.endDate ?
      Math.ceil((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1 :
      0);

  return (
    <View className="bg-slate-800/80 rounded-b-xl border-t border-slate-700/50">
      {/* Summary Row */}
      <View className="flex-row items-center justify-between px-3 py-3">
        <View className="items-center flex-1">
          <Text className="text-slate-500 text-[9px] uppercase mb-1">Credit</Text>
          <Text className="text-cyan-400 text-sm font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(displayCreditMinutes)}
          </Text>
        </View>

        <View className="h-6 w-px bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text className="text-slate-500 text-[9px] uppercase mb-1">Block</Text>
          <Text className="text-amber-400 text-sm font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(totalBlockMinutes)}
          </Text>
        </View>

        <View className="h-6 w-px bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text className="text-slate-500 text-[9px] uppercase mb-1">Per Diem</Text>
          <Text className="text-slate-300 text-sm font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatCentsToCurrency(perDiemCents)}
          </Text>
        </View>

        <View className="h-6 w-px bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text className="text-slate-500 text-[9px] uppercase mb-1">TAFB</Text>
          <Text className="text-slate-300 text-sm font-semibold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
            {formatMinutesToTime(tafbMinutes)}
          </Text>
        </View>

        <View className="h-6 w-px bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text className="text-slate-500 text-[9px] uppercase mb-1">Days</Text>
          <Text className="text-white text-sm font-bold">
            {dutyDayCount}
          </Text>
        </View>
      </View>

      {/* PHASE 6: Pay Credit Display - MANDATORY, always prominent */}
      {/* Shows: Est. Pay (large), with subline: "Original: HH:MM | Current: HH:MM | Pay Credit: HH:MM" */}
      <View className="bg-emerald-500/10 px-3 py-3 rounded-b-xl border-t border-emerald-500/20">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <View className="flex-row items-center mb-1">
              <Shield size={14} color="#10b981" />
              <Text className="text-emerald-400 text-sm font-bold ml-1.5">Est. Pay</Text>
              {isPayProtected && (
                <View className="bg-emerald-500/30 px-1.5 py-0.5 rounded ml-2">
                  <Text className="text-emerald-300 text-[9px] font-bold">PROTECTED</Text>
                </View>
              )}
            </View>
            {/* Subline showing Original | Premium Delta | Pay Credit breakdown */}
            <Text className="text-emerald-400/60 text-[10px]" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
              Base: {formatMinutesToTime(payCreditMinutes)}
              {payBreakdown && payBreakdown.premiumCreditMinutes > 0
                ? ` + ${formatMinutesToTime(payBreakdown.premiumCreditMinutes)} premium`
                : ''}
              {' '}→ {formatMinutesToTime(effectivePayCreditMinutes)} credit
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-emerald-400 text-2xl font-bold" style={{ fontFamily: 'JetBrainsMono_400Regular' }}>
              {formatCentsToCurrency(totalPayCents)}
            </Text>
            <Text className="text-emerald-400/70 text-xs mt-0.5">
              {formatMinutesToTime(effectivePayCreditMinutes)} credit
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Main Trip Breakdown Card
 * Phase 6: Enhanced with roster change status, pay credit display, and review required banner
 */
export const TripBreakdownCard = memo(function TripBreakdownCard({
  trip,
  onPress,
  onDelete,
  onReviewPress,
  onMarkSick,
  onLogEvent,
  index = 0,
  defaultExpanded = true,
  protectedCreditMinutes,
  isPayProtected = false,
}: TripBreakdownCardProps & { defaultExpanded?: boolean }) {
  const hourlyRateCents = useHourlyRateCents();
  const position = usePosition();
  const { airportDb } = useAirportDb();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showPremiumPicker, setShowPremiumPicker] = useState(false);
  // Ref to block the GestureDetector tap when the + button is pressed
  const premiumPickerPressedRef = useRef(false);

  // Trip pay engine: get live pay state from log events
  const { data: payBreakdown, refetch: refetchPayBreakdown } = useTripPayBreakdown(trip.id, true);
  const tripPayState: TripPayState = payBreakdown?.tripPayState ?? 'normal';

  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);
  const translateX = useSharedValue(0);
  const deleteOpacity = useSharedValue(0);

  // Normalize duty days: use dutyDays if available, otherwise convert tripDutyDays
  // This handles the case where schedule parsing populates tripDutyDays but not dutyDays
  const dutyDays = useMemo(() => {
    // Check if dutyDays has data
    const standardDutyDays = trip.dutyDays ?? [];
    if (standardDutyDays.length > 0) {
      return [...standardDutyDays].sort((a, b) => a.dutyDate.localeCompare(b.dutyDate));
    }

    // Fall back to tripDutyDays (canonical format)
    const canonicalDays = trip.tripDutyDays ?? [];
    if (canonicalDays.length === 0) {
      return [];
    }

    // Convert tripDutyDays to dutyDays format for rendering
    const convertedDays: BackendDutyDay[] = canonicalDays.map((tdd) => {
      // Convert legs from TripDutyLeg to BackendLeg format
      const convertedLegs: BackendLeg[] = (tdd.legs ?? []).map((leg, idx) => ({
        id: leg.id,
        dutyDayId: tdd.id,
        legIndex: leg.legIndex ?? idx,
        flightNumber: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        equipment: leg.equipment,
        tailNumber: null,
        isDeadhead: leg.isDeadhead ?? false,
        scheduledOutISO: leg.scheduledOutISO,
        scheduledInISO: leg.scheduledInISO,
        plannedBlockMinutes: leg.plannedBlockMinutes ?? 0,
        plannedCreditMinutes: leg.plannedCreditMinutes ?? 0,
        actualOutISO: leg.actualOutISO,
        actualOffISO: leg.actualOffISO,
        actualOnISO: leg.actualOnISO,
        actualInISO: leg.actualInISO,
        actualFlightMinutes: 0,
        actualBlockMinutes: leg.actualBlockMinutes ?? 0,
        creditMinutes: leg.creditMinutes ?? 0,
        premiumCode: leg.premiumCode,
        premiumAmountCents: leg.premiumAmountCents ?? 0,
        calculatedPayCents: 0,
        source: 'import',
        ooiProofUri: null,
        ooiProofTimestamp: null,
        wasEdited: false,
        editedAt: null,
        needsReview: false,
        notes: null,
        createdAt: '',
        updatedAt: '',
      }));

      return {
        id: tdd.id,
        tripId: trip.id,
        dutyDate: tdd.dutyDate,
        dutyStartISO: tdd.reportTimeISO,
        dutyEndISO: tdd.releaseTimeISO,
        plannedCreditMinutes: tdd.creditMinutes ?? 0,
        actualBlockMinutes: tdd.blockMinutes ?? 0,
        actualCreditMinutes: tdd.creditMinutes ?? 0,
        finalCreditMinutes: tdd.creditMinutes ?? 0,
        minCreditMinutes: 360, // 6 hour minimum
        totalPayCents: 0,
        proofCount: 0,
        hasAllActuals: false,
        hasPartialActuals: false,
        hasScheduleChange: tdd.hasScheduleChange ?? false,
        scheduleChangeAt: tdd.scheduleChangeAt,
        scheduleChangeReason: tdd.scheduleChangeReason,
        scheduleChangeNotes: tdd.scheduleChangeNotes,
        originalData: tdd.originalData,
        hasOverride: tdd.hasOverride ?? false,
        overrideAt: tdd.overrideAt,
        overrideReason: tdd.overrideReason,
        overridePersist: tdd.overridePersist ?? false,
        premiumCode: tdd.premiumCode,
        premiumCreditMinutes: tdd.premiumCreditMinutes ?? 0,
        premiumPayCents: tdd.premiumPayCents ?? 0,
        premiumAppliedAt: tdd.premiumAppliedAt,
        createdAt: '',
        updatedAt: '',
        legs: convertedLegs,
      } as BackendDutyDay;
    });

    return convertedDays.sort((a, b) => a.dutyDate.localeCompare(b.dutyDate));
  }, [trip.dutyDays, trip.tripDutyDays, trip.id]);

  const status = getTripStatus(trip);
  const statusColors = STATUS_COLORS[status];

  // Get first and last leg for quick route display
  const firstLeg = dutyDays[0]?.legs[0];
  const lastDay = dutyDays[dutyDays.length - 1];
  const lastLeg = lastDay?.legs[lastDay.legs.length - 1];

  // Equipment from any leg - normalized to readable format (e.g., 76P → 767)
  // Fall back to trip baseFleet if no leg has equipment
  const rawEquipment = dutyDays.flatMap(d => d.legs).find(l => l.equipment)?.equipment
    || ((trip as any).baseFleet ? (trip as any).baseFleet.replace(/^[A-Z]{3}\s+/, '') : undefined);
  const equipment = normalizeEquipment(rawEquipment);

  // Compute trip sick status for badge display
  const tripSickStatus = getTripSickStatus(trip);

  // Calculate credit delta for badge display
  const currentCreditMinutes = trip.totalCreditMinutes ?? 0;
  const hasPayProtection = protectedCreditMinutes !== undefined && protectedCreditMinutes > 0;
  const creditDelta = hasPayProtection ? currentCreditMinutes - protectedCreditMinutes : 0;

  // ============================================
  // PHASE 6: Roster Change State
  // ============================================
  // Determine if roster has changes and acknowledgment is required
  const changeSeverity = (trip as any).changeSeverity as string | undefined;
  const acknowledgmentRequired = (trip as any).acknowledgmentRequired as boolean | undefined;
  const acknowledgedAt = (trip as any).acknowledgedAt as string | undefined;

  // Trip status tag: "Original" (no changes), "Updated" (has changes)
  const hasRosterChanges = changeSeverity && changeSeverity !== 'none';
  const tripStatusTag = hasRosterChanges ? 'Updated' : 'Original';

  // Should show review required banner
  const showReviewRequiredBanner = acknowledgmentRequired && !acknowledgedAt;

  // Get protected credit from trip model (Phase 5)
  const tripProtectedCredit = (trip as any).protectedCreditMinutes as number | undefined ?? 0;
  const tripCurrentCredit = (trip as any).currentCreditMinutes as number | undefined ?? trip.totalCreditMinutes ?? 0;
  const tripPayCredit = (trip as any).payCreditMinutes as number | undefined ?? Math.max(tripProtectedCredit, tripCurrentCredit);

  const handleTap = () => {
    // Block the gesture tap if the premium picker button was just pressed
    if (premiumPickerPressedRef.current) {
      premiumPickerPressedRef.current = false;
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const handleReviewTap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReviewPress?.();
  };

  const handleExpand = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsExpanded(!isExpanded);
  };

  const handleDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Reset swipe position immediately
    translateX.value = withSpring(0);
    deleteOpacity.value = withTiming(0);
    // Call parent's delete handler which shows the confirmation alert
    onDelete?.();
  };

  // Swipe gesture for delete
  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((event) => {
      'worklet';
      // Only allow swiping left (negative values)
      if (event.translationX < 0) {
        translateX.value = Math.max(event.translationX, -100);
        deleteOpacity.value = Math.min(Math.abs(event.translationX) / 100, 1);
      }
    })
    .onEnd((event) => {
      'worklet';
      // If swiped far enough, show delete action
      if (event.translationX < -60) {
        translateX.value = withSpring(-80);
        deleteOpacity.value = withTiming(1);
      } else {
        translateX.value = withSpring(0);
        deleteOpacity.value = withTiming(0);
      }
    });

  const tapGesture = Gesture.Tap()
    .onBegin(() => {
      'worklet';
      scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
      pressed.value = withTiming(1, { duration: 100 });
    })
    .onFinalize(() => {
      'worklet';
      scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      pressed.value = withTiming(0, { duration: 150 });
    });

  // Only use pan gesture in GestureDetector (for swipe-to-delete)
  // Card tap is handled by a Pressable wrapping the card body — this avoids
  // the + button firing the gesture and opening trip detail simultaneously.
  const combinedGesture = onDelete
    ? Gesture.Simultaneous(panGesture, tapGesture)
    : panGesture;

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: translateX.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: pressed.value * 0.3,
  }));

  const deleteButtonStyle = useAnimatedStyle(() => ({
    opacity: deleteOpacity.value,
    transform: [{ scale: 0.8 + deleteOpacity.value * 0.2 }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 100).springify()}
      className="mb-4"
    >
      {/* Premium Picker Modal - opens directly without navigation */}
      <PremiumPickerModal
        visible={showPremiumPicker}
        tripContext={{
          tripId: trip.id,
          tripNumber: trip.tripNumber ?? null,
          baseCreditMinutes: payBreakdown?.baseCreditMinutes ?? (trip.payCreditMinutes ?? trip.totalCreditMinutes ?? 0),
          basePayCents: payBreakdown?.basePayCents ?? Math.round(((trip.payCreditMinutes ?? trip.totalCreditMinutes ?? 0) / 60) * hourlyRateCents),
          startDate: trip.startDate ?? undefined,
          endDate: trip.endDate ?? undefined,
        }}
        hourlyRateCents={hourlyRateCents}
        onClose={() => setShowPremiumPicker(false)}
        onApplied={() => {
          // Don't close — user may want to apply more premiums
          // Just refetch so card reflects latest pay state
          refetchPayBreakdown();
        }}
      />

      {/* Delete Button Background (revealed on swipe) */}
      {onDelete && (
        <Animated.View
          style={[
            deleteButtonStyle,
            {
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 80,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: '#ef4444',
              borderRadius: 16,
            },
          ]}
        >
          <Pressable
            onPress={handleDelete}
            className="flex-1 w-full items-center justify-center"
          >
            <Trash2 size={24} color="#fff" />
            <Text className="text-white text-xs font-semibold mt-1">Delete</Text>
          </Pressable>
        </Animated.View>
      )}

      <GestureDetector gesture={combinedGesture}>
        <Animated.View style={[cardStyle, (status === 'dropped' || status === 'company_removed') ? { opacity: 0.6 } : {}]}>
          <Pressable
            onPress={() => {
              // Only open trip detail if picker is NOT showing
              if (!showPremiumPicker) {
                handleTap();
              }
            }}
            style={{ borderRadius: 16, overflow: 'hidden' }}
          >
          <View
            className={cn(
              "bg-slate-900/90 rounded-2xl overflow-hidden",
              status === 'dropped'
                ? "border border-red-500/30 bg-red-950/10"
                : status === 'company_removed'
                  ? "border border-amber-500/30 bg-amber-950/10"
                  : tripSickStatus === 'SIK'
                ? "border-2 border-red-500/60 bg-red-950/30"
                : tripPayState === 'needs_review'
                  ? "border-2 border-red-400/60"
                  : tripPayState === 'premium_applied'
                    ? "border-2 border-purple-400/60"
                    : tripPayState === 'event_logged'
                      ? "border-2 border-amber-400/60"
                      : "border border-slate-700/60"
            )}
          >
            {/* Glow effect on press */}
            <Animated.View
              style={[glowStyle, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}
            >
              <LinearGradient
                colors={[statusColors.accent + '20', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1 }}
              />
            </Animated.View>

            {/* Status Accent Line */}
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                backgroundColor: tripSickStatus === 'SIK'
                  ? '#ef4444'
                  : tripPayState === 'needs_review'
                    ? '#f87171'
                    : tripPayState === 'premium_applied'
                      ? '#a855f7'
                      : tripPayState === 'event_logged'
                        ? '#f59e0b'
                        : (showReviewRequiredBanner ? '#f59e0b' : statusColors.accent),
                borderTopLeftRadius: 16,
                borderBottomLeftRadius: 16,
              }}
            />

            {/* PHASE 6: Review Required Banner */}
            {showReviewRequiredBanner && (
              <Pressable
                onPress={handleReviewTap}
                className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2.5 active:bg-amber-500/30"
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <FileWarning size={16} color="#f59e0b" />
                    <View className="ml-2 flex-1">
                      <Text className="text-amber-400 text-sm font-semibold">
                        Roster Change Detected — Review Required
                      </Text>
                      <Text className="text-amber-400/70 text-xs mt-0.5">
                        Tap to review changes before applying
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center bg-amber-500/30 px-2.5 py-1.5 rounded-lg ml-2">
                    <Eye size={14} color="#f59e0b" />
                    <Text className="text-amber-400 text-xs font-semibold ml-1">Review</Text>
                  </View>
                </View>
              </Pressable>
            )}

            {/* Trip Header - Horizontally scrollable for many badges, + button pinned right */}
            <View className="px-4 py-3 border-b border-slate-800/80">
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ alignItems: 'center' }}
                style={{ flex: 1 }}
              >
                <View className="flex-row items-center">
                  {/* Trip Info - Left side badges */}
                  <View className="bg-slate-800/80 px-3 py-1.5 rounded-lg mr-2">
                    <Text
                      className="text-white font-bold text-base"
                      style={{ fontFamily: 'JetBrainsMono_400Regular', letterSpacing: 1 }}
                    >
                      {trip.tripNumber || 'TRIP'}
                    </Text>
                  </View>

                  {/* PHASE 6: Original/Updated Status Tag */}
                  <View className={cn(
                    'px-2 py-1 rounded mr-2',
                    hasRosterChanges ? 'bg-amber-500/20' : 'bg-slate-700/60'
                  )}>
                    <Text className={cn(
                      'text-xs font-semibold',
                      hasRosterChanges ? 'text-amber-400' : 'text-slate-400'
                    )}>
                      {tripStatusTag}
                    </Text>
                  </View>

                  {/* Base */}
                  <View className="bg-cyan-500/20 px-2 py-1 rounded mr-2">
                    <Text className="text-cyan-400 text-xs font-semibold">
                      {firstLeg?.origin || 'SDF'}
                    </Text>
                  </View>

                  {/* Equipment */}
                  {equipment && (
                    <View className="bg-slate-700/60 px-2 py-1 rounded mr-2">
                      <Text className="text-slate-400 text-xs">{equipment}</Text>
                    </View>
                  )}

                  {/* SIK Badge - Shows if any leg is marked sick */}
                  <TripSikBadge status={tripSickStatus} />

                  {/* Schedule Change/Override/Premium Status Badges */}
                  {(() => {
                    // Check if any duty day has changes
                    const hasOverride = dutyDays.some(dd => dd.hasOverride);
                    const hasScheduleChange = dutyDays.some(dd => dd.hasScheduleChange);
                    const hasPremium = dutyDays.some(dd => dd.premiumCode);

                    return (
                      <>
                        {hasOverride && (
                          <View className="flex-row items-center bg-violet-500/20 px-1.5 py-0.5 rounded mr-2">
                            <Lock size={10} color="#8b5cf6" />
                            <Text className="text-violet-400 text-[10px] font-bold ml-0.5">OVERRIDE</Text>
                          </View>
                        )}
                        {hasScheduleChange && !hasOverride && (
                          <View className="flex-row items-center bg-amber-500/20 px-1.5 py-0.5 rounded mr-2">
                            <RefreshCw size={10} color="#f59e0b" />
                            <Text className="text-amber-400 text-[10px] font-bold ml-0.5">CHANGED</Text>
                          </View>
                        )}
                        {hasPremium && (
                          <View className="flex-row items-center bg-emerald-500/20 px-1.5 py-0.5 rounded mr-2">
                            <DollarSign size={10} color="#10b981" />
                            <Text className="text-emerald-400 text-[10px] font-bold ml-0.5">PREMIUM</Text>
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {/* Pay State Chips - from log events pay engine */}
                  {tripPayState === 'event_logged' && (
                    <View className="flex-row items-center bg-amber-500/20 px-1.5 py-0.5 rounded mr-2">
                      <FileCheck size={10} color="#f59e0b" />
                      <Text className="text-amber-400 text-[10px] font-bold ml-0.5">EVENT LOGGED</Text>
                    </View>
                  )}
                  {tripPayState === 'premium_applied' && payBreakdown?.appliedRules && payBreakdown.appliedRules.length > 0 && (
                    <>
                      {payBreakdown.appliedRules.map((rule, rIdx) => {
                        const chipLabel = rule.premiumCode
                          ? rule.creditDeltaMinutes > 0
                            ? `${rule.premiumCode} +${formatMinutesToTime(rule.creditDeltaMinutes)}`
                            : rule.payDeltaCents > 0
                              ? `${rule.premiumCode} ${((1 + rule.payDeltaCents / Math.max(payBreakdown.basePayCents, 1)) * 100).toFixed(0)}%`
                              : rule.premiumCode
                          : 'Premium';
                        return (
                          <View key={rIdx} className="flex-row items-center bg-purple-500/20 px-1.5 py-0.5 rounded mr-2">
                            <Zap size={10} color="#a855f7" />
                            <Text className="text-purple-400 text-[10px] font-bold ml-0.5">{chipLabel}</Text>
                          </View>
                        );
                      })}
                    </>
                  )}
                  {tripPayState === 'needs_review' && (
                    <View className="flex-row items-center bg-red-500/20 px-1.5 py-0.5 rounded mr-2">
                      <AlertTriangle size={10} color="#f87171" />
                      <Text className="text-red-400 text-[10px] font-bold ml-0.5">NEEDS REVIEW</Text>
                    </View>
                  )}

                  {/* Credit Delta Badge - Shows when pay protection is active */}
                  {hasPayProtection && creditDelta !== 0 && (
                    <View className="mr-2">
                      <CreditDeltaBadge
                        currentCreditMinutes={currentCreditMinutes}
                        protectedCreditMinutes={protectedCreditMinutes!}
                        isPayProtected={isPayProtected}
                        hourlyRateCents={hourlyRateCents}
                      />
                    </View>
                  )}

                  {/* Status Badge */}
                  <View
                    className="px-2.5 py-1 rounded-full flex-row items-center mr-2"
                    style={{ backgroundColor: statusColors.bg }}
                  >
                    {status === 'verified' && <CheckCircle2 size={12} color={statusColors.accent} />}
                    {status === 'needs_review' && <AlertTriangle size={12} color={statusColors.accent} />}
                    <Text className="text-xs font-semibold ml-1" style={{ color: statusColors.accent }}>
                      {statusColors.label}
                    </Text>
                  </View>

                  {/* Mark Sick Button - Red/White icon with confirmation */}
                  {onMarkSick && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        Alert.alert(
                          'Mark Trip as Sick?',
                          'This will mark the entire trip as sick (SIK) and log it as an event. This action can be undone later.',
                          [
                            {
                              text: 'Cancel',
                              style: 'cancel',
                            },
                            {
                              text: 'Yes, Mark Sick',
                              style: 'destructive',
                              onPress: () => {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                onMarkSick();
                              },
                            },
                          ],
                          { cancelable: true }
                        );
                      }}
                      className="p-1.5 mr-2 rounded-lg bg-red-500/10 active:bg-red-500/20"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Heart size={16} color="#ef4444" fill="white" />
                    </Pressable>
                  )}

                  {/* Delete Button */}
                  {onDelete && (
                    <Pressable
                      onPress={handleDelete}
                      className="p-1.5 mr-2 rounded-lg bg-red-500/10 active:bg-red-500/20"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={16} color="#ef4444" />
                    </Pressable>
                  )}

                  <Pressable onPress={handleExpand} className="p-1 active:opacity-70">
                    {isExpanded ? (
                      <ChevronDown size={20} color="#64748b" />
                    ) : (
                      <ChevronRight size={20} color="#64748b" />
                    )}
                  </Pressable>
                </View>
              </ScrollView>

              {/* + Apply Premium Button — PINNED right, always visible no matter how many chips */}
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  premiumPickerPressedRef.current = true;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowPremiumPicker(true);
                }}
                style={{ position: 'relative', marginLeft: 6 }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <View style={{
                  padding: 7, borderRadius: 10,
                  backgroundColor: 'rgba(139,92,246,0.18)',
                  borderWidth: 1, borderColor: 'rgba(139,92,246,0.4)',
                }}>
                  <Plus size={16} color="#a855f7" />
                </View>
                {/* Badge: count of premiums already applied */}
                {(payBreakdown?.appliedRules?.length ?? 0) > 0 && (
                  <View style={{
                    position: 'absolute', top: -5, right: -5,
                    backgroundColor: '#7c3aed', borderRadius: 9,
                    minWidth: 17, height: 17,
                    alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 3,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                      {payBreakdown!.appliedRules.length}
                    </Text>
                  </View>
                )}
              </Pressable>
              </View>

            {/* Quick Route Summary (collapsed view) */}
            {!isExpanded && (
                <View className="flex-row items-center mt-3">
                  <Text className="text-white text-2xl font-bold" style={{ fontFamily: 'DMSans_700Bold' }}>
                    {firstLeg?.origin || '---'}
                  </Text>
                  <View className="flex-row items-center mx-3">
                    <View className="w-2 h-2 rounded-full border-2 border-cyan-500/60" />
                    <View className="w-8 h-0.5 bg-cyan-500/40 mx-1" />
                    <Plane size={14} color="#06b6d4" style={{ transform: [{ rotate: '90deg' }] }} />
                    <View className="w-8 h-0.5 bg-cyan-500/40 mx-1" />
                    <View className="w-2 h-2 rounded-full bg-cyan-500/60" />
                  </View>
                  <Text className="text-white text-2xl font-bold" style={{ fontFamily: 'DMSans_700Bold' }}>
                    {lastLeg?.destination || '---'}
                  </Text>
                  <View className="flex-1" />
                  <Text className="text-slate-400 text-sm">
                    {dutyDays.length} day{dutyDays.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>

            {/* Expanded Content: Full Trip Breakdown */}
            {isExpanded && (
              <View>
                {dutyDays.map((dutyDay, dayIndex) => {
                  // Determine home base from trip's first leg origin
                  const homeBase = dutyDays[0]?.legs?.[0]?.origin ?? null;

                  // Previous duty day (if exists)
                  const prevDay = dayIndex > 0 ? dutyDays[dayIndex - 1] : null;

                  // Check if we should show layover before this duty day
                  // Layover = overnight rest between duty days
                  // Only show when: previous day exists, both have legs, and it's a valid overnight rest
                  const showLayover = prevDay && shouldShowLayover(
                    prevDay,
                    dutyDay,
                    dayIndex === dutyDays.length - 1, // isLastDay
                    homeBase
                  );

                  // Get layover station (where previous day ended)
                  const prevDayLegs = prevDay?.legs ?? [];
                  const sortedPrevLegs = [...prevDayLegs].sort((a, b) => a.legIndex - b.legIndex);
                  const lastLegPrev = sortedPrevLegs[sortedPrevLegs.length - 1];
                  const layoverStation = lastLegPrev?.destination;

                  // First check tripDutyDays for canonical layover data (has hotel info from parsing)
                  // tripDutyDays is the authoritative source for layover/hotel data
                  // The layover is attached to the duty day AFTER which it occurs
                  // So for layover between day 0 and day 1, we look for tripDutyDays[0].layover
                  // Match by date first (most reliable), then by index, then by station
                  const prevDayDate = prevDay?.dutyDate;
                  const canonicalDutyDay = trip.tripDutyDays?.find(tdd =>
                    // Try matching by date first
                    (prevDayDate && tdd.dutyDate === prevDayDate) ||
                    // Fallback: match by station in layover
                    (tdd.layover?.station === layoverStation) ||
                    // Fallback: match by layoverStation field
                    (tdd.layoverStation === layoverStation)
                  );
                  const canonicalLayover = canonicalDutyDay?.layover;

                  // Find LAYOVER event from trip events (authoritative rest time from OCR)
                  // Strategy 1: Match by station (most accurate)
                  // Strategy 2: If no station match, get Nth LAYOVER event by order (dayIndex - 1)
                  // LAYOVER events are created in order during parsing, so index matches duty day gaps
                  const allLayoverEvents = trip.events?.filter(e => e.eventType === 'LAYOVER') ?? [];
                  let layoverEvent = layoverStation
                    ? allLayoverEvents.find(e => e.station === layoverStation || e.depAirport === layoverStation)
                    : null;

                  // Fallback: if no station match, use positional matching
                  // dayIndex 1 means layover after duty day 0 → LAYOVER event index 0
                  if (!layoverEvent && dayIndex > 0 && allLayoverEvents.length >= dayIndex) {
                    layoverEvent = allLayoverEvents[dayIndex - 1] ?? null;
                  }

                  // Find hotel info - check tripDutyDays canonical layover FIRST (authoritative)
                  // Then check HOTEL event, then LAYOVER event
                  const allHotelEvents = trip.events?.filter(e => e.eventType === 'HOTEL') ?? [];
                  let hotelEvent = layoverStation
                    ? allHotelEvents.find(e => e.station === layoverStation)
                    : null;
                  // Fallback: use positional matching for hotels too
                  if (!hotelEvent && dayIndex > 0 && allHotelEvents.length >= dayIndex) {
                    hotelEvent = allHotelEvents[dayIndex - 1] ?? null;
                  }

                  // Get transport info from TRANSPORT events
                  const allTransportEvents = trip.events?.filter(e => e.eventType === 'TRANSPORT') ?? [];
                  let transportEvent = layoverStation
                    ? allTransportEvents.find(e => e.station === layoverStation)
                    : null;
                  // Fallback: use positional matching for transport too
                  if (!transportEvent && dayIndex > 0 && allTransportEvents.length >= dayIndex) {
                    transportEvent = allTransportEvents[dayIndex - 1] ?? null;
                  }

                  // Merge hotel/transport data from all sources
                  // Priority: canonicalLayover (tripDutyDays) > HOTEL event > LAYOVER event
                  const hotelName = canonicalLayover?.hotelName ?? hotelEvent?.hotelName ?? layoverEvent?.hotelName ?? null;
                  const hotelPhone = canonicalLayover?.hotelPhone ?? hotelEvent?.hotelPhone ?? layoverEvent?.hotelPhone ?? null;
                  const transportNotes = canonicalLayover?.transportNotes ?? transportEvent?.transportNotes ?? layoverEvent?.transportNotes ?? hotelEvent?.transportNotes ?? null;
                  const transportPhone = canonicalLayover?.transportPhone ?? transportEvent?.transportPhone ?? layoverEvent?.transportPhone ?? hotelEvent?.transportPhone ?? null;

                  // Use authoritative layover time: canonicalLayover (from parsed schedule) is the source of truth
                  // Priority: canonicalLayover.restMinutes > layoverEvent.layoverMinutes > calculated
                  // Per CML: Rest = next duty START − prior duty END (no offset subtraction)
                  const layoverMinutes = canonicalLayover?.restMinutes
                    ? canonicalLayover.restMinutes
                    : layoverEvent?.layoverMinutes
                      ? layoverEvent.layoverMinutes
                      : prevDay
                        ? calculateLayoverMinutes(prevDay, dutyDay)
                        : 0;

                  // Get times for countdown calculation
                  // Next duty start = first leg departure of current duty day
                  const sortedCurrentLegs = [...(dutyDay.legs ?? [])].sort((a, b) => a.legIndex - b.legIndex);
                  const firstLegCurrent = sortedCurrentLegs[0];
                  const nextDutyStartISO = dutyDay.dutyStartISO
                    ?? firstLegCurrent?.scheduledOutISO
                    ?? firstLegCurrent?.actualOutISO
                    ?? null;

                  // Previous duty end = last leg arrival of previous duty day
                  const prevDutyEndISO = prevDay?.dutyEndISO
                    ?? lastLegPrev?.actualInISO
                    ?? lastLegPrev?.scheduledInISO
                    ?? null;

                  return (
                    <View key={dutyDay.id}>
                      {/* Layover before this duty day (rest between duty days) */}
                      {showLayover && prevDay && (
                        <LayoverSection
                          station={layoverStation || '---'}
                          restMinutes={layoverMinutes}
                          hotelName={hotelName}
                          hotelPhone={hotelPhone}
                          transportNotes={transportNotes}
                          transportPhone={transportPhone}
                          nextDutyStartISO={nextDutyStartISO}
                          prevDutyEndISO={prevDutyEndISO}
                        />
                      )}

                      <DutyDaySection
                        dutyDay={dutyDay}
                        dayIndex={dayIndex}
                        totalDays={dutyDays.length}
                        hourlyRateCents={hourlyRateCents}
                        position={position}
                        airportDb={airportDb}
                        onPress={() => onPress(dayIndex + 1)}
                      />
                    </View>
                  );
                })}
              </View>
            )}

            {/* Summary Footer */}
            <TripSummaryFooter trip={trip} hourlyRateCents={hourlyRateCents} payBreakdown={payBreakdown} />
          </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});
