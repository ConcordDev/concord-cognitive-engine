'use client';

/**
 * QualityLoopPanel — closes the data-quality loop for the cri lens.
 * Wires six cri.* macros that the page's existing scorecard never reached:
 *   trend-snapshot / trend-history  — quality trend over time
 *   scoreRules-get / scoreRules-set — configurable CRETI weighting + thresholds
 *   bulkRemediate                   — batch flag / queue / resolve low-quality DTUs
 *   alerts                          — quality-regression alerting
 *   rootCause                       — link a low score to its weakest dimension + fixes
 *   compare                         — side-by-side profile of two DTUs
 * Every rendered value comes from a real macro call against the live corpus.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Sliders, Flag, BellRing, GitCompare,
  Search, Loader2, RotateCcw, Check, X, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { api } from '@/lib/api/client';
import { useQuery } from '@tanstack/react-query';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

const CRETI_DIMS = ['coherence', 'relevance', 'evidence', 'timeliness', 'integration'] as const;
type CretiDim = (typeof CRETI_DIMS)[number];

interface DtuCreti {
  id: string;
  title?: string;
  summary?: string;
  creti?: Partial<Record<CretiDim | 'composite', number>>;
}

interface Snapshot {
  at: string;
  count: number;
  scored: number;
  avg: number;
  min: number;
  max: number;
  dims: Record<string, number>;
}

interface TrendResult {
  history: Snapshot[];
  points: number;
  direction: 'improving' | 'declining' | 'flat';
  delta: number;
  dimTrends: Record<string, number>;
  latest: Snapshot | null;
}

interface ScoreRules {
  weights: Record<string, number>;
  thresholds: { critical: number; warning: number; healthy: number };
  isCustom?: boolean;
  defaults?: { weights: Record<string, number>; thresholds: Record<string, number> };
}

interface FlagEntry {
  dtuId: string;
  title: string;
  score: number;
  status: 'flagged' | 'queued' | 'resolved';
  note: string;
  at: string;
}

interface AlertEntry {
  id: string;
  dtuId: string;
  title: string;
  prev: number;
  current: number;
  drop: number;
  at: string;
  acknowledged: boolean;
}

interface RootCauseRow {
  dimension: string;
  value: number;
  weight: number;
  shortfall: number;
  weightedDrag: number;
  fixes: string[];
}

interface RootCauseResult {
  dtuId: string;
  title: string;
  composite: number;
  verdict: string;
  primaryCause: string | null;
  breakdown: RootCauseRow[];
  contributors: RootCauseRow[];
  recommendedFixes: { dimension: string; fix: string }[];
}

interface CompareDim {
  dimension: string;
  a: number;
  b: number;
  delta: number;
  winner: 'a' | 'b' | 'tie';
}

interface CompareResult {
  a: { id: string; title: string; composite: number };
  b: { id: string; title: string; composite: number };
  compositeDelta: number;
  overallWinner: 'a' | 'b' | 'tie';
  dimensions: CompareDim[];
  dimensionWins: { a: number; b: number; tie: number };
  biggestGap: CompareDim | null;
}

type Tab = 'trend' | 'rules' | 'remediate' | 'alerts' | 'rootcause' | 'compare';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'trend', label: 'Trend', icon: TrendingUp },
  { id: 'rules', label: 'Score Rules', icon: Sliders },
  { id: 'remediate', label: 'Remediation', icon: Flag },
  { id: 'alerts', label: 'Alerts', icon: BellRing },
  { id: 'rootcause', label: 'Root Cause', icon: Search },
  { id: 'compare', label: 'Compare', icon: GitCompare },
];

function dtuList(raw: unknown): DtuCreti[] {
  if (Array.isArray(raw)) return raw as DtuCreti[];
  const d = raw as { dtus?: DtuCreti[] } | undefined;
  return d?.dtus || [];
}

export function QualityLoopPanel() {
  const [tab, setTab] = useState<Tab>('trend');

  // Live corpus — the source for every macro that operates on DTUs.
  const corpus = useQuery({
    queryKey: ['cri-quality-loop-dtus'],
    queryFn: async () => {
      const r = await api.get('/api/dtus', { params: { limit: 300 } });
      return dtuList(r.data);
    },
  });
  const dtus = useMemo(() => corpus.data || [], [corpus.data]);
  const scored = useMemo(() => dtus.filter((d) => d.creti), [dtus]);

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4 space-y-4">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <TrendingUp className="h-5 w-5 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Quality loop</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          {scored.length}/{dtus.length} DTUs scored
        </span>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  : 'bg-zinc-900/60 text-zinc-400 border border-zinc-800 hover:text-zinc-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {corpus.isError && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          DTU substrate unreachable.
        </div>
      )}

      {tab === 'trend' && <TrendTab dtus={dtus} />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'remediate' && <RemediateTab scored={scored} />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'rootcause' && <RootCauseTab scored={scored} />}
      {tab === 'compare' && <CompareTab scored={scored} />}
    </div>
  );
}

/* ── Trend tab — trend-snapshot + trend-history ───────────────────────── */

