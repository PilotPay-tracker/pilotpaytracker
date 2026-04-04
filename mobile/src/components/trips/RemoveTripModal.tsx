/**
 * RemoveTripModal
 * Replaces the simple delete confirmation with a 4-option action sheet:
 * 1. Delete from App    — clean delete, no pay impact
 * 2. Drop Trip          — marks as dropped_by_user, reduces guarantee floor
 * 3. Company Removed    — marks as company_removed, preserves pay credit
 * 4. Cancel
 */

import { Modal, View, Text, Pressable } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { Trash2, TrendingDown, Building2, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface RemoveTripModalProps {
  visible: boolean;
  tripNumber?: string;
  onDeleteFromApp: () => void;
  onDropTrip: () => void;
  onCompanyRemoved: () => void;
  onCancel: () => void;
}

export function RemoveTripModal({
  visible,
  tripNumber,
  onDeleteFromApp,
  onDropTrip,
  onCompanyRemoved,
  onCancel,
}: RemoveTripModalProps) {
  const insets = useSafeAreaInsets();
  const label = tripNumber ? `"${tripNumber}"` : 'this trip';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        className="flex-1 bg-black/60"
        onPress={onCancel}
      >
        <Animated.View
          entering={FadeIn.duration(150)}
          className="flex-1 justify-end"
        >
          <Animated.View
            entering={SlideInDown.duration(280).springify()}
          >
            <Pressable>
              <View
                className="bg-slate-900 rounded-t-3xl border-t border-slate-700 px-5 pt-5"
                style={{ paddingBottom: Math.max(insets.bottom, 16) }}
              >
                {/* Handle bar */}
                <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-5" />

                {/* Header */}
                <Text className="text-white text-xl font-bold mb-1">
                  Remove Trip
                </Text>
                <Text className="text-slate-400 text-sm mb-6">
                  How would you like to remove {label}?
                </Text>

                {/* Delete from App */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onDeleteFromApp();
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-3 active:opacity-70"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 bg-slate-700 rounded-xl items-center justify-center">
                      <Trash2 size={18} color="#94a3b8" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-semibold text-base">
                        Delete from App
                      </Text>
                      <Text className="text-slate-400 text-xs mt-0.5">
                        Remove from display only — no pay impact
                      </Text>
                    </View>
                  </View>
                </Pressable>

                {/* Drop Trip */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    onDropTrip();
                  }}
                  className="bg-red-950/60 border border-red-800/50 rounded-2xl p-4 mb-3 active:opacity-70"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 bg-red-900/60 rounded-xl items-center justify-center">
                      <TrendingDown size={18} color="#f87171" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-red-400 font-semibold text-base">
                        Drop Trip
                      </Text>
                      <Text className="text-red-400/70 text-xs mt-0.5">
                        User-caused drop — reduces credit &amp; guarantee floor
                      </Text>
                    </View>
                  </View>
                </Pressable>

                {/* Company Removed */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onCompanyRemoved();
                  }}
                  className="bg-amber-950/60 border border-amber-700/50 rounded-2xl p-4 mb-4 active:opacity-70"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 bg-amber-900/50 rounded-xl items-center justify-center">
                      <Building2 size={18} color="#fbbf24" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-amber-400 font-semibold text-base">
                        Company Removed
                      </Text>
                      <Text className="text-amber-400/70 text-xs mt-0.5">
                        Company-caused removal — pay credit preserved
                      </Text>
                    </View>
                  </View>
                </Pressable>

                {/* Cancel */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onCancel();
                  }}
                  className="bg-slate-800 border border-slate-700 rounded-2xl p-4 active:opacity-70"
                >
                  <View className="flex-row items-center justify-center gap-2">
                    <X size={16} color="#94a3b8" />
                    <Text className="text-slate-300 font-semibold text-base">
                      Cancel
                    </Text>
                  </View>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
