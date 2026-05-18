'use client';

import { useEffect, useState, useCallback } from 'react';
import { callBrowserAgentMacro } from '@/lib/api/browser-agent';
import { Loader2, X, Plus, Repeat, Play, Trash2 } from 'lucide-react';

interface Schedule {
  id: string; title: string; goal: string;
  cadence_kind: string; cadence_param: string;
  next_run_at: number; last_run_at?: number | null; run_count: number;
  enabled: number;
}

interface Props { open: boolean; onClose: () => void; }

export function BrowserSchedulesPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: '', goal: '',
    cadenceKind: 'every_n_hours' as 'every_n_hours' | 'daily' | 'weekly',
    cadenceParam: '6',
    maxSteps: 20, maxCostCents: 50,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await callBrowserAgentMacro<{ schedules?: Schedule[] }>('schedule_list');
    setItems(r?.schedules || []);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const submit = useCallback(async () => {
    if (!draft.title.trim() || !draft.goal.trim()) return;
    setBusy(true);
    try {
      await callBrowserAgentMacro('schedule_create', draft);
      setCreating(false); setDraft({ ...draft, title: '', goal: '' });
      load();
    } finally { setBusy(false); }
  }, [draft, load]);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    await callBrowserAgentMacro('schedule_toggle', { id, enabled });
    load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete schedule?')) return;
    await callBrowserAgentMacro('schedule_delete', { id });
    load();
  }, [load]);

  const runNow = useCallback(async (id: string) => {
    await callBrowserAgentMacro('schedule_run_now', { id });
    load();
  }, [load]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Repeat className="w-4 h-4 text-cyan-400" /> Scheduled tasks</h3>
          <div className="flex items-center gap-2">
            {!creating && <button onClick={() => setCreating(true)} className="px-2 py-1 text-xs rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 flex items-center gap-1"><Plus className="w-3 h-3" /> New</button>}
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {creating && (
            <div className="border border-cyan-500/30 rounded p-3 space-y-2 bg-cyan-500/5">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Schedule title" autoFocus className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
              <textarea value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} rows={3} placeholder="Goal (what the agent does each run)" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none" />
              <div className="grid grid-cols-2 gap-2">
                <select value={draft.cadenceKind} onChange={(e) => setDraft({ ...draft, cadenceKind: e.target.value as typeof draft.cadenceKind, cadenceParam: e.target.value === 'daily' ? '09:00' : e.target.value === 'weekly' ? 'MO,09:00' : '6' })} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                  <option value="every_n_hours" className="bg-black">Every N hours</option>
                  <option value="daily" className="bg-black">Daily at HH:MM</option>
                  <option value="weekly" className="bg-black">Weekly DAY,HH:MM</option>
                </select>
                <input value={draft.cadenceParam} onChange={(e) => setDraft({ ...draft, cadenceParam: e.target.value })} placeholder={draft.cadenceKind === 'every_n_hours' ? '6' : draft.cadenceKind === 'daily' ? '09:00' : 'MO,09:00'} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setCreating(false)} className="flex-1 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
                <button onClick={submit} disabled={busy || !draft.title.trim() || !draft.goal.trim()} className="flex-1 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Create'}</button>
              </div>
            </div>
          )}
          {items.length === 0 && !creating && <div className="text-center text-white/40 text-sm py-8">No scheduled tasks yet.</div>}
          {items.map((s) => (
            <div key={s.id} className="border border-white/10 rounded p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${s.enabled ? 'bg-green-400' : 'bg-zinc-500'}`} />
                <div className="flex-1">
                  <div className="text-sm text-white font-medium">{s.title}</div>
                  <div className="text-xs text-white/50">{s.cadence_kind.replace(/_/g, ' ')} · {s.cadence_param}</div>
                </div>
                <button onClick={() => runNow(s.id)} className="p-1.5 rounded hover:bg-white/10 text-cyan-300" title="Run now"><Play className="w-3.5 h-3.5" /></button>
                <button onClick={() => toggle(s.id, !s.enabled)} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/70">{s.enabled ? 'Disable' : 'Enable'}</button>
                <button onClick={() => remove(s.id)} className="p-1.5 rounded hover:bg-red-500/20 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="text-xs text-white/60 truncate">{s.goal}</div>
              <div className="text-xs text-white/40 flex gap-3">
                <span>Next: {new Date(s.next_run_at * 1000).toLocaleString()}</span>
                <span>Runs: {s.run_count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
