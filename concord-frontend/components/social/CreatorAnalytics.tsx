'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Users,
  Eye,
  Heart,
  MessageSquare,
  Share2,
  BarChart3,
  Clock,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Type,
  Coins,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
} from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface EngagementDay {
  date: string;
  reactions: number;
  comments: number;
  shares: number;
}

interface TopPost {
  postId: string;
  title: string;
  engagementScore: number;
  reactions: number;
  comments: number;
  shares: number;
  createdAt: string;
}

interface HourlyEngagement {
  hour: number;
  score: number;
}

interface ContentBreakdown {
  mediaType: string;
  count: number;
}

interface CreatorAnalyticsData {
  overview: {
    engagementRate: number;
    totalReach: number;
    followerCount: number;
    followerTrend: 'up' | 'down' | 'stable';
  };
  engagementByDay: EngagementDay[];
  topPosts: TopPost[];
  bestPostingHours: HourlyEngagement[];
  contentBreakdown: ContentBreakdown[];
  followerGrowth: {
    gained: number;
    lost: number;
    net: number;
    period: string;
  };
  earnings: {
    totalCC: number;
    thisWeek: number;
    thisMonth: number;
  };
}

interface CreatorAnalyticsProps {
  userId: string;
  className?: string;
}

// ── Media type icons ─────────────────────────────────────────────────────────

const MEDIA_ICONS: Record<string, typeof Type> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music,
  document: FileText,
};

