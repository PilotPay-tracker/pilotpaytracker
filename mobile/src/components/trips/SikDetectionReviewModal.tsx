/**
 * SIK Detection Review Modal
 * Phase 1: Shows when SIK is detected in uploaded schedule
 * User must review and confirm before SIK is applied
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import {
  X,
  Heart,
  Calendar,
  Clock,
  Check,
  AlertTriangle,
  Info,
  Upload,
  FileCheck,
  Wallet,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';

// ============================================
// Types
// ============================================

export interface SikDetectedData {
  detected: boolean;
  dateRange?: { startDate: string; endDate: string } | null;
  station?: string | null;
  // NOTE: tafbHours is TAFB (Time Away From Base), NOT sick hours to deduct!
  // Actual sick credit comes from the trip's leg credit hours.
  tafbHours?: number | null;
  rawText?: string | null;
}

interface SikDetectionReviewModalProps {
  visible: boolean;
  onClose: () => void;
  sikDetected: SikDetectedData;
  tripId?: string;
  scheduleEvidenceId?: string;
  imageUrls?: string[];
  onSuccess?: () => void;
}

interface PreviewData {
  preview: {
    dateRange: { startDate: string; endDate: string };
    station: string | null;
    tafbHoursFromUpload: number | null; // TAFB reference only, not for deduction
    matchingTrips: Array<{
      id: string;
      tripNumber: string | null;
      startDate: string;
      endDate: string;
    }>;
    legsToMark: number;
    legsAlreadyMarked: number;
    targetLegs: Array<{
      legId: string;
      tripId: string;
      tripNumber: string | null;
      dutyDate: string;
      flightNumber: string | null;
      origin: string | null;
      destination: string | null;
      creditMinutes: number;
      alreadyMarkedSik: boolean;
    }>;
  };
  deductionPreview: {
    hoursToDeduct: number;
    bankBalanceBefore: number;
    bankBalanceAfter: number;
    coveredHours: number;
    unpaidHours: number;
    coverageOutcome: 'PAID' | 'PARTIAL' | 'UNPAID';
  };
  canApply: boolean;
  alreadyMarkedMessage: string | null;
}

// ============================================
// Helper Functions
// ============================================

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

// ============================================
// Main Component
// ============================================

export function SikDetectionReviewModal({
  visible,
  onClose,
  sikDetected,
  tripId,
  scheduleEvidenceId,
  imageUrls,
  onSuccess,
}: SikDetectionReviewModalProps) {
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load preview data when modal opens
  useEffect(() => {
    if (!visible || !sikDetected?.detected) return;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await api.post<PreviewData>('/api/sick/preview-detected', {
          sikDetected,
          tripId,
          scheduleEvidenceId,
          imageUrls,
        });
        setPreviewData(response);
      } catch (err) {
        console.error('[SikDetectionReview] Error loading preview:', err);
        setError('Failed to load SIK preview');
      } finally {
        setIsLoading(false);
      }
    };

    loadPreview();
  }, [visible, sikDetected, tripId, scheduleEvidenceId, imageUrls]);

  const handleApply = useCallback(async () => {
    if (!previewData?.canApply) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsApplying(true);

    try {
      const legIds = previewData.preview.targetLegs
        .filter(l => !l.alreadyMarkedSik)
        .map(l => l.legId);

      await api.post('/api/sick/apply-detected', {
        sikDetected,
        legIds,
        scheduleEvidenceId,
        imageUrls,
        userNotes: `Applied from uploaded schedule: ${sikDetected.rawText || 'SIK detected'}`,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('[SikDetectionReview] Error applying SIK:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Failed to apply SIK');
    } finally {
      setIsApplying(false);
    }
  }, [previewData, sikDetected, scheduleEvidenceId, imageUrls, onSuccess, onClose]);

  const handleIgnore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const coverageColor = previewData?.deductionPreview.coverageOutcome === 'PAID'
    ? 'text-emerald-400'
    : previewData?.deductionPreview.coverageOutcome === 'PARTIAL'
      ? 'text-amber-400'
      : 'text-red-400';

  const coverageBgColor = previewData?.deductionPreview.coverageOutcome === 'PAID'
    ? 'bg-emerald-500/20'
    : previewData?.deductionPreview.coverageOutcome === 'PARTIAL'
      ? 'bg-amber-500/20'
      : 'bg-red-500/20';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleIgnore}>
      <View className="flex-1 bg-black/70">
        <Animated.View
          entering={SlideInDown.duration(300)}
          className="flex-1 bg-slate-950 mt-16 rounded-t-3xl overflow-hidden"
          style={{ paddingBottom: insets.bottom }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className="w-12 h-12 rounded-xl bg-red-500/20 items-center justify-center">
                <Heart size={24} color="#ef4444" fill="#ef4444" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-white font-bold text-xl">SIK Detected</Text>
                <View className="flex-row items-center mt-0.5">
                  <Upload size={12} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-1">From uploaded schedule</Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={handleIgnore}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
            >
              <X size={20} color="#64748b" />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View className="items-center justify-center py-20">
                <ActivityIndicator size="large" color="#ef4444" />
                <Text className="text-slate-400 mt-4">Loading SIK preview...</Text>
              </View>
            ) : error ? (
              <View className="items-center justify-center py-20">
                <AlertTriangle size={48} color="#ef4444" />
                <Text className="text-red-400 mt-4 text-center">{error}</Text>
                <Pressable
                  onPress={handleIgnore}
                  className="mt-4 px-6 py-2 bg-slate-800 rounded-lg"
                >
                  <Text className="text-slate-300">Close</Text>
                </Pressable>
              </View>
            ) : previewData ? (
              <>
                {/* Banner */}
                <View className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
                  <View className="flex-row items-center mb-2">
                    <FileCheck size={20} color="#ef4444" />
                    <Text className="text-red-400 font-semibold ml-2">
                      Sick Time Detected on Schedule
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-sm">
                    Your uploaded schedule shows SIK (sick time). Review the details below and
                    confirm to apply this to your records.
                  </Text>
                </View>

                {/* Date Range */}
                <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                  <View className="flex-row items-center mb-3">
                    <Calendar size={18} color="#64748b" />
                    <Text className="text-slate-400 font-medium ml-2">Date Range</Text>
                  </View>
                  <Text className="text-white text-lg font-semibold">
                    {previewData.preview.dateRange?.startDate && (
                      <>
                        {formatDate(previewData.preview.dateRange.startDate)}
                        {previewData.preview.dateRange.endDate !== previewData.preview.dateRange.startDate && (
                          <Text className="text-slate-400"> — {formatDate(previewData.preview.dateRange.endDate)}</Text>
                        )}
                      </>
                    )}
                  </Text>
                  {previewData.preview.station && (
                    <Text className="text-slate-500 text-sm mt-1">Station: {previewData.preview.station}</Text>
                  )}
                  {sikDetected.rawText && (
                    <Text className="text-slate-500 text-xs mt-2 italic">"{sikDetected.rawText}"</Text>
                  )}
                </View>

                {/* Legs to Mark */}
                {previewData.preview.legsToMark > 0 && (
                  <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                    <View className="flex-row items-center mb-3">
                      <Clock size={18} color="#64748b" />
                      <Text className="text-slate-400 font-medium ml-2">
                        Legs to Mark ({previewData.preview.legsToMark})
                      </Text>
                    </View>
                    {previewData.preview.targetLegs
                      .filter(l => !l.alreadyMarkedSik)
                      .map((leg, idx) => (
                        <View
                          key={leg.legId}
                          className={cn(
                            'flex-row items-center py-2',
                            idx > 0 && 'border-t border-slate-700'
                          )}
                        >
                          <View className="w-5 h-5 rounded bg-red-500/20 items-center justify-center mr-3">
                            <Heart size={12} color="#ef4444" fill="#ef4444" />
                          </View>
                          <View className="flex-1">
                            <Text className="text-white">
                              {leg.origin || '?'} → {leg.destination || '?'}
                              {leg.flightNumber && (
                                <Text className="text-slate-400"> • FLT {leg.flightNumber}</Text>
                              )}
                            </Text>
                            <Text className="text-slate-500 text-xs">
                              {formatDate(leg.dutyDate)} • {formatHours(leg.creditMinutes / 60)} credit
                            </Text>
                          </View>
                        </View>
                      ))}
                  </View>
                )}

                {/* Already Marked Notice */}
                {previewData.alreadyMarkedMessage && (
                  <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
                    <View className="flex-row items-center">
                      <Info size={16} color="#f59e0b" />
                      <Text className="text-amber-400 text-sm ml-2">
                        {previewData.alreadyMarkedMessage}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Deduction Preview */}
                {previewData.deductionPreview.hoursToDeduct > 0 && (
                  <View className="bg-slate-800/60 rounded-xl p-4 mb-4">
                    <View className="flex-row items-center mb-3">
                      <Wallet size={18} color="#64748b" />
                      <Text className="text-slate-400 font-medium ml-2">Sick Bank Impact</Text>
                    </View>

                    <View className="flex-row justify-between mb-2">
                      <Text className="text-slate-400">Hours to Deduct:</Text>
                      <Text className="text-white font-semibold">
                        {formatHours(previewData.deductionPreview.hoursToDeduct)}
                      </Text>
                    </View>

                    <View className="flex-row justify-between mb-2">
                      <Text className="text-slate-400">Current Balance:</Text>
                      <Text className="text-white">
                        {formatHours(previewData.deductionPreview.bankBalanceBefore)}
                      </Text>
                    </View>

                    <View className="flex-row justify-between mb-3">
                      <Text className="text-slate-400">Balance After:</Text>
                      <Text className="text-white font-semibold">
                        {formatHours(previewData.deductionPreview.bankBalanceAfter)}
                      </Text>
                    </View>

                    {/* Coverage Status */}
                    <View className={cn('rounded-lg p-3 mt-2', coverageBgColor)}>
                      <View className="flex-row items-center justify-between">
                        <Text className={cn('font-semibold', coverageColor)}>
                          {previewData.deductionPreview.coverageOutcome === 'PAID'
                            ? 'Fully Covered'
                            : previewData.deductionPreview.coverageOutcome === 'PARTIAL'
                              ? 'Partially Covered'
                              : 'Not Covered'}
                        </Text>
                        {previewData.deductionPreview.coverageOutcome === 'PAID' && (
                          <Check size={18} color="#34d399" />
                        )}
                        {previewData.deductionPreview.coverageOutcome !== 'PAID' && (
                          <AlertTriangle size={18} color={previewData.deductionPreview.coverageOutcome === 'PARTIAL' ? '#f59e0b' : '#ef4444'} />
                        )}
                      </View>
                      {previewData.deductionPreview.unpaidHours > 0 && (
                        <Text className="text-slate-400 text-sm mt-1">
                          {formatHours(previewData.deductionPreview.unpaidHours)} hours unpaid
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Proof Attachment Note */}
                {imageUrls && imageUrls.length > 0 && (
                  <View className="flex-row items-start bg-slate-800/40 rounded-xl p-3 mb-4">
                    <FileCheck size={16} color="#64748b" style={{ marginTop: 2 }} />
                    <Text className="text-slate-500 text-xs flex-1 ml-2">
                      Your uploaded schedule will be automatically attached as proof for this sick record.
                    </Text>
                  </View>
                )}

                {/* Disclaimer */}
                <View className="flex-row items-start bg-slate-800/40 rounded-xl p-3">
                  <Info size={16} color="#64748b" style={{ marginTop: 2 }} />
                  <Text className="text-slate-500 text-xs flex-1 ml-2">
                    This is a personal historical record based on logged events. It does not
                    represent an official sick bank, balance, or employer record.
                  </Text>
                </View>
              </>
            ) : null}
          </ScrollView>

          {/* Bottom Action Bar */}
          <View
            className="absolute bottom-0 left-0 right-0 bg-slate-950 border-t border-slate-800 p-4"
            style={{ paddingBottom: Math.max(insets.bottom, 16) }}
          >
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleIgnore}
                className="flex-1 py-3.5 rounded-xl bg-slate-800 items-center active:opacity-70"
              >
                <Text className="text-slate-300 font-semibold">Ignore</Text>
              </Pressable>
              <Pressable
                onPress={handleApply}
                disabled={!previewData?.canApply || isApplying}
                className={cn(
                  'flex-1 py-3.5 rounded-xl items-center flex-row justify-center',
                  previewData?.canApply && !isApplying
                    ? 'bg-red-500 active:bg-red-600'
                    : 'bg-slate-700'
                )}
              >
                {isApplying ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Heart size={18} color="white" fill="white" style={{ marginRight: 8 }} />
                    <Text className="text-white font-semibold">Apply SIK</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
