/**
 * Notification Settings Screen
 *
 * Comprehensive notification preferences for pilots including:
 * - Report Time Reminders (60m domestic / 90m intl)
 * - Pay Period Ending Reminders
 * - Payday Reminders with Big/Small Check
 * - Arrival Welcome notifications
 * - Quiet Hours configuration
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  FadeInDown,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  Bell,
  BellOff,
  ChevronLeft,
  Clock,
  Plane,
  Wallet,
  CalendarCheck,
  MapPin,
  Moon,
  FileText,
  TestTube,
  ChevronRight,
  Shield,
  Info,
  Lock,
} from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  GetNotificationSettingsResponse,
  UpdateNotificationSettingsRequest,
  UpdateNotificationSettingsResponse,
} from "@/lib/contracts";

// ============================================
// HOOKS
// ============================================

function useNotificationSettings() {
  return useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const response = await api.get<GetNotificationSettingsResponse>("/api/notifications/settings");
      return response.settings;
    },
  });
}

function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateNotificationSettingsRequest) => {
      const response = await api.put<UpdateNotificationSettingsResponse>(
        "/api/notifications/settings",
        data
      );
      return response.settings;
    },
    onSuccess: (newSettings) => {
      queryClient.setQueryData(["notification-settings"], newSettings);
    },
  });
}

// ============================================
// COMPONENTS
// ============================================

interface SettingsSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}

function SettingsSection({ title, icon, children, delay = 0 }: SettingsSectionProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(500).delay(delay)}
      className="mx-4 mb-6"
    >
      <View className="flex-row items-center mb-3 px-1">
        {icon}
        <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider ml-2">
          {title}
        </Text>
      </View>
      <View className="bg-slate-900/70 rounded-2xl border border-slate-700/40 overflow-hidden">
        {children}
      </View>
    </Animated.View>
  );
}

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
  isLast?: boolean;
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  locked = false,
  isLast = false,
}: ToggleRowProps) {
  const handleToggle = (newValue: boolean) => {
    if (locked) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onValueChange(newValue);
  };

  return (
    <View
      className={`px-4 py-3.5 ${!isLast ? "border-b border-slate-700/30" : ""}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center">
            <Text className={`text-base font-medium ${disabled ? "text-slate-500" : "text-white"}`}>
              {label}
            </Text>
            {locked && (
              <View className="ml-2 bg-amber-500/20 px-1.5 py-0.5 rounded flex-row items-center">
                <Lock size={10} color="#f59e0b" />
                <Text className="text-amber-500 text-[10px] font-semibold ml-0.5">LOCKED</Text>
              </View>
            )}
          </View>
          {description && (
            <Text className="text-slate-500 text-sm mt-0.5">{description}</Text>
          )}
        </View>
        <Switch
          value={value}
          onValueChange={handleToggle}
          disabled={disabled || locked}
          trackColor={{ false: "#334155", true: "#f59e0b" }}
          thumbColor={value ? "#fff" : "#94a3b8"}
          ios_backgroundColor="#334155"
        />
      </View>
    </View>
  );
}

interface TimePickerRowProps {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  isLast?: boolean;
}

function TimePickerRow({ label, value, onPress, disabled = false, isLast = false }: TimePickerRowProps) {
  return (
    <Pressable
      onPress={() => {
        if (!disabled) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={disabled}
      className={`px-4 py-3.5 flex-row items-center justify-between ${!isLast ? "border-b border-slate-700/30" : ""} active:opacity-70`}
    >
      <Text className={`text-base font-medium ${disabled ? "text-slate-500" : "text-white"}`}>
        {label}
      </Text>
      <View className="flex-row items-center">
        <Text className={`text-base ${disabled ? "text-slate-600" : "text-amber-500"} font-medium`}>
          {value}
        </Text>
        <ChevronRight size={18} color={disabled ? "#475569" : "#64748b"} />
      </View>
    </Pressable>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useNotificationSettings();
  const updateMutation = useUpdateNotificationSettings();

  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<"start" | "end">("start");
  const [tempTime, setTempTime] = useState<Date>(new Date());

  const parseTimeToDate = (timeStr: string): Date => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  };

  const formatDateToTime = (date: Date): string => {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  };

  const openTimePicker = (target: "start" | "end") => {
    const current = target === "start"
      ? (settings?.quietHoursStart ?? "22:00")
      : (settings?.quietHoursEnd ?? "07:00");
    setTempTime(parseTimeToDate(current));
    setTimePickerTarget(target);
    setTimePickerVisible(true);
  };

  // Check notification permissions
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === "web") {
      setPermissionStatus("denied");
      return;
    }

    const { status } = await Notifications.getPermissionsAsync();
    setPermissionStatus(status);
  };

  const requestPermissions = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Push notifications are not available on web.");
      return;
    }

    const { status } = await Notifications.requestPermissionsAsync();
    setPermissionStatus(status);

    if (status === "granted") {
      // Update backend
      updateMutation.mutate({ pushPermissionGranted: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Notifications Disabled",
        "Please enable notifications in your device settings to receive reminders."
      );
    }
  };

  const handleToggle = useCallback(
    (key: keyof UpdateNotificationSettingsRequest, value: boolean) => {
      updateMutation.mutate({ [key]: value });
    },
    [updateMutation]
  );

  const sendTestNotification = async () => {
    if (permissionStatus !== "granted") {
      Alert.alert("Enable Notifications", "Please enable notifications first.");
      return;
    }

    setIsSendingTest(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Schedule a local notification immediately
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Test Notification",
          body: "Notifications are working correctly!",
          sound: true,
        },
        trigger: null, // Immediate
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("[Notifications] Test failed:", err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", "Failed to send test notification.");
    } finally {
      setIsSendingTest(false);
    }
  };

  const isPermissionGranted = permissionStatus === "granted";

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e293b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeIn.duration(400)}
            style={{ paddingTop: insets.top + 12 }}
            className="px-4 pb-6"
          >
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <Bell size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-2xl font-bold text-center">
              Notifications
            </Text>
            <Text className="text-slate-400 text-sm mt-1 text-center">
              Stay informed about your schedule and pay
            </Text>
          </Animated.View>

          {/* Permission Banner */}
          {!isPermissionGranted && (
            <Animated.View
              entering={FadeInDown.duration(500).delay(100)}
              className="mx-4 mb-6"
            >
              <Pressable
                onPress={requestPermissions}
                className="bg-amber-500/20 border border-amber-500/40 rounded-2xl p-4 active:opacity-80"
              >
                <View className="flex-row items-center">
                  <View className="w-12 h-12 rounded-full bg-amber-500/30 items-center justify-center">
                    <BellOff size={24} color="#f59e0b" />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-amber-400 font-semibold text-base">
                      Enable Notifications
                    </Text>
                    <Text className="text-amber-500/70 text-sm mt-0.5">
                      Tap to allow push notifications for reminders
                    </Text>
                  </View>
                  <ChevronRight size={20} color="#f59e0b" />
                </View>
              </Pressable>
            </Animated.View>
          )}

          {/* Test Notification Button */}
          {isPermissionGranted && (
            <Animated.View
              entering={FadeInDown.duration(500).delay(150)}
              className="mx-4 mb-6"
            >
              <Pressable
                onPress={sendTestNotification}
                disabled={isSendingTest}
                className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 active:opacity-80"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-full bg-green-500/20 items-center justify-center">
                    {isSendingTest ? (
                      <ActivityIndicator size="small" color="#22c55e" />
                    ) : (
                      <TestTube size={20} color="#22c55e" />
                    )}
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-white font-semibold">
                      Send Test Notification
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      Verify notifications are working
                    </Text>
                  </View>
                  <View className="bg-green-500/20 px-3 py-1.5 rounded-lg">
                    <Text className="text-green-400 font-semibold text-sm">Test</Text>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          )}

          {/* Report Time Reminders */}
          <SettingsSection
            title="Report Time Reminders"
            icon={<Plane size={14} color="#64748b" />}
            delay={200}
          >
            <ToggleRow
              label="Report Time Reminder"
              description="60 min before domestic, 90 min before international"
              value={settings?.reportTimeReminderEnabled ?? true}
              onValueChange={(v) => handleToggle("reportTimeReminderEnabled", v)}
              disabled={!isPermissionGranted}
            />
            <View className="px-4 py-3 bg-slate-800/30">
              <View className="flex-row items-start">
                <Info size={14} color="#64748b" className="mt-0.5" />
                <Text className="text-slate-500 text-xs ml-2 flex-1">
                  Reminders are automatically scheduled based on your trip type. Domestic flights get 60 min lead time, international flights get 90 min.
                </Text>
              </View>
            </View>
          </SettingsSection>

          {/* Pay Period Ending */}
          <SettingsSection
            title="Pay Period Ending"
            icon={<CalendarCheck size={14} color="#64748b" />}
            delay={300}
          >
            <ToggleRow
              label="Pay Period Ending Reminder"
              description="Review premiums before the period closes"
              value={settings?.payPeriodEndingEnabled ?? true}
              onValueChange={(v) => handleToggle("payPeriodEndingEnabled", v)}
              disabled={!isPermissionGranted}
            />
            <ToggleRow
              label="48 Hours Before"
              value={settings?.payPeriodEndingHours48 ?? true}
              onValueChange={(v) => handleToggle("payPeriodEndingHours48", v)}
              disabled={!isPermissionGranted || !settings?.payPeriodEndingEnabled}
            />
            <ToggleRow
              label="24 Hours Before"
              description="Additional reminder"
              value={settings?.payPeriodEndingHours24 ?? false}
              onValueChange={(v) => handleToggle("payPeriodEndingHours24", v)}
              disabled={!isPermissionGranted || !settings?.payPeriodEndingEnabled}
              isLast
            />
          </SettingsSection>

          {/* Payday Reminders */}
          <SettingsSection
            title="Payday Reminders"
            icon={<Wallet size={14} color="#64748b" />}
            delay={400}
          >
            <ToggleRow
              label="Payday Reminder"
              description="Know when to expect your check"
              value={settings?.paydayReminderEnabled ?? true}
              onValueChange={(v) => handleToggle("paydayReminderEnabled", v)}
              disabled={!isPermissionGranted}
            />
            <ToggleRow
              label="2 Days Before"
              value={settings?.paydayReminder2DaysBefore ?? false}
              onValueChange={(v) => handleToggle("paydayReminder2DaysBefore", v)}
              disabled={!isPermissionGranted || !settings?.paydayReminderEnabled}
            />
            <ToggleRow
              label="1 Day Before"
              value={settings?.paydayReminder1DayBefore ?? true}
              onValueChange={(v) => handleToggle("paydayReminder1DayBefore", v)}
              disabled={!isPermissionGranted || !settings?.paydayReminderEnabled}
            />
            <ToggleRow
              label="Morning Of"
              value={settings?.paydayReminderMorningOf ?? true}
              onValueChange={(v) => handleToggle("paydayReminderMorningOf", v)}
              disabled={!isPermissionGranted || !settings?.paydayReminderEnabled}
              isLast
            />
            <View className="px-4 py-3 bg-slate-800/30">
              <View className="flex-row items-start">
                <Info size={14} color="#64748b" className="mt-0.5" />
                <Text className="text-slate-500 text-xs ml-2 flex-1">
                  Reminders include whether it's a Big Check (Settlement) or Small Check (Advance).
                </Text>
              </View>
            </View>
          </SettingsSection>

          {/* Arrival Welcome */}
          <SettingsSection
            title="Arrival Welcome"
            icon={<MapPin size={14} color="#64748b" />}
            delay={500}
          >
            <ToggleRow
              label="Arrival Welcome"
              description="Friendly greeting when you land"
              value={settings?.arrivalWelcomeEnabled ?? true}
              onValueChange={(v) => handleToggle("arrivalWelcomeEnabled", v)}
              disabled={!isPermissionGranted}
            />
            <ToggleRow
              label="Only When Confidence is HIGH"
              description="Prevents false arrival notifications"
              value={settings?.arrivalHighConfidenceOnly ?? true}
              onValueChange={() => {}}
              disabled={!isPermissionGranted || !settings?.arrivalWelcomeEnabled}
              locked
              isLast
            />
          </SettingsSection>

          {/* Pay Statement Ready */}
          <SettingsSection
            title="Pay Statement"
            icon={<FileText size={14} color="#64748b" />}
            delay={550}
          >
            <ToggleRow
              label="Pay Summary Ready"
              description="Notification when your pay summary is generated"
              value={settings?.payStatementReadyEnabled ?? true}
              onValueChange={(v) => handleToggle("payStatementReadyEnabled", v)}
              disabled={!isPermissionGranted}
              isLast
            />
          </SettingsSection>

          {/* Quiet Hours */}
          <SettingsSection
            title="Quiet Hours"
            icon={<Moon size={14} color="#64748b" />}
            delay={600}
          >
            <ToggleRow
              label="Quiet Hours"
              description="Silence notifications during rest"
              value={settings?.quietHoursEnabled ?? false}
              onValueChange={(v) => handleToggle("quietHoursEnabled", v)}
              disabled={!isPermissionGranted}
            />
            <TimePickerRow
              label="Start Time"
              value={settings?.quietHoursStart ?? "22:00"}
              onPress={() => openTimePicker("start")}
              disabled={!isPermissionGranted || !settings?.quietHoursEnabled}
            />
            <TimePickerRow
              label="End Time"
              value={settings?.quietHoursEnd ?? "07:00"}
              onPress={() => openTimePicker("end")}
              disabled={!isPermissionGranted || !settings?.quietHoursEnabled}
              isLast
            />
            <View className="px-4 py-3 bg-slate-800/30">
              <View className="flex-row items-start">
                <Info size={14} color="#64748b" className="mt-0.5" />
                <Text className="text-slate-500 text-xs ml-2 flex-1">
                  During quiet hours, notifications will be delayed until the end of the quiet period.
                </Text>
              </View>
            </View>
          </SettingsSection>

          {/* Global Settings */}
          <SettingsSection
            title="Global Settings"
            icon={<Shield size={14} color="#64748b" />}
            delay={650}
          >
            <ToggleRow
              label="Only Notify When Confidence is HIGH"
              description="Reduces notification noise from uncertain data"
              value={settings?.highConfidenceOnly ?? true}
              onValueChange={(v) => handleToggle("highConfidenceOnly", v)}
              disabled={!isPermissionGranted}
              isLast
            />
          </SettingsSection>

          {/* Footer Info */}
          <Animated.View
            entering={FadeInDown.duration(500).delay(700)}
            className="mx-4 mt-2"
          >
            <View className="bg-slate-800/30 rounded-xl p-4">
              <Text className="text-slate-500 text-xs text-center">
                Notifications are scheduled locally on your device based on your trip data. They work even when offline.
              </Text>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Time Picker Modal */}
        <Modal
          visible={timePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setTimePickerVisible(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
            onPress={() => setTimePickerVisible(false)}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View
                style={{ backgroundColor: "#1e293b", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16 }}
              >
                <View className="flex-row items-center justify-between px-6 pt-5 pb-2">
                  <Pressable onPress={() => setTimePickerVisible(false)}>
                    <Text className="text-slate-400 text-base font-medium">Cancel</Text>
                  </Pressable>
                  <Text className="text-white text-base font-semibold">
                    {timePickerTarget === "start" ? "Start Time" : "End Time"}
                  </Text>
                  <Pressable
                    onPress={() => {
                      const timeStr = formatDateToTime(tempTime);
                      if (timePickerTarget === "start") {
                        updateMutation.mutate({ quietHoursStart: timeStr });
                      } else {
                        updateMutation.mutate({ quietHoursEnd: timeStr });
                      }
                      setTimePickerVisible(false);
                    }}
                  >
                    <Text className="text-amber-500 text-base font-semibold">Done</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={tempTime}
                  mode="time"
                  display="spinner"
                  onChange={(_event, date) => {
                    if (date) setTempTime(date);
                  }}
                  style={{ height: 200 }}
                  textColor="#ffffff"
                  themeVariant="dark"
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </LinearGradient>
    </View>
  );
}
