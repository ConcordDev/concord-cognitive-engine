'use client';

/**
 * PjMilestonesPanel — release milestones with task-completion progress.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Flag, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Milestone {
  id: string; name: string; dueDate: string | null; status: string;
  taskCount: number; doneCount: number; progressPct: number;
}

export function PjMilestonesPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', dueDate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'milestone-list', { projectId });
    setMilestones(r.data?.result?.milestones || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMilestone = async () => {
    if (!form.name.trim()) { setError('Milestone name is required.'); return; }
    const r = await lensRun('projects', 'milestone-create', { projectId, name: form.name.trim(), dueDate: form.dueDate });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', dueDate: '' });
    setError(null);
    await refresh();
  };

  const toggle = async (m: Milestone) => {
    await lensRun('projects', 'milestone-complete', { id: m.id, reopen: m.status === 'completed' });
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('projects', 'milestone-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Milestone name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addMilestone}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Milestone
        </button>
      </section>

      {milestones.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No milestones yet.</p>
      ) : (
        <ul className="space-y-2">
          {milestones.map((m) => (
            <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Flag className={cn('w-4 h-4 shrink-0', m.status === 'completed' ? 'text-emerald-400' : 'text-indigo-400')} />
                <span className="text-sm font-semibold text-zinc-100 flex-1">{m.name}</span>
                {m.dueDate && <span className="text-[10px] text-zinc-500">{m.dueDate}</span>}
                <button type="button" onClick={() => toggle(m)}
                  className={cn('flex items-center gap-1 text-[10px] px-2 py-0.5 rounded',
                    m.status === 'completed' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200')}>
                  <CheckCircle2 className="w-3 h-3" /> {m.status === 'completed' ? 'Done' : 'Mark done'}
                </button>
                <button type="button" onClick={() => del(m.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${m.progressPct}%` }} />
                </div>
                <span className="text-[10px] text-zinc-500">{m.doneCount}/{m.taskCount} tasks</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
