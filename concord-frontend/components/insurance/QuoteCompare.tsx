'use client';

import { useState } from 'react';
import { DollarSign, Loader2, Search, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Quote {
  carrier: string;
  annualPremium: number;
  deductible: number;
  coverageScore: number;
  rating: number;
  claimsSatisfaction: number;
  highlights: string[];
}

export function QuoteCompare() {
  const [kind, setKind] = useState<'auto' | 'home' | 'renters' | 'life' | 'umbrella'>('auto');
  const [zip, setZip] = useState('');
  const [coverage, setCoverage] = useState<'minimum' | 'standard' | 'premium'>('standard');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);

  async function getQuotes() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'insurance', action: 'quotes-compare',
        input: { kind, zip, coverage },
      });
      setQuotes((res.data?.result?.quotes || []) as Quote[]);
    } catch (e) { console.error('[Quote] failed', e); }
    finally { setLoading(false); }
  }

  const sorted = [...quotes].sort((a, b) => a.annualPremium - b.annualPremium);
  const cheapest = sorted[0]?.annualPremium || 0;
  const mostExpensive = sorted[sorted.length - 1]?.annualPremium || 0;
  const savings = mostExpensive - cheapest;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Quote shopping</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <select value={kind} onChange={e => setKind(e.target.value as 'auto' | 'home' | 'renters' | 'life' | 'umbrella')} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="auto">Auto</option><option value="home">Home</option><option value="renters">Renters</option><option value="life">Life</option><option value="umbrella">Umbrella</option>
        </select>
        <input value={zip} onChange={e => setZip(e.target.value)} placeholder="ZIP code" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={coverage} onChange={e => setCoverage(e.target.value as 'minimum' | 'standard' | 'premium')} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="minimum">Minimum (state min)</option>
          <option value="standard">Standard (100/300/100)</option>
          <option value="premium">Premium (500/500/500)</option>
        </select>
        <button onClick={getQuotes} disabled={loading} className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Compare
        </button>
      </div>
      {savings > 100 && (
        <div className="px-4 py-2 bg-green-500/10 border-b border-green-500/30 text-xs text-green-300">
          Save up to ${savings.toFixed(0)}/yr by switching carriers.
        </div>
      )}
      <ul className="divide-y divide-white/5 max-h-96 overflow-y-auto">
        {loading ? (
          <li className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Polling carriers…</li>
        ) : sorted.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-500">Click Compare to see quotes.</li>
        ) : (
          sorted.map((q, i) => (
            <li key={q.carrier} className={cn('px-3 py-2', i === 0 && 'bg-green-500/5')}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium">{q.carrier}</span>
                {i === 0 && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-bold">best price</span>}
                <span className="ml-auto text-right">
                  <div className="text-lg font-bold text-cyan-300 tabular-nums">${q.annualPremium.toFixed(0)}<span className="text-[10px] text-gray-500">/yr</span></div>
                  <div className="text-[10px] text-gray-500">${q.deductible.toFixed(0)} deductible</div>
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-3">
                <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3 text-yellow-400" /> {q.rating.toFixed(1)}</span>
                <span>Claims sat: {q.claimsSatisfaction}/10</span>
                <span>Coverage score: {q.coverageScore}/100</span>
              </div>
              {q.highlights.length > 0 && (
                <ul className="mt-1 ml-4 list-disc text-[10px] text-gray-400">
                  {q.highlights.slice(0, 3).map((h, hi) => <li key={hi}>{h}</li>)}
                </ul>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default QuoteCompare;
