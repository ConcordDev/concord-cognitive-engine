'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Loader2, Plus, Trash2, Search, MapPin, ListChecks, Route, Navigation, Sparkles,
  History, ChevronRight, Star, X, Network, Coffee, Utensils, Fuel, Hotel,
  ParkingCircle, Share2, ArrowDownUp, Car, PersonStanding, Bike, TrafficCone,
  TrainFront, Compass as CompassIcon, Wrench, Info, Camera, DownloadCloud, Sliders,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AtlasShell, AtlasNav } from './AtlasShell';
import { PlacesGraph } from './PlacesGraph';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { PlaceShareSheet, type PlaceLike } from './PlaceShareSheet';
import { DistanceMatrixPanel } from './DistanceMatrixPanel';
import { RegionStatsTool } from './RegionStatsTool';
import { BatchGeocodeTool } from './BatchGeocodeTool';
import { PlaceDetails } from './PlaceDetails';
import { StreetImagery } from './StreetImagery';
import { OfflineAreas } from './OfflineAreas';
import { LiveTrafficPanel } from './LiveTrafficPanel';
import { TransitDirections } from './TransitDirections';
import { NavigationMode } from './NavigationMode';
import { RouteStops } from './RouteStops';
import { AtlasActionPanel } from './AtlasActionPanel';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface Place { id: string; number: string; name: string; lat: number; lng: number; category: string; address: string; notes: string; rating: number | null; savedAt: string }
interface MapList { id: string; number: string; name: string; description: string; color: string; placeIds: string[]; placeCount: number; places: Place[] }
interface Stop { id: string; name: string; lat: number; lng: number; placeId: string | null; day: number; notes: string }
interface Trip { id: string; number: string; name: string; startDate: string; endDate: string; stops: Stop[]; createdAt: string }
type MapMarker = { lat: number; lng: number; label: string; popup?: string };

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
  const [mapMarkers, setMapMarkers] = useState<MapMarker[]>([]);

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

  function showOnMap(markers: MapMarker[]) {
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
            {nav === 'tools'      && <ToolsPanel />}
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

// ── Explore (geocode search → focused place → POI discovery → save/share) ──

const POI_CATEGORIES = [
  { id: 'cafe', label: 'Cafés', icon: Coffee },
  { id: 'restaurant', label: 'Restaurants', icon: Utensils },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'hotel', label: 'Hotels', icon: Hotel },
  { id: 'parking', label: 'Parking', icon: ParkingCircle },
];

interface GeoMatch { name: string; lat: number; lng: number; address: string; osmType?: string; osmId?: number; boundingBox?: number[] }
interface OverpassPoi { type: string; id: number; latitude: number; longitude: number; name?: string; amenity?: string; cuisine?: string; opening_hours?: string; website?: string }

