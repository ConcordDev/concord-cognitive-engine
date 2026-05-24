'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Boxes, Plus, Loader2, Trash2, Minus, AlertTriangle, Clock } from 'lucide-react';
import { VetInventoryItem, INVENTORY_CATEGORIES } from './vet-types';

export function InventoryPanel() {
  const [items, setItems] = useState<VetInventoryItem[]>([]);
  const [lowStock, setLowStock] = useState(0);
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('supply');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'inventory-list', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as {
        items: VetInventoryItem[];
        lowStock: number;
        expiringSoon: number;
        totalValue: number;
      };
      setItems(res.items || []);
      setLowStock(res.lowStock || 0);
      setExpiringSoon(res.expiringSoon || 0);
      setTotalValue(res.totalValue || 0);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load inventory');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addItem = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'inventory-add', {
      name,
      category,
      sku,
      quantity: Number(quantity) || 0,
      unit,
      reorderLevel: Number(reorderLevel) || 0,
      unitCost: Number(unitCost) || 0,
      expiryDate,
    });
    setBusy(false);
    if (r.data.ok) {
      setName('');
      setSku('');
      setQuantity('');
      setUnit('');
      setReorderLevel('');
      setUnitCost('');
      setExpiryDate('');
      await load();
    } else {
      setError(r.data.error || 'failed to add item');
    }
  };

  const adjust = async (id: string, delta: number) => {
    await lensRun('veterinary', 'inventory-adjust', { id, delta });
    await load();
  };

  const del = async (id: string) => {
    await lensRun('veterinary', 'inventory-delete', { id });
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Low stock</p>
          <p className="font-mono text-lg text-yellow-300">{lowStock}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Expiring soon</p>
          <p className="font-mono text-lg text-orange-300">{expiringSoon}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Total value</p>
          <p className="font-mono text-lg text-emerald-300">${totalValue.toFixed(2)}</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
        className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name *"
          className="col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        >
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="SKU"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          type="number"
          placeholder="Qty"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit (vials)"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={reorderLevel}
          onChange={(e) => setReorderLevel(e.target.value)}
          type="number"
          placeholder="Reorder at"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          type="number"
          placeholder="$ cost"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          type="date"
          className="col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="col-span-2 md:col-span-4 flex items-center justify-center gap-2 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add inventory item
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
          <Boxes className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No inventory items.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const isLow = it.quantity <= it.reorderLevel;
            const expiringSoonItem =
              it.expiryDate &&
              Date.parse(it.expiryDate) - Date.now() <= 30 * 86400000 &&
              !Number.isNaN(Date.parse(it.expiryDate));
            return (
              <div
                key={it.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {it.name}
                    {isLow && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-yellow-400/10 px-1.5 py-0.5 text-[10px] text-yellow-400">
                        <AlertTriangle className="h-3 w-3" /> low
                      </span>
                    )}
                    {expiringSoonItem && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-orange-400/10 px-1.5 py-0.5 text-[10px] text-orange-400">
                        <Clock className="h-3 w-3" /> expiring
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {it.category}
                    {it.sku && ` · ${it.sku}`} · ${it.unitCost.toFixed(2)}/{it.unit}
                    {it.expiryDate && ` · exp ${it.expiryDate}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => adjust(it.id, -1)}
                    aria-label="Decrease quantity"
                    className="rounded bg-zinc-800 p-1 text-zinc-400 hover:bg-zinc-700"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-16 text-center font-mono text-sm text-white">
                    {it.quantity} {it.unit}
                  </span>
                  <button
                    onClick={() => adjust(it.id, 1)}
                    aria-label="Increase quantity"
                    className="rounded bg-zinc-800 p-1 text-zinc-400 hover:bg-zinc-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => del(it.id)}
                    aria-label="Delete item"
                    className="ml-1 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
