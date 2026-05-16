'use client';

/**
 * ScheduleAnalyzer — bespoke schedule conflict + availability surface
 * for the calendar lens. Wires calendar.detectConflicts +
 * calendar.findAvailability against an editable event list.
 *
 *   • Editable event rows (name + start + end datetime-local)
 *   • Date / work-hours picker for availability scan
 *   • Detect → side-by-side: conflicts (overlapping pairs + minutes) +
 *     free slots (gap finder respecting work hours)
 *   • Save-as-DTU captures inputs + both reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Loader2, Plus, Trash2, AlertCircle, Clock } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface CalEvent { name: string; start: string; end: string }
interface ConflictResult { totalEvents?: number; conflicts?: Array<{ event1: string; event2: string; overlapMinutes: number }>; conflictCount?: number; conflictFree?: boolean }
interface AvailabilityResult { date?: string; workHours?: string; eventsToday?: number; availableSlots?: Array<{ start: string; end: string; minutes: number }>; totalFreeMinutes?: number }

async function callCal<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('calendar', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_EVENTS: CalEvent[] = [
  { name: 'Standup', start: `${today}T09:00`, end: `${today}T09:30` },
  { name: 'Design review', start: `${today}T10:00`, end: `${today}T11:00` },
  { name: 'Lunch', start: `${today}T12:00`, end: `${today}T13:00` },
  { name: '1:1 with Alex', start: `${today}T10:30`, end: `${today}T11:00` },
];

export function ScheduleAnalyzer() {
  const [events, setEvents] = useState<CalEvent[]>(DEFAULT_EVENTS);
  const [date, setDate] = useState(today);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(17);
  const [slot, setSlot] = useState(30);
  const [conflicts, setConflicts] = useState<ConflictResult | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const evs = events.filter((e) => e.name.trim() && e.start && e.end);
      const [c, a] = await Promise.all([
        callCal<ConflictResult>('detectConflicts', { artifact: { data: { events: evs } } }),
        callCal<AvailabilityResult>('findAvailability', { artifact: { data: { events: evs, date, workStartHour: workStart, workEndHour: workEnd, slotMinutes: slot } } }),
      ]);
      setConflicts(c);
      setAvailability(a);
      return { c, a };
    },
  });

  const addEvent = () => setEvents((es) => [...es, { name: '', start: `${date}T14:00`, end: `${date}T15:00` }]);
  const updateEvent = (i: number, key: keyof CalEvent, value: string) =>
    setEvents((es) => es.map((e, idx) => (idx === i ? { ...e, [key]: value } : e)));
  const removeEvent = (i: number) => setEvents((es) => es.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Schedule analyzer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">calendar.detectConflicts + findAvailability</span>
        </div>
        {(conflicts || availability) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-calendar-schedule"
            title={`Schedule analysis — ${date} (${events.length} events)`}
            content={`Date: ${date}\nWork hours: ${workStart}:00 – ${workEnd}:00\n\nConflicts (${conflicts?.conflictCount ?? 0}):\n${(conflicts?.conflicts || []).map((c) => `  ${c.event1} ↔ ${c.event2} (${c.overlapMinutes} min)`).join('\n') || '  None'}\n\nFree slots (${availability?.totalFreeMinutes ?? 0} min total):\n${(availability?.availableSlots || []).map((s) => `  ${s.start} – ${s.end} (${s.minutes} min)`).join('\n') || '  None'}`}
            extraTags={['calendar', 'schedule', date]}
            rawData={{ events, params: { date, workStart, workEnd, slot }, conflicts, availability }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Work start (h)</span>
          <input type="number" min={0} max={23} value={workStart} onChange={(e) => setWorkStart(Math.max(0, Math.min(23, Number(e.target.value) || 9)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Work end (h)</span>
          <input type="number" min={1} max={24} value={workEnd} onChange={(e) => setWorkEnd(Math.max(1, Math.min(24, Number(e.target.value) || 17)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Min slot (min)</span>
          <input type="number" min={5} max={240} value={slot} onChange={(e) => setSlot(Math.max(5, Math.min(240, Number(e.target.value) || 30)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_180px_180px_40px] gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Event</span><span>Start</span><span>End</span><span></span>
        </div>
        {events.map((e, i) => (
          <div key={i} className="grid grid-cols-[1fr_180px_180px_40px] gap-2">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" placeholder="Event name" value={e.name} onChange={(ev) => updateEvent(i, 'name', ev.target.value)} />
            <input type="datetime-local" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" value={e.start} onChange={(ev) => updateEvent(i, 'start', ev.target.value)} />
            <input type="datetime-local" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" value={e.end} onChange={(ev) => updateEvent(i, 'end', ev.target.value)} />
            <button type="button" onClick={() => removeEvent(i)} className="rounded border border-zinc-800 bg-zinc-950 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" onClick={addEvent} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-indigo-500/40 hover:text-indigo-200"><Plus className="h-3 w-3" />Add event</button>
          <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending || events.filter((e) => e.name && e.start && e.end).length < 2} className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-mono text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50">
            {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
            Analyze
          </button>
        </div>
      </div>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><AlertCircle className="h-3 w-3" />Conflicts</div>
          {!conflicts && <div className="text-[11px] text-zinc-500">Analyze to detect.</div>}
          {conflicts && conflicts.conflictFree && <div className="text-[11px] text-emerald-300">No conflicts — schedule clean.</div>}
          {conflicts && !conflicts.conflictFree && conflicts.conflicts && (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-zinc-400">{conflicts.conflictCount} conflict{conflicts.conflictCount === 1 ? '' : 's'} across {conflicts.totalEvents} events</div>
              {conflicts.conflicts.map((c, i) => (
                <div key={i} className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
                  <div className="text-zinc-100">{c.event1} <span className="text-rose-300">↔</span> {c.event2}</div>
                  <div className="font-mono text-[10px] text-rose-300">{c.overlapMinutes} min overlap</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Clock className="h-3 w-3" />Available slots</div>
          {!availability && <div className="text-[11px] text-zinc-500">Analyze to scan.</div>}
          {availability && (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-zinc-400">{availability.totalFreeMinutes} min free across {availability.availableSlots?.length || 0} slot{availability.availableSlots?.length === 1 ? '' : 's'} ({availability.workHours})</div>
              {availability.availableSlots?.length === 0 && <div className="text-amber-300">No free slots in work hours.</div>}
              {availability.availableSlots?.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                  <span className="font-mono text-zinc-100">{s.start} – {s.end}</span>
                  <span className="font-mono text-[10px] text-emerald-200">{s.minutes} min</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