function ExplorePanel({ onSaved, onShowOnMap }: { onSaved: () => void; onShowOnMap: (m: MapMarker[]) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [focus, setFocus] = useState<GeoMatch | null>(null);
  const [activeAmenity, setActiveAmenity] = useState<string | null>(null);
  const [pois, setPois] = useState<OverpassPoi[]>([]);
  const [poiLoading, setPoiLoading] = useState(false);
  const [showShare, setShowShare] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    setFocus(null); setPois([]); setActiveAmenity(null);
    try {
      lensRun({ domain: 'atlas', action: 'recent-searches-record', input: { query: q.trim() } }).catch(() => {});
      const r = await lensRun({ domain: 'atlas', action: 'nominatim-geocode', input: { query: q.trim(), limit: 8 } });
      const raw = (r.data?.result?.places || r.data?.result?.result?.places || r.data?.result?.matches || r.data?.result?.results || []) as Array<{ displayName?: string; display_name?: string; latitude?: number; lat?: number | string; longitude?: number; lng?: number | string; lon?: number | string; osmType?: string; osmId?: number; boundingBox?: number[] }>;
      const parsed: GeoMatch[] = raw.map(m => ({
        name: String(m.displayName || m.display_name || '').split(',')[0] || 'Result',
        lat: Number(m.latitude ?? m.lat),
        lng: Number(m.longitude ?? m.lng ?? m.lon),
        address: String(m.displayName || m.display_name || ''),
        osmType: m.osmType,
        osmId: m.osmId,
        boundingBox: m.boundingBox,
      })).filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng));
      setResults(parsed);
      onShowOnMap(parsed.map(p => ({ lat: p.lat, lng: p.lng, label: `📍 ${p.name}` })));
    } catch (e) { console.error('[Explore] search', e); }
    finally { setLoading(false); }
  }

  async function save(r: GeoMatch) {
    try {
      await lensRun({ domain: 'atlas', action: 'places-save', input: { name: r.name, lat: r.lat, lng: r.lng, address: r.address } });
      onSaved();
    } catch (e) { console.error('[Explore] save', e); }
  }

  function selectFocus(r: GeoMatch) {
    setFocus(r);
    setPois([]);
    setActiveAmenity(null);
    onShowOnMap([{ lat: r.lat, lng: r.lng, label: `📍 ${r.name}` }]);
  }

  async function runCategory(amenity: string) {
    if (!focus) return;
    setActiveAmenity(amenity);
    setPoiLoading(true);
    try {
      const box = focus.boundingBox && focus.boundingBox.length === 4
        ? { south: focus.boundingBox[0], north: focus.boundingBox[1], west: focus.boundingBox[2], east: focus.boundingBox[3] }
        // No bounding box on this result (e.g. a plain lat/lng point) — synth a ~1.5km box around it.
        : { south: focus.lat - 0.0135, north: focus.lat + 0.0135, west: focus.lng - 0.0135, east: focus.lng + 0.0135 };
      const r = await lensRun<{ elements: OverpassPoi[] }>('atlas', 'overpass-poi', { ...box, amenity });
      const found = (r.data?.result?.elements || []) as OverpassPoi[];
      setPois(found);
      onShowOnMap([
        { lat: focus.lat, lng: focus.lng, label: `📍 ${focus.name}` },
        ...found.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map(p => ({ lat: p.latitude, lng: p.longitude, label: `${CAT_EMOJI[amenity] || '📍'} ${p.name || amenity}` })),
      ]);
    } catch (e) { console.error('[Explore] poi', e); }
    finally { setPoiLoading(false); }
  }

  const shareTarget: PlaceLike | null = focus ? {
    displayName: focus.address || focus.name,
    latitude: focus.lat,
    longitude: focus.lng,
    osmType: focus.osmType,
    osmId: focus.osmId,
  } : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">Explore (OpenStreetMap geocode)</header>
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="p-2 border-b border-white/10 flex items-center gap-1">
        <Search className="w-3.5 h-3.5 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any place or address…" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="submit" disabled={loading} className="px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400 disabled:opacity-40">{loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Go'}</button>
      </form>

      {focus && (
        <div className="border-b border-white/10 bg-teal-500/[0.04] p-2.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-gray-400">Focused place</div>
              <div className="text-xs text-white truncate">{focus.name}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => save(focus)} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25">Save</button>
              <SaveAsDtuButton
                compact
                apiSource="openstreetmap"
                apiUrl={focus.osmType && focus.osmId ? `https://www.openstreetmap.org/${focus.osmType}/${focus.osmId}` : undefined}
                title={focus.name}
                content={`Place: ${focus.address}\nCoordinates: ${focus.lat}, ${focus.lng}`}
                extraTags={['atlas', 'place']}
                rawData={focus}
              />
              <button
                type="button"
                onClick={() => setShowShare(true)}
                className="p-1 rounded text-teal-300 hover:bg-teal-500/15"
                aria-label="Share or act on this place"
                title="Share / act"
              >
                <Share2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {POI_CATEGORIES.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => runCategory(c.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  activeAmenity === c.id ? 'border-teal-500/50 bg-teal-500/15 text-teal-200' : 'border-white/10 bg-black/20 text-gray-400 hover:border-teal-500/30',
                )}
              >
                <c.icon className="h-2.5 w-2.5" />{c.label}
              </button>
            ))}
            {poiLoading && <Loader2 className="h-3 w-3 animate-spin text-teal-400" />}
          </div>
          {pois.length > 0 && (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {pois.map(p => (
                <li key={`${p.type}-${p.id}`} className="flex items-center gap-1.5 text-[10px] text-gray-300">
                  <MapPin className="h-2.5 w-2.5 text-teal-400 shrink-0" />
                  <span className="truncate flex-1">{p.name || `(unnamed ${p.amenity})`}</span>
                  {p.cuisine && <span className="text-gray-500">{p.cuisine}</span>}
                </li>
              ))}
            </ul>
          )}
          {activeAmenity && !poiLoading && pois.length === 0 && (
            <p className="text-[10px] text-gray-400">No {activeAmenity.replace('_', ' ')} found nearby.</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">Search to find places. Results plot on the map — pick one to discover nearby cafés, restaurants, fuel, hotels, or parking.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {results.map((r, i) => (
              <li key={i} className={cn('px-3 py-2 hover:bg-white/[0.03] flex items-start gap-2 cursor-pointer', focus?.name === r.name && focus.lat === r.lat && 'bg-white/[0.04]')} onClick={() => selectFocus(r)}>
                <MapPin className="w-3.5 h-3.5 text-teal-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{r.name}</div>
                  <div className="text-[10px] text-gray-400 truncate">{r.address}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); save(r); }} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25">Save</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AnimatePresence>
        {showShare && shareTarget && <PlaceShareSheet place={shareTarget} onClose={() => setShowShare(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ── Saved places ──────────────────────────────────────────────

function PlacesPanel({ places, onChanged, onShowOnMap }: { places: Place[]; onChanged: () => void; onShowOnMap: (m: MapMarker[]) => void }) {
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

// ── Lists (+ optional graph view of places ↔ lists) ─────────────

function ListsPanel({ lists, places, onChanged, onShowOnMap }: { lists: MapList[]; places: Place[]; onChanged: () => void; onShowOnMap: (m: MapMarker[]) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expand, setExpand] = useState<string | null>(null);
  const [addTo, setAddTo] = useState('');
  const [showGraph, setShowGraph] = useState(false);

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
        <button
          onClick={() => setShowGraph(v => !v)}
          className={cn('ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border', showGraph ? 'border-teal-500/40 bg-teal-500/15 text-teal-200' : 'border-white/10 text-gray-400 hover:text-white')}
          title="Toggle graph view"
        >
          <Network className="w-3 h-3" /> Graph
        </button>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-0.5 text-teal-300 hover:text-teal-200"><Plus className="w-3.5 h-3.5" /></button>
      </header>
      {creating && (
        <div className="p-2 border-b border-white/10 flex gap-1">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="List name" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-2 py-1 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400">Add</button>
        </div>
      )}
      {showGraph && (
        <div className="border-b border-white/10 p-2">
          <PlacesGraph />
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
                      <button aria-label="Remove place" onClick={() => removePlace(l.id, p.id)} className="text-rose-300"><X className="w-3 h-3" /></button>
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

function TripsPanel({ trips, places, onChanged, onShowOnMap }: { trips: Trip[]; places: Place[]; onChanged: () => void; onShowOnMap: (m: MapMarker[]) => void }) {
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
                      <button aria-label="Remove stop" onClick={() => removeStop(t.id, st.id)} className="text-rose-300"><X className="w-3 h-3" /></button>
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

// ── Directions (real OSRM turn-by-turn, + traffic / transit / navigate / add-a-stop) ──

type DirSubTab = 'route' | 'traffic' | 'transit' | 'navigate' | 'stop';
const DIR_SUBTABS: Array<{ id: DirSubTab; label: string; icon: typeof Navigation }> = [
  { id: 'route', label: 'Route', icon: Navigation },
  { id: 'traffic', label: 'Traffic', icon: TrafficCone },
  { id: 'transit', label: 'Transit', icon: TrainFront },
  { id: 'navigate', label: 'Navigate', icon: CompassIcon },
  { id: 'stop', label: 'Add a stop', icon: Fuel },
];

interface MultiModalStep { instruction: string; roadName: string; distanceMeters: number }
interface MultiModalResult { mode: string; distanceKm: number; distanceMiles: number; durationText: string; steps: MultiModalStep[]; stepCount: number; source: string }

function fmtMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

async function geocodeOne(query: string): Promise<{ name: string; lat: number; lng: number } | null> {
  if (!query.trim()) return null;
  try {
    const r = await lensRun({ domain: 'atlas', action: 'nominatim-geocode', input: { query: query.trim(), limit: 1 } });
    const raw = (r.data?.result?.places || r.data?.result?.result?.places || []) as Array<{ displayName?: string; display_name?: string; latitude?: number; longitude?: number }>;
    const top = raw[0];
    if (!top) return null;
    return { name: String(top.displayName || top.display_name || query), lat: Number(top.latitude), lng: Number(top.longitude) };
  } catch { return null; }
}

function DirectionsPanel({ places, onShowOnMap }: { places: Place[]; onShowOnMap: (m: MapMarker[]) => void }) {
  const [sub, setSub] = useState<DirSubTab>('route');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [mode, setMode] = useState<'driving' | 'walking' | 'cycling'>('driving');
  const [result, setResult] = useState<MultiModalResult | null>(null);
  const [resolvedNames, setResolvedNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fillFromPlace(setter: (v: string) => void, placeId: string) {
    const p = places.find(x => x.id === placeId);
    if (p) setter(p.name);
  }

  function swap() { const o = origin; setOrigin(destination); setDestination(o); setResult(null); }
  const addStop = () => setStops(s => [...s, '']);
  const updateStop = (i: number, v: string) => setStops(s => s.map((x, idx) => idx === i ? v : x));
  const removeStop = (i: number) => setStops(s => s.filter((_, idx) => idx !== i));

  async function go() {
    if (!origin.trim() || !destination.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const legs = [origin, ...stops, destination];
      const resolved = await Promise.all(legs.map(geocodeOne));
      const valid = resolved.filter((r): r is { name: string; lat: number; lng: number } => r !== null);
      if (valid.length < 2) { setError("Couldn't resolve one or more addresses. Try a more specific location."); setLoading(false); return; }
      setResolvedNames(valid.map(v => v.name));
      const r = await lensRun<MultiModalResult>('atlas', 'directions-multimodal', {
        mode,
        waypoints: valid.map(v => ({ lat: v.lat, lng: v.lng })),
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
        onShowOnMap(valid.map((v, i) => ({ lat: v.lat, lng: v.lng, label: i === 0 ? `🟢 ${v.name}` : i === valid.length - 1 ? `🔴 ${v.name}` : `🟡 ${v.name}` })));
      } else {
        setError(r.data?.error || 'Routing failed.');
      }
    } catch { setError('Routing service unreachable.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">Directions</header>
      <div className="flex gap-1 border-b border-white/10 bg-black/20 p-1.5 overflow-x-auto">
        {DIR_SUBTABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} className={cn('flex items-center gap-1 rounded px-2 py-1 text-[10px] whitespace-nowrap', sub === t.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200')}>
            <t.icon className="w-3 h-3" />{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {sub === 'route' && (
          <div className="p-2 space-y-2">
            <div className="flex gap-1">
              {(['driving', 'walking', 'cycling'] as const).map(m => {
                const Icon = m === 'driving' ? Car : m === 'walking' ? PersonStanding : Bike;
                return (
                  <button key={m} onClick={() => setMode(m)} className={cn('flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded', mode === m ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30' : 'text-gray-400 border border-white/10')}>
                    <Icon className="w-3 h-3" />{m}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-full border-2 border-emerald-400" />
                <input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Choose starting point" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <select onChange={e => { fillFromPlace(setOrigin, e.target.value); e.target.value = ''; }} className="w-6 bg-lattice-deep border border-lattice-border rounded text-white text-[9px]" title="Use a saved place" defaultValue="">
                  <option value="" disabled>·</option>
                  {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={swap} className="p-1 text-gray-400 hover:text-white" aria-label="Swap origin and destination"><ArrowDownUp className="w-3.5 h-3.5" /></button>
              </div>
              {stops.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500 ml-0.5" />
                  <input value={s} onChange={e => updateStop(i, e.target.value)} placeholder={`Stop ${i + 1}`} className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <button onClick={() => removeStop(i)} className="p-1 text-gray-400 hover:text-rose-300" aria-label="Remove stop"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0 text-rose-400" />
                <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Choose destination" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <select onChange={e => { fillFromPlace(setDestination, e.target.value); e.target.value = ''; }} className="w-6 bg-lattice-deep border border-lattice-border rounded text-white text-[9px]" title="Use a saved place" defaultValue="">
                  <option value="" disabled>·</option>
                  {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <button onClick={addStop} className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-teal-300"><Plus className="w-3 h-3" />Add stop</button>
            </div>
            <button onClick={go} disabled={loading || !origin.trim() || !destination.trim()} className="w-full px-2 py-1.5 text-xs rounded bg-teal-500 text-black font-bold hover:bg-teal-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}Get directions
            </button>
            {error && <p className="text-[11px] text-rose-300">{error}</p>}
            {result && (
              <div className="space-y-2">
                <div className="rounded border border-teal-500/30 bg-teal-500/[0.05] p-3 text-center">
                  <div className="text-2xl font-mono text-teal-200">{result.durationText}</div>
                  <div className="text-xs text-gray-400">{result.distanceKm} km · {result.distanceMiles} mi · via {result.mode}</div>
                </div>
                {resolvedNames.length > 0 && (
                  <ol className="space-y-0.5">
                    {resolvedNames.map((n, i) => <li key={i} className="text-[10px] text-gray-300">{i + 1}. {n}</li>)}
                  </ol>
                )}
                {result.steps.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Steps ({result.stepCount})</div>
                    {result.steps.map((st, i) => (
                      <div key={i} className="flex items-start gap-1.5 rounded border border-white/10 bg-black/20 px-2 py-1">
                        <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-teal-400" />
                        <div className="flex-1 text-[10px]">
                          <div className="capitalize text-gray-100">{st.instruction}</div>
                          <div className="text-gray-400">{st.roadName && <span>{st.roadName} · </span>}{fmtMeters(st.distanceMeters)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-gray-500">Source: {result.source}</p>
              </div>
            )}
          </div>
        )}
        {sub === 'traffic' && <div className="p-2"><LiveTrafficPanel /></div>}
        {sub === 'transit' && <div className="p-2"><TransitDirections /></div>}
        {sub === 'navigate' && <div className="p-2"><NavigationMode /></div>}
        {sub === 'stop' && <div className="p-2"><RouteStops /></div>}
      </div>
    </div>
  );
}

// ── AI trip planner ───────────────────────────────────────────

function PlannerPanel({ places, onShowOnMap }: { places: Place[]; onShowOnMap: (m: MapMarker[]) => void }) {
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

// ── Tools (power-user geo utilities) ────────────────────────────

type ToolSubTab = 'optimizer' | 'regions' | 'geocode' | 'details' | 'imagery' | 'offline' | 'bench';
const TOOL_SUBTABS: Array<{ id: ToolSubTab; label: string; icon: typeof Wrench }> = [
  { id: 'optimizer', label: 'Route optimizer', icon: Route },
  { id: 'regions', label: 'Region stats', icon: Sliders },
  { id: 'geocode', label: 'Batch geocode', icon: MapPin },
  { id: 'details', label: 'Place details', icon: Info },
  { id: 'imagery', label: 'Street imagery', icon: Camera },
  { id: 'offline', label: 'Offline areas', icon: DownloadCloud },
  { id: 'bench', label: 'Quick actions', icon: Sparkles },
];

function ToolsPanel() {
  const [sub, setSub] = useState<ToolSubTab>('optimizer');
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 text-xs font-semibold text-gray-200">Tools</header>
      <div className="flex gap-1 border-b border-white/10 bg-black/20 p-1.5 overflow-x-auto">
        {TOOL_SUBTABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} className={cn('flex items-center gap-1 rounded px-2 py-1 text-[10px] whitespace-nowrap', sub === t.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200')}>
            <t.icon className="w-3 h-3" />{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {sub === 'optimizer' && <DistanceMatrixPanel />}
        {sub === 'regions' && <RegionStatsTool />}
        {sub === 'geocode' && <BatchGeocodeTool />}
        {sub === 'details' && <PlaceDetails />}
        {sub === 'imagery' && <StreetImagery />}
        {sub === 'offline' && <OfflineAreas />}
        {sub === 'bench' && <AtlasActionPanel />}
      </div>
    </div>
  );
}

// ── Recent searches ───────────────────────────────────────────

interface AtlasSnapshot {
  placeCount: number; listCount: number; tripCount: number; totalStops: number;
  recentSearchCount: number; offlineAreaCount: number; navActive: boolean;
  byCategory: Record<string, number>;
}

function RecentPanel() {
  const [recent, setRecent] = useState<Array<{ query: string; at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<AtlasSnapshot | null>(null);

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        lensRun({ domain: 'atlas', action: 'recent-searches-list', input: {} }),
        lensRun<AtlasSnapshot>({ domain: 'atlas', action: 'atlas-dashboard-summary', input: {} }),
      ]);
      setRecent((r.data?.result?.recent || []) as Array<{ query: string; at: string }>);
      setSnapshot(s.data?.ok ? (s.data.result as AtlasSnapshot) : null);
    } catch (e) { console.error('[Recent] failed', e); }
    finally { setLoading(false); }
  }
  async function clear() {
    try { await lensRun({ domain: 'atlas', action: 'recent-searches-clear', input: {} }); refresh(); }
    catch (e) { console.error('[Recent] clear', e); }
  }

  const topCategory = snapshot ? Object.entries(snapshot.byCategory).sort((a, b) => b[1] - a[1])[0] : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-200">Recent searches</span>
        <span className="text-[10px] text-gray-400">{recent.length}</span>
        {recent.length > 0 && <button onClick={clear} className="ml-auto text-[10px] text-rose-300 hover:text-rose-200">Clear</button>}
      </header>
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 p-2 border-b border-white/10 text-center">
          <SnapshotStat label="Places" value={snapshot.placeCount} />
          <SnapshotStat label="Lists" value={snapshot.listCount} />
          <SnapshotStat label="Trips" value={snapshot.tripCount} />
          <SnapshotStat label="Trip stops" value={snapshot.totalStops} />
          <SnapshotStat label="Offline areas" value={snapshot.offlineAreaCount} />
          <SnapshotStat label="Top category" value={topCategory ? `${CAT_EMOJI[topCategory[0]] || ''} ${topCategory[0]}` : '—'} small />
          {snapshot.navActive && (
            <div className="col-span-3 mt-0.5 rounded bg-violet-500/15 border border-violet-500/30 px-2 py-1 text-[10px] text-violet-200">Navigation session active</div>
          )}
        </div>
      )}
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

function SnapshotStat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 px-1.5 py-1">
      <div className={cn('font-mono text-white', small ? 'text-[10px] truncate' : 'text-xs')}>{value}</div>
      <div className="text-[9px] text-gray-400">{label}</div>
    </div>
  );
}

export default AtlasSection;
