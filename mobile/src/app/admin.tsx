/**
 * Admin Panel — Super Admin Enhanced
 *
 * Full admin panel for pdavis.ups@outlook.com with:
 * - User lookup + support view
 * - Subscription control (super admin only)
 * - Contract manager (super admin only)
 * - Audit log viewer (super admin only)
 */

import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronLeft,
  Search,
  Users,
  Calendar,
  AlertTriangle,
  Trash2,
  RefreshCw,
  ChevronRight,
  Shield,
  X,
  Plane,
  MapPin,
  Crown,
  FileText,
  ClipboardList,
  CreditCard,
  CheckCircle,
  XCircle,
  Plus,
  Upload,
  Eye,
  Clock,
  Activity,
  UserMinus,
} from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ============================================
// Types
// ============================================

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastActive: string | null;
  profile: {
    firstName: string | null;
    lastName: string | null;
    airline: string | null;
    base: string | null;
    position: string | null;
    gemsId: string | null;
    onboardingComplete: boolean;
    subscriptionStatus: string | null;
    trialStatus: string | null;
    adminRole: string | null;
  } | null;
}

interface AdminStats {
  users: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
    activeToday: number;
    activeSessions: number;
    onboardingCompleteRate: number;
  };
  trips: { total: number; thisWeek: number };
  payEvents: { total: number; open: number };
  issues: { total: number; open: number; thisWeek: number };
  subscriptions?: { active: number; lifetime: number; activeTrials: number };
}

interface UserDetails {
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
  profile: any;
  sessions: any[];
  stats: {
    tripCount: number;
    payEventCount: number;
    flightCount: number;
    issueCount: number;
  };
  recentTrips: any[];
  recentPayEvents: any[];
  issues: any[];
  recentUploads: any[];
  syncStatus: {
    lastScheduleUpload: string | null;
    uploadStatus: string | null;
    lastLogin: string | null;
  };
}

interface ContractVersion {
  id: string;
  versionName: string;
  effectiveDate: string;
  notes: string | null;
  status: string;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
}

interface AuditLog {
  id: string;
  adminEmail: string;
  targetEmail: string | null;
  actionType: string;
  details: string | null;
  createdAt: string;
}

// ============================================
// Tab type for main panel navigation
// ============================================
type AdminTab = "users" | "contracts" | "audit";

// ============================================
// Helper Components
// ============================================

function StatCard({
  title,
  value,
  subtitle,
  color = "#f59e0b",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
}) {
  return (
    <View className="bg-slate-800/60 rounded-xl p-4 flex-1 min-w-[140px]">
      <Text className="text-slate-400 text-xs uppercase tracking-wider">{title}</Text>
      <Text style={{ color }} className="text-2xl font-bold mt-1">
        {value}
      </Text>
      {subtitle && <Text className="text-slate-500 text-xs mt-1">{subtitle}</Text>}
    </View>
  );
}

function SubscriptionBadge({ status }: { status: string | null }) {
  const s = status ?? "inactive";
  const config =
    s === "active_lifetime"
      ? { label: "Lifetime", color: "#a78bfa", bg: "bg-violet-500/20" }
      : s === "active"
      ? { label: "Active", color: "#22c55e", bg: "bg-green-500/20" }
      : s === "cancelled"
      ? { label: "Cancelled", color: "#ef4444", bg: "bg-red-500/20" }
      : { label: "Inactive", color: "#64748b", bg: "bg-slate-700/40" };

  return (
    <View className={`${config.bg} px-2 py-0.5 rounded`}>
      <Text style={{ color: config.color }} className="text-xs font-medium">
        {config.label}
      </Text>
    </View>
  );
}

