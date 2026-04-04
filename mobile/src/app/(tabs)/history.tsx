/**
 * Records / Audit Trail Screen
 *
 * Professional audit trail and evidence locker for pay protection.
 * Reframed around pay outcomes and evidence:
 * - Filter by: All / Earnings / Pay Events / Open (Action Needed) / Statements
 * - Clear status on every item: Open / Resolved / Disputed
 * - Visual weight by dollar impact
 * - Evidence detail view with linked trips, notes, attachments, status history
 * - Export/Use as Evidence actions
 */

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FileCheck, AlertCircle, Plane, Scale, FileText, ChevronRight, DollarSign, Trash2, CheckCheck } from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { useAuditTrail, useAuditTrailSummary } from "@/lib/useAuditTrail";
import { useSession } from "@/lib/useSession";
import { useAcknowledgeChange, useAcknowledgeAllChanges, useAcknowledgeRosterChange, useAcknowledgeAllRosterChanges } from "@/lib/useSnapshotData";
import { useDeleteTrip, useDeleteAllTrips, useMarkTripReviewed } from "@/lib/useTripsData";
import { useDeletePayEvent, useDeleteAllPayEvents, useUpdatePayEvent } from "@/lib/usePayEvents";
import { useUpdateLogEvent } from "@/lib/useLogEvents";
import { useQueryClient } from "@tanstack/react-query";
import {
  FilterChips,
  type AuditFilterCategory,
} from "@/components/audit-trail/FilterChips";
import { SearchBar } from "@/components/audit-trail/SearchBar";
import { AuditRecordCard } from "@/components/audit-trail/AuditRecordCard";
import { EvidenceDetailDrawer } from "@/components/audit-trail/EvidenceDetailDrawer";
import type { AuditTrailEntry } from "@/lib/contracts";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import { useResponsive } from "@/lib/responsive";

