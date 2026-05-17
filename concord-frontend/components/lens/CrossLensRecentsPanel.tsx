'use client';

/**
 * CrossLensRecentsPanel — drop-in panel that shows DTUs surfaced INTO
 * the current lens from elsewhere recently.
 *
 * Phase 7 of the UX completeness sprint. Pairs with the
 * dtu_surface.surfaced_from macro and DTUEmbed's auto-record-on-mount.
 *
 * Hides itself when empty (no fake "no recent" surface).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GitMerge, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SurfaceRow {
  dtuId: string;
  title: string | null;
  sourceLens: string | null;
  creatorId: string | null;
  kind: string;
  surfacedAt: number;
}

async function runMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'dtu_surface', name, input });
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

export interface CrossLensRecentsPanelProps {
  /** The lens this panel mounts in — used as the surfaced_in_lens filter. */
  lensId: string;
  /** Days to look back. Default 7. */
  sinceDays?: number;
  /** Max rows. Default 8. */
  limit?: number;
  /** Hide when empty. Default true. */
  hideWhenEmpty?: boolean;
  className?: string;
}

export function CrossLensRecentsPanel({ lensId, sinceDays = 7, limit = 8, hideWhenEmpty = true, className }: CrossLensRecentsPanelProps) {
  const [rows, setRows] = useState<SurfaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; surfaces?: SurfaceRow[]; reason?: string }>('surfaced_from', { lensId, sinceDays, limit, excludeOwnOrigin: true });
    if (r?.ok) setRows(r.surfaces || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await runMacro<{ ok: boolean; surfaces?: SurfaceRow[]; reason?: string }>('surfaced_from', { lensId, sinceDays, limit, excludeOwnOrigin: true });
      if (cancelled) return;
      if (r?.ok) setRows(r.surfaces || []);
      else setError(r?.reason || 'fetch_failed');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [lensId, sinceDays, limit]);

  if (rows.length === 0 && !loading && !error && hideWhenEmpty) {
    return null;
  }

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <GitMerge className="w-4 h-4 text-amber-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          From elsewhere
          {rows.length > 0 && <span className="ml-2 text-[10px] text-zinc-500 font-mono">{rows.length}</span>}
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
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> {error}
        </div>
      )}

      {!error && rows.length === 0 && !loading && (
        <div className="px-3 py-3 text-xs text-zinc-500 italic text-center">
          No DTUs surfaced from elsewhere in the last {sinceDays} day{sinceDays === 1 ? '' : 's'}.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[400px] overflow-y-auto">
          {rows.map((s) => (
            <li key={`${s.dtuId}-${s.surfacedAt}`} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 font-medium truncate">{s.title || `DTU ${s.dtuId.slice(0, 12)}`}</div>
                  <div className="text-[10px] text-zinc-500 truncate font-mono">
                    {s.sourceLens && (
                      <Link href={`/lenses/${s.sourceLens}`} className="text-zinc-400 hover:text-amber-300 underline-offset-2 hover:underline">
                        from {s.sourceLens}
                      </Link>
                    )}
                    {' · '}{s.kind}
                  </div>
                </div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />
                  {timeAgo(s.surfacedAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default CrossLensRecentsPanel;
