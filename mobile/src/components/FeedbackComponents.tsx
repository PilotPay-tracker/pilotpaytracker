/**
 * Feedback Components
 *
 * Reusable UI components for collecting user feedback to improve AI.
 * These components make it easy to add feedback collection anywhere in the app.
 */

import { useState, useCallback } from "react";
import { View, Text, Pressable, Modal, TextInput } from "react-native";
import { ThumbsUp, ThumbsDown, X, MessageSquare, Star } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { webSafeExit } from "@/lib/webSafeAnimation";
import {
  useExplanationFeedback,
  useSuggestionOutcome,
  type ExplanationType,
  type SuggestionType,
  type DismissReason,
} from "@/lib/useFeedback";

// ============================================
// Quick Thumbs Feedback (Inline)
// ============================================

interface QuickFeedbackProps {
  explanationType: ExplanationType;
  entityId: string;
  onFeedbackSubmitted?: (wasHelpful: boolean) => void;
  size?: "sm" | "md";
  label?: string;
}

/**
 * Inline thumbs up/down feedback for explanations
 * Use this after AI-generated content
 */
export function QuickFeedback({
  explanationType,
  entityId,
  onFeedbackSubmitted,
  size = "md",
  label = "Was this helpful?",
}: QuickFeedbackProps) {
  const [submitted, setSubmitted] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState<boolean | null>(null);
  const feedbackMutation = useExplanationFeedback();

  const iconSize = size === "sm" ? 16 : 20;
  const buttonSize = size === "sm" ? "p-1.5" : "p-2";

  const handleFeedback = useCallback(
    async (wasHelpful: boolean) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedFeedback(wasHelpful);
      setSubmitted(true);

      try {
        await feedbackMutation.mutateAsync({
          explanationType,
          entityId,
          wasHelpful,
        });
        onFeedbackSubmitted?.(wasHelpful);
      } catch (error) {
        console.error("[QuickFeedback] Failed to submit:", error);
      }
    },
    [explanationType, entityId, feedbackMutation, onFeedbackSubmitted]
  );

  if (submitted) {
    return (
      <Animated.View entering={FadeIn} className="flex-row items-center gap-2">
        <Text className="text-slate-400 text-xs">
          {selectedFeedback ? "Thanks!" : "We'll improve this"}
        </Text>
        {selectedFeedback ? (
          <ThumbsUp size={iconSize} color="#22c55e" fill="#22c55e" />
        ) : (
          <ThumbsDown size={iconSize} color="#f59e0b" fill="#f59e0b" />
        )}
      </Animated.View>
    );
  }

  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-slate-500 text-xs">{label}</Text>
      <Pressable
        onPress={() => handleFeedback(true)}
        className={`${buttonSize} rounded-full bg-slate-800/50 active:bg-green-900/30`}
      >
        <ThumbsUp size={iconSize} color="#94a3b8" />
      </Pressable>
      <Pressable
        onPress={() => handleFeedback(false)}
        className={`${buttonSize} rounded-full bg-slate-800/50 active:bg-amber-900/30`}
      >
        <ThumbsDown size={iconSize} color="#94a3b8" />
      </Pressable>
    </View>
  );
}

// ============================================
// Detailed Feedback Modal
// ============================================

interface DetailedFeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  explanationType: ExplanationType;
  entityId: string;
  title?: string;
}

/**
 * Modal for collecting detailed feedback with ratings and comments
 */
