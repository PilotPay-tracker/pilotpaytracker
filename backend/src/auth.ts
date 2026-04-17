import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "./env";
import { db } from "./db";

// Extract domain from BACKEND_URL for passkey rpID
// DO NOT REMOVE - This function is required for passkey authentication
function getPasskeyRpID(): string {
  try {
    const backendUrl = env.BACKEND_URL || "http://localhost:3000";
    const parsed = new URL(backendUrl);
    return parsed.hostname;
  } catch {
    return "localhost";
  }
}

// ============================================
// Better Auth Configuration
// ============================================
// Better Auth handles all authentication flows for the application
// Endpoints are automatically mounted at /api/auth/* in index.ts
//
// Available endpoints:
//   - POST /api/auth/sign-up/email       - Sign up with email/password
//   - POST /api/auth/sign-in/email       - Sign in with email/password
//   - POST /api/auth/sign-out            - Sign out current session
//   - GET  /api/auth/session             - Get current session
//   - POST /api/auth/passkey/register    - Register a new passkey
//   - POST /api/auth/passkey/authenticate - Authenticate with passkey
//   - GET  /api/auth/passkey/list        - List user's passkeys
//   - DELETE /api/auth/passkey/delete    - Delete a passkey
//   - And many more... (see Better Auth docs)
//
// This configuration includes:
//   - Prisma adapter for SQLite database
//   - Expo plugin for React Native support
//   - Passkey plugin for Face ID / Touch ID / Fingerprint authentication
//   - Email/password authentication
//   - Trusted origins for CORS
console.log("🔐 [Auth] Initializing Better Auth...");

// Get rpID at module load time - DO NOT REMOVE THIS LINE
const passkeyRpID = getPasskeyRpID();
console.log(`🔑 [Auth] Passkey RP ID: ${passkeyRpID}`);

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "sqlite",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  plugins: [
    expo(),
    passkey({
      rpID: passkeyRpID,
      rpName: "Pilot Pay Tracker",
      authenticatorSelection: {
        // Platform authenticators (Face ID, Touch ID, fingerprint) preferred
        authenticatorAttachment: "platform",
        // Allow discoverable credentials for usernameless login
        residentKey: "preferred",
        // Require user verification (biometric/PIN)
        userVerification: "required",
      },
    }),
  ],
  trustedOrigins: [
    "pilotpaytracker://", // Expo app URL scheme (registered in app.json)
    "pilotpaytracker://auth-callback", // Expo Better Auth deep link callback
    "vibecode://", // Legacy scheme — keep for backwards compat with installed TestFlight builds
    "vibecode://auth-callback",
    "com.vibecode.pilotpaytracker.dpa2lr://", // TestFlight/App Store bundle ID
    "com.vibecode.pilotpaytracker.dpa2lr://auth-callback", // TestFlight deep link callback
    "com.vibecodeapp.app://", // Vibecode preview app scheme
    "com.pilotpay.pilotpaytracker://", // Legacy production iOS bundle ID scheme
    "http://localhost:3000",
    "http://localhost:5173", // Web app (Vite dev server)
    "http://localhost:8081",
    "https://royal-jewel.vibecode.run",
    "https://pilotpaytracker.com",
    "https://www.pilotpaytracker.com",
    "https://pilotpaytracker.vercel.app",
    "https://*.pilotpaytracker.vercel.app",
    "https://*.vibecodeapp.com",
    "https://*.share.sandbox.dev",
    "https://*.vibecode.dev",
    "https://*.vibecode.run",
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  session: {
    // Session lasts 1 year (365 days) - effectively indefinite
    expiresIn: 60 * 60 * 24 * 365, // 1 year in seconds
    // Refresh session when 30 days remain
    updateAge: 60 * 60 * 24 * 30, // 30 days in seconds
    // Store fresh tokens in cookies
    freshAge: 60 * 60 * 24, // 24 hours - session considered "fresh" for 24h
  },
  rateLimit: {
    enabled: true,
    window: 60,      // 60-second sliding window
    max: 20,         // max 20 auth requests per window per IP
  },
  advanced: {
    // crossSubDomainCookies is intentionally DISABLED.
    // The Next.js landing app at pilotpaytracker.com proxies all /api/auth/* requests
    // through its own domain, so the session cookie is already first-party on
    // pilotpaytracker.com. Enabling crossSubDomainCookies would set Domain=royal-jewel.vibecode.run
    // on cookies (the full hostname of baseURL), which the proxy then strips — but it
    // adds unnecessary complexity and confusion.
    disableCSRFCheck: false,
    trustedProxyHeaders: true,
    // Explicitly force secure cookie mode so cookie names use the __Secure- prefix
    // consistently regardless of how BACKEND_URL is resolved at runtime.
    useSecureCookies: true,
    // SameSite=None + Secure required for cross-domain cookie delivery.
    // The web app at pilotpaytracker.vercel.app and the native mobile app both
    // communicate with a backend on a different origin, so these flags are mandatory
    // for the browser to store and send cookies on cross-origin requests.
    //
    // Chrome / Edge enforce: SameSite=None cookies MUST also carry Secure=true,
    // otherwise the browser silently drops them — which is why desktop browsers
    // see "no session cookie" while iOS Safari (which is more lenient) may still work.
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
      path: "/",
    },
  },
});
console.log("✅ [Auth] Better Auth initialized");
console.log(`🔗 [Auth] Base URL: ${env.BACKEND_URL}`);
console.log(`🌐 [Auth] Trusted origins: ${auth.options.trustedOrigins?.join(", ")}`);
