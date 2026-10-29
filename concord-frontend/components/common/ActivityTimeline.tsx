'use client';

import { useCallback, useState } from 'react';
import { useLensTool } from '@/lib/lens-dock';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Clock, X, User, Bot, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SkeletonTimeline } from '@/components/common/Skeleton';

interface ActivityTimelineProps {
  domain: string;
}

const sourceIcons: Record<string, typeof User> = {
  user: User,
  autogen: Bot,
  dream: Sparkles,
  synthesis: Sparkles,
};

function ActivityTimeline({ domain }: ActivityTimelineProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'user' | 'system'>('all');
  useLensTool('activity', useCallback(() => setIsOpen((o) => !o), []));

  // S15: read the platform event log — the same source the Guide's
  // Recent Activity reads (/api/events/paginated) — filtered to
  // this lens's objects. This panel previously listed lens
  // ARTIFACTS as if they were activity and showed "No activity
  // yet" after full working sessions.
  const { data, isLoading } = useQuery({
    queryKey: ['activity-timeline', domain],
    queryFn: () =>
      api
        .get('/api/events/paginated', { params: { limit: 50 } })
        .then((r) => r.data)
        .catch(() => ({ items: [] })),
    staleTime: 30000,
    enabled: isOpen,
  });

  type RawEvent = {
    id?: string; type?: string; action?: string; message?: string;
    entityType?: string; timestamp?: string; meta?: Record<string, unknown>;
  };
  const belongsToLens = (e: RawEvent): boolean => {
    if (e.type === domain || e.entityType === domain) return true;
    if (e.meta?.domain === domain || e.meta?.lens === domain) return true;
    // DTU events for this lens's objects: lens DTUs are titled
    // "<Lens>: <name>" (a whiteboard board DTU is "Whiteboard: …").
    const title = e.meta?.title;
    return e.type === 'dtu' && typeof title === 'string'
      && title.toLowerCase().startsWith(`${domain.toLowerCase()}:`);
  };
  const items = ((data?.items || []) as RawEvent[])
    .filter(belongsToLens)
    .map((e) => ({
      id: e.id,
      title: e.message || `${e.type || 'event'} ${e.action || ''}`.trim(),
      updatedAt: e.timestamp,
      // The user's own DTU work and sign-ins are "You"; the rest is
      // system activity. (The event log has no per-row source field;
      // this matches how the Guide presents the same events.)
      source: e.type === 'dtu' || e.type === 'auth' ? 'user' : 'system',
    })) as Array<Record<string, unknown>>;
  const filtered = items.filter((item) => {
    if (filter === 'all') return true;
    const source = (item.source as string) || 'user';
    return filter === 'user' ? source === 'user' || source === 'user.capture' : source !== 'user';
  });

  // Opened from the lens header toolbar ("Activity"); nothing renders closed.
  if (!isOpen) return null;

  return (
    <div className="border-t border-lattice-border">
      <button
        onClick={() => setIsOpen(false)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-400 hover:text-gray-300 transition-colors"
        aria-label="Close activity timeline"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span>Activity Timeline</span>
          {items.length > 0 && (
            <span className="text-xs bg-lattice-surface px-1.5 py-0.5 rounded">{items.length}</span>
          )}
        </div>
        <X className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              {/* Filter tabs */}
              <div className="flex gap-1 mb-3">
                {(['all', 'user', 'system'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-1 text-xs rounded ${
                      filter === f
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'text-gray-400 hover:text-gray-400'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'user' ? 'You' : 'System'}
                  </button>
                ))}
              </div>

              {/* Timeline */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {isLoading ? (
                  <SkeletonTimeline count={3} />
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No activity yet</p>
                ) : (
                  filtered.map((item, i) => {
                    const source = (item.source as string) || 'user';
                    const Icon = sourceIcons[source] || User;
                    const isSystem = source !== 'user' && source !== 'user.capture';
                    return (
                      <div key={(item.id as string) || i} className="flex items-start gap-2.5">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                            isSystem ? 'bg-neon-purple/20' : 'bg-neon-cyan/20'
                          }`}
                        >
                          <Icon
                            className={`w-3 h-3 ${isSystem ? 'text-neon-purple' : 'text-neon-cyan'}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-300 truncate">
                            {(item.title as string) || 'Activity'}
                          </p>
                          <p className="text-xs text-gray-400">
                            {item.updatedAt
                              ? new Date(item.updatedAt as string).toLocaleString()
                              : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedActivityTimeline = withErrorBoundary(ActivityTimeline);
export { _WrappedActivityTimeline as ActivityTimeline };
