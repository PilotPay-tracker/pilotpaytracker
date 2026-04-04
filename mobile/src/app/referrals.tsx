/**
 * Referrals Screen
 *
 * Dedicated screen for the crew referral program.
 * Shows the user's referral code, progress toward the next free month,
 * and sharing options (iMessage, WhatsApp, copy link).
 */

import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  Share,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeInDown, FadeInUp, useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import {
  ChevronLeft,
  Gift,
  Copy,
  Check,
  Share2,
  MessageCircle,
  Users,
  Trophy,
  ChevronRight,
  Zap,
  ArrowRight,
  Star,
  CheckCircle,
} from "lucide-react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── types ────────────────────────────────────────────────────────────────────

interface ReferralCodeData {
  code: string;
  discountPercent: number;
}

interface ReferralStatsData {
  stats: {
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    freeMonthsEarned: number;
  };
  referrals: Array<{
    id: string;
    status: string;
    signedUpAt: string | null;
    subscribedAt: string | null;
    discountPercent: number;
  }>;
}

// ─── Progress ring component ──────────────────────────────────────────────────

function ProgressCircle({ value, max, size = 88 }: { value: number; max: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(value % max === 0 && value > 0 ? max : value % max, max) / max;
  const filled = circumference * pct;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Background ring */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 4,
          borderColor: "#1e293b",
        }}
      />
      {/* Progress arc — approximated with a View overlay */}
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 4,
          borderColor: "#f59e0b",
          borderTopColor: pct < 0.25 ? "#f59e0b" : "#f59e0b",
          borderRightColor: pct < 0.5 ? "transparent" : "#f59e0b",
          borderBottomColor: pct < 0.75 ? "transparent" : "#f59e0b",
          borderLeftColor: pct < 1 ? "transparent" : "#f59e0b",
          transform: [{ rotate: "-90deg" }],
        }}
      />
      <Text style={{ color: "#f59e0b", fontSize: 22, fontWeight: "800" }}>{value % max === 0 && value > 0 ? max : value % max}</Text>
      <Text style={{ color: "#64748b", fontSize: 10, marginTop: 1 }}>of {max}</Text>
    </View>
  );
}

// ─── Referral row ─────────────────────────────────────────────────────────────

