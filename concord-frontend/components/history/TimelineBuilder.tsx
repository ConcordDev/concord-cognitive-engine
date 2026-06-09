'use client';

/**
 * TimelineBuilder — full TimelineJS-parity timeline maker. Build timelines
 * with dated events (BCE supported), multi-track grouping, color-coded
 * eras, per-event media + map coordinates, then switch into the visual
 * zoomable render, the geographic map, the parallel multi-track compare,
 * the publish/embed surface, or auto-build from a Wikipedia article.
 *
 * Every value is real user input or computed from real state — no mocks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { VisualTimeline } from './VisualTimeline';
import { EventMap } from './EventMap';
import { TimelineCompare } from './TimelineCompare';
import { TimelinePublish } from './TimelinePublish';
import { WikiTimelineImport } from './WikiTimelineImport';
import { EventMediaManager, type EventMedia } from './EventMediaManager';

interface TimelineMeta { id: string; title: string; eventCount: number; eraCount: number }
interface Event {
  id: string; title: string; year: number; dateLabel: string; category: string;
  description: string; track: string; lat: number | null; lng: number | null;
  place: string; media: EventMedia[];
}
interface Era { id: string; name: string; startYear: number | null; endYear: number | null; color: string }
interface Timeline { id: string; title: string; description: string; events: Event[]; eras: Era[] }

type View = 'edit' | 'visual' | 'map' | 'compare' | 'publish' | 'import';
const VIEWS: { id: View; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'visual', label: 'Visual' },
  { id: 'map', label: 'Map' },
  { id: 'compare', label: 'Compare' },
  { id: 'publish', label: 'Publish' },
  { id: 'import', label: 'Import' },
];

export function TimelineBuilder() {
  const [timelines, setTimelines] = useState<TimelineMeta[]>([]);
  const [active, setActive] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('edit');
  const [newTimeline, setNewTimeline] = useState('');
  const [evForm, setEvForm] = useState({ title: '', year: '', category: '', description: '', track: '' });
  const [eraForm, setEraForm] = useState({ name: '', startYear: '', endYear: '', color: '#8b5cf6' });
  const [mediaOpen, setMediaOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ timelines: TimelineMeta[] }>('history', 'timeline-list', {});
    setTimelines(r.data?.result?.timelines || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun<{ timeline: Timeline }>('history', 'timeline-detail', { id });
    if (r.data?.ok && r.data.result) setActive(r.data.result.timeline);
  }, []);
  const reload = useCallback(async () => { if (active) await open(active.id); }, [active, open]);

  async function createTimeline() {
    if (!newTimeline.trim()) return;
    const r = await lensRun<{ timeline: { id: string } }>('history', 'timeline-create', { title: newTimeline.trim() });
    setNewTimeline('');
    await refresh();
    if (r.data?.ok && r.data.result) await open(r.data.result.timeline.id);
  }
  async function deleteTimeline(id: string) {
    if (!confirm('Delete this timeline?')) return;
    await lensRun('history', 'timeline-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addEvent() {
    if (!active || !evForm.title.trim() || !evForm.year.trim()) return;
    await lensRun('history', 'event-add', {
      timelineId: active.id, title: evForm.title.trim(), year: Number(evForm.year),
      category: evForm.category.trim(), description: evForm.description.trim(),
      track: evForm.track.trim() || undefined,
    });
    setEvForm({ title: '', year: '', category: '', description: '', track: '' });
    await reload(); await refresh();
  }
  async function delEvent(id: string) {
    if (!active) return;
    await lensRun('history', 'event-delete', { timelineId: active.id, eventId: id });
    await reload(); await refresh();
  }
  async function addEra() {
    if (!active || !eraForm.name.trim()) return;
    await lensRun('history', 'era-add', {
      timelineId: active.id, name: eraForm.name.trim(),
      startYear: eraForm.startYear ? Number(eraForm.startYear) : undefined,
      endYear: eraForm.endYear ? Number(eraForm.endYear) : undefined,
      color: eraForm.color,
    });
    setEraForm({ name: '', startYear: '', endYear: '', color: '#8b5cf6' });
    await reload(); await refresh();
  }
  async function delEra(id: string) {
    if (!active) return;
    await lensRun('history', 'era-delete', { timelineId: active.id, eraId: id });
    await reload(); await refresh();
  }

  const eventOptions = useMemo(
    () => (active?.events || []).map((e) => ({ id: e.id, title: e.title, dateLabel: e.dateLabel })),
    [active],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Timeline Builder</h3>
        <span className="text-[11px] text-zinc-400">TimelineJS-shape</span>
      </div>

      {/* timeline picker */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {timelines.map((t) => (
          <span key={t.id} className="group inline-flex items-center gap-1">
            <button onClick={() => open(t.id)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border',
                active?.id === t.id
                  ? 'bg-amber-600/15 border-amber-700/50 text-amber-200'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
              {t.title} <span className="text-zinc-600">{t.eventCount}</span>
            </button>
            <button onClick={() => deleteTimeline(t.id)}
              className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete timeline">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input value={newTimeline} onChange={(e) => setNewTimeline(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createTimeline(); }}
          placeholder="New timeline"
          className="w-32 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={createTimeline} className="px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* view tabs */}
      <div className="flex gap-1 mb-3 border-b border-zinc-800">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn('px-2.5 py-1 text-[11px] rounded-t-lg -mb-px border-b-2',
              view === v.id
                ? 'border-amber-500 text-amber-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-300')}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Import is timeline-independent */}
      {view === 'import' && (
        <WikiTimelineImport onBuilt={async (id) => { await refresh(); await open(id); setView('visual'); }} />
      )}

      {view !== 'import' && !active && (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
          Select or create a timeline.
        </div>
      )}

      {view === 'compare' && (
        <TimelineCompare timelines={timelines.map((t) => ({ id: t.id, title: t.title }))} />
      )}

      {active && view === 'visual' && <VisualTimeline key={active.id} timelineId={active.id} />}

      {active && view === 'map' && (
        <EventMap timelineId={active.id} events={eventOptions} onChanged={reload} />
      )}

      {active && view === 'publish' && (
        <TimelinePublish timelineId={active.id} title={active.title} />
      )}

      {active && view === 'edit' && (
        <div>
          {/* Eras */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {active.eras.map((era) => (
              <span key={era.id} className="group inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                style={{ backgroundColor: `${era.color}22`, color: era.color }}>
                {era.name}
                {era.startYear != null && <span className="opacity-70">{era.startYear}–{era.endYear ?? '?'}</span>}
                <button onClick={() => delEra(era.id)} className="opacity-0 group-hover:opacity-100" aria-label="Delete era">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
            <input value={eraForm.name} onChange={(e) => setEraForm({ ...eraForm, name: e.target.value })} placeholder="era"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200" />
            <input value={eraForm.startYear} onChange={(e) => setEraForm({ ...eraForm, startYear: e.target.value })} placeholder="from"
              className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200" />
            <input value={eraForm.endYear} onChange={(e) => setEraForm({ ...eraForm, endYear: e.target.value })} placeholder="to"
              className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200" />
            <input type="color" value={eraForm.color} onChange={(e) => setEraForm({ ...eraForm, color: e.target.value })}
              title="Era color" className="w-6 h-6 bg-transparent border border-zinc-800 rounded cursor-pointer" />
            <button onClick={addEra} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300" aria-label="Add era">
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Add event */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
            <input value={evForm.year} onChange={(e) => setEvForm({ ...evForm, year: e.target.value })} placeholder="year (− BCE)"
              className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} placeholder="Event title"
              className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={evForm.category} onChange={(e) => setEvForm({ ...evForm, category: e.target.value })} placeholder="category"
              className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={evForm.track} onChange={(e) => setEvForm({ ...evForm, track: e.target.value })} placeholder="track"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button onClick={addEvent} disabled={!evForm.title.trim() || !evForm.year.trim()}
              className="px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40">
              Add event
            </button>
          </div>

          {/* Event list */}
          {active.events.length === 0 ? (
            <p className="text-xs text-zinc-400 italic">No events yet — add the first above.</p>
          ) : (
            <ol className="relative border-l-2 border-zinc-800 ml-3 space-y-2">
              {[...active.events].sort((a, b) => a.year - b.year).map((ev) => (
                <li key={ev.id} className="group ml-4 relative">
                  <span className="absolute -left-[1.42rem] top-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-zinc-950" />
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-amber-400 shrink-0">{ev.dateLabel}</span>
                      <span className="text-xs font-semibold text-zinc-100 flex-1">{ev.title}</span>
                      {ev.track && ev.track !== 'main' && (
                        <span className="text-[9px] px-1 rounded bg-indigo-900/60 text-indigo-300">{ev.track}</span>
                      )}
                      <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400">{ev.category}</span>
                      {ev.media.length > 0 && (
                        <span className="text-[9px] text-zinc-400">{ev.media.length} media</span>
                      )}
                      <button onClick={() => setMediaOpen(mediaOpen === ev.id ? null : ev.id)}
                        className="text-[9px] text-amber-400 hover:text-amber-300">
                        {mediaOpen === ev.id ? 'close' : 'media/loc'}
                      </button>
                      <button onClick={() => delEvent(ev.id)}
                        className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete event">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    {ev.description && <p className="text-[11px] text-zinc-400 mt-0.5">{ev.description}</p>}
                    {ev.place && <p className="text-[10px] text-zinc-400 mt-0.5">📍 {ev.place}</p>}
                    {mediaOpen === ev.id && (
                      <div className="mt-2 pt-2 border-t border-zinc-800">
                        <EventMediaManager timelineId={active.id} eventId={ev.id} media={ev.media} onChanged={reload} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
