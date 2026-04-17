/**
 * Pay Statement Upload Screen
 *
 * Upload PDF or image of pay statement for OCR parsing
 * and template generation.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  FileUp,
  Camera,
  Image as ImageIcon,
  FileText,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  X,
  Sparkles,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useMutation } from "@tanstack/react-query";
import { BACKEND_URL } from "@/lib/api";
import { getAuthCookieHeader } from "@/lib/authClient";

// ============================================
// TYPES
// ============================================

type UploadStep = "select" | "preview" | "uploading" | "parsing" | "complete";

interface SelectedFile {
  uri: string;
  type: "image" | "pdf";
  name: string;
  mimeType: string;
}

// ============================================
// COMPONENTS
// ============================================

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`overflow-hidden rounded-2xl ${className}`}>
      <BlurView intensity={40} tint="dark" style={{ flex: 1 }}>
        <View className="bg-white/5 border border-white/10 rounded-2xl">
          {children}
        </View>
      </BlurView>
    </View>
  );
}

function UploadOption({
  icon,
  title,
  description,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (!disabled) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      disabled={disabled}
      className={`flex-row items-center p-4 rounded-xl mb-3 ${
        disabled ? "opacity-50" : ""
      }`}
      style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
    >
      <View className="w-12 h-12 rounded-xl bg-emerald-500/20 items-center justify-center">
        {icon}
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-white font-semibold">{title}</Text>
        <Text className="text-slate-400 text-sm">{description}</Text>
      </View>
    </Pressable>
  );
}

function ProcessingIndicator({
  step,
}: {
  step: "uploading" | "parsing";
}) {
  const rotation = useSharedValue(0);

  useState(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000 }),
      -1,
      false
    );
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View className="items-center py-12">
      <Animated.View style={animatedStyle}>
        <Loader2 size={48} color="#10b981" />
      </Animated.View>
      <Text className="text-white font-semibold text-lg mt-6">
        {step === "uploading" ? "Uploading..." : "Parsing Statement..."}
      </Text>
      <Text className="text-slate-400 text-sm mt-2 text-center px-8">
        {step === "uploading"
          ? "Securely uploading your pay statement"
          : "Extracting pay data and building your template"}
      </Text>
    </View>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function PayStatementUploadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState<UploadStep>("select");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: SelectedFile) => {
      // Get Better Auth cookie
      const cookie = await getAuthCookieHeader();

      // Use FileSystem.uploadAsync for reliable file uploads in React Native
      const uploadResult = await FileSystem.uploadAsync(
        `${BACKEND_URL}/api/pay-statements/upload`,
        file.uri,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          parameters: {
            source: file.type,
          },
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
          },
        }
      );

      if (uploadResult.status !== 200) {
        const errorData = JSON.parse(uploadResult.body || "{}");
        throw new Error(errorData.error || `Upload failed: ${uploadResult.status}`);
      }

      return JSON.parse(uploadResult.body) as { success: boolean; uploadId: string };
    },
    onSuccess: (data) => {
      setUploadId(data.uploadId);
      setStep("parsing");
      parseMutation.mutate(data.uploadId);
    },
    onError: (error) => {
      Alert.alert("Upload Failed", error.message);
      setStep("preview");
    },
  });

  // Parse mutation
  const parseMutation = useMutation({
    mutationFn: async (id: string) => {
      const cookie = await getAuthCookieHeader();

      const response = await fetch(
        `${BACKEND_URL}/api/pay-statements/${id}/parse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          credentials: "include",
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return response.json();
    },
    onSuccess: () => {
      setStep("complete");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      Alert.alert("Parsing Failed", error.message);
      setStep("preview");
    },
  });

  // Pick image from gallery
  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Required", "Please allow access to your photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        type: "image",
        name: asset.fileName ?? "statement.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      setStep("preview");
    }
  }, []);

  // Take photo
  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission Required", "Please allow access to your camera.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setSelectedFile({
        uri: asset.uri,
        type: "image",
        name: "statement_photo.jpg",
        mimeType: "image/jpeg",
      });
      setStep("preview");
    }
  }, []);

  // Pick PDF document
  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setSelectedFile({
          uri: asset.uri,
          type: "pdf",
          name: asset.name,
          mimeType: asset.mimeType ?? "application/pdf",
        });
        setStep("preview");
      }
    } catch (error) {
      console.error("Document picker error:", error);
    }
  }, []);

  // Handle upload
  const handleUpload = () => {
    if (!selectedFile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep("uploading");
    uploadMutation.mutate(selectedFile);
  };

  // Cancel and go back
  const handleCancel = () => {
    setSelectedFile(null);
    setStep("select");
  };

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Background */}
      <LinearGradient
        colors={["#0f172a", "#064e3b", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: "absolute", width: "100%", height: "100%" }}
      />

      {/* Ambient Glow */}
      <View
        className="absolute bottom-40 left-0 w-64 h-64 rounded-full opacity-20"
        style={{
          backgroundColor: "#10b981",
          shadowColor: "#10b981",
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: 100,
        }}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.duration(600)}
          style={{ paddingTop: insets.top + 12 }}
          className="px-5"
        >
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center mb-4"
          >
            <ChevronLeft size={20} color="#10b981" />
            <Text className="text-emerald-500 text-base ml-1">Back</Text>
          </Pressable>

          <View className="flex-row items-center mb-1">
            <FileUp size={20} color="#10b981" />
            <Text className="text-emerald-500 text-sm font-medium ml-2">
              Statement Upload
            </Text>
          </View>
          <Text className="text-white text-2xl font-bold">
            Upload Pay Statement
          </Text>
          <Text className="text-slate-400 text-base mt-1">
            Import your statement to create a company-style template
          </Text>
        </Animated.View>

        <View className="px-5 mt-6">
          {/* SELECT STEP */}
          {step === "select" && (
            <Animated.View entering={FadeIn.duration(400)}>
              <GlassCard className="mb-4">
                <View className="p-4">
                  <UploadOption
                    icon={<Camera size={24} color="#10b981" />}
                    title="Take Photo"
                    description="Photograph your pay statement"
                    onPress={takePhoto}
                  />
                  <UploadOption
                    icon={<ImageIcon size={24} color="#10b981" />}
                    title="Choose from Photos"
                    description="Select an existing screenshot"
                    onPress={pickImage}
                  />
                  <UploadOption
                    icon={<FileText size={24} color="#10b981" />}
                    title="Upload PDF"
                    description="Import a PDF pay statement"
                    onPress={pickDocument}
                  />
                </View>
              </GlassCard>

              {/* Info */}
              <GlassCard>
                <View className="p-4">
                  <View className="flex-row items-center mb-2">
                    <Sparkles size={16} color="#10b981" />
                    <Text className="text-emerald-400 font-semibold ml-2">
                      What happens next?
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-sm leading-5">
                    We'll analyze your statement to learn your company's format.
                    Future projections will mirror your actual pay statement layout
                    for easy comparison.
                  </Text>
                </View>
              </GlassCard>
            </Animated.View>
          )}

          {/* PREVIEW STEP */}
          {step === "preview" && selectedFile && (
            <Animated.View entering={FadeIn.duration(400)}>
              <GlassCard className="mb-4">
                <View className="p-4">
                  <View className="flex-row items-center justify-between mb-4">
                    <Text className="text-white font-semibold">
                      Selected File
                    </Text>
                    <Pressable onPress={handleCancel}>
                      <X size={20} color="#64748b" />
                    </Pressable>
                  </View>

                  {selectedFile.type === "image" ? (
                    <View className="rounded-xl overflow-hidden bg-slate-800">
                      <Image
                        source={{ uri: selectedFile.uri }}
                        className="w-full h-64"
                        resizeMode="contain"
                      />
                    </View>
                  ) : (
                    <View className="rounded-xl bg-slate-800 p-6 items-center">
                      <FileText size={48} color="#10b981" />
                      <Text className="text-white font-medium mt-3">
                        {selectedFile.name}
                      </Text>
                      <Text className="text-slate-400 text-sm mt-1">
                        PDF Document
                      </Text>
                    </View>
                  )}
                </View>
              </GlassCard>

              <Pressable
                onPress={handleUpload}
                className="bg-emerald-500 py-4 rounded-xl items-center"
              >
                <Text className="text-black font-bold text-base">
                  Upload & Process
                </Text>
              </Pressable>

              <Pressable
                onPress={handleCancel}
                className="py-4 items-center mt-2"
              >
                <Text className="text-slate-400 font-medium">
                  Choose Different File
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* UPLOADING/PARSING STEP */}
          {(step === "uploading" || step === "parsing") && (
            <Animated.View entering={FadeIn.duration(400)}>
              <GlassCard>
                <ProcessingIndicator step={step} />
              </GlassCard>
            </Animated.View>
          )}

          {/* COMPLETE STEP */}
          {step === "complete" && (
            <Animated.View entering={FadeIn.duration(400)}>
              <GlassCard className="mb-4">
                <View className="p-6 items-center">
                  <View className="w-20 h-20 rounded-full bg-emerald-500/20 items-center justify-center mb-4">
                    <CheckCircle2 size={48} color="#10b981" />
                  </View>
                  <Text className="text-white font-bold text-xl mb-2">
                    Statement Imported!
                  </Text>
                  <Text className="text-slate-400 text-center text-sm">
                    Your pay statement has been processed. Your projection template
                    now mirrors your company's format.
                  </Text>
                </View>
              </GlassCard>

              <Pressable
                onPress={() => router.push("/pay-review" as any)}
                className="bg-emerald-500 py-4 rounded-xl items-center"
              >
                <Text className="text-black font-bold text-base">
                  View Pay Review
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setStep("select");
                  setSelectedFile(null);
                }}
                className="py-4 items-center mt-2"
              >
                <Text className="text-slate-400 font-medium">
                  Upload Another Statement
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
