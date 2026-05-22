'use client';

/**
 * EnergySolarPanel — log solar production and review offset vs usage.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Sun, Home, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SolarEntry { id: string; kwh: number; date: string; value: number }
interface SelfConsumption {
  hasData: boolean;
  producedKwh?: number;
  selfConsumedKwh?: number;
  exportedKwh?: number;
  selfConsumptionPct?: number;
  ratePerKwh?: number;
  exportRate?: number;
  selfConsumptionSavings?: number;
  exportCredit?: number;
  totalSolarValue?: number;
  series?: { date: string; producedKwh: number; selfConsumedKwh: number; exportedKwh: number }[];
}

export function EnergySolarPanel({ onChange }: { onChange: () => void }) {
  const [series, setSeries] = useState<SolarEntry[]>([]);
  const [summary, setSummary] = useState<{ producedKwh: number; consumedKwh: number; offsetPct: number; savings: number } | null>(null);
  const [selfCon, setSelfCon] = useState<SelfConsumption | null>(null);
  const [exportRate, setExportRate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kwh: '', date: new Date().toISOString().slice(0, 10) });

  const refresh = useCallback(async () => {
    setLoading(true);
    const scParams: Record<string, number> = { days: 30 };
    if (Number(exportRate) >= 0 && exportRate !== '') scParams.exportRate = Number(exportRate);
    const [r, sc] = await Promise.all([
      lensRun('energy', 'solar-summary', { days: 30 }),
      lensRun('energy', 'solar-self-consumption', scParams),
    ]);
    setSeries(r.data?.result?.series || []);
    setSummary(r.data?.ok === false ? null : {
      producedKwh: r.data?.result?.producedKwh || 0,
      consumedKwh: r.data?.result?.consumedKwh || 0,
      offsetPct: r.data?.result?.offsetPct || 0,
      savings: r.data?.result?.savings || 0,
    });
    setSelfCon((sc.data?.result as SelfConsumption | null) || null);
    setLoading(false);
    onChange();
  }, [exportRate, onChange]);

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

      {/* Self-consumption vs export */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Home className="w-3.5 h-3.5 text-lime-400" /> Self-consumption vs export
          </h3>
          <label className="flex items-center gap-1 text-[10px] text-zinc-500">
            Export $/kWh
            <input placeholder="rate" inputMode="decimal" value={exportRate} onChange={(e) => setExportRate(e.target.value)}
              className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
          </label>
        </div>
        {!selfCon || !selfCon.hasData ? (
          <p className="text-[11px] text-zinc-500 italic py-6 text-center">
            Log solar production (and matching readings) to see how much you use on-site vs export.
          </p>
        ) : (
          <>
            <div className="h-3 rounded-full bg-zinc-800 overflow-hidden flex">
              <div className="h-full bg-lime-500"
                style={{ width: `${selfCon.selfConsumptionPct ?? 0}%` }} title="self-consumed" />
              <div className="h-full bg-amber-500"
                style={{ width: `${100 - (selfCon.selfConsumptionPct ?? 0)}%` }} title="exported" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                <Home className="w-3 h-3 text-lime-400" />
                {selfCon.selfConsumedKwh} kWh self-used · ${selfCon.selfConsumptionSavings} saved
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-300 justify-end">
                <Upload className="w-3 h-3 text-amber-400" />
                {selfCon.exportedKwh} kWh exported · ${selfCon.exportCredit} credit
              </div>
            </div>
            <p className="text-[11px] text-emerald-400 mt-1.5">
              Total solar value: ${selfCon.totalSolarValue} ({selfCon.selfConsumptionPct}% self-consumed)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
