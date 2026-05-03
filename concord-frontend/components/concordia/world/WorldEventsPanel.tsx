'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Calendar, Users, Music, Swords, ShoppingBag, BookOpen } from 'lucide-react';

interface WorldEvent {
  id: string;
  name: string;
  type: string;
  status: string;
  attendee_count?: number;
  max_attendees?: number;
  starts_at?: number;
  lens_id?: string;
  created_by?: string;
}

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  concert:    Music,
  tournament: Swords,
  market:     ShoppingBag,
  workshop:   BookOpen,
  meetup:     Users,
  default:    Calendar,
};

interface WorldEventsPanelProps {
  worldId?: string;
  onClose?: () => void;
}

export function WorldEventsPanel({ worldId = 'concordia-hub', onClose }: WorldEventsPanelProps) {
  const [tab, setTab] = useState<'active' | 'upcoming' | 'create'>('active');
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', type: 'concert', maxAttendees: 50 });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/world/events?status=${tab === 'active' ? 'active' : 'scheduled'}`);
      if (r.ok) {
        const d = await r.json();
        setEvents(d.events ?? []);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, [tab]);

  useEffect(() => { if (tab !== 'create') load(); }, [tab, load]);

  const rsvp = async (eventId: string) => {
    await fetch(`/api/world/events/${eventId}/rsvp`, { method: 'POST' });
    load();
  };

  const createEvent = async () => {
    setCreating(true);
    try {
      await fetch('/api/world/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, worldId }),
      });
      setTab('upcoming');
    } catch { /* offline */ }
    setCreating(false);
  };

  return (
    <div className="fixed right-4 top-20 w-80 bg-black/90 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] z-40">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-400" />
          <h2 className="text-white font-bold text-sm">World Events</h2>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(['active', 'upcoming', 'create'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'text-white border-b-2 border-indigo-400' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t === 'create' ? '+ Create' : t}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        {tab === 'create' ? (
          <div className="space-y-3">
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30"
              placeholder="Event name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <select
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            >
              {['concert', 'tournament', 'market', 'workshop', 'meetup', 'exhibition', 'hackathon', 'debate'].map(t => (
                <option key={t} value={t} className="bg-gray-900">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
            <button
              onClick={createEvent}
              disabled={!form.name || creating}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              {creating ? 'Creating…' : 'Create Event'}
            </button>
          </div>
        ) : loading ? (
          <div className="text-white/30 text-xs text-center py-8">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-white/30 text-xs text-center py-8">No {tab} events</div>
        ) : (
          events.map(ev => {
            const Icon = EVENT_ICONS[ev.type] ?? EVENT_ICONS.default;
            return (
              <div key={ev.id} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-start gap-3">
                <Icon className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{ev.name}</div>
                  <div className="text-white/40 text-xs capitalize">{ev.type}</div>
                  {ev.attendee_count != null && (
                    <div className="text-white/30 text-xs flex items-center gap-1 mt-1">
                      <Users className="w-3 h-3" />{ev.attendee_count} attending
                    </div>
                  )}
                </div>
                <button
                  onClick={() => rsvp(ev.id)}
                  className="text-xs bg-indigo-600/60 hover:bg-indigo-600 text-white px-2 py-1 rounded-lg shrink-0 transition-colors"
                >
                  RSVP
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
