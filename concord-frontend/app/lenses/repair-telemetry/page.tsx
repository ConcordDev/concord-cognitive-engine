'use client';

/**
 * Maintenance — the repair-telemetry operator lens. "Query what the world
 * repaired while you slept." Surfaces the autonomic nervous system: the
 * Homeostasis ledger (healed vs escalated findings, every 4h pass), the
 * escalation inbox (the value/arc calls the cortex refused to make — approve
 * / dismiss, PagerDuty-shaped triage), and Repair Memory's learned-fix
 * patterns (Sentry-shaped issue/resolution-rate list).
 *
 * This is a read-only monitoring DASHBOARD over the REAL `repair` domain
 * (server/domains/repair.js): health_log / escalations / memory reads + the
 * resolve_escalation operator decision. By design it has NO authoring
 * surface (editor / pipeline / dtu) — a telemetry dashboard observes, it
 * does not author, so no ManifestActionBar/generic action scaffold here.
 *
 * Rebuild notes (2026-07-11, Wave 3 continuation): the previous version of
 * this page called all four real macros but silently dropped two fields the
 * backend already returns — `health_log`'s per-finding `detail_json` (the
 * negative balance / overdue seconds / duplicate-edge count that explains
 * *why* a finding fired) and `memory`'s `topPatterns` (the ranked list of
 * learned error→fix patterns with occurrence counts, success rates, and
 * CVE tags — the actual "what the cortex learned" surface, not just the
 * rollup numbers). Both are wired in below with no new backend code.
 *
 * Four honest UX states: loading (role=status, skeleton) / error (role=alert
 * + Retry) / empty / populated. Forbidden -> AdminRequiredState (operator-
 * scoped, matches server-side auth).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Skeleton, SkeletonTableRows } from '@/components/ui/Skeleton';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { useDensity } from '@/lib/hooks/useDensity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun, isForbidden } from '@/lib/api/client';
import { cn, formatRelativeTime } from '@/lib/utils';

// ── Types (shapes returned by server/domains/repair.js) ─────────────────────

type Category = 'economy' | 'liveness' | 'arc';
type Disposition = 'healed' | 'escalated' | 'noted';
type Priority = 'high' | 'normal';
type FilterTab = 'all' | Disposition;

interface HealthEntry {
  id: string;
  pathology: string;
  category: Category;
  disposition: Disposition;
  subject_id: string;
  checked_at: number; // unix seconds
  detail: Record<string, unknown>;
}

interface Escalation {
  id: string;
  message: string;
  priority: Priority;
  status: string;
  created_at: string; // ISO
}

interface RepairPattern {
  pattern: string;
  fix?: unknown;
  occurrences: number;
  successes: number;
  failures: number;
  successRate: number;
  firstSeen: string;
  lastSeen: string;
  deprecated: boolean;
  securityRelated?: boolean;
  cveId?: string | null;
}

interface MemStats {
  totalPatterns: number;
  totalRepairs: number;
  avgSuccessRate: number;
  deprecatedFixes: number;
  topPatterns: RepairPattern[];
}

type LoadState = 'loading' | 'error' | 'ready';

const FILTER_TABS: { id: FilterTab; label: string; key: string }[] = [
  { id: 'all', label: 'All', key: '1' },
  { id: 'healed', label: 'Healed', key: '2' },
  { id: 'escalated', label: 'Escalated', key: '3' },
  { id: 'noted', label: 'Noted', key: '4' },
];

const DISPOSITION_STYLE: Record<Disposition, { dot: string; text: string; icon: typeof CheckCircle2 }> = {
  healed: { dot: 'bg-emerald-400', text: 'text-emerald-300', icon: CheckCircle2 },
  escalated: { dot: 'bg-amber-400', text: 'text-amber-300', icon: AlertTriangle },
  noted: { dot: 'bg-slate-400', text: 'text-slate-400', icon: Circle },
};

const CATEGORY_STYLE: Record<Category, string> = {
  economy: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  liveness: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
  arc: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200',
};

const AUTO_REFRESH_MS = 30_000; // the monitor pass itself runs on a ~4h cadence; this just re-polls the ledger
const AUTO_REFRESH_KEY = 'concord:repair-telemetry:auto-refresh';

/** Formats a finding's `detail` payload into a short, pathology-aware summary. Never fabricates — only formats fields the backend actually sent. */
function formatDetail(pathology: string, detail: Record<string, unknown> | undefined): string {
  const d = detail || {};
  if (pathology === 'negative_balance' && typeof d.balance === 'number') return `balance ${d.balance.toFixed(2)} CC`;
  if (pathology === 'dupe_citation' && typeof d.count === 'number') return `${d.count}× duplicate royalty edges`;
  if (pathology === 'stuck_scheduler' && typeof d.overdue_s === 'number') return `${humanizeDuration(d.overdue_s as number)} overdue`;
  const keys = Object.keys(d);
  if (!keys.length) return '—';
  return keys.slice(0, 2).map((k) => `${k}: ${JSON.stringify(d[k])}`).join(', ');
}

function humanizeDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

export default function RepairTelemetryPage() {
  const [log, setLog] = useState<HealthEntry[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [mem, setMem] = useState<MemStats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | null>(null);
  const [pendingEscalationId, setPendingEscalationId] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return window.localStorage.getItem(AUTO_REFRESH_KEY) !== '0'; } catch { return true; }
  });

  const { density } = useDensity();
  const tableDensity = density === 'low' ? 'comfortable' : 'compact';

  const refresh = useCallback(async (isBackground = false) => {
    if (isBackground) setRefreshing(true); else setState('loading');
    setErrorBanner(null);
    try {
      const [l, e, m] = await Promise.all([
        lensRun('repair', 'health_log', { limit: 150 }),
        lensRun('repair', 'escalations', {}),
        lensRun('repair', 'memory', {}),
      ]);
      if ([l, e, m].some((r) => isForbidden(r.data))) { setForbidden(true); return; }
      if (!l.data?.ok || !e.data?.ok || !m.data?.ok) {
        if (isBackground) setErrorBanner('Background refresh failed — showing last known telemetry.');
        else setState('error');
        return;
      }
      setLog((l.data.result as { entries: HealthEntry[] }).entries || []);
      setEscalations((e.data.result as { escalations: Escalation[] }).escalations || []);
      setMem((m.data.result as { stats: MemStats }).stats || null);
      setLastRefresh(new Date());
      setState('ready');
    } catch {
      if (isBackground) setErrorBanner('Background refresh failed — showing last known telemetry.');
      else setState('error');
    } finally {
      if (isBackground) setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(false); }, [refresh]);

  // Auto-refresh while the tab is visible — the ledger itself only grows on
  // a ~4h monitor cadence, but escalation approve/dismiss + repair-memory
  // stats can change from any operator session, so a light re-poll keeps
  // the dashboard honest without the user hammering Retry.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refresh(true);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    try { window.localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh ? '1' : '0'); } catch { /* best-effort */ }
  }, [autoRefresh]);

  // ── Optimistic resolve — the clicked card's own buttons show a pending
  // state within one frame; the escalation is removed from the inbox
  // immediately (end state), and restored + surfaced as an error if the
  // real response comes back false. Never a toast that fires regardless
  // of outcome. ──────────────────────────────────────────────────────────
  const resolve = useCallback(async (id: string, resolution: 'approved' | 'dismissed') => {
    setPendingEscalationId(id);
    const prev = escalations;
    setEscalations((cur) => cur.filter((e) => e.id !== id));
    if (selectedEscalationId === id) setSelectedEscalationId(null);
    try {
      const r = await lensRun('repair', 'resolve_escalation', { id, resolution });
      const ok = r.data?.ok && (r.data.result as { ok?: boolean } | null)?.ok;
      if (!ok) {
        setEscalations(prev);
        setErrorBanner(`Could not ${resolution === 'approved' ? 'approve' : 'dismiss'} escalation — restored.`);
      }
    } catch {
      setEscalations(prev);
      setErrorBanner(`Could not ${resolution === 'approved' ? 'approve' : 'dismiss'} escalation — restored.`);
    } finally {
      setPendingEscalationId(null);
    }
  }, [escalations, selectedEscalationId]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: log.length, healed: 0, escalated: 0, noted: 0 };
    for (const e of log) c[e.disposition]++;
    return c;
  }, [log]);

  const filteredLog = useMemo(
    () => (filter === 'all' ? log : log.filter((e) => e.disposition === filter)),
    [log, filter],
  );

  const selectedFinding = useMemo(
    () => filteredLog.find((e) => e.id === selectedFindingId) || null,
    [filteredLog, selectedFindingId],
  );

  const topPatterns = mem?.topPatterns || [];

  // ── Keyboard commands (discoverable via the kbd chips rendered inline) ──
  const escalationIdsRef = useRef<string[]>([]);
  escalationIdsRef.current = escalations.map((e) => e.id);

  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh telemetry', category: 'actions', action: () => void refresh(true), global: true },
      { id: 'filter-all', keys: '1', description: 'Show all findings', category: 'navigation', action: () => setFilter('all') },
      { id: 'filter-healed', keys: '2', description: 'Show healed findings', category: 'navigation', action: () => setFilter('healed') },
      { id: 'filter-escalated', keys: '3', description: 'Show escalated findings', category: 'navigation', action: () => setFilter('escalated') },
      { id: 'filter-noted', keys: '4', description: 'Show noted findings', category: 'navigation', action: () => setFilter('noted') },
      {
        id: 'escalation-next', keys: 'j', description: 'Next escalation', category: 'navigation', action: () => {
          const ids = escalationIdsRef.current;
          if (!ids.length) return;
          const idx = selectedEscalationId ? ids.indexOf(selectedEscalationId) : -1;
          setSelectedEscalationId(ids[Math.min(idx + 1, ids.length - 1)]);
        },
      },
      {
        id: 'escalation-prev', keys: 'k', description: 'Previous escalation', category: 'navigation', action: () => {
          const ids = escalationIdsRef.current;
          if (!ids.length) return;
          const idx = selectedEscalationId ? ids.indexOf(selectedEscalationId) : 0;
          setSelectedEscalationId(ids[Math.max(idx - 1, 0)]);
        },
      },
      {
        id: 'escalation-approve', keys: 'a', description: 'Approve selected escalation', category: 'actions',
        action: () => { if (selectedEscalationId) void resolve(selectedEscalationId, 'approved'); },
        enabled: !!selectedEscalationId,
      },
      {
        id: 'escalation-dismiss', keys: 'x', description: 'Dismiss selected escalation', category: 'actions',
        action: () => { if (selectedEscalationId) void resolve(selectedEscalationId, 'dismissed'); },
        enabled: !!selectedEscalationId,
      },
      {
        id: 'deselect', keys: 'esc', description: 'Deselect finding / escalation', category: 'navigation',
        action: () => { setSelectedFindingId(null); setSelectedEscalationId(null); },
      },
    ],
    { lensId: 'repair-telemetry' },
  );

  const columns: DataTableColumn<HealthEntry>[] = [
    {
      id: 'disposition', header: 'disposition', sortable: true,
      sortValue: (r) => r.disposition,
      accessor: (r) => {
        const s = DISPOSITION_STYLE[r.disposition];
        const Icon = s.icon;
        return (
          <span className={cn('flex items-center gap-1.5 font-medium', s.text)}>
            <Icon className="h-3 w-3" aria-hidden="true" /> {r.disposition}
          </span>
        );
      },
    },
    { id: 'pathology', header: 'pathology', sortable: true, monospace: true, sortValue: (r) => r.pathology, accessor: (r) => r.pathology },
    {
      id: 'category', header: 'category', sortable: true, sortValue: (r) => r.category,
      accessor: (r) => <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_STYLE[r.category])}>{r.category}</span>,
    },
    { id: 'subject', header: 'subject', monospace: true, accessor: (r) => r.subject_id || '—' },
    { id: 'detail', header: 'detail', accessor: (r) => <span className="text-slate-400">{formatDetail(r.pathology, r.detail)}</span> },
    {
      id: 'checked_at', header: 'when', align: 'right', sortable: true, monospace: true,
      sortValue: (r) => r.checked_at, accessor: (r) => formatRelativeTime(r.checked_at * 1000),
    },
  ];

  if (forbidden) return (
    <LensShell lensId="repair-telemetry" asMain={false}>
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isEmpty = state === 'ready' && log.length === 0 && escalations.length === 0
    && (!mem || (mem.totalPatterns === 0 && mem.totalRepairs === 0));

  return (
    <LensShell lensId="repair-telemetry" asMain={false}>
      <main aria-label="Repair telemetry dashboard" className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Activity className="h-5 w-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Repair Telemetry</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                What the world repaired — and what it refused to decide — while you were away.
              </p>
            </div>
            <label className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:flex">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-3 w-3 accent-amber-500" />
              auto-refresh
            </label>
            <button
              onClick={() => void refresh(true)}
              disabled={isLoading || refreshing}
              aria-label="Refresh telemetry"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-60"
            >
              <RefreshCcw className={cn('h-3 w-3', (isLoading || refreshing) && 'animate-spin')} aria-hidden="true" />
              {refreshing ? 'refreshing…' : 'refresh'}
              <kbd className="ml-0.5 hidden rounded border border-amber-400/30 bg-black/20 px-1 py-0.5 font-mono text-[9px] sm:inline">R</kbd>
            </button>
            {(isLoading || refreshing) && <span role="status" aria-live="polite" className="sr-only">Refreshing telemetry</span>}
          </div>
          {errorBanner && (
            <div role="alert" className="mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="flex-1 break-words">{errorBanner}</span>
              <button onClick={() => setErrorBanner(null)} className="shrink-0 rounded border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-500/20">dismiss</button>
            </div>
          )}
          {lastRefresh && (
            <div className="mx-auto mt-1 max-w-screen-2xl text-[10px] text-slate-500">last refreshed {lastRefresh.toLocaleTimeString()}</div>
          )}
        </header>

        <div id="repair-telemetry-content" className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {isLoading && (
            <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="block" height={54} />)}
              </div>
              <Skeleton variant="block" height={140} />
              <SkeletonTableRows rows={6} columns={6} />
              <span className="sr-only">Loading repair telemetry…</span>
            </div>
          )}

          {isError && (
            <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
              <XCircle className="h-6 w-6 text-red-400" aria-hidden="true" />
              <p className="text-sm text-slate-300">Couldn&apos;t load repair telemetry.</p>
              <button onClick={() => void refresh(false)} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">Retry</button>
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
              <span aria-hidden="true" className="text-2xl">🩹</span>
              <p className="text-sm">All quiet. The monitor has logged no findings yet — it runs on a slow (~4h) cadence.</p>
            </div>
          )}

          {state === 'ready' && !isEmpty && (
            <div className="space-y-5">
              {/* Stat tiles */}
              {mem && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  <Stat label="findings" value={counts.all} tone="slate" />
                  <Stat label="healed" value={counts.healed} tone="emerald" />
                  <Stat label="escalated" value={counts.escalated} tone="amber" />
                  <Stat label="noted" value={counts.noted} tone="slate" />
                  <Stat label="patterns learned" value={mem.totalPatterns} tone="cyan" />
                  <Stat label="repairs applied" value={mem.totalRepairs} tone="cyan" />
                  <Stat label="avg success" value={`${Math.round((mem.avgSuccessRate || 0) * 100)}%`} tone="cyan" />
                  <Stat label="deprecated fixes" value={mem.deprecatedFixes} tone="red" />
                </div>
              )}

              {/* Escalation inbox — PagerDuty-shaped triage */}
              <section aria-labelledby="escalation-heading" className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3">
                <h2 id="escalation-heading" className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                  <ShieldAlert className="h-4 w-4" /> Escalation inbox ({escalations.length})
                  <span className="text-[10px] font-normal normal-case text-slate-500">value/arc calls the cortex refused to make</span>
                  {escalations.length > 0 && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-normal normal-case text-slate-500">
                      <kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">j</kbd>/<kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">k</kbd> select
                      <kbd className="ml-1 rounded border border-white/10 bg-black/20 px-1 font-mono">a</kbd> approve
                      <kbd className="rounded border border-white/10 bg-black/20 px-1 font-mono">x</kbd> dismiss
                    </span>
                  )}
                </h2>
                {escalations.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Nothing awaiting your decision.</p>
                ) : (
                  <div className="grid gap-2">
                    {escalations.map((e) => {
                      const isSelected = selectedEscalationId === e.id;
                      const isPending = pendingEscalationId === e.id;
                      return (
                        <div
                          key={e.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedEscalationId(e.id)}
                          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedEscalationId(e.id); } }}
                          className={cn(
                            'rounded-lg border p-3 text-sm transition-colors duration-150 cursor-pointer',
                            isSelected ? 'border-amber-400/60 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/40 hover:border-amber-500/30',
                          )}
                        >
                          <div className="mb-2 flex items-start gap-2">
                            <span className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                              e.priority === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-slate-500/20 text-slate-300',
                            )}>{e.priority}</span>
                            <span className="flex-1 text-[13px] leading-snug text-slate-200">{e.message}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(ev) => { ev.stopPropagation(); void resolve(e.id, 'approved'); }}
                              disabled={isPending}
                              className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
                            </button>
                            <button
                              onClick={(ev) => { ev.stopPropagation(); void resolve(e.id, 'dismissed'); }}
                              disabled={isPending}
                              className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />} Dismiss
                            </button>
                            <span className="ml-auto text-[10px] text-slate-500">{formatRelativeTime(e.created_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Learned patterns — Repair Memory's ranked error->fix library (Sentry-shaped) */}
              <section aria-labelledby="patterns-heading" className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
                <h2 id="patterns-heading" className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
                  <Sparkles className="h-4 w-4" /> Learned patterns
                  <span className="text-[10px] font-normal normal-case text-slate-500">what the cortex has seen before, ranked by occurrence</span>
                </h2>
                {topPatterns.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No repair patterns recorded yet in this process&apos;s memory.</p>
                ) : (
                  <div className="space-y-1.5">
                    {topPatterns.map((p, i) => (
                      <div key={`${p.pattern}-${i}`} className="flex items-center gap-3 rounded border border-zinc-800/60 bg-black/20 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={p.pattern}>{p.pattern}</span>
                        <span className="shrink-0 text-slate-500" title="occurrences">{p.occurrences}×</span>
                        <div className="hidden w-20 shrink-0 items-center gap-1 sm:flex" title={`${Math.round(p.successRate * 100)}% success`}>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={cn('h-full rounded-full', p.successRate >= 0.6 ? 'bg-emerald-400' : p.successRate >= 0.3 ? 'bg-amber-400' : 'bg-red-400')}
                              style={{ width: `${Math.round(p.successRate * 100)}%` }}
                            />
                          </div>
                          <span className="w-8 text-right tabular-nums text-slate-500">{Math.round(p.successRate * 100)}%</span>
                        </div>
                        {p.securityRelated && (
                          <span className="shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-300" title={p.cveId ? `CVE: ${p.cveId}` : 'security-related'}>
                            {p.cveId || 'CVE'}
                          </span>
                        )}
                        {p.deprecated && (
                          <span className="shrink-0 rounded bg-slate-600/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300" title="success rate dropped below 30% — fix marked unreliable">
                            deprecated
                          </span>
                        )}
                        <span className="hidden shrink-0 text-slate-600 md:inline">{formatRelativeTime(p.lastSeen)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Homeostasis ledger */}
              <section aria-labelledby="ledger-heading" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 id="ledger-heading" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-300">
                    <Activity className="h-4 w-4" /> Homeostasis ledger
                  </h2>
                  <div className="ml-1 flex items-center gap-1" role="tablist" aria-label="Filter findings by disposition">
                    {FILTER_TABS.map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={filter === t.id}
                        onClick={() => setFilter(t.id)}
                        className={cn(
                          'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors duration-150',
                          filter === t.id ? 'border-amber-400/50 bg-amber-500/15 text-amber-200' : 'border-zinc-700 text-slate-400 hover:border-zinc-600',
                        )}
                      >
                        {t.label} <span className="opacity-60">{counts[t.id]}</span>
                        <kbd className="ml-0.5 hidden rounded border border-white/10 bg-black/20 px-1 font-mono text-[8px] sm:inline">{t.key}</kbd>
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto">
                    <DensityToggle variant="dropdown" showLabels={false} />
                  </div>
                </div>

                <div className={cn('grid gap-3', selectedFinding ? 'lg:grid-cols-[1fr_280px]' : 'grid-cols-1')}>
                  <div className={cn('transition-opacity duration-150', refreshing ? 'opacity-60' : 'opacity-100')}>
                    <DataTable
                      columns={columns}
                      rows={filteredLog}
                      getRowId={(r) => r.id}
                      selectedRowId={selectedFindingId}
                      onRowClick={(r) => setSelectedFindingId(r.id === selectedFindingId ? null : r.id)}
                      onRowActivate={(r) => setSelectedFindingId(r.id === selectedFindingId ? null : r.id)}
                      density={tableDensity}
                      defaultSort={{ columnId: 'checked_at', direction: 'desc' }}
                      maxHeight="480px"
                      caption="Homeostasis ledger — monitor findings, disposition, and detail"
                      emptyState={<p className="py-6 text-center text-[11px] text-slate-500">No findings match this filter.</p>}
                    />
                  </div>

                  {selectedFinding && (
                    <aside aria-label="Finding detail" className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px]">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold text-amber-200">{selectedFinding.pathology}</span>
                        <button onClick={() => setSelectedFindingId(null)} aria-label="Close detail" className="text-slate-500 hover:text-slate-300">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <dl className="space-y-1.5">
                        <Row label="disposition" value={selectedFinding.disposition} />
                        <Row label="category" value={selectedFinding.category} />
                        <Row label="subject" value={selectedFinding.subject_id || '—'} mono />
                        <Row label="checked" value={formatRelativeTime(selectedFinding.checked_at * 1000)} />
                      </dl>
                      {Object.keys(selectedFinding.detail || {}).length > 0 && (
                        <div className="mt-2 border-t border-white/10 pt-2">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">detail</p>
                          <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[10px] text-slate-300">
                            {JSON.stringify(selectedFinding.detail, null, 2)}
                          </pre>
                        </div>
                      )}
                    </aside>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </LensShell>
  );
}

type StatTone = 'slate' | 'emerald' | 'amber' | 'cyan' | 'red';

function Stat({ label, value, tone }: { label: string; value: string | number; tone: StatTone }) {
  const toneClass: Record<StatTone, string> = {
    slate: 'border-zinc-800 bg-zinc-950/40 text-slate-100',
    emerald: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200',
    amber: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200',
    cyan: 'border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-200',
    red: 'border-red-500/20 bg-red-500/[0.06] text-red-200',
  };
  return (
    <div className={cn('rounded-lg border px-2.5 py-1.5', toneClass[tone])}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('text-right text-slate-200', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
