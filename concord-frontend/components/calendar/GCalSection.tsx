'use client';

/**
 * GCalSection — Google Calendar + Notion Calendar + Fantastical 2026
 * parity workbench. Month/week/day grid, multi-calendar toggles,
 * natural-language quick-add, tasks panel with drag-to-timeblock,
 * AI auto-schedule. Wired to the calendar.* macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, Sparkles, Loader2,
  CheckSquare, Square, Trash2, Clock, X, Zap, ListTodo,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { browserTimeZone } from '@/lib/calendar-date';
import { cn } from '@/lib/utils';

interface CalendarMeta { id: string; number: string; name: string; color: string; visible: boolean; isDefault: boolean }
interface CalEvent {
  id: string; number: string; calendarId: string; title: string;
  description: string; location: string; start: string; end: string;
  allDay: boolean; recurrence: { freq: string; interval: number } | null;
  occurrenceStart: string; occurrenceEnd: string; conferenceLink: string;
  fromTaskId?: string;
}
interface Task {
  id: string; number: string; title: string; notes: string;
  dueAt: string | null; estimateMin: number; priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'done'; blockedEventId: string | null;
}
interface Proposal { taskId: string; title: string; priority: string; estimateMin: number; proposedStart: string; proposedEnd: string }

type View = 'month' | 'week' | 'day';

const PRIORITY_COLOUR: Record<string, string> = {
  high: 'text-rose-300', medium: 'text-amber-300', low: 'text-gray-400',
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

export function GCalSection() {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(new Date());
  const [calendars, setCalendars] = useState<CalendarMeta[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickAdd, setQuickAdd] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [editEvent, setEditEvent] = useState<Partial<CalEvent> & { _new?: boolean } | null>(null);
  const [showTasks, setShowTasks] = useState(true);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [showCalForm, setShowCalForm] = useState(false);
  const [calName, setCalName] = useState('');
  const [calColor, setCalColor] = useState('#34a853');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskEstimate, setTaskEstimate] = useState(30);
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [confirmCalId, setConfirmCalId] = useState<string | null>(null);
  const [railError, setRailError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // Real Google Calendar overlay (pulled via the connector — read-only).
  const [googleEvents, setGoogleEvents] = useState<CalEvent[]>([]);
  const [googleState, setGoogleState] = useState<'idle' | 'syncing' | 'connected' | 'disconnected'>('idle');

  const visibleCalIds = useMemo(() => calendars.filter(c => c.visible).map(c => c.id), [calendars]);
  const calById = useMemo(() => new Map(calendars.map(c => [c.id, c])), [calendars]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const mStart = startOfMonth(cursor);
      const rangeStart = new Date(mStart.getFullYear(), mStart.getMonth() - 1, 1).toISOString();
      const rangeEnd = new Date(mStart.getFullYear(), mStart.getMonth() + 2, 1).toISOString();
      const [c, e, t] = await Promise.all([
        lensRun({ domain: 'calendar', action: 'calendars-list', input: {} }),
        lensRun({ domain: 'calendar', action: 'events-list', input: { rangeStart, rangeEnd } }),
        lensRun({ domain: 'calendar', action: 'tasks-list', input: { status: 'all' } }),
      ]);
      setCalendars((c.data?.result?.calendars || []) as CalendarMeta[]);
      setEvents((e.data?.result?.events || []) as CalEvent[]);
      setTasks((t.data?.result?.tasks || []) as Task[]);
    } catch (err) { console.error('[GCal] refresh', err); }
    finally { setLoading(false); }
  }, [cursor]);

  useEffect(() => { refresh(); }, [refresh]);

  const [parsedPreview, setParsedPreview] = useState<{
    title: string; start: string; end: string;
    recurrence?: { freq: string; interval: number } | null; conferenceLink?: string; durationMin: number;
  } | null>(null);

  // F11: quick-add used to save sight-unseen (and alert() on failure,
  // which never surfaces embedded). Now: parse → show the parse →
  // confirm → save, with errors inline.
  async function quickAddSubmit() {
    if (!quickAdd.trim()) return;
    setQuickBusy(true);
    try {
      const p = await lensRun({ domain: 'calendar', action: 'nl-parse-event', input: { text: quickAdd.trim(), tz: browserTimeZone() } });
      const parsed = p.data?.result?.parsed;
      if (!parsed) { setRailError('Could not parse that — try adding a day or time.'); return; }
      setRailError(null);
      setParsedPreview(parsed);
    } catch (err) { console.error('[GCal] quickAdd', err); setRailError('Quick add failed — try again.'); }
    finally { setQuickBusy(false); }
  }

  async function confirmQuickAdd() {
    if (!parsedPreview) return;
    setQuickBusy(true);
    try {
      const r = await lensRun({ domain: 'calendar', action: 'events-create', input: {
        title: parsedPreview.title, start: parsedPreview.start, end: parsedPreview.end,
        recurrence: parsedPreview.recurrence || undefined, conferenceLink: parsedPreview.conferenceLink || undefined,
        tz: browserTimeZone(),
      } });
      if (r.data?.ok === false) { setRailError(r.data?.error || 'Could not save that event.'); return; }
      setParsedPreview(null);
      setQuickAdd('');
      await refresh();
    } catch (err) { console.error('[GCal] quickAdd confirm', err); setRailError('Could not save that event.'); }
    finally { setQuickBusy(false); }
  }

  async function saveEvent() {
    if (!editEvent || !editEvent.title?.trim() || !editEvent.start) return;
    try {
      if (editEvent._new) {
        const r = await lensRun({ domain: 'calendar', action: 'events-create', input: {
          title: editEvent.title, start: editEvent.start, end: editEvent.end,
          calendarId: editEvent.calendarId, description: editEvent.description, location: editEvent.location,
        } });
        if (r.data?.ok === false) { alert(r.data?.error); return; }
      } else {
        await lensRun({ domain: 'calendar', action: 'events-update', input: {
          id: editEvent.id, title: editEvent.title, start: editEvent.start, end: editEvent.end,
          calendarId: editEvent.calendarId, description: editEvent.description, location: editEvent.location,
        } });
      }
      setEditEvent(null);
      await refresh();
    } catch (err) { console.error('[GCal] saveEvent', err); }
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event?')) return;
    try {
      await lensRun({ domain: 'calendar', action: 'events-delete', input: { id } });
      setEditEvent(null);
      await refresh();
    } catch (err) { console.error('[GCal] deleteEvent', err); }
  }

  async function toggleCalendar(cal: CalendarMeta) {
    setCalendars(prev => prev.map(c => c.id === cal.id ? { ...c, visible: !c.visible } : c));
    try { await lensRun({ domain: 'calendar', action: 'calendars-update', input: { id: cal.id, visible: !cal.visible } }); }
    catch (err) { console.error('[GCal] toggleCal', err); }
  }

  // F3: in-lens form instead of prompt() (which never surfaces in
  // embedded/automated browsers and read as a dead button).
  async function addCalendar() {
    const name = calName.trim();
    if (!name) { setRailError('Give the calendar a name.'); return; }
    try {
      const r = await lensRun({ domain: 'calendar', action: 'calendars-create', input: { name, color: calColor } });
      if (!r.data?.ok) { setRailError(r.data?.error || 'Failed to create calendar'); return; }
      setCalName(''); setShowCalForm(false); setRailError(null);
      await refresh();
    } catch (err) { console.error('[GCal] addCal', err); setRailError('Failed to create calendar'); }
  }

  async function deleteCalendar(cal: CalendarMeta) {
    if (cal.isDefault) return; // server refuses anyway; the UI never offers it (see hasDelete below)
    try {
      const r = await lensRun({ domain: 'calendar', action: 'calendars-delete', input: { id: cal.id } });
      if (!r.data?.ok) { console.error('[GCal] deleteCal', r.data?.error); return; }
      await refresh();
    } catch (err) { console.error('[GCal] deleteCal', err); }
  }

  async function addTask() {
    const title = taskTitle.trim();
    if (!title) { setRailError('Give the task a title.'); return; }
    try {
      const r = await lensRun({ domain: 'calendar', action: 'tasks-create', input: { title, estimateMin: taskEstimate, priority: taskPriority } });
      if (!r.data?.ok) { setRailError(r.data?.error || 'Failed to create task'); return; }
      setTaskTitle(''); setShowTaskForm(false); setRailError(null);
      await refresh();
    } catch (err) { console.error('[GCal] addTask', err); setRailError('Failed to create task'); }
  }

  // Direct time-block: place the task at the next full hour today. (The
  // AI-proposal commit path also calls tasks-time-block; this is the
  // per-task control F3's done-state asks for.)
  async function timeBlockTask(t: Task) {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    try {
      const r = await lensRun({ domain: 'calendar', action: 'tasks-time-block', input: { taskId: t.id, start: start.toISOString() } });
      if (!r.data?.ok) { setRailError(r.data?.error || 'Could not time-block that task.'); return; }
      setRailError(null);
      await refresh();
    } catch (err) { console.error('[GCal] timeBlock', err); setRailError('Could not time-block that task.'); }
  }

  async function toggleTask(t: Task) {
    try { await lensRun({ domain: 'calendar', action: 'tasks-toggle', input: { id: t.id } }); await refresh(); }
    catch (err) { console.error('[GCal] toggleTask', err); }
  }

  async function deleteTask(id: string) {
    try { await lensRun({ domain: 'calendar', action: 'tasks-delete', input: { id } }); await refresh(); }
    catch (err) { console.error('[GCal] deleteTask', err); }
  }

  async function runAutoSchedule() {
    setAiBusy(true);
    setProposals(null);
    try {
      const day = ymd(view === 'month' ? new Date() : cursor);
      const r = await lensRun({ domain: 'calendar', action: 'ai-auto-schedule', input: { day } });
      setProposals((r.data?.result?.proposals || []) as Proposal[]);
    } catch (err) { console.error('[GCal] autoSchedule', err); }
    finally { setAiBusy(false); }
  }

  async function commitProposal(p: Proposal) {
    try {
      await lensRun({ domain: 'calendar', action: 'tasks-time-block', input: { taskId: p.taskId, start: p.proposedStart } });
      setProposals(prev => prev ? prev.filter(x => x.taskId !== p.taskId) : null);
      await refresh();
    } catch (err) { console.error('[GCal] commitProposal', err); }
  }

  // Pull real events from the user's Google Calendar via the connector. Overlays
  // them as a read-only "Google" calendar. Honest disconnected state on no_token.
  const NOT_CONNECTED_CAL = useMemo(() => new Set(['no_token', 'connector_not_configured', 'pull_failed']), []);
  async function syncGoogle() {
    setGoogleState('syncing');
    try {
      const mStart = startOfMonth(cursor);
      const timeMin = new Date(mStart.getFullYear(), mStart.getMonth() - 1, 1).toISOString();
      const timeMax = new Date(mStart.getFullYear(), mStart.getMonth() + 2, 1).toISOString();
      const r = await lensRun({ domain: 'calendar', action: 'accounts-pull-events', input: { timeMin, timeMax, maxResults: 250 } });
      if (r.data?.ok) {
        const gev = (r.data.result?.events || []) as Array<{ id: string; summary: string; start: string; end: string; allDay: boolean; location?: string; description?: string }>;
        const mapped: CalEvent[] = gev.filter(e => e.start).map(e => ({
          id: 'g_' + e.id, number: '', calendarId: 'google', title: e.summary || '(untitled)',
          description: e.description || '', location: e.location || '', start: e.start, end: e.end || e.start,
          allDay: e.allDay, recurrence: null, occurrenceStart: e.start, occurrenceEnd: e.end || e.start, conferenceLink: '',
        }));
        setGoogleEvents(mapped);
        setGoogleState('connected');
        setCalendars(prev => prev.some(c => c.id === 'google')
          ? prev
          : [...prev, { id: 'google', number: 'G', name: 'Google', color: '#ea4335', visible: true, isDefault: false }]);
      } else if (NOT_CONNECTED_CAL.has(r.data?.error || '')) {
        setGoogleState('disconnected');
      } else {
        setGoogleState('idle');
      }
    } catch { setGoogleState('idle'); }
  }
  async function connectGoogle() {
    try {
      const r = await lensRun({ domain: 'calendar', action: 'accounts-connect-google', input: { redirect: window.location.pathname } });
      const url = r.data?.result?.authorizeUrl as string | undefined;
      if (url) window.location.href = url;
    } catch { /* best-effort */ }
  }

  // Visible events filtered by calendar toggles (local + real Google overlay)
  const shownEvents = useMemo(
    () => [...events, ...googleEvents].filter(e => visibleCalIds.includes(e.calendarId)),
    [events, googleEvents, visibleCalIds],
  );

  function eventsForDay(d: Date) {
    return shownEvents
      .filter(e => sameDay(new Date(e.occurrenceStart), d))
      .sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  }

  // ── Month grid ──
  const monthGrid = useMemo(() => {
    const first = startOfMonth(cursor);
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [cursor]);

  function shiftCursor(dir: number) {
    const d = new Date(cursor);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCursor(d);
  }

  const headerLabel = view === 'month'
    ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  }, [cursor]);

  const today = new Date();

  function openNewEvent(d?: Date) {
    const base = d || new Date();
    base.setHours(9, 0, 0, 0);
    const defaultCal = calendars.find(c => c.isDefault) || calendars[0];
    setEditEvent({
      _new: true, title: '', calendarId: defaultCal?.id,
      start: new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      end: new Date(base.getTime() + 3600000 - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
      description: '', location: '',
    });
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-lattice-deep border border-blue-500/15 rounded-lg overflow-hidden">
      {/* Left rail */}
      <aside className="w-56 bg-lattice-void border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5 flex items-center gap-2">
          <CalIcon className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-gray-200">Calendar</span>
        </header>
        <div className="p-3">
          <button onClick={() => openNewEvent()} className="w-full px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />Create event
          </button>
        </div>
        {/* My calendars */}
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex-1">My calendars</span>
            <button aria-label="Add" onClick={() => { setRailError(null); setShowCalForm(v => !v); }} className="text-gray-400 hover:text-white"><Plus className="w-3 h-3" /></button>
          </div>
          {showCalForm && (
            <div className="mb-2 space-y-1.5 rounded border border-white/10 bg-white/[0.03] p-2">
              <input aria-label="New calendar name" value={calName} onChange={e => setCalName(e.target.value)} placeholder="Calendar name" className="w-full bg-lattice-deep rounded px-2 py-1 text-xs text-white placeholder:text-gray-500 outline-none" />
              <div className="flex items-center gap-1">
                {['#4285f4', '#ea4335', '#34a853', '#fbbc04', '#a142f4', '#24c1e0', '#f538a0', '#f6911e'].map(c => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setCalColor(c)} className={cn('w-4 h-4 rounded-full border-2', calColor === c ? 'border-white' : 'border-transparent')} style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-1.5">
                <button onClick={addCalendar} disabled={!calName.trim()} className="flex-1 px-2 py-1 text-[11px] rounded bg-blue-500 text-white font-semibold disabled:opacity-40">Create</button>
                <button onClick={() => setShowCalForm(false)} className="flex-1 px-2 py-1 text-[11px] rounded border border-white/15 text-gray-300">Cancel</button>
              </div>
            </div>
          )}
          <ul className="space-y-0.5">
            {calendars.map(c => (
              <li key={c.id} className="group flex items-center">
                <button onClick={() => toggleCalendar(c)} className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1 text-xs hover:bg-white/[0.04] rounded">
                  <span className={cn('w-3 h-3 rounded-sm border', c.visible ? '' : 'opacity-30')} style={{ background: c.visible ? c.color : 'transparent', borderColor: c.color }} />
                  <span className={cn('truncate flex-1 text-left', c.visible ? 'text-gray-200' : 'text-gray-400')}>{c.name}</span>
                </button>
                {!c.isDefault && (
                  confirmCalId === c.id ? (
                    <button onClick={() => { setConfirmCalId(null); void deleteCalendar(c); }} aria-label={`Confirm delete calendar ${c.name}`} className="px-1 text-[10px] text-rose-300">Delete?</button>
                  ) : (
                    <button
                      onClick={() => setConfirmCalId(c.id)}
                      aria-label={`Delete calendar ${c.name}`}
                      title="Delete calendar (its events are removed too)"
                      className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 px-1"
                    ><Trash2 className="w-3 h-3" /></button>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
        {railError && <p className="px-3 pb-1 text-[11px] text-rose-300">{railError}</p>}
        {/* Tasks */}
        <div className="px-3 pb-2 flex-1 overflow-hidden flex flex-col border-t border-white/5 pt-2">
          <div className="flex items-center gap-2 mb-1">
            <ListTodo className="w-3 h-3 text-gray-400" />
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold flex-1">Tasks</span>
            <button onClick={() => setShowTasks(v => !v)} className="text-gray-400 text-[10px]">{showTasks ? 'hide' : 'show'}</button>
            <button aria-label="Add" onClick={() => { setRailError(null); setShowTaskForm(v => !v); }} className="text-gray-400 hover:text-white"><Plus className="w-3 h-3" /></button>
          </div>
          {showTasks && (
            <>
              {showTaskForm && (
                <div className="mb-1.5 space-y-1.5 rounded border border-white/10 bg-white/[0.03] p-2">
                  <input aria-label="New task title" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task title" className="w-full bg-lattice-deep rounded px-2 py-1 text-[11px] text-white placeholder:text-gray-500 outline-none" />
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-gray-400">Minutes
                      <input aria-label="Estimate minutes" type="number" min={5} step={5} value={taskEstimate} onChange={e => setTaskEstimate(Math.max(0, Number(e.target.value) || 0))} className="ml-1 w-14 bg-lattice-deep rounded px-1 py-0.5 text-[11px] text-white outline-none" />
                    </label>
                    <select aria-label="Priority" value={taskPriority} onChange={e => setTaskPriority(e.target.value as 'low' | 'medium' | 'high')} className="bg-lattice-deep rounded px-1 py-0.5 text-[11px] text-white outline-none">
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={addTask} disabled={!taskTitle.trim()} className="flex-1 px-2 py-1 text-[11px] rounded bg-blue-500 text-white font-semibold disabled:opacity-40">Add task</button>
                    <button onClick={() => setShowTaskForm(false)} className="flex-1 px-2 py-1 text-[11px] rounded border border-white/15 text-gray-300">Cancel</button>
                  </div>
                </div>
              )}
              <button onClick={runAutoSchedule} disabled={aiBusy} className="mb-1.5 w-full px-2 py-1 text-[11px] rounded border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}AI auto-schedule
              </button>
              <ul className="flex-1 overflow-y-auto space-y-0.5">
                {tasks.filter(t => t.status === 'todo').length === 0 && (
                  <li className="text-[10px] text-gray-400 italic py-1">No open tasks.</li>
                )}
                {tasks.filter(t => t.status === 'todo').map(t => (
                  <li key={t.id} className="group flex items-center gap-1.5 text-[11px] py-0.5">
                    <button aria-label="Stop" onClick={() => toggleTask(t)}><Square className="w-3 h-3 text-gray-400 hover:text-blue-300" /></button>
                    <span className="truncate flex-1 text-gray-300">{t.title}</span>
                    <span className={cn('text-[9px] tabular-nums', PRIORITY_COLOUR[t.priority])}>{t.estimateMin}m</span>
                    {t.blockedEventId && <Clock className="w-2.5 h-2.5 text-blue-400" />}
                    {!t.blockedEventId && <button aria-label={`Time-block ${t.title}`} title="Time-block at the next hour" onClick={() => timeBlockTask(t)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-300"><Clock className="w-2.5 h-2.5" /></button>}
                    <button aria-label="Delete" onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-rose-300"><Trash2 className="w-2.5 h-2.5" /></button>
                  </li>
                ))}
                {tasks.filter(t => t.status === 'done').slice(0, 5).map(t => (
                  <li key={t.id} className="flex items-center gap-1.5 text-[11px] py-0.5 opacity-50">
                    <button aria-label="Toggle" onClick={() => toggleTask(t)}><CheckSquare className="w-3 h-3 text-emerald-400" /></button>
                    <span className="truncate flex-1 text-gray-400 line-through">{t.title}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <button onClick={() => setCursor(new Date())} className="px-2.5 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]">Today</button>
          <button aria-label="Previous" onClick={() => shiftCursor(-1)} className="p-1 text-gray-400 hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
          <button aria-label="Next" onClick={() => shiftCursor(1)} className="p-1 text-gray-400 hover:text-white"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-gray-200 tabular-nums">{headerLabel}</span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
          {googleState === 'disconnected' ? (
            <button onClick={connectGoogle} className="ml-2 px-2.5 py-1 text-xs rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1">
              <CalIcon className="w-3 h-3" /> Connect Google
            </button>
          ) : (
            <button onClick={syncGoogle} disabled={googleState === 'syncing'} className={cn('ml-2 px-2.5 py-1 text-xs rounded border inline-flex items-center gap-1 disabled:opacity-50',
              googleState === 'connected' ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10' : 'border-white/15 text-gray-300 hover:bg-white/[0.05]')}>
              {googleState === 'syncing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalIcon className="w-3 h-3" />}
              {googleState === 'connected' ? `Google · ${googleEvents.length}` : 'Sync Google'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {(['month', 'week', 'day'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} className={cn('px-2.5 py-1 text-xs rounded', view === v ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' : 'text-gray-400 border border-transparent hover:text-white')}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </header>

        {/* NL quick-add */}
        <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <input
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && quickAddSubmit()}
            placeholder='Quick add — e.g. "Team standup every Monday at 9am for 30 min"'
            className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-400 outline-none"
          />
          <button onClick={quickAddSubmit} disabled={quickBusy || !quickAdd.trim()} className="px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40">
            {quickBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
          </button>
        </div>
        {parsedPreview && (
          <div className="px-4 py-2 bg-blue-500/[0.06] border-b border-blue-500/20 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-blue-200 tabular-nums">
              {new Date(parsedPreview.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {' · '}
              {new Date(parsedPreview.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              {' – '}
              {new Date(parsedPreview.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              {parsedPreview.recurrence ? ` · repeats ${parsedPreview.recurrence.freq}` : ''}
              {' · '}
            </span>
            <span className="text-[11px] text-white font-medium flex-1 truncate">{parsedPreview.title}</span>
            <button onClick={() => void confirmQuickAdd()} disabled={quickBusy} className="px-2 py-0.5 text-[11px] rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 disabled:opacity-40">Add event</button>
            <button onClick={() => setParsedPreview(null)} className="px-2 py-0.5 text-[11px] rounded border border-white/15 text-gray-300">Cancel</button>
          </div>
        )}

        {/* AI proposals banner */}
        {proposals && proposals.length > 0 && (
          <div className="px-4 py-2 bg-blue-500/[0.06] border-b border-blue-500/20">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 mb-1">{proposals.length} AI proposal(s) — click to commit</div>
            <div className="flex flex-wrap gap-1.5">
              {proposals.map(p => (
                <button key={p.taskId} onClick={() => commitProposal(p)} className="px-2 py-1 text-[11px] rounded border border-blue-500/30 text-blue-200 hover:bg-blue-500/15 inline-flex items-center gap-1 tabular-nums">
                  <Zap className="w-3 h-3" />{p.title} — {new Date(p.proposedStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          </div>
        )}
        {proposals && proposals.length === 0 && (
          <div className="px-4 py-1.5 bg-white/[0.02] border-b border-white/10 text-[11px] text-gray-400">AI auto-schedule: no open unblocked tasks to place.</div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto">
          {view === 'month' && <MonthGrid grid={monthGrid} cursor={cursor} today={today} eventsForDay={eventsForDay} calById={calById} onDayClick={openNewEvent} onEventClick={(e) => setEditEvent({ ...e, start: toLocalInput(e.occurrenceStart), end: toLocalInput(e.occurrenceEnd) })} />}
          {view === 'week' && <DayColumns days={weekDays} today={today} eventsForDay={eventsForDay} calById={calById} onEventClick={(e) => setEditEvent({ ...e, start: toLocalInput(e.occurrenceStart), end: toLocalInput(e.occurrenceEnd) })} onDayClick={openNewEvent} />}
          {view === 'day' && <DayColumns days={[cursor]} today={today} eventsForDay={eventsForDay} calById={calById} onEventClick={(e) => setEditEvent({ ...e, start: toLocalInput(e.occurrenceStart), end: toLocalInput(e.occurrenceEnd) })} onDayClick={openNewEvent} />}
        </div>
      </main>

      {/* Event modal */}
      {editEvent && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditEvent(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} className="bg-lattice-deep border border-blue-500/30 rounded-lg w-full max-w-md overflow-hidden" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <CalIcon className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">{editEvent._new ? 'New event' : 'Edit event'}</span>
              <button aria-label="Close" onClick={() => setEditEvent(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-4 space-y-2">
              <input value={editEvent.title || ''} onChange={e => setEditEvent({ ...editEvent, title: e.target.value })} placeholder="Title *" className="w-full px-2 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-gray-400">Start
                  <input type="datetime-local" value={editEvent.start || ''} onChange={e => setEditEvent({ ...editEvent, start: e.target.value })} className="w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                </label>
                <label className="text-[10px] text-gray-400">End
                  <input type="datetime-local" value={editEvent.end || ''} onChange={e => setEditEvent({ ...editEvent, end: e.target.value })} className="w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                </label>
              </div>
              <select value={editEvent.calendarId || ''} onChange={e => setEditEvent({ ...editEvent, calendarId: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={editEvent.location || ''} onChange={e => setEditEvent({ ...editEvent, location: e.target.value })} placeholder="Location" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <textarea value={editEvent.description || ''} onChange={e => setEditEvent({ ...editEvent, description: e.target.value })} placeholder="Description" rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveEvent} className="flex-1 px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">{editEvent._new ? 'Create' : 'Save'}</button>
                {!editEvent._new && editEvent.id && <button onClick={() => deleteEvent(editEvent.id!)} className="px-3 py-1.5 text-xs rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10">Delete</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function MonthGrid({ grid, cursor, today, eventsForDay, calById, onDayClick, onEventClick }: {
  grid: Date[]; cursor: Date; today: Date;
  eventsForDay: (d: Date) => CalEvent[];
  calById: Map<string, CalendarMeta>;
  onDayClick: (d: Date) => void;
  onEventClick: (e: CalEvent) => void;
}) {
  return (
    <div className="grid grid-cols-7 grid-rows-6 h-full min-h-[560px]">
      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
        <div key={d} className="col-span-1 row-span-0 text-[10px] uppercase text-gray-400 font-semibold px-2 py-1 border-b border-white/5">{d}</div>
      ))}
      {grid.map((d, i) => {
        const inMonth = d.getMonth() === cursor.getMonth();
        const isToday = sameDay(d, today);
        const dayEvents = eventsForDay(d);
        return (
          <div key={i} onClick={() => onDayClick(d)} className={cn('border-r border-b border-white/5 p-1 overflow-hidden cursor-pointer hover:bg-white/[0.02]', !inMonth && 'bg-lattice-deep/30')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className={cn('text-[11px] font-mono tabular-nums mb-0.5 w-5 h-5 flex items-center justify-center rounded-full', isToday ? 'bg-blue-500 text-white' : inMonth ? 'text-gray-300' : 'text-gray-600')}>{d.getDate()}</div>
            <div className="space-y-0.5">
              {dayEvents.slice(0, 4).map(e => {
                const cal = calById.get(e.calendarId);
                return (
                  <button key={e.id + e.occurrenceStart} onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }} className="w-full text-left text-[10px] px-1 py-0.5 rounded truncate tabular-nums" style={{ background: (cal?.color || '#4285f4') + '33', color: cal?.color || '#4285f4' }}>
                    {e.allDay ? '' : new Date(e.occurrenceStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' '}{e.title}
                  </button>
                );
              })}
              {dayEvents.length > 4 && <div className="text-[9px] text-gray-400 px-1 tabular-nums">+{dayEvents.length - 4} more</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayColumns({ days, today, eventsForDay, calById, onEventClick, onDayClick }: {
  days: Date[]; today: Date;
  eventsForDay: (d: Date) => CalEvent[];
  calById: Map<string, CalendarMeta>;
  onEventClick: (e: CalEvent) => void;
  onDayClick: (d: Date) => void;
}) {
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
      {days.map((d, i) => {
        const isToday = sameDay(d, today);
        const dayEvents = eventsForDay(d);
        return (
          <div key={i} className="border-r border-white/5 flex flex-col">
            <div onClick={() => onDayClick(d)} className={cn('px-2 py-1.5 border-b border-white/5 cursor-pointer hover:bg-white/[0.03]', isToday && 'bg-blue-500/[0.06]')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="text-[10px] uppercase text-gray-400">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div className={cn('text-sm font-mono tabular-nums', isToday ? 'text-blue-300' : 'text-gray-300')}>{d.getDate()}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-1 space-y-1">
              {dayEvents.length === 0 && <div className="text-[10px] text-gray-400 italic px-1 py-2">No events</div>}
              {dayEvents.map(e => {
                const cal = calById.get(e.calendarId);
                return (
                  <button key={e.id + e.occurrenceStart} onClick={() => onEventClick(e)} className="w-full text-left rounded p-1.5 border-l-2" style={{ borderColor: cal?.color || '#4285f4', background: (cal?.color || '#4285f4') + '1a' }}>
                    <div className="text-[11px] text-white font-medium truncate">{e.title}</div>
                    <div className="text-[10px] text-gray-400 tabular-nums">
                      {new Date(e.occurrenceStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–{new Date(e.occurrenceEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                    {e.location && <div className="text-[9px] text-gray-400 truncate">📍 {e.location}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default GCalSection;
