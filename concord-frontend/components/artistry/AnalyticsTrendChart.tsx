'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, TrendingUp } from 'lucide-react';

interface AnalyticsSnapshot {
  id: string;
  date: string;
  totalViews: number;
  totalAppreciations: number;
  followerCount: number;
  followingCount: number;
  projectCount: number;
  viewsDelta: number | null;
  appreciationsDelta: number | null;
  followerDelta: number | null;
}
interface AnalyticsHistoryResult {
  snapshots: AnalyticsSnapshot[];
  count: number;
  days: number;
}

// Behance/ArtStation-style creator analytics: a real trend line over the
// SAME totals the stats tiles above already render — server/domains/
// artistry.js's analyticsHistory returns only stored snapshots taken from
// the live profileGet computation (never an estimated/interpolated point),
// so this chart is only ever plotting real history. Below two real points
// there's nothing honest to draw as a trend line yet, so we say so instead
// of rendering an empty or misleadingly-flat chart.
export function AnalyticsTrendChart() {
  const [data, setData] = useState<AnalyticsHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<AnalyticsHistoryResult>('artistry', 'analyticsHistory', { days: 30 });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
    } else {
      setError(r.data?.error || 'Could not load analytics history.');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const chartData = (data?.snapshots || []).map((s) => ({
    date: new Date(`${s.date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    views: s.totalViews,
    appreciations: s.totalAppreciations,
    followers: s.followerCount,
  }));

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-neon-pink" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Analytics trend</span>
        {data && data.count > 0 && (
          <span className="ml-auto text-[10px] text-gray-400">
            {data.count} snapshot{data.count === 1 ? '' : 's'} · last {data.days}d
          </span>
        )}
      </header>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading analytics history…
          </div>
        )}

        {!loading && error && (
          <p className="py-6 text-center text-xs text-red-400">{error}</p>
        )}

        {!loading && !error && data && data.count < 2 && (
          <p className="py-8 text-center text-xs text-gray-400">
            Check back after a few days to see your view trend — a chart needs at least two
            days of activity to plot a line. Your stats above are already live and real.
          </p>
        )}

        {!loading && !error && data && data.count >= 2 && (
          <ChartKit
            kind="line"
            data={chartData}
            xKey="date"
            series={[
              { key: 'views', label: 'Views', color: '#22c55e' },
              { key: 'appreciations', label: 'Appreciations', color: '#ec4899' },
              { key: 'followers', label: 'Followers', color: '#06b6d4' },
            ]}
            height={200}
          />
        )}
      </div>
    </div>
  );
}
