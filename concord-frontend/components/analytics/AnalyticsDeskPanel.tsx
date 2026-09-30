'use client';

/**
 * AnalyticsDeskPanel — overview/revenue/DTUs/actions desk with shared queries
 * and stats strip. Extracted from analytics/page.tsx consolidation.
 */

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp, Users, Coins, FileText, Quote, Heart, Loader2,
  Star, Zap, PieChart as PieChartIcon, Clock,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api, apiHelpers } from '@/lib/api/client';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';
import { AnalyticsActionPanel } from '@/components/analytics/AnalyticsActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import {
  type DeskMode, type DTUSummary, type Transaction, type TransactionSummary,
  LENS_COLORS, StatCard, RevenueBar, TierBreakdown,
} from '@/components/analytics/analytics-shared';

export function AnalyticsDeskPanel({ mode }: { mode: DeskMode }) {
  const {
    data: profileData,
    isLoading: profileLoading,
    isError: profileError,
  } = useQuery({
    queryKey: ['my-social-profile'],
    queryFn: async () => {
      const res = await api.get('/api/social/profile');
      return (res.data?.profile ?? null) as {
        userId: string;
        displayName: string;
        stats: Record<string, number>;
      } | null;
    },
    retry: 1,
  });

  const userId = profileData?.userId;

  const { data: dtusData } = useQuery({
    queryKey: ['my-dtus-analytics'],
    queryFn: async () => {
      const res = await apiHelpers.dtus.myDtus({ limit: 100, offset: 0 });
      return res.data as { dtus?: DTUSummary[]; items?: DTUSummary[]; total?: number };
    },
    enabled: !!userId,
  });

  const { data: txData } = useQuery({
    queryKey: ['my-transactions'],
    queryFn: async () => {
      const res = await api.get('/api/economy/transactions', { params: { userId, limit: 100 } });
      return res.data as { transactions: Transaction[]; summary: TransactionSummary };
    },
    enabled: !!userId,
  });

  const { data: followersData } = useQuery({
    queryKey: ['my-followers', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/followers/${userId}`);
      return res.data as { followers: string[]; count: number };
    },
    enabled: !!userId,
  });

  const { data: socialAnalytics } = useQuery({
    queryKey: ['my-social-analytics', userId],
    queryFn: async () => {
      const res = await api.get('/api/social/analytics/creator', { params: { userId } });
      return res.data as Record<string, unknown>;
    },
    enabled: !!userId,
  });

  const dtus = dtusData?.dtus || dtusData?.items || [];
  const totalDTUs = dtusData?.total || dtus.length;
  const totalCitations = profileData?.stats?.citationCount || 0;
  const followerCount = followersData?.count || profileData?.stats?.followerCount || 0;
  const revenue = txData?.summary || { royaltyTotal: 0, salesTotal: 0, total: 0 };
  const totalPosts = (socialAnalytics?.totalPosts as number) || 0;
  const engagementRate = (socialAnalytics?.engagementRate as number) || 0;

  const lensDist = new Map<string, number>();
  for (const dtu of dtus) {
    for (const tag of dtu.tags || []) {
      lensDist.set(tag, (lensDist.get(tag) || 0) + 1);
    }
  }
  const lensBreakdown = Array.from(lensDist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const topDTUs = [...dtus]
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, 5);

  if (profileError) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load analytics data</p>
          <button onClick={() => window.location.reload()} className="text-xs text-neon-cyan hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (profileLoading || !userId) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total DTUs" value={totalDTUs} icon={FileText} color="text-neon-blue" />
        <StatCard label="Citations" value={totalCitations} icon={Quote} color="text-neon-green" />
        <StatCard label="Followers" value={followerCount} icon={Users} color="text-neon-purple" />
        <StatCard label="Total CC" value={revenue.total} icon={Coins} color="text-yellow-400" />
        <StatCard label="Posts" value={totalPosts} icon={Heart} color="text-neon-pink" />
        <StatCard
          label="Engagement"
          value={`${engagementRate.toFixed(1)}%`}
          icon={TrendingUp}
          color="text-neon-cyan"
          raw
        />
      </div>

      {mode === 'overview' && <CreatorAnalytics userId={userId} />}

      {mode === 'revenue' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
          >
            <div className="flex items-center gap-2 mb-4">
              <Coins className="w-4 h-4 text-yellow-400" />
              <h3 className="text-sm font-semibold text-white">Revenue Breakdown</h3>
            </div>
            <div className="space-y-4">
              <RevenueBar label="Royalties" amount={revenue.royaltyTotal} total={revenue.total} color="bg-neon-purple" />
              <RevenueBar label="Direct Sales" amount={revenue.salesTotal} total={revenue.total} color="bg-neon-cyan" />
            </div>
            <div className="mt-4 pt-4 border-t border-lattice-border flex items-center justify-between">
              <span className="text-sm text-gray-400">Total Revenue</span>
              <span className="text-lg font-bold text-yellow-400">{formatNumber(revenue.total)} CC</span>
            </div>
          </motion.div>

          {lensBreakdown.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
            >
              <div className="flex items-center gap-2 mb-4">
                <PieChartIcon className="w-4 h-4 text-neon-purple" />
                <h3 className="text-sm font-semibold text-white">DTU Distribution by Lens / Tag</h3>
              </div>
              <div className="space-y-3">
                {lensBreakdown.map(([tag, count], idx) => {
                  const pct = totalDTUs > 0 ? (count / totalDTUs) * 100 : 0;
                  return (
                    <div key={tag} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-300 capitalize">{tag}</span>
                        <span className="text-gray-400">{count} DTUs ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: idx * 0.05 }}
                          className={cn('h-full rounded-full', LENS_COLORS[idx % LENS_COLORS.length])}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
              <p>No lens analytics data yet. Lens usage breakdown will appear here.</p>
            </div>
          )}

          {txData?.transactions && txData.transactions.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
            >
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-neon-cyan" />
                <h3 className="text-sm font-semibold text-white">Recent Transactions</h3>
              </div>
              <div className="space-y-2">
                {txData.transactions.slice(0, 10).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-lattice-surface border border-lattice-border/50"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded capitalize',
                          tx.type === 'royalty'
                            ? 'bg-neon-purple/20 text-neon-purple'
                            : 'bg-neon-cyan/20 text-neon-cyan'
                        )}
                      >
                        {tx.type || 'transfer'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(tx.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-neon-green">
                      +{formatNumber(tx.amount)} CC
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
              <p>No transaction data yet. Transaction history will appear here.</p>
            </div>
          )}
        </div>
      )}

      {mode === 'dtus' && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
          >
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-yellow-400" />
              <h3 className="text-sm font-semibold text-white">Top Performing DTUs</h3>
            </div>
            {topDTUs.length > 0 ? (
              <div className="space-y-2">
                {topDTUs.map((dtu, idx) => (
                  <div
                    key={dtu.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-lattice-surface border border-lattice-border"
                  >
                    <span className={cn('text-sm font-bold w-6 text-center', idx < 3 ? 'text-neon-cyan' : 'text-gray-400')}>
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        {dtu.title || dtu.summary || dtu.id.slice(0, 24)}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                        {dtu.tier && <span className="capitalize">{dtu.tier}</span>}
                        {(dtu.tags || []).slice(0, 2).map((t) => (
                          <span key={t} className="text-neon-cyan/60">#{t}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1 text-sm font-bold text-neon-green">
                        <Quote className="w-3.5 h-3.5" />
                        {dtu.citationCount || 0}
                      </div>
                      <div className="text-[10px] text-gray-400">citations</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No DTUs yet</p>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-neon-blue" />
              <h3 className="text-sm font-semibold text-white">DTU Tier Breakdown</h3>
            </div>
            <TierBreakdown dtus={dtus} />
          </motion.div>
        </div>
      )}

      {mode === 'actions' && (
        <div className="space-y-4">
          <PipingProvider>
            <AnalyticsActionPanel />
          </PipingProvider>
        </div>
      )}
    </div>
  );
}
