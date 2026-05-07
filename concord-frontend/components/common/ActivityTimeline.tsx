'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Clock, ChevronDown, ChevronUp, User, Bot, Sparkles } from 'lucide-react';
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

export function ActivityTimeline({ domain }: ActivityTimelineProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'user' | 'system'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['activity-timeline', domain],
    queryFn: () =>
      apiHelpers.lens
        .list(domain, { limit: 20 })
        .then((r) => r.data)
        .catch(() => ({ items: [] })),
    staleTime: 30000,
    enabled: isOpen,
  });

  const items = (data?.items || []) as Array<Record<string, unknown>>;
  const filtered = items.filter((item) => {
    if (filter === 'all') return true;
    const source = (item.source as string) || 'user';
    return filter === 'user' ? source === 'user' || source === 'user.capture' : source !== 'user';
  });

  return (
    <div className="border-t border-lattice-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-400 hover:text-gray-300 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span>Activity Timeline</span>
          {items.length > 0 && (
            <span className="text-xs bg-lattice-surface px-1.5 py-0.5 rounded">{items.length}</span>
          )}
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                        : 'text-gray-500 hover:text-gray-400'
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
                  <p className="text-xs text-gray-500 text-center py-4">No activity yet</p>
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
                          <p className="text-xs text-gray-500">
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
