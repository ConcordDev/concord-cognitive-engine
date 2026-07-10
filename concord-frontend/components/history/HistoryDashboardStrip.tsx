'use client';

/**
 * HistoryDashboardStrip — real aggregate stats for the history lens header.
 * Wires the previously-UNSURFACED `history.history-dashboard` macro (it had
 * zero frontend callers before this rebuild) into a StatTile row.
 *
 * Honest by construction: every tile is a field straight off the macro
 * result — no client-side computation, no placeholder numbers. The refresh
 * button uses `useMacroDispatchFeedback` so the control itself shows a real
 * pending state (not a toast-only or theatrical spinner).
 */

import { useEffect } from 'react';
import { RefreshCw, Layers, Flag, Scroll, Globe2, MapPinned } from 'lucide-react';
import { StatTile, StatTileGrid, Skeleton } from '@/components/ui';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { cn } from '@/lib/utils';

interface DashboardResult {
  timelines: number;
  totalEvents: number;
  totalEras: number;
  publishedTimelines: number;
  mappedEvents: number;
}

export function HistoryDashboardStrip({ refreshToken = 0 }: { refreshToken?: number }) {
  const { status, result, dispatch } = useMacroDispatchFeedback<DashboardResult>();
  const busy = status === 'dispatched' || status === 'running';

  useEffect(() => {
    void dispatch('history', 'history-dashboard', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on external mutation signal
  }, [refreshToken]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          Your research · history.history-dashboard
        </span>
        <button
          type="button"
          onClick={() => void dispatch('history', 'history-dashboard', {})}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
          aria-label="Refresh dashboard stats"
        >
          <RefreshCw className={cn('h-3 w-3', busy && 'animate-spin')} />
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {status === 'idle' || (busy && !result) ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={58} />
          ))}
        </div>
      ) : status === 'error' || !result ? (
        <p className="text-xs text-rose-400">Could not load dashboard stats.</p>
      ) : (
        <StatTileGrid columns={5}>
          <StatTile label="Timelines" value={result.timelines} icon={<Layers className="h-3.5 w-3.5" />} size="sm" />
          <StatTile label="Events" value={result.totalEvents} icon={<Flag className="h-3.5 w-3.5" />} size="sm" />
          <StatTile label="Eras" value={result.totalEras} icon={<Scroll className="h-3.5 w-3.5" />} size="sm" />
          <StatTile label="Published" value={result.publishedTimelines} icon={<Globe2 className="h-3.5 w-3.5" />} size="sm" />
          <StatTile label="Mapped events" value={result.mappedEvents} icon={<MapPinned className="h-3.5 w-3.5" />} size="sm" />
        </StatTileGrid>
      )}
    </div>
  );
}
