/**
 * Contract Viewer Screen
 *
 * Phase 1-2: PDF/Document viewer with watermark and deep-linking support.
 * Reference-only - displays contract content without interpretation.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertCircle,
  BookOpen,
  List,
  ChevronUp,
  ChevronDown,
  Bookmark,
  History,
  Info,
} from "lucide-react-native";

import {
  useContract,
  useContractSection,
  useLogContractView,
  formatDocumentType,
} from "@/lib/useContracts";
import { CONTRACT_VIEWER_WATERMARK, CONTRACT_DISCLAIMER_TEXT } from "@/lib/contracts";
import type { ContractSection, ContractDocumentType } from "@/lib/contracts";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ============================================
// WATERMARK COMPONENT
// ============================================

function WatermarkBanner() {
  return (
    <View className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2">
      <Text className="text-amber-400 text-xs text-center font-medium">
        {CONTRACT_VIEWER_WATERMARK}
      </Text>
    </View>
  );
}

// ============================================
// SECTION CARD COMPONENT
// ============================================

interface SectionCardProps {
  section: ContractSection;
  isHighlighted: boolean;
  onPress: () => void;
}

function SectionCard({ section, isHighlighted, onPress }: SectionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`bg-slate-800/60 rounded-2xl p-4 border ${
        isHighlighted
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-slate-700/50"
      } active:opacity-80`}
    >
      {/* Section header */}
      <View className="flex-row items-start">
        <View className="flex-1">
          {section.sectionNumber && (
            <Text className="text-amber-500 text-sm font-mono mb-1">
              {section.sectionNumber}
            </Text>
          )}
          <Text className="text-white font-semibold text-base" numberOfLines={2}>
            {section.displayTitle || section.heading}
          </Text>
        </View>
        {section.pageNumber && (
          <View className="bg-slate-700/50 rounded-lg px-2 py-1 ml-2">
            <Text className="text-slate-400 text-xs">
              p. {section.pageNumber}
              {section.pageEndNumber && section.pageEndNumber !== section.pageNumber
                ? `-${section.pageEndNumber}`
                : ""}
            </Text>
          </View>
        )}
      </View>

      {/* Excerpt */}
      {section.excerptText && (
        <View className="mt-3 bg-slate-900/40 rounded-xl p-3 border border-slate-700/30">
          <Text className="text-slate-300 text-sm leading-relaxed" numberOfLines={3}>
            {section.excerptText}
          </Text>
        </View>
      )}

      {/* Topics */}
      {section.topics && (
        <View className="flex-row flex-wrap mt-2">
          {JSON.parse(section.topics)
            .slice(0, 3)
            .map((topic: string, idx: number) => (
              <View
                key={`${topic}-${idx}`}
                className="bg-blue-500/20 px-2 py-0.5 rounded mr-1.5 mb-1"
              >
                <Text className="text-blue-400 text-xs capitalize">
                  {topic.replace(/_/g, " ")}
                </Text>
              </View>
            ))}
        </View>
      )}
    </Pressable>
  );
}

// ============================================
// SECTION CONTENT VIEW
// ============================================

interface SectionContentViewProps {
  section: ContractSection;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  prevLabel: string | null;
  nextLabel: string | null;
}