function TrendTab({ dtus }: { dtus: DtuCreti[] }) {
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setBusy(true);
    const r = await lensRun<TrendResult>('cri', 'trend-history', { limit: 60 });
    setBusy(false);
    if (r.data.ok && r.data.result) setTrend(r.data.result);
    else setMsg(r.data.error || 'failed to load trend history');
  }, []);

  const recordSnapshot = useCallback(async () => {
    if (dtus.length === 0) { setMsg('No DTUs to snapshot.'); return; }
    setBusy(true);
    setMsg(null);
    const payload = dtus.map((d) => ({ id: d.id, title: d.title || d.summary, creti: d.creti }));
    const r = await lensRun<{ snapshotCount: number; regressionsDetected: number }>(
      'cri', 'trend-snapshot', { dtus: payload },
    );
    if (r.data.ok && r.data.result) {
      setMsg(
        `Snapshot recorded (${r.data.result.snapshotCount} total` +
        `${r.data.result.regressionsDetected ? `, ${r.data.result.regressionsDetected} regression(s) detected` : ''}).`,
      );
      await loadHistory();
    } else {
      setBusy(false);
      setMsg(r.data.error || 'snapshot failed');
    }
  }, [dtus, loadHistory]);

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartData = useMemo(
    () => (trend?.history || []).map((s, i) => ({
      label: `#${i + 1}`,
      avg: Math.round(s.avg * 1000) / 10,
      min: Math.round(s.min * 1000) / 10,
      max: Math.round(s.max * 1000) / 10,
    })),
    [trend],
  );

  const DirIcon = trend?.direction === 'improving' ? TrendingUp
    : trend?.direction === 'declining' ? TrendingDown : Minus;
  const dirColor = trend?.direction === 'improving' ? 'text-emerald-400'
    : trend?.direction === 'declining' ? 'text-red-400' : 'text-zinc-400';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={recordSnapshot}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          Record corpus snapshot
        </button>
        <button
          type="button"
          onClick={loadHistory}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reload
        </button>
      </div>
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}

      {trend && trend.points >= 2 ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Snapshots" value={String(trend.points)} />
            <Stat
              label="Composite delta"
              value={`${trend.delta >= 0 ? '+' : ''}${(trend.delta * 100).toFixed(1)}%`}
              valueClass={dirColor}
            />
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Direction</div>
              <div className={cn('mt-0.5 flex items-center justify-center gap-1 font-mono text-sm capitalize', dirColor)}>
                <DirIcon className="h-3.5 w-3.5" /> {trend.direction}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Composite score over time (%)</div>
            <ChartKit
              kind="line"
              data={chartData}
              xKey="label"
              series={[
                { key: 'avg', label: 'Avg', color: '#06b6d4' },
                { key: 'max', label: 'Max', color: '#22c55e' },
                { key: 'min', label: 'Min', color: '#ef4444' },
              ]}
              height={200}
            />
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Per-dimension movement</div>
            <div className="space-y-1">
              {CRETI_DIMS.map((d) => {
                const v = trend.dimTrends[d] ?? 0;
                return (
                  <div key={d} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 font-mono capitalize text-zinc-400">{d}</span>
                    <div className="flex-1 h-2 rounded-full bg-zinc-800 relative overflow-hidden">
                      <div
                        className={cn('h-full absolute top-0', v >= 0 ? 'bg-emerald-500/60 left-1/2' : 'bg-red-500/60 right-1/2')}
                        style={{ width: `${Math.min(50, Math.abs(v) * 200)}%` }}
                      />
                    </div>
                    <span className={cn('w-14 text-right font-mono', v >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                      {v >= 0 ? '+' : ''}{(v * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-zinc-500">
          Record at least two snapshots to chart trend movement over time.
        </p>
      )}
    </div>
  );
}

/* ── Rules tab — scoreRules-get / scoreRules-set ──────────────────────── */

function RulesTab() {
  const [rules, setRules] = useState<ScoreRules | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState<{ critical: number; warning: number; healthy: number }>({
    critical: 0.3, warning: 0.55, healthy: 0.75,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await lensRun<ScoreRules>('cri', 'scoreRules-get', {});
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setRules(r.data.result);
      setWeights({ ...r.data.result.weights });
      setThresholds({ ...r.data.result.thresholds });
    } else {
      setMsg(r.data.error || 'failed to load score rules');
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const r = await lensRun<ScoreRules & { weightSum?: number }>('cri', 'scoreRules-set', { weights, thresholds });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setMsg('Score rules saved. New weighting applies to every quality calc.');
      await load();
    } else {
      setMsg(r.data.error || 'save failed');
    }
  }, [weights, thresholds, load]);

  const reset = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const r = await lensRun<ScoreRules>('cri', 'scoreRules-set', { reset: true });
    setBusy(false);
    if (r.data.ok) {
      setMsg('Reset to defaults.');
      await load();
    } else {
      setMsg(r.data.error || 'reset failed');
    }
  }, [load]);

  const wsum = CRETI_DIMS.reduce((a, d) => a + (weights[d] || 0), 0);

  if (!rules) {
    return <p className="text-[11px] text-zinc-500">{busy ? 'Loading score rules…' : msg || 'No rules loaded.'}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-200">CRETI dimension weights</span>
          <span className="font-mono text-[10px] text-zinc-500">Σ {wsum.toFixed(2)} (normalized on apply)</span>
        </div>
        <div className="space-y-2">
          {CRETI_DIMS.map((d) => (
            <div key={d} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 font-mono capitalize text-zinc-400">{d}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={weights[d] ?? 0}
                onChange={(e) => setWeights((w) => ({ ...w, [d]: +e.target.value }))}
                className="flex-1"
              />
              <span className="w-12 text-right font-mono text-cyan-300">{(weights[d] ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 text-xs font-semibold text-zinc-200">Health thresholds</div>
        <div className="space-y-2">
          {(['critical', 'warning', 'healthy'] as const).map((k) => (
            <div key={k} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 font-mono capitalize text-zinc-400">{k}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={thresholds[k]}
                onChange={(e) => setThresholds((t) => ({ ...t, [k]: +e.target.value }))}
                className="flex-1"
              />
              <span className="w-12 text-right font-mono text-amber-300">{thresholds[k].toFixed(2)}</span>
            </div>
          ))}
        </div>
        {!(thresholds.critical <= thresholds.warning && thresholds.warning <= thresholds.healthy) && (
          <p className="mt-1 text-[10px] text-red-400">
            Thresholds must satisfy critical ≤ warning ≤ healthy.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || wsum <= 0}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save rules
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
        </button>
        {rules.isCustom && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">custom ruleset active</span>
        )}
      </div>
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
    </div>
  );
}

/* ── Remediation tab — bulkRemediate ──────────────────────────────────── */

function RemediateTab({ scored }: { scored: DtuCreti[] }) {
  const [flags, setFlags] = useState<FlagEntry[]>([]);
  const [counts, setCounts] = useState<{ total: number; flagged: number; queued: number; resolved: number }>({
    total: 0, flagged: 0, queued: 0, resolved: 0,
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'flagged' | 'queued' | 'resolved'>('flagged');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const composite = useCallback((d: DtuCreti) => {
    const c = d.creti;
    if (!c) return 0;
    if (typeof c.composite === 'number') return c.composite;
    const vals = CRETI_DIMS.map((k) => c[k]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, []);

  // Lowest-quality DTUs are the remediation candidates.
  const candidates = useMemo(
    () => [...scored].sort((a, b) => composite(a) - composite(b)).slice(0, 30),
    [scored, composite],
  );

  const refresh = useCallback(async () => {
    const r = await lensRun<{ flags: FlagEntry[]; counts: typeof counts }>('cri', 'bulkRemediate', { op: 'list' });
    if (r.data.ok && r.data.result) {
      setFlags(r.data.result.flags);
      setCounts(r.data.result.counts);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const flagSelected = useCallback(async () => {
    if (sel.size === 0) { setMsg('Select at least one DTU.'); return; }
    setBusy(true);
    setMsg(null);
    const picked = candidates
      .filter((d) => sel.has(d.id))
      .map((d) => ({ id: d.id, title: d.title || d.summary, creti: d.creti }));
    const r = await lensRun<{ flagged: FlagEntry[] }>('cri', 'bulkRemediate', {
      op: 'flag', dtus: picked, status, note,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setMsg(`${r.data.result.flagged.length} DTU(s) marked "${status}".`);
      setSel(new Set());
      setNote('');
      await refresh();
    } else {
      setMsg(r.data.error || 'flag failed');
    }
  }, [sel, candidates, status, note, refresh]);

  const clearFlag = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun<{ cleared: number }>('cri', 'bulkRemediate', { op: 'clear', ids: [id] });
    setBusy(false);
    if (r.data.ok) await refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Total" value={String(counts.total)} />
        <Stat label="Flagged" value={String(counts.flagged)} valueClass="text-red-300" />
        <Stat label="Queued" value={String(counts.queued)} valueClass="text-amber-300" />
        <Stat label="Resolved" value={String(counts.resolved)} valueClass="text-emerald-300" />
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 text-xs font-semibold text-zinc-200">
          Lowest-quality DTUs — select to batch-remediate
        </div>
        {candidates.length === 0 ? (
          <p className="text-[11px] text-zinc-500">No scored DTUs available.</p>
        ) : (
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {candidates.map((d) => {
              const c = composite(d);
              return (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-center gap-2 rounded bg-zinc-900/60 px-2 py-1.5 text-[11px] hover:bg-zinc-800/60"
                >
                  <input
                    type="checkbox"
                    checked={sel.has(d.id)}
                    onChange={() => toggle(d.id)}
                    className="accent-cyan-500"
                  />
                  <span className="flex-1 truncate text-zinc-200">
                    {d.title || d.summary?.slice(0, 40) || d.id.slice(0, 8)}
                  </span>
                  <span
                    className={cn(
                      'font-mono',
                      c < 0.3 ? 'text-red-400' : c < 0.55 ? 'text-amber-400' : 'text-emerald-400',
                    )}
                  >
                    {(c * 100).toFixed(0)}%
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-[11px] text-white"
          >
            <option value="flagged">flagged</option>
            <option value="queued">queued</option>
            <option value="resolved">resolved</option>
          </select>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="remediation note (optional)"
            className="flex-1 min-w-[160px] rounded bg-zinc-900 border border-zinc-800 px-2 py-1 text-[11px] text-white"
          />
          <button
            type="button"
            onClick={flagSelected}
            disabled={busy || sel.size === 0}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}
            Mark {sel.size || ''}
          </button>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Remediation queue</div>
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {flags.map((f) => (
              <div key={f.dtuId} className="flex items-center gap-2 rounded bg-zinc-900/60 px-2 py-1.5 text-[11px]">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                    f.status === 'flagged' ? 'bg-red-500/20 text-red-300'
                      : f.status === 'queued' ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300',
                  )}
                >
                  {f.status}
                </span>
                <span className="flex-1 truncate text-zinc-200">{f.title}</span>
                <span className="font-mono text-zinc-400">{(f.score * 100).toFixed(0)}%</span>
                <button
                  type="button"
                  onClick={() => clearFlag(f.dtuId)}
                  className="text-zinc-500 hover:text-red-400"
                  aria-label="Remove flag"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
    </div>
  );
}

/* ── Alerts tab — alerts (list / ack / clear) ─────────────────────────── */

function AlertsTab() {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [unack, setUnack] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await lensRun<{ alerts: AlertEntry[]; unacknowledged: number }>('cri', 'alerts', { op: 'list' });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setAlerts(r.data.result.alerts);
      setUnack(r.data.result.unacknowledged);
    } else {
      setMsg(r.data.error || 'failed to load alerts');
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ack = useCallback(async (id: string) => {
    const r = await lensRun('cri', 'alerts', { op: 'ack', id });
    if (r.data.ok) await load();
  }, [load]);

  const clearAcked = useCallback(async () => {
    setBusy(true);
    const r = await lensRun<{ cleared: number }>('cri', 'alerts', { op: 'clear' });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setMsg(`Cleared ${r.data.result.cleared} acknowledged alert(s).`);
      await load();
    }
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-zinc-900 border border-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
          {alerts.length} total
        </span>
        <span
          className={cn(
            'rounded px-2.5 py-1 font-mono text-[11px]',
            unack > 0 ? 'bg-red-500/15 text-red-300' : 'bg-zinc-900 text-zinc-500 border border-zinc-800',
          )}
        >
          {unack} unacknowledged
        </span>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Refresh
        </button>
        <button
          type="button"
          onClick={clearAcked}
          disabled={busy}
          className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
        >
          Clear acknowledged
        </button>
      </div>

      <p className="text-[10px] text-zinc-500">
        Regression alerts are raised by a corpus snapshot when a DTU drops ≥10% below its baseline
        and falls under the warning threshold. Record a snapshot in the Trend tab to detect new ones.
      </p>

      {alerts.length === 0 ? (
        <p className="text-[11px] text-zinc-500">No quality-regression alerts.</p>
      ) : (
        <div className="space-y-1.5">
          {alerts.map((a) => (
            <div
              key={a.id}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px]',
                a.acknowledged
                  ? 'border-zinc-800 bg-zinc-950/40'
                  : 'border-red-500/30 bg-red-500/5',
              )}
            >
              <AlertTriangle className={cn('h-4 w-4 shrink-0', a.acknowledged ? 'text-zinc-600' : 'text-red-400')} />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-zinc-200">{a.title}</div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {(a.prev * 100).toFixed(0)}% → {(a.current * 100).toFixed(0)}%
                  <span className="ml-1 text-red-400">(−{(a.drop * 100).toFixed(0)}%)</span>
                </div>
              </div>
              {a.acknowledged ? (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">acked</span>
              ) : (
                <button
                  type="button"
                  onClick={() => ack(a.id)}
                  className="flex items-center gap-1 rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/25"
                >
                  <Check className="h-3 w-3" /> Ack
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
    </div>
  );
}

/* ── Root-cause tab — rootCause ───────────────────────────────────────── */

function RootCauseTab({ scored }: { scored: DtuCreti[] }) {
  const [dtuId, setDtuId] = useState('');
  const [result, setResult] = useState<RootCauseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(async (id: string) => {
    const d = scored.find((x) => x.id === id);
    if (!d) { setMsg('Pick a scored DTU.'); return; }
    setBusy(true);
    setMsg(null);
    const r = await lensRun<RootCauseResult>('cri', 'rootCause', {
      dtu: { id: d.id, title: d.title || d.summary, creti: d.creti },
    });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setMsg(r.data.error || 'root-cause analysis failed');
  }, [scored]);

  return (
    <div className="space-y-3">
      <select
        value={dtuId}
        onChange={(e) => { setDtuId(e.target.value); if (e.target.value) void run(e.target.value); }}
        className="w-full rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-[11px] text-white"
      >
        <option value="">Select a DTU to diagnose…</option>
        {scored.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title || d.summary?.slice(0, 50) || d.id.slice(0, 12)}
          </option>
        ))}
      </select>

      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
        </div>
      )}
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}

      {result && !busy && (
        <div className="space-y-3">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200">Verdict</span>
              <span className="font-mono text-sm text-cyan-300">{(result.composite * 100).toFixed(0)}%</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-300">{result.verdict}</p>
            {result.primaryCause && (
              <p className="mt-1 text-[11px]">
                <span className="text-zinc-500">Primary cause: </span>
                <span className="font-medium capitalize text-red-300">{result.primaryCause}</span>
              </p>
            )}
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Dimension contribution to shortfall</div>
            <div className="space-y-1.5">
              {result.breakdown.map((b) => (
                <div key={b.dimension} className="text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="w-24 font-mono capitalize text-zinc-400">{b.dimension}</span>
                    <div className="flex-1 h-2 rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-red-500/60"
                        style={{ width: `${Math.min(100, b.weightedDrag * 400)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-zinc-400">{(b.value * 100).toFixed(0)}%</span>
                  </div>
                  {b.weightedDrag > 0 && (
                    <ul className="ml-24 mt-0.5 list-disc list-inside text-[10px] text-zinc-500">
                      {b.fixes.slice(0, 1).map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>

          {result.recommendedFixes.length > 0 && (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="mb-1.5 text-xs font-semibold text-emerald-300">Recommended fixes</div>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-zinc-300">
                {result.recommendedFixes.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium capitalize text-emerald-200">{f.dimension}:</span> {f.fix}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Compare tab — compare ────────────────────────────────────────────── */

function CompareTab({ scored }: { scored: DtuCreti[] }) {
  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(async () => {
    const a = scored.find((x) => x.id === idA);
    const b = scored.find((x) => x.id === idB);
    if (!a || !b) { setMsg('Pick two scored DTUs.'); return; }
    if (a.id === b.id) { setMsg('Pick two different DTUs.'); return; }
    setBusy(true);
    setMsg(null);
    const r = await lensRun<CompareResult>('cri', 'compare', {
      dtuA: { id: a.id, title: a.title || a.summary, creti: a.creti },
      dtuB: { id: b.id, title: b.title || b.summary, creti: b.creti },
    });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setMsg(r.data.error || 'comparison failed');
  }, [idA, idB, scored]);

  const chartData = useMemo(
    () => (result?.dimensions || []).map((d) => ({
      dim: d.dimension,
      A: Math.round(d.a * 100),
      B: Math.round(d.b * 100),
    })),
    [result],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={idA}
          onChange={(e) => setIdA(e.target.value)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-[11px] text-white"
        >
          <option value="">DTU A…</option>
          {scored.map((d) => (
            <option key={d.id} value={d.id}>{d.title || d.summary?.slice(0, 36) || d.id.slice(0, 10)}</option>
          ))}
        </select>
        <select
          value={idB}
          onChange={(e) => setIdB(e.target.value)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-[11px] text-white"
        >
          <option value="">DTU B…</option>
          {scored.map((d) => (
            <option key={d.id} value={d.id}>{d.title || d.summary?.slice(0, 36) || d.id.slice(0, 10)}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy || !idA || !idB}
        className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
        Compare profiles
      </button>
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}

      {result && !busy && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <div className="truncate text-[10px] text-zinc-500">{result.a.title}</div>
              <div className={cn('mt-0.5 font-mono text-lg', result.overallWinner === 'a' ? 'text-emerald-300' : 'text-zinc-300')}>
                {(result.a.composite * 100).toFixed(0)}%
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Winner</div>
              <div className="mt-0.5 font-mono text-sm text-cyan-300">
                {result.overallWinner === 'tie' ? 'tie' : result.overallWinner === 'a' ? 'DTU A' : 'DTU B'}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <div className="truncate text-[10px] text-zinc-500">{result.b.title}</div>
              <div className={cn('mt-0.5 font-mono text-lg', result.overallWinner === 'b' ? 'text-emerald-300' : 'text-zinc-300')}>
                {(result.b.composite * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Dimension-by-dimension</div>
            <ChartKit
              kind="bar"
              data={chartData}
              xKey="dim"
              series={[
                { key: 'A', label: result.a.title, color: '#06b6d4' },
                { key: 'B', label: result.b.title, color: '#a855f7' },
              ]}
              height={200}
            />
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="space-y-1">
              {result.dimensions.map((d) => (
                <div key={d.dimension} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 font-mono capitalize text-zinc-400">{d.dimension}</span>
                  <span className="w-12 text-right font-mono text-cyan-300">{(d.a * 100).toFixed(0)}%</span>
                  <span className="text-zinc-600">vs</span>
                  <span className="w-12 font-mono text-purple-300">{(d.b * 100).toFixed(0)}%</span>
                  <span
                    className={cn(
                      'ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                      d.winner === 'a' ? 'bg-cyan-500/20 text-cyan-300'
                        : d.winner === 'b' ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-zinc-800 text-zinc-500',
                    )}
                  >
                    {d.winner === 'tie' ? 'tie' : d.winner === 'a' ? 'A' : 'B'} {d.delta >= 0 ? '+' : ''}
                    {(d.delta * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            {result.biggestGap && (
              <p className="mt-2 text-[10px] text-zinc-500">
                Biggest gap: <span className="capitalize text-zinc-300">{result.biggestGap.dimension}</span>
                {' '}({Math.abs(result.biggestGap.delta * 100).toFixed(0)}% apart)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── shared ───────────────────────────────────────────────────────────── */

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('mt-0.5 font-mono text-lg', valueClass || 'text-cyan-300')}>{value}</div>
    </div>
  );
}
