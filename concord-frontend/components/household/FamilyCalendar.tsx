'use client';

/**
 * FamilyCalendar — Cozi-shape shared family calendar. Real CRUD against the
 * household.calendar-event-* macros plus calendar-upcoming-reminders. Events
 * carry per-member colour, recurrence, location and a reminder window.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2, Edit3, Bell, MapPin, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CalEvent {
  id: string; title: string; date: string; time: string | null; endDate: string | null;
  assignee: string | null; location: string | null; color: string;
  recurrence: string; reminderMinutes: number; notes: string;
}
interface Reminder { eventId: string; title: string; date: string; time: string | null; assignee: string | null; minutesUntil: number }

const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
const RECURRENCE = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const REMINDER_OPTS = [
  { v: 0, l: 'No reminder' }, { v: 15, l: '15 min before' }, { v: 30, l: '30 min before' },
  { v: 60, l: '1 hour before' }, { v: 1440, l: '1 day before' },
];

const emptyForm = {
  id: '', title: '', date: '', time: '', endDate: '', assignee: '', location: '',
  color: COLORS[0], recurrence: 'none', reminderMinutes: 0, notes: '',
};

function monthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const cells: { date: string; day: number; inMonth: boolean }[] = [];
  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d.toISOString().slice(0, 10), day: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= lastDate; d++) {
    cells.push({ date: new Date(year, month, d).toISOString().slice(0, 10), day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month, lastDate + (cells.length - startPad - lastDate) + 1);
    cells.push({ date: d.toISOString().slice(0, 10), day: d.getDate(), inMonth: false });
  }
  return cells;
}

export function FamilyCalendar() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<typeof emptyForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const refresh = useCallback(async () => {
    const [el, rl] = await Promise.all([
      lensRun<{ events: CalEvent[] }>('household', 'calendar-event-list', {}),
      lensRun<{ reminders: Reminder[] }>('household', 'calendar-upcoming-reminders', {}),
    ]);
    if (el.data?.ok) setEvents(el.data.result?.events || []);
    if (rl.data?.ok) setReminders(rl.data.result?.reminders || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const cells = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e); }
    return m;
  }, [events]);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    if (!editing || !editing.title.trim() || !editing.date) return;
    setBusy(true);
    const params: Record<string, unknown> = {
      title: editing.title.trim(), date: editing.date, time: editing.time || undefined,
      endDate: editing.endDate || undefined, assignee: editing.assignee || undefined,
      location: editing.location || undefined, color: editing.color,
      recurrence: editing.recurrence, reminderMinutes: editing.reminderMinutes, notes: editing.notes,
    };
    if (editing.id) await lensRun('household', 'calendar-event-update', { id: editing.id, ...params });
    else await lensRun('household', 'calendar-event-create', params);
    setEditing(null); setBusy(false);
    await refresh();
  }
  async function del(id: string) {
    if (!confirm('Delete this event?')) return;
    await lensRun('household', 'calendar-event-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Family Calendar</h3>
        <span className="text-[11px] text-zinc-400">Cozi shape</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setCursor(c => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m }; })}
            className="p-1 rounded text-zinc-400 hover:bg-zinc-800" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-xs text-zinc-300 w-32 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(c => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m }; })}
            className="p-1 rounded text-zinc-400 hover:bg-zinc-800" aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setEditing({ ...emptyForm, date: today })}
            className="px-2.5 py-1 text-xs rounded-lg bg-sky-700 hover:bg-sky-600 text-white inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Event
          </button>
        </div>
      </div>

      {reminders.length > 0 && (
        <div className="mb-3 bg-amber-950/40 border border-amber-800/50 rounded-lg p-2 space-y-1">
          {reminders.map(r => (
            <p key={r.eventId} className="text-[11px] text-amber-200 inline-flex items-center gap-1.5">
              <Bell className="w-3 h-3" />{r.title} in {r.minutesUntil} min{r.assignee ? ` · ${r.assignee}` : ''}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 gap-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center text-[10px] text-zinc-400 font-medium py-1">{d}</div>
        ))}
        {cells.map(c => {
          const dayEvents = byDate.get(c.date) || [];
          return (
            <div key={c.date}
              className={cn('min-h-[62px] rounded-lg border p-1 cursor-pointer transition-colors',
                c.inMonth ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-900 bg-zinc-950/40 opacity-50',
                c.date === today && 'border-sky-600/60 bg-sky-950/30')}
              onClick={() => setEditing({ ...emptyForm, date: c.date })} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <p className={cn('text-[10px] mb-0.5', c.date === today ? 'text-sky-400 font-bold' : 'text-zinc-400')}>{c.day}</p>
              {dayEvents.slice(0, 3).map(e => (
                <div key={e.id} className="text-[9px] px-1 py-0.5 rounded mb-0.5 truncate"
                  style={{ backgroundColor: `${e.color}26`, color: e.color }}
                  onClick={ev => { ev.stopPropagation(); setEditing({ ...emptyForm, ...e, time: e.time || '', endDate: e.endDate || '', assignee: e.assignee || '', location: e.location || '', notes: e.notes || '' }); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  {e.time ? `${e.time} ` : ''}{e.title}
                </div>
              ))}
              {dayEvents.length > 3 && <p className="text-[9px] text-zinc-400">+{dayEvents.length - 3}</p>}
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditing(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md p-4 space-y-2.5" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-zinc-100">{editing.id ? 'Edit Event' : 'New Event'}</h4>
              <button onClick={() => setEditing(null)} className="text-zinc-400 hover:text-zinc-200" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Event title"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input type="time" value={editing.time} onChange={e => setEditing({ ...editing, time: e.target.value })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={editing.assignee} onChange={e => setEditing({ ...editing, assignee: e.target.value })} placeholder="Assigned to"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={editing.location} onChange={e => setEditing({ ...editing, location: e.target.value })} placeholder="Location"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={editing.recurrence} onChange={e => setEditing({ ...editing, recurrence: e.target.value })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                {RECURRENCE.map(r => <option key={r} value={r}>{r === 'none' ? 'No repeat' : r}</option>)}
              </select>
              <select value={editing.reminderMinutes} onChange={e => setEditing({ ...editing, reminderMinutes: Number(e.target.value) })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                {REMINDER_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div className="flex gap-1.5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setEditing({ ...editing, color: c })} aria-label={`Colour ${c}`}
                  className={cn('w-6 h-6 rounded-full border-2', editing.color === c ? 'border-white scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Notes" rows={2}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <div className="flex items-center gap-2 pt-1">
              {editing.id && <button onClick={() => { void del(editing.id); setEditing(null); }} className="text-rose-400 inline-flex items-center gap-1 text-xs"><Trash2 className="w-3 h-3" />Delete</button>}
              <button onClick={save} disabled={busy || !editing.title.trim() || !editing.date}
                className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}{editing.id ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <ul className="mt-3 space-y-1">
          {events.slice(0, 8).map(e => (
            <li key={e.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{e.title}</p>
                <p className="text-[10px] text-zinc-400">
                  {e.date}{e.time ? ` ${e.time}` : ''}{e.assignee ? ` · ${e.assignee}` : ''}
                  {e.location && <span className="inline-flex items-center gap-0.5"> · <MapPin className="w-2.5 h-2.5" />{e.location}</span>}
                  {e.recurrence !== 'none' && ` · ${e.recurrence}`}
                </p>
              </div>
              <button onClick={() => setEditing({ ...emptyForm, ...e, time: e.time || '', endDate: e.endDate || '', assignee: e.assignee || '', location: e.location || '', notes: e.notes || '' })}
                className="opacity-0 group-hover:opacity-100 text-zinc-400" aria-label="Edit"><Edit3 className="w-3 h-3" /></button>
              <button onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
