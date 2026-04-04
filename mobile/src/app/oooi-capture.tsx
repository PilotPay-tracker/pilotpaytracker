/**
 * OOOI Capture Screen
 *
 * Scan ACARS screenshots to capture Out-Off-On-In flight times.
 * Uses OCR (free) with OpenAI Vision fallback for parsing.
 */

import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  Camera as CameraIcon,
  Image as ImageIcon,
  Clock,
  Plane,
  Check,
  X,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Edit3,
} from "lucide-react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import {
  parseOOOIFromImage,
  type ExtendedParseResult,
} from "@/lib/oooi/visionParser";

type CaptureMode = "camera" | "gallery" | "manual";
type ParseStatus = "idle" | "capturing" | "parsing" | "success" | "error";

interface OOOIData {
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  outTime: string;
  offTime: string;
  onTime: string;
  inTime: string;
}

// Helpers
function formatTimeDisplay(time: string | undefined): string {
  if (!time) return "--:--";
  return time;
}

function calculateBlockTime(outTime: string, inTime: string): string {
  if (!outTime || !inTime) return "--:--";
  try {
    const [outH, outM] = outTime.split(":").map(Number);
    const [inH, inM] = inTime.split(":").map(Number);
    if (outH === undefined || outM === undefined || inH === undefined || inM === undefined) {
      return "--:--";
    }
    let totalMins = inH * 60 + inM - (outH * 60 + outM);
    if (totalMins < 0) totalMins += 24 * 60; // Handle overnight
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hrs}:${mins.toString().padStart(2, "0")}`;
  } catch {
    return "--:--";
  }
}

function calculateFlightTime(offTime: string, onTime: string): string {
  return calculateBlockTime(offTime, onTime);
}

// Components
function TimeInput({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  color: string;
}) {
  return (
    <View className="flex-1">
      <Text className={`text-xs font-semibold mb-1 ${color}`}>{label}</Text>
      <TextInput
        className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white text-center text-lg font-mono"
        value={value}
        onChangeText={onChange}
        placeholder="--:--"
        placeholderTextColor="#64748b"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
      />
    </View>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const color =
    percent >= 80
      ? "bg-green-500/20 text-green-400"
      : percent >= 50
        ? "bg-amber-500/20 text-amber-400"
        : "bg-red-500/20 text-red-400";

  return (
    <View className={`px-2 py-1 rounded-full ${color.split(" ")[0]}`}>
      <Text className={`text-xs font-semibold ${color.split(" ")[1]}`}>
        {percent}% confidence
      </Text>
    </View>
  );
}

export default function OOOICaptureScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<CaptureMode>("camera");
  const [status, setStatus] = useState<ParseStatus>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ExtendedParseResult | null>(
    null
  );
  const [isCameraReady, setIsCameraReady] = useState(false);

  // Editable OOOI data
  const [oooi, setOooi] = useState<OOOIData>({
    flightNumber: "",
    origin: "",
    destination: "",
    date: "",
    outTime: "",
    offTime: "",
    onTime: "",
    inTime: "",
  });

  // Camera ready handler
  const handleCameraReady = useCallback(() => {
    console.log('[OOOICapture] Camera is ready');
    setIsCameraReady(true);
  }, []);

  // Take photo with camera
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) {
      console.error('[OOOICapture] Camera ref is null');
      return;
    }

    if (!isCameraReady) {
      console.log('[OOOICapture] Camera not ready yet');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStatus("capturing");
      console.log('[OOOICapture] Taking photo...');

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: true,
      });

      console.log('[OOOICapture] Photo result:', photo?.uri ? 'success' : 'no uri');

      if (photo?.uri) {
        setCapturedImage(photo.uri);
        setStatus("parsing");
        await parseImage(photo.uri);
      } else {
        throw new Error('No photo URI returned');
      }
    } catch (error) {
      console.error("[OOOICapture] Capture error:", error);
      setStatus("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [isCameraReady]);

  // Pick from gallery
  const handlePickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]?.uri) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCapturedImage(result.assets[0].uri);
        setStatus("parsing");
        await parseImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error("Pick image error:", error);
      setStatus("error");
    }
  }, []);

  // Parse captured image
  const parseImage = useCallback(async (uri: string) => {
    try {
      const result = await parseOOOIFromImage(uri);
      setParseResult(result);

      if (result.success) {
        setOooi({
          flightNumber: result.flightNumber ?? "",
          origin: result.origin ?? "",
          destination: result.destination ?? "",
          date: result.date ?? "",
          outTime: result.outTime ?? "",
          offTime: result.offTime ?? "",
          onTime: result.onTime ?? "",
          inTime: result.inTime ?? "",
        });
        setStatus("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (error) {
      console.error("Parse error:", error);
      setStatus("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  // Retry parsing
  const handleRetry = useCallback(() => {
    setCapturedImage(null);
    setParseResult(null);
    setStatus("idle");
    setOooi({
      flightNumber: "",
      origin: "",
      destination: "",
      date: "",
      outTime: "",
      offTime: "",
      onTime: "",
      inTime: "",
    });
  }, []);

  // Save/Apply the parsed data
  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Validate we have at least some times
    if (!oooi.outTime && !oooi.offTime && !oooi.onTime && !oooi.inTime) {
      Alert.alert("Missing Data", "Please enter at least one OOOI time.");
      return;
    }

    // For now, show success and go back
    // In full implementation, this would save to a trip/leg
    Alert.alert(
      "OOOI Captured",
      `Flight: ${oooi.flightNumber || "N/A"}\n${oooi.origin || "---"} → ${oooi.destination || "---"}\n\nOUT: ${formatTimeDisplay(oooi.outTime)}\nOFF: ${formatTimeDisplay(oooi.offTime)}\nON: ${formatTimeDisplay(oooi.onTime)}\nIN: ${formatTimeDisplay(oooi.inTime)}\n\nBlock: ${calculateBlockTime(oooi.outTime, oooi.inTime)}\nFlight: ${calculateFlightTime(oooi.offTime, oooi.onTime)}`,
      [
        { text: "Capture Another", onPress: handleRetry },
        { text: "Done", onPress: () => router.back() },
      ]
    );
  }, [oooi, router, handleRetry]);

  // Request permission if needed
  if (!permission) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={["#0f172a", "#1a2744", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center mb-4"
            >
              <Text className="text-amber-500 text-base">← Back</Text>
            </Pressable>

            <View className="flex-row items-center mb-2">
              <CameraIcon size={24} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-semibold ml-2">
                Capture
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">OOOI Scanner</Text>
            <Text className="text-slate-400 text-base mt-1">
              Scan ACARS screenshots for flight times
            </Text>
          </Animated.View>

          {/* Mode Selector */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="flex-row mx-5 mt-6 bg-slate-800/60 rounded-xl p-1"
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMode("camera");
              }}
              className={`flex-1 flex-row items-center justify-center py-2.5 rounded-lg ${
                mode === "camera" ? "bg-amber-500" : ""
              }`}
            >
              <CameraIcon
                size={16}
                color={mode === "camera" ? "#000" : "#94a3b8"}
              />
              <Text
                className={`ml-1.5 font-semibold ${
                  mode === "camera" ? "text-black" : "text-slate-400"
                }`}
              >
                Camera
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMode("gallery");
                handlePickImage();
              }}
              className={`flex-1 flex-row items-center justify-center py-2.5 rounded-lg ${
                mode === "gallery" ? "bg-amber-500" : ""
              }`}
            >
              <ImageIcon
                size={16}
                color={mode === "gallery" ? "#000" : "#94a3b8"}
              />
              <Text
                className={`ml-1.5 font-semibold ${
                  mode === "gallery" ? "text-black" : "text-slate-400"
                }`}
              >
                Gallery
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setMode("manual");
                setStatus("success");
              }}
              className={`flex-1 flex-row items-center justify-center py-2.5 rounded-lg ${
                mode === "manual" ? "bg-amber-500" : ""
              }`}
            >
              <Clock size={16} color={mode === "manual" ? "#000" : "#94a3b8"} />
              <Text
                className={`ml-1.5 font-semibold ${
                  mode === "manual" ? "text-black" : "text-slate-400"
                }`}
              >
                Manual
              </Text>
            </Pressable>
          </Animated.View>

          {/* Camera / Image View */}
          {mode === "camera" && !capturedImage && (
            <Animated.View
              entering={FadeIn.duration(400)}
              className="mx-5 mt-4"
            >
              {!permission.granted ? (
                <View className="bg-slate-800/60 rounded-2xl p-8 items-center">
                  <CameraIcon size={48} color="#64748b" />
                  <Text className="text-white font-semibold text-lg mt-4">
                    Camera Access Required
                  </Text>
                  <Text className="text-slate-400 text-center mt-2">
                    Allow camera access to scan ACARS screens
                  </Text>
                  <Pressable
                    onPress={requestPermission}
                    className="bg-amber-500 px-6 py-3 rounded-xl mt-4"
                  >
                    <Text className="text-black font-semibold">
                      Grant Permission
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="rounded-2xl overflow-hidden relative" style={{ height: 300 }}>
                  <CameraView
                    ref={cameraRef}
                    style={{ height: 300 }}
                    facing="back"
                    onCameraReady={handleCameraReady}
                  />
                  {/* Capture overlay - positioned absolutely */}
                  <View className="absolute inset-0" pointerEvents="box-none">
                    {/* Camera status indicator */}
                    {!isCameraReady && (
                      <View className="absolute top-4 left-0 right-0 items-center">
                        <Text className="text-white/70 text-sm">Initializing camera...</Text>
                      </View>
                    )}

                    {/* Edit button on the right side */}
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setMode("manual");
                        setStatus("success");
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 bg-slate-900/80 border border-slate-600/50 rounded-xl px-3 py-3 items-center"
                      style={{ transform: [{ translateY: -40 }] }}
                    >
                      <Edit3 size={20} color="#f59e0b" />
                      <Text className="text-amber-500 text-xs font-semibold mt-1">Edit</Text>
                    </Pressable>

                    {/* Capture button at bottom */}
                    <View className="absolute bottom-6 left-0 right-0 items-center">
                      <Pressable
                        onPress={handleCapture}
                        disabled={status === "capturing" || !isCameraReady}
                        className={`w-16 h-16 rounded-full items-center justify-center border-4 border-amber-500 ${
                          isCameraReady ? "bg-white/90" : "bg-white/50"
                        }`}
                      >
                        {status === "capturing" ? (
                          <ActivityIndicator color="#f59e0b" />
                        ) : (
                          <View className={`w-12 h-12 rounded-full ${isCameraReady ? "bg-amber-500" : "bg-amber-500/50"}`} />
                        )}
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
            </Animated.View>
          )}

          {/* Captured Image Preview */}
          {capturedImage && (
            <Animated.View
              entering={FadeIn.duration(400)}
              className="mx-5 mt-4"
            >
              <View className="rounded-2xl overflow-hidden relative">
                <Image
                  source={{ uri: capturedImage }}
                  style={{ height: 200 }}
                  resizeMode="cover"
                />
                {status === "parsing" && (
                  <View className="absolute inset-0 bg-black/60 items-center justify-center">
                    <ActivityIndicator color="#f59e0b" size="large" />
                    <Text className="text-white mt-2">Parsing ACARS...</Text>
                  </View>
                )}

                {/* Edit button overlay on captured image */}
                {status !== "parsing" && (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMode("manual");
                      setStatus("success");
                    }}
                    className="absolute right-3 top-3 bg-slate-900/80 border border-slate-600/50 rounded-xl px-3 py-2 flex-row items-center"
                  >
                    <Edit3 size={16} color="#f59e0b" />
                    <Text className="text-amber-500 text-xs font-semibold ml-1.5">Edit Manually</Text>
                  </Pressable>
                )}
              </View>

              {/* Parse Result Info */}
              {parseResult && (
                <View className="flex-row items-center justify-between mt-3">
                  <View className="flex-row items-center">
                    {parseResult.success ? (
                      <>
                        <Sparkles size={16} color="#22c55e" />
                        <Text className="text-green-400 text-sm ml-1.5">
                          Parsed via {parseResult.method.toUpperCase()}
                        </Text>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={16} color="#f59e0b" />
                        <Text className="text-amber-400 text-sm ml-1.5">
                          Manual entry required
                        </Text>
                      </>
                    )}
                  </View>
                  <ConfidenceBadge confidence={parseResult.confidence} />
                </View>
              )}

              {/* Retry Button */}
              <Pressable
                onPress={handleRetry}
                className="flex-row items-center justify-center mt-3 py-2"
              >
                <RefreshCw size={16} color="#64748b" />
                <Text className="text-slate-400 ml-1.5">Scan Again</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* OOOI Entry Form */}
          {(status === "success" || status === "error" || mode === "manual") && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              {/* Flight Info */}
              <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                Flight Information
              </Text>
              <View className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50 mb-4">
                <View className="flex-row gap-3 mb-3">
                  <View className="flex-1">
                    <Text className="text-slate-400 text-xs mb-1">Flight #</Text>
                    <TextInput
                      className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white"
                      value={oooi.flightNumber}
                      onChangeText={(v) =>
                        setOooi((o) => ({ ...o, flightNumber: v.toUpperCase() }))
                      }
                      placeholder="UA1234"
                      placeholderTextColor="#64748b"
                      autoCapitalize="characters"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-slate-400 text-xs mb-1">Date</Text>
                    <TextInput
                      className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white"
                      value={oooi.date}
                      onChangeText={(v) => setOooi((o) => ({ ...o, date: v }))}
                      placeholder="2026-01-15"
                      placeholderTextColor="#64748b"
                    />
                  </View>
                </View>
                <View className="flex-row items-center gap-3">
                  <View className="flex-1">
                    <Text className="text-slate-400 text-xs mb-1">Origin</Text>
                    <TextInput
                      className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white text-center"
                      value={oooi.origin}
                      onChangeText={(v) =>
                        setOooi((o) => ({
                          ...o,
                          origin: v.toUpperCase().slice(0, 3),
                        }))
                      }
                      placeholder="SDF"
                      placeholderTextColor="#64748b"
                      maxLength={3}
                      autoCapitalize="characters"
                    />
                  </View>
                  <ArrowRight size={20} color="#64748b" />
                  <View className="flex-1">
                    <Text className="text-slate-400 text-xs mb-1">Dest</Text>
                    <TextInput
                      className="bg-slate-800/80 border border-slate-700/50 rounded-xl px-3 py-2.5 text-white text-center"
                      value={oooi.destination}
                      onChangeText={(v) =>
                        setOooi((o) => ({
                          ...o,
                          destination: v.toUpperCase().slice(0, 3),
                        }))
                      }
                      placeholder="LAX"
                      placeholderTextColor="#64748b"
                      maxLength={3}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>
              </View>

              {/* OOOI Times */}
              <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
                OOOI Times (24hr format)
              </Text>
              <View className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50 mb-4">
                <View className="flex-row gap-3 mb-3">
                  <TimeInput
                    label="OUT (Gate Dept)"
                    value={oooi.outTime}
                    onChange={(v) => setOooi((o) => ({ ...o, outTime: v }))}
                    color="text-blue-400"
                  />
                  <TimeInput
                    label="OFF (Takeoff)"
                    value={oooi.offTime}
                    onChange={(v) => setOooi((o) => ({ ...o, offTime: v }))}
                    color="text-purple-400"
                  />
                </View>
                <View className="flex-row gap-3">
                  <TimeInput
                    label="ON (Landing)"
                    value={oooi.onTime}
                    onChange={(v) => setOooi((o) => ({ ...o, onTime: v }))}
                    color="text-amber-400"
                  />
                  <TimeInput
                    label="IN (Gate Arr)"
                    value={oooi.inTime}
                    onChange={(v) => setOooi((o) => ({ ...o, inTime: v }))}
                    color="text-green-400"
                  />
                </View>
              </View>

              {/* Calculated Times */}
              <View className="flex-row gap-3 mb-6">
                <View className="flex-1 bg-slate-800/40 rounded-xl p-3 border border-slate-700/50">
                  <Text className="text-slate-400 text-xs">Block Time</Text>
                  <Text className="text-white text-xl font-bold font-mono">
                    {calculateBlockTime(oooi.outTime, oooi.inTime)}
                  </Text>
                </View>
                <View className="flex-1 bg-slate-800/40 rounded-xl p-3 border border-slate-700/50">
                  <Text className="text-slate-400 text-xs">Flight Time</Text>
                  <Text className="text-white text-xl font-bold font-mono">
                    {calculateFlightTime(oooi.offTime, oooi.onTime)}
                  </Text>
                </View>
              </View>

              {/* Apply Button */}
              <Pressable
                onPress={handleApply}
                className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center"
              >
                <Check size={20} color="#000" />
                <Text className="text-black font-bold text-lg ml-2">
                  Save OOOI Times
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Instructions */}
          {mode !== "manual" && status === "idle" && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(250)}
              className="mx-5 mt-6"
            >
              <View className="bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50">
                <Text className="text-slate-400 text-sm font-semibold mb-2">
                  Tips for best results:
                </Text>
                <Text className="text-slate-500 text-sm leading-5">
                  • Works even if ACARS screen is sideways{"\n"}
                  • Capture the full ACARS message{"\n"}
                  • Ensure text is clearly visible{"\n"}
                  • Good lighting improves accuracy
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