function UserRow({ user, onPress }: { user: AdminUser; onPress: () => void }) {
  const fullName = user.profile
    ? `${user.profile.firstName ?? ""} ${user.profile.lastName ?? ""}`.trim()
    : null;
  const lastActive = user.lastActive
    ? new Date(user.lastActive).toLocaleDateString()
    : "Never";

  return (
    <Pressable
      onPress={onPress}
      className="bg-slate-800/40 rounded-xl p-4 mb-3 active:opacity-70"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-white font-semibold">
              {fullName || user.email}
            </Text>
            {user.profile?.onboardingComplete && (
              <View className="bg-green-500/20 px-2 py-0.5 rounded">
                <Text className="text-green-400 text-xs">Active</Text>
              </View>
            )}
            {user.profile?.adminRole === "super_admin" && (
              <Crown size={14} color="#a78bfa" />
            )}
          </View>
          <Text className="text-slate-400 text-sm mt-0.5">{user.email}</Text>
          <View className="flex-row items-center mt-2 gap-3">
            {user.profile?.base && (
              <View className="flex-row items-center">
                <MapPin size={12} color="#64748b" />
                <Text className="text-slate-500 text-xs ml-1">{user.profile.base}</Text>
              </View>
            )}
            {user.profile?.position && (
              <View className="flex-row items-center">
                <Plane size={12} color="#64748b" />
                <Text className="text-slate-500 text-xs ml-1">
                  {user.profile.position === "CPT" ? "Captain" : "FO"}
                </Text>
              </View>
            )}
            <SubscriptionBadge status={user.profile?.subscriptionStatus ?? null} />
          </View>
          <Text className="text-slate-600 text-xs mt-1">Last: {lastActive}</Text>
        </View>
        <ChevronRight size={20} color="#64748b" />
      </View>
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-slate-400 text-xs font-semibold mb-3 uppercase tracking-wider">
      {title}
    </Text>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-slate-700/20">
      <Text className="text-slate-400 text-sm">{label}</Text>
      <Text className="text-white text-sm flex-1 text-right ml-4" numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ============================================
// Main Screen
// ============================================

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AdminTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Contract manager state
  const [showNewContractModal, setShowNewContractModal] = useState(false);
  const [newContractName, setNewContractName] = useState("");
  const [newContractDate, setNewContractDate] = useState("");
  const [newContractNotes, setNewContractNotes] = useState("");

  // Check if user is admin
  const { data: adminCheck, isLoading: isCheckingAdmin } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => api.get<{ isAdmin: boolean; isSuperAdmin: boolean; email?: string }>("/api/admin/check"),
  });

  const isSuperAdmin = adminCheck?.isSuperAdmin === true;

  // Fetch stats
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<AdminStats>("/api/admin/stats"),
    enabled: adminCheck?.isAdmin === true,
  });

  // Fetch users
  const {
    data: usersData,
    isLoading: isLoadingUsers,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ["admin-users", searchQuery],
    queryFn: () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      params.set("limit", "50");
      const qs = params.toString();
      return api.get<{ users: AdminUser[]; total: number }>(
        `/api/admin/users${qs ? `?${qs}` : ""}`
      );
    },
    enabled: adminCheck?.isAdmin === true,
  });

  // Fetch user details
  const { data: userDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["admin-user", selectedUserId],
    queryFn: () => api.get<UserDetails>(`/api/admin/users/${selectedUserId}`),
    enabled: !!selectedUserId && adminCheck?.isAdmin === true,
  });

  // Fetch contracts (super admin only)
  const { data: contractsData, refetch: refetchContracts } = useQuery({
    queryKey: ["admin-contracts"],
    queryFn: () => api.get<{ versions: ContractVersion[] }>("/api/admin/contracts"),
    enabled: isSuperAdmin && activeTab === "contracts",
  });

  // Fetch audit logs (super admin only)
  const { data: auditData, refetch: refetchAudit } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => api.get<{ logs: AuditLog[]; total: number }>("/api/admin/audit-logs?limit=50"),
    enabled: isSuperAdmin && activeTab === "audit",
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      setSelectedUserId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => {
      Alert.alert("Error", "Failed to delete user");
    },
  });

  // Mutations
  const deleteTrips = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/admin/users/${userId}/trips`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user", selectedUserId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "All trips deleted");
    },
  });

  const deletePayEvents = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/admin/users/${userId}/pay-events`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user", selectedUserId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "All pay events deleted");
    },
  });

  const resetOnboarding = useMutation({
    mutationFn: (userId: string) => api.post(`/api/admin/users/${userId}/reset-onboarding`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user", selectedUserId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Onboarding reset");
    },
  });

  const invalidateSessions = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/admin/users/${userId}/sessions`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user", selectedUserId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "All sessions invalidated");
    },
  });

  const setSubscription = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: string }) =>
      api.post(`/api/admin/users/${userId}/subscription`, { subscriptionStatus: status }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-user", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Subscription updated");
    },
    onError: () => {
      Alert.alert("Error", "Failed to update subscription");
    },
  });

  const createContract = useMutation({
    mutationFn: () =>
      api.post("/api/admin/contracts", {
        versionName: newContractName,
        effectiveDate: newContractDate,
        notes: newContractNotes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-contracts"] });
      setShowNewContractModal(false);
      setNewContractName("");
      setNewContractDate("");
      setNewContractNotes("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Contract version created");
    },
  });

  const publishContract = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/contracts/${id}/publish`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-contracts"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Published", "Contract version is now live");
    },
  });

  const deleteContractDraft = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/contracts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-contracts"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  useEffect(() => {
    if (!isCheckingAdmin && adminCheck && !adminCheck.isAdmin) {
      Alert.alert("Access Denied", "You don't have admin access");
      router.back();
    }
  }, [adminCheck, isCheckingAdmin, router]);

  if (isCheckingAdmin) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text className="text-slate-400 mt-4">Checking permissions...</Text>
      </View>
    );
  }

  if (!adminCheck?.isAdmin) return null;

  // ============================================
  // User Detail View
  // ============================================
  if (selectedUserId) {
    if (isLoadingDetails || !userDetails) {
      return (
        <View className="flex-1 bg-slate-950 items-center justify-center">
          <ActivityIndicator size="large" color="#f59e0b" />
        </View>
      );
    }

    const sub = userDetails.profile?.subscriptionStatus ?? "inactive";
    const subColor =
      sub === "active_lifetime" ? "#a78bfa" : sub === "active" ? "#22c55e" : "#64748b";

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
            <View style={{ paddingTop: insets.top + 16 }} className="px-5">
              <View className="flex-row items-center mb-4">
                <Pressable
                  onPress={() => setSelectedUserId(null)}
                  className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
                >
                  <ChevronLeft size={24} color="#f59e0b" />
                </Pressable>
                <View className="flex-1 items-center">
                  <Eye size={22} color="#f59e0b" />
                </View>
                <View className="w-10" />
              </View>
              <Text className="text-white text-2xl font-bold text-center">
                Support View
              </Text>
              <Text className="text-slate-400 text-sm text-center mt-1">
                {userDetails.user.email}
              </Text>
              <View className="flex-row justify-center mt-2">
                <SubscriptionBadge status={sub} />
              </View>
            </View>

            {/* Stats */}
            <View className="px-5 mt-6">
              <View className="flex-row gap-3">
                <StatCard title="Trips" value={userDetails.stats.tripCount} />
                <StatCard title="Pay Events" value={userDetails.stats.payEventCount} />
              </View>
              <View className="flex-row gap-3 mt-3">
                <StatCard title="Flights" value={userDetails.stats.flightCount} />
                <StatCard title="Issues" value={userDetails.stats.issueCount} color={userDetails.stats.issueCount > 0 ? "#ef4444" : "#22c55e"} />
              </View>
            </View>

            {/* Sync Status */}
            <Animated.View entering={FadeInDown.duration(400).delay(50)} className="mx-5 mt-6">
              <SectionHeader title="Sync Status" />
              <View className="bg-slate-800/40 rounded-xl p-4">
                <InfoRow
                  label="Last Login"
                  value={
                    userDetails.syncStatus.lastLogin
                      ? new Date(userDetails.syncStatus.lastLogin).toLocaleString()
                      : "Unknown"
                  }
                />
                <InfoRow
                  label="Last Schedule Upload"
                  value={
                    userDetails.syncStatus.lastScheduleUpload
                      ? new Date(userDetails.syncStatus.lastScheduleUpload).toLocaleString()
                      : "Never"
                  }
                />
                <InfoRow
                  label="Upload Status"
                  value={userDetails.syncStatus.uploadStatus ?? "N/A"}
                />
                <InfoRow
                  label="Sessions"
                  value={`${userDetails.sessions.length} active`}
                />
              </View>
            </Animated.View>

            {/* Profile Info */}
            {userDetails.profile && (
              <Animated.View entering={FadeInDown.duration(400).delay(100)} className="mx-5 mt-6">
                <SectionHeader title="Profile" />
                <View className="bg-slate-800/40 rounded-xl p-4">
                  <InfoRow
                    label="Name"
                    value={`${userDetails.profile.firstName ?? ""} ${userDetails.profile.lastName ?? ""}`.trim() || "N/A"}
                  />
                  <InfoRow label="Base" value={userDetails.profile.base ?? "N/A"} />
                  <InfoRow
                    label="Position"
                    value={userDetails.profile.position === "CPT" ? "Captain" : "First Officer"}
                  />
                  <InfoRow label="GEMS ID" value={userDetails.profile.gemsId ?? "N/A"} />
                  <InfoRow
                    label="Hourly Rate"
                    value={`$${((userDetails.profile.hourlyRateCents ?? 0) / 100).toFixed(2)}`}
                  />
                  <InfoRow
                    label="Onboarding"
                    value={
                      userDetails.profile.onboardingComplete
                        ? "Complete"
                        : `Step ${userDetails.profile.onboardingStep ?? 0}`
                    }
                  />
                  <InfoRow
                    label="Trial Status"
                    value={userDetails.profile.trialStatus ?? "N/A"}
                  />
                  <InfoRow
                    label="Subscription"
                    value={userDetails.profile.subscriptionStatus ?? "inactive"}
                  />
                  {userDetails.profile.subscriptionEndDate && (
                    <InfoRow
                      label="Sub. Expires"
                      value={new Date(userDetails.profile.subscriptionEndDate).toLocaleDateString()}
                    />
                  )}
                  <InfoRow
                    label="Contract Mapping"
                    value={userDetails.profile.contractMappingStatus ?? "none"}
                  />
                  <InfoRow label="Role" value={userDetails.profile.adminRole ?? "user"} />
                  <InfoRow
                    label="Account Created"
                    value={new Date(userDetails.user.createdAt).toLocaleDateString()}
                  />
                </View>
              </Animated.View>
            )}

            {/* Recent Trips */}
            {userDetails.recentTrips.length > 0 && (
              <Animated.View entering={FadeInDown.duration(400).delay(150)} className="mx-5 mt-6">
                <SectionHeader title={`Recent Trips (${userDetails.recentTrips.length})`} />
                <View className="bg-slate-800/40 rounded-xl p-4">
                  {userDetails.recentTrips.slice(0, 5).map((trip: any) => (
                    <View
                      key={trip.id}
                      className="flex-row justify-between py-2 border-b border-slate-700/20"
                    >
                      <Text className="text-white text-sm">{trip.pairingId ?? trip.tripNumber ?? "—"}</Text>
                      <Text className="text-slate-400 text-xs">
                        {trip.startDate} → {trip.endDate}
                      </Text>
                    </View>
                  ))}
                </View>
              </Animated.View>
            )}

            {/* Issues */}
            {userDetails.issues.length > 0 && (
              <Animated.View entering={FadeInDown.duration(400).delay(175)} className="mx-5 mt-6">
                <SectionHeader title={`Issues (${userDetails.issues.length})`} />
                <View className="bg-slate-800/40 rounded-xl p-4">
                  {userDetails.issues.slice(0, 3).map((issue: any) => (
                    <View
                      key={issue.id}
                      className="py-2 border-b border-slate-700/20"
                    >
                      <View className="flex-row justify-between">
                        <Text className="text-white text-sm flex-1 mr-2" numberOfLines={1}>
                          {issue.description ?? "No description"}
                        </Text>
                        <View className={`px-2 py-0.5 rounded ${issue.status === "open" ? "bg-red-500/20" : "bg-slate-700/40"}`}>
                          <Text className={`text-xs ${issue.status === "open" ? "text-red-400" : "text-slate-400"}`}>
                            {issue.status}
                          </Text>
                        </View>
                      </View>
                      <Text className="text-slate-500 text-xs mt-1">
                        {new Date(issue.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                  ))}
                </View>
              </Animated.View>
            )}

            {/* Subscription Control — SUPER ADMIN ONLY */}
            {isSuperAdmin && (
              <Animated.View entering={FadeInDown.duration(400).delay(200)} className="mx-5 mt-6">
                <SectionHeader title="Subscription Control" />
                <View className="bg-slate-800/40 rounded-xl border border-violet-900/30">
                  {[
                    { label: "Grant Premium (1 Year)", status: "active", color: "#22c55e" },
                    { label: "Grant Lifetime Premium", status: "active_lifetime", color: "#a78bfa" },
                    { label: "Revoke Premium", status: "inactive", color: "#ef4444" },
                  ].map(({ label, status, color }, i) => (
                    <View key={status}>
                      {i > 0 && <View className="h-px bg-slate-700/30" />}
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          Alert.alert(
                            label,
                            `Set subscription to "${status}" for ${userDetails.user.email}?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Confirm",
                                onPress: () =>
                                  setSubscription.mutate({
                                    userId: selectedUserId,
                                    status,
                                  }),
                              },
                            ]
                          );
                        }}
                        disabled={setSubscription.isPending}
                        className="flex-row items-center justify-between p-4 active:opacity-70"
                      >
                        <View className="flex-row items-center">
                          <CreditCard size={18} color={color} />
                          <Text className="text-white ml-3">{label}</Text>
                        </View>
                        {setSubscription.isPending && (
                          <ActivityIndicator size="small" color={color} />
                        )}
                      </Pressable>
                    </View>
                  ))}
                </View>
              </Animated.View>
            )}

            {/* Admin Actions */}
            <Animated.View entering={FadeInDown.duration(400).delay(250)} className="mx-5 mt-6">
              <Text className="text-red-400 text-xs font-semibold mb-3 uppercase tracking-wider">
                Admin Actions
              </Text>
              <View className="bg-slate-800/40 rounded-xl border border-red-900/30">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert(
                      "Reset Onboarding",
                      "This will reset the user's onboarding state. Continue?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Reset",
                          style: "destructive",
                          onPress: () => resetOnboarding.mutate(selectedUserId),
                        },
                      ]
                    );
                  }}
                  disabled={resetOnboarding.isPending}
                  className="flex-row items-center justify-between p-4 active:opacity-70"
                >
                  <View className="flex-row items-center">
                    <RefreshCw size={20} color="#f59e0b" />
                    <Text className="text-white ml-3">Reset Onboarding</Text>
                  </View>
                  {resetOnboarding.isPending && <ActivityIndicator size="small" color="#f59e0b" />}
                </Pressable>

                <View className="h-px bg-slate-700/30" />

                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert(
                      "Invalidate Sessions",
                      "This will log the user out on all devices. Continue?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Invalidate",
                          style: "destructive",
                          onPress: () => invalidateSessions.mutate(selectedUserId),
                        },
                      ]
                    );
                  }}
                  disabled={invalidateSessions.isPending}
                  className="flex-row items-center justify-between p-4 active:opacity-70"
                >
                  <View className="flex-row items-center">
                    <X size={20} color="#ef4444" />
                    <Text className="text-white ml-3">Invalidate All Sessions</Text>
                  </View>
                  {invalidateSessions.isPending && <ActivityIndicator size="small" color="#ef4444" />}
                </Pressable>

                <View className="h-px bg-slate-700/30" />

                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert(
                      "Delete All Trips",
                      `Permanently delete all ${userDetails.stats.tripCount} trips? Cannot be undone!`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteTrips.mutate(selectedUserId),
                        },
                      ]
                    );
                  }}
                  disabled={deleteTrips.isPending}
                  className="flex-row items-center justify-between p-4 active:opacity-70"
                >
                  <View className="flex-row items-center">
                    <Trash2 size={20} color="#ef4444" />
                    <Text className="text-red-400 ml-3">Delete All Trips</Text>
                  </View>
                  {deleteTrips.isPending && <ActivityIndicator size="small" color="#ef4444" />}
                </Pressable>

                <View className="h-px bg-slate-700/30" />

                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert(
                      "Delete All Pay Events",
                      `Permanently delete all ${userDetails.stats.payEventCount} pay events? Cannot be undone!`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deletePayEvents.mutate(selectedUserId),
                        },
                      ]
                    );
                  }}
                  disabled={deletePayEvents.isPending}
                  className="flex-row items-center justify-between p-4 active:opacity-70"
                >
                  <View className="flex-row items-center">
                    <Trash2 size={20} color="#ef4444" />
                    <Text className="text-red-400 ml-3">Delete All Pay Events</Text>
                  </View>
                  {deletePayEvents.isPending && <ActivityIndicator size="small" color="#ef4444" />}
                </Pressable>

                {/* Separator */}
                <View className="h-px bg-slate-700/30 mx-4" />

                {/* Delete User */}
                {isSuperAdmin && (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      Alert.alert(
                        "Delete User Account",
                        `Permanently delete ${userDetails.user.email} and ALL their data? This cannot be undone!`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete Forever",
                            style: "destructive",
                            onPress: () => deleteUser.mutate(selectedUserId),
                          },
                        ]
                      );
                    }}
                    disabled={deleteUser.isPending}
                    className="flex-row items-center justify-between p-4 active:opacity-70"
                  >
                    <View className="flex-row items-center">
                      <UserMinus size={20} color="#dc2626" />
                      <View className="ml-3">
                        <Text className="text-red-500 font-semibold">Delete User Account</Text>
                        <Text className="text-red-900 text-xs mt-0.5">Permanently removes all data</Text>
                      </View>
                    </View>
                    {deleteUser.isPending && <ActivityIndicator size="small" color="#dc2626" />}
                  </Pressable>
                )}
              </View>
            </Animated.View>
          </ScrollView>
        </LinearGradient>
      </View>
    );
  }

  // ============================================
  // Main Panel View
  // ============================================
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
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                refetchStats();
                refetchUsers();
                if (activeTab === "contracts") refetchContracts();
                if (activeTab === "audit") refetchAudit();
              }}
              tintColor="#f59e0b"
            />
          }
        >
          {/* Header */}
          <View style={{ paddingTop: insets.top + 16 }} className="px-5">
            <View className="flex-row items-center mb-4">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                {isSuperAdmin ? (
                  <Crown size={24} color="#a78bfa" />
                ) : (
                  <Shield size={24} color="#f59e0b" />
                )}
              </View>
              <View className="w-10" />
            </View>
            <Text className="text-white text-3xl font-bold text-center">Admin Panel</Text>
            <Text className="text-slate-400 text-sm text-center mt-1">
              {isSuperAdmin ? "Super Admin — Full Access" : "Admin — Standard Access"}
            </Text>
          </View>

          {/* Stats */}
          {stats && (
            <Animated.View entering={FadeInDown.duration(400).delay(100)} className="px-5 mt-6">
              <View className="flex-row gap-3">
                <StatCard
                  title="Total Users"
                  value={stats.users.total}
                  subtitle={`${stats.users.thisWeek} this week`}
                />
                <StatCard
                  title="Active Today"
                  value={stats.users.activeToday}
                  subtitle={`${stats.users.activeSessions} sessions`}
                  color="#22c55e"
                />
              </View>
              <View className="flex-row gap-3 mt-3">
                <StatCard
                  title="Total Trips"
                  value={stats.trips.total}
                  subtitle={`${stats.trips.thisWeek} this week`}
                  color="#3b82f6"
                />
                <StatCard
                  title="Open Issues"
                  value={stats.issues.open}
                  subtitle={`${stats.issues.total} total`}
                  color={stats.issues.open > 0 ? "#ef4444" : "#22c55e"}
                />
              </View>
              {isSuperAdmin && stats.subscriptions && (
                <View className="flex-row gap-3 mt-3">
                  <StatCard
                    title="Active Subs"
                    value={stats.subscriptions.active}
                    subtitle={`${stats.subscriptions.activeTrials} on trial`}
                    color="#22c55e"
                  />
                  <StatCard
                    title="Lifetime"
                    value={stats.subscriptions.lifetime}
                    subtitle="accounts"
                    color="#a78bfa"
                  />
                </View>
              )}
            </Animated.View>
          )}

          {/* Tab Bar — super admin gets extra tabs */}
          {isSuperAdmin && (
            <Animated.View
              entering={FadeInDown.duration(400).delay(150)}
              className="px-5 mt-6"
            >
              <View className="flex-row bg-slate-800/40 rounded-xl p-1 gap-1">
                {(
                  [
                    { id: "users", label: "Users", Icon: Users },
                    { id: "contracts", label: "Contracts", Icon: FileText },
                    { id: "audit", label: "Audit Log", Icon: ClipboardList },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <Pressable
                    key={id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveTab(id);
                    }}
                    className={`flex-1 flex-row items-center justify-center py-2 rounded-lg gap-1 ${
                      activeTab === id ? "bg-slate-700" : ""
                    }`}
                  >
                    <Icon
                      size={14}
                      color={activeTab === id ? "#f59e0b" : "#64748b"}
                    />
                    <Text
                      className={`text-xs font-medium ${
                        activeTab === id ? "text-amber-400" : "text-slate-500"
                      }`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Animated.View>
          )}

          {/* USERS TAB */}
          {activeTab === "users" && (
            <>
              {/* Search */}
              <Animated.View entering={FadeInDown.duration(400).delay(200)} className="px-5 mt-6">
                <View className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3">
                  <Search size={20} color="#64748b" />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search by email, name, or GEMS ID..."
                    placeholderTextColor="#64748b"
                    className="flex-1 text-white ml-3"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {searchQuery ? (
                    <Pressable onPress={() => setSearchQuery("")}>
                      <X size={18} color="#64748b" />
                    </Pressable>
                  ) : null}
                </View>
              </Animated.View>

              {/* Users List */}
              <Animated.View entering={FadeInDown.duration(400).delay(300)} className="px-5 mt-6">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                    Users ({usersData?.total ?? 0})
                  </Text>
                  <Pressable onPress={() => refetchUsers()} className="active:opacity-70">
                    <RefreshCw size={16} color="#64748b" />
                  </Pressable>
                </View>

                {isLoadingUsers ? (
                  <View className="py-8 items-center">
                    <ActivityIndicator size="large" color="#f59e0b" />
                  </View>
                ) : usersData?.users && usersData.users.length > 0 ? (
                  usersData.users.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedUserId(user.id);
                      }}
                    />
                  ))
                ) : (
                  <View className="py-8 items-center">
                    <Users size={48} color="#64748b" />
                    <Text className="text-slate-400 mt-4">No users found</Text>
                  </View>
                )}
              </Animated.View>
            </>
          )}

          {/* CONTRACTS TAB */}
          {activeTab === "contracts" && isSuperAdmin && (
            <Animated.View entering={FadeInDown.duration(400).delay(200)} className="px-5 mt-6">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                  Contract Versions ({contractsData?.versions.length ?? 0})
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowNewContractModal(true);
                  }}
                  className="flex-row items-center bg-amber-500/20 px-3 py-1.5 rounded-lg active:opacity-70"
                >
                  <Plus size={14} color="#f59e0b" />
                  <Text className="text-amber-400 text-xs font-medium ml-1">New</Text>
                </Pressable>
              </View>

              {!contractsData?.versions.length ? (
                <View className="py-8 items-center">
                  <FileText size={48} color="#64748b" />
                  <Text className="text-slate-400 mt-4 text-center">
                    No contract versions yet.{"\n"}Create one to get started.
                  </Text>
                </View>
              ) : (
                contractsData.versions.map((v) => (
                  <View
                    key={v.id}
                    className="bg-slate-800/40 rounded-xl p-4 mb-3"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-white font-semibold">{v.versionName}</Text>
                          <View
                            className={`px-2 py-0.5 rounded ${
                              v.status === "published"
                                ? "bg-green-500/20"
                                : "bg-amber-500/20"
                            }`}
                          >
                            <Text
                              className={`text-xs ${
                                v.status === "published" ? "text-green-400" : "text-amber-400"
                              }`}
                            >
                              {v.status}
                            </Text>
                          </View>
                        </View>
                        <Text className="text-slate-400 text-sm mt-1">
                          Effective: {v.effectiveDate}
                        </Text>
                        {v.notes ? (
                          <Text className="text-slate-500 text-xs mt-1" numberOfLines={2}>
                            {v.notes}
                          </Text>
                        ) : null}
                        {v.publishedAt ? (
                          <Text className="text-slate-600 text-xs mt-1">
                            Published {new Date(v.publishedAt).toLocaleDateString()} by {v.publishedBy}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {v.status !== "published" && (
                      <View className="flex-row gap-2 mt-3">
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            Alert.alert(
                              "Publish Contract",
                              `Publish "${v.versionName}" (effective ${v.effectiveDate})? This will make it the active contract version.`,
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Publish",
                                  onPress: () => publishContract.mutate(v.id),
                                },
                              ]
                            );
                          }}
                          disabled={publishContract.isPending}
                          className="flex-row items-center bg-green-500/20 px-3 py-1.5 rounded-lg active:opacity-70"
                        >
                          <Upload size={14} color="#22c55e" />
                          <Text className="text-green-400 text-xs font-medium ml-1">Publish</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            Alert.alert(
                              "Delete Draft",
                              `Delete draft "${v.versionName}"?`,
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: () => deleteContractDraft.mutate(v.id),
                                },
                              ]
                            );
                          }}
                          disabled={deleteContractDraft.isPending}
                          className="flex-row items-center bg-red-500/20 px-3 py-1.5 rounded-lg active:opacity-70"
                        >
                          <Trash2 size={14} color="#ef4444" />
                          <Text className="text-red-400 text-xs font-medium ml-1">Delete</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))
              )}
            </Animated.View>
          )}

          {/* AUDIT LOG TAB */}
          {activeTab === "audit" && isSuperAdmin && (
            <Animated.View entering={FadeInDown.duration(400).delay(200)} className="px-5 mt-6">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
                  Audit Log ({auditData?.total ?? 0})
                </Text>
                <Pressable onPress={() => refetchAudit()} className="active:opacity-70">
                  <RefreshCw size={16} color="#64748b" />
                </Pressable>
              </View>

              {!auditData?.logs.length ? (
                <View className="py-8 items-center">
                  <Activity size={48} color="#64748b" />
                  <Text className="text-slate-400 mt-4">No audit entries yet</Text>
                </View>
              ) : (
                auditData.logs.map((log) => (
                  <View
                    key={log.id}
                    className="bg-slate-800/40 rounded-xl p-4 mb-3"
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2 flex-wrap">
                          <View className="bg-slate-700/60 px-2 py-0.5 rounded">
                            <Text className="text-amber-400 text-xs font-mono">
                              {log.actionType}
                            </Text>
                          </View>
                        </View>
                        {log.targetEmail ? (
                          <Text className="text-slate-300 text-sm mt-1">
                            Target: {log.targetEmail}
                          </Text>
                        ) : null}
                        {log.details ? (
                          <Text className="text-slate-500 text-xs mt-1" numberOfLines={2}>
                            {log.details}
                          </Text>
                        ) : null}
                      </View>
                      <View className="flex-row items-center ml-2">
                        <Clock size={12} color="#64748b" />
                        <Text className="text-slate-600 text-xs ml-1">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-slate-600 text-xs mt-2">
                      by {log.adminEmail}
                    </Text>
                  </View>
                ))
              )}
            </Animated.View>
          )}
          {/* SUPPORT TOOLS */}
          <Animated.View entering={FadeInDown.duration(400).delay(300)} className="px-5 mt-6 mb-4">
            <Text className="text-red-400 text-sm font-semibold mb-3 uppercase tracking-wider">
              Support Tools
            </Text>
            <View className="bg-slate-900/60 rounded-2xl border border-red-900/40">

              {/* Rebuild Trips from Uploads */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  Alert.alert(
                    "Rebuild All Trips",
                    "This will delete all trips for YOUR account and rebuild them from your upload history. Use this if trips seem corrupted or out of sync.\n\nThis may take a moment.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Rebuild",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const result = await api.post<{
                              success: boolean;
                              tripsDeleted: number;
                              tripsRebuilt: number;
                              errors: string[];
                            }>("/api/uploads/rebuild", {});
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Alert.alert(
                              "Rebuild Complete",
                              `Deleted ${result.tripsDeleted} old trips.\nRebuilt ${result.tripsRebuilt} trips from uploads.${
                                result.errors?.length ? `\n\n${result.errors.length} errors occurred.` : ""
                              }`
                            );
                          } catch (error: any) {
                            console.error("[Admin] Failed to rebuild trips:", error);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                            Alert.alert("Error", error?.message || "Failed to rebuild trips.");
                          }
                        },
                      },
                    ]
                  );
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center flex-1">
                  <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center">
                    <RefreshCw size={20} color="#f59e0b" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Rebuild Trips from Uploads</Text>
                    <Text className="text-slate-400 text-sm">
                      Re-process all uploads to fix corrupted data
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Clear All Trips */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  Alert.alert(
                    "Clear All Trips",
                    "This will delete all trips for YOUR account but keep your profile and upload history. You can re-import schedules afterward.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear Trips",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const result = await api.delete<{
                              success: boolean;
                              deletedCount: number;
                            }>("/api/trips/clear-all");
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Alert.alert(
                              "Success",
                              `Cleared ${result.deletedCount || 0} trips.`
                            );
                          } catch (error) {
                            console.error("[Admin] Failed to clear trips:", error);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                            Alert.alert("Error", "Failed to clear trips. Please try again.");
                          }
                        },
                      },
                    ]
                  );
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center flex-1">
                  <View className="w-10 h-10 rounded-xl bg-orange-500/20 items-center justify-center">
                    <Trash2 size={20} color="#f97316" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-semibold">Clear All Trips</Text>
                    <Text className="text-slate-400 text-sm">
                      Delete trips but keep profile & uploads
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#64748b" />
              </Pressable>

              <View className="h-px bg-slate-700/30 mx-4" />

              {/* Clear All Data & Reset */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  Alert.alert(
                    "Clear All Data & Reset",
                    "This will delete YOUR profile and all flight data. You will need to complete profile setup again. This action CANNOT be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear All Data",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            await api.delete("/api/profile");
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            router.replace("/profile-setup");
                          } catch (error) {
                            console.error("[Admin] Failed to reset data:", error);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                            Alert.alert("Error", "Failed to reset data. Please try again.");
                          }
                        },
                      },
                    ]
                  );
                }}
                className="flex-row items-center justify-between p-4 active:opacity-70"
              >
                <View className="flex-row items-center flex-1">
                  <View className="w-10 h-10 rounded-xl bg-red-500/20 items-center justify-center">
                    <Trash2 size={20} color="#ef4444" />
                  </View>
                  <View className="ml-3 flex-1">
                    <Text className="text-red-400 font-semibold">Clear All Data & Reset</Text>
                    <Text className="text-slate-400 text-sm">
                      Delete profile and all flight data
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#ef4444" />
              </Pressable>
            </View>
          </Animated.View>

        </ScrollView>
      </LinearGradient>

      {/* New Contract Modal */}
      <Modal
        visible={showNewContractModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNewContractModal(false)}
      >
        <View className="flex-1 bg-black/70 justify-end">
          <View className="bg-slate-900 rounded-t-3xl p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white text-xl font-bold">New Contract Version</Text>
              <Pressable
                onPress={() => setShowNewContractModal(false)}
                className="w-8 h-8 rounded-full bg-slate-700/60 items-center justify-center"
              >
                <X size={18} color="#94a3b8" />
              </Pressable>
            </View>

            <Text className="text-slate-400 text-sm mb-2">Version Name *</Text>
            <TextInput
              value={newContractName}
              onChangeText={setNewContractName}
              placeholder="e.g. IPA 2025 — Section 4 Update"
              placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3 text-white mb-4"
            />

            <Text className="text-slate-400 text-sm mb-2">Effective Date * (YYYY-MM-DD)</Text>
            <TextInput
              value={newContractDate}
              onChangeText={setNewContractDate}
              placeholder="e.g. 2025-01-01"
              placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3 text-white mb-4"
              keyboardType="numbers-and-punctuation"
            />

            <Text className="text-slate-400 text-sm mb-2">Notes (optional)</Text>
            <TextInput
              value={newContractNotes}
              onChangeText={setNewContractNotes}
              placeholder="Describe changes..."
              placeholderTextColor="#475569"
              className="bg-slate-800 rounded-xl px-4 py-3 text-white mb-6"
              multiline
              numberOfLines={3}
              style={{ height: 80, textAlignVertical: "top" }}
            />

            <Pressable
              onPress={() => {
                if (!newContractName.trim() || !newContractDate.trim()) {
                  Alert.alert("Required", "Version name and effective date are required.");
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                createContract.mutate();
              }}
              disabled={createContract.isPending}
              className="bg-amber-500 rounded-xl py-4 items-center active:opacity-80"
            >
              {createContract.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-bold text-base">Create Draft</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
