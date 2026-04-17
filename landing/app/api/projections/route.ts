/**
 * Same-origin proxy for /api/projections
 *
 * The browser calls /api/projections (same-origin) with its session cookie.
 * This handler forwards the complete request — including all headers — to the
 * backend so Better Auth can authenticate the request.
 *
 * GET  /api/projections           — current projections
 * POST /api/projections/goal      — calculate goal (handled by [...path] catch-all)
 * POST /api/projections/what-if   — what-if scenario (handled by [...path] catch-all)
 */

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.VIBECODE_BACKEND_URL ||
  (process.env.VERCEL ? 'https://royal-jewel.vibecode.run' : 'http://localhost:3000')
).replace(/\/$/, '')

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search || ''
  const targetUrl = `${BACKEND_URL}/api/projections${search}`

  const requestHeaders = new Headers(req.headers)
  const cookieVal = req.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)
  requestHeaders.set('x-forwarded-host', req.headers.get('host') ?? '')
  requestHeaders.set('x-forwarded-proto', 'https')

  let backendRes: Response
  try {
    backendRes = await fetch(targetUrl, {
      method: 'GET',
      headers: requestHeaders,
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[proxy/projections] fetch failed:', err)
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }

  const responseHeaders = new Headers()
  backendRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower !== 'set-cookie' && lower !== 'transfer-encoding') {
      responseHeaders.set(key, value)
    }
  })

  const body = await backendRes.arrayBuffer()
  return new NextResponse(body, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers: responseHeaders,
  })
}
