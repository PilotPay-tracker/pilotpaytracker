/**
 * NewChangesPopup - A popup notification that appears when new schedule changes are detected
 *
 * Shows as a floating banner at the top of the screen when there are unacknowledged changes.
 */

import { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, X, ChevronRight } from "lucide-react-native";
import Animated, {
  FadeInUp,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { webSafeExit } from '@/lib/webSafeAnimation';

interface NewChangesPopupProps {
  count: number;
  onPress: () => void;
  onDismiss: () => void;
  visible?: boolean;
}

export function NewChangesPopup({
  count,
  onPress,
  onDismiss,
  visible = true,
}: NewChangesPopupProps) {
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const previousCount = useRef(count);

  // Subtle pulse animation for the badge
  const scale = useSharedValue(1);

  useEffect(() => {
    // Trigger attention pulse when count increases
    if (count > previousCount.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      scale.value = withSequence(
        withSpring(1.1, { damping: 5 }),
        withSpring(1, { damping: 8 })
      );
    }
    previousCount.current = count;
  }, [count]);

  const badgeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Don't show if dismissed, count is 0, or not visible
  if (dismissed || count === 0 || !visible) {
    return null;
  }

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDismissed(true);
    onDismiss();
  };

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(15)}
      exiting={webSafeExit(FadeOutUp.springify())}
      style={{ paddingTop: 8 }}
      className="absolute left-4 right-4 z-50"
    >
      <Pressable
        onPress={handlePress}
        className="bg-amber-500/95 rounded-2xl shadow-lg active:opacity-90"
        style={{
          shadowColor: "#f59e0b",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <View className="flex-row items-center px-4 py-3">
          {/* Icon with badge */}
          <Animated.View
            style={badgeAnimatedStyle}
            className="w-10 h-10 rounded-xl bg-amber-600/50 items-center justify-center mr-3"
          >
            <AlertTriangle size={20} color="#0f172a" />
            <View className="absolute -top-1 -right-1 bg-slate-900 rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
              <Text className="text-amber-400 text-[10px] font-bold">
                {count > 9 ? "9+" : count}
              </Text>
            </View>
          </Animated.View>

          {/* Content */}
          <View className="flex-1">
            <Text className="text-slate-900 font-bold text-sm">
              New Schedule Change{count !== 1 ? "s" : ""} Detected
            </Text>
            <Text className="text-slate-800/80 text-xs mt-0.5">
              Tap to review and accept changes
            </Text>
          </View>

          {/* Arrow */}
          <ChevronRight size={20} color="#0f172a" style={{ marginRight: 4 }} />

          {/* Dismiss button */}
          <Pressable
            onPress={handleDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            className="w-7 h-7 rounded-full bg-amber-600/50 items-center justify-center active:bg-amber-600"
          >
            <X size={14} color="#0f172a" />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}
