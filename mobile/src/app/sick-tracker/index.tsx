/**
 * Sick Time Tracker
 *
 * IMPORTANT: For PERSONAL RECORD-KEEPING ONLY
 * Does NOT submit, modify, validate, or sync with payroll, scheduling, or company systems
 * All values are user-entered or estimated for reference
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Heart,
  Clock,
  TrendingUp,
  DollarSign,
  AlertCircle,
  ChevronRight,
  Info,
  Calendar,
  Plus,
  Check,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import { HelpButton, useAutoTutorial } from '@/components/TutorialModal';
import {
  useSickBank,
  useUpdateSickBank,
  useSickSummary,
  useSickAccruals,
  useSickUsage,
  formatSickHours,
  formatSickPayout,
  getCoverageColor,
} from '@/lib/useSickTimeTracker';

// ============================================================
// Balance Progress Bar
// ============================================================

function BalanceProgressBar({ balance, cap }: { balance: number; cap: number }) {
  const percentage = Math.min(100, (balance / cap) * 100);
  const isCapped = balance >= cap;

  return (
    <View className="mt-4">
      <View className="flex-row justify-between mb-2">
        <Text className="text-slate-400 text-sm">Sick Bank</Text>
        <Text className="text-slate-300 text-sm">
          {balance.toFixed(1)} / {cap} hrs
        </Text>
      </View>
      <View className="h-3 bg-slate-800 rounded-full overflow-hidden">
        <Animated.View
          entering={FadeIn.duration(600)}
          className={cn('h-full rounded-full', isCapped ? 'bg-amber-500' : 'bg-red-500')}
          style={{ width: `${percentage}%` }}
        />
      </View>
      {isCapped && (
        <View className="flex-row items-center mt-2">
          <AlertCircle size={14} color="#f59e0b" />
          <Text className="text-amber-400 text-xs ml-1">
            Cap reached — accrual paused
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// Edit Balance Modal (inline)
// ============================================================

function EditBalanceSection({
  currentBalance,
  onSave,
  isLoading,
}: {
  currentBalance: number;
  onSave: (newBalance: number) => void;
  isLoading: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentBalance.toString());

  useEffect(() => {
    setValue(currentBalance.toString());
  }, [currentBalance]);

  const handleSave = () => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      onSave(numValue);
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setIsEditing(true);
        }}
        className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 active:opacity-80"
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-xl bg-red-500/20 items-center justify-center">
              <Heart size={20} color="#ef4444" fill="white" />
            </View>
            <View className="ml-3">
              <Text className="text-slate-400 text-sm">Current Balance</Text>
              <Text className="text-white text-2xl font-bold">
                {currentBalance.toFixed(1)} hrs
              </Text>
            </View>
          </View>
          <View className="bg-slate-700/50 px-3 py-1.5 rounded-lg">
            <Text className="text-slate-300 text-sm">Edit</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-red-500/50">
      <Text className="text-white font-semibold mb-3">Edit Sick Bank Balance</Text>
      <View className="flex-row items-center">
        <TextInput
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          className="flex-1 bg-slate-900 text-white text-xl font-bold p-3 rounded-xl border border-slate-700"
          placeholder="0.0"
          placeholderTextColor="#64748b"
          autoFocus
        />
        <Text className="text-slate-400 ml-2">hours</Text>
      </View>
      <View className="flex-row gap-3 mt-4">
        <Pressable
          onPress={() => setIsEditing(false)}
          className="flex-1 bg-slate-700 py-3 rounded-xl items-center"
        >
          <Text className="text-white font-semibold">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={isLoading}
          className="flex-1 bg-red-500 py-3 rounded-xl items-center flex-row justify-center"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <>
              <Check size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Save</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================
// Rolling 12-Month Summary Card
// ============================================================

function Rolling12MonthCard({
  eventCount,
  totalHours,
  avgPerEvent,
}: {
  eventCount: number;
  totalHours: number;
  avgPerEvent: number;
}) {
  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-4">
        <View className="w-9 h-9 rounded-lg bg-blue-500/20 items-center justify-center">
          <Calendar size={18} color="#3b82f6" />
        </View>
        <Text className="text-white font-semibold ml-3">Rolling 12 Months</Text>
      </View>

      <View className="flex-row">
        <View className="flex-1">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Events</Text>
          <Text className="text-white text-xl font-bold mt-1">{eventCount}</Text>
        </View>
        <View className="w-px bg-slate-700 mx-2" />
        <View className="flex-1">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Hours Used</Text>
          <Text className="text-white text-xl font-bold mt-1">{totalHours.toFixed(1)}</Text>
        </View>
        <View className="w-px bg-slate-700 mx-2" />
        <View className="flex-1">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">Avg / Event</Text>
          <Text className="text-white text-xl font-bold mt-1">{avgPerEvent.toFixed(1)}</Text>
        </View>
      </View>
    </View>
  );
}

// ============================================================
// Payout Estimator Card
// ============================================================

function PayoutEstimatorCard({
  eligibleHours,
  estimatedPayout,
  hourlyRate,
}: {
  eligibleHours: number;
  estimatedPayout: number;
  hourlyRate: number;
}) {
  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-3">
        <View className="w-9 h-9 rounded-lg bg-green-500/20 items-center justify-center">
          <DollarSign size={18} color="#22c55e" />
        </View>
        <Text className="text-white font-semibold ml-3">Payout Estimator</Text>
      </View>

      <View className="bg-slate-900/50 rounded-xl p-3 mb-3">
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Hours above 75</Text>
          <Text className="text-white font-medium">{eligibleHours.toFixed(1)} hrs</Text>
        </View>
        <View className="flex-row justify-between mb-2">
          <Text className="text-slate-400 text-sm">Hourly Rate</Text>
          <Text className="text-white font-medium">${(hourlyRate / 100).toFixed(2)}</Text>
        </View>
        <View className="h-px bg-slate-700 my-2" />
        <View className="flex-row justify-between">
          <Text className="text-slate-300 font-medium">Estimated Payout</Text>
          <Text className="text-green-400 text-lg font-bold">
            {formatSickPayout(estimatedPayout)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-start">
        <Info size={14} color="#64748b" />
        <Text className="text-slate-500 text-xs ml-2 flex-1">
          Estimate only — personal reference. Not connected to payroll.
        </Text>
      </View>
    </View>
  );
}

// ============================================================
// Accrual Settings Card
// ============================================================

function AccrualSettingsCard({
  accrualRate,
  capReached,
}: {
  accrualRate: number;
  capReached: boolean;
}) {
  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-3">
        <View className="w-9 h-9 rounded-lg bg-violet-500/20 items-center justify-center">
          <TrendingUp size={18} color="#8b5cf6" />
        </View>
        <Text className="text-white font-semibold ml-3">Accrual</Text>
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="text-slate-400">Rate per Bid Period</Text>
        <Text className="text-white font-bold">{accrualRate} hrs</Text>
      </View>

      {capReached && (
        <View className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mt-3">
          <Text className="text-amber-400 text-sm">
            Accrual paused — bank at cap (1,200 hrs)
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================
// Recent Usage Card
// ============================================================

function RecentUsageCard({
  events,
  onViewAll,
}: {
  events: Array<{
    id: string;
    startDate: string;
    endDate: string;
    hoursUsed: number;
    coverageStatus: string;
    tripNumber: string | null;
  }>;
  onViewAll: () => void;
}) {
  if (events.length === 0) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
        <View className="flex-row items-center mb-3">
          <View className="w-9 h-9 rounded-lg bg-slate-700/50 items-center justify-center">
            <Clock size={18} color="#94a3b8" />
          </View>
          <Text className="text-white font-semibold ml-3">Recent Usage</Text>
        </View>
        <Text className="text-slate-500 text-center py-4">
          No sick time logged yet
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <View className="w-9 h-9 rounded-lg bg-slate-700/50 items-center justify-center">
            <Clock size={18} color="#94a3b8" />
          </View>
          <Text className="text-white font-semibold ml-3">Recent Usage</Text>
        </View>
        <Pressable onPress={onViewAll} className="flex-row items-center">
          <Text className="text-slate-400 text-sm mr-1">View All</Text>
          <ChevronRight size={16} color="#64748b" />
        </Pressable>
      </View>

      {events.slice(0, 3).map((event, index) => {
        const colors = getCoverageColor(event.coverageStatus as 'FULL' | 'PARTIAL' | 'NONE');
        return (
          <View
            key={event.id}
            className={cn('py-3', index > 0 && 'border-t border-slate-700/50')}
          >
            <View className="flex-row justify-between items-center">
              <View>
                <Text className="text-white font-medium">
                  {event.startDate === event.endDate
                    ? event.startDate
                    : `${event.startDate} - ${event.endDate}`}
                </Text>
                {event.tripNumber && (
                  <Text className="text-slate-500 text-sm mt-0.5">
                    Trip {event.tripNumber}
                  </Text>
                )}
              </View>
              <View className="items-end">
                <Text className="text-white font-bold">{event.hoursUsed.toFixed(1)} hrs</Text>
                <View className={cn('px-2 py-0.5 rounded mt-1', colors.bg)}>
                  <Text className={cn('text-xs font-medium', colors.text)}>
                    {event.coverageStatus}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ============================================================
// Main Screen
// ============================================================

export default function SickTimeTrackerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { TutorialModalComponent } = useAutoTutorial('sick_tracker');

  const { data: sickBank, isLoading: bankLoading, refetch: refetchBank } = useSickBank();
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useSickSummary();
  const updateBank = useUpdateSickBank();

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchBank(), refetchSummary()]);
    setRefreshing(false);
  }, [refetchBank, refetchSummary]);

  const handleUpdateBalance = useCallback(
    (newBalance: number) => {
      updateBank.mutate({ balanceHours: newBalance });
    },
    [updateBank]
  );

  const isLoading = bankLoading || summaryLoading;

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
                <Text className="text-white text-2xl font-bold">Sick Time Tracker</Text>
                <Text className="text-slate-400 text-sm">Personal record-keeping</Text>
              </View>
              <HelpButton tutorialId="sick_tracker" />
            </View>

            {/* Disclaimer Banner */}
            <Animated.View
              entering={FadeInDown.duration(400).delay(100)}
              className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-3 mb-4"
            >
              <View className="flex-row items-start">
                <Info size={16} color="#94a3b8" />
                <Text className="text-slate-400 text-xs ml-2 flex-1">
                  This tracker is for personal reference only. It does not connect to, modify, or
                  sync with any company payroll or scheduling systems.
                </Text>
              </View>
            </Animated.View>
          </View>

          {isLoading && !sickBank ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#ef4444" />
              <Text className="text-slate-400 mt-4">Loading sick bank...</Text>
            </View>
          ) : (
            <View className="px-5">
              {/* PHASE 1: Sick Bank Balance */}
              <Animated.View entering={FadeInDown.duration(400).delay(150)}>
                <EditBalanceSection
                  currentBalance={sickBank?.balanceHours ?? 0}
                  onSave={handleUpdateBalance}
                  isLoading={updateBank.isPending}
                />

                {/* Progress Bar */}
                <BalanceProgressBar
                  balance={sickBank?.balanceHours ?? 0}
                  cap={sickBank?.capHours ?? 1200}
                />
              </Animated.View>

              {/* PHASE 5: Rolling 12-Month Summary */}
              <Animated.View entering={FadeInDown.duration(400).delay(200)} className="mt-6">
                <Rolling12MonthCard
                  eventCount={summary?.rolling12Month.eventCount ?? 0}
                  totalHours={summary?.rolling12Month.totalHoursUsed ?? 0}
                  avgPerEvent={summary?.rolling12Month.avgHoursPerEvent ?? 0}
                />
              </Animated.View>

              {/* PHASE 6: Payout Estimator */}
              <Animated.View entering={FadeInDown.duration(400).delay(250)} className="mt-4">
                <PayoutEstimatorCard
                  eligibleHours={sickBank?.payoutEstimate.eligibleHours ?? 0}
                  estimatedPayout={sickBank?.payoutEstimate.estimatedPayoutCents ?? 0}
                  hourlyRate={sickBank?.payoutEstimate.hourlyRateCents ?? 32500}
                />
              </Animated.View>

              {/* PHASE 2: Accrual Settings */}
              <Animated.View entering={FadeInDown.duration(400).delay(300)} className="mt-4">
                <AccrualSettingsCard
                  accrualRate={sickBank?.accrualRateHours ?? 5.5}
                  capReached={sickBank?.capReached ?? false}
                />
              </Animated.View>

              {/* Recent Usage */}
              <Animated.View entering={FadeInDown.duration(400).delay(350)} className="mt-4">
                <RecentUsageCard
                  events={summary?.recentEvents ?? []}
                  onViewAll={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/sick-tracker/history' as never);
                  }}
                />
              </Animated.View>

              {/* Log Sick Time Button */}
              <Animated.View entering={FadeInDown.duration(400).delay(400)} className="mt-6">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push('/sick-tracker/log' as never);
                  }}
                  className="bg-red-500 py-4 rounded-2xl flex-row items-center justify-center active:bg-red-600"
                >
                  <Plus size={20} color="white" />
                  <Text className="text-white font-bold text-lg ml-2">Log Sick Time</Text>
                </Pressable>
              </Animated.View>
            </View>
          )}
        </ScrollView>
      </LinearGradient>
      {TutorialModalComponent}
    </View>
  );
}
