/**
 * Generic API Proxy — /api/[...path]
 *
 * Catches all /api/* requests that are NOT handled by more-specific routes:
 *   - /api/auth/[...path] → auth proxy (higher precedence)
 *
 * Forwards every request — including the Cookie header — to the backend server
 * so that Better Auth session cookies work correctly for all data endpoints.
 *
 * Why needed: The web Vite app is a pure SPA with no /api/* server routes.
 * The browser must send requests to the same origin (same-origin cookies).
 * This edge function acts as the proxy that forwards to the real backend.
 *
 * Flow:
 *   Browser → pilotpaytracker.com/api/dashboard (Cookie: session_token=...)
 *           → [BACKEND_URL]/api/dashboard (Cookie forwarded)
 *           ← 200 + data ✓
 */

export const config = { runtime: 'edge' }

// IMPORTANT: Set BACKEND_URL in your Vercel project environment variables.
// This must NOT have a VITE_ prefix so it is never baked into the client bundle.
const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.VITE_BACKEND_URL ||
  'https://royal-jewel.vibecode.run'
).replace(/\/$/, '')

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = `${BACKEND_URL}${url.pathname}${url.search}`

  // Forward all request headers including Cookie so Better Auth sessions work.
  const requestHeaders = new Headers(request.headers)
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
  } catch {
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const responseHeaders = new Headers()
  backendResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'transfer-encoding') return
    responseHeaders.set(key, value)
  })

  return new Response(await backendResponse.arrayBuffer(), {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  })
}
