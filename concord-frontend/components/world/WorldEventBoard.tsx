'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, X, Loader2, RefreshCw, PartyPopper, Sparkles, Clock, MapPin, Gift,
  Users, Plus, Check, ArrowRight,
} from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Backend shapes (verified against the real endpoints) ───────────────────
//
// GET /api/world/events  →  { ok, events, count }
//   events[]: _serializeEvent (server/lib/world-events.js) — when no cityId
//   query is passed the route returns getUpcomingEvents(): scheduled, public,
//   future-dated events. We pass ?cityId=<worldId> so getCityEvents() returns
//   ALL of that world's events (active + scheduled) and we bucket client-side.
//
// GET /api/festivals/active?worldId=<worldId>  →  { ok, festivals }
//   festivals[]: { festival_id, world_id, year_idx, started_at, ends_at,
//                  name, decoration_tag } — started_at/ends_at are UNIX SECONDS.
//
// NOTE: world bosses (server/lib/world-bosses.js#listActiveBosses) have NO HTTP
// read route — only a heartbeat consumer + tests reference it — so there is no
// honest "Bosses" section to render. It is intentionally omitted (not faked).
//
// RSVP / create (absorbed from WorldEventsPanel):
//   POST /api/world/events/:id/rsvp       → marks the caller attending; refetch.
//   POST /api/world/events  { name, type, maxAttendees, worldId } → creates a
//     scheduled event; we refetch so the new row appears in "Upcoming".
//
// Gatherings (absorbed from EventsGatherings):
//   lensRun('world','gatherings',{ worldId }) → { ok, result:{ gatherings:[
//     { id, location, playerCount, description } ] } } — live clusters of
//     co-present players. Honest-empty when nobody is grouped up.

interface RawEvent {
  id: string;
  cityId?: string;
  type?: string;
  name?: string;
  description?: string;
  districtId?: string | null;
  startTime?: string | null; // ISO 8601
  endTime?: string | null; // ISO 8601
  rewards?: unknown;
  status?: string; // 'scheduled' | 'active' | 'completed' | ...
  attendee_count?: number;
}

interface Gathering {
  id: string;
  location?: string;
  playerCount?: number;
  description?: string;
}

// Event types offered by the create form — matches the backend EVENT_TYPES
// enum the legacy WorldEventsPanel posted (server/lib/world-events.js).
const CREATE_EVENT_TYPES = [
  'concert', 'tournament', 'market', 'workshop', 'meetup', 'exhibition', 'hackathon', 'debate',
] as const;

interface RawFestival {
  festival_id: string;
  name?: string;
  started_at?: number; // unix seconds
  ends_at?: number; // unix seconds
  decoration_tag?: string | null;
  year_idx?: number;
}

interface Props {
  worldId: string;
  onClose?: () => void;
}

// ── Time humanizers ─────────────────────────────────────────────────────────

/** ms → "2h" / "30m" / "45s" / "3d" (magnitude only, no sign). */
function humanizeDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/** Future timestamp → "in 2h"; past → "started 5m ago" / "ended 5m ago". */
function relativeStart(startMs: number | null, now: number): string {
  if (startMs == null || Number.isNaN(startMs)) return 'time unknown';
  const delta = startMs - now;
  if (delta > 0) return `in ${humanizeDuration(delta)}`;
  return `started ${humanizeDuration(-delta)} ago`;
}

