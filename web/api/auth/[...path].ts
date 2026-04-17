/**
 * Auth proxy — /api/auth/*
 *
 * Forwards to the Better Auth backend and passes Set-Cookie through with
 * Domain= stripped so the session is first-party on the Vercel host.
 * SameSite=None and Secure are preserved for mobile native clients.
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
    if (lower === 'transfer-encoding' || lower === 'set-cookie') return
    responseHeaders.append(key, value)
  })

  const setCookies =
    typeof backendResponse.headers.getSetCookie === 'function'
      ? backendResponse.headers.getSetCookie()
      : backendResponse.headers.get('set-cookie')
        ? [backendResponse.headers.get('set-cookie')!]
        : []

  for (const raw of setCookies) {
    responseHeaders.append('Set-Cookie', stripDomainFromSetCookie(raw))
  }

  return new Response(await backendResponse.arrayBuffer(), {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  })
}

/** Remove Domain= so the cookie is set for the current host (e.g. *.vercel.app). */
function stripDomainFromSetCookie(cookie: string): string {
  return cookie.replace(/;\s*Domain=[^;]*/gi, '').trim()
}
