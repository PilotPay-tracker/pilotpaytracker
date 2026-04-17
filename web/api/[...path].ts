/**
 * Data Proxy — /api/* (all non-auth endpoints)
 *
 * Forwards every request — including the Cookie header — to the backend so
 * Better Auth session cookies work correctly.
 *
 * Because the browser calls /api/dashboard (same-origin), this function is
 * invoked by Vercel's edge and forwards the Cookie to the backend verbatim.
 * No Set-Cookie rewriting needed here — data routes don't set new cookies.
 *
 * Flow:
 *   Browser → pilotpaytracker.vercel.app/api/dashboard  (Cookie: __Secure-better-auth.session_token=...)
 *           → royal-jewel.vibecode.run/api/dashboard (Cookie forwarded)
 *           ← 200 + data ✓
 */

export const config = { runtime: 'edge' }

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.VITE_BACKEND_URL ||
  'https://royal-jewel.vibecode.run'

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = `${BACKEND_URL}${url.pathname}${url.search}`

  const requestHeaders = new Headers(request.headers)
  // Explicitly re-set Cookie — some edge runtimes can silently drop it
  const cookieVal = request.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)
  requestHeaders.set('x-forwarded-host', url.host)
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
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const responseHeaders = new Headers()
  backendResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    // Skip transfer-encoding (Vercel handles chunked encoding) and set-cookie (data routes don't set cookies)
    if (lower !== 'transfer-encoding' && lower !== 'set-cookie') {
      responseHeaders.set(key, value)
    }
  })

  return new Response(await backendResponse.arrayBuffer(), {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  })
}
