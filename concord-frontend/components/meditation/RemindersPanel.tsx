'use client';

/**
 * RemindersPanel — scheduled practice reminders. Wires meditation.setReminder,
 * meditation.reminders (list + next-fire computation), meditation.toggleReminder,
 * meditation.updateReminder (edit in place, S-MED-3 — fixing a time used to
 * mean delete + recreate) and meditation.deleteReminder (two-step: a delete
 * confirms first, per F4). The browser Notification API is used to fire a
 * local notification when a reminder's next-fire time arrives while the tab is
 * open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reminder {
  id: string; time: string; days: string[]; label: string; enabled: boolean; createdAt: string;
}
interface NextFire { reminderId: string; label: string; at: number; iso: string }
interface RemindersResult {
  reminders: Reminder[]; count: number; nextFire: NextFire | null; dueToday: number;
}

const DOW: { id: string; label: string }[] = [
  { id: 'mon', label: 'M' }, { id: 'tue', label: 'T' }, { id: 'wed', label: 'W' },
  { id: 'thu', label: 'T' }, { id: 'fri', label: 'F' }, { id: 'sat', label: 'S' }, { id: 'sun', label: 'S' },
];

export function RemindersPanel() {
  const [data, setData] = useState<RemindersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState('08:00');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('08:00');
  const [editLabel, setEditLabel] = useState('');
  const [editDays, setEditDays] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const firedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('meditation', 'reminders', {});
    setData((r.data?.result as RemindersResult) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
  }, []);

  // Fire a local notification when a reminder's next-fire moment passes.
  useEffect(() => {
    const next = data?.nextFire;
    if (!next || permission !== 'granted') return;
    const delay = next.at - Date.now();
    if (delay < 0 || delay > 24 * 3600 * 1000) return;
    const key = `${next.reminderId}:${next.iso}`;
    if (firedRef.current.has(key)) return;
    const t = window.setTimeout(() => {
      firedRef.current.add(key);
      try {
        new Notification(next.label || 'Time to meditate', { body: 'Your scheduled practice is ready.' });
      } catch { /* notification blocked */ }
      void load();
    }, delay);
    return () => window.clearTimeout(t);
  }, [data, permission, load]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }, []);

  const toggleDay = (d: string) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const addReminder = useCallback(async () => {
    if (!time) return;
    setBusy(true);
    await lensRun('meditation', 'setReminder', {
      time,
      days,
      label: label.trim() || undefined,
    });
    setLabel('');
    await load();
    setBusy(false);
  }, [time, days, label, load]);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    setBusy(true);
    await lensRun('meditation', 'toggleReminder', { reminderId: id, enabled: !enabled });
    await load();
    setBusy(false);
  }, [load]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    await lensRun('meditation', 'deleteReminder', { reminderId: id });
    setConfirmDeleteId(null);
    await load();
    setBusy(false);
  }, [load]);

  const beginEdit = useCallback((r: Reminder) => {
    setEditId(r.id);
    setEditTime(r.time);
    setEditLabel(r.label);
    setEditDays(r.days);
    setConfirmDeleteId(null);
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    setBusy(true);
    await lensRun('meditation', 'updateReminder', {
      reminderId: id, time: editTime, days: editDays, label: editLabel.trim() || undefined,
    });
    setEditId(null);
    await load();
    setBusy(false);
  }, [editTime, editDays, editLabel, load]);

  const toggleEditDay = (d: string) =>
    setEditDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  const next = data?.nextFire;

  return (
    <div className="rounded-2xl border border-rose-900/40 bg-gradient-to-b from-rose-950/15 to-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-rose-300" />
        <h3 className="text-sm font-bold text-zinc-100">Practice Reminders</h3>
        {data && data.dueToday > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-200">{data.dueToday} due today</span>
        )}
      </div>

      {next && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 mb-3 text-[11px] text-zinc-400">
          Next: <strong className="text-zinc-200">{next.label}</strong> at{' '}
          {new Date(next.iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {permission !== 'granted' && (
        <button type="button" onClick={requestPermission}
          className="w-full mb-3 px-3 py-1.5 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
          Enable browser notifications for reminders
        </button>
      )}

      {/* New reminder form */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100" />
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-rose-500/40" />
        </div>
        <div className="flex gap-1">
          {DOW.map((d) => (
            <button key={d.id} type="button" onClick={() => toggleDay(d.id)}
              className={cn('w-7 h-7 rounded text-[11px]', days.includes(d.id) ? 'bg-rose-600 text-white' : 'bg-zinc-950 text-zinc-400')}>
              {d.label}
            </button>
          ))}
          <button type="button" onClick={addReminder} disabled={busy || days.length === 0}
            className="ml-auto px-2.5 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* Reminder list */}
      {data && data.reminders.length > 0 ? (
        <ul className="space-y-1.5">
          {data.reminders.map((r) => (
            <li key={r.id}
              className={cn('flex flex-wrap items-center gap-2.5 rounded-lg px-2.5 py-2 border',
                r.enabled ? 'bg-zinc-900/60 border-zinc-800' : 'bg-zinc-950/50 border-zinc-900 opacity-60')}>
              <span className="text-sm font-mono text-zinc-100 w-12">{r.time}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-zinc-200 truncate">{r.label}</p>
                <p className="text-[10px] text-zinc-400">
                  {r.days.length === 7 ? 'Every day' : r.days.join(' · ')}
                </p>
              </div>
              <button type="button" onClick={() => toggle(r.id, r.enabled)} disabled={busy}
                className="p-1 rounded hover:bg-zinc-800" aria-label={r.enabled ? 'Disable' : 'Enable'}>
                {r.enabled ? <Bell className="w-3.5 h-3.5 text-rose-300" /> : <BellOff className="w-3.5 h-3.5 text-zinc-400" />}
              </button>
              <button type="button" onClick={() => beginEdit(r)} disabled={busy}
                className="p-1 rounded hover:bg-zinc-800" aria-label="Edit">
                <Pencil className="w-3.5 h-3.5 text-zinc-400 hover:text-rose-300" />
              </button>
              {confirmDeleteId === r.id ? (
                <>
                  <button type="button" onClick={() => remove(r.id)} disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600 text-white">Delete?</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">Keep</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(r.id)} disabled={busy}
                  className="p-1 rounded hover:bg-zinc-800" aria-label="Delete">
                  <Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-rose-400" />
                </button>
              )}
              {editId === r.id && (
                <div className="basis-full mt-2 bg-zinc-950/60 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100" />
                    <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label (optional)"
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-rose-500/40" />
                  </div>
                  <div className="flex gap-1 items-center">
                    {DOW.map((d) => (
                      <button key={d.id} type="button" onClick={() => toggleEditDay(d.id)}
                        className={cn('w-7 h-7 rounded text-[11px]', editDays.includes(d.id) ? 'bg-rose-600 text-white' : 'bg-zinc-950 text-zinc-400')}>
                        {d.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => saveEdit(r.id)} disabled={busy || editDays.length === 0}
                      className="ml-auto px-2.5 py-1 text-[11px] rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">
                      Save changes
                    </button>
                    <button type="button" onClick={() => setEditId(null)} disabled={busy}
                      className="px-2.5 py-1 text-[11px] rounded bg-zinc-800 text-zinc-300">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400 text-center py-2">No reminders yet — add one above.</p>
      )}
    </div>
  );
}
