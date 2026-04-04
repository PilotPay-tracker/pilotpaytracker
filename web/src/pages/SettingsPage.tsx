import {
  User,
  IdCard,
  Plane,
  MapPin,
  DollarSign,
  Calendar,
  Settings as SettingsIcon,
  Shield,
  Clock,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';
import { useProfile, useProfileStats } from '@/lib/hooks';
import { formatCentsToCurrency, formatMinutesToHHMM, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ErrorMessage } from '@/components/ErrorMessage';

function InfoRow({
  icon: Icon,
  label,
  value,
  valueColor,
}: {
  icon: typeof User;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-3">
        <Icon size={14} className="text-slate-600 flex-shrink-0" />
        <span className="text-[13px] text-slate-400">{label}</span>
      </div>
      <span className={cn('text-[13px] font-medium', valueColor ?? 'text-white')}>
        {value}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'blue';
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={cn(
        'text-[20px] font-bold tracking-tight',
        accent === 'green' ? 'text-emerald-400' : accent === 'blue' ? 'text-blue-400' : 'text-white'
      )}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function calculateRetirementDate(dob: string): string {
  const date = new Date(dob + 'T12:00:00');
  date.setFullYear(date.getFullYear() + 65);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMonthsActive(dateOfHire: string): number {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(dateOfHire + 'T00:00:00').getTime()) /
        (1000 * 60 * 60 * 24 * 30.44)
    )
  );
}

export default function SettingsPage() {
  const { data: profileData, isLoading: profileLoading, isError: profileError, refetch: refetchProfile } = useProfile();
  const { data: stats, isLoading: statsLoading } = useProfileStats();
  const profile = profileData?.profile;

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex items-center justify-center h-full">
        <ErrorMessage
          message="Could not load profile data. Check your connection and try again."
          onRetry={() => void refetchProfile()}
        />
      </div>
    );
  }

  const initials =
    (profile?.firstName?.[0] ?? '') + (profile?.lastName?.[0] ?? '');
  const monthsActive = profile?.dateOfHire ? getMonthsActive(profile.dateOfHire) : null;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-7">

      {/* Profile hero */}
      <div className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-slate-800/40 to-navy-900/40 p-6 mb-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-blue-900/40 flex-shrink-0">
            {initials || '?'}
          </div>

          {/* Name + details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {profile?.firstName && profile?.lastName
                  ? `${profile.firstName} ${profile.lastName}`
                  : 'Unnamed Pilot'}
              </h2>
              <span className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-bold border',
                profile?.position === 'CPT'
                  ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                  : 'bg-blue-500/20 border-blue-500/30 text-blue-400'
              )}>
                {profile?.position ?? 'N/A'}
              </span>
              {(profile?.subscriptionStatus === 'active' || profile?.trialStatus === 'active') && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-violet-500/20 border-violet-500/30 text-violet-400">
                  {profile?.subscriptionStatus === 'active' ? 'PREMIUM' : 'TRIAL'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {profile?.airline && (
                <span className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Plane size={12} className="text-slate-500" />
                  {profile.airline}
                </span>
              )}
              {profile?.base && (
                <span className="flex items-center gap-1.5 text-sm text-slate-400">
                  <MapPin size={12} className="text-slate-500" />
                  {profile.base}
                </span>
              )}
              {profile?.hourlyRateCents && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400 font-medium">
                  <DollarSign size={12} />
                  ${(profile.hourlyRateCents / 100).toFixed(2)}/hr
                </span>
              )}
              {monthsActive !== null && (
                <span className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Calendar size={12} />
                  {monthsActive} months at airline
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Career stats grid */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="h-2.5 bg-white/[0.05] rounded w-2/3 mb-3" />
              <div className="h-6 bg-white/[0.05] rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          <StatCard
            label="Total Trips"
            value={String(stats.trips.scheduled + stats.trips.inProgress + stats.trips.completed)}
          />
          <StatCard
            label="Total Flights"
            value={String(stats.allTime.flightCount)}
          />
          <StatCard
            label="Block Time"
            value={formatMinutesToHHMM(stats.allTime.blockMinutes)}
            accent="blue"
          />
          <StatCard
            label="Credit Time"
            value={formatMinutesToHHMM(stats.allTime.creditMinutes)}
            accent="blue"
          />
          <StatCard
            label="Total Earnings"
            value={formatCentsToCurrency(stats.allTime.totalPayCents)}
            accent="green"
          />
          <StatCard
            label="Months Active"
            value={monthsActive != null ? String(monthsActive) : '—'}
            sub={profile?.dateOfHire ? `since ${formatDate(profile.dateOfHire)}` : undefined}
          />
        </div>
      ) : null}

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* Pilot profile card */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.05]">
            <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
              <User size={14} className="text-blue-400" />
              Pilot Profile
            </h2>
          </div>
          <div className="px-5 py-2">
            <InfoRow
              icon={User}
              label="Full Name"
              value={
                profile?.firstName && profile?.lastName
                  ? `${profile.firstName} ${profile.lastName}`
                  : 'Not set'
              }
            />
            <InfoRow
              icon={IdCard}
              label="GEMS ID"
              value={profile?.gemsId ?? 'Not set'}
            />
            <InfoRow
              icon={Plane}
              label="Position"
              value={profile?.position ?? 'Not set'}
              valueColor={profile?.position === 'CPT' ? 'text-amber-400' : 'text-blue-400'}
            />
            <InfoRow
              icon={MapPin}
              label="Base"
              value={profile?.base ?? 'Not set'}
            />
            <InfoRow
              icon={DollarSign}
              label="Hourly Rate"
              value={
                profile?.hourlyRateCents
                  ? `$${(profile.hourlyRateCents / 100).toFixed(2)}/hr`
                  : 'Not set'
              }
              valueColor="text-emerald-400"
            />
            <InfoRow
              icon={Calendar}
              label="Date of Hire"
              value={profile?.dateOfHire ? formatDate(profile.dateOfHire) : 'Not set'}
            />
            {profile?.dateOfBirth && (
              <InfoRow
                icon={Calendar}
                label="Mandatory Retirement"
                value={calculateRetirementDate(profile.dateOfBirth)}
                valueColor="text-slate-300"
              />
            )}
          </div>
        </div>

        {/* Configuration + edit hint */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
                <SettingsIcon size={14} className="text-blue-400" />
                Configuration
              </h2>
            </div>
            <div className="px-5 py-2">
              <InfoRow
                icon={Plane}
                label="Airline"
                value={profile?.airline ?? 'UPS'}
              />
              <InfoRow
                icon={Shield}
                label="Subscription"
                value={
                  profile?.subscriptionStatus === 'active'
                    ? 'Premium'
                    : profile?.trialStatus === 'active'
                      ? 'Trial Active'
                      : 'Free'
                }
                valueColor={
                  profile?.subscriptionStatus === 'active'
                    ? 'text-amber-400'
                    : profile?.trialStatus === 'active'
                      ? 'text-violet-400'
                      : 'text-slate-400'
                }
              />
              <InfoRow
                icon={CheckCircle2}
                label="Onboarding"
                value={profile?.onboardingComplete ? 'Complete' : 'Incomplete'}
                valueColor={profile?.onboardingComplete ? 'text-emerald-400' : 'text-amber-400'}
              />
            </div>
          </div>

          {/* Edit hint */}
          <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Smartphone size={15} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-300 mb-1">
                  Edit from the Mobile App
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Profile updates are made in the PilotPay iOS app. Any changes
                  sync automatically to the web dashboard.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
