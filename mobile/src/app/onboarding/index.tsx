/**
 * Onboarding Step 1 — Welcome
 *
 * First screen new users see after signing in.
 * Pure welcome/intro — no data collection.
 */

import { View, Text, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Plane, DollarSign, TrendingUp, ShieldCheck } from "lucide-react-native";

function OnboardingProgress({ current, total }: { current: number; total: number }) {
  return (
    <View className="flex-row items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            width: i < current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i < current ? "#f59e0b" : "#1e293b",
          }}
        />
      ))}
    </View>
  );
}

export default function OnboardingWelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/onboarding/pilot-profile");
  };

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={["#0c1421", "#0a1628", "#061220"]}
        style={{ flex: 1 }}
      >
        <View
          className="flex-1 px-6"
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          {/* Progress dots */}
          <Animated.View entering={FadeIn.delay(100)} className="items-center mb-10">
            <OnboardingProgress current={0} total={4} />
          </Animated.View>

          {/* Hero */}
          <Animated.View entering={FadeInDown.delay(150).springify()} className="items-center mb-10">
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 28,
                backgroundColor: "rgba(245,158,11,0.15)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 24,
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.25)",
              }}
            >
              <Plane size={48} color="#f59e0b" strokeWidth={1.5} />
            </View>

            <Text
              style={{
                color: "#f59e0b",
                fontSize: 12,
                fontWeight: "700",
                letterSpacing: 2,
                marginBottom: 12,
                textTransform: "uppercase",
              }}
            >
              Welcome to Pilot Pay Tracker
            </Text>

            <Text
              style={{
                color: "#ffffff",
                fontSize: 30,
                fontWeight: "800",
                textAlign: "center",
                lineHeight: 38,
                marginBottom: 14,
              }}
            >
              Let's set up{"\n"}your profile
            </Text>

            <Text
              style={{
                color: "#94a3b8",
                fontSize: 16,
                textAlign: "center",
                lineHeight: 24,
              }}
            >
              3 quick steps to personalize your{"\n"}pay tracking, career, and retirement tools.
            </Text>
          </Animated.View>

          {/* Feature cards */}
          <Animated.View entering={FadeInDown.delay(300).springify()} className="gap-3 mb-auto">
            {[
              {
                icon: DollarSign,
                color: "#22c55e",
                bg: "rgba(34,197,94,0.1)",
                title: "Precise Pay Calculations",
                desc: "Know exactly what you're owed each period",
              },
              {
                icon: TrendingUp,
                color: "#3b82f6",
                bg: "rgba(59,130,246,0.1)",
                title: "Career & Retirement Planning",
                desc: "Track seniority, upgrade path, and pension",
              },
              {
                icon: ShieldCheck,
                color: "#f59e0b",
                bg: "rgba(245,158,11,0.1)",
                title: "Pay Audit & Verification",
                desc: "Catch errors before your paycheck is final",
              },
            ].map((item) => (
              <View
                key={item.title}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "rgba(15,23,42,0.6)",
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: item.bg,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                    flexShrink: 0,
                  }}
                >
                  <item.icon size={22} color={item.color} />
                </View>
                <View className="flex-1">
                  <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 14, marginBottom: 2 }}>
                    {item.title}
                  </Text>
                  <Text style={{ color: "#64748b", fontSize: 13 }}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </Animated.View>

          {/* CTA */}
          <Animated.View entering={FadeInUp.delay(450).springify()} className="mt-8">
            <Pressable
              onPress={handleGetStarted}
              style={{
                backgroundColor: "#f59e0b",
                borderRadius: 18,
                paddingVertical: 18,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#0f172a", fontWeight: "800", fontSize: 17 }}>
                Get Started →
              </Text>
            </Pressable>
            <Text
              style={{ color: "#475569", fontSize: 12, textAlign: "center", marginTop: 12 }}
            >
              Takes less than 2 minutes
            </Text>
          </Animated.View>
        </View>
      </LinearGradient>
    </View>
  );
}
