'use client';

/**
 * ScheduleAnalyzer — schedule conflict + availability surface for the
 * calendar lens, over the user's REAL saved calendar.
 *
 * F2 (one conflict truth): this panel used to read the generic artifact
 * store (useLensData 'calendar'/'event') and feed the scratch-pad
 * detectConflicts/findAvailability calculators, so it analysed a store
 * the real calendar never writes to and reported "add 2+ events" while
 * events existed. It now reads the same STATE-backed engine as every
 * other surface: calendar.events-list for the census,
 * calendar.conflicts-check (pairwise) for conflicts, and
 * calendar.availability-find (zone-aware) for free slots.
 */

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CalendarClock, Loader2, AlertCircle, Clock, CalendarX } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { browserTimeZone, calendarDateKey, fromZonedInputValue } from '@/lib/calendar-date';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { Skeleton } from '@/components/ui';

interface ConflictRow { eventId: string; title: string; start: string; end: string }
interface ConflictPair { a: ConflictRow; b: ConflictRow; overlapMinutes: number }
interface ConflictsResult { conflicts?: ConflictRow[]; pairs?: ConflictPair[] }
interface AvailabilityResult { freeSlots?: Array<{ start: string; end: string }>; busyBlockCount?: number; tz?: string }

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

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function ScheduleAnalyzer() {
  const today = calendarDateKey();
  const [date, setDate] = useState(today);
  const [workStart, setWorkStart] = useState(9);
  const [workEnd, setWorkEnd] = useState(17);
  const [slot, setSlot] = useState(30);
  const [conflicts, setConflicts] = useState<ConflictsResult | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Census from the real store (a wide window around today).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date();
      const rangeStart = new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString();
      const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 7, 1).toISOString();
      const r = await callCal<{ events?: unknown[]; count?: number }>('events-list', { rangeStart, rangeEnd });
      if (cancelled) return;
      if (r && Array.isArray(r.events)) { setEventCount(r.events.length); setLoadError(false); }
      else { setEventCount(null); setLoadError(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const analyze = useMutation({
    mutationFn: async () => {
      const tz = browserTimeZone();
      const dayStart = fromZonedInputValue(`${date}T00:00`, tz);
      const dayEnd = fromZonedInputValue(`${date}T23:59`, tz);
      if (!dayStart || !dayEnd) return { c: null, a: null };
      const [c, a] = await Promise.all([
        callCal<ConflictsResult>('conflicts-check', {
          start: dayStart.toISOString(), end: dayEnd.toISOString(), pairwise: true,
        }),
        callCal<AvailabilityResult>('availability-find', {
          day: date, durationMin: slot, workStartHour: workStart, workEndHour: workEnd, tz,
        }),
      ]);
      setConflicts(c);
      setAvailability(a);
      return { c, a };
    },
  });

  if (eventCount === null && !loadError) {
    return (
      <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading calendar events</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded border border-lattice-border bg-lattice-deep p-2">
              <Skeleton variant="line" height="0.625rem" width="60%" className="mb-2" />
              <Skeleton variant="line" height="1.5rem" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton variant="block" height="6rem" />
          <Skeleton variant="block" height="6rem" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-rose-400" />
        <div className="mt-3 text-sm text-gray-200">Could not load your calendar events.</div>
        <div className="mt-1 text-xs text-gray-400">The analyzer reads the same saved events as the grid — nothing to analyze until they load.</div>
      </div>
    );
  }

  if (eventCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-lattice-border bg-lattice-deep p-8 text-center">
        <CalendarX className="mx-auto h-8 w-8 text-gray-600" />
        <div className="mt-3 text-sm text-gray-300">Your calendar is empty.</div>
        <div className="mt-1 text-xs text-gray-400">Add an event with the lens's "New event" button above — this panel then checks it for conflicts and finds free slots in your work day.</div>
      </div>
    );
  }

  const pairs = conflicts?.pairs || [];
  const slots = (availability?.freeSlots || []).map((s) => ({
    start: s.start,
    end: s.end,
    minutes: Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000),
  }));
  const totalFreeMinutes = slots.reduce((sum, s) => sum + s.minutes, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">Schedule analyzer</h2>
          <span className="rounded bg-lattice-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">calendar.conflicts-check + availability-find</span>
          <span className="text-[10px] text-gray-400">· {eventCount} real events</span>
        </div>
        {(conflicts || availability) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-calendar-schedule"
            title={`Schedule analysis — ${date} (${eventCount} events)`}
            content={`Date: ${date}\nWork hours: ${workStart}:00 – ${workEnd}:00\nTotal events analysed: ${eventCount}\n\nConflicts (${pairs.length}):\n${pairs.map((p) => `  ${p.a.title} ↔ ${p.b.title} (${p.overlapMinutes} min)`).join('\n') || '  None'}\n\nFree slots on ${date} (${totalFreeMinutes} min total):\n${slots.map((s) => `  ${fmtTime(s.start)} – ${fmtTime(s.end)} (${s.minutes} min)`).join('\n') || '  None'}`}
            extraTags={['calendar', 'schedule', date]}
            rawData={{ date, workStart, workEnd, slot, eventCount, conflicts, availability }}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-gray-400">Free-slot date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-gray-400">Work start (h)</span>
          <input type="number" min={0} max={23} value={workStart} onChange={(e) => setWorkStart(Math.max(0, Math.min(23, Number(e.target.value) || 9)))} className="mt-1 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-gray-400">Work end (h)</span>
          <input type="number" min={1} max={24} value={workEnd} onChange={(e) => setWorkEnd(Math.max(1, Math.min(24, Number(e.target.value) || 17)))} className="mt-1 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" /></label>
        <label className="block"><span className="block text-[10px] uppercase tracking-wider text-gray-400">Min slot (min)</span>
          <input type="number" min={5} max={240} value={slot} onChange={(e) => setSlot(Math.max(5, Math.min(240, Number(e.target.value) || 30)))} className="mt-1 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1.5 text-xs text-white" /></label>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 px-3 py-1 text-xs font-mono text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-400"><AlertCircle className="h-3 w-3" />Conflicts on {date}</div>
          {!conflicts && <div className="text-[11px] text-gray-400">Analyze to detect.</div>}
          {conflicts && pairs.length === 0 && <div className="text-[11px] text-emerald-300">No conflicts on this date.</div>}
          {conflicts && pairs.length > 0 && (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-gray-400">{pairs.length} conflict{pairs.length === 1 ? '' : 's'} on this date</div>
              {pairs.map((p, i) => (
                <div key={i} className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5">
                  <div className="text-white">{p.a.title} <span className="text-rose-300">↔</span> {p.b.title}</div>
                  <div className="font-mono text-[10px] text-rose-300 tabular-nums">{fmtTime(p.a.start)} – {fmtTime(p.b.end)} · {p.overlapMinutes} min overlap</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-400"><Clock className="h-3 w-3" />Free slots on {date}</div>
          {!availability && <div className="text-[11px] text-gray-400">Analyze to scan.</div>}
          {availability && (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-gray-400">{totalFreeMinutes} min free across {slots.length} slot{slots.length === 1 ? '' : 's'} ({workStart}:00 – {workEnd}:00)</div>
              {slots.length === 0 && <div className="text-amber-300">No free slots in work hours.</div>}
              {slots.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                  <span className="font-mono tabular-nums text-white">{fmtTime(s.start)} – {fmtTime(s.end)}</span>
                  <span className="font-mono tabular-nums text-[10px] text-emerald-200">{s.minutes} min</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
