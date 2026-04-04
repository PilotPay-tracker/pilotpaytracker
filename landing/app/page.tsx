import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000'

async function getEntitlementStatus(cookieHeader: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/subscription/status`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      return data.status as string
    }
  } catch {
    // ignore
  }
  return null
}

export default async function HomePage() {
  // Check if user is already authenticated
  const cookieStore = cookies()
  const sessionToken = cookieStore.get('better-auth.session_token')

  if (sessionToken?.value) {
    // User has a session — check if it's valid and they have access
    const headersList = headers()
    const cookieHeader = headersList.get('cookie') ?? ''
    const status = await getEntitlementStatus(cookieHeader)

    if (status === 'active' || status === 'trialing') {
      redirect('/dashboard')
    } else if (status === 'expired' || status === 'free') {
      redirect('/subscribe')
    }
    // unknown/null = backend down, show landing page as fallback
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}
    >
      {/* Header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 40px',
          background: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>✈️</span>
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '18px' }}>
            Pilot Pay Tracker
          </span>
        </div>
        <nav style={{ display: 'flex', gap: '12px' }}>
          <a
            href="/login"
            style={{
              color: '#94a3b8',
              textDecoration: 'none',
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(148,163,184,0.3)',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Sign In
          </a>
        </nav>
      </header>

      {/* Hero Section */}
      <section style={{ textAlign: 'center', maxWidth: '720px', marginTop: '80px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '100px',
            padding: '6px 16px',
            marginBottom: '32px',
            color: '#60a5fa',
            fontSize: '13px',
            fontWeight: '500',
          }}
        >
          <span>✈️</span>
          <span>Built by a UPS pilot, for UPS pilots</span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(40px, 6vw, 72px)',
            fontWeight: '800',
            color: '#fff',
            lineHeight: 1.1,
            margin: '0 0 24px',
            letterSpacing: '-1px',
          }}
        >
          Never Get{' '}
          <span
            style={{
              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Underpaid
          </span>{' '}
          Again
        </h1>

        <p style={{ fontSize: '18px', color: '#94a3b8', lineHeight: 1.7, margin: '0 0 16px' }}>
          Track, audit, and verify your pay using real UPS schedule data.
        </p>
        <p style={{ fontSize: '15px', color: '#64748b', lineHeight: 1.6, margin: '0 0 48px' }}>
          Pilots can miss hundreds to thousands per year in unnoticed pay differences.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/signup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '16px 36px',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#0f172a',
              textDecoration: 'none',
              borderRadius: '12px',
              fontWeight: '700',
              fontSize: '16px',
              boxShadow: '0 4px 24px rgba(245, 158, 11, 0.4)',
            }}
          >
            Check My Pay Now
          </a>
          <a
            href="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '16px 36px',
              background: 'rgba(255,255,255,0.05)',
              color: '#e2e8f0',
              textDecoration: 'none',
              borderRadius: '12px',
              fontWeight: '600',
              fontSize: '16px',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            Sign In
          </a>
        </div>

        <p style={{ color: '#475569', fontSize: '13px', marginTop: '24px' }}>
          No credit card required · 7-day free trial · Cancel anytime
        </p>
      </section>

      {/* Feature cards */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          maxWidth: '880px',
          width: '100%',
          marginTop: '80px',
        }}
      >
        {[
          {
            icon: '🚨',
            title: 'Catch Pay Mistakes Instantly',
            desc: 'Compare your schedule vs paycheck and flag missing credit, premiums, and errors.',
          },
          {
            icon: '💰',
            title: 'Know Exactly What You Should Be Paid',
            desc: 'Real-time projections using your trips, premiums, JA pay, and guarantee logic.',
          },
          {
            icon: '🛡️',
            title: 'Built for UPS Pay Rules',
            desc: 'Handles 75-hour guarantee, JA 150%, premium codes, and schedule changes correctly.',
          },
          {
            icon: '📈',
            title: 'Plan A + Plan B, Simplified',
            desc: 'Track your pension, savings, and long-term income based on your real career progression.',
          },
        ].map((f) => (
          <div
            key={f.title}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px',
              padding: '28px 24px',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>{f.icon}</div>
            <h3 style={{ color: '#f1f5f9', fontWeight: '600', fontSize: '15px', margin: '0 0 8px', lineHeight: 1.4 }}>
              {f.title}
            </h3>
            <p style={{ color: '#64748b', fontSize: '13px', margin: 0, lineHeight: 1.6 }}>
              {f.desc}
            </p>
          </div>
        ))}
      </section>

      {/* Bottom CTA */}
      <section style={{ marginTop: '80px', textAlign: 'center', maxWidth: '560px' }}>
        <p style={{ color: '#94a3b8', fontSize: '16px', marginBottom: '24px', lineHeight: 1.6 }}>
          Built by a UPS pilot to track pay today and plan for tomorrow.
        </p>
        <a
          href="/signup"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 32px',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#0f172a',
            textDecoration: 'none',
            borderRadius: '12px',
            fontWeight: '700',
            fontSize: '15px',
            boxShadow: '0 4px 24px rgba(245, 158, 11, 0.3)',
          }}
        >
          Start 7-Day Free Trial
        </a>
      </section>

      {/* Footer */}
      <footer style={{ marginTop: '64px', color: '#334155', fontSize: '13px', textAlign: 'center' }}>
        © 2025 Pilot Pay Tracker · All rights reserved
      </footer>
    </main>
  )
}
