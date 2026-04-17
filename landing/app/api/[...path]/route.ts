/**
 * Generic API Proxy Route — /api/[...path]
 *
 * Catches all /api/* requests that are NOT handled by more-specific routes:
 *   - /api/auth/[...all]  → auth proxy (higher precedence)
 *   - /api/cookie-debug   → debug endpoint (higher precedence)
 *
 * This route forwards every request — including the Cookie header — to the
 * backend server so that Better Auth session cookies work correctly.
 *
 * Why this is needed instead of next.config.js rewrites:
 *   Next.js 14 rewrites to external origins do not reliably forward the
 *   Cookie header. The browser calls /api/dashboard (same-origin), Next.js
 *   rewrites to the backend but the session cookie may be stripped during the
 *   cross-origin proxy — causing 401s. An explicit route handler reads
 *   request.headers directly (which always includes Cookie) and forwards
 *   them verbatim to the backend.
 *
 * Flow:
 *   Browser → pilotpaytracker.com/api/dashboard  (Cookie: __Secure-better-auth.session_token=...)
 *           → [BACKEND_URL]/api/dashboard (Cookie forwarded)
 *           ← 200 + data ✓
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// IMPORTANT: Set BACKEND_URL in your Vercel project environment variables.
// This must be a server-only env var (no NEXT_PUBLIC_ prefix) so it is never
// baked into the client-side JS bundle.
const RAW_BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.VIBECODE_BACKEND_URL ||
  (process.env.VERCEL ? 'https://royal-jewel.vibecode.run' : 'http://localhost:3000')

const BACKEND_URL = RAW_BACKEND_URL.replace(/\/$/, '')

if (!process.env.BACKEND_URL) {
  console.warn(
    `[api-proxy] BACKEND_URL is not set — using "${BACKEND_URL}". Set BACKEND_URL in Vercel env vars for production.`
  )
}
console.log(`[api-proxy] BACKEND_URL: ${BACKEND_URL}`)

async function proxyToBackend(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname
  const search = request.nextUrl.search
  const targetUrl = `${BACKEND_URL}${pathname}${search}`

  // Forward all request headers so the backend receives Cookie, Content-Type, etc.
  // Explicitly extract 'cookie' because Next.js's patched fetch can silently strip
  // it from new Headers(request.headers) on GET requests (Data Cache layer).
  const requestHeaders = new Headers(request.headers)
  const cookieVal = request.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)
  requestHeaders.set('x-forwarded-host', request.headers.get('host') ?? '')
  requestHeaders.set('x-forwarded-proto', 'https')

  let body: ArrayBuffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
  }

  let backendResponse: Response
  try {
    backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers: requestHeaders,
      body,
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[api-proxy] fetch failed:', err)
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }

  // Pass response headers through (excluding set-cookie — data routes don't set cookies)
  const responseHeaders = new Headers()
  backendResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower !== 'set-cookie' && lower !== 'transfer-encoding') {
      responseHeaders.set(key, value)
    }
  })

  const responseBody = await backendResponse.arrayBuffer()

  return new NextResponse(responseBody, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  })
}

export async function GET(request: NextRequest) {
  return proxyToBackend(request)
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request)
}

export async function PUT(request: NextRequest) {
  return proxyToBackend(request)
}

export async function PATCH(request: NextRequest) {
  return proxyToBackend(request)
}

export async function DELETE(request: NextRequest) {
  return proxyToBackend(request)
}
