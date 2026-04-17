/**
 * Same-origin proxy for /api/trips
 *
 * The browser calls /api/trips?startDate=...&endDate=... (same-origin) with
 * its session cookie. This handler forwards the complete request — including all
 * headers and query params — to the backend so Better Auth can authenticate.
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
  const targetUrl = `${BACKEND_URL}/api/trips${search}`

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
    console.error('[proxy/trips] fetch failed:', err)
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

export async function POST(req: NextRequest) {
  const search = req.nextUrl.search || ''
  const targetUrl = `${BACKEND_URL}/api/trips${search}`

  const requestHeaders = new Headers(req.headers)
  const cookieVal = req.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)
  requestHeaders.set('x-forwarded-host', req.headers.get('host') ?? '')
  requestHeaders.set('x-forwarded-proto', 'https')

  const body = await req.arrayBuffer()

  let backendRes: Response
  try {
    backendRes = await fetch(targetUrl, {
      method: 'POST',
      headers: requestHeaders,
      body,
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[proxy/trips] fetch failed:', err)
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }

  const responseHeaders = new Headers()
  backendRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower !== 'set-cookie' && lower !== 'transfer-encoding') {
      responseHeaders.set(key, value)
    }
  })

  const responseBody = await backendRes.arrayBuffer()
  return new NextResponse(responseBody, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers: responseHeaders,
  })
}
