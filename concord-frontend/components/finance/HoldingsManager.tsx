'use client';

import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus, Trash2, Loader2, Edit3, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Holding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  costBasis: number;
  price: number;
  value: number;
  assetClass: string;
  sector: string;
  feeCategory: string;
  expenseRatio: number | null;
  dividendYield: number;
  addedAt: string;
}

const ASSET_CLASSES = ['equity_us', 'equity_intl', 'bonds', 'reits', 'cash', 'crypto'];

export function HoldingsManager() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ symbol: '', name: '', shares: '', price: '', assetClass: 'equity_us', sector: 'Tech', dividendYield: '' });
  const [editPrice, setEditPrice] = useState<{ id: string; value: string } | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'holdings-list', input: {} });
      setHoldings((res.data?.result?.holdings || []) as Holding[]);
    } catch (e) { console.error('[Holdings] list failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.symbol.trim() || !form.shares || !form.price) return;
    try {
      await lensRun({
        domain: 'finance', action: 'holdings-add',
        input: {
          symbol: form.symbol.trim(), name: form.name.trim() || form.symbol.trim().toUpperCase(),
          shares: Number(form.shares), price: Number(form.price),
          assetClass: form.assetClass, sector: form.sector,
          dividendYield: Number(form.dividendYield) || 0,
        },
      });
      setForm({ symbol: '', name: '', shares: '', price: '', assetClass: 'equity_us', sector: 'Tech', dividendYield: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Holdings] add failed', e); }
  }

  async function updatePrice(id: string) {
    if (!editPrice) return;
    const v = Number(editPrice.value);
    if (!Number.isFinite(v) || v < 0) return;
    try {
      await lensRun({ domain: 'finance', action: 'holdings-update-price', input: { id, price: v } });
      setEditPrice(null);
      await refresh();
    } catch (e) { console.error('[Holdings] update-price failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'holdings-remove', input: { id } });
      setHoldings(prev => prev.filter(h => h.id !== id));
    } catch (e) { console.error('[Holdings] remove failed', e); }
  }

  const totalValue = useMemo(() => holdings.reduce((s, h) => s + h.value, 0), [holdings]);
  const totalCost = useMemo(() => holdings.reduce((s, h) => s + h.costBasis * h.shares, 0), [holdings]);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Holdings</span>
        <span className="ml-auto text-[10px] font-mono text-gray-400">
          ${totalValue.toFixed(0)} <span className={cn('ml-1', totalGain >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
            {totalGain >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%
          </span>
        </span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-7 gap-2">
          <input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="Sym" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.shares} onChange={e => setForm({ ...form, shares: e.target.value })} placeholder="Shares" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Price" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.assetClass} onChange={e => setForm({ ...form, assetClass: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {ASSET_CLASSES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
          <input type="number" step="0.001" value={form.dividendYield} onChange={e => setForm({ ...form, dividendYield: e.target.value })} placeholder="Div yield (0.03)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.sector} onChange={e => setForm({ ...form, sector: e.target.value })} placeholder="Sector" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : holdings.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Briefcase className="w-6 h-6 mx-auto mb-2 opacity-30" />No holdings. Hit + to add a position.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
              <tr><th scope="col" className="text-left px-3 py-1.5">Symbol</th><th scope="col" className="text-right">Shares</th><th scope="col" className="text-right">Cost</th><th scope="col" className="text-right">Price</th><th scope="col" className="text-right">Value</th><th scope="col" className="text-right pr-3">G/L</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {holdings.map(h => {
                const gain = (h.price - h.costBasis) * h.shares;
                const gainPct = h.costBasis > 0 ? ((h.price - h.costBasis) / h.costBasis) * 100 : 0;
                return (
                  <tr key={h.id} className="hover:bg-white/[0.03] group">
                    <td className="px-3 py-2">
                      <div className="text-white font-mono font-semibold">{h.symbol}</div>
                      <div className="text-[10px] text-gray-400 truncate">{h.name} · {h.sector}</div>
                    </td>
                    <td className="text-right font-mono tabular-nums text-gray-300">{h.shares.toFixed(2)}</td>
                    <td className="text-right font-mono tabular-nums text-gray-300">${h.costBasis.toFixed(2)}</td>
                    <td className="text-right font-mono tabular-nums text-white">
                      {editPrice?.id === h.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="number" value={editPrice.value} onChange={e => setEditPrice({ id: h.id, value: e.target.value })} className="w-16 px-1 py-0.5 text-xs bg-lattice-deep border border-cyan-500/40 rounded text-white" autoFocus />
                          <button aria-label="Confirm" onClick={() => updatePrice(h.id)} className="text-emerald-300"><Check className="w-3 h-3" /></button>
                          <button aria-label="Edit" onClick={() => setEditPrice(null)} className="text-gray-400"><X className="w-3 h-3" /></button>
                        </span>
                      ) : (
                        <button onClick={() => setEditPrice({ id: h.id, value: String(h.price) })} className="hover:text-cyan-300">${h.price.toFixed(2)}<Edit3 className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-100" /></button>
                      )}
                    </td>
                    <td className="text-right font-mono tabular-nums text-white">${h.value.toFixed(0)}</td>
                    <td className={cn('text-right font-mono tabular-nums pr-3', gain >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{gain >= 0 ? '+' : ''}${gain.toFixed(0)} ({gainPct.toFixed(1)}%)</td>
                    <td className="pr-2 text-right">
                      <button aria-label="Delete" onClick={() => remove(h.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default HoldingsManager;
