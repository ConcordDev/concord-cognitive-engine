'use client';

/**
 * The Star Chart — the Graph lens.
 *
 * One graph: the shared knowledge lattice drawn as a sky, with your own maps
 * drawn over it as your constellations. The sky is every DTU you may see on
 * the charted shelves, brightest first (magnitude from real links and
 * citations), grouped into constellations by modularity and named for their
 * brightest star. Click a star for its catalogue card (lineage included);
 * plot a route between two stars; survey the chart with the graph's own
 * analysis. The Chart room is where you draw your maps and mind maps.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { apiHelpers } from '@/lib/api/client';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { MindMapBuilder } from '@/components/graph/MindMapBuilder';
import { GraphParityPanel } from '@/components/graph/GraphParityPanel';
import { SkyChart, type SkyHandle } from './SkyChart';
import { CatalogueCard } from './CatalogueCard';
import { Survey } from './Survey';
import { gx, SHELF_NAMES, type MyConstellation, type Route, type Sky } from './gx';
import { skyFontVars } from './skyFonts';
import './sky.css';

type Room = 'sky' | 'charts';
const CLASS_ORDER = ['specs', 'knowledge', 'data', 'works', 'documents', 'parts', 'notes'];
const SPECTRAL: Record<string, [string, string]> = { specs: ['B', '#9db4ff'], knowledge: ['A', '#cad7ff'], data: ['F', '#f8f7ff'], works: ['G', '#fff4d6'], documents: ['K', '#ffd2a1'], parts: ['M', '#ffb08a'], notes: ['D', '#c9c9d6'] };

export default function Observatory() {
  useLensNav('graph');
  const [room, setRoom] = useState<Room>('sky');
  const [sky, setSky] = useState<Sky | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<MyConstellation[]>([]);
  const [shownCharts, setShownCharts] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [routeFrom, setRouteFrom] = useState<string | null>(null);
  const [route, setRoute] = useState<(Route & { from: string; to: string }) | null>(null);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [layers, setLayers] = useState({ figures: true, grid: true, names: true });
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const chart = useRef<SkyHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const pendingPoint = useRef<string | null>(null);

  // everything that must be on the chart even if it isn't among the brightest
  const include = useMemo(() => {
    const ids = new Set<string>(extra);
    for (const c of mine) if (shownCharts.has(c.id)) c.stars.forEach((s) => ids.add(s));
    route?.path?.forEach((s) => ids.add(s));
    if (selected) ids.add(selected);
    return [...ids].slice(0, 200);
  }, [extra, mine, shownCharts, route, selected]);
  const includeKey = include.slice().sort().join(',');

  const loadSky = useCallback(async () => {
    const r = await gx<Sky>('sky', { limit: 600, include });
    if (!r.ok) { setErr(r.error); setSky((s) => s || { visibleTotal: 0, shown: 0, stars: [], constellations: [], lines: [] }); return; }
    setErr(null); setSky(r.result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeKey, rev]);
  useEffect(() => { void loadSky(); }, [loadSky]);
  const loadMine = useCallback(async () => {
    const r = await gx<{ constellations: MyConstellation[] }>('my-constellations', {});
    if (r.ok) setMine(r.result?.constellations || []);
  }, []);
  useEffect(() => { void loadMine(); }, [loadMine, rev]);

  // after the sky reloads with a requested star in it, point at it
  useEffect(() => {
    const id = pendingPoint.current;
    if (id && sky?.stars.some((s) => s.id === id)) { pendingPoint.current = null; chart.current?.pointAt(id); }
  }, [sky]);
  const pointAt = useCallback((id: string) => {
    setSelected(id);
    if (sky?.stars.some((s) => s.id === id)) chart.current?.pointAt(id);
    else { pendingPoint.current = id; setExtra((x) => (x.includes(id) ? x : [...x, id])); }
  }, [sky]);

  // find a star by name (the same visibility-filtered index the sky reads)
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await apiHelpers.graph.search(term, 8);
        setHits(((r.data as { results?: { id: string; title: string }[] })?.results || []));
      } catch { setHits([]); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const choose = async (id: string | null) => {
    if (!id) { setSelected(null); return; }
    if (routeFrom && id !== routeFrom) {
      setRouteErr(null);
      const r = await gx<Route>('route', { from: routeFrom, to: id });
      if (!r.ok) setRouteErr(r.error); else setRoute({ ...r.result!, from: routeFrom, to: id });
      setRouteFrom(null);
    }
    setSelected(id);
  };

  const overlays = useMemo(() => {
    const out: { lines: [string, string][]; colour: string; dashed?: boolean; width?: number }[] = [];
    for (const c of mine) if (shownCharts.has(c.id)) out.push({ lines: c.lines, colour: 'rgba(143,211,199,0.85)', dashed: true, width: 1.6 });
    if (route?.path && route.path.length > 1) out.push({ lines: route.path.slice(1).map((id, i) => [route.path![i], id] as [string, string]), colour: '#f0d48b', width: 2.6 });
    return out;
  }, [mine, shownCharts, route]);
  const highlight = useMemo(() => {
    const ids = new Set<string>();
    for (const c of mine) if (shownCharts.has(c.id)) c.stars.forEach((s) => ids.add(s));
    route?.path?.forEach((s) => ids.add(s));
    return ids;
  }, [mine, shownCharts, route]);

  useLensCommand([
    { id: 'graph-search', keys: '/', description: 'Point the telescope (find a star)', category: 'navigation', action: () => { setRoom('sky'); setTimeout(() => search.current?.focus(), 0); } },
    { id: 'graph-figures', keys: 'f', description: 'Constellation figures on/off', category: 'actions', action: () => setLayers((l) => ({ ...l, figures: !l.figures })) },
    { id: 'graph-grid', keys: 'g', description: 'Coordinate grid on/off', category: 'actions', action: () => setLayers((l) => ({ ...l, grid: !l.grid })) },
    { id: 'graph-reset', keys: 'r', description: 'Whole sky', category: 'navigation', action: () => chart.current?.reset() },
    { id: 'graph-sky', keys: '1', description: 'The sky', category: 'navigation', action: () => setRoom('sky') },
    { id: 'graph-charts', keys: '2', description: 'Chart room', category: 'navigation', action: () => setRoom('charts') },
  ], { lensId: 'graph' });

  const selectedStar = sky?.stars.find((s) => s.id === selected) || null;
  const brightest = useMemo(() => (sky?.stars || []).slice().sort((a, b) => a.magnitude - b.magnitude).slice(0, 12), [sky]);
  const classesShown = useMemo(() => CLASS_ORDER.filter((c) => sky?.stars.some((s) => s.shelf === c)), [sky]);

  return (
    <LensShell lensId="graph" asMain={false}>
      <div data-lens-theme="graph" className={`sk ${skyFontVars} relative flex min-h-full flex-col`}>
        <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-2 pt-4 sm:px-6">
          <div>
            <h1 className="sk-atlas text-[2.4rem] leading-none text-[var(--sk-ink)] sm:text-[2.9rem]">Graph</h1>
            <p className="sk-atlas mt-1 text-[15px] italic text-[var(--sk-ink-2)]">a chart of everything that connects</p>
          </div>
          <nav role="tablist" aria-label="Rooms" className="flex gap-5">
            <button type="button" role="tab" aria-selected={room === 'sky'} className="sk-tab" onClick={() => setRoom('sky')} data-testid="sk-room-sky">The sky</button>
            <button type="button" role="tab" aria-selected={room === 'charts'} className="sk-tab" onClick={() => setRoom('charts')} data-testid="sk-room-charts">Chart room</button>
          </nav>
        </header>

        {room === 'sky' ? (
          <div className="relative grid min-h-[620px] flex-1 grid-cols-1 gap-3 px-3 pb-3 sm:px-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative min-h-[460px] overflow-hidden rounded-xl border border-[var(--sk-rule)] lg:min-h-0">
              {sky === null ? (
                <div className="sk-skeleton absolute inset-3" role="status" aria-label="Opening the observatory" data-testid="sk-loading" />
              ) : sky.stars.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center" data-testid="sk-empty">
                  <p className="sk-atlas text-[22px] italic">The sky is dark.</p>
                  <p className="max-w-sm text-[13px] text-[var(--sk-muted)]">Stars are the DTUs you can see: knowledge, specs, works, documents. As they’re made and linked, they’ll appear here.</p>
                  {err && <p className="sk-error" role="alert">{err}</p>}
                </div>
              ) : (
                <SkyChart ref={chart} stars={sky.stars} lines={sky.lines} constellations={sky.constellations}
                  selectedId={selected} onSelect={(id) => { void choose(id); }} overlays={overlays} highlight={highlight}
                  showFigures={layers.figures} showGrid={layers.grid} showNames={layers.names} />
              )}
              {/* the telescope's controls */}
              <div className="sk-panel absolute left-3 top-3 w-[min(320px,calc(100%-24px))] space-y-2 p-2.5">
                <div className="relative">
                  <input ref={search} className="sk-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Point the telescope at…" aria-label="Find a star" data-testid="sk-search" />
                  {hits.length > 0 && (
                    <ul className="sk-panel absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto p-1" role="listbox" aria-label="Stars found">
                      {hits.map((h) => (
                        <li key={h.id}><button type="button" role="option" aria-selected={false} className="w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-[rgba(216,183,102,0.12)]" onClick={() => { setQ(''); setHits([]); pointAt(h.id); }}><span className="sk-atlas italic">{h.title}</span></button></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {([['figures', 'Figures'], ['grid', 'Grid'], ['names', 'Names']] as const).map(([k, l]) => (
                    <button key={k} type="button" className="sk-btn !min-h-[28px] !px-2.5 text-[11.5px]" aria-pressed={layers[k]} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))}>{l}</button>
                  ))}
                  <button type="button" className="sk-btn !min-h-[28px] !px-2.5 text-[11.5px]" onClick={() => chart.current?.reset()}>Whole sky</button>
                </div>
                {sky && <p className="sk-mono text-[11px] text-[var(--sk-muted)]" data-testid="sk-counts">{sky.shown} of {sky.visibleTotal} stars · {sky.constellations.length} constellations</p>}
              </div>
              {classesShown.length > 0 && (
                <ul className="sk-panel absolute bottom-3 right-3 flex max-w-[calc(100%-24px)] flex-wrap gap-x-3 gap-y-1 p-2 text-[11px]" aria-label="Star classes">
                  {classesShown.map((c) => <li key={c} className="flex items-center gap-1.5"><span className="sk-dot" style={{ background: SPECTRAL[c][1], color: SPECTRAL[c][1] }} /><span className="sk-mono">{SPECTRAL[c][0]}</span> {SHELF_NAMES[c]}</li>)}
                  <li className="text-[var(--sk-muted)]">brighter = more links &amp; citations</li>
                </ul>
              )}
              {(routeFrom || route || routeErr) && (
                <div className="sk-panel absolute right-3 top-3 max-w-[300px] p-3 text-[12.5px]" aria-live="polite" data-testid="sk-route">
                  {routeFrom ? <p>Choose the destination star on the chart.</p>
                    : routeErr ? <p className="sk-error">{routeErr}</p>
                      : route?.path ? (
                        <>
                          <p className="sk-label mb-1">Route · {route.hops} jump{route.hops === 1 ? '' : 's'}</p>
                          <ol className="space-y-0.5">{route.stops.map((s, i) => <li key={s.id}><span className="sk-mono text-[var(--sk-muted)]">{i + 1}.</span> <button type="button" className="sk-link sk-atlas italic" onClick={() => pointAt(s.id)}>{s.title}</button></li>)}</ol>
                        </>
                      ) : <p className="text-[var(--sk-muted)]">{route?.note || 'No route.'}</p>}
                  <button type="button" className="sk-btn mt-2 !min-h-[26px] !px-2 text-[11px]" onClick={() => { setRoute(null); setRouteFrom(null); setRouteErr(null); }}>Clear route</button>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col gap-3 lg:max-h-[calc(100vh-150px)]">
              {selected ? (
                <CatalogueCard key={selected} id={selected} star={selectedStar} onClose={() => setSelected(null)} onPoint={pointAt}
                  onRouteFrom={(id) => { setRoute(null); setRouteErr(null); setRouteFrom((cur) => (cur === id ? null : id)); }} routingFrom={routeFrom}
                  onOpen={setOpenId} onCreated={(id) => { setRev((n) => n + 1); pendingPoint.current = id; setExtra((x) => [...x, id]); setSelected(id); }} />
              ) : (
                <div className="sk-panel min-h-0 space-y-4 overflow-y-auto p-4">
                  <section aria-label="Brightest stars">
                    <h3 className="sk-label mb-1.5">Brightest stars</h3>
                    {brightest.length === 0 ? <p className="text-[12.5px] text-[var(--sk-muted)]">None yet.</p> : (
                      <ol className="space-y-0.5" data-testid="sk-brightest">
                        {brightest.map((s) => (
                          <li key={s.id} className="flex items-baseline gap-2">
                            <span className="sk-dot shrink-0" style={{ background: s.colour, color: s.colour }} aria-hidden />
                            <button type="button" className="sk-link sk-atlas min-w-0 flex-1 truncate italic" onClick={() => pointAt(s.id)}>{s.title}</button>
                            <span className="sk-mono text-[11px] text-[var(--sk-muted)]">{s.magnitude.toFixed(1)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                  <section aria-label="Your constellations">
                    <h3 className="sk-label mb-1.5">Your constellations</h3>
                    {mine.length === 0 ? <p className="text-[12.5px] text-[var(--sk-muted)]">Draw a map in the Chart room and link its nodes to stars: it appears here, over the sky, for you alone.</p> : (
                      <ul className="space-y-1" data-testid="sk-mine">
                        {mine.map((c) => (
                          <li key={c.id}>
                            <button type="button" className="sk-btn w-full !justify-start !rounded-md !px-2.5 text-left" aria-pressed={shownCharts.has(c.id)}
                              onClick={() => setShownCharts((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                              <span className="sk-atlas min-w-0 flex-1 truncate italic">{c.title}</span>
                              <span className="sk-mono text-[10.5px] text-[var(--sk-muted)]">{c.stars.length} stars · {c.lines.length} lines</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {sky && sky.stars.length > 0 && <Survey stars={sky.stars} lines={sky.lines} onPoint={pointAt} />}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="sk-room space-y-4 px-3 pb-6 sm:px-5">
            <p className="max-w-2xl text-[13.5px] text-[var(--sk-ink-2)]">Your charts. Each map is one of your constellations: link a node to a DTU and it’s drawn between those stars on the sky. Lines you draw from someone else’s star stay on your chart; they’re never written into theirs.</p>
            <section className="sk-panel p-4" aria-label="Your maps"><GraphParityPanel /></section>
            <section className="sk-panel p-4" aria-label="Mind maps"><MindMapBuilder /></section>
          </div>
        )}
        {openId && <DTUDetailView dtuId={openId} onClose={() => setOpenId(null)} onNavigate={(id) => setOpenId(id)} />}
      </div>
    </LensShell>
  );
}
