'use client'

import Link from 'next/link'
import {
  Plane,
  Clock,
  DollarSign,
  TrendingUp,
  Calendar,
  AlertCircle,
  ArrowUpRight,
  Activity,
  ChevronRight,
} from 'lucide-react'
import { useDashboard, useProfile, useTrips, useProjections } from '@/lib/hooks'
import { formatCentsToCurrency, formatMinutesToHHMM, formatDateShort } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ErrorMessage } from '@/components/ErrorMessage'

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'blue',
  badge,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof Clock
  accent?: 'blue' | 'green' | 'amber' | 'purple'
  badge?: string
}) {
  const styles = {
    blue: {
      card: 'border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-blue-600/5',
      icon: 'bg-blue-500/15 text-blue-400',
      text: 'text-blue-400',
    },
    green: {
      card: 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5',
      icon: 'bg-emerald-500/15 text-emerald-400',
      text: 'text-emerald-400',
    },
    amber: {
      card: 'border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-600/5',
      icon: 'bg-amber-500/15 text-amber-400',
      text: 'text-amber-400',
    },
    purple: {
      card: 'border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-violet-600/5',
      icon: 'bg-violet-500/15 text-violet-400',
      text: 'text-violet-400',
    },
  }
  const s = styles[accent]

  return (
    <div className={cn('rounded-xl border p-5 relative overflow-hidden', s.card)}>
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', s.icon)}>
          <Icon size={17} strokeWidth={1.8} />
        </div>
        {badge && (
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', s.card, s.text, 'border-current/30')}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-[26px] font-bold text-white tracking-tight leading-none mb-1">
        {value}
      </p>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      {sub && <p className="text-[11px] text-slate-600 mt-1">{sub}</p>}
    </div>
  )
}

function FlightRow({
  flight,
}: {
  flight: {
    dateISO: string
    flightNumber: string | null
    origin: string | null
    destination: string | null
    blockMinutes: number
    creditMinutes: number
    totalPayCents: number
    id: string
  }
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-md bg-blue-500/10 flex items-center justify-center flex-shrink-0">
          <Plane size={12} className="text-blue-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white leading-tight">
            {flight.origin ?? '???'} → {flight.destination ?? '???'}
          </p>
          <p className="text-[11px] text-slate-500">
            {flight.flightNumber ?? 'N/A'} · {formatDateShort(flight.dateISO)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[13px] font-mono text-slate-300 leading-tight">
          {formatMinutesToHHMM(flight.blockMinutes)}
        </p>
        <p className="text-[10px] text-slate-600">block</p>
      </div>
      <div className="text-right w-20">
        <p className="text-[13px] font-mono text-emerald-400 leading-tight">
          {formatCentsToCurrency(flight.totalPayCents)}
        </p>
        <p className="text-[10px] text-slate-600">est.</p>
      </div>
    </div>
  )
}

function PeriodRow({ label, value, valueClass, highlight }: {
  label: string
  value: string
  valueClass?: string
  highlight?: boolean
}) {
  return (
    <div className={cn(
      'flex items-center justify-between py-2.5',
      highlight
        ? 'border-t border-white/[0.06] mt-2 pt-3.5'
        : 'border-b border-white/[0.04] last:border-0'
    )}>
      <span className="text-[13px] text-slate-400">{label}</span>
      <span className={cn('text-[13px] font-mono font-medium', valueClass ?? 'text-white')}>{value}</span>
    </div>
  )
}

export default function DashboardPage() {
  const { data: dashboard, isLoading, isError, refetch } = useDashboard()
  const { data: profileData } = useProfile()
  const { data: projData } = useProjections()
  const profile = profileData?.profile

  const now = new Date()
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const endDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
  const { data: tripsData } = useTrips(startDate, endDate)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <ErrorMessage
          message="Could not load dashboard data. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      </div>
    )
  }

  const d = dashboard
  const hourlyRate = d?.hourlyRateCents ?? profile?.hourlyRateCents ?? 0
  const completedTrips = tripsData?.trips?.filter(
    (t: any) => t.status === 'completed' || new Date(t.endDate) < now
  ).length ?? 0
  const totalTrips = tripsData?.trips?.length ?? 0
  const projectedAnnual = projData?.year?.projectedCents ?? null

  const GUARANTEE_MINUTES = 4500
  const creditMin = d?.totalCreditMinutes ?? 0
  const guaranteePct = Math.min(100, Math.round((creditMin / GUARANTEE_MINUTES) * 100))

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-7">
      {/* Guarantee alert banner */}
      {d?.isGuaranteeActive && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-300 font-medium">Guarantee Active</p>
            <p className="text-xs text-amber-400/70">
              Credit time ({formatMinutesToHHMM(creditMin)}) is below the 75-hour monthly guarantee. Pay will be floored at guarantee.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold text-amber-400">{guaranteePct}%</p>
            <p className="text-[10px] text-amber-500">of guarantee</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-7">
        <KPICard
          label="Gross Pay This Period"
          value={formatCentsToCurrency(d?.totalPayCents ?? 0)}
          sub={`${d?.entryCount ?? 0} flights logged`}
          icon={DollarSign}
          accent="green"
        />
        <KPICard
          label="Credit Hours"
          value={formatMinutesToHHMM(d?.totalCreditMinutes ?? 0)}
          sub={`${formatMinutesToHHMM(d?.totalBlockMinutes ?? 0)} block`}
          icon={Clock}
          accent="blue"
          badge={d?.isGuaranteeActive ? 'GTY' : undefined}
        />
        <KPICard
          label="Hourly Rate"
          value={`$${(hourlyRate / 100).toFixed(2)}`}
          sub={`${profile?.position ?? 'N/A'} · ${profile?.airline ?? 'UPS'}`}
          icon={TrendingUp}
          accent="purple"
        />
        <KPICard
          label="Trips This Month"
          value={String(totalTrips)}
          sub={`${completedTrips} completed`}
          icon={Plane}
          accent="amber"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Recent Flights */}
        <div className="xl:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
            <div className="flex items-center gap-2.5">
              <Activity size={15} className="text-blue-400" />
              <h2 className="text-[14px] font-semibold text-white">Recent Flights</h2>
            </div>
            <Link
              href="/trips"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
            >
              View all <ArrowUpRight size={11} />
            </Link>
          </div>
          {d?.recentFlights && d.recentFlights.length > 0 ? (
            <div className="px-5 py-2">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 pb-2 border-b border-white/[0.04]">
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Route</span>
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider text-right">Block</span>
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider text-right w-20">Est. Pay</span>
              </div>
              {d.recentFlights.slice(0, 8).map((flight: any) => (
                <FlightRow key={flight.id} flight={flight} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-600">
              <Plane size={32} className="mb-3 opacity-20" />
              <p className="text-sm font-medium text-slate-500">No recent flights</p>
              <p className="text-xs mt-1">Import your schedule from the mobile app</p>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Period Summary */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="px-5 py-4 border-b border-white/[0.05]">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-white">Period Summary</h2>
                {d && (
                  <span className="text-[11px] text-slate-500 bg-white/[0.04] px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Calendar size={10} />
                    {formatDateShort(d.periodStart)} – {formatDateShort(d.periodEnd)}
                  </span>
                )}
              </div>
            </div>
            <div className="px-5 py-3">
              <PeriodRow label="Block Time" value={formatMinutesToHHMM(d?.totalBlockMinutes ?? 0)} />
              <PeriodRow
                label="Credit Time"
                value={formatMinutesToHHMM(d?.totalCreditMinutes ?? 0)}
                valueClass="text-blue-300"
              />
              {(d?.paidCreditMinutes ?? 0) > 0 && (
                <PeriodRow label="Paid Credit" value={formatMinutesToHHMM(d?.paidCreditMinutes ?? 0)} />
              )}
              {(d?.jaPickupCreditMinutes ?? 0) > 0 && (
                <PeriodRow
                  label="JA Pickup"
                  value={`+${formatMinutesToHHMM(d?.jaPickupCreditMinutes ?? 0)}`}
                  valueClass="text-emerald-400"
                />
              )}
              <PeriodRow
                label="Estimated Gross"
                value={formatCentsToCurrency(d?.totalPayCents ?? 0)}
                valueClass="text-emerald-400 text-base font-bold"
                highlight
              />
            </div>
          </div>

          {/* Annual Projection */}
          {projectedAnnual && (
            <div className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-blue-500/8 to-blue-600/3">
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} className="text-blue-400" />
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Annual Projection</p>
                </div>
                <p className="text-2xl font-bold text-white tracking-tight">
                  {formatCentsToCurrency(projectedAnnual)}
                </p>
                <p className="text-xs text-slate-500 mt-1">at current pace</p>
                <Link
                  href="/career"
                  className="mt-3 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View career projections <ChevronRight size={12} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
