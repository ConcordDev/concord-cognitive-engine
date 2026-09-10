'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin,
  Plus, X, Edit2, Trash2, Bell, Repeat, Users,
  Search, Settings, Check, Video,
  ExternalLink, Rocket, CalendarDays, Megaphone, BookOpen, CheckSquare,
  Play, Timer, Loader2, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { EventActionRail } from '@/components/calendar/EventActionRail';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType = 'release' | 'session' | 'deadline' | 'collab' | 'marketing' | 'learning';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  color: string;
  category: string;
  eventType: EventType;
  location?: string;
  url?: string;
  collaborators?: string[];
  platforms?: string[];
  linkedProject?: string;
  reminders?: { time: number; unit: 'minutes' | 'hours' | 'days' | 'weeks' }[];
  recurrence?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
    interval: number;
    endDate?: Date;
  };
  artworkColor?: string;
  /** Real calendar (calendars-list) this event lives on — multi-calendar support. */
  calendarId?: string;
}

interface CalendarCategory {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  icon: EventType;
}

export type ViewMode = 'month' | 'week' | 'day' | 'agenda';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPE_META: Record<EventType, { label: string; color: string }> = {
  release:   { label: 'Launches',        color: '#22c55e' },
  session:   { label: 'Work Sessions',   color: '#06b6d4' },
  deadline:  { label: 'Deadlines',       color: '#ef4444' },
  collab:    { label: 'Collaboration',   color: '#8b5cf6' },
  marketing: { label: 'Marketing',       color: '#f97316' },
  learning:  { label: 'Learning',        color: '#3b82f6' },
};

