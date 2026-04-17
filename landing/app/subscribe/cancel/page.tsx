'use client'

export default function SubscribeCancelPage() {
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
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            textAlign: 'center',
          }}
        >
          {/* Icon */}
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(148,163,184,0.08)',
              border: '2px solid rgba(148,163,184,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 32px',
              fontSize: '32px',
            }}
          >
            ←
          </div>

          <h1
            style={{
              fontSize: 'clamp(26px, 5vw, 36px)',
              fontWeight: 800,
              margin: '0 0 16px',
              lineHeight: 1.2,
              letterSpacing: '-0.5px',
            }}
          >
            Checkout canceled
          </h1>

          <p
            style={{
              color: '#94a3b8',
              fontSize: '16px',
              lineHeight: 1.6,
              margin: '0 0 40px',
            }}
          >
            No charge was made. You can return to the access options page
            whenever you&apos;re ready.
          </p>

          {/* Benefits reminder */}
          <div
            style={{
              background: 'rgba(245,158,11,0.05)',
              border: '1px solid rgba(245,158,11,0.15)',
              borderRadius: '16px',
              padding: '20px 24px',
              marginBottom: '32px',
              textAlign: 'left',
            }}
          >
            <p
              style={{
                color: '#f59e0b',
                fontWeight: 600,
                fontSize: '13px',
                margin: '0 0 12px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Don&apos;t miss out
            </p>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 8px', lineHeight: 1.5 }}>
              Pilot Pay Tracker helps UPS pilots catch pay errors, track earnings,
              and stay 30-in-7 FAR compliant — automatically.
            </p>
            <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
              Plans start at $9.99/mo · 7-day free trial · Cancel anytime
            </p>
          </div>

          {/* CTA */}
          <a
            href="/subscribe"
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
            View Access Options →
          </a>

          <a
            href="/"
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
            Back to Home
          </a>
        </div>
      </div>
    </main>
  )
}
