import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Providers } from './providers'
import AppShell from '@/components/AppShell'

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.VIBECODE_BACKEND_URL ||
  (process.env.VERCEL ? 'https://royal-jewel.vibecode.run' : 'http://localhost:3000')

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Layer 1: Cookie presence check (fast, no DB call)
  // Better Auth uses __Secure- prefix when baseURL is https:// (production).
  // Check both names so this works in dev (http) and prod (https).
  const cookieStore = cookies()
  const allCookies = cookieStore.getAll()
  const sessionToken =
    cookieStore.get('__Secure-better-auth.session_token') ||
    cookieStore.get('better-auth.session_token')

  console.log(`[app-layout] cookie count: ${allCookies.length}`)
  console.log(`[app-layout] cookie names: [${allCookies.map(c => c.name).join(', ')}]`)
  console.log(`[app-layout] session token found: ${!!sessionToken?.value} (name: ${sessionToken?.name ?? 'none'})`)

  if (!sessionToken?.value) {
    console.log('[app-layout] → REDIRECT to /login (no session cookie)')
    redirect('/login')
  }

  // Layer 2: Server-side subscription status check
  // Forward all cookies so Better Auth can validate the session on the backend
  const headersList = headers()
  const cookieHeader = headersList.get('cookie') ?? ''

  console.log(`[app-layout] forwarding cookie header to backend (length: ${cookieHeader.length})`)

  let entitlementStatus = 'unknown'
  try {
    const res = await fetch(`${BACKEND_URL}/api/subscription/status`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })

    console.log(`[app-layout] subscription status response: ${res.status}`)

    if (res.status === 401) {
      console.log('[app-layout] → REDIRECT to /login (backend 401)')
      redirect('/login')
    }

    if (res.ok) {
      const data = await res.json()
      entitlementStatus = data.subscriptionStatus ?? data.status ?? 'unknown'
    }
  } catch (err) {
    // Backend unreachable — allow through gracefully, client-side will handle
    console.log(`[app-layout] backend unreachable: ${err}`)
    entitlementStatus = 'unknown'
  }

  console.log(`[app-layout] entitlementStatus: ${entitlementStatus}`)

  // Subscription gate
  // Allow: trialing, active, active_lifetime, unknown (backend down = graceful degradation)
  // Block: free (never trialed), expired
  if (entitlementStatus === 'expired') {
    redirect('/subscribe')
  }
  if (entitlementStatus === 'free') {
    redirect('/subscribe')
  }

  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  )
}
