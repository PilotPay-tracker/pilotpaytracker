import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.VIBECODE_BACKEND_URL ||
  (process.env.VERCEL ? 'https://royal-jewel.vibecode.run' : 'http://localhost:3000')
).replace(/\/$/, '')

export async function DELETE(req: NextRequest) {
  const targetUrl = `${BACKEND_URL}/api/account`

  const requestHeaders = new Headers(req.headers)
  const cookieVal = req.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)
  requestHeaders.set('x-forwarded-host', req.headers.get('host') ?? '')
  requestHeaders.set('x-forwarded-proto', 'https')

  let backendRes: Response
  try {
    backendRes = await fetch(targetUrl, {
      method: 'DELETE',
      headers: requestHeaders,
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[proxy/account] fetch failed:', err)
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }

  const body = await backendRes.arrayBuffer()
  return new NextResponse(body, {
    status: backendRes.status,
    headers: { 'content-type': backendRes.headers.get('content-type') ?? 'application/json' },
  })
}
