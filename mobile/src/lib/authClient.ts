import { expoClient } from "@better-auth/expo/dist/client.js";
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

// Strip trailing /api suffix — the auth client needs the server origin only.
// Better Auth appends /api/auth/... itself. Without this, the sign-in URL
// becomes https://host/api/api/auth/... (doubled prefix) causing 404s on native.
function stripApiSuffix(url: string): string {
  return url.replace(/\/api\/?$/, "");
}

const getBackendUrl = (): string => {
  // On web (browser), auth requests MUST go through the same-origin proxy so
  // the session cookie is set on the frontend domain (pilotpaytracker.com).
  // Pointing directly at the backend would set the cookie on the backend domain
  // and the frontend middleware would never see it — causing redirect loops.
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const origin = window.location.origin;
    console.log("[Auth] Web mode — using origin:", origin);
    return origin;
  }
  // EXPO_PUBLIC_PRODUCTION_API_URL is the authoritative production URL.
  // Must be just the server origin (e.g. https://pilotpaytracker.com),
  // NOT https://pilotpaytracker.com/api — Better Auth appends /api/auth itself.
  const productionUrl = process.env.EXPO_PUBLIC_PRODUCTION_API_URL;
  if (productionUrl && productionUrl.startsWith("https://")) {
    const normalized = stripApiSuffix(productionUrl);
    console.log("[Auth] Using production URL:", normalized, productionUrl !== normalized ? `(stripped /api from ${productionUrl})` : "");
    return normalized;
  }
  // EXPO_PUBLIC_VIBECODE_BACKEND_URL is injected by Vibecode's reverse proxy —
  // fallback for Vibecode sandbox development environments only.
  const vibecodeUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL;
  if (vibecodeUrl && vibecodeUrl.startsWith("https://")) {
    const normalized = stripApiSuffix(vibecodeUrl);
    console.log("[Auth] Using Vibecode sandbox URL:", normalized);
    return normalized;
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
  // On web (Expo web / browser), expoClient skips all cookie handling (returns early).
  // We must set credentials: 'include' so the browser stores and sends session cookies
  // on cross-origin requests. On native, expoClient.init() overrides this to 'omit'
  // and manually attaches the cookie from SecureStore — so this setting is safe for both.
  fetchOptions: {
    credentials: "include",
  },
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

// ============================================
// Web-only session token management
// On native, expoClient stores session in SecureStore automatically.
// On web, expoClient skips all cookie handling — we manually persist the
// raw session token so API calls can send it as Authorization: Bearer.
// ============================================

const WEB_TOKEN_KEY = `${STORAGE_PREFIX}_web_token`;

export function persistWebSessionToken(token: string): void {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(WEB_TOKEN_KEY, token);
  }
}

export function clearWebSessionToken(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(WEB_TOKEN_KEY);
  }
}

export function getWebSessionToken(): string | null {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return localStorage.getItem(WEB_TOKEN_KEY);
  }
  return null;
}

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
