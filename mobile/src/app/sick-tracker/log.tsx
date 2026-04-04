/**
 * Log Sick Time Screen
 *
 * IMPORTANT: For PERSONAL RECORD-KEEPING ONLY
 * Does NOT submit, modify, validate, or sync with payroll, scheduling, or company systems
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Heart,
  Calendar,
  Clock,
  FileText,
  Check,
  AlertCircle,
  Info,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { cn } from '@/lib/cn';
import {
  useSickBank,
  useRecordSickUsage,
  getCoverageColor,
} from '@/lib/useSickTimeTracker';

// ============================================================
// Date Picker Component
// ============================================================

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
}) {
  const [show, setShow] = useState(false);

  const handleChange = (_: any, selectedDate?: Date) => {
    setShow(Platform.OS === 'ios');
    if (selectedDate) {
      onChange(selectedDate);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <View className="mb-4">
      <Text className="text-slate-400 text-sm mb-2">{label}</Text>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShow(true);
        }}
        className="bg-slate-800 rounded-xl p-4 flex-row items-center border border-slate-700"
      >
        <Calendar size={20} color="#94a3b8" />
        <Text className="text-white font-medium ml-3 flex-1">{formatDate(value)}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={value}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          maximumDate={new Date()}
        />
      )}
    </View>
  );
}

// ============================================================
// Coverage Preview
// ============================================================

function CoveragePreview({
  hoursUsed,
  currentBalance,
}: {
  hoursUsed: number;
  currentBalance: number;
}) {
  let coverageStatus: 'FULL' | 'PARTIAL' | 'NONE' = 'FULL';
  if (currentBalance < hoursUsed) {
    coverageStatus = currentBalance <= 0 ? 'NONE' : 'PARTIAL';
  }

  const colors = getCoverageColor(coverageStatus);
  const balanceAfter = Math.max(0, currentBalance - hoursUsed);

  return (
    <View className={cn('rounded-xl p-4 border', colors.bg, colors.border)}>
      <View className="flex-row items-center mb-3">
        {coverageStatus === 'FULL' ? (
          <Check size={18} color="#22c55e" />
        ) : coverageStatus === 'PARTIAL' ? (
          <AlertCircle size={18} color="#f59e0b" />
        ) : (
          <AlertCircle size={18} color="#ef4444" />
        )}
        <Text className={cn('font-semibold ml-2', colors.text)}>
          {coverageStatus === 'FULL'
            ? 'Full Coverage'
            : coverageStatus === 'PARTIAL'
            ? 'Partial Coverage'
            : 'No Coverage'}
        </Text>
      </View>

      <View className="flex-row justify-between mb-1">
        <Text className="text-slate-400 text-sm">Current Balance</Text>
        <Text className="text-white font-medium">{currentBalance.toFixed(1)} hrs</Text>
      </View>
      <View className="flex-row justify-between mb-1">
        <Text className="text-slate-400 text-sm">Hours Used</Text>
        <Text className="text-white font-medium">-{hoursUsed.toFixed(1)} hrs</Text>
      </View>
      <View className="h-px bg-slate-700 my-2" />
      <View className="flex-row justify-between">
        <Text className="text-slate-300 font-medium">Balance After</Text>
        <Text className={cn('font-bold', balanceAfter > 0 ? 'text-white' : 'text-red-400')}>
          {balanceAfter.toFixed(1)} hrs
        </Text>
      </View>

      {coverageStatus !== 'FULL' && (
        <View className="mt-3 bg-slate-900/50 rounded-lg p-3">
          <Text className="text-slate-400 text-xs">
            {coverageStatus === 'NONE'
              ? 'This sick time will be logged but is unpaid (no sick bank coverage).'
              : `Only ${currentBalance.toFixed(1)} hrs covered. Remaining ${(hoursUsed - currentBalance).toFixed(1)} hrs logged as unpaid.`}
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// Main Screen
// ============================================================

export default function LogSickTimeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: sickBank, isLoading: bankLoading } = useSickBank();
  const recordUsage = useRecordSickUsage();

  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [hoursUsed, setHoursUsed] = useState('');
  const [tripNumber, setTripNumber] = useState('');
  const [notes, setNotes] = useState('');

  const currentBalance = sickBank?.balanceHours ?? 0;
  const numHours = parseFloat(hoursUsed) || 0;

  const canSubmit = numHours > 0 && !recordUsage.isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const formatDateStr = (date: Date) => date.toISOString().slice(0, 10);

    recordUsage.mutate(
      {
        startDate: formatDateStr(startDate),
        endDate: formatDateStr(endDate),
        hoursUsed: numHours,
        tripNumber: tripNumber || undefined,
        userNotes: notes || undefined,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        onError: (error) => {
          console.error('[LogSickTime] Error:', error);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      }
    );
  }, [canSubmit, startDate, endDate, numHours, tripNumber, notes, recordUsage, router]);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0f172a', '#1e1e2e', '#0f172a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ paddingTop: insets.top + 8 }} className="px-5">
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center mr-3"
              >
                <ArrowLeft size={20} color="#fff" />
              </Pressable>
              <View className="flex-1">
                <Text className="text-white text-2xl font-bold">Log Sick Time</Text>
                <Text className="text-slate-400 text-sm">Personal record</Text>
              </View>
            </View>
          </View>

          {bankLoading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#ef4444" />
            </View>
          ) : (
            <View className="px-5">
              {/* Disclaimer */}
              <Animated.View
                entering={FadeInDown.duration(400).delay(100)}
                className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 mb-6"
              >
                <View className="flex-row items-start">
                  <Info size={16} color="#94a3b8" />
                  <Text className="text-slate-400 text-xs ml-2 flex-1">
                    This logs sick time for your personal records only. It does not report to or
                    affect any company systems.
                  </Text>
                </View>
              </Animated.View>

              {/* Date Selection */}
              <Animated.View entering={FadeInDown.duration(400).delay(150)}>
                <DateInput label="Start Date" value={startDate} onChange={setStartDate} />
                <DateInput label="End Date" value={endDate} onChange={setEndDate} />
              </Animated.View>

              {/* Hours Input */}
              <Animated.View entering={FadeInDown.duration(400).delay(200)} className="mb-4">
                <Text className="text-slate-400 text-sm mb-2">Hours Used</Text>
                <View className="bg-slate-800 rounded-xl p-4 flex-row items-center border border-slate-700">
                  <Clock size={20} color="#94a3b8" />
                  <TextInput
                    value={hoursUsed}
                    onChangeText={setHoursUsed}
                    keyboardType="decimal-pad"
                    placeholder="0.0"
                    placeholderTextColor="#64748b"
                    className="flex-1 text-white text-lg font-medium ml-3"
                  />
                  <Text className="text-slate-500">hours</Text>
                </View>
              </Animated.View>

              {/* Trip Number (Optional) */}
              <Animated.View entering={FadeInDown.duration(400).delay(250)} className="mb-4">
                <Text className="text-slate-400 text-sm mb-2">Trip Number (optional)</Text>
                <View className="bg-slate-800 rounded-xl p-4 flex-row items-center border border-slate-700">
                  <FileText size={20} color="#94a3b8" />
                  <TextInput
                    value={tripNumber}
                    onChangeText={setTripNumber}
                    placeholder="e.g., 1234"
                    placeholderTextColor="#64748b"
                    className="flex-1 text-white font-medium ml-3"
                  />
                </View>
              </Animated.View>

              {/* Notes (Optional) */}
              <Animated.View entering={FadeInDown.duration(400).delay(300)} className="mb-6">
                <Text className="text-slate-400 text-sm mb-2">Notes (optional)</Text>
                <View className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Add any notes..."
                    placeholderTextColor="#64748b"
                    multiline
                    numberOfLines={3}
                    className="text-white font-medium min-h-[80px]"
                    textAlignVertical="top"
                  />
                </View>
              </Animated.View>

              {/* Coverage Preview */}
              {numHours > 0 && (
                <Animated.View entering={FadeInDown.duration(400).delay(350)} className="mb-6">
                  <CoveragePreview hoursUsed={numHours} currentBalance={currentBalance} />
                </Animated.View>
              )}

              {/* Submit Button */}
              <Animated.View entering={FadeInDown.duration(400).delay(400)}>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    'py-4 rounded-2xl flex-row items-center justify-center',
                    canSubmit ? 'bg-red-500 active:bg-red-600' : 'bg-slate-700'
                  )}
                >
                  {recordUsage.isPending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Heart size={20} color="white" fill="white" />
                      <Text className="text-white font-bold text-lg ml-2">Log Sick Time</Text>
                    </>
                  )}
                </Pressable>
              </Animated.View>

              {recordUsage.isError && (
                <View className="mt-4 bg-red-500/20 border border-red-500/40 rounded-xl p-3">
                  <Text className="text-red-400 text-sm text-center">
                    Failed to log sick time. Please try again.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
