/**
 * Contract View History Screen
 *
 * Phase 4: Displays passive audit log of contract references viewed.
 * Informational only and visible only to the user.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  History,
  FileText,
  Clock,
  ChevronRight,
  Search,
  Sparkles,
  Link2,
  Hand,
  Info,
} from "lucide-react-native";
import { format, parseISO, isToday, isYesterday, isThisWeek } from "date-fns";

import { useContractViewHistory } from "@/lib/useContracts";
import type { ContractReferenceViewLog, ContractViewSource } from "@/lib/contracts";

// ============================================
// HELPERS
// ============================================

function getViewSourceIcon(source: ContractViewSource) {
  switch (source) {
    case "manual":
      return Hand;
    case "contextual_trigger":
      return Sparkles;
    case "search":
      return Search;
    case "deep_link":
      return Link2;
    default:
      return FileText;
  }
}

function getViewSourceLabel(source: ContractViewSource): string {
  switch (source) {
    case "manual":
      return "Opened manually";
    case "contextual_trigger":
      return "From schedule reference";
    case "search":
      return "From search";
    case "deep_link":
      return "Via direct link";
    default:
      return "Viewed";
  }
}

function formatViewDate(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) {
    return `Today at ${format(date, "h:mm a")}`;
  }
  if (isYesterday(date)) {
    return `Yesterday at ${format(date, "h:mm a")}`;
  }
  if (isThisWeek(date)) {
    return format(date, "EEEE 'at' h:mm a");
  }
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

function groupViewsByDate(views: ContractReferenceViewLog[]): Map<string, ContractReferenceViewLog[]> {
  const groups = new Map<string, ContractReferenceViewLog[]>();

  for (const view of views) {
    const date = parseISO(view.viewedAt);
    let key: string;

    if (isToday(date)) {
      key = "Today";
    } else if (isYesterday(date)) {
      key = "Yesterday";
    } else if (isThisWeek(date)) {
      key = "This Week";
    } else {
      key = format(date, "MMMM yyyy");
    }

    const existing = groups.get(key) ?? [];
    existing.push(view);
    groups.set(key, existing);
  }

  return groups;
}

// ============================================
// VIEW CARD COMPONENT
// ============================================

interface ViewCardProps {
  view: ContractReferenceViewLog;
  onPress: () => void;
}

function ViewCard({ view, onPress }: ViewCardProps) {
  const SourceIcon = getViewSourceIcon(view.viewSource);

  return (
    <Pressable
      onPress={onPress}
      className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50 active:opacity-80"
    >
      <View className="flex-row items-start">
        <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
          <FileText size={20} color="#f59e0b" />
        </View>

        <View className="flex-1 ml-3">
          {/* Reference code */}
          {view.referenceCode && (
            <Text className="text-amber-500 text-sm font-mono mb-0.5">
              {view.referenceCode}
            </Text>
          )}

          {/* Document title placeholder (would need document lookup) */}
          <Text className="text-white font-medium" numberOfLines={1}>
            Contract Reference
          </Text>

          {/* View source and time */}
          <View className="flex-row items-center mt-1.5">
            <SourceIcon size={12} color="#64748b" />
            <Text className="text-slate-500 text-xs ml-1">
              {getViewSourceLabel(view.viewSource)}
            </Text>
            {view.pageNumber && (
              <>
                <Text className="text-slate-600 mx-1">•</Text>
                <Text className="text-slate-500 text-xs">
                  Page {view.pageNumber}
                </Text>
              </>
            )}
          </View>
        </View>

        <View className="items-end">
          <Clock size={12} color="#64748b" />
          <Text className="text-slate-500 text-xs mt-0.5">
            {format(parseISO(view.viewedAt), "h:mm a")}
          </Text>
        </View>
      </View>

      {/* Related entity context */}
      {view.relatedEntityType && (
        <View className="mt-2 pt-2 border-t border-slate-700/30 flex-row items-center">
          <Info size={12} color="#64748b" />
          <Text className="text-slate-500 text-xs ml-1.5">
            Related to: {view.relatedEntityType.replace(/_/g, " ")}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState() {
  return (
    <View className="items-center py-12 px-6">
      <View className="w-20 h-20 rounded-full bg-slate-800/60 items-center justify-center mb-4">
        <History size={40} color="#64748b" />
      </View>
      <Text className="text-white text-xl font-semibold text-center">
        No View History
      </Text>
      <Text className="text-slate-400 text-center mt-2 leading-relaxed">
        Contract references you view will appear here for your records.
      </Text>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ContractViewHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useContractViewHistory(100, 0);

  const views = data?.views ?? [];
  const groupedViews = groupViewsByDate(views);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleViewPress = useCallback(
    (view: ContractReferenceViewLog) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Navigate to contract viewer
      if (view.sectionId) {
        router.push({
          pathname: "/contract-viewer",
          params: {
            id: view.documentId,
            sectionId: view.sectionId,
          },
        });
      } else {
        router.push({
          pathname: "/contract-viewer",
          params: {
            id: view.documentId,
          },
        });
      }
    },
    [router]
  );

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#f59e0b"
            />
          }
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <History size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">
              References Viewed
            </Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              Your contract reference history
            </Text>
          </Animated.View>

          {/* Info Banner */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-4"
          >
            <View className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <View className="flex-row items-start">
                <Info size={18} color="#3b82f6" />
                <Text className="text-blue-300 text-sm flex-1 ml-2 leading-relaxed">
                  This is a passive log of contract references you've viewed.
                  It's informational only and visible only to you.
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Loading State */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading history...</Text>
            </View>
          )}

          {/* Empty State */}
          {!isLoading && views.length === 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <EmptyState />
            </Animated.View>
          )}

          {/* Grouped View History */}
          {!isLoading && views.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              {/* Total count */}
              <Text className="text-slate-400 text-sm font-semibold mb-4 uppercase tracking-wider">
                {views.length} Reference{views.length !== 1 ? "s" : ""} Viewed
              </Text>

              {/* Grouped sections */}
              {Array.from(groupedViews.entries()).map(([dateGroup, groupViews], groupIndex) => (
                <View key={dateGroup} className={groupIndex > 0 ? "mt-6" : ""}>
                  {/* Date header */}
                  <Text className="text-slate-500 text-xs font-semibold mb-2 uppercase tracking-wider">
                    {dateGroup}
                  </Text>

                  {/* View cards */}
                  <View className="gap-2">
                    {groupViews.map((view, index) => (
                      <Animated.View
                        key={view.id}
                        entering={FadeInUp.duration(300).delay(
                          groupIndex * 100 + index * 30
                        )}
                      >
                        <ViewCard
                          view={view}
                          onPress={() => handleViewPress(view)}
                        />
                      </Animated.View>
                    ))}
                  </View>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Footer Disclaimer */}
          {views.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(400)}
              className="mx-5 mt-6"
            >
              <View className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
                <Text className="text-slate-500 text-xs text-center">
                  This history is stored locally for your personal reference.
                  No data is shared with your employer or union.
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
