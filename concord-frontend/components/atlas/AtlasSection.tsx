'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Plus, Trash2, Search, MapPin, ListChecks, Route, Navigation, Sparkles, History, ChevronRight, Star, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AtlasShell, AtlasNav } from './AtlasShell';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface Place { id: string; number: string; name: string; lat: number; lng: number; category: string; address: string; notes: string; rating: number | null; savedAt: string }
interface MapList { id: string; number: string; name: string; description: string; color: string; placeIds: string[]; placeCount: number; places: Place[] }
interface Stop { id: string; name: string; lat: number; lng: number; placeId: string | null; day: number; notes: string }
interface Trip { id: string; number: string; name: string; startDate: string; endDate: string; stops: Stop[]; createdAt: string }

const CATEGORIES = ['restaurant', 'cafe', 'bar', 'hotel', 'attraction', 'park', 'shop', 'museum', 'transit', 'home', 'work', 'other'];
const CAT_EMOJI: Record<string, string> = {
  restaurant: '🍽️', cafe: '☕', bar: '🍸', hotel: '🏨', attraction: '🎡', park: '🌳',
  shop: '🛍️', museum: '🏛️', transit: '🚉', home: '🏠', work: '💼', other: '📍',
};

export function AtlasSection() {
  const [nav, setNav] = useState<AtlasNav>('places');
  const [places, setPlaces] = useState<Place[]>([]);
  const [lists, setLists] = useState<MapList[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapMarkers, setMapMarkers] = useState<Array<{ lat: number; lng: number; label: string; popup?: string }>>([]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [p, l, t] = await Promise.all([
        lensRun({ domain: 'atlas', action: 'places-list', input: {} }),
        lensRun({ domain: 'atlas', action: 'lists-list', input: {} }),
        lensRun({ domain: 'atlas', action: 'trips-list', input: {} }),
      ]);
      const pl = (p.data?.result?.places || []) as Place[];
      setPlaces(pl);
      setLists((l.data?.result?.lists || []) as MapList[]);
      setTrips((t.data?.result?.trips || []) as Trip[]);
      setMapMarkers(pl.map(x => ({ lat: x.lat, lng: x.lng, label: `${CAT_EMOJI[x.category] || '📍'} ${x.name}`, popup: `<b>${x.name}</b><br/>${x.category}${x.address ? `<br/>${x.address}` : ''}` })));
    } catch (e) { console.error('[Atlas] refresh', e); }
    finally { setLoading(false); }
  }

  function showOnMap(markers: Array<{ lat: number; lng: number; label: string; popup?: string }>) {
    setMapMarkers(markers.length > 0 ? markers : places.map(x => ({ lat: x.lat, lng: x.lng, label: `${CAT_EMOJI[x.category] || '📍'} ${x.name}` })));
  }

  const mapCenter = useMemo<[number, number]>(() => {
    if (mapMarkers.length > 0) return [mapMarkers[0].lat, mapMarkers[0].lng];
    return [20, 0];
  }, [mapMarkers]);

  return (
    <AtlasShell
      activeNav={nav}
      onNavChange={setNav}
      badges={{ places: places.length, lists: lists.length, trips: trips.length }}
      panel={
        loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : (
          <>
            {nav === 'explore'    && <ExplorePanel onSaved={refresh} onShowOnMap={showOnMap} />}
            {nav === 'places'     && <PlacesPanel places={places} onChanged={refresh} onShowOnMap={showOnMap} />}
            {nav === 'lists'      && <ListsPanel lists={lists} places={places} onChanged={refresh} onShowOnMap={showOnMap} />}
            {nav === 'trips'      && <TripsPanel trips={trips} places={places} onChanged={refresh} onShowOnMap={showOnMap} />}
            {nav === 'directions' && <DirectionsPanel places={places} onShowOnMap={showOnMap} />}
            {nav === 'planner'    && <PlannerPanel places={places} onShowOnMap={showOnMap} />}
            {nav === 'recent'     && <RecentPanel />}
          </>
        )
      }
      map={
        <div className="h-full w-full">
          <MapView center={mapCenter} zoom={mapMarkers.length > 0 ? 11 : 2} markers={mapMarkers} />
        </div>
      }
    />
  );
}

// ── Explore (geocode search → save) ──────────────────────────

