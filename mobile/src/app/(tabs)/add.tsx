/**
 * Log Event Screen - Structured pay-protection and documentation tool
 * Records contract-relevant pay triggers with evidence
 *
 * Phase 3 Upgrade: Premium Code Picker integration
 * Shows Premium Code Picker when:
 * - Premium Trigger selected
 * - Reassignment selected
 * - Schedule Change selected
 */

import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
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
  CheckCircle,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Calendar,
  User,
  Phone,
  MessageSquare,
  Radio,
  Paperclip,
  Image,
  X,
  Link2,
  Info,
  TrendingUp,
  AlertTriangle,
  Award,
  Plus,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  FadeOut,
  SlideInRight,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  usePayEvents,
  useCreatePayEvent,
  getStatusColor,
} from "@/lib/usePayEvents";
import { webSafeExit } from "@/lib/webSafeAnimation";
import { useTrips } from "@/lib/useTripsData";
import { useSession } from "@/lib/useSession";
import { PremiumCodePicker, PremiumCodeChip, type SelectedPremiumCode } from "@/components/PremiumCodePicker";
import type { PayEvent, PayEventType, PayEventStatus, ContactMethod } from "@/lib/contracts";
import { cn } from "@/lib/cn";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import { useResponsive } from "@/lib/responsive";

// Event types that trigger premium code selection
const PREMIUM_CODE_EVENT_TYPES: PayEventType[] = [
  "PREMIUM_TRIGGER",
  "REASSIGNMENT",
  "SCHEDULE_CHANGE",
];

// Event type configurations
const EVENT_TYPES: {
  type: PayEventType;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  suggestedDescription: string;
  requiresContact: boolean;
}[] = [
  {
    type: "SCHEDULE_CHANGE",
    label: "Schedule Change",
    icon: <CalendarX size={20} color="#ef4444" />,
    color: "#ef4444",
    description: "Assignment changed after report",
    suggestedDescription: "Schedule changed after check-in/report time",
    requiresContact: true,
  },
  {
    type: "DUTY_EXTENSION",
    label: "Duty Extension",
    icon: <Clock size={20} color="#f97316" />,
    color: "#f97316",
    description: "Duty period extended beyond scheduled",
    suggestedDescription: "Duty extended past original release time",
    requiresContact: true,
  },
  {
    type: "REASSIGNMENT",
    label: "Reassignment",
    icon: <Shuffle size={20} color="#eab308" />,
    color: "#eab308",
    description: "Trip or leg changed by scheduling",
    suggestedDescription: "Reassigned after report time",
    requiresContact: true,
  },
  {
    type: "PREMIUM_TRIGGER",
    label: "Premium Trigger",
    icon: <DollarSign size={20} color="#22c55e" />,
    color: "#22c55e",
    description: "Qualifies for additional compensation",
    suggestedDescription: "Premium pay triggered",
    requiresContact: true,
  },
  {
    type: "PAY_PROTECTION",
    label: "Pay Protection",
    icon: <Shield size={20} color="#3b82f6" />,
    color: "#3b82f6",
    description: "Pay protection due to changes",
    suggestedDescription: "Pay protection due to company-initiated change",
    requiresContact: true,
  },
  {
    type: "JUNIOR_ASSIGNMENT",
    label: "Junior Assignment",
    icon: <UserMinus size={20} color="#a855f7" />,
    color: "#a855f7",
    description: "Involuntary assignment",
    suggestedDescription: "Junior assigned during off days",
    requiresContact: true,
  },
  {
    type: "TRAINING",
    label: "Training",
    icon: <GraduationCap size={20} color="#06b6d4" />,
    color: "#06b6d4",
    description: "Training activity affecting pay",
    suggestedDescription: "Training activity",
    requiresContact: false,
  },
  {
    type: "DEADHEAD",
    label: "Deadhead",
    icon: <Plane size={20} color="#64748b" />,
    color: "#64748b",
    description: "Passenger travel assigned by company",
    suggestedDescription: "Deadhead segment assigned",
    requiresContact: false,
  },
  {
    type: "RESERVE_ACTIVATION",
    label: "Reserve Activation",
    icon: <PhoneCall size={20} color="#ec4899" />,
    color: "#ec4899",
    description: "Reserve duty activation",
    suggestedDescription: "Called from reserve",
    requiresContact: false,
  },
  {
    type: "OTHER",
    label: "Other",
    icon: <MoreHorizontal size={20} color="#6b7280" />,
    color: "#6b7280",
    description: "Other pay-affecting event",
    suggestedDescription: "",
    requiresContact: false,
  },
];

