'use client';

/**
 * WhiteboardWorkspaceSummary — real aggregate stats for the whiteboard lens
 * header. Wires the previously-UNSURFACED `whiteboard.workspace-summary`
 * macro (it had zero frontend callers — see
 * `docs/lens-specs/whiteboard-capability-map.md`) into a StatTile row,
 * mirroring the same pattern `HistoryDashboardStrip` established for
 * `history.history-dashboard`.
 *
 * Honest by construction: every tile is a field straight off the macro
 * result (boardCount / elementCount / stickyCount / sharedCount /
 * openCommentCount, computed server-side in `server/domains/whiteboard.js`)
 * — no client-side computation, no placeholder numbers. Bump `refreshToken`
 * whenever a mutation could change these counts (board create/delete/
 * duplicate, a save landing, a comment add/resolve/delete) to re-dispatch.
 */

import { useEffect } from 'react';
import { LayoutGrid, Shapes, StickyNote, Users, MessageSquare } from 'lucide-react';
import { StatTile, StatTileGrid, Skeleton } from '@/components/ui';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';

interface WorkspaceSummaryResult {
  boardCount: number;
  elementCount: number;
  stickyCount: number;
  sharedCount: number;
  openCommentCount: number;
}

export function WhiteboardWorkspaceSummary({ refreshToken = 0 }: { refreshToken?: number }) {
  const { status, result, dispatch } = useMacroDispatchFeedback<WorkspaceSummaryResult>();
  const busy = status === 'dispatched' || status === 'running';

  useEffect(() => {
    void dispatch('whiteboard', 'workspace-summary', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on external mutation signal
  }, [refreshToken]);

  if (status === 'idle' || (busy && !result)) {
    return (
      <div className="px-3 py-2 border-b border-white/5 bg-lattice-void">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} variant="block" height={52} />
          ))}
        </div>
      </div>
    );
  }
  // Purely additive — if the macro errors, the board itself still works;
  // degrade silently rather than blocking or scaring the user with an error.
  if (status === 'error' || !result) return null;

  return (
    <div className="px-3 py-2 border-b border-white/5 bg-lattice-void">
      <StatTileGrid columns={5}>
        <StatTile label="Boards" value={result.boardCount} icon={<LayoutGrid className="w-3.5 h-3.5" />} size="sm" />
        <StatTile label="Elements" value={result.elementCount} icon={<Shapes className="w-3.5 h-3.5" />} size="sm" />
        <StatTile label="Stickies" value={result.stickyCount} icon={<StickyNote className="w-3.5 h-3.5" />} size="sm" />
        <StatTile label="Shared" value={result.sharedCount} icon={<Users className="w-3.5 h-3.5" />} size="sm" />
        <StatTile label="Open comments" value={result.openCommentCount} icon={<MessageSquare className="w-3.5 h-3.5" />} size="sm" />
      </StatTileGrid>
    </div>
  );
}

export default WhiteboardWorkspaceSummary;
