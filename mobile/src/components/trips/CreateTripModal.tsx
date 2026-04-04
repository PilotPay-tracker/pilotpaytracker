/**
 * Create Trip Modal Component
 */

import { View, Text, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { X, Plane, Calendar, Plus } from 'lucide-react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';

interface CreateTripModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { tripNumber: string; startDate: string; endDate: string }) => void;
  isLoading?: boolean;
}

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDateDisplay(dateString: string): string {
  if (!dateString) return 'Select date';
  const date = new Date(dateString + 'T12:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function CreateTripModal({ visible, onClose, onSubmit, isLoading }: CreateTripModalProps) {
  const today = new Date();
  const [tripNumber, setTripNumber] = useState('');
  const [startDate, setStartDate] = useState(formatDateForInput(today));
  const [endDate, setEndDate] = useState(formatDateForInput(today));

  const handleSubmit = () => {
    if (!startDate || !endDate) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit({
      tripNumber: tripNumber.trim() || `Trip ${Date.now().toString().slice(-4)}`,
      startDate,
      endDate,
    });
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const adjustDate = (field: 'start' | 'end', days: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (field === 'start') {
      const date = new Date(startDate + 'T12:00:00');
      date.setDate(date.getDate() + days);
      const newStartDate = formatDateForInput(date);
      setStartDate(newStartDate);

      // Ensure end date is not before start date
      if (newStartDate > endDate) {
        setEndDate(newStartDate);
      }
    } else {
      const date = new Date(endDate + 'T12:00:00');
      date.setDate(date.getDate() + days);
      const newEndDate = formatDateForInput(date);

      // Ensure end date is not before start date
      if (newEndDate >= startDate) {
        setEndDate(newEndDate);
      }
    }
  };

  const isValid = startDate && endDate && startDate <= endDate;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <Pressable
          onPress={handleClose}
          className="flex-1 bg-black/60 justify-end"
        >
          <Animated.View
            entering={SlideInDown.duration(300)}
            className="bg-slate-900 rounded-t-3xl"
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Header */}
              <View className="flex-row items-center justify-between p-5 border-b border-slate-800">
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center">
                    <Plane size={20} color="#3b82f6" />
                  </View>
                  <Text className="text-white font-bold text-lg ml-3">New Trip</Text>
                </View>
                <Pressable
                  onPress={handleClose}
                  className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
                >
                  <X size={20} color="#64748b" />
                </Pressable>
              </View>

              {/* Form */}
              <View className="p-5">
                {/* Trip Number */}
                <View className="mb-5">
                  <Text className="text-slate-400 text-sm font-medium mb-2">Trip Number</Text>
                  <TextInput
                    value={tripNumber}
                    onChangeText={setTripNumber}
                    placeholder="e.g., T1234"
                    placeholderTextColor="#64748b"
                    className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700"
                    autoCapitalize="characters"
                  />
                </View>

                {/* Start Date */}
                <View className="mb-5">
                  <Text className="text-slate-400 text-sm font-medium mb-2">Start Date</Text>
                  <View className="flex-row items-center">
                    <Pressable
                      onPress={() => adjustDate('start', -1)}
                      className="w-12 h-12 bg-slate-800 rounded-l-xl items-center justify-center border border-slate-700 active:bg-slate-700"
                    >
                      <Text className="text-white text-xl">-</Text>
                    </Pressable>
                    <View className="flex-1 bg-slate-800 px-4 py-3 items-center border-y border-slate-700">
                      <Text className="text-white text-base">{formatDateDisplay(startDate)}</Text>
                    </View>
                    <Pressable
                      onPress={() => adjustDate('start', 1)}
                      className="w-12 h-12 bg-slate-800 rounded-r-xl items-center justify-center border border-slate-700 active:bg-slate-700"
                    >
                      <Text className="text-white text-xl">+</Text>
                    </Pressable>
                  </View>
                </View>

                {/* End Date */}
                <View className="mb-6">
                  <Text className="text-slate-400 text-sm font-medium mb-2">End Date</Text>
                  <View className="flex-row items-center">
                    <Pressable
                      onPress={() => adjustDate('end', -1)}
                      className="w-12 h-12 bg-slate-800 rounded-l-xl items-center justify-center border border-slate-700 active:bg-slate-700"
                    >
                      <Text className="text-white text-xl">-</Text>
                    </Pressable>
                    <View className="flex-1 bg-slate-800 px-4 py-3 items-center border-y border-slate-700">
                      <Text className="text-white text-base">{formatDateDisplay(endDate)}</Text>
                    </View>
                    <Pressable
                      onPress={() => adjustDate('end', 1)}
                      className="w-12 h-12 bg-slate-800 rounded-r-xl items-center justify-center border border-slate-700 active:bg-slate-700"
                    >
                      <Text className="text-white text-xl">+</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Submit Button */}
                <Pressable
                  onPress={handleSubmit}
                  disabled={!isValid || isLoading}
                  className={cn(
                    'rounded-xl py-4 flex-row items-center justify-center',
                    isValid && !isLoading ? 'bg-amber-500 active:opacity-90' : 'bg-slate-700'
                  )}
                >
                  <Plus size={20} color={isValid && !isLoading ? '#000' : '#64748b'} />
                  <Text
                    className={cn(
                      'font-bold text-base ml-2',
                      isValid && !isLoading ? 'text-black' : 'text-slate-500'
                    )}
                  >
                    {isLoading ? 'Creating...' : 'Create Trip'}
                  </Text>
                </Pressable>
              </View>

              {/* Safe area padding */}
              <View className="h-8" />
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
