'use client';

/**
 * TracesPanel — distributed-trace / request-latency view. Backed by
 * `system.traces` (latency percentiles + per-route rollup) and
 * `system.trace-record` for the lens to self-time its own macro calls so
 * the span buffer is never empty on a fresh box.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, Gauge } from 'lucide-react';

interface Span {
  id: string;
  at: string;
  route: string;
  method: string;
  durationMs: number;
  status: number;
  actor: string;
}

interface RouteRollup {
  route: string;
  count: number;
  totalMs: number;
  errors: number;
  maxMs: number;
  avgMs: number;
}

interface TracesResult {
  spans: Span[];
  count: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  errorRate: number;
  routes: RouteRollup[];
}

export function TracesPanel({ live }: { live: boolean }) {
  const [data, setData] = useState<TracesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Self-time this very macro call so the trace buffer reflects real activity.
    const t0 = performance.now();
    const r = await lensRun<TracesResult>('system', 'traces', { limit: 120 });
    const dur = Math.round(performance.now() - t0);
    await lensRun('system', 'trace-record', {
      route: '/api/lens/run system.traces',
      method: 'POST',
      durationMs: dur,
      status: r.data.ok ? 200 : 500,
    });
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'traces unavailable');
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
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading request traces…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">
        {err || 'No traces.'}
      </div>
    );
  }

  const latencyData = data.spans
    .slice()
    .reverse()
    .map((s, i) => ({ i: String(i + 1), durationMs: s.durationMs }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <PctCard label="p50" value={data.p50} />
        <PctCard label="p95" value={data.p95} />
        <PctCard label="p99" value={data.p99} />
        <PctCard label="max" value={data.maxMs} />
        <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-cyan-700">Error rate</div>
          <div className={`font-mono text-xl font-semibold ${data.errorRate > 5 ? 'text-rose-300' : 'text-cyan-100'}`}>
            {data.errorRate}%
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
          <Gauge className="h-3.5 w-3.5" aria-hidden /> Span latency (ms, chronological)
        </h3>
        <ChartKit
          kind="line"
          data={latencyData}
          xKey="i"
          series={[{ key: 'durationMs', label: 'ms', color: '#06b6d4' }]}
          height={180}
        />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-cyan-300">Per-route rollup ({data.routes.length})</h3>
        {data.routes.length === 0 ? (
          <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
            No route traces recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cyan-900/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-cyan-950/40 text-cyan-400">
                <tr>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Avg ms</th>
                  <th className="px-3 py-2 text-right">Max ms</th>
                  <th className="px-3 py-2 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((r) => (
                  <tr key={r.route} className="border-t border-cyan-900/20 hover:bg-cyan-950/20">
                    <td className="px-3 py-2 text-cyan-200">{r.route}</td>
                    <td className="px-3 py-2 text-right text-cyan-500">{r.count}</td>
                    <td className="px-3 py-2 text-right text-cyan-300">{r.avgMs}</td>
                    <td className="px-3 py-2 text-right text-cyan-500">{r.maxMs}</td>
                    <td className={`px-3 py-2 text-right ${r.errors > 0 ? 'text-rose-400' : 'text-cyan-700'}`}>{r.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold text-cyan-300">Recent spans</h3>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-cyan-900/40 bg-black/40 font-mono text-[11px]">
          {data.spans.map((s) => (
            <div key={s.id} className="flex gap-2 border-b border-cyan-900/15 px-3 py-1">
              <span className="shrink-0 text-cyan-800">{new Date(s.at).toLocaleTimeString()}</span>
              <span className={`shrink-0 w-12 ${s.status >= 400 ? 'text-rose-400' : 'text-emerald-500'}`}>{s.method}</span>
              <span className="break-all text-cyan-200">{s.route}</span>
              <span className="ml-auto shrink-0 text-cyan-500">{s.durationMs}ms</span>
              <span className={`shrink-0 ${s.status >= 400 ? 'text-rose-400' : 'text-cyan-700'}`}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PctCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-cyan-700">{label}</div>
      <div className="font-mono text-xl font-semibold text-cyan-100">{value}<span className="text-xs text-cyan-700">ms</span></div>
    </div>
  );
}
