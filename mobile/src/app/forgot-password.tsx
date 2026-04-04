/**
 * Forgot Password Screen
 * Uses custom password reset flow with 6-digit code verification.
 * Calls /api/password-reset/request to generate a code,
 * then /api/password-reset/verify to reset the password.
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
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useState, useRef } from "react";
import {
  ChevronLeft,
  Mail,
  AlertCircle,
  CheckCircle2,
  Key,
  Lock,
  ShieldCheck,
} from "lucide-react-native";
import { api } from "@/lib/api";

type ResetStep = "email" | "code" | "new-password" | "success";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverCode, setServerCode] = useState<string | null>(null);

  const validateEmail = (): string | null => {
    if (!email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email";
    return null;
  };

  const handleRequestReset = async () => {
    const validationError = validateEmail();
    if (validationError) {
      setError(validationError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      console.log("[ForgotPassword] Requesting reset for:", trimmedEmail);

      const data = await api.post<{
        success?: boolean;
        resetCode?: string;
        message?: string;
        error?: string;
      }>("/api/password-reset/request", {
        email: trimmedEmail,
      });

      console.log("[ForgotPassword] Reset request response:", data?.success);

      if (data?.resetCode) {
        // In dev/testing, the code is returned directly
        setServerCode(data.resetCode);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("code");
    } catch (err: unknown) {
      console.log("[ForgotPassword] Exception:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to send reset request";
      setError(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyAndReset = async () => {
    if (!resetCode.trim() || resetCode.trim().length !== 6) {
      setError("Please enter the 6-digit code");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const trimmedEmail = email.trim().toLowerCase();
      console.log("[ForgotPassword] Verifying reset code for:", trimmedEmail);

      const data = await api.post<{
        success?: boolean;
        message?: string;
        error?: string;
      }>("/api/password-reset/verify", {
        email: trimmedEmail,
        code: resetCode.trim(),
        newPassword,
      });

      console.log("[ForgotPassword] Password reset successful");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("success");
    } catch (err: unknown) {
      console.log("[ForgotPassword] Verify exception:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to reset password";
      setError(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
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
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View className="px-5 flex-row items-center mb-8">
              <Pressable
                onPress={() => router.back()}
                className="w-10 h-10 rounded-full bg-slate-800/60 items-center justify-center active:opacity-70"
              >
                <ChevronLeft size={24} color="#f59e0b" />
              </Pressable>
            </View>

            <View className="px-6">
              {/* Title */}
              <Animated.View entering={FadeInDown.duration(600).delay(100)}>
                <View className="items-center mb-8">
                  <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                    {step === "success" ? (
                      <CheckCircle2 size={32} color="#22c55e" />
                    ) : step === "code" || step === "new-password" ? (
                      <ShieldCheck size={32} color="#f59e0b" />
                    ) : (
                      <Key size={32} color="#f59e0b" />
                    )}
                  </View>
                  <Text className="text-white text-3xl font-bold text-center">
                    {step === "email" && "Reset Password"}
                    {step === "code" && "Enter Code"}
                    {step === "new-password" && "New Password"}
                    {step === "success" && "Password Reset"}
                  </Text>
                  <Text className="text-slate-400 text-center mt-2">
                    {step === "email" && "Enter your email to receive a reset code"}
                    {step === "code" && "Enter the 6-digit code and your new password"}
                    {step === "new-password" && "Choose a new password"}
                    {step === "success" && "Your password has been reset successfully"}
                  </Text>
                </View>
              </Animated.View>

              {/* Error Message */}
              {error && step !== "success" && (
                <Animated.View
                  entering={FadeInDown.duration(300)}
                  className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 mb-6 flex-row items-center"
                >
                  <AlertCircle size={20} color="#ef4444" />
                  <Text className="text-red-400 font-medium ml-3 flex-1">
                    {error}
                  </Text>
                </Animated.View>
              )}

              {/* Step 1: Email Input */}
              {step === "email" && (
                <>
                  <Animated.View
                    entering={FadeInDown.duration(600).delay(200)}
                    className="mb-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">
                      Email
                    </Text>
                    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                      <View className="flex-row items-center px-4">
                        <Mail size={20} color="#64748b" />
                        <TextInput
                          value={email}
                          onChangeText={(text) => {
                            setEmail(text);
                            setError(null);
                          }}
                          placeholder="pilot@email.com"
                          placeholderTextColor="#64748b"
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          textContentType="emailAddress"
                          autoComplete="email"
                          className="flex-1 text-white text-lg py-4 ml-3"
                          editable={!isLoading}
                        />
                      </View>
                    </View>
                  </Animated.View>

                  <Animated.View entering={FadeInUp.duration(600).delay(300)}>
                    <Pressable
                      onPress={handleRequestReset}
                      disabled={isLoading}
                      className={`rounded-2xl p-4 items-center ${
                        isLoading ? "bg-amber-500/50" : "bg-amber-500"
                      }`}
                      style={({ pressed }) => ({
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      {isLoading ? (
                        <View className="flex-row items-center">
                          <ActivityIndicator color="#0f172a" size="small" />
                          <Text className="text-slate-900 text-lg font-bold ml-2">
                            Sending...
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-slate-900 text-lg font-bold">
                          Send Reset Code
                        </Text>
                      )}
                    </Pressable>
                  </Animated.View>

                  <Animated.View
                    entering={FadeInUp.duration(600).delay(400)}
                    className="mt-6"
                  >
                    <Pressable
                      onPress={() => router.back()}
                      className="active:opacity-70"
                      disabled={isLoading}
                    >
                      <Text className="text-slate-400 text-center">
                        Remember your password?{" "}
                        <Text className="text-amber-500 font-semibold">Sign In</Text>
                      </Text>
                    </Pressable>
                  </Animated.View>
                </>
              )}

              {/* Step 2: Code + New Password */}
              {step === "code" && (
                <>
                  {/* Show the code hint in dev/testing */}
                  {serverCode && (
                    <Animated.View
                      entering={FadeInDown.duration(300)}
                      className="bg-amber-500/20 border border-amber-500/50 rounded-2xl p-4 mb-6"
                    >
                      <Text className="text-amber-400 font-medium text-center">
                        Your reset code: {serverCode}
                      </Text>
                      <Text className="text-amber-400/70 text-xs text-center mt-1">
                        (Shown here since email delivery is not configured)
                      </Text>
                    </Animated.View>
                  )}

                  <Animated.View
                    entering={FadeInDown.duration(600).delay(100)}
                    className="mb-4"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">
                      6-Digit Code
                    </Text>
                    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                      <View className="flex-row items-center px-4">
                        <ShieldCheck size={20} color="#64748b" />
                        <TextInput
                          value={resetCode}
                          onChangeText={(text) => {
                            setResetCode(text.replace(/[^0-9]/g, "").slice(0, 6));
                            setError(null);
                          }}
                          placeholder="123456"
                          placeholderTextColor="#64748b"
                          keyboardType="number-pad"
                          maxLength={6}
                          className="flex-1 text-white text-lg py-4 ml-3 tracking-[8px] text-center"
                          editable={!isLoading}
                        />
                      </View>
                    </View>
                  </Animated.View>

                  <Animated.View
                    entering={FadeInDown.duration(600).delay(200)}
                    className="mb-4"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">
                      New Password
                    </Text>
                    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                      <View className="flex-row items-center px-4">
                        <Lock size={20} color="#64748b" />
                        <TextInput
                          value={newPassword}
                          onChangeText={(text) => {
                            setNewPassword(text);
                            setError(null);
                          }}
                          placeholder="New password (min 6 chars)"
                          placeholderTextColor="#64748b"
                          secureTextEntry
                          textContentType="newPassword"
                          className="flex-1 text-white text-lg py-4 ml-3"
                          editable={!isLoading}
                        />
                      </View>
                    </View>
                  </Animated.View>

                  <Animated.View
                    entering={FadeInDown.duration(600).delay(300)}
                    className="mb-6"
                  >
                    <Text className="text-slate-400 text-sm font-semibold mb-2 uppercase tracking-wider">
                      Confirm Password
                    </Text>
                    <View className="bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden">
                      <View className="flex-row items-center px-4">
                        <Lock size={20} color="#64748b" />
                        <TextInput
                          value={confirmPassword}
                          onChangeText={(text) => {
                            setConfirmPassword(text);
                            setError(null);
                          }}
                          placeholder="Confirm new password"
                          placeholderTextColor="#64748b"
                          secureTextEntry
                          textContentType="newPassword"
                          className="flex-1 text-white text-lg py-4 ml-3"
                          editable={!isLoading}
                        />
                      </View>
                    </View>
                  </Animated.View>

                  <Animated.View entering={FadeInUp.duration(600).delay(400)}>
                    <Pressable
                      onPress={handleVerifyAndReset}
                      disabled={isLoading}
                      className={`rounded-2xl p-4 items-center ${
                        isLoading ? "bg-amber-500/50" : "bg-amber-500"
                      }`}
                      style={({ pressed }) => ({
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      {isLoading ? (
                        <View className="flex-row items-center">
                          <ActivityIndicator color="#0f172a" size="small" />
                          <Text className="text-slate-900 text-lg font-bold ml-2">
                            Resetting...
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-slate-900 text-lg font-bold">
                          Reset Password
                        </Text>
                      )}
                    </Pressable>
                  </Animated.View>

                  <Animated.View
                    entering={FadeInUp.duration(600).delay(500)}
                    className="mt-4"
                  >
                    <Pressable
                      onPress={() => {
                        setStep("email");
                        setResetCode("");
                        setNewPassword("");
                        setConfirmPassword("");
                        setError(null);
                        setServerCode(null);
                      }}
                      className="active:opacity-70"
                      disabled={isLoading}
                    >
                      <Text className="text-slate-400 text-center">
                        Didn't get the code?{" "}
                        <Text className="text-amber-500 font-semibold">Try Again</Text>
                      </Text>
                    </Pressable>
                  </Animated.View>
                </>
              )}

              {/* Step 3: Success */}
              {step === "success" && (
                <>
                  <Animated.View
                    entering={FadeInDown.duration(300)}
                    className="bg-green-500/20 border border-green-500/50 rounded-2xl p-4 mb-6"
                  >
                    <Text className="text-green-400 font-medium text-center">
                      Your password has been reset successfully.
                    </Text>
                    <Text className="text-green-400/70 text-sm text-center mt-2">
                      You can now sign in with your new password.
                    </Text>
                  </Animated.View>

                  <Animated.View entering={FadeInUp.duration(600).delay(200)}>
                    <Pressable
                      onPress={() => router.replace("/sign-in")}
                      className="rounded-2xl p-4 items-center bg-amber-500"
                      style={({ pressed }) => ({
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      <Text className="text-slate-900 text-lg font-bold">
                        Go to Sign In
                      </Text>
                    </Pressable>
                  </Animated.View>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}
