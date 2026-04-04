/**
 * Cookie Debug Endpoint — /api/cookie-debug
 *
 * NOT protected by middleware. Hit this URL in the browser after logging in
 * to see exactly what cookies the server receives.
 *
 * Usage: visit https://pilotpaytracker.com/api/cookie-debug
 *
 * Expected output after a successful login:
 *   {
 *     "rawCookieHeader": "__Secure-better-auth.session_token=...",
 *     "cookieCount": 1,
 *     "cookies": { "__Secure-better-auth.session_token": "..." },
 *     "hasSecureSessionToken": true,
 *     "hasPlainSessionToken": false
 *   }
 *
 * If "rawCookieHeader" is "(none)" the browser is not sending ANY cookies to
 * this domain — the issue is browser-side (path/domain/secure mismatch, or
 * the cookie was never stored in the first place).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const rawCookieHeader = request.headers.get('cookie') ?? '(none)'

  // Parse all cookies via Next.js
  const cookieStore = cookies()
  const all = cookieStore.getAll()
  const cookieMap: Record<string, string> = {}
  for (const c of all) {
    cookieMap[c.name] = c.value.slice(0, 40) + (c.value.length > 40 ? '…' : '')
  }

  const hasSecure = !!cookieStore.get('__Secure-better-auth.session_token')?.value
  const hasPlain = !!cookieStore.get('better-auth.session_token')?.value

  const body = {
    rawCookieHeader: rawCookieHeader.slice(0, 500),
    cookieCount: all.length,
    cookies: cookieMap,
    hasSecureSessionToken: hasSecure,
    hasPlainSessionToken: hasPlain,
    verdict: hasSecure || hasPlain
      ? 'SESSION COOKIE FOUND — middleware should allow through'
      : 'NO SESSION COOKIE — middleware will redirect to /login',
  }

  console.log('[cookie-debug]', JSON.stringify(body))

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
