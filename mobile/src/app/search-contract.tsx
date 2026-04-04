/**
 * Search My Contract Screen
 *
 * AI-assisted search tool for finding relevant sections in uploaded contracts.
 * Reference-only - no entitlement language.
 */

import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  Layout,
  FadeIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  Search,
  ChevronLeft,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Filter,
  Info,
  Upload,
} from "lucide-react-native";

import { useContracts } from "@/lib/useContracts";
import {
  useContractSearchMutation,
  useAiSuggestKeywordsMutation,
  useSavedContractReferences,
  useSaveContractReference,
  formatConfidence,
  formatSearchCategory,
} from "@/lib/useContractSearch";
import { cn } from "@/lib/cn";
import { QuickFeedback } from "@/components/FeedbackComponents";
import type {
  ContractSearchResult,
  SearchCategory,
  SearchMatchType,
  ContractDocumentType,
} from "@/lib/contracts";

// ============================================
// FILTER CHIPS
// ============================================

const DOCUMENT_TYPE_OPTIONS: { value: ContractDocumentType; label: string }[] = [
  { value: "CBA", label: "CBA" },
  { value: "PAY_MANUAL", label: "Pay Manual" },
  { value: "LOA", label: "LOA" },
  { value: "COMPANY_POLICY", label: "Policy" },
  { value: "OTHER", label: "Other" },
];

const CATEGORY_OPTIONS: { value: SearchCategory; label: string }[] = [
  { value: "pay", label: "Pay" },
  { value: "scheduling", label: "Scheduling" },
  { value: "reserve", label: "Reserve" },
  { value: "training", label: "Training" },
  { value: "deadhead", label: "Deadhead" },
  { value: "other", label: "Other" },
];

interface FilterChipProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

