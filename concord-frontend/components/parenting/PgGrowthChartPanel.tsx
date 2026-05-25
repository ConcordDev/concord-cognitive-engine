'use client';

/**
 * PgGrowthChartPanel — plots the child's logged measurements against WHO
 * percentile bands (3rd / 15th / 50th / 85th / 97th).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Loader2, LineChart as LineChartIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Metric = 'weight' | 'height' | 'head';

interface CurvePoint {
  ageMonths: number;
  p3: number; p15: number; p50: number; p85: number; p97: number;
}
interface Measurement { ageMonths: number; value: number; date: string; percentile: number }
interface ChartData {
  metric: Metric;
  sex: string;
  unit: string;
  curve: CurvePoint[];
  measurements: Measurement[];
  note: string;
}

const METRICS: { id: Metric; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'height', label: 'Height' },
  { id: 'head', label: 'Head' },
];

export function PgGrowthChartPanel({ childId }: { childId: string }) {
  const [metric, setMetric] = useState<Metric>('weight');
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'growth-chart', { childId, metric });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to load chart'); setData(null); }
    else { setData(r.data?.result as ChartData); setError(null); }
    setLoading(false);
  }, [childId, metric]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (error || !data) {
    return <p className="text-[11px] text-zinc-400 italic py-6 text-center">{error || 'No chart data.'}</p>;
  }

  // Merge curve + measurements into one keyed dataset for the composed chart.
  const merged = data.curve.map((c) => {
    const m = data.measurements.find((x) => Math.abs(x.ageMonths - c.ageMonths) < 0.6);
    return { ...c, measured: m ? m.value : undefined };
  });
  // Make sure off-grid measurements still render.
  for (const m of data.measurements) {
    if (!merged.some((p) => Math.abs(p.ageMonths - m.ageMonths) < 0.6)) {
      merged.push({ ageMonths: m.ageMonths, p3: 0, p15: 0, p50: 0, p85: 0, p97: 0, measured: m.value });
    }
  }
  merged.sort((a, b) => a.ageMonths - b.ageMonths);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <LineChartIcon className="w-3.5 h-3.5 text-rose-400" /> WHO percentile chart
        </h3>
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button key={m.id} type="button" onClick={() => setMetric(m.id)}
              className={`px-2 py-1 text-[11px] rounded-lg ${metric === m.id ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {data.measurements.length === 0 && (
        <p className="text-[11px] text-zinc-400 italic">No measurements logged yet — the bands below are the WHO reference curves.</p>
      )}

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={merged}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="ageMonths" tick={{ fontSize: 9, fill: '#71717a' }}
              label={{ value: 'Age (months)', position: 'insideBottom', offset: -2, fontSize: 9, fill: '#71717a' }} />
            <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={32}
              label={{ value: data.unit, angle: -90, position: 'insideLeft', fontSize: 9, fill: '#71717a' }} />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            <Line type="monotone" dataKey="p3" name="3rd" stroke="#3f3f46" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="p15" name="15th" stroke="#52525b" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="p50" name="50th" stroke="#a1a1aa" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="p85" name="85th" stroke="#52525b" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="p97" name="97th" stroke="#3f3f46" strokeWidth={1} dot={false} />
            <Scatter dataKey="measured" name="This child" fill="#fb7185" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {data.measurements.length > 0 && (
        <ul className="space-y-1">
          {data.measurements.slice(-5).reverse().map((m) => (
            <li key={m.date} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
              <span className="text-[11px] text-zinc-400">{m.date} · {m.ageMonths}mo</span>
              <span className="text-xs text-zinc-200">{m.value} {data.unit} · <span className="text-rose-300">{m.percentile}th pct</span></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-zinc-400">{data.note}</p>
    </div>
  );
}
