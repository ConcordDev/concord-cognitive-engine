'use client';

/**
 * PlaceFinder — bespoke OSM Nominatim + Overpass place-lookup surface
 * for the atlas lens. Backed by atlas.nominatim-geocode (debounced
 * typeahead) + atlas.overpass-poi (POI bbox query).
 *
 * Per category-leader UX research against OpenStreetMap, Google Maps,
 * Apple Maps, MapQuest, AllTrails, Komoot:
 *
 *   • Search box with 250ms debounce + suggestion list
 *   • Category chip shortcuts (coffee / restaurant / fuel / atm / hotel)
 *     that trigger overpass-poi with the geocoded place as bbox
 *   • Pure-SVG viewport (no tile lib) with equirectangular projection
 *     scoped to the result's bounding box — paddings auto-computed
 *   • Hover-brush sync between the result list and SVG markers
 *   • Save-as-DTU on each place with source: "openstreetmap"
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Search, Loader2, MapPin, Coffee, Utensils, Fuel, Hotel, ParkingCircle,
  ExternalLink,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Place {
  osmType?: string; osmId?: number; placeId?: number;
  displayName: string;
  latitude: number; longitude: number;
  category?: string; type?: string;
  importance?: number;
  boundingBox?: number[]; // [south, north, west, east]
  address?: Record<string, string>;
}

interface Poi {
  type: string; id: number;
  latitude: number; longitude: number;
  name?: string;
  amenity?: string;
  cuisine?: string;
  opening_hours?: string;
  phone?: string;
  website?: string;
  tags?: Record<string, string>;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('atlas', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const CATEGORIES = [
  { id: 'cafe', label: 'Cafés', icon: Coffee },
  { id: 'restaurant', label: 'Restaurants', icon: Utensils },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'hotel', label: 'Hotels', icon: Hotel },
  { id: 'parking', label: 'Parking', icon: ParkingCircle },
];

export function PlaceFinder() {
  const [queryInput, setQueryInput] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [activeAmenity, setActiveAmenity] = useState<string | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [focusPlace, setFocusPlace] = useState<Place | null>(null);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const geocodeMutation = useMutation({
    mutationFn: async (q: string) => callMacro<{ places: Place[] }>('nominatim-geocode', { query: q, limit: 5 }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setPlaces(env.result.places); setErrorMsg(null); }
      else { setPlaces([]); setErrorMsg(env.error || 'No matches'); }
    },
  });

  const poiMutation = useMutation({
    mutationFn: async (params: { south: number; west: number; north: number; east: number; amenity: string }) =>
      callMacro<{ elements: Poi[] }>('overpass-poi', params),
    onSuccess: (env) => {
      if (env.ok && env.result) setPois(env.result.elements);
      else setPois([]);
    },
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (queryInput.trim().length < 2) { setPlaces([]); return; }
    debounceRef.current = setTimeout(() => geocodeMutation.mutate(queryInput.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [queryInput]);

  const runCategory = (amenity: string) => {
    if (!focusPlace?.boundingBox || focusPlace.boundingBox.length !== 4) return;
    const [south, north, west, east] = focusPlace.boundingBox;
    setActiveAmenity(amenity);
    poiMutation.mutate({ south, west, north, east, amenity });
  };

  const bbox = useMemo(() => {
    if (focusPlace?.boundingBox && focusPlace.boundingBox.length === 4) {
      const [south, north, west, east] = focusPlace.boundingBox;
      return { south, west, north, east };
    }
    return null;
  }, [focusPlace]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Place Finder</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            osm nominatim · overpass
          </span>
        </div>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Address or place — '1600 Pennsylvania Ave NW', 'Eiffel Tower', 'Marrakech'…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
      </div>

      {errorMsg && places.length === 0 && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{errorMsg}</div>
      )}

      {places.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Matches</div>
          {places.map((p) => (
            <button
              key={`${p.osmType}-${p.osmId}-${p.placeId}`}
              type="button"
              onClick={() => { setFocusPlace(p); setPois([]); setActiveAmenity(null); }}
              className={`block w-full rounded-md border p-2 text-left transition-colors ${
                focusPlace?.placeId === p.placeId
                  ? 'border-cyan-500/40 bg-cyan-500/10'
                  : 'border-zinc-800 bg-zinc-950/40 hover:border-cyan-500/30'
              }`}
            >
              <div className="line-clamp-1 text-sm text-white">{p.displayName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                <span className="rounded bg-zinc-800 px-1.5 font-mono">{p.type || p.category}</span>
                <span className="font-mono">{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {focusPlace && (
        <>
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-zinc-500">Focused place</div>
                <div className="text-sm font-semibold text-white">{focusPlace.displayName}</div>
              </div>
              <SaveAsDtuButton
                compact
                apiSource="openstreetmap"
                apiUrl={`https://www.openstreetmap.org/${focusPlace.osmType}/${focusPlace.osmId}`}
                title={focusPlace.displayName.split(',').slice(0, 2).join(',')}
                content={[
                  `Place: ${focusPlace.displayName}`,
                  `Category: ${focusPlace.category || '—'}`,
                  `Type: ${focusPlace.type || '—'}`,
                  `Coordinates: ${focusPlace.latitude}, ${focusPlace.longitude}`,
                  focusPlace.address ? `Country: ${focusPlace.address.country || '—'}` : '',
                  focusPlace.address ? `Region: ${focusPlace.address.state || focusPlace.address.region || '—'}` : '',
                  `OSM: ${focusPlace.osmType}/${focusPlace.osmId}`,
                ].filter(Boolean).join('\n')}
                extraTags={['atlas', 'place', focusPlace.category || 'osm', focusPlace.type || '']}
                rawData={focusPlace}
              />
            </div>
            {/* Category chip strip */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => runCategory(c.id)}
                  disabled={!focusPlace.boundingBox}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-50 ${
                    activeAmenity === c.id
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-cyan-500/30'
                  }`}
                >
                  <c.icon className="h-3 w-3" />
                  {c.label}
                </button>
              ))}
              {poiMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Map bbox={bbox} focusPlace={focusPlace} pois={pois} hoverItem={hoverItem} />
            </div>
            <div className="space-y-1 max-h-[28rem] overflow-y-auto">
              {pois.length === 0 ? (
                <div className="rounded border border-dashed border-zinc-800 bg-zinc-950/40 p-3 text-center text-[11px] text-zinc-500">
                  {activeAmenity ? 'No POIs in this bbox.' : 'Pick a category above to query OSM POIs in this area.'}
                </div>
              ) : (
                pois.map((p) => (
                  <button
                    key={`poi-${p.type}-${p.id}`}
                    type="button"
                    onMouseEnter={() => setHoverItem(`${p.type}-${p.id}`)}
                    onMouseLeave={() => setHoverItem(null)}
                    className="block w-full rounded border border-zinc-800 bg-zinc-950/40 p-2 text-left transition-colors hover:border-cyan-500/30"
                  >
                    <div className="flex items-center gap-2 text-xs text-white">
                      <MapPin className="h-3 w-3 shrink-0 text-cyan-400" />
                      <span className="truncate">{p.name || `(${p.amenity})`}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-zinc-500">
                      {p.cuisine && <span>{p.cuisine}</span>}
                      {p.opening_hours && <span>{p.opening_hours}</span>}
                      {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline"><ExternalLink className="inline h-2.5 w-2.5" /> site</a>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Map({ bbox, focusPlace, pois, hoverItem }: {
  bbox: { south: number; west: number; north: number; east: number } | null;
  focusPlace: Place | null;
  pois: Poi[];
  hoverItem: string | null;
}) {
  if (!bbox || !focusPlace) return null;
  const pad = 0.05;
  const padW = (bbox.east - bbox.west) * pad;
  const padH = (bbox.north - bbox.south) * pad;
  const w = bbox.east - bbox.west + padW * 2;
  const h = bbox.north - bbox.south + padH * 2;
  const project = (lat: number, lng: number) => ({
    x: ((lng - (bbox.west - padW)) / w) * 800,
    y: ((bbox.north + padH - lat) / h) * 600,
  });
  const center = project(focusPlace.latitude, focusPlace.longitude);
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950" style={{ aspectRatio: '4 / 3' }}>
      <svg viewBox="0 0 800 600" className="h-full w-full">
        <defs>
          <pattern id="atlas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#27272a" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill="url(#atlas-grid)" />

        {/* Focus pin */}
        <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.2 }}>
          <circle cx={center.x} cy={center.y} r="14" fill="#22d3ee" opacity="0.2" />
          <circle cx={center.x} cy={center.y} r="5" fill="#22d3ee" />
        </motion.g>

        {/* POI pins */}
        {pois.map((p) => {
          if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
          const pt = project(p.latitude, p.longitude);
          const key = `${p.type}-${p.id}`;
          const hover = hoverItem === key;
          return (
            <motion.g key={key} animate={{ scale: hover ? 1.4 : 1 }}>
              <circle cx={pt.x} cy={pt.y} r="4" fill={hover ? '#fbbf24' : '#a855f7'} opacity="0.85" stroke="#0a0a0a" strokeWidth="0.5" />
              {hover && p.name && (
                <text x={pt.x + 8} y={pt.y - 6} fill="#e4e4e7" fontSize="10" fontFamily="monospace">
                  {p.name.length > 30 ? p.name.slice(0, 30) + '…' : p.name}
                </text>
              )}
            </motion.g>
          );
        })}

        {/* BBox outline */}
        <rect
          x={((bbox.west - (bbox.west - padW)) / w) * 800}
          y={((bbox.north + padH - bbox.north) / h) * 600}
          width={((bbox.east - bbox.west) / w) * 800}
          height={((bbox.north - bbox.south) / h) * 600}
          fill="none"
          stroke="#22d3ee"
          strokeOpacity="0.3"
          strokeDasharray="4 4"
        />
      </svg>
    </div>
  );
}
