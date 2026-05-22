'use client';

/**
 * RestaurantMap — geo restaurant discovery on a map (food.biz-map). Same
 * filters as biz-search plus distance sort from the browser's geolocation
 * and a directions link per business. Markers are real businesses with
 * lat/lng; no sample data.
 */

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Loader2, Navigation, Star, Crosshair } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';
import { cn } from '@/lib/utils';

interface BizMarker {
  id: string;
  name: string;
  cuisine: string;
  priceTier: number;
  neighborhood: string | null;
  address: string | null;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  distanceKm: number | null;
  directionsUrl: string;
}

interface BizMapResult {
  markers: BizMarker[];
  count: number;
  withoutGeo: number;
}

export function RestaurantMap() {
  const [markers, setMarkers] = useState<BizMarker[]>([]);
  const [withoutGeo, setWithoutGeo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  // filters
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [priceTier, setPriceTier] = useState('');
  const [minRating, setMinRating] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<BizMapResult>('food', 'biz-map', {
        query: query.trim(),
        cuisine: cuisine.trim(),
        ...(priceTier ? { priceTier: Number(priceTier) } : {}),
        minRating: Number(minRating) || 0,
        ...(origin ? { originLat: origin.lat, originLng: origin.lng } : {}),
      });
      if (r.data?.ok && r.data.result) {
        setMarkers(r.data.result.markers || []);
        setWithoutGeo(r.data.result.withoutGeo || 0);
      }
    } catch (e) {
      console.error('[RestaurantMap] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [query, cuisine, priceTier, minRating, origin]);

  useEffect(() => { load(); }, [load]);

  function locate() {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  const mapMarkers: MapMarker[] = markers.map((m) => ({
    id: m.id,
    lat: m.lat,
    lon: m.lng,
    label: m.name,
    tone: m.rating >= 4 ? 'good' : m.rating >= 3 ? 'info' : 'warn',
  }));

  const selectedBiz = markers.find((m) => m.id === selected) || null;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Restaurant Map</span>
        <span className="ml-auto text-[10px] text-gray-500">
          {markers.length} on map{withoutGeo > 0 ? ` · ${withoutGeo} without location` : ''}
        </span>
      </header>

      <div className="p-3 space-y-3">
        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={cuisine} onChange={(e) => setCuisine(e.target.value)} placeholder="Cuisine" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={priceTier} onChange={(e) => setPriceTier(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Any price</option>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{'$'.repeat(p)}</option>)}
          </select>
          <select value={minRating} onChange={(e) => setMinRating(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            {[0, 3, 3.5, 4, 4.5].map((r) => <option key={r} value={r}>{r === 0 ? 'Any rating' : `${r}+ stars`}</option>)}
          </select>
          <button
            onClick={locate}
            disabled={locating}
            className={cn('px-2 py-1.5 rounded flex items-center justify-center gap-1 font-semibold',
              origin ? 'bg-green-500/20 text-green-300' : 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30')}
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
            {origin ? 'Located' : 'Near me'}
          </button>
        </div>

        {/* Map */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading map…</div>
        ) : markers.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500">
            <MapPin className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No restaurants with map locations yet. Add a business with latitude/longitude in the Discover tab.
          </div>
        ) : (
          <>
            <MapView markers={mapMarkers} height={280} onSelect={(m) => setSelected(m.id)} />

            {/* Selected restaurant card */}
            {selectedBiz && (
              <div className="bg-lattice-deep border border-cyan-500/30 rounded p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{selectedBiz.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {selectedBiz.cuisine} · {'$'.repeat(selectedBiz.priceTier)}
                      {selectedBiz.neighborhood ? ` · ${selectedBiz.neighborhood}` : ''}
                    </div>
                    {selectedBiz.address && <div className="text-[10px] text-gray-600 mt-0.5">{selectedBiz.address}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-0.5 text-yellow-400 text-xs">
                      <Star className="w-3.5 h-3.5 fill-yellow-400" /> {selectedBiz.rating || '—'}
                    </div>
                    <div className="text-[9px] text-gray-600">{selectedBiz.reviewCount} reviews</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {selectedBiz.distanceKm != null && (
                    <span className="text-[10px] text-cyan-300">{selectedBiz.distanceKm} km away</span>
                  )}
                  <a
                    href={selectedBiz.directionsUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto px-2 py-1 rounded bg-cyan-500 text-black text-[10px] font-bold hover:bg-cyan-400 flex items-center gap-1"
                  >
                    <Navigation className="w-3 h-3" /> Directions
                  </a>
                </div>
              </div>
            )}

            {/* Ranked list */}
            <ul className="divide-y divide-white/5 max-h-56 overflow-y-auto">
              {markers.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setSelected(m.id)}
                    className={cn('w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-white/[0.03]',
                      selected === m.id && 'bg-cyan-500/10')}
                  >
                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate">{m.name}</div>
                      <div className="text-[10px] text-gray-500">{m.cuisine} · {'$'.repeat(m.priceTier)}</div>
                    </div>
                    {m.distanceKm != null && <span className="text-[10px] text-cyan-300">{m.distanceKm} km</span>}
                    <span className="flex items-center gap-0.5 text-[10px] text-yellow-400">
                      <Star className="w-3 h-3 fill-yellow-400" />{m.rating || '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

export default RestaurantMap;
