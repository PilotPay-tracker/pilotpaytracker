import { useState, useMemo } from 'react';
import {
  Plane,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  MapPin,
  Calendar,
  Search,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTrips, type BackendTrip, type BackendCanonicalDutyDay } from '@/lib/hooks';
import {
  formatCentsToCurrency,
  formatMinutesToHHMM,
  formatDateShort,
  formatDateRange,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { ErrorMessage } from '@/components/ErrorMessage';

type TripFilter = 'all' | 'scheduled' | 'completed' | 'needs_review';

function getMonthRange(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startDate: fmt(first), endDate: fmt(last) };
}

function StatusBadge({ trip, isCompleted }: { trip: BackendTrip; isCompleted: boolean }) {
  if (trip.needsReview) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20">
        <AlertCircle size={10} />
        REVIEW
      </span>
    );
  }
  if (isCompleted) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 size={10} />
        DONE
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/20">
      <Calendar size={10} />
      SCHED
    </span>
  );
}

function TripCard({ trip }: { trip: BackendTrip }) {
  const [expanded, setExpanded] = useState(false);
  const now = new Date();
  const endDate = new Date(trip.endDate);
  const isCompleted = endDate < now;

  const displayDutyDays = trip.tripDutyDays ?? [];

  const routes = displayDutyDays
    .flatMap((dd) => dd.legs.map((l) => `${l.origin ?? '?'}→${l.destination ?? '?'}`))
    .filter(Boolean);
  const uniqueRoutes = [...new Set(routes)];

  const iconColor = isCompleted
    ? 'bg-emerald-500/10 text-emerald-400'
    : trip.needsReview
      ? 'bg-amber-500/10 text-amber-400'
      : 'bg-blue-500/10 text-blue-400';

  return (
    <div
      className={cn(
        'border rounded-xl bg-white/[0.02] overflow-hidden transition-all duration-150',
        expanded
          ? 'border-white/[0.1] bg-white/[0.03]'
          : 'border-white/[0.05] hover:border-white/[0.09]'
      )}
    >
      {/* Card header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        {/* Main info row */}
        <div className="flex items-center gap-4 px-5 py-4">
          {/* Status icon */}
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', iconColor)}>
            <Plane size={16} />
          </div>

          {/* Trip number + dates */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[14px] font-bold text-white">
                Trip {trip.tripNumber ?? 'N/A'}
              </span>
              <StatusBadge trip={trip} isCompleted={isCompleted} />
            </div>
            <p className="text-xs text-slate-500">
              {formatDateRange(trip.startDate, trip.endDate)}
              {trip.baseFleet ? ` · ${trip.baseFleet}` : ''}
            </p>
          </div>

          {/* Stats - desktop only */}
          <div className="hidden md:flex items-center gap-6 text-xs text-slate-400 flex-shrink-0">
            <div className="text-center">
              <p className="font-mono text-slate-300 font-medium">
                {formatMinutesToHHMM(trip.totalBlockMinutes)}
              </p>
              <p className="text-[10px] text-slate-600 mt-0.5">block</p>
            </div>
            <div className="text-center">
              <p className="font-mono text-slate-300 font-medium">
                {formatMinutesToHHMM(trip.totalCreditMinutes)}
              </p>
              <p className="text-[10px] text-slate-600 mt-0.5">credit</p>
            </div>
            <div className="text-center">
              <p className="text-slate-400 font-medium">
                {displayDutyDays.length} day{displayDutyDays.length !== 1 ? 's' : ''}
              </p>
              <p className="text-[10px] text-slate-600 mt-0.5">duty</p>
            </div>
            {trip.totalPdiemCents > 0 && (
              <div className="text-center">
                <p className="text-slate-400 font-medium">
                  {formatCentsToCurrency(trip.totalPdiemCents)}
                </p>
                <p className="text-[10px] text-slate-600 mt-0.5">per diem</p>
              </div>
            )}
          </div>

          {/* Pay + expand toggle */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="text-[15px] font-bold text-white">
                {formatCentsToCurrency(trip.totalPayCents)}
              </p>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                {formatMinutesToHHMM(trip.totalCreditMinutes)} cr
              </p>
            </div>
            <div className="text-slate-500">
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>
          </div>
        </div>

        {/* Route tags */}
        {uniqueRoutes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3 pt-0">
            {uniqueRoutes.slice(0, 8).map((r, i) => (
              <span
                key={i}
                className="text-[10px] font-mono bg-white/[0.04] border border-white/[0.06] text-slate-400 px-2 py-0.5 rounded"
              >
                {r}
              </span>
            ))}
            {uniqueRoutes.length > 8 && (
              <span className="text-[10px] text-slate-600">
                +{uniqueRoutes.length - 8} more
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded duty day details */}
      {expanded && displayDutyDays.length > 0 && (
        <div className="border-t border-white/[0.06] bg-white/[0.01]">
          {displayDutyDays.map((dd) => (
            <DutyDayRow key={dd.id} dutyDay={dd} />
          ))}
        </div>
      )}
    </div>
  );
}

function DutyDayRow({ dutyDay }: { dutyDay: BackendCanonicalDutyDay }) {
  return (
    <div className="px-5 py-3.5 border-b border-white/[0.03] last:border-0">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold text-slate-300">
          Day {dutyDay.dutyDayIndex + 1} · {formatDateShort(dutyDay.dutyDate)}
        </p>
        {dutyDay.dutyMinutes != null && (
          <span className="text-[10px] text-slate-500 font-mono bg-white/[0.03] px-2 py-0.5 rounded">
            {formatMinutesToHHMM(dutyDay.dutyMinutes)} duty
          </span>
        )}
      </div>
      <div className="space-y-2">
        {dutyDay.legs.map((leg) => (
          <div
            key={leg.id}
            className="flex items-center justify-between text-xs py-1"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {leg.isDeadhead && (
                <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded flex-shrink-0">
                  DH
                </span>
              )}
              <span className="text-slate-300 font-mono font-medium flex-shrink-0">
                {leg.flightNumber ?? '—'}
              </span>
              <span className="text-slate-400">
                {leg.origin ?? '?'} → {leg.destination ?? '?'}
              </span>
              {leg.equipment && (
                <span className="text-slate-600 text-[10px] flex-shrink-0">{leg.equipment}</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-slate-400 font-mono flex-shrink-0 ml-4">
              <span>{formatMinutesToHHMM(leg.actualBlockMinutes)} blk</span>
              <span className="text-slate-500">{formatMinutesToHHMM(leg.creditMinutes)} cr</span>
            </div>
          </div>
        ))}
      </div>
      {dutyDay.layover && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-500 bg-white/[0.02] rounded px-2 py-1.5">
          <MapPin size={9} />
          <span>Layover: {dutyDay.layover.station ?? '?'}</span>
          {dutyDay.layover.hotelName ? <span>· {dutyDay.layover.hotelName}</span> : null}
          {dutyDay.layover.restMinutes ? (
            <span>· {formatMinutesToHHMM(dutyDay.layover.restMinutes)} rest</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<TripFilter, string> = {
  all: 'All',
  scheduled: 'Scheduled',
  completed: 'Completed',
  needs_review: 'Needs Review',
};

export default function TripsPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filter, setFilter] = useState<TripFilter>('all');
  const [search, setSearch] = useState('');

  const { startDate, endDate } = getMonthRange(currentMonth);
  const { data, isLoading, isError, refetch } = useTrips(startDate, endDate);

  const filtered = useMemo(() => {
    let trips = data?.trips ?? [];

    if (filter !== 'all') {
      const now = new Date();
      trips = trips.filter((t) => {
        const end = new Date(t.endDate);
        switch (filter) {
          case 'completed':
            return end < now;
          case 'scheduled':
            return end >= now;
          case 'needs_review':
            return t.needsReview;
          default:
            return true;
        }
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      trips = trips.filter(
        (t) =>
          t.tripNumber?.toLowerCase().includes(q) ||
          (t.tripDutyDays ?? []).some((dd) =>
            dd.legs.some(
              (l) =>
                l.origin?.toLowerCase().includes(q) ||
                l.destination?.toLowerCase().includes(q) ||
                l.flightNumber?.toLowerCase().includes(q)
            )
          )
      );
    }

    return trips;
  }, [data, filter, search]);

  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  // Totals from filtered trips
  const totalCredit = filtered.reduce((s, t) => s + t.totalCreditMinutes, 0);
  const totalBlock = filtered.reduce((s, t) => s + t.totalBlockMinutes, 0);
  const totalPay = filtered.reduce((s, t) => s + t.totalPayCents, 0);
  const totalPdiem = filtered.reduce((s, t) => s + t.totalPdiemCents, 0);

  // Review count from all trips
  const reviewCount = (data?.trips ?? []).filter((t) => t.needsReview).length;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-7">

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Month navigator */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg p-1">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-md hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[13px] font-semibold text-white px-2 min-w-[130px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-md hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trips, routes, flights..."
            className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-500/30 transition-colors"
          />
        </div>

        {/* Filter tabs — scrollable on small screens */}
        <div className="flex items-center gap-0.5 bg-white/[0.04] border border-white/[0.06] rounded-lg p-1 overflow-x-auto flex-shrink-0 max-w-full">
          {(['all', 'scheduled', 'completed', 'needs_review'] as TripFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap flex-shrink-0',
                filter === f
                  ? f === 'needs_review'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {FILTER_LABELS[f]}
              {f === 'needs_review' && reviewCount > 0 && (
                <span className={cn(
                  'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                  filter === f ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-500/20 text-amber-400'
                )}>
                  {reviewCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Trips', value: String(filtered.length), mono: false, color: 'text-white' },
          { label: 'Credit', value: formatMinutesToHHMM(totalCredit), mono: true, color: 'text-blue-300' },
          { label: 'Block', value: formatMinutesToHHMM(totalBlock), mono: true, color: 'text-slate-300' },
          { label: 'Est. Pay', value: formatCentsToCurrency(totalPay), mono: false, color: 'text-emerald-400' },
        ].map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{stat.label}</p>
              <p className={cn('text-[15px] font-bold mt-0.5', stat.color, stat.mono && 'font-mono')}>
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Per diem if present */}
      {totalPdiem > 0 && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.05] text-xs text-slate-400">
          <DollarSign size={12} className="text-slate-500" />
          <span>Per diem included:</span>
          <span className="text-slate-300 font-medium">{formatCentsToCurrency(totalPdiem)}</span>
        </div>
      )}

      {/* Trip list */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading trips...</p>
        </div>
      ) : isError ? (
        <ErrorMessage
          message="Could not load trips. Check your connection and try again."
          onRetry={() => void refetch()}
        />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
            <Plane size={24} className="text-slate-600" />
          </div>
          <p className="text-sm font-medium text-slate-400 mb-1">No trips found for {monthLabel}</p>
          <p className="text-xs text-slate-600">Import your schedule from the mobile app</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}
