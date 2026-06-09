'use client';

import { useEffect, useState } from 'react';
import { Repeat, Plus, Trash2, Pause, Play, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DCAPlan {
  id: string;
  symbol: string;
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'monthly';
  startDate: string;
  status: 'active' | 'paused';
  executedCount: number;
  totalInvested: number;
  averagePrice: number | null;
  createdAt: string;
}

export function RecurringInvestments() {
  const [plans, setPlans] = useState<DCAPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ symbol: '', amount: '', cadence: 'monthly' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'recurring-list', input: {} });
      setPlans((res.data?.result?.plans || []) as DCAPlan[]);
    } catch (e) { console.error('[Recurring] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.symbol.trim() || !form.amount) return;
    try {
      await lensRun({
        domain: 'finance', action: 'recurring-create',
        input: { symbol: form.symbol.trim(), amount: Number(form.amount), cadence: form.cadence },
      });
      setForm({ symbol: '', amount: '', cadence: 'monthly' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Recurring] create failed', e); }
  }

  async function togglePause(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'recurring-pause', input: { id } });
      await refresh();
    } catch (e) { console.error('[Recurring] pause failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'recurring-cancel', input: { id } });
      setPlans(prev => prev.filter(p => p.id !== id));
    } catch (e) { console.error('[Recurring] cancel failed', e); }
  }

  const monthlyTotal = plans.filter(p => p.status === 'active').reduce((s, p) => {
    const mult = p.cadence === 'weekly' ? 4.33 : p.cadence === 'biweekly' ? 2.17 : 1;
    return s + p.amount * mult;
  }, 0);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recurring investments</span>
        <span className="ml-auto text-[10px] text-gray-400 font-mono">${monthlyTotal.toFixed(0)}/mo deployed</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="VTI" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="$" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Start</button>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : plans.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Repeat className="w-6 h-6 mx-auto mb-2 opacity-30" />No DCA plans. Start auto-investing.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {plans.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-cyan-500/10 flex items-center justify-center text-xs font-mono font-bold text-cyan-300">{p.symbol.slice(0, 4)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {p.symbol}
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', p.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{p.status}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono">{p.executedCount} buys · avg ${p.averagePrice?.toFixed(2) || '—'}</div>
                </div>
                <span className="text-right">
                  <div className="font-mono text-sm text-white tabular-nums">${p.amount.toFixed(0)}</div>
                  <div className="text-[10px] text-gray-400">{p.cadence}</div>
                </span>
                <button onClick={() => togglePause(p.id)} className="p-1.5 rounded hover:bg-white/10 text-gray-400" title={p.status === 'active' ? 'Pause' : 'Resume'}>
                  {p.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button aria-label="Delete" onClick={() => remove(p.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RecurringInvestments;
