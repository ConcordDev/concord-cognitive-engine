'use client';

/**
 * ProductivityRemindersPanel — time and location-based task reminders.
 * Reminders attach to a real task and persist via productivity.reminder-*
 * macros.
 *
 * Two delivery paths, both honest about what they actually are:
 *  - LIVE: the productivity-reminder-sweep heartbeat (server/domains/
 *    productivity.js) pushes a `productivity:reminder-fired` socket event
 *    to this user's room the moment a reminder becomes due, ~30s cadence.
 *    That only reaches a tab that is currently open and connected — it is
 *    NOT an OS-level push/desktop notification (this codebase has no
 *    service-worker Web Push pipeline), so it is labeled "while this tab
 *    is open" rather than implied to work when the app is closed.
 *  - MANUAL: "Check what's due now" calls reminders-due directly — the
 *    original path, kept exactly as-is as the fallback for reminders that
 *    fired while this tab was closed or disconnected.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Bell, BellRing, MapPin, Clock, Trash2, Plus, Radio } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';
import { useUIStore } from '@/store/ui';

interface Reminder {
  id: string;
  taskId: string | null;
  kind: 'time' | 'location';
  remindAt: string;
  location: string | null;
  note: string;
  fired: boolean;
  task: string | null;
}
interface TaskOption { id: string; content: string }
interface LiveFiredReminder { id: string; task: string | null; note: string; remindAt: string; receivedAt: number }
interface ReminderFiredPayload {
  userId?: string;
  reminder?: { id: string; taskId: string | null; task: string | null; remindAt: string; note: string; kind: string };
}

export function ProductivityRemindersPanel({ onChange }: { onChange: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [due, setDue] = useState<Reminder[]>([]);
  const [liveFired, setLiveFired] = useState<LiveFiredReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ taskId: '', kind: 'time' as 'time' | 'location', remindAt: '', location: '', note: '' });
  const { on, off, isConnected } = useSocket({ autoConnect: true });
  const addToast = useUIStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, t] = await Promise.all([
      lensRun('productivity', 'reminder-list', {}),
      lensRun('productivity', 'task-list', {}),
    ]);
    setReminders(r.data?.result?.reminders || []);
    setTasks((t.data?.result?.tasks || []).map((x: { id: string; content: string }) => ({ id: x.id, content: x.content })));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live delivery: the productivity-reminder-sweep heartbeat pushes this
  // event to `user:<id>` the instant a reminder becomes due. Only fires
  // while this tab is connected — see the module doc comment above.
  useEffect(() => {
    const handleFired = (payload: unknown) => {
      const p = payload as ReminderFiredPayload;
      const rem = p?.reminder;
      if (!rem?.id) return;
      setLiveFired((prev) => [
        { id: rem.id, task: rem.task, note: rem.note, remindAt: rem.remindAt, receivedAt: Date.now() },
        ...prev,
      ].slice(0, 5));
      addToast({
        type: 'info',
        message: `Reminder: ${rem.task || rem.note || 'Untitled reminder'}`,
        duration: 10000,
      });
      void refresh();
      onChange();
    };
    on('productivity:reminder-fired', handleFired);
    return () => off('productivity:reminder-fired', handleFired);
  }, [on, off, refresh, onChange, addToast]);

  const add = async () => {
    if (!form.remindAt.trim()) { setError('Reminder time is required.'); return; }
    const r = await lensRun('productivity', 'reminder-add', {
      taskId: form.taskId || undefined,
      kind: form.kind,
      remindAt: form.remindAt,
      location: form.kind === 'location' ? form.location : undefined,
      note: form.note,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to add reminder.'); return; }
    setForm({ taskId: '', kind: 'time', remindAt: '', location: '', note: '' });
    setError(null);
    await refresh();
    onChange();
  };
  const del = async (id: string) => {
    await lensRun('productivity', 'reminder-delete', { id });
    await refresh();
  };
  const checkDue = async () => {
    const r = await lensRun('productivity', 'reminders-due', { markFired: true });
    setDue(r.data?.result?.due || []);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Add reminder */}
      <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'time' | 'location' })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="time">Time-based</option>
          <option value="location">Location-based</option>
        </select>
        <select value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No linked task</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.content}</option>)}
        </select>
        <input type="datetime-local" value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })}
          aria-label="Remind at"
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        {form.kind === 'location' ? (
          <input placeholder="Location (e.g. Office)" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        ) : (
          <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        )}
        {form.kind === 'location' && (
          <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        )}
        <button type="button" onClick={add}
          className="col-span-2 flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add reminder
        </button>
      </div>

      {/* Honest live-vs-manual delivery labeling */}
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <Radio className={cn('w-3 h-3', isConnected ? 'text-emerald-400' : 'text-zinc-600')} />
        <span>
          {isConnected
            ? 'Live reminders — while this tab is open, reminders notify you instantly.'
            : 'Live delivery is offline right now — reminders will still fire, but only the manual check below will surface them until this tab reconnects.'}
        </span>
      </div>

      {liveFired.length > 0 && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold flex items-center gap-1">
            <Radio className="w-3 h-3" /> Live — delivered just now
          </p>
          {liveFired.map((f) => (
            <p key={`${f.id}-${f.receivedAt}`} className="text-xs text-emerald-200">
              <BellRing className="inline w-3 h-3 mr-1" />{f.task || f.note || 'Reminder'} — {f.remindAt}
            </p>
          ))}
        </div>
      )}

      <button type="button" onClick={checkDue}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
        <BellRing className="w-3.5 h-3.5" /> Check what is due now
      </button>
      <p className="text-[10px] text-zinc-500 -mt-2">
        Fallback for reminders that fired while this tab was closed or disconnected.
      </p>

      {due.length > 0 && (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Fired reminders</p>
          {due.map((d) => (
            <p key={d.id} className="text-xs text-amber-200">
              <BellRing className="inline w-3 h-3 mr-1" />{d.task || d.note || 'Reminder'} — {d.remindAt}
            </p>
          ))}
        </div>
      )}

      {/* Reminder list */}
      {reminders.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-8 border border-zinc-800 rounded-xl">
          No reminders yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {reminders.map((r) => (
            <li key={r.id} className={cn('flex items-center gap-2 bg-zinc-900/70 border rounded-lg px-3 py-2',
              r.fired ? 'border-zinc-800 opacity-60' : 'border-zinc-800')}>
              {r.kind === 'location'
                ? <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                : <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-200 truncate">
                  {r.task || r.note || (r.kind === 'location' ? r.location : 'Reminder')}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {r.remindAt}{r.location ? ` · ${r.location}` : ''}{r.fired ? ' · fired' : ''}
                </p>
              </div>
              {r.fired && <Bell className="w-3 h-3 text-zinc-600 shrink-0" />}
              <button aria-label="Delete" type="button" onClick={() => del(r.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
