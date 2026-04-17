/**
 * Diagnostics Screen
 * Debug screen for auth and connectivity issues.
 * Includes force sign-out for TestFlight testing.
 */

import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ChevronLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Server,
  Wifi,
  Database,
  LogOut,
  Trash2,
} from "lucide-react-native";
import { BACKEND_URL } from "@/lib/api";
import { authClient, hasStoredSession } from "@/lib/authClient";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { forceSignOut } from "@/lib/clearSessionOnVersionChange";
import { useAuth } from "@/lib/BetterAuthProvider";

interface TestResult {
  name: string;
  status: "pending" | "success" | "error" | "warning";
  message: string;
  details?: string;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  envName: string;
  nodeEnv: string;
  apiBaseUrl: string;
  apiPort: string;
  build: {
    version: string;
    serverStarted: string;
    runtime: string;
    nodeVersion: string;
  };
  debug: {
    hasOpenAiKey: boolean;
    hasResendKey: boolean;
    databaseUrl: string;
  };
}

export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [healthData, setHealthData] = useState<HealthResponse | null>(null);
  const [isClearingSession, setIsClearingSession] = useState(false);

  const envBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;

  const runDiagnostics = async () => {
    setIsRunning(true);
    setResults([]);
    setHealthData(null);
    const newResults: TestResult[] = [];

    // Test 1: Environment Variables
    newResults.push({
      name: "Environment Variables",
      status: envBackendUrl ? "success" : "warning",
      message: envBackendUrl ? "EXPO_PUBLIC_BACKEND_URL is set" : "Using fallback URL",
      details: `Value: ${envBackendUrl || "(not set, using fallback)"}`,
    });
    setResults([...newResults]);

    // Test 2: Resolved backend URL
    newResults.push({
      name: "Backend URL",
      status: BACKEND_URL.startsWith("https://") ? "success" : "error",
      message: BACKEND_URL.startsWith("https://") ? "Using HTTPS (secure)" : "Not using HTTPS!",
      details: BACKEND_URL,
    });
    setResults([...newResults]);

    // Test 3: /api/health
    try {
      const healthResponse = await fetch(`${BACKEND_URL}/api/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await healthResponse.json();

      if (healthResponse.ok && data.status === "ok") {
        setHealthData(data as HealthResponse);
        newResults.push({
          name: "API Health Check",
          status: "success",
          message: `Server: ${data.envName} (${data.nodeEnv})`,
          details: `API: ${data.apiBaseUrl}`,
        });
      } else {
        newResults.push({
          name: "API Health Check",
          status: "warning",
          message: `Status: ${healthResponse.status}`,
          details: JSON.stringify(data).slice(0, 200),
        });
      }
    } catch (err: any) {
      newResults.push({
        name: "API Health Check",
        status: "error",
        message: "Cannot reach /api/health",
        details: err?.message || "Unknown error",
      });
    }
    setResults([...newResults]);

    // Test 4: Basic connectivity
    try {
      const healthResponse = await fetch(`${BACKEND_URL}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const healthDataBasic = await healthResponse.json().catch(() => ({}));
      newResults.push({
        name: "Backend Connectivity",
        status: healthResponse.ok ? "success" : "warning",
        message: healthResponse.ok ? "Backend is reachable" : `Status: ${healthResponse.status}`,
        details: JSON.stringify(healthDataBasic).slice(0, 200),
      });
    } catch (err: any) {
      newResults.push({
        name: "Backend Connectivity",
        status: "error",
        message: "Cannot reach backend",
        details: err?.message || "Unknown error",
      });
    }
    setResults([...newResults]);

    // Test 5: Auth session
    try {
      const { data: sessionData } = await authClient.getSession();
      const session = sessionData?.session;
      const u = sessionData?.user;
      newResults.push({
        name: "Auth Session",
        status: session ? "success" : "warning",
        message: session ? "User is authenticated" : "No active session",
        details: u ? `User: ${u.email}` : "User not logged in",
      });
    } catch (err: any) {
      newResults.push({
        name: "Auth Session",
        status: "error",
        message: "Could not read session",
        details: err?.message || "Unknown error",
      });
    }
    setResults([...newResults]);

    // Test 6: Stored auth cookie
    const storedSession = await hasStoredSession();
    newResults.push({
      name: "Stored Session Token",
      status: storedSession ? "success" : "warning",
      message: storedSession ? "Auth token found in secure storage" : "No stored token",
      details: storedSession ? "Token present in SecureStore" : "User may need to sign in",
    });
    setResults([...newResults]);

    // Test 7: App info
    newResults.push({
      name: "App Info",
      status: "success",
      message: `${Application.applicationName || "Unknown App"}`,
      details: `Bundle: ${Application.applicationId || "unknown"}\nVersion: ${Application.nativeApplicationVersion || "unknown"}\nBuild: ${Application.nativeBuildVersion || "unknown"}\nPlatform: ${Platform.OS}`,
    });
    setResults([...newResults]);

    setIsRunning(false);
  };

  const handleForceSignOut = () => {
    Alert.alert(
      "Force Sign Out",
      "This will clear your session, profile cache, and stored tokens. You will need to sign in again. Use this to test the sign-in/create-account flow.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear & Sign Out",
          style: "destructive",
          onPress: async () => {
            setIsClearingSession(true);
            try {
              // Sign out from Better Auth first (clears server session)
              await authClient.signOut().catch(() => {});
              // Then force-clear all local storage
              await forceSignOut();
              // Navigate to welcome
              router.replace("/welcome");
            } catch (err) {
              console.log("[Diagnostics] Force sign-out error:", err);
              // Even on error, navigate to welcome
              router.replace("/welcome");
            } finally {
              setIsClearingSession(false);
            }
          },
        },
      ]
    );
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle size={20} color="#22c55e" />;
      case "error":
        return <XCircle size={20} color="#ef4444" />;
      case "warning":
        return <AlertTriangle size={20} color="#f59e0b" />;
      default:
        return <ActivityIndicator size="small" color="#64748b" />;
    }
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
          contentContainerStyle={{
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 20,
          }}
        >
          {/* Header */}
          <View className="px-5 mb-6 flex-row items-center">
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center"
            >
              <ChevronLeft size={24} color="#f59e0b" />
            </Pressable>
            <Text className="text-white text-xl font-bold ml-4">Diagnostics</Text>
          </View>

          <View className="px-5">
            {/* Current Session Card */}
            <View className="bg-slate-800/60 rounded-2xl p-4 mb-4 border border-slate-700/50">
              <View className="flex-row items-center mb-3">
                <Server size={18} color="#f59e0b" />
                <Text className="text-amber-500 font-semibold ml-2">Current Session</Text>
              </View>
              <View className="space-y-2">
                <View>
                  <Text className="text-slate-400 text-xs">Signed in as:</Text>
                  <Text className="text-white text-sm font-medium">
                    {user?.email ?? "Not signed in"}
                  </Text>
                </View>
                <View className="mt-2">
                  <Text className="text-slate-400 text-xs">API Base URL:</Text>
                  <Text className="text-white text-sm font-mono" selectable>{BACKEND_URL}</Text>
                </View>
                <View className="mt-2">
                  <Text className="text-slate-400 text-xs">Build:</Text>
                  <Text className="text-white text-sm">
                    {Application.nativeApplicationVersion} ({Application.nativeBuildVersion}) · {Platform.OS}
                  </Text>
                </View>
              </View>
            </View>

            {/* Force Sign Out — top action for TestFlight testing */}
            <View className="bg-red-500/10 rounded-2xl p-4 mb-4 border border-red-500/30">
              <View className="flex-row items-center mb-2">
                <LogOut size={18} color="#ef4444" />
                <Text className="text-red-400 font-semibold ml-2">TestFlight Testing</Text>
              </View>
              <Text className="text-slate-400 text-sm mb-4">
                Use this to test sign-in/create-account from scratch. Clears all stored tokens and profile data so the app starts as if freshly installed.
              </Text>
              <Pressable
                onPress={handleForceSignOut}
                disabled={isClearingSession}
                className="bg-red-500/20 border border-red-500/50 rounded-xl p-3 flex-row items-center justify-center active:opacity-70"
              >
                {isClearingSession ? (
                  <>
                    <ActivityIndicator size="small" color="#ef4444" />
                    <Text className="text-red-400 font-semibold ml-2">Clearing Session...</Text>
                  </>
                ) : (
                  <>
                    <Trash2 size={18} color="#ef4444" />
                    <Text className="text-red-400 font-semibold ml-2">Force Sign Out & Clear All Data</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Server Health Data (if available) */}
            {healthData && (
              <View className="bg-emerald-900/30 rounded-2xl p-4 mb-4 border border-emerald-700/50">
                <View className="flex-row items-center mb-3">
                  <Database size={18} color="#10b981" />
                  <Text className="text-emerald-400 font-semibold ml-2">Server Environment</Text>
                </View>
                <View className="space-y-2">
                  <View>
                    <Text className="text-slate-400 text-xs">Environment Name:</Text>
                    <Text className="text-white text-sm font-mono" selectable>{healthData.envName}</Text>
                  </View>
                  <View className="mt-2">
                    <Text className="text-slate-400 text-xs">Server API URL:</Text>
                    <Text className="text-white text-sm font-mono" selectable>{healthData.apiBaseUrl}</Text>
                  </View>
                  <View className="mt-2">
                    <Text className="text-slate-400 text-xs">Runtime:</Text>
                    <Text className="text-white text-sm">{healthData.build?.runtime} ({healthData.build?.nodeVersion})</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Run Diagnostics Button */}
            <Pressable
              onPress={runDiagnostics}
              disabled={isRunning}
              className={`rounded-2xl p-4 flex-row items-center justify-center mb-4 ${
                isRunning ? "bg-slate-700" : "bg-amber-500"
              }`}
            >
              {isRunning ? (
                <>
                  <ActivityIndicator size="small" color="#f59e0b" />
                  <Text className="text-white font-bold ml-2">Running Tests...</Text>
                </>
              ) : (
                <>
                  <RefreshCw size={20} color="#0f172a" />
                  <Text className="text-slate-900 font-bold ml-2">Run Diagnostics</Text>
                </>
              )}
            </Pressable>

            {/* Test Results */}
            {results.length > 0 && (
              <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden mb-4">
                <View className="px-4 py-3 border-b border-slate-700/50">
                  <View className="flex-row items-center">
                    <Wifi size={18} color="#f59e0b" />
                    <Text className="text-amber-500 font-semibold ml-2">Test Results</Text>
                  </View>
                </View>
                {results.map((result, index) => (
                  <View
                    key={index}
                    className={`px-4 py-3 ${
                      index < results.length - 1 ? "border-b border-slate-700/30" : ""
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-white font-medium flex-1">{result.name}</Text>
                      {getStatusIcon(result.status)}
                    </View>
                    <Text className="text-slate-400 text-sm mt-1">{result.message}</Text>
                    {result.details && (
                      <Text
                        className="text-slate-500 text-xs mt-1 font-mono"
                        selectable
                        numberOfLines={4}
                      >
                        {result.details}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Instructions */}
            <View className="bg-blue-500/10 rounded-2xl p-4 border border-blue-500/30">
              <Text className="text-blue-400 font-semibold mb-2">How to test sign-in flow</Text>
              <Text className="text-slate-400 text-sm leading-relaxed">
                1. Tap "Force Sign Out & Clear All Data" above{"\n"}
                2. App will navigate to the Welcome screen{"\n"}
                3. Tap "Create Account" or "Sign In" to test the full onboarding flow{"\n"}
                4. Run diagnostics to verify backend connectivity if issues persist
              </Text>
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
