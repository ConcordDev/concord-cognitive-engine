'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Hash, TrendingUp, Loader2, Flame } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface TrendingTopic {
  tag: string;
  count: number;
  change?: 'up' | 'down' | 'stable';
  category?: string;
}

interface TrendingTopicsProps {
  onTopicClick?: (tag: string) => void;
  className?: string;
}

// ── Animated counter ─────────────────────────────────────────────────────────

function AnimatedCounter({ target, duration = 1200 }: { target: number; duration?: number }) {
  const [current, setCurrent] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now();
    const startValue = 0;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(startValue + (target - startValue) * eased));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return <span>{formatNumber(current)}</span>;
}

// ── Main Component ───────────────────────────────────────────────────────────

function TrendingTopics({ onTopicClick, className }: TrendingTopicsProps) {
  const { data: topics, isLoading } = useQuery({
    queryKey: ['trending-topics'],
    queryFn: async () => {
      const res = await api.get('/api/social/topics/trending', {
        params: { limit: 10 },
      });
      return (res.data.topics || []) as TrendingTopic[];
    },
  });

  if (isLoading) {
    return (
      <div className={cn('p-4', className)}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
        </div>
      </div>
    );
  }

  if (!topics || topics.length === 0) {
    return (
      <div className={cn('text-center py-8', className)}>
        <Hash className="w-8 h-8 text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No trending topics yet</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Flame className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Trending Topics</h3>
      </div>

      {/* Topic list */}
      <div className="space-y-1.5">
        {topics.map((topic, idx) => (
          <motion.button
            key={topic.tag}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.04 }}
            onClick={() => onTopicClick?.(topic.tag)}
            className="w-full group flex items-center justify-between p-3 rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-purple/30 transition-all text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs font-bold text-gray-500 w-5 text-right">{idx + 1}</span>
              <Hash className="w-4 h-4 text-neon-purple flex-shrink-0" />
              <span className="text-sm text-white font-medium group-hover:text-neon-purple transition-colors truncate">
                {topic.tag}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              <span className="text-xs text-gray-500">
                <AnimatedCounter target={topic.count} /> posts
              </span>
              {topic.change === 'up' && <TrendingUp className="w-3.5 h-3.5 text-green-400" />}
              {topic.change === 'down' && (
                <TrendingUp className="w-3.5 h-3.5 text-red-400 rotate-180" />
              )}
              {topic.change === 'stable' && (
                <div className="w-3.5 h-0.5 bg-gray-600 rounded-full" />
              )}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedTrendingTopics = withErrorBoundary(TrendingTopics);
export { _WrappedTrendingTopics as TrendingTopics };
export default _WrappedTrendingTopics;
