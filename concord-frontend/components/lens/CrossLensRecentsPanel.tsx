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
import { GitMerge, RefreshCw, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SurfaceRow {
  dtuId: string;
  title: string | null;
  sourceLens: string | null;
  creatorId: string | null;
  kind: string;
  surfacedAt: number;
}

// Expected read-path quiet failures. These are normal when a panel mounts
// before the lens substrate is ready, or when a lens has no surfaced DTUs.
const QUIET_SURFACE_ERRORS = new Set([
  'missing_lens_id',
  'missing_dtu_id',
  'missing_field',
  'db_error',
  'not_found',
]);

async function surfacedFrom(input: Record<string, unknown>): Promise<{ ok: boolean; surfaces?: SurfaceRow[]; error?: string }> {
  try {
    const r = await lensRun('dtu_surface', 'surfaced_from', input);
    if (!r?.data?.ok) {
      const error = (typeof r?.data?.error === 'string' && r.data.error)
        || (typeof r?.data?.reason === 'string' && r.data.reason)
        || 'failed';
      if (QUIET_SURFACE_ERRORS.has(error)) return { ok: true, surfaces: [] };
      return { ok: false, error };
    }
    // lensRun unwraps the macro envelope, so r.data.result is the macro payload
    // (e.g. { surfaces: [...] }) and r.data.ok signals macro success.
    return { ok: true, ...(r.data.result || {}) } as { ok: boolean; surfaces?: SurfaceRow[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
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

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await surfacedFrom({ lensId, sinceDays, limit, excludeOwnOrigin: true });
    if (r.ok) {
      setRows(r.surfaces || []);
      setError(null);
    } else {
      setRows([]);
      setError(r.error || 'failed');
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Without a known lens there is nothing to filter by; degrade silently.
      if (!lensId) {
        setRows([]);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const r = await surfacedFrom({ lensId, sinceDays, limit, excludeOwnOrigin: true });
      if (cancelled) return;
      if (r.ok) {
        setRows(r.surfaces || []);
        setError(null);
      } else {
        setRows([]);
        setError(r.error || 'failed');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [lensId, sinceDays, limit]);

  if (rows.length === 0 && !loading && hideWhenEmpty && !error) {
    return null;
  }

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <GitMerge className="w-4 h-4 text-amber-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          From elsewhere
          {rows.length > 0 && <span className="ml-2 text-[10px] text-zinc-400 font-mono">{rows.length}</span>}
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !lensId}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh items from other lenses"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      {rows.length === 0 && !loading && (
        <div className={cn('px-3 py-3 text-xs text-center', error ? 'text-amber-300' : 'text-zinc-400 italic')}>
          {error ? `Could not load recents: ${error}` : `No DTUs surfaced from elsewhere in the last ${sinceDays} day${sinceDays === 1 ? '' : 's'}.`}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[400px] overflow-y-auto">
          {rows.map((s) => (
            <li key={`${s.dtuId}-${s.surfacedAt}`} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 font-medium truncate">{s.title || `DTU ${s.dtuId.slice(0, 12)}`}</div>
                  <div className="text-[10px] text-zinc-400 truncate font-mono">
                    {s.sourceLens && (
                      <Link href={`/lenses/${s.sourceLens}`} className="text-zinc-400 hover:text-amber-300 underline-offset-2 hover:underline">
                        from {s.sourceLens}
                      </Link>
                    )}
                    {' · '}{s.kind}
                  </div>
                </div>
                <div className="text-[10px] text-zinc-400 flex items-center gap-1 shrink-0">
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
