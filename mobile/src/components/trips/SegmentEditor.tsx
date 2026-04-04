/**
 * Segment Editor - Unified Premium Codes + Log Events Editor
 *
 * One-stop modal for editing a segment/duty day:
 * - Log premium codes with auto-calculation
 * - Create log events for audit trail
 * - Attach screenshots for proof
 * - Everything syncs automatically to trip totals
 *
 * Opened when tapping the pencil icon on a segment in the trip detail drawer.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  ChevronLeft,
  Clock,
  DollarSign,
  FileText,
  CheckCircle2,
  Plane,
  AlertTriangle,
  Camera,
  Plus,
  Sparkles,
  Zap,
  Shield,
  ChevronDown,
  ChevronRight,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, Layout } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { usePremiumCodes, formatPremiumResult, getCategoryConfig, MOST_USED_CODES } from '@/lib/usePremiumCodes';
import { useHourlyRateCents } from '@/lib/state/profile-store';
import type { PremiumCode, PremiumCodeCategory } from '@/lib/contracts';
import type { BackendTripDutyDay, BackendTripDutyLeg } from '@/lib/useTripsData';

// ============================================
// Types
// ============================================

export interface SegmentEditorContext {
  tripId: string;
  tripNumber: string | null;
  dutyDay: BackendTripDutyDay;
  dutyDayIndex: number;
}

interface SelectedPremium {
  code: PremiumCode;
  minutes: number;
  appliedToLegIds: string[];
}

interface SegmentEditorProps {
  visible: boolean;
  onClose: () => void;
  context: SegmentEditorContext | null;
  onSave: () => void;
  isSaving?: boolean;
}

// ============================================
// Helpers
// ============================================

function formatMinutes(minutes: number): string {
  if (!minutes || minutes < 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function formatCentsToCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTimeFromISO(iso: string | null): string {
  if (!iso) return '--:--';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

// ============================================
// Premium Code Chip Component
// ============================================

function PremiumCodeChip({
  code,
  isSelected,
  onPress,
  hourlyRateCents,
  size = 'normal',
}: {
  code: PremiumCode;
  isSelected: boolean;
  onPress: () => void;
  hourlyRateCents: number;
  size?: 'compact' | 'normal';
}) {
  const isFixed = code.premiumType === 'minutes';
  const hasMinutes = code.premiumMinutes && code.premiumMinutes > 0;

  // Calculate estimated pay for display
  const estimatedPayCents = hasMinutes
    ? Math.round((code.premiumMinutes! / 60) * hourlyRateCents)
    : 0;

  const categoryConfig = getCategoryConfig(code.category as PremiumCodeCategory);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={cn(
        'rounded-xl border',
        size === 'compact' ? 'px-2 py-1.5 mr-1.5 mb-1.5' : 'px-3 py-2 mr-2 mb-2',
        isSelected
          ? 'bg-emerald-500/20 border-emerald-500'
          : 'bg-slate-800/60 border-slate-700/50'
      )}
    >
      <View className="flex-row items-center">
        <View
          className={cn('px-1.5 py-0.5 rounded', categoryConfig.bgColor)}
          style={{ marginRight: size === 'compact' ? 4 : 6 }}
        >
          <Text
            className={cn('font-bold', size === 'compact' ? 'text-xs' : 'text-sm')}
            style={{ color: categoryConfig.color }}
          >
            {code.code}
          </Text>
        </View>
        {isFixed && hasMinutes && (
          <Text className={cn('text-emerald-400', size === 'compact' ? 'text-xs' : 'text-sm')}>
            +{formatMinutes(code.premiumMinutes!)}
          </Text>
        )}
        {!isFixed && code.premiumMultiplier && (
          <Text className={cn('text-amber-400', size === 'compact' ? 'text-xs' : 'text-sm')}>
            {code.premiumMultiplier}x
          </Text>
        )}
      </View>
      {size === 'normal' && (
        <Text
          className={cn('text-xs mt-0.5', isSelected ? 'text-emerald-400/60' : 'text-slate-500')}
          numberOfLines={1}
        >
          {code.title}
        </Text>
      )}
      {size === 'normal' && isFixed && hasMinutes && (
        <Text className={cn('text-[10px] mt-0.5', isSelected ? 'text-emerald-300' : 'text-emerald-400/50')}>
          ≈ {formatCentsToCurrency(estimatedPayCents)}
        </Text>
      )}
    </Pressable>
  );
}

// ============================================
// Leg Selection Row Component
// ============================================

function LegSelectionRow({
  leg,
  isSelected,
  onToggle,
}: {
  leg: BackendTripDutyLeg;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onToggle();
      }}
      className={cn(
        'flex-row items-center p-3 rounded-xl mb-2 border',
        isSelected
          ? 'bg-emerald-500/10 border-emerald-500/50'
          : 'bg-slate-800/40 border-slate-700/30'
      )}
    >
      {/* Selection indicator */}
      <View
        className={cn(
          'w-5 h-5 rounded-full border-2 mr-3 items-center justify-center',
          isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'
        )}
      >
        {isSelected && <CheckCircle2 size={12} color="#fff" />}
      </View>

      {/* Leg info */}
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className="text-white font-semibold">{leg.flightNumber || '----'}</Text>
          {leg.isDeadhead && (
            <View className="ml-2 bg-orange-500/20 px-1.5 py-0.5 rounded">
              <Text className="text-orange-400 text-[10px] font-bold">DH</Text>
            </View>
          )}
        </View>
        <Text className="text-slate-400 text-xs">
          {leg.origin} → {leg.destination}
        </Text>
      </View>

      {/* Times */}
      <View className="items-end">
        <Text className="text-white text-sm">
          {formatTimeFromISO(leg.scheduledOutISO)} - {formatTimeFromISO(leg.scheduledInISO)}
        </Text>
        <Text className="text-emerald-400 text-xs">
          {formatMinutes((leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : leg.plannedCreditMinutes)}
        </Text>
      </View>
    </Pressable>
  );
}

