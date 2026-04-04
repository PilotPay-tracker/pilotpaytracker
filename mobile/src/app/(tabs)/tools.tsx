/**
 * Tools Screen - Pay Command Center
 *
 * Organized hierarchy:
 * 1. ANALYZE - Earnings Overview
 * 2. CALCULATE - Pay Calculator, Late Arrival Pay, Per Diem
 * 3. VERIFY & DOCUMENT - Pay Summary, Contract Vault, OOOI Capture
 * 4. REFERENCE - Pay Code Library, Airline Glossary
 * 5. SETTINGS - App Settings (visually separated)
 */

import { View, Text, ScrollView, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  TrendingUp,
  Calculator,
  Clock,
  FileText,
  Book,
  BookOpen,
  Settings,
  ChevronRight,
  Camera,
  Utensils,
  BarChart3,
  FolderCheck,
  Plane,
  Award,
  Heart,
  Target,
} from "lucide-react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

import { useContracts } from "@/lib/useContracts";
import { useProfile } from "@/lib/state/profile-store";
import { usePremiumAccess } from "@/lib/useSubscription";
import { HelpButton, useAutoTutorial } from "@/components/TutorialModal";
import { useResponsive } from "@/lib/responsive";

// ============================================
// TYPES
// ============================================

interface ProfileStats {
  allTime: { totalPayCents: number };
  currentYear: { totalPayCents: number; year: number };
  currentMonth: { totalPayCents: number; month: string };
}

// ============================================
// HOOKS
// ============================================

function useProfileStats() {
  return useQuery({
    queryKey: ["profile-stats"],
    queryFn: () => api.get<ProfileStats>("/api/profile/stats"),
  });
}

// ============================================
// HELPERS
// ============================================

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ============================================
// FEATURED CARD - Year Summary
// ============================================

function YearSummaryCard({
  yearToDate,
  monthToDate,
  year,
  onPress,
}: {
  yearToDate: number;
  monthToDate: number;
  year: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      className="active:opacity-90"
    >
      <LinearGradient
        colors={["#0c1f3d", "#0a3d62", "#1a1a2e"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 22, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
      >
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(245,158,11,0.15)", alignItems: "center", justifyContent: "center" }}>
              <BarChart3 size={20} color="#f59e0b" />
            </View>
            <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 17, marginLeft: 12 }}>
              {year} Summary
            </Text>
          </View>
          <ChevronRight size={18} color="#334155" />
        </View>

        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
              Year to Date
            </Text>
            <Text style={{ color: "#4ade80", fontSize: 24, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 }}>
              {formatCurrency(yearToDate)}
            </Text>
          </View>
          <View style={{ width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.07)", marginHorizontal: 16 }} />
          <View className="flex-1">
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
              This Month
            </Text>
            <Text style={{ color: "#f1f5f9", fontSize: 24, fontWeight: "800", marginTop: 4, letterSpacing: -0.5 }}>
              {formatCurrency(monthToDate)}
            </Text>
          </View>
        </View>

        <Text style={{ color: "#334155", fontSize: 11, marginTop: 14 }}>
          Tap for monthly breakdown, charts & career stats
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

// ============================================
// CALCULATOR CARD
// ============================================

function CalculatorCard({
  icon,
  title,
  subtitle,
  color,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
    >
      <View
        style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10, backgroundColor: color + "18" }}
      >
        {icon}
      </View>
      <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 14 }}>{title}</Text>
      <Text style={{ color: "#475569", fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
    </Pressable>
  );
}

// ============================================
// ANNUAL PAY PLANNER CARD - Flagship Feature (Compact version for grid)
// ============================================

function AnnualPayPlannerCardCompact({
  onPress,
}: {
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={{ flex: 1, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.07)" }}
    >
      <View
        style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10, backgroundColor: "rgba(245,158,11,0.18)" }}
      >
        <View style={{ position: "relative" }}>
          <BarChart3 size={22} color="#f59e0b" />
          <View style={{ position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: 7, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 8, fontWeight: "900", color: "#0f172a" }}>$</Text>
          </View>
        </View>
      </View>
      <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 14 }}>Annual Planner</Text>
      <Text style={{ color: "rgba(245,158,11,0.7)", fontSize: 12, marginTop: 2 }}>Set income goals</Text>
    </Pressable>
  );
}

