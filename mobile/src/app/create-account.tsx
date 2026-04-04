/**
 * Create Account Screen
 * Uses Better Auth (Vibecode Cloud) for email/password signup
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
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useState, useRef, useEffect } from "react";
import { ChevronLeft, Mail, Lock, Eye, EyeOff, AlertCircle, Plane } from "lucide-react-native";
import { useAuth } from "@/lib/BetterAuthProvider";

// Max time to wait for profile before showing retry (20 seconds)
const PROFILE_WAIT_TIMEOUT_MS = 20000;

export default function CreateAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, isProfileReady, profileError, retryProfileLoad } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWaitingForProfile, setIsWaitingForProfile] = useState(false);
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  const waitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (waitTimeoutRef.current) {
        clearTimeout(waitTimeoutRef.current);
      }
    };
  }, []);

  // Set a timeout when waiting for profile - show retry button if it takes too long
  useEffect(() => {
    if (isWaitingForProfile && !isProfileReady && !profileError) {
      console.log("[CreateAccount] Starting profile wait timeout...");
      waitTimeoutRef.current = setTimeout(() => {
        console.log("[CreateAccount] Profile wait timed out, showing retry");
        setWaitTimedOut(true);
      }, PROFILE_WAIT_TIMEOUT_MS);

      return () => {
        if (waitTimeoutRef.current) {
          clearTimeout(waitTimeoutRef.current);
        }
      };
    }
  }, [isWaitingForProfile, isProfileReady, profileError]);

  // Clear timeout and redirect when profile is ready
  useEffect(() => {
    if (isWaitingForProfile && isProfileReady) {
      console.log("[CreateAccount] Profile ready, clearing timeout");
      if (waitTimeoutRef.current) {
        clearTimeout(waitTimeoutRef.current);
      }
    }
  }, [isWaitingForProfile, isProfileReady]);

  // Safety net: if waiting for profile but no progress after 8s, retry profile load
  useEffect(() => {
    if (isWaitingForProfile && !isProfileReady && !profileError && !waitTimedOut) {
      const safetyTimer = setTimeout(async () => {
        console.log("[CreateAccount] Safety net: retrying profile load...");
        await retryProfileLoad();
      }, 8000);
      return () => clearTimeout(safetyTimer);
    }
  }, [isWaitingForProfile, isProfileReady, profileError, waitTimedOut, retryProfileLoad]);

  const handleCreateAccount = async () => {
    // Validate
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email");
      return;
    }
    if (!password) {
      setError("Password is required");
      return;
    }
    const trimmedPassword = password.trim();
    if (trimmedPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (trimmedPassword !== confirmPassword.trim()) {
      setError("Passwords do not match");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      console.log("[CreateAccount] Attempting signup for:", trimmedEmail);
      const { error: signUpError } = await signUp(trimmedEmail, trimmedPassword);

      if (signUpError) {
        console.log("[CreateAccount] Signup error:", signUpError.message);

        // Map common errors to user-friendly messages
        const msg = signUpError.message.toLowerCase();
        const status = (signUpError as any)?.status as number | undefined;
        let displayError: string;

        if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("duplicate")) {
          displayError = "An account with this email already exists";
        } else if (msg.includes("weak password") || msg.includes("password")) {
          displayError = "Please choose a stronger password (at least 6 characters)";
        } else if (msg.includes("invalid email")) {
          displayError = "Please enter a valid email address";
        } else if (
          status === 429 ||
          msg.includes("rate limit") ||
          msg.includes("too many") ||
          msg.includes("429") ||
          msg.includes("email rate")
        ) {
          displayError = "Too many sign-up attempts. Please wait a few minutes and try again.";
        } else if (msg.includes("network") || msg.includes("fetch") || msg.includes("connection")) {
          displayError = "Connection error. Please check your internet and try again.";
        } else {
          displayError = signUpError.message;
        }

        setError(displayError);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setIsLoading(false);
        return;
      }

      // Success - Start waiting for profile to be ready
      console.log("[CreateAccount] Signup successful! Waiting for profile...");
      setIsWaitingForProfile(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      console.log("[CreateAccount] Signup exception:", err);
      const errorMessage = err instanceof Error ? err.message : "Account creation failed. Please try again.";
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
      console.log("[CreateAccount] Retry profile wait timed out");
      setWaitTimedOut(true);
    }, PROFILE_WAIT_TIMEOUT_MS);
    await retryProfileLoad();
  };

  // Determine if we should show error state (either explicit error or timeout)
  const showErrorState = profileError || waitTimedOut;
  const errorMessage = profileError || "Taking too long to set up your account. Please check your connection and try again.";

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
                Starting your 7-day trial...
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
                <Text className="text-white text-3xl font-bold">Create your account</Text>
                <Text className="text-slate-400 text-center mt-2 text-base leading-relaxed">
                  Start your 7-day trial and verify your pay using real UPS schedule data
                </Text>
              </View>

              {/* Error */}
              {error && (
                <View className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 mb-6 flex-row items-center">
                  <AlertCircle size={20} color="#ef4444" />
                  <Text className="text-red-400 font-medium ml-3 flex-1">{error}</Text>
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
              <View className="mb-4">
                <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase">Password</Text>
                <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50">
                  <View className="flex-row items-center px-4">
                    <Lock size={20} color="#64748b" />
                    <TextInput
                      ref={passwordRef}
                      value={password}
                      onChangeText={(t) => { setPassword(t); setError(null); }}
                      placeholder="At least 6 characters"
                      placeholderTextColor="#64748b"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="newPassword"
                      autoComplete="new-password"
                      className="flex-1 text-white text-lg py-4 ml-3"
                      editable={!isLoading}
                      returnKeyType="next"
                      onSubmitEditing={() => confirmRef.current?.focus()}
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} className="p-2">
                      {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Confirm Password */}
              <View className="mb-8">
                <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase">Confirm Password</Text>
                <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50">
                  <View className="flex-row items-center px-4">
                    <Lock size={20} color="#64748b" />
                    <TextInput
                      ref={confirmRef}
                      value={confirmPassword}
                      onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                      placeholder="Re-enter password"
                      placeholderTextColor="#64748b"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="newPassword"
                      autoComplete="new-password"
                      className="flex-1 text-white text-lg py-4 ml-3"
                      editable={!isLoading}
                      returnKeyType="done"
                      onSubmitEditing={handleCreateAccount}
                    />
                  </View>
                </View>
              </View>

              {/* Create Account Button */}
              <Pressable
                onPress={handleCreateAccount}
                disabled={isLoading}
                className={`rounded-2xl p-4 items-center ${isLoading ? "bg-amber-500/50" : "bg-amber-500"}`}
              >
                {isLoading ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator color="#0f172a" size="small" />
                    <Text className="text-slate-900 text-lg font-bold ml-2">Creating Account...</Text>
                  </View>
                ) : (
                  <Text className="text-slate-900 text-lg font-bold">Start 7-Day Trial</Text>
                )}
              </Pressable>

              {/* Sign In Link */}
              <Pressable onPress={() => router.replace("/sign-in")} disabled={isLoading} className="mt-6">
                <Text className="text-slate-400 text-center">
                  Already have an account? <Text className="text-amber-500 font-semibold">Sign In</Text>
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}
