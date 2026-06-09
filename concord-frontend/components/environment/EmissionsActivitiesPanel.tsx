'use client';

import { useCallback, useEffect, useState } from 'react';
import { Leaf, Plus, Trash2, Loader2, Factory, Zap, Plane } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Activity { id: string; factorKey: string; amount: number; unit: string; scope: 1 | 2 | 3; co2eKg: number; co2eTonnes: number; date: string; facility: string; category: string; source: string }
interface Factor { key: string; co2e: number; unit: string; scope: 1 | 2 | 3; source: string }

const SCOPE_COLOUR: Record<1 | 2 | 3, string> = {
  1: 'bg-rose-500/15 text-rose-300',
  2: 'bg-amber-500/15 text-amber-300',
  3: 'bg-cyan-500/15 text-cyan-300',
};
const SCOPE_ICON = { 1: Factory, 2: Zap, 3: Plane };

export function EmissionsActivitiesPanel() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | '1' | '2' | '3'>('');
  const [form, setForm] = useState({ factorKey: 'diesel_gallon', amount: '', date: new Date().toISOString().slice(0, 10), facility: '', category: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, f] = await Promise.all([
        lensRun({ domain: 'environment', action: 'activities-list', input: filter ? { scope: Number(filter) } : {} }),
        lensRun({ domain: 'environment', action: 'emission-factors-list', input: {} }),
      ]);
      setActivities((a.data?.result?.activities || []) as Activity[]);
      setFactors((f.data?.result?.factors || []) as Factor[]);
    } catch (e) { console.error('[Activities] failed', e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function log() {
    if (!form.amount) return;
    try {
      const res = await lensRun({ domain: 'environment', action: 'activities-log', input: { ...form, amount: Number(form.amount) } });
      if (res.data?.ok === false) alert(res.data?.error);
      setForm({ ...form, amount: '', facility: '', category: '' });
      await refresh();
    } catch (e) { console.error('[Activities] log', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'environment', action: 'activities-delete', input: { id } });
      setActivities(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error('[Activities] delete', e); }
  }

  const totals = activities.reduce((acc, a) => {
    acc[a.scope] = (acc[a.scope] || 0) + a.co2eTonnes;
    acc.total += a.co2eTonnes;
    return acc;
  }, { total: 0, 1: 0, 2: 0, 3: 0 } as Record<string | number, number>);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Leaf className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Emissions activities</span>
        <span className="ml-auto text-[10px] text-gray-400">{activities.length} entries · {totals.total.toFixed(1)} tCO₂e</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All scopes</option><option value="1">Scope 1</option><option value="2">Scope 2</option><option value="3">Scope 3</option>
        </select>
      </header>
      <div className="px-4 py-2 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <Tile label="Scope 1" value={`${(totals[1] || 0).toFixed(1)}t`} tone="rose" />
        <Tile label="Scope 2" value={`${(totals[2] || 0).toFixed(1)}t`} tone="amber" />
        <Tile label="Scope 3" value={`${(totals[3] || 0).toFixed(1)}t`} tone="cyan" />
        <Tile label="Total" value={`${totals.total.toFixed(1)}t`} tone="emerald" />
      </div>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <select value={form.factorKey} onChange={e => setForm({ ...form, factorKey: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {factors.map(f => <option key={f.key} value={f.key}>S{f.scope} · {f.key.replace(/_/g, ' ')} ({f.unit})</option>)}
        </select>
        <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Amount" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.facility} onChange={e => setForm({ ...form, facility: e.target.value })} placeholder="Facility" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={log} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log</button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : activities.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Leaf className="w-6 h-6 mx-auto mb-2 opacity-30" />No activities logged yet. Pick a factor + amount above to start your inventory.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {activities.map(a => {
              const Icon = SCOPE_ICON[a.scope];
              return (
                <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                  <Icon className={cn('w-3.5 h-3.5', a.scope === 1 ? 'text-rose-300' : a.scope === 2 ? 'text-amber-300' : 'text-cyan-300')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{a.factorKey.replace(/_/g, ' ')} · {a.amount.toLocaleString()} {a.unit}</div>
                    <div className="text-[10px] text-gray-400 truncate">{a.date}{a.facility && ` · ${a.facility}`} · {a.source}</div>
                  </div>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', SCOPE_COLOUR[a.scope])}>S{a.scope}</span>
                  <span className="text-sm font-mono tabular-nums text-emerald-300">{a.co2eTonnes.toFixed(2)}t</span>
                  <button aria-label="Delete" onClick={() => remove(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  const colour = tone === 'rose' ? 'text-rose-300 border-rose-500/30 bg-rose-500/5' : tone === 'amber' ? 'text-amber-300 border-amber-500/30 bg-amber-500/5' : tone === 'cyan' ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/5' : 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
  return (
    <div className={cn('rounded border px-2 py-1.5', colour)}>
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums">{value}</div>
    </div>
  );
}

export default EmissionsActivitiesPanel;
