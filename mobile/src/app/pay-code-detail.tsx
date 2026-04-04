/**
 * Pay Code Detail Screen (Holy Grail)
 *
 * Shows full details for a single pay code including:
 * - Plain-English Summary
 * - What to Document Checklist
 * - Contract References (user-uploaded only)
 * - User Notes
 * - Related Items
 */

import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import {
  Book,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  CheckSquare,
  Square,
  Clipboard,
  Plus,
  ExternalLink,
  Info,
  Star,
  Shield,
  ShieldCheck,
  RefreshCw,
  Clock,
  GraduationCap,
  Plane,
  AlertTriangle,
  DollarSign,
  HelpCircle,
  StickyNote,
  ListChecks,
  Upload,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { usePayCode, getCategoryDisplay } from "@/lib/usePayCodes";
import { useProfile } from "@/lib/state/profile-store";
import { cn } from "@/lib/cn";
import type { DocumentChecklistItem, PayCodeReference, UserPayCode } from "@/lib/contracts";

// ============================================
// ICON MAPPING
// ============================================

const CategoryIcon: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Star,
  Shield,
  ShieldCheck,
  RefreshCw,
  Clock,
  GraduationCap,
  Plane,
  AlertTriangle,
  DollarSign,
  HelpCircle,
};

function getCategoryIcon(iconName: string) {
  return CategoryIcon[iconName] ?? HelpCircle;
}

// ============================================
// DISCLAIMER BANNER
// ============================================

function DisclaimerBanner() {
  return (
    <View className="bg-amber-500/10 rounded-xl p-3 border border-amber-500/20 flex-row items-start">
      <Info size={16} color="#f59e0b" className="mt-0.5" />
      <Text className="text-amber-400/80 text-xs ml-2 flex-1">
        This is informational and may require review. The app does not interpret or enforce contract terms.
      </Text>
    </View>
  );
}

// ============================================
// CHECKLIST SECTION
// ============================================

interface ChecklistSectionProps {
  checklist: DocumentChecklistItem[];
  onLogEvent: () => void;
}

