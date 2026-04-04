/**
 * Pay Events Screen - Log and track pay-affecting events
 * Holy Grail Version - Documentation-first workflow
 */

import { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  Plus,
  FileText,
  CalendarX,
  Clock,
  Shuffle,
  DollarSign,
  Shield,
  UserMinus,
  GraduationCap,
  Plane,
  PhoneCall,
  MoreHorizontal,
  X,
  MessageSquare,
  ChevronRight,
  Trash2,
  Link2,
  Camera,
  TrendingUp,
  CheckCircle2,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  usePayEvents,
  useCreatePayEvent,
  useDeletePayEvent,
  useUpdatePayEvent,
  formatEventType,
  getEventTypeColor,
  formatEventStatus,
  getStatusColor,
  formatMinutes,
  formatCents,
} from "@/lib/usePayEvents";
import { useTrips, type BackendTrip } from "@/lib/useTripsData";
import { RelatedPayCodes } from "@/components/RelatedPayCodes";
import type { PayEvent, PayEventType, PayEventStatus } from "@/lib/contracts";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";

// Event type options
const EVENT_TYPES: { type: PayEventType; label: string; icon: React.ReactNode; color: string }[] = [
  { type: "SCHEDULE_CHANGE", label: "Schedule Change", icon: <CalendarX size={20} color="#ef4444" />, color: "#ef4444" },
  { type: "DUTY_EXTENSION", label: "Duty Extension", icon: <Clock size={20} color="#f97316" />, color: "#f97316" },
  { type: "REASSIGNMENT", label: "Reassignment", icon: <Shuffle size={20} color="#eab308" />, color: "#eab308" },
  { type: "PREMIUM_TRIGGER", label: "Premium Trigger", icon: <DollarSign size={20} color="#22c55e" />, color: "#22c55e" },
  { type: "PAY_PROTECTION", label: "Pay Protection", icon: <Shield size={20} color="#3b82f6" />, color: "#3b82f6" },
  { type: "JUNIOR_ASSIGNMENT", label: "Junior Assignment", icon: <UserMinus size={20} color="#a855f7" />, color: "#a855f7" },
  { type: "TRAINING", label: "Training", icon: <GraduationCap size={20} color="#06b6d4" />, color: "#06b6d4" },
  { type: "DEADHEAD", label: "Deadhead", icon: <Plane size={20} color="#64748b" />, color: "#64748b" },
  { type: "RESERVE_ACTIVATION", label: "Reserve Activation", icon: <PhoneCall size={20} color="#ec4899" />, color: "#ec4899" },
  { type: "OTHER", label: "Other", icon: <MoreHorizontal size={20} color="#6b7280" />, color: "#6b7280" },
];

// Get icon component for event type
function getEventIcon(eventType: PayEventType) {
  const found = EVENT_TYPES.find((e) => e.type === eventType);
  return found?.icon ?? <MoreHorizontal size={20} color="#6b7280" />;
}

