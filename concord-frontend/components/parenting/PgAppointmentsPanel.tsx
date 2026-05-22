'use client';

/**
 * PgAppointmentsPanel — pediatric appointment + vaccine reminders with
 * one-click iCalendar (.ics) export for the device calendar.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarPlus, CalendarClock, Check, Trash2, Download, Stethoscope, Syringe } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Appointment {
  id: string;
  childId: string;
  title: string;
  kind: string;
  date: string;
  time: string | null;
  provider: string | null;
  location: string | null;
  notes: string | null;
  done: boolean;
}
interface ApptList {
  appointments: Appointment[];
  count: number;
  nextUp: Appointment | null;
  overdue: number;
}

const KINDS = ['checkup', 'vaccine', 'dental', 'specialist', 'other'] as const;
const KIND_ICON: Record<string, typeof Stethoscope> = {
  checkup: Stethoscope, vaccine: Syringe, dental: CalendarClock,
  specialist: Stethoscope, other: CalendarClock,
};

export function PgAppointmentsPanel({ childId }: { childId: string }) {
  const [data, setData] = useState<ApptList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', kind: 'checkup', date: '', time: '', provider: '', location: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('parenting', 'appointment-list', { childId });
    setData(r.data?.ok === false ? null : (r.data?.result as ApptList));
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.title.trim()) { setError('Appointment title is required.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setError('Pick a date.'); return; }
    const r = await lensRun('parenting', 'appointment-add', {
      childId, title: form.title.trim(), kind: form.kind, date: form.date,
      time: form.time || undefined, provider: form.provider.trim() || undefined,
      location: form.location.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    setForm({ title: '', kind: 'checkup', date: '', time: '', provider: '', location: '' });
    await refresh();
  };
  const toggleDone = async (a: Appointment) => {
    await lensRun('parenting', 'appointment-update', { id: a.id, done: !a.done });
    await refresh();
  };
  const remove = async (id: string) => {
    await lensRun('parenting', 'appointment-delete', { id });
    await refresh();
  };
  const exportIcal = async () => {
    const r = await lensRun('parenting', 'appointment-ical', { childId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Nothing to export'); return; }
    setError(null);
    const result = r.data?.result as { ical: string; filename: string };
    const blob = new Blob([result.ical], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Next up */}
      {data?.nextUp && (
        <div className="bg-gradient-to-br from-rose-900/40 to-zinc-900/70 border border-rose-900/50 rounded-xl p-3">
          <p className="text-[10px] text-rose-300 uppercase tracking-wide">Next appointment</p>
          <p className="text-sm font-bold text-zinc-100 mt-0.5">{data.nextUp.title}</p>
          <p className="text-[11px] text-zinc-400">
            {data.nextUp.date}{data.nextUp.time ? ` · ${data.nextUp.time}` : ''}
            {data.nextUp.provider ? ` · ${data.nextUp.provider}` : ''}
          </p>
        </div>
      )}

      {/* Add */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <CalendarPlus className="w-3.5 h-3.5 text-rose-400" /> Schedule appointment
        </h3>
        <input placeholder="Title (e.g. 12-month checkup)" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <div className="grid grid-cols-3 gap-2">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Provider" value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Location" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={add}
          className="w-full flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg py-1.5">
          <CalendarPlus className="w-3.5 h-3.5" /> Add appointment
        </button>
      </section>

      {/* List */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <CalendarClock className="w-3.5 h-3.5 text-rose-400" /> Appointments
            {data && data.overdue > 0 && (
              <span className="text-[10px] text-amber-400">· {data.overdue} overdue</span>
            )}
          </h3>
          {data && data.count > 0 && (
            <button type="button" onClick={exportIcal}
              className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Download className="w-3 h-3" /> Export .ics
            </button>
          )}
        </div>
        {!data || data.appointments.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic py-4 text-center">No appointments scheduled.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.appointments.map((a) => {
              const Icon = KIND_ICON[a.kind] || CalendarClock;
              const overdue = !a.done && a.date < todayStr;
              return (
                <li key={a.id} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2',
                  a.done ? 'border-zinc-800 bg-zinc-900/40 opacity-60'
                    : overdue ? 'border-amber-900/50 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900/70')}>
                  <Icon className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs text-zinc-200', a.done && 'line-through')}>{a.title}</p>
                    <p className="text-[10px] text-zinc-500">
                      {a.date}{a.time ? ` · ${a.time}` : ''}
                      {a.provider ? ` · ${a.provider}` : ''}
                      {a.location ? ` · ${a.location}` : ''}
                      {overdue && ' · overdue'}
                    </p>
                  </div>
                  <button type="button" onClick={() => toggleDone(a)}
                    className={cn('w-5 h-5 rounded flex items-center justify-center shrink-0',
                      a.done ? 'bg-emerald-600' : 'border border-zinc-600 hover:border-zinc-500')}
                    aria-label="Toggle done">
                    {a.done && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <button type="button" onClick={() => remove(a.id)}
                    className="text-zinc-500 hover:text-rose-300 shrink-0" aria-label="Delete appointment">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[10px] text-zinc-500 mt-2">Exported events include a 24-hour reminder alarm.</p>
      </section>
    </div>
  );
}
