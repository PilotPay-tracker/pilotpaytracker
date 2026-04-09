import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BACKEND_URL =
  (process.env.BACKEND_URL ||
    process.env.VIBECODE_BACKEND_URL ||
    (process.env.VERCEL
      ? 'https://royal-jewel.vibecode.run'
      : 'http://localhost:3000')
  ).replace(/\/$/, '')

async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, '')
  const search = req.nextUrl.search || ''
  const targetUrl = `${BACKEND_URL}/api/${path}${search}`

  const requestHeaders = new Headers(req.headers)
  const cookieVal = req.headers.get('cookie')
  if (cookieVal) requestHeaders.set('cookie', cookieVal)

  requestHeaders.set('x-forwarded-host', req.headers.get('host') ?? '')
  requestHeaders.set('x-forwarded-proto', 'https')

  const init: RequestInit = {
    method: req.method,
    headers: requestHeaders,
    cache: 'no-store',
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  let backendRes: Response
  try {
    backendRes = await fetch(targetUrl, init)
  } catch (err) {
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 502 })
  }

  const responseHeaders = new Headers()
  backendRes.headers.forEach((value, key) => {
    if (!['set-cookie', 'transfer-encoding'].includes(key.toLowerCase())) {
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

export async function GET(req: NextRequest) {
  return proxy(req)
}

export async function POST(req: NextRequest) {
  return proxy(req)
}

export async function PUT(req: NextRequest) {
  return proxy(req)
}

export async function PATCH(req: NextRequest) {
  return proxy(req)
}

export async function DELETE(req: NextRequest) {
  return proxy(req)
}
