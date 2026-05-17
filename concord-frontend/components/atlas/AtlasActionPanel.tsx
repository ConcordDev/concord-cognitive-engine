'use client';

/**
 * AtlasActionPanel — geospatial bench.
 * nominatim-geocode / nominatim-reverse / overpass-poi (OSM) /
 * distanceMatrix + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { MapPin, Locate, Coffee, Route, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

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
interface DistMatrix { from: string; to: string; distanceKm: number; estTimeMinutes: number }
interface DistResult { matrix: DistMatrix[]; nearest?: { from: string; to: string; distanceKm: number } }

const DEMO_PTS = JSON.stringify({
  points: [
    { name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
    { name: 'Oakland', lat: 37.8044, lng: -122.2712 },
    { name: 'San Jose', lat: 37.3382, lng: -121.8863 },
    { name: 'Palo Alto', lat: 37.4419, lng: -122.1430 },
  ],
}, null, 2);

export function AtlasActionPanel() {
  const [query, setQuery] = useState('Eiffel Tower, Paris');
  const [lat, setLat] = useState('48.8584');
  const [lng, setLng] = useState('2.2945');
  const [amenity, setAmenity] = useState('restaurant');
  const [bboxSouth, setBboxSouth] = useState('48.855');
  const [bboxWest, setBboxWest] = useState('2.290');
  const [bboxNorth, setBboxNorth] = useState('48.862');
  const [bboxEast, setBboxEast] = useState('2.300');
  const [ptsText, setPtsText] = useState(DEMO_PTS);
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

  async function actGeo() {
    if (!query.trim()) { err('Query required.'); return; }
    setBusy('geo'); setFeedback(null);
    try { const r = await callMacro<GeoResult>('nominatim-geocode', { query: query.trim(), limit: 5 }); if (r.ok && r.result) { setGeoResult(r.result); ok(`${r.result.count} places · ${r.result.places[0]?.displayName.slice(0, 50)}.`); if (r.result.places[0]) { setLat(String(r.result.places[0].latitude)); setLng(String(r.result.places[0].longitude)); } } else err(r.error ?? 'geo failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRev() {
    setBusy('rev'); setFeedback(null);
    try { const r = await callMacro<RevResult>('nominatim-reverse', { latitude: parseFloat(lat), longitude: parseFloat(lng) }); if (r.ok && r.result) { setRevResult(r.result); ok(`${r.result.displayName.slice(0, 50)}.`); } else err(r.error ?? 'rev failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPoi() {
    setBusy('poi'); setFeedback(null);
    try { const r = await callMacro<PoiResult>('overpass-poi', { south: parseFloat(bboxSouth), west: parseFloat(bboxWest), north: parseFloat(bboxNorth), east: parseFloat(bboxEast), amenity: amenity.trim() || undefined }); if (r.ok && r.result) { setPoiResult(r.result); ok(`${r.result.elements?.length ?? 0} ${amenity} POIs.`); } else err(r.error ?? 'poi failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDist() {
    try { const parsed = JSON.parse(ptsText); setBusy('dist'); setFeedback(null);
      const r = await callMacro<DistResult>('distanceMatrix', { artifact: { data: parsed } }); if (r.ok && r.result) { setDistResult(r.result); ok(`${r.result.matrix.length} pairs.`); } else err(r.error ?? 'dist failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid points JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Geo — ${query.slice(0, 40)}`, tags: ['atlas', 'geo'], source: 'atlas:geo:mint', meta: { visibility: 'private', consent: { allowCitations: false }, atlas: { geo: geoResult, rev: revResult, poi: poiResult, dist: distResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Geo DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📍 Geo lookup`, '', geoResult?.places[0] ? `${geoResult.places[0].displayName} · ${geoResult.places[0].latitude}, ${geoResult.places[0].longitude}` : '', poiResult ? `${poiResult.elements?.length ?? 0} ${amenity} POIs in bbox` : '', distResult ? `Nearest: ${distResult.nearest?.from} ↔ ${distResult.nearest?.to} (${distResult.nearest?.distanceKm}km)` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!geoResult && !poiResult) { err('Run geocode or POI first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Atlas dataset — ${query.slice(0, 30)}`, tags: ['atlas', 'osm', 'public'], source: 'atlas:dataset:publish', meta: { visibility: 'public', consent: { allowCitations: true }, geo: geoResult, poi: poiResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Atlas/geo brief. ${geoResult?.places[0] ? `Location: ${geoResult.places[0].displayName}.` : ''} ${poiResult ? `Found ${poiResult.elements?.length} ${amenity} in bbox.` : ''} ${distResult ? `${distResult.matrix.length} distance pairs.` : ''} Suggest one geospatial insight + one related query worth running. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Insight ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
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
        <input type="text" value={amenity} onChange={(e) => setAmenity(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Amenity" />
        <input type="text" value={bboxSouth} onChange={(e) => setBboxSouth(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="S" />
        <input type="text" value={bboxWest} onChange={(e) => setBboxWest(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="W" />
        <input type="text" value={bboxNorth} onChange={(e) => setBboxNorth(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="N" />
        <input type="text" value={bboxEast} onChange={(e) => setBboxEast(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="E" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        <textarea value={ptsText} onChange={(e) => setPtsText(e.target.value)} rows={2} className="md:col-span-5 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono" placeholder="Points JSON for distance" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {geoResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Geocode · {geoResult.count} matches</div>
            {geoResult.places.slice(0, 5).map((p, i) => <div key={i} className="text-[11px] text-zinc-200 mt-1"><strong className="text-blue-200">{p.displayName}</strong><div className="text-[10px] text-zinc-500 font-mono">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)} · {p.category}/{p.type}</div></div>)}
          </div>
        )}
        {revResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Reverse · {revResult.latitude}, {revResult.longitude}</div>
            <div className="text-[11px] text-green-200">{revResult.displayName}</div>
            {revResult.address && Object.entries(revResult.address).slice(0, 5).map(([k, v]) => <div key={k} className="text-[10px] text-zinc-400"><span className="font-mono text-zinc-500">{k}:</span> {v}</div>)}
          </div>
        )}
        {poiResult?.elements && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">POI · {poiResult.elements.length} {amenity}</div>
            {poiResult.elements.slice(0, 10).map((e, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong className="text-amber-200">{e.name ?? 'unnamed'}</strong> · <span className="font-mono text-zinc-500">{e.latitude?.toFixed(4)}, {e.longitude?.toFixed(4)}</span>{e.tags?.cuisine ? ` · ${e.tags.cuisine}` : ''}</div>)}
          </div>
        )}
        {distResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Distance matrix · {distResult.matrix.length} pairs</div>
            {distResult.nearest && <div className="text-[11px] text-emerald-300">nearest: {distResult.nearest.from} ↔ {distResult.nearest.to} ({distResult.nearest.distanceKm}km)</div>}
            {distResult.matrix.slice(0, 8).map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><span className="font-mono text-purple-200">{m.from}</span> → <span className="font-mono text-purple-200">{m.to}</span></span><span className="font-mono">{m.distanceKm}km · {m.estTimeMinutes}min</span></div>)}
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
