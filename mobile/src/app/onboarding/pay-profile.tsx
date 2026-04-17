/**
 * Onboarding — Pay Profile
 *
 * Auto-populates pay data from the UPS contract benchmark engine.
 * User selects seat + pay year; values are instantly filled from contract data.
 * Optional: override hourly rate only.
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ChevronLeft, Edit3, CheckCircle2, Briefcase, TrendingUp } from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile } from "@/lib/state/profile-store";
import { api } from "@/lib/api";
import type { BenchmarkLookupResponse } from "@/lib/contracts";
import { computePayYearFromDOH } from "@/lib/payProfile";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1000) return `$${Math.round(dollars / 1000)}K`;
  return `$${dollars.toLocaleString()}`;
}

function fmtRate(cents: number): string {
  return `$${(cents / 100).toFixed(0)}/hr`;
}

// Map profile position ("FO" / "CPT") → benchmark seat ("FO" / "Captain")
function seatFromPosition(pos: string | null | undefined): "FO" | "Captain" {
  return pos === "CPT" ? "Captain" : "FO";
}

// Map benchmark seat back to display label
const SEAT_LABELS: Record<"FO" | "Captain", string> = {
  FO: "First Officer",
  Captain: "Captain",
};

// ─── sub-components ─────────────────────────────────────────────────────────

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

function SeatToggle({
  selected,
  onSelect,
}: {
  selected: "FO" | "Captain";
  onSelect: (s: "FO" | "Captain") => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {(["FO", "Captain"] as const).map((s) => {
        const active = selected === s;
        return (
          <Pressable
            key={s}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(s);
            }}
            style={{
              flex: 1,
              paddingVertical: 14,
              borderRadius: 14,
              borderWidth: 1.5,
              backgroundColor: active ? "rgba(245,158,11,0.12)" : "rgba(15,23,42,0.8)",
              borderColor: active ? "#f59e0b" : "#1e293b",
              alignItems: "center",
            }}
          >
            <Briefcase size={16} color={active ? "#f59e0b" : "#475569"} style={{ marginBottom: 4 }} />
            <Text style={{ color: active ? "#f59e0b" : "#94a3b8", fontWeight: "700", fontSize: 14 }}>
              {SEAT_LABELS[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function YearSelector({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (y: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingVertical: 4 }}
      style={{ flexGrow: 0 }}
    >
      {Array.from({ length: 15 }, (_, i) => i + 1).map((y) => {
        const active = selected === y;
        return (
          <Pressable
            key={y}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(y);
            }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              borderWidth: 1.5,
              backgroundColor: active ? "#f59e0b" : "rgba(15,23,42,0.8)",
              borderColor: active ? "#f59e0b" : "#1e293b",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: active ? "#0f172a" : "#64748b", fontWeight: "700", fontSize: 13 }}>
              {y}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface BenchmarkCardProps {
  benchmark: BenchmarkLookupResponse;
  seat: "FO" | "Captain";
  year: number;
  editedRateCents: number | null;
  isDohDerived?: boolean;
}

function BenchmarkCard({ benchmark, seat, year, editedRateCents, isDohDerived }: BenchmarkCardProps) {
  const displayRate = editedRateCents ?? benchmark.hourlyRateCents;
  const isEdited = editedRateCents !== null && editedRateCents !== benchmark.hourlyRateCents;

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      {/* Header */}
      <View
        style={{
          backgroundColor: "rgba(245,158,11,0.08)",
          borderRadius: 20,
          borderWidth: 1,
          borderColor: "rgba(245,158,11,0.2)",
          padding: 20,
          marginBottom: 12,
        }}
      >
        {/* Title */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
          <TrendingUp size={18} color="#f59e0b" />
          <Text style={{ color: "#f59e0b", fontWeight: "800", fontSize: 15, marginLeft: 8 }}>
            {SEAT_LABELS[seat]} — Year {year}
          </Text>
          {isDohDerived && (
            <View
              style={{
                marginLeft: 8,
                backgroundColor: "rgba(16,185,129,0.15)",
                borderRadius: 6,
                paddingHorizontal: 7,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: "#10b981", fontSize: 10, fontWeight: "700" }}>AUTO</Text>
            </View>
          )}
        </View>

        {/* Pay grid */}
        <View style={{ gap: 12 }}>
          <PayRow
            label="Hourly Rate"
            value={fmtRate(displayRate)}
            accent
            edited={isEdited}
          />
          <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
          <PayRow label="Guarantee Pay" value={fmt(benchmark.payAtGuaranteeCents) + "/yr"} />
          <PayRow label="Avg Line Pay" value={fmt(benchmark.avgLinePayCents) + "/yr"} />
          <PayRow label="Avg Total Pay" value={fmt(benchmark.avgTotalPayCents) + "/yr"} />
        </View>
      </View>

      {/* Source note */}
      {benchmark.sourceNote && (
        <Text
          style={{
            color: "#475569",
            fontSize: 11,
            textAlign: "center",
            lineHeight: 16,
            paddingHorizontal: 8,
          }}
        >
          Based on {benchmark.sourceNote}
        </Text>
      )}
    </Animated.View>
  );
}

