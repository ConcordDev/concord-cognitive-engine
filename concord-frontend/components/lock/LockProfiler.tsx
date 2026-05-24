/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * LockProfiler — concurrency lock-profiler surface for the lock lens.
 * Every panel is driven by a real macro on server/domains/lock.js:
 *   recordLockEvent / clearLockTrace  — per-user lock-trace buffer
 *   holdTimeline      — live lock-hold timeline (which thread held what, when)
 *   orderingAnalysis  — lock-ordering inversion / pre-deadlock detection
 *   hotspotRanking    — contention hotspots ranked by total wait time
 *   blameAttribution  — acquisition-site blame from captured stack traces
 *   amdahlProjection  — throughput-under-contention / Amdahl + USL modeling
 *   deadlockDetect    — wait-for graph cycle detection
 * No hardcoded data — the trace is recorded through recordLockEvent.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Flame,
  GitBranch,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView, TreeDiagram } from '@/components/viz';
import type { TimelineEvent, TreeNode } from '@/components/viz';

interface LockEvent {
  id: string;
  thread: string;
  lock: string;
  action: 'acquire' | 'release' | 'wait';
  waitMs: number;
  holdMs: number;
  stack: string[];
  ts: number;
}

interface HoldSpan {
  thread: string;
  lock: string;
  start: number;
  end: number;
  durationMs: number;
  closed: boolean;
}

interface Hotspot {
  rank: number;
  lock: string;
  totalWaitMs: number;
  totalHoldMs: number;
  waitCount: number;
  acquireCount: number;
  uniqueWaiters: number;
  peakWaitMs: number;
  avgWaitMs: number;
  waitShare: number;
}

interface Inversion {
  lockA: string;
  lockB: string;
  forwardThreads: string[];
  reverseThreads: string[];
  severity: string;
}

interface PrecedenceEdge {
  from: string;
  to: string;
  threads: string[];
}

interface BlameSite {
  rank: number;
  site: string;
  fullStack: string[];
  acquireCount: number;
  waitCount: number;
  totalWaitMs: number;
  totalHoldMs: number;
  blameMs: number;
  locks: string[];
  threads: string[];
}

interface CurvePoint {
  processors: number;
  amdahlSpeedup: number;
  uslSpeedup: number;
  amdahlThroughput: number;
  uslThroughput: number;
  efficiency: number;
}

