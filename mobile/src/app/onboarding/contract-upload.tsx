/**
 * Onboarding Step 2: Contract Upload
 *
 * Optional step where user can upload their CBA/LOA/pay manual.
 * Documents are used as reference for AI context only.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import {
  FileText,
  Upload,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  AlertTriangle,
} from "lucide-react-native";
import { useUpdateProfileMutation } from "@/lib/useProfile";
import { useProfile } from "@/lib/state/profile-store";

// Disclaimer text
const DISCLAIMER_TEXT = `These documents are used for reference only. The app does not interpret or enforce contract terms.`;

export default function ContractUploadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const updateMutation = useUpdateProfileMutation();

  const [selectedFiles, setSelectedFiles] = useState<
    Array<{ name: string; uri: string; size: number }>
  >([]);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handlePickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/plain", "application/msword"],
        multiple: true,
      });

      if (!result.canceled && result.assets) {
        const newFiles = result.assets.map((asset) => ({
          name: asset.name,
          uri: asset.uri,
          size: asset.size ?? 0,
        }));
        setSelectedFiles((prev) => [...prev, ...newFiles]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error("Document picker error:", error);
      Alert.alert("Error", "Failed to select document. Please try again.");
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadAndContinue = useCallback(async () => {
    if (selectedFiles.length === 0 || !disclaimerAccepted) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsUploading(true);

    try {
      // TODO: Implement actual file upload to backend
      // For now, we'll just update the profile to indicate contract was uploaded

      await updateMutation.mutateAsync({
        onboardingStep: 2,
        contractMappingStatus: "confirmed", // Contract uploaded
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate directly to schedule sync (rule-mapping step removed)
      router.push("/onboarding/schedule-sync" as any);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", "Failed to upload documents. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, [selectedFiles, disclaimerAccepted, updateMutation, router]);

  const handleSkip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await updateMutation.mutateAsync({
        onboardingStep: 2,
        contractMappingStatus: "none",
      });

      // Skip directly to schedule sync (step 4) since no documents
      router.push("/onboarding/schedule-sync" as any);
    } catch (error) {
      console.error("Failed to skip:", error);
    }
  }, [updateMutation, router]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 24 }}
            className="px-6"
          >
            {/* Back button */}
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center mb-4"
            >
              <ChevronLeft size={24} color="#f59e0b" />
            </Pressable>

            {/* Step indicator - 3 steps total */}
            <View className="flex-row items-center mb-6">
              <View className="w-8 h-8 rounded-full bg-green-500 items-center justify-center">
                <CheckCircle2 size={16} color="#ffffff" />
              </View>
              <View className="flex-1 h-1 bg-amber-500 mx-2" />
              <View className="w-8 h-8 rounded-full bg-amber-500 items-center justify-center">
                <Text className="text-slate-900 font-bold">2</Text>
              </View>
              <View className="flex-1 h-1 bg-slate-700 mx-2" />
              <View className="w-8 h-8 rounded-full bg-slate-700 items-center justify-center">
                <Text className="text-slate-500 font-bold">3</Text>
              </View>
            </View>

            <FileText size={32} color="#f59e0b" />
            <Text className="text-white text-3xl font-bold mt-4">
              Upload your contract
            </Text>
            <Text className="text-slate-400 text-sm mt-1">(optional)</Text>
            <Text className="text-slate-400 text-base mt-2">
              Upload your CBA/LOA/pay manual so AI can reference your language
              when schedule changes or pay events occur.
            </Text>
          </Animated.View>

          {/* Disclaimer */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-6 mt-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4"
          >
            <View className="flex-row items-start">
              <AlertTriangle size={20} color="#f59e0b" />
              <Text className="text-amber-300 text-sm ml-3 flex-1">
                {DISCLAIMER_TEXT}
              </Text>
            </View>
          </Animated.View>

          {/* Upload Area */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-6 mt-6"
          >
            <Pressable
              onPress={handlePickDocument}
              className="border-2 border-dashed border-slate-600 rounded-2xl p-8 items-center active:border-amber-500 active:bg-amber-500/5"
            >
              <View className="w-16 h-16 rounded-full bg-slate-800 items-center justify-center mb-4">
                <Upload size={28} color="#f59e0b" />
              </View>
              <Text className="text-white font-semibold text-lg">
                Tap to select files
              </Text>
              <Text className="text-slate-400 text-sm mt-1 text-center">
                PDF, DOC, or TXT files{"\n"}Multiple files supported
              </Text>
            </Pressable>
          </Animated.View>

          {/* Selected Files */}
          {selectedFiles.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(400)}
              className="mx-6 mt-6"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Selected Files ({selectedFiles.length})
              </Text>
              {selectedFiles.map((file, index) => (
                <View
                  key={`${file.name}-${index}`}
                  className="flex-row items-center bg-slate-800/60 rounded-xl p-4 mb-2 border border-slate-700/50"
                >
                  <FileText size={20} color="#3b82f6" />
                  <View className="flex-1 ml-3">
                    <Text
                      className="text-white font-medium"
                      numberOfLines={1}
                    >
                      {file.name}
                    </Text>
                    <Text className="text-slate-500 text-xs">
                      {formatFileSize(file.size)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveFile(index)}
                    className="w-8 h-8 rounded-full bg-slate-700 items-center justify-center"
                  >
                    <X size={16} color="#ef4444" />
                  </Pressable>
                </View>
              ))}

              {/* Disclaimer Checkbox */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDisclaimerAccepted(!disclaimerAccepted);
                }}
                className="flex-row items-start mt-4"
              >
                <View
                  className={`w-6 h-6 rounded border-2 items-center justify-center ${
                    disclaimerAccepted
                      ? "bg-amber-500 border-amber-500"
                      : "border-slate-600"
                  }`}
                >
                  {disclaimerAccepted && (
                    <CheckCircle2 size={14} color="#0f172a" />
                  )}
                </View>
                <Text className="text-slate-300 text-sm ml-3 flex-1">
                  I understand these documents are for reference only and the
                  app does not interpret or enforce contract terms.
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>

        {/* Bottom Buttons */}
        <Animated.View
          entering={FadeInUp.duration(600).delay(400)}
          className="absolute bottom-0 left-0 right-0 px-6"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <LinearGradient
            colors={["transparent", "#0f172a"]}
            style={{
              position: "absolute",
              top: -40,
              left: 0,
              right: 0,
              height: 40,
            }}
          />

          {/* Upload & Continue (if files selected) */}
          {selectedFiles.length > 0 ? (
            <Pressable
              onPress={handleUploadAndContinue}
              disabled={!disclaimerAccepted || isUploading}
              className={`rounded-2xl p-4 flex-row items-center justify-center mb-3 ${
                disclaimerAccepted && !isUploading
                  ? "bg-amber-500 active:opacity-80"
                  : "bg-slate-700"
              }`}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <>
                  <Upload
                    size={20}
                    color={disclaimerAccepted ? "#0f172a" : "#64748b"}
                  />
                  <Text
                    className={`font-bold text-lg ml-2 ${
                      disclaimerAccepted ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    Upload Contract
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={handlePickDocument}
              className="rounded-2xl p-4 flex-row items-center justify-center mb-3 bg-amber-500 active:opacity-80"
            >
              <Upload size={20} color="#0f172a" />
              <Text className="font-bold text-lg ml-2 text-slate-900">
                Upload Contract
              </Text>
            </Pressable>
          )}

          {/* Skip Button */}
          <Pressable
            onPress={handleSkip}
            disabled={updateMutation.isPending}
            className="rounded-2xl p-4 flex-row items-center justify-center bg-slate-800/60 border border-slate-700 active:opacity-80"
          >
            <Text className="text-slate-300 font-semibold">Skip for now</Text>
          </Pressable>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}
