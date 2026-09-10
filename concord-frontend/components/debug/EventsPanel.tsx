'use client';

import { useState } from 'react';
import { Eye, ChevronDown, ChevronRight } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useDebugDesk } from '@/components/debug/useDebugDesk';

export function EventsPanel() {
  const { events, isLoading, isError, errorMessage, refetchAll } = useDebugDesk();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const toggleEventExpand = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) return <ErrorState error={errorMessage} onRetry={refetchAll} />;

  return (
<div className="panel p-4">
  <h2 className="font-semibold mb-4 flex items-center gap-2">
    <Eye className="w-4 h-4 text-neon-cyan" />
    Recent Events ({events?.events?.length || 0})
  </h2>
  <div className="space-y-2 max-h-[600px] overflow-auto">
    {(events?.events || []).length === 0 ? (
      <div className="text-center py-12 text-gray-400">
        <Eye className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No events recorded yet</p>
      </div>
    ) : (
      (events?.events || [])
        .slice(0, 100)
        .map((event: Record<string, unknown>, idx: number) => {
          const id = (event.id as string) || `evt-${idx}`;
          const isExpanded = expandedEvents.has(id);
          return (
            <div
              key={id}
              className="bg-lattice-deep rounded-lg border border-lattice-border"
            >
              <button
                onClick={() => toggleEventExpand(id)}
                className="flex items-center justify-between p-3 w-full text-left"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  )}
                  <span
                    className={`font-mono text-sm ${
                      String(event.type).includes('error')
                        ? 'text-red-400'
                        : String(event.type).includes('created')
                          ? 'text-neon-green'
                          : 'text-neon-purple'
                    }`}
                  >
                    {String(event.type)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {String(event.at || event.timestamp || '')}
                  </span>
                </div>
              </button>
              {isExpanded && (
                <pre className="px-3 pb-3 text-xs text-gray-400 overflow-auto max-h-48 border-t border-lattice-border pt-2 mx-3">
                  {JSON.stringify(event.payload || event, null, 2)}
                </pre>
              )}
            </div>
          );
        })
    )}
  </div>
</div>

  );
}
