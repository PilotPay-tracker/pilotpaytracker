/**
 * Sick Time History Screen
 *
 * IMPORTANT: For PERSONAL RECORD-KEEPING ONLY
 * Shows immutable sick usage log entries
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
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
  Paperclip,
  Info,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import { useSickUsage, getCoverageColor, type SickUsage } from '@/lib/useSickTimeTracker';

// ============================================================
// Usage Card
// ============================================================

function UsageCard({ usage }: { usage: SickUsage }) {
  const colors = getCoverageColor(usage.coverageStatus);
  const isSingleDay = usage.startDate === usage.endDate;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 mb-3">
      {/* Header */}
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1">
          <View className="flex-row items-center">
            <Calendar size={16} color="#94a3b8" />
            <Text className="text-white font-semibold ml-2">
              {isSingleDay
                ? new Date(usage.startDate).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : `${new Date(usage.startDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })} - ${new Date(usage.endDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`}
            </Text>
          </View>
          {usage.tripNumber && (
            <View className="flex-row items-center mt-1">
              <FileText size={14} color="#64748b" />
              <Text className="text-slate-500 text-sm ml-1">Trip {usage.tripNumber}</Text>
            </View>
          )}
        </View>

        <View className={cn('px-2 py-1 rounded', colors.bg)}>
          <Text className={cn('text-xs font-semibold', colors.text)}>{usage.coverageStatus}</Text>
        </View>
      </View>

      {/* Hours */}
      <View className="flex-row items-center mb-3">
        <View className="flex-row items-center flex-1">
          <Heart size={18} color="#ef4444" fill="white" />
          <Text className="text-white text-xl font-bold ml-2">{usage.hoursUsed.toFixed(1)} hrs</Text>
        </View>
      </View>

      {/* Balance Change */}
      <View className="bg-slate-900/50 rounded-xl p-3">
        <View className="flex-row justify-between mb-1">
          <Text className="text-slate-400 text-sm">Balance Before</Text>
          <Text className="text-slate-300">{usage.balanceBefore.toFixed(1)} hrs</Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-slate-400 text-sm">Balance After</Text>
          <Text className={usage.balanceAfter > 0 ? 'text-white' : 'text-red-400'}>
            {usage.balanceAfter.toFixed(1)} hrs
          </Text>
        </View>
      </View>

      {/* Notes */}
      {usage.userNotes && (
        <View className="mt-3 pt-3 border-t border-slate-700/50">
          <Text className="text-slate-400 text-sm">{usage.userNotes}</Text>
        </View>
      )}

      {/* Attachments */}
      {usage.attachments && usage.attachments.length > 0 && (
        <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/50">
          <Paperclip size={14} color="#64748b" />
          <Text className="text-slate-500 text-sm ml-1">
            {usage.attachments.length} attachment{usage.attachments.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Timestamp */}
      <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/50">
        <Clock size={12} color="#475569" />
        <Text className="text-slate-600 text-xs ml-1">
          Logged {new Date(usage.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// Empty State
// ============================================================

function EmptyState() {
  return (
    <View className="items-center justify-center py-16">
      <View className="w-16 h-16 rounded-full bg-slate-800/60 items-center justify-center mb-4">
        <Heart size={32} color="#64748b" />
      </View>
      <Text className="text-white text-lg font-semibold mb-2">No Sick Time Logged</Text>
      <Text className="text-slate-500 text-center max-w-xs">
        When you log sick time, it will appear here as an immutable record for your personal
        reference.
      </Text>
    </View>
  );
}

// ============================================================
// Main Screen
// ============================================================

export default function SickHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data: usage, isLoading, refetch } = useSickUsage();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Calculate totals
  const totalHours = usage?.reduce((sum, u) => sum + u.hoursUsed, 0) ?? 0;
  const totalEvents = usage?.length ?? 0;

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
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ef4444" />
          }
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
                <Text className="text-white text-2xl font-bold">Sick Time History</Text>
                <Text className="text-slate-400 text-sm">Immutable records</Text>
              </View>
            </View>

            {/* Disclaimer */}
            <View className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 mb-4">
              <View className="flex-row items-start">
                <Info size={16} color="#94a3b8" />
                <Text className="text-slate-400 text-xs ml-2 flex-1">
                  These records are immutable and cannot be deleted. They serve as your personal
                  audit trail.
                </Text>
              </View>
            </View>
          </View>

          {isLoading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#ef4444" />
              <Text className="text-slate-400 mt-4">Loading history...</Text>
            </View>
          ) : usage && usage.length > 0 ? (
            <View className="px-5">
              {/* Summary */}
              <Animated.View
                entering={FadeInDown.duration(400).delay(100)}
                className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 mb-4"
              >
                <View className="flex-row">
                  <View className="flex-1 items-center">
                    <Text className="text-slate-400 text-sm">Total Events</Text>
                    <Text className="text-white text-2xl font-bold mt-1">{totalEvents}</Text>
                  </View>
                  <View className="w-px bg-slate-700" />
                  <View className="flex-1 items-center">
                    <Text className="text-slate-400 text-sm">Total Hours</Text>
                    <Text className="text-white text-2xl font-bold mt-1">
                      {totalHours.toFixed(1)}
                    </Text>
                  </View>
                </View>
              </Animated.View>

              {/* Usage List */}
              {usage.map((item, index) => (
                <Animated.View
                  key={item.id}
                  entering={FadeInDown.duration(400).delay(150 + index * 50)}
                >
                  <UsageCard usage={item} />
                </Animated.View>
              ))}
            </View>
          ) : (
            <EmptyState />
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