// Event card component
function EventCard({
  event,
  onPress,
  onDelete,
  onQuickResolve,
}: {
  event: PayEvent;
  onPress: () => void;
  onDelete: () => void;
  onQuickResolve?: () => void;
}) {
  const statusColor = getStatusColor(event.status);

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
          "Delete Event",
          `Delete "${event.title}"?`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: onDelete },
          ]
        );
      }}
      className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/50 mb-3 active:opacity-80"
    >
      <View className="flex-row items-start">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${getEventTypeColor(event.eventType)}20` }}
        >
          {getEventIcon(event.eventType)}
        </View>

        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-white font-semibold text-base flex-1" numberOfLines={1}>
              {event.title}
            </Text>
            <View className={`px-2 py-0.5 rounded-full ${statusColor.bg}`}>
              <Text className={`text-xs font-medium ${statusColor.text}`}>
                {formatEventStatus(event.status)}
              </Text>
            </View>
          </View>

          <Text className="text-slate-400 text-sm mt-1">
            {formatEventType(event.eventType)}
            {event.airlineLabel ? ` (${event.airlineLabel})` : ""}
          </Text>

          <View className="flex-row items-center mt-2">
            <Text className="text-slate-500 text-xs">{event.eventDateISO}</Text>

            {event.creditDifferenceMinutes != null && (
              <>
                <Text className="text-slate-600 mx-2">•</Text>
                <Text
                  className={`text-xs font-medium ${
                    event.creditDifferenceMinutes >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatMinutes(event.creditDifferenceMinutes)}
                </Text>
              </>
            )}

            {event.payDifferenceCents != null && (
              <>
                <Text className="text-slate-600 mx-2">•</Text>
                <Text
                  className={`text-xs font-medium ${
                    event.payDifferenceCents >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {formatCents(event.payDifferenceCents)}
                </Text>
              </>
            )}
          </View>

          {event.documentation && event.documentation.length > 0 && (
            <View className="flex-row items-center mt-2">
              <MessageSquare size={12} color="#64748b" />
              <Text className="text-slate-500 text-xs ml-1">
                {event.documentation.length} note{event.documentation.length !== 1 ? "s" : ""}
              </Text>
            </View>
          )}

          {/* Trip Linkage Indicator */}
          {event.tripId && (
            <View className="flex-row items-center mt-2">
              <Link2 size={12} color="#f59e0b" />
              <Text className="text-amber-500/80 text-xs ml-1">Linked to trip</Text>
            </View>
          )}

          {/* Quick Accept Button for Open Events */}
          {event.status === "open" && onQuickResolve && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onQuickResolve();
              }}
              className="mt-3 bg-green-500/20 border border-green-500/30 rounded-xl px-4 py-2.5 flex-row items-center justify-center active:bg-green-500/30"
            >
              <CheckCircle2 size={16} color="#22c55e" />
              <Text className="text-green-400 font-semibold text-sm ml-2">Accept Event</Text>
            </Pressable>
          )}
        </View>

        <ChevronRight size={16} color="#64748b" className="ml-2" />
      </View>
    </Pressable>
  );
}

// Event detail modal
function EventDetailModal({
  event,
  visible,
  onClose,
  onUpdateStatus,
  onDelete,
  isUpdating,
}: {
  event: PayEvent | null;
  visible: boolean;
  onClose: () => void;
  onUpdateStatus: (status: PayEventStatus) => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const insets = useSafeAreaInsets();

  if (!event) return null;

  const statusColor = getStatusColor(event.status);
  const eventTypeColor = getEventTypeColor(event.eventType);

  const STATUS_OPTIONS: { status: PayEventStatus; label: string; color: string }[] = [
    { status: "open", label: "Open", color: "#f59e0b" },
    { status: "disputed", label: "Disputed", color: "#ef4444" },
    { status: "resolved", label: "Resolved", color: "#22c55e" },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View
            style={{ paddingTop: insets.top + 8 }}
            className="px-5 pb-4 flex-row items-center justify-between border-b border-slate-700/50"
          >
            <Pressable
              onPress={onClose}
              className="p-2 -ml-2 active:opacity-70"
            >
              <X size={24} color="#64748b" />
            </Pressable>
            <Text className="text-white text-lg font-semibold">Event Details</Text>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                Alert.alert(
                  "Delete Event",
                  `Delete "${event.title}"?`,
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: onDelete },
                  ]
                );
              }}
              className="p-2 -mr-2 active:opacity-70"
            >
              <Trash2 size={20} color="#ef4444" />
            </Pressable>
          </View>

          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Event Header */}
            <Animated.View entering={FadeIn.duration(300)} className="mt-6">
              <View className="flex-row items-start mb-4">
                <View
                  className="w-14 h-14 rounded-2xl items-center justify-center"
                  style={{ backgroundColor: `${eventTypeColor}20` }}
                >
                  {EVENT_TYPES.find(e => e.type === event.eventType)?.icon}
                </View>
                <View className="flex-1 ml-4">
                  <Text className="text-white font-bold text-xl">{event.title}</Text>
                  <Text className="text-slate-400 text-sm mt-1">
                    {formatEventType(event.eventType)}
                    {event.airlineLabel ? ` (${event.airlineLabel})` : ""}
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* Event Info Card */}
            <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm">Date</Text>
                <Text className="text-white font-medium">{event.eventDateISO}</Text>
              </View>

              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm">Status</Text>
                <View className={`px-3 py-1 rounded-full ${statusColor.bg}`}>
                  <Text className={`text-sm font-medium ${statusColor.text}`}>
                    {formatEventStatus(event.status)}
                  </Text>
                </View>
              </View>

              {event.creditDifferenceMinutes != null && (
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-slate-400 text-sm">Credit Impact</Text>
                  <Text
                    className={`font-bold ${
                      event.creditDifferenceMinutes >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {formatMinutes(event.creditDifferenceMinutes)}
                  </Text>
                </View>
              )}

              {event.payDifferenceCents != null && (
                <View className="flex-row items-center justify-between">
                  <Text className="text-slate-400 text-sm">Pay Impact</Text>
                  <Text
                    className={`font-bold ${
                      event.payDifferenceCents >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {formatCents(event.payDifferenceCents)}
                  </Text>
                </View>
              )}
            </View>

            {/* Description */}
            {event.description && (
              <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Notes</Text>
                <Text className="text-white text-base leading-6">{event.description}</Text>
              </View>
            )}

            {/* Documentation */}
            {event.documentation && event.documentation.length > 0 && (
              <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-4">
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">
                  Documentation ({event.documentation.length})
                </Text>
                {event.documentation.map((doc, index) => (
                  <View key={doc.id} className={`${index > 0 ? "mt-3 pt-3 border-t border-slate-700/50" : ""}`}>
                    <View className="flex-row items-center mb-1">
                      <MessageSquare size={12} color="#64748b" />
                      <Text className="text-slate-400 text-xs ml-1.5">{doc.docType}</Text>
                    </View>
                    <Text className="text-white text-sm">{doc.content}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Update Status */}
            <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3 mt-2">
              Update Status
            </Text>
            <View className="flex-row flex-wrap mb-4">
              {STATUS_OPTIONS.map((option) => (
                <Pressable
                  key={option.status}
                  onPress={() => {
                    if (option.status !== event.status && !isUpdating) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onUpdateStatus(option.status);
                    }
                  }}
                  disabled={isUpdating}
                  className={`mr-2 mb-2 px-4 py-2 rounded-xl ${
                    event.status === option.status
                      ? "border-2"
                      : "bg-slate-800/60 border border-slate-700/50"
                  } ${isUpdating ? "opacity-50" : ""}`}
                  style={event.status === option.status ? {
                    borderColor: option.color,
                    backgroundColor: `${option.color}20`
                  } : {}}
                >
                  <Text
                    className={`text-sm font-medium ${
                      event.status === option.status ? "" : "text-slate-300"
                    }`}
                    style={event.status === option.status ? { color: option.color } : {}}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Timestamp */}
            <View className="items-center mt-4">
              <Text className="text-slate-600 text-xs">
                Created {new Date(event.createdAt).toLocaleDateString()}
              </Text>
            </View>

            {/* Related Pay Codes */}
            <View className="mt-6">
              <RelatedPayCodes eventType={event.eventType} />
            </View>
          </ScrollView>
        </LinearGradient>
      </View>
    </Modal>
  );
}

// Log Event Modal - Create new pay events
function LogEventModal({
  visible,
  onClose,
  onCreate,
  isCreating,
  trips,
  selectedTripId,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (data: {
    eventType: PayEventType;
    title: string;
    description: string;
    eventDateISO: string;
    tripId?: string;
  }) => void;
  isCreating: boolean;
  trips: BackendTrip[];
  selectedTripId?: string;
}) {
  const insets = useSafeAreaInsets();
  const [selectedType, setSelectedType] = useState<PayEventType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tripId, setTripId] = useState<string | undefined>(selectedTripId);

  const today = new Date().toISOString().split("T")[0];

  const handleSubmit = () => {
    if (!selectedType || !title.trim()) return;
    onCreate({
      eventType: selectedType,
      title: title.trim(),
      description: description.trim(),
      eventDateISO: today,
      tripId,
    });
    // Reset form
    setSelectedType(null);
    setTitle("");
    setDescription("");
    setTripId(undefined);
  };

  const handleClose = () => {
    setSelectedType(null);
    setTitle("");
    setDescription("");
    setTripId(undefined);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View
            style={{ paddingTop: insets.top + 8 }}
            className="px-5 pb-4 flex-row items-center justify-between border-b border-slate-700/50"
          >
            <Pressable onPress={handleClose} className="p-2 -ml-2 active:opacity-70">
              <X size={24} color="#64748b" />
            </Pressable>
            <Text className="text-white text-lg font-semibold">Log Pay Event</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Event Type Selection */}
            <Animated.View entering={FadeIn.duration(300)} className="mt-6">
              <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">
                Event Type
              </Text>
              <View className="flex-row flex-wrap">
                {EVENT_TYPES.map((eventType) => (
                  <Pressable
                    key={eventType.type}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedType(eventType.type);
                    }}
                    className={`mr-2 mb-2 px-3 py-2 rounded-xl flex-row items-center ${
                      selectedType === eventType.type
                        ? "border-2"
                        : "bg-slate-800/60 border border-slate-700/50"
                    }`}
                    style={
                      selectedType === eventType.type
                        ? {
                            borderColor: eventType.color,
                            backgroundColor: `${eventType.color}20`,
                          }
                        : {}
                    }
                  >
                    {eventType.icon}
                    <Text
                      className={`ml-2 text-sm font-medium ${
                        selectedType === eventType.type ? "" : "text-slate-300"
                      }`}
                      style={selectedType === eventType.type ? { color: eventType.color } : {}}
                    >
                      {eventType.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Animated.View>

            {/* Title */}
            <View className="mt-6">
              <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                Title
              </Text>
              <View className="bg-slate-800/60 rounded-xl border border-slate-700/50">
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Brief description of the event"
                  placeholderTextColor="#64748b"
                  className="text-white text-base p-4"
                />
              </View>
            </View>

            {/* Description */}
            <View className="mt-4">
              <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                Notes (Optional)
              </Text>
              <View className="bg-slate-800/60 rounded-xl border border-slate-700/50">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Additional details, rep name, times..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  className="text-white text-base p-4"
                  style={{ minHeight: 80 }}
                />
              </View>
            </View>

            {/* Link to Trip (Optional) */}
            {trips.length > 0 && (
              <View className="mt-4">
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                  Link to Trip (Optional)
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row">
                    <Pressable
                      onPress={() => setTripId(undefined)}
                      className={`mr-2 px-4 py-2 rounded-xl ${
                        !tripId
                          ? "bg-amber-500/20 border-2 border-amber-500"
                          : "bg-slate-800/60 border border-slate-700/50"
                      }`}
                    >
                      <Text className={!tripId ? "text-amber-400 font-medium" : "text-slate-400"}>
                        None
                      </Text>
                    </Pressable>
                    {trips.slice(0, 5).map((trip) => (
                      <Pressable
                        key={trip.id}
                        onPress={() => setTripId(trip.id)}
                        className={`mr-2 px-4 py-2 rounded-xl ${
                          tripId === trip.id
                            ? "bg-amber-500/20 border-2 border-amber-500"
                            : "bg-slate-800/60 border border-slate-700/50"
                        }`}
                      >
                        <Text
                          className={
                            tripId === trip.id ? "text-amber-400 font-medium" : "text-slate-400"
                          }
                        >
                          {trip.tripNumber || trip.startDate}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Date Display */}
            <View className="mt-4">
              <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">
                Date
              </Text>
              <View className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                <Text className="text-white text-base">{today}</Text>
              </View>
            </View>

            {/* Submit Button */}
            <Pressable
              onPress={handleSubmit}
              disabled={!selectedType || !title.trim() || isCreating}
              className={`mt-6 rounded-xl p-4 flex-row items-center justify-center ${
                selectedType && title.trim() && !isCreating
                  ? "bg-amber-500 active:opacity-80"
                  : "bg-slate-700"
              }`}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <>
                  <FileText
                    size={20}
                    color={selectedType && title.trim() ? "#0f172a" : "#64748b"}
                  />
                  <Text
                    className={`font-bold text-lg ml-2 ${
                      selectedType && title.trim() ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    Log Event
                  </Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </LinearGradient>
      </View>
    </Modal>
  );
}

export default function PayEventsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ tripId?: string }>();

  // Data
  const { data, isLoading, refetch } = usePayEvents();
  const { data: tripsData } = useTrips();
  const createEventMutation = useCreatePayEvent();
  const deleteEventMutation = useDeletePayEvent();
  const updateEventMutation = useUpdatePayEvent();

  // State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<PayEvent | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const events = data?.events ?? [];
  const trips = useMemo(() => tripsData?.trips ?? [], [tripsData]);

  // Handlers
  const handleCreateEvent = async (eventData: {
    eventType: PayEventType;
    title: string;
    description: string;
    eventDateISO: string;
    tripId?: string;
    repName?: string;
    contactTime?: string;
    proofUri?: string;
    contextAnswers?: Record<string, boolean | string>;
  }) => {
    try {
      await createEventMutation.mutateAsync({
        eventType: eventData.eventType,
        title: eventData.title,
        description: eventData.description,
        eventDateISO: eventData.eventDateISO,
        tripId: eventData.tripId,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowCreateModal(false);
      refetch();
    } catch (error) {
      console.error("Failed to create event:", error);
      Alert.alert("Error", "Failed to log event. Please try again.");
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      await deleteEventMutation.mutateAsync(eventId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowDetailModal(false);
      setSelectedEvent(null);
    } catch (error) {
      console.error("Failed to delete event:", error);
    }
  };

  const handleUpdateEventStatus = async (status: PayEventStatus) => {
    if (!selectedEvent) return;
    try {
      await updateEventMutation.mutateAsync({
        eventId: selectedEvent.id,
        data: { status },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Update local selected event
      setSelectedEvent({ ...selectedEvent, status });
      refetch();
    } catch (error) {
      console.error("Failed to update event:", error);
      Alert.alert("Error", "Failed to update event status.");
    }
  };

  const handleEventPress = (event: PayEvent) => {
    setSelectedEvent(event);
    setShowDetailModal(true);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
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
          >
            {/* Header */}
            <View style={{ paddingTop: insets.top + 8 }} className="px-5">
              <View className="flex-row items-center justify-between mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.back();
                  }}
                  className="flex-row items-center active:opacity-70"
                >
                  <ChevronLeft size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base ml-1">Back</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowCreateModal(true);
                  }}
                  className="bg-amber-500 rounded-xl px-4 py-2 flex-row items-center active:opacity-80"
                >
                  <Plus size={18} color="#000" />
                  <Text className="text-slate-950 font-semibold ml-1">Log Event</Text>
                </Pressable>
              </View>

              <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                <View className="flex-row items-center mb-2">
                  <FileText size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Documentation
                  </Text>
                </View>
                <Text className="text-white text-3xl font-bold">Pay Events</Text>
                <Text className="text-slate-400 text-base mt-1">
                  Track schedule changes and pay-affecting events
                </Text>
              </Animated.View>
            </View>

            {/* Loading */}
            {isLoading && (
              <View className="items-center justify-center py-20">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4">Loading events...</Text>
              </View>
            )}

            {/* Empty State */}
            {!isLoading && events.length === 0 && (
              <Animated.View
                entering={FadeIn.duration(600)}
                className="mx-5 mt-8"
              >
                <View className="bg-slate-900/60 rounded-2xl p-6 border border-slate-700/50 items-center">
                  <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                    <FileText size={32} color="#f59e0b" />
                  </View>
                  <Text className="text-white text-xl font-bold text-center">
                    No Events Logged
                  </Text>
                  <Text className="text-slate-400 text-center mt-2 mb-6">
                    Log pay events like schedule changes, duty extensions, or
                    reassignments to keep a record for pay verification.
                  </Text>
                  <Pressable
                    onPress={() => setShowCreateModal(true)}
                    className="bg-amber-500 rounded-xl px-6 py-3 flex-row items-center active:opacity-80"
                  >
                    <Plus size={20} color="#000" />
                    <Text className="text-slate-950 font-semibold text-base ml-2">
                      Log Your First Event
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Events List */}
            {!isLoading && events.length > 0 && (
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-6"
              >
                {/* Info Banner */}
                <View className="bg-blue-900/30 rounded-xl p-4 border border-blue-700/30 mb-4">
                  <Text className="text-blue-300 text-sm">
                    Long press an event to delete. Tap to view details and add
                    documentation.
                  </Text>
                </View>

                {/* Summary */}
                <View className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/50 mb-4 flex-row justify-around">
                  <View className="items-center">
                    <Text className="text-2xl font-bold text-white">{events.length}</Text>
                    <Text className="text-slate-400 text-xs mt-1">Total Events</Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-2xl font-bold text-amber-400">
                      {events.filter((e) => e.status === "open").length}
                    </Text>
                    <Text className="text-slate-400 text-xs mt-1">Open</Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-2xl font-bold text-green-400">
                      {events.filter((e) => e.status === "resolved").length}
                    </Text>
                    <Text className="text-slate-400 text-xs mt-1">Resolved</Text>
                  </View>
                </View>

                {/* Events */}
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onPress={() => handleEventPress(event)}
                    onDelete={() => handleDeleteEvent(event.id)}
                    onQuickResolve={
                      event.status === "open"
                        ? async () => {
                            try {
                              await updateEventMutation.mutateAsync({
                                eventId: event.id,
                                data: { status: "resolved" },
                              });
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                              refetch();
                            } catch (error) {
                              console.error("Failed to resolve event:", error);
                              Alert.alert("Error", "Failed to accept event. Please try again.");
                            }
                          }
                        : undefined
                    }
                  />
                ))}
              </Animated.View>
            )}
          </ScrollView>
        </LinearGradient>
      </View>

      {/* Create Modal - Holy Grail Version */}
      <LogEventModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreateEvent}
        isCreating={createEventMutation.isPending}
        trips={trips}
        selectedTripId={params.tripId}
      />

      {/* Detail Modal */}
      <EventDetailModal
        event={selectedEvent}
        visible={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedEvent(null);
        }}
        onUpdateStatus={handleUpdateEventStatus}
        onDelete={() => {
          if (selectedEvent) {
            handleDeleteEvent(selectedEvent.id);
          }
        }}
        isUpdating={updateEventMutation.isPending}
      />
    </>
  );
}
