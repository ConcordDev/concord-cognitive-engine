'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { Map as MapIcon, Loader2, Search, BedDouble, Bath, Maximize2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { Listing } from './ListingsBrowser';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface BoundListing extends Listing {
  lat: number | null;
  lng: number | null;
}
interface Bounds {
  north: string;
  south: string;
  east: string;
  west: string;
}

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function MapAreaSearch({ onSelect }: { onSelect?: (l: Listing) => void }) {
  const [bounds, setBounds] = useState<Bounds>({ north: '', south: '', east: '', west: '' });
  const [filters, setFilters] = useState({ minPrice: '', maxPrice: '', minBeds: '' });
  const [results, setResults] = useState<BoundListing[] | null>(null);
  const [withoutCoords, setWithoutCoords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    const n = Number(bounds.north), s = Number(bounds.south), e = Number(bounds.east), w = Number(bounds.west);
    if (![n, s, e, w].every(Number.isFinite) || !bounds.north || !bounds.south || !bounds.east || !bounds.west) {
      setError('Enter all four boundary coordinates.');
      return;
    }
    if (n <= s) { setError('North latitude must be greater than south.'); return; }
    setLoading(true);
    setError(null);
    try {
      const inp: Record<string, unknown> = { bounds: { north: n, south: s, east: e, west: w } };
      const f: Record<string, number> = {};
      if (filters.minPrice) f.minPrice = Number(filters.minPrice);
      if (filters.maxPrice) f.maxPrice = Number(filters.maxPrice);
      if (filters.minBeds) f.minBeds = Number(filters.minBeds);
      if (Object.keys(f).length > 0) inp.filters = f;
      const r = await lensRun({ domain: 'realestate', action: 'listings-in-bounds', input: inp });
      if (r.data?.ok) {
        setResults((r.data.result?.listings as BoundListing[]) || []);
        setWithoutCoords(Number(r.data.result?.withoutCoords) || 0);
      } else {
        setError(r.data?.error || 'Search failed.');
      }
    } catch (err) {
      console.error('[MapAreaSearch] failed', err);
      setError('Search failed.');
    } finally {
      setLoading(false);
    }
  }, [bounds, filters]);

  const useCurrentView = () => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        const d = 0.15;
        setBounds({
          north: (latitude + d).toFixed(4),
          south: (latitude - d).toFixed(4),
          east: (longitude + d).toFixed(4),
          west: (longitude - d).toFixed(4),
        });
      }, () => setError('Geolocation unavailable — enter coordinates manually.'));
    } else {
      setError('Geolocation unavailable — enter coordinates manually.');
    }
  };

  const markers = (results || [])
    .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
    .map((l) => ({
      lat: Number(l.lat),
      lng: Number(l.lng),
      label: fmtPrice(l.price),
      popup: `<div style="font-weight:600">${fmtPrice(l.price)}</div><div style="font-size:11px;color:#666">${l.address}</div><div style="font-size:10px;color:#888">${l.beds}bd · ${l.baths}ba · ${l.sqft.toLocaleString()} sqft</div>`,
    }));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapIcon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Map area search</span>
        <span className="ml-auto text-[10px] text-gray-400">draw-area / bounding box</span>
      </header>

      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-4 gap-2 text-xs">
          <label className="space-y-1"><span className="text-gray-400">North lat</span><input type="number" step="0.0001" value={bounds.north} onChange={(e) => setBounds({ ...bounds, north: e.target.value })} placeholder="31.0" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
          <label className="space-y-1"><span className="text-gray-400">South lat</span><input type="number" step="0.0001" value={bounds.south} onChange={(e) => setBounds({ ...bounds, south: e.target.value })} placeholder="29.0" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
          <label className="space-y-1"><span className="text-gray-400">East lng</span><input type="number" step="0.0001" value={bounds.east} onChange={(e) => setBounds({ ...bounds, east: e.target.value })} placeholder="-96.0" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
          <label className="space-y-1"><span className="text-gray-400">West lng</span><input type="number" step="0.0001" value={bounds.west} onChange={(e) => setBounds({ ...bounds, west: e.target.value })} placeholder="-99.0" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          <input type="number" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} placeholder="Min $" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} placeholder="Max $" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={filters.minBeds} onChange={(e) => setFilters({ ...filters, minBeds: e.target.value })} placeholder="Min beds" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={useCurrentView} className="px-2 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10">Use my area</button>
        </div>
        <button onClick={search} disabled={loading} className="w-full px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search this area
        </button>
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </div>

      {markers.length > 0 && (
        <div className="h-72 border-b border-white/10 overflow-hidden">
          <MapView center={[markers[0].lat, markers[0].lng]} zoom={11} markers={markers} />
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        {results === null ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">Set a bounding box and search to find listings on the map.</div>
        ) : results.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No listings in this area yet.{withoutCoords > 0 ? ` ${withoutCoords} listing(s) have no coordinates.` : ''}</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {results.map((l) => (
              <li key={l.id} className="px-3 py-2.5 hover:bg-white/[0.03] flex items-center gap-3 cursor-pointer" onClick={() => onSelect?.(l)}>
                <span className="text-sm font-mono font-semibold text-white w-20">{fmtPrice(l.price)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate">{l.address}</div>
                  <div className="text-[10px] text-gray-400">{l.city}{l.state ? `, ${l.state}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="inline-flex items-center gap-0.5"><BedDouble className="w-3 h-3" />{l.beds}</span>
                  <span className="inline-flex items-center gap-0.5"><Bath className="w-3 h-3" />{l.baths}</span>
                  <span className="inline-flex items-center gap-0.5"><Maximize2 className="w-3 h-3" />{l.sqft.toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {results !== null && withoutCoords > 0 && results.length > 0 && (
          <p className="px-3 py-1.5 text-[10px] text-gray-400">{withoutCoords} listing(s) excluded — no coordinates.</p>
        )}
      </div>
    </div>
  );
}

export default MapAreaSearch;
