'use client';

/**
 * FiguresNotebook — notable-person / biography tracking, distinct from
 * dated events.
 *
 * Real backend surface (see docs/lens-specs/history-capability-map.md for
 * the resolution): `server/domains/history.js` registers a `history.figure-*`
 * macro family (figure-add / figure-list / figure-update / figure-delete /
 * figure-link-event / figure-unlink-event). A figure's name, role, dates,
 * region, and bio persist server-side per-user via the same STATE.historyLens
 * substrate as timelines — genuinely saved, not a client-only mock. The real
 * differentiator from a plain notebook: figure-link-event validates a link
 * against the caller's ACTUAL timeline events (a fabricated timelineId/
 * eventId is rejected), and figure-list re-derives every linked event LIVE
 * against current timeline state on every read, so a since-deleted timeline
 * or event surfaces honestly as "no longer exists" — never silently dropped,
 * never silently presented as still valid.
 *
 * The old page used the generic disconnected `useLensData` lens-artifact
 * store with an amber "not backend-validated" disclosure. That framing is
 * retired below because it's no longer true — it's replaced with an accurate
 * one that owns what's real (persistence + validated linkage) without
 * overclaiming (there is still no historical-analysis scoring on a figure).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Plus, Trash2, Search, UserRound, Check, Loader2, Link2, Unlink, AlertTriangle, ShieldCheck } from 'lucide-react';
import { DataTable, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { lensRun } from '@/lib/api/client';
import { useDensity } from '@/lib/hooks/useDensity';

interface LinkedEvent {
  timelineId: string;
  eventId: string;
  found: boolean;
  timelineTitle?: string;
  eventTitle?: string;
  eventYear?: number;
}

interface Figure {
  id: string;
  name: string;
  role: string;
  birthYear: number | null;
  deathYear: number | null;
  region: string;
  bio: string;
  linkedEvents: LinkedEvent[];
  linkedEventCount: number;
  createdAt: string;
}

interface TimelineMeta { id: string; title: string; eventCount: number }
interface TimelineEventOption { id: string; title: string; year: number; dateLabel: string }

const REGIONS = ['global', 'europe', 'asia', 'africa', 'americas', 'middle_east', 'oceania', 'other'] as const;

const emptyForm = { name: '', role: '', birthYear: '', deathYear: '', region: 'global', bio: '' };

export function FiguresNotebook() {
  const [figures, setFigures] = useState<Figure[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { density } = useDensity();
  const tableDensity = density === 'high' ? 'compact' : 'comfortable';

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const loadFigures = useCallback(async () => {
    const r = await lensRun<{ figures: Figure[] }>('history', 'figure-list', {});
    if (r.data?.ok && r.data.result) {
      setFigures(r.data.result.figures);
      setLoadError(null);
    } else {
      setLoadError(r.data?.error || 'Could not load your figures notebook.');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadFigures(); }, [loadFigures]);

  const filtered = useMemo(() => {
    if (!search.trim()) return figures;
    const q = search.toLowerCase();
    return figures.filter((f) => f.name.toLowerCase().includes(q) || (f.role || '').toLowerCase().includes(q) || (f.bio || '').toLowerCase().includes(q));
  }, [figures, search]);

  const selected = figures.find((f) => f.id === selectedId) || null;

  const columns: DataTableColumn<Figure>[] = [
    { id: 'name', header: 'Name', accessor: (r) => r.name, sortable: true },
    { id: 'role', header: 'Role', accessor: (r) => r.role || '—', sortable: true },
    { id: 'born', header: 'Born', accessor: (r) => r.birthYear ?? '—', sortable: true, monospace: true, align: 'right', width: '80px' },
    { id: 'died', header: 'Died', accessor: (r) => r.deathYear ?? '—', sortable: true, monospace: true, align: 'right', width: '80px' },
    { id: 'region', header: 'Region', accessor: (r) => (r.region || '').replace(/_/g, ' ') || '—', sortable: true, width: '110px' },
    { id: 'links', header: 'Events', accessor: (r) => r.linkedEventCount, sortable: true, monospace: true, align: 'right', width: '70px' },
  ];

  async function handleCreate() {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const r = await lensRun('history', 'figure-add', {
        name: form.name.trim(),
        role: form.role.trim() || undefined,
        birthYear: form.birthYear.trim() ? Number(form.birthYear) : undefined,
        deathYear: form.deathYear.trim() ? Number(form.deathYear) : undefined,
        region: form.region,
        bio: form.bio.trim() || undefined,
      });
      if (r.data?.ok) {
        setForm(emptyForm);
        setShowCreate(false);
        await loadFigures();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (selectedId === id) setSelectedId(null);
    await lensRun('history', 'figure-delete', { id });
    await loadFigures();
  }

  async function handleBioSave(id: string, bio: string) {
    const r = await lensRun<{ figure: Figure }>('history', 'figure-update', { id, bio });
    if (r.data?.ok && r.data.result) {
      setFigures((prev) => prev.map((f) => (f.id === id ? r.data.result!.figure : f)));
    } else {
      throw new Error(r.data?.error || 'Save failed');
    }
  }

  async function handleUnlink(figureId: string, timelineId: string, eventId: string) {
    const r = await lensRun<{ figure: Figure }>('history', 'figure-unlink-event', { figureId, timelineId, eventId });
    if (r.data?.ok && r.data.result) {
      setFigures((prev) => prev.map((f) => (f.id === figureId ? r.data.result!.figure : f)));
    }
  }

  async function handleLink(figureId: string, timelineId: string, eventId: string) {
    const r = await lensRun<{ figure: Figure }>('history', 'figure-link-event', { figureId, timelineId, eventId });
    if (r.data?.ok && r.data.result) {
      setFigures((prev) => prev.map((f) => (f.id === figureId ? r.data.result!.figure : f)));
      return true;
    }
    return false;
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => { setIsLoading(true); void loadFigures(); }} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-[11px] text-zinc-400">
        <ShieldCheck className="inline h-3 w-3 mr-1 text-emerald-400" />
        Historical figures — name, role, dates, region, and bio persist server-side per-user
        (<span className="text-zinc-300">history.figure-*</span>, real backend storage, not a
        client-only note). Event links are <span className="text-zinc-300">validated against
        your real timelines</span> when created, and re-checked live on every read — a link to a
        timeline or event you later delete honestly shows as no longer existing rather than
        being silently hidden or presented as still valid. There is no analysis/scoring of a
        figure yet — that remains a genuinely future capability.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search figures…"
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" /> New figure
        </button>
        <span className="text-xs text-zinc-500 ml-auto">{filtered.length} figure{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name…"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Role (e.g. philosopher)"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white sm:col-span-2" />
            <input value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} placeholder="Born (− for BCE)"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono" />
            <input value={form.deathYear} onChange={(e) => setForm({ ...form, deathYear: e.target.value })} placeholder="Died"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono" />
          </div>
          <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white">
            {REGIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Bio…"
            className="w-full h-20 resize-none bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={!form.name.trim() || creating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40">
              {creating && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-xs text-zinc-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="table-row" columns={6} />)}
        </div>
      ) : figures.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title="No figures noted yet."
          description="Add the first historical figure you're researching — a name, role, and dates is enough to start."
          action={{ label: 'New figure', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <DataTable
              columns={columns}
              rows={filtered}
              getRowId={(r) => r.id}
              onRowClick={(r) => setSelectedId(r.id)}
              onRowActivate={(r) => setSelectedId(r.id)}
              selectedRowId={selectedId}
              density={tableDensity}
              zebra
              stickyHeader
              caption="Your historical figures notebook"
              emptyState={<EmptyState compact title="No matches" description="No figures match this search." />}
            />
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3 sticky top-4 self-start">
            {selected ? (
              <FigureDetail
                key={selected.id}
                figure={selected}
                onDelete={() => handleDelete(selected.id)}
                onBioSave={(bio) => handleBioSave(selected.id, bio)}
                onUnlink={(timelineId, eventId) => handleUnlink(selected.id, timelineId, eventId)}
                onLink={(timelineId, eventId) => handleLink(selected.id, timelineId, eventId)}
              />
            ) : (
              <div className="text-center py-8 text-zinc-500">
                <UserRound className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Select a figure to view notes.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Detail panel: bio editor + real event-linkage (list + link/unlink). */
