/**
 * AuditRecordCard - Individual record card in the audit trail
 *
 * Features:
 * - Clear status display (Open / Resolved / Disputed) with color + text
 * - Visual weight by dollar impact (larger impact = higher visual priority)
 * - De-emphasizes Trip Imported records relative to Pay Events
 * - Swipe-to-delete gesture support
 */

import { View, Text, Pressable, Alert } from "react-native";
import {
  Plane,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  FileText,
  Download,
  ChevronRight,
  Paperclip,
  Clock,
  CircleDot,
  AlertOctagon,
  Trash2,
  Layers,
} from "lucide-react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Swipeable } from "react-native-gesture-handler";
import { useRef } from "react";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";
import { webSafeExit } from '@/lib/webSafeAnimation';
import type { AuditTrailEntry, AuditRecordStatus } from "@/lib/contracts";
import {
  getEntryTypeDisplay,
  formatMinutesDisplay,
  formatCentsDisplay,
} from "@/lib/useAuditTrail";

interface AuditRecordCardProps {
  entry: AuditTrailEntry;
  index: number;
  onPress: (entry: AuditTrailEntry) => void;
  onDelete?: (entry: AuditTrailEntry) => void;
}

// Icon mapping
const IconMap: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Plane,
  CheckCircle,
  AlertTriangle,
  DollarSign,
  FileText,
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

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Status badge configuration
function getStatusConfig(status: AuditRecordStatus | null) {
  switch (status) {
    case "open":
      return {
        label: "Open",
        color: "text-amber-400",
        bgColor: "bg-amber-500/20",
        borderColor: "border-amber-500/30",
        icon: Clock,
        iconColor: "#f59e0b",
      };
    case "disputed":
      return {
        label: "Disputed",
        color: "text-red-400",
        bgColor: "bg-red-500/20",
        borderColor: "border-red-500/30",
        icon: AlertOctagon,
        iconColor: "#ef4444",
      };
    case "resolved":
      return {
        label: "Resolved",
        color: "text-green-400",
        bgColor: "bg-green-500/20",
        borderColor: "border-green-500/30",
        icon: CheckCircle,
        iconColor: "#22c55e",
      };
    default:
      return null;
  }
}

// Calculate visual weight based on dollar impact
function getImpactWeight(payImpactCents: number | null): "high" | "medium" | "low" {
  if (!payImpactCents) return "low";
  const absImpact = Math.abs(payImpactCents);
  if (absImpact >= 10000) return "high"; // $100+
  if (absImpact >= 2500) return "medium"; // $25+
  return "low";
}

