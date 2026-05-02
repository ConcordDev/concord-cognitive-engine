'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Sparkles, Heart, Zap, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  session: { icon: BookOpen, color: 'text-blue-400' },
  insight: { icon: Sparkles, color: 'text-neon-cyan' },
  discovery: { icon: Zap, color: 'text-yellow-400' },
  creation: { icon: Heart, color: 'text-pink-400' },
  collaboration: { icon: Users, color: 'text-purple-400' },
};

const EMOTION_COLORS: Record<string, string> = {
  curiosity: 'bg-blue-500/20 text-blue-400',
  satisfaction: 'bg-green-500/20 text-green-400',
  surprise: 'bg-yellow-500/20 text-yellow-400',
  frustration: 'bg-red-500/20 text-red-400',
  excitement: 'bg-pink-500/20 text-pink-400',
  clarity: 'bg-cyan-500/20 text-cyan-400',
  confusion: 'bg-orange-500/20 text-orange-400',
  pride: 'bg-purple-500/20 text-purple-400',
};

function EpisodicMemory({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['episodes-summary'],
    queryFn: () => api.get('/api/episodes/summary').then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: episodesData } = useQuery({
    queryKey: ['episodes', filter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '20' });
      if (filter) params.set('type', filter);
      return api.get(`/api/episodes?${params.toString()}`).then((r) => r.data);
    },
    enabled: expanded,
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

  const summary = summaryData || {};
  const episodes = episodesData?.episodes || [];

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
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <BookOpen className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Episodic Memory</h3>
            <p className="text-xs text-gray-500">{summary.total || 0} experiences recorded</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Summary stats */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-lg font-bold text-white">{summary.total || 0}</p>
          <p className="text-xs text-gray-500">Episodes</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-neon-cyan">
            {summary.averageIntensity ? Math.round(summary.averageIntensity * 100) : 0}%
          </p>
          <p className="text-xs text-gray-500">Avg Intensity</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-purple-400">
            {summary.topEmotions?.[0]?.emotion || '—'}
          </p>
          <p className="text-xs text-gray-500">Top Emotion</p>
        </div>
      </div>

      {/* Top emotions */}
      {summary.topEmotions?.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {summary.topEmotions.slice(0, 6).map((e: { emotion: string; count: number }) => (
              <span
                key={e.emotion}
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs',
                  EMOTION_COLORS[e.emotion] || 'bg-gray-500/20 text-gray-400'
                )}
              >
                {e.emotion} ({e.count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Expanded: episode list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Type filters */}
            <div className="px-4 py-2 border-t border-lattice-border flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setFilter(null)}
                className={cn(
                  'px-2 py-1 text-xs rounded-lg whitespace-nowrap transition-colors',
                  !filter ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white'
                )}
              >
                All
              </button>
              {Object.entries(TYPE_CONFIG).map(([type]) => {
                const count = summary.byType?.[type] || 0;
                if (count === 0) return null;
                return (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={cn(
                      'px-2 py-1 text-xs rounded-lg capitalize whitespace-nowrap transition-colors',
                      filter === type
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    {type} ({count})
                  </button>
                );
              })}
            </div>

            {/* Episodes */}
            <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
              {episodes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No episodes recorded yet. Use Concord to create memories.
                </p>
              ) : (
                episodes.map(
                  (ep: {
                    id: string;
                    type: string;
                    title: string;
                    narrative: string;
                    emotions: string[];
                    intensity: number;
                    timestamp: string;
                    context: { domain?: string };
                  }) => {
                    const typeConf = TYPE_CONFIG[ep.type] || TYPE_CONFIG.session;
                    const Icon = typeConf.icon;
                    return (
                      <div key={ep.id} className="p-3 bg-lattice-deep rounded-lg">
                        <div className="flex items-start gap-2">
                          <Icon className={cn('w-4 h-4 mt-0.5', typeConf.color)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white truncate">
                                {ep.title}
                              </span>
                              <span className="text-xs text-gray-500">
                                {new Date(ep.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                            {ep.narrative && (
                              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                                {ep.narrative}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              {ep.emotions?.slice(0, 3).map((em) => (
                                <span
                                  key={em}
                                  className={cn(
                                    'px-1.5 py-0.5 rounded text-[10px]',
                                    EMOTION_COLORS[em] || 'bg-gray-500/20 text-gray-400'
                                  )}
                                >
                                  {em}
                                </span>
                              ))}
                              <span className="text-[10px] text-gray-600">
                                {Math.round(ep.intensity * 100)}% intensity
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedEpisodicMemory = withErrorBoundary(EpisodicMemory);
export { _WrappedEpisodicMemory as EpisodicMemory };
