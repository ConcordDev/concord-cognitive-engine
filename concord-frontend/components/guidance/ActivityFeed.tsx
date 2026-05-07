'use client';

/**
 * ActivityFeed — Full-page activity feed with filtering + SSE live updates.
 *
 * Shows paginated events with scope/type/entity filters.
 * Connects to SSE for live updates.
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Activity, Filter, RefreshCw, Undo2, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { useSocket } from '@/hooks/useSocket';

interface EventItem {
  id: string;
  type: string;
  actorUserId: string | null;
  scope: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  undoToken: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  requestId: string | null;
}

interface EventsResponse {
  ok: boolean;
  items: EventItem[];
  total: number;
  limit: number;
  offset: number;
}

function ActivityFeed() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const limit = 25;

  // Live updates via WebSocket (replaces SSE which lacks cookie auth support)
  const { isConnected, on, off } = useSocket();

  useEffect(() => {
    if (!isConnected) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
    };
    const events = [
      'dtu:created',
      'dtu:updated',
      'dtu:deleted',
      'system:alert',
      'lens:dtu_generated',
    ];
    events.forEach((e) => on(e, handler));
    return () => {
      events.forEach((e) => off(e, handler));
    };
  }, [isConnected, on, off, queryClient]);

  const { data, isLoading, refetch } = useQuery<EventsResponse>({
    queryKey: ['activity-feed', offset, typeFilter, scopeFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit, offset };
      if (typeFilter) params.type = typeFilter;
      if (scopeFilter) params.scope = scopeFilter;
      return (await api.get('/api/events/paginated', { params })).data;
    },
    refetchInterval: 15_000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const handleUndo = async (undoToken: string) => {
    try {
      await api.post('/api/undo', { undoToken });
      addToast({ type: 'success', message: 'Action undone successfully' });
      refetch();
    } catch {
      addToast({ type: 'error', message: 'Failed to undo action' });
    }
  };

  const copyDebugBundle = (evt: EventItem) => {
    const bundle = {
      event: evt,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    addToast({ type: 'success', message: 'Debug bundle copied to clipboard' });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-blue" />
          Activity Feed
          <span className="text-sm text-gray-500 font-normal">({total} events)</span>
        </h2>
        <button onClick={() => refetch()} className="text-gray-400 hover:text-white p-1">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-gray-500" />
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setOffset(0);
          }}
          className="bg-lattice-surface border border-lattice-border rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All types</option>
          <option value="DTU_CREATED">DTU Created</option>
          <option value="DTU_UPDATED">DTU Updated</option>
          <option value="DTU_DELETED">DTU Deleted</option>
          <option value="LENS_ITEM_SYNCED">Lens Synced</option>
          <option value="MARKETPLACE_LISTING_PUBLISHED">Listing Published</option>
          <option value="UNDO_APPLIED">Undo Applied</option>
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => {
            setScopeFilter(e.target.value);
            setOffset(0);
          }}
          className="bg-lattice-surface border border-lattice-border rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All scopes</option>
          <option value="global">Global</option>
          <option value="marketplace">Marketplace</option>
        </select>
      </div>

      {/* Events list */}
      {isLoading ? (
        <div className="text-gray-500 text-sm py-8 text-center">Loading events...</div>
      ) : items.length === 0 ? (
        <div className="text-gray-500 text-sm py-8 text-center">No events found</div>
      ) : (
        <div className="space-y-2">
          {items.map((evt) => (
            <div
              key={evt.id}
              className="p-3 rounded-lg bg-lattice-surface border border-lattice-border hover:border-lattice-border/80"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <EventTypeBadge type={evt.type} />
                    {evt.scope !== 'global' && (
                      <span className="text-[10px] px-1 py-0.5 bg-neon-blue/10 text-neon-blue rounded">
                        {evt.scope}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 mt-1">{evt.summary || evt.type}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                    <span>{formatTimestamp(evt.createdAt)}</span>
                    {evt.entityType && (
                      <span>
                        {evt.entityType}:{evt.entityId?.slice(0, 8)}
                      </span>
                    )}
                    {evt.requestId && (
                      <span className="font-mono">req:{evt.requestId.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  {evt.undoToken && (
                    <button
                      onClick={() => handleUndo(evt.undoToken!)}
                      className="p-1 text-neon-blue hover:bg-neon-blue/10 rounded"
                      title="Undo this action"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => copyDebugBundle(evt)}
                    className="p-1 text-gray-500 hover:text-white hover:bg-lattice-border/50 rounded"
                    title="Copy debug bundle"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={currentPage >= totalPages}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const EventTypeBadge = React.memo(function EventTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    DTU_CREATED: 'text-neon-green bg-neon-green/10',
    DTU_UPDATED: 'text-neon-blue bg-neon-blue/10',
    DTU_DELETED: 'text-red-400 bg-red-400/10',
    LENS_ITEM_SYNCED: 'text-purple-400 bg-purple-400/10',
    MARKETPLACE_LISTING_PUBLISHED: 'text-amber-400 bg-amber-400/10',
    UNDO_APPLIED: 'text-gray-400 bg-gray-400/10',
  };
  const color = colors[type] || 'text-gray-400 bg-gray-400/10';

  return <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', color)}>{type}</span>;
});

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedActivityFeed = withErrorBoundary(ActivityFeed);
export { _WrappedActivityFeed as ActivityFeed };
