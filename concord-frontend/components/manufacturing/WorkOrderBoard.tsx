'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClipboardList, Loader2, Clock, User } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface WorkOrder {
  id: string;
  number: string;
  product: string;
  quantity: number;
  quantityProduced: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'queued' | 'in_progress' | 'on_hold' | 'complete';
  dueDate: string | null;
  assignedTo?: string | null;
  machine?: string | null;
}

const STATUSES: WorkOrder['status'][] = ['queued', 'in_progress', 'on_hold', 'complete'];
const PRIORITIES: WorkOrder['priority'][] = ['low', 'medium', 'high', 'urgent'];

function lensError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error || err?.message || fallback;
}

const fieldCls = 'mt-0.5 w-full min-w-[7rem] px-2 py-1 text-xs bg-[#0a0e17] border border-white/10 rounded text-white placeholder:text-gray-600';

export function WorkOrderBoard() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<WorkOrder['priority']>('medium');

  const load = useCallback(async () => {
    const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'work-orders', input: {} });
    const result = res.data?.result || {};
    return {
      orders: (result.orders || []) as WorkOrder[],
      notes: typeof result.notes === 'string' ? result.notes : null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((result) => {
      if (cancelled) return;
      setOrders(result.orders);
      setNotes(result.notes);
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      setError(lensError(e, 'Could not load work orders.'));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load]);

  async function createOrder(ev: FormEvent) {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: Record<string, unknown> = {
        product: product.trim(),
        quantity: quantity.trim(),
        priority,
      };
      if (dueDate.trim() !== '') input.dueDate = dueDate.trim();
      const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'work-order-create', input });
      if (res.data?.ok === false) {
        setError(res.data.error || 'Could not create work order.');
        return;
      }
      setProduct('');
      setQuantity('');
      const result = await load();
      setOrders(result.orders);
      setNotes(result.notes);
    } catch (e) {
      setError(lensError(e, 'Could not create work order.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: WorkOrder['status']) {
    setError(null);
    try {
      const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'work-order-update', input: { id, status } });
      if (res.data?.ok === false) {
        setError(res.data.error || 'Could not update work order.');
        return;
      }
      const result = await load();
      setOrders(result.orders);
      setNotes(result.notes);
    } catch (e) {
      setError(lensError(e, 'Could not update work order.'));
    }
  }

  const byStatus = {
    queued: orders.filter(o => o.status === 'queued'),
    in_progress: orders.filter(o => o.status === 'in_progress'),
    on_hold: orders.filter(o => o.status === 'on_hold'),
    complete: orders.filter(o => o.status === 'complete'),
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Work orders</span>
        <span className="ml-auto text-[10px] text-gray-400">{orders.length} active</span>
      </header>
      <form onSubmit={createOrder} className="px-3 py-2 border-b border-white/5 flex flex-wrap items-end gap-2">
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Product
          <input value={product} onChange={(e) => setProduct(e.target.value)} required className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Quantity
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" required className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Due date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrder['priority'])} className={fieldCls}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button type="submit" disabled={saving} className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create work order'}
        </button>
      </form>
      {error && <p role="alert" className="px-3 py-1.5 text-[11px] text-red-300">{error}</p>}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : orders.length === 0 ? (
        <p className="px-4 py-6 text-xs text-gray-400">
          No work orders.
          {notes && <span className="block mt-1 text-[10px] text-gray-500">{notes}</span>}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-3">
          {STATUSES.map(s => (
            <div key={s} className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 px-1">{s.replace(/_/g, ' ')} <span className="text-cyan-300">{byStatus[s].length}</span></div>
              {byStatus[s].map(o => {
                const pct = o.quantity > 0 ? (o.quantityProduced / o.quantity) * 100 : 0;
                const dueMs = o.dueDate ? new Date(o.dueDate).getTime() : NaN;
                const days = Number.isFinite(dueMs) ? Math.ceil((dueMs - Date.now()) / 86400000) : null;
                return (
                  <div key={o.id} className="p-2 bg-white/[0.02] border border-white/10 rounded text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-cyan-300">{o.number}</span>
                      <span className={cn('text-[8px] uppercase px-1 py-0.5 rounded font-bold',
                        o.priority === 'urgent' ? 'bg-red-500/30 text-red-200' :
                        o.priority === 'high' ? 'bg-orange-500/30 text-orange-200' :
                        o.priority === 'medium' ? 'bg-yellow-500/30 text-yellow-200' :
                        'bg-gray-500/30 text-gray-200'
                      )}>{o.priority}</span>
                    </div>
                    <div className="text-white mt-0.5 truncate">{o.product}</div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {o.quantityProduced}/{o.quantity} {o.machine ? `· ${o.machine}` : ''}
                    </div>
                    <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-gray-400 mt-1">
                      <Clock className="w-3 h-3" /> {days == null ? 'no due date' : days < 0 ? <span className="text-red-300">overdue {-days}d</span> : `${days}d`}
                      {o.assignedTo && <span className="inline-flex items-center gap-0.5 ml-auto"><User className="w-3 h-3" /> {o.assignedTo}</span>}
                    </div>
                    <label className="mt-1 block text-[9px] uppercase tracking-wider text-gray-500">
                      Status
                      <select
                        aria-label={`Status ${o.number}`}
                        value={o.status}
                        onChange={(e) => { void updateStatus(o.id, e.target.value as WorkOrder['status']); }}
                        className="mt-0.5 w-full px-1 py-0.5 text-[10px] bg-[#0a0e17] border border-white/10 rounded text-white"
                      >
                        {STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                      </select>
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export default WorkOrderBoard;
