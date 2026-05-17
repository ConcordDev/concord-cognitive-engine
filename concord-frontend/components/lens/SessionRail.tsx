'use client';

/**
 * SessionRail — drop-in panel that lists the caller's open + paused
 * sessions for one lens (or across all lenses).
 *
 * Phase 5 of the UX completeness sprint. Pairs with useLensSession.
 * Self-scoped via the sessions.list_mine macro — anonymous callers see
 * an empty state. No fake data.
 */

import { useEffect, useState, useCallback } from 'react';
import { GitBranch, RefreshCw, AlertTriangle, Play, Pause, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SessionRow {
  id: string;
  lensId: string;
  title: string | null;
  status: 'open' | 'paused' | 'completed' | 'abandoned';
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

const statusIcon = (s: SessionRow['status']) => {
  switch (s) {
    case 'open': return <Play className="w-3 h-3 text-emerald-400" />;
    case 'paused': return <Pause className="w-3 h-3 text-amber-400" />;
    case 'completed': return <CheckCircle2 className="w-3 h-3 text-zinc-500" />;
    case 'abandoned': return <XCircle className="w-3 h-3 text-rose-400" />;
  }
};

export interface SessionRailProps {
  /** Lens to filter by. Omit to show every open session across lenses. */
  lensId?: string;
  /** Status filter; defaults to open + paused. */
  status?: 'open' | 'paused' | 'completed' | 'abandoned';
  /** Max rows to render. Default 12. */
  limit?: number;
  /** Hide the panel entirely when no rows. Default true. */
  hideWhenEmpty?: boolean;
  /** Called when a row is clicked. The lens can route to that session. */
  onSelect?: (sessionId: string, row: SessionRow) => void;
  className?: string;
}

export function SessionRail({ lensId, status, limit = 12, hideWhenEmpty = true, onSelect, className }: SessionRailProps) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [pausedRows, setPausedRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (status) {
      const r = await runMacro<{ ok: boolean; sessions?: SessionRow[]; reason?: string }>('list_mine', {
        ...(lensId ? { lensId } : {}), status, limit,
      });
      if (r?.ok) setRows(r.sessions || []);
      else setError(r?.reason || 'fetch_failed');
    } else {
      // Default: fetch open AND paused, merge.
      const [openR, pausedR] = await Promise.all([
        runMacro<{ ok: boolean; sessions?: SessionRow[]; reason?: string }>('list_mine', { ...(lensId ? { lensId } : {}), status: 'open', limit }),
        runMacro<{ ok: boolean; sessions?: SessionRow[]; reason?: string }>('list_mine', { ...(lensId ? { lensId } : {}), status: 'paused', limit }),
      ]);
      if (openR?.ok) setRows(openR.sessions || []);
      else if (openR && !openR.ok) setError(openR.reason || 'fetch_failed');
      if (pausedR?.ok) setPausedRows(pausedR.sessions || []);
    }
    setLoading(false);
  }, [lensId, status, limit]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const combined = [...rows, ...pausedRows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);

  if (combined.length === 0 && !loading && !error && hideWhenEmpty) {
    return null;
  }

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <GitBranch className="w-4 h-4 text-indigo-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          {lensId ? `Open sessions · ${lensId}` : 'Open sessions'}
          {combined.length > 0 && <span className="ml-2 text-[10px] text-zinc-500 font-mono">{combined.length}</span>}
        </h3>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {error && (
        <div className="px-3 py-2 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          {error}
        </div>
      )}

      {!error && combined.length === 0 && !loading && (
        <div className="px-3 py-4 text-xs text-zinc-500 italic text-center">
          No open sessions. Start one from any lens action bar.
        </div>
      )}

      {combined.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[400px] overflow-y-auto">
          {combined.map((s) => (
            <li
              key={s.id}
              className="px-3 py-2 text-xs hover:bg-zinc-900/40 cursor-pointer"
              onClick={() => onSelect?.(s.id, s)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(s.id, s); }}
            >
              <div className="flex items-center gap-2">
                {statusIcon(s.status)}
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 font-medium truncate">{s.title || `Untitled · ${s.lensId}`}</div>
                  <div className="text-[10px] text-zinc-500 font-mono truncate">
                    {s.lensId} · step: {s.currentStep || '—'} · {s.stepCount} step{s.stepCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />
                  {timeAgo(s.updatedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SessionRail;
