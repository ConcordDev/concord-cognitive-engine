'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  ShoppingCart, Plus, Trash2, Loader2, ExternalLink,
  Check, TrendingDown, TrendingUp, Tag,
} from 'lucide-react';

interface PricePoint { price: number; at: string }
interface ShopItem {
  id: string;
  name: string;
  qty: number;
  vendor: string;
  vendorUrl: string;
  price: number;
  priceHistory: PricePoint[];
  purchased: boolean;
  lineTotal: number;
  createdAt: string;
}
interface ShopResult {
  items: ShopItem[];
  count: number;
  totalCost: number;
  remainingCost: number;
  purchasedCount: number;
}

const DOMAIN = 'home-improvement';

export function ShoppingList() {
  const [result, setResult] = useState<ShopResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', qty: '1', vendor: '', vendorUrl: '', price: '' });
  const [priceEdit, setPriceEdit] = useState<Record<string, string>>({});
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<ShopResult>(DOMAIN, 'shopping-list', {});
    if (data.ok && data.result) setResult(data.result);
    else setError(data.error || 'Failed to load shopping list');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'shopping-add', {
      name: form.name, qty: Number(form.qty) || 1, vendor: form.vendor, vendorUrl: form.vendorUrl, price: Number(form.price) || 0,
    });
    if (data.ok) { setForm({ name: '', qty: '1', vendor: '', vendorUrl: '', price: '' }); await load(); }
    else setError(data.error || 'Failed to add item');
    setBusy(false);
  };

  const toggle = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'shopping-toggle', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'shopping-delete', { id });
    if (data.ok) await load();
    setBusy(false);
  };

  const updatePrice = async (id: string) => {
    const v = priceEdit[id];
    if (v === undefined || v === '') return;
    setBusy(true); setError(null);
    const { data } = await lensRun(DOMAIN, 'shopping-price-update', { id, price: Number(v) });
    if (data.ok) { setPriceEdit((p) => ({ ...p, [id]: '' })); await load(); }
    else setError(data.error || 'Failed to update price');
    setBusy(false);
  };

  const items = result?.items || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <ShoppingCart className="w-4 h-4 text-neon-green" /> Materials Shopping List
          <span className="text-xs text-gray-400">({result?.count || 0})</span>
        </h3>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {result && (
        <div className="grid grid-cols-3 gap-2">
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-neon-green">${result.totalCost.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Total cost</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-yellow-400">${result.remainingCost.toLocaleString()}</p>
            <p className="text-xs text-gray-400">Still to buy</p>
          </div>
          <div className="lens-card text-center">
            <p className="text-lg font-bold text-neon-cyan">{result.purchasedCount}/{result.count}</p>
            <p className="text-xs text-gray-400">Purchased</p>
          </div>
        </div>
      )}

      <div className="panel p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Item name" className="input-lattice" />
          <input value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} type="number" placeholder="Qty" className="input-lattice" />
          <input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} type="number" placeholder="Unit price $" className="input-lattice" />
          <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} placeholder="Vendor" className="input-lattice" />
          <input value={form.vendorUrl} onChange={(e) => setForm((f) => ({ ...f, vendorUrl: e.target.value }))} placeholder="Vendor link" className="input-lattice md:col-span-2" />
        </div>
        <button onClick={add} disabled={busy || !form.name.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
          <Plus className="w-3.5 h-3.5 inline mr-1" />{busy ? 'Saving...' : 'Add Item'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading list...</div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400">No items yet. Build a shopping list with vendor links and price tracking.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const first = it.priceHistory[0]?.price ?? it.price;
            const dropped = it.price < first;
            const rose = it.price > first;
            return (
              <div key={it.id} className={`panel p-3 ${it.purchased ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(it.id)} disabled={busy} className={`w-5 h-5 rounded border flex items-center justify-center ${it.purchased ? 'bg-neon-green border-neon-green' : 'border-gray-600'}`}>
                    {it.purchased && <Check className="w-3.5 h-3.5 text-black" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium text-white truncate ${it.purchased ? 'line-through' : ''}`}>{it.name}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{it.qty} × ${it.price.toLocaleString()}</span>
                      <span className="text-neon-green font-semibold">${it.lineTotal.toLocaleString()}</span>
                      {it.vendor && <span className="flex items-center gap-0.5"><Tag className="w-3 h-3" />{it.vendor}</span>}
                      {dropped && <span className="flex items-center gap-0.5 text-neon-green"><TrendingDown className="w-3 h-3" />price drop</span>}
                      {rose && <span className="flex items-center gap-0.5 text-red-400"><TrendingUp className="w-3 h-3" />price up</span>}
                    </div>
                  </div>
                  {it.vendorUrl && (
                    <a href={it.vendorUrl} target="_blank" rel="noopener noreferrer" className="text-neon-cyan p-1"><ExternalLink className="w-3.5 h-3.5" /></a>
                  )}
                  <button aria-label="Delete" onClick={() => remove(it.id)} disabled={busy} className="text-gray-400 hover:text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    value={priceEdit[it.id] ?? ''}
                    onChange={(e) => setPriceEdit((p) => ({ ...p, [it.id]: e.target.value }))}
                    type="number" placeholder="New price" className="input-lattice text-xs w-32"
                  />
                  <button onClick={() => updatePrice(it.id)} disabled={busy || !priceEdit[it.id]} className="btn-neon text-xs disabled:opacity-50">Log price</button>
                  {it.priceHistory.length > 1 && (
                    <button onClick={() => setOpenHistory((o) => (o === it.id ? null : it.id))} className="text-xs text-gray-400 hover:text-white">
                      {openHistory === it.id ? 'Hide' : `History (${it.priceHistory.length})`}
                    </button>
                  )}
                </div>
                {openHistory === it.id && it.priceHistory.length > 1 && (
                  <div className="mt-2">
                    <ChartKit
                      kind="line" height={140} xKey="at"
                      data={it.priceHistory.map((h) => ({ at: h.at.slice(5, 10), price: h.price }))}
                      series={[{ key: 'price', label: 'Price', color: '#22c55e' }]}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