function FigureDetail({
  figure,
  onDelete,
  onBioSave,
  onUnlink,
  onLink,
}: {
  figure: Figure;
  onDelete: () => void;
  onBioSave: (bio: string) => Promise<void>;
  onUnlink: (timelineId: string, eventId: string) => Promise<void>;
  onLink: (timelineId: string, eventId: string) => Promise<boolean>;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{figure.name}</h3>
        <button type="button" onClick={onDelete} aria-label={`Delete ${figure.name}`}
          className="text-rose-400 hover:text-rose-300 shrink-0"><Trash2 className="w-4 h-4" /></button>
      </div>
      {figure.role && <p className="text-xs text-amber-300">{figure.role}</p>}
      <p className="text-xs text-zinc-400 font-mono">
        {figure.birthYear ?? '?'} – {figure.deathYear ?? 'present/unknown'}
      </p>
      {figure.region && <p className="text-xs text-zinc-400 capitalize">{figure.region.replace(/_/g, ' ')}</p>}

      <div className="border-t border-zinc-800 pt-2">
        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1" htmlFor="figure-bio">
          Bio (autosaves on blur)
        </label>
        <BioEditor initial={figure.bio || ''} onSave={onBioSave} />
      </div>

      <div className="border-t border-zinc-800 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1">
          <Link2 className="w-3 h-3" /> Linked events ({figure.linkedEventCount})
        </p>
        <LinkedEventsList linkedEvents={figure.linkedEvents} onUnlink={onUnlink} />
        <EventLinkPicker onLink={onLink} />
      </div>
    </>
  );
}

