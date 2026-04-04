/**
 * Airline Glossary Screen
 *
 * Reference-only display of airline-specific terminology mapped to universal pay events.
 * These terms do not affect pay calculations or rules logic.
 */

import { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import {
  Search,
  X,
  ChevronDown,
  BookOpen,
  ArrowRight,
  Info,
  Building2,
  Plane,
  CheckCircle2,
} from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInUp,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolateColor,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { webSafeExit } from "@/lib/webSafeAnimation";
import {
  AIRLINE_GLOSSARIES,
  UNIVERSAL_PAY_EVENTS,
  type AirlineCode,
  type AirlineGlossary,
  type GlossaryTerm,
  type UniversalPayEventKey,
  searchGlossary,
} from "@/lib/airline-glossary";

// UPS color theme - this is a UPS-only app
const AIRLINE_COLORS_MAP: Partial<Record<AirlineCode, { primary: string; bg: string }>> = {
  UPS: { primary: "#351c15", bg: "#5c3d2e" },
};

// Default colors for airlines not in the map
const DEFAULT_AIRLINE_COLORS = { primary: "#334155", bg: "#475569" };

// Helper to get airline colors with fallback
function getAirlineColors(airline: AirlineCode): { primary: string; bg: string } {
  return AIRLINE_COLORS_MAP[airline] ?? DEFAULT_AIRLINE_COLORS;
}

interface TermDetailModalProps {
  visible: boolean;
  onClose: () => void;
  term: GlossaryTerm | null;
  airline: AirlineCode | null;
}

function TermDetailModal({
  visible,
  onClose,
  term,
  airline,
}: TermDetailModalProps) {
  if (!term || !airline) return null;

  const universalEvent = UNIVERSAL_PAY_EVENTS[term.mapsTo];
  const colors = getAirlineColors(airline);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end bg-black/60"
        onPress={onClose}
      >
        <Animated.View
          entering={SlideInUp.springify().damping(20)}
          exiting={webSafeExit(SlideOutDown.springify().damping(20))}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <LinearGradient
              colors={["#1e293b", "#0f172a"]}
              style={{
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingBottom: 40,
              }}
            >
              {/* Handle */}
              <View className="items-center pt-3 pb-4">
                <View className="w-10 h-1 rounded-full bg-slate-600" />
              </View>

              <ScrollView className="px-6" showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View className="flex-row items-start mb-6">
                  <View
                    className="w-14 h-14 rounded-2xl items-center justify-center mr-4"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <Text className="text-white font-bold text-lg">
                      {term.abbreviation.slice(0, 2)}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-xl font-bold">
                      {term.abbreviation}
                    </Text>
                    <Text className="text-slate-400 text-base">
                      {term.longName}
                    </Text>
                    <View className="flex-row items-center mt-2">
                      <Building2 size={14} color="#64748b" />
                      <Text className="text-slate-500 text-sm ml-1.5">
                        {airline}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={onClose}
                    className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
                  >
                    <X size={16} color="#94a3b8" />
                  </Pressable>
                </View>

                {/* Definition */}
                <View className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                  <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                    Definition
                  </Text>
                  <Text className="text-white text-base leading-6">
                    {term.definition}
                  </Text>
                </View>

                {/* Example */}
                {term.example && (
                  <View className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                    <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                      Example
                    </Text>
                    <Text className="text-slate-300 text-base leading-6 italic">
                      "{term.example}"
                    </Text>
                  </View>
                )}

                {/* Universal Event Mapping */}
                <View className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6">
                  <View className="flex-row items-center mb-3">
                    <ArrowRight size={16} color="#f59e0b" />
                    <Text className="text-amber-500 text-xs font-semibold uppercase tracking-wider ml-2">
                      Maps to Universal Event
                    </Text>
                  </View>
                  <Text className="text-white font-semibold text-base mb-1">
                    {universalEvent.name}
                  </Text>
                  <Text className="text-slate-400 text-sm leading-5">
                    {universalEvent.description}
                  </Text>
                  <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/50">
                    <View className="bg-slate-700/50 px-2 py-1 rounded">
                      <Text className="text-slate-400 text-xs font-mono">
                        {term.mapsTo}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Disclaimer */}
                <View className="flex-row items-start bg-slate-800/30 rounded-xl p-3 mb-4">
                  <Info size={14} color="#64748b" className="mt-0.5" />
                  <Text className="text-slate-500 text-xs ml-2 flex-1 leading-4">
                    This is a reference term only. It does not affect pay
                    calculations or rules in this app.
                  </Text>
                </View>
              </ScrollView>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

interface AirlineSelectorProps {
  selected: AirlineCode | "all";
  onSelect: (code: AirlineCode | "all") => void;
}

function AirlineSelector({ selected, onSelect }: AirlineSelectorProps) {
  const airlines: Array<{ code: AirlineCode | "all"; label: string }> = [
    { code: "all", label: "All Airlines" },
    ...AIRLINE_GLOSSARIES.map((g) => ({ code: g.code, label: g.name })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-4"
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      {airlines.map(({ code, label }) => {
        const isSelected = selected === code;
        const colors =
          code !== "all" ? getAirlineColors(code as AirlineCode) : null;

        return (
          <Pressable
            key={code}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(code);
            }}
            className={`px-4 py-2 rounded-full flex-row items-center ${
              isSelected
                ? "bg-amber-500"
                : "bg-slate-800/80 border border-slate-700/50"
            }`}
          >
            {isSelected && (
              <CheckCircle2
                size={14}
                color={isSelected ? "#000" : "#94a3b8"}
                style={{ marginRight: 6 }}
              />
            )}
            <Text
              className={`text-sm font-medium ${
                isSelected ? "text-black" : "text-slate-300"
              }`}
            >
              {code === "all" ? "All" : code}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface TermCardProps {
  term: GlossaryTerm;
  airline: AirlineCode;
  onPress: () => void;
  index: number;
}

function TermCard({ term, airline, onPress, index }: TermCardProps) {
  const colors = getAirlineColors(airline);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 50)}
      style={animatedStyle}
    >
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.98, { damping: 15 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 15 });
        }}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4 mb-3"
      >
        <View className="flex-row items-start">
          {/* Abbreviation badge */}
          <View
            className="w-12 h-12 rounded-xl items-center justify-center mr-3"
            style={{ backgroundColor: colors.bg + "40" }}
          >
            <Text
              className="font-bold text-sm"
              style={{ color: colors.primary === "#351c15" ? "#d97706" : colors.bg }}
            >
              {term.abbreviation.length > 4
                ? term.abbreviation.slice(0, 3)
                : term.abbreviation}
            </Text>
          </View>

          {/* Content */}
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-white font-semibold text-base flex-1">
                {term.longName}
              </Text>
              <View className="bg-slate-700/50 px-2 py-0.5 rounded">
                <Text className="text-slate-400 text-xs">{airline}</Text>
              </View>
            </View>
            <Text
              className="text-slate-400 text-sm mt-1 leading-5"
              numberOfLines={2}
            >
              {term.definition}
            </Text>
            {/* Universal event tag */}
            <View className="flex-row items-center mt-2">
              <ArrowRight size={12} color="#f59e0b" />
              <Text className="text-amber-500/80 text-xs ml-1">
                {UNIVERSAL_PAY_EVENTS[term.mapsTo].name}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function GlossaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAirline, setSelectedAirline] = useState<AirlineCode | "all">(
    "all"
  );
  const [selectedTerm, setSelectedTerm] = useState<{
    term: GlossaryTerm;
    airline: AirlineCode;
  } | null>(null);

  // Filter and search terms
  const filteredTerms = useMemo(() => {
    let results: Array<{ airline: AirlineCode; term: GlossaryTerm }> = [];

    if (searchQuery.trim()) {
      // Search across all airlines
      results = searchGlossary(searchQuery.trim());
      // Filter by selected airline if not "all"
      if (selectedAirline !== "all") {
        results = results.filter((r) => r.airline === selectedAirline);
      }
    } else {
      // Show all terms for selected airline(s)
      const glossaries =
        selectedAirline === "all"
          ? AIRLINE_GLOSSARIES
          : AIRLINE_GLOSSARIES.filter((g) => g.code === selectedAirline);

      for (const glossary of glossaries) {
        for (const term of glossary.terms) {
          results.push({ airline: glossary.code, term });
        }
      }
    }

    return results;
  }, [searchQuery, selectedAirline]);

  const openTermDetail = useCallback(
    (term: GlossaryTerm, airline: AirlineCode) => {
      setSelectedTerm({ term, airline });
    },
    []
  );

  return (
    <View className="flex-1 bg-slate-950">
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

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
            {/* Back button */}
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center mb-4"
            >
              <Text className="text-amber-500 text-base">← Back</Text>
            </Pressable>

            <View className="flex-row items-center mb-2">
              <BookOpen size={24} color="#f59e0b" />
              <Text className="text-amber-500 text-base font-semibold ml-2">
                Reference
              </Text>
            </View>
            <Text className="text-white text-3xl font-bold">
              Airline Glossary
            </Text>
            <Text className="text-slate-400 text-base mt-1">
              Terminology mapped to universal pay events
            </Text>
          </Animated.View>

          {/* Disclaimer */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-4"
          >
            <View className="flex-row items-start bg-slate-800/40 border border-slate-700/50 rounded-xl p-3">
              <Info size={16} color="#64748b" />
              <Text className="text-slate-400 text-sm ml-2 flex-1 leading-5">
                These terms are labels and definitions only — they do not affect
                pay calculations or rules logic in this app.
              </Text>
            </View>
          </Animated.View>

          {/* Search */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-5 mt-4"
          >
            <View className="flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3">
              <Search size={18} color="#64748b" />
              <TextInput
                className="flex-1 text-white text-base ml-3"
                placeholder="Search terms..."
                placeholderTextColor="#64748b"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <Pressable
                  onPress={() => setSearchQuery("")}
                  className="p-1"
                >
                  <X size={16} color="#64748b" />
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Airline Filter */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(250)}
            className="mt-4"
          >
            <AirlineSelector
              selected={selectedAirline}
              onSelect={setSelectedAirline}
            />
          </Animated.View>

          {/* Results count */}
          <View className="px-5 mb-3">
            <Text className="text-slate-500 text-sm">
              {filteredTerms.length} term{filteredTerms.length !== 1 ? "s" : ""}
              {selectedAirline !== "all" && ` for ${selectedAirline}`}
              {searchQuery && ` matching "${searchQuery}"`}
            </Text>
          </View>

          {/* Terms List */}
          <View className="px-5">
            {filteredTerms.length === 0 ? (
              <View className="items-center py-12">
                <BookOpen size={48} color="#334155" />
                <Text className="text-slate-500 text-base mt-4">
                  No terms found
                </Text>
                <Text className="text-slate-600 text-sm mt-1">
                  Try a different search or filter
                </Text>
              </View>
            ) : (
              filteredTerms.map(({ airline, term }, index) => (
                <TermCard
                  key={`${airline}-${term.abbreviation}-${index}`}
                  term={term}
                  airline={airline}
                  onPress={() => openTermDetail(term, airline)}
                  index={index}
                />
              ))
            )}
          </View>

          {/* Universal Events Reference */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">
              Universal Pay Event Keys
            </Text>
            <View className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
              {Object.entries(UNIVERSAL_PAY_EVENTS).map(
                ([key, event], index) => (
                  <View
                    key={key}
                    className={`px-4 py-3 ${
                      index !== Object.keys(UNIVERSAL_PAY_EVENTS).length - 1
                        ? "border-b border-slate-700/50"
                        : ""
                    }`}
                  >
                    <View className="flex-row items-center">
                      <View className="bg-amber-500/20 px-2 py-0.5 rounded">
                        <Text className="text-amber-500 text-xs font-mono">
                          {key}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-white font-medium text-sm mt-1.5">
                      {event.name}
                    </Text>
                    <Text className="text-slate-500 text-xs mt-0.5 leading-4">
                      {event.description}
                    </Text>
                  </View>
                )
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </LinearGradient>

      {/* Term Detail Modal */}
      <TermDetailModal
        visible={!!selectedTerm}
        onClose={() => setSelectedTerm(null)}
        term={selectedTerm?.term ?? null}
        airline={selectedTerm?.airline ?? null}
      />
    </View>
  );
}
