'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { TrendingUp, Flame, Eye, Heart, MessageSquare, Loader2, Hash } from 'lucide-react';
import { cn, formatNumber, formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface TrendingPost {
  id: string;
  title: string;
  authorName?: string;
  createdAt: string;
  trendScore?: number;
  engagement?: {
    views: number;
    likes: number;
    comments: number;
  };
}

interface TrendingDomain {
  domain: string;
  score: number;
  topPosts: TrendingPost[];
}

// ── Main Component ───────────────────────────────────────────────────────────

export function TrendingDomains({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-domains'],
    queryFn: async () => {
      const res = await api.get('/api/social/trending/domains', { params: { limit: 5 } });
      return (res.data.domains || []) as TrendingDomain[];
    },
    staleTime: 60000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className={cn('rounded-xl border border-lattice-border bg-lattice-surface/50 p-4', className)}>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return null; // Don't render anything if no trending domains
  }

  return (
    <div className={cn('rounded-xl border border-lattice-border bg-lattice-surface/50 overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-lattice-border flex items-center gap-2">
        <Flame className="w-4 h-4 text-orange-400" />
        <h2 className="text-sm font-semibold text-white">Trending by Domain</h2>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {data.slice(0, 5).map((domain, idx) => (
          <motion.div
            key={domain.domain}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="rounded-xl bg-lattice-deep border border-lattice-border p-3 space-y-2"
          >
            {/* Domain header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-neon-purple" />
                <span className="text-sm font-medium text-white capitalize truncate">
                  {domain.domain}
                </span>
              </div>
              <TrendingUp className="w-3.5 h-3.5 text-green-400" />
            </div>

            {/* Top posts in domain */}
            <div className="space-y-1.5">
              {domain.topPosts.slice(0, 3).map((post, postIdx) => (
                <div
                  key={post.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-lattice-surface/50 border border-lattice-border/30"
                >
                  <span className="text-[10px] font-bold text-gray-500 mt-0.5">
                    {postIdx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">
                      {post.title || 'Untitled'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                      {post.engagement && (
                        <>
                          <span className="flex items-center gap-0.5">
                            <Heart className="w-2.5 h-2.5" />
                            {formatNumber(post.engagement.likes)}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <MessageSquare className="w-2.5 h-2.5" />
                            {formatNumber(post.engagement.comments)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {domain.topPosts.length === 0 && (
                <p className="text-[10px] text-gray-600 text-center py-2">No posts yet</p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default TrendingDomains;
