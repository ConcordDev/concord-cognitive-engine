'use client';

/**
 * AtlasActionPanel — geospatial bench.
 * nominatim-geocode / nominatim-reverse / overpass-poi (OSM) /
 * distanceMatrix + mint/DM/publish/agent.
 *
 * Max-polish pass: empty defaults (no fake "Eiffel Tower" / Paris bbox),
 * structured points editor for distance, geocode → reverse + bbox-center
 * auto-fill via internal piping, recall window on DM + publish, pipe
 * publish/import for cross-panel hand-off.
 */

import { useState } from 'react';
import { MapPin, Locate, Coffee, Route, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Crosshair } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  StructuredArrayEditor,
  type ColumnSpec,
  usePipe,
  PipeImporter,
  useRecallableAction,
  RecallSlot,
} from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('atlas', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'geo' | 'rev' | 'poi' | 'dist' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Place { displayName: string; latitude: number; longitude: number; category?: string; type?: string; importance?: number }
interface GeoResult { query: string; places: Place[]; count: number }
interface RevResult { latitude: number; longitude: number; displayName: string; address?: Record<string, string> }
interface PoiElement { id: number; latitude: number; longitude: number; name?: string; amenity?: string; tags?: Record<string, string> }
interface PoiResult { elements?: PoiElement[]; count?: number }
interface DistPair { from: string; to: string; distanceKm: number; estTimeMinutes: number }
interface DistResult { pairs: DistPair[]; nearest?: { from: string; to: string; distanceKm: number } }

interface PointRow { name: string; lat: number; lng: number }
const POINT_COLS: ColumnSpec<PointRow>[] = [
  { key: 'name', label: 'Name', type: 'text', flex: 2 },
  { key: 'lat', label: 'Lat', type: 'number', width: '6rem', step: 0.0001 },
  { key: 'lng', label: 'Lng', type: 'number', width: '6rem', step: 0.0001 },
];

export function AtlasActionPanel() {
  const pipe = usePipe();

  const [query, setQuery] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [amenity, setAmenity] = useState('');
  const [bboxSouth, setBboxSouth] = useState('');
  const [bboxWest, setBboxWest] = useState('');
  const [bboxNorth, setBboxNorth] = useState('');
  const [bboxEast, setBboxEast] = useState('');
  const [points, setPoints] = useState<PointRow[]>([]);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [geoResult, setGeoResult] = useState<GeoResult | null>(null);
  const [revResult, setRevResult] = useState<RevResult | null>(null);
  const [poiResult, setPoiResult] = useState<PoiResult | null>(null);
  const [distResult, setDistResult] = useState<DistResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const dmRecall = useRecallableAction({
    label: 'DM', windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish', windowMs: 30_000,
    onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); },
  });

  async function actGeo() {
    if (!query.trim()) { err('Address / place required.'); return; }
    setBusy('geo'); setFeedback(null);
    try {
      const r = await callMacro<GeoResult>('nominatim-geocode', { query: query.trim(), limit: 5 });
      if (r.ok && r.result) {
        setGeoResult(r.result);
        pipe.publish('atlas.geo', r.result, { label: `Geocode: ${r.result.places[0]?.displayName.slice(0, 40)}` });
        const first = r.result.places[0];
        if (first) { setLat(String(first.latitude)); setLng(String(first.longitude)); }
        ok(`${r.result.count} places · ${first?.displayName.slice(0, 50) ?? ''}.`);
      } else err(r.error ?? 'geo failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRev() {
    const latNum = parseFloat(lat), lngNum = parseFloat(lng);
    if (!isFinite(latNum) || !isFinite(lngNum)) { err('Valid lat + lng required.'); return; }
    setBusy('rev'); setFeedback(null);
    try {
      const r = await callMacro<RevResult>('nominatim-reverse', { latitude: latNum, longitude: lngNum });
      if (r.ok && r.result) {
        setRevResult(r.result);
        pipe.publish('atlas.rev', r.result, { label: `Reverse: ${r.result.displayName.slice(0, 40)}` });
        ok(`${r.result.displayName.slice(0, 50)}.`);
      } else err(r.error ?? 'rev failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPoi() {
    const s = parseFloat(bboxSouth), w = parseFloat(bboxWest), n = parseFloat(bboxNorth), east = parseFloat(bboxEast);
    if (![s, w, n, east].every(isFinite)) { err('Valid S/W/N/E bbox required ("Use as bbox" wires from current lat/lng).'); return; }
    if (!amenity.trim()) { err('Amenity tag required.'); return; }
    setBusy('poi'); setFeedback(null);
    try {
      const r = await callMacro<PoiResult>('overpass-poi', { south: s, west: w, north: n, east, amenity: amenity.trim() });
      if (r.ok && r.result) {
        setPoiResult(r.result);
        pipe.publish('atlas.poi', r.result, { label: `${r.result.elements?.length ?? 0} ${amenity} POIs` });
        ok(`${r.result.elements?.length ?? 0} ${amenity} POIs.`);
      } else err(r.error ?? 'poi failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDist() {
    if (points.length < 2) { err('Add at least 2 points.'); return; }
    setBusy('dist'); setFeedback(null);
    try {
      const r = await callMacro<DistResult>('distanceMatrix', { artifact: { data: { points } } });
      if (r.ok && r.result) {
        setDistResult(r.result);
        pipe.publish('atlas.dist', r.result, { label: `${r.result.pairs.length} pairs` });
        ok(`${r.result.pairs.length} pairs.`);
      } else err(r.error ?? 'dist failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Geo — ${query.slice(0, 40) || 'atlas'}`, tags: ['atlas', 'geo'], source: 'atlas:geo:mint', meta: { visibility: 'private', consent: { allowCitations: false }, atlas: { geo: geoResult, rev: revResult, poi: poiResult, dist: distResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('atlas.mintedDtuId', id, { label: `Geo DTU ${id.slice(0, 8)}…` }); ok(`Geo DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📍 Geo lookup`, '',
      geoResult?.places[0] ? `${geoResult.places[0].displayName} · ${geoResult.places[0].latitude}, ${geoResult.places[0].longitude}` : '',
      poiResult ? `${poiResult.elements?.length ?? 0} ${amenity} POIs in bbox` : '',
      distResult ? `Nearest: ${distResult.nearest?.from} ↔ ${distResult.nearest?.to} (${distResult.nearest?.distanceKm}km)` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!geoResult && !poiResult) { err('Run geocode or POI first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Atlas dataset — ${query.slice(0, 30) || 'osm'}`, tags: ['atlas', 'osm', 'public'], source: 'atlas:dataset:publish', meta: { visibility: 'public', consent: { allowCitations: true }, geo: geoResult, poi: poiResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('atlas.publishedDtuId', id, { label: `Public dataset ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Atlas/geo brief. ${geoResult?.places[0] ? `Location: ${geoResult.places[0].displayName}.` : ''} ${poiResult ? `Found ${poiResult.elements?.length} ${amenity} in bbox.` : ''} ${distResult ? `${distResult.pairs.length} distance pairs.` : ''} Suggest one geospatial insight + one related query worth running. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2);
        setAgentReply(text); pipe.publish('atlas.agentReply', text, { label: 'Geo insight' });
        ok('Insight ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  // Internal pipe: take current lat/lng → ±0.005° bbox (≈0.5km box around the point).
  function useLatLngAsBbox() {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (!isFinite(la) || !isFinite(ln)) { err('Need valid lat + lng first.'); return; }
    setBboxSouth((la - 0.005).toFixed(4));
    setBboxNorth((la + 0.005).toFixed(4));
    setBboxWest((ln - 0.005).toFixed(4));
    setBboxEast((ln + 0.005).toFixed(4));
    ok('bbox set to ±0.005° around current lat/lng.');
  }
  function promoteGeoToPoints() {
    if (!geoResult || geoResult.places.length === 0) { err('Run geocode first.'); return; }
    const next = geoResult.places.slice(0, 8).map((p) => ({
      name: p.displayName.split(',')[0].slice(0, 32),
      lat: p.latitude, lng: p.longitude,
    }));
    setPoints((prev) => [...prev, ...next]);
    ok(`Added ${next.length} geocode results as points.`);
  }

  const actions = [
    { id: 'geo' as ActionId, label: 'Geocode', desc: 'Nominatim (OSM)', icon: MapPin, accent: '#3b82f6', handler: actGeo },
    { id: 'rev' as ActionId, label: 'Reverse', desc: 'lat/lng → addr', icon: Locate, accent: '#22c55e', handler: actRev },
    { id: 'poi' as ActionId, label: 'POI', desc: 'Overpass bbox', icon: Coffee, accent: '#f59e0b', handler: actPoi },
    { id: 'dist' as ActionId, label: 'Distance', desc: 'distanceMatrix', icon: Route, accent: '#a855f7', handler: actDist },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private geo DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send geo brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public dataset', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Insight', desc: 'Agent: geo insight', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <MapPin className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Atlas / OSM</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">Nominatim · Overpass · distance</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Address / place" />
        <input type="text" value={lat} onChange={(e) => setLat(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Lat" />
        <input type="text" value={lng} onChange={(e) => setLng(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Lng" />
        <input type="text" value={amenity} onChange={(e) => setAmenity(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Amenity (e.g. cafe)" />
        <div className="md:col-span-5 flex items-end gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 self-center">bbox</span>
          <input type="text" value={bboxSouth} onChange={(e) => setBboxSouth(e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-white font-mono" placeholder="S" />
          <input type="text" value={bboxWest} onChange={(e) => setBboxWest(e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-white font-mono" placeholder="W" />
          <input type="text" value={bboxNorth} onChange={(e) => setBboxNorth(e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-white font-mono" placeholder="N" />
          <input type="text" value={bboxEast} onChange={(e) => setBboxEast(e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-white font-mono" placeholder="E" />
          <button type="button" onClick={useLatLngAsBbox} className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500" title="±0.005° around current lat/lng">
            <Crosshair className="w-3 h-3" /> Use as bbox
          </button>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="DM recipient" />
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
        <div className="md:col-span-5 space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Points for distance matrix ({points.length})</label>
            <div className="flex items-center gap-1">
              <button type="button" onClick={promoteGeoToPoints} className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500" title="Append geocode places as points">
                <MapPin className="w-3 h-3" /> + geocoded
              </button>
              <PipeImporter<PointRow[]> accept={['atlas.pointsImport']} onImport={(rows) => Array.isArray(rows) && setPoints(rows)} compact />
            </div>
          </div>
          <StructuredArrayEditor<PointRow> value={points} onChange={setPoints} template={{ name: '', lat: 0, lng: 0 }} columns={POINT_COLS} accent="purple" maxRows={40} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {geoResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Geocode · {geoResult.count} matches</div>
            {geoResult.places.slice(0, 5).map((p, i) => <div key={i} className="text-[11px] text-zinc-200 mt-1"><strong className="text-blue-200">{p.displayName}</strong><div className="text-[10px] text-zinc-400 font-mono">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)} · {p.category}/{p.type}</div></div>)}
          </div>
        )}
        {revResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Reverse · {revResult.latitude}, {revResult.longitude}</div>
            <div className="text-[11px] text-green-200">{revResult.displayName}</div>
            {revResult.address && Object.entries(revResult.address).slice(0, 5).map(([k, v]) => <div key={k} className="text-[10px] text-zinc-400"><span className="font-mono text-zinc-400">{k}:</span> {v}</div>)}
          </div>
        )}
        {poiResult?.elements && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">POI · {poiResult.elements.length} {amenity}</div>
            {poiResult.elements.slice(0, 10).map((e, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong className="text-amber-200">{e.name ?? 'unnamed'}</strong> · <span className="font-mono text-zinc-400">{e.latitude?.toFixed(4)}, {e.longitude?.toFixed(4)}</span>{e.tags?.cuisine ? ` · ${e.tags.cuisine}` : ''}</div>)}
          </div>
        )}
        {distResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Distance matrix · {distResult.pairs.length} pairs</div>
            {distResult.nearest && <div className="text-[11px] text-emerald-300">nearest: {distResult.nearest.from} ↔ {distResult.nearest.to} ({distResult.nearest.distanceKm}km)</div>}
            {distResult.pairs.slice(0, 8).map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><span className="font-mono text-purple-200">{m.from}</span> → <span className="font-mono text-purple-200">{m.to}</span></span><span className="font-mono">{m.distanceKm}km · {m.estTimeMinutes}min</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Geo insight</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
