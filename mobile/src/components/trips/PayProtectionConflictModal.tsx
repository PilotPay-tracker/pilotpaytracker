/**
 * PayProtectionConflictModal - Pay Protection Alert for Trip Conflicts
 *
 * Shows when importing a trip that overlaps with existing trips.
 * User must make a decision before proceeding:
 *
 * NEW ACTIONS (v2):
 * 1. Company Revision (Protected Credit) - company changed the assignment
 * 2. Replace Trip (Swap / Open Time) - user swap/trade/dropped original
 * 3. Cancel Import - do nothing
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import {
  Shield,
  AlertTriangle,
  X,
  RefreshCw,
  ArrowRightLeft,
  XCircle,
  Calendar,
  Clock,
  Plane,
  ChevronRight,
  Info,
  Star,
  TrendingUp,
  TrendingDown,
  CheckCircle,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { cn } from '@/lib/cn';
import type {
  TripConflict,
  ConflictTripSummary,
  ConflictDecision,
} from '@/lib/contracts';

interface PayProtectionConflictModalProps {
  visible: boolean;
  onClose: () => void;
  onDecision: (decision: ConflictDecision, note?: string) => Promise<void>;
  conflicts: TripConflict[];
  newTripSummary: ConflictTripSummary;
  isLoading?: boolean;
  hourlyRateCents?: number;
  recommendedAction?: ConflictDecision | null;
}

// Format minutes to hours:minutes
function formatCredit(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Conflict type label
function getConflictTypeLabel(type: string): string {
  switch (type) {
    case 'duplicate_trip':
      return 'Duplicate Trip';
    case 'date_overlap':
      return 'Date Overlap';
    case 'duty_day_overlap':
      return 'Duty Day Overlap';
    case 'same_calendar_day':
      return 'Same Calendar Day';
    default:
      return 'Conflict';
  }
}

// Severity color
function getSeverityColor(score: number): { bg: string; text: string; border: string } {
  if (score >= 80) {
    return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' };
  }
  if (score >= 60) {
    return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' };
  }
  return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/50' };
}

// Trip summary card
function TripSummaryCard({
  trip,
  label,
  isNew = false,
}: {
  trip: ConflictTripSummary;
  label: string;
  isNew?: boolean;
}) {
  return (
    <View
      className={cn(
        'rounded-xl p-4 border',
        isNew ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-slate-800/60 border-slate-700/50'
      )}
    >
      <View className="flex-row items-center mb-3">
        <View
          className={cn(
            'w-8 h-8 rounded-lg items-center justify-center',
            isNew ? 'bg-cyan-500/20' : 'bg-slate-700/50'
          )}
        >
          <Plane size={16} color={isNew ? '#06b6d4' : '#94a3b8'} />
        </View>
        <Text
          className={cn(
            'ml-2 text-xs font-semibold uppercase tracking-wider',
            isNew ? 'text-cyan-400' : 'text-slate-400'
          )}
        >
          {label}
        </Text>
        {trip.isOverride && (
          <View className="ml-auto bg-amber-500/20 px-2 py-0.5 rounded">
            <Text className="text-amber-400 text-[10px] font-bold">OVERRIDE</Text>
          </View>
        )}
      </View>

      <Text className="text-white font-semibold text-lg mb-1">
        {trip.tripNumber || trip.pairingId || 'Trip'}
      </Text>

      <View className="flex-row items-center mb-2">
        <Calendar size={12} color="#64748b" />
        <Text className="text-slate-400 text-sm ml-1.5">
          {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
        </Text>
      </View>

      <View className="flex-row items-center mb-2">
        <Clock size={12} color="#64748b" />
        <Text className="text-slate-400 text-sm ml-1.5">
          {formatCredit(trip.totalCreditMinutes)} credit • {trip.dutyDaysCount} duty days
        </Text>
      </View>

      {trip.routeHighlights && trip.routeHighlights !== 'N/A' && (
        <View className="bg-slate-900/50 rounded-lg px-3 py-2 mt-2">
          <Text className="text-slate-300 text-xs font-mono">
            {trip.routeHighlights}
          </Text>
        </View>
      )}
    </View>
  );
}

// Decision button
function DecisionButton({
  icon: Icon,
  label,
  description,
  color,
  onPress,
  disabled = false,
  isRecommended = false,
  impactText,
}: {
  icon: React.ComponentType<{ size: number; color: string }>;
  label: string;
  description: string;
  color: 'red' | 'amber' | 'slate' | 'cyan';
  onPress: () => void;
  disabled?: boolean;
  isRecommended?: boolean;
  impactText?: string;
}) {
  const colors = {
    red: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      text: 'text-red-400',
      icon: '#ef4444',
    },
    amber: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      icon: '#f59e0b',
    },
    slate: {
      bg: 'bg-slate-800/60',
      border: 'border-slate-700/50',
      text: 'text-slate-400',
      icon: '#64748b',
    },
    cyan: {
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/30',
      text: 'text-cyan-400',
      icon: '#06b6d4',
    },
  };

  const c = colors[color];

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled}
      className={cn(
        'flex-row items-center p-4 rounded-xl border mb-3',
        isRecommended ? 'bg-emerald-500/15 border-emerald-500/50' : c.bg,
        !isRecommended && c.border,
        disabled && 'opacity-50'
      )}
    >
      <View className="w-10 h-10 rounded-xl bg-slate-900/50 items-center justify-center">
        <Icon size={20} color={isRecommended ? '#10b981' : c.icon} />
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center">
          <Text className={cn('font-semibold', isRecommended ? 'text-emerald-400' : c.text)}>{label}</Text>
          {isRecommended && (
            <View className="flex-row items-center ml-2 bg-emerald-500/20 px-2 py-0.5 rounded">
              <Star size={10} color="#10b981" />
              <Text className="text-emerald-400 text-[10px] font-bold ml-1">RECOMMENDED</Text>
            </View>
          )}
        </View>
        <Text className="text-slate-500 text-xs mt-0.5">{description}</Text>
        {impactText && (
          <Text className={cn(
            'text-xs mt-1 font-medium',
            impactText.includes('+') ? 'text-green-400' : impactText.includes('-') ? 'text-red-400' : 'text-slate-400'
          )}>
            {impactText}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={isRecommended ? '#10b981' : '#64748b'} />
    </Pressable>
  );
}

export function PayProtectionConflictModal({
  visible,
  onClose,
  onDecision,
  conflicts,
  newTripSummary,
  isLoading = false,
  hourlyRateCents = 0,
  recommendedAction,
}: PayProtectionConflictModalProps) {
  const insets = useSafeAreaInsets();
  const [acknowledgmentNote, setAcknowledgmentNote] = useState('');
  const [selectedDecision, setSelectedDecision] = useState<ConflictDecision | null>(null);

  // Get the most severe conflict
  const primaryConflict = conflicts[0];
  const severityColors = primaryConflict
    ? getSeverityColor(primaryConflict.severityScore)
    : getSeverityColor(50);

  // Calculate impact deltas for each action
  const impactCalculations = useMemo(() => {
    const existingCredit = primaryConflict?.existingTrip.totalCreditMinutes ?? 0;
    const newCredit = newTripSummary.totalCreditMinutes ?? 0;
    const creditDelta = newCredit - existingCredit;
    const payDelta = Math.round((creditDelta / 60) * hourlyRateCents);
    // Protected credit = max(old, new)
    const protectedCredit = Math.max(existingCredit, newCredit);

    // Format helpers
    const formatCreditDelta = (delta: number): string => {
      const sign = delta >= 0 ? '+' : '';
      const hours = Math.floor(Math.abs(delta) / 60);
      const mins = Math.abs(delta) % 60;
      return `${sign}${delta >= 0 ? '' : '-'}${hours}:${mins.toString().padStart(2, '0')}`;
    };

    const formatPayDelta = (cents: number): string => {
      const sign = cents >= 0 ? '+' : '';
      return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
    };

    return {
      // Company Revision: protected credit = max(old, new)
      companyRevision: {
        creditDelta,
        payDelta: Math.round(((protectedCredit - existingCredit) / 60) * hourlyRateCents),
        protectedCredit,
        text: newCredit < existingCredit
          ? `Pay Protected: ${formatCredit(protectedCredit)} (original preserved)`
          : newCredit > existingCredit
          ? `Credit increased: ${formatCredit(existingCredit)} → ${formatCredit(newCredit)}`
          : 'Credit unchanged',
      },
      // Replace Trip: use new trip credit only
      replaceTrip: {
        creditDelta,
        payDelta,
        text: `New trip: ${formatCredit(newCredit)} credit`,
      },
      // Cancel: no changes
      cancel: {
        creditDelta: 0,
        payDelta: 0,
        text: 'No changes',
      },
    };
  }, [primaryConflict, newTripSummary, hourlyRateCents]);

  const handleDecision = useCallback(
    async (decision: ConflictDecision) => {
      setSelectedDecision(decision);
      try {
        await onDecision(decision, acknowledgmentNote || undefined);
      } finally {
        setSelectedDecision(null);
        setAcknowledgmentNote('');
      }
    },
    [onDecision, acknowledgmentNote]
  );

  const handleClose = () => {
    if (isLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/80">
        <Animated.View
          entering={SlideInUp.duration(400).springify()}
          className="flex-1 mt-8 rounded-t-3xl overflow-hidden"
        >
          <LinearGradient colors={['#0f172a', '#020617']} style={{ flex: 1 }}>
            {/* Header */}
            <View
              className="px-5 py-4 border-b border-slate-800/50"
              style={{ paddingTop: insets.top > 8 ? 8 : insets.top }}
            >
              <View className="flex-row items-center">
                <View className={cn('w-12 h-12 rounded-xl items-center justify-center', severityColors.bg)}>
                  <Shield size={24} color="#ef4444" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white text-xl font-bold">Pay Protection Alert</Text>
                  <Text className="text-red-400 text-sm font-medium">Trip Conflict Detected</Text>
                </View>
                <Pressable
                  onPress={handleClose}
                  disabled={isLoading}
                  className="w-10 h-10 rounded-full bg-slate-800/80 items-center justify-center"
                >
                  <X size={20} color="#64748b" />
                </Pressable>
              </View>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Warning Banner */}
              <View className={cn('rounded-xl p-4 mb-5 border', severityColors.bg, severityColors.border)}>
                <View className="flex-row items-start">
                  <AlertTriangle size={20} color="#ef4444" />
                  <View className="flex-1 ml-3">
                    <Text className="text-white font-semibold mb-1">
                      Importing this trip will create overlapping schedules
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      The system detected {conflicts.length} existing trip{conflicts.length !== 1 ? 's' : ''} that
                      overlap with the dates you're trying to import. You must decide how to proceed.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Conflict Details */}
              {primaryConflict && (
                <View className="mb-5">
                  <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                    Conflict Details
                  </Text>
                  <View className={cn('rounded-xl p-3 border', severityColors.bg, severityColors.border)}>
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className={cn('font-semibold', severityColors.text)}>
                        {getConflictTypeLabel(primaryConflict.conflictType)}
                      </Text>
                      <View className="bg-slate-900/50 px-2 py-1 rounded">
                        <Text className="text-slate-400 text-xs">
                          Severity: {primaryConflict.severityScore}/100
                        </Text>
                      </View>
                    </View>
                    <Text className="text-slate-400 text-sm">
                      Overlapping dates: {primaryConflict.overlappingDates.slice(0, 5).map(formatDate).join(', ')}
                      {primaryConflict.overlappingDates.length > 5 && ` +${primaryConflict.overlappingDates.length - 5} more`}
                    </Text>
                  </View>
                </View>
              )}

              {/* Trip Comparison */}
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Trip Comparison
              </Text>

              {/* Existing Trip */}
              {primaryConflict && (
                <View className="mb-3">
                  <TripSummaryCard trip={primaryConflict.existingTrip} label="Existing Trip" />
                </View>
              )}

              {/* New Trip */}
              <View className="mb-5">
                <TripSummaryCard trip={newTripSummary} label="New Trip (Importing)" isNew />
              </View>

              {/* Decision Required */}
              <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                Choose an Action
              </Text>

              <DecisionButton
                icon={RefreshCw}
                label="Company Revision (Protected Credit)"
                description="Company changed this assignment — update trip, protect original credit"
                color="cyan"
                onPress={() => handleDecision('company_revision')}
                disabled={isLoading}
                isRecommended={recommendedAction === 'company_revision' || recommendedAction === 'replace_existing'}
                impactText={impactCalculations.companyRevision.text}
              />

              <DecisionButton
                icon={ArrowRightLeft}
                label="Replace Trip (Swap / Open Time)"
                description="You dropped or traded the original — archive it, import new"
                color="amber"
                onPress={() => handleDecision('replace_trip')}
                disabled={isLoading}
                isRecommended={recommendedAction === 'replace_trip'}
                impactText={impactCalculations.replaceTrip.text}
              />

              <DecisionButton
                icon={XCircle}
                label="Cancel Import"
                description="Do not import this trip"
                color="slate"
                onPress={() => handleDecision('cancel')}
                disabled={isLoading}
                impactText={impactCalculations.cancel.text}
              />

              {/* Optional Note */}
              <View className="mt-4">
                <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                  Optional Note (for audit trail)
                </Text>
                <TextInput
                  value={acknowledgmentNote}
                  onChangeText={setAcknowledgmentNote}
                  placeholder="Add a note about your decision..."
                  placeholderTextColor="#475569"
                  multiline
                  numberOfLines={2}
                  className="bg-slate-800/60 rounded-xl p-4 text-white border border-slate-700/50"
                  style={{ minHeight: 60, textAlignVertical: 'top' }}
                />
              </View>

              {/* Info Note */}
              <View className="flex-row items-start mt-4 bg-slate-800/40 rounded-xl p-3">
                <Info size={16} color="#64748b" />
                <Text className="text-slate-500 text-xs ml-2 flex-1">
                  This decision is logged in your audit trail for pay protection documentation.
                  Override trips are visually marked and can be reviewed later.
                </Text>
              </View>
            </ScrollView>

            {/* Loading Indicator */}
            {isLoading && (
              <Animated.View
                entering={FadeIn}
                exiting={webSafeExit(FadeOut)}
                className="absolute inset-0 bg-slate-900/80 items-center justify-center"
              >
                <View className="bg-slate-800 rounded-2xl p-6 items-center">
                  <Text className="text-white font-semibold">
                    {selectedDecision === 'company_revision'
                      ? 'Applying company revision...'
                      : selectedDecision === 'replace_trip' || selectedDecision === 'replace_existing'
                      ? 'Replacing trip...'
                      : 'Processing...'}
                  </Text>
                </View>
              </Animated.View>
            )}
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}
