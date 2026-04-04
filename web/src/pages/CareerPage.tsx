import { useState, useMemo } from 'react';
import {
  TrendingUp,
  Award,
  BarChart3,
  Landmark,
  Lightbulb,
  RefreshCw,
  Target,
  Info,
  DollarSign,
  CalendarDays,
  Plane,
  ArrowUpRight,
} from 'lucide-react';
import {
  useProjections,
  useUserBenchmarkComparison,
  useCareerInsight,
  useLifetimeEarnings,
  useUpgradeScenario,
  useCalculateGoal,
  useWhatIf,
} from '@/lib/hooks';
import { useProfile } from '@/lib/hooks';
import { formatCentsToCurrency, formatMinutesToHHMM } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  computeRetirementForecast,
  computeMultiAgeForecast,
  UPS_CONTRACT_RULES,
  DEFAULT_RETIREMENT_PROFILE,
} from '@shared/retirementEngine';
import type { RetirementProfile, EarningsBasis } from '@shared/retirementEngine';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return formatCentsToCurrency(cents);
}

function fmtK(cents: number) {
  const k = cents / 100000;
  return k >= 10 ? `$${k.toFixed(0)}k` : `$${k.toFixed(1)}k`;
}

function pct(value: number | null | undefined, decimals = 0) {
  if (value == null) return '—';
  return `${value.toFixed(decimals)}%`;
}

function progressBar(value: number, max: number, color: string) {
  const p = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500', color)}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.06] bg-white/[0.02] p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{children}</p>;
}

