/**
 * Onboarding Step 3 — Career Details
 *
 * Collects: date of hire, date of birth, hourly rate.
 * Saves to backend with onboardingStep: 3 then navigates to goals.
 */

import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ChevronLeft, Calendar, DollarSign, ChevronRight } from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile } from "@/lib/state/profile-store";

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i < step ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i < step ? "#f59e0b" : "#1e293b",
          }}
        />
      ))}
    </View>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "Select date";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DatePickerField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Date | null;
  onChange: (d: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(value ?? new Date(2000, 0, 1));

  const hasValue = value !== null;

  return (
    <View>
      <View style={{ marginBottom: 8 }}>
        <Text style={{ color: "#cbd5e1", fontWeight: "600", fontSize: 13 }}>{label}</Text>
        {hint && <Text style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>{hint}</Text>}
      </View>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setOpen(true);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "rgba(15,23,42,0.8)",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: hasValue ? "#334155" : "#1e293b",
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
        }}
      >
        <Calendar size={18} color={hasValue ? "#f59e0b" : "#475569"} />
        <Text style={{ flex: 1, color: hasValue ? "#ffffff" : "#334155", fontSize: 16 }}>
          {formatDate(value)}
        </Text>
        <ChevronRight size={16} color="#475569" />
      </Pressable>

      {Platform.OS === "ios" ? (
        <Modal visible={open} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
            <View
              style={{
                backgroundColor: "#0f172a",
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                padding: 24,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
                <Pressable onPress={() => setOpen(false)}>
                  <Text style={{ color: "#64748b", fontSize: 16 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    onChange(tempDate);
                    setOpen(false);
                  }}
                >
                  <Text style={{ color: "#f59e0b", fontWeight: "700", fontSize: 16 }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                mode="date"
                display="spinner"
                value={tempDate}
                onChange={(_, d) => d && setTempDate(d)}
                maximumDate={new Date()}
                textColor="#ffffff"
                style={{ height: 180 }}
              />
            </View>
          </View>
        </Modal>
      ) : (
        open && (
          <DateTimePicker
            mode="date"
            display="default"
            value={tempDate}
            onChange={(_, d) => {
              setOpen(false);
              if (d) onChange(d);
            }}
            maximumDate={new Date()}
          />
        )
      )}
    </View>
  );
}

// Hourly rate options derived from UPS pay tables
const RATE_OPTIONS = [
  { label: "Year 1 FO — $93.97", cents: 9397 },
  { label: "Year 5 FO — $148.69", cents: 14869 },
  { label: "Year 10 FO — $202.01", cents: 20201 },
  { label: "Year 1 CPT — $211.40", cents: 21140 },
  { label: "Year 5 CPT — $267.54", cents: 26754 },
  { label: "Year 10 CPT — $325.00", cents: 32500 },
];

export default function OnboardingCareerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const updateProfile = useUpdateProfileMutation();

  const parseDate = (s: string | null | undefined): Date | null => {
    if (!s) return null;
    const d = new Date(s + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  };

  const [dateOfHire, setDateOfHire] = useState<Date | null>(parseDate(profile?.dateOfHire));
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(parseDate(profile?.dateOfBirth));
  const [rateCents, setRateCents] = useState<number | null>(
    profile?.hourlyRateCents && profile.hourlyRateCents > 0 ? profile.hourlyRateCents : null
  );

  const canContinue = dateOfHire !== null && dateOfBirth !== null && rateCents !== null;

  const toDateStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const handleContinue = async () => {
    if (!canContinue) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await updateProfile.mutateAsync({
      dateOfHire: toDateStr(dateOfHire!),
      dateOfBirth: toDateStr(dateOfBirth!),
      hourlyRateCents: rateCents!,
      onboardingStep: 3,
    });
    router.replace("/onboarding/goals");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#030712" }}>
      <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View
            style={{
              paddingTop: insets.top + 16,
              paddingHorizontal: 24,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 32,
            }}
          >
            <Pressable
              onPress={() => router.replace("/onboarding/pilot-profile")}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(30,41,59,0.8)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ChevronLeft size={20} color="#94a3b8" />
            </Pressable>
            <ProgressBar step={2} total={4} />
            <View style={{ width: 40 }} />
          </View>

          <Animated.View entering={FadeInDown.delay(100).springify()} style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
              Step 3 of 4
            </Text>
            <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
              Career Details
            </Text>
            <Text style={{ color: "#64748b", fontSize: 15, lineHeight: 22 }}>
              Used for seniority tracking, retirement projections, and accurate pay calculations.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).springify()} style={{ paddingHorizontal: 24, gap: 24 }}>
            <DatePickerField
              label="Date of Hire"
              hint="Your UPS seniority date"
              value={dateOfHire}
              onChange={setDateOfHire}
            />

            <DatePickerField
              label="Date of Birth"
              hint="Used to calculate your retirement date"
              value={dateOfBirth}
              onChange={setDateOfBirth}
            />

            {/* Hourly rate */}
            <View>
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: "#cbd5e1", fontWeight: "600", fontSize: 13 }}>Hourly Rate</Text>
                <Text style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>
                  Select your current rate from the UPS pay table
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                {RATE_OPTIONS.map((opt) => {
                  const active = rateCents === opt.cents;
                  return (
                    <Pressable
                      key={opt.cents}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setRateCents(opt.cents);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: active ? "rgba(245,158,11,0.12)" : "rgba(15,23,42,0.8)",
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: active ? "#f59e0b" : "#1e293b",
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        gap: 12,
                      }}
                    >
                      <DollarSign size={16} color={active ? "#f59e0b" : "#475569"} />
                      <Text style={{ flex: 1, color: active ? "#ffffff" : "#94a3b8", fontSize: 15 }}>
                        {opt.label}
                      </Text>
                      {active && (
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: "#f59e0b",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: "#0f172a", fontWeight: "800", fontSize: 12 }}>✓</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {/* Footer CTA */}
        <Animated.View
          entering={FadeInUp.delay(300).springify()}
          style={{
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 16,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(6,18,32,0.95)",
          }}
        >
          <Pressable
            onPress={handleContinue}
            disabled={!canContinue || updateProfile.isPending}
            style={{
              backgroundColor: canContinue ? "#f59e0b" : "#1e293b",
              borderRadius: 18,
              paddingVertical: 18,
              alignItems: "center",
            }}
          >
            {updateProfile.isPending ? (
              <ActivityIndicator color={canContinue ? "#0f172a" : "#475569"} />
            ) : (
              <Text style={{ color: canContinue ? "#0f172a" : "#475569", fontWeight: "800", fontSize: 17 }}>
                Continue →
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}
