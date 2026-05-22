'use client';

/**
 * HeartbeatHealthPanel — per-heartbeat runtime health: last-run age, run /
 * error / skip counters, and a derived health verdict (ok / stale / error /
 * pending). Backed by `system.heartbeat-health` which joins the static
 * registry with STATE.heartbeatRuntime telemetry.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Heart, Loader2, CheckCircle2, XCircle, Clock, CircleDashed } from 'lucide-react';

interface HBModule {
  id: string;
  frequency: number;
  intervalSec: number;
  neverDisable: boolean;
  lastRunAt: string | null;
  lastRunAgeSec: number | null;
  runCount: number;
  errorCount: number;
  skipCount: number;
  lastError: string | null;
  health: 'ok' | 'stale' | 'error' | 'pending';
}

interface HealthResult {
  modules: HBModule[];
  summary: { total: number; ok: number; stale: number; error: number; pending: number; booted: boolean };
}

const HEALTH_ICON: Record<string, React.ReactNode> = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />,
  stale: <Clock className="h-3.5 w-3.5 text-yellow-400" aria-hidden />,
  error: <XCircle className="h-3.5 w-3.5 text-rose-400" aria-hidden />,
  pending: <CircleDashed className="h-3.5 w-3.5 text-cyan-600" aria-hidden />,
};

export function HeartbeatHealthPanel({ live }: { live: boolean }) {
  const [data, setData] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'health' | 'frequency' | 'errors'>('health');

  const load = useCallback(async () => {
    const r = await lensRun<HealthResult>('system', 'heartbeat-health', {});
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'heartbeat-health unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [live, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading heartbeat runtime…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">
        {err || 'No heartbeat data.'}
      </div>
    );
  }

  const rank: Record<string, number> = { error: 0, stale: 1, pending: 2, ok: 3 };
  const modules = [...data.modules].sort((a, b) => {
    if (sortBy === 'frequency') return a.frequency - b.frequency;
    if (sortBy === 'errors') return b.errorCount - a.errorCount;
    return rank[a.health] - rank[b.health];
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SumCard label="Total" value={data.summary.total} icon={<Heart className="h-3.5 w-3.5" aria-hidden />} />
        <SumCard label="OK" value={data.summary.ok} tone="ok" />
        <SumCard label="Stale" value={data.summary.stale} tone={data.summary.stale > 0 ? 'warn' : 'ok'} />
        <SumCard label="Error" value={data.summary.error} tone={data.summary.error > 0 ? 'bad' : 'ok'} />
        <SumCard label="Pending" value={data.summary.pending} />
      </div>

      {!data.summary.booted && (
        <div className="rounded border border-yellow-700/40 bg-yellow-950/15 px-3 py-2 text-xs text-yellow-300">
          Runtime telemetry not yet recorded — counters will populate once the governor tick has cycled.
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className="text-cyan-700">Sort:</span>
        {(['health', 'frequency', 'errors'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`rounded px-2 py-0.5 ${sortBy === s ? 'bg-cyan-700/30 text-cyan-200' : 'text-cyan-600 hover:text-cyan-400'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-cyan-900/40">
        <table className="w-full font-mono text-xs">
          <thead className="bg-cyan-950/40 text-cyan-400">
            <tr>
              <th className="px-3 py-2 text-left">Health</th>
              <th className="px-3 py-2 text-left">Module</th>
              <th className="px-3 py-2 text-right">Interval</th>
              <th className="px-3 py-2 text-right">Last run</th>
              <th className="px-3 py-2 text-right">Runs</th>
              <th className="px-3 py-2 text-right">Errors</th>
              <th className="px-3 py-2 text-right">Skips</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.id} className="border-t border-cyan-900/20 hover:bg-cyan-950/20">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">{HEALTH_ICON[m.health]} {m.health}</span>
                </td>
                <td className="px-3 py-2 text-cyan-200">
                  {m.id}
                  {m.neverDisable && <span className="ml-1.5 rounded bg-cyan-900/40 px-1 py-0.5 text-[9px] text-cyan-400">locked</span>}
                </td>
                <td className="px-3 py-2 text-right text-cyan-600">{fmtInterval(m.intervalSec)}</td>
                <td className="px-3 py-2 text-right text-cyan-500">
                  {m.lastRunAgeSec == null ? '—' : `${fmtAge(m.lastRunAgeSec)} ago`}
                </td>
                <td className="px-3 py-2 text-right text-cyan-500">{m.runCount}</td>
                <td className={`px-3 py-2 text-right ${m.errorCount > 0 ? 'text-rose-400' : 'text-cyan-700'}`}>{m.errorCount}</td>
                <td className={`px-3 py-2 text-right ${m.skipCount > 0 ? 'text-yellow-400' : 'text-cyan-700'}`}>{m.skipCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modules.some((m) => m.lastError) && (
        <div className="space-y-1">
          {modules.filter((m) => m.lastError).map((m) => (
            <p key={m.id} className="rounded border border-rose-900/30 bg-rose-950/15 px-2 py-1 font-mono text-[10px] text-rose-300">
              {m.id}: {m.lastError}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SumCard({ label, value, tone = 'neutral', icon }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' | 'neutral'; icon?: React.ReactNode }) {
  const cls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
    : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
      : tone === 'ok' ? 'border-emerald-800/40 text-emerald-200'
        : 'border-cyan-900/40 text-cyan-200';
  return (
    <div className={`rounded-lg border bg-cyan-950/10 p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cyan-700">{icon}{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function fmtInterval(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}
