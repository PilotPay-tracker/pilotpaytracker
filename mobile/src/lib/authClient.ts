import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// App scheme for deep linking
// IMPORTANT: Use the URL scheme registered in app.json, NOT the bundle ID.
// Application.applicationId returns the bundle ID on iOS, which is NOT the same
// as the URL scheme. The registered scheme is "pilotpaytracker" (from app.json).
const getAppScheme = (): string => {
  // Always use the registered URL scheme for Better Auth Expo client.
  // This ensures OAuth redirects and deep links work correctly on TestFlight.
  return "pilotpaytracker";
};

const getBackendUrl = (): string => {
  // EXPO_PUBLIC_BACKEND_URL is the canonical variable — set this in the ENV tab
  // for TestFlight/App Store builds to point to the correct backend.
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (backendUrl && backendUrl.startsWith("https://")) {
    console.log("[Auth] Using Vibecode backend URL:", backendUrl);
    return backendUrl;
  }
  // EXPO_PUBLIC_VIBECODE_BACKEND_URL is injected by Vibecode's reverse proxy at
  // bundle time — internal fallback for Vibecode sandbox environments.
  const vibecodeUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL;
  if (vibecodeUrl && vibecodeUrl.startsWith("https://")) {
    console.log("[Auth] Using Vibecode backend URL:", vibecodeUrl);
    return vibecodeUrl;
  }
  // Fallback: local dev
  console.log("[Auth] Using localhost fallback");
  return "http://localhost:3000";
};

const BACKEND_URL = getBackendUrl();
const APP_SCHEME = getAppScheme();
const STORAGE_PREFIX = "pilotpay";

console.log("[Auth] Backend:", BACKEND_URL);
console.log("[Auth] Scheme:", APP_SCHEME);
console.log("[Auth] Platform:", Platform.OS);

export const authClient = createAuthClient({
  baseURL: BACKEND_URL,
  plugins: [
    expoClient({
      scheme: APP_SCHEME,
      storagePrefix: STORAGE_PREFIX,
      storage: SecureStore,
    }),
  ],
});

// Helper to check if cookies are stored
export const hasStoredSession = async (): Promise<boolean> => {
  try {
    const cookie = await SecureStore.getItemAsync(`${STORAGE_PREFIX}_cookie`);
    return !!cookie && cookie !== "{}";
  } catch {
    return false;
  }
};

/**
 * Get the stored Better Auth cookie as a Cookie header string for raw fetch calls.
 * The expo client plugin stores cookies in SecureStore as a JSON object.
 * Returns null if no session exists.
 */
export async function getAuthCookieHeader(): Promise<string | null> {
  try {
    const cookieJson = await SecureStore.getItemAsync(`${STORAGE_PREFIX}_cookie`);
    if (!cookieJson || cookieJson === "{}") return null;

    // @better-auth/expo stores cookies as a JSON object:
    // { [cookieName]: { value: string, expires: string | null }, ... }
    const parsed = JSON.parse(cookieJson) as Record<
      string,
      { value?: string; expires?: string | null } | string | null | undefined
    >;

    const now = Date.now();
    const parts: string[] = [];

    for (const [name, entry] of Object.entries(parsed)) {
      if (!entry) continue;

      // Defensive: handle any legacy/plain string formats
      if (typeof entry === "string") {
        if (entry) parts.push(`${name}=${entry}`);
        continue;
      }

      const value = entry.value;
      if (!value) continue;

      const expires = entry.expires ?? null;
      if (expires) {
        const exp = Date.parse(expires);
        if (!Number.isNaN(exp) && exp < now) continue;
      }

      parts.push(`${name}=${value}`);
    }

    return parts.length > 0 ? parts.join("; ") : null;
  } catch {
    return null;
  }
}
