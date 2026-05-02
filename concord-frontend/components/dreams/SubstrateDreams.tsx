'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Moon,
  Sun,
  Sparkles,
  Brain,
  Scissors,
  Zap,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const PHASE_ICONS: Record<string, React.ElementType> = {
  replay: Brain,
  consolidate: Zap,
  prune: Scissors,
  dream: Sparkles,
  integrate: Sun,
  wake: Sun,
};

const PHASE_COLORS: Record<string, string> = {
  replay: 'text-blue-400',
  consolidate: 'text-purple-400',
  prune: 'text-red-400',
  dream: 'text-neon-cyan',
  integrate: 'text-green-400',
  wake: 'text-yellow-400',
};

function SubstrateDreams({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: dreamState, isLoading } = useQuery<{
    isActive?: boolean;
    currentPhase?: { id: string; name: string; description: string };
    progress?: number;
    stats?: Record<string, number>;
  }>({
    queryKey: ['dream-state'],
    queryFn: () => api.get('/api/dreams/state').then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.isActive ? 3000 : 30000),
  });

  const { data: historyData } = useQuery({
    queryKey: ['dream-history'],
    queryFn: () => api.get('/api/dreams/history').then((r) => r.data),
    enabled: expanded,
  });

  const startDream = useMutation({
    mutationFn: () => api.post('/api/dreams/start'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dream-state'] });
      queryClient.invalidateQueries({ queryKey: ['dream-history'] });
    },
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          'p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse',
          className
        )}
      >
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  const isActive = dreamState?.isActive;
  const currentPhase = dreamState?.currentPhase;
  const progress = dreamState?.progress || 0;
  const stats = dreamState?.stats || {};

  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', isActive ? 'bg-neon-purple/20' : 'bg-lattice-deep')}>
            <Moon
              className={cn(
                'w-5 h-5',
                isActive ? 'text-neon-purple animate-pulse' : 'text-gray-400'
              )}
            />
          </div>
          <div>
            <h3 className="font-medium text-white">Substrate Dreams</h3>
            <p className="text-xs text-gray-500">
              {isActive
                ? `Phase: ${currentPhase?.name || 'Unknown'}`
                : stats.totalDreams > 0
                  ? `${stats.totalDreams} dream cycles completed`
                  : 'Night cycle processor'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isActive && (
            <button
              onClick={() => startDream.mutate()}
              disabled={startDream.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neon-purple/20 text-neon-purple rounded-lg hover:bg-neon-purple/30 transition-colors disabled:opacity-50"
            >
              {startDream.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              Dream
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Active dream progress */}
      {isActive && currentPhase && (
        <div className="p-4 bg-gradient-to-r from-neon-purple/5 to-neon-cyan/5">
          <div className="flex items-center gap-3 mb-3">
            {(() => {
              const PhaseIcon = PHASE_ICONS[currentPhase.id] || Sparkles;
              return (
                <PhaseIcon
                  className={cn('w-5 h-5', PHASE_COLORS[currentPhase.id] || 'text-gray-400')}
                />
              );
            })()}
            <div>
              <p className="text-sm font-medium text-white">{currentPhase.name}</p>
              <p className="text-xs text-gray-500">{currentPhase.description}</p>
            </div>
          </div>
          <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-neon-purple to-neon-cyan rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">{Math.round(progress * 100)}%</p>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px bg-lattice-border">
        {[
          { label: 'Dreams', value: stats.totalDreams || 0, color: 'text-neon-purple' },
          { label: 'Insights', value: stats.insightsGenerated || 0, color: 'text-neon-cyan' },
          { label: 'Consolidated', value: stats.dtusConsolidated || 0, color: 'text-green-400' },
          { label: 'Pruned', value: stats.connectionsPruned || 0, color: 'text-red-400' },
        ].map((stat) => (
          <div key={stat.label} className="p-3 bg-lattice-surface text-center">
            <p className={cn('text-lg font-bold', stat.color)}>{stat.value}</p>
            <p className="text-xs text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Expanded: history + insights */}
      <AnimatePresence>
        {expanded && historyData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Recent insights */}
            {historyData.lastInsights?.length > 0 && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Recent Insights
                </h4>
                <div className="space-y-2">
                  {historyData.lastInsights.slice(0, 5).map(
                    (
                      insight: {
                        content: string;
                        type: string;
                        domains?: string[];
                        createdAt: string;
                      },
                      i: number
                    ) => (
                      <div key={i} className="p-2 bg-lattice-deep rounded-lg text-sm text-gray-300">
                        <p>{insight.content}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-neon-cyan">{insight.type}</span>
                          {insight.domains?.map((d) => (
                            <span key={d} className="text-xs text-gray-500">
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* History */}
            {historyData.history?.length > 0 && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Dream History
                </h4>
                <div className="space-y-1">
                  {historyData.history
                    .slice(0, 5)
                    .map(
                      (
                        h: { startedAt: string; completedAt: string; insightsGenerated: number },
                        i: number
                      ) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs text-gray-500"
                        >
                          <span>{new Date(h.startedAt).toLocaleDateString()}</span>
                          <span>{h.insightsGenerated} insights</span>
                        </div>
                      )
                    )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSubstrateDreams = withErrorBoundary(SubstrateDreams);
export { _WrappedSubstrateDreams as SubstrateDreams };
