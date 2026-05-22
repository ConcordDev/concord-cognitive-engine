'use client';

/**
 * Sessions lens — primary surface for the multi-step workflow substrate.
 *
 * Lists every session belonging to the caller across all lenses, with:
 *   - status filter chips (all / open / paused / completed / abandoned)
 *   - free-text search (title or lens) + sort (recent / oldest / title / lens / steps)
 *   - per-session row actions: open detail, resume, pause, complete, abandon
 *   - a per-session detail modal with the full step-transition timeline,
 *     breadcrumb, event log, rename + annotate
 *   - a stale-session reminder banner with bulk-close
 *   - multi-select bulk close
 *
 * Real data end-to-end — reads from sessions.search. No fake placeholders;
 * an empty backend renders an empty-state CTA.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  GitBranch, Play, Pause, CheckCircle2, XCircle, RefreshCw,
  AlertTriangle, Clock, ArrowRight, Sparkles, Search, ListChecks,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { SessionDetail } from '@/components/sessions/SessionDetail';
import { StaleReminder } from '@/components/sessions/StaleReminder';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type SessionStatus = 'open' | 'paused' | 'completed' | 'abandoned';
type SortKey = 'recent' | 'oldest' | 'title' | 'lens' | 'steps';

interface SessionRow {
  id: string;
  lensId: string;
  title: string | null;
  status: SessionStatus;
  currentStep: string | null;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

interface SearchResult {
  ok: boolean;
  sessions?: SessionRow[];
  reason?: string;
}

function timeAgo(secs: number): string {
  const delta = Math.floor(Date.now() / 1000) - secs;
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

const STATUS_META: Record<SessionStatus, { label: string; color: string; icon: typeof Play }> = {
  open:       { label: 'Open',       color: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', icon: Play },
  paused:     { label: 'Paused',     color: 'text-amber-300 border-amber-500/40 bg-amber-500/10',       icon: Pause },
  completed:  { label: 'Completed',  color: 'text-zinc-300 border-zinc-700 bg-zinc-900/40',             icon: CheckCircle2 },
  abandoned:  { label: 'Abandoned',  color: 'text-rose-300 border-rose-500/40 bg-rose-500/10',          icon: XCircle },
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recently updated' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'title',  label: 'Title A→Z' },
  { key: 'lens',   label: 'Lens A→Z' },
  { key: 'steps',  label: 'Most steps' },
];

export default function SessionsLensPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SessionStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<SearchResult>('sessions', 'search', {
      query: query.trim() || undefined,
      status: activeFilter === 'all' ? undefined : activeFilter,
      sort,
      limit: 100,
    });
    if (r.data?.ok && r.data.result?.ok) {
      setRows(r.data.result.sessions || []);
    } else {
      setRows([]);
      setError(r.data?.result?.reason || r.data?.error || 'fetch_failed');
    }
    setLoading(false);
  }, [query, activeFilter, sort]);

  useEffect(() => {
    const t = setTimeout(() => { void fetchAll(); }, 250);
    return () => clearTimeout(t);
  }, [fetchAll]);

  // Counts come from an unfiltered status-agnostic pass so chips stay accurate.
  const [counts, setCounts] = useState<Record<string, number>>({
    all: 0, open: 0, paused: 0, completed: 0, abandoned: 0,
  });
  const refreshCounts = useCallback(async () => {
    const r = await lensRun<SearchResult>('sessions', 'search', { limit: 100 });
    if (r.data?.ok && r.data.result?.ok) {
      const all = r.data.result.sessions || [];
      const c: Record<string, number> = { all: all.length, open: 0, paused: 0, completed: 0, abandoned: 0 };
      for (const s of all) c[s.status] = (c[s.status] || 0) + 1;
      setCounts(c);
    }
  }, []);
  useEffect(() => { void refreshCounts(); }, [refreshCounts]);

  const refreshAll = useCallback(() => {
    void fetchAll();
    void refreshCounts();
  }, [fetchAll, refreshCounts]);

  const rowAction = useCallback(async (
    macro: 'pause' | 'resume' | 'close',
    sessionId: string,
    outcome?: 'completed' | 'abandoned',
  ) => {
    const params: Record<string, unknown> = { sessionId };
    if (outcome) params.outcome = outcome;
    const r = await lensRun<{ ok: boolean }>('sessions', macro, params);
    if (r.data?.ok && r.data.result?.ok) refreshAll();
  }, [refreshAll]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkClose = async (outcome: 'completed' | 'abandoned') => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const r = await lensRun<{ ok: boolean; closed: number }>('sessions', 'bulk_close', {
      sessionIds: Array.from(selected),
      outcome,
    });
    setBulkBusy(false);
    if (r.data?.ok && r.data.result?.ok) {
      setSelected(new Set());
      setSelectMode(false);
      refreshAll();
    }
  };

  const selectableRows = useMemo(
    () => rows.filter(r => r.status === 'open' || r.status === 'paused'),
    [rows],
  );

  return (
    <LensShell lensId="sessions" asMain={false}>
      <FirstRunTour lensId="sessions" />
      <ManifestActionBar />
      <DepthBadge lensId="sessions" size="sm" className="ml-2" />

      <div className="min-h-screen bg-lattice-void p-6 text-zinc-100">
        <div className="max-w-5xl mx-auto">
          <header className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-7 h-7 text-indigo-300" />
              <div>
                <h1 className="text-2xl font-bold">Sessions</h1>
                <p className="text-xs text-zinc-500">Multi-step work across every lens — real, persistent, resumable.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
                className={cn(
                  'inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border transition-colors',
                  selectMode
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200',
                )}
              >
                <ListChecks className="w-3.5 h-3.5" /> Select
              </button>
              <button
                type="button"
                onClick={refreshAll}
                disabled={loading}
                className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors rounded border border-zinc-800"
                aria-label="Refresh"
              >
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </button>
            </div>
          </header>

          <StaleReminder onChanged={refreshAll} />

          {/* Search + sort */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by title or lens…"
                className="w-full text-xs bg-zinc-900 border border-zinc-800 rounded pl-8 pr-2 py-2 text-zinc-100 focus:border-indigo-500/50 outline-none"
              />
            </div>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className="text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-zinc-300 focus:border-indigo-500/50 outline-none"
              aria-label="Sort sessions"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {(['all', 'open', 'paused', 'completed', 'abandoned'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setActiveFilter(s)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded border transition-colors',
                  activeFilter === s
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-700',
                )}
              >
                {s === 'all' ? 'All' : STATUS_META[s].label}
                <span className="ml-1.5 text-[10px] font-mono text-zinc-500">{counts[s] || 0}</span>
              </button>
            ))}
          </div>

          {/* Bulk action bar */}
          {selectMode && (
            <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5">
              <span className="text-xs text-indigo-200">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set(selectableRows.map(r => r.id)))}
                className="text-[11px] text-zinc-400 hover:text-zinc-100 underline-offset-2 hover:underline"
              >
                Select all open/paused ({selectableRows.length})
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={bulkBusy || selected.size === 0}
                onClick={() => void bulkClose('completed')}
                className="text-[11px] px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                Complete selected
              </button>
              <button
                type="button"
                disabled={bulkBusy || selected.size === 0}
                onClick={() => void bulkClose('abandoned')}
                className="text-[11px] px-2.5 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
              >
                Abandon selected
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300/80 mb-4">
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
              {error}
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-12 text-center">
              <Sparkles className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <h2 className="text-sm font-medium text-zinc-300 mb-1">
                {query.trim()
                  ? 'No sessions match your search.'
                  : activeFilter === 'all' ? 'No sessions yet.' : `No ${activeFilter} sessions.`}
              </h2>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Sessions persist multi-step work across visits — open a war campaign in kingdoms, a research arc
                in paper, a podcast season in podcast. Visit any session-aware lens to start one.
              </p>
              <Link
                href="/hub"
                className="inline-flex items-center gap-1 mt-4 text-xs text-indigo-300 hover:text-indigo-200"
              >
                Browse lenses <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map(s => {
                const meta = STATUS_META[s.status];
                const Icon = meta.icon;
                const canSelect = s.status === 'open' || s.status === 'paused';
                return (
                  <li
                    key={s.id}
                    className={cn(
                      'rounded-lg border bg-zinc-950/60 p-3 transition-colors',
                      selected.has(s.id)
                        ? 'border-indigo-500/50 bg-indigo-500/5'
                        : 'border-zinc-800 hover:border-indigo-500/40',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {selectMode && (
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          disabled={!canSelect}
                          onChange={() => toggleSelect(s.id)}
                          className="mt-1.5 accent-indigo-500 disabled:opacity-30"
                          aria-label={`Select ${s.title || s.lensId}`}
                        />
                      )}
                      <div className={cn('p-1.5 rounded border', meta.color)}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setDetailId(s.id)}
                            className="text-sm font-medium text-zinc-100 hover:text-indigo-300 truncate text-left"
                          >
                            {s.title || `Untitled session in ${s.lensId}`}
                          </button>
                          <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border', meta.color)}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                          <Link href={`/lenses/${s.lensId}`} className="text-zinc-400 hover:text-indigo-300 underline-offset-2 hover:underline">
                            {s.lensId}
                          </Link>
                          {' · step: '}{s.currentStep || '—'}
                          {' · '}{s.stepCount} transition{s.stepCount === 1 ? '' : 's'}
                          {' · '}<Clock className="inline w-2.5 h-2.5" /> {timeAgo(s.updatedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDetailId(s.id)}
                          className="text-[10px] text-zinc-400 hover:text-indigo-300 px-2 py-1 rounded border border-zinc-800 hover:border-indigo-500/40"
                        >
                          Detail
                        </button>
                        {s.status === 'paused' && (
                          <button
                            type="button"
                            onClick={() => void rowAction('resume', s.id)}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-zinc-800 hover:border-emerald-500/40"
                          >
                            Resume
                          </button>
                        )}
                        {s.status === 'open' && (
                          <button
                            type="button"
                            onClick={() => void rowAction('pause', s.id)}
                            className="text-[10px] text-amber-400 hover:text-amber-300 px-2 py-1 rounded border border-zinc-800 hover:border-amber-500/40"
                          >
                            Pause
                          </button>
                        )}
                        {(s.status === 'open' || s.status === 'paused') && (
                          <>
                            <button
                              type="button"
                              onClick={() => void rowAction('close', s.id, 'completed')}
                              className="text-[10px] text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-zinc-800 hover:border-emerald-500/40"
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              onClick={() => void rowAction('close', s.id, 'abandoned')}
                              className="text-[10px] text-rose-400 hover:text-rose-300 px-2 py-1 rounded border border-zinc-800 hover:border-rose-500/40"
                            >
                              Abandon
                            </button>
                          </>
                        )}
                        {(s.status === 'completed' || s.status === 'abandoned') && (
                          <button
                            type="button"
                            onClick={() => router.push(`/lenses/${s.lensId}`)}
                            className="text-[10px] text-zinc-400 hover:text-indigo-300 px-2 py-1 rounded border border-zinc-800 hover:border-indigo-500/40"
                          >
                            Open lens
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {detailId && (
        <SessionDetail
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onMutated={refreshAll}
        />
      )}

      {/* Mobile — thumb-friendly status filter bar; hides on desktop. */}
      <MobileTabBar
        tabs={[
          { id: 'all',       label: 'All',       icon: GitBranch,   badgeCount: counts.all       || 0 },
          { id: 'open',      label: 'Open',      icon: Play,        badgeCount: counts.open      || 0 },
          { id: 'paused',    label: 'Paused',    icon: Pause,       badgeCount: counts.paused    || 0 },
          { id: 'completed', label: 'Done',      icon: CheckCircle2 },
        ]}
        active={activeFilter}
        onSelect={(id) => setActiveFilter(id as typeof activeFilter)}
      />
    </LensShell>
  );
}
