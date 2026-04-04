/**
 * EntryDetailDrawer - Bottom sheet showing full details of an audit trail entry
 */

import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  X,
  Clock,
  Calendar,
  DollarSign,
  Plane,
  FileText,
  Paperclip,
  ChevronRight,
  Download,
  Plus,
  AlertTriangle,
  CheckCircle,
} from "lucide-react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";
import type { AuditTrailEntry } from "@/lib/contracts";
import {
  getEntryTypeDisplay,
  formatConfidence,
  formatMinutesDisplay,
  formatCentsDisplay,
} from "@/lib/useAuditTrail";

interface EntryDetailDrawerProps {
  entry: AuditTrailEntry | null;
  visible: boolean;
  onClose: () => void;
  onViewTrip?: (tripId: string) => void;
  onViewPayEvent?: (eventId: string) => void;
  onAddProof?: (entry: AuditTrailEntry) => void;
  onExport?: (entry: AuditTrailEntry) => void;
  onLogEvent?: (entry: AuditTrailEntry) => void;
  onAcceptChange?: (entry: AuditTrailEntry) => void;
  isAccepting?: boolean;
}

function formatFullTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return "";
  const startDate = new Date(start + "T12:00:00");
  const startStr = startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!end || end === start) return startStr;
  const endDate = new Date(end + "T12:00:00");
  const endStr = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} - ${endStr}`;
}

export function EntryDetailDrawer({
  entry,
  visible,
  onClose,
  onViewTrip,
  onViewPayEvent,
  onAddProof,
  onExport,
  onLogEvent,
  onAcceptChange,
  isAccepting,
}: EntryDetailDrawerProps) {
  const insets = useSafeAreaInsets();

  if (!entry) return null;

  const display = getEntryTypeDisplay(entry.entryType);
  const confidenceDisplay = formatConfidence(entry.confidence);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View entering={FadeIn.duration(200)} className="flex-1 bg-black/60">
        <Pressable className="flex-1" onPress={handleClose} />

        <Animated.View
          entering={SlideInDown.duration(300)}
          className="bg-slate-900 rounded-t-3xl max-h-[85%]"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Handle */}
          <View className="items-center pt-3 pb-4">
            <View className="w-10 h-1 bg-slate-700 rounded-full" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pb-4 border-b border-slate-800">
            <View className="flex-row items-center flex-1">
              <View className={cn("w-12 h-12 rounded-xl items-center justify-center mr-3", display.bgColor)}>
                {entry.entryType === "DETECTED_CHANGE" && <AlertTriangle size={24} color={display.color} />}
                {entry.entryType === "PAY_EVENT" && <DollarSign size={24} color={display.color} />}
                {entry.entryType === "TRIP_IMPORTED" && <Plane size={24} color={display.color} />}
                {entry.entryType === "TRIP_CONFIRMED" && <CheckCircle size={24} color={display.color} />}
                {entry.entryType === "STATEMENT_UPLOADED" && <FileText size={24} color={display.color} />}
                {entry.entryType === "EXPORT_GENERATED" && <Download size={24} color={display.color} />}
                {!["DETECTED_CHANGE", "PAY_EVENT", "TRIP_IMPORTED", "TRIP_CONFIRMED", "STATEMENT_UPLOADED", "EXPORT_GENERATED"].includes(entry.entryType) && (
                  <FileText size={24} color={display.color} />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-white text-lg font-bold" numberOfLines={2}>
                  {entry.title}
                </Text>
                <Text className="text-slate-400 text-sm">{display.label}</Text>
              </View>
            </View>
            <Pressable onPress={handleClose} className="p-2 -mr-2 active:opacity-50">
              <X size={24} color="#64748b" />
            </Pressable>
          </View>

          <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
            {/* Timestamp */}
            <View className="flex-row items-center py-4 border-b border-slate-800">
              <Clock size={16} color="#64748b" />
              <Text className="text-slate-400 text-sm ml-2">{formatFullTimestamp(entry.timestamp)}</Text>
            </View>

            {/* Linked Pay Period / Trip */}
            {(entry.tripId || entry.payEventId || entry.dateRangeStart) && (
              <View className="py-4 border-b border-slate-800">
                {entry.dateRangeStart && (
                  <View className="flex-row items-center mb-2">
                    <Calendar size={16} color="#64748b" />
                    <Text className="text-slate-400 text-sm ml-2">
                      {formatDateRange(entry.dateRangeStart, entry.dateRangeEnd)}
                    </Text>
                  </View>
                )}
                {entry.routeSummary && (
                  <View className="flex-row items-center">
                    <Plane size={16} color="#64748b" />
                    <Text className="text-slate-400 text-sm ml-2">{entry.routeSummary}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Pay Impact Section */}
            {(entry.creditMinutes != null || entry.payImpactCents != null) && (
              <View className="py-4 border-b border-slate-800">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-3">Pay Impact</Text>
                <View className="flex-row gap-4">
                  {entry.creditMinutes != null && (
                    <View className="flex-1 bg-slate-800/50 rounded-xl p-3">
                      <Text className="text-slate-400 text-xs mb-1">Credit</Text>
                      <Text className="text-white text-lg font-bold">{formatMinutesDisplay(entry.creditMinutes)}</Text>
                    </View>
                  )}
                  {entry.payImpactCents != null && (
                    <View className="flex-1 bg-slate-800/50 rounded-xl p-3">
                      <Text className="text-slate-400 text-xs mb-1">Est. Pay</Text>
                      <Text
                        className={cn(
                          "text-lg font-bold",
                          entry.payImpactCents >= 0 ? "text-green-400" : "text-red-400"
                        )}
                      >
                        {formatCentsDisplay(entry.payImpactCents)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Confidence */}
            {entry.confidence && (
              <View className="py-4 border-b border-slate-800">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">Confidence</Text>
                <View className={cn("px-3 py-2 rounded-lg self-start", confidenceDisplay.bgColor)}>
                  <Text className={cn("text-sm font-medium", confidenceDisplay.color)}>{confidenceDisplay.label}</Text>
                </View>
              </View>
            )}

            {/* Explanation */}
            {entry.explanation && (
              <View className="py-4 border-b border-slate-800">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">What Changed</Text>
                <View className="bg-slate-800/50 rounded-xl p-3">
                  <Text className="text-slate-300 text-sm">{entry.explanation}</Text>
                </View>
              </View>
            )}

            {/* Notes */}
            {entry.notes && (
              <View className="py-4 border-b border-slate-800">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">Notes</Text>
                <Text className="text-slate-300 text-sm">{entry.notes}</Text>
              </View>
            )}

            {/* Attachments */}
            {entry.attachmentCount > 0 && (
              <View className="py-4 border-b border-slate-800">
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">Attachments</Text>
                <View className="flex-row items-center bg-slate-800/50 rounded-xl p-3">
                  <Paperclip size={16} color="#64748b" />
                  <Text className="text-slate-300 text-sm ml-2">{entry.attachmentCount} attachment(s)</Text>
                  <ChevronRight size={16} color="#64748b" className="ml-auto" />
                </View>
              </View>
            )}

            {/* Actions */}
            <View className="py-6 gap-3">
              {/* Accept Change (for detected changes that need review) */}
              {entry.entryType === "DETECTED_CHANGE" && entry.needsReview && onAcceptChange && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onAcceptChange(entry);
                  }}
                  disabled={isAccepting}
                  className="flex-row items-center justify-center bg-green-500 rounded-xl py-3.5 active:opacity-80"
                >
                  {isAccepting ? (
                    <ActivityIndicator size="small" color="#0f172a" />
                  ) : (
                    <>
                      <CheckCircle size={18} color="#0f172a" />
                      <Text className="text-slate-900 font-bold ml-2">Accept Change</Text>
                    </>
                  )}
                </Pressable>
              )}

              {/* Log Event (for detected changes) */}
              {entry.entryType === "DETECTED_CHANGE" && entry.needsReview && onLogEvent && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onLogEvent(entry);
                  }}
                  className="flex-row items-center justify-center bg-amber-500 rounded-xl py-3 active:opacity-80"
                >
                  <Plus size={18} color="#0f172a" />
                  <Text className="text-slate-900 font-bold ml-2">Log Pay Event</Text>
                </Pressable>
              )}

              {/* View Trip */}
              {entry.tripId && onViewTrip && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onViewTrip(entry.tripId!);
                    onClose();
                  }}
                  className="flex-row items-center justify-center bg-slate-800 rounded-xl py-3 active:opacity-80"
                >
                  <Plane size={18} color="#f59e0b" />
                  <Text className="text-white font-semibold ml-2">View Trip</Text>
                </Pressable>
              )}

              {/* View Pay Event */}
              {entry.payEventId && onViewPayEvent && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onViewPayEvent(entry.payEventId!);
                    onClose();
                  }}
                  className="flex-row items-center justify-center bg-slate-800 rounded-xl py-3 active:opacity-80"
                >
                  <DollarSign size={18} color="#22c55e" />
                  <Text className="text-white font-semibold ml-2">View Pay Event</Text>
                </Pressable>
              )}

              {/* Add Proof */}
              {onAddProof && entry.entryType !== "EXPORT_GENERATED" && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onAddProof(entry);
                  }}
                  className="flex-row items-center justify-center bg-slate-800 rounded-xl py-3 active:opacity-80"
                >
                  <Plus size={18} color="#3b82f6" />
                  <Text className="text-white font-semibold ml-2">Add Proof</Text>
                </Pressable>
              )}

              {/* Export */}
              {onExport && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onExport(entry);
                  }}
                  className="flex-row items-center justify-center bg-slate-800 rounded-xl py-3 active:opacity-80"
                >
                  <Download size={18} color="#ec4899" />
                  <Text className="text-white font-semibold ml-2">Export</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
