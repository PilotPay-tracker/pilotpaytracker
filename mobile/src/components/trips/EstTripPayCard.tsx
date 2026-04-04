/**
 * EstTripPayCard - Premium pay estimation display
 *
 * Displays trip totals in a table format:
 * - Credit, Block, Per Diem, TAFB, Days
 * - Large Est Trip Pay calculation
 * - Matches the cockpit glass aesthetic
 */

import { View, Text, Pressable } from 'react-native';
import { DollarSign, TrendingUp, Clock, Plane, Calendar } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { formatMinutesToTime, formatCentsToCurrency } from '@/lib/useTripsData';

export interface TripTotals {
  creditMin: number;      // Total credit in minutes
  blockMin: number;       // Total block in minutes
  tafbMin: number;        // Time Away From Base in minutes
  dutyDays: number;       // Number of duty days
  perDiemCents: number;   // Per diem in cents
}

export interface TripPayInfo {
  hourlyRateCents: number;   // e.g., 23300 for $233/hr
  estTripPayCents: number;   // creditHours * hourlyRate
  perDiemCents: number;      // from totals
  estTotalCents: number;     // estTripPay + perDiem
}

interface EstTripPayCardProps {
  /** Card title (e.g., "TRIP • SDF → SDF" or "S5055") */
  title: string;
  /** Optional subtitle (e.g., date range) */
  subtitle?: string;
  /** Trip totals for the summary table */
  totals: TripTotals;
  /** Pay calculation details */
  pay: TripPayInfo;
  /** Optional: Show confidence indicator */
  confidence?: 'high' | 'medium' | 'low';
  /** Optional: Stagger animation delay index */
  index?: number;
  /** Optional: Press handler */
  onPress?: () => void;
}

// Helper to calculate pay from totals
export function calcTripPay(totals: TripTotals, hourlyRateCents: number): TripPayInfo {
  const creditHours = totals.creditMin / 60;
  const estTripPayCents = Math.round(creditHours * hourlyRateCents);
  const perDiemCents = totals.perDiemCents || 0;
  const estTotalCents = estTripPayCents + perDiemCents;

  return {
    hourlyRateCents,
    estTripPayCents,
    perDiemCents,
    estTotalCents,
  };
}

// Mini column for stats table
function StatColumn({
  label,
  value,
  valueColor = 'text-white',
  mono = true,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <View className="items-center flex-1">
      <Text className="text-slate-500 text-[9px] uppercase font-bold tracking-wider mb-1">
        {label}
      </Text>
      <Text
        className={`text-sm font-bold ${valueColor}`}
        style={mono ? { fontFamily: 'JetBrainsMono_400Regular' } : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

// Confidence badge
function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'HIGH' },
    medium: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'MED' },
    low: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'LOW' },
  };

  const { bg, text, label } = config[level];

  return (
    <View className={`${bg} px-2 py-0.5 rounded-full`}>
      <Text className={`${text} text-[9px] font-bold`}>{label}</Text>
    </View>
  );
}

