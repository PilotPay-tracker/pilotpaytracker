import { createAuthClient } from 'better-auth/react'

/**
 * Auth client base URL — MUST be the same domain as this Next.js app.
 *
 * Why: Better Auth sets the session cookie on whatever domain handles
 * the /api/auth/* requests. If we pointed directly at the backend
 * (royal-jewel.vibecode.run), the cookie would land on that domain and
 * the Next.js middleware on pilotpaytracker.com would never see it.
 *
 * With the proxy at /api/auth/[...all], all auth requests flow through
 * pilotpaytracker.com → the cookie is set on pilotpaytracker.com → the
 * middleware finds the cookie → protected routes work.
 *
 * CRITICAL: Never use NEXT_PUBLIC_BACKEND_URL here — that is the backend
 * URL, not the frontend. Using it would send auth requests directly to the
 * backend, bypassing the proxy, and the session cookie would be set on the
 * wrong domain.
 */
const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin                          // Browser: always correct
    : process.env.NEXT_PUBLIC_APP_URL ||              // SSR: set in Vercel env vars
      'https://pilotpaytracker.com'                   // SSR fallback — canonical domain

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: {
    credentials: 'include',
  },
})

export const { signIn, signUp } = authClient
