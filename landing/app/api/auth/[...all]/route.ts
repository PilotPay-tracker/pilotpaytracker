/**
 * Auth Proxy Route — /api/auth/[...all]
 *
 * Problem: Better Auth sets the session cookie on the backend domain
 * (preview-emzjepkzrrpo.dev.vibecode.run). When the user visits pilotpaytracker.com,
 * the browser does NOT send that cookie — cookie is domain-bound to the
 * backend. The Next.js middleware checking request.cookies sees nothing
 * and 307-redirects the user back to /login.
 *
 * Solution: Proxy all /api/auth/* requests through the Next.js app and
 * rewrite every Set-Cookie header directly on the response. This guarantees:
 *  - No Domain= attribute (browser assigns cookie to responding domain)
 *  - SameSite=Lax (never None — this is first-party, not cross-site)
 *  - Secure=true, HttpOnly=true, Path=/
 *  - Cookie is stored for pilotpaytracker.com ✓
 *
 * NOTE: We add Set-Cookie directly to responseHeaders (NOT via cookies().set()
 * from next/headers). The cookies() API queues cookies internally but those are
 * NOT reliably merged into a manually constructed new NextResponse(...).
 *
 * Flow:
 *   Browser → pilotpaytracker.com/api/auth/* (this file)
 *           → [BACKEND_URL]/api/auth/* (backend)
 *           ← Set-Cookie: __Secure-better-auth.session_token (rewritten)
 *           → cookie stored for pilotpaytracker.com ✓
 */

import { NextRequest, NextResponse } from 'next/server'

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
    `[auth-proxy] BACKEND_URL is not set — using "${BACKEND_URL}". Set BACKEND_URL in Vercel env vars for production.`
  )
}
console.log(`[auth-proxy] BACKEND_URL: ${BACKEND_URL}`)

async function proxyToBackend(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname
  const search = request.nextUrl.search
  const targetUrl = `${BACKEND_URL}${pathname}${search}`

  // Forward all request headers so Better Auth sees Origin, Cookie, Content-Type, etc.
  const requestHeaders = new Headers(request.headers)
  // Ensure the backend knows the real forwarding host for CORS/trusted-origin checks
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
      // Never cache auth responses
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[auth-proxy] fetch failed:', err)
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 502 })
  }

  // Build response headers, excluding Set-Cookie from backend (we rewrite them below).
  const responseHeaders = new Headers()
  backendResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower !== 'set-cookie' && lower !== 'transfer-encoding') {
      responseHeaders.set(key, value)
    }
  })

  // Rewrite Set-Cookie headers directly onto the response with first-party safe attributes:
  //   - No Domain= (browser assigns cookie to pilotpaytracker.com, the responding host)
  //   - SameSite=Lax (never None — this is first-party, not cross-site)
  //   - Secure=true, HttpOnly=true, Path=/
  //
  // IMPORTANT: We add Set-Cookie directly to responseHeaders instead of using
  // cookies().set() from next/headers. The cookies() API queues cookies internally
  // but those are NOT reliably merged into a manually constructed `new NextResponse(...)`.
  // Direct header manipulation is the only guaranteed approach.
  const setCookieValues = getSetCookieHeaders(backendResponse.headers)
  console.log(`[auth-proxy] backend returned ${setCookieValues.length} Set-Cookie header(s)`)

  for (const raw of setCookieValues) {
    console.log(`[auth-proxy] raw Set-Cookie: ${raw.slice(0, 200)}`)
    const parsed = parseSetCookie(raw)

    // Build a fresh Set-Cookie string with explicit first-party safe attributes.
    const parts: string[] = [`${parsed.name}=${parsed.value}`]
    parts.push('Path=/')
    parts.push('HttpOnly')
    parts.push('Secure')
    parts.push('SameSite=Lax')
    // Preserve expiry from backend so session duration is maintained.
    if (parsed.maxAge !== undefined) {
      parts.push(`Max-Age=${parsed.maxAge}`)
    } else if (parsed.expires) {
      parts.push(`Expires=${parsed.expires.toUTCString()}`)
    }
    // Domain is intentionally omitted — browser assigns to responding domain.

    const cookieStr = parts.join('; ')
    console.log(`[auth-proxy] rewritten Set-Cookie: ${cookieStr.slice(0, 200)}`)
    // append() is required for multiple Set-Cookie headers (not set())
    responseHeaders.append('Set-Cookie', cookieStr)
  }

  const responseBody = await backendResponse.arrayBuffer()

  return new NextResponse(responseBody, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all Set-Cookie header values from a Headers object.
 * Uses getSetCookie() (Node 18+) to correctly split multiple Set-Cookie headers.
 * Falls back to a single-header parse for older runtimes.
 */
function getSetCookieHeaders(headers: Headers): string[] {
  if (typeof (headers as any).getSetCookie === 'function') {
    return (headers as any).getSetCookie() as string[]
  }
  // Fallback: may concatenate multiple cookies — rare in practice for auth responses
  const raw = headers.get('set-cookie')
  return raw ? [raw] : []
}

interface ParsedSetCookie {
  name: string
  value: string
  path?: string
  httpOnly: boolean
  secure: boolean
  sameSite?: string
  maxAge?: number
  expires?: Date
}

/**
 * Parse a raw Set-Cookie header string into structured fields.
 * Domain and Partitioned attributes are intentionally discarded.
 */
function parseSetCookie(raw: string): ParsedSetCookie {
  const parts = raw.split(/\s*;\s*/)
  const nameValuePart = parts[0] ?? ''
  const eqIdx = nameValuePart.indexOf('=')
  const name = nameValuePart.slice(0, eqIdx).trim()
  const value = nameValuePart.slice(eqIdx + 1).trim()

  const result: ParsedSetCookie = { name, value, httpOnly: false, secure: false }

  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i].trim()
    const lower = attr.toLowerCase()

    if (lower === 'httponly') {
      result.httpOnly = true
    } else if (lower === 'secure') {
      result.secure = true
    } else if (lower.startsWith('samesite=')) {
      result.sameSite = attr.slice(attr.indexOf('=') + 1).trim()
    } else if (lower.startsWith('path=')) {
      result.path = attr.slice(attr.indexOf('=') + 1).trim()
    } else if (lower.startsWith('max-age=')) {
      const n = parseInt(attr.slice(attr.indexOf('=') + 1).trim(), 10)
      if (!isNaN(n)) result.maxAge = n
    } else if (lower.startsWith('expires=')) {
      const dateStr = attr.slice(attr.indexOf('=') + 1).trim()
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) result.expires = d
    }
    // 'domain=' and 'partitioned' are intentionally skipped
  }

  return result
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
