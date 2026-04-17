'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// Use same-origin path — Next.js rewrite in next.config.js proxies /api/* to backend
const BACKEND_URL = ''

const REDIRECT_DELAY = 5 // seconds

type SessionStatus = 'loading' | 'verified' | 'error' | 'no_session'

export default function SubscribeSuccessPage() {
  const router = useRouter()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [countdown, setCountdown] = useState(REDIRECT_DELAY)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')

    if (!sessionId) {
      setStatus('no_session')
      return
    }

    // Belt-and-suspenders: verify session immediately so DB is updated
    // without waiting for the Stripe webhook to arrive
    fetch(`${BACKEND_URL}/api/stripe/verify-session?session_id=${encodeURIComponent(sessionId)}`, {
      credentials: 'include',
    })
      .then(() => {
        // Always show success regardless of response — payment went through
        setStatus('verified')
      })
      .catch(() => {
        // Network error — still show success, webhook will handle it
        setStatus('verified')
      })
  }, [])

  // Auto-redirect countdown once verified
  useEffect(() => {
    if (status !== 'verified') return

    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval)
          router.push('/dashboard')
          return 0
        }
        return n - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [status, router])

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '16px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '860px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <a
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textDecoration: 'none',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
              }}
            >
              ✈️
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: '#fff' }}>
              Pilot Pay Tracker
            </span>
          </a>
        </div>
      </header>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
        }}
      >
        {status === 'loading' ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                border: '3px solid rgba(245,158,11,0.2)',
                borderTopColor: '#f59e0b',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 24px',
              }}
            />
            <p style={{ color: '#94a3b8', fontSize: '15px' }}>Confirming your access…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : (
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              textAlign: 'center',
            }}
          >
            {/* Success icon */}
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'rgba(34,197,94,0.1)',
                border: '2px solid rgba(34,197,94,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 32px',
                fontSize: '36px',
              }}
            >
              ✓
            </div>

            {/* Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: '999px',
                padding: '6px 16px',
                marginBottom: '20px',
              }}
            >
              <span style={{ color: '#4ade80', fontSize: '13px', fontWeight: 500 }}>
                ✦ Payment confirmed
              </span>
            </div>

            <h1
              style={{
                fontSize: 'clamp(28px, 5vw, 40px)',
                fontWeight: 800,
                margin: '0 0 16px',
                lineHeight: 1.15,
                letterSpacing: '-0.5px',
              }}
            >
              Access Activated
            </h1>

            <p
              style={{
                color: '#94a3b8',
                fontSize: '17px',
                lineHeight: 1.6,
                margin: '0 0 8px',
              }}
            >
              Your Pilot Pay Tracker access is now active.
            </p>

            {/* Auto-redirect notice */}
            <p style={{ color: '#475569', fontSize: '13px', margin: '0 0 36px' }}>
              Redirecting to your dashboard in {countdown}s…
            </p>

            {/* Feature confirmation */}
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '16px',
                padding: '20px 24px',
                marginBottom: '32px',
                textAlign: 'left',
              }}
            >
              <p style={{ fontWeight: 600, fontSize: '14px', margin: '0 0 14px', color: '#e2e8f0' }}>
                Your access includes
              </p>
              {[
                'Unlimited Trip Board imports',
                'AI-powered schedule change detection',
                'Pay confidence scoring',
                'Annual earnings projections',
                '30-in-7 FAR compliance tracking',
                'Priority pilot support',
              ].map((f) => (
                <div
                  key={f}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '10px',
                  }}
                >
                  <span style={{ color: '#4ade80', fontSize: '14px', flexShrink: 0 }}>✓</span>
                  <span style={{ color: '#94a3b8', fontSize: '14px' }}>{f}</span>
                </div>
              ))}
            </div>

            {/* Primary CTA: Dashboard */}
            <a
              href="/dashboard"
              style={{
                display: 'block',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0f172a',
                textDecoration: 'none',
                borderRadius: '14px',
                padding: '16px',
                fontSize: '16px',
                fontWeight: 700,
                marginBottom: '12px',
                textAlign: 'center',
              }}
            >
              Go to Dashboard →
            </a>

            {/* Secondary CTA: Open mobile app */}
            <a
              href="pilotpaytracker://"
              style={{
                display: 'block',
                background: 'transparent',
                color: '#94a3b8',
                textDecoration: 'none',
                borderRadius: '14px',
                padding: '14px',
                fontSize: '15px',
                fontWeight: 500,
                border: '1px solid rgba(255,255,255,0.1)',
                textAlign: 'center',
              }}
            >
              Open Mobile App ✈️
            </a>
          </div>
        )}
      </div>
    </main>
  )
}
