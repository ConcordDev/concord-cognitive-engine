'use client';

/**
 * RecurringTemplates — Sweepy-shape recurring task templates by frequency.
 * Real CRUD against household.task-template-create / -list / -delete and
 * task-template-spawn, which materialises a template into a live chore task.
 */

import { useCallback, useEffect, useState } from 'react';
import { Repeat, Plus, Trash2, Loader2, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Template {
  id: string; name: string; frequency: string; room: string | null;
  assignee: string | null; effort: string; notes: string; lastSpawnedAt: string | null;
}

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const;
const EFFORTS = ['light', 'medium', 'heavy'] as const;

export function RecurringTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [spawned, setSpawned] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', frequency: 'weekly', room: '', assignee: '', effort: 'medium' });

  const refresh = useCallback(async () => {
    const r = await lensRun<{ templates: Template[] }>('household', 'task-template-list', {});
    if (r.data?.ok) setTemplates(r.data.result?.templates || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    await lensRun('household', 'task-template-create', {
      name: form.name.trim(), frequency: form.frequency,
      room: form.room.trim() || undefined, assignee: form.assignee.trim() || undefined, effort: form.effort,
    });
    setForm({ ...form, name: '', room: '', assignee: '' });
    setBusy(false);
    await refresh();
  }
  async function del(id: string) {
    await lensRun('household', 'task-template-delete', { id });
    await refresh();
  }
  async function spawn(t: Template) {
    const r = await lensRun<{ task: { name: string }; room: { name: string } }>('household', 'task-template-spawn', { id: t.id });
    if (r.data?.ok && r.data.result) {
      setSpawned(`"${r.data.result.task.name}" added to the ${r.data.result.room.name} chore board`);
      setTimeout(() => setSpawned(null), 4000);
    }
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Repeat className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Recurring Task Templates</h3>
        <span className="text-[11px] text-zinc-500">{templates.length}</span>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex gap-1.5 flex-wrap">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') void add(); }} placeholder="Template name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} placeholder="Room"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })} placeholder="Who"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.effort} onChange={e => setForm({ ...form, effort: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {EFFORTS.map(ef => <option key={ef} value={ef}>{ef}</option>)}
        </select>
        <button onClick={add} disabled={busy || !form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add
        </button>
      </div>

      {spawned && <p className="mb-2 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded px-2 py-1">{spawned}</p>}

      {templates.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">No data yet — define a recurring task template above, then spawn it onto the chore board.</p>
      ) : (
        <ul className="space-y-1">
          {templates.map(t => (
            <li key={t.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{t.name}</p>
                <p className="text-[10px] text-zinc-500">
                  <span className="text-cyan-400">{t.frequency}</span>
                  {t.room ? ` · ${t.room}` : ''}{t.assignee ? ` · ${t.assignee}` : ''} · {t.effort}
                  {t.lastSpawnedAt && ` · last spawned ${new Date(t.lastSpawnedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button onClick={() => spawn(t)} title="Spawn onto chore board"
                className={cn('px-2 py-1 text-[11px] rounded inline-flex items-center gap-1',
                  'bg-cyan-700/40 hover:bg-cyan-600 text-cyan-200 hover:text-white')}>
                <Zap className="w-3 h-3" />Spawn
              </button>
              <button onClick={() => del(t.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
