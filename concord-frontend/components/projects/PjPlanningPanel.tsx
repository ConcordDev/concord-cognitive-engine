'use client';

/**
 * PjPlanningPanel — milestones, the risk register and project goals.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Flag, AlertTriangle, Target, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Milestone { id: string; name: string; dueDate: string | null; status: string; taskCount: number; doneCount: number; progressPct: number }
interface Risk { id: string; name: string; likelihood: number; impact: number; score: number; severity: string; mitigation: string | null }
interface Goal { id: string; name: string; metric: string; target: number; current: number; progressPct: number }

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-rose-400', high: 'text-orange-400', medium: 'text-amber-400', low: 'text-zinc-400',
};

export function PjPlanningPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [mForm, setMForm] = useState({ name: '', dueDate: '' });
  const [rForm, setRForm] = useState({ name: '', likelihood: '3', impact: '3', mitigation: '' });
  const [gForm, setGForm] = useState({ name: '', metric: '', target: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, r, g] = await Promise.all([
      lensRun('projects', 'milestone-list', { projectId }),
      lensRun('projects', 'risk-list', { projectId }),
      lensRun('projects', 'goal-list', { projectId }),
    ]);
    setMilestones(m.data?.result?.milestones || []);
    setRisks(r.data?.result?.risks || []);
    setGoals(g.data?.result?.goals || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMilestone = async () => {
    if (!mForm.name.trim()) return;
    await lensRun('projects', 'milestone-create', { projectId, name: mForm.name.trim(), dueDate: mForm.dueDate });
    setMForm({ name: '', dueDate: '' });
    await refresh();
  };
  const addRisk = async () => {
    if (!rForm.name.trim()) return;
    await lensRun('projects', 'risk-add', {
      projectId, name: rForm.name.trim(), likelihood: Number(rForm.likelihood),
      impact: Number(rForm.impact), mitigation: rForm.mitigation.trim(),
    });
    setRForm({ name: '', likelihood: '3', impact: '3', mitigation: '' });
    await refresh();
  };
  const addGoal = async () => {
    if (!gForm.name.trim()) return;
    await lensRun('projects', 'goal-create', {
      projectId, name: gForm.name.trim(), metric: gForm.metric.trim() || 'progress',
      target: Number(gForm.target) || 100, current: 0,
    });
    setGForm({ name: '', metric: '', target: '' });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Milestones */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Flag className="w-3.5 h-3.5 text-indigo-400" /> Milestones
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
          <input placeholder="Milestone" value={mForm.name} onChange={(e) => setMForm({ ...mForm, name: e.target.value })} className={inp} />
          <input type="date" value={mForm.dueDate} onChange={(e) => setMForm({ ...mForm, dueDate: e.target.value })} className={inp} />
          <button type="button" onClick={addMilestone} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {milestones.length === 0 ? <Empty text="No milestones." /> : (
          <ul className="space-y-1.5">
            {milestones.map((m) => (
              <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-zinc-100 flex-1">{m.name}</span>
                  {m.dueDate && <span className="text-[10px] text-zinc-400">{m.dueDate}</span>}
                  <button type="button"
                    onClick={() => lensRun('projects', 'milestone-complete', { id: m.id, reopen: m.status === 'completed' }).then(refresh)}
                    className={cn('text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1',
                      m.status === 'completed' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-800 text-zinc-300')}>
                    <CheckCircle2 className="w-3 h-3" />{m.status === 'completed' ? 'Done' : 'Mark'}
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'milestone-delete', { id: m.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${m.progressPct}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-400">{m.doneCount}/{m.taskCount}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Risks */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Risk register
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <input placeholder="Risk" value={rForm.name} onChange={(e) => setRForm({ ...rForm, name: e.target.value })}
            className={cn(inp, 'col-span-2')} />
          <select value={rForm.likelihood} onChange={(e) => setRForm({ ...rForm, likelihood: e.target.value })} className={inp}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Likelihood {n}</option>)}
          </select>
          <select value={rForm.impact} onChange={(e) => setRForm({ ...rForm, impact: e.target.value })} className={inp}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Impact {n}</option>)}
          </select>
          <button type="button" onClick={addRisk} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {risks.length === 0 ? <Empty text="No risks logged." /> : (
          <ul className="space-y-1">
            {risks.map((r) => (
              <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className={cn('text-[10px] font-bold uppercase w-14', SEVERITY_COLOR[r.severity])}>{r.severity}</span>
                <span className="text-xs text-zinc-200 flex-1 truncate">{r.name}</span>
                <span className="text-[10px] text-zinc-400">L{r.likelihood}×I{r.impact} = {r.score}</span>
                <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'risk-delete', { id: r.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Goals */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-emerald-400" /> Goals
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Goal" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} className={inp} />
          <input placeholder="Metric" value={gForm.metric} onChange={(e) => setGForm({ ...gForm, metric: e.target.value })} className={inp} />
          <input placeholder="Target" inputMode="numeric" value={gForm.target}
            onChange={(e) => setGForm({ ...gForm, target: e.target.value })} className={inp} />
          <button type="button" onClick={addGoal} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {goals.length === 0 ? <Empty text="No goals." /> : (
          <ul className="space-y-1.5">
            {goals.map((g) => (
              <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-zinc-100 flex-1">{g.name}</span>
                  <input type="number" defaultValue={g.current}
                    onBlur={(e) => lensRun('projects', 'goal-update-progress', { id: g.id, current: Number(e.target.value) }).then(refresh)}
                    className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-100" />
                  <span className="text-[10px] text-zinc-400">/ {g.target} {g.metric}</span>
                  <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'goal-delete', { id: g.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, g.progressPct)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inp = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';
const btn = 'flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg';
function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-zinc-400 italic">{text}</p>;
}
