'use client';

/**
 * CrtPerformancePanel — per-artifact content performance. Shows views,
 * clicks, conversions, citations and revenue per content item, with
 * derived click / conversion / citation rates. Counters are moved by
 * real input via the creator.content-track macro — nothing seeded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Gauge, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface PerfRow {
  id: string;
  title: string;
  format: string;
  stage: string;
  platform: string | null;
  publishedAt: string | null;
  views: number;
  clicks: number;
  conversions: number;
  citations: number;
  revenue: number;
  clickRate: number;
  conversionRate: number;
  citationRate: number;
  revenuePerView: number;
}
interface PerfResult {
  rows: PerfRow[];
  count: number;
  totals: {
    views: number;
    clicks: number;
    conversions: number;
    citations: number;
    revenue: number;
  };
}

const METRICS: { id: 'views' | 'clicks' | 'conversions' | 'citations' | 'revenue'; label: string }[] = [
  { id: 'views', label: 'Views' },
  { id: 'clicks', label: 'Clicks' },
  { id: 'conversions', label: 'Conversions' },
  { id: 'citations', label: 'Citations' },
  { id: 'revenue', label: 'Revenue' },
];

export function CrtPerformancePanel() {
  const [result, setResult] = useState<PerfResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackForm, setTrackForm] = useState<{ id: string; metric: string; delta: string }>({
    id: '',
    metric: 'views',
    delta: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'content-performance', {});
    if (r.data?.ok) setResult(r.data.result as PerfResult);
    else setResult(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const track = async () => {
    const delta = Number(trackForm.delta);
    if (!trackForm.id) { setError('Select a content item.'); return; }
    if (!Number.isFinite(delta) || delta === 0) { setError('Enter a non-zero delta.'); return; }
    const r = await lensRun('creator', 'content-track', {
      id: trackForm.id,
      metric: trackForm.metric,
      delta,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setTrackForm({ ...trackForm, delta: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const rows = result?.rows ?? [];

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {result && rows.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <Stat label="Views" value={result.totals.views.toLocaleString()} />
          <Stat label="Clicks" value={result.totals.clicks.toLocaleString()} />
          <Stat label="Conversions" value={result.totals.conversions.toLocaleString()} />
          <Stat label="Citations" value={result.totals.citations.toLocaleString()} />
          <Stat label="Revenue" value={`$${result.totals.revenue.toLocaleString()}`} />
        </div>
      )}

      {/* Record real platform metrics against a content item. */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-red-400" /> Record performance
        </h3>
        {rows.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">
            Add content in the Pipeline tab first — then record its real platform metrics here.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select
              value={trackForm.id}
              onChange={(e) => setTrackForm({ ...trackForm, id: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            >
              <option value="">Select content…</option>
              {rows.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <select
              value={trackForm.metric}
              onChange={(e) => setTrackForm({ ...trackForm, metric: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            >
              {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <input
              placeholder="Delta (e.g. 1200)"
              inputMode="decimal"
              value={trackForm.delta}
              onChange={(e) => setTrackForm({ ...trackForm, delta: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
            />
            <button
              type="button"
              onClick={track}
              className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg"
            >
              <Gauge className="w-3.5 h-3.5" /> Record
            </button>
          </div>
        )}
      </section>

      {/* Per-artifact analytics table. */}
      {rows.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No content performance data yet.</p>
      ) : (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-400 uppercase tracking-wide text-[10px]">
              <tr className="border-b border-zinc-800">
                <th className="text-left px-3 py-2">Artifact</th>
                <th className="text-right px-2 py-2">Views</th>
                <th className="text-right px-2 py-2">CTR</th>
                <th className="text-right px-2 py-2">Conv.</th>
                <th className="text-right px-2 py-2">Cite</th>
                <th className="text-right px-3 py-2">Rev/view</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-800/60 last:border-0">
                  <td className="px-3 py-2">
                    <p className="text-zinc-100 truncate max-w-[180px]">{r.title}</p>
                    <p className="text-[10px] text-zinc-400 capitalize">{r.format}{r.platform && ` · ${r.platform}`}</p>
                  </td>
                  <td className="text-right px-2 py-2 text-zinc-300">{r.views.toLocaleString()}</td>
                  <td className="text-right px-2 py-2 text-sky-300">{r.clickRate}%</td>
                  <td className="text-right px-2 py-2 text-amber-300">{r.conversionRate}%</td>
                  <td className="text-right px-2 py-2 text-violet-300">{r.citationRate}%</td>
                  <td className="text-right px-3 py-2 text-emerald-300">${r.revenuePerView}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase">{label}</p>
    </div>
  );
}
