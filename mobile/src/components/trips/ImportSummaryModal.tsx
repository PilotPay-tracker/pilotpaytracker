/**
 * ImportSummaryModal - Import Results Display
 *
 * Shows comprehensive summary after schedule import:
 * - Trips created/updated/skipped
 * - Conflicts needing review
 * - Warnings
 * - Errors (if any)
 *
 * User-friendly UX that builds trust and confidence.
 */

import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Plane,
  Calendar,
  Clock,
  AlertCircle,
  FileText,
  ChevronRight,
} from 'lucide-react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { cn } from '@/lib/cn';
import type { ImportSummary as ImportSummaryType } from '@/lib/contracts';

interface ImportSummaryModalProps {
  visible: boolean;
  onClose: () => void;
  onViewTrip?: (tripId: string) => void;
  summary: ImportSummaryType | null;
}

// Format credit minutes to HH:MM
function formatCredit(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

// Format date for display
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Get status icon and color
function getStatusStyle(status: string) {
  switch (status) {
    case 'completed':
      return {
        icon: CheckCircle2,
        color: '#10b981',
        bgColor: 'bg-emerald-500/20',
        label: 'Import Successful',
      };
    case 'failed':
      return {
        icon: AlertCircle,
        color: '#ef4444',
        bgColor: 'bg-red-500/20',
        label: 'Import Failed',
      };
    case 'skipped':
      return {
        icon: RefreshCw,
        color: '#f59e0b',
        bgColor: 'bg-amber-500/20',
        label: 'Already Imported',
      };
    default:
      return {
        icon: FileText,
        color: '#6b7280',
        bgColor: 'bg-gray-500/20',
        label: 'Unknown Status',
      };
  }
}

// Get action badge style
function getActionStyle(action: string) {
  switch (action) {
    case 'created':
      return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Created' };
    case 'updated':
      return { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Updated' };
    case 'skipped':
      return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Skipped' };
    case 'conflict':
      return { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Conflict' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-400', label: action };
  }
}

export function ImportSummaryModal({
  visible,
  onClose,
  onViewTrip,
  summary,
}: ImportSummaryModalProps) {
  const insets = useSafeAreaInsets();

  if (!summary) return null;

  const statusStyle = getStatusStyle(summary.status);
  const StatusIcon = statusStyle.icon;

  const totalTrips = summary.tripsCreated + summary.tripsUpdated + summary.tripsSkipped;
  const hasWarnings = summary.warnings.length > 0;
  const hasErrors = !!summary.errorMessage;
  const hasConflicts = summary.conflictsNeedingReview > 0;

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const handleViewTrip = (tripId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onViewTrip?.(tripId);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-black/70 justify-end">
        <Animated.View
          entering={SlideInUp.springify().damping(20)}
          className="bg-zinc-900 rounded-t-3xl overflow-hidden"
          style={{ maxHeight: '85%' }}
        >
          {/* Header with gradient */}
          <LinearGradient
            colors={['#18181b', '#27272a']}
            style={{ paddingTop: insets.top > 0 ? 16 : 24 }}
          >
            <View className="px-6 pb-6">
              {/* Close button */}
              <View className="flex-row justify-end mb-4">
                <Pressable
                  onPress={handleClose}
                  className="w-8 h-8 rounded-full bg-zinc-800 items-center justify-center"
                >
                  <X size={18} color="#a1a1aa" />
                </Pressable>
              </View>

              {/* Status indicator */}
              <View className="items-center">
                <View className={cn('w-16 h-16 rounded-full items-center justify-center mb-4', statusStyle.bgColor)}>
                  <StatusIcon size={32} color={statusStyle.color} />
                </View>
                <Text className="text-white text-xl font-semibold mb-1">
                  {statusStyle.label}
                </Text>
                {summary.status === 'completed' && totalTrips > 0 && (
                  <Text className="text-zinc-400 text-sm">
                    {totalTrips} {totalTrips === 1 ? 'trip' : 'trips'} processed
                  </Text>
                )}
              </View>
            </View>
          </LinearGradient>

          <ScrollView className="flex-1 px-6 py-4">
            {/* Stats Grid */}
            {summary.status === 'completed' && (
              <Animated.View
                entering={FadeIn.delay(100)}
                className="flex-row flex-wrap mb-6"
              >
                {/* Created */}
                {summary.tripsCreated > 0 && (
                  <View className="w-1/2 p-2">
                    <View className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
                      <Text className="text-emerald-400 text-2xl font-bold">
                        {summary.tripsCreated}
                      </Text>
                      <Text className="text-zinc-400 text-sm mt-1">
                        {summary.tripsCreated === 1 ? 'Trip Created' : 'Trips Created'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Updated */}
                {summary.tripsUpdated > 0 && (
                  <View className="w-1/2 p-2">
                    <View className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-4">
                      <Text className="text-blue-400 text-2xl font-bold">
                        {summary.tripsUpdated}
                      </Text>
                      <Text className="text-zinc-400 text-sm mt-1">
                        {summary.tripsUpdated === 1 ? 'Trip Updated' : 'Trips Updated'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Skipped */}
                {summary.tripsSkipped > 0 && (
                  <View className="w-1/2 p-2">
                    <View className="bg-zinc-500/10 border border-zinc-500/30 rounded-2xl p-4">
                      <Text className="text-zinc-400 text-2xl font-bold">
                        {summary.tripsSkipped}
                      </Text>
                      <Text className="text-zinc-400 text-sm mt-1">
                        {summary.tripsSkipped === 1 ? 'Trip Skipped' : 'Trips Skipped'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Conflicts */}
                {hasConflicts && (
                  <View className="w-1/2 p-2">
                    <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                      <Text className="text-amber-400 text-2xl font-bold">
                        {summary.conflictsNeedingReview}
                      </Text>
                      <Text className="text-zinc-400 text-sm mt-1">
                        Needs Review
                      </Text>
                    </View>
                  </View>
                )}
              </Animated.View>
            )}

            {/* Error Message */}
            {hasErrors && (
              <Animated.View
                entering={FadeIn.delay(150)}
                className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 mb-4"
              >
                <View className="flex-row items-center mb-2">
                  <AlertCircle size={18} color="#ef4444" />
                  <Text className="text-red-400 font-medium ml-2">Error</Text>
                </View>
                <Text className="text-red-300 text-sm">{summary.errorMessage}</Text>
              </Animated.View>
            )}

            {/* Warnings */}
            {hasWarnings && (
              <Animated.View
                entering={FadeIn.delay(200)}
                className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-4"
              >
                <View className="flex-row items-center mb-2">
                  <AlertTriangle size={18} color="#f59e0b" />
                  <Text className="text-amber-400 font-medium ml-2">
                    {summary.warnings.length} {summary.warnings.length === 1 ? 'Warning' : 'Warnings'}
                  </Text>
                </View>
                {summary.warnings.map((warning, index) => (
                  <Text key={index} className="text-amber-300/80 text-sm mb-1">
                    • {warning}
                  </Text>
                ))}
              </Animated.View>
            )}

            {/* Trip Results */}
            {summary.tripResults.length > 0 && (
              <Animated.View entering={FadeIn.delay(250)}>
                <Text className="text-zinc-400 text-sm font-medium mb-3">
                  Trip Details
                </Text>
                {summary.tripResults.map((trip, index) => {
                  const actionStyle = getActionStyle(trip.action);
                  return (
                    <Pressable
                      key={`${trip.tripId ?? 'trip'}-${index}`}
                      onPress={() => trip.tripId && handleViewTrip(trip.tripId)}
                      className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 mb-2 active:opacity-70"
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1">
                          <View className="flex-row items-center mb-1">
                            <Plane size={14} color="#a1a1aa" />
                            <Text className="text-white font-medium ml-2">
                              {trip.pairingId || trip.tripNumber || 'Trip'}
                            </Text>
                            <View className={cn('px-2 py-0.5 rounded-full ml-2', actionStyle.bg)}>
                              <Text className={cn('text-xs font-medium', actionStyle.text)}>
                                {actionStyle.label}
                              </Text>
                            </View>
                          </View>
                          <View className="flex-row items-center">
                            <Calendar size={12} color="#71717a" />
                            <Text className="text-zinc-500 text-xs ml-1">
                              {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                            </Text>
                            {trip.creditMinutes > 0 && (
                              <>
                                <View className="w-1 h-1 rounded-full bg-zinc-600 mx-2" />
                                <Clock size={12} color="#71717a" />
                                <Text className="text-zinc-500 text-xs ml-1">
                                  {formatCredit(trip.creditMinutes)}
                                </Text>
                              </>
                            )}
                          </View>
                          {trip.message && (
                            <Text className="text-zinc-400 text-xs mt-1">
                              {trip.message}
                            </Text>
                          )}
                        </View>
                        {trip.tripId && (
                          <ChevronRight size={18} color="#71717a" />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </Animated.View>
            )}

            {/* No trips message */}
            {summary.status === 'completed' && totalTrips === 0 && !hasErrors && (
              <Animated.View
                entering={FadeIn.delay(150)}
                className="items-center py-8"
              >
                <FileText size={48} color="#52525b" />
                <Text className="text-zinc-500 text-center mt-4">
                  No trips were found in this schedule.
                </Text>
              </Animated.View>
            )}

            {/* Duplicate file message */}
            {summary.status === 'skipped' && (
              <Animated.View
                entering={FadeIn.delay(150)}
                className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4"
              >
                <View className="flex-row items-center mb-2">
                  <RefreshCw size={18} color="#f59e0b" />
                  <Text className="text-amber-400 font-medium ml-2">Already Imported</Text>
                </View>
                <Text className="text-zinc-300 text-sm">
                  This file has already been imported. No changes were made to your trips.
                </Text>
              </Animated.View>
            )}
          </ScrollView>

          {/* Footer */}
          <View
            className="px-6 py-4 border-t border-zinc-800"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <Pressable
              onPress={handleClose}
              className="rounded-2xl py-4 items-center active:opacity-90"
              style={{
                backgroundColor: '#10b981',
                shadowColor: '#10b981',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <Text className="text-white font-bold text-base tracking-wide">
                Done
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default ImportSummaryModal;
