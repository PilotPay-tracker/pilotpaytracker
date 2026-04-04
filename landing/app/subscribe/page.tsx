'use client'

import { useState, useEffect, useCallback } from 'react'
import { authClient } from '../../lib/auth'

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://preview-qdjnuldqmyed.dev.vibecode.run'

const FEATURES = [
  'Unlimited Trip Board imports',
  'AI-powered schedule change detection',
  'Pay confidence scoring',
  'Annual earnings projections',
  '30-in-7 FAR compliance tracking',
  'Priority pilot support',
]

type Plan = 'monthly' | 'yearly'

export default function SubscribePage() {
  const { data: session, isPending } = authClient.useSession()
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')

  // Read ?plan= query param for pre-selection
  const [selectedPlan, setSelectedPlan] = useState<Plan>('yearly')
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const plan = params.get('plan')
    if (plan === 'monthly' || plan === 'yearly') setSelectedPlan(plan)
  }, [])

  const handleSubscribe = useCallback(async (plan: Plan) => {
    if (!session?.user) {
      window.location.href = `/login?redirect=/subscribe?plan=${plan}`
      return
    }

    setLoadingPlan(plan)
    setError('')

    try {
      const res = await fetch(`${BACKEND_URL}/api/stripe/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not start checkout. Please try again.')
        return
      }

      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoadingPlan(null)
    }
  }, [session])

  const isLoading = loadingPlan !== null

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#fff',
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
            justifyContent: 'space-between',
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

          {session?.user ? (
            <a
              href="pilotpaytracker://"
              style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '14px' }}
            >
              Back to app
            </a>
          ) : (
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <a href="/login" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '14px' }}>
                Log In
              </a>
              <a
                href="/signup"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#0f172a',
                  textDecoration: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                Sign Up
              </a>
            </div>
          )}
        </div>
      </header>

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '48px 24px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: '999px',
              padding: '6px 16px',
              marginBottom: '20px',
            }}
          >
            <span style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 500 }}>
              ✦ 7-day free trial included
            </span>
          </div>
          <h1
            style={{
              fontSize: 'clamp(28px, 5vw, 44px)',
              fontWeight: 800,
              margin: '0 0 12px',
              lineHeight: 1.15,
              letterSpacing: '-0.5px',
            }}
          >
            Make Sure You&apos;re Getting<br />Paid Correctly
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '17px', margin: 0, lineHeight: 1.6 }}>
            Track, audit, and verify your pay using real UPS schedule data.
          </p>
        </div>

        {/* Plans + Features grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '24px',
          }}
        >
          {/* Pricing column */}
          <div>
            <p style={{ color: '#fff', fontWeight: 600, fontSize: '16px', marginBottom: '16px' }}>
              Choose your plan
            </p>

            {/* Annual */}
            <div
              style={{
                borderRadius: '16px',
                border: `2px solid ${selectedPlan === 'yearly' ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                background: selectedPlan === 'yearly' ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)',
                padding: '20px',
                marginBottom: '12px',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedPlan('yearly')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '17px' }}>Annual Plan</span>
                    <span
                      style={{
                        background: '#f59e0b',
                        color: '#0f172a',
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        letterSpacing: '0.5px',
                      }}
                    >
                      BEST VALUE
                    </span>
                  </div>
                  <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>2 months free vs. monthly</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '24px', fontWeight: 800 }}>$99.99</div>
                  <div style={{ color: '#475569', fontSize: '12px' }}>/year</div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleSubscribe('yearly') }}
                disabled={isLoading || isPending}
                style={{
                  width: '100%',
                  background: isLoading && loadingPlan === 'yearly'
                    ? 'rgba(245,158,11,0.6)'
                    : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: isLoading || isPending ? 'not-allowed' : 'pointer',
                  opacity: isLoading && loadingPlan !== 'yearly' ? 0.5 : 1,
                }}
              >
                {loadingPlan === 'yearly' ? 'Opening checkout…' : 'Start Annual Plan →'}
              </button>
            </div>

            {/* Monthly */}
            <div
              style={{
                borderRadius: '16px',
                border: `1px solid ${selectedPlan === 'monthly' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
                background: 'rgba(255,255,255,0.02)',
                padding: '20px',
                marginBottom: '12px',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedPlan('monthly')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '17px', margin: '0 0 4px' }}>Monthly Plan</p>
                  <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Flexible, cancel anytime</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '24px', fontWeight: 800 }}>$9.99</div>
                  <div style={{ color: '#475569', fontSize: '12px' }}>/month</div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleSubscribe('monthly') }}
                disabled={isLoading || isPending}
                style={{
                  width: '100%',
                  background: 'transparent',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '12px',
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: isLoading || isPending ? 'not-allowed' : 'pointer',
                  opacity: isLoading && loadingPlan !== 'monthly' ? 0.5 : 1,
                }}
              >
                {loadingPlan === 'monthly' ? 'Opening checkout…' : 'Start Monthly Plan →'}
              </button>
            </div>

            {error && (
              <div
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  color: '#f87171',
                  fontSize: '14px',
                  marginBottom: '12px',
                }}
              >
                {error}
              </div>
            )}

            <p style={{ color: '#475569', fontSize: '12px', textAlign: 'center', margin: '8px 0' }}>
              Prices shown after 7-day free trial. Cancel anytime.
            </p>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '20px',
                marginTop: '4px',
              }}
            >
              <span style={{ color: '#475569', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🔒 Secure checkout via Stripe
              </span>
              <span style={{ color: '#475569', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ⏱ Cancel anytime
              </span>
            </div>
          </div>

          {/* Features column */}
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            <p style={{ fontWeight: 600, fontSize: '15px', margin: '0 0 20px' }}>Everything included</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {FEATURES.map((f) => (
                <li key={f} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: '#f59e0b', fontSize: '16px', flexShrink: 0 }}>✓</span>
                  <span style={{ color: '#cbd5e1', fontSize: '14px' }}>{f}</span>
                </li>
              ))}
            </ul>

            <div
              style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: '20px',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'rgba(245,158,11,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                👑
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: '14px', margin: '0 0 4px' }}>Works on iPhone &amp; web</p>
                <p style={{ color: '#64748b', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                  Subscribe once — access everywhere. Download the app from the App Store
                  and your subscription unlocks instantly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