export function EstTripPayCard({
  title,
  subtitle,
  totals,
  pay,
  confidence,
  index = 0,
  onPress,
}: EstTripPayCardProps) {
  const handlePress = () => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  const CardContent = (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 80).springify()}
      className="bg-slate-900/95 border border-slate-700/60 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800/80">
        <View className="flex-row items-center">
          <View className="w-1 h-6 bg-cyan-500 rounded-full mr-3" />
          <View>
            <Text
              className="text-white text-base font-bold"
              style={{ fontFamily: 'JetBrainsMono_500Medium' }}
            >
              {title}
            </Text>
            {subtitle && (
              <Text className="text-slate-500 text-xs mt-0.5">{subtitle}</Text>
            )}
          </View>
        </View>

        {confidence && <ConfidenceBadge level={confidence} />}
      </View>

      {/* Stats Table Row */}
      <View className="flex-row items-center justify-between px-3 py-4 border-b border-slate-800/50">
        <StatColumn
          label="CREDIT"
          value={formatMinutesToTime(totals.creditMin)}
          valueColor="text-cyan-400"
        />

        <View className="h-8 w-px bg-slate-700/50" />

        <StatColumn
          label="BLOCK"
          value={formatMinutesToTime(totals.blockMin)}
          valueColor="text-amber-400"
        />

        <View className="h-8 w-px bg-slate-700/50" />

        <StatColumn
          label="PER DIEM"
          value={formatCentsToCurrency(totals.perDiemCents)}
          valueColor="text-slate-300"
        />

        <View className="h-8 w-px bg-slate-700/50" />

        <StatColumn
          label="TAFB"
          value={formatMinutesToTime(totals.tafbMin)}
          valueColor="text-slate-300"
        />

        <View className="h-8 w-px bg-slate-700/50" />

        <StatColumn
          label="DAYS"
          value={String(totals.dutyDays)}
          valueColor="text-white"
          mono={false}
        />
      </View>

      {/* Est Trip Pay Section */}
      <LinearGradient
        colors={['rgba(16, 185, 129, 0.08)', 'rgba(16, 185, 129, 0.02)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingHorizontal: 16, paddingVertical: 16 }}
      >
        {/* Calculation explanation */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <TrendingUp size={14} color="#10b981" />
            <Text className="text-emerald-400/80 text-xs font-semibold ml-1.5">
              Est. Trip Pay
            </Text>
          </View>
          <Text className="text-emerald-400/60 text-[10px]">
            {formatMinutesToTime(totals.creditMin)} × ${(pay.hourlyRateCents / 100).toFixed(0)}/hr
          </Text>
        </View>

        {/* Large pay amount */}
        <Text
          className="text-emerald-400 text-3xl font-bold"
          style={{ fontFamily: 'JetBrainsMono_500Medium' }}
        >
          {formatCentsToCurrency(pay.estTripPayCents)}
        </Text>

        {/* Per diem + total breakdown */}
        <View className="flex-row items-center mt-3 pt-3 border-t border-emerald-500/20">
          <View className="flex-row items-center flex-1">
            <Text className="text-slate-500 text-xs">Per Diem:</Text>
            <Text className="text-slate-400 text-xs font-medium ml-1">
              {formatCentsToCurrency(pay.perDiemCents)}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Text className="text-slate-500 text-xs">Est Total:</Text>
            <Text className="text-emerald-400/80 text-sm font-bold ml-1">
              {formatCentsToCurrency(pay.estTotalCents)}
            </Text>
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable onPress={handlePress} className="active:opacity-90">
        {CardContent}
      </Pressable>
    );
  }

  return CardContent;
}

/**
 * MonthPaySummaryCard - Monthly summary with pay focus
 * Shows aggregated totals for the current month
 */
interface MonthPaySummaryCardProps {
  monthLabel: string;
  totals: TripTotals;
  pay: TripPayInfo;
  tripCount: number;
  onViewDashboard?: () => void;
}

export function MonthPaySummaryCard({
  monthLabel,
  totals,
  pay,
  tripCount,
  onViewDashboard,
}: MonthPaySummaryCardProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      className="bg-slate-900/80 border border-slate-700/50 rounded-2xl overflow-hidden mb-4"
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800/50">
        <View className="flex-row items-center">
          <Calendar size={14} color="#f59e0b" />
          <Text className="text-amber-400 text-xs font-semibold uppercase tracking-wider ml-2">
            {monthLabel} Summary
          </Text>
        </View>

        {onViewDashboard && (
          <Pressable
            onPress={onViewDashboard}
            className="px-2.5 py-1 bg-cyan-500/20 rounded-md active:opacity-70"
          >
            <Text className="text-cyan-400 text-[10px] font-medium">View Dashboard</Text>
          </Pressable>
        )}
      </View>

      {/* Stats Row */}
      <View className="flex-row items-center justify-around py-4 px-2">
        <View className="items-center flex-1">
          <Text
            className="text-white text-xl font-bold"
            style={{ fontFamily: 'JetBrainsMono_500Medium' }}
          >
            {formatMinutesToTime(totals.blockMin)}
          </Text>
          <Text className="text-slate-500 text-[10px] mt-1">Block Hrs</Text>
        </View>

        <View className="w-px h-8 bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text
            className="text-cyan-400 text-xl font-bold"
            style={{ fontFamily: 'JetBrainsMono_500Medium' }}
          >
            {formatMinutesToTime(totals.creditMin)}
          </Text>
          <Text className="text-slate-500 text-[10px] mt-1">Credit Hrs</Text>
        </View>

        <View className="w-px h-8 bg-slate-700/50" />

        <View className="items-center flex-1">
          <Text
            className="text-emerald-400 text-xl font-bold"
            style={{ fontFamily: 'JetBrainsMono_500Medium' }}
          >
            {formatCentsToCurrency(pay.estTripPayCents)}
          </Text>
          <Text className="text-slate-500 text-[10px] mt-1">Est. Pay</Text>
        </View>
      </View>

      {/* Trip Count Footer */}
      <View className="flex-row items-center justify-center pb-3">
        <Plane size={12} color="#64748b" style={{ transform: [{ rotate: '45deg' }] }} />
        <Text className="text-slate-500 text-xs ml-1.5">
          {tripCount} trip{tripCount !== 1 ? 's' : ''} this month
        </Text>
      </View>
    </Animated.View>
  );
}
