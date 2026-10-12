'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

// Mirrors the REAL handler contract (server/domains/manufacturing.js#spc-chart).
// On the empty path the handler returns only { product, samples:[], source,
// notes } — cpk/ppm/inControl/centerLine are ABSENT, so they are optional here
// and the render guards on `source === 'wired-feed'`.
export interface SPCResult {
  product: string;
  upperSpec?: number;
  lowerSpec?: number;
  upperControl?: number;
  lowerControl?: number;
  centerLine?: number;
  samples: Array<{ at: string; value: number; subgroup?: string | null; outOfSpec?: boolean; outOfControl?: boolean; upperSpec?: number; lowerSpec?: number }>;
  cpk?: number;
  ppm?: number;
  inControl?: boolean;
  source?: string;
  notes?: string;
}

function lensError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error || err?.message || fallback;
}

const fieldCls = 'mt-0.5 w-full min-w-[7rem] px-2 py-1 text-xs bg-[#0a0e17] border border-white/10 rounded text-white placeholder:text-gray-600';

export function QualitySPC() {
  const [data, setData] = useState<SPCResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState('');
  const [value, setValue] = useState('');
  const [subgroup, setSubgroup] = useState('');
  // Bumps on each chart read and each logged sample so a slower chart
  // response cannot overwrite a sample that was just logged.
  const requestGen = useRef(0);

  const load = useCallback(async (name: string): Promise<SPCResult | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'spc-chart', input: { product: trimmed } });
    if (res.data?.ok === false) {
      throw new Error(res.data.error || 'Could not load the SPC chart.');
    }
    return (res.data?.result as SPCResult) || null;
  }, []);

  useEffect(() => {
    const trimmed = product.trim();
    if (!trimmed) return;
    const gen = ++requestGen.current;
    let cancelled = false;
    load(trimmed).then((result) => {
      if (cancelled || gen !== requestGen.current) return;
      setData(result);
      setLoading(false);
    }).catch((e) => {
      if (cancelled || gen !== requestGen.current) return;
      setError(lensError(e, 'Could not load the SPC chart.'));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [product, load]);

  async function logSample(ev: FormEvent) {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: Record<string, unknown> = {
        product: product.trim(),
        value: value.trim(),
      };
      if (subgroup.trim() !== '') input.subgroup = subgroup.trim();
      const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'spc-sample-log', input });
      if (res.data?.ok === false) {
        setError(res.data.error || 'Could not log sample.');
        return;
      }
      setValue('');
      const gen = ++requestGen.current;
      const chart = await load(product);
      if (gen === requestGen.current) {
        setData(chart);
        setLoading(false);
      }
    } catch (e) {
      setError(lensError(e, 'Could not log sample.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">SPC chart</span>
      </header>
      <form onSubmit={logSample} className="px-3 py-2 border-b border-white/5 flex flex-wrap items-end gap-2">
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Product
          <input
            value={product}
            onChange={(e) => {
              const next = e.target.value;
              setProduct(next);
              setError(null);
              if (next.trim()) setLoading(true);
            }}
            required
            className={fieldCls}
          />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Value
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Subgroup
          <input value={subgroup} onChange={(e) => setSubgroup(e.target.value)} className={fieldCls} />
        </label>
        <button type="submit" disabled={saving} className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {saving ? 'Logging…' : 'Log sample'}
        </button>
      </form>
      {error && <p role="alert" className="px-3 py-1.5 text-[11px] text-red-300">{error}</p>}
      {!product.trim() ? (
        <p className="px-4 py-6 text-center text-xs text-gray-400">Enter a product, then log gauge readings. The chart uses those samples.</p>
      ) : loading || (data != null && data.product !== product.trim()) ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !data || data.source !== 'wired-feed' || data.cpk == null || data.samples.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">
          <p>No SPC samples for <span className="text-cyan-300 font-mono">{data?.product || product.trim()}</span> yet.</p>
          {data?.notes && <p className="mt-1 text-[10px] text-gray-500">{data.notes}</p>}
        </div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-2 bg-white/[0.02] rounded">
              <div className={`text-xl font-bold tabular-nums ${data.cpk >= 1.33 ? 'text-green-300' : data.cpk >= 1.0 ? 'text-cyan-300' : data.cpk >= 0.67 ? 'text-yellow-300' : 'text-red-300'}`}>{data.cpk.toFixed(2)}</div>
              <div className="text-[9px] uppercase text-gray-400">Cpk (≥1.33 capable)</div>
            </div>
            <div className="p-2 bg-white/[0.02] rounded">
              <div className="text-xl font-bold tabular-nums text-white">{(data.ppm ?? 0).toFixed(0)}</div>
              <div className="text-[9px] uppercase text-gray-400">PPM defective</div>
            </div>
            <div className="p-2 bg-white/[0.02] rounded">
              <div className={`text-xl font-bold tabular-nums ${data.inControl ? 'text-green-300' : 'text-red-300'}`}>{data.inControl ? '✓' : '✗'}</div>
              <div className="text-[9px] uppercase text-gray-400">In control</div>
            </div>
            <div className="p-2 bg-white/[0.02] rounded">
              <div className="text-xl font-bold tabular-nums text-cyan-300">{data.samples.length}</div>
              <div className="text-[9px] uppercase text-gray-400">Samples</div>
            </div>
          </div>
          <div className="px-4 pb-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">{data.product} — spec {(data.lowerSpec ?? 0).toFixed(3)}–{(data.upperSpec ?? 0).toFixed(3)}</div>
            <svg viewBox="0 0 400 120" className="w-full h-32 bg-[#0a0e17] border border-white/10 rounded">
              {(() => {
                const margin = 4;
                const w = 400 - 2 * margin;
                const h = 120 - 2 * margin;
                const upperSpec = data.upperSpec ?? 0, lowerSpec = data.lowerSpec ?? 0;
                const upperControl = data.upperControl ?? upperSpec, lowerControl = data.lowerControl ?? lowerSpec;
                const centerLine = data.centerLine ?? (upperSpec + lowerSpec) / 2;
                const all = [upperSpec, lowerSpec, ...data.samples.map(s => s.value)];
                const lo = Math.min(...all) * 0.98;
                const hi = Math.max(...all) * 1.02;
                const y = (v: number) => margin + h - ((v - lo) / (hi - lo || 1)) * h;
                const x = (i: number) => margin + (i / Math.max(1, data.samples.length - 1)) * w;
                return (
                  <>
                    <line x1={margin} x2={margin + w} y1={y(upperSpec)} y2={y(upperSpec)} stroke="#f87171" strokeDasharray="2 2" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(lowerSpec)} y2={y(lowerSpec)} stroke="#f87171" strokeDasharray="2 2" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(upperControl)} y2={y(upperControl)} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(lowerControl)} y2={y(lowerControl)} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(centerLine)} y2={y(centerLine)} stroke="#22d3ee" strokeWidth="0.5" />
                    <polyline points={data.samples.map((s, i) => `${x(i)},${y(s.value)}`).join(' ')} stroke="#22d3ee" strokeWidth="0.8" fill="none" />
                    {data.samples.map((s, i) => (
                      <circle key={i} cx={x(i)} cy={y(s.value)} r={1.2} fill={s.outOfSpec ? '#f87171' : s.outOfControl ? '#fbbf24' : '#22d3ee'} />
                    ))}
                  </>
                );
              })()}
            </svg>
            <div className="text-[9px] text-gray-400 mt-1 flex items-center gap-3">
              <span><span className="inline-block w-3 h-0.5 align-middle bg-red-400" /> spec limits</span>
              <span><span className="inline-block w-3 h-0.5 align-middle bg-yellow-400" /> control limits (3σ)</span>
              <span><span className="inline-block w-3 h-0.5 align-middle bg-cyan-400" /> centerline / data</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
export default QualitySPC;
