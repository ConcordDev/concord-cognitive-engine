'use client';

import { useEffect, useState } from 'react';
import { Scissors, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Candidate {
  id: string;
  symbol: string;
  shares: number;
  costBasis: number;
  price: number;
  unrealisedLoss: number;
  longTerm: boolean;
  heldDays: number;
  washSaleClear: boolean;
}

interface Result {
  candidates: Candidate[];
  totalHarvestableLoss: number;
  estimatedTaxBenefit: number;
}

export function TaxLossHarvester() {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [minLoss, setMinLoss] = useState('100');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'tax-loss-candidates', input: { minLoss: Number(minLoss) || 100 } });
      setResult(res.data?.result || null);
    } catch (e) { console.error('[TaxLoss] load failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Scissors className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Tax-loss harvester</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-gray-400">
          Min loss $
          <input type="number" value={minLoss} onChange={e => setMinLoss(e.target.value)} className="w-16 px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        </span>
        <button onClick={refresh} className="p-1 text-gray-400 hover:text-white" title="Recalculate"><RefreshCw className="w-3.5 h-3.5" /></button>
      </header>

      {result && result.totalHarvestableLoss > 0 && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-rose-300">Harvestable loss</div>
            <div className="text-xl font-mono tabular-nums text-rose-300">-${result.totalHarvestableLoss.toFixed(0)}</div>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300">Est. tax benefit (24%)</div>
            <div className="text-xl font-mono tabular-nums text-emerald-300">+${result.estimatedTaxBenefit.toFixed(0)}</div>
          </div>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !result || result.candidates.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Scissors className="w-6 h-6 mx-auto mb-2 opacity-30" />No harvestable losses. (Add losing positions in Holdings or lower min loss.)</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
              <tr><th className="text-left px-3 py-1.5">Symbol</th><th className="text-right">Shares</th><th className="text-right">Cost</th><th className="text-right">Price</th><th className="text-right">Loss</th><th className="pr-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {result.candidates.map(c => (
                <tr key={c.id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-2 font-mono font-semibold text-white">{c.symbol}</td>
                  <td className="text-right font-mono tabular-nums text-gray-300">{c.shares.toFixed(2)}</td>
                  <td className="text-right font-mono tabular-nums text-gray-300">${c.costBasis.toFixed(2)}</td>
                  <td className="text-right font-mono tabular-nums text-white">${c.price.toFixed(2)}</td>
                  <td className="text-right font-mono tabular-nums text-rose-300">${c.unrealisedLoss.toFixed(0)}</td>
                  <td className="pr-3">
                    <div className="flex items-center gap-1">
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', c.longTerm ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{c.longTerm ? 'LTCG' : 'STCG'}</span>
                      {!c.washSaleClear && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />WASH</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-400">
        Wash-sale rule: re-buying within 30 days disallows the loss claim. Long-term losses offset LTCG first.
      </footer>
    </div>
  );
}

export default TaxLossHarvester;