function ExplorePanel({ onSaved, onShowOnMap }: { onSaved: () => void; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string; popup?: string }>) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ name: string; lat: number; lng: number; address: string }>>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      lensRun({ domain: 'atlas', action: 'recent-searches-record', input: { query: q.trim() } }).catch(() => {});
      const r = await lensRun({ domain: 'atlas', action: 'nominatim-geocode', input: { query: q.trim() } });
      const matches = (r.data?.result?.matches || r.data?.result?.results || []) as Array<{ displayName?: string; display_name?: string; lat: number | string; lng?: number | string; lon?: number | string }>;
      const parsed = matches.map(m => ({
        name: String(m.displayName || m.display_name || '').split(',')[0] || 'Result',
        lat: Number(m.lat),
        lng: Number(m.lng ?? m.lon),
        address: String(m.displayName || m.display_name || ''),
      })).filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng));
      setResults(parsed);
      onShowOnMap(parsed.map(p => ({ lat: p.lat, lng: p.lng, label: `📍 ${p.name}` })));
    } catch (e) { console.error('[Explore] search', e); }
    finally { setLoading(false); }
  }

  async function save(r: { name: string; lat: number; lng: number; address: string }) {
    try {
      await lensRun({ domain: 'atlas', action: 'places-save', input: { name: r.name, lat: r.lat, lng: r.lng, address: r.address } });
      onSaved();
    } catch (e) { console.error('[Explore] save', e); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">Explore (OpenStreetMap geocode)</header>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-2 border-b border-white/10 flex items-center gap-1">
        <Search className="w-3.5 h-3.5 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any place or address…" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400 disabled:opacity-40">{loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Go'}</button>
      </form>
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">Search to find places. Results plot on the map.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {results.map((r, i) => (
              <li key={i} className="px-3 py-2 hover:bg-white/[0.03] flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{r.name}</div>
                  <div className="text-[10px] text-gray-400 truncate">{r.address}</div>
                </div>
                <button onClick={() => save(r)} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25">Save</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Saved places ──────────────────────────────────────────────

function PlacesPanel({ places, onChanged, onShowOnMap }: { places: Place[]; onChanged: () => void; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string }>) => void }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', lat: '', lng: '', category: 'other', address: '', notes: '' });

  async function create() {
    if (!draft.name.trim() || !draft.lat || !draft.lng) return;
    try {
      const r = await lensRun({ domain: 'atlas', action: 'places-save', input: { ...draft, lat: Number(draft.lat), lng: Number(draft.lng) } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ name: '', lat: '', lng: '', category: 'other', address: '', notes: '' });
      setCreating(false);
      onChanged();
    } catch (e) { console.error('[Places] create', e); }
  }
  async function remove(id: string) {
    if (!confirm('Delete this place?')) return;
    try { await lensRun({ domain: 'atlas', action: 'places-delete', input: { id } }); onChanged(); }
    catch (e) { console.error('[Places] delete', e); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Saved places</span>
        <span className="text-[10px] text-gray-400">{places.length}</span>
        <button onClick={() => onShowOnMap(places.map(p => ({ lat: p.lat, lng: p.lng, label: `${CAT_EMOJI[p.category]} ${p.name}` })))} className="ml-auto text-[10px] text-teal-300 hover:text-teal-200">Show all</button>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-0.5 text-teal-300 hover:text-teal-200"><Plus className="w-3.5 h-3.5" /></button>
      </header>
      {creating && (
        <div className="p-2 border-b border-white/10 space-y-1.5 bg-black/30">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name *" className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <div className="flex gap-1">
            <input value={draft.lat} onChange={e => setDraft({ ...draft, lat: e.target.value })} placeholder="Lat *" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={draft.lng} onChange={e => setDraft({ ...draft, lng: e.target.value })} placeholder="Lng *" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          </div>
          <select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
          </select>
          <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes" className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="w-full px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400">Save place</button>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {places.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-400">No saved places. Use Explore to find some.</li>
        ) : places.map(p => (
          <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-start gap-2 group cursor-pointer" onClick={() => onShowOnMap([{ lat: p.lat, lng: p.lng, label: `${CAT_EMOJI[p.category]} ${p.name}` }])}>
            <span className="text-base">{CAT_EMOJI[p.category] || '📍'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white truncate">{p.name}</div>
              <div className="text-[10px] text-gray-400 truncate">{p.address || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</div>
              {p.notes && <div className="text-[10px] text-gray-400 truncate">{p.notes}</div>}
            </div>
            {p.rating !== null && <span className="text-[10px] text-amber-300 inline-flex items-center gap-0.5"><Star className="w-2.5 h-2.5 fill-current" />{p.rating}</span>}
            <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(p.id); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-300"><Trash2 className="w-3 h-3" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Lists ─────────────────────────────────────────────────────

function ListsPanel({ lists, places, onChanged, onShowOnMap }: { lists: MapList[]; places: Place[]; onChanged: () => void; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string }>) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expand, setExpand] = useState<string | null>(null);
  const [addTo, setAddTo] = useState('');

  async function create() {
    if (!name.trim()) return;
    try { await lensRun({ domain: 'atlas', action: 'lists-create', input: { name: name.trim() } }); setName(''); setCreating(false); onChanged(); }
    catch (e) { console.error('[Lists] create', e); }
  }
  async function addPlace(listId: string, placeId: string) {
    if (!placeId) return;
    try { await lensRun({ domain: 'atlas', action: 'lists-add-place', input: { listId, placeId } }); setAddTo(''); onChanged(); }
    catch (e) { console.error('[Lists] add', e); }
  }
  async function removePlace(listId: string, placeId: string) {
    try { await lensRun({ domain: 'atlas', action: 'lists-remove-place', input: { listId, placeId } }); onChanged(); }
    catch (e) { console.error('[Lists] remove', e); }
  }
  async function del(id: string) {
    if (!confirm('Delete this list?')) return;
    try { await lensRun({ domain: 'atlas', action: 'lists-delete', input: { id } }); onChanged(); }
    catch (e) { console.error('[Lists] delete', e); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Lists</span>
        <span className="text-[10px] text-gray-400">{lists.length}</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="ml-auto p-0.5 text-teal-300 hover:text-teal-200"><Plus className="w-3.5 h-3.5" /></button>
      </header>
      {creating && (
        <div className="p-2 border-b border-white/10 flex gap-1">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="List name" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400">Add</button>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {lists.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-400">No lists yet.</li>
        ) : lists.map(l => {
          const isOpen = expand === l.id;
          return (
            <li key={l.id}>
              <div className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-2 group">
                <button aria-label="Next" onClick={() => setExpand(isOpen ? null : l.id)}><ChevronRight className={cn('w-3 h-3 text-gray-400 transition', isOpen && 'rotate-90')} /></button>
                <ListChecks className="w-3.5 h-3.5" style={{ color: l.color }} />
                <span className="flex-1 text-xs text-white truncate">{l.name}</span>
                <span className="text-[10px] text-gray-400">{l.placeCount}</span>
                <button onClick={() => onShowOnMap(l.places.map(p => ({ lat: p.lat, lng: p.lng, label: `${CAT_EMOJI[p.category]} ${p.name}` })))} className="opacity-0 group-hover:opacity-100 text-[10px] text-teal-300">map</button>
                <button aria-label="Delete" onClick={() => del(l.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-300"><Trash2 className="w-3 h-3" /></button>
              </div>
              {isOpen && (
                <div className="px-3 pb-2 space-y-1">
                  {l.places.map(p => (
                    <div key={p.id} className="flex items-center gap-1.5 text-[11px] text-gray-300">
                      <span>{CAT_EMOJI[p.category]}</span>
                      <span className="flex-1 truncate">{p.name}</span>
                      <button onClick={() => removePlace(l.id, p.id)} className="text-rose-300"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <div className="flex gap-1">
                    <select value={addTo} onChange={e => setAddTo(e.target.value)} className="flex-1 px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
                      <option value="">+ Add place…</option>
                      {places.filter(p => !l.placeIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button onClick={() => addPlace(l.id, addTo)} disabled={!addTo} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 disabled:opacity-40">Add</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Trips ─────────────────────────────────────────────────────

function TripsPanel({ trips, places, onChanged, onShowOnMap }: { trips: Trip[]; places: Place[]; onChanged: () => void; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string }>) => void }) {
  const [name, setName] = useState('');
  const [expand, setExpand] = useState<string | null>(null);
  const [addStop, setAddStop] = useState('');

  async function create() {
    if (!name.trim()) return;
    try { await lensRun({ domain: 'atlas', action: 'trips-create', input: { name: name.trim() } }); setName(''); onChanged(); }
    catch (e) { console.error('[Trips] create', e); }
  }
  async function addStopToTrip(tripId: string, placeId: string) {
    if (!placeId) return;
    try { await lensRun({ domain: 'atlas', action: 'trips-add-stop', input: { tripId, placeId } }); setAddStop(''); onChanged(); }
    catch (e) { console.error('[Trips] addStop', e); }
  }
  async function removeStop(tripId: string, stopId: string) {
    try { await lensRun({ domain: 'atlas', action: 'trips-remove-stop', input: { tripId, stopId } }); onChanged(); }
    catch (e) { console.error('[Trips] removeStop', e); }
  }
  async function del(id: string) {
    if (!confirm('Delete this trip?')) return;
    try { await lensRun({ domain: 'atlas', action: 'trips-delete', input: { id } }); onChanged(); }
    catch (e) { console.error('[Trips] delete', e); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Trips</span>
        <span className="text-[10px] text-gray-400">{trips.length}</span>
      </header>
      <div className="p-2 border-b border-white/10 flex gap-1">
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="New trip name" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400">Add</button>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {trips.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-400">No trips yet.</li>
        ) : trips.map(t => {
          const isOpen = expand === t.id;
          return (
            <li key={t.id}>
              <div className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-2 group">
                <button aria-label="Next" onClick={() => setExpand(isOpen ? null : t.id)}><ChevronRight className={cn('w-3 h-3 text-gray-400 transition', isOpen && 'rotate-90')} /></button>
                <Route className="w-3.5 h-3.5 text-teal-400" />
                <span className="flex-1 text-xs text-white truncate">{t.name}</span>
                <span className="text-[10px] text-gray-400">{t.stops.length} stop(s)</span>
                <button onClick={() => onShowOnMap(t.stops.map(st => ({ lat: st.lat, lng: st.lng, label: st.name })))} className="opacity-0 group-hover:opacity-100 text-[10px] text-teal-300">map</button>
                <button aria-label="Delete" onClick={() => del(t.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-300"><Trash2 className="w-3 h-3" /></button>
              </div>
              {isOpen && (
                <div className="px-3 pb-2 space-y-1">
                  {t.stops.map((st, i) => (
                    <div key={st.id} className="flex items-center gap-1.5 text-[11px] text-gray-300">
                      <span className="text-teal-400 font-mono">{i + 1}.</span>
                      <span className="flex-1 truncate">{st.name}</span>
                      <span className="text-[9px] text-gray-400">day {st.day}</span>
                      <button onClick={() => removeStop(t.id, st.id)} className="text-rose-300"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <div className="flex gap-1">
                    <select value={addStop} onChange={e => setAddStop(e.target.value)} className="flex-1 px-1.5 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
                      <option value="">+ Add stop from saved places…</option>
                      {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button onClick={() => addStopToTrip(t.id, addStop)} disabled={!addStop} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 disabled:opacity-40">Add</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Directions (OSRM) ─────────────────────────────────────────

function DirectionsPanel({ places, onShowOnMap }: { places: Place[]; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string }>) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<'driving' | 'walking' | 'cycling'>('driving');
  const [result, setResult] = useState<{ distanceKm: number; distanceMiles: number; durationText: string; mode: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    const fp = places.find(p => p.id === from);
    const tp = places.find(p => p.id === to);
    if (!fp || !tp) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await lensRun({ domain: 'atlas', action: 'directions', input: {
        waypoints: [{ lat: fp.lat, lng: fp.lng }, { lat: tp.lat, lng: tp.lng }],
        mode,
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setResult(r.data?.result);
      onShowOnMap([{ lat: fp.lat, lng: fp.lng, label: `🟢 ${fp.name}` }, { lat: tp.lat, lng: tp.lng, label: `🔴 ${tp.name}` }]);
    } catch (e) { console.error('[Directions] go', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">Directions (OSRM routing)</header>
      <div className="p-2 space-y-2">
        <select value={from} onChange={e => setFrom(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">From… (saved place)</option>
          {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={to} onChange={e => setTo(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">To… (saved place)</option>
          {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="flex gap-1">
          {(['driving', 'walking', 'cycling'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={cn('flex-1 px-2 py-1 text-[11px] rounded', mode === m ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30' : 'text-gray-400 border border-white/10')}>{m}</button>
          ))}
        </div>
        <button onClick={go} disabled={loading || !from || !to} className="w-full px-2 py-1.5 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}Get directions
        </button>
        {result && (
          <div className="rounded border border-teal-500/30 bg-teal-500/[0.05] p-3 text-center">
            <div className="text-2xl font-mono text-teal-200">{result.durationText}</div>
            <div className="text-xs text-gray-400">{result.distanceKm} km · {result.distanceMiles} mi · {result.mode}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI trip planner ───────────────────────────────────────────

function PlannerPanel({ places, onShowOnMap }: { places: Place[]; onShowOnMap: (m: Array<{ lat: number; lng: number; label: string }>) => void }) {
  const [prompt, setPrompt] = useState('');
  const [days, setDays] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ itinerary: Array<{ day: number; stops: Array<{ name: string; lat: number; lng: number; category: string }> }>; narration: string; source: string } | null>(null);

  async function plan() {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await lensRun({ domain: 'atlas', action: 'ai-trip-plan', input: { prompt: prompt.trim(), days } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setResult(r.data?.result);
      const allStops = (r.data?.result?.itinerary || []).flatMap((d: { stops: Array<{ name: string; lat: number; lng: number }> }) => d.stops);
      onShowOnMap(allStops.map((st: { name: string; lat: number; lng: number }) => ({ lat: st.lat, lng: st.lng, label: st.name })));
    } catch (e) { console.error('[Planner] plan', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">AI trip planner (Ask Maps parity)</header>
      <div className="p-2 space-y-2">
        <p className="text-[11px] text-gray-400">Builds a multi-day itinerary from your {places.length} saved place(s).</p>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. relaxed foodie weekend" rows={3} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400">Days</label>
          <input type="number" min={1} max={14} value={days} onChange={e => setDays(Number(e.target.value))} className="w-16 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={plan} disabled={loading || !prompt.trim() || places.length === 0} className="ml-auto px-2.5 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400 disabled:opacity-40 inline-flex items-center gap-1">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Plan
          </button>
        </div>
      </div>
      {result && (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
          <div className="rounded border border-teal-500/30 bg-teal-500/[0.05] p-2 text-[11px] text-teal-100">{result.narration}</div>
          {result.itinerary.map(d => (
            <div key={d.day} className="rounded border border-white/10 bg-black/30 p-2">
              <div className="text-[10px] uppercase tracking-wider text-teal-300 font-semibold mb-1">Day {d.day}</div>
              <ul className="space-y-0.5">
                {d.stops.map((st, i) => (
                  <li key={i} className="text-[11px] text-white flex items-center gap-1.5">
                    <span>{CAT_EMOJI[st.category] || '📍'}</span>{st.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="text-[10px] text-gray-400 italic">source: {result.source}</div>
        </div>
      )}
    </div>
  );
}

// ── Recent searches ───────────────────────────────────────────

function RecentPanel() {
  const [recent, setRecent] = useState<Array<{ query: string; at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'atlas', action: 'recent-searches-list', input: {} });
      setRecent((r.data?.result?.recent || []) as Array<{ query: string; at: string }>);
    } catch (e) { console.error('[Recent] failed', e); }
    finally { setLoading(false); }
  }
  async function clear() {
    try { await lensRun({ domain: 'atlas', action: 'recent-searches-clear', input: {} }); refresh(); }
    catch (e) { console.error('[Recent] clear', e); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Recent searches</span>
        <span className="text-[10px] text-gray-400">{recent.length}</span>
        {recent.length > 0 && <button onClick={clear} className="ml-auto text-[10px] text-rose-300 hover:text-rose-200">Clear</button>}
      </header>
      <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
        {loading ? (
          <li className="px-3 py-8 text-center text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</li>
        ) : recent.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-400">No recent searches.</li>
        ) : recent.map((r, i) => (
          <li key={i} className="px-3 py-2 flex items-center gap-2 text-xs text-gray-300">
            <History className="w-3 h-3 text-gray-400" />
            <span className="flex-1 truncate">{r.query}</span>
            <span className="text-[10px] text-gray-400">{r.at.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AtlasSection;