// ============================================
// TOOL LIST ITEM
// ============================================

function ToolItem({
  icon,
  title,
  subtitle,
  onPress,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      className="flex-row items-center py-4 active:opacity-70"
    >
      <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
        {icon}
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center">
          <Text style={{ color: "#e2e8f0", fontWeight: "600", fontSize: 15 }}>{title}</Text>
          {badge && (
            <View style={{ marginLeft: 8, backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" }}>
              <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "700" }}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={{ color: "#475569", fontSize: 13, marginTop: 1 }}>{subtitle}</Text>
      </View>
      <ChevronRight size={16} color="#334155" />
    </Pressable>
  );
}

// ============================================
// MAIN SCREEN
// ============================================

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const { data: contractsData } = useContracts();
  const { data: stats } = useProfileStats();
  const { hasPremiumAccess } = usePremiumAccess();
  const { contentMaxWidth } = useResponsive();

  // Auto-show tutorial on first visit
  const { showTutorial, closeTutorial, openTutorial, TutorialModalComponent } = useAutoTutorial("tools");

  const hasContracts = contractsData?.hasActiveDocuments ?? false;
  const contractCount = contractsData?.totalCount ?? 0;
  const airlineName = profile?.airline ?? "Your Airline";
  const currentYear = new Date().getFullYear();

  return (
    <View className="flex-1" style={{ backgroundColor: "#070e1a" }}>
      <LinearGradient
        colors={["#0d1b2e", "#071325", "#020b1a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 100, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' as const }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(100)}
            style={{ paddingTop: insets.top + 16 }}
            className="px-5"
          >
            <View className="flex-row items-center justify-between mb-1">
              <View className="flex-row items-center">
                <View style={{ backgroundColor: "rgba(245,158,11,0.15)", borderRadius: 99, padding: 5, marginRight: 8 }}>
                  <TrendingUp size={14} color="#f59e0b" />
                </View>
                <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>
                  Pay Command Center
                </Text>
              </View>
              <HelpButton tutorialId="tools" size="small" />
            </View>
            <Text style={{ color: "#ffffff", fontSize: 26, fontWeight: "800", letterSpacing: -0.5 }}>Tools</Text>
          </Animated.View>

          {/* SECTION 1 — ANALYZE: Earnings Overview */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(150)}
            className="mx-5 mt-5"
          >
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
              Analyze
            </Text>
            <YearSummaryCard
              yearToDate={stats?.currentYear.totalPayCents ?? 0}
              monthToDate={stats?.currentMonth.totalPayCents ?? 0}
              year={stats?.currentYear.year ?? currentYear}
              onPress={() => router.push("/year-summary")}
            />
          </Animated.View>

          {/* SECTION 2 — CALCULATE: Annual Planner, Pay Calculator, Late Arrival Pay, Per Diem */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(200)}
            className="mx-5 mt-6"
          >
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
              Calculate
            </Text>
            {/* Row 1: Annual Planner + Pay Calculator */}
            <View className="flex-row gap-3 mb-3">
              <AnnualPayPlannerCardCompact
                onPress={() => router.push("/annual-pay-planner")}
              />
              <CalculatorCard
                icon={<Calculator size={24} color="#f59e0b" />}
                title="Pay Calculator"
                subtitle="Estimate trip pay"
                color="#f59e0b"
                onPress={() => router.push("/pay-calculator")}
              />
            </View>
            {/* Row 2: Late Arrival Pay + Per Diem */}
            <View className="flex-row gap-3 mb-3">
              <CalculatorCard
                icon={<Clock size={24} color="#3b82f6" />}
                title="Late Arrival Pay"
                subtitle="UPS LAP premium"
                color="#3b82f6"
                onPress={() => router.push("/late-arrival-pay")}
              />
              <CalculatorCard
                icon={<Utensils size={24} color="#22c55e" />}
                title="Per Diem"
                subtitle="Meal / expense estimate"
                color="#22c55e"
                onPress={() => router.push("/per-diem")}
              />
            </View>
            {/* Row 3: 30-in-7 Tracker + Sick Time */}
            <View className="flex-row gap-3">
              <CalculatorCard
                icon={<TrendingUp size={24} color="#ef4444" />}
                title="30-in-7 Tracker"
                subtitle="Block time limit"
                color="#ef4444"
                onPress={() => router.push("/30-in-7")}
              />
              <CalculatorCard
                icon={<Heart size={24} color="#ef4444" fill="white" />}
                title="Sick Time"
                subtitle="Personal tracker"
                color="#ef4444"
                onPress={() => router.push("/sick-tracker")}
              />
            </View>
          </Animated.View>

          {/* SECTION 3 — VERIFY & DOCUMENT: Pay Summary, Contract Vault, OOOI Capture */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(250)}
            className="mx-5 mt-6"
          >
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
              Verify & Document
            </Text>
            <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 18, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
              <ToolItem
                icon={<FileText size={20} color="#a78bfa" />}
                title="Pay Summary"
                subtitle="Auto-generated pay breakdown"
                onPress={() => router.push("/pay-summary")}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
              <ToolItem
                icon={<FolderCheck size={20} color="#8b5cf6" />}
                title="Contract Vault"
                subtitle={
                  hasContracts
                    ? `${contractCount} document${contractCount !== 1 ? "s" : ""} uploaded`
                    : "Upload CBAs / LOAs"
                }
                badge={hasContracts ? "Active" : undefined}
                onPress={() => router.push("/contract-references")}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
              <ToolItem
                icon={<Camera size={20} color="#14b8a6" />}
                title="OOOI Capture"
                subtitle="Scan flight times from screens"
                onPress={() => router.push("/oooi-capture")}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
              <ToolItem
                icon={<Plane size={20} color="#38bdf8" />}
                title="Flight Log"
                subtitle="Your digital logbook"
                onPress={() => router.push("/flight-log")}
              />
            </View>
          </Animated.View>

          {/* SECTION 4 — REFERENCE: Pay Code Library, Airline Glossary */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-5 mt-6"
          >
            <Text style={{ color: "#475569", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
              Reference
            </Text>
            <View style={{ backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 18, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
              <ToolItem
                icon={<Award size={20} color="#f59e0b" />}
                title="UPS Premium Codes"
                subtitle="AP0, LRP, SVT & all UPS premiums"
                badge="NEW"
                onPress={() => router.push("/premium-code-library" as never)}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
              <ToolItem
                icon={<Book size={20} color="#8b5cf6" />}
                title="Pay Code Library"
                subtitle="All pay codes & definitions"
                badge={hasContracts ? "Linked" : undefined}
                onPress={() => router.push("/pay-code-library")}
              />
              <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.05)" }} />
              <ToolItem
                icon={<BookOpen size={20} color="#60a5fa" />}
                title="Airline Glossary"
                subtitle={`${airlineName} terminology`}
                onPress={() => router.push("/glossary")}
              />
            </View>
          </Animated.View>

          {/* SECTION 5 — SETTINGS: Visually separated */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(350)}
            className="mx-5 mt-10"
          >
            <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.04)", marginBottom: 20 }} />
            <Text style={{ color: "#334155", fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
              Settings
            </Text>
            <View style={{ backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 18, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" }}>
              <ToolItem
                icon={<Settings size={20} color="#475569" />}
                title="App Settings"
                subtitle="Profile, airline, pay rate, tax profile, preferences"
                onPress={() => router.push("/settings")}
              />
            </View>
          </Animated.View>

          {/* App Info */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(400)}
            className="items-center mt-8"
          >
            <Text className="text-slate-600 text-xs">Pilot Pay Tracker</Text>
          </Animated.View>
        </ScrollView>
      </LinearGradient>

      {/* Tutorial Modal */}
      {TutorialModalComponent}
    </View>
  );
}
