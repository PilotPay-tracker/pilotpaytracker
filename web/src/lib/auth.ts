/**
 * Web Auth Client
 * Uses Better Auth's React client for web (cookie-based sessions)
 *
 * baseURL must point to the same origin so auth requests go through the
 * Vercel Edge Function proxy (/api/auth/*), which rewrites Set-Cookie
 * headers onto the frontend domain. If we pointed directly at the backend,
 * the session cookie would land on that domain and subsequent same-origin
 * API calls would not include it.
 */
import { createAuthClient } from 'better-auth/react';

const baseURL = typeof window !== 'undefined'
  ? window.location.origin   // Browser: pilotpaytracker.vercel.app
  : '';                       // SSR/build: safe fallback (no SSR in Vite)

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: 'include',
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
