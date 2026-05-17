'use client';

/**
 * Sessions lens — primary surface for the multi-step workflow substrate
 * (Phase 5 of the UX completeness sprint).
 *
 * Lists every session belonging to the caller across all lenses, grouped
 * by status (open / paused / completed / abandoned), with quick actions
 * to resume, pause, or close.
 *
 * Real data end-to-end — reads from sessions.list_mine + sessions.get
 * per row. No fake placeholders; an empty backend renders an empty
 * state CTA pointing users at lenses that support sessions.
 */

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  GitBranch, Play, Pause, CheckCircle2, XCircle, RefreshCw,
  AlertTriangle, Clock, ArrowRight, Sparkles,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type SessionStatus = 'open' | 'paused' | 'completed' | 'abandoned';

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

async function runMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'sessions', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
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

export default function SessionsLensPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SessionStatus | 'all'>('all');

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    // Pull all statuses; merge.
    const all: SessionRow[] = [];
    for (const status of ['open', 'paused', 'completed', 'abandoned'] as const) {
      const r = await runMacro<{ ok: boolean; sessions?: SessionRow[]; reason?: string }>(
        'list_mine', { status, limit: 100 },
      );
      if (r?.ok && r.sessions) all.push(...r.sessions);
      else if (r && !r.ok && !error) setError(r.reason || 'fetch_failed');
    }
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    setRows(all);
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return rows;
    return rows.filter(r => r.status === activeFilter);
  }, [rows, activeFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, open: 0, paused: 0, completed: 0, abandoned: 0 };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const closeSession = async (id: string, outcome: 'completed' | 'abandoned') => {
    const r = await runMacro<{ ok: boolean; reason?: string }>('close', { sessionId: id, outcome });
    if (r?.ok) void fetchAll();
  };

  return (
    <LensShell lensId="sessions" asMain={false}>
      <FirstRunTour lensId="sessions" />
      <ManifestActionBar />
      <DepthBadge lensId="sessions" size="sm" className="ml-2" />

      <div className="min-h-screen bg-lattice-void p-6 text-zinc-100">
        <div className="max-w-5xl mx-auto">
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-7 h-7 text-indigo-300" />
              <div>
                <h1 className="text-2xl font-bold">Sessions</h1>
                <p className="text-xs text-zinc-500">Multi-step work across every lens — real, persistent, resumable.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchAll()}
              disabled={loading}
              className="p-2 text-zinc-500 hover:text-zinc-200 transition-colors rounded border border-zinc-800"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </header>

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

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300/80 mb-4">
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />
              {error}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-12 text-center">
              <Sparkles className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <h2 className="text-sm font-medium text-zinc-300 mb-1">
                {activeFilter === 'all' ? 'No sessions yet.' : `No ${activeFilter} sessions.`}
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

          {filtered.length > 0 && (
            <ul className="space-y-2">
              {filtered.map(s => {
                const meta = STATUS_META[s.status];
                const Icon = meta.icon;
                return (
                  <li
                    key={s.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-indigo-500/40 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn('p-1.5 rounded border', meta.color)}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => router.push(`/lenses/${s.lensId}`)}
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
                        <Link
                          href={`/lenses/${s.lensId}`}
                          className="text-[10px] text-zinc-400 hover:text-indigo-300 px-2 py-1 rounded border border-zinc-800 hover:border-indigo-500/40"
                        >
                          Resume
                        </Link>
                        {(s.status === 'open' || s.status === 'paused') && (
                          <>
                            <button
                              type="button"
                              onClick={() => void closeSession(s.id, 'completed')}
                              className="text-[10px] text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded border border-zinc-800 hover:border-emerald-500/40"
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              onClick={() => void closeSession(s.id, 'abandoned')}
                              className="text-[10px] text-rose-400 hover:text-rose-300 px-2 py-1 rounded border border-zinc-800 hover:border-rose-500/40"
                            >
                              Abandon
                            </button>
                          </>
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
      {/* Phase 5 mobile — thumb-friendly status filter bar; hides on desktop. */}
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
