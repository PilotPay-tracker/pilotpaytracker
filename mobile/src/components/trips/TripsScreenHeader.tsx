/**
 * TripsScreenHeader - Premium navigation header
 * Cockpit glass aesthetic with month navigation
 */

import { View, Text, Pressable } from 'react-native';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  List,
  SlidersHorizontal,
  Search,
  X,
  Trash2,
  MoreVertical,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { webSafeExit } from '@/lib/webSafeAnimation';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '@/lib/cn';
import { useState } from 'react';
import { TextInput } from 'react-native';

export type ViewMode = 'list' | 'calendar';

export type TripFilter = 'all' | 'scheduled' | 'completed' | 'needs_review';

interface TripsScreenHeaderProps {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  tripCount: number;
  onImportPress: () => void;
  filter: TripFilter;
  onFilterChange: (filter: TripFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearMonth?: () => void;
  onHelpPress?: () => void;
  pendingReviewsCount?: number;
  onPendingReviewsPress?: () => void;
}

const FILTERS: { value: TripFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'needs_review', label: 'Review' },
];

function MonthNavigator({
  currentMonth,
  onMonthChange,
}: {
  currentMonth: Date;
  onMonthChange: (date: Date) => void;
}) {
  const handlePrevMonth = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    onMonthChange(newDate);
  };

  const handleNextMonth = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    onMonthChange(newDate);
  };

  const handleToday = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onMonthChange(new Date());
  };

  const monthYear = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const isCurrentMonth =
    currentMonth.getMonth() === new Date().getMonth() &&
    currentMonth.getFullYear() === new Date().getFullYear();

  return (
    <View className="flex-row items-center">
      <Pressable
        onPress={handlePrevMonth}
        className="w-9 h-9 rounded-lg bg-slate-800/60 items-center justify-center active:bg-slate-700"
      >
        <ChevronLeft size={20} color="#94a3b8" />
      </Pressable>

      <Pressable onPress={handleToday} className="mx-3 active:opacity-70">
        <Text
          className="text-white text-lg font-bold"
          style={{ fontFamily: 'DMSans_700Bold' }}
        >
          {monthYear}
        </Text>
        {!isCurrentMonth && (
          <Text className="text-cyan-500 text-[10px] text-center">tap for today</Text>
        )}
      </Pressable>

      <Pressable
        onPress={handleNextMonth}
        className="w-9 h-9 rounded-lg bg-slate-800/60 items-center justify-center active:bg-slate-700"
      >
        <ChevronRight size={20} color="#94a3b8" />
      </Pressable>
    </View>
  );
}

