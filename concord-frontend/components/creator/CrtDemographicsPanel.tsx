'use client';

/**
 * CrtDemographicsPanel — audience demographics. The creator logs real
 * audience segment counts (geography / age / referral / device /
 * acquisition); the panel rolls them up by segment with share %.
 * Every count is real user input — nothing seeded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, PieChart } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface BreakdownRow {
  label: string;
  count: number;
  share: number;
}
interface SegmentData {
  total: number;
  breakdown: BreakdownRow[];
}
interface DemographicsResult {
  segments: Record<string, SegmentData>;
  segmentNames: string[];
}

const SEGMENTS: { id: string; label: string; hint: string }[] = [
  { id: 'geography', label: 'Geography', hint: 'e.g. United States' },
  { id: 'age', label: 'Age', hint: 'e.g. 25-34' },
  { id: 'referral', label: 'Referral', hint: 'e.g. Search' },
  { id: 'device', label: 'Device', hint: 'e.g. Mobile' },
  { id: 'acquisition', label: 'Acquisition', hint: 'e.g. Organic' },
];
const BAR_COLORS = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-cyan-500'];

export function CrtDemographicsPanel() {
  const [data, setData] = useState<DemographicsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ segment: 'geography', label: '', count: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'audience-demographics', {});
    if (r.data?.ok) setData(r.data.result as DemographicsResult);
    else setData(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logEntry = async () => {
    const count = Number(form.count);
    if (!form.label.trim()) { setError('Label is required.'); return; }
    if (!Number.isFinite(count) || count < 0) { setError('Count must be zero or positive.'); return; }
    const r = await lensRun('creator', 'audience-demographic-log', {
      segment: form.segment,
      label: form.label.trim(),
      count,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ ...form, label: '', count: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const segments = data?.segments ?? {};
  const hasAny = Object.values(segments).some((s) => s.breakdown.length > 0);

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Log a demographic segment count. */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <PieChart className="w-3.5 h-3.5 text-red-400" /> Log audience segment
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select
            value={form.segment}
            onChange={(e) => setForm({ ...form, segment: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          >
            {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input
            placeholder={SEGMENTS.find((s) => s.id === form.segment)?.hint ?? 'Label'}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <input
            placeholder="Count"
            inputMode="numeric"
            value={form.count}
            onChange={(e) => setForm({ ...form, count: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <button
            type="button"
            onClick={logEntry}
            className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
      </section>

      {!hasAny ? (
        <p className="text-[11px] text-zinc-500 italic">
          No demographics logged yet. Add real audience segment counts above to see who buys and cites your work.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {SEGMENTS.filter((s) => (segments[s.id]?.breakdown.length ?? 0) > 0).map((s) => {
            const seg = segments[s.id];
            return (
              <div key={s.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-200">{s.label}</h4>
                  <span className="text-[10px] text-zinc-500">{seg.total.toLocaleString()} total</span>
                </div>
                <ul className="space-y-1.5">
                  {seg.breakdown.map((row, i) => (
                    <li key={row.label} className="flex items-center gap-2">
                      <span className="w-24 text-[11px] text-zinc-400 truncate">{row.label}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', BAR_COLORS[i % BAR_COLORS.length])}
                          style={{ width: `${row.share}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-400 w-20 text-right">
                        {row.count.toLocaleString()} ({row.share}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
