'use client';

/**
 * CarbonFootprintDashboard — Scope 1/2/3 rollup dashboard (Persefoni-shape).
 *
 * Surfaces environment.footprint-breakdown (per-scope totals, category
 * split, monthly stacked series, verification rollup) and
 * environment.emissions-trend (year-over-year actuals + target trajectory
 * overlay). Every value is computed from the user's real logged activities
 * — empty states say "no data yet", nothing is hardcoded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2, TrendingDown, TrendingUp, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface Breakdown {
  year: string;
  totalTonnes: number;
  byScope: { scope1: number; scope2: number; scope3: number };
  scopeShare: { scope1: number; scope2: number; scope3: number };
  byCategory: Array<{ category: string; tonnes: number }>;
  byMonth: Array<{ month: string; scope1: number; scope2: number; scope3: number; total: number }>;
  activityCount: number;
  verifiedTonnes: number;
  verifiedPct: number;
}

interface TrendRow {
  year: string;
  actual: number | null;
  trajectory: number | null;
  yoyPct: number | null;
  varianceToTrajectory: number | null;
}

interface TrendResult {
  series: TrendRow[];
  target: { id: string; name: string; baseYear: number; targetYear: number } | null;
  hasTarget: boolean;
}

const SCOPE_TONE = {
  scope1: { label: 'Scope 1 · Direct', colour: 'text-rose-300', bar: 'bg-rose-400/70', hex: '#fb7185' },
  scope2: { label: 'Scope 2 · Energy', colour: 'text-amber-300', bar: 'bg-amber-400/70', hex: '#fbbf24' },
  scope3: { label: 'Scope 3 · Indirect', colour: 'text-cyan-300', bar: 'bg-cyan-400/70', hex: '#22d3ee' },
} as const;

export function CarbonFootprintDashboard() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [b, t] = await Promise.all([
        lensRun('environment', 'footprint-breakdown', { year }),
        lensRun('environment', 'emissions-trend', {}),
      ]);
      if (b.data?.ok) setBreakdown(b.data.result as Breakdown);
      if (t.data?.ok) setTrend(t.data.result as TrendResult);
    } catch (e) {
      console.error('[CarbonFootprint] failed', e);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const yearOptions = (() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2, now - 3].map(String);
  })();

  const hasData = !!breakdown && breakdown.activityCount > 0;
  const trendSeries = (trend?.series || []).filter(
    (r) => r.actual != null || r.trajectory != null,
  );

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Globe className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Carbon footprint dashboard
        </span>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : !hasData ? (
        <div className="px-4 py-12 text-center text-xs text-gray-400">
          <Globe className="w-7 h-7 mx-auto mb-2 opacity-30" />
          No data yet for {year}. Log emissions activities to build your Scope 1/2/3 rollup.
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Scope rollup tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(['scope1', 'scope2', 'scope3'] as const).map((s) => {
              const tone = SCOPE_TONE[s];
              return (
                <div
                  key={s}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5"
                >
                  <div className="text-[9px] uppercase tracking-wider text-gray-400">
                    {tone.label}
                  </div>
                  <div className={cn('text-lg font-mono font-bold tabular-nums', tone.colour)}>
                    {breakdown!.byScope[s].toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}{' '}
                    t
                  </div>
                  <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full', tone.bar)}
                      style={{ width: `${breakdown!.scopeShare[s]}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[9px] text-gray-400">
                    {breakdown!.scopeShare[s]}% of total
                  </div>
                </div>
              );
            })}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <div className="text-[9px] uppercase tracking-wider text-gray-400">
                Gross total
              </div>
              <div className="text-lg font-mono font-bold tabular-nums text-emerald-300">
                {breakdown!.totalTonnes.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{' '}
                t
              </div>
              <div className="mt-1 flex items-center gap-1 text-[9px] text-emerald-400/80">
                <ShieldCheck className="w-3 h-3" />
                {breakdown!.verifiedPct}% verified ({breakdown!.verifiedTonnes.toFixed(1)} t)
              </div>
            </div>
          </div>

          {/* Monthly stacked bar */}
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-2">
              Monthly emissions · {year} (tCO₂e by scope)
            </div>
            <ChartKit
              kind="bar"
              data={breakdown!.byMonth}
              xKey="month"
              stacked
              height={200}
              series={[
                { key: 'scope1', label: 'Scope 1', color: SCOPE_TONE.scope1.hex },
                { key: 'scope2', label: 'Scope 2', color: SCOPE_TONE.scope2.hex },
                { key: 'scope3', label: 'Scope 3', color: SCOPE_TONE.scope3.hex },
              ]}
            />
          </div>

          {/* Category breakdown */}
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-2">
              Emissions by category
            </div>
            <ul className="space-y-1.5">
              {breakdown!.byCategory.map((c) => {
                const pct =
                  breakdown!.totalTonnes > 0
                    ? (c.tonnes / breakdown!.totalTonnes) * 100
                    : 0;
                return (
                  <li key={c.category} className="flex items-center gap-2">
                    <span className="text-xs text-gray-300 w-32 truncate capitalize">
                      {c.category.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-emerald-300 w-16 text-right">
                      {c.tonnes.toFixed(1)} t
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Year-over-year trend + target trajectory */}
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-cyan-300">
                Year-over-year trend
              </span>
              {trend?.hasTarget && trend.target && (
                <span className="text-[10px] text-gray-400">
                  vs target · {trend.target.name} ({trend.target.baseYear}→
                  {trend.target.targetYear})
                </span>
              )}
            </div>
            {trendSeries.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-6">
                No multi-year history yet. Log activities across years to see the trend.
              </div>
            ) : (
              <>
                <ChartKit
                  kind="line"
                  data={trendSeries.map((r) => ({
                    year: r.year,
                    actual: r.actual,
                    trajectory: r.trajectory,
                  }))}
                  xKey="year"
                  height={200}
                  series={[
                    { key: 'actual', label: 'Actual emissions', color: '#22c55e' },
                    ...(trend?.hasTarget
                      ? [
                          {
                            key: 'trajectory',
                            label: 'Target trajectory',
                            color: '#06b6d4',
                          },
                        ]
                      : []),
                  ]}
                />
                <ul className="mt-2 divide-y divide-white/5">
                  {trendSeries
                    .filter((r) => r.actual != null)
                    .map((r) => (
                      <li
                        key={r.year}
                        className="flex items-center gap-3 py-1 text-xs"
                      >
                        <span className="font-mono text-gray-400 w-12">{r.year}</span>
                        <span className="font-mono tabular-nums text-emerald-300 w-20">
                          {r.actual!.toFixed(1)} t
                        </span>
                        {r.yoyPct != null && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-0.5 text-[10px]',
                              r.yoyPct <= 0 ? 'text-emerald-400' : 'text-rose-400',
                            )}
                          >
                            {r.yoyPct <= 0 ? (
                              <TrendingDown className="w-3 h-3" />
                            ) : (
                              <TrendingUp className="w-3 h-3" />
                            )}
                            {r.yoyPct > 0 ? '+' : ''}
                            {r.yoyPct.toFixed(1)}% YoY
                          </span>
                        )}
                        {r.varianceToTrajectory != null && (
                          <span
                            className={cn(
                              'ml-auto text-[10px] font-mono',
                              r.varianceToTrajectory <= 0
                                ? 'text-emerald-400'
                                : 'text-amber-400',
                            )}
                          >
                            {r.varianceToTrajectory > 0 ? '+' : ''}
                            {r.varianceToTrajectory.toFixed(1)} t vs trajectory
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CarbonFootprintDashboard;
