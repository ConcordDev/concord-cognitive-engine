'use client';

import { useEffect, useState } from 'react';
import { Repeat, Plus, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Plan { id: string; customerId: string; serviceType: string; cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual'; priceEach: number; status: 'active' | 'cancelled'; nextServiceDate: string | null; jobsCompleted: number; totalRevenue: number }

export function RecurringPlansPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ customerId: '', serviceType: '', cadence: 'monthly' as Plan['cadence'], priceEach: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'trades', action: 'recurring-plans-list', input: {} });
      setPlans((res.data?.result?.plans || []) as Plan[]);
    } catch (e) { console.error('[Recurring] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.customerId.trim() || !form.serviceType.trim() || !form.priceEach) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'trades', action: 'recurring-plans-create',
        input: { customerId: form.customerId, serviceType: form.serviceType, cadence: form.cadence, priceEach: Number(form.priceEach) },
      });
      setForm({ customerId: '', serviceType: '', cadence: 'monthly', priceEach: '' });
      await refresh();
    } catch (e) { console.error('[Recurring] create', e); }
  }

  async function cancel(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'trades', action: 'recurring-plans-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error('[Recurring] cancel', e); }
  }

  const active = plans.filter(p => p.status === 'active');
  const monthlyRecurring = active.reduce((sum, p) => {
    const mult = p.cadence === 'weekly' ? 4.33 : p.cadence === 'monthly' ? 1 : p.cadence === 'quarterly' ? 1 / 3 : 1 / 12;
    return sum + p.priceEach * mult;
  }, 0);

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recurring service plans</span>
        <span className="ml-auto text-[10px] text-gray-500">{active.length} active · ~${monthlyRecurring.toFixed(0)}/mo MRR</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} placeholder="Customer ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.serviceType} onChange={e => setForm({ ...form, serviceType: e.target.value })} placeholder="Service type" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value as Plan['cadence'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
        </select>
        <input type="number" value={form.priceEach} onChange={e => setForm({ ...form, priceEach: e.target.value })} placeholder="Price each" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="col-span-5 px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add plan</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : plans.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Repeat className="w-6 h-6 mx-auto mb-2 opacity-30" />No recurring plans.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {plans.map(p => (
              <li key={p.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', p.status === 'cancelled' && 'opacity-50')}>
                <Repeat className="w-3.5 h-3.5 text-violet-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{p.serviceType}</div>
                  <div className="text-[10px] text-gray-500">{p.customerId.slice(0, 12)} · {p.cadence} · {p.jobsCompleted} jobs done</div>
                </div>
                <span className="font-mono text-sm tabular-nums text-violet-300">${p.priceEach.toFixed(0)}</span>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', p.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{p.status}</span>
                {p.status === 'active' && <button onClick={() => cancel(p.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-300"><X className="w-3 h-3" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RecurringPlansPanel;