/** "ends in 30m" when in the future, "ended 5m ago" when past. */
function relativeEnd(endMs: number | null, now: number): string | null {
  if (endMs == null || Number.isNaN(endMs)) return null;
  const delta = endMs - now;
  if (delta > 0) return `ends in ${humanizeDuration(delta)}`;
  return `ended ${humanizeDuration(-delta)} ago`;
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Normalize a rewards field (array | object | string) to a short label. */
function rewardLabel(rewards: unknown): string | null {
  if (rewards == null) return null;
  if (Array.isArray(rewards)) {
    if (rewards.length === 0) return null;
    const parts = rewards
      .map((r) => {
        if (typeof r === 'string') return r;
        if (r && typeof r === 'object') {
          const o = r as Record<string, unknown>;
          if (typeof o.label === 'string') return o.label;
          if (o.cc != null) return `${o.cc} CC`;
          if (o.skillXp != null) return `${o.skillXp} XP`;
        }
        return null;
      })
      .filter((x): x is string => !!x);
    return parts.length ? parts.join(' · ') : null;
  }
  if (typeof rewards === 'object') {
    const o = rewards as Record<string, unknown>;
    const parts: string[] = [];
    if (o.cc != null) parts.push(`${o.cc} CC`);
    if (o.skillXp != null) parts.push(`${o.skillXp} XP`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (typeof rewards === 'string') return rewards;
  return null;
}

// ── Sub-rows ────────────────────────────────────────────────────────────────

function EventRow({
  ev,
  now,
  onRsvp,
  rsvped,
  busy,
}: {
  ev: RawEvent;
  now: number;
  onRsvp: (id: string) => void;
  rsvped: boolean;
  busy: boolean;
}) {
  const startMs = toMs(ev.startTime);
  const endMs = toMs(ev.endTime);
  const endLabel = relativeEnd(endMs, now);
  const reward = rewardLabel(ev.rewards);
  return (
    <li className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-100">{ev.name || ev.type || 'Untitled event'}</span>
        {ev.type && (
          <span className="text-[10px] uppercase tracking-wider text-cyan-300/80 flex-shrink-0">
            {ev.type}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {relativeStart(startMs, now)}
          {endLabel ? ` · ${endLabel}` : ''}
        </span>
        {ev.districtId && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {ev.districtId}
          </span>
        )}
        {ev.attendee_count != null && (
          <span className="inline-flex items-center gap-1">
            <Users className="w-3 h-3" />
            {ev.attendee_count}
          </span>
        )}
        {reward && (
          <span className="inline-flex items-center gap-1 text-amber-300/90">
            <Gift className="w-3 h-3" />
            {reward}
          </span>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onRsvp(ev.id)}
          disabled={busy || rsvped}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
            rsvped
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
              : 'bg-indigo-600/70 hover:bg-indigo-600 text-white',
          )}
        >
          {rsvped ? (
            <><Check className="w-3 h-3" /> RSVP&apos;d</>
          ) : busy ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> RSVP</>
          ) : (
            'RSVP'
          )}
        </button>
      </div>
    </li>
  );
}

function FestivalRow({ f, now }: { f: RawFestival; now: number }) {
  const endMs = f.ends_at != null ? f.ends_at * 1000 : null;
  const startMs = f.started_at != null ? f.started_at * 1000 : null;
  const endLabel = relativeEnd(endMs, now);
  return (
    <li className="rounded-md border border-fuchsia-500/20 bg-fuchsia-950/10 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fuchsia-100">
          <PartyPopper className="w-3.5 h-3.5 text-fuchsia-300" />
          {f.name || f.festival_id}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {startMs != null ? relativeStart(startMs, now) : 'active'}
          {endLabel ? ` · ${endLabel}` : ''}
        </span>
        {f.decoration_tag && (
          <span className="inline-flex items-center gap-1 text-fuchsia-300/80">
            <Sparkles className="w-3 h-3" />
            {f.decoration_tag}
          </span>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  icon,
  children,
  empty,
  emptyLabel = 'No events scheduled',
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
  emptyLabel?: string;
}) {
  return (
    <section>
      <h3 className="px-1 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
        {icon}
        {title}
      </h3>
      {empty ? (
        <p className="px-3 py-3 text-xs text-gray-500 italic">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  );
}

// ── Main board ──────────────────────────────────────────────────────────────

export function WorldEventBoard({ worldId, onClose }: Props) {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [festivals, setFestivals] = useState<RawFestival[]>([]);
  const [gatherings, setGatherings] = useState<Gathering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // RSVP + create-event state (absorbed from WorldEventsPanel).
  const [rsvpedIds, setRsvpedIds] = useState<Set<string>>(new Set());
  const [rsvpBusyId, setRsvpBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'concert', maxAttendees: 50 });
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evRes, fRes, gRes] = await Promise.all([
        // Pass cityId so getCityEvents returns active + scheduled for this world.
        api.get('/api/world/events', { params: { cityId: worldId } }),
        api.get('/api/festivals/active', { params: { worldId } }),
        // Spontaneous gatherings = live co-present player clusters.
        lensRun<{ gatherings?: Gathering[] }>('world', 'gatherings', { worldId }),
      ]);
      const evData = evRes.data as { ok?: boolean; events?: RawEvent[] };
      const fData = fRes.data as { ok?: boolean; festivals?: RawFestival[] };
      setEvents(Array.isArray(evData?.events) ? evData.events : []);
      setFestivals(Array.isArray(fData?.festivals) ? fData.festivals : []);
      const gRows = gRes.data?.ok ? gRes.data.result?.gatherings : null;
      setGatherings(Array.isArray(gRows) ? gRows : []);
      setNow(Date.now());
    } catch (e) {
      console.error('[WorldEventBoard] fetch failed', e);
      setError('Could not load the event board. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  const handleRsvp = useCallback(async (eventId: string) => {
    setActionError(null);
    setRsvpBusyId(eventId);
    try {
      await api.post(`/api/world/events/${eventId}/rsvp`, {});
      setRsvpedIds((prev) => new Set(prev).add(eventId));
      // Refetch so attendee counts reflect the new RSVP.
      refresh();
    } catch (e) {
      console.error('[WorldEventBoard] rsvp failed', e);
      setActionError('RSVP failed. Try again.');
    } finally {
      setRsvpBusyId(null);
    }
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!form.name.trim()) return;
    setActionError(null);
    setCreating(true);
    try {
      await api.post('/api/world/events', { ...form, worldId });
      setShowCreate(false);
      setForm({ name: '', type: 'concert', maxAttendees: 50 });
      refresh();
    } catch (e) {
      console.error('[WorldEventBoard] create failed', e);
      setActionError('Could not create the event. Try again.');
    } finally {
      setCreating(false);
    }
  }, [form, worldId, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep relative timestamps fresh without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Bucket events: "active" = explicitly active OR (started & not ended);
  // everything else with a future start is "upcoming". Completed/ended drop off.
  const active: RawEvent[] = [];
  const upcoming: RawEvent[] = [];
  for (const ev of events) {
    if (ev.status === 'completed' || ev.status === 'cancelled') continue;
    const startMs = toMs(ev.startTime);
    const endMs = toMs(ev.endTime);
    const isActive =
      ev.status === 'active' ||
      (startMs != null && startMs <= now && (endMs == null || endMs > now));
    if (isActive) active.push(ev);
    else if (startMs == null || startMs > now) upcoming.push(ev);
  }
  const byStart = (a: RawEvent, b: RawEvent) =>
    (toMs(a.startTime) ?? Infinity) - (toMs(b.startTime) ?? Infinity);
  active.sort(byStart);
  upcoming.sort(byStart);
  const sortedFestivals = [...festivals].sort(
    (a, b) => (a.started_at ?? Infinity) - (b.started_at ?? Infinity),
  );

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-[100vw] z-40 flex flex-col bg-black/80 backdrop-blur-sm border-l border-white/10 text-white shadow-2xl overflow-hidden">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Event board</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { setShowCreate((v) => !v); setActionError(null); }}
            className={cn(
              'p-1 rounded-md hover:bg-white/5 text-gray-400',
              showCreate && 'bg-white/10 text-cyan-300',
            )}
            aria-label="Create event"
            title="Create event"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400 disabled:opacity-50"
            aria-label="Refresh event board"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md hover:bg-white/5 text-gray-400"
              aria-label="Close event board"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {actionError && (
          <div className="rounded-md border border-red-500/30 bg-red-950/20 px-3 py-2 text-[11px] text-red-300">
            {actionError}
          </div>
        )}

        {showCreate && (
          <section className="rounded-md border border-white/10 bg-black/20 p-3 space-y-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
              <Plus className="w-3 h-3 text-cyan-400" /> New event
            </h3>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30"
              placeholder="Event name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              aria-label="Event type"
            >
              {CREATE_EVENT_TYPES.map((t) => (
                <option key={t} value={t} className="bg-gray-900">
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!form.name.trim() || creating}
              className="w-full rounded-lg bg-cyan-600/80 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-40"
            >
              {creating ? 'Creating…' : 'Create event'}
            </button>
          </section>
        )}

        {loading && events.length === 0 && festivals.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/30 bg-red-950/20 px-4 py-6 text-center">
            <p className="text-xs text-red-300">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 px-3 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-gray-200"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <Section
              title="Active now"
              icon={<Sparkles className="w-3 h-3 text-emerald-400" />}
              empty={active.length === 0}
            >
              {active.map((ev) => (
                <EventRow
                  key={ev.id}
                  ev={ev}
                  now={now}
                  onRsvp={handleRsvp}
                  rsvped={rsvpedIds.has(ev.id)}
                  busy={rsvpBusyId === ev.id}
                />
              ))}
            </Section>

            <Section
              title="Upcoming"
              icon={<Clock className="w-3 h-3 text-cyan-400" />}
              empty={upcoming.length === 0}
            >
              {upcoming.map((ev) => (
                <EventRow
                  key={ev.id}
                  ev={ev}
                  now={now}
                  onRsvp={handleRsvp}
                  rsvped={rsvpedIds.has(ev.id)}
                  busy={rsvpBusyId === ev.id}
                />
              ))}
            </Section>

            <Section
              title="Gatherings"
              icon={<Users className="w-3 h-3 text-yellow-400" />}
              empty={gatherings.length === 0}
              emptyLabel="No spontaneous gatherings right now"
            >
              {gatherings.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2"
                >
                  <ArrowRight className="w-3 h-3 flex-shrink-0 text-yellow-400" />
                  <span className="flex-1 text-xs text-gray-200">
                    {g.description || g.location || 'Players gathering'}
                  </span>
                  {g.playerCount != null && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <Users className="w-3 h-3" />
                      {g.playerCount}
                    </span>
                  )}
                </li>
              ))}
            </Section>

            <Section
              title="Festivals"
              icon={<PartyPopper className="w-3 h-3 text-fuchsia-400" />}
              empty={sortedFestivals.length === 0}
            >
              {sortedFestivals.map((f) => (
                <FestivalRow key={`${f.festival_id}-${f.year_idx ?? 0}`} f={f} now={now} />
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

export default WorldEventBoard;
