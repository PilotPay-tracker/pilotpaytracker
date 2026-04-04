/**
 * Trips Screen - Redesigned
 * The holy grail of pilot schedule management
 * Cockpit Glass aesthetic with premium interactions
 */

import { View, Text, ScrollView, RefreshControl, Alert, Pressable, InteractionManager, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, useMemo, useEffect } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
// Icons removed - not currently used
import {
  useFonts,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';

import { api, uploadImageBase64, parseScheduleSync, getPendingReviews, parseScheduleWithPolling, BACKEND_URL } from '@/lib/api';
import { getAuthCookieHeader } from '@/lib/authClient';
import {
  useTrips,
  useTrip,
  useCreateTrip,
  useDeleteTrip,
  useDropTrip,
  useCompanyRemoveTrip,
  formatCentsToCurrency,
  useFixLegCreditMinutes,
  type BackendTrip,
  type BackendLeg,
} from '@/lib/useTripsData';
import { useHourlyRateCents } from '@/lib/state/profile-store';

// Import new components
import { TripBreakdownCard } from '@/components/trips/TripBreakdownCard';
import { MonthPaySummaryCard, calcTripPay, type TripTotals, type TripPayInfo } from '@/components/trips/EstTripPayCard';
import {
  TripsScreenHeader,
  type ViewMode,
  type TripFilter,
} from '@/components/trips/TripsScreenHeader';
import { SmartImportModal, type SelectedImage, type ScheduleSourceType } from '@/components/trips/SmartImportModal';
import { ImportSummaryModal } from '@/components/trips/ImportSummaryModal';
import { ImportProgressOverlay } from '@/components/trips/ImportProgressOverlay';
import { useImportQueue } from '@/lib/useImportQueue';
import { EmptyTripsState } from '@/components/trips/EmptyTripsState';
import type { ImportSummary } from '@/lib/contracts';

// Import existing components we still need
import { TripDetailDrawer } from '@/components/trips/TripDetailDrawer';
import { type LegOOOIContext } from '@/components/trips/CanonicalTripBreakdown';
import { CalendarView } from '@/components/trips/CalendarView';
import { OOOIEditor } from '@/components/trips/OOOIEditor';
import { OOOICapture } from '@/components/trips/OOOICapture';
import { AddLegModal } from '@/components/trips/AddLegModal';
import { CreateTripModal } from '@/components/trips/CreateTripModal';
import { PayProtectionConflictModal } from '@/components/trips/PayProtectionConflictModal';
import { SickMarkingModal } from '@/components/trips/SickMarkingModal';
import { SikDetectionReviewModal, type SikDetectedData } from '@/components/trips/SikDetectionReviewModal';
import { RemoveTripModal } from '@/components/trips/RemoveTripModal';
import { useUpdateLeg, useAddDutyDay, useAddLeg, useUpdateTripDutyLeg } from '@/lib/useTripsData';
import type { TripConflict, ConflictTripSummary, ConflictDecision, CheckConflictsResponse } from '@/lib/contracts';
import { HelpButton, useAutoTutorial, TutorialModal } from '@/components/TutorialModal';
import { useTripNotificationScheduler } from '@/lib/useNotifications';
import { ReserveScheduleCard } from '@/components/trips/ReserveScheduleCard';
import {
  useReserveSchedule,
  useDeleteReserveSchedule,
  type ReserveScheduleEvent,
} from '@/lib/useReserveSchedule';
import { useResponsive } from "@/lib/responsive";

// Utility functions
function getMonthDateRange(date: Date): { startDate: string; endDate: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  return {
    startDate: firstDay.toISOString().split('T')[0],
    endDate: lastDay.toISOString().split('T')[0],
  };
}

function filterTrips(trips: BackendTrip[], filter: TripFilter): BackendTrip[] {
  if (filter === 'all') return trips;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0] ?? '';

  return trips.filter(trip => {
    // A trip is completed if its end date is today or in the past
    const tripEndDate = trip.endDate?.split('T')[0] ?? '';
    const endDatePastOrToday = tripEndDate <= todayStr;

    // Also check hasAllActuals flag and status
    const hasAllActuals = trip.dutyDays?.every(dd => dd.hasAllActuals) ?? false;
    const isCompleted = endDatePastOrToday || hasAllActuals || trip.status === 'completed';

    switch (filter) {
      case 'scheduled':
        // Scheduled = trip end date is in the future (after today)
        return !isCompleted;
      case 'completed':
        // Completed = trip end date is today or past OR has all actuals OR status is completed
        return isCompleted;
      case 'needs_review':
        return trip.needsReview;
      default:
        return true;
    }
  });
}

function searchTrips(trips: BackendTrip[], query: string): BackendTrip[] {
  if (!query.trim()) return trips;

  const lowerQuery = query.toLowerCase();
  return trips.filter(trip => {
    // Search in trip number
    if (trip.tripNumber?.toLowerCase().includes(lowerQuery)) return true;

    // Search in routes
    const routes =
      trip.dutyDays?.flatMap(dd =>
        dd.legs.map(leg => `${leg.origin || ''} ${leg.destination || ''}`.toLowerCase())
      ) || [];
    if (routes.some(r => r.includes(lowerQuery))) return true;

    // Search in flight numbers
    const flightNumbers =
      trip.dutyDays?.flatMap(dd => dd.legs.map(leg => leg.flightNumber?.toLowerCase() || '')) || [];
    if (flightNumbers.some(fn => fn.includes(lowerQuery))) return true;

    return false;
  });
}

