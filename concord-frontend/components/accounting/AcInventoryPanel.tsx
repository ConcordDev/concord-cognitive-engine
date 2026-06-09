'use client';

/** AcInventoryPanel — products & services with inventory tracking. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Item {
  id: string; name: string; type: string; sku: string | null;
  price: number; cost: number; qtyOnHand: number | null; reorderPoint: number | null;
}

export function AcInventoryPanel() {
  const [items, setItems] = useState<Item[]>([]);
  const [lowStock, setLowStock] = useState<{ count: number; inventoryValue: number }>({ count: 0, inventoryValue: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', type: 'inventory', sku: '', price: '', cost: '', qtyOnHand: '', reorderPoint: '' });
  const [adj, setAdj] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [i, l] = await Promise.all([
      lensRun({ domain: 'accounting', action: 'item-list', input: {} }),
      lensRun({ domain: 'accounting', action: 'inventory-low-stock', input: {} }),
    ]);
    setItems(i.data?.result?.items || []);
    setLowStock({ count: l.data?.result?.count || 0, inventoryValue: l.data?.result?.inventoryValue || 0 });
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) return;
    await lensRun({ domain: 'accounting', action: 'item-create', input: {
      name: form.name.trim(), type: form.type, sku: form.sku.trim(),
      price: Number(form.price) || 0, cost: Number(form.cost) || 0,
      qtyOnHand: Number(form.qtyOnHand) || 0, reorderPoint: Number(form.reorderPoint) || 0,
    } });
    setForm({ name: '', type: 'inventory', sku: '', price: '', cost: '', qtyOnHand: '', reorderPoint: '' });
    await refresh();
  };
  const adjust = async (id: string) => {
    const delta = Number(adj[id]);
    if (!delta) return;
    await lensRun({ domain: 'accounting', action: 'item-adjust-stock', input: { id, delta } });
    setAdj((p) => ({ ...p, [id]: '' }));
    await refresh();
  };

  if (loading) return <Spin />;

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Inventory value" value={`$${lowStock.inventoryValue.toLocaleString()}`} />
        <Stat label="Low stock items" value={lowStock.count} alert={lowStock.count > 0} />
      </div>

      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">New item</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inp}>
            <option value="inventory">Inventory</option><option value="service">Service</option>
          </select>
          <input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inp} />
          <input placeholder="Price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={inp} />
          <input placeholder="Cost" inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className={inp} />
          {form.type === 'inventory' && <>
            <input placeholder="Qty on hand" inputMode="numeric" value={form.qtyOnHand} onChange={(e) => setForm({ ...form, qtyOnHand: e.target.value })} className={inp} />
            <input placeholder="Reorder pt" inputMode="numeric" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} className={inp} />
          </>}
          <button type="button" onClick={add} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
      </section>

      {items.length === 0 ? <Empty text="No items yet." /> : (
        <ul className="space-y-1">
          {items.map((it) => {
            const low = it.type === 'inventory' && (it.qtyOnHand || 0) <= (it.reorderPoint || 0);
            return (
              <li key={it.id} className="flex items-center gap-2 text-xs bg-black/20 border border-white/10 rounded px-2 py-1.5">
                {low && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                <span className="flex-1 text-gray-200">{it.name}{it.sku && <span className="text-gray-400"> · {it.sku}</span>}</span>
                <span className="text-gray-400">${it.price} / cost ${it.cost}</span>
                {it.type === 'inventory' && (
                  <>
                    <span className={low ? 'text-amber-400' : 'text-gray-400'}>{it.qtyOnHand} on hand</span>
                    <input placeholder="±" value={adj[it.id] || ''}
                      onChange={(e) => setAdj((p) => ({ ...p, [it.id]: e.target.value }))}
                      className="w-12 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[11px]" />
                    <button type="button" onClick={() => adjust(it.id)} className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded">adjust</button>
                  </>
                )}
                <button aria-label="Delete" type="button" onClick={() => lensRun({ domain: 'accounting', action: 'item-delete', input: { id: it.id } }).then(refresh)}
                  className="text-gray-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const inp = 'bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded';
function Spin() { return <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-gray-400 italic">{text}</p>; }
function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 text-center">
      <p className={`text-xl font-bold ${alert ? 'text-amber-300' : 'text-gray-100'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 uppercase">{label}</p>
    </div>
  );
}