function ReferralRow({ index, status, subscribedAt }: { index: number; status: string; subscribedAt: string | null }) {
  const isSubscribed = status === "subscribed";
  const isPending = status === "signed_up";
  return (
    <View className="flex-row items-center py-2.5 px-1">
      <View
        className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
          isSubscribed ? "bg-green-500/20" : "bg-slate-700/40"
        }`}
      >
        {isSubscribed ? (
          <CheckCircle size={16} color="#22c55e" />
        ) : (
          <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "700" }}>#{index + 1}</Text>
        )}
      </View>
      <View className="flex-1">
        <Text className={`font-semibold text-sm ${isSubscribed ? "text-green-400" : "text-slate-300"}`}>
          {isSubscribed ? "Subscribed — reward counted" : isPending ? "Signed up — awaiting subscription" : "Pending"}
        </Text>
        {subscribedAt && (
          <Text className="text-slate-500 text-xs mt-0.5">
            {new Date(subscribedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </Text>
        )}
      </View>
      <View
        className={`px-2 py-0.5 rounded-full ${
          isSubscribed ? "bg-green-500/20" : isPending ? "bg-amber-500/20" : "bg-slate-700/30"
        }`}
      >
        <Text className={`text-xs font-semibold ${isSubscribed ? "text-green-400" : isPending ? "text-amber-400" : "text-slate-500"}`}>
          {isSubscribed ? "+1" : isPending ? "pending" : "—"}
        </Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ReferralsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [copied, setCopied] = useState(false);
  const [referralInput, setReferralInput] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  // Fetch referral code
  const { data: codeData, isLoading: codeLoading } = useQuery({
    queryKey: ["my-referral-code"],
    queryFn: () => api.get<ReferralCodeData>("/api/referrals/my-code"),
    staleTime: 60 * 60 * 1000,
  });

  // Fetch referral stats
  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["referral-stats"],
    queryFn: () => api.get<ReferralStatsData>("/api/referrals/stats"),
    staleTime: 60 * 1000,
  });

  const code = codeData?.code ?? "";
  const stats = statsData?.stats;
  const referrals = statsData?.referrals ?? [];

  const successfulReferrals = stats?.successfulReferrals ?? 0;
  const progressInCycle = successfulReferrals % 3;
  const freeMonthsEarned = stats?.freeMonthsEarned ?? 0;
  const nextRewardAt = Math.ceil(successfulReferrals / 3) * 3 || 3;
  const untilNextReward = nextRewardAt - successfulReferrals;

  // ── Copy code ──
  const handleCopy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ── Native share ──
  const shareMessage = `Hey! I use Pilot Pay Tracker to manage my UPS flying pay — it's been a game changer. Use my code ${code} when you sign up and you'll get 50% off your first payment.\n\nDownload it and start tracking.`;

  const handleNativeShare = async () => {
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({ message: shareMessage, title: "Join Pilot Pay Tracker" });
    } catch (e) {
      // user dismissed
    }
  };

  // ── iMessage ──
  const handleIMessage = () => {
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const encoded = encodeURIComponent(shareMessage);
    Linking.openURL(`sms:?&body=${encoded}`).catch(() => {
      Alert.alert("Couldn't open Messages", "Please share manually.");
    });
  };

  // ── WhatsApp ──
  const handleWhatsApp = () => {
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const encoded = encodeURIComponent(shareMessage);
    Linking.openURL(`whatsapp://send?text=${encoded}`).catch(() => {
      Alert.alert("WhatsApp not installed", "Please share another way.");
    });
  };

  // ── Apply referral code ──
  const handleApplyCode = async () => {
    if (!referralInput.trim()) {
      Alert.alert("Enter a Code", "Please enter a referral code first.");
      return;
    }
    setIsApplying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await api.post<{ success: boolean; error?: string; message?: string; discountPercent?: number }>(
        "/api/referrals/apply",
        { code: referralInput.trim().toUpperCase() }
      );
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          "Code Applied!",
          result.message ?? `You'll get ${result.discountPercent ?? 50}% off your first payment.`
        );
        setReferralInput("");
        queryClient.invalidateQueries({ queryKey: ["referral-stats"] });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Couldn't Apply Code", result.error ?? "That code isn't valid. Try again.");
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", err?.message ?? "Failed to apply code. Please try again.");
    } finally {
      setIsApplying(false);
    }
  };

  const isLoading = codeLoading || statsLoading;

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0f172a", "#1a1a0f", "#0f172a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={{ paddingTop: insets.top + 12 }} className="px-5 mb-2">
            <View className="flex-row items-center mb-6">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={22} color="#f59e0b" />
              </Pressable>
              <View className="flex-1 items-center">
                <Text className="text-white text-xl font-bold">Crew Referrals</Text>
              </View>
              <View className="w-10" />
            </View>
          </View>

          {/* Hero card */}
          <Animated.View entering={FadeInDown.duration(500).delay(50)} className="mx-5 mb-5">
            <LinearGradient
              colors={["#1c1708", "#0f172a"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#f59e0b30" }}
            >
              <View className="flex-row items-center mb-3">
                <View className="w-10 h-10 rounded-xl bg-amber-500/20 items-center justify-center mr-3">
                  <Gift size={22} color="#f59e0b" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-lg">Share & Earn</Text>
                  <Text className="text-amber-400/80 text-sm">1 free month per 3 referrals</Text>
                </View>
              </View>
              <Text className="text-slate-300 text-sm leading-5">
                Every pilot you refer gets{" "}
                <Text className="text-amber-400 font-bold">50% off</Text> their first payment.
                For every <Text className="text-white font-semibold">3 pilots who subscribe</Text>,
                you earn a <Text className="text-green-400 font-semibold">free month</Text>.
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* Progress + code */}
          {isLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#f59e0b" size="large" />
            </View>
          ) : (
            <>
              {/* Progress card */}
              <Animated.View entering={FadeInDown.duration(500).delay(100)} className="mx-5 mb-4">
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/40 p-5">
                  <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4">
                    Progress
                  </Text>
                  <View className="flex-row items-center">
                    {/* Circle progress */}
                    <ProgressCircle value={progressInCycle === 0 && successfulReferrals > 0 ? 3 : progressInCycle} max={3} size={92} />

                    <View className="flex-1 ml-5">
                      <Text className="text-white font-bold text-lg leading-tight">
                        {progressInCycle === 0 && successfulReferrals > 0
                          ? "Reward earned!"
                          : `${untilNextReward} more to go`}
                      </Text>
                      <Text className="text-slate-400 text-sm mt-1">
                        Next reward: <Text className="text-amber-400 font-semibold">1 free month</Text>
                      </Text>

                      <View className="flex-row gap-3 mt-3">
                        <View className="flex-1 bg-slate-800/60 rounded-xl p-2.5 items-center">
                          <Text className="text-white font-bold text-lg">{stats?.totalReferrals ?? 0}</Text>
                          <Text className="text-slate-500 text-xs mt-0.5">Referred</Text>
                        </View>
                        <View className="flex-1 bg-green-500/10 rounded-xl p-2.5 items-center">
                          <Text className="text-green-400 font-bold text-lg">{successfulReferrals}</Text>
                          <Text className="text-slate-500 text-xs mt-0.5">Subscribed</Text>
                        </View>
                        <View className="flex-1 bg-amber-500/10 rounded-xl p-2.5 items-center">
                          <Text className="text-amber-400 font-bold text-lg">{freeMonthsEarned}</Text>
                          <Text className="text-slate-500 text-xs mt-0.5">Earned</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Progress bar */}
                  <View className="mt-4">
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-slate-500 text-xs">Referrals: {successfulReferrals % 3 === 0 && successfulReferrals > 0 ? 3 : successfulReferrals % 3} / 3</Text>
                      <Text className="text-amber-400 text-xs font-semibold">Next reward: 1 free month</Text>
                    </View>
                    <View className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <Animated.View
                        style={{
                          height: "100%",
                          width: `${Math.round((progressInCycle === 0 && successfulReferrals > 0 ? 3 : progressInCycle) / 3 * 100)}%`,
                          backgroundColor: "#f59e0b",
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <View className="flex-row justify-between mt-1">
                      <Text className="text-slate-600 text-xs">0</Text>
                      <Text className="text-slate-600 text-xs">1</Text>
                      <Text className="text-slate-600 text-xs">2</Text>
                      <Text className="text-amber-500/70 text-xs font-semibold">3 🎁</Text>
                    </View>
                  </View>
                </View>
              </Animated.View>

              {/* Your referral code */}
              <Animated.View entering={FadeInDown.duration(500).delay(150)} className="mx-5 mb-4">
                <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 ml-1">
                  Your Referral Code
                </Text>
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/40 p-5">
                  <View className="items-center mb-4">
                    <Pressable
                      onPress={handleCopy}
                      className="bg-slate-800/70 rounded-2xl px-8 py-4 active:opacity-70"
                      style={{ borderWidth: 1, borderColor: copied ? "#22c55e40" : "#f59e0b30" }}
                    >
                      <Text style={{ color: copied ? "#22c55e" : "#f59e0b", fontSize: 28, fontWeight: "900", letterSpacing: 6 }}>
                        {code}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleCopy}
                      className="flex-row items-center mt-3 active:opacity-70"
                    >
                      {copied ? (
                        <Check size={14} color="#22c55e" />
                      ) : (
                        <Copy size={14} color="#64748b" />
                      )}
                      <Text className={`text-xs ml-1.5 font-medium ${copied ? "text-green-400" : "text-slate-400"}`}>
                        {copied ? "Copied!" : "Tap to copy"}
                      </Text>
                    </Pressable>
                  </View>

                  {/* Share buttons */}
                  <View className="gap-2.5">
                    {/* iMessage */}
                    <Pressable
                      onPress={handleIMessage}
                      className="flex-row items-center bg-green-500/15 rounded-xl px-4 py-3.5 active:opacity-70"
                      style={{ borderWidth: 1, borderColor: "#22c55e30" }}
                    >
                      <View className="w-8 h-8 rounded-lg bg-green-500/20 items-center justify-center mr-3">
                        <MessageCircle size={18} color="#22c55e" />
                      </View>
                      <Text className="text-white font-semibold flex-1">Share via iMessage</Text>
                      <ArrowRight size={16} color="#64748b" />
                    </Pressable>

                    {/* WhatsApp */}
                    <Pressable
                      onPress={handleWhatsApp}
                      className="flex-row items-center bg-emerald-500/10 rounded-xl px-4 py-3.5 active:opacity-70"
                      style={{ borderWidth: 1, borderColor: "#10b98130" }}
                    >
                      <View className="w-8 h-8 rounded-lg bg-emerald-500/20 items-center justify-center mr-3">
                        <Share2 size={18} color="#10b981" />
                      </View>
                      <Text className="text-white font-semibold flex-1">Share via WhatsApp</Text>
                      <ArrowRight size={16} color="#64748b" />
                    </Pressable>

                    {/* More options */}
                    <Pressable
                      onPress={handleNativeShare}
                      className="flex-row items-center bg-slate-800/60 rounded-xl px-4 py-3.5 active:opacity-70"
                      style={{ borderWidth: 1, borderColor: "#334155" }}
                    >
                      <View className="w-8 h-8 rounded-lg bg-slate-700/60 items-center justify-center mr-3">
                        <Share2 size={18} color="#94a3b8" />
                      </View>
                      <Text className="text-white font-semibold flex-1">More Options</Text>
                      <ArrowRight size={16} color="#64748b" />
                    </Pressable>
                  </View>
                </View>
              </Animated.View>

              {/* Apply a referral code */}
              <Animated.View entering={FadeInDown.duration(500).delay(200)} className="mx-5 mb-4">
                <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 ml-1">
                  Have a Referral Code?
                </Text>
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/40 p-4">
                  <Text className="text-slate-300 text-sm mb-3">
                    Enter a friend's code to get 50% off your first payment.
                  </Text>
                  <View className="flex-row gap-2">
                    <TextInput
                      value={referralInput}
                      onChangeText={(t) => setReferralInput(t.toUpperCase())}
                      placeholder="PILOT-XXXX"
                      placeholderTextColor="#475569"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      className="flex-1 bg-slate-800/70 rounded-xl px-4 py-3 text-white font-mono text-base border border-slate-700/40"
                    />
                    <Pressable
                      onPress={handleApplyCode}
                      disabled={isApplying || !referralInput.trim()}
                      className="bg-amber-500 rounded-xl px-4 items-center justify-center active:opacity-80"
                      style={{ opacity: !referralInput.trim() ? 0.5 : 1 }}
                    >
                      {isApplying ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <Text className="text-black font-bold">Apply</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </Animated.View>

              {/* Referral history */}
              {referrals.length > 0 && (
                <Animated.View entering={FadeInDown.duration(500).delay(250)} className="mx-5 mb-4">
                  <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 ml-1">
                    Referral History
                  </Text>
                  <View className="bg-slate-900/60 rounded-2xl border border-slate-700/40 px-4 py-2">
                    {referrals.map((r, i) => (
                      <View key={r.id}>
                        {i > 0 && <View className="h-px bg-slate-800/60 mx-1" />}
                        <ReferralRow
                          index={i}
                          status={r.status}
                          subscribedAt={r.subscribedAt}
                        />
                      </View>
                    ))}
                  </View>
                </Animated.View>
              )}

              {/* How it works */}
              <Animated.View entering={FadeInDown.duration(500).delay(300)} className="mx-5">
                <Text className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2 ml-1">
                  How It Works
                </Text>
                <View className="bg-slate-900/60 rounded-2xl border border-slate-700/40 p-4 gap-3">
                  {[
                    { icon: Share2, color: "#f59e0b", title: "Share your code", body: "Send your PILOT-XXXX code to fellow UPS crew." },
                    { icon: Users, color: "#3b82f6", title: "They sign up", body: "Your referred pilot gets 50% off their first payment when they use your code." },
                    { icon: Trophy, color: "#22c55e", title: "They subscribe", body: "Once they subscribe, their referral counts toward your reward." },
                    { icon: Zap, color: "#a855f7", title: "Earn free months", body: "Every 3 subscribed pilots earns you 1 free month, automatically applied." },
                  ].map((step, i) => (
                    <View key={i} className="flex-row items-start">
                      <View
                        className="w-8 h-8 rounded-lg items-center justify-center mr-3 mt-0.5 flex-shrink-0"
                        style={{ backgroundColor: step.color + "20" }}
                      >
                        <step.icon size={16} color={step.color} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-white font-semibold text-sm">{step.title}</Text>
                        <Text className="text-slate-400 text-xs mt-0.5 leading-4">{step.body}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </Animated.View>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