function ChecklistSection({ checklist, onLogEvent }: ChecklistSectionProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggleItem = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-4">
        <ListChecks size={18} color="#f59e0b" />
        <Text className="text-white font-semibold text-base ml-2">
          What to Document
        </Text>
      </View>

      <View className="gap-3">
        {checklist.map((item) => {
          const isChecked = checked.has(item.id);
          return (
            <Pressable
              key={item.id}
              onPress={() => toggleItem(item.id)}
              className="flex-row items-start"
            >
              {isChecked ? (
                <CheckSquare size={20} color="#22c55e" />
              ) : (
                <Square size={20} color="#64748b" />
              )}
              <View className="flex-1 ml-3">
                <Text
                  className={cn(
                    "text-sm",
                    isChecked ? "text-slate-400 line-through" : "text-slate-200"
                  )}
                >
                  {item.label}
                </Text>
                {item.isRequired && !isChecked && (
                  <Text className="text-amber-500 text-xs mt-0.5">Required</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onLogEvent();
        }}
        className="bg-amber-500 rounded-xl px-4 py-3 mt-4 flex-row items-center justify-center active:opacity-80"
      >
        <Plus size={18} color="#0f172a" />
        <Text className="text-slate-900 font-bold ml-2">Log This as a Pay Event</Text>
      </Pressable>
    </View>
  );
}

// ============================================
// CONTRACT REFERENCES SECTION
// ============================================

interface ContractReferencesSectionProps {
  references: PayCodeReference[];
  hasContracts: boolean;
  onUploadContract: () => void;
  onOpenDocument: (ref: PayCodeReference) => void;
}

function ContractReferencesSection({
  references,
  hasContracts,
  onUploadContract,
  onOpenDocument,
}: ContractReferencesSectionProps) {
  if (!hasContracts) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
        <View className="flex-row items-center mb-3">
          <FileText size={18} color="#8b5cf6" />
          <Text className="text-white font-semibold text-base ml-2">
            Contract References
          </Text>
        </View>

        <View className="items-center py-4">
          <FileText size={32} color="#64748b" />
          <Text className="text-slate-400 text-center mt-2">
            No contract uploaded yet
          </Text>
          <Pressable
            onPress={onUploadContract}
            className="bg-purple-500/20 rounded-xl px-4 py-2 mt-3 flex-row items-center active:opacity-80"
          >
            <Upload size={16} color="#8b5cf6" />
            <Text className="text-purple-400 font-medium ml-2">Upload Contract</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (references.length === 0) {
    return (
      <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
        <View className="flex-row items-center mb-3">
          <FileText size={18} color="#8b5cf6" />
          <Text className="text-white font-semibold text-base ml-2">
            Contract References
          </Text>
        </View>

        <View className="items-center py-4">
          <Text className="text-slate-400 text-center">
            No references found in your uploaded documents
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-4">
        <FileText size={18} color="#8b5cf6" />
        <Text className="text-white font-semibold text-base ml-2">
          Contract References
        </Text>
        <View className="ml-2 bg-purple-500/20 px-2 py-0.5 rounded-full">
          <Text className="text-purple-400 text-xs font-medium">{references.length}</Text>
        </View>
      </View>

      <View className="gap-3">
        {references.map((ref) => (
          <Pressable
            key={ref.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenDocument(ref);
            }}
            className="bg-slate-700/30 rounded-xl p-3 active:bg-slate-700/50"
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-white font-medium" numberOfLines={1}>
                  {ref.documentTitle}
                </Text>
                {ref.sectionHeading && (
                  <Text className="text-slate-400 text-sm mt-0.5" numberOfLines={1}>
                    {ref.sectionHeading}
                  </Text>
                )}
                <View className="flex-row items-center mt-1 gap-2">
                  {ref.sectionRef && (
                    <Text className="text-slate-500 text-xs">{ref.sectionRef}</Text>
                  )}
                  {ref.pageNumber && (
                    <Text className="text-slate-500 text-xs">Page {ref.pageNumber}</Text>
                  )}
                  <View
                    className={cn(
                      "px-1.5 py-0.5 rounded",
                      ref.confidence === "high"
                        ? "bg-green-500/20"
                        : ref.confidence === "medium"
                          ? "bg-amber-500/20"
                          : "bg-slate-600/50"
                    )}
                  >
                    <Text
                      className={cn(
                        "text-xs",
                        ref.confidence === "high"
                          ? "text-green-400"
                          : ref.confidence === "medium"
                            ? "text-amber-400"
                            : "text-slate-400"
                      )}
                    >
                      {ref.confidence}
                    </Text>
                  </View>
                </View>
              </View>
              <ExternalLink size={16} color="#64748b" />
            </View>

            {ref.excerpt && (
              <Text className="text-slate-400 text-sm mt-2 italic" numberOfLines={3}>
                "{ref.excerpt}"
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ============================================
// USER NOTES SECTION
// ============================================

interface UserNotesSectionProps {
  notes: string | null;
  onSave: (notes: string) => void;
}

function UserNotesSection({ notes, onSave }: UserNotesSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(notes ?? "");

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSave(editValue);
    setIsEditing(false);
  };

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <StickyNote size={18} color="#22c55e" />
          <Text className="text-white font-semibold text-base ml-2">My Notes</Text>
        </View>
        {!isEditing && (
          <Pressable
            onPress={() => setIsEditing(true)}
            className="px-2 py-1 active:opacity-50"
          >
            <Text className="text-amber-500 text-sm">Edit</Text>
          </Pressable>
        )}
      </View>

      {isEditing ? (
        <View>
          <TextInput
            value={editValue}
            onChangeText={setEditValue}
            placeholder="Add your notes, examples, or reminders..."
            placeholderTextColor="#64748b"
            className="bg-slate-700/50 rounded-xl p-3 text-white text-sm min-h-[100px]"
            multiline
            textAlignVertical="top"
          />
          <View className="flex-row gap-2 mt-3">
            <Pressable
              onPress={() => {
                setEditValue(notes ?? "");
                setIsEditing(false);
              }}
              className="flex-1 bg-slate-700 rounded-xl py-2 active:opacity-80"
            >
              <Text className="text-slate-300 text-center font-medium">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              className="flex-1 bg-amber-500 rounded-xl py-2 active:opacity-80"
            >
              <Text className="text-slate-900 text-center font-bold">Save</Text>
            </Pressable>
          </View>
        </View>
      ) : notes ? (
        <Text className="text-slate-300 text-sm">{notes}</Text>
      ) : (
        <Text className="text-slate-500 text-sm italic">
          No notes yet. Tap Edit to add your own notes or examples.
        </Text>
      )}
    </View>
  );
}

// ============================================
// RELATED CODES SECTION
// ============================================

interface RelatedCodesSectionProps {
  codes: UserPayCode[];
  onCodePress: (code: UserPayCode) => void;
}

function RelatedCodesSection({ codes, onCodePress }: RelatedCodesSectionProps) {
  if (codes.length === 0) return null;

  return (
    <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <View className="flex-row items-center mb-3">
        <Link2 size={18} color="#3b82f6" />
        <Text className="text-white font-semibold text-base ml-2">Related Codes</Text>
      </View>

      <View className="gap-2">
        {codes.map((code) => (
          <Pressable
            key={code.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onCodePress(code);
            }}
            className="flex-row items-center bg-slate-700/30 rounded-xl p-3 active:bg-slate-700/50"
          >
            <View className="flex-1">
              <Text className="text-white font-medium">{code.displayName}</Text>
              {code.shortCode && (
                <Text className="text-slate-400 text-xs mt-0.5">{code.shortCode}</Text>
              )}
            </View>
            <ChevronRight size={16} color="#64748b" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function PayCodeDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ codeId?: string; codeKey?: string }>();
  const profile = useProfile();

  const codeId = params.codeId ?? params.codeKey ?? null;
  const { data, isLoading } = usePayCode(codeId);

  const code = data?.code;
  const checklist = data?.checklist ?? [];
  const relatedCodes = data?.relatedCodes ?? [];
  const hasContracts = data?.hasContracts ?? false;

  const categoryDisplay = code ? getCategoryDisplay(code.category) : null;
  const Icon = categoryDisplay ? getCategoryIcon(categoryDisplay.icon) : HelpCircle;

  const handleLogEvent = useCallback(() => {
    router.push("/add");
  }, [router]);

  const handleUploadContract = useCallback(() => {
    router.push("/contract-references");
  }, [router]);

  const handleOpenDocument = useCallback((ref: PayCodeReference) => {
    // In a full implementation, this would deep-link to the document
    router.push("/contract-references");
  }, [router]);

  const handleSaveNotes = useCallback((notes: string) => {
    // In a full implementation, this would save to backend
    console.log("Saving notes:", notes);
  }, []);

  const handleRelatedCodePress = useCallback(
    (relatedCode: UserPayCode) => {
      router.push({
        pathname: "/pay-code-detail",
        params: { codeId: relatedCode.id, codeKey: relatedCode.codeKey },
      });
    },
    [router]
  );

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

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
            {/* Back Button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }}
              className="flex-row items-center mb-4"
            >
              <ChevronLeft size={20} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-medium ml-1">
                Pay Code Library
              </Text>
            </Pressable>

            {/* Loading */}
            {isLoading && (
              <View className="items-center py-12">
                <ActivityIndicator size="large" color="#f59e0b" />
                <Text className="text-slate-400 mt-3">Loading...</Text>
              </View>
            )}

            {/* Code Header */}
            {code && categoryDisplay && (
              <View className="flex-row items-start">
                <View
                  className={cn(
                    "w-14 h-14 rounded-xl items-center justify-center mr-4",
                    categoryDisplay.bgColor
                  )}
                >
                  <Icon size={28} color={categoryDisplay.color} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <Text className="text-white text-2xl font-bold flex-1">
                      {code.displayName}
                    </Text>
                  </View>
                  <View className="flex-row items-center mt-1 gap-2">
                    {code.shortCode && (
                      <View className="bg-slate-700/50 px-2 py-0.5 rounded">
                        <Text className="text-slate-300 text-sm font-mono">
                          {code.shortCode}
                        </Text>
                      </View>
                    )}
                    <Text className="text-slate-400 text-sm">
                      {profile?.airline ?? "Airline"}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </Animated.View>

          {code && (
            <>
              {/* Disclaimer */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-4"
              >
                <DisclaimerBanner />
              </Animated.View>

              {/* Summary Section */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(200)}
                className="mx-5 mt-4"
              >
                <View className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
                  <View className="flex-row items-center mb-3">
                    <Clipboard size={18} color="#f59e0b" />
                    <Text className="text-white font-semibold text-base ml-2">
                      Summary
                    </Text>
                  </View>

                  <Text className="text-slate-300 text-sm leading-relaxed">
                    {code.description ?? code.summary ?? "No description available."}
                  </Text>

                  {/* Bullet points */}
                  <View className="mt-3 gap-2">
                    <View className="flex-row">
                      <Text className="text-amber-500 mr-2">•</Text>
                      <Text className="text-slate-400 text-sm flex-1">
                        This code typically applies when specific conditions are met
                      </Text>
                    </View>
                    <View className="flex-row">
                      <Text className="text-amber-500 mr-2">•</Text>
                      <Text className="text-slate-400 text-sm flex-1">
                        Document all relevant details to support any pay review
                      </Text>
                    </View>
                    <View className="flex-row">
                      <Text className="text-amber-500 mr-2">•</Text>
                      <Text className="text-slate-400 text-sm flex-1">
                        Consult your contract for specific language and conditions
                      </Text>
                    </View>
                  </View>
                </View>
              </Animated.View>

              {/* Checklist Section */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="mx-5 mt-4"
              >
                <ChecklistSection checklist={checklist} onLogEvent={handleLogEvent} />
              </Animated.View>

              {/* Contract References Section */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(300)}
                className="mx-5 mt-4"
              >
                <ContractReferencesSection
                  references={code.references ?? []}
                  hasContracts={hasContracts}
                  onUploadContract={handleUploadContract}
                  onOpenDocument={handleOpenDocument}
                />
              </Animated.View>

              {/* User Notes Section */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(350)}
                className="mx-5 mt-4"
              >
                <UserNotesSection notes={code.userNotes} onSave={handleSaveNotes} />
              </Animated.View>

              {/* Related Codes Section */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(400)}
                className="mx-5 mt-4"
              >
                <RelatedCodesSection
                  codes={relatedCodes}
                  onCodePress={handleRelatedCodePress}
                />
              </Animated.View>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
