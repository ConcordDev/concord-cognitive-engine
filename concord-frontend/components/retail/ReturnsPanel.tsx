'use client';

/**
 * ReturnsPanel — RMA lifecycle on real orders (returns-create / -list /
 * -update): open a return, approve or reject it, mark the goods received,
 * then close it. Refunding stays a separate, explicit step (refunds-create in
 * the panel beside this one) so a return never moves money on its own.
 */

import { useCallback, useEffect, useState } from 'react';
import { PackageOpen, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ReturnRecord {
  id: string; orderId?: string; orderNumber: string; orderTotal?: number; reason: string; note?: string | null;
  restock: boolean; status: string; rmaNumber: string; initiatedAt: string;
}
interface Order { id: string; number: string; total: number }

const NEXT: Record<string, Array<{ status: string; label: string; tone: string }>> = {
  pending: [{ status: 'approved', label: 'Approve', tone: 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' }, { status: 'rejected', label: 'Reject', tone: 'border border-white/10 text-gray-300 hover:text-rose-300' }],
  approved: [{ status: 'received', label: 'Goods received', tone: 'bg-sky-500/20 text-sky-200 hover:bg-sky-500/30' }, { status: 'rejected', label: 'Reject', tone: 'border border-white/10 text-gray-300 hover:text-rose-300' }],
  received: [{ status: 'closed', label: 'Close', tone: 'bg-white/10 text-gray-200 hover:bg-white/15' }],
};
const BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300', approved: 'bg-emerald-500/15 text-emerald-300', received: 'bg-sky-500/15 text-sky-300',
  closed: 'bg-gray-500/15 text-gray-400', rejected: 'bg-rose-500/15 text-rose-300',
};
const sel = 'px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white';

export function ReturnsPanel({ onChange }: { onChange?: () => void }) {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ orderId: '', reason: 'defective', note: '', restock: true });

  const refresh = useCallback(async () => {
    const [r, o] = await Promise.all([
      lensRun<{ returns: ReturnRecord[] }>('retail', 'returns-list', {}),
      lensRun<{ orders: Order[] }>('retail', 'orders-list', {}),
    ]);
    setReturns(r.data.result?.returns || []);
    setOrders(o.data.result?.orders || []);
    setLoading(false);
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const open = async () => {
    if (!form.orderId) { setError('Pick the order being returned.'); return; }
    setBusy('new'); setError(null);
    try {
      const r = await lensRun('retail', 'returns-create', form);
      if (!r.data.ok) { setError(r.data.error || 'Could not open the return.'); return; }
      setForm({ orderId: '', reason: 'defective', note: '', restock: true });
      await refresh(); onChange?.();
    } finally { setBusy(null); }
  };

  const move = async (id: string, status: string) => {
    setBusy(id); setError(null);
    try {
      const r = await lensRun('retail', 'returns-update', { id, status });
      if (!r.data.ok) setError(r.data.error || 'Could not update the return.');
      await refresh(); onChange?.();
    } finally { setBusy(null); }
  };

  return (
    <div className="bg-lattice-deep border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <PackageOpen className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Returns (RMA)</span>
        <span className="ml-auto text-[10px] text-gray-400">{returns.filter((r) => !['closed', 'rejected'].includes(r.status)).length} open</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select aria-label="Order" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} className={cn(sel, 'col-span-2')}>
          <option value="">Order being returned…</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · ${o.total.toFixed(2)}</option>)}
        </select>
        <select aria-label="Return reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={sel}>
          <option value="defective">Defective</option>
          <option value="not_as_described">Not as described</option>
          <option value="wrong_item">Wrong item</option>
          <option value="shipping_damaged">Damaged in transit</option>
          <option value="changed_mind">Changed mind</option>
        </select>
        <input aria-label="Note" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={sel} />
        <button type="button" onClick={() => void open()} disabled={busy === 'new'} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold transition-colors hover:bg-amber-400 disabled:opacity-50">Open RMA</button>
        <label className="col-span-2 sm:col-span-5 inline-flex items-center gap-1.5 text-[11px] text-gray-300">
          <input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} className="accent-emerald-500" />
          Restock when received
        </label>
        {error && <p role="alert" className="col-span-2 sm:col-span-5 text-[11px] text-rose-400">{error}</p>}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading returns…</div>
        ) : returns.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><PackageOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />No returns yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {returns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/[0.03]">
                <span className="font-mono text-amber-200">{r.rmaNumber}</span>
                <span className="font-mono text-emerald-300">{r.orderNumber}</span>
                <span className="capitalize text-gray-300">{r.reason.replace(/_/g, ' ')}</span>
                {r.note && <span className="truncate text-gray-500" title={r.note}>· {r.note}</span>}
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', BADGE[r.status] || BADGE.closed)}>{r.status}</span>
                <span className="ml-auto flex gap-1.5">
                  {r.orderId && (NEXT[r.status] || []).map((n) => (
                    <button key={n.status} type="button" onClick={() => void move(r.id, n.status)} disabled={busy === r.id} className={cn('rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50', n.tone)}>{n.label}</button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ReturnsPanel;
