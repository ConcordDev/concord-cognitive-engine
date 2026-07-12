'use client';

/**
 * FashionWishlistPanel — save desired external items (name/price/link/note)
 * and convert them into a real closet item once bought. Backed by real,
 * persistent fashion.wishlist-* macros (STATE.fashionLens.wishlist, the
 * same per-user Map shape as items/outfits/capsules) — not client-side
 * useState. See docs/lens-specs/fashion-capability-map.md checklist #14.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Heart, Trash2, ExternalLink, ShoppingBag, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface WishlistEntry {
  id: string;
  name: string;
  price: number | null;
  link: string | null;
  note: string | null;
  category: string | null;
  createdAt: string;
}

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'bag', 'activewear'];

export function FashionWishlistPanel({ onChange }: { onChange?: () => void }) {
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', link: '', note: '', category: '' });
  const [convertForm, setConvertForm] = useState<{ id: string; category: string; cost: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fashion', 'wishlist-list', {});
    setEntries((r.data?.result?.wishlist as WishlistEntry[]) || []);
    setTotalValue((r.data?.result?.totalValue as number) || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) { setError('Item name is required.'); return; }
    if (form.price.trim() && (!Number.isFinite(Number(form.price)) || Number(form.price) < 0)) {
      setError('Price must be a non-negative number.');
      return;
    }
    const r = await lensRun('fashion', 'wishlist-add', {
      name: form.name.trim(),
      price: form.price.trim() ? Number(form.price) : undefined,
      link: form.link.trim(),
      note: form.note.trim(),
      category: form.category || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', price: '', link: '', note: '', category: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange?.();
  };

  const remove = async (id: string) => {
    setBusy(id);
    const r = await lensRun('fashion', 'wishlist-remove', { id });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh(); onChange?.();
  };

  const openConvert = (entry: WishlistEntry) => {
    setConvertForm({ id: entry.id, category: entry.category || 'top', cost: entry.price != null ? String(entry.price) : '' });
    setError(null);
  };

  const convert = async () => {
    if (!convertForm) return;
    setBusy(convertForm.id);
    const r = await lensRun('fashion', 'wishlist-convert-to-item', {
      id: convertForm.id,
      category: convertForm.category,
      cost: convertForm.cost.trim() ? Number(convertForm.cost) : undefined,
    });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setConvertForm(null); setError(null);
    await refresh(); onChange?.();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Heart className="w-3.5 h-3.5 text-fuchsia-400" /> Wishlist
          {totalValue > 0 && <span className="text-[11px] font-normal text-emerald-400">~${totalValue} total</span>}
        </h3>
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
          <input placeholder="Price ($)" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Link (optional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Category (optional)</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add to wishlist</button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          Nothing saved yet. Add items you want to buy — convert to a real closet item once purchased.
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((w) => (
            <li key={w.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{w.name}</p>
                  <p className="text-[10px] text-zinc-400 capitalize flex items-center gap-1 flex-wrap">
                    {w.category && <span>{w.category}</span>}
                    {w.price != null && <span className="text-emerald-400">${w.price}</span>}
                    {w.link && (
                      <a href={w.link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-fuchsia-300 hover:text-fuchsia-200 normal-case">
                        <ExternalLink className="w-3 h-3" /> link
                      </a>
                    )}
                  </p>
                  {w.note && <p className="text-[11px] text-zinc-500 mt-1">{w.note}</p>}
                </div>
                <button aria-label="Remove" type="button" onClick={() => remove(w.id)} disabled={busy === w.id}
                  className="text-zinc-600 hover:text-rose-400 shrink-0 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {convertForm?.id === w.id ? (
                <div className="flex items-center gap-1.5 mt-2">
                  <select value={convertForm.category} onChange={(e) => setConvertForm({ ...convertForm, category: e.target.value })}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input inputMode="decimal" value={convertForm.cost}
                    onChange={(e) => setConvertForm({ ...convertForm, cost: e.target.value })}
                    placeholder="Cost ($)"
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
                  <button type="button" onClick={convert} disabled={busy === w.id}
                    className="px-2 py-1 text-[11px] bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white rounded-lg">
                    {busy === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm'}
                  </button>
                  <button aria-label="Cancel" type="button" onClick={() => setConvertForm(null)} className="text-zinc-400 hover:text-zinc-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => openConvert(w)}
                  className="flex items-center gap-1 mt-2 text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                  <ShoppingBag className="w-3 h-3" /> Bought it — move to closet
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
