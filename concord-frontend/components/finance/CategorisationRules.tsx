'use client';

import { useEffect, useState } from 'react';
import { Filter, Plus, Trash2, Loader2, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Rule {
  id: string;
  matchText: string;
  category: string;
  matchKind: 'contains' | 'starts_with' | 'regex';
  priority: number;
  createdAt: string;
}

export function CategorisationRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ matchText: '', category: '', matchKind: 'contains' as Rule['matchKind'], priority: '100' });
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ category: string; source: string } | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'rules-list', input: {} });
      setRules((res.data?.result?.rules || []) as Rule[]);
    } catch (e) { console.error('[Rules] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.matchText.trim() || !form.category.trim()) return;
    try {
      await lensRun({
        domain: 'finance', action: 'rules-create',
        input: { matchText: form.matchText.trim(), category: form.category.trim(), matchKind: form.matchKind, priority: Number(form.priority) || 100 },
      });
      setForm({ matchText: '', category: '', matchKind: 'contains', priority: '100' });
      await refresh();
    } catch (e) { console.error('[Rules] create failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'rules-delete', input: { id } });
      setRules(prev => prev.filter(r => r.id !== id));
    } catch (e) { console.error('[Rules] delete failed', e); }
  }

  async function runTest() {
    if (!testInput.trim()) return;
    try {
      const res = await lensRun({ domain: 'finance', action: 'rules-apply', input: { description: testInput } });
      setTestResult(res.data?.result || null);
    } catch (e) { console.error('[Rules] apply failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Filter className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Categorisation rules</span>
        <span className="ml-auto text-[10px] text-gray-400">{rules.length} rules</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-7 gap-2">
        <input value={form.matchText} onChange={e => setForm({ ...form, matchText: e.target.value })} placeholder="Match text" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Category" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.matchKind} onChange={e => setForm({ ...form, matchKind: e.target.value as Rule['matchKind'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="contains">contains</option>
          <option value="starts_with">starts with</option>
          <option value="regex">regex</option>
        </select>
        <input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} placeholder="Prio" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>

      <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] flex items-center gap-2">
        <input value={testInput} onChange={e => setTestInput(e.target.value)} placeholder="Test a merchant description…" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={runTest} className="px-2.5 py-1.5 text-xs rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 inline-flex items-center gap-1"><Play className="w-3 h-3" />Test</button>
        {testResult && (
          <span className="text-[11px] font-mono">
            → <span className="text-emerald-300">{testResult.category}</span>
            <span className="text-gray-400 ml-1">({testResult.source})</span>
          </span>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : rules.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Filter className="w-6 h-6 mx-auto mb-2 opacity-30" />No custom rules. The built-in categoriser handles common merchants.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rules.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                <span className="font-mono text-cyan-300 w-10 tabular-nums text-right">{r.priority}</span>
                <span className={cn('px-1.5 py-0.5 rounded text-[10px] uppercase font-mono', r.matchKind === 'regex' ? 'bg-violet-500/20 text-violet-300' : 'bg-cyan-500/15 text-cyan-300')}>{r.matchKind}</span>
                <span className="font-mono text-white truncate flex-1">"{r.matchText}"</span>
                <span className="text-gray-400">→</span>
                <span className="font-semibold text-emerald-300">{r.category}</span>
                <button aria-label="Delete" onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CategorisationRules;
