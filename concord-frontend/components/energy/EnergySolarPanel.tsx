'use client';

/**
 * EnergySolarPanel — log solar production and review offset vs usage.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Sun } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SolarEntry { id: string; kwh: number; date: string; value: number }

export function EnergySolarPanel({ onChange }: { onChange: () => void }) {
  const [series, setSeries] = useState<SolarEntry[]>([]);
  const [summary, setSummary] = useState<{ producedKwh: number; consumedKwh: number; offsetPct: number; savings: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kwh: '', date: new Date().toISOString().slice(0, 10) });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('energy', 'solar-summary', { days: 30 });
    setSeries(r.data?.result?.series || []);
    setSummary(r.data?.ok === false ? null : {
      producedKwh: r.data?.result?.producedKwh || 0,
      consumedKwh: r.data?.result?.consumedKwh || 0,
      offsetPct: r.data?.result?.offsetPct || 0,
      savings: r.data?.result?.savings || 0,
    });
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    if (!(Number(form.kwh) >= 0) || form.kwh === '') { setError('Enter the kWh produced.'); return; }
    const r = await lensRun('energy', 'solar-log', { kwh: Number(form.kwh), date: form.date });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ kwh: '', date: new Date().toISOString().slice(0, 10) });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = series.map((e) => ({ date: e.date.slice(5), kwh: e.kwh }));

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {summary && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-lime-400">{summary.producedKwh}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Produced kWh</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-zinc-100">{summary.consumedKwh}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Consumed kWh</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-amber-400">{summary.offsetPct}%</p>
            <p className="text-[10px] text-zinc-500 uppercase">Offset</p>
          </div>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-emerald-400">${summary.savings}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Saved</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="kWh produced" inputMode="decimal" value={form.kwh} onChange={(e) => setForm({ ...form, kwh: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={log}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Sun className="w-3.5 h-3.5 text-lime-400" /> Solar production
        </h3>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={30} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="kwh" stroke="#facc15" fill="#facc15" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-500 italic py-8 text-center">
            Log solar production over several days to see the curve.
          </p>
        )}
      </div>
    </div>
  );
}
