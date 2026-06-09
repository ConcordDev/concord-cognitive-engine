'use client';

/**
 * VisualTimeline — TimelineJS-style zoomable, pannable visual timeline with
 * media-rich slides, era overlays and a date-range filter. Pure data comes
 * from the history.timeline-render macro; nothing is hardcoded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, MapPin, Image as ImageIcon,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface RenderMedia {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'audio' | 'link';
  caption: string;
  credit: string;
}
export interface RenderEvent {
  id: string;
  title: string;
  year: number;
  dateLabel: string;
  category: string;
  description: string;
  track: string;
  lat: number | null;
  lng: number | null;
  place: string;
  media: RenderMedia[];
}
export interface RenderEra {
  id: string;
  name: string;
  startYear: number | null;
  endYear: number | null;
  color: string;
}
interface RenderResult {
  timelineId: string;
  title: string;
  description: string;
  events: RenderEvent[];
  eras: RenderEra[];
  tracks: string[];
  categories: string[];
  span: { minYear: number; maxYear: number } | null;
  range: { fromYear: number | null; toYear: number | null };
  totalEvents: number;
}

const CAT_COLOR: Record<string, string> = {
  political: '#60a5fa', military: '#f87171', cultural: '#a78bfa', economic: '#34d399',
  scientific: '#22d3ee', religious: '#fbbf24', wikipedia: '#fb923c', general: '#94a3b8',
};
function catColor(c: string): string {
  return CAT_COLOR[c] || CAT_COLOR.general;
}

export function VisualTimeline({ timelineId }: { timelineId: string }) {
  const [data, setData] = useState<RenderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  const [trackFilter, setTrackFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<RenderResult>('history', 'timeline-render', {
      timelineId,
      fromYear: fromYear ? Number(fromYear) : undefined,
      toYear: toYear ? Number(toYear) : undefined,
      track: trackFilter || undefined,
    });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
      setSelectedIdx(0);
    } else {
      setData(null);
    }
    setLoading(false);
  }, [timelineId, fromYear, toYear, trackFilter]);

  useEffect(() => { void load(); }, [load]);

  const span = data?.span;

  // map each event to a horizontal % position within the visible span
  const positioned = useMemo(() => {
    const events = data?.events || [];
    if (!span || events.length === 0) return [];
    const lo = span.minYear;
    const range = Math.max(1, span.maxYear - span.minYear);
    return events.map((e) => ({ ...e, pct: ((e.year - lo) / range) * 100 }));
  }, [data, span]);

  const selected = positioned[selectedIdx] || null;

  const goPrev = useCallback(() => setSelectedIdx((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setSelectedIdx((i) => Math.min(positioned.length - 1, i + 1)),
    [positioned.length],
  );

  // scroll the selected marker into view when navigating
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-ev-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedIdx]);

  if (loading) {
    return <p className="text-xs text-zinc-400 py-6 text-center">Rendering timeline…</p>;
  }
  if (!data) {
    return <p className="text-xs text-zinc-400 py-6 text-center">No data yet — select a timeline.</p>;
  }

  return (
    <div className="space-y-3">
      {/* range + track controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-zinc-400">Range</span>
        <input
          value={fromYear} onChange={(e) => setFromYear(e.target.value)}
          placeholder="from yr" inputMode="numeric"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
        />
        <input
          value={toYear} onChange={(e) => setToYear(e.target.value)}
          placeholder="to yr" inputMode="numeric"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
        />
        {data.tracks.length > 1 && (
          <select
            value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
          >
            <option value="">all tracks</option>
            {data.tracks.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} title="Zoom out"
            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><ZoomOut className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] text-zinc-400 w-8 text-center">{zoom.toFixed(1)}×</span>
          <button onClick={() => setZoom((z) => Math.min(8, z + 0.5))} title="Zoom in"
            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button onClick={() => { setZoom(1); setFromYear(''); setToYear(''); setTrackFilter(''); }}
            title="Reset" className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><RotateCcw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {positioned.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-lg py-10 text-center text-xs text-zinc-400">
          No dated events in this range yet.
        </div>
      ) : (
        <>
          {/* zoomable / pannable axis */}
          <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60">
            <div className="relative h-32" style={{ width: `${100 * zoom}%`, minWidth: '100%' }}>
              {/* era overlay bands */}
              {span && data.eras.map((era) => {
                if (era.startYear == null || era.endYear == null) return null;
                const lo = span.minYear;
                const range = Math.max(1, span.maxYear - span.minYear);
                const left = ((era.startYear - lo) / range) * 100;
                const width = ((era.endYear - era.startYear) / range) * 100;
                return (
                  <div key={era.id} className="absolute top-0 bottom-0"
                    style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%`, backgroundColor: `${era.color}1a` }}>
                    <span className="absolute top-1 left-1 text-[9px] font-semibold" style={{ color: era.color }}>
                      {era.name}
                    </span>
                  </div>
                );
              })}
              {/* baseline */}
              <div className="absolute left-0 right-0 top-1/2 h-px bg-zinc-700" />
              {/* event markers */}
              {positioned.map((e, i) => (
                <button
                  key={e.id} data-ev-idx={i}
                  onClick={() => setSelectedIdx(i)}
                  className="absolute -translate-x-1/2 group"
                  style={{ left: `${e.pct}%`, top: '50%' }}
                  title={`${e.dateLabel} — ${e.title}`}
                >
                  <span
                    className={cn(
                      'block w-3 h-3 rounded-full border-2 -translate-y-1/2 transition-transform',
                      i === selectedIdx ? 'scale-150 ring-2 ring-white/40' : 'group-hover:scale-125',
                    )}
                    style={{ backgroundColor: catColor(e.category), borderColor: '#0a0a0f' }}
                  />
                  <span className={cn(
                    'absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px]',
                    i % 2 === 0 ? 'bottom-3' : 'top-3',
                    i === selectedIdx ? 'text-amber-300 font-semibold' : 'text-zinc-400 group-hover:text-zinc-200',
                  )}>
                    {e.dateLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* media-rich slide for the selected event */}
          {selected && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center gap-2 mb-2">
                <button aria-label="Previous" onClick={goPrev} disabled={selectedIdx === 0}
                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-[11px] font-mono text-amber-400">{selected.dateLabel}</span>
                <span className="text-sm font-bold text-zinc-100 flex-1 truncate">{selected.title}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded text-zinc-900 font-semibold"
                  style={{ backgroundColor: catColor(selected.category) }}>{selected.category}</span>
                <button aria-label="Next" onClick={goNext} disabled={selectedIdx >= positioned.length - 1}
                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </div>
              {selected.place && (
                <p className="text-[11px] text-zinc-400 flex items-center gap-1 mb-1">
                  <MapPin className="w-3 h-3" /> {selected.place}
                  {selected.lat != null && selected.lng != null && (
                    <span className="font-mono text-zinc-600"> ({selected.lat.toFixed(2)}, {selected.lng.toFixed(2)})</span>
                  )}
                </p>
              )}
              {selected.description && (
                <p className="text-xs text-zinc-400 mb-2 whitespace-pre-wrap">{selected.description}</p>
              )}
              {selected.media.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {selected.media.map((m) => (
                    <figure key={m.id} className="rounded border border-zinc-800 overflow-hidden bg-zinc-950">
                      {m.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt={m.caption || selected.title}
                          className="w-full h-24 object-cover" loading="lazy" />
                      ) : (
                        <a href={m.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-center h-24 text-[11px] text-amber-400 underline gap-1">
                          <ImageIcon className="w-3.5 h-3.5" /> open {m.kind}
                        </a>
                      )}
                      {(m.caption || m.credit) && (
                        <figcaption className="px-1.5 py-1 text-[9px] text-zinc-400">
                          {m.caption}{m.credit ? ` · ${m.credit}` : ''}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-zinc-400 italic">No media attached to this event.</p>
              )}
            </div>
          )}
          <p className="text-[10px] text-zinc-400 text-center">
            {positioned.length} event{positioned.length !== 1 ? 's' : ''}
            {span ? ` · ${span.minYear} → ${span.maxYear}` : ''}
          </p>
        </>
      )}
    </div>
  );
}
