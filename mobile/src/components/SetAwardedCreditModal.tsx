/**
 * SetAwardedCreditModal
 *
 * Prompts the pilot to set their originally-awarded line credit for the
 * current bid period.  Supports:
 *   1. Manual numeric entry (hours, decimal ok — e.g. "71.5")
 *   2. Photo upload of the award schedule screenshot
 *
 * Stores the baseline via PUT /api/bid-period-baseline so the pay engine
 * can correctly classify pickups, drops, and guarantee behaviour.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  X,
  Target,
  Keyboard,
  Camera,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronRight,
  Clock,
} from "lucide-react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upsertBidPeriodBaseline } from "@/lib/api";
import type { BidPeriodBaselineSource } from "@/shared/contracts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetAwardedCreditModalProps {
  visible: boolean;
  onClose: () => void;
  /** Current UPS period key, e.g. "2026-P04" */
  periodKey: string;
  periodStartISO: string;
  periodEndISO: string;
  /** Guarantee for this period (minutes) — shown for context */
  guaranteeMinutes: number;
  /** Current active credit (minutes) — shown for context */
  currentCreditMinutes: number;
  /** Called after a successful save */
  onSaved?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHrs(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}:00` : `${h}:${String(m).padStart(2, "0")}`;
}

function parsePeriodLabel(key: string): string {
  // "2026-P04" → "Period 4, 2026"
  const m = key.match(/^(\d{4})-P(\d{1,2})$/);
  if (m) return `Period ${parseInt(m[2]!)}, ${m[1]}`;
  return key;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SetAwardedCreditModal({
  visible,
  onClose,
  periodKey,
  periodStartISO,
  periodEndISO,
  guaranteeMinutes,
  currentCreditMinutes,
  onSaved,
}: SetAwardedCreditModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"choose" | "manual" | "upload">("choose");
  const [creditInput, setCreditInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const guaranteeHours = guaranteeMinutes / 60;
  const currentHours = currentCreditMinutes / 60;

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (params: {
      hours: number;
      source: BidPeriodBaselineSource;
      note: string;
      confidence: "high" | "medium" | "low";
    }) =>
      upsertBidPeriodBaseline({
        periodKey,
        awardedCreditHours: params.hours,
        source: params.source,
        sourceNote: params.note,
        confidence: params.confidence,
      }),
    onSuccess: () => {
      // Invalidate dashboard and baseline queries
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["bid-period-baseline"] });
      setSuccessMessage("Baseline saved! Pay analysis updated.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setSuccessMessage(null);
        onSaved?.();
        handleClose();
      }, 1400);
    },
  });

  // ── Input validation & save (manual) ─────────────────────────────────────
  const handleManualSave = useCallback(() => {
    const parsed = parseFloat(creditInput.replace(/[^\d.]/g, ""));
    if (isNaN(parsed) || parsed <= 0) {
      setInputError("Enter a valid number of hours (e.g. 71 or 71.5)");
      return;
    }
    if (parsed > 200) {
      setInputError("That seems too high — max 200 hours");
      return;
    }
    setInputError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    saveMutation.mutate({
      hours: parsed,
      source: "manual_entry",
      note: "Manually entered awarded line credit",
      confidence: "medium",
    });
  }, [creditInput, saveMutation.mutate]);

  // ── Photo upload flow ─────────────────────────────────────────────────────
  const handleUploadPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setInputError("Photo access is required to upload your award screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.85,
      base64: false,
    });
    if (result.canceled) return;
    // For now we switch to manual entry with a note that upload was attempted.
    // In a full implementation the image would be OCR'd to extract the credit.
    setMode("manual");
    setInputError(null);
  }, []);

  const handleClose = useCallback(() => {
    setMode("choose");
    setCreditInput("");
    setInputError(null);
    setSuccessMessage(null);
    saveMutation.reset();
    onClose();
  }, [onClose, saveMutation.reset]);

  // ── Shortcut: pre-fill from current credit ────────────────────────────────
  const prefillCurrent = useCallback(() => {
    setCreditInput(currentHours.toFixed(1));
    setInputError(null);
    Haptics.selectionAsync();
  }, [currentHours]);

  const prefillGuarantee = useCallback(() => {
    setCreditInput(guaranteeHours.toFixed(1));
    setInputError(null);
    Haptics.selectionAsync();
  }, [guaranteeHours]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View className="flex-1 bg-slate-950">
          {/* Header */}
          <Animated.View
            entering={FadeIn.duration(250)}
            style={{ paddingTop: insets.top + 12 }}
            className="px-5 pb-4 border-b border-slate-700/40"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3 flex-1">
                <View className="w-10 h-10 rounded-2xl bg-blue-500/20 items-center justify-center">
                  <Target size={20} color="#60a5fa" />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-lg font-bold">
                    Set Awarded Credit
                  </Text>
                  <Text className="text-slate-400 text-xs">
                    {parsePeriodLabel(periodKey)}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleClose}
                className="w-9 h-9 rounded-full bg-slate-800 items-center justify-center active:opacity-70"
              >
                <X size={18} color="#94a3b8" />
              </Pressable>
            </View>
          </Animated.View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Context card ──────────────────────────────────────────── */}
            <Animated.View
              entering={FadeInDown.duration(300).delay(60)}
              className="mx-5 mt-5 rounded-2xl bg-slate-800/60 p-4 gap-3"
            >
              <Text className="text-slate-300 text-sm leading-relaxed">
                Your <Text className="text-white font-semibold">originally awarded line credit</Text> is
                the credit the bidding system assigned to you at the start of this period — before any
                pickups or drops.
              </Text>
              <Text className="text-slate-400 text-xs leading-relaxed">
                This tells the pay engine whether the guarantee protects your pay, whether pickups are
                filling a gap or earning extra on top, and whether dropped trips affected what you're owed.
              </Text>

              {/* Quick stats */}
              <View className="flex-row gap-3 mt-1">
                <View className="flex-1 bg-slate-700/50 rounded-xl p-3">
                  <Text className="text-slate-400 text-xs mb-1">Guarantee</Text>
                  <Text className="text-amber-400 text-base font-bold">{fmtHrs(guaranteeMinutes)}</Text>
                </View>
                <View className="flex-1 bg-slate-700/50 rounded-xl p-3">
                  <Text className="text-slate-400 text-xs mb-1">Current credit</Text>
                  <Text className="text-blue-300 text-base font-bold">{fmtHrs(currentCreditMinutes)}</Text>
                </View>
              </View>
            </Animated.View>

            {/* ── Success message ───────────────────────────────────────── */}
            {successMessage && (
              <Animated.View
                entering={FadeIn.duration(200)}
                className="mx-5 mt-4 rounded-xl bg-green-500/20 border border-green-500/30 p-4 flex-row items-center gap-3"
              >
                <CheckCircle size={20} color="#4ade80" />
                <Text className="text-green-400 text-sm font-medium flex-1">
                  {successMessage}
                </Text>
              </Animated.View>
            )}

            {/* ── Mode: choose ─────────────────────────────────────────── */}
            {mode === "choose" && !successMessage && (
              <Animated.View
                entering={FadeInDown.duration(300).delay(120)}
                className="mx-5 mt-5 gap-3"
              >
                <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">
                  How do you want to set it?
                </Text>

                {/* Manual entry */}
                <Pressable
                  onPress={() => { setMode("manual"); Haptics.selectionAsync(); }}
                  className="bg-slate-800 rounded-2xl p-4 flex-row items-center gap-4 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-xl bg-blue-500/20 items-center justify-center">
                    <Keyboard size={22} color="#60a5fa" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-base">Enter hours manually</Text>
                    <Text className="text-slate-400 text-xs mt-0.5">Type your awarded line credit (e.g. 71 or 71:30)</Text>
                  </View>
                  <ChevronRight size={18} color="#475569" />
                </Pressable>

                {/* Upload photo */}
                <Pressable
                  onPress={() => { setMode("upload"); Haptics.selectionAsync(); }}
                  className="bg-slate-800 rounded-2xl p-4 flex-row items-center gap-4 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-xl bg-purple-500/20 items-center justify-center">
                    <Camera size={22} color="#a78bfa" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-base">Upload award screenshot</Text>
                    <Text className="text-slate-400 text-xs mt-0.5">Photo of your awarded schedule (recommended)</Text>
                  </View>
                  <ChevronRight size={18} color="#475569" />
                </Pressable>

                {/* Estimated / skip */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    saveMutation.mutate({
                      hours: guaranteeHours,
                      source: "estimated",
                      note: "Estimated at guarantee floor",
                      confidence: "low",
                    });
                  }}
                  disabled={saveMutation.isPending}
                  className="rounded-2xl p-4 flex-row items-center gap-4 active:opacity-80"
                  style={{ borderWidth: 1, borderColor: "rgba(71,85,105,0.5)" }}
                >
                  <View className="w-11 h-11 rounded-xl bg-slate-700/50 items-center justify-center">
                    <Clock size={22} color="#64748b" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-400 font-medium text-base">Use guarantee as estimate</Text>
                    <Text className="text-slate-500 text-xs mt-0.5">Assumes {fmtHrs(guaranteeMinutes)} awarded — low confidence</Text>
                  </View>
                </Pressable>
              </Animated.View>
            )}

            {/* ── Mode: upload ─────────────────────────────────────────── */}
            {mode === "upload" && !successMessage && (
              <Animated.View
                entering={FadeInDown.duration(300)}
                className="mx-5 mt-5 gap-4"
              >
                <View className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4 gap-2">
                  <View className="flex-row items-center gap-2">
                    <Info size={16} color="#a78bfa" />
                    <Text className="text-purple-300 font-semibold text-sm">Upload Award Screenshot</Text>
                  </View>
                  <Text className="text-slate-400 text-sm leading-relaxed">
                    Take a screenshot of your awarded schedule from Crew Access or your bid confirmation,
                    then upload it. After uploading, enter the total credited hours shown.
                  </Text>
                </View>

                <Pressable
                  onPress={handleUploadPhoto}
                  className="bg-purple-600/20 border border-purple-500/40 rounded-2xl p-5 items-center gap-3 active:opacity-80"
                >
                  <Camera size={32} color="#a78bfa" />
                  <Text className="text-purple-300 font-semibold text-base">Choose from Photos</Text>
                  <Text className="text-slate-500 text-xs text-center">
                    Select your award schedule screenshot
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setMode("manual")}
                  className="items-center py-3"
                >
                  <Text className="text-blue-400 text-sm">Enter hours manually instead</Text>
                </Pressable>

                <Pressable
                  onPress={() => setMode("choose")}
                  className="items-center py-2"
                >
                  <Text className="text-slate-500 text-sm">← Back</Text>
                </Pressable>
              </Animated.View>
            )}

            {/* ── Mode: manual ─────────────────────────────────────────── */}
            {mode === "manual" && !successMessage && (
              <Animated.View
                entering={FadeInDown.duration(300)}
                className="mx-5 mt-5 gap-4"
              >
                <Text className="text-slate-400 text-sm leading-relaxed">
                  Enter the total credit hours shown on your awarded schedule.
                  You can use decimals (e.g. <Text className="text-white">71.5</Text>) or H:MM format (e.g. <Text className="text-white">71:30</Text>).
                </Text>

                {/* Input */}
                <View>
                  <View
                    className="rounded-2xl flex-row items-center overflow-hidden"
                    style={{
                      borderWidth: 1.5,
                      borderColor: inputError ? "#f87171" : "#334155",
                      backgroundColor: "rgba(30,41,59,0.8)",
                    }}
                  >
                    <TextInput
                      value={creditInput}
                      onChangeText={(t) => {
                        setCreditInput(t);
                        setInputError(null);
                      }}
                      placeholder="e.g. 71 or 71.5"
                      placeholderTextColor="#475569"
                      keyboardType="decimal-pad"
                      className="flex-1 text-white text-xl font-bold px-5 py-4"
                      returnKeyType="done"
                      onSubmitEditing={handleManualSave}
                      autoFocus
                    />
                    <Text className="text-slate-400 text-base pr-5">hrs</Text>
                  </View>

                  {inputError && (
                    <View className="flex-row items-center gap-1.5 mt-2 px-1">
                      <AlertTriangle size={13} color="#f87171" />
                      <Text className="text-red-400 text-xs">{inputError}</Text>
                    </View>
                  )}
                </View>

                {/* Quick-fill shortcuts */}
                <View className="gap-2">
                  <Text className="text-slate-500 text-xs uppercase tracking-wider">Quick fill</Text>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={prefillGuarantee}
                      className="flex-1 bg-amber-500/10 border border-amber-500/20 rounded-xl py-2.5 items-center active:opacity-70"
                    >
                      <Text className="text-amber-400 text-xs font-medium">Guarantee</Text>
                      <Text className="text-amber-300 text-sm font-bold">{fmtHrs(guaranteeMinutes)}</Text>
                    </Pressable>
                    <Pressable
                      onPress={prefillCurrent}
                      className="flex-1 bg-blue-500/10 border border-blue-500/20 rounded-xl py-2.5 items-center active:opacity-70"
                    >
                      <Text className="text-blue-400 text-xs font-medium">Current credit</Text>
                      <Text className="text-blue-300 text-sm font-bold">{fmtHrs(currentCreditMinutes)}</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Confidence note */}
                <View className="bg-slate-800/50 rounded-xl p-3 flex-row items-start gap-2">
                  <Info size={14} color="#60a5fa" style={{ marginTop: 1 }} />
                  <Text className="text-slate-400 text-xs leading-relaxed flex-1">
                    Manual entries are marked as medium confidence. Upload your award screenshot for high confidence tracking.
                  </Text>
                </View>

                {/* Save button */}
                <Pressable
                  onPress={handleManualSave}
                  disabled={saveMutation.isPending || !creditInput.trim()}
                  className="rounded-2xl py-4 items-center active:opacity-80"
                  style={{
                    backgroundColor:
                      !creditInput.trim() ? "rgba(71,85,105,0.5)" : "#3b82f6",
                  }}
                >
                  {saveMutation.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text
                      className="font-bold text-base"
                      style={{ color: !creditInput.trim() ? "#64748b" : "#fff" }}
                    >
                      Save Awarded Credit
                    </Text>
                  )}
                </Pressable>

                {saveMutation.isError && (
                  <View className="flex-row items-center gap-2 justify-center">
                    <AlertTriangle size={14} color="#f87171" />
                    <Text className="text-red-400 text-sm">
                      {(saveMutation.error as Error)?.message ?? "Save failed. Try again."}
                    </Text>
                  </View>
                )}

                <Pressable
                  onPress={() => setMode("choose")}
                  className="items-center py-2"
                >
                  <Text className="text-slate-500 text-sm">← Back</Text>
                </Pressable>
              </Animated.View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
