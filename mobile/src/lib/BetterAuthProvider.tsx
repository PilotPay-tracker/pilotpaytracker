/**
 * Auth Provider (Better Auth)
 *
 * Uses Better Auth (local backend) for authentication.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState, type AppStateStatus, Platform, View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter, useSegments, useRootNavigationState } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { authClient, persistWebSessionToken, clearWebSessionToken, hasStoredSession } from "./authClient";
import { api } from "./api";
import { ensureProfileExists } from "./ensureProfileExists";
import { useProfileStore, useIsProfileComplete, useProfile } from "./state/profile-store";
import { isAppleReviewAccount, resetBypassState } from "./appleReviewBypass";
import { setUserId, logoutUser, isRevenueCatEnabled } from "./revenuecatClient";

// Increased to 25s to handle Apple review / TestFlight slow networks.
// Apple's review infrastructure can add significant latency on first connection.
const AUTH_TIMEOUT_MS = 25000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

interface AuthContextType {
  session: any;
  user: any;
  isAuthenticated: boolean;
  isLoading: boolean;
  isProfileReady: boolean;
  isOptimisticallyAuthenticated: boolean;
  profileError: string | null;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /**
   * Signs out the current user without redirecting to /welcome.
   * Used when opening the app from a web signup to clear a cached
   * session so the new user can sign in fresh.
   */
  requestSignOutForSwitch: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  retryProfileLoad: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isProfileReady: false,
  isOptimisticallyAuthenticated: false,
  profileError: null,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  requestSignOutForSwitch: async () => {},
  resetPassword: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  retryProfileLoad: async () => {},
});

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children?: React.ReactNode;
  appReady: boolean;
}

