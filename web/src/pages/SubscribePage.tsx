import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Plane, Check, Shield, Clock, Sparkles, ExternalLink, CheckCircle, Crown, AlertTriangle } from 'lucide-react';
import { useSession } from '@/lib/auth';
import { api } from '@/lib/api';

const FEATURES = [
  'Unlimited Trip Board imports',
  'AI-powered schedule change detection',
  'Pay confidence scoring',
  'Annual earnings projections',
  '30-in-7 FAR compliance tracking',
  'Priority pilot support',
];

type Plan = 'monthly' | 'yearly';

interface StripeStatus {
  configured: boolean;
  hasMonthlyPrice: boolean;
  hasYearlyPrice: boolean;
}

export default function SubscribePage() {
  const [searchParams] = useSearchParams();
  const initialPlan = (searchParams.get('plan') as Plan) ?? 'yearly';
  const [selectedPlan, setSelectedPlan] = useState<Plan>(initialPlan);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  // Check if Stripe is configured
  useEffect(() => {
    api.get<StripeStatus>('/api/stripe/status')
      .then(setStripeStatus)
      .catch(() => setStripeStatus({ configured: false, hasMonthlyPrice: false, hasYearlyPrice: false }));
  }, []);

  const handleSubscribe = async (plan: Plan) => {
    if (!session?.user) {
      navigate(`/signup?redirect=subscribe&plan=${plan}`);
      return;
    }

    if (!stripeStatus?.configured) {
      setError('Payments are not yet configured. Please contact support.');
      return;
    }

    setLoadingPlan(plan);
    setIsLoading(true);
    setError('');

    try {
      const result = await api.post<{ url: string }>('/api/stripe/create-checkout', { plan });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not start checkout. Please try again.';
      setError(msg);
    } finally {
      setIsLoading(false);
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
              <Plane size={18} className="text-slate-900" />
            </div>
            <span className="font-bold text-lg text-white">Pilot Pay Tracker</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {session?.user ? (
              <Link to="/" className="text-slate-400 hover:text-white transition-colors">
                Back to app
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-slate-400 hover:text-white transition-colors">Log In</Link>
                <Link to="/signup" className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-1.5 rounded-lg transition-colors">
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 mb-6">
            <Sparkles size={14} className="text-amber-400" />
            <span className="text-amber-400 text-sm font-medium">7-day free trial included</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
            Make Sure You're Getting<br />Paid Correctly
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Track, audit, and verify your pay using real UPS schedule data.
            Start free — no credit card required.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-start">
          {/* Pricing cards */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-5">Choose your plan</h2>

            {/* Annual */}
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-500/5 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-lg">Annual Plan</span>
                    <span className="bg-amber-500 text-slate-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      BEST VALUE
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm">2 months free vs. monthly</p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-white font-bold text-2xl">$99.99</div>
                  <div className="text-slate-500 text-xs">/year</div>
                </div>
              </div>
              <button
                onClick={() => handleSubscribe('yearly')}
                disabled={isLoading || isPending}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loadingPlan === 'yearly' ? (
                  <span>Opening checkout...</span>
                ) : (
                  <>
                    <span>Start Annual Plan</span>
                    <ExternalLink size={15} />
                  </>
                )}
              </button>
            </div>

            {/* Monthly */}
            <div className="rounded-2xl border border-white/10 bg-white/3 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-lg">Monthly Plan</span>
                  </div>
                  <p className="text-slate-400 text-sm">Flexible, cancel anytime</p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <div className="text-white font-bold text-2xl">$9.99</div>
                  <div className="text-slate-500 text-xs">/month</div>
                </div>
              </div>
              <button
                onClick={() => handleSubscribe('monthly')}
                disabled={isLoading || isPending}
                className="w-full border border-white/15 hover:border-white/30 text-white font-bold py-3.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loadingPlan === 'monthly' ? (
                  <span>Opening checkout...</span>
                ) : (
                  <>
                    <span>Start Monthly Plan</span>
                    <ExternalLink size={15} />
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <span className="text-red-400 text-sm">{error}</span>
              </div>
            )}

            <p className="text-slate-500 text-xs text-center pt-1">
              Prices shown after 7-day free trial. Cancel anytime.
            </p>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                <Shield size={12} className="text-slate-500" />
                Secure checkout via Stripe
              </div>
              <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                <Clock size={12} className="text-slate-500" />
                Cancel anytime
              </div>
            </div>
          </div>

          {/* What's included */}
          <div className="bg-white/3 border border-white/8 rounded-2xl p-6">
            <h3 className="font-semibold text-white mb-5">Everything included</h3>
            <ul className="space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <CheckCircle size={18} className="text-amber-400 shrink-0" />
                  <span className="text-slate-300 text-sm">{f}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 pt-6 border-t border-white/8">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Crown size={20} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Works on iPhone & web</p>
                  <p className="text-slate-500 text-xs">Same account everywhere</p>
                </div>
              </div>
              <p className="text-slate-500 text-xs leading-relaxed">
                Download the Pilot Pay Tracker app from the App Store to access your account on mobile.
                Subscribe on the website and your access unlocks instantly in the app.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
