/**
 * Contract & Pay References Screen
 *
 * Allows users to upload, manage, and view their CBA, pay manual,
 * and other contract documents for AI reference context.
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp, Layout } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import {
  FileText,
  ChevronLeft,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileCheck,
  ChevronRight,
  Info,
  X,
  Search,
} from "lucide-react-native";
import {
  useContracts,
  useUploadContract,
  useDeleteContract,
  useReparseContract,
  formatDocumentType,
  formatParseStatus,
  formatFileSize,
} from "@/lib/useContracts";
import type { ContractDocument, ContractDocumentType } from "@/lib/contracts";

// Document type options for picker
const DOCUMENT_TYPES: { value: ContractDocumentType; label: string; description: string }[] = [
  { value: "CBA", label: "CBA", description: "Collective Bargaining Agreement" },
  { value: "PAY_MANUAL", label: "Pay Manual", description: "Company pay manual or guide" },
  { value: "LOA", label: "LOA", description: "Letter of Agreement" },
  { value: "COMPANY_POLICY", label: "Company Policy", description: "Policy documents" },
  { value: "OTHER", label: "Other", description: "Other reference documents" },
];

// Reference-only disclaimer
const DISCLAIMER_TEXT =
  "These documents are used for reference only. The app does not interpret or enforce contract terms.";

// ============================================
// COMPONENTS
// ============================================

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <View className="items-center py-12 px-6">
      <View className="w-20 h-20 rounded-full bg-slate-800/60 items-center justify-center mb-4">
        <FileText size={40} color="#64748b" />
      </View>
      <Text className="text-white text-xl font-semibold text-center">
        No Documents Uploaded
      </Text>
      <Text className="text-slate-400 text-center mt-2 leading-relaxed">
        Upload your CBA, pay manual, or LOAs so AI can reference your contract
        language when schedule changes happen.
      </Text>
      <Pressable
        onPress={onUpload}
        className="bg-amber-500 rounded-2xl px-6 py-3 mt-6 flex-row items-center active:opacity-80"
      >
        <Plus size={20} color="#0f172a" />
        <Text className="text-slate-900 font-bold ml-2">Upload Document</Text>
      </Pressable>
    </View>
  );
}

function DocumentCard({
  document,
  onDelete,
  onReparse,
  onPress,
}: {
  document: ContractDocument;
  onDelete: () => void;
  onReparse: () => void;
  onPress: () => void;
}) {
  const statusConfig = formatParseStatus(document.parseStatus);

  const StatusIcon =
    document.parseStatus === "success"
      ? CheckCircle2
      : document.parseStatus === "failed"
        ? AlertCircle
        : Clock;

  return (
    <Pressable
      onPress={onPress}
      className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50 active:opacity-90"
    >
      <View className="flex-row items-start">
        <View className="w-12 h-12 rounded-xl bg-amber-500/20 items-center justify-center">
          <FileText size={24} color="#f59e0b" />
        </View>

        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {document.title}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <Text className="text-slate-400 text-sm">
              {formatDocumentType(document.documentType as ContractDocumentType)}
            </Text>
            {document.versionLabel && (
              <>
                <Text className="text-slate-600 mx-1">•</Text>
                <Text className="text-amber-500/80 text-sm font-medium">
                  {document.versionLabel}
                </Text>
              </>
            )}
          </View>

          <View className="flex-row items-center mt-2">
            <StatusIcon size={14} color={statusConfig.color} />
            <Text
              className="text-sm ml-1"
              style={{ color: statusConfig.color }}
            >
              {statusConfig.label}
            </Text>
            <Text className="text-slate-500 text-xs ml-3">
              {formatFileSize(document.fileSize)}
            </Text>
          </View>
        </View>

        <ChevronRight size={20} color="#64748b" />
      </View>

      {/* Action buttons */}
      <View className="flex-row items-center justify-end mt-3 pt-3 border-t border-slate-700/30">
        {document.parseStatus === "failed" && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReparse();
            }}
            className="flex-row items-center px-3 py-1.5 rounded-lg bg-amber-500/10 mr-2 active:opacity-70"
          >
            <RefreshCw size={14} color="#f59e0b" />
            <Text className="text-amber-500 text-sm font-medium ml-1">Retry</Text>
          </Pressable>
        )}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          className="flex-row items-center px-3 py-1.5 rounded-lg bg-red-500/10 active:opacity-70"
        >
          <Trash2 size={14} color="#ef4444" />
          <Text className="text-red-400 text-sm font-medium ml-1">Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function DisclaimerModal({
  visible,
  onAccept,
  onCancel,
}: {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable
        className="flex-1 bg-black/60 items-center justify-center px-6"
        onPress={onCancel}
      >
        <Pressable
          className="bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-700"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="items-center mb-4">
            <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center">
              <Info size={32} color="#f59e0b" />
            </View>
          </View>

          <Text className="text-white text-xl font-bold text-center">
            Reference-Only Disclaimer
          </Text>

          <Text className="text-slate-400 text-center mt-4 leading-relaxed">
            {DISCLAIMER_TEXT}
          </Text>

          <View className="bg-slate-800/60 rounded-xl p-4 mt-4 border border-slate-700/50">
            <Text className="text-slate-300 text-sm leading-relaxed">
              <Text className="font-semibold">AI may:</Text>
              {"\n"}• Index headings and sections
              {"\n"}• Surface relevant excerpts
              {"\n"}• Summarize what sections discuss
              {"\n\n"}
              <Text className="font-semibold text-red-400">AI may NOT:</Text>
              {"\n"}• Interpret entitlement
              {"\n"}• Apply contract logic automatically
              {"\n"}• Declare pay owed
              {"\n"}• Accuse payroll/company error
            </Text>
          </View>

          <View className="flex-row gap-3 mt-6">
            <Pressable
              onPress={onCancel}
              className="flex-1 bg-slate-700/50 rounded-2xl py-3 items-center active:opacity-70"
            >
              <Text className="text-white font-semibold">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
              className="flex-1 bg-amber-500 rounded-2xl py-3 items-center active:opacity-80"
            >
              <Text className="text-slate-900 font-bold">I Understand</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UploadModal({
  visible,
  onClose,
  onUpload,
  isUploading,
}: {
  visible: boolean;
  onClose: () => void;
  onUpload: (file: DocumentPicker.DocumentPickerAsset, title: string, type: ContractDocumentType, versionLabel?: string) => void;
  isUploading: boolean;
}) {
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState("");
  const [versionLabel, setVersionLabel] = useState(""); // Phase 1: Version label
  const [documentType, setDocumentType] = useState<ContractDocumentType>("CBA");

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        const file = result.assets[0];
        setSelectedFile(file);
        // Auto-fill title from filename if empty
        if (!title) {
          const name = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
          setTitle(name);
          // Try to extract version from filename (e.g., "Contract 16", "UPS CBA 2023")
          const versionMatch = name.match(/(\d+|20\d{2})/);
          if (versionMatch && !versionLabel) {
            setVersionLabel(`Version ${versionMatch[0]}`);
          }
        }
      }
    } catch (error) {
      console.error("Document picker error:", error);
      Alert.alert("Error", "Failed to pick document");
    }
  };

  const handleUpload = () => {
    if (!selectedFile || !title.trim()) {
      Alert.alert("Missing Information", "Please select a file and provide a title.");
      return;
    }
    onUpload(selectedFile, title.trim(), documentType, versionLabel.trim() || undefined);
  };

  const handleClose = () => {
    setSelectedFile(null);
    setTitle("");
    setVersionLabel("");
    setDocumentType("CBA");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable
        className="flex-1 bg-black/60 justify-end"
        onPress={handleClose}
      >
        <Pressable
          className="bg-slate-900 rounded-t-3xl p-6 border-t border-slate-700"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-white text-xl font-bold">Upload Document</Text>
            <Pressable
              onPress={handleClose}
              className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
            >
              <X size={18} color="#94a3b8" />
            </Pressable>
          </View>

          {/* File picker */}
          <Text className="text-slate-400 text-sm font-semibold mb-2">
            DOCUMENT FILE
          </Text>
          <Pressable
            onPress={handlePickDocument}
            className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50 mb-4 active:opacity-80"
          >
            {selectedFile ? (
              <View className="flex-row items-center">
                <FileCheck size={24} color="#22c55e" />
                <View className="flex-1 ml-3">
                  <Text className="text-white font-medium" numberOfLines={1}>
                    {selectedFile.name}
                  </Text>
                  <Text className="text-slate-500 text-sm">
                    {formatFileSize(selectedFile.size ?? 0)}
                  </Text>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center">
                <Plus size={24} color="#64748b" />
                <Text className="text-slate-400 ml-3">
                  Tap to select PDF, image, or Word doc
                </Text>
              </View>
            )}
          </Pressable>

          {/* Title input */}
          <Text className="text-slate-400 text-sm font-semibold mb-2">
            DOCUMENT TITLE
          </Text>
          <View className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50 mb-4">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Enter document title..."
              placeholderTextColor="#64748b"
              className="text-white text-base"
              autoCapitalize="words"
            />
          </View>

          {/* Version label input (Phase 1) */}
          <Text className="text-slate-400 text-sm font-semibold mb-2">
            VERSION LABEL <Text className="text-slate-500 font-normal">(optional)</Text>
          </Text>
          <View className="bg-slate-800/60 rounded-xl px-4 py-3 border border-slate-700/50 mb-4">
            <TextInput
              value={versionLabel}
              onChangeText={setVersionLabel}
              placeholder="e.g., Contract 16, 2024 Edition"
              placeholderTextColor="#64748b"
              className="text-white text-base"
              autoCapitalize="words"
            />
          </View>

          {/* Document type selector */}
          <Text className="text-slate-400 text-sm font-semibold mb-2">
            DOCUMENT TYPE
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-6"
            style={{ flexGrow: 0 }}
          >
            <View className="flex-row gap-2">
              {DOCUMENT_TYPES.map((type) => (
                <Pressable
                  key={type.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setDocumentType(type.value);
                  }}
                  className={`px-4 py-2 rounded-xl ${
                    documentType === type.value
                      ? "bg-amber-500"
                      : "bg-slate-800/60 border border-slate-700/50"
                  }`}
                >
                  <Text
                    className={`font-medium ${
                      documentType === type.value
                        ? "text-slate-900"
                        : "text-slate-300"
                    }`}
                  >
                    {type.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Upload button */}
          <Pressable
            onPress={handleUpload}
            disabled={isUploading || !selectedFile || !title.trim()}
            className={`rounded-2xl py-4 items-center ${
              isUploading || !selectedFile || !title.trim()
                ? "bg-slate-700/50"
                : "bg-amber-500 active:opacity-80"
            }`}
          >
            {isUploading ? (
              <View className="flex-row items-center">
                <ActivityIndicator size="small" color="#0f172a" />
                <Text className="text-slate-900 font-bold ml-2">Uploading...</Text>
              </View>
            ) : (
              <Text
                className={`font-bold ${
                  !selectedFile || !title.trim()
                    ? "text-slate-500"
                    : "text-slate-900"
                }`}
              >
                Upload Document
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ContractReferencesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch } = useContracts();
  const uploadMutation = useUploadContract();
  const deleteMutation = useDeleteContract();
  const reparseMutation = useReparseContract();

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    file: DocumentPicker.DocumentPickerAsset;
    title: string;
    type: ContractDocumentType;
    versionLabel?: string;
  } | null>(null);

  const handleStartUpload = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowUploadModal(true);
  }, []);

  const handleUploadRequest = useCallback(
    (file: DocumentPicker.DocumentPickerAsset, title: string, type: ContractDocumentType, versionLabel?: string) => {
      // Store pending upload and show disclaimer
      setPendingUpload({ file, title, type, versionLabel });
      setShowUploadModal(false);
      setShowDisclaimerModal(true);
    },
    []
  );

  const handleDisclaimerAccept = useCallback(async () => {
    if (!pendingUpload) return;

    setShowDisclaimerModal(false);

    try {
      await uploadMutation.mutateAsync({
        file: {
          uri: pendingUpload.file.uri,
          name: pendingUpload.file.name,
          type: pendingUpload.file.mimeType ?? "application/pdf",
        },
        title: pendingUpload.title,
        documentType: pendingUpload.type,
        versionLabel: pendingUpload.versionLabel,
        disclaimerAccepted: true,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Contract Uploaded",
        `"${pendingUpload.title}" has been saved and is now active. AI will reference this document when analyzing your schedule changes.`,
        [{ text: "Got it" }]
      );
      setPendingUpload(null);
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Upload Failed",
        error instanceof Error ? error.message : "Failed to upload document"
      );
    }
  }, [pendingUpload, uploadMutation]);

  const handleDisclaimerCancel = useCallback(() => {
    setShowDisclaimerModal(false);
    setPendingUpload(null);
  }, []);

  const handleDelete = useCallback(
    (document: ContractDocument) => {
      Alert.alert(
        "Delete Document",
        `Are you sure you want to delete "${document.title}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteMutation.mutateAsync(document.id);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (error) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert("Error", "Failed to delete document");
              }
            },
          },
        ]
      );
    },
    [deleteMutation]
  );

  const handleReparse = useCallback(
    async (document: ContractDocument) => {
      try {
        await reparseMutation.mutateAsync(document.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Success", "Document re-processing has been queued.");
      } catch (error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Error", "Failed to re-process document");
      }
    },
    [reparseMutation]
  );

  const documents = data?.documents ?? [];

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
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <FileText size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">
              Contract References
            </Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              Upload documents for AI context
            </Text>
          </Animated.View>

          {/* Info Banner */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-4"
          >
            <View className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <View className="flex-row items-start">
                <Info size={18} color="#3b82f6" />
                <Text className="text-blue-300 text-sm flex-1 ml-2 leading-relaxed">
                  Upload your CBA, pay manual, or LOAs so AI can surface relevant
                  sections when schedule changes occur.{" "}
                  <Text className="font-semibold">Reference only</Text> — AI will
                  not interpret or enforce terms.
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Loading State */}
          {isLoading && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text className="text-slate-400 mt-3">Loading documents...</Text>
            </View>
          )}

          {/* Empty State */}
          {!isLoading && documents.length === 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <EmptyState onUpload={handleStartUpload} />
            </Animated.View>
          )}

          {/* Document List */}
          {!isLoading && documents.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              {/* Search Contract Button */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/search-contract");
                }}
                className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4 mb-4 flex-row items-center active:opacity-80"
              >
                <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center">
                  <Search size={20} color="#22c55e" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold text-base">
                    Search My Contract
                  </Text>
                  <Text className="text-slate-400 text-sm">
                    AI-assisted keyword search
                  </Text>
                </View>
                <ChevronRight size={20} color="#22c55e" />
              </Pressable>

              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                  Your Documents ({documents.length})
                </Text>
                <Pressable
                  onPress={handleStartUpload}
                  className="flex-row items-center active:opacity-70"
                >
                  <Plus size={16} color="#f59e0b" />
                  <Text className="text-amber-500 text-sm font-semibold ml-1">
                    Add
                  </Text>
                </Pressable>
              </View>

              <View className="gap-3">
                {documents.map((doc, index) => (
                  <Animated.View
                    key={doc.id}
                    entering={FadeInUp.duration(400).delay(250 + index * 50)}
                    layout={Layout.springify()}
                  >
                    <DocumentCard
                      document={doc}
                      onDelete={() => handleDelete(doc)}
                      onReparse={() => handleReparse(doc)}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        // Navigate to contract viewer
                        router.push({
                          pathname: "/contract-viewer",
                          params: { id: doc.id },
                        });
                      }}
                    />
                  </Animated.View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Disclaimer Reminder */}
          {documents.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(400)}
              className="mx-5 mt-6"
            >
              <View className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
                <Text className="text-slate-500 text-sm text-center">
                  {DISCLAIMER_TEXT}
                </Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* FAB for upload when documents exist */}
        {!isLoading && documents.length > 0 && (
          <Pressable
            onPress={handleStartUpload}
            className="absolute bottom-8 right-5 w-14 h-14 rounded-full bg-amber-500 items-center justify-center shadow-lg active:opacity-80"
            style={{ bottom: insets.bottom + 80 }}
          >
            <Plus size={28} color="#0f172a" />
          </Pressable>
        )}
      </LinearGradient>

      {/* Modals */}
      <UploadModal
        visible={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleUploadRequest}
        isUploading={uploadMutation.isPending}
      />

      <DisclaimerModal
        visible={showDisclaimerModal}
        onAccept={handleDisclaimerAccept}
        onCancel={handleDisclaimerCancel}
      />
    </View>
  );
}
