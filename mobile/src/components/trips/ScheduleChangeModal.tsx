/**
 * Schedule Change Modal
 *
 * Allows users to record schedule changes or apply overrides to duty days.
 * Changes are recorded without re-importing - they temporarily supersede imported data.
 * Overrides persist through future imports and become the source of truth.
 *
 * Now includes leg editing capability for reroutes (e.g., ONT-MIA → ONT-RFD)
 */

import { View, Text, Pressable, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image as RNImage } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  X,
  Pencil,
  Lock,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Plane,
  Plus,
  DollarSign,
  ArrowRight,
  Trash2,
  FileText,
  Paperclip,
  Calendar,
  User,
  Phone,
  MessageSquare,
  Radio,
  MoreHorizontal,
} from 'lucide-react-native';
import Animated, { SlideInDown, FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import type { BackendTripDutyDay, BackendDutyDay } from '@/lib/useTripsData';
import { formatMinutesToTime } from '@/lib/useTripsData';
import type { PayEventType, ContactMethod } from '@/lib/contracts';

// ============================================
// Types
// ============================================

export type ScheduleChangeReason =
  | 'reassignment'
  | 'reroute'
  | 'timing_change'
  | 'leg_added'
  | 'leg_removed'
  | 'other';

export type PremiumPayCode = 'JA' | 'RA' | 'EXT' | 'LA' | null;

export interface LegEdit {
  id: string;
  legIndex: number;
  flightNumber: string;
  origin: string;
  destination: string;
  isDeadhead: boolean;
  isModified: boolean;
  isNew: boolean;
  isDeleted: boolean;
  originalOrigin?: string;
  originalDestination?: string;
}

// Log Event fields for auto-creating pay events
export interface LogEventData {
  eventType: PayEventType;
  eventDescription: string;
  eventDate: string;
  contactName?: string;
  contactMethod?: ContactMethod;
  contactTime?: string;
  additionalNotes?: string;
  proofUri?: string;
}

export interface ScheduleChangeData {
  reason: ScheduleChangeReason;
  notes: string;
  // Updated duty day values
  reportTimeISO?: string;
  releaseTimeISO?: string;
  creditMinutes?: number;
  blockMinutes?: number;
  // Premium pay
  premiumCode?: PremiumPayCode;
  premiumCreditMinutes?: number;
  // Override flag
  isOverride: boolean;
  // Leg edits for detailed logging
  legEdits?: LegEdit[];
  // Log Event data for automatic pay event creation
  logEvent?: LogEventData;
}

interface ScheduleChangeModalProps {
  visible: boolean;
  onClose: () => void;
  dutyDay: BackendTripDutyDay | BackendDutyDay | null;
  dutyDayIndex: number;
  tripNumber: string | null;
  onSave: (data: ScheduleChangeData) => Promise<void>;
  isSaving: boolean;
}

// ============================================
// Constants
// ============================================

const CHANGE_REASONS: { value: ScheduleChangeReason; label: string; description: string }[] = [
  { value: 'reassignment', label: 'Reassignment', description: 'Assigned to a different trip or pairing' },
  { value: 'reroute', label: 'Reroute', description: 'Same trip, different routing' },
  { value: 'timing_change', label: 'Timing Change', description: 'Departure/arrival times changed' },
  { value: 'leg_added', label: 'Leg Added', description: 'Additional leg(s) added to duty day' },
  { value: 'leg_removed', label: 'Leg Removed', description: 'Leg(s) removed from duty day' },
  { value: 'other', label: 'Other', description: 'Other schedule modification' },
];

const PREMIUM_CODES: { value: PremiumPayCode; label: string; description: string }[] = [
  { value: null, label: 'None', description: 'No premium pay applies' },
  { value: 'JA', label: 'Junior Assignment (JA)', description: 'Involuntary assignment based on seniority' },
  { value: 'RA', label: 'Reassignment (RA)', description: 'Reassigned from original trip' },
  { value: 'EXT', label: 'Extension (EXT)', description: 'Trip extended beyond original schedule' },
  { value: 'LA', label: 'Late Arrival (LA)', description: 'Late arrival pay for delays' },
];

// Event types for Log Event (auto-populate from schedule change reason)
const EVENT_TYPE_MAP: Record<ScheduleChangeReason, PayEventType> = {
  reassignment: 'REASSIGNMENT',
  reroute: 'SCHEDULE_CHANGE',
  timing_change: 'SCHEDULE_CHANGE',
  leg_added: 'SCHEDULE_CHANGE',
  leg_removed: 'SCHEDULE_CHANGE',
  other: 'OTHER',
};

// Contact method options
const CONTACT_METHODS: { value: ContactMethod; label: string; icon: React.ReactNode }[] = [
  { value: 'phone', label: 'Phone', icon: <Phone size={14} color="#64748b" /> },
  { value: 'acars', label: 'ACARS', icon: <Radio size={14} color="#64748b" /> },
  { value: 'message', label: 'Text', icon: <MessageSquare size={14} color="#64748b" /> },
  { value: 'other', label: 'Other', icon: <MoreHorizontal size={14} color="#64748b" /> },
];

// ============================================
// Helpers
// ============================================

function formatDateFromISO(iso: string | null): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

// ============================================
// Leg Editor Row Component
// ============================================

function LegEditorRow({
  leg,
  onChange,
  onDelete,
}: {
  leg: LegEdit;
  onChange: (updates: Partial<LegEdit>) => void;
  onDelete: () => void;
}) {
  const hasChanges = leg.isModified || leg.isNew;
  const showOriginal = leg.isModified && (leg.originalOrigin !== leg.origin || leg.originalDestination !== leg.destination);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={webSafeExit(FadeOut.duration(150))}
      className={cn(
        "rounded-xl p-3 mb-2 border",
        leg.isDeleted
          ? "bg-red-900/20 border-red-500/30 opacity-50"
          : hasChanges
            ? "bg-amber-900/20 border-amber-500/30"
            : "bg-slate-800/50 border-slate-700/50"
      )}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <View className={cn(
            "px-2 py-0.5 rounded",
            leg.isDeadhead ? "bg-amber-500/20" : "bg-blue-500/20"
          )}>
            <Text className={cn(
              "text-xs font-bold",
              leg.isDeadhead ? "text-amber-400" : "text-blue-400"
            )}>
              {leg.isDeadhead ? 'DH' : 'FLT'}
            </Text>
          </View>
          <TextInput
            value={leg.flightNumber}
            onChangeText={(text) => onChange({ flightNumber: text.toUpperCase(), isModified: true })}
            placeholder="FLT#"
            placeholderTextColor="#64748b"
            className="text-white font-medium text-sm bg-slate-700/50 rounded px-2 py-1 w-16"
            maxLength={6}
          />
          {leg.isNew && (
            <View className="bg-emerald-500/20 px-1.5 py-0.5 rounded">
              <Text className="text-emerald-400 text-[10px] font-bold">NEW</Text>
            </View>
          )}
          {leg.isModified && !leg.isNew && (
            <View className="bg-amber-500/20 px-1.5 py-0.5 rounded">
              <Text className="text-amber-400 text-[10px] font-bold">EDITED</Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDelete();
          }}
          className="p-1.5 rounded-lg bg-red-500/10 active:bg-red-500/20"
        >
          <Trash2 size={14} color="#ef4444" />
        </Pressable>
      </View>

      {/* Route Editor */}
      <View className="flex-row items-center gap-2">
        <TextInput
          value={leg.origin}
          onChangeText={(text) => onChange({ origin: text.toUpperCase(), isModified: true })}
          placeholder="DEP"
          placeholderTextColor="#64748b"
          className="text-white font-bold text-lg bg-slate-700/50 rounded-lg px-3 py-2 flex-1 text-center"
          maxLength={4}
          autoCapitalize="characters"
        />
        <View className="bg-slate-700/30 rounded-full p-1">
          <Plane size={16} color="#64748b" />
        </View>
        <TextInput
          value={leg.destination}
          onChangeText={(text) => onChange({ destination: text.toUpperCase(), isModified: true })}
          placeholder="ARR"
          placeholderTextColor="#64748b"
          className="text-white font-bold text-lg bg-slate-700/50 rounded-lg px-3 py-2 flex-1 text-center"
          maxLength={4}
          autoCapitalize="characters"
        />
      </View>

      {/* Show original route if modified */}
      {showOriginal && (
        <View className="flex-row items-center justify-center mt-2 gap-1">
          <Text className="text-zinc-500 text-xs line-through">
            {leg.originalOrigin} → {leg.originalDestination}
          </Text>
          <ArrowRight size={10} color="#64748b" />
          <Text className="text-amber-400 text-xs font-medium">
            {leg.origin} → {leg.destination}
          </Text>
        </View>
      )}

      {/* Deadhead Toggle */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onChange({ isDeadhead: !leg.isDeadhead, isModified: true });
        }}
        className="flex-row items-center justify-center mt-2 gap-2"
      >
        <View className={cn(
          "w-4 h-4 rounded border-2",
          leg.isDeadhead ? "bg-amber-500 border-amber-500" : "border-slate-600"
        )}>
          {leg.isDeadhead && <CheckCircle2 size={12} color="#fff" />}
        </View>
        <Text className="text-slate-400 text-xs">Deadhead (DH)</Text>
      </Pressable>
    </Animated.View>
  );
}

