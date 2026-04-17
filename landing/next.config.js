/** @type {import('next').NextConfig} */

// Canonical production domain. All traffic is redirected here.
// NEXT_PUBLIC_APP_URL overrides this (set it in Vercel env vars if needed).
const CANONICAL_DOMAIN = 'https://pilotpaytracker.com'

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  CANONICAL_DOMAIN

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_URL: appUrl,
  },

  /**
   * Canonical-domain redirect.
   *
   * pilotpaytracker.vercel.app is the Vercel auto-assigned domain. Keeping
   * two active auth origins creates split cookie stores — a session established
   * on .vercel.app is invisible on .com and vice-versa. Redirecting at the
   * edge collapses both origins to pilotpaytracker.com before any auth cookie
   * is read or written.
   *
   * This redirect does NOT fire on localhost or preview deployments because
   * the `has: host` condition only matches the exact vercel.app hostname.
   */
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'pilotpaytracker.vercel.app' }],
        destination: `${CANONICAL_DOMAIN}/:path*`,
        permanent: true, // 308 — browsers cache this redirect
      },
    ]
  },

  /**
   * API routing — all /api/* requests are handled by Route Handlers:
   *
   *   /api/auth/[...all]  → auth proxy  (sets session cookie on Vercel domain)
   *   /api/cookie-debug   → debug endpoint
   *   /api/[...path]      → generic data proxy (forwards Cookie to backend)
   *
   * The generic proxy at app/api/[...path]/route.ts explicitly forwards the
   * Cookie header to the backend, ensuring Better Auth sessions work for
   * protected data endpoints (/api/dashboard, /api/profile, /api/trips, etc.).
   *
   * IMPORTANT: We do NOT set NEXT_PUBLIC_BACKEND_URL in the env config here.
   * NEXT_PUBLIC_* env vars are baked into the client-side JavaScript bundle at
   * build time. If the backend URL were baked in, client code (or third-party
   * libraries) could use it to call the backend directly — bypassing the
   * same-origin cookie proxy and losing session authentication.
   *
   * Server-side route handlers and layouts read BACKEND_URL directly from
   * process.env at runtime, which is safe (server-only, not in the bundle).
   *
   * To configure the backend URL on Vercel:
   *   Add BACKEND_URL (NOT NEXT_PUBLIC_BACKEND_URL) in your Vercel project
   *   environment variables. The route handlers will pick it up server-side.
   */
}

module.exports = nextConfig
