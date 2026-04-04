/**
 * Schedule Change Log Event Modal
 *
 * Displayed after a schedule edit is saved.
 * Shows before/after changes with substance and auto-suggests premium codes.
 * Allows quick save of Log Event with leg-level linking.
 */

import { View, Text, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useCallback, useMemo } from 'react';
import {
  X,
  FileCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plane,
  ArrowRight,
  Clock,
  DollarSign,
  Paperclip,
  CheckCircle2,
  Save,
  Trash2,
} from 'lucide-react-native';
import Animated, { SlideInDown, FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import type { SimplePremiumSuggestion } from '@/lib/contracts';

// ============================================
// Types
// ============================================

export interface LegChangeData {
  legId: string;
  legIndex: number;
  flightNumber: string | null;
  origin: string | null;
  destination: string | null;
  before: {
    flightNumber?: string | null;
    origin?: string | null;
    destination?: string | null;
    scheduledOut?: string | null;
    scheduledIn?: string | null;
    creditMinutes?: number;
  };
  after: {
    flightNumber?: string | null;
    origin?: string | null;
    destination?: string | null;
    scheduledOut?: string | null;
    scheduledIn?: string | null;
    creditMinutes?: number;
  };
  changeType: 'route_change' | 'time_change' | 'leg_added' | 'leg_removed' | 'modified';
}

export interface ScheduleChangeContext {
  tripId: string;
  tripNumber: string | null;
  dutyDayId?: string;
  dutyDayIndex: number;
  dutyDate: string;
  // Change summary
  changeType: string;
  before: {
    totalCreditMinutes?: number;
    legCount?: number;
    layoverCity?: string;
    layoverMinutes?: number;
  };
  after: {
    totalCreditMinutes?: number;
    legCount?: number;
    layoverCity?: string;
    layoverMinutes?: number;
  };
  // Individual leg changes
  legChanges: LegChangeData[];
  // Attachment URLs (from schedule screenshots)
  attachmentUrls?: string[];
}

export interface SaveLogEventData {
  tripId: string;
  eventType: string;
  changeType: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  legIds: string[];
  primaryLegId?: string;
  premiumCode: string | null;
  premiumMinutesDelta: number | null;
  notes: string;
  attachmentUrls?: string[];
  status: 'draft' | 'saved';
}

interface ScheduleChangeLogEventModalProps {
  visible: boolean;
  onClose: () => void;
  context: ScheduleChangeContext | null;
  premiumSuggestions: SimplePremiumSuggestion[];
  onSave: (data: SaveLogEventData) => Promise<void>;
  onDiscard: () => void;
  isSaving: boolean;
}

// ============================================
// Premium Chips
// ============================================

const AP_CODES: { code: string; name: string; minutes: number }[] = [
  { code: 'AP0', name: 'Protection', minutes: 0 },
  { code: 'AP2', name: 'Layover Change', minutes: 60 },
  { code: 'AP3', name: 'Reassignment', minutes: 60 },
  { code: 'AP4', name: 'Duty Extension', minutes: 120 },
  { code: 'AP6', name: 'Additional Flying', minutes: 120 },
  { code: 'AP7', name: 'Early Report', minutes: 60 },
  { code: 'AP8', name: 'Late Report', minutes: 60 },
];

// ============================================
// Helpers
// ============================================

function formatMinutes(minutes: number | undefined | null): string {
  if (!minutes && minutes !== 0) return 'N/A';
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? '-' : '';
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
}

function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '--:--';
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '--:--';
  }
}

// ============================================
// Leg Change Card
// ============================================

