'use client';

/**
 * PgFamilyCalendarPanel — general shared family calendar. Unlike
 * PgAppointmentsPanel (pediatric appointments only, always tied to one
 * child), this covers any family event — activities, school closures,
 * travel, etc. — and an event is optionally tied to a specific child or
 * left family-wide. Backed by the parenting.event-* macro family
 * (event-add/event-list/event-update/event-delete/event-ical).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, CalendarPlus, CalendarRange, Check, Trash2, Download, Pencil, X, Users,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FamilyEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  childId: string | null;
  category: string;
  location: string | null;
  notes: string | null;
}
interface EventList {
  events: FamilyEvent[];
  count: number;
  nextUp: FamilyEvent | null;
}
interface Child { id: string; name: string; ageDisplay: string }

const CATEGORIES = ['activity', 'school', 'medical', 'travel', 'other'] as const;
const CATEGORY_COLOR: Record<string, string> = {
  activity: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  school: 'bg-sky-900/40 text-sky-300 border-sky-800/60',
  medical: 'bg-rose-900/40 text-rose-300 border-rose-800/60',
  travel: 'bg-amber-900/40 text-amber-300 border-amber-800/60',
  other: 'bg-zinc-800/60 text-zinc-300 border-zinc-700',
};

const emptyForm = {
  title: '', allDay: true, startDate: '', startTime: '', endDate: '', endTime: '',
  childId: '', category: 'activity' as string, location: '', notes: '',
};

function toStartAt(f: typeof emptyForm): string | null {
  if (f.allDay) return f.startDate || null;
  if (!f.startDate || !f.startTime) return null;
  return `${f.startDate}T${f.startTime}`;
}
function toEndAt(f: typeof emptyForm): string | undefined {
  if (f.allDay) return f.endDate || undefined;
  if (!f.endDate || !f.endTime) return undefined;
  return `${f.endDate}T${f.endTime}`;
}

export function PgFamilyCalendarPanel() {
  const [data, setData] = useState<EventList | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async (all: boolean) => {
    const [ev, kids] = await Promise.all([
      lensRun('parenting', 'event-list', all ? {} : { scope: 'upcoming' }),
      lensRun('parenting', 'child-list', {}),
    ]);
    setData(ev.data?.ok === false ? null : ((ev.data?.result as EventList) || null));
    setChildren((kids.data?.result?.children as Child[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(showAll); }, [refresh, showAll]);

  const resetForm = () => { setForm({ ...emptyForm }); setEditingId(null); };

  const startEdit = (e: FamilyEvent) => {
    setEditingId(e.id);
    if (e.allDay) {
      setForm({
        title: e.title, allDay: true,
        startDate: e.startAt, startTime: '', endDate: e.endAt || '', endTime: '',
        childId: e.childId || '', category: e.category,
        location: e.location || '', notes: e.notes || '',
      });
    } else {
      const [sd, st] = e.startAt.split('T');
      const [ed, et] = (e.endAt || '').split('T');
      setForm({
        title: e.title, allDay: false,
        startDate: sd || '', startTime: (st || '').slice(0, 5),
        endDate: ed || '', endTime: (et || '').slice(0, 5),
        childId: e.childId || '', category: e.category,
        location: e.location || '', notes: e.notes || '',
      });
    }
  };

  const save = async () => {
    if (!form.title.trim()) { setError('Event title is required.'); return; }
    const startAt = toStartAt(form);
    if (!startAt) { setError(form.allDay ? 'Pick a start date.' : 'Pick a start date and time.'); return; }
    const endAt = toEndAt(form);
    const payload = {
      title: form.title.trim(), startAt, endAt,
      childId: form.childId || undefined,
      category: form.category, location: form.location.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    const r = editingId
      ? await lensRun('parenting', 'event-update', { id: editingId, ...payload })
      : await lensRun('parenting', 'event-add', payload);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to save event.'); return; }
    setError(null);
    resetForm();
    await refresh(showAll);
  };

  const remove = async (id: string) => {
    const r = await lensRun('parenting', 'event-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to delete event.'); return; }
    if (editingId === id) resetForm();
    await refresh(showAll);
  };

  const exportIcal = async () => {
    const r = await lensRun('parenting', 'event-ical', {});
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

  const childName = (id: string | null) => (id ? children.find((c) => c.id === id)?.name || 'Child' : null);

  if (loading) {
    return <div role="status" aria-label="Loading family calendar" className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-zinc-400">
        A shared calendar for everything the family calendar needs to hold — not just pediatric
        appointments. Events can be family-wide or tagged to a specific child.
      </p>

      {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Next up */}
      {data?.nextUp && (
        <div className="bg-gradient-to-br from-sky-900/40 to-zinc-900/70 border border-sky-900/50 rounded-xl p-3">
          <p className="text-[10px] text-sky-300 uppercase tracking-wide">Next up</p>
          <p className="text-sm font-bold text-zinc-100 mt-0.5">{data.nextUp.title}</p>
          <p className="text-[11px] text-zinc-400">
            {data.nextUp.startAt}{childName(data.nextUp.childId) ? ` · ${childName(data.nextUp.childId)}` : ' · family-wide'}
          </p>
        </div>
      )}

      {/* Add / Edit */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center justify-between text-xs font-semibold text-zinc-300">
          <span className="flex items-center gap-1">
            <CalendarPlus className="w-3.5 h-3.5 text-sky-400" /> {editingId ? 'Edit event' : 'Add family event'}
          </span>
          {editingId && (
            <button type="button" onClick={resetForm} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200">
              <X className="w-3 h-3" /> Cancel edit
            </button>
          )}
        </h3>
        <input placeholder="Title (e.g. Soccer practice, School closed)" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />

        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
          <input type="checkbox" checked={form.allDay}
            onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
          All-day event
        </label>

        {form.allDay ? (
          <div className="grid grid-cols-2 gap-2">
            <input type="date" aria-label="Start date" value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="date" aria-label="End date (optional)" value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" aria-label="Start" value={form.startDate && form.startTime ? `${form.startDate}T${form.startTime}` : ''}
              onChange={(e) => { const [d, t] = e.target.value.split('T'); setForm({ ...form, startDate: d || '', startTime: t || '' }); }}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="datetime-local" aria-label="End (optional)" value={form.endDate && form.endTime ? `${form.endDate}T${form.endTime}` : ''}
              onChange={(e) => { const [d, t] = e.target.value.split('T'); setForm({ ...form, endDate: d || '', endTime: t || '' }); }}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Child" value={form.childId} onChange={(e) => setForm({ ...form, childId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Family-wide (no specific child)</option>
            {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Location" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Notes" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={save}
          className="w-full flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg py-1.5">
          {editingId ? <Pencil className="w-3.5 h-3.5" /> : <CalendarPlus className="w-3.5 h-3.5" />}
          {editingId ? 'Save changes' : 'Add event'}
        </button>
      </section>

      {/* List */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <CalendarRange className="w-3.5 h-3.5 text-sky-400" /> Family calendar
          </h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowAll((v) => !v)}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 underline decoration-dotted">
              {showAll ? 'Show upcoming only' : 'Show all events'}
            </button>
            {data && data.count > 0 && (
              <button type="button" onClick={exportIcal}
                className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                <Download className="w-3 h-3" /> Export .ics
              </button>
            )}
          </div>
        </div>
        {!data || data.events.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-4 text-center">
            {showAll ? 'No family events yet.' : 'No upcoming family events.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.events.map((e) => {
              const cName = childName(e.childId);
              return (
                <li key={e.id} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
                  <span className={cn('mt-0.5 text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border shrink-0', CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other)}>
                    {e.category}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-200">{e.title}</p>
                    <p className="text-[10px] text-zinc-400">
                      {e.startAt}{e.endAt ? ` → ${e.endAt}` : ''}
                      {e.location ? ` · ${e.location}` : ''}
                      {cName ? (
                        <span className="inline-flex items-center gap-0.5 ml-1"><Users className="w-2.5 h-2.5" /> {cName}</span>
                      ) : (
                        <span className="ml-1 italic">family-wide</span>
                      )}
                    </p>
                  </div>
                  <button type="button" onClick={() => startEdit(e)}
                    className="text-zinc-400 hover:text-sky-300 shrink-0" aria-label="Edit event">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(e.id)}
                    className="text-zinc-400 hover:text-rose-300 shrink-0" aria-label="Delete event">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[10px] text-zinc-400 mt-2 flex items-center gap-1">
          <Check className="w-3 h-3" /> Exported events include a 24-hour reminder alarm.
        </p>
      </section>
    </div>
  );
}
