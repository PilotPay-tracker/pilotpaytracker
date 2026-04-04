/**
 * OOOI Time Editor Component
 * Edit flight OOOI times with manual input or OCR parsing
 */

import { View, Text, Pressable, TextInput, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { X, Camera, Clock, Plane, Save, RefreshCw, CheckCircle } from 'lucide-react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useState, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import type { BackendLeg } from '@/lib/useTripsData';

interface OOOIEditorProps {
  leg: BackendLeg | null;
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    actualOutISO?: string;
    actualOffISO?: string;
    actualOnISO?: string;
    actualInISO?: string;
    actualBlockMinutes?: number;
    actualFlightMinutes?: number;
  }) => void;
  onOpenCamera?: () => void;
  isSaving?: boolean;
}

function extractTimeFromISO(isoString: string | null): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '';
  }
}

function buildISOFromTime(time: string, baseDate: string): string | undefined {
  if (!time || !time.match(/^\d{2}:\d{2}$/)) return undefined;
  const [hours, minutes] = time.split(':');
  return `${baseDate}T${hours}:${minutes}:00.000Z`;
}

function parseTimeInput(value: string): string {
  // Remove non-digits
  const digits = value.replace(/\D/g, '');

  // Format as HH:MM
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

function calculateMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  let startMins = startH * 60 + startM;
  let endMins = endH * 60 + endM;

  // Handle overnight flights
  if (endMins < startMins) {
    endMins += 24 * 60;
  }

  return endMins - startMins;
}