export function AuthProvider({ children, appReady }: AuthProviderProps) {
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const queryClient = useQueryClient();

  // Direct session check via our API client (avoids @better-auth/expo isPending stuck bug)
  const { data: sessionData, isPending, refetch } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      try {
        // 12 s timeout — Apple review / TestFlight networks can be slow.
        const data = await api.get<{ session: any; user: any } | null>("/api/auth/get-session", 12000);
        return data ?? null;
      } catch (err: any) {
        // For gateway/network errors (backend cold start), THROW so React Query retries
        const status = err?.status as number | undefined;
        const msg = (err?.message ?? "").toLowerCase();
        const isGatewayOrNetwork =
          status === 502 || status === 503 || status === 504 ||
          (!status && (msg.includes("bad gateway") || msg.includes("connection") ||
            msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")));
        if (isGatewayOrNetwork) {
          console.log("[BetterAuth] Session check gateway/network error, will retry:", err?.message);
          throw err; // Let React Query retry with backoff
        }
        // Auth errors / truly no session → return null (not an error)
        return null;
      }
    },
    enabled: appReady,
    staleTime: 1000 * 60 * 5, // 5 min cache
    retry: 2, // Retry gateway/network errors up to 2 times (was 4 — too slow on unreachable backends)
    retryDelay: (attempt: number) => Math.min(1500 * (attempt + 1), 4000), // 1.5s, 3s max
    refetchOnWindowFocus: false,
  });

  // Profile state — initialize isProfileReady from persisted store so it's true immediately
  // on restart if the user was previously logged in with a complete profile
  const [isProfileReady, setIsProfileReady] = useState(() => {
    const stored = useProfileStore.getState();
    return !!stored.profile && stored.isComplete;
  });
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileLoadAttemptedRef = useRef(false);
  // When true, the nav effect skips all redirects until sign-out completes.
  // Set before calling authClient.signOut() during account switching so
  // BetterAuthProvider doesn't race to push the old user to /(tabs).
  const skipNavRedirectRef = useRef(false);

  // Profile store actions
  const setProfile = useProfileStore((s) => s.setProfile);
  const setProfileLoading = useProfileStore((s) => s.setLoading);
  const clearProfile = useProfileStore((s) => s.clearProfile);
  const isProfileDataComplete = useIsProfileComplete();
  const persistedProfile = useProfile();

  const session = appReady ? sessionData?.session ?? null : null;
  const user = appReady ? sessionData?.user ?? null : null;
  const isAuthenticated = appReady ? !!user : false;
  // Treat app-not-ready as loading so we never run routing decisions early.
  const isLoading = !appReady || isPending;

  // Optimistic auth is disabled — always wait for session check before showing content.
  // This prevents unauthenticated users from briefly seeing the dashboard when a
  // persisted profile exists from a previous session.
  const isOptimisticallyAuthenticated = false;

  // Track whether the first navigation decision has been made.
  // We always render children (so the Stack navigator mounts and provides
  // navigationState), but overlay a spinner until both the session check AND
  // the initial routing decision are complete.  This eliminates the race condition
  // where children render at the wrong initial route before the nav effect fires.
  const firstNavRef = useRef(false);
  const [isFirstNavDone, setIsFirstNavDone] = useState(false);

  // Safety timeout: if something goes wrong and the nav effect never fires,
  // remove the overlay after 5 seconds so the app doesn't appear frozen.
  // This is the primary guard against a hung spinner when the backend is
  // unreachable (e.g. TestFlight without EXPO_PUBLIC_BACKEND_URL set).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!firstNavRef.current) {
        firstNavRef.current = true;
        setIsFirstNavDone(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const normalizeAuthError = useCallback((err: unknown, fallbackMessage: string) => {
    if (!err) return { message: fallbackMessage } as { message: string; status?: number; code?: string };
    if (err instanceof Error) {
      const anyErr = err as any;
      return {
        message: err.message || fallbackMessage,
        status: typeof anyErr.status === "number" ? anyErr.status : undefined,
        code: typeof anyErr.code === "string" ? anyErr.code : undefined,
      };
    }
    if (typeof err === "string") return { message: err };
    const anyErr = err as any;
    const status =
      (typeof anyErr.status === "number" && anyErr.status) ||
      (typeof anyErr.statusCode === "number" && anyErr.statusCode) ||
      (typeof anyErr.response?.status === "number" && anyErr.response.status) ||
      undefined;
    const code =
      (typeof anyErr.code === "string" && anyErr.code) ||
      (typeof anyErr.error?.code === "string" && anyErr.error.code) ||
      undefined;
    const message =
      (typeof anyErr.message === "string" && anyErr.message) ||
      (typeof anyErr.error === "string" && anyErr.error) ||
      (typeof anyErr.body?.message === "string" && anyErr.body.message) ||
      (typeof anyErr.data?.message === "string" && anyErr.data.message) ||
      (typeof anyErr.response?.data?.message === "string" && anyErr.response.data.message) ||
      fallbackMessage;

    // Ensure status is surfaced in the message for UI mappers (e.g. 429 rate limit)
    const withStatus = status ? `${message} (${status})` : message;
    return { message: withStatus, status, code };
  }, []);

  /**
   * Load profile after authentication
   */
  const loadProfile = useCallback(async (isNewSignup = false) => {
    const profileStart = Date.now();
    console.log("[BetterAuth][PROFILE] ── START ─────────────────────────────────────");
    console.log("[BetterAuth][PROFILE] isNewSignup:", isNewSignup);
    setProfileLoading(true);
    setProfileError(null);
    setIsProfileReady(false);

    const result = await ensureProfileExists(isNewSignup);

    if (result.success && result.profile) {
      console.log(`[BetterAuth][PROFILE] Loaded OK in ${Date.now() - profileStart}ms:`, {
        id: result.profile.id,
        isComplete: result.isComplete,
        airline: (result.profile as any).airline ?? "(not set)",
      });
      setProfile(result.profile, result.isComplete);
      setIsProfileReady(true);
      setProfileError(null);
    } else {
      console.log(`[BetterAuth][PROFILE] FAILED in ${Date.now() - profileStart}ms:`, result.error, result.errorType);
      setProfileError(result.error ?? "Failed to load profile");
      setIsProfileReady(false);
      setProfileLoading(false);
    }
  }, [setProfile, setProfileLoading]);

  const retryProfileLoad = useCallback(async () => {
    if (isAuthenticated) {
      await loadProfile();
    }
  }, [isAuthenticated, loadProfile]);

  // Load profile when user becomes authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading && !profileLoadAttemptedRef.current) {
      console.log("[BetterAuth][AUTH_EFFECT] ── User authenticated ──────────────────────────────");
      console.log("[BetterAuth][AUTH_EFFECT] userId:", user?.id, "email:", user?.email);
      profileLoadAttemptedRef.current = true;

      // Check for Apple Review account
      if (user?.email) {
        const isReviewAccount = isAppleReviewAccount(user.email);
        if (isReviewAccount) {
          console.log("[BetterAuth] ========================================");
          console.log("[BetterAuth] APPLE REVIEW ACCOUNT SIGNED IN");
          console.log("[BetterAuth] Email:", user.email);
          console.log("[BetterAuth] All premium features will be unlocked");
          console.log("[BetterAuth] ========================================");
        }
      }

      // Link RevenueCat to the authenticated user (handles session restores on app relaunch)
      if (user?.id && isRevenueCatEnabled()) {
        console.log("[BetterAuth] Linking RevenueCat user on session restore:", user.id);
        setUserId(user.id).catch((e) => console.log("[BetterAuth] RevenueCat login skipped:", e));
      }

      loadProfile();
    }
  }, [isAuthenticated, isLoading, loadProfile, user?.email, user?.id]);

  // Reset profile state on sign out
  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      profileLoadAttemptedRef.current = false;
      setIsProfileReady(false);
      setProfileError(null);
    }
  }, [isAuthenticated, isLoading]);

  // Hide splash screen only after BOTH session check AND first navigation decision
  // are complete. This prevents any flash of the wrong screen.
  useEffect(() => {
    const authResolved = !isAuthenticated || profileError != null || isProfileReady;
    if (!isLoading && isFirstNavDone && authResolved) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading, isFirstNavDone, isAuthenticated, profileError, isProfileReady]);

  // Refresh session when app becomes active
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === "active") {
        console.log("[BetterAuth] App became active - refreshing session + subscription");
        try {
          await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
          // Invalidate subscription status so premium unlocks immediately after Stripe checkout
          await queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
          // Also invalidate projection/benchmark data so numbers refresh on every app-foreground
          await queryClient.invalidateQueries({ queryKey: ["projections"] });
          await queryClient.invalidateQueries({ queryKey: ["pay-benchmarks"] });
          await refetch();
        } catch (error) {
          console.log("[BetterAuth] Session refresh failed:", (error as Error).message);
        }
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [refetch, queryClient]);

  // Sign up with email and password (with retry for transient server errors, same pattern as signIn)
  const signUp = useCallback(async (email: string, password: string) => {
    const signupStart = Date.now();
    console.log("[BetterAuth][SIGNUP] ── START ──────────────────────────────────────");
    console.log("[BetterAuth][SIGNUP] Email:", email, "| timeout:", AUTH_TIMEOUT_MS, "ms");
    profileLoadAttemptedRef.current = false;

    const MAX_RETRIES = 2;
    let lastNormalized: { message: string; status?: number; code?: string } | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = Math.min(2000 * attempt, 4000);
          console.log(`[BetterAuth][SIGNUP] Retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }

        console.log(`[BetterAuth][SIGNUP] Calling authClient.signUp.email (attempt ${attempt + 1})`);
        const result = await withTimeout(
          authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0],
          }),
          AUTH_TIMEOUT_MS,
        );

        const { error } = result;

        if (!error) {
          // On web, persist the session token for use in API calls
          if (Platform.OS === "web") {
            const token = (result as any).data?.session?.token;
            if (token) persistWebSessionToken(token);
          }
          console.log(`[BetterAuth][SIGNUP] authClient success (${Date.now() - signupStart}ms)`);
          lastNormalized = null;
          break; // Account created
        }

        const normalized = normalizeAuthError(error, "Sign up failed");
        console.log(`[BetterAuth][SIGNUP] Error (attempt ${attempt + 1}):`, JSON.stringify(normalized));
        lastNormalized = normalized;

        const isTransient =
          normalized.status === 502 ||
          normalized.status === 503 ||
          normalized.status === 504 ||
          (normalized.status === undefined &&
            (normalized.message.toLowerCase().includes("fetch") ||
             normalized.message.toLowerCase().includes("network") ||
             normalized.message.toLowerCase().includes("timeout")));

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`[BetterAuth][SIGNUP] Transient error (${normalized.status}), will retry...`);
          continue;
        }

        const e = new Error(normalized.message);
        (e as any).status = normalized.status;
        (e as any).code = normalized.code;
        return { error: e };
      } catch (error) {
        const normalized = normalizeAuthError(error, "Sign up failed");
        console.log(`[BetterAuth][SIGNUP] Exception (attempt ${attempt + 1}):`, JSON.stringify(normalized));
        lastNormalized = normalized;

        const isTransient =
          normalized.status === 502 ||
          normalized.status === 503 ||
          normalized.status === 504 ||
          (normalized.status === undefined &&
            (normalized.message.toLowerCase().includes("fetch") ||
             normalized.message.toLowerCase().includes("network") ||
             normalized.message.toLowerCase().includes("timeout")));

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`[BetterAuth][SIGNUP] Transient exception (${normalized.status}), will retry...`);
          continue;
        }

        const e = new Error(normalized.message);
        (e as any).status = normalized.status;
        (e as any).code = normalized.code;
        return { error: e };
      }
    }

    if (lastNormalized) {
      console.log("[BetterAuth][SIGNUP] All signup retries exhausted:", lastNormalized);
      const e = new Error(lastNormalized.message);
      (e as any).status = lastNormalized.status;
      (e as any).code = lastNormalized.code;
      return { error: e };
    }

    console.log(`[BetterAuth][SIGNUP] Account created OK (${Date.now() - signupStart}ms). Polling for session...`);

    // Poll for the session after signup. On slow/restricted networks the session
    // cookie may not be readable immediately. We try up to 5 times with increasing
    // waits (1.5s, 2s, 2.5s, 3s, 3.5s = up to ~13s total) before giving up.
    // Giving up is non-fatal — the create-account screen shows "Setting Up…" and
    // retries via its own 8-second safety-net timer.
    const SESSION_POLL_ATTEMPTS = 5;
    let sessionFound = false;
    for (let poll = 1; poll <= SESSION_POLL_ATTEMPTS; poll++) {
      const waitMs = 1000 + (poll * 500); // 1.5s, 2s, 2.5s, 3s, 3.5s
      console.log(`[BetterAuth][SIGNUP] Session poll ${poll}/${SESSION_POLL_ATTEMPTS}: waiting ${waitMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      try {
        await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
        const result = await refetch();
        const hasSession = !!(result.data as any)?.user;
        console.log(`[BetterAuth][SIGNUP] Session poll ${poll} result: hasSession=${hasSession} (${Date.now() - signupStart}ms total)`);
        if (hasSession) {
          sessionFound = true;
          break;
        }
      } catch (pollErr) {
        console.log(`[BetterAuth][SIGNUP] Session poll ${poll} error (non-fatal):`, pollErr);
      }
    }

    if (!sessionFound) {
      // Session was not confirmed in time — this is non-fatal.
      // The create-account screen shows "Setting Up Your Account…" and has its
      // own 8-second safety-net that calls retryProfileLoad(). The AppState
      // handler will also pick up the session when the app is next foregrounded.
      console.log(`[BetterAuth][SIGNUP] Session not confirmed after polling — returning success anyway. ` +
        `The screen retry timer will handle it. (total: ${Date.now() - signupStart}ms)`);
    }

    console.log(`[BetterAuth][SIGNUP] ── DONE (${Date.now() - signupStart}ms) ──────────────────────────────`);
    return { error: null };
  }, [normalizeAuthError, refetch, queryClient]);

  // Sign in with email and password (with retry for transient server errors)
  const signIn = useCallback(async (email: string, password: string) => {
    const signinStart = Date.now();
    console.log("[BetterAuth][SIGNIN] ── START ──────────────────────────────────────");
    console.log("[BetterAuth][SIGNIN] Email:", email, "| timeout:", AUTH_TIMEOUT_MS, "ms");
    profileLoadAttemptedRef.current = false;

    // Retry only for clear transient server errors (502/503/504).
    // Keep MAX_RETRIES low so users get feedback quickly instead of waiting 60+ seconds.
    const MAX_RETRIES = 2;
    let lastNormalized: { message: string; status?: number; code?: string } | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          // Brief backoff before retrying: 2s, 4s
          const backoffMs = Math.min(2000 * attempt, 4000);
          console.log(`[BetterAuth][SIGNIN] Retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }

        console.log(`[BetterAuth][SIGNIN] Calling authClient.signIn.email (attempt ${attempt + 1})`);
        const result = await withTimeout(
          authClient.signIn.email({ email, password }),
          AUTH_TIMEOUT_MS,
        );

        const { error } = result;

        if (!error) {
          // On web, persist the session token for use in API calls (bypasses cross-origin cookie issues)
          if (Platform.OS === "web") {
            const token = (result as any).data?.session?.token;
            if (token) persistWebSessionToken(token);
          }
          console.log(`[BetterAuth][SIGNIN] authClient success (${Date.now() - signinStart}ms)`);
          // On native, verify the session cookie was stored in SecureStore by expoClient
          if (Platform.OS !== "web") {
            const cookieStored = await hasStoredSession();
            console.log(`[BetterAuth][SIGNIN] Native SecureStore cookie present: ${cookieStored}`);
          }
          lastNormalized = null;
          break;
        }

        const normalized = normalizeAuthError(error, "Sign in failed");
        console.log(`[BetterAuth][SIGNIN] Error (attempt ${attempt + 1}):`, JSON.stringify(normalized));
        // Also log the raw error shape for diagnosing unexpected Better Auth error formats
        if (error && typeof error === "object") {
          const e = error as any;
          console.log(`[BetterAuth][SIGNIN] Raw error — status:${e.status} code:${e.code} message:${e.message}`);
        }
        lastNormalized = normalized;

        const isTransient =
          normalized.status === 502 ||
          normalized.status === 503 ||
          normalized.status === 504 ||
          (normalized.status === undefined &&
            (normalized.message.toLowerCase().includes("fetch") ||
             normalized.message.toLowerCase().includes("network") ||
             normalized.message.toLowerCase().includes("timeout")));

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`[BetterAuth][SIGNIN] Transient error (${normalized.status}), will retry...`);
          continue;
        }

        const e = new Error(normalized.message);
        (e as any).status = normalized.status;
        (e as any).code = normalized.code;
        return { error: e };
      } catch (error) {
        const normalized = normalizeAuthError(error, "Sign in failed");
        console.log(`[BetterAuth][SIGNIN] Exception (attempt ${attempt + 1}):`, JSON.stringify(normalized));
        if (error && typeof error === "object") {
          const e = error as any;
          console.log(`[BetterAuth][SIGNIN] Raw exception — name:${e.name} message:${e.message} status:${e.status}`);
        }
        lastNormalized = normalized;

        const isTransient =
          normalized.status === 502 ||
          normalized.status === 503 ||
          normalized.status === 504 ||
          (normalized.status === undefined &&
            (normalized.message.toLowerCase().includes("fetch") ||
             normalized.message.toLowerCase().includes("network") ||
             normalized.message.toLowerCase().includes("timeout")));

        if (isTransient && attempt < MAX_RETRIES) {
          console.log(`[BetterAuth][SIGNIN] Transient exception (${normalized.status}), will retry...`);
          continue;
        }

        const e = new Error(normalized.message);
        (e as any).status = normalized.status;
        (e as any).code = normalized.code;
        return { error: e };
      }
    }

    if (lastNormalized) {
      console.log("[BetterAuth][SIGNIN] All retries exhausted:", lastNormalized);
      const e = new Error(lastNormalized.message);
      (e as any).status = lastNormalized.status;
      (e as any).code = lastNormalized.code;
      return { error: e };
    }

    console.log(`[BetterAuth][SIGNIN] Auth OK (${Date.now() - signinStart}ms). Refreshing session...`);

    // Refresh session — the auth useEffect handles RevenueCat + profile loading.
    // Wrap in try-catch: if refetch throws (e.g., brief network blip after auth), we
    // still want to return success so the user isn't stuck on the sign-in screen.
    // The navigation useEffect will load the session on the next render cycle.
    try {
      await new Promise(resolve => setTimeout(resolve, 1500)); // slightly longer wait for cookie propagation
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      // Log the state of SecureStore before session check to diagnose native cookie issues
      if (Platform.OS !== "web") {
        const cookieExists = await hasStoredSession();
        console.log(`[BetterAuth][SIGNIN] Pre-session-check: SecureStore cookie present=${cookieExists}`);
      }
      const result = await refetch();
      const hasSession = !!(result.data as any)?.user;
      const userId = (result.data as any)?.user?.id ?? "none";
      console.log(`[BetterAuth][SIGNIN] Session check after signin: hasSession=${hasSession} userId=${userId} (${Date.now() - signinStart}ms total)`);
    } catch (refreshErr) {
      console.log("[BetterAuth][SIGNIN] Session refresh failed (non-fatal):", refreshErr);
      // Non-fatal: the auth state polling will pick up the session shortly.
    }

    console.log(`[BetterAuth][SIGNIN] ── DONE (${Date.now() - signinStart}ms) ─────────────────────────────`);
    return { error: null };
  }, [normalizeAuthError, refetch, queryClient]);

  // Sign out
  const signOut = useCallback(async () => {
    console.log("[BetterAuth] Signing out");
    await authClient.signOut();
    // Clear web session token on sign out
    if (Platform.OS === "web") {
      clearWebSessionToken();
    }
    // Log out of RevenueCat to clear the linked user
    if (isRevenueCatEnabled()) {
      logoutUser().catch(() => {});
    }
    clearProfile();
    setIsProfileReady(false);
    setProfileError(null);
    profileLoadAttemptedRef.current = false;
    resetBypassState();
    // Clear all React Query cache so stale data doesn't confuse routing on re-login
    queryClient.clear();
    // Re-fetch session to confirm signed out state
    await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
  }, [clearProfile, queryClient]);

  // Sign out for account switch — clears session without redirecting to /welcome.
  // Called from sign-in screen when opened via pilotpaytracker://sign-in?new=1
  const requestSignOutForSwitch = useCallback(async () => {
    console.log("[BetterAuth] Signing out for account switch");
    skipNavRedirectRef.current = true;
    await authClient.signOut().catch(() => {});
    // Clear web session token on sign out
    if (Platform.OS === "web") {
      clearWebSessionToken();
    }
    if (isRevenueCatEnabled()) {
      logoutUser().catch(() => {});
    }
    clearProfile();
    setIsProfileReady(false);
    setProfileError(null);
    profileLoadAttemptedRef.current = false;
    resetBypassState();
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    // Intentionally no router.replace() — sign-in screen stays visible
  }, [clearProfile, queryClient]);

  // Reset password - sends email
  const resetPassword = useCallback(async (email: string) => {
    console.log("[BetterAuth] Requesting password reset for:", email);
    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });

      if (error) {
        const normalized = normalizeAuthError(error, "Password reset failed");
        console.log("[BetterAuth] Password reset error:", normalized);
        const e = new Error(normalized.message);
        (e as any).status = normalized.status;
        (e as any).code = normalized.code;
        return { error: e };
      }
    } catch (error) {
      const normalized = normalizeAuthError(error, "Password reset failed");
      console.log("[BetterAuth] Password reset exception:", normalized);
      const e = new Error(normalized.message);
      (e as any).status = normalized.status;
      (e as any).code = normalized.code;
      return { error: e };
    }

    console.log("[BetterAuth] Password reset email sent");
    return { error: null };
  }, [normalizeAuthError]);

  // Update password (after reset)
  const updatePassword = useCallback(async (newPassword: string) => {
    console.log("[BetterAuth] Updating password");
    const { error } = await authClient.changePassword({
      newPassword,
      currentPassword: "",
      revokeOtherSessions: false,
    });

    if (error) {
      console.log("[BetterAuth] Update password error:", error.message);
      return { error: new Error(error.message ?? "Password update failed") };
    }

    console.log("[BetterAuth] Password updated successfully");
    return { error: null };
  }, []);

  // Handle navigation based on auth state
  useEffect(() => {
    if (!navigationState?.key) return;
    if (isLoading) {
      console.log("[BetterAuth] Waiting for session check...");
      return;
    }

    // During account switch: block nav redirects until sign-out finishes
    if (skipNavRedirectRef.current) {
      if (!isAuthenticated && !isLoading) {
        skipNavRedirectRef.current = false;
      }
      return;
    }

    const inAuthGroup =
      segments[0] === "welcome" ||
      segments[0] === "sign-in" ||
      segments[0] === "create-account" ||
      segments[0] === "forgot-password";

    const inProtectedGroup =
      segments[0] === "(tabs)" ||
      segments[0] === "settings" ||
      segments[0] === "profile-setup" ||
      segments[0] === "onboarding";

    const inOnboarding = segments[0] === "onboarding";

    // Pick the right onboarding step to resume at based on how far the user got
    const getOnboardingRoute = () => {
      const step = persistedProfile?.onboardingStep ?? 0;
      if (step >= 3) return "/onboarding/goals" as const;
      if (step >= 2) return "/onboarding/career" as const;
      if (step >= 1) return "/onboarding/pilot-profile" as const;
      return "/onboarding" as const;
    };

    // Treat unknown/empty segments as needing auth routing
    const inUnknownGroup = !inAuthGroup && !inProtectedGroup;

    console.log("[BetterAuth] Navigation check:", {
      isAuthenticated,
      isProfileReady,
      isProfileDataComplete,
      currentSegment: segments[0],
      inAuthGroup,
      inProtectedGroup,
    });

    if (!isAuthenticated && (inProtectedGroup || inUnknownGroup)) {
      // Not authenticated and on a protected or unknown route — send to welcome
      console.log("[BetterAuth] Redirecting to welcome - not authenticated");
      router.replace("/welcome");
    } else if (isAuthenticated && inAuthGroup) {
      if (isProfileReady) {
        if (!isProfileDataComplete) {
          const route = getOnboardingRoute();
          console.log("[BetterAuth] Profile incomplete - redirecting to onboarding:", route);
          router.replace(route);
        } else {
          console.log("[BetterAuth] User authenticated with profile ready - redirecting to tabs");
          router.replace("/(tabs)");
        }
      } else if (profileError) {
        // Stay on sign-in/create-account screen so the user sees the retry UI.
        console.log("[BetterAuth] Profile error - staying on auth screen for retry");
      } else {
        console.log("[BetterAuth] Waiting for profile to be ready...");
      }
    } else if (isAuthenticated && isProfileReady && !isProfileDataComplete && !inOnboarding) {
      const route = getOnboardingRoute();
      console.log("[BetterAuth] Profile incomplete - enforcing onboarding redirect:", route);
      router.replace(route);
    }

    // Mark the first navigation decision as done.
    // Wait 350ms so any router.replace() call above has time to complete
    // before we reveal the app content.
    const initialDecisionResolved = !isAuthenticated || profileError != null || isProfileReady;
    if (!firstNavRef.current && initialDecisionResolved) {
      firstNavRef.current = true;
      setTimeout(() => setIsFirstNavDone(true), 350);
    }
  }, [isAuthenticated, isLoading, isProfileReady, isProfileDataComplete, profileError, persistedProfile, segments, navigationState?.key, router]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isAuthenticated,
        isLoading,
        isProfileReady,
        isOptimisticallyAuthenticated,
        profileError,
        signUp,
        signIn,
        signOut,
        requestSignOutForSwitch,
        resetPassword,
        updatePassword,
        retryProfileLoad,
      }}
    >
      {/* Always render children so the Stack navigator mounts and provides
          navigationState immediately. We overlay a loading screen on top until
          the first routing decision is complete (or the 6s safety timeout fires).
          We intentionally do NOT block on isLoading here — if the backend is
          unreachable (e.g. TestFlight with no cloud URL configured) the safety
          timeout guarantees the spinner is removed and the app becomes usable. */}
      {children}
      {(!isFirstNavDone ||
        (appReady && isAuthenticated && !profileError && !isProfileReady)) && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#f59e0b" />
          {appReady && isAuthenticated && !isProfileReady && !profileError && (
            <Text style={styles.loadingText}>Setting up your account...</Text>
          )}
        </View>
      )}
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 16,
  },
});
