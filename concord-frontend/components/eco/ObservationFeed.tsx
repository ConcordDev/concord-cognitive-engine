'use client';

import { useCallback, useMemo, useState } from 'react';
import { Bird, Loader2, MapPin, Search, Crosshair } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';

interface CommunityObservation {
  key: string;
  commonName: string;
  scientificName: string;
  kingdom: string | null;
  lat: number;
  lng: number;
  country: string | null;
  observedAt: string | null;
  basisOfRecord: string | null;
  datasetName: string | null;
}

interface FeedResult {
  observations: CommunityObservation[];
  total: number;
  center: { lat: number; lng: number };
  radiusKm: number;
  taxonFilter: string | null;
  source: string;
}

const KINGDOM_TONE: Record<string, MapMarker['tone']> = {
  Animalia: 'info',
  Plantae: 'good',
  Fungi: 'warn',
};

export function ObservationFeed() {
  const [lat, setLat] = useState('37.7749');
  const [lng, setLng] = useState('-122.4194');
  const [radiusKm, setRadiusKm] = useState('25');
  const [taxonName, setTaxonName] = useState('');
  const [data, setData] = useState<FeedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!isFinite(latN) || !isFinite(lngN)) {
      setError('Enter valid coordinates.');
      return;
    }
    setLoading(true);
    setError(null);
    const r = await lensRun<FeedResult>('eco', 'observation-feed', {
      lat: latN,
      lng: lngN,
      radiusKm: Number(radiusKm) || 25,
      limit: 80,
      taxonName: taxonName.trim(),
    });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
    } else {
      setError(r.data?.error || 'Could not load community observations.');
      setData(null);
    }
    setLoading(false);
  }, [lat, lng, radiusKm, taxonName]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLng(pos.coords.longitude.toFixed(4));
      },
      () => setError('Could not read your location.'),
    );
  }, []);

  const markers: MapMarker[] = useMemo(
    () =>
      (data?.observations || []).map((o) => ({
        id: o.key,
        lat: o.lat,
        lon: o.lng,
        label: `${o.commonName} (${o.scientificName})`,
        tone: KINGDOM_TONE[o.kingdom || ''] || 'default',
      })),
    [data],
  );

  const selectedObs = data?.observations.find((o) => o.key === selected) || null;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Bird className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Community sightings
        </span>
        {data && (
          <span className="ml-auto text-[10px] text-gray-400">
            {data.observations.length} shown · {data.total.toLocaleString()} records
          </span>
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Latitude</span>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Longitude</span>
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Radius (km)</span>
            <input
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-400 uppercase">Taxon filter</span>
            <input
              value={taxonName}
              onChange={(e) => setTaxonName(e.target.value)}
              placeholder="optional"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-sm focus:outline-none focus:border-green-500/50"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Load sightings
          </button>
          <button
            onClick={useMyLocation}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/[0.04] border border-white/10 text-gray-300 text-sm hover:bg-white/[0.08]"
          >
            <Crosshair className="w-4 h-4" /> My location
          </button>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        {!data && !loading && !error && (
          <p className="py-8 text-center text-xs text-gray-400">
            No data yet. Set a location and load nearby species sightings from GBIF.
          </p>
        )}

        {data && (
          <>
            <MapView markers={markers} height={280} onSelect={(m) => setSelected(m.id)} />
            {selectedObs && (
              <div className="rounded border border-green-500/30 bg-green-500/[0.06] p-3 text-xs">
                <div className="text-sm text-white">{selectedObs.commonName}</div>
                <div className="italic text-gray-400">{selectedObs.scientificName}</div>
                <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-gray-400">
                  {selectedObs.kingdom && <span>{selectedObs.kingdom}</span>}
                  {selectedObs.country && <span>{selectedObs.country}</span>}
                  {selectedObs.observedAt && (
                    <span>{new Date(selectedObs.observedAt).toLocaleDateString()}</span>
                  )}
                  {selectedObs.basisOfRecord && <span>{selectedObs.basisOfRecord}</span>}
                </div>
              </div>
            )}
            <div className="max-h-72 overflow-y-auto rounded border border-white/5 divide-y divide-white/5">
              {data.observations.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-400">
                  No sightings in this area yet.
                </p>
              ) : (
                data.observations.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setSelected(o.key)}
                    className={`w-full text-left px-3 py-2 hover:bg-white/[0.03] ${
                      selected === o.key ? 'bg-green-500/[0.08]' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{o.commonName}</div>
                        <div className="text-[11px] italic text-gray-400 truncate">
                          {o.scientificName}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {o.lat.toFixed(3)}, {o.lng.toFixed(3)}
                          {o.observedAt ? ` · ${new Date(o.observedAt).toLocaleDateString()}` : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <p className="text-[10px] text-gray-400">Source: {data.source}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default ObservationFeed;