export function AuditRecordCard({ entry, index, onPress, onDelete }: AuditRecordCardProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const display = getEntryTypeDisplay(entry.entryType);
  const Icon = IconMap[display.icon] || FileText;
  const statusConfig = getStatusConfig(entry.status);
  const impactWeight = getImpactWeight(entry.payImpactCents);

  // De-emphasize trip imports relative to pay events
  const isDeemphasized = entry.entryType === "TRIP_IMPORTED" && entry.status === "resolved";

  // Check if this entry type can be deleted
  const canDelete = entry.entryType === "TRIP_IMPORTED" ||
                    entry.entryType === "TRIP_CONFIRMED" ||
                    entry.entryType === "PAY_EVENT" ||
                    entry.entryType === "DETECTED_CHANGE";

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(entry);
  };

  const handleDelete = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Determine the label and count for trips
    const tripCount = entry.tripCount ?? 1;
    const isTripUpload = entry.entryType === "TRIP_IMPORTED" || entry.entryType === "TRIP_CONFIRMED";

    const typeLabel = entry.entryType === "PAY_EVENT"
      ? "pay event"
      : entry.entryType === "DETECTED_CHANGE"
        ? "schedule change"
        : tripCount > 1
          ? `${tripCount} trips`
          : "trip record";
    const actionLabel = entry.entryType === "DETECTED_CHANGE" ? "Dismiss" : "Delete";

    const message = entry.entryType === "DETECTED_CHANGE"
      ? `Are you sure you want to dismiss this schedule change?`
      : isTripUpload && tripCount > 1
        ? `This will delete all ${tripCount} trips from this upload. This cannot be undone.`
        : `Are you sure you want to delete this ${typeLabel}? This cannot be undone.`;

    Alert.alert(
      `${actionLabel} Record`,
      message,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            swipeableRef.current?.close();
          },
        },
        {
          text: actionLabel,
          style: "destructive",
          onPress: () => onDelete?.(entry),
        },
      ]
    );
  };

  // Determine card styling based on status and type
  const getCardStyle = () => {
    if (entry.entryType === "DETECTED_CHANGE" || entry.status === "disputed") {
      return "bg-amber-500/10 border-amber-500/30";
    }
    if (entry.status === "open" && entry.entryType === "PAY_EVENT") {
      return "bg-slate-800/80 border-amber-500/40";
    }
    if (isDeemphasized) {
      return "bg-slate-900/40 border-slate-700/30";
    }
    return "bg-slate-800/60 border-slate-700/50";
  };

  // Determine icon size based on impact weight
  const getIconSize = () => {
    if (impactWeight === "high") return { container: "w-12 h-12", icon: 24 };
    if (impactWeight === "medium") return { container: "w-10 h-10", icon: 20 };
    return { container: "w-10 h-10", icon: 20 };
  };

  const iconSize = getIconSize();

  const renderRightActions = () => {
    const isScheduleChange = entry.entryType === "DETECTED_CHANGE";
    return (
      <Pressable
        onPress={handleDelete}
        className={`${isScheduleChange ? "bg-green-500" : "bg-red-500"} rounded-2xl ml-2 justify-center items-center px-6`}
      >
        {isScheduleChange ? (
          <CheckCircle size={22} color="#fff" />
        ) : (
          <Trash2 size={22} color="#fff" />
        )}
        <Text className="text-white text-xs font-semibold mt-1">
          {isScheduleChange ? "Dismiss" : "Delete"}
        </Text>
      </Pressable>
    );
  };

  const cardContent = (
    <Pressable
      onPress={handlePress}
      className={cn(
        "rounded-2xl p-4 border active:opacity-80",
        getCardStyle(),
        isDeemphasized && "opacity-70"
      )}
    >
      <View className="flex-row items-start">
        {/* Icon */}
        <View
          className={cn(
            "rounded-xl items-center justify-center mr-3",
            iconSize.container,
            display.bgColor,
            impactWeight === "high" && "ring-2 ring-amber-500/30"
          )}
        >
          <Icon size={iconSize.icon} color={display.color} />
        </View>

        {/* Content */}
        <View className="flex-1">
          {/* Header Row */}
          <View className="flex-row items-center justify-between mb-1">
            <Text
              className={cn(
                "text-base font-semibold flex-1",
                isDeemphasized ? "text-slate-400" : "text-white"
              )}
              numberOfLines={1}
            >
              {entry.title}
            </Text>
            <Text className="text-slate-500 text-xs ml-2">{formatTimestamp(entry.timestamp)}</Text>
          </View>

          {/* Subtitle */}
          {entry.subtitle && (
            <Text
              className={cn("text-sm mb-2", isDeemphasized ? "text-slate-500" : "text-slate-400")}
              numberOfLines={1}
            >
              {entry.subtitle}
            </Text>
          )}

          {/* Route/Date info */}
          {(entry.routeSummary || entry.dateRangeStart) && (
            <Text className="text-slate-500 text-xs mb-2" numberOfLines={1}>
              {entry.routeSummary}
              {entry.routeSummary && entry.dateRangeStart && " · "}
              {entry.dateRangeStart && formatDateShort(entry.dateRangeStart)}
              {entry.dateRangeEnd && entry.dateRangeEnd !== entry.dateRangeStart && ` - ${formatDateShort(entry.dateRangeEnd)}`}
            </Text>
          )}

          {/* Badges Row */}
          <View className="flex-row flex-wrap gap-2 mt-1">
            {/* Status Badge - Most prominent */}
            {statusConfig && (
              <View className={cn("flex-row items-center px-2 py-1 rounded-lg", statusConfig.bgColor)}>
                <statusConfig.icon size={12} color={statusConfig.iconColor} />
                <Text className={cn("text-xs font-semibold ml-1", statusConfig.color)}>
                  {statusConfig.label}
                </Text>
              </View>
            )}

            {/* Pay Impact Badge - Visual weight for larger impacts */}
            {entry.payImpactCents != null && entry.payImpactCents !== 0 && (
              <View
                className={cn(
                  "px-2 py-1 rounded-lg",
                  entry.payImpactCents > 0 ? "bg-green-500/20" : "bg-red-500/20",
                  impactWeight === "high" && "ring-1 ring-green-500/30"
                )}
              >
                <Text
                  className={cn(
                    "font-bold",
                    entry.payImpactCents > 0 ? "text-green-400" : "text-red-400",
                    impactWeight === "high" ? "text-sm" : "text-xs"
                  )}
                >
                  {formatCentsDisplay(entry.payImpactCents)}
                </Text>
              </View>
            )}

            {/* Credit Badge */}
            {entry.creditMinutes != null && entry.creditMinutes !== 0 && (
              <View className="bg-slate-700/50 px-2 py-1 rounded-lg">
                <Text className="text-slate-300 text-xs font-medium">
                  {formatMinutesDisplay(entry.creditMinutes)}
                </Text>
              </View>
            )}

            {/* Needs Review Badge */}
            {entry.needsReview && !statusConfig && (
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

            {/* Trip Count Badge for grouped uploads */}
            {entry.tripCount != null && entry.tripCount > 1 && (
              <View className="flex-row items-center bg-blue-500/20 px-2 py-1 rounded-lg">
                <Layers size={10} color="#3b82f6" />
                <Text className="text-blue-400 text-xs font-medium ml-1">{entry.tripCount} trips</Text>
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
  );

  // If delete is not supported for this entry type, render without swipeable
  if (!onDelete || !canDelete) {
    return (
      <Animated.View entering={FadeIn.duration(300).delay(index * 30)} exiting={webSafeExit(FadeOut.duration(200))}>
        {cardContent}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(300).delay(index * 30)} exiting={webSafeExit(FadeOut.duration(200))}>
      <Swipeable
        ref={swipeableRef}
        renderRightActions={renderRightActions}
        rightThreshold={40}
        overshootRight={false}
        friction={2}
        onSwipeableOpen={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        {cardContent}
      </Swipeable>
    </Animated.View>
  );
}