function FilterChip({ label, isSelected, onPress }: FilterChipProps) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className={cn(
        "px-3 py-1.5 rounded-full border mr-2 mb-2",
        isSelected
          ? "bg-amber-500 border-amber-500"
          : "bg-slate-800/60 border-slate-700/50"
      )}
    >
      <Text
        className={cn(
          "text-sm font-medium",
          isSelected ? "text-slate-900" : "text-slate-300"
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================
// AI ASSIST PANEL
// ============================================

interface AiAssistPanelProps {
  query: string;
  onSuggestKeyword: (keyword: string) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

function AiAssistPanel({
  query,
  onSuggestKeyword,
  isExpanded,
  onToggle,
}: AiAssistPanelProps) {
  const [assistQuery, setAssistQuery] = useState("");
  const suggestMutation = useAiSuggestKeywordsMutation();

  const handleSuggest = useCallback(async () => {
    if (!assistQuery.trim()) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await suggestMutation.mutateAsync({
        query: assistQuery,
        context: query,
      });
    } catch (error) {
      console.error("AI suggest error:", error);
    }
  }, [assistQuery, query, suggestMutation]);

  const suggestions = suggestMutation.data?.suggestedKeywords ?? [];

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="bg-slate-800/40 rounded-2xl border border-slate-700/50 overflow-hidden"
    >
      {/* Header */}
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-4 py-3"
      >
        <View className="flex-row items-center">
          <Sparkles size={18} color="#f59e0b" />
          <Text className="text-amber-500 font-semibold ml-2">AI Assist</Text>
        </View>
        {isExpanded ? (
          <ChevronUp size={18} color="#64748b" />
        ) : (
          <ChevronDown size={18} color="#64748b" />
        )}
      </Pressable>

      {/* Expanded Content */}
      {isExpanded && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          className="px-4 pb-4"
        >
          <Text className="text-slate-400 text-sm mb-3">
            Describe what you're trying to find. I'll suggest better keywords.
          </Text>

          {/* Input */}
          <View className="flex-row items-center mb-3">
            <View className="flex-1 bg-slate-900/60 rounded-xl px-4 py-2.5 border border-slate-700/50 mr-2">
              <TextInput
                value={assistQuery}
                onChangeText={setAssistQuery}
                placeholder="Example: What section covers short notice trips?"
                placeholderTextColor="#64748b"
                className="text-white text-sm"
                multiline
              />
            </View>
            <Pressable
              onPress={handleSuggest}
              disabled={suggestMutation.isPending || !assistQuery.trim()}
              className={cn(
                "px-4 py-2.5 rounded-xl",
                suggestMutation.isPending || !assistQuery.trim()
                  ? "bg-slate-700/50"
                  : "bg-amber-500"
              )}
            >
              {suggestMutation.isPending ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text
                  className={cn(
                    "font-semibold text-sm",
                    !assistQuery.trim() ? "text-slate-500" : "text-slate-900"
                  )}
                >
                  Suggest
                </Text>
              )}
            </Pressable>
          </View>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <View>
              <Text className="text-slate-500 text-xs font-semibold mb-2 uppercase">
                Try these keywords:
              </Text>
              <View className="flex-row flex-wrap">
                {suggestions.map((keyword, index) => (
                  <Pressable
                    key={`${keyword}-${index}`}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSuggestKeyword(keyword);
                    }}
                    className="bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 rounded-full mr-2 mb-2"
                  >
                    <Text className="text-amber-400 text-sm">{keyword}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Explanation */}
          {suggestMutation.data?.explanation && (
            <View className="mt-2">
              <Text className="text-slate-500 text-xs italic mb-2">
                {suggestMutation.data.explanation}
              </Text>
              <QuickFeedback
                explanationType="contract_reference"
                entityId={`ai_suggest_${assistQuery.slice(0, 20)}`}
                size="sm"
                label="Helpful?"
              />
            </View>
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ============================================
// SEARCH RESULT CARD
// ============================================

interface SearchResultCardProps {
  result: ContractSearchResult;
  onOpenPage: () => void;
  onSaveReference: () => void;
  isSaved: boolean;
  isSaving: boolean;
}

function SearchResultCard({
  result,
  onOpenPage,
  onSaveReference,
  isSaved,
  isSaving,
}: SearchResultCardProps) {
  const confidenceConfig = formatConfidence(result.confidence);

  return (
    <Animated.View
      entering={FadeInUp.duration(300)}
      layout={Layout.springify()}
      className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50"
    >
      {/* Heading */}
      <Text className="text-white font-semibold text-base" numberOfLines={2}>
        {result.heading}
      </Text>

      {/* Meta line */}
      <View className="flex-row items-center mt-2 flex-wrap">
        <Text className="text-slate-400 text-sm" numberOfLines={1}>
          {result.documentTitle}
        </Text>
        {result.pageNumber && (
          <>
            <Text className="text-slate-600 mx-1.5">•</Text>
            <Text className="text-slate-400 text-sm">
              Page {result.pageNumber}
            </Text>
          </>
        )}
        <Text className="text-slate-600 mx-1.5">•</Text>
        <View
          className={cn("px-2 py-0.5 rounded-full", confidenceConfig.bgColor)}
        >
          <Text className="text-xs font-medium" style={{ color: confidenceConfig.color }}>
            {confidenceConfig.label}
          </Text>
        </View>
      </View>

      {/* Excerpt */}
      <View className="bg-slate-900/40 rounded-xl p-3 mt-3 border border-slate-700/30">
        <Text className="text-slate-300 text-sm leading-relaxed" numberOfLines={3}>
          {result.highlightedExcerpt ?? result.excerpt}
        </Text>
      </View>

      {/* Matched terms */}
      {result.matchedTerms.length > 0 && (
        <View className="flex-row flex-wrap mt-2">
          {result.matchedTerms.slice(0, 4).map((term, index) => (
            <View
              key={`${term}-${index}`}
              className="bg-blue-500/20 px-2 py-0.5 rounded mr-1.5 mb-1"
            >
              <Text className="text-blue-400 text-xs">{term}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/30">
        <Pressable
          onPress={onOpenPage}
          className="flex-row items-center flex-1 bg-slate-700/50 rounded-xl py-2 px-3 mr-2 active:opacity-70"
        >
          <ExternalLink size={16} color="#f59e0b" />
          <Text className="text-amber-500 text-sm font-medium ml-1.5">
            Open Page
          </Text>
        </Pressable>

        <Pressable
          onPress={onSaveReference}
          disabled={isSaving}
          className={cn(
            "flex-row items-center flex-1 rounded-xl py-2 px-3 active:opacity-70",
            isSaved ? "bg-green-500/20" : "bg-slate-700/50"
          )}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#22c55e" />
          ) : isSaved ? (
            <BookmarkCheck size={16} color="#22c55e" />
          ) : (
            <Bookmark size={16} color="#94a3b8" />
          )}
          <Text
            className={cn(
              "text-sm font-medium ml-1.5",
              isSaved ? "text-green-400" : "text-slate-400"
            )}
          >
            {isSaved ? "Saved" : "Save"}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ============================================
// EMPTY STATES
// ============================================

function NoDocumentsState({ onUpload }: { onUpload: () => void }) {
  return (
    <View className="items-center py-12 px-6">
      <View className="w-20 h-20 rounded-full bg-slate-800/60 items-center justify-center mb-4">
        <FileText size={40} color="#64748b" />
      </View>
      <Text className="text-white text-xl font-semibold text-center">
        Upload Your Contract
      </Text>
      <Text className="text-slate-400 text-center mt-2 leading-relaxed">
        Upload your CBA or pay manual to enable contract search.
      </Text>
      <Pressable
        onPress={onUpload}
        className="bg-amber-500 rounded-2xl px-6 py-3 mt-6 flex-row items-center active:opacity-80"
      >
        <Upload size={20} color="#0f172a" />
        <Text className="text-slate-900 font-bold ml-2">Upload Contract</Text>
      </Pressable>
    </View>
  );
}

function NoResultsState({ query }: { query: string }) {
  return (
    <View className="items-center py-12 px-6">
      <View className="w-16 h-16 rounded-full bg-slate-800/60 items-center justify-center mb-4">
        <Search size={32} color="#64748b" />
      </View>
      <Text className="text-white text-lg font-semibold text-center">
        No Results Found
      </Text>
      <Text className="text-slate-400 text-center mt-2">
        No sections match "{query}". Try different keywords or use AI Assist.
      </Text>
    </View>
  );
}

function SearchPromptState() {
  return (
    <View className="items-center py-12 px-6">
      <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
        <Search size={32} color="#f59e0b" />
      </View>
      <Text className="text-white text-lg font-semibold text-center">
        Search Your Contract
      </Text>
      <Text className="text-slate-400 text-center mt-2">
        Enter keywords like "junior assignment", "guarantee", or "reassignment"
      </Text>
    </View>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function SearchContractScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string }>();

  // State
  const [searchQuery, setSearchQuery] = useState(params.query ?? "");
  const [selectedDocTypes, setSelectedDocTypes] = useState<ContractDocumentType[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<SearchCategory[]>([]);
  const [matchType, setMatchType] = useState<SearchMatchType>("fuzzy");
  const [showFilters, setShowFilters] = useState(false);
  const [showAiAssist, setShowAiAssist] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Data
  const { data: contractsData, isLoading: isLoadingContracts } = useContracts();
  const { data: savedRefsData } = useSavedContractReferences();
  const searchMutation = useContractSearchMutation();
  const saveMutation = useSaveContractReference();

  const hasContracts = contractsData?.hasActiveDocuments ?? false;
  const savedSectionIds = useMemo(
    () => new Set(savedRefsData?.references.map((r) => r.sectionId) ?? []),
    [savedRefsData]
  );

  // Handlers
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await searchMutation.mutateAsync({
        query: searchQuery,
        documentTypes: selectedDocTypes.length > 0 ? selectedDocTypes : undefined,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        matchType,
        limit: 30,
      });
    } catch (error) {
      console.error("Search error:", error);
      Alert.alert("Search Error", "Failed to search contracts. Please try again.");
    }
  }, [searchQuery, selectedDocTypes, selectedCategories, matchType, searchMutation]);

  const handleSuggestKeyword = useCallback(
    (keyword: string) => {
      const newQuery = searchQuery ? `${searchQuery} ${keyword}` : keyword;
      setSearchQuery(newQuery);
    },
    [searchQuery]
  );

  const handleToggleDocType = useCallback((type: ContractDocumentType) => {
    setSelectedDocTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const handleToggleCategory = useCallback((category: SearchCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  }, []);

  const handleSaveReference = useCallback(
    async (result: ContractSearchResult) => {
      setSavingId(result.sectionId);
      try {
        await saveMutation.mutateAsync({
          sectionId: result.sectionId,
          documentId: result.documentId,
          documentTitle: result.documentTitle,
          sectionHeading: result.heading,
          sectionNumber: result.sectionNumber,
          pageNumber: result.pageNumber,
          excerpt: result.excerpt,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error("Save error:", error);
        Alert.alert("Error", "Failed to save reference");
      } finally {
        setSavingId(null);
      }
    },
    [saveMutation]
  );

  const handleOpenPage = useCallback((result: ContractSearchResult) => {
    // Navigate to contract detail view (could be implemented later)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      result.heading,
      `Document: ${result.documentTitle}\n${result.pageNumber ? `Page: ${result.pageNumber}\n` : ""}\n${result.excerpt}`,
      [{ text: "Close", style: "cancel" }]
    );
  }, []);

  const results = searchMutation.data?.results ?? [];
  const hasSearched = searchMutation.isSuccess || searchMutation.isError;

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
          keyboardShouldPersistTaps="handled"
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
                <Search size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-2xl font-bold text-center">
              Search My Contract
            </Text>
            <Text className="text-slate-400 text-sm mt-1 text-center">
              Reference-only. Results cite your uploaded documents.
            </Text>
          </Animated.View>

          {/* Loading Contracts */}
          {isLoadingContracts && (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#f59e0b" />
            </View>
          )}

          {/* No Contracts State */}
          {!isLoadingContracts && !hasContracts && (
            <Animated.View
              entering={FadeInUp.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <NoDocumentsState
                onUpload={() => router.push("/contract-references")}
              />
            </Animated.View>
          )}

          {/* Search Interface */}
          {!isLoadingContracts && hasContracts && (
            <>
              {/* Search Bar */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(150)}
                className="mx-5 mt-4"
              >
                <View className="flex-row items-center bg-slate-800/60 rounded-2xl px-4 py-3 border border-slate-700/50">
                  <Search size={18} color="#64748b" />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search keywords (e.g., junior assignment, guarantee)"
                    placeholderTextColor="#64748b"
                    className="flex-1 text-white text-base ml-3"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                  />
                  {searchQuery.length > 0 && (
                    <Pressable
                      onPress={() => setSearchQuery("")}
                      className="p-1"
                    >
                      <X size={18} color="#64748b" />
                    </Pressable>
                  )}
                </View>

                {/* Search Button */}
                <Pressable
                  onPress={handleSearch}
                  disabled={searchMutation.isPending || !searchQuery.trim()}
                  className={cn(
                    "mt-3 rounded-2xl py-3 items-center",
                    searchMutation.isPending || !searchQuery.trim()
                      ? "bg-slate-700/50"
                      : "bg-amber-500 active:opacity-80"
                  )}
                >
                  {searchMutation.isPending ? (
                    <View className="flex-row items-center">
                      <ActivityIndicator size="small" color="#0f172a" />
                      <Text className="text-slate-900 font-bold ml-2">
                        Searching...
                      </Text>
                    </View>
                  ) : (
                    <Text
                      className={cn(
                        "font-bold",
                        !searchQuery.trim() ? "text-slate-500" : "text-slate-900"
                      )}
                    >
                      Search
                    </Text>
                  )}
                </Pressable>
              </Animated.View>

              {/* Filter Toggle */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(200)}
                className="mx-5 mt-4"
              >
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowFilters(!showFilters);
                    }}
                    className={cn(
                      "flex-row items-center px-3 py-2 rounded-xl border",
                      showFilters
                        ? "bg-amber-500/20 border-amber-500/30"
                        : "bg-slate-800/60 border-slate-700/50"
                    )}
                  >
                    <Filter size={16} color={showFilters ? "#f59e0b" : "#64748b"} />
                    <Text
                      className={cn(
                        "text-sm font-medium ml-1.5",
                        showFilters ? "text-amber-500" : "text-slate-400"
                      )}
                    >
                      Filters
                    </Text>
                    {(selectedDocTypes.length > 0 || selectedCategories.length > 0) && (
                      <View className="bg-amber-500 rounded-full w-5 h-5 items-center justify-center ml-2">
                        <Text className="text-slate-900 text-xs font-bold">
                          {selectedDocTypes.length + selectedCategories.length}
                        </Text>
                      </View>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setMatchType(matchType === "fuzzy" ? "exact" : "fuzzy");
                    }}
                    className={cn(
                      "flex-row items-center px-3 py-2 rounded-xl border",
                      matchType === "exact"
                        ? "bg-blue-500/20 border-blue-500/30"
                        : "bg-slate-800/60 border-slate-700/50"
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm font-medium",
                        matchType === "exact" ? "text-blue-400" : "text-slate-400"
                      )}
                    >
                      {matchType === "exact" ? "Exact" : "Fuzzy"}
                    </Text>
                  </Pressable>
                </View>

                {/* Filters Panel */}
                {showFilters && (
                  <Animated.View
                    entering={FadeInDown.duration(200)}
                    className="mt-3 bg-slate-800/40 rounded-2xl p-4 border border-slate-700/50"
                  >
                    {/* Document Type */}
                    <Text className="text-slate-400 text-xs font-semibold mb-2 uppercase">
                      Document Type
                    </Text>
                    <View className="flex-row flex-wrap mb-3">
                      {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                        <FilterChip
                          key={opt.value}
                          label={opt.label}
                          isSelected={selectedDocTypes.includes(opt.value)}
                          onPress={() => handleToggleDocType(opt.value)}
                        />
                      ))}
                    </View>

                    {/* Category */}
                    <Text className="text-slate-400 text-xs font-semibold mb-2 uppercase">
                      Category
                    </Text>
                    <View className="flex-row flex-wrap">
                      {CATEGORY_OPTIONS.map((opt) => (
                        <FilterChip
                          key={opt.value}
                          label={opt.label}
                          isSelected={selectedCategories.includes(opt.value)}
                          onPress={() => handleToggleCategory(opt.value)}
                        />
                      ))}
                    </View>
                  </Animated.View>
                )}
              </Animated.View>

              {/* AI Assist Panel */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(250)}
                className="mx-5 mt-4"
              >
                <AiAssistPanel
                  query={searchQuery}
                  onSuggestKeyword={handleSuggestKeyword}
                  isExpanded={showAiAssist}
                  onToggle={() => setShowAiAssist(!showAiAssist)}
                />
              </Animated.View>

              {/* Results */}
              <View className="mx-5 mt-6">
                {/* Results Header */}
                {hasSearched && results.length > 0 && (
                  <Animated.View
                    entering={FadeInDown.duration(300)}
                    className="flex-row items-center justify-between mb-3"
                  >
                    <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                      Results ({searchMutation.data?.totalCount ?? 0})
                    </Text>
                    {searchMutation.data?.suggestedKeywords &&
                      searchMutation.data.suggestedKeywords.length > 0 && (
                        <View className="flex-row items-center">
                          <Text className="text-slate-500 text-xs mr-2">
                            Also try:
                          </Text>
                          {searchMutation.data.suggestedKeywords
                            .slice(0, 2)
                            .map((kw, i) => (
                              <Pressable
                                key={`${kw}-${i}`}
                                onPress={() => handleSuggestKeyword(kw)}
                                className="bg-slate-700/50 px-2 py-0.5 rounded mr-1"
                              >
                                <Text className="text-slate-400 text-xs">{kw}</Text>
                              </Pressable>
                            ))}
                        </View>
                      )}
                  </Animated.View>
                )}

                {/* Result Cards */}
                {hasSearched && results.length > 0 && (
                  <View className="gap-3">
                    {results.map((result, index) => (
                      <SearchResultCard
                        key={result.id}
                        result={result}
                        onOpenPage={() => handleOpenPage(result)}
                        onSaveReference={() => handleSaveReference(result)}
                        isSaved={savedSectionIds.has(result.sectionId)}
                        isSaving={savingId === result.sectionId}
                      />
                    ))}
                  </View>
                )}

                {/* No Results */}
                {hasSearched && results.length === 0 && (
                  <NoResultsState query={searchQuery} />
                )}

                {/* Initial State */}
                {!hasSearched && <SearchPromptState />}
              </View>

              {/* Disclaimer */}
              {hasSearched && results.length > 0 && (
                <Animated.View
                  entering={FadeInUp.duration(400)}
                  className="mx-5 mt-6"
                >
                  <View className="bg-slate-800/40 rounded-xl p-3 border border-slate-700/30 flex-row items-start">
                    <Info size={14} color="#64748b" />
                    <Text className="text-slate-500 text-xs ml-2 flex-1">
                      {searchMutation.data?.disclaimer}
                    </Text>
                  </View>
                </Animated.View>
              )}
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