const MEDIA_COLORS: Record<string, string> = {
  text: 'bg-blue-500/20 text-blue-400',
  image: 'bg-green-500/20 text-green-400',
  video: 'bg-purple-500/20 text-purple-400',
  audio: 'bg-orange-500/20 text-orange-400',
  document: 'bg-gray-500/20 text-gray-400',
};

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-xl bg-lattice-deep border border-lattice-border"
    >
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-neon-cyan" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  suffix,
  color = 'text-neon-cyan',
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  trend?: 'up' | 'down' | 'stable';
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-lattice-surface border border-lattice-border">
      <div className="flex items-center justify-between mb-2">
        <Icon className={cn('w-4 h-4', color)} />
        {trend === 'up' && <ArrowUpRight className="w-4 h-4 text-green-400" />}
        {trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-400" />}
      </div>
      <div className={cn('text-2xl font-bold', color)}>
        {value}
        {suffix && <span className="text-sm ml-0.5">{suffix}</span>}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function CreatorAnalytics({ userId, className }: CreatorAnalyticsProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['creator-analytics', userId],
    queryFn: async () => {
      const res = await api.get('/api/social/analytics/creator', {
        params: { userId },
      });
      return res.data as CreatorAnalyticsData;
    },
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-20', className)}>
        <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={cn('text-center py-16', className)}>
        <BarChart3 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500">Unable to load analytics</p>
      </div>
    );
  }

  const maxDayEngagement = Math.max(
    ...data.engagementByDay.map((d) => d.reactions + d.comments + d.shares),
    1
  );

  const maxHourScore = Math.max(
    ...data.bestPostingHours.map((h) => h.score),
    1
  );

  const maxContentCount = Math.max(
    ...data.contentBreakdown.map((c) => c.count),
    1
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* ── Overview ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Engagement Rate"
          value={`${data.overview.engagementRate.toFixed(1)}`}
          suffix="%"
          icon={Heart}
          trend={data.overview.followerTrend}
          color="text-neon-pink"
        />
        <StatCard
          label="Total Reach"
          value={formatNumber(data.overview.totalReach)}
          icon={Eye}
          color="text-neon-cyan"
        />
        <StatCard
          label="Followers"
          value={formatNumber(data.overview.followerCount)}
          icon={Users}
          trend={data.overview.followerTrend}
          color="text-neon-purple"
        />
      </div>

      {/* ── Engagement Chart (7 days) ────────────────────────────────── */}
      <Section title="Engagement (Last 7 Days)" icon={BarChart3}>
        <div className="flex items-end gap-2 h-40">
          {data.engagementByDay.slice(-7).map((day) => {
            const total = day.reactions + day.comments + day.shares;
            const heightPct = (total / maxDayEngagement) * 100;
            const reactPct = total > 0 ? (day.reactions / total) * heightPct : 0;
            const commentPct = total > 0 ? (day.comments / total) * heightPct : 0;
            const sharePct = total > 0 ? (day.shares / total) * heightPct : 0;

            const dayLabel = new Date(day.date).toLocaleDateString('en-US', {
              weekday: 'short',
            });

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[10px] text-gray-500">{total}</div>
                <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: '120px' }}>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${reactPct}%` }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className="w-full bg-neon-cyan/60 min-h-0"
                    title={`${day.reactions} reactions`}
                  />
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${commentPct}%` }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                    className="w-full bg-neon-purple/60 min-h-0"
                    title={`${day.comments} comments`}
                  />
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${sharePct}%` }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                    className="w-full bg-neon-green/60 min-h-0"
                    title={`${day.shares} shares`}
                  />
                </div>
                <div className="text-[10px] text-gray-500">{dayLabel}</div>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-neon-cyan/60" /> Reactions
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-neon-purple/60" /> Comments
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-neon-green/60" /> Shares
          </span>
        </div>
      </Section>

      {/* ── Top Posts ────────────────────────────────────────────────── */}
      <Section title="Top Posts" icon={Flame}>
        <div className="space-y-2">
          {data.topPosts.slice(0, 5).map((post, idx) => (
            <div
              key={post.postId}
              className="flex items-center gap-3 p-3 rounded-lg bg-lattice-surface border border-lattice-border"
            >
              <span className={cn(
                'text-sm font-bold w-6 text-center',
                idx < 3 ? 'text-neon-cyan' : 'text-gray-500'
              )}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{post.title}</p>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                  <span className="flex items-center gap-0.5">
                    <Heart className="w-3 h-3" /> {post.reactions}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="w-3 h-3" /> {post.comments}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Share2 className="w-3 h-3" /> {post.shares}
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-bold text-neon-cyan">
                  {post.engagementScore}
                </div>
                <div className="text-[10px] text-gray-600">score</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Best Posting Hours ───────────────────────────────────────── */}
      <Section title="Best Posting Hours" icon={Clock}>
        <div className="flex items-end gap-px h-28">
          {data.bestPostingHours.map((hour) => {
            const heightPct = (hour.score / maxHourScore) * 100;
            const isTop = hour.score === maxHourScore;

            return (
              <div key={hour.hour} className="flex-1 flex flex-col items-center" title={`${hour.hour}:00 - Score: ${hour.score}`}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPct}%` }}
                  transition={{ duration: 0.5, delay: hour.hour * 0.02 }}
                  className={cn(
                    'w-full rounded-t-sm min-h-[2px]',
                    isTop ? 'bg-neon-cyan' : 'bg-neon-cyan/30'
                  )}
                />
                {hour.hour % 4 === 0 && (
                  <span className="text-[8px] text-gray-600 mt-1">
                    {hour.hour.toString().padStart(2, '0')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-gray-600 text-center mt-2">Hour of day (UTC)</div>
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ── Content Breakdown ──────────────────────────────────────── */}
        <Section title="Content Breakdown" icon={FileText}>
          <div className="space-y-3">
            {data.contentBreakdown.map((item) => {
              const Icon = MEDIA_ICONS[item.mediaType] || FileText;
              const colorClass = MEDIA_COLORS[item.mediaType] || MEDIA_COLORS.document;
              const widthPct = (item.count / maxContentCount) * 100;

              return (
                <div key={item.mediaType} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn('p-1 rounded', colorClass)}>
                        <Icon className="w-3 h-3" />
                      </div>
                      <span className="text-xs text-gray-400 capitalize">{item.mediaType}</span>
                    </div>
                    <span className="text-xs font-medium text-white">{item.count}</span>
                  </div>
                  <div className="h-1.5 bg-lattice-surface rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPct}%` }}
                      transition={{ duration: 0.6 }}
                      className={cn('h-full rounded-full', colorClass.includes('blue') ? 'bg-blue-400/60' : colorClass.includes('green') ? 'bg-green-400/60' : colorClass.includes('purple') ? 'bg-purple-400/60' : colorClass.includes('orange') ? 'bg-orange-400/60' : 'bg-gray-400/60')}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Follower Growth + Earnings ─────────────────────────────── */}
        <div className="space-y-4">
          {/* Follower Growth */}
          <Section title="Follower Growth (30d)" icon={Users}>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-lg font-bold text-green-400">
                  +{formatNumber(data.followerGrowth.gained)}
                </div>
                <div className="text-[10px] text-gray-500">Gained</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-red-400">
                  -{formatNumber(data.followerGrowth.lost)}
                </div>
                <div className="text-[10px] text-gray-500">Lost</div>
              </div>
              <div className="text-center">
                <div className={cn(
                  'text-lg font-bold',
                  data.followerGrowth.net >= 0 ? 'text-neon-cyan' : 'text-red-400'
                )}>
                  {data.followerGrowth.net >= 0 ? '+' : ''}
                  {formatNumber(data.followerGrowth.net)}
                </div>
                <div className="text-[10px] text-gray-500">Net</div>
              </div>
            </div>
          </Section>

          {/* Earnings */}
          <Section title="Earnings" icon={Coins}>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Total Earned</span>
                <span className="text-lg font-bold text-neon-green">
                  {formatNumber(data.earnings.totalCC)} CC
                </span>
              </div>
              <div className="h-px bg-lattice-border" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">This Week</span>
                <span className="text-sm font-medium text-white">
                  {formatNumber(data.earnings.thisWeek)} CC
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">This Month</span>
                <span className="text-sm font-medium text-white">
                  {formatNumber(data.earnings.thisMonth)} CC
                </span>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

export default CreatorAnalytics;
