'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth'

export const metadata = undefined // client component

type Step = 'confirm' | 'deleting' | 'deleted' | 'error' | 'unauthenticated'

export default function DeleteAccountPage() {
  const { data: session, isPending } = authClient.useSession()
  const [step, setStep] = useState<Step>('confirm')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleDelete() {
    setStep('deleting')
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setStep('unauthenticated')
          return
        }
        throw new Error((data as { error?: string }).error ?? `Error ${res.status}`)
      }
      // Sign out clears the session cookie
      await authClient.signOut()
      setStep('deleted')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong.')
      setStep('error')
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
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
        <a
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
        >
          <span style={{ fontSize: '24px' }}>✈️</span>
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '18px' }}>
            Pilot Pay Tracker
          </span>
        </a>
        <nav style={{ display: 'flex', gap: '12px' }}>
          {!session && !isPending && (
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
          )}
        </nav>
      </header>

      {/* Content */}
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          marginTop: '120px',
          marginBottom: '64px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '48px 40px',
        }}
      >
        {isPending ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '2px solid rgba(148,163,184,0.3)',
                borderTopColor: '#94a3b8',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        ) : step === 'deleted' ? (
          <DeletedState />
        ) : step === 'unauthenticated' || (!isPending && !session) ? (
          <UnauthenticatedState />
        ) : step === 'error' ? (
          <ErrorState message={errorMessage} onRetry={() => setStep('confirm')} />
        ) : (
          <ConfirmState
            email={session?.user?.email ?? ''}
            deleting={step === 'deleting'}
            onDelete={handleDelete}
          />
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  )
}