const COLORS = [
  { name: 'Green',  value: '#22c55e' },
  { name: 'Cyan',   value: '#06b6d4' },
  { name: 'Red',    value: '#ef4444' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Blue',   value: '#3b82f6' },
  { name: 'Pink',   value: '#ec4899' },
  { name: 'Yellow', value: '#eab308' },
];

const PLATFORMS = ['Web', 'Mobile', 'Desktop', 'API', 'Social', 'Email', 'Print'];

const INITIAL_PROJECTS: string[] = [];

const REMINDER_OPTIONS = [
  { label: '1 week before',  time: 1, unit: 'weeks' as const },
  { label: '3 days before',  time: 3, unit: 'days' as const },
  { label: '1 day before',   time: 1, unit: 'days' as const },
  { label: '1 hour before',  time: 1, unit: 'hours' as const },
];

const SESSION_TYPES = ['Deep Work', 'Brainstorm', 'Review', 'Planning', 'Research', 'Workshop'];
const SESSION_DURATIONS = [1, 1.5, 2, 3, 4];

const CategoryIcon = ({ type, className }: { type: EventType; className?: string }) => {
  switch (type) {
    case 'release':   return <Rocket className={className} />;
    case 'session':   return <CalendarDays className={className} />;
    case 'deadline':  return <Clock className={className} />;
    case 'collab':    return <Users className={className} />;
    case 'marketing': return <Megaphone className={className} />;
    case 'learning':  return <BookOpen className={className} />;
  }
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Real-engine wiring — the main grid persists through the STATE-backed
// calendar.events-* macros (server/domains/calendar.js), not a generic
// artifact-CRUD store. The engine's event shape (title/description/location/
// start/end/allDay/recurrence/reminders(minutes[])/attendees/calendarId) is
// narrower than this lens's release-planning UI (eventType/platforms/
// collaborators/linkedProject/artworkColor) — those extra, genuinely-distinct
// fields round-trip inside `description` as a trailing JSON block (a real,
// persisted encoding, not fabricated data) so nothing is lost. `collaborators`
// maps onto the engine's native `attendees` field; `url` maps onto its native
// `conferenceLink` field — no encoding needed for either.
// ---------------------------------------------------------------------------

interface BackendCalendar {
  id: string;
  number: string;
  name: string;
  color: string;
  visible: boolean;
  isDefault: boolean;
}

interface BackendRecurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  count: number | null;
  until: string | null;
}

interface BackendEvent {
  id: string;
  number: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: BackendRecurrence | null;
  reminders: number[];
  attendees: string[];
  conferenceLink: string;
  createdAt: string;
  occurrenceStart?: string;
  occurrenceEnd?: string;
}

interface BackendConflict { eventId: string; title: string; start: string; end: string }

const EVENT_META_DELIM_OPEN = '\n\n<!--concord-cal-meta:';
const EVENT_META_DELIM_CLOSE = '-->';

interface EncodedEventMeta {
  eventType: EventType;
  category: string;
  platforms?: string[];
  linkedProject?: string;
  color?: string;
  artworkColor?: string;
}

function encodeEventDescription(plain: string, meta: EncodedEventMeta): string {
  return `${plain || ''}${EVENT_META_DELIM_OPEN}${JSON.stringify(meta)}${EVENT_META_DELIM_CLOSE}`;
}

function decodeEventDescription(raw: string): { plain: string; meta: EncodedEventMeta } {
  const fallback: EncodedEventMeta = { eventType: 'session', category: EVENT_TYPE_META.session.label };
  const idx = (raw || '').indexOf(EVENT_META_DELIM_OPEN);
  if (idx === -1) return { plain: raw || '', meta: fallback };
  const plain = raw.slice(0, idx);
  const jsonStr = raw.slice(idx + EVENT_META_DELIM_OPEN.length, raw.length - EVENT_META_DELIM_CLOSE.length);
  try {
    const parsed = JSON.parse(jsonStr) as Partial<EncodedEventMeta>;
    const eventType = (parsed.eventType && EVENT_TYPE_META[parsed.eventType]) ? parsed.eventType : 'session';
    return {
      plain,
      meta: {
        eventType,
        category: parsed.category || EVENT_TYPE_META[eventType].label,
        platforms: parsed.platforms,
        linkedProject: parsed.linkedProject,
        color: parsed.color,
        artworkColor: parsed.artworkColor,
      },
    };
  } catch {
    return { plain: raw, meta: fallback };
  }
}

const REMINDER_UNIT_MINUTES: Record<string, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

function remindersToMinutes(reminders?: { time: number; unit: 'minutes' | 'hours' | 'days' | 'weeks' }[]): number[] {
  return (reminders || []).map((r) => Math.max(0, Math.round(r.time * (REMINDER_UNIT_MINUTES[r.unit] || 1))));
}

function minutesToReminders(mins?: number[]): { time: number; unit: 'minutes' | 'hours' | 'days' | 'weeks' }[] {
  return (mins || []).map((m) => {
    if (m > 0 && m % 10080 === 0) return { time: m / 10080, unit: 'weeks' as const };
    if (m > 0 && m % 1440 === 0) return { time: m / 1440, unit: 'days' as const };
    if (m > 0 && m % 60 === 0) return { time: m / 60, unit: 'hours' as const };
    return { time: m, unit: 'minutes' as const };
  });
}

/** Backend occurrence (from events-list, or the master row from events-create/update) → UI CalendarEvent. */
function fromBackendEvent(e: BackendEvent): CalendarEvent {
  const { plain, meta } = decodeEventDescription(e.description || '');
  const typeMeta = EVENT_TYPE_META[meta.eventType];
  return {
    id: e.id,
    title: e.title,
    description: plain,
    startDate: new Date(e.occurrenceStart || e.start),
    endDate: new Date(e.occurrenceEnd || e.end),
    allDay: e.allDay,
    color: meta.color || typeMeta.color,
    category: meta.category || typeMeta.label,
    eventType: meta.eventType,
    location: e.location || undefined,
    url: e.conferenceLink || undefined,
    collaborators: e.attendees && e.attendees.length ? e.attendees : undefined,
    platforms: meta.platforms,
    linkedProject: meta.linkedProject,
    reminders: minutesToReminders(e.reminders),
    recurrence: e.recurrence
      ? { frequency: e.recurrence.freq, interval: e.recurrence.interval, endDate: e.recurrence.until ? new Date(e.recurrence.until) : undefined }
      : undefined,
    artworkColor: meta.artworkColor,
    calendarId: e.calendarId,
  };
}

/** UI CalendarEvent → events-create/events-update params. */
function toBackendEventParams(ev: CalendarEvent): Record<string, unknown> {
  const meta: EncodedEventMeta = {
    eventType: ev.eventType,
    category: ev.category,
    platforms: ev.platforms,
    linkedProject: ev.linkedProject,
    color: ev.color,
    artworkColor: ev.artworkColor,
  };
  const params: Record<string, unknown> = {
    title: ev.title,
    description: encodeEventDescription(ev.description || '', meta),
    location: ev.location || '',
    start: ev.startDate.toISOString(),
    end: ev.endDate.toISOString(),
    allDay: !!ev.allDay,
    reminders: remindersToMinutes(ev.reminders),
    attendees: ev.collaborators || [],
    conferenceLink: ev.url || '',
    recurrence: ev.recurrence
      ? { freq: ev.recurrence.frequency, interval: ev.recurrence.interval, until: ev.recurrence.endDate ? ev.recurrence.endDate.toISOString() : null }
      : null,
  };
  if (ev.calendarId) params.calendarId = ev.calendarId;
  return params;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarGridWorkbench() {
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('calendar');

  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<BackendCalendar[]>([]);

  // Categories are the event-type filter (Launches/Work Sessions/Deadlines/…) —
  // a fixed, always-real set derived from EVENT_TYPE_META. (Previously this read
  // a generic 'category' artifact list that nothing ever wrote to, so the
  // sidebar's category filter always rendered "No categories yet" and the
  // per-day visibility filter silently no-op'd. Deriving from the same table
  // the event-type picker already uses makes the filter genuinely work.)
  const [categoryVisibility, setCategoryVisibility] = useState<Record<EventType, boolean>>({
    release: true, session: true, deadline: true, collab: true, marketing: true, learning: true,
  });
  const categories: CalendarCategory[] = useMemo(
    () => (Object.keys(EVENT_TYPE_META) as EventType[]).map((type) => ({
      id: type,
      name: EVENT_TYPE_META[type].label,
      color: EVENT_TYPE_META[type].color,
      visible: categoryVisibility[type] ?? true,
      icon: type,
    })),
    [categoryVisibility],
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  // New event form
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '',
    description: '',
    startDate: new Date(),
    endDate: new Date(),
    allDay: false,
    color: COLORS[0].value,
    category: EVENT_TYPE_META.release.label,
    eventType: 'release',
    platforms: [],
    collaborators: [],
    linkedProject: '',
    reminders: [],
  });

  // Quick-book session form
  const [bookSession, setBookSession] = useState({
    sessionType: SESSION_TYPES[0],
    duration: 2,
    date: new Date(),
    hour: 10,
  });

  const [collaboratorInput, setCollaboratorInput] = useState('');

  // Live conflict check against the real, STATE-backed calendar.conflicts-check
  // macro — recomputed (debounced) whenever the composer's start/end changes.
  // A feature the generic artifact-CRUD store could never offer (it had no
  // notion of "my other real events").
  const [conflicts, setConflicts] = useState<BackendConflict[]>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  // Fetch real calendars + events from the STATE-backed engine (calendars-list /
  // events-list — server/domains/calendar.js). Range spans 2 months back
  // through 4 months forward from the visible month: enough for month/week/day
  // navigation without a refetch on every click, and enough for the agenda
  // view's "upcoming events" list to have real substance.
  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    setError(null);
    try {
      const base = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const rangeStart = new Date(base.getFullYear(), base.getMonth() - 2, 1).toISOString();
      const rangeEnd = new Date(base.getFullYear(), base.getMonth() + 4, 1).toISOString();
      const [calRes, evRes] = await Promise.all([
        lensRun({ domain: 'calendar', action: 'calendars-list', input: {} }),
        lensRun({ domain: 'calendar', action: 'events-list', input: { rangeStart, rangeEnd } }),
      ]);
      if (calRes.data.ok === false) throw new Error(calRes.data.error || 'Failed to load calendars');
      if (evRes.data.ok === false) throw new Error(evRes.data.error || 'Failed to load events');
      const backendCalendars = (calRes.data.result as { calendars?: BackendCalendar[] } | null)?.calendars || [];
      const backendEvents = (evRes.data.result as { events?: BackendEvent[] } | null)?.events || [];
      setCalendars(backendCalendars);
      setEvents(backendEvents.map(fromBackendEvent));
    } catch (e) {
      setIsError(true);
      setError({ message: e instanceof Error ? e.message : 'Failed to load calendar' });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced live conflict check while the composer is open.
  useEffect(() => {
    if (!showCreateModal || !newEvent.startDate || !newEvent.endDate) { setConflicts([]); return; }
    const start = newEvent.startDate;
    const end = newEvent.endDate;
    let cancelled = false;
    setCheckingConflicts(true);
    const t = setTimeout(async () => {
      try {
        const r = await lensRun({
          domain: 'calendar',
          action: 'conflicts-check',
          input: { start: start.toISOString(), end: end.toISOString(), excludeEventId: editingEventId || undefined },
        });
        if (cancelled) return;
        setConflicts(r.data.ok === false ? [] : ((r.data.result as { conflicts?: BackendConflict[] } | null)?.conflicts || []));
      } catch {
        if (!cancelled) setConflicts([]);
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [showCreateModal, newEvent.startDate, newEvent.endDate, editingEventId]);

  // Derive project list from event data, seeded with INITIAL_PROJECTS defaults
  const projects: string[] = useMemo(() => {
    const projectSet = new Set<string>(INITIAL_PROJECTS);
    events.forEach(e => {
      if (e.linkedProject) projectSet.add(e.linkedProject);
    });
    return Array.from(projectSet).sort();
  }, [events]);

  // Calendar calculations
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getWeekDates = (date: Date) => {
    const day = date.getDay();
    const diff = date.getDate() - day;
    const weekStart = new Date(date);
    weekStart.setDate(diff);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  };

  const getHoursArray = () => Array.from({ length: 24 }, (_, i) => i);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  const getEventsForDay = (date: Date) => {
    return events.filter((event) => {
      const eventStart = new Date(event.startDate);
      const categoryVisible = categories.find((c) => c.name === event.category)?.visible ?? true;
      if (!categoryVisible) return false;
      const calVisible = calendars.find((c) => c.id === event.calendarId)?.visible ?? true;
      if (!calVisible) return false;
      return isSameDay(eventStart, date);
    });
  };

  const getEventsForHour = (date: Date, hour: number) => {
    return events.filter((event) => {
      const eventStart = new Date(event.startDate);
      return (
        isSameDay(eventStart, date) &&
        !event.allDay &&
        eventStart.getHours() === hour
      );
    });
  };

  const navigateMonth = (direction: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
  };

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + direction * 7);
    setCurrentDate(newDate);
  };

  const navigateDay = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + direction);
    setCurrentDate(newDate);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatDateRange = (start: Date, end: Date, allDay: boolean) => {
    if (allDay) return 'All day';
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  const getDaysUntil = (date: Date) => {
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const handleEventTypeChange = (eventType: EventType) => {
    const meta = EVENT_TYPE_META[eventType];
    const cat = categories.find((c) => c.icon === eventType);
    setNewEvent({
      ...newEvent,
      eventType,
      color: meta.color,
      category: cat?.name || meta.label,
    });
  };

  const handleTogglePlatform = (platform: string) => {
    const current = newEvent.platforms || [];
    const updated = current.includes(platform)
      ? current.filter((p) => p !== platform)
      : [...current, platform];
    setNewEvent({ ...newEvent, platforms: updated });
  };

  const handleToggleReminder = (reminder: { time: number; unit: 'minutes' | 'hours' | 'days' | 'weeks' }) => {
    const current = newEvent.reminders || [];
    const exists = current.some((r) => r.time === reminder.time && r.unit === reminder.unit);
    const updated = exists
      ? current.filter((r) => !(r.time === reminder.time && r.unit === reminder.unit))
      : [...current, reminder];
    setNewEvent({ ...newEvent, reminders: updated });
  };

  const handleAddCollaborator = () => {
    if (!collaboratorInput.trim()) return;
    const tag = collaboratorInput.startsWith('@') ? collaboratorInput : `@${collaboratorInput}`;
    setNewEvent({ ...newEvent, collaborators: [...(newEvent.collaborators || []), tag] });
    setCollaboratorInput('');
  };

  const handleRemoveCollaborator = (tag: string) => {
    setNewEvent({ ...newEvent, collaborators: (newEvent.collaborators || []).filter((c) => c !== tag) });
  };

  const defaultNewEventForm = (): Partial<CalendarEvent> => ({
    title: '',
    description: '',
    startDate: new Date(),
    endDate: new Date(),
    allDay: false,
    color: COLORS[0].value,
    category: EVENT_TYPE_META.release.label,
    eventType: 'release',
    platforms: [],
    collaborators: [],
    linkedProject: '',
    reminders: [],
  });

  const handleCreateEvent = async () => {
    if (!newEvent.title) return;
    const defaultCalId = calendars.find((c) => c.isDefault)?.id || calendars[0]?.id;

    const event: CalendarEvent = {
      id: editingEventId || `pending_${Date.now()}`,
      title: newEvent.title,
      description: newEvent.description,
      startDate: newEvent.startDate || new Date(),
      endDate: newEvent.endDate || new Date(),
      allDay: newEvent.allDay || false,
      color: newEvent.color || COLORS[0].value,
      category: newEvent.category || EVENT_TYPE_META.release.label,
      eventType: newEvent.eventType || 'release',
      location: newEvent.location,
      url: newEvent.url,
      platforms: newEvent.platforms,
      collaborators: newEvent.collaborators,
      linkedProject: newEvent.linkedProject,
      reminders: newEvent.reminders,
      recurrence: newEvent.recurrence,
      artworkColor: newEvent.artworkColor,
      calendarId: newEvent.calendarId || defaultCalId,
    };

    // Optimistic UI: show the end state immediately, reconcile (or roll back)
    // once the real events-create/events-update call lands.
    const wasEditing = editingEventId;
    const previousEvents = events;
    setEvents((prev) => (wasEditing ? prev.map((e) => (e.id === wasEditing ? event : e)) : [...prev, event]));
    setEditingEventId(null);
    setShowCreateModal(false);
    setNewEvent(defaultNewEventForm());

    try {
      const params = toBackendEventParams(event);
      if (wasEditing) {
        (params as Record<string, unknown>).id = wasEditing;
        const r = await lensRun({ domain: 'calendar', action: 'events-update', input: params });
        if (r.data.ok === false) throw new Error(r.data.error || 'Failed to update event');
      } else {
        const r = await lensRun({ domain: 'calendar', action: 'events-create', input: params });
        if (r.data.ok === false) throw new Error(r.data.error || 'Failed to create event');
      }
      await fetchData();
    } catch (e) {
      setEvents(previousEvents);
      useUIStore.getState().addToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save event' });
    }
  };

  // Lens-scoped keyboard commands. Standard calendar verbs (Google
  // Calendar / Fantastical idiom): m/w/d/a switch view; n opens the
  // event composer; t jumps to today; j/k navigate by viewMode period;
  // arrows do the same as j/k for non-Vim users.
  const shiftDate = (days: number) => setSelectedDate((prev) => {
    const next = new Date(prev);
    next.setDate(next.getDate() + days);
    return next;
  });
  const shiftMonth = (months: number) => setSelectedDate((prev) => {
    const next = new Date(prev);
    next.setMonth(next.getMonth() + months);
    return next;
  });
  const periodForward = () => {
    if (viewMode === 'month') shiftMonth(1);
    else if (viewMode === 'week') shiftDate(7);
    else shiftDate(1);
  };
  const periodBackward = () => {
    if (viewMode === 'month') shiftMonth(-1);
    else if (viewMode === 'week') shiftDate(-7);
    else shiftDate(-1);
  };

  useLensCommand(
    [
      { id: 'view-month',  keys: 'm', description: 'Month view',  category: 'view', action: () => setViewMode('month') },
      { id: 'view-week',   keys: 'w', description: 'Week view',   category: 'view', action: () => setViewMode('week') },
      { id: 'view-day',    keys: 'd', description: 'Day view',    category: 'view', action: () => setViewMode('day') },
      { id: 'view-agenda', keys: 'a', description: 'Agenda view', category: 'view', action: () => setViewMode('agenda') },
      { id: 'new-event',   keys: 'n', description: 'New event',   category: 'actions', action: () => setShowCreateModal(true) },
      { id: 'goto-today',  keys: 't', description: 'Jump to today', category: 'navigation', action: () => setSelectedDate(new Date()) },
      { id: 'next',        keys: 'j', description: 'Next period',     category: 'navigation', action: periodForward },
      { id: 'prev',        keys: 'k', description: 'Previous period', category: 'navigation', action: periodBackward },
      { id: 'next-arr',    keys: 'right', description: 'Next period',     category: 'navigation', action: periodForward },
      { id: 'prev-arr',    keys: 'left',  description: 'Previous period', category: 'navigation', action: periodBackward },
      { id: 'close-create', keys: 'esc', description: 'Close composer', category: 'navigation', action: () => setShowCreateModal(false) },
    ],
    { lensId: 'calendar' }
  );

  const handleBookSession = async () => {
    const start = new Date(bookSession.date);
    start.setHours(bookSession.hour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(start.getMinutes() + bookSession.duration * 60);
    const defaultCalId = calendars.find((c) => c.isDefault)?.id || calendars[0]?.id;

    const event: CalendarEvent = {
      id: `pending_${Date.now()}`,
      title: `${bookSession.sessionType} Session`,
      startDate: start,
      endDate: end,
      allDay: false,
      color: EVENT_TYPE_META.session.color,
      category: EVENT_TYPE_META.session.label,
      eventType: 'session',
      location: '',
      reminders: [{ time: 1, unit: 'hours' }],
      calendarId: defaultCalId,
    };

    const previousEvents = events;
    setEvents((prev) => [...prev, event]);
    setShowBookingModal(false);

    try {
      const r = await lensRun({ domain: 'calendar', action: 'events-create', input: toBackendEventParams(event) });
      if (r.data.ok === false) throw new Error(r.data.error || 'Failed to book session');
      await fetchData();
    } catch (e) {
      setEvents(previousEvents);
      useUIStore.getState().addToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to book session' });
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    const previousEvents = events;
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    setSelectedEvent(null);
    setShowEventModal(false);
    try {
      const r = await lensRun({ domain: 'calendar', action: 'events-delete', input: { id: eventId } });
      if (r.data.ok === false) throw new Error(r.data.error || 'Failed to delete event');
    } catch (e) {
      setEvents(previousEvents);
      useUIStore.getState().addToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to delete event' });
    }
  };

  const toggleCategoryVisibility = (categoryId: string) => {
    setCategoryVisibility((prev) => ({ ...prev, [categoryId]: !(prev[categoryId as EventType] ?? true) }));
  };

  // Multi-calendar filter/picker — real calendars-list/calendars-update/
  // calendars-create, a feature the generic artifact-CRUD store had no
  // concept of at all.
  const toggleCalendarVisibility = async (cal: BackendCalendar) => {
    setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, visible: !c.visible } : c)));
    try {
      const r = await lensRun({ domain: 'calendar', action: 'calendars-update', input: { id: cal.id, visible: !cal.visible } });
      if (r.data.ok === false) throw new Error(r.data.error || 'Failed to update calendar');
    } catch (e) {
      setCalendars((prev) => prev.map((c) => (c.id === cal.id ? { ...c, visible: cal.visible } : c)));
      useUIStore.getState().addToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to update calendar' });
    }
  };

  const handleAddCalendar = async () => {
    const name = typeof window !== 'undefined' ? window.prompt('New calendar name?') : null;
    if (!name?.trim()) return;
    try {
      const r = await lensRun({ domain: 'calendar', action: 'calendars-create', input: { name: name.trim() } });
      if (r.data.ok === false) throw new Error(r.data.error || 'Failed to create calendar');
      await fetchData();
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: e instanceof Error ? e.message : 'Failed to create calendar' });
    }
  };

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  const renderMonthView = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const prevMonthDays = getDaysInMonth(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

    const days: (Date | null)[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, prevMonthDays - i);
      days.push(d);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i));
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, i));
    }

    return (
      <div className="flex-1 flex flex-col">
        <div className="grid grid-cols-7 border-b border-lattice-border">
          {DAY_NAMES.map((day) => (
            <div key={day} className="py-3 text-center text-sm font-medium text-gray-400">
              {day}
            </div>
          ))}
        </div>

        <div className="flex-1 grid grid-cols-7 grid-rows-6">
          {days.map((date, index) => {
            if (!date) return <div key={index} />;

            const isCurrentMonth = date.getMonth() === currentDate.getMonth();
            const dayEvents = getEventsForDay(date);
            const isSelected = isSameDay(date, selectedDate);

            return (
              <div
                key={index}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  'min-h-[100px] border-b border-r border-lattice-border p-1 cursor-pointer transition-colors',
                  !isCurrentMonth && 'bg-lattice-deep/30',
                  isSelected && 'bg-neon-cyan/5',
                  isToday(date) && 'bg-neon-blue/10'
                )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={cn(
                      'w-7 h-7 flex items-center justify-center rounded-full text-sm tabular-nums',
                      isToday(date) && 'bg-neon-blue text-white',
                      !isCurrentMonth && 'text-gray-400'
                    )}
                  >
                    {date.getDate()}
                  </span>
                  {dayEvents.length > 3 && (
                    <span className="text-xs text-gray-400 tabular-nums">+{dayEvents.length - 3}</span>
                  )}
                </div>

                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <button
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(event);
                        setShowEventModal(true);
                      }}
                      className="w-full text-left px-1.5 py-0.5 rounded text-xs truncate font-medium transition-colors hover:opacity-80 flex items-center gap-1"
                      style={{ backgroundColor: event.color + '30', color: event.color }}
                    >
                      <CategoryIcon type={event.eventType} className="w-3 h-3 flex-shrink-0" />
                      {!event.allDay && (
                        <span className="opacity-70 tabular-nums">{formatTime(new Date(event.startDate))} </span>
                      )}
                      <span className="truncate">{event.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDates = getWeekDates(currentDate);
    const hours = getHoursArray();

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-lattice-border">
          <div className="w-16 flex-shrink-0" />
          {weekDates.map((date, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 py-2 text-center border-l border-lattice-border',
                isToday(date) && 'bg-neon-blue/10'
              )}
            >
              <p className="text-xs text-gray-400">{DAY_NAMES[i]}</p>
              <p className={cn('text-lg font-semibold tabular-nums', isToday(date) && 'text-neon-blue')}>
                {date.getDate()}
              </p>
            </div>
          ))}
        </div>

        <div className="flex border-b border-lattice-border min-h-[40px]">
          <div className="w-16 flex-shrink-0 flex items-center justify-center text-xs text-gray-400">
            All day
          </div>
          {weekDates.map((date, i) => {
            const allDayEvents = getEventsForDay(date).filter((e) => e.allDay);
            return (
              <div key={i} className="flex-1 border-l border-lattice-border p-1 sm:p-3 space-y-1">
                {allDayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => {
                      setSelectedEvent(event);
                      setShowEventModal(true);
                    }}
                    className="w-full text-left px-2 py-1 rounded text-xs font-medium truncate flex items-center gap-1"
                    style={{ backgroundColor: event.color + '30', color: event.color }}
                  >
                    <CategoryIcon type={event.eventType} className="w-3 h-3 flex-shrink-0" />
                    {event.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="relative">
            {hours.map((hour) => (
              <div key={hour} className="flex h-16 border-b border-lattice-border/50">
                <div className="w-16 flex-shrink-0 flex items-start justify-center -mt-2 text-xs text-gray-400 tabular-nums">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </div>
                {weekDates.map((date, i) => {
                  const hourEvents = getEventsForHour(date, hour);
                  return (
                    <div
                      key={i}
                      className="flex-1 border-l border-lattice-border/50 relative"
                      onClick={() => {
                        const newStart = new Date(date);
                        newStart.setHours(hour, 0, 0, 0);
                        const newEnd = new Date(newStart);
                        newEnd.setHours(hour + 1);
                        setNewEvent({ ...newEvent, startDate: newStart, endDate: newEnd });
                        setEditingEventId(null);
                        setShowCreateModal(true);
                      }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                      {hourEvents.map((event) => {
                        const start = new Date(event.startDate);
                        const end = new Date(event.endDate);
                        const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                        const top = (start.getMinutes() / 60) * 64;
                        const height = Math.max(duration * 64, 20);

                        return (
                          <button
                            key={event.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                              setShowEventModal(true);
                            }}
                            className="absolute left-1 right-1 rounded px-2 py-1 text-xs font-medium overflow-hidden z-10"
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              backgroundColor: event.color + '30',
                              color: event.color,
                              borderLeft: `3px solid ${event.color}`,
                            }}
                          >
                            <p className="font-semibold truncate flex items-center gap-1">
                              <CategoryIcon type={event.eventType} className="w-3 h-3" />
                              {event.title}
                            </p>
                            <p className="opacity-70 text-[10px] tabular-nums">{formatTime(start)}</p>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = getHoursArray();
    const dayEvents = getEventsForDay(selectedDate);
    const allDayEvents = dayEvents.filter((e) => e.allDay);

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="py-4 text-center border-b border-lattice-border">
          <p className="text-sm text-gray-400">{DAY_NAMES_FULL[selectedDate.getDay()]}</p>
          <p className={cn('text-3xl font-bold tabular-nums', isToday(selectedDate) && 'text-neon-blue')}>
            {selectedDate.getDate()}
          </p>
          <p className="text-sm text-gray-400 tabular-nums">
            {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}
          </p>
        </div>

        {allDayEvents.length > 0 && (
          <div className="border-b border-lattice-border p-2 space-y-1">
            <p className="text-xs text-gray-400 mb-1">All day</p>
            {allDayEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => {
                  setSelectedEvent(event);
                  setShowEventModal(true);
                }}
                className="w-full text-left px-3 py-2 rounded font-medium flex items-center gap-2"
                style={{ backgroundColor: event.color + '30', color: event.color }}
              >
                <CategoryIcon type={event.eventType} className="w-4 h-4" />
                {event.title}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {hours.map((hour) => {
            const hourEvents = getEventsForHour(selectedDate, hour);

            return (
              <div key={hour} className="flex h-20 border-b border-lattice-border/50">
                <div className="w-20 flex-shrink-0 flex items-start justify-center pt-1 text-sm text-gray-400 tabular-nums">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </div>
                <div
                  className="flex-1 relative border-l border-lattice-border/50"
                  onClick={() => {
                    const newStart = new Date(selectedDate);
                    newStart.setHours(hour, 0, 0, 0);
                    const newEnd = new Date(newStart);
                    newEnd.setHours(hour + 1);
                    setNewEvent({ ...newEvent, startDate: newStart, endDate: newEnd });
                    setEditingEventId(null);
                    setShowCreateModal(true);
                  }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  {hourEvents.map((event) => {
                    const start = new Date(event.startDate);
                    const end = new Date(event.endDate);
                    const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
                    const top = (start.getMinutes() / 60) * 80;
                    const height = Math.max(duration * 80, 30);

                    return (
                      <button
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(event);
                          setShowEventModal(true);
                        }}
                        className="absolute left-2 right-2 rounded-lg px-3 py-2 text-sm overflow-hidden"
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          backgroundColor: event.color + '30',
                          color: event.color,
                          borderLeft: `4px solid ${event.color}`,
                        }}
                      >
                        <p className="font-semibold flex items-center gap-1">
                          <CategoryIcon type={event.eventType} className="w-4 h-4" />
                          {event.title}
                        </p>
                        <p className="text-xs opacity-70 tabular-nums">
                          {formatDateRange(start, end, event.allDay)}
                        </p>
                        {event.location && (
                          <p className="text-xs opacity-70 flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" />
                            {event.location}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderReleaseTimeline = () => {
    const releaseEvents = events
      .filter((e) => e.eventType === 'release' && new Date(e.startDate) >= new Date())
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 6);

    if (releaseEvents.length === 0) return null;

    return (
      <div className="border-t border-lattice-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Rocket className="w-5 h-5 text-neon-cyan" />
          <h3 className="text-lg font-semibold text-neon-cyan">Upcoming Releases</h3>
        </div>

        <div className="relative">
          <div className="absolute top-8 left-0 right-0 h-0.5 bg-lattice-border" />
          <div className="flex gap-4 flex-wrap pb-2">
            {releaseEvents.map((event) => {
              const daysLeft = getDaysUntil(new Date(event.startDate));
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex-shrink-0 w-48"
                >
                  <div className="flex flex-col items-center">
                    <div className="w-4 h-4 rounded-full bg-neon-cyan border-2 border-lattice-surface z-10 mb-3" />
                    <div
                      className="w-full rounded-lg border border-lattice-border p-3 bg-lattice-elevated hover:border-neon-cyan/40 transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedEvent(event);
                        setShowEventModal(true);
                      }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                      {/* Artwork gradient */}
                      <div
                        className="w-full h-20 rounded-md mb-2 flex items-center justify-center"
                        style={{
                          background: `linear-gradient(135deg, ${event.artworkColor || event.color}40, ${event.color}20)`,
                        }}
                      >
                        <CalendarDays className="w-8 h-8" style={{ color: event.artworkColor || event.color }} />
                      </div>
                      <p className="font-semibold text-sm truncate">{event.title}</p>
                      <p className="text-xs text-gray-400 mt-1 tabular-nums">
                        {new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                      {/* Platform icons */}
                      {event.platforms && event.platforms.length > 0 && (
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          {event.platforms.map((p) => (
                            <span
                              key={p}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-deep text-gray-400"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Countdown */}
                      <div className="mt-2 flex items-center gap-1">
                        <Timer className="w-3 h-3 text-neon-cyan" />
                        <span className={cn(
                          'text-xs font-semibold tabular-nums',
                          daysLeft <= 3 ? 'text-red-400' : daysLeft <= 7 ? 'text-yellow-400' : 'text-neon-cyan'
                        )}>
                          {daysLeft <= 0 ? 'Today!' : `${daysLeft}d left`}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderAgendaView = () => {
    const upcomingEvents = events
      .filter((e) => new Date(e.startDate) >= new Date())
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 30);

    const groupedEvents: { [key: string]: CalendarEvent[] } = {};
    upcomingEvents.forEach((event) => {
      const dateKey = new Date(event.startDate).toDateString();
      if (!groupedEvents[dateKey]) groupedEvents[dateKey] = [];
      groupedEvents[dateKey].push(event);
    });

    return (
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="flex-1 p-4">
          {Object.entries(groupedEvents).map(([dateKey, dayEvents]) => {
            const date = new Date(dateKey);
            return (
              <div key={dateKey} className="mb-6">
                <div className="flex items-center gap-4 mb-3">
                  <div
                    className={cn(
                      'w-12 h-12 rounded-lg flex flex-col items-center justify-center',
                      isToday(date) ? 'bg-neon-blue text-white' : 'bg-lattice-elevated'
                    )}
                  >
                    <span className="text-xs">{DAY_NAMES[date.getDay()]}</span>
                    <span className="text-lg font-bold tabular-nums">{date.getDate()}</span>
                  </div>
                  <div>
                    <p className="font-semibold">{DAY_NAMES_FULL[date.getDay()]}</p>
                    <p className="text-sm text-gray-400 tabular-nums">
                      {MONTH_NAMES[date.getMonth()]} {date.getFullYear()}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 ml-16">
                  {dayEvents.map((event) => (
                    <button
                      key={event.id}
                      onClick={() => {
                        setSelectedEvent(event);
                        setShowEventModal(true);
                      }}
                      className="w-full text-left p-3 rounded-lg hover:bg-lattice-elevated transition-colors"
                      style={{ borderLeft: `4px solid ${event.color}` }}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium flex items-center gap-2">
                          <CategoryIcon type={event.eventType} className="w-4 h-4" />
                          {event.title}
                        </h4>
                        <span className="text-sm text-gray-400 tabular-nums">
                          {formatDateRange(new Date(event.startDate), new Date(event.endDate), event.allDay)}
                        </span>
                      </div>
                      {event.location && (
                        <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3" />
                          {event.location}
                        </p>
                      )}
                      {event.collaborators && event.collaborators.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          {event.collaborators.map((c) => (
                            <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      {event.description && (
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">{event.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {upcomingEvents.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <CalendarDays className="w-16 h-16 mb-4 opacity-30" />
              <p>No upcoming events</p>
              <button
                onClick={() => { setEditingEventId(null); setShowCreateModal(true); }}
                className="mt-4 btn-neon"
              >
                Schedule Something
              </button>
            </div>
          )}
        </div>

        {/* Release Timeline */}
        {renderReleaseTimeline()}
      </div>
    );
  };

  const renderSidebar = () => (
    <AnimatePresence>
      {showSidebar && (
        <motion.aside
          initial={{ width: 0 }}
          animate={{ width: 280 }}
          exit={{ width: 0 }}
          className="border-r border-lattice-border bg-lattice-surface/30 overflow-hidden flex-shrink-0"
        >
          <div className="w-70 p-4 space-y-6">
            {/* Mini calendar */}
            <div className="panel p-3">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => navigateMonth(-1)} className="p-1 rounded hover:bg-lattice-elevated" aria-label="Previous">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium tabular-nums">
                  {MONTH_NAMES[currentDate.getMonth()]} {currentDate.getFullYear()}
                </span>
                <button onClick={() => navigateMonth(1)} className="p-1 rounded hover:bg-lattice-elevated" aria-label="Next">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {DAY_NAMES.map((day) => (
                  <div key={day} className="text-[10px] text-gray-400 py-1">
                    {day[0]}
                  </div>
                ))}

                {(() => {
                  const firstDay = getFirstDayOfMonth(currentDate);
                  const daysInMonth = getDaysInMonth(currentDate);
                  const days = [];

                  for (let i = 0; i < firstDay; i++) {
                    days.push(<div key={`empty-${i}`} />);
                  }

                  for (let i = 1; i <= daysInMonth; i++) {
                    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), i);
                    const hasEvents = getEventsForDay(date).length > 0;

                    days.push(
                      <button
                        key={i}
                        onClick={() => setSelectedDate(date)}
                        className={cn(
                          'w-7 h-7 rounded-full text-xs tabular-nums transition-colors relative',
                          isToday(date) && 'bg-neon-blue text-white',
                          isSameDay(date, selectedDate) && !isToday(date) && 'bg-neon-cyan/20 text-neon-cyan',
                          !isToday(date) && !isSameDay(date, selectedDate) && 'hover:bg-lattice-elevated'
                        )}
                      >
                        {i}
                        {hasEvents && !isToday(date) && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-cyan" />
                        )}
                      </button>
                    );
                  }

                  return days;
                })()}
              </div>
            </div>

            {/* Create button */}
            <button
              onClick={() => { setEditingEventId(null); setShowCreateModal(true); }}
              className="w-full btn-neon flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Schedule Event
            </button>

            {/* Calendars — real calendars-list/calendars-update multi-calendar
                filter + calendars-create, distinct from the event-type
                categories below (a "which real calendar" filter vs. a
                "which kind of event" filter). */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium">Calendars</h4>
                <button
                  onClick={handleAddCalendar}
                  className="p-1 rounded hover:bg-lattice-elevated text-gray-400 hover:text-white"
                  aria-label="Add calendar"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-2">
                {calendars.length === 0 && (
                  <p className="text-xs text-gray-400 py-2">No calendars yet.</p>
                )}
                {calendars.map((cal) => (
                  <button
                    key={cal.id}
                    onClick={() => toggleCalendarVisibility(cal)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded flex items-center justify-center',
                        cal.visible ? 'opacity-100' : 'opacity-30'
                      )}
                      style={{ backgroundColor: cal.color }}
                    >
                      {cal.visible && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className={cn('text-sm', !cal.visible && 'text-gray-400')}>
                      {cal.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Categories */}
            <div>
              <h4 className="text-sm font-medium mb-3">Categories</h4>
              <div className="space-y-2">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => toggleCategoryVisibility(category.id)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded flex items-center justify-center',
                        category.visible ? 'opacity-100' : 'opacity-30'
                      )}
                      style={{ backgroundColor: category.color }}
                    >
                      {category.visible && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <CategoryIcon
                      type={category.icon}
                      className={cn('w-4 h-4', !category.visible && 'text-gray-400')}
                    />
                    <span className={cn('text-sm', !category.visible && 'text-gray-400')}>
                      {category.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected date events */}
            <div>
              <h4 className="text-sm font-medium mb-3">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h4>
              <div className="space-y-2">
                {getEventsForDay(selectedDate).length > 0 ? (
                  getEventsForDay(selectedDate).map((event) => (
                    <button
                      key={event.id}
                      onClick={() => {
                        setSelectedEvent(event);
                        setShowEventModal(true);
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
                      style={{ borderLeft: `3px solid ${event.color}` }}
                    >
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <CategoryIcon type={event.eventType} className="w-3 h-3" />
                        {event.title}
                      </p>
                      <p className="text-xs text-gray-400 tabular-nums">
                        {formatDateRange(new Date(event.startDate), new Date(event.endDate), event.allDay)}
                      </p>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">No events</p>
                )}
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------


  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading calendar</span>
        {/* Header skeleton — mirrors the toolbar (today / nav / title / view switch) */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
          <div className="flex items-center gap-4">
            <Skeleton variant="block" width={36} height={36} className="!rounded-lg" />
            <Skeleton variant="line" width="4.5rem" height="2rem" className="!rounded-lg" />
            <Skeleton variant="line" width="8rem" height="1.5rem" />
          </div>
          <Skeleton variant="line" width="12rem" height="2rem" className="!rounded-lg" />
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar skeleton — mini calendar + calendars + categories */}
          <aside className="w-[280px] border-r border-lattice-border bg-lattice-surface/30 p-4 space-y-6 flex-shrink-0">
            <div className="panel p-3 space-y-2">
              <Skeleton variant="line" width="60%" className="mx-auto" />
              <div className="grid grid-cols-7 gap-1.5 pt-2">
                {Array.from({ length: 28 }).map((_, i) => (
                  <Skeleton key={i} variant="avatar" width="100%" height={22} className="!rounded" />
                ))}
              </div>
            </div>
            <Skeleton variant="line" height="2.25rem" className="!rounded-lg" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton variant="avatar" width={16} height={16} className="!rounded" />
                  <Skeleton variant="line" width={`${50 + i * 8}%`} />
                </div>
              ))}
            </div>
          </aside>

          {/* Grid skeleton — 7-column month grid, matching the real header + cells */}
          <main className="flex-1 flex flex-col overflow-hidden bg-lattice-deep">
            <div className="grid grid-cols-7 border-b border-lattice-border">
              {DAY_NAMES.map((day) => (
                <div key={day} className="py-3 text-center text-sm font-medium text-gray-400">{day}</div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7 grid-rows-5">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="min-h-[100px] border-b border-r border-lattice-border p-1.5 space-y-1.5">
                  <Skeleton variant="line" width="1.25rem" height="1.25rem" className="!rounded-full" />
                  {(i * 7) % 5 === 0 && <Skeleton variant="line" height="0.875rem" />}
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8" role="alert" aria-live="assertive">
        <ErrorState error={error?.message} onRetry={() => { fetchData(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="calendar" className="h-[calc(100vh-8rem)] flex flex-col min-h-[640px]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
          aria-label="Calendar icon">
            <CalendarIcon className="w-5 h-5" />
          </button>

          <button onClick={goToToday} className="px-4 py-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated text-sm font-medium">
            Today
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth(-1);
                else if (viewMode === 'week') navigateWeek(-1);
                else navigateDay(-1);
              }}
              className="p-2 rounded-lg hover:bg-lattice-elevated"
            aria-label="Previous">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                if (viewMode === 'month') navigateMonth(1);
                else if (viewMode === 'week') navigateWeek(1);
                else navigateDay(1);
              }}
              className="p-2 rounded-lg hover:bg-lattice-elevated"
            aria-label="Next">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <h1 className="text-xl font-semibold tabular-nums">
            {viewMode === 'month' && `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
            {viewMode === 'week' && `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
            {viewMode === 'day' && selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {viewMode === 'agenda' && 'Release Schedule'}
          </h1>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="calendar" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-lattice-deep rounded-lg p-1">
            {(['day', 'week', 'month', 'agenda'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors',
                  viewMode === mode
                    ? 'bg-neon-cyan/20 text-neon-cyan'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          <button onClick={() => setShowSidebar(!showSidebar)} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" aria-label="Search">
            <Search className="w-5 h-5" />
          </button>
          <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Calendar settings' })} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" aria-label="Settings">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {renderSidebar()}

        <main className="flex-1 flex flex-col overflow-hidden bg-lattice-deep relative">
          {events.length === 0 && (
            <div className="border-b border-lattice-border bg-lattice-surface/40 px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <CalendarDays className="w-4 h-4 text-neon-cyan/70" />
                <span>No events scheduled yet. Your calendar is empty.</span>
              </div>
              <button
                onClick={() => { setEditingEventId(null); setShowCreateModal(true); }}
                className="btn-neon flex items-center gap-1.5 text-sm px-3 py-1.5 flex-shrink-0"
              >
                <Plus className="w-4 h-4" />
                Create your first event
              </button>
            </div>
          )}
          {viewMode === 'month' && renderMonthView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'day' && renderDayView()}
          {viewMode === 'agenda' && renderAgendaView()}

          {/* Book Session floating button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBookingModal(true)}
            className="absolute bottom-6 right-6 flex items-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-shadow z-20"
          >
            <Clock className="w-5 h-5" />
            Book Session
          </motion.button>
        </main>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Event detail modal                                                */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showEventModal && selectedEvent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowEventModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-lattice-surface border border-lattice-border rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_320px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 overflow-y-auto">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: selectedEvent.color + '30' }}
                  >
                    <CategoryIcon type={selectedEvent.eventType} className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedEvent.title}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: selectedEvent.color + '20', color: selectedEvent.color }}>
                      {EVENT_TYPE_META[selectedEvent.eventType]?.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setShowEventModal(false); setEditingEventId(selectedEvent.id); setShowCreateModal(true); setNewEvent(selectedEvent); }} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" aria-label="Edit">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteEvent(selectedEvent.id)}
                    className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-red-400"
                  aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setShowEventModal(false)}
                    className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
                  aria-label="Close">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3 text-gray-400">
                  <Clock className="w-5 h-5" />
                  <div className="tabular-nums">
                    <p>
                      {new Date(selectedEvent.startDate).toLocaleDateString('en-US', {
                        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                    <p className="text-sm">
                      {formatDateRange(new Date(selectedEvent.startDate), new Date(selectedEvent.endDate), selectedEvent.allDay)}
                    </p>
                  </div>
                </div>

                {selectedEvent.location && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <MapPin className="w-5 h-5" />
                    <span>{selectedEvent.location}</span>
                  </div>
                )}

                {selectedEvent.url && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Video className="w-5 h-5" />
                    <a href={selectedEvent.url} className="text-neon-cyan hover:underline">
                      Join session
                    </a>
                  </div>
                )}

                {selectedEvent.linkedProject && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <CheckSquare className="w-5 h-5" />
                    <span>Project: <span className="text-neon-cyan">{selectedEvent.linkedProject}</span></span>
                  </div>
                )}

                {selectedEvent.platforms && selectedEvent.platforms.length > 0 && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Play className="w-5 h-5" />
                    <div className="flex flex-wrap gap-1">
                      {selectedEvent.platforms.map((p) => (
                        <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-lattice-elevated text-gray-300">{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedEvent.collaborators && selectedEvent.collaborators.length > 0 && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Users className="w-5 h-5" />
                    <div className="flex flex-wrap gap-1">
                      {selectedEvent.collaborators.map((c) => (
                        <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">{c}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedEvent.recurrence && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Repeat className="w-5 h-5" />
                    <span className="capitalize">
                      Repeats {selectedEvent.recurrence.frequency}
                      {selectedEvent.recurrence.interval > 1 && ` every ${selectedEvent.recurrence.interval}`}
                    </span>
                  </div>
                )}

                {selectedEvent.reminders && selectedEvent.reminders.length > 0 && (
                  <div className="flex items-center gap-3 text-gray-400">
                    <Bell className="w-5 h-5" />
                    <span className="tabular-nums">
                      {selectedEvent.reminders.map((r) => `${r.time} ${r.unit}`).join(', ')} before
                    </span>
                  </div>
                )}

                {selectedEvent.description && (
                  <div className="pt-4 border-t border-lattice-border">
                    <p className="text-gray-300">{selectedEvent.description}</p>
                  </div>
                )}

                {selectedEvent.eventType === 'release' && (
                  <div className="pt-4 border-t border-lattice-border">
                    <button onClick={() => { window.location.href = '/lenses/board'; }} className="flex items-center gap-2 text-neon-cyan hover:underline">
                      <ExternalLink className="w-4 h-4" />
                      Open release dashboard
                    </button>
                  </div>
                )}
              </div>
              </div>
              <aside className="border-t md:border-t-0 md:border-l border-lattice-border bg-lattice-bg/40 p-4 overflow-y-auto">
                <EventActionRail event={selectedEvent} />
              </aside>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* Create event modal                                                */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-lattice-surface border border-lattice-border rounded-xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Schedule Event</h2>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
                aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Event type selector */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Event Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(EVENT_TYPE_META) as EventType[]).map((type) => {
                      const meta = EVENT_TYPE_META[type];
                      const isActive = newEvent.eventType === type;
                      return (
                        <button
                          key={type}
                          onClick={() => handleEventTypeChange(type)}
                          className={cn(
                            'flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors text-xs',
                            isActive
                              ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                              : 'border-lattice-border hover:border-white/20 text-gray-400'
                          )}
                        >
                          <CategoryIcon type={type} className="w-4 h-4" />
                          <span>{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <input
                    type="text"
                    value={newEvent.title || ''}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                    placeholder="Add title"
                    className="w-full bg-transparent text-xl font-semibold focus:outline-none placeholder-gray-500"
                  />
                </div>

                {/* All day toggle */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvent.allDay}
                      onChange={(e) => setNewEvent({ ...newEvent, allDay: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm">All day</span>
                  </label>
                </div>

                {/* Date/time */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Start</label>
                    <input
                      type="datetime-local"
                      value={newEvent.startDate?.toISOString().slice(0, 16) || ''}
                      onChange={(e) => setNewEvent({ ...newEvent, startDate: new Date(e.target.value) })}
                      className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">End</label>
                    <input
                      type="datetime-local"
                      value={newEvent.endDate?.toISOString().slice(0, 16) || ''}
                      onChange={(e) => setNewEvent({ ...newEvent, endDate: new Date(e.target.value) })}
                      className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    />
                  </div>
                </div>

                {/* Live conflict check — real STATE-backed calendar.conflicts-check
                    against the user's actual saved events, not a pasted scratch pad. */}
                {checkingConflicts && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking for conflicts…
                  </div>
                )}
                {!checkingConflicts && conflicts.length > 0 && (
                  <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-300">
                    <div className="flex items-center gap-1.5 font-semibold mb-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Conflicts with {conflicts.length} existing event{conflicts.length === 1 ? '' : 's'}
                    </div>
                    {conflicts.map((c) => (
                      <div key={`${c.eventId}-${c.start}`} className="text-yellow-200/80 tabular-nums">
                        {c.title} — {new Date(c.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    ))}
                  </div>
                )}

                {/* Calendar (multi-calendar support — real calendars-list) */}
                {calendars.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Calendar</label>
                    <select
                      value={newEvent.calendarId || calendars.find((c) => c.isDefault)?.id || calendars[0]?.id || ''}
                      onChange={(e) => setNewEvent({ ...newEvent, calendarId: e.target.value })}
                      className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    >
                      {calendars.map((cal) => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Repeat (real RRULE-lite recurrence — calendar.expandRecurring via
                    events-list) — the generic artifact store had no way to do this. */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5" /> Repeat
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={newEvent.recurrence?.frequency || 'none'}
                      onChange={(e) => {
                        const freq = e.target.value;
                        if (freq === 'none') { setNewEvent({ ...newEvent, recurrence: undefined }); return; }
                        setNewEvent({
                          ...newEvent,
                          recurrence: {
                            frequency: freq as 'daily' | 'weekly' | 'monthly' | 'yearly',
                            interval: newEvent.recurrence?.interval || 1,
                            endDate: newEvent.recurrence?.endDate,
                          },
                        });
                      }}
                      className="bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                    {newEvent.recurrence && (
                      <>
                        <span className="text-xs text-gray-400">every</span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={newEvent.recurrence.interval}
                          onChange={(e) => setNewEvent({
                            ...newEvent,
                            recurrence: { ...newEvent.recurrence!, interval: Math.max(1, parseInt(e.target.value, 10) || 1) },
                          })}
                          className="w-16 bg-lattice-deep rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                        />
                        <span className="text-xs text-gray-400">
                          {{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[newEvent.recurrence.frequency]}
                        </span>
                      </>
                    )}
                  </div>
                  {newEvent.recurrence && (
                    <div className="mt-2">
                      <label className="text-xs text-gray-400 mb-1 block">Ends (optional)</label>
                      <input
                        type="date"
                        value={newEvent.recurrence.endDate ? newEvent.recurrence.endDate.toISOString().slice(0, 10) : ''}
                        onChange={(e) => setNewEvent({
                          ...newEvent,
                          recurrence: { ...newEvent.recurrence!, endDate: e.target.value ? new Date(e.target.value) : undefined },
                        })}
                        className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                      />
                    </div>
                  )}
                </div>

                {/* Link to Project */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Link to Project (optional)</label>
                  <select
                    value={newEvent.linkedProject || ''}
                    onChange={(e) => setNewEvent({ ...newEvent, linkedProject: e.target.value })}
                    className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                  >
                    <option value="">None</option>
                    {projects.map((proj) => (
                      <option key={proj} value={proj}>{proj}</option>
                    ))}
                  </select>
                </div>

                {/* Platform selector (shown for release & marketing types) */}
                {(newEvent.eventType === 'release' || newEvent.eventType === 'marketing') && (
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Platforms</label>
                    <div className="flex flex-wrap gap-2">
                      {PLATFORMS.map((platform) => {
                        const isSelected = (newEvent.platforms || []).includes(platform);
                        return (
                          <button
                            key={platform}
                            onClick={() => handleTogglePlatform(platform)}
                            className={cn(
                              'text-xs px-3 py-1.5 rounded-full border transition-colors',
                              isSelected
                                ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                                : 'border-lattice-border text-gray-400 hover:border-white/20'
                            )}
                          >
                            {platform}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Collaborator tags */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Collaborators (optional)</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={collaboratorInput}
                        onChange={(e) => setCollaboratorInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCollaborator(); } }}
                        placeholder="@username"
                        className="w-full bg-lattice-deep rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                      />
                    </div>
                    <button
                      onClick={handleAddCollaborator}
                      className="px-3 py-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated text-sm"
                    >
                      Add
                    </button>
                  </div>
                  {(newEvent.collaborators || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(newEvent.collaborators || []).map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                          {c}
                          <button onClick={() => handleRemoveCollaborator(c)} className="hover:text-white" aria-label="Close">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Color */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Color</label>
                  <div className="flex items-center gap-2">
                    {COLORS.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => setNewEvent({ ...newEvent, color: color.value })}
                        className={cn(
                          'w-8 h-8 rounded-full transition-transform',
                          newEvent.color === color.value && 'ring-2 ring-white scale-110'
                        )}
                        style={{ backgroundColor: color.value }}
                      />
                    ))}
                  </div>
                </div>

                {/* Auto-reminders */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Reminders</label>
                  <div className="flex flex-wrap gap-2">
                    {REMINDER_OPTIONS.map((opt) => {
                      const isSelected = (newEvent.reminders || []).some(
                        (r) => r.time === opt.time && r.unit === opt.unit
                      );
                      return (
                        <button
                          key={opt.label}
                          onClick={() => handleToggleReminder({ time: opt.time, unit: opt.unit })}
                          className={cn(
                            'text-xs px-3 py-1.5 rounded-full border transition-colors',
                            isSelected
                              ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                              : 'border-lattice-border text-gray-400 hover:border-white/20'
                          )}
                        >
                          <Bell className="w-3 h-3 inline mr-1" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Location (optional)</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={newEvent.location || ''}
                      onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                      placeholder="Location or address"
                      className="w-full bg-lattice-deep rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description (optional)</label>
                  <DraftedTextarea
                    lensId="calendar"
                    draftKey="event-description"
                    initial={newEvent.description || ''}
                    onValueChange={(v) => setNewEvent({ ...newEvent, description: v })}
                    placeholder="Add notes, details, links..."
                    rows={3}
                    className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan resize-none"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateEvent}
                    disabled={!newEvent.title}
                    className="flex-1 py-2 rounded-lg bg-neon-cyan text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Schedule
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------- */}
      {/* Quick Book Session modal                                           */}
      {/* ----------------------------------------------------------------- */}
      <AnimatePresence>
        {showBookingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowBookingModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-lattice-surface border border-lattice-border rounded-xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <Bell className="w-5 h-5 text-cyan-400" />
                  </div>
                  <h2 className="text-xl font-bold">Book a Session</h2>
                </div>
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
                aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Session type */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Session Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {SESSION_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={() => setBookSession({ ...bookSession, sessionType: type })}
                        className={cn(
                          'px-3 py-2 rounded-lg border text-sm transition-colors text-left',
                          bookSession.sessionType === type
                            ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                            : 'border-lattice-border text-gray-400 hover:border-white/20'
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Date</label>
                  <input
                    type="date"
                    value={bookSession.date.toISOString().slice(0, 10)}
                    onChange={(e) => setBookSession({ ...bookSession, date: new Date(e.target.value) })}
                    className="w-full bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                  />
                </div>

                {/* Time slot */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Start Time</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((hour) => (
                      <button
                        key={hour}
                        onClick={() => setBookSession({ ...bookSession, hour })}
                        className={cn(
                          'px-2 py-1.5 rounded-lg border text-xs tabular-nums transition-colors',
                          bookSession.hour === hour
                            ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                            : 'border-lattice-border text-gray-400 hover:border-white/20'
                        )}
                      >
                        {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Duration</label>
                  <div className="flex gap-2">
                    {SESSION_DURATIONS.map((dur) => (
                      <button
                        key={dur}
                        onClick={() => setBookSession({ ...bookSession, duration: dur })}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg border text-sm tabular-nums transition-colors',
                          bookSession.duration === dur
                            ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                            : 'border-lattice-border text-gray-400 hover:border-white/20'
                        )}
                      >
                        {dur}h
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="p-3 rounded-lg bg-lattice-deep border border-lattice-border">
                  <p className="text-sm text-gray-400">Session summary</p>
                  <p className="font-semibold mt-1">{bookSession.sessionType}</p>
                  <p className="text-sm text-gray-300 tabular-nums">
                    {bookSession.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    {' at '}
                    {bookSession.hour === 0 ? '12 AM' : bookSession.hour < 12 ? `${bookSession.hour} AM` : bookSession.hour === 12 ? '12 PM' : `${bookSession.hour - 12} PM`}
                    {' for '}
                    {bookSession.duration}h
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => setShowBookingModal(false)}
                    className="flex-1 py-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBookSession}
                    className="flex-1 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold"
                  >
                    Book Session
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {realtimeData && (
        <div className="mt-6 px-4 pb-4">
          <RealtimeDataPanel
            domain="calendar"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </div>
      )}
    </div>
  );
}
