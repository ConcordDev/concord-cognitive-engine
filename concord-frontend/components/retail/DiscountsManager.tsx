'use client';

import { useEffect, useState } from 'react';
import { Tag, Plus, Trash2, Loader2, Percent, DollarSign, Truck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Discount {
  id: string; code: string; kind: 'percentage' | 'fixed_amount' | 'free_shipping';
  value: number; minSubtotal: number; usageLimit: number | null; usageCount: number;
  expiresAt: string | null; active: boolean;
}

const KIND_ICON = { percentage: Percent, fixed_amount: DollarSign, free_shipping: Truck };

export function DiscountsManager() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', kind: 'percentage' as Discount['kind'], value: '', minSubtotal: '', usageLimit: '', expiresAt: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'retail', action: 'discounts-list', input: {} });
      setDiscounts((res.data?.result?.discounts || []) as Discount[]);
    } catch (e) { console.error('[Discounts] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.code.trim()) return;
    try {
      await lensRun({
        domain: 'retail', action: 'discounts-create',
        input: {
          code: form.code, kind: form.kind, value: Number(form.value) || 0,
          minSubtotal: Number(form.minSubtotal) || 0,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
          expiresAt: form.expiresAt || undefined,
        },
      });
      setForm({ code: '', kind: 'percentage', value: '', minSubtotal: '', usageLimit: '', expiresAt: '' });
      await refresh();
    } catch (e) { console.error('[Discounts] create failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'retail', action: 'discounts-delete', input: { id } });
      setDiscounts(prev => prev.filter(d => d.id !== id));
    } catch (e) { console.error('[Discounts] delete failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Tag className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Discount codes</span>
        <span className="ml-auto text-[10px] text-gray-400">{discounts.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-7 gap-2">
        <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="CODE" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Discount['kind'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="percentage">% off</option>
          <option value="fixed_amount">$ off</option>
          <option value="free_shipping">Free ship</option>
        </select>
        <input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="Value" disabled={form.kind === 'free_shipping'} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white disabled:opacity-40" />
        <input type="number" value={form.minSubtotal} onChange={e => setForm({ ...form, minSubtotal: e.target.value })} placeholder="Min $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.usageLimit} onChange={e => setForm({ ...form, usageLimit: e.target.value })} placeholder="Usage cap" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : discounts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Tag className="w-6 h-6 mx-auto mb-2 opacity-30" />No discount codes yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {discounts.map(d => {
              const Icon = KIND_ICON[d.kind];
              return (
                <li key={d.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                  <Icon className="w-4 h-4 text-emerald-300" />
                  <span className="font-mono font-bold text-white text-sm tabular-nums">{d.code}</span>
                  <span className="text-xs text-gray-400">
                    {d.kind === 'free_shipping' ? 'Free shipping' : d.kind === 'percentage' ? `${d.value}% off` : `$${d.value} off`}
                    {d.minSubtotal > 0 && <span className="text-gray-400"> · min ${d.minSubtotal}</span>}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400">
                    {d.usageCount}{d.usageLimit ? `/${d.usageLimit}` : ''} uses
                  </span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', d.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{d.active ? 'active' : 'inactive'}</span>
                  <button onClick={() => remove(d.id)} aria-label="Delete discount" className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DiscountsManager;
