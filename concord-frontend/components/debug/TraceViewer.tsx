'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * TraceViewer — Datadog-style distributed trace / span waterfall.
 *
 * Wires the `debug` domain macros:
 *   trace-record · trace-list · trace-detail
 *
 * Every value rendered comes from a real macro response.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Activity, Loader2, Plus, RefreshCw } from 'lucide-react';

interface Span {
  spanId: string;
  parentId: string | null;
  name: string;
  service: string;
  startMs: number;
  endMs: number;
  status: 'ok' | 'error';
  durationMs: number;
  offsetPct: number;
  widthPct: number;
  depth: number;
}
interface TraceSummary {
  id: string;
  name: string;
  spanCount: number;
  totalDurationMs: number;
  errorCount: number;
  rootService: string;
  recordedAt: string;
}
interface TraceDetail extends TraceSummary {
  spans: Span[];
}
interface ServiceRollup {
  service: string;
  spans: number;
  totalMs: number;
  errors: number;
}

const SERVICE_COLOR: Record<string, string> = {};
const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];
function colorFor(service: string): string {
  if (!SERVICE_COLOR[service]) {
    SERVICE_COLOR[service] = PALETTE[Object.keys(SERVICE_COLOR).length % PALETTE.length];
  }
  return SERVICE_COLOR[service];
}

export function TraceViewer() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [rollup, setRollup] = useState<ServiceRollup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('debug', 'trace-list', {});
    if (r.data?.ok && r.data.result) {
      setTraces(r.data.result.traces || []);
    } else {
      setError(r.data?.error || 'Failed to load traces');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, []);

  const openTrace = useCallback(async (id: string) => {
    const r = await lensRun('debug', 'trace-detail', { id });
    if (r.data?.ok && r.data.result) {
      setDetail(r.data.result.trace);
      setRollup(r.data.result.serviceBreakdown || []);
    }
  }, []);

  // Records a real span tree captured from the running lens stack.
  const recordSample = useCallback(async () => {
    setBusy(true);
    const t0 = performance.now();
    // Capture genuine timings of in-page macro round-trips as spans.
    const probe = await lensRun('debug', 'trace-list', {});
    const t1 = performance.now();
    const probe2 = await lensRun('debug', 'alert-list', {});
    const t2 = performance.now();
    const base = Date.now();
    const r = await lensRun('debug', 'trace-record', {
      name: 'lens.debug bootstrap',
      spans: [
        {
          spanId: 's-root',
          name: 'GET /lenses/debug',
          service: 'frontend',
          startMs: base,
          endMs: base + (t2 - t0),
          status: 'ok',
        },
        {
          spanId: 's-traces',
          parentId: 's-root',
          name: 'POST /api/lens/run debug.trace-list',
          service: 'macro-router',
          startMs: base,
          endMs: base + (t1 - t0),
          status: probe.data?.ok ? 'ok' : 'error',
        },
        {
          spanId: 's-alerts',
          parentId: 's-root',
          name: 'POST /api/lens/run debug.alert-list',
          service: 'macro-router',
          startMs: base + (t1 - t0),
          endMs: base + (t2 - t0),
          status: probe2.data?.ok ? 'ok' : 'error',
        },
      ],
    });
    setBusy(false);
    if (r.data?.ok && r.data.result?.trace) {
      load();
      openTrace(r.data.result.trace.id);
    } else {
      setError(r.data?.error || 'Trace record failed');
    }
  }, [load, openTrace]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" /> Distributed Trace Viewer
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={recordSample}
            disabled={busy}
            className="text-xs px-2 py-1 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Capture Trace
          </button>
          <button
            onClick={load}
            className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trace list */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? (
            <div className="text-center py-6 text-gray-500 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : traces.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">
              <Activity className="w-7 h-7 mx-auto mb-2 opacity-40" />
              No traces — capture one
            </div>
          ) : (
            <div className="space-y-2 max-h-[440px] overflow-y-auto">
              {traces.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTrace(t.id)}
                  className={`w-full text-left p-2.5 rounded-lg border ${
                    detail?.id === t.id
                      ? 'border-neon-cyan/40 bg-neon-cyan/[0.06]'
                      : 'border-lattice-border bg-lattice-deep hover:border-lattice-border/80'
                  }`}
                >
                  <p className="text-xs font-mono text-gray-200 truncate">{t.name}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                    <span className="text-yellow-400">{t.totalDurationMs}ms</span>
                    <span>{t.spanCount} spans</span>
                    {t.errorCount > 0 && (
                      <span className="text-red-400">{t.errorCount} err</span>
                    )}
                    <span className="text-neon-purple">{t.rootService}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Waterfall */}
        <div className="lg:col-span-2">
          {!detail ? (
            <div className="text-center py-12 text-gray-600 text-sm border border-dashed border-lattice-border rounded-lg">
              Select a trace to view the span waterfall
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-gray-200">{detail.name}</p>
                <span className="text-xs text-yellow-400">{detail.totalDurationMs}ms total</span>
              </div>

              {/* Span waterfall */}
              <div className="space-y-1 bg-lattice-deep rounded-lg p-3 border border-lattice-border">
                {detail.spans.map((sp) => (
                  <div key={sp.spanId} className="flex items-center gap-2 text-[11px]">
                    <div
                      className="w-44 shrink-0 truncate font-mono text-gray-300"
                      style={{ paddingLeft: `${sp.depth * 12}px` }}
                      title={sp.name}
                    >
                      {sp.name}
                    </div>
                    <div className="relative flex-1 h-4 bg-lattice-void rounded">
                      <div
                        className="absolute h-full rounded"
                        style={{
                          left: `${sp.offsetPct}%`,
                          width: `${Math.max(sp.widthPct, 1.5)}%`,
                          backgroundColor:
                            sp.status === 'error' ? '#ef4444' : colorFor(sp.service),
                          opacity: 0.85,
                        }}
                        title={`${sp.service} · ${sp.durationMs}ms`}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-gray-400 font-mono">
                      {sp.durationMs}ms
                    </span>
                  </div>
                ))}
              </div>

              {/* Service rollup */}
              {rollup.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                    Service Breakdown
                  </p>
                  <div className="space-y-1">
                    {rollup.map((s) => (
                      <div
                        key={s.service}
                        className="flex items-center gap-2 text-[11px] bg-lattice-deep rounded px-2 py-1"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: colorFor(s.service) }}
                        />
                        <span className="text-gray-300 font-mono flex-1">{s.service}</span>
                        <span className="text-gray-500">{s.spans} spans</span>
                        <span className="text-yellow-400 w-16 text-right">{s.totalMs}ms</span>
                        {s.errors > 0 && <span className="text-red-400">{s.errors} err</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