// ============================================
// Main Component
// ============================================

export function ScheduleChangeModal({
  visible,
  onClose,
  dutyDay,
  dutyDayIndex,
  tripNumber,
  onSave,
  isSaving,
}: ScheduleChangeModalProps) {
  const insets = useSafeAreaInsets();

  // Form state
  const [reason, setReason] = useState<ScheduleChangeReason>('timing_change');
  const [notes, setNotes] = useState('');
  const [isOverride, setIsOverride] = useState(false);
  const [showReasonPicker, setShowReasonPicker] = useState(false);
  const [showPremiumPicker, setShowPremiumPicker] = useState(false);
  const [showLegsEditor, setShowLegsEditor] = useState(false);
  const [showLogEventSection, setShowLogEventSection] = useState(true);

  // Time/credit values
  const [creditHours, setCreditHours] = useState('');
  const [creditMinutes, setCreditMinutes] = useState('');
  const [blockHours, setBlockHours] = useState('');
  const [blockMinutes, setBlockMinutes] = useState('');

  // Premium pay
  const [premiumCode, setPremiumCode] = useState<PremiumPayCode>(null);
  const [premiumHours, setPremiumHours] = useState('');
  const [premiumMinutes, setPremiumMinutes] = useState('');

  // Leg edits
  const [legEdits, setLegEdits] = useState<LegEdit[]>([]);

  // Log Event state (auto-populated from schedule change)
  const [eventDescription, setEventDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactMethod, setContactMethod] = useState<ContactMethod | null>(null);
  const [contactTime, setContactTime] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);

  // Initialize from duty day values
  useEffect(() => {
    if (visible && dutyDay) {
      const creditMins = 'creditMinutes' in dutyDay ? dutyDay.creditMinutes : (dutyDay as BackendDutyDay).finalCreditMinutes || 0;
      const blockMins = 'blockMinutes' in dutyDay ? dutyDay.blockMinutes : (dutyDay as BackendDutyDay).actualBlockMinutes || 0;
      const existingPremiumCode = dutyDay.premiumCode as PremiumPayCode;
      const existingPremiumMins = dutyDay.premiumCreditMinutes || 0;

      setCreditHours(Math.floor(creditMins / 60).toString());
      setCreditMinutes((creditMins % 60).toString().padStart(2, '0'));
      setBlockHours(Math.floor(blockMins / 60).toString());
      setBlockMinutes((blockMins % 60).toString().padStart(2, '0'));

      setPremiumCode(existingPremiumCode || null);
      setPremiumHours(Math.floor(existingPremiumMins / 60).toString());
      setPremiumMinutes((existingPremiumMins % 60).toString().padStart(2, '0'));

      // Initialize leg edits from duty day legs
      const legs = 'legs' in dutyDay ? dutyDay.legs : [];
      setLegEdits(legs.map((leg) => ({
        id: leg.id,
        legIndex: leg.legIndex,
        flightNumber: leg.flightNumber || '',
        origin: leg.origin || '',
        destination: leg.destination || '',
        isDeadhead: leg.isDeadhead || false,
        isModified: false,
        isNew: false,
        isDeleted: false,
        originalOrigin: leg.origin || '',
        originalDestination: leg.destination || '',
      })));

      // Check if already has schedule change or override
      if (dutyDay.hasOverride) {
        setIsOverride(true);
        setReason((dutyDay.scheduleChangeReason as ScheduleChangeReason) || 'other');
        setNotes(dutyDay.scheduleChangeNotes || '');
      } else if (dutyDay.hasScheduleChange) {
        setReason((dutyDay.scheduleChangeReason as ScheduleChangeReason) || 'timing_change');
        setNotes(dutyDay.scheduleChangeNotes || '');
      } else {
        // Reset to defaults for new changes
        setReason('timing_change');
        setNotes('');
        setIsOverride(false);
      }

      setShowLegsEditor(false);
      setShowLogEventSection(true);

      // Reset Log Event fields
      setEventDescription('');
      setContactName('');
      setContactMethod(null);
      setContactTime('');
      setAdditionalNotes('');
      setProofUri(null);
    }
  }, [visible, dutyDay]);

  // Auto-generate event description from reason and leg changes
  const autoGeneratedDescription = useMemo(() => {
    const selectedReason = CHANGE_REASONS.find(r => r.value === reason);
    let desc = selectedReason?.description || 'Schedule modification';

    // Add leg change details
    const hasLegChanges = legEdits.some(leg => leg.isModified || leg.isNew || leg.isDeleted);
    if (hasLegChanges) {
      const modified = legEdits.filter(l => l.isModified && !l.isNew);
      const added = legEdits.filter(l => l.isNew);
      const removed = legEdits.filter(l => l.isDeleted);

      const parts: string[] = [];
      if (modified.length > 0) {
        const routeChanges = modified
          .filter(l => l.originalOrigin !== l.origin || l.originalDestination !== l.destination)
          .map(l => `${l.originalOrigin}-${l.originalDestination} → ${l.origin}-${l.destination}`);
        if (routeChanges.length > 0) {
          parts.push(`Reroute: ${routeChanges.join(', ')}`);
        }
      }
      if (added.length > 0) {
        parts.push(`Added: ${added.map(l => `${l.origin}-${l.destination}`).join(', ')}`);
      }
      if (removed.length > 0) {
        parts.push(`Removed: ${removed.map(l => `${l.origin}-${l.destination}`).join(', ')}`);
      }
      if (parts.length > 0) {
        desc = parts.join('. ');
      }
    }
    return desc;
  }, [reason, legEdits]);

  const handleLegChange = useCallback((legId: string, updates: Partial<LegEdit>) => {
    setLegEdits(prev => prev.map(leg =>
      leg.id === legId ? { ...leg, ...updates } : leg
    ));
  }, []);

  const handleLegDelete = useCallback((legId: string) => {
    setLegEdits(prev => prev.map(leg =>
      leg.id === legId ? { ...leg, isDeleted: !leg.isDeleted } : leg
    ));
  }, []);

  const handleAddLeg = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newLegId = `new-${Date.now()}`;
    const lastLeg = legEdits.filter(l => !l.isDeleted).slice(-1)[0];
    setLegEdits(prev => [...prev, {
      id: newLegId,
      legIndex: prev.length,
      flightNumber: '',
      origin: lastLeg?.destination || '',
      destination: '',
      isDeadhead: false,
      isModified: false,
      isNew: true,
      isDeleted: false,
    }]);
  }, [legEdits]);

  // Handle adding proof attachment
  const handleAddProof = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProofUri(result.assets[0].uri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error('Failed to pick image:', error);
    }
  }, []);

  const handleSave = useCallback(async () => {
    const totalCredit = parseInt(creditHours || '0') * 60 + parseInt(creditMinutes || '0');
    const totalBlock = parseInt(blockHours || '0') * 60 + parseInt(blockMinutes || '0');
    const totalPremium = parseInt(premiumHours || '0') * 60 + parseInt(premiumMinutes || '0');

    // Only include leg edits that have changes
    const modifiedLegs = legEdits.filter(leg => leg.isModified || leg.isNew || leg.isDeleted);

    // Get duty date for log event
    const dutyDate = 'dutyDate' in (dutyDay ?? {}) ? (dutyDay as BackendTripDutyDay).dutyDate : '';

    // Build log event data
    const finalDescription = eventDescription || autoGeneratedDescription;
    const logEventData: LogEventData = {
      eventType: EVENT_TYPE_MAP[reason],
      eventDescription: finalDescription,
      eventDate: dutyDate || new Date().toISOString().split('T')[0],
      contactName: contactName || undefined,
      contactMethod: contactMethod || undefined,
      contactTime: contactTime || undefined,
      additionalNotes: additionalNotes || notes || undefined,
      proofUri: proofUri || undefined,
    };

    await onSave({
      reason,
      notes,
      creditMinutes: totalCredit,
      blockMinutes: totalBlock,
      premiumCode,
      premiumCreditMinutes: premiumCode ? totalPremium : 0,
      isOverride,
      legEdits: modifiedLegs.length > 0 ? modifiedLegs : undefined,
      logEvent: logEventData,
    });
  }, [reason, notes, creditHours, creditMinutes, blockHours, blockMinutes, premiumCode, premiumHours, premiumMinutes, isOverride, legEdits, dutyDay, eventDescription, autoGeneratedDescription, contactName, contactMethod, contactTime, additionalNotes, proofUri, onSave]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  if (!dutyDay) return null;

  const totalCreditMins = parseInt(creditHours || '0') * 60 + parseInt(creditMinutes || '0');
  const totalPremiumMins = parseInt(premiumHours || '0') * 60 + parseInt(premiumMinutes || '0');
  const totalWithPremium = totalCreditMins + (premiumCode ? totalPremiumMins : 0);

  const selectedReason = CHANGE_REASONS.find(r => r.value === reason);
  const selectedPremium = PREMIUM_CODES.find(p => p.value === premiumCode);

  // Get date for display
  const dutyDate = 'dutyDate' in dutyDay ? dutyDay.dutyDate : '';
  const formattedDate = formatDateFromISO(dutyDate);

  // Check if any legs have been modified
  const hasLegChanges = legEdits.some(leg => leg.isModified || leg.isNew || leg.isDeleted);
  const activeLegs = legEdits.filter(leg => !leg.isDeleted);

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
                <View className={cn(
                  "w-10 h-10 rounded-xl items-center justify-center",
                  isOverride ? "bg-violet-500/20" : "bg-amber-500/20"
                )}>
                  {isOverride ? (
                    <Lock size={20} color="#8b5cf6" />
                  ) : (
                    <Pencil size={20} color="#f59e0b" />
                  )}
                </View>
                <View className="ml-3">
                  <Text className="text-white font-bold text-lg">
                    {isOverride ? 'Override Day' : 'Schedule Change'}
                  </Text>
                  <Text className="text-slate-400 text-sm">
                    {tripNumber ? `Trip ${tripNumber}` : 'Trip'} — Day {dutyDayIndex}
                    {formattedDate ? ` (${formattedDate})` : ''}
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
              {/* Flight Legs Editor Section */}
              <View className="mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowLegsEditor(!showLegsEditor);
                  }}
                  className={cn(
                    "flex-row items-center justify-between p-3 rounded-xl border",
                    hasLegChanges
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-slate-800/50 border-slate-700/50"
                  )}
                >
                  <View className="flex-row items-center">
                    <Plane size={18} color={hasLegChanges ? "#f59e0b" : "#64748b"} />
                    <View className="ml-3">
                      <Text className={cn("font-semibold", hasLegChanges ? "text-amber-400" : "text-slate-300")}>
                        Edit Flight Legs
                      </Text>
                      <Text className="text-slate-500 text-xs">
                        {activeLegs.length} leg{activeLegs.length !== 1 ? 's' : ''}
                        {hasLegChanges ? ' • Modified' : ''}
                      </Text>
                    </View>
                  </View>
                  {showLegsEditor ? (
                    <ChevronUp size={18} color="#64748b" />
                  ) : (
                    <ChevronDown size={18} color="#64748b" />
                  )}
                </Pressable>

                {showLegsEditor && (
                  <Animated.View entering={FadeIn.duration(200)} className="mt-3">
                    {legEdits.map((leg) => (
                      <LegEditorRow
                        key={leg.id}
                        leg={leg}
                        onChange={(updates) => handleLegChange(leg.id, updates)}
                        onDelete={() => handleLegDelete(leg.id)}
                      />
                    ))}
                    <Pressable
                      onPress={handleAddLeg}
                      className="flex-row items-center justify-center py-3 rounded-xl border border-dashed border-slate-600 bg-slate-800/30 active:bg-slate-700/50"
                    >
                      <Plus size={16} color="#64748b" />
                      <Text className="text-slate-400 font-medium ml-2">Add Leg</Text>
                    </Pressable>
                  </Animated.View>
                )}
              </View>

              {/* Override Toggle */}
              <View className="mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setIsOverride(!isOverride);
                  }}
                  className={cn(
                    "flex-row items-center justify-between p-3 rounded-xl border",
                    isOverride
                      ? "bg-violet-500/10 border-violet-500/30"
                      : "bg-slate-800/50 border-slate-700/50"
                  )}
                >
                  <View className="flex-row items-center">
                    <Lock size={18} color={isOverride ? "#8b5cf6" : "#64748b"} />
                    <View className="ml-3">
                      <Text className={cn("font-semibold", isOverride ? "text-violet-400" : "text-slate-300")}>
                        Make this an Override
                      </Text>
                      <Text className="text-slate-500 text-xs">
                        Persists through future imports
                      </Text>
                    </View>
                  </View>
                  <View className={cn(
                    "w-12 h-7 rounded-full p-1",
                    isOverride ? "bg-violet-500" : "bg-slate-700"
                  )}>
                    <Animated.View
                      className="w-5 h-5 rounded-full bg-white"
                      style={{ marginLeft: isOverride ? 20 : 0 }}
                    />
                  </View>
                </Pressable>
              </View>

              {/* Change Reason Picker */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Change Reason</Text>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowReasonPicker(!showReasonPicker);
                  }}
                  className="bg-slate-800 rounded-xl p-3 flex-row items-center justify-between"
                >
                  <View>
                    <Text className="text-white font-medium">{selectedReason?.label}</Text>
                    <Text className="text-slate-500 text-xs">{selectedReason?.description}</Text>
                  </View>
                  <ChevronDown size={18} color="#64748b" />
                </Pressable>

                {showReasonPicker && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    className="bg-slate-800 rounded-xl mt-2 overflow-hidden"
                  >
                    {CHANGE_REASONS.map((r) => (
                      <Pressable
                        key={r.value}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setReason(r.value);
                          setShowReasonPicker(false);
                        }}
                        className={cn(
                          "p-3 border-b border-slate-700/50",
                          reason === r.value && "bg-amber-500/10"
                        )}
                      >
                        <Text className={cn(
                          "font-medium",
                          reason === r.value ? "text-amber-400" : "text-white"
                        )}>
                          {r.label}
                        </Text>
                        <Text className="text-slate-500 text-xs">{r.description}</Text>
                      </Pressable>
                    ))}
                  </Animated.View>
                )}
              </View>

              {/* Credit Time */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Credit Time</Text>
                <View className="bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
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

              {/* Block Time */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Block Time</Text>
                <View className="bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
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

              {/* Premium Pay Section */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Premium Pay</Text>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowPremiumPicker(!showPremiumPicker);
                  }}
                  className={cn(
                    "rounded-xl p-3 flex-row items-center justify-between",
                    premiumCode ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-slate-800"
                  )}
                >
                  <View className="flex-row items-center">
                    <DollarSign size={18} color={premiumCode ? "#10b981" : "#64748b"} />
                    <View className="ml-2">
                      <Text className={cn("font-medium", premiumCode ? "text-emerald-400" : "text-white")}>
                        {selectedPremium?.label}
                      </Text>
                      <Text className="text-slate-500 text-xs">{selectedPremium?.description}</Text>
                    </View>
                  </View>
                  <ChevronDown size={18} color="#64748b" />
                </Pressable>

                {showPremiumPicker && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    className="bg-slate-800 rounded-xl mt-2 overflow-hidden"
                  >
                    {PREMIUM_CODES.map((p) => (
                      <Pressable
                        key={p.value ?? 'none'}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setPremiumCode(p.value);
                          setShowPremiumPicker(false);
                        }}
                        className={cn(
                          "p-3 border-b border-slate-700/50",
                          premiumCode === p.value && "bg-emerald-500/10"
                        )}
                      >
                        <Text className={cn(
                          "font-medium",
                          premiumCode === p.value ? "text-emerald-400" : "text-white"
                        )}>
                          {p.label}
                        </Text>
                        <Text className="text-slate-500 text-xs">{p.description}</Text>
                      </Pressable>
                    ))}
                  </Animated.View>
                )}

                {/* Premium Credit Input */}
                {premiumCode && (
                  <Animated.View entering={FadeIn.duration(200)} className="mt-3">
                    <Text className="text-slate-400 text-xs font-medium mb-2">Premium Credit Time</Text>
                    <View className="bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
                      <TextInput
                        value={premiumHours}
                        onChangeText={(t) => setPremiumHours(t.replace(/[^0-9]/g, ''))}
                        placeholder="0"
                        placeholderTextColor="#64748b"
                        keyboardType="number-pad"
                        className="text-emerald-400 text-xl font-bold flex-1 text-center"
                        maxLength={2}
                      />
                      <Text className="text-slate-500 text-lg mx-1">h</Text>
                      <Text className="text-slate-600 text-xl font-bold">:</Text>
                      <TextInput
                        value={premiumMinutes}
                        onChangeText={(t) => {
                          const num = t.replace(/[^0-9]/g, '');
                          if (parseInt(num) <= 59 || num === '') {
                            setPremiumMinutes(num);
                          }
                        }}
                        placeholder="00"
                        placeholderTextColor="#64748b"
                        keyboardType="number-pad"
                        className="text-emerald-400 text-xl font-bold flex-1 text-center"
                        maxLength={2}
                      />
                      <Text className="text-slate-500 text-lg ml-1">m</Text>
                    </View>
                  </Animated.View>
                )}
              </View>

              {/* Notes */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-medium mb-2">Notes (Optional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Add any additional details about this change..."
                  placeholderTextColor="#64748b"
                  multiline
                  className="bg-slate-800 rounded-xl p-3 text-white min-h-[80px]"
                  textAlignVertical="top"
                />
              </View>

              {/* Log Event Section - Auto-creates pay event with details */}
              <View className="mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowLogEventSection(!showLogEventSection);
                  }}
                  className="flex-row items-center justify-between p-3 rounded-xl bg-blue-500/10 border border-blue-500/30"
                >
                  <View className="flex-row items-center">
                    <FileText size={18} color="#3b82f6" />
                    <View className="ml-3">
                      <Text className="text-blue-400 font-semibold">Log Event Details</Text>
                      <Text className="text-slate-500 text-xs">Auto-saved with your change</Text>
                    </View>
                  </View>
                  {showLogEventSection ? (
                    <ChevronUp size={18} color="#3b82f6" />
                  ) : (
                    <ChevronDown size={18} color="#3b82f6" />
                  )}
                </Pressable>

                {showLogEventSection && (
                  <Animated.View entering={FadeIn.duration(200)} className="mt-3 space-y-3">
                    {/* Event Type (auto-selected from reason) */}
                    <View className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                      <Text className="text-slate-500 text-xs mb-1">Event Type</Text>
                      <Text className="text-white font-medium">
                        {EVENT_TYPE_MAP[reason] === 'REASSIGNMENT' ? 'Reassignment' :
                         EVENT_TYPE_MAP[reason] === 'SCHEDULE_CHANGE' ? 'Schedule Change' : 'Other'}
                      </Text>
                    </View>

                    {/* Event Description */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">What Changed?</Text>
                      <TextInput
                        value={eventDescription}
                        onChangeText={setEventDescription}
                        placeholder={autoGeneratedDescription}
                        placeholderTextColor="#64748b"
                        multiline
                        className="bg-slate-800 rounded-xl p-3 text-white"
                        textAlignVertical="top"
                        style={{ minHeight: 60 }}
                      />
                    </View>

                    {/* Event Date (auto-populated) */}
                    <View className="mt-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                      <View className="flex-row items-center">
                        <Calendar size={16} color="#f59e0b" />
                        <Text className="text-slate-400 text-xs ml-2">Event Date</Text>
                      </View>
                      <Text className="text-white font-medium mt-1">{formattedDate || 'Today'}</Text>
                    </View>

                    {/* Contact Details */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">Who Notified You?</Text>
                      <View className="flex-row items-center bg-slate-800 rounded-xl px-3">
                        <User size={16} color="#64748b" />
                        <TextInput
                          value={contactName}
                          onChangeText={setContactName}
                          placeholder="Crew scheduling rep name"
                          placeholderTextColor="#64748b"
                          className="flex-1 text-white p-3"
                        />
                      </View>
                    </View>

                    {/* Contact Method */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">Contact Method</Text>
                      <View className="flex-row">
                        {CONTACT_METHODS.map((method) => (
                          <Pressable
                            key={method.value}
                            onPress={() => {
                              setContactMethod(method.value);
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }}
                            className={cn(
                              "flex-1 mr-2 p-2 rounded-lg flex-row items-center justify-center",
                              contactMethod === method.value
                                ? "bg-blue-500/20 border border-blue-500/50"
                                : "bg-slate-800/60 border border-slate-700/50"
                            )}
                          >
                            {method.icon}
                            <Text
                              className={cn(
                                "ml-1 text-xs",
                                contactMethod === method.value
                                  ? "text-blue-400 font-semibold"
                                  : "text-slate-400"
                              )}
                            >
                              {method.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>

                    {/* Contact Time */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">Contact Time (optional)</Text>
                      <TextInput
                        value={contactTime}
                        onChangeText={setContactTime}
                        placeholder="e.g., 14:30 EST"
                        placeholderTextColor="#64748b"
                        className="bg-slate-800 rounded-xl p-3 text-white"
                      />
                    </View>

                    {/* Additional Notes */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">Additional Details (optional)</Text>
                      <TextInput
                        value={additionalNotes}
                        onChangeText={setAdditionalNotes}
                        placeholder="Clarifications, sequence of events..."
                        placeholderTextColor="#64748b"
                        multiline
                        className="bg-slate-800 rounded-xl p-3 text-white"
                        textAlignVertical="top"
                        style={{ minHeight: 60 }}
                      />
                    </View>

                    {/* Proof Attachment */}
                    <View className="mt-3">
                      <Text className="text-slate-400 text-xs mb-2">Attach Proof (Recommended)</Text>
                      {proofUri ? (
                        <View className="bg-slate-800 rounded-xl p-3 border border-slate-700/50">
                          <View className="flex-row items-center justify-between">
                            <View className="flex-row items-center flex-1">
                              <RNImage
                                source={{ uri: proofUri }}
                                style={{ width: 48, height: 48, borderRadius: 8 }}
                              />
                              <Text className="text-slate-300 text-sm ml-3 flex-1" numberOfLines={1}>
                                Screenshot attached
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => setProofUri(null)}
                              className="p-2"
                            >
                              <X size={16} color="#ef4444" />
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          onPress={handleAddProof}
                          className="bg-slate-800/60 rounded-xl p-3 border border-dashed border-slate-600 flex-row items-center justify-center"
                        >
                          <Paperclip size={16} color="#3b82f6" />
                          <Text className="text-blue-400 font-medium ml-2 text-sm">Add Screenshot</Text>
                        </Pressable>
                      )}
                      <Text className="text-slate-600 text-xs text-center mt-2">
                        Screenshots of crew scheduling messages, trip board changes
                      </Text>
                    </View>
                  </Animated.View>
                )}
              </View>

              {/* Credit Summary */}
              <View className="bg-slate-800/50 rounded-xl p-4 mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-slate-400 text-sm">Base Credit</Text>
                  <Text className="text-amber-400 font-bold">{formatMinutesToTime(totalCreditMins)}</Text>
                </View>
                {premiumCode && (
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-slate-400 text-sm">+ Premium ({premiumCode})</Text>
                    <Text className="text-emerald-400 font-bold">+{formatMinutesToTime(totalPremiumMins)}</Text>
                  </View>
                )}
                <View className="h-px bg-slate-700 my-2" />
                <View className="flex-row items-center justify-between">
                  <Text className="text-white font-semibold">Total Credit</Text>
                  <Text className="text-white font-bold text-lg">{formatMinutesToTime(totalWithPremium)}</Text>
                </View>
              </View>

              {/* Info Banner */}
              <View className={cn(
                "rounded-xl p-3 flex-row items-start mb-6",
                isOverride ? "bg-violet-500/10 border border-violet-500/30" : "bg-amber-500/10 border border-amber-500/30"
              )}>
                <AlertCircle size={16} color={isOverride ? "#8b5cf6" : "#f59e0b"} style={{ marginTop: 2 }} />
                <Text className={cn("text-sm ml-2 flex-1", isOverride ? "text-violet-300" : "text-amber-300")}>
                  {isOverride
                    ? "This override will persist through future schedule imports and become the source of truth for this duty day."
                    : "This change will temporarily supersede imported data. It will be flagged for review if a new schedule import affects this day."
                  }
                </Text>
              </View>

              {/* Save Button */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  handleSave();
                }}
                disabled={isSaving}
                className={cn(
                  "rounded-xl py-4 flex-row items-center justify-center active:opacity-80",
                  isOverride ? "bg-violet-500" : "bg-amber-500"
                )}
              >
                {isSaving ? (
                  <Text className="text-white font-bold text-lg">Saving...</Text>
                ) : (
                  <>
                    {isOverride ? <Lock size={20} color="#fff" /> : <CheckCircle2 size={20} color="#0f172a" />}
                    <Text className={cn("font-bold text-lg ml-2", isOverride ? "text-white" : "text-slate-900")}>
                      {isOverride ? 'Apply Override' : 'Save Change'}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