function LegChangeCard({ leg }: { leg: LegChangeData }) {
  const hasRouteChange = leg.before.origin !== leg.after.origin || leg.before.destination !== leg.after.destination;
  const hasTimeChange = leg.before.scheduledOut !== leg.after.scheduledOut || leg.before.scheduledIn !== leg.after.scheduledIn;
  const hasCreditChange = leg.before.creditMinutes !== leg.after.creditMinutes;

  const isAdded = leg.changeType === 'leg_added';
  const isRemoved = leg.changeType === 'leg_removed';

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      className={cn(
        "rounded-xl p-3 mb-2 border",
        isAdded
          ? "bg-emerald-900/20 border-emerald-500/30"
          : isRemoved
            ? "bg-red-900/20 border-red-500/30"
            : "bg-amber-900/20 border-amber-500/30"
      )}
    >
      {/* Leg Header */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <View className={cn(
            "px-2 py-0.5 rounded",
            isAdded ? "bg-emerald-500/20" : isRemoved ? "bg-red-500/20" : "bg-amber-500/20"
          )}>
            <Text className={cn(
              "text-xs font-bold",
              isAdded ? "text-emerald-400" : isRemoved ? "text-red-400" : "text-amber-400"
            )}>
              {isAdded ? 'ADDED' : isRemoved ? 'REMOVED' : 'CHANGED'}
            </Text>
          </View>
          <Text className="text-slate-400 text-xs">
            Leg {leg.legIndex} • FLT {leg.flightNumber || 'N/A'}
          </Text>
        </View>
        <Plane size={14} color="#64748b" />
      </View>

      {/* Route Change */}
      {hasRouteChange && !isAdded && !isRemoved && (
        <View className="flex-row items-center justify-center gap-2 mb-2">
          <Text className="text-slate-500 text-sm line-through">
            {leg.before.origin}–{leg.before.destination}
          </Text>
          <ArrowRight size={12} color="#f59e0b" />
          <Text className="text-amber-400 text-sm font-semibold">
            {leg.after.origin}–{leg.after.destination}
          </Text>
        </View>
      )}

      {/* Added/Removed Route */}
      {(isAdded || isRemoved) && (
        <View className="flex-row items-center justify-center mb-2">
          <Text className={cn(
            "text-sm font-semibold",
            isAdded ? "text-emerald-400" : "text-red-400"
          )}>
            {leg.after.origin || leg.before.origin}–{leg.after.destination || leg.before.destination}
          </Text>
        </View>
      )}

      {/* Time Change */}
      {hasTimeChange && !isAdded && !isRemoved && (
        <View className="flex-row items-center justify-center gap-4 mb-2">
          <View className="items-center">
            <Text className="text-slate-600 text-[10px]">DEPART</Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-slate-500 text-xs line-through">{formatTime(leg.before.scheduledOut)}</Text>
              <ArrowRight size={10} color="#64748b" />
              <Text className="text-white text-xs font-medium">{formatTime(leg.after.scheduledOut)}</Text>
            </View>
          </View>
          <View className="items-center">
            <Text className="text-slate-600 text-[10px]">ARRIVE</Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-slate-500 text-xs line-through">{formatTime(leg.before.scheduledIn)}</Text>
              <ArrowRight size={10} color="#64748b" />
              <Text className="text-white text-xs font-medium">{formatTime(leg.after.scheduledIn)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Credit Change */}
      {hasCreditChange && (
        <View className="flex-row items-center justify-center">
          <Clock size={12} color="#64748b" />
          <Text className="text-slate-500 text-xs ml-1">Credit:</Text>
          <Text className="text-slate-400 text-xs line-through ml-1">{formatMinutes(leg.before.creditMinutes)}</Text>
          <ArrowRight size={10} color="#64748b" className="mx-1" />
          <Text className={cn(
            "text-xs font-medium",
            (leg.after.creditMinutes || 0) > (leg.before.creditMinutes || 0) ? "text-emerald-400" : "text-red-400"
          )}>
            {formatMinutes(leg.after.creditMinutes)}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ============================================
// Main Component
// ============================================

export function ScheduleChangeLogEventModal({
  visible,
  onClose,
  context,
  premiumSuggestions,
  onSave,
  onDiscard,
  isSaving,
}: ScheduleChangeLogEventModalProps) {
  const insets = useSafeAreaInsets();

  // Form state
  const [selectedPremiumCode, setSelectedPremiumCode] = useState<string | null>(null);
  const [premiumMinutes, setPremiumMinutes] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [showPremiumPicker, setShowPremiumPicker] = useState(false);
  const [showLegDetails, setShowLegDetails] = useState(true);

  // Initialize premium from top suggestion
  useMemo(() => {
    if (premiumSuggestions.length > 0 && !selectedPremiumCode) {
      const top = premiumSuggestions[0];
      setSelectedPremiumCode(top.code);
      setPremiumMinutes(top.minutes);
    }
  }, [premiumSuggestions, selectedPremiumCode]);

  // Generate auto notes from changes
  const autoNotes = useMemo(() => {
    if (!context) return '';
    const parts: string[] = [];

    // Credit change
    const creditBefore = context.before.totalCreditMinutes || 0;
    const creditAfter = context.after.totalCreditMinutes || 0;
    if (creditBefore !== creditAfter) {
      const diff = creditAfter - creditBefore;
      const sign = diff > 0 ? '+' : '';
      parts.push(`Credit: ${formatMinutes(creditBefore)} → ${formatMinutes(creditAfter)} (${sign}${formatMinutes(diff)})`);
    }

    // Leg count change
    const legsBefore = context.before.legCount || 0;
    const legsAfter = context.after.legCount || 0;
    if (legsBefore !== legsAfter) {
      const diff = legsAfter - legsBefore;
      if (diff > 0) {
        parts.push(`Legs Added: +${diff}`);
      } else {
        parts.push(`Legs Removed: ${diff}`);
      }
    }

    // Layover change
    if (context.before.layoverCity !== context.after.layoverCity) {
      parts.push(`Layover: ${context.before.layoverCity || 'N/A'} → ${context.after.layoverCity || 'N/A'}`);
    }

    // Leg-specific changes
    context.legChanges.forEach((leg) => {
      if (leg.changeType === 'route_change') {
        parts.push(`Reroute Leg ${leg.legIndex}: ${leg.before.origin}-${leg.before.destination} → ${leg.after.origin}-${leg.after.destination}`);
      }
    });

    return parts.join('\n');
  }, [context]);

  const handleSelectPremium = useCallback((code: string, minutes: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPremiumCode(code);
    setPremiumMinutes(minutes);
    setShowPremiumPicker(false);
  }, []);

  const handleSave = useCallback(async (status: 'draft' | 'saved') => {
    if (!context) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const legIds = context.legChanges.map((l) => l.legId);
    const primaryLegId = context.legChanges.find((l) => l.changeType === 'route_change')?.legId || legIds[0];

    await onSave({
      tripId: context.tripId,
      eventType: 'schedule_change',
      changeType: context.changeType,
      before: context.before as Record<string, unknown>,
      after: context.after as Record<string, unknown>,
      legIds,
      primaryLegId,
      premiumCode: selectedPremiumCode,
      premiumMinutesDelta: selectedPremiumCode ? premiumMinutes : null,
      notes: notes || autoNotes,
      attachmentUrls: context.attachmentUrls,
      status,
    });
  }, [context, selectedPremiumCode, premiumMinutes, notes, autoNotes, onSave]);

  const handleDiscard = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDiscard();
  }, [onDiscard]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  if (!context) return null;

  const selectedPremium = AP_CODES.find((p) => p.code === selectedPremiumCode);
  const creditDiff = (context.after.totalCreditMinutes || 0) - (context.before.totalCreditMinutes || 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 bg-black/70 justify-end">
          <Animated.View
            entering={SlideInDown.duration(300)}
            className="bg-slate-900 rounded-t-3xl max-h-[90%]"
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-xl items-center justify-center bg-amber-500/20">
                  <AlertTriangle size={20} color="#f59e0b" />
                </View>
                <View className="ml-3">
                  <Text className="text-white font-bold text-lg">Schedule Change Detected</Text>
                  <Text className="text-slate-400 text-sm">
                    Trip {context.tripNumber || context.tripId.slice(0, 8)} — Day {context.dutyDayIndex}
                    {context.dutyDate ? ` • ${formatDateShort(context.dutyDate)}` : ''}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleClose}
                className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
              >
                <X size={16} color="#64748b" />
              </Pressable>
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: 16 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Change Summary Banner */}
              <View className="bg-slate-800/50 rounded-xl p-4 mb-4 border border-slate-700/50">
                <Text className="text-slate-400 text-xs font-medium mb-2">CHANGE SUMMARY</Text>

                {/* Credit Change */}
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-slate-300 text-sm">Trip Credit</Text>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-sm">{formatMinutes(context.before.totalCreditMinutes)}</Text>
                    <ArrowRight size={12} color="#64748b" className="mx-2" />
                    <Text className="text-white font-semibold">{formatMinutes(context.after.totalCreditMinutes)}</Text>
                    {creditDiff !== 0 && (
                      <Text className={cn(
                        "text-xs ml-2 px-1.5 py-0.5 rounded",
                        creditDiff > 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                      )}>
                        {creditDiff > 0 ? '+' : ''}{formatMinutes(creditDiff)}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Leg Count Change */}
                {context.before.legCount !== context.after.legCount && (
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-slate-300 text-sm">Legs</Text>
                    <View className="flex-row items-center">
                      <Text className="text-slate-500 text-sm">{context.before.legCount}</Text>
                      <ArrowRight size={12} color="#64748b" className="mx-2" />
                      <Text className="text-white font-semibold">{context.after.legCount}</Text>
                    </View>
                  </View>
                )}

                {/* Layover Change */}
                {context.before.layoverCity !== context.after.layoverCity && (
                  <View className="flex-row items-center justify-between">
                    <Text className="text-slate-300 text-sm">Layover</Text>
                    <View className="flex-row items-center">
                      <Text className="text-slate-500 text-sm">{context.before.layoverCity || 'N/A'}</Text>
                      <ArrowRight size={12} color="#64748b" className="mx-2" />
                      <Text className="text-white font-semibold">{context.after.layoverCity || 'N/A'}</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Leg-Level Changes */}
              {context.legChanges.length > 0 && (
                <View className="mb-4">
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowLegDetails(!showLegDetails);
                    }}
                    className="flex-row items-center justify-between mb-2"
                  >
                    <Text className="text-slate-400 text-xs font-medium">
                      AFFECTED LEGS ({context.legChanges.length})
                    </Text>
                    {showLegDetails ? (
                      <ChevronUp size={14} color="#64748b" />
                    ) : (
                      <ChevronDown size={14} color="#64748b" />
                    )}
                  </Pressable>

                  {showLegDetails && (
                    <Animated.View entering={FadeIn.duration(200)}>
                      {context.legChanges.map((leg) => (
                        <LegChangeCard key={leg.legId} leg={leg} />
                      ))}
                    </Animated.View>
                  )}
                </View>
              )}

              {/* Premium Code Selection */}
              <View className="mb-4">
                <Text className="text-slate-400 text-xs font-medium mb-2">PREMIUM PAY</Text>
                <Text className="text-slate-500 text-xs mb-3">
                  This change may impact pay/premiums. Select applicable premium code:
                </Text>

                {/* Premium Suggestions Chips */}
                {premiumSuggestions.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {premiumSuggestions.map((suggestion) => (
                      <Pressable
                        key={suggestion.code}
                        onPress={() => handleSelectPremium(suggestion.code, suggestion.minutes)}
                        className={cn(
                          "px-3 py-2 rounded-lg border flex-row items-center",
                          selectedPremiumCode === suggestion.code
                            ? "bg-emerald-500/20 border-emerald-500/50"
                            : "bg-slate-800/50 border-slate-700/50"
                        )}
                      >
                        <DollarSign size={12} color={selectedPremiumCode === suggestion.code ? "#10b981" : "#64748b"} />
                        <Text className={cn(
                          "text-sm font-medium ml-1",
                          selectedPremiumCode === suggestion.code ? "text-emerald-400" : "text-slate-300"
                        )}>
                          {suggestion.code}
                        </Text>
                        {suggestion.minutes > 0 && (
                          <Text className="text-slate-500 text-xs ml-1">
                            +{formatMinutes(suggestion.minutes)}
                          </Text>
                        )}
                        {suggestion.confidence === 'high' && (
                          <View className="bg-amber-500/20 px-1 py-0.5 rounded ml-1">
                            <Text className="text-amber-400 text-[10px] font-bold">LIKELY</Text>
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* More Premium Options */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowPremiumPicker(!showPremiumPicker);
                  }}
                  className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50 flex-row items-center justify-between"
                >
                  <View className="flex-row items-center">
                    <DollarSign size={16} color={selectedPremiumCode ? "#10b981" : "#64748b"} />
                    <Text className={cn(
                      "font-medium ml-2",
                      selectedPremiumCode ? "text-emerald-400" : "text-slate-300"
                    )}>
                      {selectedPremium ? `${selectedPremium.code} - ${selectedPremium.name}` : 'Select Premium Code'}
                    </Text>
                    {selectedPremiumCode && premiumMinutes > 0 && (
                      <Text className="text-emerald-400/60 text-sm ml-2">
                        +{formatMinutes(premiumMinutes)}
                      </Text>
                    )}
                  </View>
                  <ChevronDown size={16} color="#64748b" />
                </Pressable>

                {showPremiumPicker && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    className="bg-slate-800 rounded-xl mt-2 overflow-hidden border border-slate-700/50"
                  >
                    <Pressable
                      onPress={() => handleSelectPremium('', 0)}
                      className={cn(
                        "p-3 border-b border-slate-700/50",
                        !selectedPremiumCode && "bg-slate-700/30"
                      )}
                    >
                      <Text className={cn(
                        "font-medium",
                        !selectedPremiumCode ? "text-white" : "text-slate-400"
                      )}>
                        None
                      </Text>
                      <Text className="text-slate-500 text-xs">No premium pay applies</Text>
                    </Pressable>
                    {AP_CODES.map((code) => (
                      <Pressable
                        key={code.code}
                        onPress={() => handleSelectPremium(code.code, code.minutes)}
                        className={cn(
                          "p-3 border-b border-slate-700/50",
                          selectedPremiumCode === code.code && "bg-emerald-500/10"
                        )}
                      >
                        <View className="flex-row items-center justify-between">
                          <Text className={cn(
                            "font-medium",
                            selectedPremiumCode === code.code ? "text-emerald-400" : "text-white"
                          )}>
                            {code.code} - {code.name}
                          </Text>
                          {code.minutes > 0 && (
                            <Text className="text-emerald-400/60 text-xs">
                              +{formatMinutes(code.minutes)}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    ))}
                  </Animated.View>
                )}
              </View>

              {/* Notes */}
              <View className="mb-4">
                <Text className="text-slate-400 text-xs font-medium mb-2">NOTES</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={autoNotes || "Add any additional notes..."}
                  placeholderTextColor="#64748b"
                  multiline
                  className="bg-slate-800 rounded-xl p-3 text-white min-h-[80px]"
                  textAlignVertical="top"
                />
              </View>

              {/* Attachments indicator */}
              {context.attachmentUrls && context.attachmentUrls.length > 0 && (
                <View className="bg-blue-500/10 rounded-xl p-3 mb-4 border border-blue-500/30 flex-row items-center">
                  <Paperclip size={16} color="#3b82f6" />
                  <Text className="text-blue-400 text-sm ml-2">
                    {context.attachmentUrls.length} attachment{context.attachmentUrls.length !== 1 ? 's' : ''} will be included
                  </Text>
                </View>
              )}

              {/* Info Banner */}
              <View className="bg-amber-500/10 rounded-xl p-3 mb-6 border border-amber-500/30 flex-row items-start">
                <FileCheck size={16} color="#f59e0b" style={{ marginTop: 2 }} />
                <Text className="text-amber-300 text-sm ml-2 flex-1">
                  Review and save this documentation. This Log Event will be linked to the specific flight leg(s) affected.
                </Text>
              </View>

              {/* Action Buttons */}
              <View className="flex-row gap-3">
                {/* Discard */}
                <Pressable
                  onPress={handleDiscard}
                  disabled={isSaving}
                  className="flex-1 rounded-xl py-4 flex-row items-center justify-center bg-slate-800 border border-slate-700 active:opacity-80"
                >
                  <Trash2 size={18} color="#ef4444" />
                  <Text className="text-red-400 font-semibold ml-2">Discard</Text>
                </Pressable>

                {/* Save as Draft */}
                <Pressable
                  onPress={() => handleSave('draft')}
                  disabled={isSaving}
                  className="flex-1 rounded-xl py-4 flex-row items-center justify-center bg-slate-700 active:opacity-80"
                >
                  <Save size={18} color="#94a3b8" />
                  <Text className="text-slate-300 font-semibold ml-2">Draft</Text>
                </Pressable>

                {/* Save */}
                <Pressable
                  onPress={() => handleSave('saved')}
                  disabled={isSaving}
                  className="flex-1 rounded-xl py-4 flex-row items-center justify-center bg-emerald-500 active:opacity-80"
                >
                  {isSaving ? (
                    <Text className="text-white font-bold">Saving...</Text>
                  ) : (
                    <>
                      <CheckCircle2 size={18} color="#fff" />
                      <Text className="text-white font-bold ml-2">Save</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