export default function TripsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId: deepLinkTripId } = useLocalSearchParams<{ tripId?: string }>();
  const { contentMaxWidth } = useResponsive();

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("trips");

  // Load fonts
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  // Core state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filter, setFilter] = useState<TripFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTripDetail, setShowTripDetail] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<BackendTrip | null>(null);
  const [selectedDutyDayIndex, setSelectedDutyDayIndex] = useState<number | undefined>(undefined);
  const [selectedLeg, setSelectedLeg] = useState<BackendLeg | null>(null);
  const [selectedLegOOOIContext, setSelectedLegOOOIContext] = useState<LegOOOIContext | null>(null);
  const [isCanonicalLeg, setIsCanonicalLeg] = useState(false);
  const [showOOOIEditor, setShowOOOIEditor] = useState(false);
  const [showOOOICapture, setShowOOOICapture] = useState(false);
  const [showAddLegModal, setShowAddLegModal] = useState(false);
  const [selectedDutyDayId, setSelectedDutyDayId] = useState<string | null>(null);
  // Remove Trip modal state
  const [removeTripModalVisible, setRemoveTripModalVisible] = useState(false);
  const [removeTripTarget, setRemoveTripTarget] = useState<BackendTrip | null>(null);

  // Conflict detection state
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictData, setConflictData] = useState<{
    conflicts: TripConflict[];
    newTripSummary: ConflictTripSummary;
    parsedData: any;
  } | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  // Import summary modal state
  const [showImportSummary, setShowImportSummary] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // Sick marking modal state
  const [showSickModal, setShowSickModal] = useState(false);
  const [sickModalTrip, setSickModalTrip] = useState<BackendTrip | null>(null);

  // SIK detection from upload state (Phase 1)
  const [showSikDetectionModal, setShowSikDetectionModal] = useState(false);
  const [sikDetectionData, setSikDetectionData] = useState<{
    sikDetected: SikDetectedData;
    tripId?: string;
    imageUrls?: string[];
  } | null>(null);

  // Import queue for multi-file progress tracking
  const importQueue = useImportQueue();

  // Get date range for current month
  const { startDate, endDate } = useMemo(() => getMonthDateRange(currentMonth), [currentMonth]);

  // Data hooks
  const { data: tripsData, isLoading, isRefetching, refetch } = useTrips({ startDate, endDate });
  const { data: tripDetailData, refetch: refetchTripDetail } = useTrip(selectedTrip?.id ?? null);

  // Reserve Schedule data
  const {
    data: reserveData,
    isLoading: isLoadingReserve,
    refetch: refetchReserve,
  } = useReserveSchedule({ startDate, endDate, includeLegs: true });
  const deleteReserveScheduleMutation = useDeleteReserveSchedule();

  // Fetch pending reviews for the validation gate badge
  const [pendingReviewsCount, setPendingReviewsCount] = useState(0);
  useEffect(() => {
    const fetchPendingReviews = async () => {
      try {
        const result = await getPendingReviews();
        setPendingReviewsCount(result.count ?? 0);
      } catch (error) {
        // Silently fail - don't block the UI
        console.log('[Trips] Could not fetch pending reviews:', error);
      }
    };
    fetchPendingReviews();
  }, []);

  const createTripMutation = useCreateTrip();
  const deleteTripMutation = useDeleteTrip();
  const dropTripMutation = useDropTrip();
  const companyRemoveTripMutation = useCompanyRemoveTrip();
  const updateLegMutation = useUpdateLeg();
  const updateTripDutyLegMutation = useUpdateTripDutyLeg();
  const addDutyDayMutation = useAddDutyDay();
  const addLegMutation = useAddLeg();
  const fixLegCreditMutation = useFixLegCreditMinutes();

  // Auto-fix leg credit minutes on mount (runs once)
  useEffect(() => {
    // Only run if we have trips data and haven't already fixed
    if (tripsData?.trips && tripsData.trips.length > 0) {
      fixLegCreditMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripsData?.trips?.length]);

  // Process trips
  const allTrips = tripsData?.trips ?? [];
  const processedTrips = useMemo(() => {
    let trips = filterTrips(allTrips, filter);
    trips = searchTrips(trips, searchQuery);
    // Sort chronologically (oldest to newest), then by time for same-day trips
    return trips.sort((a, b) => {
      // First, compare by start date
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;

      // Same date - compare by first leg departure time
      const aFirstLeg = a.dutyDays?.[0]?.legs?.[0];
      const bFirstLeg = b.dutyDays?.[0]?.legs?.[0];

      const aTime = aFirstLeg?.scheduledOutISO || aFirstLeg?.actualOutISO || '';
      const bTime = bFirstLeg?.scheduledOutISO || bFirstLeg?.actualOutISO || '';

      return aTime.localeCompare(bTime);
    });
  }, [allTrips, filter, searchQuery]);

  // Get hourly rate from profile
  const hourlyRateCents = useHourlyRateCents();

  // Helper to calculate effective credit for a trip
  // Uses trip-level if > 0, otherwise sums from duty days/legs
  const getEffectiveTripCredit = (trip: BackendTrip): number => {
    if (trip.totalCreditMinutes && trip.totalCreditMinutes > 0) {
      return trip.totalCreditMinutes;
    }
    // Fallback: sum from duty days
    const dutyDays = trip.dutyDays ?? trip.tripDutyDays ?? [];
    return dutyDays.reduce((sum, dd: any) => {
      const dayCredit = dd.finalCreditMinutes || dd.actualCreditMinutes || dd.plannedCreditMinutes || dd.creditMinutes || 0;
      if (dayCredit > 0) {
        return sum + dayCredit;
      }
      // Sum from legs if day-level credit is 0
      // Fix: check if creditMinutes > 0 before using, otherwise use plannedCreditMinutes
      const legsCredit = (dd.legs ?? []).reduce((legSum: number, leg: any) => {
        const legCredit = (leg.creditMinutes ?? 0) > 0 ? leg.creditMinutes : (leg.plannedCreditMinutes ?? 0);
        return legSum + legCredit;
      }, 0);
      return sum + legsCredit;
    }, 0);
  };

  // Helper to calculate effective block for a trip
  const getEffectiveTripBlock = (trip: BackendTrip): number => {
    if (trip.totalBlockMinutes && trip.totalBlockMinutes > 0) {
      return trip.totalBlockMinutes;
    }
    // Fallback: sum from duty days
    const dutyDays = trip.dutyDays ?? trip.tripDutyDays ?? [];
    return dutyDays.reduce((sum, dd: any) => {
      const dayBlock = dd.actualBlockMinutes || dd.blockMinutes || 0;
      if (dayBlock > 0) {
        return sum + dayBlock;
      }
      // Sum from legs if day-level block is 0
      // Fix: check if actualBlockMinutes > 0 before using, otherwise use plannedBlockMinutes
      const legsBlock = (dd.legs ?? []).reduce((legSum: number, leg: any) => {
        const legBlock = (leg.actualBlockMinutes ?? 0) > 0 ? leg.actualBlockMinutes : (leg.plannedBlockMinutes ?? 0);
        return legSum + legBlock;
      }, 0);
      return sum + legsBlock;
    }, 0);
  };

  // Calculate monthly totals for the new pay-focused summary
  // PHASE 5: Use payCreditMinutes (max of protected, current) for pay calculations
  const monthlyTotals = useMemo((): TripTotals => {
    let totalBlockMinutes = 0;
    let totalCreditMinutes = 0;
    let totalPayCreditMinutes = 0; // Phase 5: Aggregated pay credit for pay calculations
    let totalTafbMinutes = 0;
    let totalPdiemCents = 0;
    let totalDutyDays = 0;

    for (const trip of allTrips) {
      // Use effective block/credit that falls back to leg-level sums
      totalBlockMinutes += getEffectiveTripBlock(trip);
      totalCreditMinutes += getEffectiveTripCredit(trip);
      // Phase 5: Use payCreditMinutes if available, fallback to effective credit
      totalPayCreditMinutes += trip.payCreditMinutes || getEffectiveTripCredit(trip);
      totalTafbMinutes += trip.totalTafbMinutes || 0;
      totalPdiemCents += trip.totalPdiemCents || 0;
      totalDutyDays += trip.dutyDaysCount || trip.dutyDays?.length || trip.tripDutyDays?.length || 0;
    }

    return {
      // Phase 5: Use payCreditMinutes for pay calculations (protects pilot pay)
      creditMin: totalPayCreditMinutes,
      blockMin: totalBlockMinutes,
      tafbMin: totalTafbMinutes,
      dutyDays: totalDutyDays,
      perDiemCents: totalPdiemCents,
    };
  }, [allTrips]);

  // Calculate pay info based on monthly totals
  const monthlyPay = useMemo((): TripPayInfo => {
    return calcTripPay(monthlyTotals, hourlyRateCents);
  }, [monthlyTotals, hourlyRateCents]);

  // Schedule notifications for upcoming trips
  // Convert trips to the format expected by the notification scheduler
  const tripsForNotifications = useMemo(() => {
    return allTrips.map(trip => ({
      id: trip.id,
      tripNumber: trip.tripNumber,
      dutyDays: (trip.tripDutyDays ?? trip.dutyDays ?? []).map(dd => ({
        id: dd.id,
        dutyDate: dd.dutyDate,
        reportTimeISO: 'reportTimeISO' in dd ? dd.reportTimeISO : dd.dutyStartISO,
        legs: dd.legs.map(leg => ({
          origin: leg.origin,
          destination: leg.destination,
          flightNumber: leg.flightNumber,
          scheduledOutISO: leg.scheduledOutISO,
        })),
      })),
    }));
  }, [allTrips]);

  // Auto-schedule notifications when trips change
  useTripNotificationScheduler(tripsForNotifications);

  const tripDetail = tripDetailData?.trip ?? selectedTrip;

  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Handlers
  const handleTripPress = useCallback((trip: BackendTrip, dutyDayIndex?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTrip(trip);
    setSelectedDutyDayIndex(dutyDayIndex);
    setShowTripDetail(true);
  }, []);

  // Deep-link: fetch the specific trip by ID (bypasses month date filter)
  const { data: deepLinkTripData } = useTrip(deepLinkTripId ?? null);

  // Auto-open a specific trip when navigated here with ?tripId=
  useEffect(() => {
    if (!deepLinkTripId) return;
    const trip = deepLinkTripData?.trip;
    if (!trip) return;
    // Jump calendar to the trip's month so it appears in the list
    if (trip.startDate) {
      const tripDate = new Date(trip.startDate + "T12:00:00");
      setCurrentMonth(tripDate);
    }
    setSelectedTrip(trip);
    setShowTripDetail(true);
  }, [deepLinkTripId, deepLinkTripData]);

  // Phase 6: Handle review changes navigation
  const handleReviewPress = useCallback((trip: BackendTrip) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/review-changes?tripId=${trip.id}`);
  }, [router]);

  const handleImport = useCallback(
    async (
      images: SelectedImage[],
      sourceType: ScheduleSourceType,
      onProgress?: (progress: number, step: string) => void
    ) => {
      // Start the import queue for progress tracking (works for single and multi-file)
      // This enables the floating minimized indicator when user dismisses the modal
      const fileNames = images.map((_, i) => `Screenshot ${i + 1}`);
      importQueue.startQueue(fileNames);

      try {
      // Upload images first
      const uploadedUrls: string[] = [];

      // Upload phase is 0-30% of total progress
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        try {
          // Update queue status for progress tracking
          importQueue.setFileUploading(i, 0);

          // Calculate upload progress (0-30%)
          const uploadProgressBase = Math.round((i / images.length) * 30);
          onProgress?.(uploadProgressBase, `Uploading image ${i + 1} of ${images.length}...`);

          console.log(`[Import] Uploading image ${i + 1}/${images.length}, base64 length: ${image.base64.length}`);
          const result = await uploadImageBase64(image.base64, image.mimeType);

          importQueue.setFileUploading(i, 50);

          if (result.url) {
            uploadedUrls.push(result.url);
            console.log(`[Import] Uploaded: ${result.url}`);

            // Mark file as done uploading (will be set to parsing later)
            importQueue.setFileUploading(i, 100);

            // Update progress after upload
            const uploadProgressAfter = Math.round(((i + 1) / images.length) * 30);
            onProgress?.(uploadProgressAfter, `Uploaded ${i + 1} of ${images.length} images`);
          }
        } catch (err) {
          console.error('[Import] Upload failed:', err);
          importQueue.setFileError(i, 'Upload failed');
          throw new Error('Failed to upload images');
        }
      }

      if (uploadedUrls.length === 0) {
        throw new Error('No images uploaded successfully');
      }

      // Helper function to build ImportSummary from API response
      const buildImportSummary = (
        response: any,
        uploadId: string = 'import-' + Date.now()
      ): ImportSummary => {
        const createdIds = response.createdTripIds || [];
        const updatedIds = response.updatedTripIds || [];
        const skippedIds = response.skippedTripIds || [];
        const warnings = response.warnings || response.lowConfidenceWarnings || [];
        const errors = response.errors || [];

        // Build trip results from parsed data if available
        const tripResults: ImportSummary['tripResults'] = [];

        // Add created trips
        for (let i = 0; i < createdIds.length; i++) {
          const parsedTrip = response.parsedTrips?.[i];
          tripResults.push({
            tripId: createdIds[i],
            action: 'created',
            tripNumber: parsedTrip?.tripNumber || null,
            pairingId: parsedTrip?.pairingId || null,
            startDate: parsedTrip?.startDate || '',
            endDate: parsedTrip?.endDate || '',
            creditMinutes: parsedTrip?.totalCreditMinutes || 0,
            message: null,
          });
        }

        // Add updated trips
        for (const tripId of updatedIds) {
          tripResults.push({
            tripId,
            action: 'updated',
            tripNumber: null,
            pairingId: null,
            startDate: '',
            endDate: '',
            creditMinutes: 0,
            message: 'Trip data merged with existing',
          });
        }

        // Add skipped trips
        for (const tripId of skippedIds) {
          tripResults.push({
            tripId,
            action: 'skipped',
            tripNumber: null,
            pairingId: null,
            startDate: '',
            endDate: '',
            creditMinutes: 0,
            message: 'Already imported',
          });
        }

        const hasErrors = errors.length > 0 || response.errorMessage;
        const status = hasErrors ? 'failed' :
                      (createdIds.length === 0 && updatedIds.length === 0 && skippedIds.length > 0) ? 'skipped' :
                      'completed';

        return {
          uploadId,
          status,
          tripsCreated: createdIds.length,
          tripsUpdated: updatedIds.length,
          tripsSkipped: skippedIds.length,
          conflictsNeedingReview: response.conflictsFound || 0,
          warnings,
          errorMessage: response.errorMessage || (errors.length > 0 ? errors.join(', ') : null),
          tripResults,
        };
      };

      // Use the new async API with polling for better scalability
      console.log('[Import] Starting async processing...');
      onProgress?.(30, 'Starting schedule analysis...');

      // Mark all files as parsing in the queue
      for (let i = 0; i < images.length; i++) {
        importQueue.setFileParsing(i, 50);
      }

      try {
        const result = await parseScheduleWithPolling(uploadedUrls, (status) => {
          // Map server progress (0-100) to our progress range (30-95)
          // Server progress: 0-100 during parsing
          // Our range: 30% (after upload) to 95% (before finalization)
          const mappedProgress = 30 + Math.round(status.progress * 0.65);
          const step = status.currentStep || 'Processing...';
          onProgress?.(mappedProgress, step);
          console.log(`[Import] Progress: ${status.progress}% -> ${mappedProgress}% - ${step}`);
        });

        console.log('[Import] Async processing complete:', result);

        // Mark all files as done in the queue
        const tripsPerFile = Math.ceil((result.createdTripIds?.length || 0) / images.length);
        for (let i = 0; i < images.length; i++) {
          importQueue.setFileDone(i, tripsPerFile);
        }
        // Dismiss the overlay immediately so it doesn't block the summary modal
        importQueue.dismissQueue();

        // CHECK FOR CONFLICTS from async API - Show modal if conflicts detected
        if (result.hasConflicts && result.conflictsDetected && result.conflictsDetected.length > 0) {
          console.log('[Import] CONFLICT DETECTED from async API - Showing Pay Protection modal');
          const firstConflict = result.conflictsDetected[0];
          setConflictData({
            conflicts: firstConflict.conflicts,
            newTripSummary: firstConflict.newTripSummary,
            parsedData: firstConflict.parsedData,
          });
          setShowConflictModal(true);
          // Still refetch to show any trips that were created without conflicts
          refetch();
          return;
        }

        const tripCount = result.createdTripIds?.length || 0;
        const updateCount = result.updatedTripIds?.length || 0;

        // Build import summary
        const summary = buildImportSummary(result);

        // Stagger state updates to prevent UI freeze:
        // 1. Refetch trips data first
        refetch();
        // 2. Wait for current interactions/animations to complete before showing summary
        InteractionManager.runAfterInteractions(() => {
          setImportSummary(summary);
          setShowImportSummary(true);
        });

        // CHECK FOR SIK DETECTION - Show review modal if SIK detected (Phase 1)
        if (result.hasSikDetected && result.sikDetected && result.sikDetected.length > 0) {
          console.log('[Import] SIK DETECTED in upload - showing review modal');
          const firstSik = result.sikDetected[0];
          if (firstSik) {
            setSikDetectionData({
              sikDetected: firstSik.sikDetected,
              tripId: firstSik.tripId,
              imageUrls: uploadedUrls,
            });
            setShowSikDetectionModal(true);
          }
        }

        // If nothing was imported and no specific error, throw
        if (tripCount === 0 && updateCount === 0 && !result.errorMessage && summary.tripsSkipped === 0) {
          throw new Error('No trips could be extracted from the images. Try a clearer screenshot.');
        }
      } catch (asyncErr: any) {
        // If async API fails, fall back to sync API with extended timeout
        console.log('[Import] Async API failed, falling back to sync:', asyncErr.message);

        // Clear parse cache first to ensure fresh parsing with latest parser
        try {
          await api.delete('/api/schedule/clear-cache');
          console.log('[Import] Cache cleared for fresh parsing');
        } catch (cacheErr) {
          console.warn('[Import] Could not clear cache:', cacheErr);
        }

        // Call schedule parse API with extended timeout and retry
        const parseResponse = await parseScheduleSync<{
          success: boolean;
          hasConflicts?: boolean;
          conflictResult?: CheckConflictsResponse;
          parsedData?: any;
          parsedTrips: Array<{
            tripNumber?: string;
            startDate?: string;
            endDate?: string;
            hasConflicts?: boolean;
            conflicts?: TripConflict[];
          }>;
          createdTripIds: string[];
          updatedTripIds: string[];
          skippedTripIds?: string[];
          errors?: string[];
          warnings?: string[];
          lowConfidenceWarnings?: string[];
          message?: string;
          errorMessage?: string;
        }>(uploadedUrls, sourceType);

        console.log('[Import] Parse response:', parseResponse);

        // Mark all files as done in the queue
        const tripsPerFile = Math.ceil((parseResponse.createdTripIds?.length || 0) / images.length);
        for (let i = 0; i < images.length; i++) {
          importQueue.setFileDone(i, tripsPerFile);
        }
        // Dismiss the overlay immediately so it doesn't block the summary modal
        importQueue.dismissQueue();

        // CHECK FOR CONFLICTS - Show modal if conflicts detected
        if (parseResponse.hasConflicts && parseResponse.conflictResult) {
          console.log('[Import] CONFLICT DETECTED - Showing Pay Protection modal');
          setConflictData({
            conflicts: parseResponse.conflictResult.conflicts,
            newTripSummary: parseResponse.conflictResult.newTripSummary,
            parsedData: parseResponse.parsedData,
          });
          setShowConflictModal(true);
          return;
        }

        const tripCount = parseResponse.createdTripIds?.length || 0;
        const updateCount = parseResponse.updatedTripIds?.length || 0;

        // Build import summary
        const summary = buildImportSummary(parseResponse);

        // Stagger state updates to prevent UI freeze
        refetch();
        InteractionManager.runAfterInteractions(() => {
          setImportSummary(summary);
          setShowImportSummary(true);
        });

        // CHECK FOR SIK DETECTION - Show review modal if SIK detected (Phase 1)
        const sikData = (parseResponse as any).sikDetected;
        const hasSik = (parseResponse as any).hasSikDetected;
        if (hasSik && sikData && sikData.length > 0) {
          console.log('[Import] SIK DETECTED in upload (sync) - showing review modal');
          const firstSik = sikData[0];
          if (firstSik) {
            setSikDetectionData({
              sikDetected: firstSik.sikDetected,
              tripId: firstSik.tripId,
              imageUrls: uploadedUrls,
            });
            setShowSikDetectionModal(true);
          }
        }

        // If nothing was imported and no specific error, throw
        if (tripCount === 0 && updateCount === 0 && !parseResponse.errors?.length && summary.tripsSkipped === 0) {
          throw new Error('No trips could be extracted from the images. Try a clearer screenshot.');
        }
      }
      } catch (outerErr) {
        // Ensure queue is dismissed on any unhandled error so screen never freezes
        importQueue.dismissQueue();
        throw outerErr;
      }
    },
    [refetch, importQueue]
  );

  // Handle conflict resolution from the Pay Protection modal
  const handleConflictDecision = useCallback(
    async (decision: ConflictDecision, note?: string) => {
      if (!conflictData) return;

      setIsResolvingConflict(true);

      // Helper function to make the API call with retry logic
      const resolveWithRetry = async (retries = 2): Promise<{
        success: boolean;
        tripId: string | null;
        deletedTripIds: string[];
        archivedTripIds?: string[];
        isOverride: boolean;
        auditRecordId: string | null;
        protectedCreditResult?: {
          oldCreditMinutes: number;
          newCreditMinutes: number;
          protectedCreditMinutes: number;
          changedDutyDays: string[];
        };
        message?: string;
      }> => {
        try {
          // Use a longer timeout for conflict resolution (30 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          const cookie = await getAuthCookieHeader();

          const response = await fetch(`${BACKEND_URL}/api/schedule/resolve-conflict`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(cookie ? { Cookie: cookie } : {}),
            },
            body: JSON.stringify({
              decision,
              conflictingTripIds: conflictData.conflicts.map(c => c.existingTrip.tripId),
              newTripData: conflictData.parsedData,
              acknowledgmentNote: note,
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(errorData.error || `Request failed: ${response.status}`);
          }

          return await response.json();
        } catch (error: any) {
          // Retry on network errors or fetch cancellation
          const isRetryable =
            error.name === 'AbortError' ||
            error.message?.includes('fetch failed') ||
            error.message?.includes('canceled') ||
            error.message?.includes('network');

          if (isRetryable && retries > 0) {
            console.log(`[Conflict] Retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            return resolveWithRetry(retries - 1);
          }

          throw error;
        }
      };

      try {
        const response = await resolveWithRetry();

        console.log('[Conflict] Resolution response:', response);

        if (decision === 'cancel') {
          // User cancelled - just close the modal
          Alert.alert('Import Cancelled', 'The trip was not imported.');
        } else if (decision === 'company_revision') {
          // Company revision - trip was updated with protected credit
          refetch();
          const pc = response.protectedCreditResult;
          if (pc) {
            const formatCredit = (mins: number) => {
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return `${h}:${m.toString().padStart(2, '0')}`;
            };
            Alert.alert(
              'Company Revision Applied',
              `Trip updated with protected credit.\n\n` +
              `Original Credit: ${formatCredit(pc.oldCreditMinutes)}\n` +
              `Revised Credit: ${formatCredit(pc.newCreditMinutes)}\n` +
              `Protected Credit: ${formatCredit(pc.protectedCreditMinutes)}\n\n` +
              `${pc.changedDutyDays.length} duty day(s) affected.`,
              [{ text: 'OK' }]
            );
          } else {
            Alert.alert('Company Revision Applied', 'Trip updated successfully.');
          }
        } else if (decision === 'replace_trip') {
          // Replace trip - old archived, new imported
          refetch();
          const archivedCount = response.archivedTripIds?.length ?? 0;
          Alert.alert(
            'Trip Replaced',
            archivedCount > 0
              ? `Original trip archived. New trip imported successfully.`
              : `New trip imported successfully.`,
            [{ text: 'OK' }]
          );
        } else if (response.success && response.tripId) {
          // Legacy decisions (replace_existing, keep_both_override)
          refetch();
          if (decision === 'replace_existing') {
            Alert.alert(
              'Trip Replaced',
              `Successfully replaced ${response.deletedTripIds.length} existing trip(s) with the new import.`,
              [{ text: 'OK' }]
            );
          } else if (decision === 'keep_both_override') {
            Alert.alert(
              'Override Created',
              'Trip imported as OVERRIDE. Both trips now exist in your schedule.',
              [{ text: 'OK' }]
            );
          }
        }

        // Close the modal and reset state
        setShowConflictModal(false);
        setConflictData(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error: any) {
        console.error('[Conflict] Resolution failed:', error);

        // Show appropriate error message
        let errorMessage = 'Failed to resolve conflict. Please try again.';
        if (error.name === 'AbortError' || error.message?.includes('canceled') || error.message?.includes('timeout')) {
          errorMessage = 'Request timed out. Please check your connection and try again.';
        } else if (error.message?.includes('network') || error.message?.includes('fetch failed')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message) {
          errorMessage = error.message;
        }

        Alert.alert('Error', errorMessage);
      } finally {
        setIsResolvingConflict(false);
      }
    },
    [conflictData, refetch]
  );

  const handleCreateTrip = useCallback(
    async (data: { tripNumber: string; startDate: string; endDate: string }) => {
      try {
        await createTripMutation.mutateAsync({
          tripNumber: data.tripNumber,
          startDate: data.startDate,
          endDate: data.endDate,
          source: 'manual',
        });
        setShowCreateModal(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error('Failed to create trip:', error);
        Alert.alert('Error', 'Failed to create trip');
      }
    },
    [createTripMutation]
  );

  const handleDeleteTrip = useCallback(async (tripId?: string, skipConfirmation = false) => {
    // Use provided tripId or fall back to selectedTrip
    const tripToDelete = tripId
      ? allTrips.find(t => t.id === tripId)
      : selectedTrip;

    if (!tripToDelete) return;

    // skipConfirmation is no longer used — always show the modal
    setRemoveTripTarget(tripToDelete);
    setRemoveTripModalVisible(true);
  }, [selectedTrip, allTrips]);

  const handleConfirmDeleteFromApp = useCallback(async () => {
    if (!removeTripTarget) return;
    setRemoveTripModalVisible(false);
    try {
      await deleteTripMutation.mutateAsync(removeTripTarget.id);
      if (selectedTrip?.id === removeTripTarget.id) {
        setShowTripDetail(false);
        setSelectedTrip(null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[Trips] Failed to delete trip:', error);
      Alert.alert('Error', 'Failed to delete trip. Please try again.');
    } finally {
      setRemoveTripTarget(null);
    }
  }, [removeTripTarget, deleteTripMutation, selectedTrip]);

  const handleConfirmDropTrip = useCallback(async () => {
    if (!removeTripTarget) return;
    setRemoveTripModalVisible(false);
    try {
      await dropTripMutation.mutateAsync(removeTripTarget.id);
      if (selectedTrip?.id === removeTripTarget.id) {
        setShowTripDetail(false);
        setSelectedTrip(null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[Trips] Failed to drop trip:', error);
      Alert.alert('Error', 'Failed to drop trip. Please try again.');
    } finally {
      setRemoveTripTarget(null);
    }
  }, [removeTripTarget, dropTripMutation, selectedTrip]);

  const handleConfirmCompanyRemoved = useCallback(async () => {
    if (!removeTripTarget) return;
    setRemoveTripModalVisible(false);
    try {
      await companyRemoveTripMutation.mutateAsync(removeTripTarget.id);
      if (selectedTrip?.id === removeTripTarget.id) {
        setShowTripDetail(false);
        setSelectedTrip(null);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('[Trips] Failed to mark trip as company removed:', error);
      Alert.alert('Error', 'Failed to update trip. Please try again.');
    } finally {
      setRemoveTripTarget(null);
    }
  }, [removeTripTarget, companyRemoveTripMutation, selectedTrip]);

  // Clear all trips for current month
  const handleClearMonth = useCallback(async () => {
    if (processedTrips.length === 0) return;

    const monthName = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    Alert.alert(
      'Clear All Trips',
      `This will delete all ${processedTrips.length} trip(s) in ${monthName}. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete all trips in current month
              for (const trip of processedTrips) {
                await deleteTripMutation.mutateAsync(trip.id);
              }
              refetch();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Success', `Cleared ${processedTrips.length} trips from ${monthName}`);
            } catch (error) {
              console.error('Failed to clear month:', error);
              Alert.alert('Error', 'Failed to delete some trips');
            }
          },
        },
      ]
    );
  }, [processedTrips, currentMonth, deleteTripMutation, refetch]);

  const handleAddDutyDay = useCallback(async () => {
    if (!selectedTrip) return;

    const today = new Date().toISOString().split('T')[0];
    const dutyDate =
      today >= selectedTrip.startDate && today <= selectedTrip.endDate
        ? today
        : selectedTrip.startDate;

    try {
      await addDutyDayMutation.mutateAsync({
        tripId: selectedTrip.id,
        data: { dutyDate },
      });
      refetchTripDetail();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to add duty day:', error);
      Alert.alert('Error', 'Failed to add duty day');
    }
  }, [selectedTrip, addDutyDayMutation, refetchTripDetail]);

  const handleAddLeg = useCallback((dutyDayId: string) => {
    setSelectedDutyDayId(dutyDayId);
    setShowAddLegModal(true);
  }, []);

  const handleAddLegSubmit = useCallback(
    async (data: {
      flightNumber?: string;
      origin?: string;
      destination?: string;
      equipment?: string;
      isDeadhead?: boolean;
      plannedBlockMinutes?: number;
    }) => {
      if (!selectedDutyDayId) return;

      try {
        await addLegMutation.mutateAsync({
          dutyDayId: selectedDutyDayId,
          data: {
            flightNumber: data.flightNumber,
            origin: data.origin,
            destination: data.destination,
            equipment: data.equipment,
            isDeadhead: data.isDeadhead,
            plannedBlockMinutes: data.plannedBlockMinutes,
            plannedCreditMinutes: data.plannedBlockMinutes,
            source: 'manual',
          },
        });
        setShowAddLegModal(false);
        setSelectedDutyDayId(null);
        refetchTripDetail();
        refetch();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error('Failed to add leg:', error);
        Alert.alert('Error', 'Failed to add leg');
      }
    },
    [selectedDutyDayId, addLegMutation, refetchTripDetail, refetch]
  );

  const handleEditLeg = useCallback((leg: BackendLeg) => {
    setSelectedLeg(leg);
    setShowOOOIEditor(true);
  }, []);

  const handleCaptureProof = useCallback((leg: BackendLeg) => {
    setSelectedLeg(leg);
    setIsCanonicalLeg(false);
    setShowOOOICapture(true);
  }, []);

  // Handle OOOI capture from leg context (canonical breakdown)
  const handleCaptureOOOI = useCallback((legContext: LegOOOIContext) => {
    console.log('[OOOI] handleCaptureOOOI called with:', legContext.legId, legContext.origin, '->', legContext.destination);
    setSelectedLegOOOIContext(legContext);
    setIsCanonicalLeg(true);
    // Create a minimal BackendLeg for the OOOICapture component
    const legForCapture: BackendLeg = {
      id: legContext.legId,
      dutyDayId: '', // Not needed for capture
      legIndex: 0,
      flightNumber: legContext.flightNumber,
      origin: legContext.origin,
      destination: legContext.destination,
      equipment: null,
      tailNumber: null,
      isDeadhead: false,
      scheduledOutISO: legContext.scheduledOutISO,
      scheduledInISO: legContext.scheduledInISO,
      plannedBlockMinutes: 0,
      plannedCreditMinutes: 0,
      actualOutISO: null,
      actualOffISO: null,
      actualOnISO: null,
      actualInISO: null,
      actualFlightMinutes: 0,
      actualBlockMinutes: 0,
      creditMinutes: 0,
      premiumCode: null,
      premiumAmountCents: 0,
      calculatedPayCents: 0,
      source: 'manual',
      ooiProofUri: null,
      ooiProofTimestamp: null,
      notes: null,
      wasEdited: false,
      editedAt: null,
      needsReview: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    console.log('[OOOI] Setting selectedLeg and opening OOOICapture modal for leg:', legForCapture.id);
    setSelectedLeg(legForCapture);
    // Close the trip detail drawer first so OOOICapture modal appears on top
    setShowTripDetail(false);
    // Small delay to let the drawer close before opening capture modal
    setTimeout(() => {
      setShowOOOICapture(true);
    }, 100);
  }, []);

  const handleSaveOOOI = useCallback(
    async (data: {
      actualOutISO?: string;
      actualOffISO?: string;
      actualOnISO?: string;
      actualInISO?: string;
      actualBlockMinutes?: number;
      actualFlightMinutes?: number;
    }) => {
      if (!selectedLeg) return;

      try {
        // Use correct mutation based on leg type
        if (isCanonicalLeg) {
          await updateTripDutyLegMutation.mutateAsync({
            legId: selectedLeg.id,
            data: {
              actualOutISO: data.actualOutISO,
              actualOffISO: data.actualOffISO,
              actualOnISO: data.actualOnISO,
              actualInISO: data.actualInISO,
              actualBlockMinutes: data.actualBlockMinutes,
              creditMinutes: data.actualBlockMinutes, // Use block as credit for canonical
            },
          });
        } else {
          await updateLegMutation.mutateAsync({
            legId: selectedLeg.id,
            data,
          });
        }
        setShowOOOIEditor(false);
        setSelectedLeg(null);
        setIsCanonicalLeg(false);
        refetchTripDetail();
        refetch();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error('Failed to save OOOI:', error);
        Alert.alert('Error', 'Failed to save OOOI times');
      }
    },
    [selectedLeg, isCanonicalLeg, updateLegMutation, updateTripDutyLegMutation, refetchTripDetail, refetch]
  );

  const handleOOOIParsed = useCallback(
    async (result: {
      outTime?: string;
      offTime?: string;
      onTime?: string;
      inTime?: string;
      imageUri?: string;
      confidence: number;
    }) => {
      // Capture the current leg before any state changes
      const leg = selectedLeg;
      const canonical = isCanonicalLeg;

      if (!leg) {
        console.error('[OOOI] No selected leg when parsing result');
        return;
      }

      console.log('[OOOI] Parsed result for leg:', leg.id, 'isCanonical:', canonical);

      const baseDate =
        leg.scheduledOutISO?.split('T')[0] ?? new Date().toISOString().split('T')[0];

      const buildISO = (time?: string) => {
        if (!time || !time.match(/^\d{2}:\d{2}$/)) return undefined;
        return `${baseDate}T${time}:00.000Z`;
      };

      const parseTime = (time?: string): number | undefined => {
        if (!time) return undefined;
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
      };

      const outMins = parseTime(result.outTime);
      const offMins = parseTime(result.offTime);
      const onMins = parseTime(result.onTime);
      const inMins = parseTime(result.inTime);

      let blockMinutes = 0;
      let flightMinutes = 0;

      if (outMins !== undefined && inMins !== undefined) {
        blockMinutes = inMins >= outMins ? inMins - outMins : inMins + 1440 - outMins;
      }
      if (offMins !== undefined && onMins !== undefined) {
        flightMinutes = onMins >= offMins ? onMins - offMins : onMins + 1440 - offMins;
      }

      const data = {
        actualOutISO: buildISO(result.outTime),
        actualOffISO: buildISO(result.offTime),
        actualOnISO: buildISO(result.onTime),
        actualInISO: buildISO(result.inTime),
        actualBlockMinutes: blockMinutes,
        actualFlightMinutes: flightMinutes,
      };

      console.log('[OOOI] Saving data:', data);

      // Close the capture modal first (before async operation)
      setShowOOOICapture(false);

      try {
        // Use correct mutation based on leg type (using captured values)
        if (canonical) {
          console.log('[OOOI] Using TripDutyLeg mutation for leg:', leg.id);
          await updateTripDutyLegMutation.mutateAsync({
            legId: leg.id,
            data: {
              actualOutISO: data.actualOutISO,
              actualOffISO: data.actualOffISO,
              actualOnISO: data.actualOnISO,
              actualInISO: data.actualInISO,
              actualBlockMinutes: data.actualBlockMinutes,
              creditMinutes: data.actualBlockMinutes, // Use block as credit for canonical
            },
          });
        } else {
          console.log('[OOOI] Using regular Leg mutation for leg:', leg.id);
          await updateLegMutation.mutateAsync({
            legId: leg.id,
            data,
          });
        }

        // Clear state after successful save
        setSelectedLeg(null);
        setIsCanonicalLeg(false);
        refetchTripDetail();
        refetch();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        console.log('[OOOI] Save successful');
      } catch (error) {
        console.error('[OOOI] Failed to save OOOI:', error);
        Alert.alert('Error', 'Failed to save OOOI times');
      }
    },
    [selectedLeg, isCanonicalLeg, updateLegMutation, updateTripDutyLegMutation, refetchTripDetail, refetch]
  );

  const handleRefresh = useCallback(() => {
    refetch();
    refetchReserve();
  }, [refetch, refetchReserve]);

  // Handle delete reserve schedule event
  const handleDeleteReserveSchedule = useCallback((event: ReserveScheduleEvent) => {
    const typeName = event.scheduleType.startsWith('RSV') ? 'Reserve' : event.scheduleType;
    const hasLegs = (event.activationLegs?.length ?? 0) > 0;

    Alert.alert(
      `Delete ${typeName}`,
      hasLegs
        ? `This ${typeName} has ${event.activationLegs?.length} activation leg(s) attached. Deleting will also remove all attached legs. This cannot be undone.`
        : `Are you sure you want to delete this ${typeName} event? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('[Trips] Deleting reserve schedule:', event.id, event.scheduleType);
              await deleteReserveScheduleMutation.mutateAsync(event.id);
              console.log('[Trips] Successfully deleted reserve schedule:', event.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error('[Trips] Failed to delete reserve schedule:', error);
              Alert.alert('Error', 'Failed to delete reserve schedule. Please try again.');
            }
          },
        },
      ]
    );
  }, [deleteReserveScheduleMutation]);

  // Show loading state while fonts load
  if (!fontsLoaded) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <Text className="text-slate-400">Loading...</Text>
      </View>
    );
  }

  // Render content
  const renderContent = () => {
    const reserveEvents = reserveData?.events ?? [];

    if (isLoading && allTrips.length === 0 && reserveEvents.length === 0) {
      return (
        <View className="flex-1 items-center justify-center">
          <Text className="text-slate-400">Loading trips...</Text>
        </View>
      );
    }

    // Show RSV events even if no trips
    if (processedTrips.length === 0 && reserveEvents.length === 0) {
      if (allTrips.length === 0) {
        return (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor="#06b6d4" />
            }
          >
            <EmptyTripsState onImportPress={() => setShowImportModal(true)} monthLabel={monthLabel} />
          </ScrollView>
        );
      }
      return (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-slate-400 text-center">
            No trips match your current filters
          </Text>
        </View>
      );
    }

    if (viewMode === 'calendar') {
      return (
        <CalendarView
          currentMonth={currentMonth}
          trips={processedTrips}
          onTripPress={handleTripPress}
        />
      );
    }

    // List view

    const listHeader = (
      <View>
        {/* Monthly Pay Summary Card */}
        {allTrips.length > 0 && (
          <MonthPaySummaryCard
            monthLabel={monthLabel}
            totals={monthlyTotals}
            pay={monthlyPay}
            tripCount={allTrips.length}
            onViewDashboard={() => router.push('/(tabs)')}
          />
        )}

        {/* Reserve Schedule Section */}
        {reserveEvents.length > 0 && (
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-semibold text-white">Reserve Schedule</Text>
              <View className="bg-violet-500/20 px-2 py-1 rounded-md">
                <Text className="text-xs text-violet-400 font-medium">
                  {reserveEvents.length} event{reserveEvents.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            {reserveEvents.map((event, index) => (
              <ReserveScheduleCard
                key={event.id}
                event={event}
                index={index}
                onDelete={() => handleDeleteReserveSchedule(event)}
              />
            ))}
          </View>
        )}

        {/* Trips Section Header (when RSV events exist) */}
        {reserveEvents.length > 0 && processedTrips.length > 0 && (
          <View className="flex-row items-center justify-between mb-3 mt-2">
            <Text className="text-lg font-semibold text-white">Trips</Text>
            <View className="bg-cyan-500/20 px-2 py-1 rounded-md">
              <Text className="text-xs text-cyan-400 font-medium">
                {processedTrips.length} trip{processedTrips.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>
        )}
      </View>
    );

    return (
      <FlatList
        data={processedTrips}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <TripBreakdownCard
            trip={item}
            onPress={(dutyDayIndex) => handleTripPress(item, dutyDayIndex)}
            onDelete={() => handleDeleteTrip(item.id)}
            onReviewPress={() => handleReviewPress(item)}
            onMarkSick={() => {
              setSickModalTrip(item);
              setShowSickModal(true);
            }}
            index={index}
          />
        )}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor="#06b6d4" />
        }
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        windowSize={10}
        initialNumToRender={5}
        style={{ flex: 1 }}
      />
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={['#0f172a', '#020617']}
          style={{ flex: 1, paddingTop: insets.top }}
        >
          {/* Header */}
          <TripsScreenHeader
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            tripCount={processedTrips.length}
            onImportPress={() => setShowImportModal(true)}
            filter={filter}
            onFilterChange={setFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearMonth={handleClearMonth}
            onHelpPress={openTutorial}
            pendingReviewsCount={pendingReviewsCount}
            onPendingReviewsPress={() => router.push('/import-review')}
          />

          {/* Content */}
          {renderContent()}

          {/* Modals */}
          <SmartImportModal
            visible={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImport={handleImport}
          />

          {/* Import Summary Modal */}
          <ImportSummaryModal
            visible={showImportSummary}
            onClose={() => {
              setShowImportSummary(false);
              setImportSummary(null);
            }}
            onViewTrip={(tripId) => {
              const trip = allTrips.find(t => t.id === tripId);
              if (trip) {
                handleTripPress(trip);
              }
            }}
            summary={importSummary}
          />

          {/* Pay Protection Conflict Modal */}
          <PayProtectionConflictModal
            visible={showConflictModal}
            onClose={() => {
              setShowConflictModal(false);
              setConflictData(null);
            }}
            onDecision={handleConflictDecision}
            conflicts={conflictData?.conflicts ?? []}
            newTripSummary={conflictData?.newTripSummary ?? {
              tripId: '',
              tripNumber: null,
              pairingId: null,
              startDate: '',
              endDate: '',
              totalCreditMinutes: 0,
              dutyDaysCount: 0,
              legCount: 0,
              routeHighlights: '',
            }}
            isLoading={isResolvingConflict}
          />

          <CreateTripModal
            visible={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={handleCreateTrip}
            isLoading={createTripMutation.isPending}
          />

          <TripDetailDrawer
            trip={tripDetail}
            visible={showTripDetail}
            onClose={() => {
              setShowTripDetail(false);
              setSelectedTrip(null);
              setSelectedDutyDayIndex(undefined);
            }}
            onDelete={handleDeleteTrip}
            onAddDutyDay={handleAddDutyDay}
            onAddLeg={handleAddLeg}
            onEditLeg={handleEditLeg}
            onCaptureProof={handleCaptureProof}
            onCaptureOOOI={handleCaptureOOOI}
            onAddPayEvent={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (tripDetail) {
                // Navigate with full trip context for prefill
                const firstDutyDay = tripDetail.dutyDays?.[0];
                const firstLeg = firstDutyDay?.legs?.[0];
                const params: Record<string, string> = {
                  tripId: tripDetail.id,
                  tripNumber: tripDetail.tripNumber ?? '',
                  tripStartDate: tripDetail.startDate ?? '',
                  tripEndDate: tripDetail.endDate ?? '',
                };
                if (firstDutyDay?.dutyDate) params.dutyDayDate = firstDutyDay.dutyDate;
                if (firstLeg?.equipment) params.aircraftType = firstLeg.equipment;
                router.push({ pathname: '/create-log-event', params });
              } else {
                router.push('/create-log-event');
              }
            }}
            onVerifyPay={() => {
              if (!tripDetail) return;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Pay Verified',
                `Trip ${tripDetail.tripNumber || ''} has been marked as verified.`,
                [{ text: 'Great', style: 'default' }]
              );
            }}
            isDeleting={deleteTripMutation.isPending}
            initialDutyDayIndex={selectedDutyDayIndex}
          />

          <OOOIEditor
            leg={selectedLeg}
            visible={showOOOIEditor}
            onClose={() => {
              setShowOOOIEditor(false);
              setSelectedLeg(null);
            }}
            onSave={handleSaveOOOI}
            onOpenCamera={() => {
              setShowOOOIEditor(false);
              setShowOOOICapture(true);
            }}
            isSaving={updateLegMutation.isPending}
          />

          <OOOICapture
            leg={selectedLeg}
            visible={showOOOICapture}
            onClose={() => {
              setShowOOOICapture(false);
              setSelectedLeg(null);
              setIsCanonicalLeg(false);
              // Reopen trip detail if we have a selected trip
              if (selectedTrip) {
                setShowTripDetail(true);
              }
            }}
            onParsed={handleOOOIParsed}
          />

          <AddLegModal
            visible={showAddLegModal}
            onClose={() => {
              setShowAddLegModal(false);
              setSelectedDutyDayId(null);
            }}
            onSubmit={handleAddLegSubmit}
            isLoading={addLegMutation.isPending}
          />

          {/* Sick Marking Modal */}
          {sickModalTrip && (
            <SickMarkingModal
              visible={showSickModal}
              onClose={() => {
                setShowSickModal(false);
                setSickModalTrip(null);
              }}
              trip={sickModalTrip}
              onSuccess={() => {
                refetch();
              }}
            />
          )}

          {/* SIK Detection Review Modal (Phase 1) - shows when SIK detected in upload */}
          {sikDetectionData && (
            <SikDetectionReviewModal
              visible={showSikDetectionModal}
              onClose={() => {
                setShowSikDetectionModal(false);
                setSikDetectionData(null);
              }}
              sikDetected={sikDetectionData.sikDetected}
              tripId={sikDetectionData.tripId}
              imageUrls={sikDetectionData.imageUrls}
              onSuccess={() => {
                refetch();
              }}
            />
          )}

          {/* Import Progress Overlay - shows during multi-file imports */}
          <ImportProgressOverlay
            queue={importQueue.queue}
            onCancel={importQueue.cancelQueue}
            onDismiss={importQueue.dismissQueue}
          />

          {/* Auto Tutorial Modal */}
          {TutorialModalComponent}

          {/* Remove Trip Modal */}
          <RemoveTripModal
            visible={removeTripModalVisible}
            tripNumber={removeTripTarget?.tripNumber ?? undefined}
            onDeleteFromApp={handleConfirmDeleteFromApp}
            onDropTrip={handleConfirmDropTrip}
            onCompanyRemoved={handleConfirmCompanyRemoved}
            onCancel={() => {
              setRemoveTripModalVisible(false);
              setRemoveTripTarget(null);
            }}
          />
        </LinearGradient>
      </View>
    </GestureHandlerRootView>
  );
}