function ConfirmState({
  email,
  deleting,
  onDelete,
}: {
  email: string
  deleting: boolean
  onDelete: () => void
}) {
  const [typed, setTyped] = useState('')
  const confirmWord = 'DELETE'
  const confirmed = typed === confirmWord

  return (
    <>
      {/* Icon */}
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          fontSize: '26px',
        }}
      >
        🗑️
      </div>

      <h1
        style={{
          fontSize: '26px',
          fontWeight: '800',
          color: '#f1f5f9',
          margin: '0 0 12px',
          letterSpacing: '-0.4px',
        }}
      >
        Delete Account
      </h1>

      <p style={{ color: '#94a3b8', fontSize: '15px', lineHeight: '1.6', margin: '0 0 8px' }}>
        This permanently deletes your account and all associated data. This action cannot be undone.
      </p>

      {email && (
        <p style={{ color: '#64748b', fontSize: '13px', margin: '0 0 28px' }}>
          Account: <span style={{ color: '#94a3b8' }}>{email}</span>
        </p>
      )}

      {/* Warning list */}
      <div
        style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.18)',
          borderRadius: '12px',
          padding: '16px 18px',
          marginBottom: '28px',
        }}
      >
        <p style={{ color: '#fca5a5', fontSize: '13px', fontWeight: '600', margin: '0 0 8px' }}>
          The following will be permanently removed:
        </p>
        <ul style={{ color: '#94a3b8', fontSize: '13px', margin: 0, paddingLeft: '18px', lineHeight: '1.8' }}>
          <li>Your account and login credentials</li>
          <li>All trips, flights, and pay data</li>
          <li>Profile and configuration settings</li>
          <li>All active sessions</li>
        </ul>
      </div>

      {/* Confirmation input */}
      <label style={{ display: 'block', marginBottom: '6px' }}>
        <span style={{ color: '#94a3b8', fontSize: '13px' }}>
          Type <strong style={{ color: '#f1f5f9' }}>DELETE</strong> to confirm
        </span>
      </label>
      <input
        type="text"
        value={typed}
        onChange={e => setTyped(e.target.value)}
        placeholder="DELETE"
        disabled={deleting}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: '10px',
          border: `1px solid ${confirmed ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
          background: 'rgba(255,255,255,0.04)',
          color: '#f1f5f9',
          fontSize: '15px',
          fontFamily: 'monospace',
          letterSpacing: '0.08em',
          outline: 'none',
          boxSizing: 'border-box',
          marginBottom: '20px',
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
      />

      <button
        onClick={onDelete}
        disabled={!confirmed || deleting}
        style={{
          width: '100%',
          padding: '13px',
          borderRadius: '12px',
          border: 'none',
          background: confirmed && !deleting ? '#dc2626' : 'rgba(239,68,68,0.2)',
          color: confirmed && !deleting ? '#fff' : 'rgba(239,68,68,0.4)',
          fontSize: '15px',
          fontWeight: '700',
          cursor: confirmed && !deleting ? 'pointer' : 'not-allowed',
          transition: 'background 0.15s',
          marginBottom: '16px',
        }}
      >
        {deleting ? 'Deleting…' : 'Delete Account'}
      </button>

      <a
        href="/login"
        style={{
          display: 'block',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '14px',
          textDecoration: 'none',
        }}
      >
        Cancel — go back
      </a>
    </>
  )
}

function DeletedState() {
  return (
    <>
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'rgba(16,185,129,0.12)',
          border: '1px solid rgba(16,185,129,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          fontSize: '26px',
        }}
      >
        ✓
      </div>
      <h1
        style={{
          fontSize: '26px',
          fontWeight: '800',
          color: '#f1f5f9',
          margin: '0 0 12px',
          letterSpacing: '-0.4px',
        }}
      >
        Account Deleted
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '15px', lineHeight: '1.6', margin: '0 0 32px' }}>
        Your account and all associated data have been permanently deleted. Thank you for using Pilot Pay Tracker.
      </p>
      <a
        href="/"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '13px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#f1f5f9',
          fontSize: '15px',
          fontWeight: '600',
          textDecoration: 'none',
        }}
      >
        Return to homepage
      </a>
    </>
  )
}

function UnauthenticatedState() {
  return (
    <>
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'rgba(148,163,184,0.08)',
          border: '1px solid rgba(148,163,184,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          fontSize: '26px',
        }}
      >
        🔒
      </div>
      <h1
        style={{
          fontSize: '26px',
          fontWeight: '800',
          color: '#f1f5f9',
          margin: '0 0 12px',
          letterSpacing: '-0.4px',
        }}
      >
        Delete Account
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '15px', lineHeight: '1.6', margin: '0 0 32px' }}>
        You must be signed in to delete your account. Please sign in to continue.
      </p>
      <a
        href={`/login?redirect=/account/delete`}
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '13px',
          borderRadius: '12px',
          background: '#2563eb',
          color: '#fff',
          fontSize: '15px',
          fontWeight: '700',
          textDecoration: 'none',
          marginBottom: '12px',
        }}
      >
        Sign In
      </a>
      <a
        href="/"
        style={{
          display: 'block',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '14px',
          textDecoration: 'none',
        }}
      >
        Return to homepage
      </a>
    </>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
          fontSize: '26px',
        }}
      >
        ⚠️
      </div>
      <h1
        style={{
          fontSize: '26px',
          fontWeight: '800',
          color: '#f1f5f9',
          margin: '0 0 12px',
          letterSpacing: '-0.4px',
        }}
      >
        Something went wrong
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '15px', lineHeight: '1.6', margin: '0 0 8px' }}>
        We couldn't delete your account.
      </p>
      {message && (
        <p style={{ color: '#fca5a5', fontSize: '13px', margin: '0 0 32px', fontFamily: 'monospace' }}>
          {message}
        </p>
      )}
      <button
        onClick={onRetry}
        style={{
          width: '100%',
          padding: '13px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.06)',
          color: '#f1f5f9',
          fontSize: '15px',
          fontWeight: '600',
          cursor: 'pointer',
          marginBottom: '12px',
        }}
      >
        Try again
      </button>
      <a
        href="/"
        style={{
          display: 'block',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '14px',
          textDecoration: 'none',
        }}
      >
        Return to homepage
      </a>
    </>
  )
}
