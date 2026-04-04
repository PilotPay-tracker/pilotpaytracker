/**
 * Pay Explanation Modal
 * Displays AI-generated explanations for pay statement sections
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  X,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronRight,
} from "lucide-react-native";
import {
  usePayExplanation,
  getVerificationColor,
  getVerificationLabel,
  getSectionLabel,
  type PayExplanationSection,
  type PayExplanationRequest,
  type PayExplanationResponse,
} from "@/lib/usePayExplanation";
import { QuickFeedback } from "@/components/FeedbackComponents";

interface PayExplanationModalProps {
  visible: boolean;
  onClose: () => void;
  section: PayExplanationSection;
  request: Omit<PayExplanationRequest, "section">;
}

export function PayExplanationModal({
  visible,
  onClose,
  section,
  request,
}: PayExplanationModalProps) {
  const insets = useSafeAreaInsets();
  const explanationMutation = usePayExplanation();
  const [explanation, setExplanation] = useState<PayExplanationResponse | null>(
    null
  );

  // Fetch explanation when modal opens
  useEffect(() => {
    if (visible && !explanation) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      explanationMutation.mutate(
        { ...request, section },
        {
          onSuccess: (data) => {
            setExplanation(data);
          },
        }
      );
    }
  }, [visible]);

  // Reset when modal closes
  useEffect(() => {
    if (!visible) {
      setExplanation(null);
      explanationMutation.reset();
    }
  }, [visible]);

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const isLoading = explanationMutation.isPending;
  const error = explanationMutation.error;

  // Get status icon
  const StatusIcon = ({
    status,
  }: {
    status: PayExplanationResponse["verificationStatus"];
  }) => {
    switch (status) {
      case "VERIFIED":
        return <CheckCircle size={20} color="#4ade80" />;
      case "ESTIMATED":
        return <Info size={20} color="#fbbf24" />;
      case "MISMATCH":
        return <AlertCircle size={20} color="#f87171" />;
      case "REVIEW_RECOMMENDED":
        return <AlertTriangle size={20} color="#fb923c" />;
    }
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
          colors={["#0f172a", "#1e293b", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <Animated.View
            entering={FadeIn.duration(300)}
            style={{ paddingTop: insets.top + 8 }}
            className="px-5 pb-4 border-b border-slate-700/50"
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                  <Sparkles size={20} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-white text-lg font-semibold">
                    {getSectionLabel(section)} Explanation
                  </Text>
                  <Text className="text-slate-400 text-xs">
                    AI-powered analysis
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={handleClose}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <X size={20} color="#94a3b8" />
              </Pressable>
            </View>
          </Animated.View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Loading State */}
            {isLoading && (
              <Animated.View
                entering={FadeIn.duration(300)}
                className="items-center py-16"
              >
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-4 text-center">
                  Analyzing your pay statement...
                </Text>
                <Text className="text-slate-500 text-sm mt-1">
                  This may take a few seconds
                </Text>
              </Animated.View>
            )}

            {/* Error State */}
            {error && !isLoading && (
              <Animated.View
                entering={FadeIn.duration(300)}
                className="mx-5 mt-6"
              >
                <View className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <View className="flex-row items-center mb-2">
                    <AlertCircle size={20} color="#f87171" />
                    <Text className="text-red-400 font-semibold ml-2">
                      Unable to Generate Explanation
                    </Text>
                  </View>
                  <Text className="text-red-300/80 text-sm">
                    {error.message || "Please try again later."}
                  </Text>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      explanationMutation.mutate({ ...request, section });
                    }}
                    className="mt-3 bg-red-500/20 py-2 px-4 rounded-lg self-start active:opacity-70"
                  >
                    <Text className="text-red-400 font-medium">Retry</Text>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Explanation Content */}
            {explanation && !isLoading && (
              <Animated.View
                entering={FadeInDown.duration(400).delay(100)}
                className="px-5 pt-6"
              >
                {/* Verification Status Badge */}
                <View
                  className={`flex-row items-center self-start px-3 py-2 rounded-full mb-6 ${getVerificationColor(explanation.verificationStatus).bg} border ${getVerificationColor(explanation.verificationStatus).border}`}
                >
                  <StatusIcon status={explanation.verificationStatus} />
                  <Text
                    className={`ml-2 font-medium ${getVerificationColor(explanation.verificationStatus).text}`}
                  >
                    {getVerificationLabel(explanation.verificationStatus)}
                  </Text>
                </View>

                {/* Header */}
                <Text className="text-white text-xl font-bold mb-4">
                  {explanation.explanation.header}
                </Text>

                {/* Key Drivers */}
                {explanation.explanation.keyDrivers.length > 0 && (
                  <View className="mb-6">
                    <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                      Key Factors
                    </Text>
                    <View className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
                      {explanation.explanation.keyDrivers.map((driver, idx) => (
                        <View
                          key={idx}
                          className={`flex-row items-start px-4 py-3 ${idx > 0 ? "border-t border-slate-700/30" : ""}`}
                        >
                          <ChevronRight
                            size={16}
                            color="#f59e0b"
                            style={{ marginTop: 2 }}
                          />
                          <Text className="text-slate-200 ml-2 flex-1">
                            {driver}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* What Matched */}
                {explanation.explanation.matched &&
                  explanation.explanation.matched.length > 0 && (
                    <View className="mb-6">
                      <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                        What Matched Expectations
                      </Text>
                      <View className="bg-green-500/10 rounded-xl border border-green-500/30 overflow-hidden">
                        {explanation.explanation.matched.map((item, idx) => (
                          <View
                            key={idx}
                            className={`flex-row items-start px-4 py-3 ${idx > 0 ? "border-t border-green-500/20" : ""}`}
                          >
                            <CheckCircle
                              size={16}
                              color="#4ade80"
                              style={{ marginTop: 2 }}
                            />
                            <Text className="text-green-300 ml-2 flex-1">
                              {item}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                {/* What Differed */}
                {explanation.explanation.differed &&
                  explanation.explanation.differed.length > 0 && (
                    <View className="mb-6">
                      <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                        What Differed
                      </Text>
                      <View className="bg-amber-500/10 rounded-xl border border-amber-500/30 overflow-hidden">
                        {explanation.explanation.differed.map((item, idx) => (
                          <View
                            key={idx}
                            className={`flex-row items-start px-4 py-3 ${idx > 0 ? "border-t border-amber-500/20" : ""}`}
                          >
                            <AlertTriangle
                              size={16}
                              color="#fbbf24"
                              style={{ marginTop: 2 }}
                            />
                            <Text className="text-amber-300 ml-2 flex-1">
                              {item}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                {/* Benchmark Context */}
                {explanation.explanation.benchmarkContext && (
                  <View className="mb-6">
                    <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                      Benchmark Context
                    </Text>
                    <View className="bg-blue-500/10 rounded-xl border border-blue-500/30 p-4">
                      <Text className="text-blue-300">
                        {explanation.explanation.benchmarkContext}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Difference Analysis */}
                {explanation.differenceAnalysis && (
                  <View className="mb-6">
                    <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                      Difference Analysis
                    </Text>
                    <View className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
                      <View className="flex-row justify-between mb-3">
                        <Text className="text-slate-400">Net Pay Difference</Text>
                        <Text
                          className={
                            explanation.differenceAnalysis.netPayDifferenceCents >=
                            0
                              ? "text-green-400 font-semibold"
                              : "text-red-400 font-semibold"
                          }
                        >
                          {explanation.differenceAnalysis.netPayDifferenceCents >=
                          0
                            ? "+"
                            : ""}
                          $
                          {(
                            explanation.differenceAnalysis.netPayDifferenceCents /
                            100
                          ).toFixed(2)}
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <View
                          className={`px-2 py-1 rounded ${explanation.differenceAnalysis.isWithinTolerance ? "bg-green-500/20" : "bg-amber-500/20"}`}
                        >
                          <Text
                            className={
                              explanation.differenceAnalysis.isWithinTolerance
                                ? "text-green-400 text-xs"
                                : "text-amber-400 text-xs"
                            }
                          >
                            {explanation.differenceAnalysis.isWithinTolerance
                              ? "Within normal variance"
                              : "Outside normal variance"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* Verification Note */}
                {explanation.verificationNote && (
                  <View className="mb-6">
                    <View className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 flex-row items-start">
                      <Info size={18} color="#94a3b8" style={{ marginTop: 2 }} />
                      <Text className="text-slate-300 ml-3 flex-1">
                        {explanation.verificationNote}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Suggested Action */}
                {explanation.suggestedAction && (
                  <View className="mb-6">
                    <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
                      Suggested Action
                    </Text>
                    <View className="bg-amber-500/10 rounded-xl border border-amber-500/30 p-4 flex-row items-start">
                      <Sparkles
                        size={18}
                        color="#f59e0b"
                        style={{ marginTop: 2 }}
                      />
                      <Text className="text-amber-200 ml-3 flex-1">
                        {explanation.suggestedAction}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Feedback Section */}
                <View className="mt-6 pt-4 border-t border-slate-700/50">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-slate-400 text-sm">
                      Help improve our explanations
                    </Text>
                    <QuickFeedback
                      explanationType="pay_statement"
                      entityId={`${section}_${request.context?.payPeriodStart ?? "unknown"}`}
                      size="md"
                      label=""
                    />
                  </View>
                </View>

                {/* Disclaimer */}
                <View className="mt-4 pt-4 border-t border-slate-700/50">
                  <Text className="text-slate-500 text-xs text-center">
                    AI-generated analysis based on your pay data and contract
                    rules. Not a substitute for official payroll records.
                  </Text>
                </View>
              </Animated.View>
            )}
          </ScrollView>
        </LinearGradient>
      </View>
    </Modal>
  );
}
