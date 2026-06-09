'use client';

import { useEffect, useState } from 'react';
import { Target, Plus, Trash2, TrendingUp, Loader2, Calendar } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  monthlyContribution: number;
  category: string;
  targetDate: string | null;
  remaining: number;
  monthsAtRate: number | null;
  etaDate: string | null;
  progressPct: number;
}

const CATEGORIES = ['emergency', 'house', 'travel', 'car', 'education', 'retirement', 'general'];

export function GoalsTracker() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', target: '', monthlyContribution: '', category: 'general' });
  const [contributing, setContributing] = useState<string | null>(null);
  const [contribAmt, setContribAmt] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'goals-list', input: {} });
      setGoals((res.data?.result?.goals || []) as Goal[]);
    } catch (e) { console.error('[Goals] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim() || !form.target) return;
    try {
      await lensRun({
        domain: 'finance', action: 'goals-create',
        input: { name: form.name.trim(), target: Number(form.target), monthlyContribution: Number(form.monthlyContribution) || 0, category: form.category },
      });
      setForm({ name: '', target: '', monthlyContribution: '', category: 'general' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Goals] create failed', e); }
  }

  async function contribute(id: string) {
    const amt = Number(contribAmt);
    if (!amt) return;
    try {
      await lensRun({ domain: 'finance', action: 'goals-contribute', input: { id, amount: amt } });
      setContributing(null); setContribAmt('');
      await refresh();
    } catch (e) { console.error('[Goals] contribute failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'goals-delete', input: { id } });
      setGoals(prev => prev.filter(g => g.id !== id));
    } catch (e) { console.error('[Goals] delete failed', e); }
  }

  const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Savings goals</span>
        <span className="ml-auto text-[10px] font-mono text-gray-400">
          ${totalSaved.toFixed(0)} / ${totalTarget.toFixed(0)}
        </span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="New goal"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Goal name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} placeholder="Target $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.monthlyContribution} onChange={e => setForm({ ...form, monthlyContribution: e.target.value })} placeholder="$/mo" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={create} className="col-span-5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Create goal</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : goals.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Target className="w-6 h-6 mx-auto mb-2 opacity-30" />No goals yet. Hit + to set one.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {goals.map(g => (
              <li key={g.id} className="px-3 py-3 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm text-white font-medium flex-1 truncate">{g.name}</span>
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{g.category}</span>
                  <button aria-label="Delete" onClick={() => remove(g.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-baseline gap-2 mb-1.5 text-xs">
                  <span className="font-mono tabular-nums text-cyan-300">${g.saved.toFixed(0)}</span>
                  <span className="text-gray-400">/ ${g.target.toFixed(0)}</span>
                  <span className="ml-auto text-gray-400 tabular-nums">{g.progressPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className={cn('h-full transition-all', g.progressPct >= 100 ? 'bg-emerald-500' : 'bg-cyan-500')} style={{ width: `${Math.min(100, g.progressPct)}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                  <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" /> ${g.monthlyContribution.toFixed(0)}/mo</span>
                  {g.etaDate ? (
                    <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> ETA {g.etaDate} ({g.monthsAtRate}mo)</span>
                  ) : (
                    <span className="text-gray-600">Set monthly to see ETA</span>
                  )}
                </div>
                {contributing === g.id ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input type="number" value={contribAmt} onChange={e => setContribAmt(e.target.value)} placeholder="$ to add" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" autoFocus />
                    <button onClick={() => contribute(g.id)} className="px-3 py-1 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Add</button>
                    <button onClick={() => { setContributing(null); setContribAmt(''); }} className="px-2 py-1 text-xs text-gray-400">×</button>
                  </div>
                ) : (
                  <button onClick={() => setContributing(g.id)} className="mt-2 text-[11px] text-cyan-300 hover:text-cyan-200">+ Contribute</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default GoalsTracker;
