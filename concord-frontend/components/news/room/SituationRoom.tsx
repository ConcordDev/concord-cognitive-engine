'use client';

/**
 * The Situation Room — the News lens. The world map is the front page: where
 * the world is reporting from, right now and over the last day, read from
 * the stories' own words. A timeline scrubs and replays the window; the
 * dossier opens a place or a story; the Desk holds the briefing, alerts,
 * library, analysis and delivery. Data: news.situation (live GDELT + vetted
 * RSS + the shared library), re-read every five minutes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, PanelRightOpen, Map as MapIcon, ListTree } from 'lucide-react';
import { cn } from '@/lib/utils';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { roomFontVars } from './roomFonts';
import { CATEGORIES, DEFAULT_CATEGORIES, FEED_REASON, fetchSituation, since, utcClock, type Arc, type Category, type Region, type Situation, type Story } from './roomApi';
import { WorldMap, placeName } from './WorldMap';
import { Timeline } from './Timeline';
import { Dossier } from './Dossier';
import { DeskDrawer, type DeskTab } from './DeskDrawer';
import './room.css';

const WINDOWS = [6, 24, 72] as const;
const REFRESH_MS = 5 * 60_000;

/** Regions and arcs for just the stories in view (the timeline span). Mirrors news-situation.js. */
export function rollUp(stories: Story[], now = Date.now()): { regions: Region[]; arcs: Arc[] } {
  const regions = new Map<string, Region & { srcs: Set<string> }>();
  const arcs = new Map<string, Arc>();
  for (const s of stories) {
    const t = Date.parse(s.at);
    for (const p of s.places) {
      const r = regions.get(p.key) || { key: p.key, count: 0, mentioned: 0, outlet: 0, sources: 0, last3h: 0, latest: null, categories: {}, srcs: new Set<string>() };
      r.count++;
      if (s.basis === 'mentioned') r.mentioned++; else r.outlet++;
      if (s.source) r.srcs.add(s.source);
      if (t >= now - 3 * 3_600_000) r.last3h++;
      if (!r.latest || s.at > r.latest) r.latest = s.at;
      r.categories[s.category] = (r.categories[s.category] || 0) + 1;
      regions.set(p.key, r);
    }
    if (s.basis === 'mentioned' && s.places.length > 1) {
      const keys = [...new Set(s.places.map((p) => p.key))].sort();
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const id = `${keys[i]}|${keys[j]}`;
        arcs.set(id, { a: keys[i], b: keys[j], count: (arcs.get(id)?.count || 0) + 1 });
      }
    }
  }
  return {
    regions: [...regions.values()].map(({ srcs, ...r }) => ({ ...r, sources: srcs.size })).sort((a, b) => b.count - a.count),
    arcs: [...arcs.values()].sort((a, b) => b.count - a.count),
  };
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function SituationRoom() {
  const [hours, setHours] = useState<number>(24);
  const [cats, setCats] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [data, setData] = useState<Situation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [openStory, setOpenStory] = useState<Story | null>(null);
  const [lib, setLib] = useState<Record<string, string>>({});
  const [desk, setDesk] = useState<DeskTab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [clock, setClock] = useState(() => utcClock());
  const [mobile, setMobile] = useState<'map' | 'dossier'>('map');
  const narrow = useNarrow();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchSituation(hours, cats);
    setLoading(false);
    if (!r.ok) { setError(r.message); return; }
    setError(null);
    setData(r.result);
    setRange([0, Math.max(0, r.result.timeline.length - 1)]);
  }, [hours, cats]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { void load(); }, REFRESH_MS); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setClock(utcClock()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);

  // The stories inside the timeline span drive the map and the dossier.
  const inSpan = useMemo(() => {
    if (!data) return [];
    const tl = data.timeline;
    if (!tl.length) return data.stories;
    const lo = Date.parse(tl[range[0]]?.at || tl[0].at);
    const hi = Date.parse(tl[range[1]]?.at || tl[tl.length - 1].at) + 3_600_000;
    return data.stories.filter((s) => { const t = Date.parse(s.at); return t >= lo && t < hi; });
  }, [data, range]);
  const view = useMemo(() => rollUp(inSpan), [inSpan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (desk) setDesk(null); else if (openStory) setOpenStory(null); else setSelected(null); }
      else if (e.key === 'd') { e.preventDefault(); setDesk((x) => (x ? null : 'briefing')); }
      else if (e.key === 'r') { e.preventDefault(); void load(); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') setHours(WINDOWS[Number(e.key) - 1]);
      else if (e.key === 'n' && view.regions.length) {
        const i = view.regions.findIndex((x) => x.key === selected);
        setSelected(view.regions[(i + 1) % view.regions.length].key); setOpenStory(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desk, openStory, selected, view.regions, load]);

  const select = (k: string | null) => { setSelected(k); setOpenStory(null); if (narrow && k) setMobile('dossier'); };
  const feed = data?.feed;
  const feedLine = !feed ? 'Connecting…'
    : feed.status === 'fresh' ? `Live · pulled ${since(feed.fetchedAt)} ago`
    : feed.status === 'stale' ? `Delayed · last pull ${since(feed.fetchedAt)} ago`
    : `Live feed unreachable — ${FEED_REASON[feed.reasons[0]] || (feed.reasons.length ? 'the news sources cannot be reached from this server.' : 'no source answered.')} Showing the library.`;

  return (
    <div className={cn('sr flex min-h-[calc(100dvh-4rem)] flex-col', roomFontVars)} data-testid="sr-app" data-lens="news">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b sr-rule px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="sr-display text-[26px] font-bold uppercase leading-none tracking-[0.06em]">Situation Room</h1>
          <span className="sr-mono text-[13px] sr-text-2" aria-label="Coordinated universal time">{clock}</span>
        </div>
        <p className="flex items-center gap-2 text-[12.5px]" data-testid="sr-feed" role="status">
          <span className="sr-lamp" data-s={feed?.status || 'unavailable'} aria-hidden />
          <span className={feed?.status === 'fresh' ? 'sr-text-2' : feed?.status === 'stale' ? 'sr-warn-text' : 'sr-muted'} title={feed?.reasons.join('; ') || undefined}>{feedLine}</span>
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex gap-1" role="radiogroup" aria-label="Window">
            {WINDOWS.map((h, i) => <button key={h} type="button" role="radio" aria-checked={hours === h} aria-pressed={hours === h} className="sr-btn h-7 px-2.5" onClick={() => setHours(h)} title={`Last ${h} hours (${i + 1})`}>{h}h</button>)}
          </div>
          <button type="button" className="sr-btn h-7 w-7 justify-center px-0" onClick={() => void load()} disabled={loading} aria-label="Refresh (r)" title="Refresh (r)"><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /></button>
          <button type="button" className="sr-btn h-7" onClick={() => setDesk('briefing')} data-testid="sr-open-desk"><PanelRightOpen className="h-3.5 w-3.5" />Desk<span className="sr-kbd">d</span></button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-1" role="group" aria-label="What to watch">
          {CATEGORIES.map((c) => {
            const on = cats.includes(c);
            return <button key={c} type="button" aria-pressed={on} className="sr-chip" onClick={() => setCats((x) => (on ? (x.length > 1 ? x.filter((y) => y !== c) : x) : [...x, c]))}>{c}</button>;
          })}
          {data && (
            <span className="sr-mono ml-auto text-[11px] sr-muted" data-testid="sr-counts">
              {inSpan.length} stories · {view.regions.length} places · <span className="sr-live-text">{inSpan.filter((s) => s.basis === 'mentioned').length} named</span> · <span className="sr-outlet-text">{inSpan.filter((s) => s.basis === 'outlet').length} by outlet</span> · {inSpan.filter((s) => !s.places.length).length} unplaced{data.counts.undated ? ` · ${data.counts.undated} undated` : ''}
            </span>
          )}
        </div>
      </header>

      {error && <p className="border-b sr-rule px-6 py-2 text-[13px] sr-warn-text" role="alert">{error}</p>}

      {narrow && (
        <nav className="flex border-b sr-rule" aria-label="View">
          {([['map', 'Map', MapIcon], ['dossier', 'Dossier', ListTree]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" className={cn('flex h-10 flex-1 items-center justify-center gap-1.5 sr-display text-[14px] font-semibold uppercase tracking-wider', mobile === id ? 'text-[color:var(--sr-text)] shadow-[inset_0_-2px_0_var(--sr-live)]' : 'sr-muted')} onClick={() => setMobile(id)} aria-current={mobile === id} data-testid={`sr-mtab-${id}`}>
              <Icon className="h-4 w-4" />{label}{id === 'dossier' && selected ? <span className="sr-mono text-[10px] normal-case sr-text-2">· {placeName(selected)}</span> : null}
            </button>
          ))}
        </nav>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {(!narrow || mobile === 'map') && (
          <main className="sr-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-2 pb-4 pt-2 sm:px-4">
            <div className="relative mx-auto aspect-[96/50] w-full max-w-[1280px]">
              <WorldMap regions={view.regions} arcs={view.arcs} selected={selected} onSelect={select} className="absolute inset-0" />
              {data && data.stories.length === 0 && (
                <div className="sr-panel absolute left-1/2 top-1/2 max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-sm px-5 py-4 text-center" data-testid="sr-empty">
                  <p className="sr-display text-[19px] font-semibold">Quiet board</p>
                  <p className="mt-1 text-[13px] sr-muted">{feed?.status === 'unavailable' ? 'The live feed cannot be reached from this server, and nothing in the library falls in this window.' : 'No stories in this window yet.'} Add a story from the Desk and it appears where it happened.</p>
                  <button type="button" className="sr-btn mx-auto mt-3" onClick={() => setDesk('library')}>Open the library</button>
                </div>
              )}
              <Legend />
            </div>
            {data && <div className="sr-panel mx-auto mt-2 w-full max-w-[1280px] rounded-sm px-3 py-2"><Timeline buckets={data.timeline} range={range} onRange={setRange} /></div>}
            {data && <LinkedPlaces arcs={view.arcs} onSelect={select} />}
          </main>
        )}
        {(!narrow || mobile === 'dossier') && (
          <aside className="sr-panel min-h-0 border-y-0 border-r-0 lg:w-[400px] lg:flex-shrink-0 xl:w-[440px]" aria-label="Dossier">
            <Dossier situation={data} regions={view.regions} stories={inSpan} selected={selected} onSelect={select} openStory={openStory} setOpenStory={setOpenStory} lib={lib} setLib={setLib} notify={setToast} />
          </aside>
        )}
      </div>

      {desk && <DeskDrawer tab={desk} setTab={setDesk} onClose={() => setDesk(null)} stories={inSpan} notify={setToast} onChanged={() => void load()} />}
      {toast && <div className="sr-panel fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-sm px-3 py-2 text-[13px]" role="status" data-testid="sr-toast">{toast}</div>}
      {!desk && <LensAgentFab lensId="news" lensPrompt="You're inside Concord News (the Situation Room): a live world map of where news is being reported from, read from the stories' own words, with a timeline, region dossiers, alerts, a library and bias analysis. Help the user understand what is happening where, compare coverage across outlets, and spot bias." />}
    </div>
  );
}

/** Places named in the same stories, strongest links first. */
function LinkedPlaces({ arcs, onSelect }: { arcs: Arc[]; onSelect: (k: string) => void }) {
  return (
    <section className="mx-auto mt-3 w-full max-w-[1280px]" aria-label="Linked places" data-testid="sr-links">
      <p className="sr-label mb-1.5">Linked places <span className="normal-case tracking-normal sr-faint">· named together in the same stories</span></p>
      {arcs.length === 0 ? <p className="text-[12.5px] sr-faint">No story in this span names two places.</p> : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {arcs.slice(0, 9).map((a) => (
            <li key={`${a.a}|${a.b}`} className="sr-panel flex items-center gap-2 rounded-sm px-3 py-2">
              <button type="button" className="sr-display text-[16px] font-semibold hover:text-[color:var(--sr-live)]" onClick={() => onSelect(a.a)}>{placeName(a.a)}</button>
              <span className="h-px flex-1 bg-[var(--sr-arc)]" aria-hidden />
              <button type="button" className="sr-display text-[16px] font-semibold hover:text-[color:var(--sr-live)]" onClick={() => onSelect(a.b)}>{placeName(a.b)}</button>
              <span className="sr-mono text-[11px] sr-muted">{a.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] sr-muted" aria-hidden>
      <span className="flex items-center gap-1">fewer {[1, 2, 3, 4, 5].map((h) => <span key={h} className="sr-heat-swatch" data-h={h} />)} more</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[var(--sr-live)]" />last 3h</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-[var(--sr-outlet)]" />outlet's country only</span>
    </div>
  );
}

export default SituationRoom;