export function DetailedFeedbackModal({
  visible,
  onClose,
  explanationType,
  entityId,
  title = "Help Us Improve",
}: DetailedFeedbackModalProps) {
  const [wasHelpful, setWasHelpful] = useState<boolean | null>(null);
  const [clarityRating, setClarityRating] = useState<number>(0);
  const [feedbackText, setFeedbackText] = useState("");
  const feedbackMutation = useExplanationFeedback();

  const handleSubmit = useCallback(async () => {
    if (wasHelpful === null) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      await feedbackMutation.mutateAsync({
        explanationType,
        entityId,
        wasHelpful,
        clarityRating: clarityRating > 0 ? clarityRating : undefined,
        feedbackText: feedbackText.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error("[DetailedFeedback] Failed to submit:", error);
    }
  }, [wasHelpful, clarityRating, feedbackText, explanationType, entityId, feedbackMutation, onClose]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWasHelpful(null);
    setClarityRating(0);
    setFeedbackText("");
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={handleClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View
            entering={SlideInDown.springify().damping(20)}
            className="bg-slate-900 rounded-t-3xl px-5 py-6 border-t border-slate-700"
          >
            {/* Header */}
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white text-lg font-semibold">{title}</Text>
              <Pressable onPress={handleClose} className="p-2 -mr-2">
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            {/* Helpful? */}
            <Text className="text-slate-400 text-sm mb-3">Was this helpful?</Text>
            <View className="flex-row gap-3 mb-6">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setWasHelpful(true);
                }}
                className={`flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border ${
                  wasHelpful === true
                    ? "bg-green-900/30 border-green-500"
                    : "bg-slate-800/50 border-slate-700"
                }`}
              >
                <ThumbsUp
                  size={20}
                  color={wasHelpful === true ? "#22c55e" : "#94a3b8"}
                  fill={wasHelpful === true ? "#22c55e" : "transparent"}
                />
                <Text
                  className={wasHelpful === true ? "text-green-400" : "text-slate-400"}
                >
                  Yes
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setWasHelpful(false);
                }}
                className={`flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border ${
                  wasHelpful === false
                    ? "bg-amber-900/30 border-amber-500"
                    : "bg-slate-800/50 border-slate-700"
                }`}
              >
                <ThumbsDown
                  size={20}
                  color={wasHelpful === false ? "#f59e0b" : "#94a3b8"}
                  fill={wasHelpful === false ? "#f59e0b" : "transparent"}
                />
                <Text
                  className={wasHelpful === false ? "text-amber-400" : "text-slate-400"}
                >
                  No
                </Text>
              </Pressable>
            </View>

            {/* Clarity Rating */}
            <Text className="text-slate-400 text-sm mb-3">
              How clear was this? (optional)
            </Text>
            <View className="flex-row gap-2 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setClarityRating(star);
                  }}
                  className="p-1"
                >
                  <Star
                    size={28}
                    color={star <= clarityRating ? "#f59e0b" : "#475569"}
                    fill={star <= clarityRating ? "#f59e0b" : "transparent"}
                  />
                </Pressable>
              ))}
            </View>

            {/* Comments */}
            <Text className="text-slate-400 text-sm mb-2">
              Any additional feedback? (optional)
            </Text>
            <TextInput
              value={feedbackText}
              onChangeText={setFeedbackText}
              placeholder="What could be improved..."
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
              className="bg-slate-800 text-white px-4 py-3 rounded-xl mb-6 min-h-[80px]"
              style={{ textAlignVertical: "top" }}
            />

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={wasHelpful === null || feedbackMutation.isPending}
              className={`py-4 rounded-xl ${
                wasHelpful !== null
                  ? "bg-cyan-600 active:bg-cyan-700"
                  : "bg-slate-700"
              }`}
            >
              <Text
                className={`text-center font-semibold ${
                  wasHelpful !== null ? "text-white" : "text-slate-500"
                }`}
              >
                {feedbackMutation.isPending ? "Submitting..." : "Submit Feedback"}
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ============================================
// Suggestion Dismissal Picker
// ============================================

interface DismissReasonPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (reason: DismissReason, notes?: string) => void;
  suggestionType: SuggestionType;
}

