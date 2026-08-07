'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FunnelsPanel } from '@/components/analytics/FunnelsPanel';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { AnalyticsActionPanel } from '@/components/analytics/AnalyticsActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
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
  PieChart as PieChartIcon,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api, apiHelpers } from '@/lib/api/client';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';
import { PlatformGrowth } from '@/components/analytics/PlatformGrowth';
import { EventAnalytics } from '@/components/analytics/EventAnalytics';
import { AdvancedAnalytics } from '@/components/analytics/AdvancedAnalytics';

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
  useLensNav('analytics');
  const [activeSection, setActiveSection] = useState<'overview' | 'revenue' | 'dtus' | 'actions'>(
    'overview'
  );
  const [showPlatformGrowth, setShowPlatformGrowth] = useState(false);
  const [showEventAnalytics, setShowEventAnalytics] = useState(false);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);
  const [showFunnels, setShowFunnels] = useState(false);


  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveSection('overview') },
      { id: 'tab-revenue', keys: 'r', description: 'Revenue', category: 'navigation', action: () => setActiveSection('revenue') },
      { id: 'tab-dtus', keys: 'd', description: 'Dtus', category: 'navigation', action: () => setActiveSection('dtus') },
      { id: 'tab-actions', keys: 'a', description: 'Actions', category: 'navigation', action: () => setActiveSection('actions') },
    ],
    { lensId: 'analytics' }
  );
  // Fetch user profile for userId
  const {
    data: profileData,
    isLoading: profileLoading,
    isError: profileError,
  } = useQuery({
    queryKey: ['my-social-profile'],
    queryFn: async () => {
      const res = await api.get('/api/social/profile');
      // React Query rejects undefined returns. Coerce a missing
      // profile (new user, backend miss) to null.
      return (res.data?.profile ?? null) as {
        userId: string;
        displayName: string;
        stats: Record<string, number>;
      } | null;
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
    for (const tag of dtu.tags || []) {
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
    { id: 'actions' as const, label: 'Actions', icon: Zap },
  ];

  if (profileError) {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load analytics data</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-neon-cyan hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-lattice-void animate-pulse">
        <div className="bg-lattice-surface border-b border-lattice-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
            <div className="h-8 bg-lattice-elevated rounded-lg w-1/3 mb-4" />
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 bg-lattice-elevated rounded-lg w-24" />
              ))}
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-lattice-deep rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-lattice-deep rounded-xl" />
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
    <LensShell lensId="analytics" asMain={false}>
      <FirstRunTour lensId="analytics" />
      <ManifestActionBar />
      <DepthBadge lensId="analytics" size="sm" className="ml-2" />
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
                <p className="text-sm text-gray-400 mt-0.5">
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
        {activeSection === 'overview' && <CreatorAnalytics userId={userId} />}

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
                <RevenueBar
                  label="Royalties"
                  amount={revenue.royaltyTotal}
                  total={revenue.total}
                  color="bg-neon-purple"
                />
                <RevenueBar
                  label="Direct Sales"
                  amount={revenue.salesTotal}
                  total={revenue.total}
                  color="bg-neon-cyan"
                />
              </div>
              <div className="mt-4 pt-4 border-t border-lattice-border flex items-center justify-between">
                <span className="text-sm text-gray-400">Total Revenue</span>
                <span className="text-lg font-bold text-yellow-400">
                  {formatNumber(revenue.total)} CC
                </span>
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
                  <PieChartIcon className="w-4 h-4 text-neon-purple" />
                  <h3 className="text-sm font-semibold text-white">
                    DTU Distribution by Lens / Tag
                  </h3>
                </div>
                <div className="space-y-3">
                  {lensBreakdown.map(([tag, count], idx) => {
                    const pct = totalDTUs > 0 ? (count / totalDTUs) * 100 : 0;
                    return (
                      <div key={tag} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-300 capitalize">{tag}</span>
                          <span className="text-gray-400">
                            {count} DTUs ({pct.toFixed(0)}%)
                          </span>
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
              <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
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
                      <span
                        className={cn(
                          'text-sm font-bold w-6 text-center',
                          idx < 3 ? 'text-neon-cyan' : 'text-gray-400'
                        )}
                      >
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">
                          {dtu.title || dtu.summary || dtu.id.slice(0, 24)}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                          {dtu.tier && <span className="capitalize">{dtu.tier}</span>}
                          {(dtu.tags || []).slice(0, 2).map((t) => (
                            <span key={t} className="text-neon-cyan/60">
                              #{t}
                            </span>
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

        {/* Actions section — analyst bench: funnel / cohort / anomaly / forecast + mint/DM/publish/agent */}
        {activeSection === 'actions' && (
          <div className="space-y-4">
            <PipingProvider>
              <AnalyticsActionPanel />
            </PipingProvider>
          </div>
        )}
      </main>
      <section className="mt-6 mx-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowPlatformGrowth(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Platform growth</span>
          {showPlatformGrowth ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showPlatformGrowth && (
          <div className="mt-3">
            <PlatformGrowth />
          </div>
        )}
      </section>
      <section className="mt-6 mx-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowEventAnalytics(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Event analytics</span>
          {showEventAnalytics ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showEventAnalytics && (
          <div className="mt-3">
            <EventAnalytics />
          </div>
        )}
      </section>
      <section className="mt-6 mx-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowAdvancedAnalytics(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Advanced analytics</span>
          {showAdvancedAnalytics ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showAdvancedAnalytics && (
          <div className="mt-3">
            <AdvancedAnalytics />
          </div>
        )}
      </section>
    </div>

      <section className="mt-6 max-w-7xl mx-auto rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowFunnels(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Funnels</span>
          {showFunnels ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showFunnels && <div className="mt-3"><FunnelsPanel /></div>}
      </section>

      <a href="#analytics-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to analytics content</a>
          <RecentMineCard domain="analytics" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="analytics" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="analytics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
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
      <div className="text-xs text-gray-400 mt-1">{label}</div>
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
  const barColor = color.includes('purple')
    ? '#8b5cf6'
    : color.includes('cyan')
      ? '#00e5ff'
      : '#3b82f6';
  const data = [{ name: label, value: amount, total }];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="text-white font-medium">
          {formatNumber(amount)} CC ({total > 0 ? ((amount / total) * 100).toFixed(0) : 0}%)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={28}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, total || 1]} />
          <YAxis type="category" dataKey="name" hide />
          <Bar
            dataKey="value"
            fill={barColor}
            radius={[4, 4, 4, 4]}
            background={{ fill: '#1e293b', radius: 4 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const TIER_PIE_COLORS: Record<string, string> = {
  regular: '#3b82f6',
  mega: '#8b5cf6',
  hyper: '#ec4899',
  shadow: '#6b7280',
};

function TierBreakdown({ dtus }: { dtus: DTUSummary[] }) {
  const tierCounts: Record<string, number> = {};
  for (const dtu of dtus) {
    const tier = dtu.tier || 'regular';
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  const pieData = Object.entries(tierCounts).map(([tier, count]) => ({
    name: tier,
    value: count,
    color: TIER_PIE_COLORS[tier] || '#6b7280',
  }));

  if (pieData.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No DTU data available</p>;
  }

  return (
    <div data-lens-theme="analytics" className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={30}
            outerRadius={55}
            paddingAngle={2}
            strokeWidth={0}
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a2e',
              border: '1px solid #2d2d44',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {pieData.map(({ name, value, color }) => (
          <div key={name} className="flex items-center gap-2 text-sm">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-300 capitalize flex-1">{name}</span>
            <span className="text-gray-400">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
