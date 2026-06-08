'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar, Clock, MapPin, Users, Plus, ChevronLeft, ChevronRight,
  X, Check,
  ArrowRight, History,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type EventType =
  | 'grand-opening' | 'design-competition' | 'disaster-drill' | 'lecture'
  | 'market-day' | 'festival' | 'firm-showcase' | 'exploration-expedition';

interface GameEvent {
  id: string;
  name: string;
  type: EventType;
  date: string;
  time: string;
  location: string;
  description: string;
  organizer: string;
  rsvpCount: number;
  rsvped?: boolean;
  isLive?: boolean;
  crossWorld?: boolean;
  worldName?: string;
}

interface Gathering {
  id: string;
  location: string;
  playerCount: number;
  description: string;
}

interface CalendarDay {
  day: number;
  events: GameEvent[];
  isToday?: boolean;
  isCurrentMonth?: boolean;
}

interface EventsGatheringsProps {
  worldId?: string;
  events?: GameEvent[];
  calendar?: CalendarDay[];
  gatherings?: Gathering[];
  onRSVP?: (eventId: string) => void;
  onCreate?: (event: Partial<GameEvent>) => void;
  onJoinGathering?: (gatheringId: string) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const EVENT_META: Record<EventType, { label: string; emoji: string; color: string }> = {
  'grand-opening':          { label: 'Grand Opening',          emoji: '\uD83C\uDF80', color: 'text-pink-400' },
  'design-competition':     { label: 'Design Competition',     emoji: '\uD83C\uDFC6', color: 'text-yellow-400' },
  'disaster-drill':         { label: 'Disaster Drill',         emoji: '\uD83C\uDF2A\uFE0F', color: 'text-red-400' },
  'lecture':                { label: 'Lecture',                 emoji: '\uD83D\uDCDA', color: 'text-blue-400' },
  'market-day':             { label: 'Market Day',             emoji: '\uD83D\uDCB0', color: 'text-green-400' },
  'festival':               { label: 'Festival',               emoji: '\uD83C\uDF89', color: 'text-purple-400' },
  'firm-showcase':          { label: 'Firm Showcase',          emoji: '\uD83C\uDFE2', color: 'text-cyan-400' },
  'exploration-expedition': { label: 'Exploration Expedition', emoji: '\uD83D\uDDFA\uFE0F', color: 'text-orange-400' },
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Backend → panel adapter ────────────────────────────────────── */

// Backend EVENT_TYPES (world-events.js) don't 1:1 match this panel's union,
// so map the overlaps and default unknown kinds to a safe known key. Never
// fabricate a type the backend didn't send — only coerce to a renderable enum.
const BACKEND_TYPE_MAP: Record<string, EventType> = {
  festival: 'festival',
  market: 'market-day',
  workshop: 'lecture',
  debate: 'lecture',
  exhibition: 'firm-showcase',
  ceremony: 'grand-opening',
  tournament: 'design-competition',
  hackathon: 'design-competition',
  raid: 'exploration-expedition',
  concert: 'festival',
  meetup: 'festival',
  rally: 'festival',
  referendum: 'lecture',
};

function adaptEvent(e: Record<string, unknown>): GameEvent {
  const rawType = String(e.type ?? '');
  const type: EventType = (rawType in EVENT_META)
    ? (rawType as EventType)
    : (BACKEND_TYPE_MAP[rawType] ?? 'festival');
  const startMs = Number(e.startTime ?? e.start_time ?? 0);
  const start = startMs ? new Date(startMs * (startMs < 1e12 ? 1000 : 1)) : null;
  return {
    id: String(e.id ?? ''),
    name: String(e.name ?? e.title ?? 'Event'),
    type,
    date: start ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
    time: start ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '',
    location: String(e.location ?? e.districtId ?? e.district_id ?? ''),
    description: String(e.description ?? ''),
    organizer: String(e.hostName ?? e.host_name ?? e.hostId ?? e.host_id ?? ''),
    rsvpCount: Number(e.rsvpCount ?? e.rsvp_count ?? 0),
    isLive: String(e.status ?? '') === 'active' || String(e.status ?? '') === 'live',
  };
}

function buildCalendar(events: GameEvent[]): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let d = 1; d <= 30; d++) {
    const dayEvents = events.filter(e => {
      const num = parseInt(e.date.replace(/\D/g, ''));
      return num === d;
    });
    days.push({ day: d, events: dayEvents, isToday: d === 5, isCurrentMonth: true });
  }
  return days;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function EventsGatherings({
  worldId,
  events: eventsProp,
  calendar: calendarProp,
  gatherings: gatheringsProp,
  onRSVP,
  onCreate,
  onJoinGathering,
}: EventsGatheringsProps) {
  const [activeTab, setActiveTab] = useState<'upcoming' | 'calendar' | 'live' | 'create' | 'past'>('upcoming');
  const [selectedEvent, setSelectedEvent] = useState<GameEvent | null>(null);

  // Real events come from GET /api/world/events. Start EMPTY — never seed
  // fabricated events. Spontaneous gatherings have no backend surface yet, so
  // they stay empty (honest empty-state) unless the caller passes them in.
  const [events, setEvents] = useState<GameEvent[]>(eventsProp ?? []);
  // TODO: wire spontaneous gatherings to backend (no co-presence cluster API exists yet)
  const gatherings = gatheringsProp ?? [];

  useEffect(() => {
    if (eventsProp) return; // caller supplied data — respect it
    let cancelled = false;
    (async () => {
      try {
        const wid = worldId || 'concordia-hub';
        const r = await fetch(`/api/world/events?cityId=${encodeURIComponent(wid)}`, { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : null)).catch(() => null);
        const rows = Array.isArray(r?.events) ? r.events : [];
        if (!cancelled) setEvents(rows.map(adaptEvent));
      } catch { if (!cancelled) setEvents([]); }
    })();
    return () => { cancelled = true; };
  }, [worldId, eventsProp]);

  const [rsvpedIds, setRsvpedIds] = useState<Set<string>>(new Set());

  // Create form state
  const [createForm, setCreateForm] = useState<Partial<GameEvent>>({
    type: 'grand-opening', name: '', date: '', time: '', location: '', description: '',
  });

  const calendar = calendarProp ?? buildCalendar(events);
  const liveEvents = events.filter(e => e.isLive);
  const upcomingEvents = events.filter(e => !e.isLive);

  const handleRSVP = (eventId: string) => {
    setRsvpedIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
    onRSVP?.(eventId);
  };

  const handleCreate = () => {
    if (!createForm.name || !createForm.date) return;
    onCreate?.(createForm);
    setCreateForm({ type: 'grand-opening', name: '', date: '', time: '', location: '', description: '' });
  };

  /* ── Event Detail Card ─────────────────────────────────────── */
  const renderEventDetail = (event: GameEvent) => {
    const meta = EVENT_META[event.type];
    return (
      <div className={`${panel} p-5 w-96 space-y-4`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{meta.emoji}</span>
            <div>
              <h3 className="text-white font-semibold">{event.name}</h3>
              <span className={`text-xs ${meta.color}`}>{meta.label}</span>
            </div>
          </div>
          <button onClick={() => setSelectedEvent(null)} className="text-white/40 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1.5 text-xs text-white/60">
          <div className="flex items-center gap-2"><Calendar size={12} /> {event.date}</div>
          <div className="flex items-center gap-2"><Clock size={12} /> {event.time}</div>
          <div className="flex items-center gap-2"><MapPin size={12} /> {event.location}</div>
          <div className="flex items-center gap-2"><Users size={12} /> {event.rsvpCount} attending</div>
        </div>

        <p className="text-sm text-white/70">{event.description}</p>

        <div className="text-xs text-white/50">Organized by <span className="text-white/70">{event.organizer}</span></div>

        {event.crossWorld && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2 text-xs text-purple-400">
            Cross-world event in <span className="font-medium">{event.worldName}</span>
          </div>
        )}

        {event.isLive && (
          <div className="flex items-center gap-2 text-xs text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Happening now!
          </div>
        )}

        <button
          onClick={() => handleRSVP(event.id)}
          className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            rsvpedIds.has(event.id)
              ? 'bg-green-600/30 text-green-400 border border-green-500/30'
              : 'bg-cyan-600/80 hover:bg-cyan-500 text-white'
          }`}
        >
          {rsvpedIds.has(event.id) ? <><Check size={14} /> RSVP&apos;d</> : 'RSVP'}
        </button>
      </div>
    );
  };

  /* ── Event Row ─────────────────────────────────────────────── */
  const renderEventRow = (event: GameEvent) => {
    const meta = EVENT_META[event.type];
    return (
      <button
        key={event.id}
        onClick={() => setSelectedEvent(event)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
      >
        <span className="text-lg shrink-0">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white font-medium truncate">{event.name}</span>
            {event.isLive && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-white/40 mt-0.5">
            <span>{event.date} {event.time}</span>
            <span>{event.location}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-white/40 shrink-0">
          <Users size={10} /> {event.rsvpCount}
          {rsvpedIds.has(event.id) && <Check size={10} className="text-green-400" />}
        </div>
      </button>
    );
  };

  /* ── Calendar View ─────────────────────────────────────────── */
  const renderCalendar = () => (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent('events:calendar-prev')); }}
          aria-label="Previous month"
          className="p-1 text-white/40 hover:text-white/70"
        ><ChevronLeft size={16} /></button>
        <span className="text-sm text-white font-medium">April 2026</span>
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent('events:calendar-next')); }}
          aria-label="Next month"
          className="p-1 text-white/40 hover:text-white/70"
        ><ChevronRight size={16} /></button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAYS_OF_WEEK.map(d => (
          <div key={d} className="text-center text-[10px] text-white/30 py-1">{d}</div>
        ))}
        {/* Offset for April 2026 (Wednesday start) */}
        {[...Array(3)].map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {calendar.map(day => {
          const hasEvents = day.events.length > 0;
          return (
            <button
              key={day.day}
              className={`relative aspect-square flex flex-col items-center justify-center rounded text-xs transition-colors ${
                day.isToday
                  ? 'bg-cyan-600/30 text-cyan-400 ring-1 ring-cyan-500/50'
                  : hasEvents
                    ? 'bg-white/5 text-white/70 hover:bg-white/10'
                    : 'text-white/30 hover:bg-white/5'
              }`}
              onClick={() => {
                if (day.events.length > 0) setSelectedEvent(day.events[0]);
              }}
            >
              {day.day}
              {hasEvents && (
                <div className="flex gap-0.5 mt-0.5">
                  {day.events.slice(0, 3).map((ev, i) => (
                    <span
                      key={i}
                      className="w-1 h-1 rounded-full"
                      style={{ backgroundColor: EVENT_META[ev.type].color.replace('text-', '').includes('pink') ? '#F472B6' : EVENT_META[ev.type].color.replace('text-', '').includes('yellow') ? '#FACC15' : '#22D3EE' }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ── Create Event Form ─────────────────────────────────────── */
  const renderCreateForm = () => (
    <div className="p-4 space-y-3">
      <h4 className="text-sm text-white font-medium flex items-center gap-2">
        <Plus size={14} className="text-cyan-400" /> Create Event
      </h4>

      <div className="space-y-2">
        <select
          value={createForm.type}
          onChange={e => setCreateForm(prev => ({ ...prev, type: e.target.value as EventType }))}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/25"
        >
          {(Object.keys(EVENT_META) as EventType[]).map(type => (
            <option key={type} value={type} className="bg-gray-900">
              {EVENT_META[type].emoji} {EVENT_META[type].label}
            </option>
          ))}
        </select>

        <input
          value={createForm.name ?? ''}
          onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="Event name"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
        />

        <div className="flex gap-2">
          <input
            value={createForm.date ?? ''}
            onChange={e => setCreateForm(prev => ({ ...prev, date: e.target.value }))}
            placeholder="Date (e.g. Apr 15)"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
          />
          <input
            value={createForm.time ?? ''}
            onChange={e => setCreateForm(prev => ({ ...prev, time: e.target.value }))}
            placeholder="Time"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
          />
        </div>

        <input
          value={createForm.location ?? ''}
          onChange={e => setCreateForm(prev => ({ ...prev, location: e.target.value }))}
          placeholder="Location"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
        />

        <textarea
          value={createForm.description ?? ''}
          onChange={e => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Description"
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25 resize-none"
        />

        <button
          onClick={handleCreate}
          disabled={!createForm.name || !createForm.date}
          className="w-full px-4 py-2 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 disabled:opacity-30 text-white text-sm font-medium transition-colors"
        >
          Create Event
        </button>
      </div>
    </div>
  );

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-md">
      {/* Happening now */}
      {liveEvents.length > 0 && (
        <div className={`${panel} px-3 py-2`}>
          <div className="flex items-center gap-2 text-xs text-green-400 mb-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="font-medium">Happening Now</span>
          </div>
          {liveEvents.map(renderEventRow)}
        </div>
      )}

      {/* Spontaneous gatherings */}
      {gatherings.length > 0 && (
        <div className="flex flex-col gap-2">
          {gatherings.map(g => (
            <div key={g.id} className={`${panel} px-3 py-2 flex items-center gap-3`}>
              <Users size={14} className="text-yellow-400 shrink-0" />
              <span className="text-xs text-white/70 flex-1">{g.description}</span>
              <button
                onClick={() => onJoinGathering?.(g.id)}
                className="px-2.5 py-1 rounded bg-yellow-600/80 hover:bg-yellow-500 text-white text-[10px] font-medium transition-colors flex items-center gap-1"
              >
                <ArrowRight size={10} /> Join
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className={`${panel} p-1 flex gap-1`}>
        {([
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'live', label: 'Live' },
          { key: 'create', label: 'Create' },
          { key: 'past', label: 'Past' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t.key ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t.label}
            {t.key === 'live' && liveEvents.length > 0 && (
              <span className="ml-1 w-4 h-4 inline-flex items-center justify-center rounded-full bg-green-500 text-white text-[9px] font-bold">
                {liveEvents.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`${panel}`}>
        {activeTab === 'upcoming' && (
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {upcomingEvents.length === 0
              ? <p className="text-center text-white/30 text-xs py-6">No upcoming events</p>
              : upcomingEvents.map(renderEventRow)}
          </div>
        )}

        {activeTab === 'calendar' && renderCalendar()}

        {activeTab === 'live' && (
          <div className="divide-y divide-white/5">
            {liveEvents.length === 0
              ? <p className="text-center text-white/30 text-xs py-6">No live events right now</p>
              : liveEvents.map(renderEventRow)}
          </div>
        )}

        {activeTab === 'create' && renderCreateForm()}

        {activeTab === 'past' && (
          <div className="p-6 text-center">
            <History size={24} className="text-white/20 mx-auto mb-2" />
            <p className="text-xs text-white/30">Past events archive</p>
            <p className="text-[10px] text-white/20 mt-1">Previous events will appear here after they conclude.</p>
          </div>
        )}
      </div>

      {/* Selected event overlay */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedEvent(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            {renderEventDetail(selectedEvent)}
          </div>
        </div>
      )}
    </div>
  );
}
