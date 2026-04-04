/**
 * EmptyTripsState - Beautiful empty state for trips
 * Encourages users to import their schedule
 */

import { View, Text, Pressable } from 'react-native';
import { Plane, Upload, Calendar, Sparkles } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';

interface EmptyTripsStateProps {
  onImportPress: () => void;
  monthLabel: string;
}

function FloatingPlane() {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-15, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(15, { duration: 2000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    translateX.value = withRepeat(
      withSequence(
        withTiming(8, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(-8, { duration: 3000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    rotate.value = withRepeat(
      withSequence(
        withTiming(5, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
        withTiming(-5, { duration: 2500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <View className="w-24 h-24 rounded-full bg-cyan-500/10 items-center justify-center">
        <Plane size={48} color="#06b6d4" style={{ transform: [{ rotate: '45deg' }] }} />
      </View>
    </Animated.View>
  );
}

export function EmptyTripsState({ onImportPress, monthLabel }: EmptyTripsStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      <Animated.View entering={FadeIn.duration(600)} className="items-center">
        <FloatingPlane />

        <Animated.Text
          entering={FadeInDown.duration(400).delay(200)}
          className="text-white text-2xl font-bold text-center mt-8"
          style={{ fontFamily: 'DMSans_700Bold' }}
        >
          No trips for {monthLabel}
        </Animated.Text>

        <Animated.Text
          entering={FadeInDown.duration(400).delay(300)}
          className="text-slate-400 text-center mt-3 mb-8 leading-5"
        >
          Import your schedule to start tracking{'\n'}flights, credit, and pay
        </Animated.Text>

        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onImportPress();
            }}
            className="overflow-hidden rounded-2xl active:opacity-90"
          >
            <LinearGradient
              colors={['#06b6d4', '#0891b2']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ paddingHorizontal: 32, paddingVertical: 16 }}
            >
              <View className="flex-row items-center">
                <Upload size={20} color="#ffffff" />
                <Text
                  className="text-white font-bold text-base ml-2"
                  style={{ fontFamily: 'DMSans_700Bold' }}
                >
                  Import Schedule
                </Text>
              </View>
            </LinearGradient>
          </Pressable>
        </Animated.View>

        {/* Features List */}
        <Animated.View
          entering={FadeInDown.duration(400).delay(500)}
          className="mt-10 bg-slate-800/30 rounded-2xl p-5 w-full"
        >
          <View className="flex-row items-center mb-4">
            <Sparkles size={16} color="#06b6d4" />
            <Text className="text-white font-semibold ml-2">What gets imported</Text>
          </View>

          {[
            { icon: Plane, text: 'Flight numbers & routes' },
            { icon: Calendar, text: 'Block time & credit hours' },
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <View key={idx} className="flex-row items-center mb-2 last:mb-0">
                <View className="w-6 h-6 rounded-full bg-cyan-500/10 items-center justify-center mr-3">
                  <Icon size={12} color="#06b6d4" />
                </View>
                <Text className="text-slate-400 text-sm">{item.text}</Text>
              </View>
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