// Contact method options
const CONTACT_METHODS: { value: ContactMethod; label: string; icon: React.ReactNode }[] = [
  { value: "phone", label: "Phone", icon: <Phone size={16} color="#64748b" /> },
  { value: "acars", label: "ACARS", icon: <Radio size={16} color="#64748b" /> },
  { value: "message", label: "Message", icon: <MessageSquare size={16} color="#64748b" /> },
  { value: "other", label: "Other", icon: <MoreHorizontal size={16} color="#64748b" /> },
];

// Status options
const STATUS_OPTIONS: { value: PayEventStatus; label: string; color: string }[] = [
  { value: "open", label: "Open", color: "#f59e0b" },
  { value: "resolved", label: "Resolved", color: "#22c55e" },
  { value: "disputed", label: "Disputed", color: "#ef4444" },
];

// Pay impact confidence levels
type ConfidenceLevel = "high" | "medium" | "low";

interface PayImpactPreview {
  estimatedCreditHours: string;
  possiblePremiums: string[];
  confidence: ConfidenceLevel;
}

// Get pay impact preview based on event type
function getPayImpactPreview(eventType: PayEventType): PayImpactPreview {
  const impacts: Record<PayEventType, PayImpactPreview> = {
    SCHEDULE_CHANGE: {
      estimatedCreditHours: "Original credit preserved",
      possiblePremiums: ["Pay protection", "Greater of original/new"],
      confidence: "high",
    },
    DUTY_EXTENSION: {
      estimatedCreditHours: "Varies by extension length",
      possiblePremiums: ["Extension premium", "Overtime if applicable"],
      confidence: "medium",
    },
    REASSIGNMENT: {
      estimatedCreditHours: "Greater of original/new trip",
      possiblePremiums: ["Pay protection", "Reassignment premium"],
      confidence: "high",
    },
    PREMIUM_TRIGGER: {
      estimatedCreditHours: "Base credit + premium",
      possiblePremiums: ["Contract-specific premium"],
      confidence: "medium",
    },
    PAY_PROTECTION: {
      estimatedCreditHours: "Original credit preserved",
      possiblePremiums: ["Full pay protection"],
      confidence: "high",
    },
    JUNIOR_ASSIGNMENT: {
      estimatedCreditHours: "Trip credit + JA premium",
      possiblePremiums: ["Junior assignment premium", "Override pay"],
      confidence: "high",
    },
    TRAINING: {
      estimatedCreditHours: "Training rate applies",
      possiblePremiums: ["Training guarantee"],
      confidence: "medium",
    },
    DEADHEAD: {
      estimatedCreditHours: "50-100% of block time",
      possiblePremiums: ["Deadhead credit per contract"],
      confidence: "medium",
    },
    RESERVE_ACTIVATION: {
      estimatedCreditHours: "Trip credit or guarantee",
      possiblePremiums: ["Reserve premium", "Call-out pay"],
      confidence: "medium",
    },
    OTHER: {
      estimatedCreditHours: "Varies",
      possiblePremiums: ["Review contract"],
      confidence: "low",
    },
  };
  return impacts[eventType];
}

// Attachment type
interface Attachment {
  uri: string;
  type: "image" | "pdf";
  name: string;
}

