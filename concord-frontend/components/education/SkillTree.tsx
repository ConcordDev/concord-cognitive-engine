'use client';

import { useEffect, useState } from 'react';
import { Target, Plus, Loader2, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Skill {
  id: string; name: string; subject: string;
  mastery: 'not_started' | 'attempted' | 'familiar' | 'proficient' | 'mastered';
  attempts: number; lastPracticedAt: string | null;
}

const MASTERY_COLOURS: Record<Skill['mastery'], string> = {
  not_started: 'bg-gray-500/15 text-gray-400',
  attempted: 'bg-blue-500/15 text-blue-300',
  familiar: 'bg-cyan-500/20 text-cyan-300',
  proficient: 'bg-emerald-500/20 text-emerald-300',
  mastered: 'bg-amber-500/20 text-amber-300',
};

const MASTERY_BARS: Record<Skill['mastery'], number> = {
  not_started: 0, attempted: 25, familiar: 50, proficient: 75, mastered: 100,
};

export function SkillTree() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', subject: 'math' });
  const [subjectFilter, setSubjectFilter] = useState('');

  useEffect(() => { refresh(); }, [subjectFilter]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'skills-tree', input: subjectFilter ? { subject: subjectFilter } : {} });
      setSkills((res.data?.result?.skills || []) as Skill[]);
      setCounts(res.data?.result?.counts || {});
    } catch (e) { console.error('[Skills] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim()) return;
    try {
      await lensRun({ domain: 'education', action: 'skills-create', input: form });
      setForm({ name: '', subject: form.subject });
      await refresh();
    } catch (e) { console.error('[Skills] add failed', e); }
  }

  async function practice(id: string, success: boolean) {
    try {
      await lensRun({ domain: 'education', action: 'skills-practice', input: { id, success } });
      await refresh();
    } catch (e) { console.error('[Skills] practice failed', e); }
  }

  const subjects = [...new Set(skills.map(s => s.subject))];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Skill tree · mastery</span>
        <span className="ml-auto text-[10px] text-gray-500">{skills.length} skills</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2 text-xs">
        {(['not_started', 'attempted', 'familiar', 'proficient', 'mastered'] as const).map(lvl => (
          <div key={lvl} className={cn('rounded px-2 py-1.5', MASTERY_COLOURS[lvl])}>
            <div className="text-[9px] uppercase tracking-wider opacity-70">{lvl.replace('_', ' ')}</div>
            <div className="text-lg font-mono tabular-nums">{counts[lvl] || 0}</div>
          </div>
        ))}
      </div>

      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="New skill" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className="w-28 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
        <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All subjects</option>
          {subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Target className="w-6 h-6 mx-auto mb-2 opacity-30" />No skills yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {skills.map(s => (
              <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm text-white font-medium flex-1 truncate">{s.name}</span>
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{s.subject}</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', MASTERY_COLOURS[s.mastery])}>{s.mastery.replace('_', ' ')}</span>
                  <button onClick={() => practice(s.id, true)} className="p-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30" title="Correct"><Check className="w-3 h-3" /></button>
                  <button onClick={() => practice(s.id, false)} className="p-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30" title="Wrong"><X className="w-3 h-3" /></button>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={cn('h-full transition-all', s.mastery === 'mastered' ? 'bg-amber-400' : s.mastery === 'proficient' ? 'bg-emerald-400' : 'bg-cyan-400')} style={{ width: `${MASTERY_BARS[s.mastery]}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[9px] text-gray-500">
                  <span>{s.attempts} attempts</span>
                  {s.lastPracticedAt && <span>last: {new Date(s.lastPracticedAt).toLocaleDateString()}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SkillTree;
