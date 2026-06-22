'use client';

/**
 * Ops Telemetry Lens (Phase B + C + D + F)
 *
 * Operator surface for the concurrency / threading stack:
 *   - Per-module heartbeat timing (p50/p90/p99 + last run) — Phase B
 *   - Macro pool + heartbeat worker pool utilisation — Phase C
 *   - Brain endpoint inflight + failure counts — Phase D
 *   - Per-world shard status + manual restart — Phase F
 *
 * Reads from /api/admin/heartbeat-stats, /api/admin/worker-stats,
 * /api/admin/brain-endpoints, /api/admin/world-shards (all admin-gated).
 *
 * Auto-refreshes every 5 seconds while the tab is visible.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LivenessPanel } from '@/components/admin/LivenessPanel';
import { Activity, Cpu, Brain, Globe, RefreshCcw, AlertTriangle, Layers } from 'lucide-react';

interface HeartbeatStatRow {
  id: string;
  frequency: number;
  scope: 'global' | 'world';
  serial: boolean;
  worker: boolean;
  sampleCount: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  lastMs: number;
  lastAt: number;
  totalRuns: number;
}

interface PoolStats {
  poolSize: number;
  ready: boolean;
  busy: number;
  idle: number;
  queueLength: number;
  metrics: {
    dispatched: number;
    completed: number;
    errors: number;
    timeouts?: number;
    queueHighWater: number;
    avgLatencyMs: number;
  };
}

interface BrainEndpointRow {
  url: string;
  inflight: number;
  failures: number;
  lastHealthyAt: number;
}
interface BrainRow {
  brain: string;
  model: string;
  maxConcurrent: number | null;
  endpoints: BrainEndpointRow[];
}

interface WorldShardRow {
  worldId: string;
  status: string;
  pid: number | null;
  startedAt: number;
  lastTickAt: number;
  lastTickCount: number;
  restartCount: number;
}

export default function OpsTelemetryPage() {
  const [hbStats, setHbStats] = useState<HeartbeatStatRow[]>([]);
  const [macroPool, setMacroPool] = useState<PoolStats | null>(null);
  const [hbPool, setHbPool] = useState<PoolStats | null>(null);
  const [brains, setBrains] = useState<BrainRow[]>([]);
  const [brainActivity, setBrainActivity] = useState<Array<{ brain: string; role: string; model: string; enabled: boolean; requests: number; errors: number; dtusGenerated: number; avgMs: number; idleSeconds: number | null }>>([]);
  const [shards, setShards] = useState<WorldShardRow[]>([]);
  const [sharded, setSharded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // Wave 7 / D2 — the cost-story telemetry ("a thousand NPCs for the cost of ten").
  const [costs, setCosts] = useState<{ calls: number; tokensIn: number; tokensOut: number; costLabel: string; byBrain: Record<string, { calls: number }> } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // Probe the first admin endpoint status-aware so a 403 renders the friendly
      // admin-gate instead of a stuck spinner / empty tables.
      const hbRes = await fetch('/api/admin/heartbeat-stats', { credentials: 'include' });
      if (hbRes.status === 403) { setForbidden(true); return; }
      const hb = await hbRes.json().catch(() => null);
      const [wp, be, ws, ic, ba] = await Promise.all([
        fetch('/api/admin/worker-stats', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/brain-endpoints', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/world-shards', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/inference-costs?hours=24', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        fetch('/api/admin/brain-activity', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      ]);
      if (hb?.ok) setHbStats(hb.modules || []);
      if (wp?.ok) { setMacroPool(wp.macroPool || null); setHbPool(wp.heartbeatPool || null); }
      if (be?.ok) setBrains(be.brains || []);
      if (ba?.ok) setBrainActivity(ba.brains || []);
      if (ws?.ok) { setShards(ws.shards || []); setSharded(!!ws.sharded); }
      if (ic?.ok) setCosts({ calls: ic.calls, tokensIn: ic.tokensIn, tokensOut: ic.tokensOut, costLabel: ic.costLabel, byBrain: ic.byBrain || {} });
      setLastRefresh(new Date());
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const restartShard = useCallback(async (worldId: string) => {
    try {
      await fetch(`/api/admin/world-shards/${encodeURIComponent(worldId)}/restart`, {
        method: 'POST',
        credentials: 'include',
      });
      refresh();
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
  }, [refresh]);

  if (forbidden) return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  return (
    <LensShell lensId="ops-telemetry" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="ops-telemetry" size="sm" className="ml-2" />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Activity className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Ops Telemetry</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Concurrency stack — heartbeat timings, worker pools, brain endpoints, world shards.
              </p>
            </div>
            <button onClick={refresh} className="flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-300 hover:bg-fuchsia-500/20">
              <RefreshCcw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'refreshing…' : 'refresh'}
            </button>
          </div>
          {err && (
            <div className="mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {err}
            </div>
          )}
          {lastRefresh && (
            <div className="mx-auto mt-1 max-w-screen-2xl text-[10px] text-slate-400">last refreshed {lastRefresh.toLocaleTimeString()}</div>
          )}
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-4 px-3 py-4 sm:px-6 sm:py-5">
          {/* F2 — substrate liveness (the moat-mass + funnel/distribution/economy headline) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <LivenessPanel />
          </div>

          {/* Wave 7 / D2 — the cost-story telemetry: LLM calls track SALIENT exchanges,
              not population. "A thousand instinct NPCs for the cost of ten." */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
              <Brain className="h-4 w-4" /> Inference cost (24h)
              <span className="text-[10px] font-normal text-slate-400">LLM wakes only on salience</span>
            </h2>
            {costs ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="LLM calls" value={costs.calls.toLocaleString()} />
                <Metric label="Tokens in" value={costs.tokensIn.toLocaleString()} />
                <Metric label="Tokens out" value={costs.tokensOut.toLocaleString()} />
                <Metric label="Est. cost" value={costs.costLabel} />
                {Object.entries(costs.byBrain).map(([brain, b]) => (
                  <Metric key={brain} label={brain} value={`${b.calls} calls`} />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">No inference recorded in the window — the village is living on instinct.</p>
            )}
          </div>

          {/* Worker pools */}
          <div className="grid gap-3 lg:grid-cols-2">
            <PoolCard title="Macro worker pool" icon={Cpu} stats={macroPool} />
            <PoolCard title="Heartbeat worker pool" icon={Cpu} stats={hbPool} />
          </div>

          {/* Heartbeat modules */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
              <Layers className="h-4 w-4" /> Heartbeat modules
              <span className="text-[10px] font-normal text-slate-400">sorted by p99 (slowest first)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-slate-400">
                    <th className="px-2 py-1.5">module</th>
                    <th className="px-2 py-1.5">freq</th>
                    <th className="px-2 py-1.5">scope</th>
                    <th className="px-2 py-1.5">tags</th>
                    <th className="px-2 py-1.5 text-right">last</th>
                    <th className="px-2 py-1.5 text-right">p50</th>
                    <th className="px-2 py-1.5 text-right">p90</th>
                    <th className="px-2 py-1.5 text-right">p99</th>
                    <th className="px-2 py-1.5 text-right">runs</th>
                  </tr>
                </thead>
                <tbody>
                  {hbStats.length === 0 && (
                    <tr><td colSpan={9} className="px-2 py-4 text-center text-slate-500">no samples yet (tick interval 60s — give it a minute)</td></tr>
                  )}
                  {hbStats.slice(0, 80).map((m) => (
                    <tr key={m.id} className={`border-b border-zinc-900 ${m.p99 > 10000 ? 'bg-red-500/10' : m.p99 > 5000 ? 'bg-amber-500/10' : ''}`}>
                      <td className="px-2 py-1 font-mono text-slate-200">{m.id}</td>
                      <td className="px-2 py-1 text-slate-400">{m.frequency}</td>
                      <td className="px-2 py-1 text-slate-400">{m.scope}</td>
                      <td className="px-2 py-1 text-slate-400">
                        {m.worker && <span className="mr-1 rounded bg-fuchsia-500/20 px-1 text-fuchsia-300">worker</span>}
                        {m.serial && <span className="rounded bg-amber-500/20 px-1 text-amber-300">serial</span>}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-slate-300">{m.lastMs.toFixed(1)}ms</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{m.p50.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-400">{m.p90.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{m.p99.toFixed(1)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{m.totalRuns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Brain endpoints */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
              <Brain className="h-4 w-4" /> Brain endpoints (Phase D)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brains.map((b) => (
                <div key={b.brain} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] text-emerald-200">{b.brain}</span>
                    <span className="text-[10px] text-emerald-300/70">max={b.maxConcurrent ?? '—'}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-emerald-300/60">{b.model}</p>
                  <ul className="mt-2 space-y-1">
                    {b.endpoints.map((ep) => {
                      const stale = ep.lastHealthyAt > 0 && (Date.now() - ep.lastHealthyAt) > 60_000;
                      const wedged = ep.failures >= 3;
                      return (
                        <li key={ep.url} className={`flex items-center justify-between rounded px-2 py-1 ${wedged ? 'bg-red-500/20' : stale ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                          <span className="truncate font-mono text-[10px] text-emerald-100">{ep.url}</span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] text-emerald-200">
                            inflight={ep.inflight} fail={ep.failures}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {brains.length === 0 && <p className="text-[11px] text-slate-400">no endpoints loaded</p>}
            </div>
          </div>

          {/* Brain activity — per-brain division of labor (aggregate counts only, no content) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Activity className="h-4 w-4" /> Brain activity
              <span className="ml-1 text-[10px] font-normal normal-case text-slate-400">who&apos;s pulling their weight (counts only)</span>
            </h2>
            <div className="space-y-1.5">
              {brainActivity.map((b) => {
                const live = b.idleSeconds != null && b.idleSeconds < 120;
                return (
                  <div key={b.brain} className="flex items-center justify-between rounded border border-zinc-800/60 bg-black/20 px-2 py-1 text-[11px]">
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-200">{b.brain}</span>
                      <span className="ml-2 text-slate-400">{b.role}</span>
                      <div className="text-[10px] text-slate-400">{b.model}{!b.enabled && ' · offline'}</div>
                    </div>
                    <div className="flex items-center gap-3 text-right tabular-nums">
                      <span className="text-cyan-300" title="total requests">{b.requests}<span className="text-slate-500"> req</span></span>
                      {b.errors > 0 && <span className="text-red-400" title="errors">{b.errors} err</span>}
                      <span className="text-slate-400" title="avg latency">{b.avgMs}ms</span>
                      <span className={live ? 'text-emerald-400' : 'text-slate-500'} title="last active">
                        {b.idleSeconds == null ? 'idle' : live ? '● active' : `${b.idleSeconds}s ago`}
                      </span>
                    </div>
                  </div>
                );
              })}
              {brainActivity.length === 0 && <p className="text-[11px] text-slate-400">no brain activity loaded</p>}
            </div>
          </div>

          {/* World shards */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Globe className="h-4 w-4" /> World shards (Phase F)
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${sharded ? 'bg-cyan-500/20 text-cyan-200' : 'bg-slate-500/20 text-slate-300'}`}>
                {sharded ? 'enabled' : 'disabled — in-process'}
              </span>
            </h2>
            {!sharded ? (
              <p className="text-[11px] text-slate-400">
                CONCORD_SHARD_WORLDS=false. Per-world heartbeat modules run in-process on the parent.
                Enable in <code className="rounded bg-slate-800 px-1">.env</code> to shard worlds into child processes.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-slate-400">
                      <th className="px-2 py-1.5">world</th>
                      <th className="px-2 py-1.5">status</th>
                      <th className="px-2 py-1.5">pid</th>
                      <th className="px-2 py-1.5 text-right">last tick</th>
                      <th className="px-2 py-1.5 text-right">restart count</th>
                      <th className="px-2 py-1.5 text-right">action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shards.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">no shards spawned</td></tr>
                    )}
                    {shards.map((s) => (
                      <tr key={s.worldId} className={`border-b border-zinc-900 ${s.status === 'crashed' ? 'bg-red-500/10' : s.status === 'catching-up' ? 'bg-amber-500/10' : ''}`}>
                        <td className="px-2 py-1 font-mono text-slate-200">{s.worldId}</td>
                        <td className="px-2 py-1 text-slate-300">{s.status}</td>
                        <td className="px-2 py-1 font-mono text-slate-400">{s.pid ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono text-slate-400">{s.lastTickAt ? `${Math.round((Date.now() - s.lastTickAt) / 1000)}s ago` : '—'}</td>
                        <td className="px-2 py-1 text-right font-mono text-slate-400">{s.restartCount}</td>
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => restartShard(s.worldId)} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20">restart</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  );
}

function PoolCard({ title, icon: Icon, stats }: { title: string; icon: React.ComponentType<{ className?: string }>; stats: PoolStats | null }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
        <Icon className="h-4 w-4" /> {title}
      </h2>
      {stats ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="pool size" value={String(stats.poolSize)} />
          <Stat label="busy" value={String(stats.busy)} />
          <Stat label="idle" value={String(stats.idle)} />
          <Stat label="queued" value={String(stats.queueLength)} />
          <Stat label="dispatched" value={String(stats.metrics.dispatched)} />
          <Stat label="completed" value={String(stats.metrics.completed)} />
          <Stat label="errors" value={String(stats.metrics.errors)} />
          <Stat label="avg ms" value={`${stats.metrics.avgLatencyMs}`} />
        </div>
      ) : (
        <p className="text-[11px] text-slate-400">pool stats unavailable</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-fuchsia-500/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-fuchsia-300/80">{label}</div>
      <div className="font-mono text-[12px] text-fuchsia-100">{value}</div>
    </div>
  );
}
