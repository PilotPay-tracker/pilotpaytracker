/**
 * Profile Setup Screen
 *
 * Required profile setup for new users.
 * Also used as the Settings edit screen.
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  User,
  IdCard,
  Calendar,
  DollarSign,
  Plane,
  MapPin,
  ChevronLeft,
  Check,
  Building2,
} from "lucide-react-native";
import { useProfileQuery, useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile, useIsProfileComplete } from "@/lib/state/profile-store";
import { positionValues, baseValues, type Position } from "@/lib/contracts";

// UPS is the only supported airline - locked at product level
const UPS_AIRLINE = "UPS" as const;

// Calculate retirement date (DOB + 65 years)
function calculateRetirementDate(dob: string): string {
  const date = new Date(dob + "T12:00:00");
  date.setFullYear(date.getFullYear() + 65);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Format date for display
function formatDateDisplay(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ToggleButtonGroupProps {
  options: readonly string[];
  selected: string | null;
  onSelect: (value: string) => void;
  labels?: Record<string, string>;
}

function ToggleButtonGroup({
  options,
  selected,
  onSelect,
  labels,
}: ToggleButtonGroupProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <Pressable
            key={option}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(option);
            }}
            className={`px-4 py-2 rounded-xl border ${
              isSelected
                ? "bg-amber-500 border-amber-500"
                : "bg-slate-800/60 border-slate-700"
            }`}
          >
            <Text
              className={`font-semibold ${
                isSelected ? "text-slate-900" : "text-slate-300"
              }`}
            >
              {labels?.[option] ?? option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isEditMode = params.mode === "edit";

  // Fetch profile
  const { isLoading: isLoadingProfile, refetch } = useProfileQuery();
  const profile = useProfile();
  const isComplete = useIsProfileComplete();
  const updateMutation = useUpdateProfileMutation();

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gemsId, setGemsId] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const [base, setBase] = useState<string | null>(null);
  // Airline is locked to UPS - not editable
  const [hourlyRate, setHourlyRate] = useState("");
  const [doh, setDoh] = useState<Date | null>(null);
  const [dob, setDob] = useState<Date | null>(null);

  // Date picker state
  const [showDohPicker, setShowDohPicker] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  // Temporary dates while picker is open (so scrolling doesn't immediately commit)
  const [tempDoh, setTempDoh] = useState<Date>(new Date());
  const [tempDob, setTempDob] = useState<Date>(new Date(1980, 0, 1));

  // Initialize form with existing profile data
  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName ?? "");
      setLastName(profile.lastName ?? "");
      setGemsId(profile.gemsId ?? "");
      setPosition((profile.position as Position) ?? null);
      setBase(profile.base ?? null);
      // Airline is always UPS - no need to set from profile
      setHourlyRate(
        profile.hourlyRateCents > 0
          ? (profile.hourlyRateCents / 100).toString()
          : ""
      );
      if (profile.dateOfHire) {
        setDoh(new Date(profile.dateOfHire + "T12:00:00"));
      }
      if (profile.dateOfBirth) {
        setDob(new Date(profile.dateOfBirth + "T12:00:00"));
      }
    }
  }, [profile]);

  // Validation
  const isFormValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    gemsId.trim().length > 0 &&
    position !== null &&
    (base !== null && base.trim().length > 0) &&
    doh !== null &&
    dob !== null &&
    parseFloat(hourlyRate) > 0;

  // Handle save
  const handleSave = useCallback(async () => {
    if (!isFormValid) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateMutation.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gemsId: gemsId.trim(),
        position: position!,
        base: base!,
        airline: UPS_AIRLINE, // Always UPS
        dateOfHire: doh!.toISOString().split("T")[0],
        dateOfBirth: dob!.toISOString().split("T")[0],
        hourlyRateCents: Math.round(parseFloat(hourlyRate) * 100),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate based on mode
      if (isEditMode) {
        router.back();
      } else {
        // First time setup - go through onboarding flow
        router.replace("/onboarding/airline-select");
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("[ProfileSetup] Save failed:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
      });
      // Show more detailed error message for debugging
      const errorMessage = error?.message || "Failed to save profile";
      Alert.alert(
        "Error",
        `${errorMessage}\n\nPlease try again or contact support if the issue persists.`
      );
    }
  }, [
    isFormValid,
    firstName,
    lastName,
    gemsId,
    position,
    base,
    doh,
    dob,
    hourlyRate,
    isEditMode,
    updateMutation,
    router,
  ]);

  // Format hourly rate on blur
  const handleRateBlur = () => {
    const rate = parseFloat(hourlyRate);
    if (!isNaN(rate) && rate > 0) {
      setHourlyRate(rate.toFixed(2));
    }
  };

  if (isLoadingProfile && !profile) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text className="text-slate-400 mt-4">Loading profile...</Text>
      </View>
    );
  }

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
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center justify-between mb-4">
              {isEditMode && (
                <Pressable
                  onPress={() => router.back()}
                  className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
                >
                  <ChevronLeft size={24} color="#f59e0b" />
                </Pressable>
              )}
              {!isEditMode && <View className="w-10" />}
              <View className="flex-1 items-center">
                <Plane size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">
              {isEditMode ? "Edit Profile" : "Profile Setup"}
            </Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              {isEditMode
                ? "Update your pilot information"
                : "Complete your profile to get started"}
            </Text>
          </Animated.View>

          {/* Form */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-5 mt-6"
          >
            {/* Identity Section */}
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Identity
            </Text>
            <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-6">
              {/* First Name */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <User size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">First Name</Text>
                </View>
                <TextInput
                  className="bg-slate-800/60 rounded-xl px-4 py-3 text-white text-base border border-slate-700/50"
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Enter first name"
                  placeholderTextColor="#64748b"
                  autoCapitalize="words"
                />
              </View>

              {/* Last Name */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <User size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Last Name</Text>
                </View>
                <TextInput
                  className="bg-slate-800/60 rounded-xl px-4 py-3 text-white text-base border border-slate-700/50"
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Enter last name"
                  placeholderTextColor="#64748b"
                  autoCapitalize="words"
                />
              </View>

              {/* GEMS ID */}
              <View>
                <View className="flex-row items-center mb-2">
                  <IdCard size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">GEMS ID</Text>
                </View>
                <TextInput
                  className="bg-slate-800/60 rounded-xl px-4 py-3 text-white text-base border border-slate-700/50"
                  value={gemsId}
                  onChangeText={setGemsId}
                  placeholder="Enter GEMS ID"
                  placeholderTextColor="#64748b"
                  autoCapitalize="characters"
                />
              </View>
            </View>

            {/* Dates Section */}
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Dates
            </Text>
            <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-6">
              {/* Date of Hire */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <Calendar size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Date of Hire</Text>
                </View>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTempDoh(doh ?? new Date());
                    setShowDohPicker(true);
                  }}
                  className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50"
                >
                  <Text className={doh ? "text-white" : "text-slate-500"}>
                    {doh ? formatDateDisplay(doh.toISOString().split("T")[0]) : "Select date"}
                  </Text>
                </Pressable>
              </View>

              {/* Date of Birth */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <Calendar size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Date of Birth</Text>
                </View>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTempDob(dob ?? new Date(1980, 0, 1));
                    setShowDobPicker(true);
                  }}
                  className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50"
                >
                  <Text className={dob ? "text-white" : "text-slate-500"}>
                    {dob ? formatDateDisplay(dob.toISOString().split("T")[0]) : "Select date"}
                  </Text>
                </Pressable>
              </View>

              {/* Retirement Date (calculated) */}
              {dob && (
                <View className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30">
                  <Text className="text-slate-500 text-xs uppercase tracking-wider mb-1">
                    Retirement Date (Age 65)
                  </Text>
                  <Text className="text-amber-500 text-base font-semibold">
                    {calculateRetirementDate(dob.toISOString().split("T")[0])}
                  </Text>
                </View>
              )}
            </View>

            {/* Date of Hire Picker Modal */}
            <Modal
              visible={showDohPicker}
              transparent
              animationType="slide"
            >
              <Pressable
                className="flex-1 bg-black/50 justify-end"
                onPress={() => setShowDohPicker(false)}
              >
                <Pressable
                  className="bg-slate-900 rounded-t-3xl"
                  onPress={(e) => e.stopPropagation()}
                >
                  <View className="flex-row justify-between items-center px-5 py-4 border-b border-slate-700">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowDohPicker(false);
                      }}
                    >
                      <Text className="text-slate-400 text-base font-medium">Cancel</Text>
                    </Pressable>
                    <Text className="text-white text-base font-semibold">Date of Hire</Text>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setDoh(tempDoh);
                        setShowDohPicker(false);
                      }}
                    >
                      <Text className="text-amber-500 text-base font-semibold">Done</Text>
                    </Pressable>
                  </View>
                  <DateTimePicker
                    value={tempDoh}
                    mode="date"
                    display="spinner"
                    onChange={(_, date) => {
                      if (date) setTempDoh(date);
                    }}
                    maximumDate={new Date()}
                    style={{ height: 200 }}
                    textColor="#fff"
                  />
                  <View style={{ height: insets.bottom + 20 }} />
                </Pressable>
              </Pressable>
            </Modal>

            {/* Date of Birth Picker Modal */}
            <Modal
              visible={showDobPicker}
              transparent
              animationType="slide"
            >
              <Pressable
                className="flex-1 bg-black/50 justify-end"
                onPress={() => setShowDobPicker(false)}
              >
                <Pressable
                  className="bg-slate-900 rounded-t-3xl"
                  onPress={(e) => e.stopPropagation()}
                >
                  <View className="flex-row justify-between items-center px-5 py-4 border-b border-slate-700">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowDobPicker(false);
                      }}
                    >
                      <Text className="text-slate-400 text-base font-medium">Cancel</Text>
                    </Pressable>
                    <Text className="text-white text-base font-semibold">Date of Birth</Text>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setDob(tempDob);
                        setShowDobPicker(false);
                      }}
                    >
                      <Text className="text-amber-500 text-base font-semibold">Done</Text>
                    </Pressable>
                  </View>
                  <DateTimePicker
                    value={tempDob}
                    mode="date"
                    display="spinner"
                    onChange={(_, date) => {
                      if (date) setTempDob(date);
                    }}
                    maximumDate={new Date()}
                    style={{ height: 200 }}
                    textColor="#fff"
                  />
                  <View style={{ height: insets.bottom + 20 }} />
                </Pressable>
              </Pressable>
            </Modal>

            {/* Pilot Settings Section */}
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Pilot Settings
            </Text>
            <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 mb-6">
              {/* Airline - Locked to UPS */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <Building2 size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Airline</Text>
                </View>
                <View className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50 flex-row items-center justify-between">
                  <Text className="text-white font-semibold">UPS</Text>
                  <View className="bg-amber-500/20 px-2 py-1 rounded">
                    <Text className="text-amber-500 text-xs font-semibold">LOCKED</Text>
                  </View>
                </View>
                <Text className="text-slate-500 text-xs mt-2">
                  Built by a UPS pilot for UPS pilots
                </Text>
              </View>

              {/* Position */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <Plane size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Position</Text>
                </View>
                <ToggleButtonGroup
                  options={positionValues}
                  selected={position}
                  onSelect={(v) => setPosition(v as Position)}
                  labels={{ FO: "First Officer", CPT: "Captain" }}
                />
              </View>

              {/* Base - UPS bases only */}
              <View className="mb-4">
                <View className="flex-row items-center mb-2">
                  <MapPin size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Base</Text>
                </View>
                <ToggleButtonGroup
                  options={baseValues}
                  selected={base}
                  onSelect={(v) => setBase(v)}
                />
              </View>

              {/* Hourly Rate */}
              <View>
                <View className="flex-row items-center mb-2">
                  <DollarSign size={16} color="#64748b" />
                  <Text className="text-slate-400 text-sm ml-2">Hourly Rate ($)</Text>
                </View>
                <TextInput
                  className="bg-slate-800/60 rounded-xl px-4 py-3 text-white text-base border border-slate-700/50"
                  value={hourlyRate}
                  onChangeText={setHourlyRate}
                  onBlur={handleRateBlur}
                  placeholder="325.00"
                  placeholderTextColor="#64748b"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </Animated.View>

          {/* Save Button */}
          <Animated.View
            entering={FadeInUp.duration(600).delay(400)}
            className="mx-5 mt-4"
          >
            <Pressable
              onPress={handleSave}
              disabled={!isFormValid || updateMutation.isPending}
              className={`rounded-2xl p-4 items-center flex-row justify-center ${
                isFormValid && !updateMutation.isPending
                  ? "bg-amber-500 active:opacity-80"
                  : "bg-slate-700"
              }`}
            >
              {updateMutation.isPending ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <>
                  <Check size={20} color={isFormValid ? "#0f172a" : "#64748b"} />
                  <Text
                    className={`font-bold text-lg ml-2 ${
                      isFormValid ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {isEditMode ? "Save Changes" : "Complete Setup"}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>

          {/* Current Settings Summary (Edit mode only) */}
          {isEditMode && profile && isComplete && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(500)}
              className="mx-5 mt-8"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Current Settings
              </Text>
              <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Name</Text>
                  <Text className="text-white font-medium">
                    {profile.firstName} {profile.lastName}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">GEMS ID</Text>
                  <Text className="text-white font-medium">{profile.gemsId}</Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Position</Text>
                  <Text className="text-white font-medium">
                    {profile.position === "CPT" ? "Captain" : "First Officer"}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Base</Text>
                  <Text className="text-white font-medium">{profile.base}</Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Hourly Rate</Text>
                  <Text className="text-amber-500 font-bold">
                    ${(profile.hourlyRateCents / 100).toFixed(2)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Date of Hire</Text>
                  <Text className="text-white font-medium">
                    {formatDateDisplay(profile.dateOfHire)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-slate-400 text-sm">Date of Birth</Text>
                  <Text className="text-white font-medium">
                    {formatDateDisplay(profile.dateOfBirth)}
                  </Text>
                </View>
                {profile.dateOfBirth && (
                  <View className="flex-row justify-between items-center pt-3 border-t border-slate-700/50">
                    <Text className="text-slate-400 text-sm">Retirement Date</Text>
                    <Text className="text-green-400 font-semibold">
                      {calculateRetirementDate(profile.dateOfBirth)}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