export function TripsScreenHeader({
  currentMonth,
  onMonthChange,
  viewMode,
  onViewModeChange,
  tripCount,
  onImportPress,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onClearMonth,
  onHelpPress,
  pendingReviewsCount = 0,
  onPendingReviewsPress,
}: TripsScreenHeaderProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showActions, setShowActions] = useState(false);

  return (
    <View className="px-4 pb-3">
      {/* Pending Reviews Banner */}
      {pendingReviewsCount > 0 && onPendingReviewsPress && (
        <Animated.View entering={FadeIn.duration(200)}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onPendingReviewsPress();
            }}
            className="flex-row items-center bg-amber-500/20 border border-amber-500/40 rounded-xl px-4 py-3 mb-4 active:bg-amber-500/30"
          >
            <AlertTriangle size={18} color="#f59e0b" />
            <View className="flex-1 ml-3">
              <Text className="text-amber-400 font-semibold">
                {pendingReviewsCount} Import{pendingReviewsCount !== 1 ? 's' : ''} Need Review
              </Text>
              <Text className="text-amber-300/70 text-xs">
                Tap to review and confirm
              </Text>
            </View>
            <ChevronRight size={18} color="#f59e0b" />
          </Pressable>
        </Animated.View>
      )}
      {/* Main Header Row */}
      <View className="flex-row items-center justify-between mb-4">
        <MonthNavigator currentMonth={currentMonth} onMonthChange={onMonthChange} />

        <View className="flex-row items-center gap-2">
          {/* Help Button */}
          {onHelpPress && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onHelpPress();
              }}
              className="w-9 h-9 rounded-lg bg-slate-800/60 items-center justify-center active:bg-slate-700"
            >
              <HelpCircle size={18} color="#f59e0b" />
            </Pressable>
          )}

          {/* View Mode Toggle */}
          <View className="flex-row bg-slate-800/60 rounded-lg p-1 mr-2">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onViewModeChange('list');
              }}
              className={cn(
                'px-3 py-1.5 rounded-md',
                viewMode === 'list' ? 'bg-cyan-500/20' : ''
              )}
            >
              <List size={16} color={viewMode === 'list' ? '#06b6d4' : '#64748b'} />
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onViewModeChange('calendar');
              }}
              className={cn(
                'px-3 py-1.5 rounded-md',
                viewMode === 'calendar' ? 'bg-cyan-500/20' : ''
              )}
            >
              <Calendar size={16} color={viewMode === 'calendar' ? '#06b6d4' : '#64748b'} />
            </Pressable>
          </View>

          {/* Import Button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onImportPress();
            }}
            className="w-10 h-10 rounded-xl items-center justify-center overflow-hidden active:opacity-80"
          >
            <LinearGradient
              colors={['#06b6d4', '#0891b2']}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
              }}
            />
            <Plus size={22} color="#ffffff" strokeWidth={2.5} />
          </Pressable>

          {/* More Actions Button */}
          {onClearMonth && tripCount > 0 && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowActions(!showActions);
              }}
              className="w-10 h-10 rounded-xl items-center justify-center ml-2 bg-slate-800/60 active:bg-slate-700"
            >
              <MoreVertical size={20} color="#64748b" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Actions Dropdown */}
      {showActions && onClearMonth && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={webSafeExit(FadeOut.duration(100))}
          className="absolute right-4 top-14 z-50 bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden shadow-2xl"
          style={{ minWidth: 180 }}
        >
          <Pressable
            onPress={() => {
              setShowActions(false);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onClearMonth();
            }}
            className="flex-row items-center px-4 py-3 active:bg-slate-700"
          >
            <Trash2 size={18} color="#ef4444" />
            <Text className="text-red-400 font-medium ml-3">Clear Month</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Filter/Search Row */}
      <View className="flex-row items-center">
        {/* Filter Pills */}
        <View className="flex-row flex-1 mr-3">
          {FILTERS.map(f => (
            <Pressable
              key={f.value}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onFilterChange(f.value);
              }}
              className={cn(
                'px-3 py-1.5 rounded-full mr-2',
                filter === f.value ? 'bg-cyan-500/20' : 'bg-slate-800/40'
              )}
            >
              <Text
                className={cn(
                  'text-xs font-medium',
                  filter === f.value ? 'text-cyan-400' : 'text-slate-400'
                )}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Search Toggle */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowSearch(!showSearch);
            if (showSearch) {
              onSearchChange('');
            }
          }}
          className={cn(
            'w-9 h-9 rounded-lg items-center justify-center',
            showSearch || searchQuery ? 'bg-cyan-500/20' : 'bg-slate-800/40'
          )}
        >
          {showSearch || searchQuery ? (
            <X size={16} color="#06b6d4" />
          ) : (
            <Search size={16} color="#64748b" />
          )}
        </Pressable>
      </View>

      {/* Search Input */}
      {showSearch && (
        <Animated.View entering={FadeIn.duration(200)} exiting={webSafeExit(FadeOut.duration(150))} className="mt-3">
          <View className="bg-slate-800/60 rounded-xl px-4 py-3 flex-row items-center">
            <Search size={16} color="#64748b" />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder="Search trips, routes..."
              placeholderTextColor="#64748b"
              className="flex-1 text-white ml-2"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery && (
              <Pressable
                onPress={() => onSearchChange('')}
                className="w-6 h-6 rounded-full bg-slate-700 items-center justify-center"
              >
                <X size={12} color="#94a3b8" />
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}

      {/* Trip Count */}
      <View className="mt-3 flex-row items-center">
        <Text className="text-slate-500 text-xs">
          {tripCount} trip{tripCount !== 1 ? 's' : ''}
          {filter !== 'all' ? ` (${filter.replace('_', ' ')})` : ''}
        </Text>
      </View>
    </View>
  );
}
