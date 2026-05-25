'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, Plus, Loader2, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Project { id: string; name: string; description: string; expectedReductionTonnesPerYear: number; costUsd: number; paybackYears: number | null; status: string; startDate: string | null; actualReductionTonnes: number }

const STATUS_COLOUR: Record<string, string> = {
  proposed: 'bg-gray-500/15 text-gray-300',
  approved: 'bg-cyan-500/15 text-cyan-300',
  in_progress: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
};

export function ProjectsBacklog() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', expectedReductionTonnesPerYear: '', costUsd: '', paybackYears: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'environment', action: 'projects-list', input: {} });
      setProjects((r.data?.result?.projects || []) as Project[]);
    } catch (e) { console.error('[Projects] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim()) return;
    try {
      await lensRun({ domain: 'environment', action: 'projects-create', input: { ...form, expectedReductionTonnesPerYear: Number(form.expectedReductionTonnesPerYear) || 0, costUsd: Number(form.costUsd) || 0, paybackYears: Number(form.paybackYears) || undefined } });
      setForm({ name: '', description: '', expectedReductionTonnesPerYear: '', costUsd: '', paybackYears: '' });
      await refresh();
    } catch (e) { console.error('[Projects] create', e); }
  }

  async function setStatus(id: string, status: string) {
    try {
      await lensRun({ domain: 'environment', action: 'projects-update-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Projects] status', e); }
  }

  const totalAnnualReduction = projects.filter(p => p.status === 'approved' || p.status === 'in_progress' || p.status === 'completed').reduce((s, p) => s + p.expectedReductionTonnesPerYear, 0);
  const totalInvestment = projects.filter(p => p.status !== 'cancelled').reduce((s, p) => s + p.costUsd, 0);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Reduction projects</span>
        <span className="ml-auto text-[10px] text-gray-400">{totalAnnualReduction.toFixed(0)} t/yr expected · ${(totalInvestment / 1000).toFixed(0)}K total</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Project name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.expectedReductionTonnesPerYear} onChange={e => setForm({ ...form, expectedReductionTonnesPerYear: e.target.value })} placeholder="t CO₂e / yr" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.costUsd} onChange={e => setForm({ ...form, costUsd: e.target.value })} placeholder="Cost $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.paybackYears} onChange={e => setForm({ ...form, paybackYears: e.target.value })} placeholder="Payback yrs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : projects.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Lightbulb className="w-6 h-6 mx-auto mb-2 opacity-30" />No reduction projects yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {projects.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-3.5 h-3.5 text-emerald-300" />
                  <span className="text-sm text-white">{p.name}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs">
                    <span className="font-mono text-emerald-300">-{p.expectedReductionTonnesPerYear}t/yr</span>
                    <span className="text-gray-400">·</span>
                    <span className="font-mono text-gray-400">${(p.costUsd / 1000).toFixed(0)}K</span>
                    {p.paybackYears && <><span className="text-gray-400">·</span><span className="font-mono text-cyan-300">{p.paybackYears}y payback</span></>}
                  </span>
                </div>
                {p.description && <div className="text-[11px] text-gray-400 ml-5 mb-1">{p.description}</div>}
                <div className="ml-5 flex items-center gap-1">
                  <select value={p.status} onChange={e => setStatus(p.id, e.target.value)} className={cn('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border-0', STATUS_COLOUR[p.status])}>
                    {Object.keys(STATUS_COLOUR).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ProjectsBacklog;
