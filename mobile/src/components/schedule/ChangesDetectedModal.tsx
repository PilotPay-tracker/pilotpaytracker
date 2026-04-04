/**
 * Changes Detected Modal
 *
 * Displays detected schedule changes with two-column diff visualization
 * and AI-suggested pay events for logging.
 *
 * Supports both snapshot-based changes and calendar sync changes.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plane,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Plus,
  Minus,
  RefreshCw,
  FileText,
  DollarSign,
  ChevronRight,
  ChevronDown,
  MapPin,
  Calendar,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeInDown,
  SlideInUp,
  Layout,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '@/lib/cn';
import {
  useScheduleChanges,
  useAcknowledgeChange,
  type ScheduleChange,
} from '@/lib/useSnapshotData';

interface ChangesDetectedModalProps {
  visible: boolean;
  onClose: () => void;
  onLogPayEvent?: (change: ScheduleChange) => void;
}

// Format minutes as HH:MM
function formatMinutes(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${hours}:${String(mins).padStart(2, '0')}`;
}

// Format minutes as time HH:MM without sign
function formatMinutesAsTime(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

// Format cents as dollars
function formatCents(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '+';
  return `${sign}$${dollars.toFixed(0)}`;
}

// Format ISO timestamp to time
function formatTimeFromISO(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso.length > 20 ? iso.slice(11, 16) : iso;
  }
}

// Truncate long values
function truncateValue(value: string, maxLength = 20): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '...';
}

// Two-column comparison row component
function TwoColumnRow({
  label,
  icon,
  oldValue,
  newValue,
  isChanged,
  changeDirection,
}: {
  label: string;
  icon: React.ReactNode;
  oldValue: string;
  newValue: string;
  isChanged: boolean;
  changeDirection?: 'up' | 'down';
}) {
  return (
    <View className="flex-row border-b border-slate-700/30 last:border-b-0">
      {/* Old Value Column */}
      <View className={cn(
        'flex-1 px-3 py-2 border-r border-slate-700/30',
        isChanged && 'bg-red-500/5'
      )}>
        <View className="flex-row items-center mb-1">
          {icon}
          <Text className="text-slate-500 text-[10px] ml-1 uppercase">{label}</Text>
        </View>
        <Text className={cn(
          'text-sm font-mono',
          isChanged ? 'text-red-400 line-through' : 'text-slate-400'
        )}>
          {oldValue}
        </Text>
      </View>

      {/* New Value Column */}
      <View className={cn(
        'flex-1 px-3 py-2',
        isChanged && 'bg-green-500/5'
      )}>
        <View className="flex-row items-center mb-1">
          {icon}
          <Text className="text-slate-500 text-[10px] ml-1 uppercase">{label}</Text>
        </View>
        <View className="flex-row items-center">
          <Text className={cn(
            'text-sm font-mono',
            isChanged ? 'text-green-400 font-semibold' : 'text-slate-400'
          )}>
            {newValue}
          </Text>
          {changeDirection === 'up' && (
            <ArrowUp size={12} color="#22c55e" style={{ marginLeft: 4 }} />
          )}
          {changeDirection === 'down' && (
            <ArrowDown size={12} color="#ef4444" style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>
    </View>
  );
}

// Get icon and color for change type
function getChangeStyle(changeType: string, severity: string) {
  const styles: Record<string, { icon: typeof Plus; color: string; bgColor: string }> = {
    TRIP_ADDED: { icon: Plus, color: '#22c55e', bgColor: 'bg-green-500/20' },
    TRIP_REMOVED: { icon: Minus, color: '#ef4444', bgColor: 'bg-red-500/20' },
    TRIP_MODIFIED: { icon: RefreshCw, color: '#f59e0b', bgColor: 'bg-amber-500/20' },
    LEG_ADDED: { icon: Plus, color: '#22c55e', bgColor: 'bg-green-500/20' },
    LEG_REMOVED: { icon: Minus, color: '#ef4444', bgColor: 'bg-red-500/20' },
    LEG_MODIFIED: { icon: RefreshCw, color: '#f59e0b', bgColor: 'bg-amber-500/20' },
    TIME_CHANGE: { icon: Clock, color: '#f59e0b', bgColor: 'bg-amber-500/20' },
    DH_CHANGE: { icon: Plane, color: '#8b5cf6', bgColor: 'bg-violet-500/20' },
    CREDIT_CHANGE: { icon: DollarSign, color: '#06b6d4', bgColor: 'bg-cyan-500/20' },
  };

  return styles[changeType] || { icon: AlertTriangle, color: '#64748b', bgColor: 'bg-slate-500/20' };
}

