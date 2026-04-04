import { useState, useMemo } from 'react';
import {
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  Plane,
  AlertTriangle,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { useTrips, useProfile } from '@/lib/hooks';
import {
  formatCentsToCurrency,
  formatCentsToExact,
  formatMinutesToHHMM,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { ErrorMessage } from '@/components/ErrorMessage';

// UPS pay constants (matches mobile pay-check-logic.ts)
const MONTHLY_GUARANTEE_MINUTES = 75 * 60; // 4500 minutes
const ADVANCE_PAY_PERCENT = 50;

interface EarningsLine {
  label: string;
  description: string;
  amountCents: number;
  creditMinutes?: number;
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  accent?: 'blue' | 'emerald' | 'amber';
}) {
  const colors = {
    blue: 'text-blue-300',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
  };
  return (
    <div className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-slate-500 mb-2">
        <Icon size={13} />
        <span className="text-[11px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={cn('text-[18px] font-bold font-mono', accent ? colors[accent] : 'text-white')}>
        {value}
      </p>
    </div>
  );
}

export default function PaySummaryPage() {
  const { data: profileData } = useProfile();
  const profile = profileData?.profile;
  const hourlyRate = profile?.hourlyRateCents ?? 0;

  const [periodOffset, setPeriodOffset] = useState(0);
  const [checkType, setCheckType] = useState<'big' | 'small'>('big');

  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1);
  const startDate = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
  const endDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  const { data: tripsData, isLoading, isError, refetch } = useTrips(startDate, endDate);
  const trips = tripsData?.trips ?? [];

  const totals = useMemo(() => {
    const totalCreditMinutes = trips.reduce((s, t) => s + t.totalCreditMinutes, 0);
    const totalBlockMinutes = trips.reduce((s, t) => s + t.totalBlockMinutes, 0);
    const totalPayCents = trips.reduce((s, t) => s + t.totalPayCents, 0);
    const totalPdiemCents = trips.reduce((s, t) => s + t.totalPdiemCents, 0);
    const totalPremiumCents = trips.reduce((s, t) => s + t.premiumCents, 0);
    const totalTafbMinutes = trips.reduce((s, t) => s + t.totalTafbMinutes, 0);

    const guaranteeMinutes = MONTHLY_GUARANTEE_MINUTES;
    const guaranteeCents = Math.round((guaranteeMinutes / 60) * hourlyRate);
    const creditAboveGuarantee = Math.max(0, totalCreditMinutes - guaranteeMinutes);
    const overageCents = Math.round((creditAboveGuarantee / 60) * hourlyRate);
    const isAboveGuarantee = totalCreditMinutes >= guaranteeMinutes;
    const guaranteePct = Math.min(100, Math.round((totalCreditMinutes / guaranteeMinutes) * 100));

    return {
      totalCreditMinutes,
      totalBlockMinutes,
      totalPayCents,
      totalPdiemCents,
      totalPremiumCents,
      totalTafbMinutes,
      guaranteeMinutes,
      guaranteeCents,
      creditAboveGuarantee,
      overageCents,
      isAboveGuarantee,
      guaranteePct,
    };
  }, [trips, hourlyRate]);

  const earnings = useMemo((): EarningsLine[] => {
    const lines: EarningsLine[] = [];

    if (checkType === 'small') {
      const advanceCents = Math.round(totals.guaranteeCents * (ADVANCE_PAY_PERCENT / 100));
      lines.push({
        label: 'Advance Pay (50% Guarantee)',
        description: `${(MONTHLY_GUARANTEE_MINUTES / 60 / 2).toFixed(1)} hrs @ $${(hourlyRate / 100).toFixed(2)}/hr`,
        amountCents: advanceCents,
        creditMinutes: MONTHLY_GUARANTEE_MINUTES / 2,
      });
    } else {
      const remainingGuaranteeCents = Math.round(totals.guaranteeCents * (1 - ADVANCE_PAY_PERCENT / 100));
      lines.push({
        label: 'Settlement (Remaining Guarantee)',
        description: `${(MONTHLY_GUARANTEE_MINUTES / 60 / 2).toFixed(1)} hrs @ $${(hourlyRate / 100).toFixed(2)}/hr`,
        amountCents: remainingGuaranteeCents,
        creditMinutes: MONTHLY_GUARANTEE_MINUTES / 2,
      });

      if (totals.overageCents > 0) {
        lines.push({
          label: 'Credit Above Guarantee',
          description: `${formatMinutesToHHMM(totals.creditAboveGuarantee)} overage`,
          amountCents: totals.overageCents,
          creditMinutes: totals.creditAboveGuarantee,
        });
      }

      if (totals.totalPremiumCents > 0) {
        lines.push({
          label: 'Premium Pay',
          description: 'JA, junior manning, overrides',
          amountCents: totals.totalPremiumCents,
        });
      }

      if (totals.totalPdiemCents > 0) {
        lines.push({
          label: 'Per Diem',
          description: `${formatMinutesToHHMM(totals.totalTafbMinutes)} TAFB`,
          amountCents: totals.totalPdiemCents,
        });
      }
    }

    return lines;
  }, [checkType, totals, hourlyRate]);

  const grossCents = earnings.reduce((s, e) => s + e.amountCents, 0);

  const periodLabel = targetDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-7">

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-7">
        {/* Month navigator */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg p-1">
          <button
            onClick={() => setPeriodOffset((p) => p - 1)}
            className="p-1.5 rounded-md hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[13px] font-semibold text-white px-2 min-w-[130px] text-center">
            {periodLabel}
          </span>
          <button
            onClick={() => setPeriodOffset((p) => p + 1)}
            className="p-1.5 rounded-md hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Check type toggle */}
        <div className="flex items-center bg-white/[0.04] border border-white/[0.06] rounded-lg p-1">
          <button
            onClick={() => setCheckType('small')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
              checkType === 'small'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <DollarSign size={13} />
            Small Check
          </button>
          <button
            onClick={() => setCheckType('big')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
              checkType === 'big'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <TrendingUp size={13} />
            Big Check
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Info size={12} />
          <span>
            {checkType === 'small'
              ? '50% advance on monthly guarantee'
              : 'Settlement + overage + premiums + per diem'}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : isError ? (
        <ErrorMessage
          message="Could not load pay data. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Left: Pay statement (2 cols wide) */}
          <div className="xl:col-span-2 space-y-5">

            {/* Guarantee utilization bar */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  {totals.isAboveGuarantee ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <Clock size={14} className="text-amber-400" />
                  )}
                  <span className="text-sm font-medium text-white">
                    Monthly Guarantee ({formatMinutesToHHMM(MONTHLY_GUARANTEE_MINUTES)})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-sm font-mono font-semibold',
                    totals.isAboveGuarantee ? 'text-emerald-400' : 'text-amber-400'
                  )}>
                    {formatMinutesToHHMM(totals.totalCreditMinutes)}
                  </span>
                  <span className="text-xs text-slate-500">/ {formatMinutesToHHMM(MONTHLY_GUARANTEE_MINUTES)}</span>
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    totals.isAboveGuarantee
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-amber-500/15 text-amber-400'
                  )}>
                    {totals.guaranteePct}%
                  </span>
                </div>
              </div>
              <div className="w-full h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700',
                    totals.isAboveGuarantee ? 'bg-emerald-500' : 'bg-amber-500'
                  )}
                  style={{ width: `${totals.guaranteePct}%` }}
                />
              </div>
              {totals.isAboveGuarantee && totals.creditAboveGuarantee > 0 && (
                <p className="text-xs text-emerald-400/70 mt-1.5">
                  +{formatMinutesToHHMM(totals.creditAboveGuarantee)} above guarantee — overage pay applies
                </p>
              )}
            </div>

            {/* Pay statement card */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              {/* Statement header */}
              <div className="px-6 py-4 border-b border-white/[0.05] bg-gradient-to-r from-slate-800/60 to-slate-900/60">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
                      Estimated Pay Statement
                    </p>
                    <p className="text-[18px] font-bold text-white">{periodLabel}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {checkType === 'small' ? 'Advance Check (1st of month)' : 'Settlement Check (15th of month)'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-white">
                      {profile
                        ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || 'Pilot'
                        : '—'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {profile?.position ?? ''} · {profile?.base ?? ''}
                    </p>
                    {profile?.gemsId && (
                      <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
                        GEMS {profile.gemsId}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Earnings table */}
              <div className="px-6 py-5">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                  Earnings
                </h3>

                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-2.5 border-b border-white/[0.06]">
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider">Description</span>
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider w-20 text-right">Hours</span>
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider w-28 text-right">Amount</span>
                </div>

                {earnings.map((line, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_auto_auto] gap-4 py-3.5 border-b border-white/[0.03] last:border-0"
                  >
                    <div>
                      <p className="text-[13px] text-white font-medium">{line.label}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{line.description}</p>
                    </div>
                    <span className="text-[13px] font-mono text-slate-400 w-20 text-right self-center">
                      {line.creditMinutes != null ? formatMinutesToHHMM(line.creditMinutes) : '—'}
                    </span>
                    <span className="text-[13px] font-mono text-white w-28 text-right self-center font-medium">
                      {formatCentsToExact(line.amountCents)}
                    </span>
                  </div>
                ))}

                {/* Gross total */}
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.10]">
                  <span className="text-base font-bold text-white">Estimated Gross Pay</span>
                  <span className="text-2xl font-bold text-white tracking-tight">
                    {formatCentsToExact(grossCents)}
                  </span>
                </div>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10 px-4 py-3">
              <AlertTriangle size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                This is an estimated pay summary for planning purposes only. It is NOT an official payroll
                document. Actual compensation may differ based on final schedule adjustments, pay
                protections, and company payroll processing.
              </p>
            </div>
          </div>

          {/* Right: Period stats sidebar */}
          <div className="space-y-4">
            {/* Period stats */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.05]">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Period Stats
                </p>
              </div>
              <div className="p-5 space-y-4">
                {[
                  { label: 'Credit Time', value: formatMinutesToHHMM(totals.totalCreditMinutes), mono: true, color: 'text-blue-300' },
                  { label: 'Block Time', value: formatMinutesToHHMM(totals.totalBlockMinutes), mono: true, color: 'text-slate-300' },
                  { label: 'Trips', value: String(trips.length), mono: false, color: 'text-white' },
                  { label: 'TAFB', value: formatMinutesToHHMM(totals.totalTafbMinutes), mono: true, color: 'text-slate-300' },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{stat.label}</span>
                    <span className={cn('text-[13px] font-semibold', stat.color, stat.mono && 'font-mono')}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pay components breakdown */}
            {checkType === 'big' && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.05]">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Pay Components
                  </p>
                </div>
                <div className="p-5 space-y-3">
                  {[
                    {
                      label: 'Base Guarantee',
                      value: formatCentsToCurrency(totals.guaranteeCents),
                      sub: `75 hrs @ $${(hourlyRate / 100).toFixed(2)}/hr`,
                    },
                    totals.overageCents > 0
                      ? {
                          label: 'Overage Pay',
                          value: formatCentsToCurrency(totals.overageCents),
                          sub: `+${formatMinutesToHHMM(totals.creditAboveGuarantee)} above GTY`,
                          green: true,
                        }
                      : null,
                    totals.totalPremiumCents > 0
                      ? {
                          label: 'Premium Pay',
                          value: formatCentsToCurrency(totals.totalPremiumCents),
                          sub: 'JA / junior manning',
                          green: true,
                        }
                      : null,
                    totals.totalPdiemCents > 0
                      ? {
                          label: 'Per Diem',
                          value: formatCentsToCurrency(totals.totalPdiemCents),
                          sub: `${formatMinutesToHHMM(totals.totalTafbMinutes)} TAFB`,
                        }
                      : null,
                  ]
                    .filter(Boolean)
                    .map((item) => item && (
                      <div key={item.label}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">{item.label}</span>
                          <span className={cn(
                            'text-xs font-semibold font-mono',
                            'green' in item && item.green ? 'text-emerald-400' : 'text-white'
                          )}>
                            {item.value}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">{item.sub}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Hourly rate context */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Rate Info
              </p>
              <p className="text-2xl font-bold text-white tracking-tight">
                ${(hourlyRate / 100).toFixed(2)}
                <span className="text-sm font-normal text-slate-500">/hr</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {profile?.position ?? 'N/A'} · {profile?.airline ?? 'UPS'}
              </p>
              <div className="mt-3 pt-3 border-t border-white/[0.05]">
                <p className="text-xs text-slate-500">Monthly guarantee</p>
                <p className="text-sm font-mono font-semibold text-slate-300 mt-0.5">
                  {formatMinutesToHHMM(MONTHLY_GUARANTEE_MINUTES)} (75 hrs)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
