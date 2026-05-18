'use client';

/**
 * /lenses/calendar — Calendar Sprint A.
 *
 * Real DB-backed calendar wired to migration-217 substrate via the
 * calendar.* macros. Replaces the prior 2095-LOC localStorage-only
 * page (events were lost on reload).
 *
 * Three-pane layout:
 *   left   = calendar list (multi-calendar overlay) + utilities tabs
 *   center = month/week/day grid via the existing CalendarView component
 *   right  = event detail pane (when selected) or scheduling tools
 *
 * Sprint B will add the AI menu (Motion-style auto-schedule + daily
 * ritual + voice → event). Sprint C will add agents + booking links
 * + project bridge.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CalendarView } from '@/components/calendar/CalendarView';
import { ScheduleAnalyzer } from '@/components/calendar/ScheduleAnalyzer';
import { TimezoneTools } from '@/components/calendar/TimezoneTools';
import { callCalendarMacro, type Calendar, type CalendarEvent } from '@/lib/api/calendar';
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar';
import { CalendarEventDetail } from '@/components/calendar/CalendarEventDetail';
import { CalendarEventCreate } from '@/components/calendar/CalendarEventCreate';
import {
  Plus, Loader2, ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  ListIcon, Layout, LayoutGrid, Clock as ClockIcon, Settings, Sparkles,
} from 'lucide-react';

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarLensPage() {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<ViewMode>('month');
  const [cursorDate, setCursorDate] = useState(new Date());
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createOnDate, setCreateOnDate] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'detail' | 'schedule' | 'timezone'>('detail');
  const [loading, setLoading] = useState(true);

  // ─── Load calendars on mount ────────────────────────────────────
  const refreshCalendars = useCallback(async () => {
    try {
      const r = await callCalendarMacro<{ calendars?: Calendar[] }>('calendar_list');
      if (r?.calendars) {
        setCalendars(r.calendars);
        setEnabledIds(new Set(r.calendars.filter((c) => c.enabled).map((c) => c.id)));
      }
    } catch (e) { console.error('calendar_list', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refreshCalendars(); }, [refreshCalendars]);

  // ─── Compute window for the current view ────────────────────────
  const window = useMemo(() => {
    const d = new Date(cursorDate);
    if (view === 'month') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) };
    }
    if (view === 'week') {
      const dayOfWeek = d.getDay();
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) };
    }
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) };
  }, [cursorDate, view]);

  // ─── Refresh events when window or enabled calendars change ─────
  const refreshEvents = useCallback(async () => {
    if (enabledIds.size === 0) { setEvents([]); return; }
    try {
      const r = await callCalendarMacro<{ events?: CalendarEvent[] }>('event_list', {
        calendarIds: Array.from(enabledIds),
        windowStartTs: window.startTs,
        windowEndTs: window.endTs,
        includeRecurring: true,
        limit: 1000,
      });
      setEvents(r?.events || []);
    } catch (e) { console.error('event_list', e); }
  }, [enabledIds, window]);

  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  // ─── Translate events into CalendarView shape ───────────────────
  const viewEvents = useMemo(() => events.map((e) => {
    const startDate = new Date(e.start_at * 1000);
    const time = e.all_day ? undefined : startDate.toISOString().slice(11, 16);
    return {
      id: e.instance_id || e.id,
      title: e.title,
      date: startDate.toISOString().slice(0, 10),
      time,
      color: e.color || calendars.find((c) => c.id === e.calendar_id)?.color || '#22d3ee',
      type: 'event' as const,
    };
  }), [events, calendars]);

  const activeEvent = useMemo(() => {
    if (!activeEventId) return null;
    return events.find((e) => (e.instance_id || e.id) === activeEventId) || null;
  }, [events, activeEventId]);

  // ─── Navigation ─────────────────────────────────────────────────
  const navigate = useCallback((direction: -1 | 1) => {
    const d = new Date(cursorDate);
    if (view === 'month') d.setMonth(d.getMonth() + direction);
    else if (view === 'week') d.setDate(d.getDate() + 7 * direction);
    else d.setDate(d.getDate() + direction);
    setCursorDate(d);
  }, [cursorDate, view]);

  const goToday = useCallback(() => setCursorDate(new Date()), []);

  // ─── Calendar enable toggle ─────────────────────────────────────
  const toggleCalendar = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ─── Date click → opens create modal pre-filled ─────────────────
  const onSelectDate = useCallback((date: string) => {
    setCreateOnDate(date);
    setCreateOpen(true);
  }, []);

  const onSelectEvent = useCallback((evt: { id: string }) => {
    setActiveEventId(evt.id);
    setRightTab('detail');
  }, []);

  const headerLabel = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions =
      view === 'month' ? { year: 'numeric', month: 'long' } :
      view === 'week'  ? { year: 'numeric', month: 'short', day: 'numeric' } :
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return cursorDate.toLocaleDateString(undefined, opts);
  }, [view, cursorDate]);

  if (loading) {
    return (
      <LensShell lensId="calendar">
        <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-white/40">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="calendar">
      <div className="flex h-[calc(100vh-3.5rem)] bg-black/40">
        {/* ─── Sidebar: calendars + tools tabs ────────────────────── */}
        <CalendarSidebar
          calendars={calendars}
          enabledIds={enabledIds}
          onToggle={toggleCalendar}
          onCreate={refreshCalendars}
        />

        {/* ─── Center: header + grid ──────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded hover:bg-white/10 text-white/70"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={goToday} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/80">Today</button>
            <button onClick={() => navigate(1)} className="p-1.5 rounded hover:bg-white/10 text-white/70"><ChevronRight className="w-4 h-4" /></button>
            <h2 className="text-sm font-semibold text-white flex-1 truncate ml-2">{headerLabel}</h2>
            <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5">
              <ViewBtn icon={<LayoutGrid className="w-3.5 h-3.5" />} active={view === 'month'} onClick={() => setView('month')} />
              <ViewBtn icon={<Layout className="w-3.5 h-3.5" />} active={view === 'week'} onClick={() => setView('week')} />
              <ViewBtn icon={<ListIcon className="w-3.5 h-3.5" />} active={view === 'day'} onClick={() => setView('day')} />
            </div>
            <button
              onClick={() => { setCreateOnDate(null); setCreateOpen(true); }}
              className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-medium flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Event
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            <CalendarView
              events={viewEvents}
              onSelectDate={onSelectDate}
              onSelectEvent={onSelectEvent}
              onCreateEvent={onSelectDate}
              className="h-full"
            />
          </div>
        </div>

        {/* ─── Right pane: event detail or scheduling tools ───────── */}
        <aside className="w-80 border-l border-white/10 flex flex-col bg-black/60">
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10">
            <TabBtn icon={<CalendarIcon className="w-3.5 h-3.5" />} label="Event" active={rightTab === 'detail'} onClick={() => setRightTab('detail')} />
            <TabBtn icon={<Sparkles className="w-3.5 h-3.5" />} label="Schedule" active={rightTab === 'schedule'} onClick={() => setRightTab('schedule')} />
            <TabBtn icon={<ClockIcon className="w-3.5 h-3.5" />} label="Timezones" active={rightTab === 'timezone'} onClick={() => setRightTab('timezone')} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {rightTab === 'detail' && (
              activeEvent
                ? <CalendarEventDetail event={activeEvent} onClose={() => setActiveEventId(null)} onChange={refreshEvents} />
                : <div className="p-4 text-center text-white/40 text-sm">Pick an event to see its details.</div>
            )}
            {rightTab === 'schedule' && (
              <div className="p-3"><ScheduleAnalyzer /></div>
            )}
            {rightTab === 'timezone' && (
              <div className="p-3"><TimezoneTools /></div>
            )}
          </div>
        </aside>
      </div>

      <CalendarEventCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        calendars={calendars}
        defaultDate={createOnDate}
        onCreated={() => { setCreateOpen(false); refreshEvents(); }}
      />
    </LensShell>
  );
}

function ViewBtn({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={`p-1 rounded ${active ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}>{icon}</button>
  );
}

function TabBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}>
      {icon}{label}
    </button>
  );
}