function formatMinutesToDisplay(minutes: number): string {
  if (!minutes || minutes < 0) return '0:00';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}:${mins.toString().padStart(2, '0')}`;
}

interface TimeInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  color: string;
}

function TimeInput({ label, value, onChange, color }: TimeInputProps) {
  const handleChange = (text: string) => {
    const formatted = parseTimeInput(text);
    onChange(formatted);
  };

  return (
    <View className="flex-1 mx-1">
      <Text className={cn('text-xs font-bold text-center mb-1', `text-${color}-400`)}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder="HH:MM"
        placeholderTextColor="#64748b"
        keyboardType="numeric"
        maxLength={5}
        className={cn(
          'bg-slate-800 text-white text-center text-lg py-3 rounded-xl font-mono border',
          value ? `border-${color}-500/50` : 'border-slate-700'
        )}
        selectTextOnFocus
      />
    </View>
  );
}

export function OOOIEditor({
  leg,
  visible,
  onClose,
  onSave,
  onOpenCamera,
  isSaving,
}: OOOIEditorProps) {
  const insets = useSafeAreaInsets();

  // Get the base date from the leg's scheduled out time
  const baseDate = leg?.scheduledOutISO?.split('T')[0] || new Date().toISOString().split('T')[0];

  const [outTime, setOutTime] = useState('');
  const [offTime, setOffTime] = useState('');
  const [onTime, setOnTime] = useState('');
  const [inTime, setInTime] = useState('');

  // Reset form when leg changes
  useEffect(() => {
    if (leg) {
      setOutTime(extractTimeFromISO(leg.actualOutISO));
      setOffTime(extractTimeFromISO(leg.actualOffISO));
      setOnTime(extractTimeFromISO(leg.actualOnISO));
      setInTime(extractTimeFromISO(leg.actualInISO));
    }
  }, [leg?.id]);

  if (!leg) return null;

  const blockMinutes = calculateMinutes(outTime, inTime);
  const flightMinutes = calculateMinutes(offTime, onTime);

  const hasChanges =
    outTime !== extractTimeFromISO(leg.actualOutISO) ||
    offTime !== extractTimeFromISO(leg.actualOffISO) ||
    onTime !== extractTimeFromISO(leg.actualOnISO) ||
    inTime !== extractTimeFromISO(leg.actualInISO);

  const hasAllTimes = outTime && offTime && onTime && inTime;
  const isValid = hasAllTimes && blockMinutes > 0 && flightMinutes > 0 && flightMinutes <= blockMinutes;

  const handleSave = () => {
    if (!isValid) {
      Alert.alert('Invalid Times', 'Please enter valid OOOI times. Flight time must be less than or equal to block time.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave({
      actualOutISO: buildISOFromTime(outTime, baseDate),
      actualOffISO: buildISOFromTime(offTime, baseDate),
      actualOnISO: buildISOFromTime(onTime, baseDate),
      actualInISO: buildISOFromTime(inTime, baseDate),
      actualBlockMinutes: blockMinutes,
      actualFlightMinutes: flightMinutes,
    });
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const handleClear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOutTime('');
    setOffTime('');
    setOnTime('');
    setInTime('');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/70 justify-end">
        <Animated.View
          entering={SlideInDown.duration(300)}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-5 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                <Clock size={20} color="#f59e0b" />
              </View>
              <View className="ml-3">
                <Text className="text-white font-bold text-lg">Edit OOOI Times</Text>
                <View className="flex-row items-center">
                  <Text className="text-slate-400 text-sm">
                    {leg.flightNumber || '----'} · {leg.origin || '---'} → {leg.destination || '---'}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView className="max-h-[70vh]">
            <View className="p-5">
              {/* Camera Button */}
              {onOpenCamera && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onOpenCamera();
                  }}
                  className="bg-blue-500/20 border border-blue-500/40 rounded-xl py-4 flex-row items-center justify-center mb-5 active:opacity-80"
                >
                  <Camera size={20} color="#3b82f6" />
                  <Text className="text-blue-400 font-semibold ml-2">Scan ACARS Photo</Text>
                </Pressable>
              )}

              {/* Time Inputs */}
              <View className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                <Text className="text-slate-400 text-xs font-medium mb-3 text-center">
                  Enter times in 24-hour UTC format
                </Text>

                <View className="flex-row mb-4">
                  <TimeInput label="OUT" value={outTime} onChange={setOutTime} color="emerald" />
                  <TimeInput label="OFF" value={offTime} onChange={setOffTime} color="blue" />
                  <TimeInput label="ON" value={onTime} onChange={setOnTime} color="blue" />
                  <TimeInput label="IN" value={inTime} onChange={setInTime} color="emerald" />
                </View>

                {/* Calculated Times */}
                <View className="flex-row items-center justify-center pt-3 border-t border-slate-700">
                  <View className="flex-row items-center mr-6">
                    <Text className="text-slate-500 text-sm">Block:</Text>
                    <Text className={cn(
                      'font-bold text-lg ml-2',
                      blockMinutes > 0 ? 'text-amber-400' : 'text-slate-600'
                    )}>
                      {formatMinutesToDisplay(blockMinutes)}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-sm">Flight:</Text>
                    <Text className={cn(
                      'font-bold text-lg ml-2',
                      flightMinutes > 0 ? 'text-blue-400' : 'text-slate-600'
                    )}>
                      {formatMinutesToDisplay(flightMinutes)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Clear Button */}
              <Pressable
                onPress={handleClear}
                className="flex-row items-center justify-center py-2 mb-4"
              >
                <RefreshCw size={14} color="#64748b" />
                <Text className="text-slate-500 text-sm ml-1.5">Clear All</Text>
              </Pressable>

              {/* Validation Messages */}
              {!isValid && hasAllTimes && (
                <View className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                  <Text className="text-red-400 text-sm text-center">
                    {flightMinutes > blockMinutes
                      ? 'Flight time cannot exceed block time'
                      : 'Please check your times'}
                  </Text>
                </View>
              )}

              {/* Save Button */}
              <Pressable
                onPress={handleSave}
                disabled={!hasChanges || !isValid || isSaving}
                className={cn(
                  'rounded-xl py-4 flex-row items-center justify-center',
                  hasChanges && isValid && !isSaving
                    ? 'bg-amber-500 active:opacity-90'
                    : 'bg-slate-700'
                )}
              >
                {isSaving ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    {hasChanges && isValid ? (
                      <Save size={20} color="#000" />
                    ) : (
                      <CheckCircle size={20} color="#64748b" />
                    )}
                    <Text
                      className={cn(
                        'font-bold text-base ml-2',
                        hasChanges && isValid ? 'text-black' : 'text-slate-500'
                      )}
                    >
                      {!hasChanges ? 'No Changes' : isValid ? 'Save Times' : 'Complete All Times'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
