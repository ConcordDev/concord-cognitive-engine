'use client';

/**
 * MhSleepPanel — nightly sleep logging with an hours chart and averages.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Moon, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SleepEntry { id: string; hoursSlept: number; quality: number; bedtime: string | null; wakeTime: string | null; date: string }

export function MhSleepPanel({ onChange }: { onChange: () => void }) {
  const [series, setSeries] = useState<SleepEntry[]>([]);
  const [avgHours, setAvgHours] = useState<number | null>(null);
  const [avgQuality, setAvgQuality] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ hoursSlept: '', quality: '3', bedtime: '', wakeTime: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mental-health', 'sleep-history', { days: 14 });
    setSeries(r.data?.result?.series || []);
    setAvgHours(r.data?.result?.avgHours ?? null);
    setAvgQuality(r.data?.result?.avgQuality ?? null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    if (!(Number(form.hoursSlept) > 0)) { setError('Enter hours slept.'); return; }
    const r = await lensRun('mental-health', 'sleep-log', {
      hoursSlept: Number(form.hoursSlept), quality: Number(form.quality) || 3,
      bedtime: form.bedtime, wakeTime: form.wakeTime,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ hoursSlept: '', quality: '3', bedtime: '', wakeTime: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = series.map((x) => ({ date: x.date.slice(5), hours: x.hoursSlept }));

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {(avgHours != null) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-sky-300">{avgHours}h</p>
            <p className="text-[10px] text-zinc-500 uppercase">Avg sleep (14d)</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-zinc-100">{avgQuality}/5</p>
            <p className="text-[10px] text-zinc-500 uppercase">Avg quality</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Hours" inputMode="decimal" value={form.hoursSlept} onChange={(e) => setForm({ ...form, hoursSlept: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.quality} onChange={(e) => setForm({ ...form, quality: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {[1, 2, 3, 4, 5].map((q) => <option key={q} value={q}>Quality {q}</option>)}
        </select>
        <input placeholder="Bedtime" value={form.bedtime} onChange={(e) => setForm({ ...form, bedtime: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={log}
          className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Moon className="w-3.5 h-3.5 text-sky-400" /> Sleep history
        </h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={24} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="hours" fill="#38bdf8" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-500 italic py-8 text-center">Log your sleep to see the pattern.</p>
        )}
      </div>
    </div>
  );
}
