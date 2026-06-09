'use client';

/**
 * FashionClosetPanel — wardrobe item grid with add, wear logging,
 * category filter and cost-per-wear value ratings.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Repeat, Scissors } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Item {
  id: string; name: string; category: string; brand: string | null; color: string | null;
  season: string; cost: number; timesWorn: number; costPerWear: number | null; valueRating: string;
  photo: string | null; bgRemoved?: boolean; bgRemovalMode?: string;
}

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'bag', 'activewear'];
const VALUE_COLOR: Record<string, string> = {
  excellent: 'text-emerald-400', good: 'text-sky-400', moderate: 'text-amber-400',
  poor: 'text-rose-400', unworn: 'text-zinc-400',
};

export function FashionClosetPanel({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'top', brand: '', color: '', cost: '', photo: '' });
  const [bgBusy, setBgBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fashion', 'item-list', filter ? { category: filter } : {});
    setItems(r.data?.result?.items || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) { setError('Item name is required.'); return; }
    const r = await lensRun('fashion', 'item-add', {
      name: form.name.trim(), category: form.category, brand: form.brand.trim(),
      color: form.color.trim(), cost: Number(form.cost) || 0, photo: form.photo.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', category: 'top', brand: '', color: '', cost: '', photo: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const wear = async (id: string) => { await lensRun('fashion', 'item-wear', { id }); await refresh(); onChange(); };
  const del = async (id: string) => { await lensRun('fashion', 'item-delete', { id }); await refresh(); onChange(); };
  const removeBg = async (id: string) => {
    setBgBusy(id); setError(null);
    const r = await lensRun('fashion', 'item-remove-bg', { id });
    setBgBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Background removal failed'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setFilter('')}
            className={cn('text-[11px] px-2 py-0.5 rounded-full border', filter === '' ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setFilter(c)}
              className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize', filter === c ? 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300' : 'border-zinc-700 text-zinc-400')}>
              {c}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Cost ($)" inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Photo URL (optional)" value={form.photo} onChange={(e) => setForm({ ...form, photo: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add to closet</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No items. Add pieces to build your digital closet.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {items.map((i) => (
            <li key={i.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              {i.photo && (
                <div className={cn('mb-2 rounded-lg overflow-hidden flex items-center justify-center h-28',
                  i.bgRemoved
                    ? 'bg-[conic-gradient(at_50%_50%,#27272a_25%,#18181b_0_50%,#27272a_0_75%,#18181b_0)] bg-[length:16px_16px]'
                    : i.bgRemovalMode === 'css-mask'
                      ? 'bg-zinc-100 [mask-image:radial-gradient(ellipse_70%_85%_at_center,#000_60%,transparent_100%)]'
                      : 'bg-zinc-950')}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- external arbitrary image host */}
                  <img src={i.photo} alt={i.name} className="max-h-28 object-contain" />
                </div>
              )}
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{i.name}</p>
                  <p className="text-[10px] text-zinc-400 capitalize">
                    {i.category}{i.brand ? ` · ${i.brand}` : ''}{i.color ? ` · ${i.color}` : ''}
                  </p>
                </div>
                <button aria-label="Delete" type="button" onClick={() => del(i.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {i.photo && !i.bgRemoved && (
                <button type="button" onClick={() => removeBg(i.id)} disabled={bgBusy === i.id}
                  className="flex items-center gap-1 mt-2 px-2 py-0.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-50">
                  {bgBusy === i.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                  {i.bgRemovalMode === 'css-mask' ? 'Re-cut background' : 'Remove background'}
                </button>
              )}
              {i.bgRemoved && (
                <span className="inline-block mt-2 text-[10px] text-emerald-400">Flat-lay cutout applied</span>
              )}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-zinc-400">
                  worn {i.timesWorn}× ·{' '}
                  <span className={VALUE_COLOR[i.valueRating]}>
                    {i.costPerWear != null ? `$${i.costPerWear}/wear` : 'unworn'}
                  </span>
                </span>
                <button type="button" onClick={() => wear(i.id)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
                  <Repeat className="w-3 h-3" /> Wear
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
