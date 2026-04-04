/**
 * Add Leg Modal Component
 * Creates a new flight leg within a duty day
 */

import { View, Text, Pressable, TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView, Switch } from 'react-native';
import { X, Plane, Plus } from 'lucide-react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';

interface AddLegModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    flightNumber?: string;
    origin?: string;
    destination?: string;
    equipment?: string;
    isDeadhead?: boolean;
    plannedBlockMinutes?: number;
  }) => void;
  isLoading?: boolean;
}

export function AddLegModal({ visible, onClose, onSubmit, isLoading }: AddLegModalProps) {
  const [flightNumber, setFlightNumber] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [equipment, setEquipment] = useState('');
  const [isDeadhead, setIsDeadhead] = useState(false);
  const [blockHours, setBlockHours] = useState('');
  const [blockMins, setBlockMins] = useState('');

  const handleSubmit = () => {
    if (!origin || !destination) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const hours = parseInt(blockHours) || 0;
    const mins = parseInt(blockMins) || 0;
    const plannedBlockMinutes = hours * 60 + mins;

    onSubmit({
      flightNumber: flightNumber.trim() || undefined,
      origin: origin.toUpperCase().trim(),
      destination: destination.toUpperCase().trim(),
      equipment: equipment.trim() || undefined,
      isDeadhead,
      plannedBlockMinutes: plannedBlockMinutes > 0 ? plannedBlockMinutes : undefined,
    });

    // Reset form
    setFlightNumber('');
    setOrigin('');
    setDestination('');
    setEquipment('');
    setIsDeadhead(false);
    setBlockHours('');
    setBlockMins('');
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const isValid = origin.length >= 2 && destination.length >= 2;

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
                  <Text className="text-white font-bold text-lg ml-3">Add Leg</Text>
                </View>
                <Pressable
                  onPress={handleClose}
                  className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
                >
                  <X size={20} color="#64748b" />
                </Pressable>
              </View>

              {/* Form */}
              <ScrollView className="p-5" keyboardShouldPersistTaps="handled">
                {/* Flight Number */}
                <View className="mb-4">
                  <Text className="text-slate-400 text-sm font-medium mb-2">Flight Number</Text>
                  <TextInput
                    value={flightNumber}
                    onChangeText={setFlightNumber}
                    placeholder="e.g., 2791"
                    placeholderTextColor="#64748b"
                    className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700"
                    autoCapitalize="characters"
                  />
                </View>

                {/* Origin & Destination */}
                <View className="flex-row mb-4">
                  <View className="flex-1 mr-2">
                    <Text className="text-slate-400 text-sm font-medium mb-2">Origin</Text>
                    <TextInput
                      value={origin}
                      onChangeText={setOrigin}
                      placeholder="SDF"
                      placeholderTextColor="#64748b"
                      className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700 text-center"
                      autoCapitalize="characters"
                      maxLength={3}
                    />
                  </View>
                  <View className="flex-1 ml-2">
                    <Text className="text-slate-400 text-sm font-medium mb-2">Destination</Text>
                    <TextInput
                      value={destination}
                      onChangeText={setDestination}
                      placeholder="ANC"
                      placeholderTextColor="#64748b"
                      className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700 text-center"
                      autoCapitalize="characters"
                      maxLength={3}
                    />
                  </View>
                </View>

                {/* Equipment */}
                <View className="mb-4">
                  <Text className="text-slate-400 text-sm font-medium mb-2">Equipment</Text>
                  <TextInput
                    value={equipment}
                    onChangeText={setEquipment}
                    placeholder="e.g., 767"
                    placeholderTextColor="#64748b"
                    className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700"
                    autoCapitalize="characters"
                  />
                </View>

                {/* Planned Block Time */}
                <View className="mb-4">
                  <Text className="text-slate-400 text-sm font-medium mb-2">Planned Block Time</Text>
                  <View className="flex-row items-center">
                    <View className="flex-1 mr-2">
                      <TextInput
                        value={blockHours}
                        onChangeText={setBlockHours}
                        placeholder="0"
                        placeholderTextColor="#64748b"
                        className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700 text-center"
                        keyboardType="numeric"
                        maxLength={2}
                      />
                      <Text className="text-slate-500 text-xs text-center mt-1">Hours</Text>
                    </View>
                    <Text className="text-slate-500 text-xl">:</Text>
                    <View className="flex-1 ml-2">
                      <TextInput
                        value={blockMins}
                        onChangeText={setBlockMins}
                        placeholder="00"
                        placeholderTextColor="#64748b"
                        className="bg-slate-800 text-white text-lg px-4 py-3 rounded-xl border border-slate-700 text-center"
                        keyboardType="numeric"
                        maxLength={2}
                      />
                      <Text className="text-slate-500 text-xs text-center mt-1">Minutes</Text>
                    </View>
                  </View>
                </View>

                {/* Deadhead Toggle */}
                <View className="flex-row items-center justify-between bg-slate-800/60 rounded-xl p-4 mb-6">
                  <View>
                    <Text className="text-white font-medium">Deadhead</Text>
                    <Text className="text-slate-400 text-xs">Passenger/positioning flight</Text>
                  </View>
                  <Switch
                    value={isDeadhead}
                    onValueChange={setIsDeadhead}
                    trackColor={{ false: '#334155', true: '#f59e0b' }}
                    thumbColor="#fff"
                  />
                </View>

                {/* Submit Button */}
                <Pressable
                  onPress={handleSubmit}
                  disabled={!isValid || isLoading}
                  className={cn(
                    'rounded-xl py-4 flex-row items-center justify-center mb-4',
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
                    {isLoading ? 'Adding...' : 'Add Leg'}
                  </Text>
                </Pressable>
              </ScrollView>

              {/* Safe area padding */}
              <View className="h-8" />
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
