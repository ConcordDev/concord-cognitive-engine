'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Refund { id: string; orderId: string; orderNumber: string; amount: number; reason: string; restock: boolean; processedAt: string }
interface Order { id: string; number: string; total: number }

export function RefundsPanel() {
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ orderId: '', amount: '', reason: 'customer_request', restock: true });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [r, o] = await Promise.all([
        lensRun({ domain: 'retail', action: 'refunds-list', input: {} }),
        lensRun({ domain: 'retail', action: 'orders-list', input: {} }),
      ]);
      setRefunds((r.data?.result?.refunds || []) as Refund[]);
      setOrders((o.data?.result?.orders || []) as Order[]);
    } catch (e) { console.error('[Refunds] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.orderId || !form.amount) return;
    try {
      const res = await lensRun({
        domain: 'retail', action: 'refunds-create',
        input: { orderId: form.orderId, amount: Number(form.amount), reason: form.reason, restock: form.restock },
      });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      setForm({ orderId: '', amount: '', reason: 'customer_request', restock: true });
      await refresh();
    } catch (e) { console.error('[Refunds] create failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <RotateCcw className="w-4 h-4 text-rose-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Refunds & returns</span>
        <span className="ml-auto text-[10px] text-gray-400">{refunds.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <select value={form.orderId} onChange={e => setForm({ ...form, orderId: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select order…</option>
          {orders.map(o => <option key={o.id} value={o.id}>{o.number} · ${o.total.toFixed(2)}</option>)}
        </select>
        <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Refund $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="customer_request">Customer request</option>
          <option value="defective">Defective</option>
          <option value="not_as_described">Not as described</option>
          <option value="shipping_damaged">Damaged in transit</option>
          <option value="other">Other</option>
        </select>
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-rose-500 text-white font-bold hover:bg-rose-400">Refund</button>
        <label className="col-span-5 inline-flex items-center gap-1.5 text-[11px] text-gray-300">
          <input type="checkbox" checked={form.restock} onChange={e => setForm({ ...form, restock: e.target.checked })} className="accent-emerald-500" />
          Restock inventory
        </label>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : refunds.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><RotateCcw className="w-6 h-6 mx-auto mb-2 opacity-30" />No refunds processed yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5"><tr><th className="text-left px-3 py-1.5">Order</th><th className="text-left">Reason</th><th className="text-right">Amount</th><th className="text-right pr-3">When</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {refunds.map(r => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-2 font-mono text-emerald-300">{r.orderNumber}</td>
                  <td className="text-gray-300 capitalize">{r.reason.replace('_', ' ')}{r.restock && <span className="ml-1 text-[10px] text-emerald-400">(restocked)</span>}</td>
                  <td className="text-right font-mono tabular-nums text-rose-300">-${r.amount.toFixed(2)}</td>
                  <td className="text-right text-gray-400 text-[10px] pr-3">{new Date(r.processedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default RefundsPanel;
