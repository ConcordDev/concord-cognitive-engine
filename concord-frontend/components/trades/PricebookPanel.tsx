'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Plus, Loader2, Trash2, Pencil } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PriceItem {
  id: string;
  name: string;
  kind: 'service' | 'material';
  price: number;
  cost: number;
  unit: string;
  category: string;
  marginPct: number;
}

const EMPTY = { id: '', name: '', kind: 'service' as const, price: '', cost: '', unit: 'ea', category: 'general' };

export function PricebookPanel() {
  const [items, setItems] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | 'service' | 'material'>('');
  const [draft, setDraft] = useState<{ id: string; name: string; kind: 'service' | 'material'; price: string; cost: string; unit: string; category: string }>(EMPTY);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ items: PriceItem[] }>('trades', 'pricebook-list', filter ? { kind: filter } : {});
      if (r.data?.ok && r.data.result) setItems(r.data.result.items);
    } catch (e) { console.error('[Pricebook] list failed', e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  async function save() {
    if (!draft.name.trim() || draft.price === '') return;
    try {
      const r = await lensRun('trades', 'pricebook-upsert', {
        id: draft.id || undefined, name: draft.name, kind: draft.kind,
        price: Number(draft.price), cost: Number(draft.cost) || 0, unit: draft.unit, category: draft.category,
      });
      if (r.data?.ok) { setDraft(EMPTY); setShowForm(false); await refresh(); }
    } catch (e) { console.error('[Pricebook] save failed', e); }
  }

  async function remove(id: string) {
    try {
      const r = await lensRun('trades', 'pricebook-delete', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Pricebook] delete failed', e); }
  }

  function editItem(it: PriceItem) {
    setDraft({ id: it.id, name: it.name, kind: it.kind, price: String(it.price), cost: String(it.cost), unit: it.unit, category: it.category });
    setShowForm(true);
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pricebook</span>
        <div className="ml-auto flex items-center gap-1">
          {(['', 'service', 'material'] as const).map(f => (
            <button key={f || 'all'} onClick={() => setFilter(f)} className={cn('px-2 py-0.5 text-[10px] rounded', filter === f ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30' : 'text-gray-500 border border-transparent hover:text-gray-300')}>
              {f || 'all'}
            </button>
          ))}
        </div>
      </header>

      <div className="p-3 border-b border-white/10">
        <button onClick={() => { setDraft(EMPTY); setShowForm(v => !v); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-violet-500/30 bg-violet-500/10 text-xs text-violet-200">
          <Plus className="w-3 h-3" /> New catalog item
        </button>
        {showForm && (
          <div className="mt-2 rounded border border-violet-500/30 bg-violet-500/5 p-3 grid grid-cols-6 gap-2">
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" className="col-span-3 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
            <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as 'service' | 'material' }))} className="col-span-1 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              <option value="service">Service</option><option value="material">Material</option>
            </select>
            <input value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} placeholder="Unit" className="col-span-1 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
            <input value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} placeholder="Category" className="col-span-1 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
            <input type="number" value={draft.cost} onChange={e => setDraft(d => ({ ...d, cost: e.target.value }))} placeholder="Cost $" step="0.01" className="col-span-3 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <input type="number" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} placeholder="Price $" step="0.01" className="col-span-3 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <button onClick={save} disabled={!draft.name.trim() || draft.price === ''} className="col-span-6 px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100 disabled:opacity-40">
              {draft.id ? 'Update item' : 'Add to pricebook'}
            </button>
          </div>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><BookOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />No pricebook items yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-white/[0.02]">
              <tr className="text-[9px] uppercase text-gray-600">
                <th className="text-left px-3 py-1.5">Item</th>
                <th className="text-left px-2 py-1.5">Kind</th>
                <th className="text-right px-2 py-1.5">Cost</th>
                <th className="text-right px-2 py-1.5">Price</th>
                <th className="text-right px-2 py-1.5">Margin</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map(it => (
                <tr key={it.id} className="hover:bg-white/[0.02] group">
                  <td className="px-3 py-1.5">
                    <div className="text-white">{it.name}</div>
                    <div className="text-[9px] text-gray-600">{it.category} · per {it.unit}</div>
                  </td>
                  <td className="px-2 py-1.5"><span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', it.kind === 'service' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-500/15 text-amber-300')}>{it.kind}</span></td>
                  <td className="px-2 py-1.5 text-right font-mono text-gray-400">${it.cost.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-violet-300">${it.price.toFixed(2)}</td>
                  <td className={cn('px-2 py-1.5 text-right font-mono', it.marginPct >= 30 ? 'text-emerald-300' : it.marginPct >= 0 ? 'text-amber-300' : 'text-rose-300')}>{it.marginPct.toFixed(1)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => editItem(it)} className="p-1 text-gray-600 hover:text-violet-300 opacity-0 group-hover:opacity-100" aria-label="Edit"><Pencil className="w-3 h-3" /></button>
                    <button onClick={() => remove(it.id)} className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100" aria-label="Delete"><Trash2 className="w-3 h-3" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default PricebookPanel;