function SectionContentView({
  section,
  onClose,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: SectionContentViewProps) {
  return (
    <View className="flex-1">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-700/50">
        <Pressable
          onPress={onClose}
          className="p-2 -ml-2 active:opacity-70"
        >
          <ChevronLeft size={24} color="#f59e0b" />
        </Pressable>
        <View className="flex-1 mx-2">
          {section.sectionNumber && (
            <Text className="text-amber-500 text-sm font-mono">
              {section.sectionNumber}
            </Text>
          )}
          <Text className="text-white font-semibold" numberOfLines={1}>
            {section.displayTitle || section.heading}
          </Text>
        </View>
        {section.pageNumber && (
          <View className="bg-slate-700/50 rounded-lg px-3 py-1">
            <Text className="text-slate-400 text-sm">
              Page {section.pageNumber}
            </Text>
          </View>
        )}
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-slate-200 text-base leading-7">
          {section.content}
        </Text>

        {/* Summary if available */}
        {section.summary && (
          <View className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <View className="flex-row items-center mb-2">
              <Info size={16} color="#3b82f6" />
              <Text className="text-blue-400 text-sm font-semibold ml-2">
                Section Overview
              </Text>
            </View>
            <Text className="text-slate-300 text-sm leading-relaxed">
              {section.summary}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Navigation Footer */}
      <View className="px-4 py-3 border-t border-slate-700/50 flex-row items-center">
        <Pressable
          onPress={onPrev ?? undefined}
          disabled={!onPrev}
          className={`flex-1 flex-row items-center py-2 ${
            onPrev ? "active:opacity-70" : "opacity-30"
          }`}
        >
          <ChevronLeft size={18} color="#64748b" />
          <Text
            className="text-slate-400 text-sm ml-1 flex-1"
            numberOfLines={1}
          >
            {prevLabel || "Previous"}
          </Text>
        </Pressable>

        <View className="w-px h-6 bg-slate-700/50 mx-3" />

        <Pressable
          onPress={onNext ?? undefined}
          disabled={!onNext}
          className={`flex-1 flex-row items-center justify-end py-2 ${
            onNext ? "active:opacity-70" : "opacity-30"
          }`}
        >
          <Text
            className="text-slate-400 text-sm mr-1 flex-1 text-right"
            numberOfLines={1}
          >
            {nextLabel || "Next"}
          </Text>
          <ChevronRight size={18} color="#64748b" />
        </Pressable>
      </View>
    </View>
  );
}

// ============================================
// TABLE OF CONTENTS
// ============================================

interface TableOfContentsProps {
  sections: ContractSection[];
  highlightedSectionId: string | null;
  onSelectSection: (section: ContractSection) => void;
  onClose: () => void;
}

function TableOfContents({
  sections,
  highlightedSectionId,
  onSelectSection,
  onClose,
}: TableOfContentsProps) {
  return (
    <View className="flex-1">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-700/50">
        <List size={20} color="#f59e0b" />
        <Text className="text-white font-semibold text-lg ml-2 flex-1">
          Table of Contents
        </Text>
        <Pressable
          onPress={onClose}
          className="p-2 -mr-2 active:opacity-70"
        >
          <Text className="text-amber-500 font-semibold">Done</Text>
        </Pressable>
      </View>

      {/* Section list */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          {sections.map((section) => (
            <Pressable
              key={section.id}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectSection(section);
              }}
              className={`flex-row items-center py-3 px-3 rounded-xl ${
                section.id === highlightedSectionId
                  ? "bg-amber-500/20 border border-amber-500/30"
                  : "bg-slate-800/40 active:bg-slate-700/50"
              }`}
            >
              {section.sectionNumber && (
                <Text className="text-amber-500 text-sm font-mono w-20">
                  {section.sectionNumber}
                </Text>
              )}
              <Text
                className={`flex-1 text-sm ${
                  section.id === highlightedSectionId
                    ? "text-white font-medium"
                    : "text-slate-300"
                }`}
                numberOfLines={2}
              >
                {section.displayTitle || section.heading}
              </Text>
              {section.pageNumber && (
                <Text className="text-slate-500 text-xs ml-2">
                  p.{section.pageNumber}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

type ViewMode = "list" | "content" | "toc";

export default function ContractViewerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    sectionId?: string;
    highlightText?: string;
  }>();

  const documentId = params.id;
  const initialSectionId = params.sectionId;
  const highlightText = params.highlightText;

  // State
  const [viewMode, setViewMode] = useState<ViewMode>(initialSectionId ? "content" : "list");
  const [selectedSection, setSelectedSection] = useState<ContractSection | null>(null);

  // Data
  const { data: contractData, isLoading, error } = useContract(documentId);
  const logViewMutation = useLogContractView();

  const document = contractData?.document;
  const sections = useMemo(
    () => document?.sections ?? [],
    [document?.sections]
  );

  // Find section from URL params
  useEffect(() => {
    if (initialSectionId && sections.length > 0) {
      const section = sections.find((s) => s.id === initialSectionId);
      if (section) {
        setSelectedSection(section);
        setViewMode("content");
      }
    }
  }, [initialSectionId, sections]);

  // Log view when opening document or section
  useEffect(() => {
    if (document) {
      logViewMutation.mutate({
        documentId: document.id,
        sectionId: selectedSection?.id,
        viewSource: initialSectionId ? "deep_link" : "manual",
        referenceCode: selectedSection?.sectionNumber ?? undefined,
        pageNumber: selectedSection?.pageNumber ?? undefined,
      });
    }
  }, [document?.id, selectedSection?.id]);

  // Navigation handlers
  const handleSelectSection = useCallback((section: ContractSection) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedSection(section);
    setViewMode("content");
  }, []);

  const handleCloseContent = useCallback(() => {
    setViewMode("list");
    setSelectedSection(null);
  }, []);

  const handleToggleToc = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewMode((prev) => (prev === "toc" ? "list" : "toc"));
  }, []);

  // Navigate to previous/next section
  const currentSectionIndex = selectedSection
    ? sections.findIndex((s) => s.id === selectedSection.id)
    : -1;

  const prevSection = currentSectionIndex > 0 ? sections[currentSectionIndex - 1] : null;
  const nextSection =
    currentSectionIndex >= 0 && currentSectionIndex < sections.length - 1
      ? sections[currentSectionIndex + 1]
      : null;

  const handlePrevSection = useCallback(() => {
    if (prevSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedSection(prevSection);
    }
  }, [prevSection]);

  const handleNextSection = useCallback(() => {
    if (nextSection) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedSection(nextSection);
    }
  }, [nextSection]);

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text className="text-slate-400 mt-3">Loading document...</Text>
      </View>
    );
  }

  // Error state
  if (error || !document) {
    return (
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        >
          <View
            style={{ paddingTop: insets.top + 16 }}
            className="flex-1 items-center justify-center px-6"
          >
            <View className="w-20 h-20 rounded-full bg-red-500/20 items-center justify-center mb-4">
              <AlertCircle size={40} color="#ef4444" />
            </View>
            <Text className="text-white text-xl font-semibold text-center">
              Document Not Found
            </Text>
            <Text className="text-slate-400 text-center mt-2">
              The requested contract document could not be loaded.
            </Text>
            <Pressable
              onPress={() => router.back()}
              className="bg-amber-500 rounded-2xl px-6 py-3 mt-6 active:opacity-80"
            >
              <Text className="text-slate-900 font-bold">Go Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1e3a5a", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* Safe area header */}
        <View style={{ paddingTop: insets.top }}>
          {/* Watermark banner */}
          <WatermarkBanner />

          {/* Document header */}
          <Animated.View
            entering={FadeInDown.duration(400)}
            className="px-4 py-3 border-b border-slate-700/50"
          >
            <View className="flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>

              <View className="flex-1 mx-3">
                <Text className="text-white font-bold text-lg" numberOfLines={1}>
                  {document.title}
                </Text>
                <View className="flex-row items-center mt-0.5">
                  <Text className="text-slate-400 text-sm">
                    {formatDocumentType(document.documentType as ContractDocumentType)}
                  </Text>
                  {document.versionLabel && (
                    <>
                      <Text className="text-slate-600 mx-1.5">•</Text>
                      <Text className="text-amber-500 text-sm">
                        {document.versionLabel}
                      </Text>
                    </>
                  )}
                </View>
              </View>

              {/* TOC toggle */}
              <Pressable
                onPress={handleToggleToc}
                className={`w-10 h-10 rounded-full items-center justify-center ${
                  viewMode === "toc"
                    ? "bg-amber-500"
                    : "bg-slate-800/60"
                } active:opacity-70`}
              >
                <List
                  size={20}
                  color={viewMode === "toc" ? "#0f172a" : "#f59e0b"}
                />
              </Pressable>
            </View>
          </Animated.View>
        </View>

        {/* Content area */}
        <View className="flex-1">
          {/* Table of Contents view */}
          {viewMode === "toc" && (
            <Animated.View entering={FadeIn.duration(200)} className="flex-1">
              <TableOfContents
                sections={sections}
                highlightedSectionId={initialSectionId ?? null}
                onSelectSection={(section) => {
                  handleSelectSection(section);
                  setViewMode("content");
                }}
                onClose={() => setViewMode("list")}
              />
            </Animated.View>
          )}

          {/* Section content view */}
          {viewMode === "content" && selectedSection && (
            <Animated.View entering={FadeIn.duration(200)} className="flex-1">
              <SectionContentView
                section={selectedSection}
                onClose={handleCloseContent}
                onPrev={prevSection ? handlePrevSection : null}
                onNext={nextSection ? handleNextSection : null}
                prevLabel={
                  prevSection?.sectionNumber ||
                  prevSection?.displayTitle ||
                  prevSection?.heading ||
                  null
                }
                nextLabel={
                  nextSection?.sectionNumber ||
                  nextSection?.displayTitle ||
                  nextSection?.heading ||
                  null
                }
              />
            </Animated.View>
          )}

          {/* Section list view */}
          {viewMode === "list" && (
            <Animated.View entering={FadeIn.duration(200)} className="flex-1">
              <ScrollView
                className="flex-1"
                contentContainerStyle={{
                  padding: 16,
                  paddingBottom: insets.bottom + 40,
                }}
                showsVerticalScrollIndicator={false}
              >
                {/* Section count */}
                <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                  {sections.length} Section{sections.length !== 1 ? "s" : ""}
                </Text>

                {/* Sections */}
                {sections.length > 0 ? (
                  <View className="gap-3">
                    {sections.map((section, index) => (
                      <Animated.View
                        key={section.id}
                        entering={FadeInUp.duration(300).delay(index * 30)}
                      >
                        <SectionCard
                          section={section}
                          isHighlighted={section.id === initialSectionId}
                          onPress={() => handleSelectSection(section)}
                        />
                      </Animated.View>
                    ))}
                  </View>
                ) : (
                  <View className="items-center py-12">
                    <View className="w-16 h-16 rounded-full bg-slate-800/60 items-center justify-center mb-4">
                      <BookOpen size={32} color="#64748b" />
                    </View>
                    <Text className="text-white text-lg font-semibold text-center">
                      No Sections Found
                    </Text>
                    <Text className="text-slate-400 text-center mt-2">
                      This document hasn't been parsed yet or has no recognized
                      sections.
                    </Text>
                  </View>
                )}

                {/* Disclaimer footer */}
                <View className="mt-6 bg-slate-800/40 rounded-xl p-4 border border-slate-700/30">
                  <Text className="text-slate-500 text-xs text-center leading-relaxed">
                    {CONTRACT_DISCLAIMER_TEXT}
                  </Text>
                </View>
              </ScrollView>
            </Animated.View>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}