// Individual change card component with two-column compare
function ChangeCard({
  change,
  index,
  onAcknowledge,
  onLogPayEvent,
  isAcknowledging,
}: {
  change: ScheduleChange;
  index: number;
  onAcknowledge: (changeId: string) => void;
  onLogPayEvent: (change: ScheduleChange) => void;
  isAcknowledging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = getChangeStyle(change.changeType, change.severity);
  const Icon = style.icon;

  const hasPayImpact = change.severity === 'pay_impact' || Math.abs(change.creditDiffMinutes) > 0;

  // Parse old and new values for two-column comparison
  const hasDetailedComparison = change.oldValue && change.newValue;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 80).springify()}
      layout={Layout.springify()}
      className="mb-3"
    >
      <View
        className={cn(
          'rounded-2xl overflow-hidden border',
          change.acknowledged
            ? 'bg-slate-800/30 border-slate-700/30'
            : 'bg-slate-800/60 border-slate-700/50'
        )}
      >
        {/* Header */}
        <Pressable
          onPress={() => {
            console.log('[ChangesDetectedModal] Header pressed, expanding:', !expanded);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setExpanded(!expanded);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            padding: 16,
            paddingBottom: 12,
            backgroundColor: pressed ? 'rgba(51, 65, 85, 0.2)' : 'transparent',
          })}
        >
          <View className={cn('w-10 h-10 rounded-xl items-center justify-center mr-3', style.bgColor)}>
            <Icon size={20} color={style.color} />
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-sm">
              {change.suggestedEventTitle || change.changeType.replace(/_/g, ' ')}
            </Text>
            {change.tripNumber && (
              <Text className="text-slate-400 text-xs mt-0.5">
                {change.tripNumber} • {change.tripDate}
              </Text>
            )}
          </View>
          {change.acknowledged ? (
            <View className="bg-green-500/20 px-2 py-1 rounded-lg">
              <Text className="text-green-400 text-xs font-medium">Done</Text>
            </View>
          ) : (
            <ChevronDown
              size={18}
              color="#64748b"
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          )}
        </Pressable>

        {/* Two-Column Compare Section */}
        {hasDetailedComparison && expanded && (
          <View className="px-4 pb-3">
            <View className="bg-slate-900/50 rounded-xl overflow-hidden">
              {/* Column Headers */}
              <View className="flex-row border-b border-slate-700/50">
                <View className="flex-1 px-3 py-2 bg-red-500/5 border-r border-slate-700/50">
                  <Text className="text-red-400 text-xs font-semibold text-center">
                    PREVIOUS
                  </Text>
                </View>
                <View className="flex-1 px-3 py-2 bg-green-500/5">
                  <Text className="text-green-400 text-xs font-semibold text-center">
                    NEW
                  </Text>
                </View>
              </View>

              {/* Comparison Rows */}
              <TwoColumnRow
                label="Date"
                icon={<Calendar size={12} color="#64748b" />}
                oldValue={change.tripDate || '-'}
                newValue={change.tripDate || '-'}
                isChanged={false}
              />

              {change.fieldChanged === 'scheduledOut' || change.fieldChanged === 'time' ? (
                <TwoColumnRow
                  label="Start Time"
                  icon={<Clock size={12} color="#64748b" />}
                  oldValue={formatTimeFromISO(change.oldValue)}
                  newValue={formatTimeFromISO(change.newValue)}
                  isChanged
                />
              ) : null}

              {change.fieldChanged === 'scheduledIn' || change.fieldChanged === 'time' ? (
                <TwoColumnRow
                  label="End Time"
                  icon={<Clock size={12} color="#64748b" />}
                  oldValue={change.fieldChanged === 'time' ? formatTimeFromISO(change.oldValue) : '-'}
                  newValue={change.fieldChanged === 'time' ? formatTimeFromISO(change.newValue) : '-'}
                  isChanged={change.fieldChanged === 'time'}
                />
              ) : null}

              {change.fieldChanged === 'credit' || change.creditDiffMinutes !== 0 ? (
                <TwoColumnRow
                  label="Credit"
                  icon={<DollarSign size={12} color="#64748b" />}
                  oldValue={change.oldValue?.includes(':') ? change.oldValue : formatMinutesAsTime(parseInt(change.oldValue || '0'))}
                  newValue={change.newValue?.includes(':') ? change.newValue : formatMinutesAsTime(parseInt(change.newValue || '0'))}
                  isChanged
                  changeDirection={change.creditDiffMinutes > 0 ? 'up' : 'down'}
                />
              ) : null}

              {(change.fieldChanged === 'isDeadhead' || change.changeType === 'DH_CHANGE') && (
                <TwoColumnRow
                  label="Deadhead"
                  icon={<Plane size={12} color="#64748b" />}
                  oldValue={change.oldValue === 'true' ? 'Yes' : 'No'}
                  newValue={change.newValue === 'true' ? 'Yes' : 'No'}
                  isChanged
                />
              )}

              {/* Generic fallback for other field changes */}
              {change.fieldChanged && !['scheduledOut', 'scheduledIn', 'time', 'credit', 'isDeadhead'].includes(change.fieldChanged) && (
                <TwoColumnRow
                  label={change.fieldChanged.replace(/([A-Z])/g, ' $1').trim()}
                  icon={<AlertTriangle size={12} color="#64748b" />}
                  oldValue={truncateValue(change.oldValue || '-')}
                  newValue={truncateValue(change.newValue || '-')}
                  isChanged
                />
              )}
            </View>
          </View>
        )}

        {/* Simple Change Details (when not expanded or no detailed comparison) */}
        {!expanded && hasDetailedComparison && (
          <View className="px-4 pb-3">
            <View className="flex-row items-center bg-slate-900/50 rounded-xl p-3">
              <View className="flex-1">
                <Text className="text-slate-500 text-xs mb-1">Before</Text>
                <Text className="text-slate-300 text-sm font-mono">
                  {truncateValue(change.oldValue || '-')}
                </Text>
              </View>
              <ArrowRight size={16} color="#475569" className="mx-3" />
              <View className="flex-1">
                <Text className="text-slate-500 text-xs mb-1">After</Text>
                <Text className="text-slate-300 text-sm font-mono">
                  {truncateValue(change.newValue || '-')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Pay Impact */}
        {hasPayImpact && (
          <View className="px-4 pb-3">
            <View className="flex-row">
              {change.creditDiffMinutes !== 0 && (
                <View
                  className={cn(
                    'flex-row items-center px-3 py-2 rounded-lg mr-2',
                    change.creditDiffMinutes > 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                  )}
                >
                  {change.creditDiffMinutes > 0 ? (
                    <ArrowUp size={14} color="#22c55e" />
                  ) : (
                    <ArrowDown size={14} color="#ef4444" />
                  )}
                  <Text
                    className={cn(
                      'text-sm font-semibold ml-1',
                      change.creditDiffMinutes > 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {formatMinutes(change.creditDiffMinutes)} credit
                  </Text>
                </View>
              )}
              {change.estimatedPayDiffCents !== 0 && (
                <View
                  className={cn(
                    'flex-row items-center px-3 py-2 rounded-lg',
                    change.estimatedPayDiffCents > 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                  )}
                >
                  <DollarSign
                    size={14}
                    color={change.estimatedPayDiffCents > 0 ? '#22c55e' : '#ef4444'}
                  />
                  <Text
                    className={cn(
                      'text-sm font-semibold ml-0.5',
                      change.estimatedPayDiffCents > 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {formatCents(change.estimatedPayDiffCents)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Actions */}
        {!change.acknowledged && (
          <View className="flex-row border-t border-slate-700/30">
            <Pressable
              onPress={() => {
                console.log('[ChangesDetectedModal] Dismiss pressed for change:', change.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onAcknowledge(change.id);
              }}
              disabled={isAcknowledging}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 14,
                borderRightWidth: 1,
                borderRightColor: 'rgba(51, 65, 85, 0.3)',
                backgroundColor: pressed ? 'rgba(51, 65, 85, 0.3)' : 'transparent',
              })}
            >
              {isAcknowledging ? (
                <ActivityIndicator size="small" color="#64748b" />
              ) : (
                <>
                  <X size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Dismiss</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                console.log('[ChangesDetectedModal] Apply pressed for change:', change.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onAcknowledge(change.id);
              }}
              disabled={isAcknowledging}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 14,
                borderRightWidth: change.suggestedEventType ? 1 : 0,
                borderRightColor: 'rgba(51, 65, 85, 0.3)',
                backgroundColor: pressed ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
              })}
            >
              <CheckCircle2 size={16} color="#22c55e" />
              <Text className="text-green-400 text-sm font-medium ml-2">Apply</Text>
            </Pressable>
            {change.suggestedEventType && (
              <Pressable
                onPress={() => {
                  console.log('[ChangesDetectedModal] Log Event pressed for change:', change.id);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onLogPayEvent(change);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 14,
                  backgroundColor: pressed ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                })}
              >
                <FileText size={16} color="#06b6d4" />
                <Text className="text-cyan-400 text-sm font-medium ml-2">Log Event</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export function ChangesDetectedModal({
  visible,
  onClose,
  onLogPayEvent,
}: ChangesDetectedModalProps) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'all' | 'unacknowledged' | 'pay_impact'>('unacknowledged');

  const { data, isLoading, refetch } = useScheduleChanges(
    filter === 'all' ? {} : filter === 'unacknowledged' ? { acknowledged: false } : { severity: 'pay_impact' }
  );
  const acknowledgeChange = useAcknowledgeChange();

  const handleAcknowledge = useCallback(
    async (changeId: string) => {
      try {
        await acknowledgeChange.mutateAsync({ changeId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        console.error('Failed to acknowledge:', err);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [acknowledgeChange]
  );

  const handleLogPayEvent = useCallback(
    (change: ScheduleChange) => {
      onLogPayEvent?.(change);
    },
    [onLogPayEvent]
  );

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const changes = data?.changes || [];
  const summary = data?.summary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/80">
        <Animated.View entering={SlideInUp.springify().damping(20)} className="flex-1 mt-12">
          <LinearGradient
            colors={['#0c1421', '#0a1628', '#061220']}
            style={{ flex: 1, borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
          >
            {/* Header */}
            <View
              className="flex-row items-center justify-between px-5 pt-5 pb-4"
              style={{ paddingTop: insets.top > 12 ? 20 : insets.top + 8 }}
            >
              <View className="flex-row items-center flex-1">
                <View className="w-11 h-11 rounded-2xl bg-amber-500/20 items-center justify-center mr-3">
                  <AlertTriangle size={22} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-lg tracking-tight">
                    Schedule Changes
                  </Text>
                  <Text className="text-slate-500 text-xs mt-0.5">
                    {summary?.unacknowledged || 0} unreviewed • {summary?.payImpactCount || 0} affect pay
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  console.log('[ChangesDetectedModal] Close button pressed');
                  handleClose();
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: pressed ? 'rgba(51, 65, 85, 1)' : 'rgba(51, 65, 85, 0.8)',
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <X size={18} color="#64748b" />
              </Pressable>
            </View>

            {/* Summary Banner */}
            {summary && summary.totalPayImpactCents !== 0 && (
              <Animated.View entering={FadeIn.delay(100)} className="mx-5 mb-4">
                <View
                  className={cn(
                    'flex-row items-center rounded-2xl px-4 py-3 border',
                    summary.totalPayImpactCents > 0
                      ? 'bg-green-500/10 border-green-500/20'
                      : 'bg-red-500/10 border-red-500/20'
                  )}
                >
                  <DollarSign
                    size={20}
                    color={summary.totalPayImpactCents > 0 ? '#22c55e' : '#ef4444'}
                  />
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold text-base">
                      {formatCents(summary.totalPayImpactCents)} estimated impact
                    </Text>
                    <Text className="text-slate-400 text-xs mt-0.5">
                      From {summary.payImpactCount} changes affecting pay
                    </Text>
                  </View>
                </View>
              </Animated.View>
            )}

            {/* Filter Tabs */}
            <View className="flex-row mx-5 mb-4 bg-slate-800/40 rounded-xl p-1">
              {[
                { key: 'unacknowledged' as const, label: 'To Review' },
                { key: 'pay_impact' as const, label: 'Pay Impact' },
                { key: 'all' as const, label: 'All' },
              ].map((tab) => (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    console.log('[ChangesDetectedModal] Filter tab pressed:', tab.key);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setFilter(tab.key);
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: filter === tab.key
                      ? 'rgba(51, 65, 85, 1)'
                      : pressed
                        ? 'rgba(51, 65, 85, 0.5)'
                        : 'transparent',
                  })}
                >
                  <Text
                    className={cn(
                      'text-center text-sm font-medium',
                      filter === tab.key ? 'text-white' : 'text-slate-400'
                    )}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Changes List */}
            <ScrollView
              className="flex-1 px-5"
              contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
              showsVerticalScrollIndicator={false}
            >
              {isLoading ? (
                <View className="items-center justify-center py-20">
                  <ActivityIndicator size="large" color="#06b6d4" />
                  <Text className="text-slate-400 mt-4">Loading changes...</Text>
                </View>
              ) : changes.length === 0 ? (
                <Animated.View entering={FadeIn} className="items-center justify-center py-20">
                  <View className="w-16 h-16 rounded-2xl bg-green-500/10 items-center justify-center mb-4">
                    <CheckCircle2 size={32} color="#22c55e" />
                  </View>
                  <Text className="text-white font-semibold text-base">All caught up!</Text>
                  <Text className="text-slate-400 text-sm mt-2 text-center px-8">
                    {filter === 'unacknowledged'
                      ? 'No changes waiting for review'
                      : filter === 'pay_impact'
                        ? 'No changes affecting pay'
                        : 'No schedule changes detected'}
                  </Text>
                </Animated.View>
              ) : (
                changes.map((change, index) => (
                  <ChangeCard
                    key={change.id}
                    change={change}
                    index={index}
                    onAcknowledge={handleAcknowledge}
                    onLogPayEvent={handleLogPayEvent}
                    isAcknowledging={acknowledgeChange.isPending}
                  />
                ))
              )}
            </ScrollView>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}