// Recent event card component
function RecentEventCard({
  event,
  onPress,
}: {
  event: PayEvent;
  onPress: () => void;
}) {
  const statusColor = getStatusColor(event.status);
  const eventType = EVENT_TYPES.find((e) => e.type === event.eventType);

  return (
    <Pressable
      onPress={onPress}
      className="bg-slate-900/60 rounded-xl p-4 border border-slate-700/50 mb-3 active:opacity-80"
    >
      <View className="flex-row items-center">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${eventType?.color || "#6b7280"}20` }}
        >
          {eventType?.icon}
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold" numberOfLines={1}>
            {event.title}
          </Text>
          <View className="flex-row items-center mt-1">
            <Text className="text-slate-500 text-xs">{event.eventDateISO}</Text>
            <View className={`ml-2 px-2 py-0.5 rounded-full ${statusColor.bg}`}>
              <Text className={`text-[10px] font-medium ${statusColor.text}`}>
                {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
              </Text>
            </View>
          </View>
        </View>
        <ChevronRight size={16} color="#64748b" />
      </View>
    </Pressable>
  );
}

// Section header component
function SectionHeader({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <View className="flex-row items-center mb-3">
      <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
        {label}
      </Text>
      {required && (
        <Text className="text-red-400 text-sm font-semibold ml-1">*</Text>
      )}
    </View>
  );
}

// Dropdown select component
function DropdownSelect<T extends string>({
  value,
  options,
  onSelect,
  placeholder,
  renderOption,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  placeholder: string;
  renderOption?: (option: { value: T; label: string }, isSelected: boolean) => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setIsOpen(true);
        }}
        className="bg-slate-800/60 rounded-2xl border border-slate-700/50 p-4 flex-row items-center justify-between"
      >
        <Text
          className={selectedOption ? "text-white text-lg" : "text-slate-500 text-lg"}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <ChevronDown size={20} color="#64748b" />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/60 justify-end"
          onPress={() => setIsOpen(false)}
        >
          <View className="bg-slate-900 rounded-t-3xl max-h-[60%]">
            <View className="p-4 border-b border-slate-700/50">
              <Text className="text-white text-lg font-semibold text-center">
                {placeholder}
              </Text>
            </View>
            <ScrollView className="p-4">
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelect(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "p-4 rounded-xl mb-2",
                    value === option.value
                      ? "bg-amber-500/20 border border-amber-500/50"
                      : "bg-slate-800/60"
                  )}
                >
                  {renderOption ? (
                    renderOption(option, value === option.value)
                  ) : (
                    <Text
                      className={cn(
                        "text-lg",
                        value === option.value ? "text-amber-400 font-semibold" : "text-white"
                      )}
                    >
                      {option.label}
                    </Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <View className="p-4 pb-8">
              <Pressable
                onPress={() => setIsOpen(false)}
                className="bg-slate-800 rounded-xl p-4"
              >
                <Text className="text-slate-400 text-center font-semibold">Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function LogEventScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const { contentMaxWidth } = useResponsive();

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("log_event");

  // Data hooks
  const { data: eventsData, refetch } = usePayEvents();
  const { data: tripsData } = useTrips();
  const createEventMutation = useCreatePayEvent();

  // Form state
  const [selectedType, setSelectedType] = useState<PayEventType | null>(null);
  const [eventDescription, setEventDescription] = useState("");
  const [eventDate, setEventDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod | null>(null);
  const [contactTime, setContactTime] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [eventStatus, setEventStatus] = useState<PayEventStatus>("open");
  const [linkedTripId, setLinkedTripId] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Phase 3: Premium Code Selection State
  const [selectedPremiumCode, setSelectedPremiumCode] = useState<SelectedPremiumCode | null>(null);
  const [showPremiumCodePicker, setShowPremiumCodePicker] = useState(false);

  // Check if premium code is required for this event type
  const premiumCodeRequired = useMemo(
    () => selectedType && PREMIUM_CODE_EVENT_TYPES.includes(selectedType),
    [selectedType]
  );

  // Get event type config
  const selectedEventType = useMemo(
    () => EVENT_TYPES.find((e) => e.type === selectedType),
    [selectedType]
  );

  // Check if contact details are required
  const contactRequired = selectedEventType?.requiresContact ?? false;

  // Get pay impact preview
  const payImpact = useMemo(
    () => (selectedType ? getPayImpactPreview(selectedType) : null),
    [selectedType]
  );

  // Get recent trips for linking
  const recentTrips = useMemo(() => {
    if (!tripsData?.trips) return [];
    return tripsData.trips.slice(0, 5).map((t) => ({
      value: t.id,
      label: `${t.tripNumber || "Trip"} - ${t.startDate?.split("T")[0] || "Unknown date"}`,
    }));
  }, [tripsData]);

  // Format date for display
  const formattedDate = useMemo(() => {
    return eventDate.toISOString().split("T")[0];
  }, [eventDate]);

  // Auto-populate description when event type changes
  const handleTypeSelect = useCallback((type: PayEventType) => {
    setSelectedType(type);
    const eventConfig = EVENT_TYPES.find((e) => e.type === type);
    if (eventConfig?.suggestedDescription && !eventDescription) {
      setEventDescription(eventConfig.suggestedDescription);
    }
    // Phase 3: Reset premium code when changing event type
    if (!PREMIUM_CODE_EVENT_TYPES.includes(type)) {
      setSelectedPremiumCode(null);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [eventDescription]);

  // Handle image picker
  const handleAddAttachment = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setAttachments((prev) => [
        ...prev,
        {
          uri: asset.uri,
          type: "image",
          name: asset.fileName || `attachment-${prev.length + 1}.jpg`,
        },
      ]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // Remove attachment
  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Validate form
  const isFormValid = useMemo(() => {
    if (!selectedType) return false;
    if (!eventDescription.trim()) return false;
    if (contactRequired && !contactName.trim()) return false;
    if (contactRequired && !contactMethod) return false;
    // Phase 3: Premium code required for certain event types
    if (premiumCodeRequired && !selectedPremiumCode) return false;
    return true;
  }, [selectedType, eventDescription, contactRequired, contactName, contactMethod, premiumCodeRequired, selectedPremiumCode]);

  // Handle form submission
  const handleCreateEvent = async () => {
    if (!isFormValid || !isAuthenticated) return;

    try {
      await createEventMutation.mutateAsync({
        eventType: selectedType!,
        title: eventDescription.trim(),
        description: additionalNotes.trim() || undefined,
        eventDateISO: formattedDate,
        tripId: linkedTripId || undefined,
        // Phase 3: Include premium code if selected
        premiumCode: selectedPremiumCode?.code.code,
        premiumVariantKey: selectedPremiumCode?.variant?.variant_key,
        newCreditMinutes: selectedPremiumCode?.premiumMinutes,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSuccess(true);

      // Reset form
      setSelectedType(null);
      setEventDescription("");
      setContactName("");
      setContactMethod(null);
      setContactTime("");
      setAdditionalNotes("");
      setAttachments([]);
      setEventStatus("open");
      setLinkedTripId(null);
      // Phase 3: Reset premium code
      setSelectedPremiumCode(null);

      // Refresh events list
      refetch();

      // Hide success after 2s
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error("Failed to create event:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const recentEvents = (eventsData?.events ?? []).slice(0, 3);

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e293b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: 120, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(100)}
              style={{ paddingTop: insets.top + 16 }}
              className="px-5"
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center">
                  <FileText size={24} color="#f59e0b" />
                  <Text className="text-amber-500 text-base font-semibold ml-2">
                    Pay Documentation
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    openTutorial();
                  }}
                  className="w-10 h-10 rounded-full bg-slate-800/60 border border-slate-700/50 items-center justify-center active:opacity-70"
                >
                  <Info size={18} color="#f59e0b" />
                </Pressable>
              </View>
              <Text className="text-white text-3xl font-bold">Log Event</Text>
              <Text className="text-slate-400 text-base mt-1">
                Record contract-relevant pay triggers with evidence
              </Text>
            </Animated.View>

            {/* Not Authenticated Warning */}
            {!isAuthenticated && (
              <Animated.View
                entering={FadeIn.duration(300)}
                className="mx-5 mt-4"
              >
                <View className="bg-amber-500/20 rounded-2xl p-4 border border-amber-500/50 flex-row items-center">
                  <AlertCircle size={20} color="#f59e0b" />
                  <Text className="text-amber-400 ml-3 flex-1">
                    Sign in to save your events
                  </Text>
                  <Pressable
                    onPress={() => router.push("/welcome")}
                    className="bg-amber-500 px-3 py-1 rounded-full"
                  >
                    <Text className="text-slate-900 font-semibold text-sm">
                      Sign In
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Success Message */}
            {showSuccess && (
              <Animated.View
                entering={FadeIn.duration(300)}
                exiting={webSafeExit(FadeOut.duration(300))}
                className="mx-5 mt-4"
              >
                <View className="bg-green-500/20 rounded-2xl p-4 border border-green-500/50 flex-row items-center">
                  <CheckCircle size={20} color="#22c55e" />
                  <Text className="text-green-400 ml-3 font-semibold">
                    Event logged successfully!
                  </Text>
                </View>
              </Animated.View>
            )}

            {/* 1. Event Type Selection (Required) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(150)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="Event Type" required />
              <View className="flex-row flex-wrap">
                {EVENT_TYPES.map((eventType, index) => (
                  <Pressable
                    key={eventType.type}
                    onPress={() => handleTypeSelect(eventType.type)}
                    className={cn(
                      "mr-2 mb-2 px-3 py-2.5 rounded-xl flex-row items-center",
                      selectedType === eventType.type
                        ? "border-2"
                        : "bg-slate-800/60 border border-slate-700/50",
                      eventType.type === "OTHER" && "opacity-60"
                    )}
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
                      className={cn(
                        "ml-2 text-sm font-medium",
                        selectedType === eventType.type ? "" : "text-slate-300"
                      )}
                      style={
                        selectedType === eventType.type
                          ? { color: eventType.color }
                          : {}
                      }
                    >
                      {eventType.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Selected type description */}
              {selectedEventType && (
                <Animated.View entering={FadeIn.duration(200)} className="mt-2">
                  <Text className="text-slate-500 text-sm">
                    {selectedEventType.description}
                  </Text>
                </Animated.View>
              )}
            </Animated.View>

            {/* 2. Event Description (Required) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="What changed?" required />
              <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                <TextInput
                  value={eventDescription}
                  onChangeText={setEventDescription}
                  placeholder="Describe the event (e.g., Reassigned after report time)"
                  placeholderTextColor="#64748b"
                  className="text-white text-lg p-4"
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  style={{ minHeight: 60 }}
                />
              </View>
              {selectedEventType?.suggestedDescription && !eventDescription && (
                <Pressable
                  onPress={() => setEventDescription(selectedEventType.suggestedDescription)}
                  className="mt-2 flex-row items-center"
                >
                  <Info size={14} color="#64748b" />
                  <Text className="text-slate-500 text-sm ml-1">
                    Tap to use: "{selectedEventType.suggestedDescription}"
                  </Text>
                </Pressable>
              )}
            </Animated.View>

            {/* 3. Date (Required) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(250)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="Event Date" required />
              <Pressable
                onPress={() => setShowDatePicker(true)}
                className="bg-slate-800/60 rounded-2xl border border-slate-700/50 p-4 flex-row items-center"
              >
                <Calendar size={20} color="#f59e0b" />
                <Text className="text-white text-lg ml-3 flex-1">
                  {formattedDate}
                </Text>
                <ChevronRight size={16} color="#64748b" />
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={eventDate}
                  mode="date"
                  display="spinner"
                  onChange={(event, date) => {
                    setShowDatePicker(false);
                    if (date) setEventDate(date);
                  }}
                  themeVariant="dark"
                />
              )}
            </Animated.View>

            {/* 4. Pay Impact Preview (Auto-generated, Read-only) */}
            {payImpact && (
              <Animated.View
                entering={SlideInRight.duration(400)}
                className="mx-5 mt-6"
              >
                <SectionHeader label="Potential Pay Impact" />
                <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 p-4">
                  <View className="flex-row items-center mb-3">
                    <TrendingUp size={18} color="#22c55e" />
                    <Text className="text-slate-300 ml-2 flex-1">
                      {payImpact.estimatedCreditHours}
                    </Text>
                  </View>

                  <View className="mb-3">
                    <Text className="text-slate-500 text-xs uppercase tracking-wider mb-2">
                      Possible Premiums
                    </Text>
                    <View className="flex-row flex-wrap">
                      {payImpact.possiblePremiums.map((premium, index) => (
                        <View
                          key={index}
                          className="bg-green-500/10 border border-green-500/30 rounded-lg px-2 py-1 mr-2 mb-1"
                        >
                          <Text className="text-green-400 text-xs">{premium}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-xs uppercase tracking-wider mr-2">
                      Confidence:
                    </Text>
                    <View
                      className={cn(
                        "px-2 py-0.5 rounded-full",
                        payImpact.confidence === "high"
                          ? "bg-green-500/20"
                          : payImpact.confidence === "medium"
                          ? "bg-amber-500/20"
                          : "bg-slate-500/20"
                      )}
                    >
                      <Text
                        className={cn(
                          "text-xs font-medium capitalize",
                          payImpact.confidence === "high"
                            ? "text-green-400"
                            : payImpact.confidence === "medium"
                            ? "text-amber-400"
                            : "text-slate-400"
                        )}
                      >
                        {payImpact.confidence}
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>
            )}

            {/* Phase 3: Premium Code Selection */}
            {premiumCodeRequired && (
              <Animated.View
                entering={FadeInDown.duration(600).delay(280)}
                className="mx-5 mt-6"
              >
                <SectionHeader label="Premium Code" required />
                <View className="bg-emerald-500/10 rounded-xl p-3 mb-3 flex-row items-center">
                  <Award size={16} color="#10b981" />
                  <Text className="text-emerald-400 text-sm ml-2">
                    Select a UPS premium code for this event
                  </Text>
                </View>

                {selectedPremiumCode ? (
                  <View className="flex-row items-center">
                    <PremiumCodeChip
                      selection={selectedPremiumCode}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowPremiumCodePicker(true);
                      }}
                      onRemove={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedPremiumCode(null);
                      }}
                    />
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowPremiumCodePicker(true);
                    }}
                    className="bg-slate-800/60 rounded-xl border border-slate-700/50 border-dashed p-4 flex-row items-center justify-center active:bg-slate-800/80"
                  >
                    <Plus size={20} color="#f59e0b" />
                    <Text className="text-amber-500 font-semibold ml-2">
                      Select Premium Code
                    </Text>
                  </Pressable>
                )}

                {/* Quick Codes */}
                <View className="flex-row flex-wrap mt-3">
                  <Text className="text-slate-500 text-xs w-full mb-2">Common: </Text>
                  {["AP0", "AP1", "LRP", "SVT"].map((code) => (
                    <Pressable
                      key={code}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowPremiumCodePicker(true);
                      }}
                      className="bg-slate-800/40 rounded-lg px-2 py-1 mr-2 mb-1 active:bg-slate-700"
                    >
                      <Text className="text-slate-400 text-xs font-medium">{code}</Text>
                    </Pressable>
                  ))}
                </View>
              </Animated.View>
            )}

            {/* 5. Contact Details */}
            {selectedType && (
              <Animated.View
                entering={FadeInDown.duration(600).delay(300)}
                className="mx-5 mt-6"
              >
                <SectionHeader
                  label="Contact Details"
                  required={contactRequired}
                />
                {contactRequired && (
                  <View className="bg-amber-500/10 rounded-xl p-3 mb-3 flex-row items-center">
                    <AlertTriangle size={16} color="#f59e0b" />
                    <Text className="text-amber-400 text-sm ml-2">
                      Contact details required for this event type
                    </Text>
                  </View>
                )}

                {/* Rep Name */}
                <View className="mb-3">
                  <Text className="text-slate-500 text-xs mb-2">
                    Crew Scheduling Rep Name {contactRequired && "*"}
                  </Text>
                  <View className="bg-slate-800/60 rounded-xl border border-slate-700/50 flex-row items-center px-4">
                    <User size={18} color="#64748b" />
                    <TextInput
                      value={contactName}
                      onChangeText={setContactName}
                      placeholder="Enter rep name"
                      placeholderTextColor="#64748b"
                      className="flex-1 text-white text-base p-3"
                    />
                  </View>
                </View>

                {/* Contact Method */}
                <View className="mb-3">
                  <Text className="text-slate-500 text-xs mb-2">
                    Contact Method {contactRequired && "*"}
                  </Text>
                  <View className="flex-row">
                    {CONTACT_METHODS.map((method) => (
                      <Pressable
                        key={method.value}
                        onPress={() => {
                          setContactMethod(method.value);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        className={cn(
                          "flex-1 mr-2 p-3 rounded-xl flex-row items-center justify-center",
                          contactMethod === method.value
                            ? "bg-amber-500/20 border border-amber-500/50"
                            : "bg-slate-800/60 border border-slate-700/50"
                        )}
                      >
                        {method.icon}
                        <Text
                          className={cn(
                            "ml-1.5 text-sm",
                            contactMethod === method.value
                              ? "text-amber-400 font-semibold"
                              : "text-slate-400"
                          )}
                        >
                          {method.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Contact Time */}
                <View>
                  <Text className="text-slate-500 text-xs mb-2">
                    Contact Time (optional)
                  </Text>
                  <View className="bg-slate-800/60 rounded-xl border border-slate-700/50 flex-row items-center px-4">
                    <Clock size={18} color="#64748b" />
                    <TextInput
                      value={contactTime}
                      onChangeText={setContactTime}
                      placeholder="e.g., 14:30 EST"
                      placeholderTextColor="#64748b"
                      className="flex-1 text-white text-base p-3"
                    />
                  </View>
                </View>
              </Animated.View>
            )}

            {/* 6. Additional Notes (Optional) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(350)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="Additional details (optional)" />
              <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                <TextInput
                  value={additionalNotes}
                  onChangeText={setAdditionalNotes}
                  placeholder="Clarifications, sequence of events, follow-up instructions..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  className="text-white text-base p-4"
                  style={{ minHeight: 80 }}
                />
              </View>
            </Animated.View>

            {/* 7. Attachments (Optional but Prominent) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(400)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="Attach Proof (Recommended)" />
              <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 border-dashed p-4">
                {attachments.length > 0 && (
                  <View className="mb-3">
                    {attachments.map((attachment, index) => (
                      <View
                        key={index}
                        className="flex-row items-center bg-slate-700/50 rounded-xl p-3 mb-2"
                      >
                        <Image size={18} color="#64748b" />
                        <Text
                          className="text-slate-300 flex-1 ml-2"
                          numberOfLines={1}
                        >
                          {attachment.name}
                        </Text>
                        <Pressable
                          onPress={() => handleRemoveAttachment(index)}
                          className="p-1"
                        >
                          <X size={18} color="#ef4444" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  onPress={handleAddAttachment}
                  className="flex-row items-center justify-center p-3"
                >
                  <Paperclip size={20} color="#f59e0b" />
                  <Text className="text-amber-500 font-semibold ml-2">
                    Add Screenshot or Photo
                  </Text>
                </Pressable>
                <Text className="text-slate-500 text-xs text-center mt-2">
                  Screenshots of crew scheduling messages, trip board changes, pay
                  statements
                </Text>
              </View>
            </Animated.View>

            {/* 8. Event Status (Required) */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(450)}
              className="mx-5 mt-6"
            >
              <SectionHeader label="Status" required />
              <View className="flex-row">
                {STATUS_OPTIONS.map((status) => (
                  <Pressable
                    key={status.value}
                    onPress={() => {
                      setEventStatus(status.value);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    className={cn(
                      "flex-1 mr-2 p-3 rounded-xl items-center",
                      eventStatus === status.value
                        ? "border-2"
                        : "bg-slate-800/60 border border-slate-700/50"
                    )}
                    style={
                      eventStatus === status.value
                        ? {
                            borderColor: status.color,
                            backgroundColor: `${status.color}20`,
                          }
                        : {}
                    }
                  >
                    <Text
                      className={cn(
                        "font-semibold",
                        eventStatus === status.value ? "" : "text-slate-400"
                      )}
                      style={
                        eventStatus === status.value ? { color: status.color } : {}
                      }
                    >
                      {status.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text className="text-slate-500 text-xs mt-2">
                Open events appear in Dashboard "Action Needed"
              </Text>
            </Animated.View>

            {/* 9. Trip Linking */}
            {recentTrips.length > 0 && (
              <Animated.View
                entering={FadeInDown.duration(600).delay(500)}
                className="mx-5 mt-6"
              >
                <SectionHeader label="Link to Trip (Optional)" />
                <DropdownSelect
                  value={linkedTripId}
                  options={recentTrips}
                  onSelect={setLinkedTripId}
                  placeholder="Select a trip to link"
                  renderOption={(option, isSelected) => (
                    <View className="flex-row items-center">
                      <Link2
                        size={18}
                        color={isSelected ? "#f59e0b" : "#64748b"}
                      />
                      <Text
                        className={cn(
                          "ml-2 text-base",
                          isSelected ? "text-amber-400 font-semibold" : "text-white"
                        )}
                      >
                        {option.label}
                      </Text>
                    </View>
                  )}
                />
                {linkedTripId && (
                  <Pressable
                    onPress={() => setLinkedTripId(null)}
                    className="mt-2 flex-row items-center"
                  >
                    <X size={14} color="#ef4444" />
                    <Text className="text-red-400 text-sm ml-1">Remove link</Text>
                  </Pressable>
                )}
              </Animated.View>
            )}

            {/* 10. Submit Button */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(550)}
              className="mx-5 mt-8"
            >
              <Pressable
                onPress={handleCreateEvent}
                disabled={!isFormValid || createEventMutation.isPending || !isAuthenticated}
                className={cn(
                  "rounded-2xl p-4 flex-row items-center justify-center",
                  isFormValid && !createEventMutation.isPending && isAuthenticated
                    ? "bg-amber-500 active:bg-amber-600"
                    : "bg-slate-700"
                )}
              >
                {createEventMutation.isPending ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : (
                  <>
                    <FileText
                      size={20}
                      color={isFormValid && isAuthenticated ? "#0f172a" : "#64748b"}
                    />
                    <Text
                      className={cn(
                        "font-bold text-lg ml-2",
                        isFormValid && isAuthenticated
                          ? "text-slate-900"
                          : "text-slate-500"
                      )}
                    >
                      Save Event
                    </Text>
                  </>
                )}
              </Pressable>
              {!isFormValid && selectedType && (
                <Text className="text-red-400 text-xs text-center mt-2">
                  {!eventDescription.trim()
                    ? "Event description is required"
                    : premiumCodeRequired && !selectedPremiumCode
                    ? "Premium code is required for this event type"
                    : contactRequired && !contactName.trim()
                    ? "Rep name is required for this event type"
                    : contactRequired && !contactMethod
                    ? "Contact method is required for this event type"
                    : ""}
                </Text>
              )}
            </Animated.View>

            {/* Recent Events */}
            {recentEvents.length > 0 && (
              <Animated.View
                entering={FadeInDown.duration(600).delay(600)}
                className="mx-5 mt-8"
              >
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                    Recent Events
                  </Text>
                  <Pressable
                    onPress={() => router.push("/pay-events")}
                    className="active:opacity-70"
                  >
                    <Text className="text-amber-500 text-sm font-medium">
                      View All
                    </Text>
                  </Pressable>
                </View>
                {recentEvents.map((event) => (
                  <RecentEventCard
                    key={event.id}
                    event={event}
                    onPress={() => router.push("/pay-events")}
                  />
                ))}
              </Animated.View>
            )}

            {/* Tip Banner */}
            <Animated.View
              entering={FadeInDown.duration(600).delay(650)}
              className="mx-5 mt-6 mb-4"
            >
              <View className="bg-blue-900/30 rounded-2xl p-4 border border-blue-700/30">
                <Text className="text-blue-300 text-sm leading-5">
                  <Text className="font-semibold">Tip:</Text> Log events as they
                  happen with evidence. Include rep names, contact times, and
                  screenshots when possible for stronger pay verification.
                </Text>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      {/* Phase 3: Premium Code Picker Modal */}
      <PremiumCodePicker
        visible={showPremiumCodePicker}
        onClose={() => setShowPremiumCodePicker(false)}
        onSelect={(selection) => {
          setSelectedPremiumCode(selection);
          setShowPremiumCodePicker(false);
        }}
        selectedCode={selectedPremiumCode?.code.code}
        changeType={selectedType ?? undefined}
      />

      {/* Auto Tutorial Modal */}
      {TutorialModalComponent}
    </View>
  );
}
