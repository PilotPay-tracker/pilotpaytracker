/**
 * Settings Screen
 *
 * Shows current profile summary and provides options to edit profile
 * or reset all data.
 */

import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  Settings as SettingsIcon,
  User,
  IdCard,
  Plane,
  MapPin,
  DollarSign,
  Calendar,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  FileText,
  Building2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calculator,
  MessageCircle,
  Bug,
  Lightbulb,
  HelpCircle,
  X,
  Send,
  Bot,
  Bell,
  Shield,
  Gift,
} from "lucide-react-native";
import { useProfile, useProfileStore } from "@/lib/state/profile-store";
import { useDeleteProfileMutation } from "@/lib/useProfile";
import { useAuth } from "@/lib/BetterAuthProvider";
import { useContracts } from "@/lib/useContracts";
import { api } from "@/lib/api";
import { trackEvent, AnalyticsEvents } from "@/lib/analytics";
import { clearAllUserData } from "@/lib/clearUserData";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

// Format date for display
function formatDateDisplay(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Calculate retirement date (DOB + 65 years)
function calculateRetirementDate(dob: string): string {
  const date = new Date(dob + "T12:00:00");
  date.setFullYear(date.getFullYear() + 65);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface SettingRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}

function SettingRow({ icon, label, value, valueColor = "text-white" }: SettingRowProps) {
  return (
    <View className="flex-row items-center justify-between py-3">
      <View className="flex-row items-center flex-1">
        {icon}
        <Text className="text-slate-400 text-sm ml-3">{label}</Text>
      </View>
      <Text className={`font-medium ${valueColor}`}>{value}</Text>
    </View>
  );
}

// Issue categories
const ISSUE_CATEGORIES = [
  { id: "bug", label: "Bug Report", icon: Bug, color: "#ef4444" },
  { id: "feature", label: "Feature Request", icon: Lightbulb, color: "#f59e0b" },
  { id: "question", label: "Question", icon: HelpCircle, color: "#3b82f6" },
  { id: "other", label: "Other", icon: MessageCircle, color: "#64748b" },
] as const;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useProfile();
  const deleteMutation = useDeleteProfileMutation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { data: contractsData } = useContracts();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();

  // Check if current user is admin
  const { data: adminCheck } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => api.get<{ isAdmin: boolean }>("/api/admin/check"),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  const isAdmin = adminCheck?.isAdmin === true;

  // Referral system state
  const [showReferralModal, setShowReferralModal] = useState(false);

  // Get user's referral code
  const { data: referralData, isLoading: referralLoading } = useQuery({
    queryKey: ["my-referral-code"],
    queryFn: () => api.get<{ code: string; discountPercent: number }>("/api/referrals/my-code"),
    staleTime: 60 * 60 * 1000, // Cache for 1 hour
  });

  // Get referral stats
  const { data: referralStats } = useQuery({
    queryKey: ["referral-stats"],
    queryFn: () =>
      api.get<{
        stats: {
          totalReferrals: number;
          successfulReferrals: number;
          pendingReferrals: number;
          freeMonthsEarned: number;
        };
      }>("/api/referrals/stats"),
    staleTime: 5 * 60 * 1000,
  });

  // Report Issue state
  const [showReportModal, setShowReportModal] = useState(false);
  const [issueCategory, setIssueCategory] = useState<string>("bug");
  const [issueDescription, setIssueDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitIssue = async () => {
    if (!issueDescription.trim()) {
      Alert.alert("Error", "Please describe the issue");
      return;
    }

    setIsSubmitting(true);
    try {
      const deviceInfo = `${Platform.OS} ${Platform.Version}`;
      const appVersion = Constants.expoConfig?.version ?? "1.0";

      await api.post("/api/support/report-issue", {
        category: issueCategory,
        description: issueDescription.trim(),
        deviceInfo,
        appVersion,
      });

      trackEvent(AnalyticsEvents.ISSUE_REPORTED, {
        category: issueCategory,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowReportModal(false);
      setIssueDescription("");
      setIssueCategory("bug");
      Alert.alert("Thank You", "Your feedback has been submitted. We'll look into it.");
    } catch (error) {
      console.error("[Settings] Failed to submit issue:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", "Failed to submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditProfile = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/profile-setup", params: { mode: "edit" } });
  };

  const handleResetData = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      "Clear All Data & Reset",
      "This will delete your profile and all flight data. You will need to complete profile setup again. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All Data",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              // Navigate to profile setup
              router.replace("/profile-setup");
            } catch (error) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", "Failed to reset data. Please try again.");
            }
          },
        },
      ]
    );
  };

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setIsSigningOut(true);
          try {
            // Clear ALL user data using centralized utility
            // This ensures no data leaks between users
            await clearAllUserData(queryClient);

            // Sign out from auth
            await signOut();

            // Navigate to welcome
            router.replace("/welcome");
          } catch (error) {
            console.log("[Settings] Sign out error:", error);
            // Even if sign out fails, clear local state and navigate
            // This ensures users can always sign out
            await clearAllUserData(queryClient).catch(() => {});
            router.replace("/welcome");
          } finally {
            setIsSigningOut(false);
          }
        },
      },
    ]);
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
                <SettingsIcon size={24} color="#f59e0b" />
              </View>
              <View className="w-10" />
            </View>

            <Text className="text-white text-3xl font-bold text-center">Settings</Text>
            <Text className="text-slate-400 text-base mt-2 text-center">
              Manage your profile and preferences
            </Text>
          </Animated.View>

          {/* Profile Summary Card */}
          {profile && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(200)}
              className="mx-5 mt-6"
            >
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                  Profile
                </Text>
                <Pressable
                  onPress={handleEditProfile}
                  className="flex-row items-center active:opacity-70"
                >
                  <Edit size={14} color="#f59e0b" />
                  <Text className="text-amber-500 text-sm font-semibold ml-1">Edit</Text>
                </Pressable>
              </View>

              <View className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                {/* Name Header */}
                <View className="items-center pb-4 border-b border-slate-700/50 mb-4">
                  <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-3">
                    <Plane size={32} color="#f59e0b" />
                  </View>
                  <Text className="text-white text-xl font-bold">
                    {profile.firstName} {profile.lastName}
                  </Text>
                  <Text className="text-slate-400 text-sm mt-1">
                    {profile.position === "CPT" ? "Captain" : "First Officer"} - {profile.base}
                  </Text>
                </View>

                {/* Profile Details */}
                <SettingRow
                  icon={<IdCard size={16} color="#64748b" />}
                  label="GEMS ID"
                  value={profile.gemsId ?? "Not set"}
                />
                <View className="h-px bg-slate-700/30" />
                <SettingRow
                  icon={<Plane size={16} color="#64748b" />}
                  label="Position"
                  value={profile.position === "CPT" ? "Captain" : "First Officer"}
                />
                <View className="h-px bg-slate-700/30" />
                <SettingRow
                  icon={<MapPin size={16} color="#64748b" />}
                  label="Base"
                  value={profile.base ?? "Not set"}
                />
                <View className="h-px bg-slate-700/30" />
                <SettingRow
                  icon={<DollarSign size={16} color="#64748b" />}
                  label="Hourly Rate"
                  value={`$${(profile.hourlyRateCents / 100).toFixed(2)}`}
                  valueColor="text-amber-500"
                />
                <View className="h-px bg-slate-700/30" />
                <SettingRow
                  icon={<Calendar size={16} color="#64748b" />}
                  label="Date of Hire"
                  value={formatDateDisplay(profile.dateOfHire)}
                />
                <View className="h-px bg-slate-700/30" />
                <SettingRow
                  icon={<Calendar size={16} color="#64748b" />}
                  label="Date of Birth"
                  value={formatDateDisplay(profile.dateOfBirth)}
                />
                {profile.dateOfBirth && (
                  <>
                    <View className="h-px bg-slate-700/30" />
                    <SettingRow
                      icon={<Calendar size={16} color="#22c55e" />}
                      label="Retirement"
                      value={calculateRetirementDate(profile.dateOfBirth)}
                      valueColor="text-green-400"
                    />
                  </>
                )}
              </View>
            </Animated.View>
          )}

          {/* Airline & Terminology - UPS Only */}
          {profile && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(250)}
              className="mx-5 mt-6"
            >
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Airline & Terminology
              </Text>
              <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
                {/* Current Airline - Locked to UPS */}
                <View className="flex-row items-center justify-between p-4">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                      <Building2 size={20} color="#f59e0b" />
                    </View>
                    <View className="ml-3">
                      <Text className="text-white font-semibold">UPS</Text>
                      <Text className="text-slate-400 text-sm">
                        Built by a UPS pilot for UPS pilots
                      </Text>
                    </View>
                  </View>
                  <View className="bg-amber-500/20 px-2 py-1 rounded">
                    <Text className="text-amber-500 text-xs font-semibold">LOCKED</Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Actions */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(300)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Account
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {/* Edit Profile */}
              <Pressable
                onPress={handleEditProfile}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                    <User size={20} color="#f59e0b" />
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-semibold">Edit Profile</Text>
                    <Text className="text-slate-400 text-sm">Update your information</Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Sign Out */}
              <Pressable
                onPress={handleSignOut}
                disabled={isSigningOut}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-slate-700/50 items-center justify-center">
                    {isSigningOut ? (
                      <ActivityIndicator size="small" color="#64748b" />
                    ) : (
                      <LogOut size={20} color="#64748b" />
                    )}
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-semibold">Sign Out</Text>
                    <Text className="text-slate-400 text-sm">Sign out of your account</Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Contract & Pay References */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(350)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Contract & Pay References
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/contract-references");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center">
                    <FileText size={20} color="#3b82f6" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Contract Documents</Text>
                    <Text className="text-slate-400 text-sm">
                      {contractsData?.hasActiveDocuments
                        ? `${contractsData.totalCount} document${contractsData.totalCount !== 1 ? "s" : ""} uploaded`
                        : "Upload CBA, pay manual, LOAs"}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Tax & Net Pay Estimator */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(375)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Tax & Net Pay
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/tax-settings");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-green-500/20 items-center justify-center">
                    <Calculator size={20} color="#22c55e" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Tax Settings</Text>
                    <Text className="text-slate-400 text-sm">
                      Configure withholding for net pay estimates
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Notifications */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(387)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Notifications
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/notification-settings");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                    <Bell size={20} color="#f59e0b" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Notification Settings</Text>
                    <Text className="text-slate-400 text-sm">
                      Report times, payday, and quiet hours
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Crew Referral Program */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(393)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Crew Referral Program
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-amber-500/20 overflow-hidden">
              <LinearGradient
                colors={["#1c170820", "#0f172a"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 16 }}
              >
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push("/referrals");
                  }}
                  className="p-4 active:opacity-70"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center mr-3">
                        <Gift size={20} color="#f59e0b" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-white font-semibold">Share & Earn</Text>
                        <Text className="text-slate-400 text-sm">
                          Refer crew — earn 1 free month per 3 referrals
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={20} color="#f59e0b" />
                  </View>
                  {referralData?.code && (
                    <View className="mt-3 flex-row items-center justify-between bg-slate-800/60 rounded-xl px-3 py-2.5">
                      <Text className="text-slate-400 text-xs">Your code</Text>
                      <Text className="text-amber-400 font-bold tracking-widest text-sm">
                        {referralData.code}
                      </Text>
                      {referralStats?.stats && (
                        <Text className="text-slate-400 text-xs">
                          {referralStats.stats.successfulReferrals % 3}/{3} → free month
                        </Text>
                      )}
                    </View>
                  )}
                </Pressable>
              </LinearGradient>
            </View>
          </Animated.View>

          {/* Support & Feedback */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(400)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Support & Feedback
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {/* AI Help Desk */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/help-desk");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                    <Bot size={20} color="#f59e0b" />
                  </View>
                  <View className="ml-3 flex-1">
                    <View className="flex-row items-center">
                      <Text className="text-white font-semibold">AI Help Desk</Text>
                      <View className="ml-2 px-2 py-0.5 rounded bg-amber-500/20">
                        <Text className="text-amber-400 text-xs font-semibold">NEW</Text>
                      </View>
                    </View>
                    <Text className="text-slate-400 text-sm">
                      Get instant help & schedule import tutorials
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Report an Issue */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowReportModal(true);
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-purple-500/20 items-center justify-center">
                    <MessageCircle size={20} color="#a855f7" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Report an Issue</Text>
                    <Text className="text-slate-400 text-sm">
                      Bug reports, feature requests, questions
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Diagnostics */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/diagnostics");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-slate-700/50 items-center justify-center">
                    <Bug size={20} color="#64748b" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Diagnostics</Text>
                    <Text className="text-slate-400 text-sm">
                      Test connectivity & force sign-out for testing
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Admin Panel - Only visible to admins */}
          {isAdmin && (
            <Animated.View
              entering={FadeInDown.duration(600).delay(425)}
              className="mx-5 mt-6"
            >
              <Text className="text-amber-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Admin
              </Text>
              <View className="bg-slate-900/60 rounded-2xl border border-amber-500/30">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push("/admin");
                  }}
                  className="flex-row items-center justify-between p-4 active:opacity-70"
                >
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                      <Shield size={20} color="#f59e0b" />
                    </View>
                    <View className="ml-3">
                      <Text className="text-amber-400 font-semibold">Admin Panel</Text>
                      <Text className="text-slate-400 text-sm">
                        Manage users and view app stats
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#f59e0b" />
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* Data Recovery Tools */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(437)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Data Recovery
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {/* Clear Import Cache */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  Alert.alert(
                    "Clear Import Cache",
                    "This will clear the cached schedule parses, allowing you to re-import the same files. Your existing trips will not be affected.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear Cache",
                        onPress: async () => {
                          try {
                            await api.delete("/api/schedule/clear-cache");
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Alert.alert("Success", "Import cache cleared. You can now re-import files.");
                          } catch (error) {
                            console.error("[Settings] Failed to clear cache:", error);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                            Alert.alert("Error", "Failed to clear cache. Please try again.");
                          }
                        },
                      },
                    ]
                  );
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center">
                    <RefreshCw size={20} color="#3b82f6" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Clear Import Cache</Text>
                    <Text className="text-slate-400 text-sm">
                      Allow re-importing the same files
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

            </View>
          </Animated.View>

          {/* About & Legal (Phase 7) */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(475)}
            className="mx-5 mt-6"
          >
            <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              About
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-slate-700/50">
              {/* Contract Reference History */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/contract-view-history");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-blue-500/20 items-center justify-center">
                    <FileText size={20} color="#3b82f6" />
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-semibold">Contract References Viewed</Text>
                    <Text className="text-slate-400 text-sm">
                      View your reference history
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Schedule Patterns */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/contract-patterns");
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-xl bg-purple-500/20 items-center justify-center">
                    <Calculator size={20} color="#a855f7" />
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-semibold">Schedule Patterns</Text>
                    <Text className="text-slate-400 text-sm">
                      Informational pattern awareness
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>
            </View>

            {/* Legal Disclaimer */}
            <View className="bg-slate-800/40 rounded-xl p-4 mt-4 border border-slate-700/30">
              <Text className="text-slate-500 text-xs text-center leading-relaxed">
                Pilot Pay Tracker is an independent personal record-keeping tool.
                It is not affiliated with, endorsed by, or authorized by any airline,
                union, or employer. Contract references are provided for informational
                purposes only. No legal, contractual, or professional advice is given.
              </Text>
            </View>
          </Animated.View>

          {/* App Version */}
          <Animated.View
            entering={FadeInDown.duration(600).delay(500)}
            className="items-center mt-10"
          >
            <Text className="text-slate-500 text-sm">Pilot Pay Tracker v1.0</Text>
            <Text className="text-slate-600 text-xs mt-1">
              Built by a UPS pilot for UPS pilots
            </Text>
          </Animated.View>
        </ScrollView>
      </LinearGradient>

      {/* Report Issue Modal */}
      <Modal
        visible={showReportModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReportModal(false)}
      >
        <View className="flex-1 bg-slate-950">
          <LinearGradient
            colors={["#0f172a", "#1e293b"]}
            style={{ flex: 1 }}
          >
            {/* Modal Header */}
            <View
              style={{ paddingTop: insets.top + 16 }}
              className="px-5 pb-4 border-b border-slate-800"
            >
              <View className="flex-row items-center justify-between">
                <Pressable
                  onPress={() => setShowReportModal(false)}
                  className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center"
                >
                  <X size={20} color="#94a3b8" />
                </Pressable>
                <Text className="text-white text-lg font-semibold">Report an Issue</Text>
                <View className="w-10" />
              </View>
            </View>

            <ScrollView className="flex-1 px-5 pt-6">
              {/* Category Selection */}
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Category
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {ISSUE_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = issueCategory === cat.id;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setIssueCategory(cat.id);
                      }}
                      className={`flex-row items-center px-4 py-2.5 rounded-xl border ${
                        isSelected
                          ? "bg-slate-800 border-amber-500/50"
                          : "bg-slate-900/60 border-slate-700/50"
                      }`}
                    >
                      <Icon size={16} color={isSelected ? cat.color : "#64748b"} />
                      <Text
                        className={`ml-2 font-medium ${
                          isSelected ? "text-white" : "text-slate-400"
                        }`}
                      >
                        {cat.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Description */}
              <Text className="text-slate-400 text-sm font-semibold mb-3 uppercase tracking-wider">
                Description
              </Text>
              <View className="bg-slate-900/60 rounded-xl border border-slate-700/50 p-4 mb-6">
                <TextInput
                  value={issueDescription}
                  onChangeText={setIssueDescription}
                  placeholder="Describe the issue, feature request, or question..."
                  placeholderTextColor="#64748b"
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  className="text-white text-base"
                  style={{ minHeight: 120 }}
                />
              </View>

              {/* Device Info */}
              <View className="bg-slate-800/40 rounded-xl p-4 mb-6">
                <Text className="text-slate-500 text-xs mb-2">
                  The following info will be included:
                </Text>
                <Text className="text-slate-400 text-sm">
                  Device: {Platform.OS} {Platform.Version}
                </Text>
                <Text className="text-slate-400 text-sm">
                  App Version: {Constants.expoConfig?.version ?? "1.0"}
                </Text>
              </View>

              {/* Submit Button */}
              <Pressable
                onPress={handleSubmitIssue}
                disabled={isSubmitting || !issueDescription.trim()}
                className={`flex-row items-center justify-center py-4 rounded-xl mb-10 ${
                  isSubmitting || !issueDescription.trim()
                    ? "bg-slate-700"
                    : "bg-amber-500"
                }`}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Send size={18} color={!issueDescription.trim() ? "#64748b" : "#000"} />
                    <Text
                      className={`ml-2 font-semibold text-base ${
                        !issueDescription.trim() ? "text-slate-500" : "text-black"
                      }`}
                    >
                      Submit Feedback
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </LinearGradient>
        </View>
      </Modal>
    </View>
  );
}