const DISMISS_REASONS: { value: DismissReason; label: string; description: string }[] = [
  { value: "already_claimed", label: "Already Claimed", description: "I already logged this event" },
  { value: "incorrect", label: "Incorrect", description: "The analysis was wrong" },
  { value: "not_applicable", label: "Not Applicable", description: "This doesn't apply to my situation" },
  { value: "timing_issue", label: "Timing Issue", description: "The dates/times are wrong" },
  { value: "other", label: "Other", description: "Different reason" },
];

/**
 * Bottom sheet for selecting why a suggestion was dismissed
 */
export function DismissReasonPicker({
  visible,
  onClose,
  onSelect,
}: DismissReasonPickerProps) {
  const [selectedReason, setSelectedReason] = useState<DismissReason | null>(null);
  const [notes, setNotes] = useState("");

  const handleSubmit = useCallback(() => {
    if (!selectedReason) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(selectedReason, selectedReason === "other" ? notes : undefined);
    setSelectedReason(null);
    setNotes("");
    onClose();
  }, [selectedReason, notes, onSelect, onClose]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedReason(null);
    setNotes("");
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={handleClose}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View
            entering={SlideInDown.springify().damping(20)}
            className="bg-slate-900 rounded-t-3xl px-5 py-6 border-t border-slate-700"
          >
            {/* Header */}
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-lg font-semibold">
                Why are you dismissing this?
              </Text>
              <Pressable onPress={handleClose} className="p-2 -mr-2">
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>

            <Text className="text-slate-400 text-sm mb-4">
              This helps us improve future suggestions
            </Text>

            {/* Reasons */}
            <View className="gap-2 mb-4">
              {DISMISS_REASONS.map((reason) => (
                <Pressable
                  key={reason.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedReason(reason.value);
                  }}
                  className={`p-4 rounded-xl border ${
                    selectedReason === reason.value
                      ? "bg-cyan-900/30 border-cyan-500"
                      : "bg-slate-800/50 border-slate-700"
                  }`}
                >
                  <Text
                    className={
                      selectedReason === reason.value
                        ? "text-cyan-400 font-medium"
                        : "text-white"
                    }
                  >
                    {reason.label}
                  </Text>
                  <Text className="text-slate-500 text-sm mt-0.5">
                    {reason.description}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Notes for "Other" */}
            {selectedReason === "other" && (
              <Animated.View entering={FadeIn} className="mb-4">
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Please explain..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={2}
                  className="bg-slate-800 text-white px-4 py-3 rounded-xl"
                  style={{ textAlignVertical: "top" }}
                />
              </Animated.View>
            )}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={!selectedReason}
              className={`py-4 rounded-xl ${
                selectedReason
                  ? "bg-cyan-600 active:bg-cyan-700"
                  : "bg-slate-700"
              }`}
            >
              <Text
                className={`text-center font-semibold ${
                  selectedReason ? "text-white" : "text-slate-500"
                }`}
              >
                Submit
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ============================================
// Feedback Banner (Post-Action)
// ============================================

interface FeedbackBannerProps {
  visible: boolean;
  onDismiss: () => void;
  onProvideFeedback: () => void;
  message?: string;
}

/**
 * Banner that appears after an action to collect follow-up feedback
 */
export function FeedbackBanner({
  visible,
  onDismiss,
  onProvideFeedback,
  message = "How did that work out?",
}: FeedbackBannerProps) {
  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn}
      exiting={webSafeExit(FadeOut)}
      className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 mx-4 mb-4"
    >
      <View className="flex-row items-center gap-3">
        <MessageSquare size={20} color="#06b6d4" />
        <Text className="text-white flex-1">{message}</Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onProvideFeedback();
          }}
          className="bg-cyan-600 px-3 py-1.5 rounded-lg active:bg-cyan-700"
        >
          <Text className="text-white text-sm font-medium">Feedback</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDismiss();
          }}
          className="p-1"
        >
          <X size={18} color="#94a3b8" />
        </Pressable>
      </View>
    </Animated.View>
  );
}
