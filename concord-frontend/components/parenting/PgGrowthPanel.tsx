'use client';

/**
 * PgGrowthPanel — growth logging with WHO-referenced percentile
 * estimates and a weight-history chart.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface GrowthEntry { id: string; weightKg: number | null; heightCm: number | null; headCm: number | null; date: string }
interface Measure { value: number; whoMedian: number; percentile: number }
interface Percentiles {
  ageMonths: number; sex: string; measuredOn: string;
  weight?: Measure; height?: Measure; head?: Measure; note: string;
}

export function PgGrowthPanel({ childId }: { childId: string }) {
  const [history, setHistory] = useState<GrowthEntry[]>([]);
  const [pct, setPct] = useState<Percentiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ weightKg: '', heightCm: '', headCm: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const h = await lensRun('parenting', 'growth-history', { childId });
    setHistory(h.data?.result?.entries || []);
    const p = await lensRun('parenting', 'growth-percentile', { childId });
    setPct(p.data?.ok === false ? null : (p.data?.result as Percentiles));
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const logGrowth = async () => {
    if (!form.weightKg && !form.heightCm && !form.headCm) {
      setError('Enter at least one measurement.'); return;
    }
    const r = await lensRun('parenting', 'growth-log', {
      childId,
      weightKg: Number(form.weightKg) || 0,
      heightCm: Number(form.heightCm) || 0,
      headCm: Number(form.headCm) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ weightKg: '', heightCm: '', headCm: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const weightSeries = history.filter((e) => e.weightKg != null).map((e) => ({ date: e.date.slice(5), weight: e.weightKg }));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Log */}
      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Weight kg" inputMode="decimal" value={form.weightKg}
          onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Height cm" inputMode="decimal" value={form.heightCm}
          onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Head cm" inputMode="decimal" value={form.headCm}
          onChange={(e) => setForm({ ...form, headCm: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={logGrowth}
          className="flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      {/* Percentiles */}
      {pct ? (
        <div>
          <div className="grid grid-cols-3 gap-2">
            <PctCard label="Weight" m={pct.weight} unit="kg" />
            <PctCard label="Height" m={pct.height} unit="cm" />
            <PctCard label="Head" m={pct.head} unit="cm" />
          </div>
          <p className="text-[10px] text-zinc-500 mt-1.5">{pct.note}</p>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 italic">Log a measurement to see WHO percentile estimates.</p>
      )}

      {/* Weight chart */}
      {weightSeries.length > 1 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-rose-400" /> Weight history
          </h3>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={weightSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={28} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
              <Line type="monotone" dataKey="weight" stroke="#fb7185" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function PctCard({ label, m, unit }: { label: string; m?: Measure; unit: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      {m ? (
        <>
          <p className="text-lg font-bold text-rose-300">{m.percentile}th</p>
          <p className="text-[11px] text-zinc-300">{m.value} {unit}</p>
          <p className="text-[10px] text-zinc-500">WHO median {m.whoMedian}</p>
        </>
      ) : (
        <p className="text-xs text-zinc-600 py-2">—</p>
      )}
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}
