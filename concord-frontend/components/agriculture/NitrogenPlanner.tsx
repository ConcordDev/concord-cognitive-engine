'use client';

import { useEffect, useState } from 'react';
import { Droplet, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Plan {
  id: string; fieldId: string; crop: string;
  targetLbsPerAcre: number; totalApplied: number; remaining: number; season: string;
  applications?: Array<{ id: string; lbsPerAcre: number; product: string; appliedAt: string; timing: string }>;
}

export function NitrogenPlanner() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fieldId: '', crop: '', targetLbsPerAcre: '' });
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [applyForm, setApplyForm] = useState({ lbsPerAcre: '', product: 'UAN-32', timing: 'sidedress' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'nitrogen-plans', input: {} });
      setPlans((res.data?.result?.plans || []) as Plan[]);
    } catch (e) { console.error('[N] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.fieldId.trim() || !form.targetLbsPerAcre) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'nitrogen-plan-create', input: { ...form, targetLbsPerAcre: Number(form.targetLbsPerAcre) } });
      setForm({ fieldId: '', crop: '', targetLbsPerAcre: '' });
      await refresh();
    } catch (e) { console.error('[N] create', e); }
  }

  async function apply() {
    if (!applyFor || !applyForm.lbsPerAcre) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'nitrogen-apply', input: { planId: applyFor, lbsPerAcre: Number(applyForm.lbsPerAcre), product: applyForm.product, timing: applyForm.timing } });
      setApplyFor(null); setApplyForm({ lbsPerAcre: '', product: 'UAN-32', timing: 'sidedress' });
      await refresh();
    } catch (e) { console.error('[N] apply', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Droplet className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Nitrogen plans</span>
        <span className="ml-auto text-[10px] text-gray-400">{plans.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.fieldId} onChange={e => setForm({ ...form, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} placeholder="Crop" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.targetLbsPerAcre} onChange={e => setForm({ ...form, targetLbsPerAcre: e.target.value })} placeholder="Target lbs/ac" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />New plan</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : plans.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Droplet className="w-6 h-6 mx-auto mb-2 opacity-30" />No nitrogen plans yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {plans.map(p => {
              const pct = p.targetLbsPerAcre > 0 ? Math.round((p.totalApplied / p.targetLbsPerAcre) * 100) : 0;
              return (
                <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2 mb-1">
                    <Droplet className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="text-sm text-white">Field {p.fieldId.slice(0, 12)}</span>
                    <span className="text-[10px] text-gray-400">{p.crop} · {p.season}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-cyan-300">{p.totalApplied}/{p.targetLbsPerAcre} lbs/ac</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={cn('h-full transition-all', pct >= 100 ? 'bg-emerald-400' : 'bg-cyan-400')} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                    <span>{p.remaining} lbs/ac remaining</span>
                    <span>{p.applications?.length || 0} applications</span>
                  </div>
                  {applyFor === p.id ? (
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      <input type="number" value={applyForm.lbsPerAcre} onChange={e => setApplyForm({ ...applyForm, lbsPerAcre: e.target.value })} placeholder="lbs/ac" className="px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" autoFocus />
                      <input value={applyForm.product} onChange={e => setApplyForm({ ...applyForm, product: e.target.value })} placeholder="Product" className="px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
                      <select value={applyForm.timing} onChange={e => setApplyForm({ ...applyForm, timing: e.target.value })} className="px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
                        <option>preplant</option><option>sidedress</option><option>topdress</option><option>fertigation</option>
                      </select>
                      <div className="flex items-center gap-1">
                        <button onClick={apply} className="flex-1 px-2 py-1 text-[11px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Apply</button>
                        <button onClick={() => setApplyFor(null)} className="px-2 py-1 text-[11px] text-gray-400">×</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setApplyFor(p.id)} className="mt-1 text-[11px] text-cyan-300 hover:text-cyan-200">+ Apply N</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NitrogenPlanner;
