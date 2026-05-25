'use client';

import { useCallback, useEffect, useState } from 'react';
import { LineChart, Loader2, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';

interface PriceEntry {
  id: string;
  date: string;
  price: number;
  kind: string;
}
interface HistoryResult {
  listingId: string;
  address: string;
  history: PriceEntry[];
  firstPrice: number;
  lastPrice: number;
  lowestPrice: number;
  highestPrice: number;
  totalChangePct: number;
  pricePerSqft: number | null;
}

const KIND_OPTIONS = ['price_change', 'listed', 'relisted', 'pending', 'sold', 'estimate'] as const;

export function PriceHistoryPanel({ listingId }: { listingId?: string }) {
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ price: '', kind: 'price_change' as string, date: '' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!listingId) { setResult(null); return; }
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'price-history', input: { listingId } });
      if (r.data?.ok) setResult(r.data.result as HistoryResult);
      else setResult(null);
    } catch (e) {
      console.error('[PriceHistory] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addEntry = async () => {
    if (!listingId || !form.price) return;
    setError(null);
    try {
      const input: Record<string, unknown> = { listingId, price: Number(form.price), kind: form.kind };
      if (form.date) input.date = form.date;
      const r = await lensRun({ domain: 'realestate', action: 'price-history-add', input });
      if (r.data?.ok) {
        setForm({ price: '', kind: 'price_change', date: '' });
        setAdding(false);
        await refresh();
      } else {
        setError(r.data?.error || 'Could not add entry.');
      }
    } catch (e) {
      console.error('[PriceHistory] add failed', e);
      setError('Could not add entry.');
    }
  };

  if (!listingId) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-8 text-center text-xs text-gray-400">
        <LineChart className="w-6 h-6 mx-auto mb-2 opacity-30" />
        Select a listing to view its price history time series.
      </div>
    );
  }

  const up = result ? result.totalChangePct >= 0 : true;
  const chartData = (result?.history || []).map((h) => ({ date: h.date, price: h.price }));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LineChart className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Price history</span>
        <span className="ml-auto text-[10px] text-gray-400">Zestimate-style</span>
        <button onClick={() => setAdding((v) => !v)} className="p-1 text-gray-400 hover:text-white" title="Add price event"><Plus className="w-4 h-4" /></button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
          <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={addEntry} className="px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !result || result.history.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-400">No price history yet. Add a price event.</div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Current</div>
              <div className="text-sm font-mono tabular-nums text-white">${result.lastPrice.toLocaleString()}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Total change</div>
              <div className={cn('text-sm font-mono tabular-nums inline-flex items-center gap-1', up ? 'text-emerald-400' : 'text-rose-400')}>
                {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{result.totalChangePct}%
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Low / High</div>
              <div className="text-sm font-mono tabular-nums text-white">${(result.lowestPrice / 1000).toFixed(0)}K–${(result.highestPrice / 1000).toFixed(0)}K</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">$/sqft</div>
              <div className="text-sm font-mono tabular-nums text-white">{result.pricePerSqft ? `$${result.pricePerSqft}` : '—'}</div>
            </div>
          </div>

          <ChartKit kind="area" data={chartData} xKey="date" series={[{ key: 'price', label: 'Price', color: '#06b6d4' }]} height={200} showLegend={false} />

          <ul className="divide-y divide-white/5 rounded border border-white/10 max-h-44 overflow-y-auto">
            {result.history.slice().reverse().map((h) => (
              <li key={h.id} className="px-3 py-1.5 flex items-center gap-3 text-xs">
                <span className="font-mono text-gray-400 w-24">{h.date}</span>
                <span className="flex-1 capitalize text-gray-300">{h.kind.replace('_', ' ')}</span>
                <span className="font-mono tabular-nums text-white">${h.price.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default PriceHistoryPanel;
