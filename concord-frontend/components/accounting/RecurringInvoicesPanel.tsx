'use client';

import { useEffect, useState } from 'react';
import { Calendar, Loader2, Plus, Play, Pause, Zap } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Recurring {
  id: string; number: string;
  customerName: string; customerId: string | null;
  total: number; cadence: 'weekly' | 'monthly' | 'quarterly' | 'annually';
  startAt: string; nextRunAt: string;
  memo: string; active: boolean;
  lastRunAt: string | null; runCount: number;
}

const CADENCES = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' },
] as const;

export function RecurringInvoicesPanel() {
  const [list, setList] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState({ customerName: '', total: '', cadence: 'monthly' as Recurring['cadence'], startAt: '', memo: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'recurring-invoices-list', input: {} });
      setList((r.data?.result?.recurring || []) as Recurring[]);
    } catch (e) { console.error('[Recurring] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.customerName.trim() || !draft.total) return;
    try {
      await api.post('/api/lens/run', { domain: 'accounting', action: 'recurring-invoices-create', input: { ...draft, total: Number(draft.total) } });
      setDraft({ customerName: '', total: '', cadence: 'monthly', startAt: '', memo: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Recurring] create failed', e); }
  }

  async function toggle(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'accounting', action: 'recurring-invoices-toggle', input: { id } });
      await refresh();
    } catch (e) { console.error('[Recurring] toggle failed', e); }
  }

  async function runDue() {
    setRunning(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'recurring-invoices-run-due', input: {} });
      const count = r.data?.result?.count || 0;
      alert(`Generated ${count} invoice${count === 1 ? '' : 's'}.`);
      await refresh();
    } catch (e) { console.error('[Recurring] run-due failed', e); }
    finally { setRunning(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Recurring invoices</span>
        <span className="text-[10px] text-gray-500">{list.filter(r => r.active).length} active</span>
        <button onClick={runDue} disabled={running} className="ml-auto px-2.5 py-1 text-xs rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 inline-flex items-center gap-1">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}Run due
        </button>
        <button onClick={() => setCreating(v => !v)} className="px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.customerName} onChange={e => setDraft({ ...draft, customerName: e.target.value })} placeholder="Customer *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value })} placeholder="Amount *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value as Recurring['cadence'] })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CADENCES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input type="date" value={draft.startAt} onChange={e => setDraft({ ...draft, startAt: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="Memo" className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-3 px-2 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No recurring invoices.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(r => (
              <li key={r.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <button onClick={() => toggle(r.id)} className={cn('w-7 h-7 rounded inline-flex items-center justify-center', r.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/15 text-gray-400')} title={r.active ? 'Pause' : 'Resume'}>
                  {r.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-500">{r.number}</span>
                    <span>{r.customerName}</span>
                    <span className="text-[10px] text-emerald-300">{CADENCES.find(c => c.id === r.cadence)?.label}</span>
                  </div>
                  {r.memo && <div className="text-[11px] text-gray-400 truncate">{r.memo}</div>}
                  <div className="text-[10px] text-gray-500">Next run {r.nextRunAt} · {r.runCount} run{r.runCount === 1 ? '' : 's'}{r.lastRunAt && ` · last ${r.lastRunAt}`}</div>
                </div>
                <div className="text-sm font-mono tabular-nums text-white w-24 text-right">${r.total.toFixed(2)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RecurringInvoicesPanel;
