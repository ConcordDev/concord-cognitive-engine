'use client';

import { useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Activity, GaugeCircle, Loader2, Play, Wind } from 'lucide-react';
import type { QueueJob } from './JobList';

type SubTab = 'theory' | 'scheduling' | 'backpressure';

// Maps the queue's high/normal/low priority lanes onto the 1-10 scale the
// prioritySchedule macro expects, and gives a rough duration estimate from a
// job's own last recorded runtime (server tracks durationMs per job) when one
// hasn't run yet.
const PRIORITY_WEIGHT: Record<string, number> = { high: 9, normal: 5, low: 2 };
const DEFAULT_ESTIMATE_MS = 2000;

function StatRow({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-mono font-medium ${accent || 'text-white'}`}>{value}</span>
    </div>
  );
}

export function QueueAnalyticsPanel({
  allJobs,
  servers,
}: {
  allJobs: QueueJob[];
  /** Live worker/concurrency count, used as the analytics' default server count. */
  servers: number;
}) {
  const [sub, setSub] = useState<SubTab>('theory');
  const [serverCount, setServerCount] = useState(Math.max(1, servers));
  const [algorithm, setAlgorithm] = useState<'weighted_fair' | 'deadline_monotonic' | 'priority_preemptive'>('weighted_fair');
  const [maxCapacity, setMaxCapacity] = useState(200);
  const [targetFillRatio, setTargetFillRatio] = useState(0.7);
  const [busy, setBusy] = useState(false);
  const [theoryResult, setTheoryResult] = useState<Record<string, unknown> | null>(null);
  const [scheduleResult, setScheduleResult] = useState<Record<string, unknown> | null>(null);
  const [bpResult, setBpResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive the queueing-theory inputs from live job history — no manual entry:
  // every job's own arrival + (for finished jobs) completion timestamp.
  const { arrivals, completions } = useMemo(() => {
    const arr = allJobs.map((j) => j.createdAt).filter(Boolean) as string[];
    const comp = allJobs
      .filter((j) => (j.status === 'completed' || j.status === 'failed' || j.status === 'dead') && j.createdAt && j.finishedAt)
      .map((j) => ({ arrived: j.createdAt as string, completed: j.finishedAt as string }));
    return { arrivals: arr, completions: comp };
  }, [allJobs]);

  const pendingJobs = useMemo(
    () => allJobs.filter((j) => j.status === 'pending' || j.status === 'delayed'),
    [allJobs],
  );

  const runTheory = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await lensRun('queue', 'queueAnalytics', {
        queue: { arrivals, completions, servers: serverCount },
      });
      if (res.data.ok === false) setError(res.data.error || 'Analysis failed');
      else setTheoryResult(res.data.result as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setBusy(false);
    }
  };

  const runSchedule = async () => {
    setBusy(true);
    setError(null);
    try {
      const jobs = pendingJobs.map((j) => ({
        id: j.id,
        priority: PRIORITY_WEIGHT[j.priority] ?? 5,
        arrivalTime: j.createdAt,
        estimatedDuration: j.durationMs || DEFAULT_ESTIMATE_MS,
        weight: PRIORITY_WEIGHT[j.priority] ?? 5,
      }));
      const res = await lensRun('queue', 'prioritySchedule', { jobs, algorithm });
      if (res.data.ok === false) setError(res.data.error || 'Simulation failed');
      else setScheduleResult(res.data.result as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setBusy(false);
    }
  };

  const runBackpressure = async () => {
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const fiveMinAgo = now - 5 * 60 * 1000;
      const recentArrivals = allJobs.filter((j) => j.createdAt && Date.parse(j.createdAt) >= fiveMinAgo).length;
      const recentCompletions = allJobs.filter(
        (j) => j.finishedAt && Date.parse(j.finishedAt) >= fiveMinAgo && j.status === 'completed',
      ).length;
      const ingressRate = Math.round((recentArrivals / 5) * 100) / 100;
      const egressRate = Math.round((recentCompletions / 5) * 100) / 100;
      const depth = pendingJobs.length + allJobs.filter((j) => j.status === 'failed').length;
      const res = await lensRun('queue', 'backpressure', {
        metrics: { queueDepth: depth, maxCapacity, ingressRate, egressRate },
        targetFillRatio,
      });
      if (res.data.ok === false) setError(res.data.error || 'Computation failed');
      else setBpResult(res.data.result as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Computation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-neon-purple" /> Queueing Analytics
        </h2>
        <div className="flex gap-1 rounded-lg bg-black/30 p-1 text-xs">
          {([
            { key: 'theory', label: 'Queueing Theory' },
            { key: 'scheduling', label: 'Priority Scheduling' },
            { key: 'backpressure', label: 'Backpressure' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={`rounded px-2.5 py-1 transition-colors ${
                sub === t.key ? 'bg-neon-purple/20 text-neon-purple' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{error}</p>
      )}

      {sub === 'theory' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            M/M/1 and M/M/c queueing models computed from every job&apos;s real arrival + completion
            timestamps ({arrivals.length} arrivals, {completions.length} completions on record).
          </p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">Servers (workers)</label>
            <input
              type="number"
              min={1}
              max={64}
              value={serverCount}
              onChange={(e) => setServerCount(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white"
            />
            <button
              onClick={runTheory}
              disabled={busy || (arrivals.length < 2 && completions.length < 2)}
              className="flex items-center gap-1.5 rounded-lg bg-neon-purple/20 px-3 py-1.5 text-xs text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Analyze
            </button>
          </div>
          {theoryResult && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/30 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Rates &amp; utilization</p>
                <StatRow label="Arrival rate (λ)" value={`${String((theoryResult.rates as Record<string, unknown>)?.arrivalRate ?? '—')}/s`} />
                <StatRow label="Service rate (μ)" value={`${String((theoryResult.rates as Record<string, unknown>)?.serviceRate ?? '—')}/s`} />
                <StatRow
                  label="Utilization (ρ)"
                  value={String((theoryResult.utilization as Record<string, unknown>)?.rho ?? '—')}
                  accent={(theoryResult.utilization as Record<string, unknown>)?.status === 'overloaded' ? 'text-rose-400' : 'text-neon-green'}
                />
                <StatRow label="Status" value={String((theoryResult.utilization as Record<string, unknown>)?.status ?? '—')} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {serverCount > 1 ? 'M/M/c model' : 'M/M/1 model'}
                </p>
                {(() => {
                  const model = (serverCount > 1 ? theoryResult.mmcModel : theoryResult.mm1Model) as Record<string, unknown> | undefined;
                  if (!model || 'note' in model) return <p className="text-xs text-zinc-500">{String(model?.note ?? 'Not applicable')}</p>;
                  return (
                    <>
                      <StatRow label="Avg wait (Wq)" value={`${String(model.avgWaitTimeSeconds ?? model.avgWaitTime ?? '—')}s`} />
                      <StatRow label="Avg queue length (Lq)" value={String(model.avgQueueLength ?? '—')} />
                      <StatRow label="Idle probability" value={String(model.idleProbability ?? '—')} />
                    </>
                  );
                })()}
              </div>
              {!!theoryResult.serviceTimeDistribution && typeof theoryResult.serviceTimeDistribution === 'object' && (
                <div className="col-span-full space-y-1.5 border-t border-white/10 pt-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Service time distribution</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-300">
                    {Object.entries(theoryResult.serviceTimeDistribution as Record<string, unknown>).map(([k, v]) => (
                      <span key={k}>
                        {k}: <span className="font-mono text-neon-cyan">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {sub === 'scheduling' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Simulate a scheduling algorithm over the {pendingJobs.length} currently pending/scheduled
            job(s) — priority lanes mapped onto a 1-10 weight, fairness + starvation + deadline-miss
            analysis computed from the real order.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as typeof algorithm)}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
            >
              <option value="weighted_fair">Weighted Fair Queuing</option>
              <option value="deadline_monotonic">Deadline-Monotonic (EDF)</option>
              <option value="priority_preemptive">Priority Preemptive</option>
            </select>
            <button
              onClick={runSchedule}
              disabled={busy || pendingJobs.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-neon-purple/20 px-3 py-1.5 text-xs text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Simulate
            </button>
          </div>
          {scheduleResult && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
              {'message' in scheduleResult ? (
                <p className="text-xs text-zinc-400">{String(scheduleResult.message)}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <StatRow
                      label="Fairness (Jain's index)"
                      value={String((scheduleResult.fairness as Record<string, unknown>)?.jainsIndex ?? '—')}
                      accent="text-neon-cyan"
                    />
                    <StatRow label="Level" value={String((scheduleResult.fairness as Record<string, unknown>)?.level ?? '—')} />
                    <StatRow
                      label="Starvation"
                      value={(scheduleResult.starvation as Record<string, unknown>)?.detected ? 'detected' : 'none'}
                      accent={(scheduleResult.starvation as Record<string, unknown>)?.detected ? 'text-rose-400' : 'text-neon-green'}
                    />
                  </div>
                  <div className="space-y-1">
                    {(scheduleResult.schedule as Array<Record<string, unknown>> | undefined)?.slice(0, 8).map((row, i) => (
                      <div key={i} className="flex items-center gap-3 rounded bg-black/40 px-2 py-1 text-[11px]">
                        <span className="w-6 text-zinc-500">#{String(row.order)}</span>
                        <span className="flex-1 truncate font-mono text-zinc-300">{String(row.id)}</span>
                        <span className="text-zinc-400">wait {String(row.waitTime)}ms</span>
                        {row.meetsDeadline === false && <span className="text-rose-400">deadline missed</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {sub === 'backpressure' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Backpressure signal from live queue depth vs. a target capacity — ingress/egress rates
            measured from the last 5 minutes of real job activity.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              Target capacity
              <input
                type="number"
                min={1}
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              Target fill ratio
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                value={targetFillRatio}
                onChange={(e) => setTargetFillRatio(Math.min(1, Math.max(0.1, Number(e.target.value) || 0.7)))}
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <button
              onClick={runBackpressure}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-neon-purple/20 px-3 py-1.5 text-xs text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wind className="h-3.5 w-3.5" />} Compute
            </button>
          </div>
          {bpResult && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/30 p-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Current state</p>
                <StatRow label="Fill ratio" value={`${String((bpResult.currentState as Record<string, unknown>)?.fillRatio ?? '—')}%`} />
                <StatRow
                  label="Health"
                  value={String((bpResult.currentState as Record<string, unknown>)?.health ?? '—')}
                  accent={
                    (bpResult.currentState as Record<string, unknown>)?.health === 'critical'
                      ? 'text-rose-400'
                      : (bpResult.currentState as Record<string, unknown>)?.health === 'healthy'
                        ? 'text-neon-green'
                        : 'text-amber-400'
                  }
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                  <GaugeCircle className="h-3 w-3" /> Backpressure
                </p>
                <StatRow label="Signal" value={String((bpResult.backpressure as Record<string, unknown>)?.signal ?? '—')} />
                <StatRow label="Level" value={String((bpResult.backpressure as Record<string, unknown>)?.level ?? '—')} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Throttling</p>
                <StatRow label="Active tier" value={String((bpResult.throttling as Record<string, unknown>)?.activeTier ?? '—')} />
                <StatRow label="Recommended ingress" value={String((bpResult.throttling as Record<string, unknown>)?.recommendedIngressRate ?? '—')} />
              </div>
              {Array.isArray(bpResult.recommendations) && bpResult.recommendations.length > 0 && (
                <ul className="col-span-full space-y-1 border-t border-white/10 pt-2 text-xs text-amber-300">
                  {(bpResult.recommendations as string[]).map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