function BigNumber({
  value,
  sub,
  accent,
}: {
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <p className={cn('text-2xl font-bold tracking-tight', accent ?? 'text-white')}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function InsightBadge({ insight }: { insight: { title: string; message: string; type: string } }) {
  const colors: Record<string, string> = {
    senior_fo_advantage: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    captain_leverage: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    premium_strategy: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    default: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  };
  const color = colors[insight.type] ?? colors.default;
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3.5', color)}>
      <Lightbulb size={16} className="mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-sm font-semibold">{insight.title}</p>
        <p className="text-xs mt-0.5 opacity-80">{insight.message}</p>
      </div>
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-white/[0.05] rounded w-1/3" />
      <div className="h-8 bg-white/[0.05] rounded w-1/2" />
      <div className="h-3 bg-white/[0.05] rounded w-2/3" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: BENCHMARKS
// ─────────────────────────────────────────────────────────────────────────────

function BenchmarksTab() {
  const { data: comparison, isLoading } = useUserBenchmarkComparison();
  const { data: insight } = useCareerInsight();
  const [foYear, setFoYear] = useState(7);
  const [cptYear, setCptYear] = useState(8);
  const { data: scenario, isLoading: scenarioLoading } = useUpgradeScenario(cptYear, foYear);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <SectionCard key={i}>
            <LoadingShimmer />
          </SectionCard>
        ))}
      </div>
    );
  }

  if (!comparison?.hasBenchmarks || !comparison.userProfile) {
    return (
      <SectionCard className="flex flex-col items-center py-16 text-center">
        <Award size={40} className="text-slate-600 mb-4" />
        <p className="text-white font-medium mb-2">No benchmark data available</p>
        <p className="text-sm text-slate-500 max-w-sm">
          Set your airline, position, and date of hire in Settings to see pay benchmarks.
        </p>
      </SectionCard>
    );
  }

  const { userProfile, currentBenchmark, userPerformance, upgradeSimulation } = comparison;

  const benchmarkRows = [
    {
      label: 'Guarantee',
      benchmarkCents: currentBenchmark?.payAtGuaranteeCents ?? 0,
      pctOfBenchmark: userPerformance?.percentOfBenchmarkGuarantee,
      delta: userPerformance?.deltaFromGuaranteeCents,
    },
    {
      label: 'Avg Line',
      benchmarkCents: currentBenchmark?.avgLinePayCents ?? 0,
      pctOfBenchmark: userPerformance?.percentOfBenchmarkAvgLine,
      delta: userPerformance?.deltaFromAvgLineCents,
    },
    {
      label: 'Avg Total',
      benchmarkCents: currentBenchmark?.avgTotalPayCents ?? 0,
      pctOfBenchmark: userPerformance?.percentOfBenchmarkAvgTotal,
      delta: null,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Career Insight Banner */}
      {insight && <InsightBadge insight={insight} />}

      {/* Top metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SectionCard>
          <CardLabel>Position</CardLabel>
          <BigNumber
            value={userProfile.position === 'Captain' ? 'Captain' : 'First Officer'}
            sub={`${userProfile.airline} · YOS ${userProfile.yearOfService}`}
          />
        </SectionCard>
        <SectionCard>
          <CardLabel>Hourly Rate</CardLabel>
          <BigNumber
            value={`$${(userProfile.hourlyRateCents / 100).toFixed(2)}`}
            sub="per contract hour"
          />
        </SectionCard>
        <SectionCard>
          <CardLabel>YTD Pay</CardLabel>
          <BigNumber
            value={fmt(userPerformance?.ytdPayCents ?? 0)}
            sub={`Day ${userPerformance?.dayOfYear ?? 0} of year`}
          />
        </SectionCard>
        <SectionCard>
          <CardLabel>Annual Projection</CardLabel>
          <BigNumber
            value={fmt(userPerformance?.projectedAnnualCents ?? 0)}
            sub="at current pace"
            accent="text-emerald-400"
          />
        </SectionCard>
      </div>

      {/* Benchmark comparison table */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4">
          Performance vs. Benchmark
          {currentBenchmark && (
            <span className="ml-2 text-xs text-slate-500 font-normal">
              {userProfile.airline} {currentBenchmark.seat} Year {currentBenchmark.yearOfService} · {currentBenchmark.effectiveDate}
            </span>
          )}
        </h3>
        <div className="space-y-4">
          {benchmarkRows.map((row) => {
            const p = row.pctOfBenchmark ?? 0;
            const barColor =
              p >= 100 ? 'bg-emerald-500' : p >= 85 ? 'bg-amber-500' : 'bg-blue-500';
            return (
              <div key={row.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-slate-400">{row.label}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">{fmt(row.benchmarkCents)}</span>
                    <span className={cn('font-semibold w-14 text-right', p >= 100 ? 'text-emerald-400' : 'text-white')}>
                      {pct(row.pctOfBenchmark)}
                    </span>
                  </div>
                </div>
                {progressBar(p, 120, barColor)}
                {row.delta != null && (
                  <p className={cn('text-xs mt-1', row.delta >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {row.delta >= 0 ? '+' : ''}
                    {fmt(row.delta)} vs benchmark
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Upgrade simulation */}
      {upgradeSimulation && (
        <SectionCard>
          <h3 className="text-sm font-semibold text-white mb-4">Captain Upgrade Opportunity</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1.5">Compare at FO Year</label>
                  <select
                    value={foYear}
                    onChange={(e) => setFoYear(Number(e.target.value))}
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                  >
                    {Array.from({ length: 15 }, (_, i) => i + 1).map((y) => (
                      <option key={y} value={y} className="bg-slate-900">Year {y}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1.5">Upgrade to CPT Year</label>
                  <select
                    value={cptYear}
                    onChange={(e) => setCptYear(Number(e.target.value))}
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                  >
                    {Array.from({ length: 15 }, (_, i) => i + 1).map((y) => (
                      <option key={y} value={y} className="bg-slate-900">Year {y}</option>
                    ))}
                  </select>
                </div>
              </div>
              {scenarioLoading ? (
                <LoadingShimmer />
              ) : scenario ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/[0.03] rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">FO at Year {scenario.foYear}</p>
                    <p className="text-base font-bold text-white">{fmt(scenario.foAvgTotalCents)}</p>
                    <p className="text-xs text-slate-500">${(scenario.foHourlyCents / 100).toFixed(2)}/hr</p>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                    <p className="text-xs text-emerald-400 mb-1">CPT at Year {scenario.captainYear}</p>
                    <p className="text-base font-bold text-emerald-400">{fmt(scenario.captainAvgTotalCents)}</p>
                    <p className="text-xs text-emerald-400/70">${(scenario.captainHourlyCents / 100).toFixed(2)}/hr</p>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col justify-center items-center bg-white/[0.02] rounded-lg p-5 text-center">
              <p className="text-xs text-slate-500 mb-2">Potential Increase</p>
              {scenario ? (
                <>
                  <p className="text-3xl font-bold text-emerald-400">
                    +{pct(scenario.percentIncrease, 1)}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">{fmt(scenario.netDifferenceCents)} / yr</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-emerald-400">
                    +{pct(upgradeSimulation.percentIncrease, 1)}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    {fmt(upgradeSimulation.potentialIncreaseCents)} / yr
                  </p>
                </>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: EARNINGS
// ─────────────────────────────────────────────────────────────────────────────

type Scope = 'YEAR' | 'MONTH' | 'PAY_PERIOD';

function EarningsTab() {
  const { data: projections, isLoading: projLoading } = useProjections();
  const { data: lifetime, isLoading: ltLoading } = useLifetimeEarnings();
  const { mutate: calcGoal, data: goalData, isPending: goalPending } = useCalculateGoal();
  const [scope, setScope] = useState<Scope>('YEAR');
  const [goalAmount, setGoalAmount] = useState('');

  const scopeLabel: Record<Scope, string> = {
    YEAR: 'Year',
    MONTH: 'Month',
    PAY_PERIOD: 'Pay Period',
  };

  const currentProj = projections
    ? scope === 'YEAR'
      ? projections.year
      : scope === 'MONTH'
      ? projections.month
      : projections.payPeriod
    : null;

  const handleGoalCalc = () => {
    const cents = Math.round(parseFloat(goalAmount) * 100);
    if (!isNaN(cents) && cents > 0) {
      calcGoal({ targetCents: cents, scope });
    }
  };

  return (
    <div className="space-y-5">
      {/* Scope tabs */}
      <div className="flex gap-1 bg-white/[0.04] p-1 rounded-lg w-fit">
        {(['YEAR', 'MONTH', 'PAY_PERIOD'] as Scope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              scope === s
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            {scopeLabel[s]}
          </button>
        ))}
      </div>

      {projLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <SectionCard key={i}><LoadingShimmer /></SectionCard>
          ))}
        </div>
      ) : currentProj ? (
        <>
          {/* Projection metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SectionCard>
              <CardLabel>Actual Pay</CardLabel>
              <BigNumber
                value={fmt(currentProj.actual.payCents)}
                sub={`${currentProj.daysElapsed}d elapsed`}
              />
            </SectionCard>
            <SectionCard>
              <CardLabel>Projected {scopeLabel[scope]}</CardLabel>
              <BigNumber
                value={fmt(currentProj.projectedCents)}
                sub={`${currentProj.daysRemaining}d remaining`}
                accent="text-blue-400"
              />
            </SectionCard>
            <SectionCard>
              <CardLabel>Credit Hours</CardLabel>
              <BigNumber
                value={formatMinutesToHHMM(currentProj.actual.creditMinutes)}
                sub={`${currentProj.actual.flights} flights`}
              />
            </SectionCard>
            <SectionCard>
              <CardLabel>Daily Average</CardLabel>
              <BigNumber
                value={fmt(currentProj.dailyAvgCents)}
                sub="per day at pace"
              />
            </SectionCard>
          </div>

          {/* Progress bar */}
          <SectionCard>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                {scopeLabel[scope]} Pace
              </h3>
              <span className="text-xs text-slate-500">
                {currentProj.daysElapsed} / {currentProj.daysTotal} days
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="flex justify-between text-xs text-slate-500 mb-2">
                  <span>Actual: {fmt(currentProj.actual.payCents)}</span>
                  <span>Projected: {fmt(currentProj.projectedCents)}</span>
                </div>
                {progressBar(
                  currentProj.actual.payCents,
                  currentProj.projectedCents,
                  'bg-blue-500'
                )}
                <div className="flex justify-between text-xs text-slate-600 mt-1">
                  <span>$0</span>
                  <span>{fmt(currentProj.projectedCents)}</span>
                </div>
              </div>
              <div className="flex flex-col justify-center bg-white/[0.02] rounded-lg p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Completion</p>
                <p className="text-2xl font-bold text-white">
                  {Math.round((currentProj.actual.payCents / Math.max(1, currentProj.projectedCents)) * 100)}%
                </p>
                <p className="text-xs text-slate-500 mt-0.5">of projection</p>
              </div>
            </div>
          </SectionCard>
        </>
      ) : null}

      {/* Goal calculator */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Target size={16} className="text-amber-400" />
          Goal Calculator
        </h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1.5">Target income ($)</label>
            <input
              type="number"
              placeholder="e.g. 250000"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <button
            onClick={handleGoalCalc}
            disabled={goalPending || !goalAmount}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {goalPending ? <RefreshCw size={14} className="animate-spin" /> : <Target size={14} />}
            Calculate
          </button>
        </div>
        {goalData && (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white/[0.03] rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Progress</p>
              <p className="text-lg font-bold text-white">{goalData.progressPercent.toFixed(0)}%</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Remaining</p>
              <p className="text-lg font-bold text-white">{fmt(goalData.remainingCents)}</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Daily Pace Needed</p>
              <p className="text-lg font-bold text-white">{fmt(goalData.requiredDailyPaceCents)}</p>
            </div>
            <div
              className={cn(
                'rounded-lg p-3 text-center',
                goalData.isAchievable ? 'bg-emerald-500/10' : 'bg-rose-500/10'
              )}
            >
              <p className="text-xs text-slate-500 mb-1">Achievable</p>
              <p
                className={cn(
                  'text-lg font-bold',
                  goalData.isAchievable ? 'text-emerald-400' : 'text-rose-400'
                )}
              >
                {goalData.isAchievable ? 'Yes' : 'Stretch'}
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Lifetime earnings */}
      {ltLoading ? (
        <SectionCard><LoadingShimmer /></SectionCard>
      ) : lifetime && lifetime.years.length > 0 ? (
        <SectionCard>
          <h3 className="text-sm font-semibold text-white mb-1">Lifetime Earnings</h3>
          <p className="text-xs text-slate-500 mb-4">
            {lifetime.airlineName} · {lifetime.summary.yearsActive} years recorded
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <div>
              <CardLabel>Career Total</CardLabel>
              <p className="text-lg font-bold text-white">{fmt(lifetime.summary.totalCareerEarningsCents)}</p>
            </div>
            <div>
              <CardLabel>Annual Average</CardLabel>
              <p className="text-lg font-bold text-white">{fmt(lifetime.summary.averageAnnualEarningsCents)}</p>
            </div>
            <div>
              <CardLabel>Best Year</CardLabel>
              <p className="text-lg font-bold text-emerald-400">
                {lifetime.summary.highestEarningYear
                  ? `${lifetime.summary.highestEarningYear.year}: ${fmt(lifetime.summary.highestEarningYear.grossEarningsCents)}`
                  : '—'}
              </p>
            </div>
            <div>
              <CardLabel>Current Year</CardLabel>
              <p className="text-lg font-bold text-blue-400">
                {fmt(lifetime.summary.currentYearEarningsCents)}
                {lifetime.summary.currentYearIsInProgress && (
                  <span className="text-xs text-slate-500 ml-1">(in progress)</span>
                )}
              </p>
            </div>
          </div>
          {/* Year bar chart */}
          <div className="overflow-x-auto">
            <div className="flex gap-1.5 items-end min-w-0" style={{ minHeight: 80 }}>
              {lifetime.years
                .slice()
                .sort((a, b) => a.year - b.year)
                .map((yr) => {
                  const maxCents = Math.max(...lifetime.years.map((y) => y.grossEarningsCents));
                  const h = Math.max(4, Math.round((yr.grossEarningsCents / maxCents) * 72));
                  const isCurrent = yr.isFinalized === false;
                  return (
                    <div key={yr.year} className="flex flex-col items-center gap-1 flex-1 min-w-[28px]" title={`${yr.year}: ${fmt(yr.grossEarningsCents)}`}>
                      <div
                        className={cn(
                          'w-full rounded-t',
                          isCurrent ? 'bg-blue-500/60' : 'bg-blue-700/60'
                        )}
                        style={{ height: h }}
                      />
                      <p className="text-[9px] text-slate-600">{yr.year}</p>
                    </div>
                  );
                })}
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

function SimulationTab() {
  const { data: comparison } = useUserBenchmarkComparison();
  const userYos = comparison?.userProfile?.yearOfService ?? null;
  const [foYear, setFoYear] = useState(5);
  const [cptYear, setCptYear] = useState(8);
  const { data: scenario, isLoading } = useUpgradeScenario(cptYear, foYear);
  const { mutate: whatIf, data: whatIfData, isPending: whatIfPending } = useWhatIf();
  const [whatIfHours, setWhatIfHours] = useState('');
  const [whatIfScope, setWhatIfScope] = useState<Scope>('YEAR');

  return (
    <div className="space-y-5">
      {/* Upgrade scenario comparison */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Plane size={15} className="text-blue-400" />
          Upgrade Path Simulator
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Compare FO pay at a given year vs. Captain pay at a given year using the CBA pay table.
        </p>
        <div className="flex gap-4 mb-5">
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1.5">FO at Year</label>
            <select
              value={foYear}
              onChange={(e) => setFoYear(Number(e.target.value))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map((y) => (
                <option key={y} value={y} className="bg-slate-900">Year {y}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1.5">CPT at Year</label>
            <select
              value={cptYear}
              onChange={(e) => setCptYear(Number(e.target.value))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map((y) => (
                <option key={y} value={y} className="bg-slate-900">Year {y}</option>
              ))}
            </select>
          </div>
        </div>
        {isLoading ? (
          <LoadingShimmer />
        ) : scenario ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white/[0.04] rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-2">FO — Year {scenario.foYear}</p>
              <p className="text-xl font-bold text-white">{fmt(scenario.foAvgTotalCents)}</p>
              <p className="text-xs text-slate-500 mt-1">${(scenario.foHourlyCents / 100).toFixed(2)}/hr avg total</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-xs text-emerald-400 mb-2">Captain — Year {scenario.captainYear}</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(scenario.captainAvgTotalCents)}</p>
              <p className="text-xs text-emerald-400/70 mt-1">${(scenario.captainHourlyCents / 100).toFixed(2)}/hr avg total</p>
            </div>
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 flex flex-col items-center justify-center text-center">
              <p className="text-xs text-slate-500 mb-1">Annual Advantage</p>
              <div className="flex items-center gap-1 text-emerald-400">
                <ArrowUpRight size={18} />
                <p className="text-2xl font-bold">+{pct(scenario.percentIncrease, 1)}</p>
              </div>
              <p className="text-sm text-slate-400 mt-0.5">{fmt(scenario.netDifferenceCents)} / yr</p>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* FO vs Captain pay table */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4">UPS Pay Table Reference (TA 2025)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-white/[0.06]">
                <th className="pb-2 pr-4">YOS</th>
                <th className="pb-2 pr-4">FO Guarantee</th>
                <th className="pb-2 pr-4">FO Avg Total</th>
                <th className="pb-2 pr-4">CPT Guarantee</th>
                <th className="pb-2">CPT Avg Total</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((yos) => {
                // Inline UPS TA 2025 data for reference display
                const fo = [
                  { g: 5827600, t: 6714600 },
                  { g: 22233900, t: 25618000 },
                  { g: 22264100, t: 25652800 },
                  { g: 22710700, t: 26167400 },
                  { g: 23164100, t: 26689700 },
                  { g: 23626200, t: 27222200 },
                  { g: 24099100, t: 27767100 },
                  { g: 24579800, t: 28320900 },
                  { g: 25071200, t: 28887100 },
                  { g: 25771200, t: 29693700 },
                  { g: 26494700, t: 30527300 },
                  { g: 27238600, t: 31384400 },
                  { g: 27376100, t: 31542800 },
                  { g: 27510600, t: 31697900 },
                  { g: 27718300, t: 31937100 },
                ][yos - 1];
                const cpt = [
                  { g: 5827600, t: 7311100 },
                  { g: 35820500, t: 44939100 },
                  { g: 35890700, t: 45027200 },
                  { g: 36036000, t: 45209500 },
                  { g: 36179300, t: 45389300 },
                  { g: 36321700, t: 45567900 },
                  { g: 36468900, t: 45752600 },
                  { g: 36614200, t: 45934800 },
                  { g: 36759500, t: 46117100 },
                  { g: 37183600, t: 46649200 },
                  { g: 37612600, t: 47187400 },
                  { g: 38045500, t: 47730500 },
                  { g: 38329200, t: 48086400 },
                  { g: 38712400, t: 48567200 },
                  { g: 39098500, t: 49051500 },
                ][yos - 1];
                const isUserYos = userYos != null && yos === userYos;
                return (
                  <tr
                    key={yos}
                    className={cn(
                      'border-b border-white/[0.03] last:border-0',
                      isUserYos ? 'bg-blue-500/10' : 'hover:bg-white/[0.02]'
                    )}
                  >
                    <td className="py-2 pr-4 text-slate-400 font-medium">
                      {yos}
                      {isUserYos && (
                        <span className="ml-1.5 text-[10px] text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded">you</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-white font-mono text-xs">{fmtK(fo.g)}</td>
                    <td className="py-2 pr-4 text-white font-mono text-xs">{fmtK(fo.t)}</td>
                    <td className="py-2 pr-4 text-emerald-400 font-mono text-xs">{fmtK(cpt.g)}</td>
                    <td className="py-2 text-emerald-400 font-mono text-xs">{fmtK(cpt.t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* What-if scenario */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 size={15} className="text-violet-400" />
          What-If Scenario
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          See how additional credit hours would affect your projected pay.
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-slate-500 block mb-1.5">Additional credit hours</label>
            <input
              type="number"
              placeholder="e.g. 10"
              value={whatIfHours}
              onChange={(e) => setWhatIfHours(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Scope</label>
            <select
              value={whatIfScope}
              onChange={(e) => setWhatIfScope(e.target.value as Scope)}
              className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              <option value="YEAR" className="bg-slate-900">Year</option>
              <option value="MONTH" className="bg-slate-900">Month</option>
              <option value="PAY_PERIOD" className="bg-slate-900">Pay Period</option>
            </select>
          </div>
          <button
            onClick={() => {
              const hrs = parseFloat(whatIfHours);
              if (!isNaN(hrs) && hrs > 0) {
                whatIf({ additionalCreditMinutes: Math.round(hrs * 60), scope: whatIfScope });
              }
            }}
            disabled={whatIfPending || !whatIfHours}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {whatIfPending ? <RefreshCw size={14} className="animate-spin" /> : 'Run'}
          </button>
        </div>
        {whatIfData && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-white/[0.03] rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Current</p>
              <p className="text-base font-bold text-white">{fmt(whatIfData.currentCents)}</p>
            </div>
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 text-center">
              <p className="text-xs text-violet-400 mb-1">With Extra Hours</p>
              <p className="text-base font-bold text-violet-400">{fmt(whatIfData.projectedCents)}</p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Difference</p>
              <p className="text-base font-bold text-emerald-400">+{fmt(whatIfData.differenceCents)}</p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: RETIREMENT
// ─────────────────────────────────────────────────────────────────────────────

function RetirementTab() {
  const { data: profileData } = useProfile();
  const profile = profileData?.profile;

  // Build retirement profile from server profile data + user inputs
  const [retProfile, setRetProfile] = useState<RetirementProfile>({
    ...DEFAULT_RETIREMENT_PROFILE,
    doh: profile?.dateOfHire ?? null,
    dob: profile?.dateOfBirth ?? null,
  });
  const [selectedAge, setSelectedAge] = useState<60 | 62 | 65>(65);

  // Update from server profile when it loads
  const resolvedProfile = useMemo<RetirementProfile>(
    () => ({
      ...retProfile,
      doh: profile?.dateOfHire ?? retProfile.doh,
      dob: profile?.dateOfBirth ?? retProfile.dob,
    }),
    [retProfile, profile?.dateOfHire, profile?.dateOfBirth]
  );

  const forecast = useMemo(
    () => computeRetirementForecast(resolvedProfile, UPS_CONTRACT_RULES),
    [resolvedProfile]
  );

  const multiAge = useMemo(
    () => computeMultiAgeForecast(resolvedProfile, UPS_CONTRACT_RULES, [60, 62, 65]),
    [resolvedProfile]
  );

  const selectedForecast = multiAge[selectedAge] ?? forecast;
  const hasDates = !!resolvedProfile.doh && !!resolvedProfile.dob;

  const confidenceColors = {
    HIGH: 'text-emerald-400',
    MEDIUM: 'text-amber-400',
    ESTIMATE: 'text-slate-400',
  };

  return (
    <div className="space-y-5">
      {/* Profile inputs */}
      <SectionCard>
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <CalendarDays size={15} className="text-blue-400" />
          Retirement Profile
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Date of Hire</label>
            <input
              type="date"
              value={resolvedProfile.doh ?? ''}
              onChange={(e) => setRetProfile((p) => ({ ...p, doh: e.target.value || null }))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Date of Birth</label>
            <input
              type="date"
              value={resolvedProfile.dob ?? ''}
              onChange={(e) => setRetProfile((p) => ({ ...p, dob: e.target.value || null }))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Earnings Basis</label>
            <select
              value={resolvedProfile.earningsBasis}
              onChange={(e) => setRetProfile((p) => ({ ...p, earningsBasis: e.target.value as EarningsBasis }))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              <option value="GUAR" className="bg-slate-900">Guarantee</option>
              <option value="LINE" className="bg-slate-900">Avg Line</option>
              <option value="TOTAL" className="bg-slate-900">Avg Total</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1.5">Plan B Growth Rate</label>
            <select
              value={resolvedProfile.planBGrowthRatePct}
              onChange={(e) => setRetProfile((p) => ({ ...p, planBGrowthRatePct: Number(e.target.value) }))}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            >
              <option value={3} className="bg-slate-900">3% Conservative</option>
              <option value={5} className="bg-slate-900">5% Moderate</option>
              <option value={7} className="bg-slate-900">7% Aggressive</option>
            </select>
          </div>
        </div>

        {!hasDates && (
          <div className="mt-4 flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            Enter your Date of Hire and Date of Birth above to generate retirement projections. You can also set these in Settings on the mobile app.
          </div>
        )}
      </SectionCard>

      {hasDates && (
        <>
          {/* Retirement age comparison */}
          <div className="grid grid-cols-3 gap-4">
            {([60, 62, 65] as const).map((age) => {
              const f = multiAge[age];
              if (!f) return null;
              const isSelected = selectedAge === age;
              return (
                <button
                  key={age}
                  onClick={() => setSelectedAge(age)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-all',
                    isSelected
                      ? 'border-blue-500/40 bg-blue-500/10'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                  )}
                >
                  <p className={cn('text-xs font-medium mb-2', isSelected ? 'text-blue-400' : 'text-slate-400')}>
                    Retire at {age}
                  </p>
                  <p className={cn('text-xl font-bold', isSelected ? 'text-white' : 'text-slate-300')}>
                    {fmt(f.projectedTotalAnnualRetirementIncomeCents)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {fmt(f.projectedTotalAnnualRetirementIncomeCents / 12)}/mo · {f.yearsOfService} YOS
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">{f.retirementYear}</p>
                </button>
              );
            })}
          </div>

          {/* Selected forecast detail */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Plan A pension */}
            <SectionCard>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Plan A — Defined Benefit Pension</h3>
                <span className="text-xs text-slate-600">{selectedForecast.pension.formulaUsed === 'FLAT_DOLLAR' ? 'Flat $' : '%'} formula</span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <CardLabel>Annual Pension</CardLabel>
                  <p className="text-xl font-bold text-white">{fmt(selectedForecast.pension.annualCents)}</p>
                </div>
                <div>
                  <CardLabel>Monthly Pension</CardLabel>
                  <p className="text-xl font-bold text-white">{fmt(selectedForecast.pension.monthlyCents)}</p>
                </div>
              </div>
              <div className="text-xs text-slate-500 space-y-1 border-t border-white/[0.04] pt-3">
                <div className="flex justify-between">
                  <span>Final Avg Earnings (FAE)</span>
                  <span className="text-slate-300">{fmt(selectedForecast.finalAverageEarningsCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Effective YOS</span>
                  <span className="text-slate-300">{selectedForecast.pension.effectiveYOS}</span>
                </div>
                <div className="flex justify-between">
                  <span>Seat at Retirement</span>
                  <span className="text-slate-300">{selectedForecast.seatAtRetirement}</span>
                </div>
                <div className="flex justify-between">
                  <span>Percent formula</span>
                  <span className="text-slate-300">{fmt(selectedForecast.pension.percentFormulaAnnualCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Flat $ formula</span>
                  <span className="text-slate-300">{fmt(selectedForecast.pension.flatDollarFormulaAnnualCents)}</span>
                </div>
              </div>
            </SectionCard>

            {/* Plan B + VEBA */}
            <SectionCard>
              <h3 className="text-sm font-semibold text-white mb-4">Plan B — MPP + VEBA/HRA</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <CardLabel>Plan B Balance at Retirement</CardLabel>
                    <span className="text-xs text-slate-500">{selectedForecast.earningsBasis} basis</span>
                  </div>
                  <p className="text-xl font-bold text-white">{fmt(selectedForecast.projectedPlanBBalanceCents)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    SWR withdrawal: {fmt(selectedForecast.planBAnnualWithdrawalCents)}/yr
                  </p>
                </div>
                <div className="border-t border-white/[0.04] pt-3">
                  <CardLabel>VEBA / HRA</CardLabel>
                  <p className="text-base font-bold text-white">
                    {fmt(selectedForecast.hraAnnualPostRetireCents)}/yr
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Medical reimbursement only — not cash income
                    {selectedForecast.hraStopsAtMedicare ? ` · stops at age ${selectedForecast.medicareEligibilityAge}` : ''}
                  </p>
                </div>
                {selectedForecast.sickLeaveEstimatedPayoutCents > 0 && (
                  <div className="border-t border-white/[0.04] pt-3">
                    <CardLabel>Sick Leave Payout (one-time)</CardLabel>
                    <p className="text-base font-bold text-amber-400">
                      {fmt(selectedForecast.sickLeaveEstimatedPayoutCents)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Not included in annual income</p>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Total income summary */}
          <SectionCard className="border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Total Projected Retirement Income</h3>
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-medium', confidenceColors[selectedForecast.confidenceLevel])}>
                  {selectedForecast.confidenceLevel} confidence
                </span>
                <span className="text-xs text-slate-600">· {selectedForecast.rulesetVersion}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
              <div className="lg:col-span-2 space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-white/[0.04]">
                  <span className="text-sm text-slate-400">Plan A Pension</span>
                  <span className="text-sm font-semibold text-white">{fmt(selectedForecast.pension.annualCents)}/yr</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/[0.04]">
                  <span className="text-sm text-slate-400">Plan B / MPP Withdrawal</span>
                  <span className="text-sm font-semibold text-white">{fmt(selectedForecast.planBAnnualWithdrawalCents)}/yr</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/[0.04]">
                  <span className="text-sm text-slate-400">VEBA / HRA</span>
                  <span className="text-sm text-slate-500">{fmt(selectedForecast.hraAnnualPostRetireCents)}/yr (medical, not cash)</span>
                </div>
                <div className="flex justify-between items-center pt-1">
                  <span className="text-sm font-semibold text-white">Total Annual Income</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {fmt(selectedForecast.projectedTotalAnnualRetirementIncomeCents)}/yr
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center bg-white/[0.03] rounded-xl p-5 text-center">
                <p className="text-xs text-slate-500 mb-1">Monthly Income</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {fmt(selectedForecast.projectedTotalAnnualRetirementIncomeCents / 12)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {selectedForecast.yearsRemaining} years away · {selectedForecast.retirementYear}
                </p>
              </div>
            </div>
            {(selectedForecast.hasValidationErrors || selectedForecast.sanityWarnings.length > 0) && (
              <div className="flex gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  {selectedForecast.validationErrors.map((e, i) => <p key={i}>{e}</p>)}
                  {selectedForecast.sanityWarnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-600 mt-3">
              Estimates only. Based on {selectedForecast.rulesetVersion}. Consult a financial advisor for personalized guidance.
            </p>
          </SectionCard>

          {/* Year-by-year table (first 10 rows) */}
          {selectedForecast.yearlyProjections.length > 0 && (
            <SectionCard>
              <h3 className="text-sm font-semibold text-white mb-4">Year-by-Year Forecast</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                      <th className="pb-2 pr-3">Year</th>
                      <th className="pb-2 pr-3">Age</th>
                      <th className="pb-2 pr-3">Seat</th>
                      <th className="pb-2 pr-3">Annual Income</th>
                      <th className="pb-2 pr-3">Plan B Contrib</th>
                      <th className="pb-2 pr-3">Plan B Balance</th>
                      <th className="pb-2">Contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedForecast.yearlyProjections.slice(0, 15).map((yr) => (
                      <tr
                        key={yr.year}
                        className={cn(
                          'border-b border-white/[0.03] last:border-0',
                          yr.isActualEarnings ? 'bg-emerald-500/5' : ''
                        )}
                      >
                        <td className="py-1.5 pr-3 text-slate-400">{yr.year}</td>
                        <td className="py-1.5 pr-3 text-slate-400">{yr.age.toFixed(0)}</td>
                        <td className="py-1.5 pr-3">
                          <span className={cn('text-xs', yr.seatType === 'CAPTAIN' ? 'text-emerald-400' : 'text-blue-400')}>
                            {yr.seatType === 'CAPTAIN' ? 'CPT' : 'FO'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-white font-mono">{fmtK(yr.estimatedAnnualIncomeCents)}</td>
                        <td className="py-1.5 pr-3 text-slate-300 font-mono">{fmtK(yr.planBContributionCents)}</td>
                        <td className="py-1.5 pr-3 text-slate-300 font-mono">{fmtK(yr.cumulativePlanBCents)}</td>
                        <td className="py-1.5 text-slate-600">{yr.contractLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedForecast.yearlyProjections.length > 15 && (
                  <p className="text-xs text-slate-600 mt-2 text-center">
                    +{selectedForecast.yearlyProjections.length - 15} more years through {selectedForecast.retirementYear}
                  </p>
                )}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'benchmarks' | 'earnings' | 'simulation' | 'retirement';

const TABS: { id: Tab; label: string; icon: typeof TrendingUp; desc: string }[] = [
  { id: 'benchmarks', label: 'Benchmarks', icon: Award, desc: 'Compare vs. peers' },
  { id: 'earnings', label: 'Earnings', icon: DollarSign, desc: 'Projections & goals' },
  { id: 'simulation', label: 'Simulation', icon: BarChart3, desc: 'Upgrade scenarios' },
  { id: 'retirement', label: 'Retirement', icon: Landmark, desc: 'Pension & forecast' },
];

export default function CareerPage() {
  const [tab, setTab] = useState<Tab>('benchmarks');

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-7">

      {/* Tab navigation — horizontally scrollable on small screens */}
      <div className="flex items-center gap-2 mb-6 border-b border-white/[0.06] pb-1 overflow-x-auto">
        <div className="flex items-center gap-1 flex-shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-2.5 rounded-t-lg text-sm font-medium transition-all relative whitespace-nowrap flex-shrink-0',
                tab === id
                  ? 'text-white bg-white/[0.05]'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
              )}
            >
              <Icon
                size={15}
                className={tab === id ? 'text-blue-400' : 'text-slate-600'}
              />
              <span>{label}</span>
              {tab === id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-blue-400 rounded-t-full" />
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto hidden lg:block flex-shrink-0 pl-4">
          <p className="text-xs text-slate-600">
            {TABS.find((t) => t.id === tab)?.desc}
          </p>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'benchmarks' && <BenchmarksTab />}
      {tab === 'earnings' && <EarningsTab />}
      {tab === 'simulation' && <SimulationTab />}
      {tab === 'retirement' && <RetirementTab />}
    </div>
  );
}
