import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Protected app routes — require valid session
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/trips',
  '/pay-summary',
  '/career',
  '/tools',
  '/settings',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  )

  if (!isProtected) return NextResponse.next()

  // ── RAW HEADER DIAGNOSTIC ──────────────────────────────────────────────────
  // Log the raw Cookie header exactly as the browser sent it.
  // If this is empty/missing the browser is genuinely not sending any cookies.
  const rawCookieHeader = request.headers.get('cookie') ?? '(none)'
  console.log(`[middleware] path=${pathname}`)
  console.log(`[middleware] raw Cookie header: ${rawCookieHeader.slice(0, 500)}`)

  // Parse via Next.js cookie API (splits on semicolon, url-decodes names/values)
  const allCookies = request.cookies.getAll()
  const allCookieNames = allCookies.map((c) => c.name)
  console.log(`[middleware] parsed cookie count: ${allCookies.length}`)
  console.log(`[middleware] parsed cookie names: [${allCookieNames.join(', ')}]`)

  // Check for Better Auth session cookie.
  // Better Auth prefixes cookie names with "__Secure-" when baseURL is https://.
  // We check both forms so it works in dev (http) and prod (https).
  const sessionToken =
    request.cookies.get('__Secure-better-auth.session_token') ||
    request.cookies.get('better-auth.session_token')

  console.log(`[middleware] __Secure-better-auth.session_token present: ${!!request.cookies.get('__Secure-better-auth.session_token')?.value}`)
  console.log(`[middleware] better-auth.session_token present: ${!!request.cookies.get('better-auth.session_token')?.value}`)
  console.log(`[middleware] session found: ${!!sessionToken?.value}`)
  // ────────────────────────────────────────────────────────────────────────────

  if (!sessionToken?.value) {
    console.log(`[middleware] → REDIRECT to /login (no session cookie)`)
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  console.log(`[middleware] → ALLOW (session cookie: ${sessionToken.name})`)
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/trips/:path*',
    '/pay-summary/:path*',
    '/career/:path*',
    '/tools/:path*',
    '/settings/:path*',
  ],
}