export default function AuditTrailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { px, contentMaxWidth } = useResponsive();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("records");

  // Filter state - using new category-based filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<AuditFilterCategory>("ALL");
  const [refreshing, setRefreshing] = useState(false);

  // Selected entry for detail drawer
  const [selectedEntry, setSelectedEntry] = useState<AuditTrailEntry | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Fetch data with category-based filtering
  const { data, isLoading } = useAuditTrail({ search: searchQuery || undefined });
  const { summary } = useAuditTrailSummary();
  const acknowledgeChange = useAcknowledgeChange();
  const acknowledgeAllChanges = useAcknowledgeAllChanges();
  const acknowledgeRosterChange = useAcknowledgeRosterChange();
  const acknowledgeAllRosterChanges = useAcknowledgeAllRosterChanges();
  const deleteTrip = useDeleteTrip();
  const deletePayEvent = useDeletePayEvent();
  const deleteAllTrips = useDeleteAllTrips();
  const deleteAllPayEvents = useDeleteAllPayEvents();
  const updateTrip = useMarkTripReviewed();
  const updatePayEvent = useUpdatePayEvent();
  const updateLogEvent = useUpdateLogEvent();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResolvingOrKeeping, setIsResolvingOrKeeping] = useState(false);

  const allEntries = data?.entries ?? [];

  // Filter entries by category
  const filteredEntries = useMemo(() => {
    let entries = allEntries;

    switch (selectedCategory) {
      case "EARNINGS":
        // Show trips and pay events that affect earnings
        entries = entries.filter(
          (e) =>
            e.entryType === "TRIP_IMPORTED" ||
            e.entryType === "TRIP_CONFIRMED" ||
            (e.entryType === "PAY_EVENT" && e.payImpactCents !== null)
        );
        break;
      case "PAY_EVENTS":
        // Show only logged pay events
        entries = entries.filter((e) => e.entryType === "PAY_EVENT");
        break;
      case "TRIP_CHANGES":
        // Show schedule/roster changes that need review
        entries = entries.filter(
          (e) => e.entryType === "DETECTED_CHANGE"
        );
        break;
      case "PAY_SUMMARY":
        // Show statements and exports
        entries = entries.filter(
          (e) => e.entryType === "STATEMENT_UPLOADED" || e.entryType === "EXPORT_GENERATED"
        );
        break;
      default:
        // ALL - show everything
        break;
    }

    return entries;
  }, [allEntries, selectedCategory]);

  // Sort by dollar impact (larger impact = higher priority)
  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      // First, prioritize items needing action
      const aActionNeeded = a.needsReview || a.status === "open" || a.status === "disputed" || a.entryType === "DETECTED_CHANGE";
      const bActionNeeded = b.needsReview || b.status === "open" || b.status === "disputed" || b.entryType === "DETECTED_CHANGE";
      if (aActionNeeded && !bActionNeeded) return -1;
      if (!aActionNeeded && bActionNeeded) return 1;

      // Then by dollar impact (absolute value, larger first)
      const aImpact = Math.abs(a.payImpactCents ?? 0);
      const bImpact = Math.abs(b.payImpactCents ?? 0);
      if (aImpact !== bImpact) return bImpact - aImpact;

      // Finally by timestamp (most recent first)
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [filteredEntries]);

  // Count of trip change log entries (unacknowledged schedule/roster changes only)
  const tripChangeCount = useMemo(() => {
    return allEntries.filter(
      (e) => e.entryType === "DETECTED_CHANGE" && e.needsReview
    ).length;
  }, [allEntries]);

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await queryClient.invalidateQueries({ queryKey: ["trips"] });
    await queryClient.invalidateQueries({ queryKey: ["pay-events"] });
    await queryClient.invalidateQueries({ queryKey: ["snapshots"] });
    await queryClient.invalidateQueries({ queryKey: ["schedule-changes"] });
    setRefreshing(false);
  }, [queryClient]);

  // Entry press handler
  const handleEntryPress = useCallback((entry: AuditTrailEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedEntry(entry);
    setDrawerVisible(true);
  }, []);

  // Navigation handlers
  const handleViewTrip = useCallback((tripId: string) => {
    setDrawerVisible(false);
    router.push({ pathname: "/(tabs)/trips", params: { tripId } });
  }, [router]);

  const handleViewPayEvent = useCallback((eventId: string) => {
    setDrawerVisible(false);
    router.push("/pay-events");
  }, [router]);

  // Handle accepting/acknowledging a change from the audit trail
  const handleAcceptChange = useCallback(async (entry: AuditTrailEntry) => {
    if (entry.entryType === "DETECTED_CHANGE" && entry.scheduleChangeId) {
      try {
        await acknowledgeChange.mutateAsync({ changeId: entry.scheduleChangeId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDrawerVisible(false);
        setSelectedEntry(null);
        await queryClient.invalidateQueries({ queryKey: ["schedule-changes"] });
      } catch (error) {
        console.error("Failed to acknowledge change:", error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [acknowledgeChange, queryClient]);

  // Handle logging a pay event from a detected change
  const handleLogEvent = useCallback((entry: AuditTrailEntry) => {
    setDrawerVisible(false);

    if (entry.entryType === "DETECTED_CHANGE") {
      if (entry.scheduleChangeId) {
        acknowledgeChange.mutate({ changeId: entry.scheduleChangeId });
      }

      router.push({
        pathname: "/pay-events",
        params: {
          prefillType: "SCHEDULE_CHANGE",
          prefillTitle: entry.title || "Schedule Change",
          prefillDate: entry.dateRangeStart || undefined,
          prefillCreditDiff: String(entry.creditMinutes || 0),
          prefillPayDiff: String(entry.payImpactCents || 0),
          prefillDescription: entry.explanation || entry.notes || "",
        },
      });
    } else {
      router.push("/pay-events");
    }
  }, [router, acknowledgeChange]);

  // Handle export/evidence action - navigate to evidence notes screen
  const handleExportEvidence = useCallback((entry: AuditTrailEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDrawerVisible(false);
    router.push({
      pathname: "/evidence-notes",
      params: {
        entryId: entry.id,
        payEventId: entry.payEventId ?? "",
        title: entry.title,
        existingNotes: entry.notes ?? "",
      },
    });
  }, [router]);

  // Handle resolving an open case
  const handleResolve = useCallback(async (entry: AuditTrailEntry) => {
    setIsResolvingOrKeeping(true);
    try {
      const isLogEvent = entry.id.startsWith("log-event-");
      if (isLogEvent && entry.payEventId) {
        // Log-events use "saved" to mean resolved
        await updateLogEvent.mutateAsync({ id: entry.payEventId, status: "saved" });
      } else if (entry.entryType === "PAY_EVENT" && entry.payEventId) {
        await updatePayEvent.mutateAsync({ eventId: entry.payEventId, data: { status: "resolved" } });
      } else if ((entry.entryType === "TRIP_IMPORTED" || entry.entryType === "TRIP_CONFIRMED") && entry.tripIds && entry.tripIds.length > 0) {
        await Promise.all(entry.tripIds.map((id) => updateTrip.mutateAsync(id)));
      } else if (entry.tripId) {
        await updateTrip.mutateAsync(entry.tripId);
      }
      await queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      await queryClient.invalidateQueries({ queryKey: ["log-events"] });
      await queryClient.invalidateQueries({ queryKey: ["trips"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDrawerVisible(false);
      setSelectedEntry(null);
    } catch (error) {
      console.error("Failed to resolve case:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsResolvingOrKeeping(false);
    }
  }, [updatePayEvent, updateLogEvent, updateTrip, queryClient]);

  // Handle keeping a case open (or reopening a resolved one)
  const handleKeepOpen = useCallback(async (entry: AuditTrailEntry) => {
    if (entry.status === "open") {
      // Already open - just close the drawer
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDrawerVisible(false);
      setSelectedEntry(null);
      return;
    }
    const isLogEvent = entry.id.startsWith("log-event-");
    setIsResolvingOrKeeping(true);
    try {
      if (isLogEvent && entry.payEventId) {
        // Log-events use "draft" to mean open/unresolved
        await updateLogEvent.mutateAsync({ id: entry.payEventId, status: "draft" });
      } else if (entry.entryType === "PAY_EVENT" && entry.payEventId) {
        await updatePayEvent.mutateAsync({ eventId: entry.payEventId, data: { status: "open" } });
      }
      await queryClient.invalidateQueries({ queryKey: ["pay-events"] });
      await queryClient.invalidateQueries({ queryKey: ["log-events"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDrawerVisible(false);
      setSelectedEntry(null);
    } catch (error) {
      console.error("Failed to reopen case:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsResolvingOrKeeping(false);
    }
  }, [updatePayEvent, updateLogEvent, queryClient]);

  // Handle deleting an audit trail entry (trip or pay event)
  const handleDeleteEntry = useCallback(async (entry: AuditTrailEntry) => {
    if (entry.entryType === "TRIP_IMPORTED" || entry.entryType === "TRIP_CONFIRMED") {
      // For grouped uploads, delete all trips in the group
      const tripIdsToDelete = entry.tripIds && entry.tripIds.length > 0
        ? entry.tripIds
        : entry.tripId
          ? [entry.tripId]
          : [];

      if (tripIdsToDelete.length === 0) return;

      // Delete all trips in the group
      try {
        await Promise.all(
          tripIdsToDelete.map((tripId) =>
            new Promise<void>((resolve, reject) => {
              deleteTrip.mutate(tripId, {
                onSuccess: () => resolve(),
                onError: (error) => reject(error),
              });
            })
          )
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ["trips"] });
      } catch (error) {
        console.error("Failed to delete trips:", error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } else if (entry.entryType === "PAY_EVENT") {
      // Delete the pay event
      if (entry.payEventId) {
        deletePayEvent.mutate(entry.payEventId, {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            queryClient.invalidateQueries({ queryKey: ["pay-events"] });
          },
          onError: (error) => {
            console.error("Failed to delete pay event:", error);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          },
        });
      }
    } else if (entry.entryType === "DETECTED_CHANGE") {
      // Acknowledge/dismiss the schedule change
      // Check if it's a roster change (entry.id starts with "roster-change-") or schedule change (entry.id starts with "change-")
      const isRosterChange = entry.id.startsWith("roster-change-");

      if (isRosterChange && entry.tripId && entry.scheduleChangeId) {
        // Use roster change API
        acknowledgeRosterChange.mutate(
          { tripId: entry.tripId, changeId: entry.scheduleChangeId },
          {
            onSuccess: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: ["schedule-changes"] });
              queryClient.invalidateQueries({ queryKey: ["roster-changes"] });
            },
            onError: (error) => {
              console.error("Failed to dismiss roster change:", error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            },
          }
        );
      } else if (entry.scheduleChangeId) {
        // Use schedule change API
        acknowledgeChange.mutate(
          { changeId: entry.scheduleChangeId },
          {
            onSuccess: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: ["schedule-changes"] });
            },
            onError: (error) => {
              console.error("Failed to dismiss schedule change:", error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            },
          }
        );
      }
    }
  }, [deleteTrip, deletePayEvent, acknowledgeChange, acknowledgeRosterChange, queryClient]);

  // Handle dismiss all schedule changes
  const handleDismissAll = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Dismiss both schedule changes and roster changes
    const results = await Promise.allSettled([
      acknowledgeAllChanges.mutateAsync(undefined),
      acknowledgeAllRosterChanges.mutateAsync(undefined),
    ]);

    const anySuccess = results.some((r) => r.status === "fulfilled");
    const anyError = results.some((r) => r.status === "rejected");

    if (anySuccess) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (anyError) {
      console.error("Some dismiss operations failed:", results.filter((r) => r.status === "rejected"));
    }
  }, [acknowledgeAllChanges, acknowledgeAllRosterChanges]);

  // Handle delete all records
  const handleDeleteAll = useCallback(() => {
    // Count items by type
    const tripCount = sortedEntries.filter(
      (e) => e.entryType === "TRIP_IMPORTED" || e.entryType === "TRIP_CONFIRMED"
    ).length;
    const payEventCount = sortedEntries.filter((e) => e.entryType === "PAY_EVENT").length;
    const changeCount = sortedEntries.filter((e) => e.entryType === "DETECTED_CHANGE").length;

    if (tripCount === 0 && payEventCount === 0 && changeCount === 0) {
      Alert.alert("Nothing to Delete", "There are no records to delete.");
      return;
    }

    const parts: string[] = [];
    if (tripCount > 0) parts.push(`${tripCount} trip${tripCount !== 1 ? "s" : ""}`);
    if (payEventCount > 0) parts.push(`${payEventCount} pay event${payEventCount !== 1 ? "s" : ""}`);
    if (changeCount > 0) parts.push(`${changeCount} schedule change${changeCount !== 1 ? "s" : ""}`);

    Alert.alert(
      "Delete All Records",
      `This will permanently delete ${parts.join(", ")}. This action cannot be undone.\n\nAre you sure?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

            try {
              const promises: Promise<unknown>[] = [];

              if (tripCount > 0) {
                promises.push(deleteAllTrips.mutateAsync(undefined));
              }
              if (payEventCount > 0) {
                promises.push(deleteAllPayEvents.mutateAsync(undefined));
              }
              if (changeCount > 0) {
                promises.push(acknowledgeAllChanges.mutateAsync(undefined));
                promises.push(acknowledgeAllRosterChanges.mutateAsync(undefined));
              }

              await Promise.allSettled(promises);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error("Failed to delete all:", error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }, [sortedEntries, deleteAllTrips, deleteAllPayEvents, acknowledgeAllChanges, acknowledgeAllRosterChanges]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#f59e0b"
                colors={["#f59e0b"]}
              />
            }
          >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center justify-between mb-2">
              <View className="flex-row items-center">
                <FileCheck size={24} color="#f59e0b" />
                <Text className="text-amber-500 text-base font-semibold ml-2">
                  Audit Trail
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                {sortedEntries.length > 0 && (
                  <Pressable
                    onPress={handleDeleteAll}
                    disabled={isDeleting}
                    className="bg-red-500/20 border border-red-500/30 rounded-lg px-3 py-1.5 flex-row items-center active:opacity-80"
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <>
                        <Trash2 size={14} color="#ef4444" />
                        <Text className="text-red-400 text-xs font-semibold ml-1.5">
                          Delete All
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
                <HelpButton tutorialId="records" size="small" />
              </View>
            </View>
            <Text className="text-white text-3xl font-bold">Records</Text>
            <Text className="text-slate-400 text-base mt-1">
              {sortedEntries.length} record{sortedEntries.length !== 1 ? "s" : ""}
              {tripChangeCount > 0 && (
                <Text className="text-amber-500"> · {tripChangeCount} action needed</Text>
              )}
            </Text>
          </Animated.View>

          {/* Search Bar */}
          <Animated.View entering={FadeInDown.duration(600).delay(150)} className="mt-4">
            <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
          </Animated.View>

          {/* Filter Chips */}
          <Animated.View entering={FadeInDown.duration(600).delay(200)} className="mt-4">
            <FilterChips
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              tripChangeCount={tripChangeCount}
            />
          </Animated.View>

          {/* Loading State */}
          {isLoading && isAuthenticated && (
            <View className="mx-5 mt-8 items-center">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading records...</Text>
            </View>
          )}

          {/* Not Authenticated */}
          {!isAuthenticated && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(250)}
              className="mx-5 mt-8 bg-slate-800/60 rounded-2xl p-6 items-center border border-slate-700/50"
            >
              <Scale size={40} color="#64748b" />
              <Text className="text-white text-lg font-semibold mt-4">
                Sign in to view your records
              </Text>
              <Text className="text-slate-400 text-center mt-2">
                Build your audit trail and evidence locker for pay protection.
              </Text>
              <Pressable
                onPress={() => router.push("/welcome")}
                className="bg-amber-500 rounded-2xl px-6 py-3 mt-4 active:opacity-80"
              >
                <Text className="text-slate-900 font-bold">Get Started</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Content */}
          {isAuthenticated && !isLoading && (
            <>
              {/* Pay Summary Quick Access Card - Shows when PAY_SUMMARY filter is selected */}
              {selectedCategory === "PAY_SUMMARY" && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(250)}
                  className="mx-5 mt-6"
                >
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      router.push("/pay-summary");
                    }}
                    className="active:opacity-90"
                  >
                    <LinearGradient
                      colors={["#065f46", "#047857", "#10b981"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ borderRadius: 16, padding: 16 }}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center flex-1">
                          <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center mr-3">
                            <DollarSign size={24} color="#ffffff" />
                          </View>
                          <View className="flex-1">
                            <Text className="text-white font-bold text-lg">Pay Summary</Text>
                            <Text className="text-emerald-200 text-sm mt-0.5">
                              Auto-generated pay breakdown • View details
                            </Text>
                          </View>
                        </View>
                        <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center">
                          <ChevronRight size={18} color="#ffffff" />
                        </View>
                      </View>
                      <View className="mt-3 pt-3 border-t border-white/20">
                        <Text className="text-emerald-200/80 text-xs">
                          Same data as Tools → Pay Summary. Tap to view full earnings, deductions & net pay.
                        </Text>
                      </View>
                    </LinearGradient>
                  </Pressable>
                </Animated.View>
              )}

              {/* Action Needed Alert */}
              {tripChangeCount > 0 && selectedCategory !== "TRIP_CHANGES" && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(250)}
                  className="mx-5 mt-6"
                >
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setSelectedCategory("TRIP_CHANGES");
                    }}
                    className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/30 flex-row items-center active:bg-amber-500/20"
                  >
                    <View className="w-10 h-10 rounded-xl items-center justify-center bg-amber-500/20 mr-3">
                      <AlertCircle size={20} color="#f59e0b" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-white font-semibold">
                        {tripChangeCount} schedule change{tripChangeCount !== 1 ? "s" : ""} logged
                      </Text>
                      <Text className="text-slate-400 text-sm">
                        Tap to view your trip change log
                      </Text>
                    </View>
                  </Pressable>
                </Animated.View>
              )}

              {/* Dismiss All Button - Shows when viewing Trip Changes */}
              {tripChangeCount > 0 && selectedCategory === "TRIP_CHANGES" && (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(250)}
                  className="mx-5 mt-6"
                >
                  <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <Text className="text-white font-semibold">
                          {tripChangeCount} change{tripChangeCount !== 1 ? "s" : ""} to review
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          Swipe left on items to dismiss individually
                        </Text>
                      </View>
                      <Pressable
                        onPress={handleDismissAll}
                        disabled={acknowledgeAllChanges.isPending || acknowledgeAllRosterChanges.isPending}
                        className="bg-green-500/20 border border-green-500/30 rounded-xl px-4 py-2.5 flex-row items-center active:opacity-80"
                      >
                        {(acknowledgeAllChanges.isPending || acknowledgeAllRosterChanges.isPending) ? (
                          <ActivityIndicator size="small" color="#22c55e" />
                        ) : (
                          <>
                            <CheckCheck size={16} color="#22c55e" />
                            <Text className="text-green-400 font-semibold ml-2">
                              Dismiss All
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                </Animated.View>
              )}

              {/* Records List */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(300)}
                className="mx-5 mt-6 gap-3"
              >
                {sortedEntries.map((entry, index) => (
                  <AuditRecordCard
                    key={entry.id}
                    entry={entry}
                    index={index}
                    onPress={handleEntryPress}
                    onDelete={handleDeleteEntry}
                  />
                ))}

                {sortedEntries.length === 0 && (
                  <View className="bg-slate-900/60 rounded-2xl p-6 items-center border border-slate-700/50">
                    <Plane size={32} color="#64748b" />
                    <Text className="text-slate-400 text-base mt-3">
                      {searchQuery || selectedCategory !== "ALL"
                        ? "No matching records found"
                        : "No records yet"}
                    </Text>
                    <Text className="text-slate-500 text-sm mt-1 text-center">
                      {searchQuery || selectedCategory !== "ALL"
                        ? "Try adjusting your filters"
                        : "Import trips or log pay events to start building your audit trail"}
                    </Text>
                    {!searchQuery && selectedCategory === "ALL" && (
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push("/trips");
                        }}
                        className="mt-4 bg-amber-500 px-4 py-2 rounded-full active:opacity-80"
                      >
                        <Text className="text-slate-900 font-semibold">Import Schedule</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </Animated.View>
            </>
          )}
        </ScrollView>
      </LinearGradient>

      {/* Evidence Detail Drawer */}
      <EvidenceDetailDrawer
        entry={selectedEntry}
        visible={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        onViewTrip={handleViewTrip}
        onViewPayEvent={handleViewPayEvent}
        onLogEvent={handleLogEvent}
        onAcceptChange={handleAcceptChange}
        onExportEvidence={handleExportEvidence}
        onResolve={handleResolve}
        onKeepOpen={handleKeepOpen}
        isAccepting={acknowledgeChange.isPending}
        isResolvingOrKeeping={isResolvingOrKeeping}
      />

      {/* Tutorial Modal */}
      {TutorialModalComponent}
    </View>
    </GestureHandlerRootView>
  );
}
