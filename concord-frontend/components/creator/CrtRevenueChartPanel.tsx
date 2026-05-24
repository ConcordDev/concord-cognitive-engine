'use client';

/**
 * CrtRevenueChartPanel — time-series revenue charts. Buckets logged
 * revenue into day / week / month series via the creator.revenue-timeseries
 * macro and charts it with ChartKit. Every value is computed from real
 * logged revenue — nothing seeded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, LineChart } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

type Bucket = 'day' | 'week' | 'month';

interface SeriesRow {
  period: string;
  total: number;
  bySource: Record<string, number>;
}
interface TimeseriesResult {
  bucket: Bucket;
  days: number;
  series: SeriesRow[];
  count: number;
  grandTotal: number;
}

const BUCKETS: { id: Bucket; label: string; days: number }[] = [
  { id: 'day', label: 'Daily', days: 90 },
  { id: 'week', label: 'Weekly', days: 365 },
  { id: 'month', label: 'Monthly', days: 730 },
];
const SOURCES = ['ad_revenue', 'sponsorship', 'memberships', 'merch', 'tips', 'affiliate', 'other'];

export function CrtRevenueChartPanel() {
  const [bucket, setBucket] = useState<Bucket>('month');
  const [breakdown, setBreakdown] = useState(false);
  const [data, setData] = useState<TimeseriesResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const cfg = BUCKETS.find((b) => b.id === bucket);
    const r = await lensRun('creator', 'revenue-timeseries', {
      bucket,
      days: cfg?.days ?? 365,
    });
    if (r.data?.ok) setData(r.data.result as TimeseriesResult);
    else setData(null);
    setLoading(false);
  }, [bucket]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Flatten bySource into top-level keys for stacked chart rendering.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((row) => {
      const flat: Record<string, unknown> = { period: row.period, total: row.total };
      for (const src of SOURCES) flat[src] = row.bySource[src] ?? 0;
      return flat;
    });
  }, [data]);

  const activeSources = useMemo(() => {
    if (!data) return [];
    return SOURCES.filter((s) => data.series.some((row) => (row.bySource[s] ?? 0) > 0));
  }, [data]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const hasData = !!data && data.series.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <LineChart className="w-3.5 h-3.5 text-red-400" /> Earnings over time
        </h3>
        <div className="flex items-center gap-2">
          {hasData && (
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={breakdown} onChange={(e) => setBreakdown(e.target.checked)} />
              By source
            </label>
          )}
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
            {BUCKETS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBucket(b.id)}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-medium',
                  bucket === b.id ? 'bg-red-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!hasData ? (
        <p className="text-[11px] text-zinc-400 italic py-8 text-center">
          No revenue logged yet. Log earnings in the Revenue tab to see them charted here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label={`${BUCKETS.find((b) => b.id === bucket)?.label} total`} value={`$${data!.grandTotal.toLocaleString()}`} />
            <Stat label="Periods" value={data!.count} />
            <Stat
              label="Avg / period"
              value={`$${(data!.count > 0 ? data!.grandTotal / data!.count : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            />
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <ChartKit
              kind={breakdown ? 'bar' : 'area'}
              data={chartData}
              xKey="period"
              stacked={breakdown}
              series={
                breakdown
                  ? activeSources.map((s) => ({ key: s, label: s.replace(/_/g, ' ') }))
                  : [{ key: 'total', label: 'Total revenue', color: '#22c55e' }]
              }
              height={260}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="text-xl font-bold text-emerald-300">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase">{label}</p>
    </div>
  );
}
