'use client';

/**
 * BatchGeocodeTool — batch place resolver + bearing/distance calculator
 * for the atlas lens's Tools tab. Wires the previously-UNSURFACED
 * `atlas.geocode` macro: resolves a list of place names against ~20
 * built-in reference-city coordinates (or caller-supplied lat/lon),
 * then computes hemisphere, estimated UTC offset, and — when an origin
 * is set — distance + compass bearing from that origin.
 *
 * Distinct from the live `atlas.nominatim-geocode` search used
 * elsewhere in this lens (Explore, Directions): this tool is a fast,
 * offline batch calculator over a small reference set, not a live web
 * lookup — useful for "compare these 5 named cities" without 5 network
 * round-trips. Both are real; they serve different jobs.
 *
 * Backend: atlas.geocode — pure computation, no external I/O.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Compass, Loader2, MapPinned } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { StructuredArrayEditor, type ColumnSpec } from '@/components/panel-polish';

interface PlaceRow { name: string; lat: number | ''; lon: number | '' }

interface ResolvedPlace {
  name: string;
  resolved: boolean;
  message?: string;
  lat?: number;
  lon?: number;
  source?: string;
  hemisphere?: string;
  estimatedUTCOffset?: number;
  distanceFromOriginKm?: number;
  bearingFromOrigin?: number;
  directionFromOrigin?: string;
}

interface GeocodeResult {
  count: number;
  resolvedCount: number;
  unresolvedCount: number;
  resolved: ResolvedPlace[];
  nearestToOrigin: string | null;
  farthestFromOrigin: string | null;
}

const COLS: ColumnSpec<PlaceRow>[] = [
  { key: 'name', label: 'Place name', type: 'text', flex: 2, placeholder: 'e.g. Tokyo, or any name if you supply lat/lon' },
  { key: 'lat', label: 'Lat (optional)', type: 'number', width: '7rem', step: 0.0001 },
  { key: 'lon', label: 'Lon (optional)', type: 'number', width: '7rem', step: 0.0001 },
];

export function BatchGeocodeTool() {
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [originLat, setOriginLat] = useState('');
  const [originLon, setOriginLon] = useState('');

  const compute = useMutation({
    mutationFn: async () => {
      const valid = places.filter((p) => p.name.trim());
      if (valid.length === 0) return null;
      const origin = originLat.trim() && originLon.trim() && Number.isFinite(Number(originLat)) && Number.isFinite(Number(originLon))
        ? { lat: Number(originLat), lon: Number(originLon) }
        : undefined;
      const r = await apiHelpers.lens.runDomain('atlas', 'geocode', {
        input: { artifact: { data: { places: valid.map((p) => ({ name: p.name, lat: p.lat === '' ? undefined : p.lat, lon: p.lon === '' ? undefined : p.lon })), origin } },
      } });
      const env = (r as { data?: { ok: boolean; result?: { result?: GeocodeResult } & GeocodeResult } }).data;
      if (!env?.ok) return null;
      const raw = env.result;
      return (raw && 'result' in raw && raw.result ? raw.result : raw) as GeocodeResult | null;
    },
  });

  const result = compute.data;

  return (
    <div className="overflow-hidden rounded-xl border border-lattice-border bg-lattice-void">
      <div className="border-b border-lattice-border bg-lattice-surface/60 p-3">
        <div className="flex items-center gap-2">
          <MapPinned className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-semibold text-white">Batch geocode &amp; bearing</span>
          <span className="rounded bg-lattice-elevated px-1.5 py-0.5 font-mono tabular-nums text-[10px] uppercase tracking-wider text-gray-400">atlas.geocode</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">Resolve several named places at once (built-in reference cities, or your own lat/lon), then measure distance + bearing from an origin.</p>
      </div>

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input type="number" step="any" placeholder="Origin lat (optional)" value={originLat} onChange={(e) => setOriginLat(e.target.value)} className="rounded border border-lattice-border bg-lattice-void px-2 py-1.5 text-xs text-white placeholder:text-gray-400 focus:border-sky-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="Origin lon (optional)" value={originLon} onChange={(e) => setOriginLon(e.target.value)} className="rounded border border-lattice-border bg-lattice-void px-2 py-1.5 text-xs text-white placeholder:text-gray-400 focus:border-sky-500/40 focus:outline-none" />
        </div>
        <StructuredArrayEditor<PlaceRow>
          value={places}
          onChange={setPlaces}
          template={{ name: '', lat: '', lon: '' }}
          columns={COLS}
          accent="sky"
          maxRows={20}
          rowsOnly
        />
        <button
          type="button"
          onClick={() => compute.mutate()}
          disabled={compute.isPending || places.filter((p) => p.name.trim()).length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Compass className="h-3.5 w-3.5" />}
          Resolve
        </button>

        {compute.isError && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Batch geocode failed.</div>}
        {!result && !compute.isPending && (
          <div className="rounded border border-dashed border-lattice-border p-6 text-center text-[11px] text-gray-400">
            No data yet. Add place names above (city names from the built-in reference set resolve without lat/lon).
          </div>
        )}
        {result && (
          <div className="space-y-2">
            <div className="text-[11px] text-gray-400">{result.resolvedCount} resolved · {result.unresolvedCount} unresolved{result.nearestToOrigin ? ` · nearest: ${result.nearestToOrigin}` : ''}{result.farthestFromOrigin ? ` · farthest: ${result.farthestFromOrigin}` : ''}</div>
            {result.resolved.map((p, i) => (
              <div key={i} className={`rounded border px-2.5 py-1.5 text-[11px] ${p.resolved ? 'border-lattice-border bg-lattice-surface/40' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
                {p.resolved ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <span className="text-gray-100">{p.name}</span>
                    <span className="font-mono tabular-nums text-gray-400">{p.lat?.toFixed(3)}, {p.lon?.toFixed(3)} · {p.hemisphere} · UTC{(p.estimatedUTCOffset ?? 0) >= 0 ? '+' : ''}{p.estimatedUTCOffset}</span>
                    {p.distanceFromOriginKm !== undefined && (
                      <span className="font-mono tabular-nums text-sky-300">{p.distanceFromOriginKm} km {p.directionFromOrigin}</span>
                    )}
                  </div>
                ) : (
                  <span>{p.message}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