type TabId = 'timeline' | 'ordering' | 'hotspots' | 'blame' | 'amdahl' | 'deadlock';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'timeline', label: 'Hold Timeline', icon: Activity },
  { id: 'hotspots', label: 'Contention Hotspots', icon: Flame },
  { id: 'ordering', label: 'Lock Ordering', icon: GitBranch },
  { id: 'deadlock', label: 'Wait-For Graph', icon: AlertTriangle },
  { id: 'blame', label: 'Blame Attribution', icon: Layers },
  { id: 'amdahl', label: 'Amdahl / USL', icon: TrendingUp },
];

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export function LockProfiler() {
  const [tab, setTab] = useState<TabId>('timeline');
  const [events, setEvents] = useState<LockEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Manual lock-event form
  const [form, setForm] = useState({
    thread: 'worker-1',
    lock: 'accounts',
    action: 'acquire' as LockEvent['action'],
    waitMs: '0',
    holdMs: '0',
    stack: '',
  });

  // Analysis results
  const [timeline, setTimeline] = useState<any>(null);
  const [ordering, setOrdering] = useState<any>(null);
  const [hotspots, setHotspots] = useState<any>(null);
  const [blame, setBlame] = useState<any>(null);
  const [amdahl, setAmdahl] = useState<any>(null);
  const [deadlock, setDeadlock] = useState<any>(null);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [tl, ord, hot, bl, am] = await Promise.all([
        lensRun('lock', 'holdTimeline', {}),
        lensRun('lock', 'orderingAnalysis', {}),
        lensRun('lock', 'hotspotRanking', {}),
        lensRun('lock', 'blameAttribution', {}),
        lensRun('lock', 'amdahlProjection', {}),
      ]);
      setTimeline(tl.data?.result || null);
      setOrdering(ord.data?.result || null);
      setHotspots(hot.data?.result || null);
      setBlame(bl.data?.result || null);
      setAmdahl(am.data?.result || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setBusy(false);
    }
  }, []);

  // Initial load of any persisted trace analysis.
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordEvent = useCallback(
    async (ev: {
      thread: string;
      lock: string;
      action: string;
      waitMs?: number;
      holdMs?: number;
      stack?: string[];
      ts?: number;
    }) => {
      const res = await lensRun('lock', 'recordLockEvent', ev);
      if (res.data?.ok === false) {
        throw new Error(res.data?.error || 'recordLockEvent failed');
      }
      return res.data?.result;
    },
    [],
  );

  const handleManualRecord = useCallback(async () => {
    if (!form.thread.trim() || !form.lock.trim()) {
      setErr('Thread and lock are required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const stack = form.stack
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await recordEvent({
        thread: form.thread.trim(),
        lock: form.lock.trim(),
        action: form.action,
        waitMs: Number(form.waitMs) || 0,
        holdMs: Number(form.holdMs) || 0,
        stack,
      });
      await refreshAll();
      setEvents((prev) => [
        ...prev,
        {
          id: `local_${Date.now()}`,
          thread: form.thread.trim(),
          lock: form.lock.trim(),
          action: form.action,
          waitMs: Number(form.waitMs) || 0,
          holdMs: Number(form.holdMs) || 0,
          stack,
          ts: Date.now(),
        },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'recordLockEvent failed');
    } finally {
      setBusy(false);
    }
  }, [form, recordEvent, refreshAll]);

  /**
   * Record a realistic interleaved nested-lock scenario so the profiler
   * panels have a trace to analyze. The scenario deliberately contains a
   * lock-ordering inversion (worker-1: accounts→audit, worker-2:
   * audit→accounts) so ordering analysis and the wait-for graph fire.
   */
  const handleRecordScenario = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const t0 = Date.now();
      const scenario: Array<{
        thread: string;
        lock: string;
        action: string;
        waitMs?: number;
        holdMs?: number;
        stack?: string[];
        ts: number;
      }> = [
        { thread: 'worker-1', lock: 'accounts', action: 'acquire', holdMs: 120, ts: t0 + 0, stack: ['transfer()', 'debitAccount()'] },
        { thread: 'worker-2', lock: 'audit', action: 'acquire', holdMs: 90, ts: t0 + 10, stack: ['logEntry()', 'appendAudit()'] },
        { thread: 'worker-3', lock: 'accounts', action: 'wait', waitMs: 110, ts: t0 + 15, stack: ['transfer()', 'creditAccount()'] },
        { thread: 'worker-1', lock: 'audit', action: 'acquire', holdMs: 40, ts: t0 + 50, stack: ['transfer()', 'recordTransfer()'] },
        { thread: 'worker-2', lock: 'accounts', action: 'wait', waitMs: 70, ts: t0 + 55, stack: ['logEntry()', 'reconcile()'] },
        { thread: 'worker-1', lock: 'audit', action: 'release', ts: t0 + 90, stack: ['transfer()', 'recordTransfer()'] },
        { thread: 'worker-1', lock: 'accounts', action: 'release', ts: t0 + 120, stack: ['transfer()', 'debitAccount()'] },
        { thread: 'worker-3', lock: 'accounts', action: 'acquire', holdMs: 60, ts: t0 + 125, stack: ['transfer()', 'creditAccount()'] },
        { thread: 'worker-2', lock: 'audit', action: 'release', ts: t0 + 130, stack: ['logEntry()', 'appendAudit()'] },
        { thread: 'worker-2', lock: 'accounts', action: 'acquire', holdMs: 50, ts: t0 + 185, stack: ['logEntry()', 'reconcile()'] },
        { thread: 'worker-2', lock: 'audit', action: 'acquire', holdMs: 30, ts: t0 + 200, stack: ['logEntry()', 'reconcile()'] },
        { thread: 'worker-3', lock: 'accounts', action: 'release', ts: t0 + 185, stack: ['transfer()', 'creditAccount()'] },
        { thread: 'worker-2', lock: 'audit', action: 'release', ts: t0 + 230, stack: ['logEntry()', 'reconcile()'] },
        { thread: 'worker-2', lock: 'accounts', action: 'release', ts: t0 + 235, stack: ['logEntry()', 'reconcile()'] },
        { thread: 'worker-4', lock: 'cache', action: 'wait', waitMs: 25, ts: t0 + 60, stack: ['readPath()', 'cacheGet()'] },
        { thread: 'worker-4', lock: 'cache', action: 'acquire', holdMs: 15, ts: t0 + 85, stack: ['readPath()', 'cacheGet()'] },
        { thread: 'worker-4', lock: 'cache', action: 'release', ts: t0 + 100, stack: ['readPath()', 'cacheGet()'] },
      ];
      for (const ev of scenario) {
        await recordEvent(ev);
      }
      setEvents(
        scenario.map((ev, i) => ({
          id: `s_${i}`,
          thread: ev.thread,
          lock: ev.lock,
          action: ev.action as LockEvent['action'],
          waitMs: ev.waitMs || 0,
          holdMs: ev.holdMs || 0,
          stack: ev.stack || [],
          ts: ev.ts,
        })),
      );
      await refreshAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'scenario record failed');
    } finally {
      setBusy(false);
    }
  }, [recordEvent, refreshAll]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await lensRun('lock', 'clearLockTrace', {});
      if (res.data?.ok === false) {
        throw new Error(res.data?.error || 'clearLockTrace failed');
      }
      setEvents([]);
      await refreshAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'clearLockTrace failed');
    } finally {
      setBusy(false);
    }
  }, [refreshAll]);

  const runDeadlock = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      // Derive a lock-snapshot from the recorded ordering precedence so
      // deadlockDetect runs against the same real trace.
      const ord = ordering;
      const lockSnapshot = (ord?.precedenceEdges || []).map((e: PrecedenceEdge) => ({
        holder: e.from,
        waiting: e.to,
      }));
      const res = await lensRun('lock', 'deadlockDetect', { data: { locks: lockSnapshot } });
      setDeadlock(res.data?.result || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'deadlockDetect failed');
    } finally {
      setBusy(false);
    }
  }, [ordering]);

  // Auto-run deadlock detection when entering its tab.
  useEffect(() => {
    if (tab === 'deadlock' && !deadlock && ordering) {
      runDeadlock();
    }
  }, [tab, deadlock, ordering, runDeadlock]);

  const hasTrace = (timeline?.eventCount || 0) > 0;

  return (
    <div className="space-y-4">
      {/* Trace recorder */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-neon-cyan" />
            Lock Trace Recorder
            {hasTrace && (
              <span className="text-xs text-gray-400">
                {timeline.eventCount} event{timeline.eventCount !== 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleRecordScenario}
              disabled={busy}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" /> Record Sample Scenario
            </button>
            <button
              onClick={refreshAll}
              disabled={busy}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Re-analyze
            </button>
            <button
              onClick={handleClear}
              disabled={busy}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50 text-rose-400"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <input
            value={form.thread}
            onChange={(e) => setForm({ ...form, thread: e.target.value })}
            placeholder="thread"
            className="bg-lattice-deep border border-white/10 rounded px-2 py-1"
            aria-label="thread name"
          />
          <input
            value={form.lock}
            onChange={(e) => setForm({ ...form, lock: e.target.value })}
            placeholder="lock"
            className="bg-lattice-deep border border-white/10 rounded px-2 py-1"
            aria-label="lock name"
          />
          <select
            value={form.action}
            onChange={(e) =>
              setForm({ ...form, action: e.target.value as LockEvent['action'] })
            }
            className="bg-lattice-deep border border-white/10 rounded px-2 py-1"
            aria-label="lock action"
          >
            <option value="acquire">acquire</option>
            <option value="wait">wait</option>
            <option value="release">release</option>
          </select>
          <input
            value={form.waitMs}
            onChange={(e) => setForm({ ...form, waitMs: e.target.value })}
            placeholder="waitMs"
            type="number"
            className="bg-lattice-deep border border-white/10 rounded px-2 py-1"
            aria-label="wait milliseconds"
          />
          <input
            value={form.holdMs}
            onChange={(e) => setForm({ ...form, holdMs: e.target.value })}
            placeholder="holdMs"
            type="number"
            className="bg-lattice-deep border border-white/10 rounded px-2 py-1"
            aria-label="hold milliseconds"
          />
          <button
            onClick={handleManualRecord}
            disabled={busy}
            className="btn-neon text-xs disabled:opacity-50"
          >
            Record
          </button>
        </div>
        <textarea
          value={form.stack}
          onChange={(e) => setForm({ ...form, stack: e.target.value })}
          placeholder="call stack — one frame per line (top frame first), used for blame attribution"
          rows={2}
          className="w-full bg-lattice-deep border border-white/10 rounded px-2 py-1 text-xs font-mono"
          aria-label="call stack frames"
        />
        {events.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {events.slice(-20).map((ev) => (
              <span
                key={ev.id}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                  ev.action === 'acquire'
                    ? 'border-neon-cyan/30 text-neon-cyan'
                    : ev.action === 'wait'
                      ? 'border-amber-500/30 text-amber-400'
                      : 'border-emerald-500/30 text-emerald-400'
                }`}
                title={ev.stack.join(' / ')}
              >
                {ev.thread}·{ev.lock}·{ev.action}
              </span>
            ))}
          </div>
        )}
        {err && <p className="text-xs text-rose-400">{err}</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-white/10">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-neon-cyan text-neon-cyan'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {!hasTrace && (
        <div className="rounded-lg border border-white/10 bg-lattice-deep p-6 text-center text-sm text-gray-400">
          No lock trace recorded yet. Record events above or click
          <span className="text-neon-cyan"> Record Sample Scenario </span>
          to populate the profiler.
        </div>
      )}

      {hasTrace && tab === 'timeline' && <TimelinePanel timeline={timeline} />}
      {hasTrace && tab === 'hotspots' && <HotspotPanel hotspots={hotspots} />}
      {hasTrace && tab === 'ordering' && <OrderingPanel ordering={ordering} />}
      {hasTrace && tab === 'deadlock' && (
        <DeadlockPanel deadlock={deadlock} onRun={runDeadlock} busy={busy} />
      )}
      {hasTrace && tab === 'blame' && <BlamePanel blame={blame} />}
      {hasTrace && tab === 'amdahl' && (
        <AmdahlPanel amdahl={amdahl} onRecompute={refreshAll} />
      )}
    </div>
  );
}

/* ── Hold timeline ─────────────────────────────────────────────── */
function TimelinePanel({ timeline }: { timeline: any }) {
  const spans: HoldSpan[] = timeline?.spans || [];
  const lanes: string[] = timeline?.lanes || [];
  const windowStart = timeline?.windowStart || 0;
  const windowMs = Math.max(1, timeline?.windowMs || 1);

  const events: TimelineEvent[] = spans.map((s, i) => ({
    id: `span_${i}`,
    label: `${s.thread} · ${s.lock}`,
    time: s.start,
    tone: s.closed ? 'good' : 'warn',
    detail: `held ${fmtMs(s.durationMs)}${s.closed ? '' : ' (still open)'}`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Hold Spans" value={spans.length} />
        <Stat label="Threads" value={lanes.length} />
        <Stat label="Window" value={fmtMs(windowMs)} />
        <Stat label="Total Held" value={fmtMs(timeline?.totalHeldMs || 0)} />
      </div>

      {/* Per-thread swimlane Gantt */}
      <div className="rounded-lg border border-white/10 bg-lattice-deep p-3 space-y-2">
        <p className="text-xs text-gray-400 mb-1">Lock-hold swimlanes</p>
        {lanes.map((lane) => (
          <div key={lane} className="flex items-center gap-2">
            <span className="w-24 text-xs font-mono text-gray-300 shrink-0 truncate">
              {lane}
            </span>
            <div className="relative flex-1 h-6 bg-lattice-void rounded overflow-hidden">
              {spans
                .filter((s) => s.thread === lane)
                .map((s, i) => {
                  const left = ((s.start - windowStart) / windowMs) * 100;
                  const width = Math.max(1.5, (s.durationMs / windowMs) * 100);
                  return (
                    <div
                      key={i}
                      className={`absolute top-0.5 bottom-0.5 rounded text-[9px] flex items-center px-1 overflow-hidden ${
                        s.closed
                          ? 'bg-neon-cyan/40 border border-neon-cyan/60'
                          : 'bg-amber-500/40 border border-amber-500/60'
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${s.lock}: ${fmtMs(s.durationMs)}`}
                    >
                      <span className="text-white truncate">{s.lock}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1">Acquisition timeline</p>
        <TimelineView events={events} />
      </div>
    </div>
  );
}

/* ── Contention hotspots ───────────────────────────────────────── */
function HotspotPanel({ hotspots }: { hotspots: any }) {
  const list: Hotspot[] = hotspots?.hotspots || [];
  const chartData = list.map((h) => ({
    lock: h.lock,
    waitMs: h.totalWaitMs,
    holdMs: h.totalHoldMs,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Locks Tracked" value={hotspots?.lockCount || 0} />
        <Stat label="Total Wait" value={fmtMs(hotspots?.totalWaitMs || 0)} />
        <Stat
          label="Worst Lock"
          value={hotspots?.worst?.lock || '—'}
        />
      </div>

      {chartData.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 mb-2">Wait vs hold time per lock</p>
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="lock"
            series={[
              { key: 'waitMs', label: 'Total wait (ms)', color: '#f59e0b' },
              { key: 'holdMs', label: 'Total hold (ms)', color: '#06b6d4' },
            ]}
            height={220}
          />
        </div>
      )}

      <div className="space-y-2">
        {list.map((h) => (
          <div
            key={h.lock}
            className="flex items-center gap-3 p-3 bg-lattice-deep rounded-lg border border-white/5"
          >
            <span className="w-7 h-7 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold shrink-0">
              #{h.rank}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-sm truncate">{h.lock}</p>
              <p className="text-xs text-gray-400">
                {h.waitCount} waits · {h.uniqueWaiters} unique waiters · peak{' '}
                {fmtMs(h.peakWaitMs)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-amber-400">
                {fmtMs(h.totalWaitMs)}
              </p>
              <p className="text-xs text-gray-400">{h.waitShare}% of wait</p>
            </div>
            <div className="w-20 h-2 bg-lattice-void rounded-full overflow-hidden shrink-0">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${Math.min(100, h.waitShare)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Lock-ordering analysis ────────────────────────────────────── */
function OrderingPanel({ ordering }: { ordering: any }) {
  const inversions: Inversion[] = ordering?.inversions || [];
  const edges: PrecedenceEdge[] = ordering?.precedenceEdges || [];
  const cycles: string[][] = ordering?.orderingCycles || [];
  const risk = ordering?.riskLevel || 'safe';

  // Build a precedence tree per root lock for visualization.
  const roots = [...new Set(edges.map((e) => e.from))].filter(
    (f) => !edges.some((e) => e.to === f),
  );
  const treeRoots = (roots.length > 0 ? roots : [...new Set(edges.map((e) => e.from))]).slice(0, 6);
  const tree: TreeNode[] = treeRoots.map((root) => buildPrecTree(root, edges, new Set()));

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border-l-4 p-3 ${
          risk === 'high'
            ? 'border-l-rose-500 bg-rose-500/5'
            : risk === 'low'
              ? 'border-l-amber-500 bg-amber-500/5'
              : 'border-l-emerald-500 bg-emerald-500/5'
        }`}
      >
        <p className="text-sm font-semibold flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Ordering risk: <span className="uppercase">{risk}</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">{ordering?.summary}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Locks" value={ordering?.lockCount || 0} />
        <Stat label="Threads" value={ordering?.threadsAnalyzed || 0} />
        <Stat label="Precedence Edges" value={edges.length} />
        <Stat
          label="Inversions"
          value={inversions.length}
          tone={inversions.length > 0 ? 'bad' : 'good'}
        />
      </div>

      {inversions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-rose-400">
            Deadlock-prone ordering inversions
          </p>
          {inversions.map((inv, i) => (
            <div
              key={i}
              className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg text-xs"
            >
              <p className="font-mono text-sm text-rose-300">
                {inv.lockA} ⇄ {inv.lockB}
              </p>
              <p className="text-gray-400 mt-1">
                <span className="text-neon-cyan">{inv.lockA}→{inv.lockB}</span> in{' '}
                {inv.forwardThreads.join(', ') || '—'} ·{' '}
                <span className="text-neon-cyan">{inv.lockB}→{inv.lockA}</span> in{' '}
                {inv.reverseThreads.join(', ') || '—'}
              </p>
              <p className="text-rose-400 mt-1">
                If both paths run concurrently this can deadlock.
              </p>
            </div>
          ))}
        </div>
      )}

      {cycles.length > 0 && (
        <div className="text-xs">
          <p className="font-semibold text-rose-400 mb-1">Ordering cycles</p>
          {cycles.map((c, i) => (
            <div
              key={i}
              className="bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 mb-1 font-mono"
            >
              {c.join(' → ')}
            </div>
          ))}
        </div>
      )}

      {tree.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 mb-2">
            Lock-precedence graph (acquired-while-holding)
          </p>
          <TreeDiagram root={tree} />
        </div>
      )}
    </div>
  );
}

function buildPrecTree(
  lock: string,
  edges: PrecedenceEdge[],
  seen: Set<string>,
): TreeNode {
  const node: TreeNode = { id: `prec_${lock}_${seen.size}`, label: lock, tone: 'info' };
  if (seen.has(lock)) {
    node.detail = '(cycle)';
    node.tone = 'bad';
    return node;
  }
  const next = new Set(seen);
  next.add(lock);
  const children = edges
    .filter((e) => e.from === lock)
    .map((e) => {
      const child = buildPrecTree(e.to, edges, next);
      child.detail = `${e.threads.length} thread(s)`;
      return child;
    });
  if (children.length > 0) node.children = children;
  return node;
}

/* ── Wait-for graph / deadlock ─────────────────────────────────── */
function DeadlockPanel({
  deadlock,
  onRun,
  busy,
}: {
  deadlock: any;
  onRun: () => void;
  busy: boolean;
}) {
  const graph: Record<string, string[]> = deadlock?.waitForGraph || {};
  const sets = deadlock?.deadlockSets || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Wait-for graph derived from the recorded lock precedence.
        </p>
        <button
          onClick={onRun}
          disabled={busy}
          className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Detect Deadlocks
        </button>
      </div>

      {deadlock && (
        <>
          <div
            className={`rounded-lg border-l-4 p-3 ${
              deadlock.deadlocked
                ? 'border-l-rose-500 bg-rose-500/5'
                : 'border-l-emerald-500 bg-emerald-500/5'
            }`}
          >
            <p
              className={`text-sm font-bold ${
                deadlock.deadlocked ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {deadlock.deadlocked
                ? `DEADLOCK DETECTED — ${deadlock.cycleCount} cycle(s)`
                : 'No deadlock in current wait-for graph'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {deadlock.totalNodes} nodes · {deadlock.totalEdges} edges
              {deadlock.message ? ` · ${deadlock.message}` : ''}
            </p>
          </div>

          {sets.length > 0 && (
            <div className="space-y-2">
              {sets.map((s: any, i: number) => (
                <div
                  key={i}
                  className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg text-xs"
                >
                  <p className="font-mono text-rose-300">{s.cycle.join(' → ')}</p>
                  <p className="text-gray-400 mt-1">
                    Suggested victim to abort:{' '}
                    <span className="text-amber-400 font-mono">
                      {s.suggestedVictim}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {Object.keys(graph).length > 0 && (
            <div className="rounded-lg border border-white/10 bg-lattice-deep p-3 text-xs">
              <p className="text-gray-400 mb-2">Wait-for edges</p>
              {Object.entries(graph).map(([from, tos]) => (
                <div key={from} className="font-mono mb-1">
                  <span className="text-neon-cyan">{from}</span>
                  <span className="text-gray-600"> waits-for </span>
                  <span className="text-amber-400">{tos.join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Blame attribution ─────────────────────────────────────────── */
function BlamePanel({ blame }: { blame: any }) {
  const sites: BlameSite[] = blame?.sites || [];

  if (sites.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-lattice-deep p-6 text-center text-sm text-gray-400">
        {blame?.message ||
          'No stack traces captured. Record lock events with a call stack to attribute blame.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Acquisition Sites" value={sites.length} />
        <Stat label="Stacked Events" value={blame?.stackedEvents || 0} />
        <Stat label="Uncaptured" value={blame?.uncapturedEvents || 0} />
      </div>

      <div className="space-y-2">
        {sites.map((s) => (
          <div
            key={s.site}
            className="p-3 bg-lattice-deep rounded-lg border border-white/5"
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">
                #{s.rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{s.site}</p>
                <p className="text-xs text-gray-400">
                  {s.acquireCount} acquires · {s.waitCount} waits ·{' '}
                  {s.locks.join(', ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-purple-400">
                  {fmtMs(s.blameMs)}
                </p>
                <p className="text-xs text-gray-400">blame total</p>
              </div>
            </div>
            {s.fullStack.length > 1 && (
              <div className="mt-2 pl-10 text-xs font-mono text-gray-400 space-y-0.5">
                {s.fullStack.map((frame, i) => (
                  <p key={i} className={i === 0 ? 'text-neon-cyan' : ''}>
                    {i === 0 ? '→ ' : '  '}
                    {frame}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Amdahl / USL projection ───────────────────────────────────── */
function AmdahlPanel({
  amdahl,
  onRecompute,
}: {
  amdahl: any;
  onRecompute: () => void;
}) {
  const curve: CurvePoint[] = amdahl?.curve || [];
  const chartData = curve.map((c) => ({
    processors: String(c.processors),
    amdahl: c.amdahlSpeedup,
    usl: c.uslSpeedup,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Throughput-under-contention modeling — serial fraction derived from
          the recorded trace.
        </p>
        <button
          onClick={onRecompute}
          className="btn-secondary text-xs flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Recompute
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Serial Fraction"
          value={`${((amdahl?.serialFraction || 0) * 100).toFixed(1)}%`}
        />
        <Stat
          label="Source"
          value={amdahl?.serialFractionSource || '—'}
        />
        <Stat
          label="Amdahl Ceiling"
          value={
            typeof amdahl?.amdahlCeiling === 'number'
              ? `${amdahl.amdahlCeiling}×`
              : amdahl?.amdahlCeiling || '—'
          }
        />
        <Stat
          label="USL Peak"
          value={
            amdahl?.uslPeak
              ? `${amdahl.uslPeak.speedup}× @ ${amdahl.uslPeak.processors}p`
              : '—'
          }
        />
      </div>

      {chartData.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 mb-2">
            Speedup vs processor count
          </p>
          <ChartKit
            kind="line"
            data={chartData}
            xKey="processors"
            series={[
              { key: 'amdahl', label: 'Amdahl (ideal)', color: '#06b6d4' },
              { key: 'usl', label: 'USL (with coherency)', color: '#ec4899' },
            ]}
            height={240}
          />
        </div>
      )}

      {amdahl?.verdict && (
        <div className="rounded-lg border border-white/10 bg-lattice-deep p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
            Verdict
          </p>
          <p className="text-sm text-gray-300">{amdahl.verdict}</p>
        </div>
      )}

      {curve.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left border-b border-white/10">
                <th className="py-1 pr-3">Cores</th>
                <th className="py-1 pr-3">Amdahl×</th>
                <th className="py-1 pr-3">USL×</th>
                <th className="py-1 pr-3">USL throughput</th>
                <th className="py-1 pr-3">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((c) => (
                <tr key={c.processors} className="border-b border-white/5">
                  <td className="py-1 pr-3 font-mono">{c.processors}</td>
                  <td className="py-1 pr-3 text-neon-cyan">{c.amdahlSpeedup}</td>
                  <td className="py-1 pr-3 text-neon-pink">{c.uslSpeedup}</td>
                  <td className="py-1 pr-3">{c.uslThroughput}</td>
                  <td className="py-1 pr-3">
                    {(c.efficiency * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Shared stat tile ──────────────────────────────────────────── */
function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'good' | 'bad';
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-lattice-deep p-3 text-center">
      <p
        className={`text-lg font-bold ${
          tone === 'good'
            ? 'text-emerald-400'
            : tone === 'bad'
              ? 'text-rose-400'
              : 'text-neon-cyan'
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
