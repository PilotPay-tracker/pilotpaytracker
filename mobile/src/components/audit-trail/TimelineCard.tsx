/**
 * TimelineCard - Individual card in the audit trail timeline
 * Renders different card types based on entry type
 */

import { View, Text, Pressable } from "react-native";
import {
  Plane,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  FileText,
  Settings,
  Lightbulb,
  Download,
  ChevronRight,
  Paperclip,
  BookOpen,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { cn } from "@/lib/cn";
import type { AuditTrailEntry, AuditTrailEntryType, AuditConfidenceLevel } from "@/lib/contracts";
import {
  getEntryTypeDisplay,
  formatConfidence,
  formatMinutesDisplay,
  formatCentsDisplay,
} from "@/lib/useAuditTrail";

interface TimelineCardProps {
  entry: AuditTrailEntry;
  index: number;
  onPress: (entry: AuditTrailEntry) => void;
}

// Icon mapping
const IconMap: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Plane,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  FileText,
  Settings,
  Lightbulb,
  Download,
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

export function TimelineCard({ entry, index, onPress }: TimelineCardProps) {
  const display = getEntryTypeDisplay(entry.entryType);
  const Icon = IconMap[display.icon] || FileText;
  const confidenceDisplay = formatConfidence(entry.confidence);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(entry);
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
      <Pressable
        onPress={handlePress}
        className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 active:bg-slate-800/80"
      >
        <View className="flex-row items-start">
          {/* Icon */}
          <View
            className={cn("w-10 h-10 rounded-xl items-center justify-center mr-3", display.bgColor)}
          >
            <Icon size={20} color={display.color} />
          </View>

          {/* Content */}
          <View className="flex-1">
            {/* Header Row */}
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-white text-base font-semibold flex-1" numberOfLines={1}>
                {entry.title}
              </Text>
              <Text className="text-slate-500 text-xs ml-2">{formatTimestamp(entry.timestamp)}</Text>
            </View>

            {/* Subtitle */}
            {entry.subtitle && (
              <Text className="text-slate-400 text-sm mb-2" numberOfLines={1}>
                {entry.subtitle}
              </Text>
            )}

            {/* Route/Date info */}
            {(entry.routeSummary || entry.dateRangeStart) && (
              <Text className="text-slate-500 text-xs mb-2" numberOfLines={1}>
                {entry.routeSummary}
                {entry.routeSummary && entry.dateRangeStart && " • "}
                {entry.dateRangeStart && formatDateShort(entry.dateRangeStart)}
                {entry.dateRangeEnd && entry.dateRangeEnd !== entry.dateRangeStart && ` - ${formatDateShort(entry.dateRangeEnd)}`}
              </Text>
            )}

            {/* Badges Row */}
            <View className="flex-row flex-wrap gap-2 mt-1">
              {/* Credit Badge */}
              {entry.creditMinutes != null && entry.creditMinutes !== 0 && (
                <View className="bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Text className="text-slate-300 text-xs font-medium">
                    {formatMinutesDisplay(entry.creditMinutes)}
                  </Text>
                </View>
              )}

              {/* Pay Impact Badge */}
              {entry.payImpactCents != null && entry.payImpactCents !== 0 && (
                <View className={cn("px-2 py-1 rounded-lg", entry.payImpactCents > 0 ? "bg-green-500/20" : "bg-red-500/20")}>
                  <Text
                    className={cn("text-xs font-medium", entry.payImpactCents > 0 ? "text-green-400" : "text-red-400")}
                  >
                    {formatCentsDisplay(entry.payImpactCents)}
                  </Text>
                </View>
              )}

              {/* Confidence Badge */}
              {entry.confidence && (
                <View className={cn("px-2 py-1 rounded-lg", confidenceDisplay.bgColor)}>
                  <Text className={cn("text-xs font-medium", confidenceDisplay.color)}>
                    {confidenceDisplay.label}
                  </Text>
                </View>
              )}

              {/* Needs Review Badge */}
              {entry.needsReview && (
                <View className="bg-amber-500/20 px-2 py-1 rounded-lg">
                  <Text className="text-amber-400 text-xs font-medium">Needs Review</Text>
                </View>
              )}

              {/* Attachment Count */}
              {entry.attachmentCount > 0 && (
                <View className="flex-row items-center bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Paperclip size={10} color="#94a3b8" />
                  <Text className="text-slate-400 text-xs ml-1">{entry.attachmentCount}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Chevron */}
          <View className="ml-2 justify-center">
            <ChevronRight size={16} color="#64748b" />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Specialized card variants for specific entry types
export function TripCard({ entry, index, onPress }: TimelineCardProps) {
  return <TimelineCard entry={entry} index={index} onPress={onPress} />;
}

export function DetectedChangeCard({ entry, index, onPress }: TimelineCardProps) {
  const router = useRouter();

  const handleReview = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress(entry);
  };

  const handleViewPayCodes = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Map change type to category
    const categoryMap: Record<string, string> = {
      TRIP_ADDED: "REASSIGNMENT",
      TRIP_REMOVED: "PROTECTION",
      LEG_ADDED: "REASSIGNMENT",
      LEG_REMOVED: "PROTECTION",
      TIME_CHANGE: "PREMIUM",
      DH_CHANGE: "DEADHEAD",
      CREDIT_CHANGE: "GUARANTEE",
    };
    const category = categoryMap[entry.subtitle ?? ""] ?? "PROTECTION";
    router.push(`/pay-code-library?category=${category}`);
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
      <Pressable
        onPress={handleReview}
        className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/30 active:bg-amber-500/20"
      >
        <View className="flex-row items-start">
          <View className="w-10 h-10 rounded-xl items-center justify-center mr-3 bg-amber-500/20">
            <AlertTriangle size={20} color="#f59e0b" />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-white text-base font-semibold">{entry.title}</Text>
              <Text className="text-amber-400 text-xs">Needs Review</Text>
            </View>

            {entry.subtitle && (
              <Text className="text-slate-400 text-sm mb-2">{entry.subtitle}</Text>
            )}

            {entry.explanation && (
              <Text className="text-slate-500 text-xs mb-2">{entry.explanation}</Text>
            )}

            <View className="flex-row gap-2 mt-1">
              {entry.creditMinutes != null && (
                <View className="bg-slate-700/50 px-2 py-1 rounded-lg">
                  <Text className="text-slate-300 text-xs">{formatMinutesDisplay(entry.creditMinutes)}</Text>
                </View>
              )}
              {entry.payImpactCents != null && (
                <View className={cn("px-2 py-1 rounded-lg", entry.payImpactCents > 0 ? "bg-green-500/20" : "bg-red-500/20")}>
                  <Text className={cn("text-xs", entry.payImpactCents > 0 ? "text-green-400" : "text-red-400")}>
                    {formatCentsDisplay(entry.payImpactCents)}
                  </Text>
                </View>
              )}
            </View>

            {/* Action Buttons */}
            <View className="flex-row gap-2 mt-3">
              <Pressable
                onPress={handleReview}
                className="bg-amber-500 rounded-xl px-4 py-2 active:opacity-80"
              >
                <Text className="text-slate-900 text-sm font-semibold">Review & Classify</Text>
              </Pressable>
              <Pressable
                onPress={handleViewPayCodes}
                className="bg-slate-700/50 rounded-xl px-3 py-2 flex-row items-center active:opacity-70"
              >
                <BookOpen size={14} color="#f59e0b" />
                <Text className="text-amber-500/80 text-xs ml-1">Pay Codes</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function PayEventCard({ entry, index, onPress }: TimelineCardProps) {
  return <TimelineCard entry={entry} index={index} onPress={onPress} />;
}

export function StatementCard({ entry, index, onPress }: TimelineCardProps) {
  const confidenceDisplay = formatConfidence(entry.confidence);
  const isReconciled = entry.suggestionStatus === "accepted";

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress(entry);
        }}
        className="bg-purple-500/10 rounded-2xl p-4 border border-purple-500/30 active:bg-purple-500/20"
      >
        <View className="flex-row items-start">
          <View className="w-10 h-10 rounded-xl items-center justify-center mr-3 bg-purple-500/20">
            <FileText size={20} color="#8b5cf6" />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-white text-base font-semibold">{entry.title}</Text>
              {entry.confidence && (
                <View className={cn("px-2 py-1 rounded-lg", confidenceDisplay.bgColor)}>
                  <Text className={cn("text-xs", confidenceDisplay.color)}>{confidenceDisplay.label}</Text>
                </View>
              )}
            </View>

            {entry.subtitle && (
              <Text className="text-slate-400 text-sm mb-2">{entry.subtitle}</Text>
            )}

            {entry.routeSummary && (
              <Text className="text-slate-500 text-xs mb-2">{entry.routeSummary}</Text>
            )}

            {isReconciled && (
              <View className="flex-row items-center mt-2 bg-green-500/20 px-2 py-1 rounded-lg self-start">
                <CheckCircle size={12} color="#22c55e" />
                <Text className="text-green-400 text-xs ml-1">Reconciliation complete</Text>
              </View>
            )}

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPress(entry);
              }}
              className="mt-3 flex-row items-center"
            >
              <Text className="text-purple-400 text-sm font-medium">
                {isReconciled ? "View Actual vs Projected" : "View Statement"}
              </Text>
              <ChevronRight size={14} color="#a855f7" />
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function ExportCard({ entry, index, onPress }: TimelineCardProps) {
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress(entry);
        }}
        className="bg-pink-500/10 rounded-2xl p-4 border border-pink-500/30 active:bg-pink-500/20"
      >
        <View className="flex-row items-start">
          <View className="w-10 h-10 rounded-xl items-center justify-center mr-3 bg-pink-500/20">
            <Download size={20} color="#ec4899" />
          </View>

          <View className="flex-1">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-white text-base font-semibold">{entry.title}</Text>
              <Text className="text-slate-500 text-xs">{formatTimestamp(entry.timestamp)}</Text>
            </View>

            {entry.subtitle && (
              <Text className="text-slate-400 text-sm mb-2">{entry.subtitle}</Text>
            )}

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onPress(entry);
              }}
              className="mt-2 flex-row items-center bg-pink-500 rounded-xl px-4 py-2 self-start active:opacity-80"
            >
              <Download size={14} color="#0f172a" />
              <Text className="text-slate-900 text-sm font-semibold ml-2">Download</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Factory function to render the appropriate card type
export function renderTimelineCard(entry: AuditTrailEntry, index: number, onPress: (entry: AuditTrailEntry) => void) {
  switch (entry.entryType) {
    case "DETECTED_CHANGE":
      return <DetectedChangeCard key={entry.id} entry={entry} index={index} onPress={onPress} />;
    case "STATEMENT_UPLOADED":
      return <StatementCard key={entry.id} entry={entry} index={index} onPress={onPress} />;
    case "EXPORT_GENERATED":
      return <ExportCard key={entry.id} entry={entry} index={index} onPress={onPress} />;
    default:
      return <TimelineCard key={entry.id} entry={entry} index={index} onPress={onPress} />;
  }
}
