'use client';

import { useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AVMResult {
  estimate: number;
  lowEstimate: number;
  highEstimate: number;
  confidenceErrorPct: number;
  pricePerSqft: number;
  rentEstimate: number;
  factors: { conditionMult: number; ageDepreciation: number; bedBathBoost: number; lotPremium: number };
}

export function AVMEstimator() {
  const [form, setForm] = useState({ sqft: '2000', beds: '3', baths: '2', yearBuilt: '2010', lotSqft: '7000', zipMedianPpsf: '280', condition: 'good' as 'excellent' | 'good' | 'fair' | 'poor' });
  const [result, setResult] = useState<AVMResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function estimate() {
    if (!form.sqft) return;
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'realestate', action: 'avm-estimate',
        input: { sqft: Number(form.sqft), beds: Number(form.beds), baths: Number(form.baths), yearBuilt: Number(form.yearBuilt), lotSqft: Number(form.lotSqft), zipMedianPpsf: Number(form.zipMedianPpsf), condition: form.condition },
      });
      setResult((res.data?.result as AVMResult) || null);
    } catch (e) { console.error('[AVM] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Home value estimator (AVM)</span>
        <span className="ml-auto text-[10px] text-gray-500">Zestimate-shape</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <label className="space-y-1"><span className="text-gray-400">Sqft</span><input type="number" value={form.sqft} onChange={e => setForm({ ...form, sqft: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1"><span className="text-gray-400">Beds</span><input type="number" value={form.beds} onChange={e => setForm({ ...form, beds: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1"><span className="text-gray-400">Baths</span><input type="number" value={form.baths} onChange={e => setForm({ ...form, baths: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1"><span className="text-gray-400">Year built</span><input type="number" value={form.yearBuilt} onChange={e => setForm({ ...form, yearBuilt: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1"><span className="text-gray-400">Lot sqft</span><input type="number" value={form.lotSqft} onChange={e => setForm({ ...form, lotSqft: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1"><span className="text-gray-400">Zip $/sqft</span><input type="number" value={form.zipMedianPpsf} onChange={e => setForm({ ...form, zipMedianPpsf: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="space-y-1 col-span-2"><span className="text-gray-400">Condition</span>
          <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as typeof form.condition })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option>
          </select>
        </label>
        <button onClick={estimate} disabled={loading} className="col-span-4 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />} Estimate value
        </button>
      </div>

      {result && (
        <div className="p-4 space-y-3">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Estimated value</div>
            <div className="text-4xl font-mono font-semibold text-cyan-300 tabular-nums">${result.estimate.toLocaleString()}</div>
            <div className="text-[11px] text-gray-400 mt-1">
              Range: <span className="text-gray-200">${result.lowEstimate.toLocaleString()}</span> – <span className="text-gray-200">${result.highEstimate.toLocaleString()}</span>
              <span className="text-gray-500"> · ±{Math.round(result.confidenceErrorPct * 100)}%</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">$/sqft</div>
              <div className="text-lg font-mono tabular-nums text-white">${result.pricePerSqft}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Rent estimate</div>
              <div className="text-lg font-mono tabular-nums text-white">${result.rentEstimate.toLocaleString()}/mo</div>
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-2.5 text-[11px] grid grid-cols-2 gap-1.5">
            <FactorRow label="Condition" value={`×${result.factors.conditionMult.toFixed(2)}`} />
            <FactorRow label="Age" value={`×${result.factors.ageDepreciation.toFixed(2)}`} />
            <FactorRow label="Bed/bath" value={`×${result.factors.bedBathBoost.toFixed(2)}`} />
            <FactorRow label="Lot premium" value={`+${(result.factors.lotPremium * 100).toFixed(1)}%`} />
          </div>
        </div>
      )}
    </div>
  );
}

function FactorRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-gray-500">{label}</span><span className={cn('font-mono tabular-nums text-cyan-300')}>{value}</span></div>;
}

export default AVMEstimator;
