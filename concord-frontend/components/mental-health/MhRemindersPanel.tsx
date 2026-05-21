'use client';

/**
 * MhRemindersPanel — daily reminders for check-ins, breathing, gratitude,
 * journaling and meditation, plus a "due today" view of outstanding ones.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Bell, Plus, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reminder { id: string; kind: string; time: string; enabled: boolean }
interface DueItem { id: string; kind: string; time: string }
interface DueResult { due: DueItem[]; doneToday: Record<string, boolean>; total: number }

const KINDS = ['mood', 'breathing', 'gratitude', 'journal', 'meditation'] as const;

export function MhRemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [due, setDue] = useState<DueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<typeof KINDS[number]>('mood');
  const [time, setTime] = useState('20:00');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, d] = await Promise.all([
      lensRun('mental-health', 'reminder-list', {}),
      lensRun('mental-health', 'reminder-due', {}),
    ]);
    setReminders(l.data?.result?.reminders || []);
    setDue((d.data?.result as DueResult | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    const r = await lensRun('mental-health', 'reminder-set', { kind, time });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  const toggle = async (rem: Reminder) => {
    await lensRun('mental-health', 'reminder-set', { id: rem.id, kind: rem.kind, time: rem.time, enabled: !rem.enabled });
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('mental-health', 'reminder-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Due today */}
      {due && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Bell className="w-3.5 h-3.5 text-sky-400" /> Today
          </h3>
          {due.total === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No reminders set. Add one below.</p>
          ) : due.due.length === 0 ? (
            <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-emerald-200">All caught up — every reminder is done for today.</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {due.due.map((d) => (
                <li key={d.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-xs text-zinc-200 capitalize flex-1">{d.kind} check-in</span>
                  <span className="text-[11px] font-mono text-zinc-500">{d.time}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Add reminder */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">New reminder</h3>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex gap-1">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </section>

      {/* All reminders */}
      {reminders.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">All reminders</h3>
          <ul className="space-y-1.5">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => toggle(r)}
                  className={cn('w-9 h-5 rounded-full p-0.5 transition-colors', r.enabled ? 'bg-sky-600' : 'bg-zinc-700')}
                  aria-label={r.enabled ? 'Disable reminder' : 'Enable reminder'}>
                  <span className={cn('block w-4 h-4 rounded-full bg-white transition-transform', r.enabled && 'translate-x-4')} />
                </button>
                <span className={cn('text-xs capitalize flex-1', r.enabled ? 'text-zinc-200' : 'text-zinc-500')}>{r.kind}</span>
                <span className="text-[11px] font-mono text-zinc-500">{r.time}</span>
                <button type="button" onClick={() => del(r.id)} className="text-zinc-500 hover:text-rose-400" aria-label="Delete reminder">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
