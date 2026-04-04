/**
 * Sign In Screen
 * Uses Better Auth (Vibecode Cloud) for email/password login
 */

import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, Mail, Lock, Eye, EyeOff, AlertCircle, Plane, CheckCircle, RefreshCw } from "lucide-react-native";
import { useAuth } from "@/lib/BetterAuthProvider";
import { api } from "@/lib/api";

// Max time to wait for profile before showing retry (20 seconds)
const PROFILE_WAIT_TIMEOUT_MS = 20000;
// Default server-side rate-limit wait (when server doesn't include a retry-after).
const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 5 * 60;

function extractRetryAfterSeconds(message: string): number | null {
  const lower = message.toLowerCase();

  // Examples we might see:
  // "Retry after 300 seconds"
  // "Retry-After: 2 minutes"
  // "Try again in 5 minutes"
  // "Please wait 120 seconds"
  const retryAfterMatch = lower.match(/retry[-\s]?after[^0-9]*([0-9]+)\s*(seconds?|secs?|minutes?|mins?)/);
  if (retryAfterMatch) {
    const value = Number(retryAfterMatch[1]);
    const unit = retryAfterMatch[2];
    if (!Number.isFinite(value)) return null;
    const isMinutes = unit.startsWith("min");
    return isMinutes ? value * 60 : value;
  }

  const retryAfterDigitsOnlyMatch = lower.match(/retry[-\s]?after[^0-9]*([0-9]+)/);
  if (retryAfterDigitsOnlyMatch) {
    const value = Number(retryAfterDigitsOnlyMatch[1]);
    if (Number.isFinite(value)) return value;
  }

  const tryAgainMatch = lower.match(/try again in[^0-9]*([0-9]+)\s*(seconds?|secs?|minutes?|mins?)/);
  if (tryAgainMatch) {
    const value = Number(tryAgainMatch[1]);
    const unit = tryAgainMatch[2];
    if (!Number.isFinite(value)) return null;
    const isMinutes = unit.startsWith("min");
    return isMinutes ? value * 60 : value;
  }

  const pleaseWaitMatch = lower.match(/please wait[^0-9]*([0-9]+)\s*(seconds?|secs?|minutes?|mins?)/);
  if (pleaseWaitMatch) {
    const value = Number(pleaseWaitMatch[1]);
    const unit = pleaseWaitMatch[2];
    if (!Number.isFinite(value)) return null;
    const isMinutes = unit.startsWith("min");
    return isMinutes ? value * 60 : value;
  }

  return null;
}

