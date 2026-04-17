export const metadata = {
  title: 'Terms of Use — Pilot Pay Tracker',
  description: 'Terms of Use for Pilot Pay Tracker',
}

export default function TermsPage() {
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
          Terms of Use
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 40px' }}>
          Last updated: April 16, 2025
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By creating an account or using Pilot Pay Tracker (the "Service"), you agree to be bound
            by these Terms of Use ("Terms"). If you do not agree to these Terms, do not use the
            Service. These Terms constitute a legally binding agreement between you and Pilot Pay
            Tracker ("we," "our," or "us").
          </p>
        </Section>

        <Section title="2. Account Usage">
          <p>
            You must be at least 18 years of age and an active or former airline pilot to use the
            Service. You are responsible for maintaining the confidentiality of your account
            credentials and for all activity that occurs under your account.
          </p>
          <ul>
            <li>You agree to provide accurate and current information when creating your account.</li>
            <li>You may not share your account with others or create accounts on behalf of third parties.</li>
            <li>
              You are solely responsible for ensuring the accuracy of schedule and pay data you enter
              into the Service.
            </li>
            <li>
              We reserve the right to suspend or terminate accounts that violate these Terms or that
              we reasonably believe are engaged in fraudulent or abusive activity.
            </li>
          </ul>
        </Section>

        <Section title="3. Subscription and Access">
          <p>
            Access to full features of the Service requires an active paid subscription. We offer
            subscription plans on a monthly or annual basis, as displayed at the time of purchase.
          </p>
          <ul>
            <li>
              <strong>Free trial:</strong> New users may be offered a limited free trial period.
              After the trial ends, continued access requires a paid subscription.
            </li>
            <li>
              <strong>Subscription activation:</strong> Your subscription begins immediately upon
              successful payment processing.
            </li>
            <li>
              <strong>Feature access:</strong> We reserve the right to modify, limit, or discontinue
              features at any time with reasonable notice.
            </li>
          </ul>
        </Section>

        <Section title="4. Payment Processing">
          <p>
            Payments are processed by third-party providers including Apple (App Store), Google
            (Google Play), and Stripe, depending on your platform and payment method. By initiating
            a purchase, you agree to the applicable third-party processor's terms of service and
            privacy policy.
          </p>
          <ul>
            <li>All prices are displayed in US dollars unless otherwise indicated.</li>
            <li>Subscription fees are charged at the beginning of each billing period.</li>
            <li>
              We do not store your full payment card information. Payment details are handled
              directly by the applicable payment processor.
            </li>
            <li>
              Taxes may apply depending on your jurisdiction and are your responsibility unless
              stated otherwise.
            </li>
          </ul>
        </Section>

        <Section title="5. Cancellation">
          <p>
            You may cancel your subscription at any time through the platform you used to subscribe
            (App Store, Google Play, or your account settings). Cancellation takes effect at the end
            of the current billing period — you will retain access to the Service until that date.
          </p>
          <ul>
            <li>
              <strong>App Store (iOS):</strong> Manage or cancel via iPhone Settings → Apple ID →
              Subscriptions.
            </li>
            <li>
              <strong>Google Play (Android):</strong> Manage or cancel via Google Play Store →
              Subscriptions.
            </li>
            <li>
              <strong>Web:</strong> Cancel via your account Settings page or by contacting us.
            </li>
          </ul>
          <p>
            Refunds are subject to the refund policy of the applicable payment processor. We do not
            issue partial refunds for unused portions of a billing period unless required by law.
          </p>
        </Section>

        <Section title="6. Disclaimer of Warranties">
          <p>
            The Service is provided on an "as is" and "as available" basis without warranties of any
            kind, either express or implied. We do not warrant that the Service will be uninterrupted,
            error-free, or completely secure.
          </p>
          <p>
            Pay calculations, estimates, and audits produced by the Service are for informational
            purposes only and are not a substitute for official payroll records, union guidance, or
            professional financial advice. Always verify pay discrepancies through official channels.
          </p>
        </Section>

        <Section title="7. Limitation of Liability">
          <p>
            To the fullest extent permitted by applicable law, Pilot Pay Tracker and its officers,
            directors, employees, and affiliates shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from your use of or inability to
            use the Service, including but not limited to lost wages, lost profits, or data loss.
          </p>
          <p>
            Our total cumulative liability to you for any claims arising from or related to these
            Terms or the Service shall not exceed the total amount you paid us in the twelve (12)
            months preceding the claim.
          </p>
        </Section>

        <Section title="8. Intellectual Property">
          <p>
            All content, features, and functionality of the Service — including but not limited to
            text, graphics, logos, and software — are the exclusive property of Pilot Pay Tracker
            and are protected by applicable intellectual property laws. You may not copy, modify,
            distribute, or create derivative works without our prior written consent.
          </p>
        </Section>

        <Section title="9. Changes to Terms">
          <p>
            We may revise these Terms at any time. We will provide notice of material changes by
            updating the "Last updated" date above and, where appropriate, through in-app or email
            notification. Your continued use of the Service after any changes constitutes acceptance
            of the revised Terms.
          </p>
        </Section>

        <Section title="10. Governing Law">
          <p>
            These Terms are governed by and construed in accordance with the laws of the United
            States, without regard to conflict of law principles. Any disputes arising under these
            Terms shall be resolved in the courts of competent jurisdiction in the United States.
          </p>
        </Section>

        <Section title="11. Contact Us" last>
          <p>
            If you have questions about these Terms or the Service, please contact us at:
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
