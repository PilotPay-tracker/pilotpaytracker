/**
 * EvidenceDetailDrawer - Bottom sheet showing full details of an audit record
 *
 * Features:
 * - Detailed evidence view with linked trips, notes, attachments, status history
 * - Export / Use as Evidence action for Pay Events and Disputed records
 * - Status management (Open / Resolved / Disputed)
 */

import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  X,
  Clock,
  Calendar,
  Plane,
  FileText,
  Paperclip,
  ChevronRight,
  Download,
  AlertTriangle,
  CheckCircle,
  AlertOctagon,
  Plus,
  FileCheck,
} from "lucide-react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { cn } from "@/lib/cn";
import type { AuditTrailEntry, AuditRecordStatus } from "@/lib/contracts";
import {
  getEntryTypeDisplay,
  formatMinutesDisplay,
  formatCentsDisplay,
} from "@/lib/useAuditTrail";

interface EvidenceDetailDrawerProps {
  entry: AuditTrailEntry | null;
  visible: boolean;
  onClose: () => void;
  onViewTrip?: (tripId: string) => void;
  onViewPayEvent?: (eventId: string) => void;
  onAddProof?: (entry: AuditTrailEntry) => void;
  onExportEvidence?: (entry: AuditTrailEntry) => void;
  onLogEvent?: (entry: AuditTrailEntry) => void;
  onAcceptChange?: (entry: AuditTrailEntry) => void;
  onResolve?: (entry: AuditTrailEntry) => void;
  onKeepOpen?: (entry: AuditTrailEntry) => void;
  isAccepting?: boolean;
  isResolvingOrKeeping?: boolean;
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

// Status configuration
function getStatusConfig(status: AuditRecordStatus | null) {
  switch (status) {
    case "open":
      return {
        label: "Open",
        description: "This record requires attention or verification",
        color: "text-amber-400",
        bgColor: "bg-amber-500/20",
        borderColor: "border-amber-500/30",
        icon: Clock,
        iconColor: "#f59e0b",
      };
    case "disputed":
      return {
        label: "Disputed",
        description: "This record is being contested or under review",
        color: "text-red-400",
        bgColor: "bg-red-500/20",
        borderColor: "border-red-500/30",
        icon: AlertOctagon,
        iconColor: "#ef4444",
      };
    case "resolved":
      return {
        label: "Resolved",
        description: "This record has been verified and closed",
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

export function EvidenceDetailDrawer({
  entry,
  visible,
  onClose,
  onViewTrip,
  onViewPayEvent,
  onAddProof,
  onExportEvidence,
  onLogEvent,
  onAcceptChange,
  onResolve,
  onKeepOpen,
  isAccepting,
  isResolvingOrKeeping,
}: EvidenceDetailDrawerProps) {
  const insets = useSafeAreaInsets();

  if (!entry) return null;

  const display = getEntryTypeDisplay(entry.entryType);
  const statusConfig = getStatusConfig(entry.status);

  // Determine if export/evidence action should be shown
  const showExportEvidence =
    entry.entryType === "PAY_EVENT" ||
    entry.status === "disputed" ||
    entry.status === "open";

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View entering={FadeIn.duration(200)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={handleClose} />

        <Animated.View
          entering={SlideInDown.duration(300)}
          className="bg-slate-900 rounded-t-3xl"
          style={{ paddingBottom: insets.bottom + 16, maxHeight: '88%' }}
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
                {entry.entryType === "PAY_EVENT" && <FileCheck size={24} color={display.color} />}
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

          <ScrollView className="px-5" style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            {/* Status Section - Prominent display */}
            {statusConfig && (
              <View className={cn("my-4 p-4 rounded-xl border", statusConfig.bgColor, statusConfig.borderColor)}>
                <View className="flex-row items-center mb-2">
                  <statusConfig.icon size={20} color={statusConfig.iconColor} />
                  <Text className={cn("text-lg font-bold ml-2", statusConfig.color)}>
                    {statusConfig.label}
                  </Text>
                </View>
                <Text className="text-slate-400 text-sm">{statusConfig.description}</Text>
              </View>
            )}

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
                <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">Evidence & Attachments</Text>
                <View className="flex-row items-center bg-slate-800/50 rounded-xl p-3">
                  <Paperclip size={16} color="#64748b" />
                  <Text className="text-slate-300 text-sm ml-2">{entry.attachmentCount} attachment(s)</Text>
                  <ChevronRight size={16} color="#64748b" style={{ marginLeft: "auto" }} />
                </View>
              </View>
            )}

            {/* Actions */}
            <View className="py-6 gap-3">
              {/* Resolve / Keep Open - for open cases */}
              {entry.status === "open" && onResolve && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onResolve(entry);
                  }}
                  disabled={isResolvingOrKeeping}
                  className="flex-row items-center justify-center bg-green-500 rounded-xl py-3.5 active:opacity-80"
                >
                  {isResolvingOrKeeping ? (
                    <ActivityIndicator size="small" color="#0f172a" />
                  ) : (
                    <>
                      <CheckCircle size={18} color="#0f172a" />
                      <Text className="text-slate-900 font-bold ml-2">Mark as Resolved</Text>
                    </>
                  )}
                </Pressable>
              )}

              {entry.status === "open" && onKeepOpen && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onKeepOpen(entry);
                  }}
                  disabled={isResolvingOrKeeping}
                  className="flex-row items-center justify-center bg-slate-800 border border-amber-500/40 rounded-xl py-3 active:opacity-80"
                >
                  <Clock size={18} color="#f59e0b" />
                  <Text className="text-amber-400 font-semibold ml-2">Keep Open</Text>
                </Pressable>
              )}

              {/* Reopen - for resolved cases */}
              {entry.status === "resolved" && onKeepOpen && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onKeepOpen(entry);
                  }}
                  disabled={isResolvingOrKeeping}
                  className="flex-row items-center justify-center bg-slate-800 border border-slate-600/50 rounded-xl py-3 active:opacity-80"
                >
                  {isResolvingOrKeeping ? (
                    <ActivityIndicator size="small" color="#94a3b8" />
                  ) : (
                    <>
                      <Clock size={18} color="#94a3b8" />
                      <Text className="text-slate-300 font-semibold ml-2">Reopen Case</Text>
                    </>
                  )}
                </Pressable>
              )}
              {/* Export / Use as Evidence - Primary action for pay events and disputed records */}
              {showExportEvidence && onExportEvidence && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onExportEvidence(entry);
                  }}
                  className="flex-row items-center justify-center bg-amber-500 rounded-xl py-3.5 active:opacity-80"
                >
                  <FileCheck size={18} color="#0f172a" />
                  <Text className="text-slate-900 font-bold ml-2">Add Evidence Notes</Text>
                </Pressable>
              )}

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
                  className="flex-row items-center justify-center bg-slate-800 rounded-xl py-3 active:opacity-80"
                >
                  <Plus size={18} color="#f59e0b" />
                  <Text className="text-white font-semibold ml-2">Log Pay Event</Text>
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
                  <Plane size={18} color="#3b82f6" />
                  <Text className="text-white font-semibold ml-2">
                    {entry.routeSummary ? `View Trip ${entry.routeSummary}` : "View Trip"}
                  </Text>
                </Pressable>
              )}

              {/* Add Proof - removed, use Export as Evidence flow */}
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
