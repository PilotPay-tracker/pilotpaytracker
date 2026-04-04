/**
 * clearSessionOnVersionChange
 *
 * Clears auth-related storage whenever the app's version/build changes.
 * This prevents TestFlight reinstalls from reusing a stale auth token and
 * causing an incorrect authenticated launch (blank dashboard / bad routing).
 *
 * AsyncStorage keys cleared on mismatch:
 *  - Any key containing: `session`, `token`, `auth`, `user` (case-insensitive)
 * Also clears:
 *  - expo-secure-store: "pilotpay_cookie"
 *  - AsyncStorage: "pilot-profile-storage" (Zustand profile persist key)
 */

import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useProfileStore } from "./state/profile-store";

const AUTH_COOKIE_KEY = "pilotpay_cookie";
const PROFILE_STORE_KEY = "pilot-profile-storage";
const LAST_VERSION_BUILD_KEY = "app_last_version_build";

function getCurrentVersionAndBuild() {
  const version =
    Constants.expoConfig?.version ??
    // expo-constants changed shape across SDKs; `manifest2` is the most reliable when present.
    (Constants as any).manifest2?.version ??
    (Constants as any).manifest?.version ??
    "0";

  // Build number is platform-dependent; try Android/iOS manifest values first, then fall back.
  const buildNumber =
    (Constants as any).manifest2?.ios?.buildNumber ??
    (Constants as any).manifest2?.android?.buildNumber ??
    (Constants as any).manifest2?.android?.versionCode ??
    (Constants as any).expoConfig?.versionCode ??
    (Constants as any).expoConfig?.buildNumber ??
    Application.nativeBuildVersion ??
    "0";

  return { version: String(version), buildNumber: String(buildNumber) };
}

function keyLooksLikeAuthSessionKey(key: string) {
  const lower = key.toLowerCase();
  return lower.includes("session") || lower.includes("token") || lower.includes("auth") || lower.includes("user");
}

export async function clearSessionOnVersionChange(): Promise<void> {
  try {
    const current = getCurrentVersionAndBuild();
    const lastRaw = await AsyncStorage.getItem(LAST_VERSION_BUILD_KEY);

    let last: { version: string; buildNumber: string } | null = null;
    if (lastRaw) {
      try {
        last = JSON.parse(lastRaw) as { version: string; buildNumber: string };
      } catch {
        last = null;
      }
    }

    const shouldWipe =
      last == null || last.version !== current.version || last.buildNumber !== current.buildNumber;

    if (shouldWipe) {
      // Wipe ALL auth-related AsyncStorage keys to avoid stale TestFlight sessions.
      const keys = await AsyncStorage.getAllKeys();
      const authKeysToWipe = keys.filter(keyLooksLikeAuthSessionKey);

      await Promise.allSettled([
        ...authKeysToWipe.map((k) => AsyncStorage.removeItem(k)),
        // Also wipe our known Better Auth cookie storage and profile cache.
        SecureStore.deleteItemAsync(AUTH_COOKIE_KEY),
        AsyncStorage.removeItem(PROFILE_STORE_KEY),
      ]);

      // Also clear in-memory Zustand state in case it already hydrated from old storage.
      useProfileStore.getState().clearProfile();
      console.log(
        `[App] Version/build changed or first launch: wiping auth keys (${current.version} / ${current.buildNumber})`
      );
    }

    await AsyncStorage.setItem(LAST_VERSION_BUILD_KEY, JSON.stringify(current));
  } catch (err) {
    // Non-blocking — if this fails the app continues normally
    console.log("[App] Version check error (non-fatal):", err);

    // Fail-safe: if the version/build comparison logic fails, still wipe any
    // auth-like keys to avoid routing into an authenticated flow with stale data.
    try {
      const keys = await AsyncStorage.getAllKeys();
      const authKeysToWipe = keys.filter(keyLooksLikeAuthSessionKey);
      await Promise.allSettled([
        ...authKeysToWipe.map((k) => AsyncStorage.removeItem(k)),
        SecureStore.deleteItemAsync(AUTH_COOKIE_KEY),
      ]);
      useProfileStore.getState().clearProfile();
    } catch {
      // Ignore fail-safe errors
    }
  }
}

/** Forcefully clears the session regardless of build number (for testing). */
export async function forceSignOut(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(AUTH_COOKIE_KEY),
    AsyncStorage.removeItem(PROFILE_STORE_KEY),
  ]);
  useProfileStore.getState().clearProfile();
  console.log("[App] Force sign-out: session cleared");
}
