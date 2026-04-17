export const metadata = {
  title: 'Privacy Policy — Pilot Pay Tracker',
  description: 'Privacy Policy for Pilot Pay Tracker',
}

export default function PrivacyPage() {
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

      {/* Content */}
      <article
        style={{
          maxWidth: '760px',
          width: '100%',
          marginTop: '120px',
          marginBottom: '64px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '48px 56px',
        }}
      >
        <h1
          style={{
            fontSize: '36px',
            fontWeight: '800',
            color: '#f1f5f9',
            margin: '0 0 8px',
            letterSpacing: '-0.5px',
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 40px' }}>
          Last updated: April 16, 2025
        </p>

        <Section title="1. Introduction">
          <p>
            Pilot Pay Tracker ("we," "our," or "us") is committed to protecting your privacy. This
            Privacy Policy explains how we collect, use, and safeguard your information when you use
            our mobile application and website (collectively, the "Service").
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <p>We collect the following types of information:</p>
          <ul>
            <li>
              <strong>Account information:</strong> Your name, email address, and password when you
              create an account.
            </li>
            <li>
              <strong>Schedule and pay data:</strong> Trip information, pay codes, schedule data, and
              related details you enter or import into the Service.
            </li>
            <li>
              <strong>Usage data:</strong> Information about how you interact with the Service,
              including features used, pages viewed, and actions taken.
            </li>
            <li>
              <strong>Device information:</strong> Device type, operating system version, and app
              version for troubleshooting and compatibility purposes.
            </li>
          </ul>
          <p>
            We do not collect financial account numbers, Social Security numbers, or government-issued
            ID numbers.
          </p>
        </Section>

        <Section title="3. How We Use Your Information">
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, operate, and improve the Service.</li>
            <li>Calculate pay estimates and audits based on your schedule data.</li>
            <li>Authenticate your account and maintain session security.</li>
            <li>Send service-related communications such as receipts, account notices, and updates.</li>
            <li>Respond to your support requests and inquiries.</li>
            <li>Comply with applicable legal obligations.</li>
          </ul>
          <p>We do not sell your personal information to third parties.</p>
        </Section>

        <Section title="4. Payment Information">
          <p>
            Payment processing for subscriptions is handled by third-party processors including Apple
            (App Store), Google (Google Play), and Stripe. We do not store your credit card numbers
            or full payment details on our servers. Subscription billing, renewals, and refunds are
            governed by the applicable third-party processor's terms and privacy policy.
          </p>
          <p>
            We may receive limited transaction metadata (such as subscription status, purchase date,
            and transaction ID) from these processors to manage your account entitlements.
          </p>
        </Section>

        <Section title="5. Data Sharing">
          <p>
            We do not share your personal information with third parties except in the following
            circumstances:
          </p>
          <ul>
            <li>
              <strong>Service providers:</strong> Trusted vendors who help us operate the Service
              (e.g., hosting, analytics, payment processing) under strict confidentiality obligations.
            </li>
            <li>
              <strong>Legal requirements:</strong> When required by law, court order, or government
              authority.
            </li>
            <li>
              <strong>Business transfers:</strong> In connection with a merger, acquisition, or sale
              of assets, where your information may be transferred to a successor entity.
            </li>
          </ul>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We retain your account information for as long as your account is active. If you delete
            your account, we will delete your personal information within 30 days, except where
            retention is required by law or legitimate business necessity (e.g., fraud prevention,
            legal disputes).
          </p>
        </Section>

        <Section title="7. Account Deletion">
          <p>
            You may delete your account at any time from within the app under Settings → Delete
            Account. Upon deletion, your account data and associated schedule information will be
            permanently removed from our systems within 30 days. Anonymized, aggregated data that
            cannot be linked back to you may be retained for analytical purposes.
          </p>
        </Section>

        <Section title="8. Security">
          <p>
            We implement industry-standard security measures including encrypted data transmission
            (TLS/HTTPS), hashed password storage, and access controls to protect your information.
            No method of transmission over the internet is 100% secure, and we cannot guarantee
            absolute security. We encourage you to use a strong, unique password for your account.
          </p>
        </Section>

        <Section title="9. Children's Privacy">
          <p>
            The Service is not directed to children under the age of 13. We do not knowingly collect
            personal information from children. If you believe we have inadvertently collected such
            information, please contact us immediately.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by updating the "Last updated" date above and, where appropriate, through
            in-app or email notification. Continued use of the Service after any changes constitutes
            acceptance of the revised policy.
          </p>
        </Section>

        <Section title="11. Contact Us" last>
          <p>
            If you have questions about this Privacy Policy or wish to exercise your privacy rights,
            please contact us at:
          </p>
          <p>
            <strong style={{ color: '#60a5fa' }}>pilotpaytracker@outlook.com</strong>
          </p>
        </Section>
      </article>

      {/* Footer */}
      <footer
        style={{
          color: '#334155',
          fontSize: '13px',
          textAlign: 'center',
          paddingBottom: '32px',
          display: 'flex',
          gap: '20px',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <span>© 2025 Pilot Pay Tracker · All rights reserved</span>
        <span>·</span>
        <a href="/privacy" style={{ color: '#475569', textDecoration: 'none' }}>Privacy Policy</a>
        <span>·</span>
        <a href="/terms" style={{ color: '#475569', textDecoration: 'none' }}>Terms of Use</a>
      </footer>
    </main>
  )
}

function Section({
  title,
  children,
  last,
}: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <section
      style={{
        marginBottom: last ? 0 : '36px',
        paddingBottom: last ? 0 : '36px',
        borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '700',
          color: '#e2e8f0',
          margin: '0 0 16px',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          color: '#94a3b8',
          fontSize: '15px',
          lineHeight: 1.75,
        }}
      >
        {children}
      </div>
    </section>
  )
}
