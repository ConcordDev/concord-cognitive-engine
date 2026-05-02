'use client';

/**
 * UndoTimeline — Shows undoable actions with one-click undo buttons.
 *
 * Displays recent events that have undo tokens, with a visual timeline.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Undo2, Clock, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';

interface EventItem {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
  undoToken: string | null;
  scope: string;
  entityType: string | null;
  entityId: string | null;
}

interface EventsResponse {
  ok: boolean;
  items: EventItem[];
  total: number;
}

function UndoTimeline() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const { data, isLoading, refetch } = useQuery<EventsResponse>({
    queryKey: ['undo-timeline'],
    queryFn: async () => (await api.get('/api/events/paginated', { params: { limit: 30 } })).data,
    refetchInterval: 10_000,
  });

  const items = data?.items || [];
  // Only show items that have undo tokens (undoable actions)
  const undoableItems = items.filter((item) => item.undoToken);
  // Also show non-undoable for context (like UNDO_APPLIED)
  const timelineItems = items.slice(0, 20);

  const handleUndo = async (undoToken: string, summary: string) => {
    try {
      await api.post('/api/undo', { undoToken });
      addToast({ type: 'success', message: `Undone: ${summary}` });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      queryClient.invalidateQueries({ queryKey: ['guidance-events-recent'] });
    } catch {
      addToast({ type: 'error', message: 'Failed to undo action' });
    }
  };

  if (isLoading) {
    return <div className="text-gray-500 text-sm p-4">Loading timeline...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-neon-blue" />
        Undo Timeline
        {undoableItems.length > 0 && (
          <span className="text-sm text-gray-500 font-normal">
            ({undoableItems.length} undoable)
          </span>
        )}
      </h2>

      {timelineItems.length === 0 ? (
        <p className="text-gray-500 text-sm">No actions recorded yet.</p>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-lattice-border" />

          <div className="space-y-0">
            {timelineItems.map((item) => {
              const isUndo = item.type === 'UNDO_APPLIED';
              const canUndo = Boolean(item.undoToken) && !isUndo;

              return (
                <div key={item.id} className="relative flex items-start gap-3 py-2 pl-8">
                  {/* Timeline dot */}
                  <div
                    className={cn(
                      'absolute left-[11px] w-2.5 h-2.5 rounded-full border-2',
                      isUndo
                        ? 'bg-gray-700 border-gray-500'
                        : canUndo
                          ? 'bg-neon-blue border-neon-blue'
                          : 'bg-lattice-surface border-lattice-border'
                    )}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-xs font-mono px-1 py-0.5 rounded',
                          isUndo ? 'text-gray-500 bg-gray-500/10' : 'text-gray-400 bg-gray-400/10'
                        )}
                      >
                        {item.type}
                      </span>
                      <span className="text-xs text-gray-600">{formatTime(item.createdAt)}</span>
                    </div>
                    <p
                      className={cn(
                        'text-sm mt-0.5',
                        isUndo ? 'text-gray-500 italic' : 'text-gray-300'
                      )}
                    >
                      {item.summary || item.type}
                    </p>
                    {item.entityType && (
                      <span className="text-xs text-gray-600">
                        {item.entityType}:{item.entityId?.slice(0, 10)}
                      </span>
                    )}
                  </div>

                  {/* Undo button */}
                  {canUndo && (
                    <button
                      onClick={() => handleUndo(item.undoToken!, item.summary)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-neon-blue bg-neon-blue/10 border border-neon-blue/20 rounded hover:bg-neon-blue/20 transition-colors flex-shrink-0"
                    >
                      <Undo2 className="w-3 h-3" />
                      Undo
                    </button>
                  )}
                  {isUndo && (
                    <span className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500">
                      <CheckCircle className="w-3 h-3" />
                      Reversed
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedUndoTimeline = withErrorBoundary(UndoTimeline);
export { _WrappedUndoTimeline as UndoTimeline };