function PayRow({
  label,
  value,
  accent,
  edited,
}: {
  label: string;
  value: string;
  accent?: boolean;
  edited?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: "#64748b", fontSize: 14 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {edited && (
          <View
            style={{
              backgroundColor: "rgba(59,130,246,0.2)",
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: "#60a5fa", fontSize: 10, fontWeight: "700" }}>CUSTOM</Text>
          </View>
        )}
        <Text
          style={{
            color: accent ? "#ffffff" : "#94a3b8",
            fontSize: accent ? 18 : 15,
            fontWeight: accent ? "800" : "600",
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

// ─── main screen ────────────────────────────────────────────────────────────

export default function OnboardingPayProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const updateProfile = useUpdateProfileMutation();

  // Seat derived from profile position, defaulting to FO
  const [seat, setSeat] = useState<"FO" | "Captain">(
    seatFromPosition(profile?.position)
  );

  // Auto-derive pay year from DOH using anniversary date logic
  const dohDerivedYear = computePayYearFromDOH(profile?.dateOfHire);
  const [year, setYear] = useState<number>(dohDerivedYear);
  const [benchmark, setBenchmark] = useState<BenchmarkLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [editedRateCents, setEditedRateCents] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editInput, setEditInput] = useState("");

  // Fetch benchmark whenever seat or year changes
  const fetchBenchmark = useCallback(async (s: "FO" | "Captain", y: number) => {
    setLoading(true);
    try {
      const data = await api.get<BenchmarkLookupResponse>(
        `/api/pay-benchmarks/lookup?seat=${s}&yearOfService=${y}`
      );
      setBenchmark(data);
      // Reset custom rate when selection changes
      setEditedRateCents(null);
    } catch {
      setBenchmark(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBenchmark(seat, year);
  }, [seat, year, fetchBenchmark]);

  const handleSeatChange = (s: "FO" | "Captain") => {
    setSeat(s);
    setEditedRateCents(null);
  };

  const handleYearChange = (y: number) => {
    setYear(y);
    setEditedRateCents(null);
  };

  const openEditModal = () => {
    if (!benchmark) return;
    const current = editedRateCents ?? benchmark.hourlyRateCents;
    setEditInput((current / 100).toFixed(0));
    setShowEditModal(true);
  };

  const confirmEdit = () => {
    const parsed = parseFloat(editInput);
    if (!isNaN(parsed) && parsed > 0) {
      setEditedRateCents(Math.round(parsed * 100));
    }
    setShowEditModal(false);
  };

  const handleUseValues = async () => {
    if (!benchmark) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const finalRateCents = editedRateCents ?? benchmark.hourlyRateCents;
    const isManual = editedRateCents !== null && editedRateCents !== benchmark.hourlyRateCents;

    // Map seat back to profile position
    const position = seat === "Captain" ? "CPT" : "FO";

    await updateProfile.mutateAsync({
      position,
      hourlyRateCents: finalRateCents,
      payYear: year,
      hourlyRateSource: isManual ? "manual" : "contract",
      onboardingStep: 4,
    });

    router.replace("/onboarding/goals");
  };

  const canContinue = benchmark !== null && !loading;

  return (
    <View style={{ flex: 1, backgroundColor: "#030712" }}>
      <LinearGradient colors={["#0c1421", "#0a1628", "#061220"]} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
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
              onPress={() => router.replace("/onboarding/career")}
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
            <ProgressBar step={3} total={5} />
            <View style={{ width: 40 }} />
          </View>

          {/* Title */}
          <Animated.View
            entering={FadeInDown.delay(100).springify()}
            style={{ paddingHorizontal: 24, marginBottom: 28 }}
          >
            <Text
              style={{
                color: "#64748b",
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 2,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Step 4 of 5
            </Text>
            <Text style={{ color: "#ffffff", fontSize: 28, fontWeight: "800", marginBottom: 8 }}>
              Set Your Pay Profile
            </Text>
            <Text style={{ color: "#64748b", fontSize: 15, lineHeight: 22 }}>
              We'll auto-fill your pay rates from the UPS contract — no guessing required.
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(200).springify()}
            style={{ paddingHorizontal: 24, gap: 20 }}
          >
            {/* Seat selector */}
            <View>
              <Text
                style={{ color: "#cbd5e1", fontWeight: "600", fontSize: 13, marginBottom: 10 }}
              >
                Seat
              </Text>
              <SeatToggle selected={seat} onSelect={handleSeatChange} />
            </View>

            {/* Pay year */}
            <View>
              <Text
                style={{ color: "#cbd5e1", fontWeight: "600", fontSize: 13, marginBottom: 10 }}
              >
                Pay Year
              </Text>
              <YearSelector selected={year} onSelect={handleYearChange} />
            </View>

            {/* Benchmark card */}
            <View style={{ marginTop: 4 }}>
              {loading ? (
                <View
                  style={{
                    backgroundColor: "rgba(15,23,42,0.8)",
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: "#1e293b",
                    padding: 40,
                    alignItems: "center",
                  }}
                >
                  <ActivityIndicator color="#f59e0b" />
                  <Text style={{ color: "#475569", marginTop: 12, fontSize: 14 }}>
                    Loading contract data…
                  </Text>
                </View>
              ) : benchmark ? (
                <BenchmarkCard
                  benchmark={benchmark}
                  seat={seat}
                  year={year}
                  editedRateCents={editedRateCents}
                  isDohDerived={year === dohDerivedYear && !!profile?.dateOfHire}
                />
              ) : (
                <View
                  style={{
                    backgroundColor: "rgba(239,68,68,0.08)",
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.2)",
                    padding: 24,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#f87171", fontSize: 14 }}>
                    Contract data unavailable. Please try again.
                  </Text>
                </View>
              )}
            </View>

            {/* Edit rate button */}
            {benchmark && !loading && (
              <Pressable
                onPress={openEditModal}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 12,
                }}
              >
                <Edit3 size={15} color="#475569" />
                <Text style={{ color: "#475569", fontSize: 14 }}>Edit Hourly Rate</Text>
              </Pressable>
            )}
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
            onPress={handleUseValues}
            disabled={!canContinue || updateProfile.isPending}
            style={{
              backgroundColor: canContinue ? "#f59e0b" : "#1e293b",
              borderRadius: 18,
              paddingVertical: 18,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {updateProfile.isPending ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <>
                <CheckCircle2 size={20} color={canContinue ? "#0f172a" : "#475569"} />
                <Text
                  style={{
                    color: canContinue ? "#0f172a" : "#475569",
                    fontWeight: "800",
                    fontSize: 17,
                  }}
                >
                  Use These Values
                </Text>
              </>
            )}
          </Pressable>
        </Animated.View>
      </LinearGradient>

      {/* Edit Rate Modal */}
      <Modal visible={showEditModal} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
        >
          <View
            style={{
              backgroundColor: "#0f172a",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 28,
              paddingBottom: insets.bottom + 28,
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "800", fontSize: 20, marginBottom: 6 }}>
              Edit Hourly Rate
            </Text>
            <Text style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
              Only your hourly rate will be adjusted. Guarantee and avg pay values reflect
              the contract and are not editable.
            </Text>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(30,41,59,0.8)",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#334155",
                paddingHorizontal: 16,
                paddingVertical: 14,
                marginBottom: 20,
                gap: 10,
              }}
            >
              <Text style={{ color: "#f59e0b", fontWeight: "800", fontSize: 20 }}>$</Text>
              <TextInput
                value={editInput}
                onChangeText={setEditInput}
                keyboardType="decimal-pad"
                placeholder={benchmark ? (benchmark.hourlyRateCents / 100).toFixed(0) : "0"}
                placeholderTextColor="#334155"
                style={{ flex: 1, color: "#ffffff", fontSize: 24, fontWeight: "700" }}
                autoFocus
              />
              <Text style={{ color: "#475569", fontSize: 16 }}>/hr</Text>
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                onPress={() => setShowEditModal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  borderRadius: 14,
                  backgroundColor: "rgba(30,41,59,0.8)",
                  borderWidth: 1,
                  borderColor: "#1e293b",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#64748b", fontWeight: "700" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmEdit}
                style={{
                  flex: 2,
                  paddingVertical: 16,
                  borderRadius: 14,
                  backgroundColor: "#f59e0b",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#0f172a", fontWeight: "800", fontSize: 16 }}>
                  Save Rate
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
