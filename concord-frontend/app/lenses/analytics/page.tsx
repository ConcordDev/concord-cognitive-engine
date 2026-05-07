'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  BarChart3,
  TrendingUp,
  Users,
  Coins,
  FileText,
  Quote,
  Heart,
  Loader2,
  ArrowLeft,
  Star,
  Zap,
  PieChart,
  Clock,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api, apiHelpers } from '@/lib/api/client';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';

// ── Types ────────────────────────────────────────────────────────────────────

interface TransactionSummary {
  royaltyTotal: number;
  salesTotal: number;
  total: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  from?: string;
  to?: string;
  timestamp: number;
}

interface DTUSummary {
  id: string;
  title?: string;
  summary?: string;
  citationCount?: number;
  tags?: string[];
  tier?: string;
}

// ── Analytics Page ───────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeSection, setActiveSection] = useState<'overview' | 'revenue' | 'dtus'>('overview');

  // Fetch user profile for userId
  const { data: profileData, isError: profileError } = useQuery({
    queryKey: ['my-social-profile'],
    queryFn: async () => {
      const res = await api.get('/api/social/profile');
      return res.data.profile as { userId: string; displayName: string; stats: Record<string, number> };
    },
    retry: 1,
  });

  const userId = profileData?.userId;

  // Fetch DTUs created by the user
  const { data: dtusData } = useQuery({
    queryKey: ['my-dtus-analytics'],
    queryFn: async () => {
      const res = await apiHelpers.dtus.myDtus({ limit: 100, offset: 0 });
      return res.data as { dtus?: DTUSummary[]; items?: DTUSummary[]; total?: number };
    },
    enabled: !!userId,
  });

  // Fetch transaction/revenue data
  const { data: txData } = useQuery({
    queryKey: ['my-transactions'],
    queryFn: async () => {
      const res = await api.get('/api/economy/transactions', { params: { userId, limit: 100 } });
      return res.data as { transactions: Transaction[]; summary: TransactionSummary };
    },
    enabled: !!userId,
  });

  // Fetch follower data
  const { data: followersData } = useQuery({
    queryKey: ['my-followers', userId],
    queryFn: async () => {
      const res = await api.get(`/api/social/followers/${userId}`);
      return res.data as { followers: string[]; count: number };
    },
    enabled: !!userId,
  });

  // Fetch social analytics (engagement)
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

  // Compute per-lens (tag) DTU distribution
  const lensDist = new Map<string, number>();
  for (const dtu of dtus) {
    for (const tag of (dtu.tags || [])) {
      lensDist.set(tag, (lensDist.get(tag) || 0) + 1);
    }
  }
  const lensBreakdown = Array.from(lensDist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Top performing DTUs (by citations, approximated)
  const topDTUs = [...dtus]
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, 5);

  const sections = [
    { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
    { id: 'revenue' as const, label: 'Revenue', icon: Coins },
    { id: 'dtus' as const, label: 'DTUs', icon: FileText },
  ];

  if (profileError) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load analytics data</p>
          <button onClick={() => window.location.reload()} className="text-xs text-neon-cyan hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-lattice-void text-white">
      {/* Header */}
      <header className="bg-lattice-surface border-b border-lattice-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/profile"
                className="p-2 rounded-lg hover:bg-lattice-deep transition-colors text-gray-400 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-neon-cyan" />
                  Creator Analytics Dashboard
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  Full performance overview for {profileData?.displayName || 'your account'}
                </p>
              </div>
            </div>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 mt-4">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeSection === s.id
                    ? 'bg-neon-cyan/10 text-neon-cyan'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-deep'
                )}
              >
                <s.icon className="w-4 h-4" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top-level Stat Cards */}
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

        {/* Overview section: existing CreatorAnalytics component */}
        {activeSection === 'overview' && (
          <CreatorAnalytics userId={userId} />
        )}

        {/* Revenue section */}
        {activeSection === 'revenue' && (
          <div className="space-y-4">
            {/* Revenue breakdown bar */}
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

            {/* Revenue per lens */}
            {lensBreakdown.length > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
              >
                <div className="flex items-center gap-2 mb-4">
                  <PieChart className="w-4 h-4 text-neon-purple" />
                  <h3 className="text-sm font-semibold text-white">DTU Distribution by Lens / Tag</h3>
                </div>
                <div className="space-y-3">
                  {lensBreakdown.map(([tag, count], idx) => {
                    const pct = totalDTUs > 0 ? (count / totalDTUs) * 100 : 0;
                    return (
                      <div key={tag} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-300 capitalize">{tag}</span>
                          <span className="text-gray-500">{count} DTUs ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: idx * 0.05 }}
                            className={cn(
                              'h-full rounded-full',
                              LENS_COLORS[idx % LENS_COLORS.length]
                            )}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                <p>No lens analytics data yet. Lens usage breakdown will appear here.</p>
              </div>
            )}

            {/* Recent transactions */}
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
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded capitalize',
                          tx.type === 'royalty' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-neon-cyan/20 text-neon-cyan'
                        )}>
                          {tx.type || 'transfer'}
                        </span>
                        <span className="text-xs text-gray-500">
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
              <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                <p>No transaction data yet. Transaction history will appear here.</p>
              </div>
            )}
          </div>
        )}

        {/* DTUs section */}
        {activeSection === 'dtus' && (
          <div className="space-y-4">
            {/* Top performing DTUs */}
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
                      <span className={cn(
                        'text-sm font-bold w-6 text-center',
                        idx < 3 ? 'text-neon-cyan' : 'text-gray-500'
                      )}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">
                          {dtu.title || dtu.summary || dtu.id.slice(0, 24)}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                          {dtu.tier && (
                            <span className="capitalize">{dtu.tier}</span>
                          )}
                          {(dtu.tags || []).slice(0, 2).map(t => (
                            <span key={t} className="text-neon-cyan/60">#{t}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-1 text-sm font-bold text-neon-green">
                          <Quote className="w-3.5 h-3.5" />
                          {dtu.citationCount || 0}
                        </div>
                        <div className="text-[10px] text-gray-600">citations</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">No DTUs yet</p>
              )}
            </motion.div>

            {/* DTU tier distribution */}
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
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const LENS_COLORS = [
  'bg-neon-cyan/70',
  'bg-neon-purple/70',
  'bg-neon-pink/70',
  'bg-neon-green/70',
  'bg-yellow-400/70',
  'bg-blue-400/70',
  'bg-orange-400/70',
  'bg-teal-400/70',
];

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  raw,
}: {
  label: string;
  value: string | number;
  icon: typeof BarChart3;
  color: string;
  raw?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-lattice-deep border border-lattice-border"
    >
      <Icon className={cn('w-4 h-4 mb-2', color)} />
      <div className={cn('text-2xl font-bold', color)}>
        {raw ? value : formatNumber(value as number)}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </motion.div>
  );
}

function RevenueBar({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="text-white font-medium">{formatNumber(amount)} CC ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-3 bg-lattice-surface rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8 }}
          className={cn('h-full rounded-full', color)}
        />
      </div>
    </div>
  );
}

function TierBreakdown({ dtus }: { dtus: DTUSummary[] }) {
  const tierCounts: Record<string, number> = {};
  for (const dtu of dtus) {
    const tier = dtu.tier || 'regular';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  const TIER_COLORS: Record<string, string> = {
    regular: 'bg-neon-blue/60',
    mega: 'bg-neon-purple/60',
    hyper: 'bg-neon-pink/60',
    shadow: 'bg-gray-400/60',
  };

  const total = dtus.length || 1;

  return (
    <div data-lens-theme="analytics" className="space-y-3">
      {Object.entries(tierCounts).map(([tier, count]) => {
        const pct = (count / total) * 100;
        return (
          <div key={tier} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-300 capitalize">{tier}</span>
              <span className="text-gray-500">{count} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6 }}
                className={cn('h-full rounded-full', TIER_COLORS[tier] || 'bg-gray-400/60')}
              />
            </div>
          </div>
        );
      })}
      {Object.keys(tierCounts).length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">No DTU data available</p>
      )}
    </div>
  );
}
