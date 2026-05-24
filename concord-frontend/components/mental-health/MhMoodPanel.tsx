'use client';

/**
 * MhMoodPanel — daily mood check-ins with a trend chart and insights.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, SmilePlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Mood { id: string; mood: number; energy: number | null; label: string | null; note: string | null; date: string }
interface Insights { entries: number; average: number | null; trend: string; distribution: Record<string, number> }

const MOOD_EMOJI = ['', '😞', '😕', '😐', '🙂', '😄'];
const TREND_COLOR: Record<string, string> = {
  improving: 'text-emerald-400', declining: 'text-rose-400', stable: 'text-zinc-400', no_data: 'text-zinc-400',
};

export function MhMoodPanel({ onChange }: { onChange: () => void }) {
  const [series, setSeries] = useState<Mood[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mood, setMood] = useState(3);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [h, i] = await Promise.all([
      lensRun('mental-health', 'mood-history', { days: 30 }),
      lensRun('mental-health', 'mood-insights', {}),
    ]);
    setSeries(h.data?.result?.series || []);
    setInsights((i.data?.result as Insights | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    const r = await lensRun('mental-health', 'mood-log', { mood, note: note.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setNote(''); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = series.map((m) => ({ date: m.date.slice(5), mood: m.mood }));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Check-in */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <SmilePlus className="w-3.5 h-3.5 text-sky-400" /> How are you feeling?
        </h3>
        <div className="flex justify-between mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setMood(n)}
              className={cn('text-2xl rounded-lg px-2 py-1 transition-transform',
                mood === n ? 'bg-sky-950/60 scale-110' : 'opacity-50 hover:opacity-100')}>
              {MOOD_EMOJI[n]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={log}
            className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Check in</button>
        </div>
      </section>

      {/* Insights */}
      {insights && insights.entries > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{insights.average}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Avg mood</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className={cn('text-lg font-bold capitalize', TREND_COLOR[insights.trend])}>{insights.trend}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Trend</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{insights.entries}</p>
            <p className="text-[10px] text-zinc-400 uppercase">Check-ins</p>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Mood trend (30 days)</h3>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" minTickGap={30} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 9, fill: '#71717a' }} width={20} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Line type="monotone" dataKey="mood" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-400 italic py-8 text-center">Check in for a few days to see your trend.</p>
        )}
      </div>
    </div>
  );
}
