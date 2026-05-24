'use client';

/**
 * EnergyUsagePanel — log energy readings, view the daily-usage chart
 * and a category breakdown.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Activity } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface DayPoint { date: string; kwh: number; cost: number }
interface BreakdownRow { category: string; kwh: number; pct: number }

export function EnergyUsagePanel({ onChange }: { onChange: () => void }) {
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [totalKwh, setTotalKwh] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [untracked, setUntracked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kwh: '', date: new Date().toISOString().slice(0, 10) });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [h, b] = await Promise.all([
      lensRun('energy', 'reading-history', { days: 30 }),
      lensRun('energy', 'usage-breakdown', { days: 30 }),
    ]);
    setSeries(h.data?.result?.series || []);
    setTotalKwh(h.data?.result?.totalKwh || 0);
    setTotalCost(h.data?.result?.totalCost || 0);
    setBreakdown(b.data?.result?.breakdown || []);
    setUntracked(b.data?.result?.untrackedKwh || 0);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    if (!(Number(form.kwh) > 0)) { setError('Enter a kWh value greater than zero.'); return; }
    const r = await lensRun('energy', 'reading-log', { kwh: Number(form.kwh), date: form.date });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ kwh: '', date: new Date().toISOString().slice(0, 10) });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = series.map((d) => ({ date: d.date.slice(5), kwh: d.kwh }));

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="kWh used" inputMode="decimal" value={form.kwh} onChange={(e) => setForm({ ...form, kwh: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={log}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Activity className="w-3.5 h-3.5 text-lime-400" /> Last 30 days
          </h3>
          <span className="text-[11px] text-zinc-400">{totalKwh} kWh · ${totalCost}</span>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={30} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="kwh" fill="#a3e635" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-zinc-400 italic py-8 text-center">No readings yet. Log usage to see your trend.</p>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Usage by category</h3>
        {breakdown.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Assign readings to devices to see a breakdown.</p>
        ) : (
          <ul className="space-y-1">
            {breakdown.map((b) => (
              <li key={b.category} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-200 capitalize">{b.category.replace(/_/g, ' ')}</span>
                  <span className="text-zinc-400">{b.kwh} kWh · {b.pct}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-lime-500 rounded-full" style={{ width: `${b.pct}%` }} />
                </div>
              </li>
            ))}
            {untracked > 0 && (
              <li className="text-[11px] text-zinc-400 px-3">+ {untracked} kWh untracked (whole-home readings)</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