/** Inline autosaving bio textarea — real macro-dispatch feedback on blur. */
function BioEditor({ initial, onSave }: { initial: string; onSave: (bio: string) => Promise<unknown> }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function commit() {
    if (value === initial) return;
    setState('saving');
    try {
      await onSave(value);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('idle');
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        id="figure-bio"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="No bio yet — click to add some."
        className="w-full h-20 resize-none bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/40"
      />
      <div className="h-3.5 flex items-center gap-1 text-[10px]">
        {state === 'saving' && <><Loader2 className="w-3 h-3 animate-spin text-zinc-500" /><span className="text-zinc-500">Saving…</span></>}
        {state === 'saved' && <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Saved</span></>}
      </div>
    </div>
  );
}

/** Real linked events, each honestly flagged when its source timeline/event no longer exists. */
function LinkedEventsList({
  linkedEvents,
  onUnlink,
}: {
  linkedEvents: LinkedEvent[];
  onUnlink: (timelineId: string, eventId: string) => Promise<void>;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (linkedEvents.length === 0) {
    return <p className="text-[11px] text-zinc-500 italic mb-2">No linked events yet.</p>;
  }

  return (
    <ul className="space-y-1 mb-2">
      {linkedEvents.map((le) => {
        const key = `${le.timelineId}:${le.eventId}`;
        return (
          <li key={key} className="flex items-center gap-2 text-[11px] bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1">
            {le.found ? (
              <>
                <span className="font-mono text-amber-400 shrink-0">{le.eventYear}</span>
                <span className="flex-1 truncate text-zinc-200">{le.eventTitle}</span>
                <span className="text-zinc-500 truncate max-w-[90px]">{le.timelineTitle}</span>
              </>
            ) : (
              <span className="flex-1 flex items-center gap-1 text-amber-500/80">
                <AlertTriangle className="w-3 h-3 shrink-0" /> This linked event no longer exists.
              </span>
            )}
            <button
              type="button"
              aria-label="Unlink event"
              disabled={busyKey === key}
              onClick={async () => {
                setBusyKey(key);
                try { await onUnlink(le.timelineId, le.eventId); } finally { setBusyKey(null); }
              }}
              className="text-rose-400 hover:text-rose-300 shrink-0 disabled:opacity-40"
            >
              {busyKey === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Picker to link a new event — sourced entirely from the user's REAL
 * timelines/events via `history.timeline-list` then `history.timeline-detail`
 * for the chosen timeline (the same macro calls TimelineBuilder/EventMap
 * already use). No fabricated options.
 */
function EventLinkPicker({ onLink }: { onLink: (timelineId: string, eventId: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [timelines, setTimelines] = useState<TimelineMeta[]>([]);
  const [timelineId, setTimelineId] = useState('');
  const [events, setEvents] = useState<TimelineEventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    (async () => {
      const r = await lensRun<{ timelines: TimelineMeta[] }>('history', 'timeline-list', {});
      if (r.data?.ok && r.data.result) setTimelines(r.data.result.timelines);
    })();
  }, [open]);

  useEffect(() => {
    if (!timelineId) { setEvents([]); setEventId(''); return; }
    setLoadingEvents(true);
    (async () => {
      const r = await lensRun<{ timeline: { events: TimelineEventOption[] } }>('history', 'timeline-detail', { id: timelineId });
      setEvents(r.data?.ok && r.data.result ? r.data.result.timeline.events : []);
      setLoadingEvents(false);
    })();
  }, [timelineId]);

  async function handleLink() {
    if (!timelineId || !eventId) return;
    setError('');
    setLinking(true);
    try {
      const ok = await onLink(timelineId, eventId);
      if (ok) {
        setOpen(false);
        setTimelineId('');
        setEventId('');
      } else {
        setError('Could not link this event.');
      }
    } finally {
      setLinking(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300">
        <Plus className="w-3 h-3" /> Link an event
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 space-y-1.5">
      <select value={timelineId} onChange={(e) => setTimelineId(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200">
        <option value="">select timeline…</option>
        {timelines.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.eventCount})</option>)}
      </select>
      <select value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={!timelineId || loadingEvents}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-50">
        <option value="">{loadingEvents ? 'loading events…' : 'select event…'}</option>
        {events.map((e) => <option key={e.id} value={e.id}>{e.dateLabel} — {e.title}</option>)}
      </select>
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={handleLink} disabled={!timelineId || !eventId || linking}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40">
          {linking && <Loader2 className="w-3 h-3 animate-spin" />} Link
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(''); }} className="text-[11px] text-zinc-400 hover:text-white">Cancel</button>
      </div>
    </div>
  );
}
