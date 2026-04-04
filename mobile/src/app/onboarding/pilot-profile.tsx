/**
 * Onboarding Step 2 — Pilot Profile
 *
 * Collects: first name, last name, GEMS ID, position, base.
 * Saves to backend with onboardingStep: 2 then navigates to career.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ChevronLeft, User, Hash, MapPin } from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile } from "@/lib/state/profile-store";
import { positionValues, baseValues, type Position, type Base } from "@/lib/contracts";

const BASE_LABELS: Record<string, string> = {
  ANC: "ANC — Anchorage",
  ONT: "ONT — Ontario",
  SDF: "SDF — Louisville",
  SDFZ: "SDFZ — Louisville (Int'l)",
  MIA: "MIA — Miami",
};

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View className="flex-row items-center gap-2">
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

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <View className="mb-2">
      <Text style={{ color: "#cbd5e1", fontWeight: "600", fontSize: 13 }}>{label}</Text>
      {hint && <Text style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>{hint}</Text>}
    </View>
  );
}

function StyledInput({
  value,
  onChangeText,
  placeholder,
  icon: Icon,
  keyboardType,
  autoCapitalize,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  icon: typeof User;
  keyboardType?: "default" | "number-pad";
  autoCapitalize?: "none" | "words";
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(15,23,42,0.8)",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#1e293b",
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
      }}
    >
      <Icon size={18} color="#475569" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#334155"
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        style={{ flex: 1, color: "#ffffff", fontSize: 16 }}
      />
    </View>
  );
}

function ToggleGroup<T extends string>({
  options,
  selected,
  onSelect,
  labels,
}: {
  options: readonly T[];
  selected: T | null;
  onSelect: (v: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const active = selected === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(opt);
            }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 12,
              borderWidth: 1,
              backgroundColor: active ? "#f59e0b" : "rgba(15,23,42,0.8)",
              borderColor: active ? "#f59e0b" : "#1e293b",
            }}
          >
            <Text style={{ color: active ? "#0f172a" : "#94a3b8", fontWeight: "600", fontSize: 14 }}>
              {labels?.[opt] ?? opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function OnboardingPilotProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const updateProfile = useUpdateProfileMutation();

  const [firstName, setFirstName] = useState(profile?.firstName ?? "");
  const [lastName, setLastName] = useState(profile?.lastName ?? "");
  const [gemsId, setGemsId] = useState(profile?.gemsId ?? "");
  const [position, setPosition] = useState<Position | null>(
    (profile?.position as Position | null) ?? null
  );
  const [base, setBase] = useState<Base | null>((profile?.base as Base | null) ?? null);

  const canContinue =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    gemsId.trim().length > 0 &&
    position !== null &&
    base !== null;

  const handleContinue = async () => {
    if (!canContinue) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await updateProfile.mutateAsync({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gemsId: gemsId.trim(),
      position,
      base,
      onboardingStep: 2,
    });
    router.replace("/onboarding/career");
  };

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            className="flex-1"
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
                onPress={() => router.replace("/onboarding")}
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
              <ProgressBar step={1} total={4} />
              <View style={{ width: 40 }} />
            </View>

            <Animated.View entering={FadeInDown.delay(100).springify()} style={{ paddingHorizontal: 24, marginBottom: 32 }}>
              <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                Step 2 of 4
              </Text>
              <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
                Pilot Profile
              </Text>
              <Text style={{ color: "#64748b", fontSize: 15, lineHeight: 22 }}>
                This personalizes your pay calculations and contract matching.
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()} style={{ paddingHorizontal: 24, gap: 20 }}>
              {/* Name row */}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <FieldLabel label="First Name" />
                  <StyledInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Parker"
                    icon={User}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FieldLabel label="Last Name" />
                  <StyledInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Davis"
                    icon={User}
                  />
                </View>
              </View>

              {/* GEMS ID */}
              <View>
                <FieldLabel label="GEMS ID" hint="Your UPS employee number" />
                <StyledInput
                  value={gemsId}
                  onChangeText={setGemsId}
                  placeholder="12345"
                  icon={Hash}
                  keyboardType="number-pad"
                  autoCapitalize="none"
                />
              </View>

              {/* Position */}
              <View>
                <FieldLabel label="Position" />
                <ToggleGroup<Position>
                  options={positionValues}
                  selected={position}
                  onSelect={setPosition}
                  labels={{ FO: "First Officer", CPT: "Captain" }}
                />
              </View>

              {/* Base */}
              <View>
                <FieldLabel label="Domicile Base" />
                <ToggleGroup<Base>
                  options={baseValues}
                  selected={base}
                  onSelect={setBase}
                  labels={BASE_LABELS}
                />
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
                <Text
                  style={{
                    color: canContinue ? "#0f172a" : "#475569",
                    fontWeight: "800",
                    fontSize: 17,
                  }}
                >
                  Continue →
                </Text>
              )}
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}
