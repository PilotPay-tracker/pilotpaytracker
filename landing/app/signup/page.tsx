'use client'

import { useState } from 'react'
import { signUp } from '../../lib/auth'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      const result = await signUp.email({ email, password, name: email.split('@')[0] })
      if (result.error) {
        const msg = result.error.message?.toLowerCase() ?? ''
        if (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')) {
          setError('An account with this email already exists. Try logging in.')
        } else if (msg.includes('weak') || msg.includes('password')) {
          setError('Please choose a stronger password (at least 6 characters).')
        } else {
          setError(result.error.message ?? "Couldn't create your account — please try again.")
        }
      } else {
        setSuccess(true)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't create your account — please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
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
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ width: '100%', maxWidth: '420px', textAlign: 'center' }}>

          {/* Success icon */}
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
              fontSize: '32px',
              color: '#22c55e',
            }}
          >
            ✓
          </div>

          {/* Headline */}
          <h1 style={{ color: '#fff', fontSize: '26px', fontWeight: '700', margin: '0 0 8px', letterSpacing: '-0.5px' }}>
            Account created!
          </h1>

          {/* Trial confirmation */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: '100px',
              padding: '5px 14px',
              marginBottom: '24px',
            }}
          >
            <span style={{ color: '#22c55e', fontSize: '13px' }}>✓</span>
            <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '500' }}>
              Your 7-day free trial has started
            </span>
          </div>

          {/* Next step instruction */}
          <div
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              padding: '20px',
              marginBottom: '28px',
              textAlign: 'left',
            }}
          >
            <p style={{ color: '#94a3b8', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>
              Next step
            </p>
            <p style={{ color: '#e2e8f0', fontSize: '15px', lineHeight: 1.6, margin: 0 }}>
              Open the <strong style={{ color: '#fff' }}>Pilot Pay Tracker</strong> app on your device and log in with the same email and password you just used.
            </p>
          </div>

          {/* Primary CTA — deep link carrying new-account signal + email */}
          <a
            href={`pilotpaytracker://sign-in?new=1&email=${encodeURIComponent(email)}`}
            style={{
              display: 'block',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#0f172a',
              textDecoration: 'none',
              borderRadius: '12px',
              padding: '15px 24px',
              fontSize: '16px',
              fontWeight: '700',
              marginBottom: '12px',
              boxShadow: '0 4px 20px rgba(245,158,11,0.35)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            ✈️ Open App
          </a>

          {/* Secondary CTA — App Store */}
          <a
            href="https://apps.apple.com/app/pilot-pay-tracker/id6746883697"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              background: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              textDecoration: 'none',
              borderRadius: '12px',
              padding: '14px 24px',
              fontSize: '15px',
              fontWeight: '600',
              border: '1px solid rgba(255,255,255,0.12)',
              marginBottom: '28px',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Download on the App Store
          </a>

          {/* Support line */}
          <p style={{ color: '#475569', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
            Trouble logging in?{' '}
            <a href="/login" style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: '500' }}>
              Try signing in
            </a>
            {' '}or{' '}
            <a href="mailto:support@pilotpaytracker.com" style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: '500' }}>
              contact support
            </a>
          </p>

        </div>
      </main>
    )
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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: '420px' }}>
        {/* Back link */}
        <div style={{ marginBottom: '32px' }}>
          <a
            href="/"
            style={{
              color: '#64748b',
              textDecoration: 'none',
              fontSize: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ← Back
          </a>
        </div>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              fontSize: '28px',
              boxShadow: '0 8px 24px rgba(245, 158, 11, 0.3)',
            }}
          >
            ✈️
          </div>
          <h1
            style={{
              color: '#fff',
              fontSize: '24px',
              fontWeight: '700',
              margin: '0 0 8px',
              letterSpacing: '-0.5px',
              textAlign: 'center',
            }}
          >
            Create your account
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0, textAlign: 'center', lineHeight: 1.6 }}>
            Start your 7-day trial and verify your pay using real UPS schedule data
          </p>
        </div>

        {/* Trial badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.2)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '24px',
          }}
        >
          <span style={{ color: '#22c55e', fontSize: '15px' }}>✓</span>
          <span style={{ color: '#22c55e', fontSize: '14px', fontWeight: '500' }}>
            7-day free trial — no credit card required
          </span>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '10px',
              padding: '12px 16px',
              color: '#f87171',
              fontSize: '14px',
              marginBottom: '8px',
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          <div>
            <label
              style={{
                display: 'block',
                color: '#94a3b8',
                fontSize: '13px',
                marginBottom: '6px',
                fontWeight: '500',
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                padding: '12px 16px',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                color: '#94a3b8',
                fontSize: '13px',
                marginBottom: '6px',
                fontWeight: '500',
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              required
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '12px 48px 12px 16px',
                  color: '#fff',
                  fontSize: '15px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#475569',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: loading ? 'rgba(245,158,11,0.5)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#0f172a',
              border: 'none',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '4px',
            }}
          >
            {loading ? 'Creating account…' : 'Start 7-Day Free Trial'}
          </button>
        </form>

        <p style={{ color: '#475569', fontSize: '13px', textAlign: 'center', marginTop: '24px' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: '600' }}>
            Log In
          </a>
        </p>

        <p style={{ color: '#334155', fontSize: '12px', textAlign: 'center', marginTop: '12px' }}>
          Use the same account as your Pilot Pay Tracker mobile app
        </p>
      </div>
    </main>
  )
}
