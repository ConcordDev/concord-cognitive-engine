'use client';

/**
 * TrendPanel — time-series trend chart for one self metric. Calls the
 * self.trend macro and renders the daily series via ChartKit plus a
 * stat strip (avg / min / max / latest / delta%). No seed data: an
 * empty ledger shows an explicit empty state.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const METRICS: { key: string; label: string }[] = [
  { key: 'steps', label: 'Steps' },
  { key: 'sleep_hours', label: 'Sleep' },
  { key: 'workout_min', label: 'Workout' },
  { key: 'mood', label: 'Mood' },
  { key: 'weight_kg', label: 'Weight' },
  { key: 'resting_hr', label: 'Resting HR' },
  { key: 'water_ml', label: 'Water' },
  { key: 'calories', label: 'Calories' },
  { key: 'meditation_min', label: 'Meditation' },
  { key: 'journal_entries', label: 'Journal' },
];
const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

interface TrendStats {
  count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  latest: number | null;
  deltaPct: number | null;
}
interface TrendResult {
  metric: string;
  label: string;
  unit: string;
  higherBetter: boolean;
  days: number;
  series: { day: string; value: number }[];
  stats: TrendStats;
}

export function TrendPanel({ refreshKey }: { refreshKey: number }) {
  const [metric, setMetric] = useState('steps');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun<TrendResult>('self', 'trend', { metric, days });
      if (r.data?.ok && r.data.result) setData(r.data.result);
      else setData(null);
    } catch { setData(null); }
    finally { setBusy(false); }
  }, [metric, days]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const stats = data?.stats;
  const delta = stats?.deltaPct;
  const DeltaIcon = delta == null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const good = data && delta != null && (data.higherBetter ? delta > 0 : delta < 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Trend metric"
        >
          {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <div className="flex gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                days === r.days ? 'bg-rose-600 text-white' : 'border border-rose-900/40 text-rose-400 hover:text-rose-200'
              }`}
              aria-pressed={days === r.days}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
      ) : data && data.series.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <StatCell label="Avg" value={fmt(stats?.avg, data.unit)} />
            <StatCell label="Min" value={fmt(stats?.min, data.unit)} />
            <StatCell label="Max" value={fmt(stats?.max, data.unit)} />
            <StatCell label="Latest" value={fmt(stats?.latest, data.unit)} />
            <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-rose-700">Trend</div>
              <div className={`mt-0.5 flex items-center gap-1 font-mono text-sm font-semibold ${
                delta == null ? 'text-rose-400' : good ? 'text-emerald-400' : 'text-amber-400'
              }`}>
                <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
                {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`}
              </div>
            </div>
          </div>
          <ChartKit
            kind="area"
            data={data.series}
            xKey="day"
            series={[{ key: 'value', label: data.label, color: '#fb7185' }]}
            height={260}
            showLegend={false}
          />
        </>
      ) : (
        <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
          No {data?.label ?? 'data'} logged yet. Log readings to build a trend.
        </p>
      )}
    </div>
  );
}

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return '—';
  return `${v}${unit}`;
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-rose-700">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-rose-200">{value}</div>
    </div>
  );
}