// ============================================
// Credit Impact Display
// ============================================

function CreditImpactDisplay({
  baseCredit,
  premiumCredit,
  hourlyRateCents,
}: {
  baseCredit: number;
  premiumCredit: number;
  hourlyRateCents: number;
}) {
  const totalCredit = baseCredit + premiumCredit;
  const basePayCents = Math.round((baseCredit / 60) * hourlyRateCents);
  const premiumPayCents = Math.round((premiumCredit / 60) * hourlyRateCents);
  const totalPayCents = basePayCents + premiumPayCents;

  return (
    <LinearGradient
      colors={['#064e3b', '#065f46', '#047857']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 16, padding: 16, marginBottom: 16 }}
    >
      <View className="flex-row items-center mb-3">
        <Shield size={20} color="#10b981" />
        <Text className="text-emerald-300 font-semibold text-sm ml-2">Credit Summary</Text>
      </View>

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-emerald-200/70 text-sm">Base Credit</Text>
        <Text className="text-white font-medium">{formatMinutes(baseCredit)}</Text>
      </View>

      {premiumCredit > 0 && (
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-emerald-200/70 text-sm">Premium Credit</Text>
          <Text className="text-emerald-400 font-bold">+{formatMinutes(premiumCredit)}</Text>
        </View>
      )}

      <View className="h-px bg-emerald-500/30 my-2" />

      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-emerald-200/70 text-xs">Total Credit</Text>
          <Text className="text-white text-2xl font-bold">{formatMinutes(totalCredit)}</Text>
        </View>
        <View className="items-end">
          <Text className="text-emerald-200/70 text-xs">Estimated Pay</Text>
          <Text className="text-emerald-400 text-xl font-bold">
            {formatCentsToCurrency(totalPayCents)}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

// ============================================
// Main Component
// ============================================

export function SegmentEditor({
  visible,
  onClose,
  context,
  onSave,
  isSaving = false,
}: SegmentEditorProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const hourlyRateCents = useHourlyRateCents();

  // State
  const [selectedCodes, setSelectedCodes] = useState<SelectedPremium[]>([]);
  const [selectedLegIds, setSelectedLegIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [showAllCodes, setShowAllCodes] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'premium' | 'legs' | 'notes' | null>('premium');

  // Fetch premium codes
  const { data: codesData, isLoading: codesLoading } = usePremiumCodes();
  const premiumCodes = codesData?.codes ?? [];

  // Get most used codes
  const mostUsedCodes = useMemo(() => {
    return premiumCodes.filter(c => MOST_USED_CODES.includes(c.code)).slice(0, 6);
  }, [premiumCodes]);

  // Split codes by type
  const fixedCodes = useMemo(() =>
    premiumCodes.filter(c => c.premiumType === 'minutes'),
    [premiumCodes]
  );

  // Reset state when context changes
  useEffect(() => {
    if (visible && context) {
      setSelectedCodes([]);
      setSelectedLegIds(context.dutyDay.legs.map(l => l.id)); // Select all legs by default
      setNotes('');
      setEventTitle(`${context.tripNumber || 'Trip'} — Day ${context.dutyDayIndex}`);
      setExpandedSection('premium');
    }
  }, [visible, context]);

  // Calculate base credit from duty day
  const baseCredit = useMemo(() => {
    if (!context) return 0;
    const dd = context.dutyDay;
    const dayLevelCredit = dd.creditMinutes ?? 0;
    if (dayLevelCredit > 0) return dayLevelCredit;

    return dd.legs.reduce((sum, leg) => {
      const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
      return sum + legCredit;
    }, 0);
  }, [context]);

  // Calculate total premium minutes
  const totalPremiumMinutes = useMemo(() => {
    return selectedCodes.reduce((sum, sp) => sum + sp.minutes, 0);
  }, [selectedCodes]);

  // Toggle premium code selection
  const handleToggleCode = useCallback((code: PremiumCode) => {
    setSelectedCodes(prev => {
      const existing = prev.find(sp => sp.code.code === code.code);
      if (existing) {
        return prev.filter(sp => sp.code.code !== code.code);
      }
      return [
        ...prev,
        {
          code,
          minutes: code.premiumMinutes ?? 0,
          appliedToLegIds: selectedLegIds,
        },
      ];
    });
  }, [selectedLegIds]);

  // Toggle leg selection
  const handleToggleLeg = useCallback((legId: string) => {
    setSelectedLegIds(prev => {
      if (prev.includes(legId)) {
        return prev.filter(id => id !== legId);
      }
      return [...prev, legId];
    });
  }, []);

  // Mutation to save premium + log event
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error('No context');

      // 1. Update duty day with premium credit via schedule-change endpoint
      // Note: The schedule-change endpoint only accepts limited premium codes (JA, RA, EXT, LA)
      // We pass null for premiumCode but still set premiumCreditMinutes
      if (selectedCodes.length > 0) {
        const primaryCode = selectedCodes[0];
        // Check if code is one of the accepted types
        const acceptedCodes = ['JA', 'RA', 'EXT', 'LA'];
        const premiumCode = acceptedCodes.includes(primaryCode.code.code.toUpperCase())
          ? (primaryCode.code.code.toUpperCase() as 'JA' | 'RA' | 'EXT' | 'LA')
          : null;

        await api.put(`/api/trips/duty-days/${context.dutyDay.id}/schedule-change`, {
          reason: 'reassignment',
          notes: notes || `Applied premium: ${selectedCodes.map(c => c.code.code).join(', ')}`,
          premiumCode,
          premiumCreditMinutes: totalPremiumMinutes,
          isOverride: false,
          logEvent: {
            eventType: 'PREMIUM_TRIGGER',
            eventDescription: `Applied premium code ${primaryCode.code.code} (+${formatMinutes(totalPremiumMinutes)})`,
            eventDate: context.dutyDay.dutyDate,
            additionalNotes: notes || undefined,
          },
        });
      }

      // 2. Create log event for audit trail with full premium info
      const eventData = {
        tripId: context.tripId,
        eventType: 'premium',
        notes: notes || `Premium codes applied: ${selectedCodes.map(c => c.code.code).join(', ')}`,
        premiumCode: selectedCodes[0]?.code.code,
        premiumMinutesDelta: totalPremiumMinutes,
        status: 'saved' as const,
        // Link to legs
        legIds: selectedLegIds,
        primaryLegId: selectedLegIds[0],
      };

      await api.post('/api/log-events', eventData);

      return { success: true };
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['trips'] });
      queryClient.invalidateQueries({ queryKey: ['trip', context?.tripId] });
      queryClient.invalidateQueries({ queryKey: ['log-events'] });
      onSave();
      onClose();
    },
    onError: (error) => {
      console.error('[SegmentEditor] Save failed:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert(
        'Save Failed',
        `Could not save premium codes. ${errorMessage.includes('JSON') ? 'Server returned an invalid response.' : errorMessage}`,
        [{ text: 'OK' }]
      );
    },
  });

  const handleSave = () => {
    if (selectedCodes.length === 0) {
      // Just close if no changes
      onClose();
      return;
    }
    saveMutation.mutate();
  };

  if (!context) return null;

  const isLoading = codesLoading || isSaving || saveMutation.isPending;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/80">
        <Animated.View
          entering={FadeIn.duration(200)}
          className="flex-1 bg-slate-950"
          style={{ marginTop: insets.top }}
        >
          {/* Header */}
          <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onClose();
              }}
              className="p-2 -ml-2 rounded-lg active:bg-slate-800"
            >
              <X size={24} color="#fff" />
            </Pressable>
            <View className="flex-1 ml-2">
              <Text className="text-white text-lg font-bold">Edit Segment</Text>
              <Text className="text-slate-400 text-xs">
                Day {context.dutyDayIndex} • {context.dutyDay.legs.length} leg(s)
              </Text>
            </View>
            <View className="flex-row items-center bg-emerald-500/20 px-3 py-1.5 rounded-lg">
              <Zap size={14} color="#10b981" />
              <Text className="text-emerald-400 font-bold ml-1">
                {formatMinutes(baseCredit + totalPremiumMinutes)}
              </Text>
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
              {/* Credit Impact Summary */}
              <Animated.View entering={FadeInDown.duration(300)}>
                <CreditImpactDisplay
                  baseCredit={baseCredit}
                  premiumCredit={totalPremiumMinutes}
                  hourlyRateCents={hourlyRateCents}
                />
              </Animated.View>

              {/* Premium Codes Section */}
              <Animated.View entering={FadeInDown.duration(300).delay(100)}>
                <Pressable
                  onPress={() => setExpandedSection(expandedSection === 'premium' ? null : 'premium')}
                  className="flex-row items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3 mb-2"
                >
                  <View className="flex-row items-center">
                    <DollarSign size={18} color="#10b981" />
                    <Text className="text-white font-semibold ml-2">Premium Codes</Text>
                    {selectedCodes.length > 0 && (
                      <View className="ml-2 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                        <Text className="text-emerald-400 text-xs font-bold">{selectedCodes.length}</Text>
                      </View>
                    )}
                  </View>
                  {expandedSection === 'premium' ? (
                    <ChevronDown size={18} color="#64748b" />
                  ) : (
                    <ChevronRight size={18} color="#64748b" />
                  )}
                </Pressable>

                {expandedSection === 'premium' && (
                  <Animated.View layout={Layout} className="mb-4">
                    {/* Most Used Codes */}
                    {mostUsedCodes.length > 0 && (
                      <View className="mb-4">
                        <View className="flex-row items-center mb-2">
                          <Sparkles size={14} color="#f59e0b" />
                          <Text className="text-amber-400 text-xs font-medium ml-1">Quick Access</Text>
                        </View>
                        <View className="flex-row flex-wrap">
                          {mostUsedCodes.map(code => (
                            <PremiumCodeChip
                              key={code.code}
                              code={code}
                              isSelected={selectedCodes.some(sp => sp.code.code === code.code)}
                              onPress={() => handleToggleCode(code)}
                              hourlyRateCents={hourlyRateCents}
                              size="compact"
                            />
                          ))}
                        </View>
                      </View>
                    )}

                    {/* All Fixed Codes */}
                    <View>
                      <View className="flex-row items-center justify-between mb-2">
                        <View className="flex-row items-center">
                          <Clock size={14} color="#10b981" />
                          <Text className="text-emerald-400 text-xs font-medium ml-1">
                            Fixed Credit Codes
                          </Text>
                        </View>
                        <Pressable onPress={() => setShowAllCodes(!showAllCodes)}>
                          <Text className="text-slate-400 text-xs">
                            {showAllCodes ? 'Less' : 'More'}
                          </Text>
                        </Pressable>
                      </View>
                      <View className="flex-row flex-wrap">
                        {(showAllCodes ? fixedCodes : fixedCodes.slice(0, 8)).map(code => (
                          <PremiumCodeChip
                            key={code.code}
                            code={code}
                            isSelected={selectedCodes.some(sp => sp.code.code === code.code)}
                            onPress={() => handleToggleCode(code)}
                            hourlyRateCents={hourlyRateCents}
                          />
                        ))}
                      </View>
                    </View>
                  </Animated.View>
                )}
              </Animated.View>

              {/* Legs Section */}
              <Animated.View entering={FadeInDown.duration(300).delay(200)}>
                <Pressable
                  onPress={() => setExpandedSection(expandedSection === 'legs' ? null : 'legs')}
                  className="flex-row items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3 mb-2"
                >
                  <View className="flex-row items-center">
                    <Plane size={18} color="#3b82f6" />
                    <Text className="text-white font-semibold ml-2">Apply to Legs</Text>
                    <View className="ml-2 bg-blue-500/20 px-2 py-0.5 rounded-full">
                      <Text className="text-blue-400 text-xs font-bold">
                        {selectedLegIds.length}/{context.dutyDay.legs.length}
                      </Text>
                    </View>
                  </View>
                  {expandedSection === 'legs' ? (
                    <ChevronDown size={18} color="#64748b" />
                  ) : (
                    <ChevronRight size={18} color="#64748b" />
                  )}
                </Pressable>

                {expandedSection === 'legs' && (
                  <Animated.View layout={Layout} className="mb-4">
                    {context.dutyDay.legs.map(leg => (
                      <LegSelectionRow
                        key={leg.id}
                        leg={leg}
                        isSelected={selectedLegIds.includes(leg.id)}
                        onToggle={() => handleToggleLeg(leg.id)}
                      />
                    ))}
                  </Animated.View>
                )}
              </Animated.View>

              {/* Notes Section */}
              <Animated.View entering={FadeInDown.duration(300).delay(300)}>
                <Pressable
                  onPress={() => setExpandedSection(expandedSection === 'notes' ? null : 'notes')}
                  className="flex-row items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3 mb-2"
                >
                  <View className="flex-row items-center">
                    <FileText size={18} color="#f59e0b" />
                    <Text className="text-white font-semibold ml-2">Event Details</Text>
                  </View>
                  {expandedSection === 'notes' ? (
                    <ChevronDown size={18} color="#64748b" />
                  ) : (
                    <ChevronRight size={18} color="#64748b" />
                  )}
                </Pressable>

                {expandedSection === 'notes' && (
                  <Animated.View layout={Layout} className="mb-4">
                    {/* Event Title */}
                    <View className="mb-3">
                      <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                        Log Event Title
                      </Text>
                      <TextInput
                        value={eventTitle}
                        onChangeText={setEventTitle}
                        placeholder="e.g., Trip 1234 — Reassignment"
                        placeholderTextColor="#64748b"
                        className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white"
                      />
                    </View>

                    {/* Notes */}
                    <View>
                      <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                        Additional Notes
                      </Text>
                      <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Crew scheduler name, call time, details..."
                        placeholderTextColor="#64748b"
                        multiline
                        numberOfLines={3}
                        textAlignVertical="top"
                        className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white min-h-[80px]"
                      />
                    </View>

                    {/* Contract Reference */}
                    {selectedCodes.length > 0 && (
                      <View className="bg-slate-800/40 rounded-xl p-3 mt-3 border border-slate-700/30">
                        <Text className="text-slate-500 text-xs mb-1">Contract References</Text>
                        {selectedCodes
                          .filter(sp => sp.code.contractRef)
                          .map(sp => (
                            <Text key={sp.code.code} className="text-slate-400 text-xs">
                              {sp.code.code}: {sp.code.contractRef}
                            </Text>
                          ))}
                      </View>
                    )}
                  </Animated.View>
                )}
              </Animated.View>
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Bottom Action Bar */}
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <View className="flex-row gap-3">
              <Pressable
                onPress={onClose}
                className="flex-1 bg-slate-700/60 rounded-xl py-4 items-center justify-center active:opacity-80"
              >
                <Text className="text-slate-300 font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={isLoading}
                className={cn(
                  'flex-2 flex-row items-center justify-center rounded-xl py-4 px-6',
                  selectedCodes.length > 0 && !isLoading
                    ? 'bg-emerald-500 active:bg-emerald-600'
                    : 'bg-slate-600'
                )}
                style={{ flex: 2 }}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <CheckCircle2 size={20} color="#fff" />
                    <Text className="text-white font-bold text-base ml-2">
                      {selectedCodes.length > 0 ? 'Save & Log' : 'Done'}
                    </Text>
                    {totalPremiumMinutes > 0 && (
                      <Text className="text-emerald-200 text-sm ml-2">
                        (+{formatMinutes(totalPremiumMinutes)})
                      </Text>
                    )}
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
