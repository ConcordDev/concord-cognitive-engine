'use client';

/**
 * TrendPanel — historical trend of coverage / drift / dormant-module count
 * over time. Backed by `system.history` (the accumulated snapshot timeline)
 * and `system.history-snapshot` to capture a fresh point from the current
 * cartograph report.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { Loader2, Camera, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Snapshot {
  at: string;
  coveragePct: number;
  coveragePresent: number;
  coverageInScope: number;
  driftCount: number;
  deadTableCount: number;
  dormantModuleCount: number;
  heartbeatCount: number;
  macroCount: number;
  cartographGeneratedAt: string | null;
}

interface HistoryResult {
  snapshots: Snapshot[];
  count: number;
  trend: { coverageDelta: number; driftDelta: number; dormantDelta: number } | null;
  capacity: number;
}

export function TrendPanel() {
  const [data, setData] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [snapErr, setSnapErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun<HistoryResult>('system', 'history', { limit: 90 });
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'history unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const snapshot = useCallback(async () => {
    setBusy(true);
    setSnapErr(null);
    const r = await lensRun('system', 'history-snapshot', {});
    if (!r.data.ok) {
      setSnapErr(r.data.error === 'cartograph_not_run'
        ? 'Cartographer not yet run — run npm run cartograph:static first.'
        : (r.data.error || 'snapshot failed'));
    }
    await load();
    setBusy(false);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading trend history…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">
        {err || 'No history.'}
      </div>
    );
  }

  const chartData = data.snapshots.map((s) => ({
    t: new Date(s.at).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    coveragePct: s.coveragePct,
    driftCount: s.driftCount,
    dormantModuleCount: s.dormantModuleCount,
  }));

  const events: TimelineEvent[] = data.snapshots.map((s) => ({
    id: s.at,
    label: `${s.coveragePct}% coverage`,
    time: s.at,
    tone: s.driftCount > 0 ? 'warn' : 'good',
    detail: `${s.driftCount} drift · ${s.dormantModuleCount} dormant · ${s.macroCount} macros`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cyan-300">Coverage & drift over time</h3>
        <button
          onClick={snapshot}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-800/40 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Camera className="h-3 w-3" aria-hidden />}
          Capture snapshot
        </button>
      </div>

      {snapErr && (
        <div className="rounded border border-yellow-700/40 bg-yellow-950/15 px-3 py-2 text-xs text-yellow-300">{snapErr}</div>
      )}

      {data.trend && (
        <div className="grid grid-cols-3 gap-3">
          <TrendCard label="Coverage Δ" value={data.trend.coverageDelta} unit="%" goodWhenPositive />
          <TrendCard label="Drift Δ" value={data.trend.driftDelta} unit="" goodWhenPositive={false} />
          <TrendCard label="Dormant Δ" value={data.trend.dormantDelta} unit="" goodWhenPositive={false} />
        </div>
      )}

      {data.snapshots.length === 0 ? (
        <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
          No snapshots yet. Click <strong className="text-cyan-300">Capture snapshot</strong> to record the first trend point.
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
              <h4 className="mb-2 text-xs font-semibold text-cyan-300">Coverage %</h4>
              <ChartKit
                kind="area"
                data={chartData}
                xKey="t"
                series={[{ key: 'coveragePct', label: 'coverage %', color: '#22c55e' }]}
                height={180}
              />
            </div>
            <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
              <h4 className="mb-2 text-xs font-semibold text-cyan-300">Drift & dormant modules</h4>
              <ChartKit
                kind="line"
                data={chartData}
                xKey="t"
                series={[
                  { key: 'driftCount', label: 'drift', color: '#f59e0b' },
                  { key: 'dormantModuleCount', label: 'dormant', color: '#ec4899' },
                ]}
                height={180}
              />
            </div>
          </div>
          <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
            <h4 className="mb-2 text-xs font-semibold text-cyan-300">Snapshot timeline ({data.count}/{data.capacity})</h4>
            <TimelineView events={events} height={110} />
          </div>
        </>
      )}
    </div>
  );
}

function TrendCard({ label, value, unit, goodWhenPositive }: { label: string; value: number; unit: string; goodWhenPositive: boolean }) {
  const isGood = goodWhenPositive ? value >= 0 : value <= 0;
  const flat = value === 0;
  const cls = flat ? 'text-cyan-400' : isGood ? 'text-emerald-400' : 'text-rose-400';
  const Icon = flat ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-cyan-700">{label}</div>
      <div className={`flex items-center gap-1.5 font-mono text-xl font-semibold ${cls}`}>
        <Icon className="h-4 w-4" aria-hidden />
        {value > 0 ? '+' : ''}{value}{unit}
      </div>
    </div>
  );
}
