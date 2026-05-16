'use client';

/**
 * ScheduleAnalyzer — schedule conflict + availability surface for the
 * calendar lens. Pulls the user's REAL events via
 * useLensData<CalendarEvent>('calendar', 'event') — same source as
 * the main lens grid. No seed defaults.
 *
 * Backend (no changes): calendar.detectConflicts +
 * calendar.findAvailability.
 *
 * The lens already exposes a full CRUD editor for events. This panel
 * is read-only analysis — pick a date, see conflicts (across all
 * events the user has) and free slots for that day.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Loader2, AlertCircle, Clock, CalendarX } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface CalendarEventArtifact {
  title?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  allDay?: boolean;
}

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

function toIso(d: string | Date | undefined): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19);
}

export function ScheduleAnalyzer() {
  const { items: events, isLoading } = useLensData<CalendarEventArtifact>('calendar', 'event', { seed: [] });
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(17);
  const [slot, setSlot] = useState(30);
  const [conflicts, setConflicts] = useState<ConflictResult | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);

  const realEvents = useMemo(() => events.map((e) => {
    const d = e.data;
    return { name: d.title || e.title, start: toIso(d.startDate), end: toIso(d.endDate) };
  }).filter((e): e is { name: string; start: string; end: string } => !!(e.start && e.end)), [events]);

  const eventsOnDate = useMemo(() => realEvents.filter((e) => e.start.slice(0, 10) === date), [realEvents, date]);

  const analyze = useMutation({
    mutationFn: async () => {
      const [c, a] = await Promise.all([
        callCal<ConflictResult>('detectConflicts', { artifact: { data: { events: realEvents } } }),
        callCal<AvailabilityResult>('findAvailability', { artifact: { data: { events: realEvents, date, workStartHour: workStart, workEndHour: workEnd, slotMinutes: slot } } }),
      ]);
      setConflicts(c);
      setAvailability(a);
      return { c, a };
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading calendar events…</div>;

  if (realEvents.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-8 text-center">
        <CalendarX className="mx-auto h-8 w-8 text-zinc-600" />
        <div className="mt-3 text-sm text-zinc-300">Add 2+ calendar events to analyze.</div>
        <div className="mt-1 text-xs text-zinc-500">Use the lens's "New event" button above. This panel will then detect overlapping events and surface free slots in your work day.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Schedule analyzer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">calendar.detectConflicts + findAvailability</span>
          <span className="text-[10px] text-zinc-500">· {realEvents.length} real events</span>
        </div>
        {(conflicts || availability) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-calendar-schedule"
            title={`Schedule analysis — ${date} (${realEvents.length} events, ${eventsOnDate.length} on this date)`}
            content={`Date: ${date}\nWork hours: ${workStart}:00 – ${workEnd}:00\nTotal events analysed: ${realEvents.length}\n\nConflicts (${conflicts?.conflictCount ?? 0}):\n${(conflicts?.conflicts || []).map((c) => `  ${c.event1} ↔ ${c.event2} (${c.overlapMinutes} min)`).join('\n') || '  None'}\n\nFree slots on ${date} (${availability?.totalFreeMinutes ?? 0} min total):\n${(availability?.availableSlots || []).map((s) => `  ${s.start} – ${s.end} (${s.minutes} min)`).join('\n') || '  None'}`}
            extraTags={['calendar', 'schedule', date]}
            rawData={{ date, workStart, workEnd, slot, eventCount: realEvents.length, conflicts, availability }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Free-slot date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Work start (h)</span>
          <input type="number" min={0} max={23} value={workStart} onChange={(e) => setWorkStart(Math.max(0, Math.min(23, Number(e.target.value) || 9)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Work end (h)</span>
          <input type="number" min={1} max={24} value={workEnd} onChange={(e) => setWorkEnd(Math.max(1, Math.min(24, Number(e.target.value) || 17)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-zinc-500">Min slot (min)</span>
          <input type="number" min={5} max={240} value={slot} onChange={(e) => setSlot(Math.max(5, Math.min(240, Number(e.target.value) || 30)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" /></label>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-mono text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><AlertCircle className="h-3 w-3" />Conflicts (all events)</div>
          {!conflicts && <div className="text-[11px] text-zinc-500">Analyze to detect.</div>}
          {conflicts && conflicts.conflictFree && <div className="text-[11px] text-emerald-300">No conflicts across your {realEvents.length} events.</div>}
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
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Clock className="h-3 w-3" />Free slots on {date}</div>
          {!availability && <div className="text-[11px] text-zinc-500">Analyze to scan.</div>}
          {availability && (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-zinc-400">{availability.totalFreeMinutes} min free across {availability.availableSlots?.length || 0} slot{availability.availableSlots?.length === 1 ? '' : 's'} ({availability.workHours}) · {eventsOnDate.length} event{eventsOnDate.length === 1 ? '' : 's'} on this date</div>
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
