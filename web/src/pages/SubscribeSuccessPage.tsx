import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plane, CheckCircle, ArrowRight, Clock } from 'lucide-react';
import { useSession } from '@/lib/auth';
import { api } from '@/lib/api';

interface SubscriptionStatus {
  subscriptionStatus: 'free' | 'trialing' | 'active' | 'expired';
  plan: string | null;
  trialEndsAt: string | null;
}

export default function SubscribeSuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { data: authSession } = useSession();
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);

  // Refresh subscription status from backend after successful checkout
  useEffect(() => {
    if (!authSession?.user) return;
    api.get<SubscriptionStatus>('/api/subscription/status')
      .then(setSubStatus)
      .catch(() => setSubStatus(null));
  }, [authSession?.user, sessionId]);

  const isTrialing = subStatus?.subscriptionStatus === 'trialing';
  const isActive = subStatus?.subscriptionStatus === 'active';

  const trialEndsAt = subStatus?.trialEndsAt
    ? new Date(subStatus.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 rounded-3xl bg-amber-500/20 flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={40} className="text-amber-400" />
        </div>

        {isTrialing ? (
          <>
            <h1 className="text-3xl font-bold text-white mb-3">Trial Started!</h1>
            <p className="text-slate-400 mb-4 leading-relaxed">
              Your account is created and your 7-day free trial is now active.
            </p>
            {trialEndsAt && (
              <div className="flex items-center justify-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-6">
                <Clock size={16} className="text-amber-400 shrink-0" />
                <p className="text-amber-400 text-sm font-medium">
                  Trial ends {trialEndsAt}
                </p>
              </div>
            )}
            <p className="text-slate-500 text-sm mb-8 leading-relaxed">
              After your trial, subscribe here on the website to keep access.
              Open the mobile app to start tracking your pay.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-white mb-3">
              {isActive ? "You're Subscribed!" : "Account Ready!"}
            </h1>
            <p className="text-slate-400 mb-8 leading-relaxed">
              {isActive
                ? `Your ${subStatus?.plan ?? ''} subscription is now active. Log in to the mobile app to start tracking your pay.`
                : "Your account is set up. Log in to the mobile app to get started."}
            </p>
          </>
        )}

        <div className="space-y-3">
          {authSession?.user ? (
            <Link
              to="/"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              Go to Dashboard
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              Log In
              <ArrowRight size={16} />
            </Link>
          )}
        </div>

        <p className="text-slate-600 text-xs mt-8 flex items-center justify-center gap-2">
          <Plane size={12} />
          Pilot Pay Tracker
        </p>
      </div>
    </div>
  );
}
