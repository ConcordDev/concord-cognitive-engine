'use client';

import { useEffect, useState } from 'react';
import { Workflow, Plus, Trash2, Loader2, ArrowRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Rule { id: string; category: string; departmentId: string; departmentName: string }
interface Department { id: string; name: string }

const CATEGORIES = ['pothole', 'streetlight_out', 'graffiti', 'trash_missed', 'tree_down', 'noise_complaint', 'abandoned_vehicle', 'sidewalk_damage', 'traffic_signal', 'water_leak', 'illegal_dumping', 'park_maintenance', 'animal_control', 'other'];

export function RoutingRulesPanel() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ category: 'pothole', departmentId: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        lensRun({ domain: 'government', action: 'routing-rules-list', input: {} }),
        lensRun({ domain: 'government', action: 'departments-list', input: {} }),
      ]);
      setRules((r.data?.result?.rules || []) as Rule[]);
      setDepts((d.data?.result?.departments || []) as Department[]);
    } catch (e) { console.error('[Rules] failed', e); }
    finally { setLoading(false); }
  }

  async function set() {
    if (!form.departmentId) return;
    try {
      const res = await lensRun({ domain: 'government', action: 'routing-rules-set', input: form });
      if (res.data?.ok === false) alert(res.data?.error);
      await refresh();
    } catch (e) { console.error('[Rules] set', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'routing-rules-delete', input: { id } });
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (e) { console.error('[Rules] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Workflow className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Routing rules · auto-assign 311 requests</span>
        <span className="ml-auto text-[10px] text-gray-400">{rules.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-3 gap-2">
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select department…</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={set} disabled={!form.departmentId} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Set rule</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : rules.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Workflow className="w-6 h-6 mx-auto mb-2 opacity-30" />No routing rules yet. New SRs will sit unassigned.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rules.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                <span className="font-mono text-amber-300 capitalize">{r.category.replace(/_/g, ' ')}</span>
                <ArrowRight className="w-3 h-3 text-gray-400" />
                <span className="text-white">{r.departmentName}</span>
                <button aria-label="Delete" onClick={() => remove(r.id)} className="ml-auto opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RoutingRulesPanel;
