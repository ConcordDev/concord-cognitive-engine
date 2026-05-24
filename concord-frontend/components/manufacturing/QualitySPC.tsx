'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

export interface SPCResult {
  product: string;
  measurement: string;
  unit: string;
  upperSpec: number;
  lowerSpec: number;
  upperControl: number;
  lowerControl: number;
  centerLine: number;
  samples: Array<{ at: string; value: number; outOfSpec: boolean; outOfControl: boolean }>;
  cpk: number;
  ppm: number;
  inControl: boolean;
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
      ) : (
        <>
          <div className="p-4 grid grid-cols-4 gap-3 text-center">
            <div className="p-2 bg-white/[0.02] rounded">
              <div className={`text-xl font-bold tabular-nums ${data.cpk >= 1.33 ? 'text-green-300' : data.cpk >= 1.0 ? 'text-cyan-300' : data.cpk >= 0.67 ? 'text-yellow-300' : 'text-red-300'}`}>{data.cpk.toFixed(2)}</div>
              <div className="text-[9px] uppercase text-gray-400">Cpk (≥1.33 capable)</div>
            </div>
            <div className="p-2 bg-white/[0.02] rounded">
              <div className="text-xl font-bold tabular-nums text-white">{data.ppm.toFixed(0)}</div>
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
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">{data.measurement} ({data.unit}) — spec {data.lowerSpec.toFixed(3)}–{data.upperSpec.toFixed(3)}</div>
            <svg viewBox="0 0 400 120" className="w-full h-32 bg-[#0a0e17] border border-white/10 rounded">
              {(() => {
                const margin = 4;
                const w = 400 - 2 * margin;
                const h = 120 - 2 * margin;
                const all = [data.upperSpec, data.lowerSpec, ...data.samples.map(s => s.value)];
                const lo = Math.min(...all) * 0.98;
                const hi = Math.max(...all) * 1.02;
                const y = (v: number) => margin + h - ((v - lo) / (hi - lo)) * h;
                const x = (i: number) => margin + (i / Math.max(1, data.samples.length - 1)) * w;
                return (
                  <>
                    <line x1={margin} x2={margin + w} y1={y(data.upperSpec)} y2={y(data.upperSpec)} stroke="#f87171" strokeDasharray="2 2" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(data.lowerSpec)} y2={y(data.lowerSpec)} stroke="#f87171" strokeDasharray="2 2" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(data.upperControl)} y2={y(data.upperControl)} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(data.lowerControl)} y2={y(data.lowerControl)} stroke="#fbbf24" strokeDasharray="3 3" strokeWidth="0.5" />
                    <line x1={margin} x2={margin + w} y1={y(data.centerLine)} y2={y(data.centerLine)} stroke="#22d3ee" strokeWidth="0.5" />
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
