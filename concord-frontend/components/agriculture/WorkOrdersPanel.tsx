'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Loader2, Check } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Order { id: string; fieldId: string; operation: string; kind: string; scheduledFor: string | null; status: string; notes: string }

const KINDS = ['planting', 'spraying', 'tillage', 'harvest', 'scouting', 'irrigation', 'fertilize'];

export function WorkOrdersPanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fieldId: '', operation: '', kind: 'spraying', scheduledFor: '', notes: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'agriculture', action: 'work-orders-list', input: {} });
      setOrders((res.data?.result?.orders || []) as Order[]);
    } catch (e) { console.error('[WO] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.fieldId.trim() || !form.operation.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'agriculture', action: 'work-orders-create', input: form });
      setForm({ fieldId: '', operation: '', kind: 'spraying', scheduledFor: '', notes: '' });
      await refresh();
    } catch (e) { console.error('[WO] create', e); }
  }

  async function complete(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'agriculture', action: 'work-orders-complete', input: { id } });
      await refresh();
    } catch (e) { console.error('[WO] complete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Field work orders</span>
        <span className="ml-auto text-[10px] text-gray-500">{orders.filter(o => o.status === 'scheduled').length} scheduled · {orders.filter(o => o.status === 'completed').length} done</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.fieldId} onChange={e => setForm({ ...form, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.operation} onChange={e => setForm({ ...form, operation: e.target.value })} placeholder="Operation" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="date" value={form.scheduledFor} onChange={e => setForm({ ...form, scheduledFor: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="col-span-5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Create work order</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : orders.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><ClipboardCheck className="w-6 h-6 mx-auto mb-2 opacity-30" />No work orders yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {orders.map(o => (
              <li key={o.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', o.status === 'completed' && 'opacity-50')}>
                <ClipboardCheck className={cn('w-3.5 h-3.5', o.status === 'completed' ? 'text-emerald-300' : 'text-cyan-300')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{o.operation}</div>
                  <div className="text-[10px] text-gray-500">Field {o.fieldId.slice(0, 10)} · {o.kind}{o.scheduledFor ? ` · ${o.scheduledFor}` : ''}</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', o.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{o.status}</span>
                {o.status === 'scheduled' && <button onClick={() => complete(o.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" />Done</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WorkOrdersPanel;