function formatSecondsMMSS(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { new: isNewParam, email: emailParam } = useLocalSearchParams<{ new?: string; email?: string }>();
  const { signIn, isProfileReady, profileError, retryProfileLoad, requestSignOutForSwitch } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  const isNewAccountFlow = isNewParam === "1";

  const [email, setEmail] = useState(emailParam ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnectionError, setIsConnectionError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Signing In...");
  const [rateLimitUntilMs, setRateLimitUntilMs] = useState<number | null>(null);
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number>(0);
  const [isWaitingForProfile, setIsWaitingForProfile] = useState(false);
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  const waitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchDoneRef = useRef(false);

  // If opened via pilotpaytracker://sign-in?new=1, sign out cached user so
  // the new user can log in fresh.
  useEffect(() => {
    if (isNewAccountFlow && !switchDoneRef.current) {
      switchDoneRef.current = true;
      requestSignOutForSwitch().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proactively ping the backend on mount to warm it up so it's ready when the user logs in
  useEffect(() => {
    api.get("/health", 5000).catch(() => {});
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (waitTimeoutRef.current) {
        clearTimeout(waitTimeoutRef.current);
      }
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  // Rate-limit countdown tick (only active when the server tells us to wait).
  useEffect(() => {
    if (rateLimitUntilMs == null) return;

    const interval = setInterval(() => {
      const msLeft = rateLimitUntilMs - Date.now();
      const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
      setRateLimitSecondsLeft(secondsLeft);

      if (secondsLeft <= 0) {
        setRateLimitUntilMs(null);
        setRateLimitSecondsLeft(0);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [rateLimitUntilMs]);

  const isRateLimitActive = rateLimitUntilMs != null && Date.now() < rateLimitUntilMs;

  // Set a timeout when waiting for profile - show retry button if it takes too long
  useEffect(() => {
    if (isWaitingForProfile && !isProfileReady && !profileError) {
      console.log("[SignIn] Starting profile wait timeout...");
      waitTimeoutRef.current = setTimeout(() => {
        console.log("[SignIn] Profile wait timed out, showing retry");
        setWaitTimedOut(true);
      }, PROFILE_WAIT_TIMEOUT_MS);

      return () => {
        if (waitTimeoutRef.current) {
          clearTimeout(waitTimeoutRef.current);
        }
      };
    }
  }, [isWaitingForProfile, isProfileReady, profileError]);

  // Clear timeout when profile is ready
  useEffect(() => {
    if (isWaitingForProfile && isProfileReady) {
      console.log("[SignIn] Profile ready, clearing timeout");
      if (waitTimeoutRef.current) {
        clearTimeout(waitTimeoutRef.current);
      }
    }
  }, [isWaitingForProfile, isProfileReady]);

  // Safety net: if waiting for profile but no progress after 8s, retry profile load
  useEffect(() => {
    if (isWaitingForProfile && !isProfileReady && !profileError && !waitTimedOut) {
      const safetyTimer = setTimeout(async () => {
        console.log("[SignIn] Safety net: retrying profile load...");
        await retryProfileLoad();
      }, 8000);
      return () => clearTimeout(safetyTimer);
    }
  }, [isWaitingForProfile, isProfileReady, profileError, waitTimedOut, retryProfileLoad]);

  const handleSignIn = async () => {
    if (isRateLimitActive) return;
    // Validate
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    if (!trimmedEmail) {
      setError("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email");
      return;
    }
    if (!trimmedPassword) {
      setError("Password is required");
      return;
    }

    setError(null);
    setIsConnectionError(false);
    setRateLimitUntilMs(null);
    setRateLimitSecondsLeft(0);
    setIsLoading(true);
    setLoadingMessage("Signing In...");

    // Update loading message after 5s to indicate retrying
    loadingTimerRef.current = setTimeout(() => {
      setLoadingMessage("Connecting...");
    }, 5000);
    // Update again after 15s
    const longLoadTimer = setTimeout(() => {
      setLoadingMessage("Server starting up...");
    }, 15000);
    const veryLongLoadTimer = setTimeout(() => {
      setLoadingMessage("Almost there...");
    }, 30000);

    try {
      console.log("[SignIn] Attempting sign in for:", trimmedEmail);
      const { error: signInError } = await signIn(trimmedEmail, trimmedPassword);

      if (signInError) {
        console.log("[SignIn] Error:", signInError.message);
        clearTimeout(longLoadTimer);
        clearTimeout(veryLongLoadTimer);
        if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);

        // Map common errors to user-friendly messages
        const msg = signInError.message.toLowerCase();
        let displayError: string;

        if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials") || msg.includes("invalid email or password")) {
          displayError = "Invalid email or password";
        } else if (msg.includes("invalid email")) {
          displayError = "Please enter a valid email address";
        } else if (msg.includes("email not confirmed")) {
          displayError = "Please check your email to confirm your account";
        } else if (msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("429")) {
          const retrySeconds = extractRetryAfterSeconds(signInError.message) ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS;
          setRateLimitUntilMs(Date.now() + retrySeconds * 1000);
          setRateLimitSecondsLeft(retrySeconds);
          displayError = "Too many attempts. Please wait before trying again.";
        } else if (msg.includes("network") || msg.includes("fetch") || msg.includes("connection")) {
          displayError = "Connection error. Please check your internet and try again.";
        } else if (
          msg.includes("502") || msg.includes("503") || msg.includes("504") ||
          msg.includes("bad gateway") || msg.includes("service unavailable") ||
          msg.includes("gateway timeout")
        ) {
          setIsConnectionError(true);
          displayError = "Server is temporarily unavailable. Please try again.";
        } else if (msg.includes("500") || msg.includes("internal server")) {
          displayError = "A server error occurred. Please try again.";
        } else if (msg.includes("sign in failed") || msg.includes("failed")) {
          displayError = "Sign in failed. Please check your credentials and try again.";
        } else {
          displayError = signInError.message;
        }

        setError(displayError);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setIsLoading(false);
        return;
      }

      // Success - Start waiting for profile to be ready
      console.log("[SignIn] Success! Waiting for profile...");
      clearTimeout(longLoadTimer);
      clearTimeout(veryLongLoadTimer);
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      setIsWaitingForProfile(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      console.log("[SignIn] Exception:", err);
      clearTimeout(longLoadTimer);
      clearTimeout(veryLongLoadTimer);
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      const rawMessage = err instanceof Error ? err.message.toLowerCase() : "";
      let errorMessage: string;
      if (
        rawMessage.includes("network") ||
        rawMessage.includes("fetch") ||
        rawMessage.includes("connection") ||
        rawMessage.includes("failed to fetch") ||
        rawMessage.includes("networkerror") ||
        rawMessage.includes("timeout") ||
        rawMessage.includes("econnrefused") ||
        rawMessage.includes("aborted")
      ) {
        setIsConnectionError(true);
        errorMessage = "Unable to connect to server. Please check your internet and try again.";
      } else {
        errorMessage = err instanceof Error ? err.message : "Sign in failed. Please try again.";
      }
      setError(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle profile error while waiting
  const handleRetryProfile = async () => {
    setError(null);
    setWaitTimedOut(false);
    // Reset the timeout
    if (waitTimeoutRef.current) {
      clearTimeout(waitTimeoutRef.current);
    }
    waitTimeoutRef.current = setTimeout(() => {
      console.log("[SignIn] Retry profile wait timed out");
      setWaitTimedOut(true);
    }, PROFILE_WAIT_TIMEOUT_MS);
    await retryProfileLoad();
  };

  // Handle connection error retry - immediately re-attempt sign-in
  const handleConnectionRetry = useCallback(() => {
    setError(null);
    setIsConnectionError(false);
    handleSignIn();
  }, [email, password]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine if we should show error state (either explicit error or timeout)
  const showErrorState = profileError || waitTimedOut;
  const errorMessage = profileError || "Taking too long to load your profile. Please check your connection and try again.";

  // Show waiting screen while profile is loading after successful auth
  if (isWaitingForProfile) {
    return (
      <View className="flex-1 bg-slate-950">
        <LinearGradient
          colors={["#0f172a", "#1e3a5a", "#0f172a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }}
        >
          {showErrorState ? (
            // Profile failed to load or timed out - show retry option
            <View className="items-center">
              <View className="w-16 h-16 rounded-full bg-red-500/20 items-center justify-center mb-4">
                <AlertCircle size={32} color="#ef4444" />
              </View>
              <Text className="text-white text-xl font-bold text-center mb-2">
                Setup Failed
              </Text>
              <Text className="text-slate-400 text-center mb-6">
                {errorMessage}
              </Text>
              <Pressable
                onPress={handleRetryProfile}
                className="bg-amber-500 rounded-2xl px-8 py-4 active:opacity-80"
              >
                <Text className="text-slate-900 text-lg font-bold">Try Again</Text>
              </Pressable>
            </View>
          ) : (
            // Loading profile
            <View className="items-center">
              <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                <Plane size={32} color="#f59e0b" />
              </View>
              <Text className="text-white text-xl font-bold text-center mb-2">
                Setting Up Your Account
              </Text>
              <Text className="text-slate-400 text-center mb-6">
                Just a moment...
              </Text>
              <ActivityIndicator size="large" color="#f59e0b" />
            </View>
          )}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 20,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Back Button */}
            <View className="px-5 mb-8">
              <Pressable
                onPress={() => router.replace("/welcome")}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
            </View>

            <View className="px-6">
              {/* Header */}
              <View className="items-center mb-8">
                <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                  <Plane size={32} color="#f59e0b" />
                </View>
                {isNewAccountFlow ? (
                  <>
                    <Text className="text-white text-3xl font-bold">Account created!</Text>
                    <Text className="text-slate-400 mt-2 text-center text-base">
                      Sign in with your new credentials to get started
                    </Text>
                  </>
                ) : (
                  <>
                    <Text className="text-white text-3xl font-bold">Welcome back</Text>
                    <Text className="text-slate-400 mt-2 text-center text-base">
                      Log in to track, audit, and verify your pay
                    </Text>
                  </>
                )}
              </View>

              {/* New-account success badge */}
              {isNewAccountFlow && (
                <View className="bg-green-500/10 border border-green-500/25 rounded-2xl p-4 mb-6 flex-row items-center">
                  <CheckCircle size={20} color="#22c55e" />
                  <Text className="text-green-400 font-medium ml-3 flex-1">
                    7-day free trial started — sign in to begin
                  </Text>
                </View>
              )}

              {/* Error */}
              {error && (
                <View className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 mb-6">
                  <View className="flex-row items-center">
                    <AlertCircle size={20} color="#ef4444" />
                    <Text className="text-red-400 font-medium ml-3 flex-1">{error}</Text>
                    {isRateLimitActive && (
                      <Text className="text-red-300 font-semibold ml-3">
                        Try again in {formatSecondsMMSS(rateLimitSecondsLeft)}
                      </Text>
                    )}
                  </View>
                  {isConnectionError && !isRateLimitActive && (
                    <Pressable
                      onPress={handleConnectionRetry}
                      className="mt-3 bg-red-500/30 rounded-xl py-2 px-4 flex-row items-center justify-center active:opacity-70"
                    >
                      <RefreshCw size={14} color="#f87171" />
                      <Text className="text-red-300 font-semibold ml-2 text-sm">Retry Connection</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Email */}
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase">Email</Text>
                <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50">
                  <View className="flex-row items-center px-4">
                    <Mail size={20} color="#64748b" />
                    <TextInput
                      value={email}
                      onChangeText={(t) => { setEmail(t); setError(null); }}
                      placeholder="pilot@email.com"
                      placeholderTextColor="#64748b"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      textContentType="emailAddress"
                      autoComplete="email"
                      className="flex-1 text-white text-lg py-4 ml-3"
                      editable={!isLoading}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </View>
                </View>
              </View>

              {/* Password */}
              <View className="mb-8">
                <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase">Password</Text>
                <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50">
                  <View className="flex-row items-center px-4">
                    <Lock size={20} color="#64748b" />
                    <TextInput
                      ref={passwordRef}
                      value={password}
                      onChangeText={(t) => { setPassword(t); setError(null); }}
                      placeholder="Enter password"
                      placeholderTextColor="#64748b"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="password"
                      autoComplete="password"
                      className="flex-1 text-white text-lg py-4 ml-3"
                      editable={!isLoading}
                      onSubmitEditing={handleSignIn}
                      returnKeyType="go"
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} className="p-2">
                      {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Sign In Button */}
              <Pressable
                onPress={handleSignIn}
                disabled={isLoading || isRateLimitActive}
                className={`rounded-2xl p-4 items-center ${isLoading || isRateLimitActive ? "bg-amber-500/50" : "bg-amber-500"}`}
              >
                {isRateLimitActive ? (
                  <Text className="text-slate-900 text-lg font-bold">
                    Try again in {formatSecondsMMSS(rateLimitSecondsLeft)}
                  </Text>
                ) : isLoading ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator color="#0f172a" size="small" />
                    <Text className="text-slate-900 text-lg font-bold ml-2">{loadingMessage}</Text>
                  </View>
                ) : (
                  <Text className="text-slate-900 text-lg font-bold">Log In</Text>
                )}
              </Pressable>

              {/* Links */}
              <Pressable onPress={() => router.replace("/forgot-password")} disabled={isLoading || isRateLimitActive} className="mt-4">
                <Text className="text-amber-500 text-center font-medium">Forgot Password?</Text>
              </Pressable>

              <Pressable onPress={() => router.replace("/create-account")} disabled={isLoading} className="mt-4">
                <Text className="text-slate-400 text-center">
                  Don't have an account? <Text className="text-amber-500 font-semibold">Create Account</Text>
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}
