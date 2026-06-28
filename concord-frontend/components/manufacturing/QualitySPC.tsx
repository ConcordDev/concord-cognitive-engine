'use client';

import { useEffect, useState } from 'react';
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
  samples: Array<{ at: string; value: number; outOfSpec?: boolean; outOfControl?: boolean; upperSpec?: number; lowerSpec?: number }>;
  cpk?: number;
  ppm?: number;
  inControl?: boolean;
  source?: string;
  notes?: string;
}

export function QualitySPC() {
  const [data, setData] = useState<SPCResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState('Widget-001');

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'spc-chart', input: { product } });
        setData(res.data?.result as SPCResult || null);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [product]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">SPC chart</span>
        <select value={product} onChange={e => setProduct(e.target.value)} className="ml-auto px-2 py-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {['Widget-001', 'Widget-002', 'Tube-A', 'Plate-X', 'Bracket-12'].map(p => <option key={p}>{p}</option>)}
        </select>
      </header>
      {loading || !data ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (data.source !== 'wired-feed' || data.cpk == null || data.samples.length === 0) ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">
          <p>No SPC samples for <span className="text-cyan-300 font-mono">{data.product}</span> yet.</p>
          {data.notes && <p className="mt-1 text-[10px] text-gray-500">{data.notes}</p>}
        </div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-4 gap-3 text-center">
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
