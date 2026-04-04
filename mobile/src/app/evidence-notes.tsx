/**
 * Evidence Notes Screen
 *
 * Write a narrative of what happened and attach photo evidence.
 * Saves notes + photo to the associated log event or pay event record.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import {
  X,
  Camera,
  ImageIcon,
  FileCheck,
  Trash2,
  ChevronLeft,
  AlertCircle,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useUpdateLogEvent } from "@/lib/useLogEvents";
import { uploadImageBase64, api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export default function EvidenceNotesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    entryId,        // e.g. "log-event-abc123" or "pay-event-abc123"
    payEventId,     // raw pay event ID
    title,          // entry title for display
    existingNotes,  // pre-fill with existing notes
  } = useLocalSearchParams<{
    entryId?: string;
    payEventId?: string;
    title?: string;
    existingNotes?: string;
  }>();

  const [notes, setNotes] = useState(existingNotes ?? "");
  const [photo, setPhoto] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const updateLogEvent = useUpdateLogEvent();

  const isLogEvent = entryId?.startsWith("log-event-");
  const rawId = payEventId ?? "";

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhoto({
        uri: asset.uri,
        base64: asset.base64 ?? "",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow camera access.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhoto({
        uri: asset.uri,
        base64: asset.base64 ?? "",
        mimeType: asset.mimeType ?? "image/jpeg",
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!notes.trim() && !photo) {
      Alert.alert("Nothing to save", "Please add some notes or a photo before saving.");
      return;
    }
    if (!rawId) {
      Alert.alert("Error", "No record ID found. Please go back and try again.");
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Upload photo if one was selected
      let attachmentUrl: string | null = null;
      if (photo?.base64) {
        const result = await uploadImageBase64(photo.base64, photo.mimeType);
        attachmentUrl = result.url;
      }

      // Build combined notes (existing + new narrative)
      const notesText = notes.trim();

      if (isLogEvent) {
        // For log events: save notes directly on the event
        const updatePayload: Parameters<typeof updateLogEvent.mutateAsync>[0] = {
          id: rawId,
          notes: notesText || undefined,
        };
        await updateLogEvent.mutateAsync(updatePayload);

        // If photo uploaded, also save as a pay event document if there's a pay event ID
        // Log events don't have a separate documents table, so the photo URL goes in notes
        if (attachmentUrl) {
          const combinedNotes = notesText
            ? `${notesText}\n\n[Attachment]: ${attachmentUrl}`
            : `[Attachment]: ${attachmentUrl}`;
          await updateLogEvent.mutateAsync({ id: rawId, notes: combinedNotes });
        }
      } else {
        // For pay events: add document with note + optional photo attachment
        await api.post(`/api/pay-events/${rawId}/documents`, {
          docType: "NOTE",
          content: notesText || null,
          attachmentUrl: attachmentUrl || null,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["log-events"] });
      await queryClient.invalidateQueries({ queryKey: ["pay-events"] });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      console.error("[EvidenceNotes] Save failed:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Save failed", "Could not save your evidence. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [notes, photo, rawId, isLogEvent, updateLogEvent, queryClient, router]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View
          style={{ paddingTop: insets.top + 12 }}
          className="px-5 pb-4 border-b border-slate-800 flex-row items-center justify-between"
        >
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center rounded-full bg-slate-800 active:opacity-70"
          >
            <ChevronLeft size={22} color="#94a3b8" />
          </Pressable>
          <View className="flex-1 mx-3">
            <Text className="text-white text-lg font-bold" numberOfLines={1}>
              Add Evidence
            </Text>
            {title ? (
              <Text className="text-slate-400 text-xs mt-0.5" numberOfLines={1}>
                {title}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className="bg-amber-500 rounded-xl px-4 py-2 active:opacity-80"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#0f172a" />
            ) : (
              <Text className="text-slate-900 font-bold text-sm">Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Info Banner */}
          <Animated.View entering={FadeInDown.duration(400).delay(50)}>
            <View className="flex-row items-start bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 mb-6">
              <AlertCircle size={18} color="#60a5fa" style={{ marginTop: 1 }} />
              <Text className="text-blue-300 text-sm ml-3 flex-1 leading-5">
                Document what happened in your own words. Photos of schedules, messages, or paperwork strengthen your case.
              </Text>
            </View>
          </Animated.View>

          {/* Notes Section */}
          <Animated.View entering={FadeInDown.duration(400).delay(100)}>
            <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
              What Happened
            </Text>
            <View className="bg-slate-800/70 rounded-2xl border border-slate-700/50 p-4">
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Describe what took place — the date, who was involved, what was said or changed, and how it affected your pay..."
                placeholderTextColor="#475569"
                multiline
                textAlignVertical="top"
                style={{
                  color: "#f1f5f9",
                  fontSize: 15,
                  lineHeight: 22,
                  minHeight: 160,
                  fontFamily: "System",
                }}
                autoFocus={false}
              />
            </View>
            <Text className="text-slate-600 text-xs mt-2 ml-1">
              {notes.length} characters
            </Text>
          </Animated.View>

          {/* Photo Section */}
          <Animated.View entering={FadeInDown.duration(400).delay(150)} className="mt-8">
            <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Photo Evidence
            </Text>

            {photo ? (
              <View className="rounded-2xl overflow-hidden border border-slate-700/50">
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: "100%", height: 220 }}
                  resizeMode="cover"
                />
                <View className="flex-row p-3 bg-slate-800/90 gap-3">
                  <Pressable
                    onPress={() => setPhoto(null)}
                    className="flex-1 flex-row items-center justify-center bg-red-500/20 border border-red-500/30 rounded-xl py-2.5 active:opacity-70"
                  >
                    <Trash2 size={16} color="#f87171" />
                    <Text className="text-red-400 font-semibold ml-2 text-sm">Remove</Text>
                  </Pressable>
                  <Pressable
                    onPress={pickPhoto}
                    className="flex-1 flex-row items-center justify-center bg-slate-700 rounded-xl py-2.5 active:opacity-70"
                  >
                    <ImageIcon size={16} color="#94a3b8" />
                    <Text className="text-slate-300 font-semibold ml-2 text-sm">Replace</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <Pressable
                  onPress={takePhoto}
                  className="flex-1 bg-slate-800/70 border border-slate-700/50 rounded-2xl py-6 items-center justify-center active:opacity-70"
                >
                  <View className="w-12 h-12 rounded-full bg-slate-700 items-center justify-center mb-3">
                    <Camera size={22} color="#f59e0b" />
                  </View>
                  <Text className="text-white font-semibold text-sm">Take Photo</Text>
                  <Text className="text-slate-500 text-xs mt-1">Use camera</Text>
                </Pressable>
                <Pressable
                  onPress={pickPhoto}
                  className="flex-1 bg-slate-800/70 border border-slate-700/50 rounded-2xl py-6 items-center justify-center active:opacity-70"
                >
                  <View className="w-12 h-12 rounded-full bg-slate-700 items-center justify-center mb-3">
                    <ImageIcon size={22} color="#3b82f6" />
                  </View>
                  <Text className="text-white font-semibold text-sm">Choose Photo</Text>
                  <Text className="text-slate-500 text-xs mt-1">From library</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>

          {/* Save Button (bottom) */}
          <Animated.View entering={FadeInDown.duration(400).delay(200)} className="mt-10">
            <Pressable
              onPress={handleSave}
              disabled={isSaving}
              className="bg-amber-500 rounded-2xl py-4 items-center active:opacity-80"
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <View className="flex-row items-center">
                  <FileCheck size={20} color="#0f172a" />
                  <Text className="text-slate-900 font-bold text-base ml-2">
                    Save Evidence
                  </Text>
                </View>
              )}
            </Pressable>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}
