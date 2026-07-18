'use client';

// SpatialQueryForm — Wave 4 gap-closure (docs/lens-specs/atlas-capability-map.md
// §1c `query`). The ad-hoc power-user spatial query surface into
// server/lib/foundation-atlas.js#executeSpatialQuery (macro `atlas.query`,
// `POST /api/atlas/query`). That function dispatches on `query.type` — the
// switch's six cases (point / area / radius / material / subsurface / changes)
// are the real, authoritative type list (its `default:` branch echoes the
// same six back as `validTypes`); this form mirrors it exactly rather than
// inventing its own list. Each type drives a distinct real field set matching
// what the dispatched retrieval function actually reads:
//   point       -> getTile(coordinates)                  { lat, lng }
//   material    -> getMaterialAtPoint(coordinates)        { lat, lng }
//   radius      -> getVolume(bounds-from-coords+radius)   { lat, lng, radius_m }
//   area        -> getVolume(bounds)                      { lat_min, lat_max, lng_min, lng_max }
//   subsurface  -> getSubsurface(bounds)                  { lat_min, lat_max, lng_min, lng_max }
//   changes     -> getChanges(bounds, since, limit)       { bounds? (optional), since? (optional), limit? (optional) }
//
// This deployment's substrate is structurally empty (no mesh signal-ingestion
// pipeline wired — see the disclosure banner in app/lenses/atlas/page.tsx), so
// a well-formed query will honestly return zero tiles/changes rather than
// fabricated results. That is the correct, expected behavior — never invent
// a result to look less empty.

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle, CheckCircle2, MapPin, Info } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

type QueryType = 'point' | 'area' | 'radius' | 'material' | 'subsurface' | 'changes';

const QUERY_TYPES: { id: QueryType; label: string }[] = [
  { id: 'point', label: 'Point (tile lookup)' },
  { id: 'area', label: 'Area (volume)' },
  { id: 'radius', label: 'Radius' },
  { id: 'material', label: 'Material at point' },
  { id: 'subsurface', label: 'Subsurface (area)' },
  { id: 'changes', label: 'Changes over time' },
];

interface MapTile {
  id: string;
  coordinates?: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
  confidence?: number;
  resolution_cm?: number;
  layers?: Record<string, { dominantMaterial?: string }>;
}

interface ChangeRecord {
  id: string;
  type?: string;
  magnitude?: number;
  detectedAt?: string;
  confidence?: number;
}

interface SpatialQueryResult {
  ok: boolean;
  error?: string;
  message?: string;
  validTypes?: string[];
  // point
  tile?: MapTile;
  coordinates?: { lat: number; lng: number };
  // material
  material?: string;
  confidence?: number;
  resolution_cm?: number;
  // area / radius / subsurface
  tier?: string;
  tileCount?: number;
  tiles?: MapTile[];
  // changes
  count?: number;
  total?: number;
  changes?: ChangeRecord[];
}

const inputCls = 'bg-lattice-surface border border-lattice-border rounded px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-purple-500/60';

const FIELD_SETS: Record<QueryType, { point: boolean; bounds: boolean; radius: boolean; changesExtra: boolean }> = {
  point: { point: true, bounds: false, radius: false, changesExtra: false },
  material: { point: true, bounds: false, radius: false, changesExtra: false },
  radius: { point: true, bounds: false, radius: true, changesExtra: false },
  area: { point: false, bounds: true, radius: false, changesExtra: false },
  subsurface: { point: false, bounds: true, radius: false, changesExtra: false },
  changes: { point: false, bounds: true, radius: false, changesExtra: true },
};

export function SpatialQueryForm() {
  const [type, setType] = useState<QueryType>('point');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radiusM, setRadiusM] = useState('');
  const [latMin, setLatMin] = useState('');
  const [latMax, setLatMax] = useState('');
  const [lngMin, setLngMin] = useState('');
  const [lngMax, setLngMax] = useState('');
  const [since, setSince] = useState('');
  const [limit, setLimit] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SpatialQueryResult | null>(null);
  const [lastType, setLastType] = useState<QueryType | null>(null);

  const fields = FIELD_SETS[type];

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const r = await apiHelpers.atlasTomography.query(payload);
      return r.data as SpatialQueryResult;
    },
    onSuccess: (data) => {
      setLastResult(data);
      setLastType(type);
      if (!data?.ok) {
        setFormError(null); // honest ok:false is not a form-validation error — render it as a result
      }
    },
    onError: () => {
      setFormError('Could not reach the atlas. Try again.');
      setLastResult(null);
      setLastType(null);
    },
  });

  function validCoord(latStr: string, lngStr: string): string | null {
    const latNum = Number(latStr);
    const lngNum = Number(lngStr);
    if (!latStr.trim() || !lngStr.trim() || !Number.isFinite(latNum) || !Number.isFinite(lngNum) ||
        latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return 'Latitude and longitude are required and must be valid coordinates.';
    }
    return null;
  }

  function validBounds(): string | null {
    const values = [latMin, latMax, lngMin, lngMax];
    if (values.some((v) => !v.trim())) {
      return 'lat_min, lat_max, lng_min, and lng_max are all required for this query type.';
    }
    const [a, b, c, d] = values.map(Number);
    if (![a, b, c, d].every(Number.isFinite)) {
      return 'Bounds must be valid numbers.';
    }
    if (a > b) return 'lat_min must be less than or equal to lat_max.';
    if (c > d) return 'lng_min must be less than or equal to lng_max.';
    return null;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setLastResult(null);
    setLastType(null);

    let payload: Record<string, unknown>;

    if (type === 'point' || type === 'material') {
      const err = validCoord(lat, lng);
      if (err) { setFormError(err); return; }
      payload = { type, coordinates: { lat: Number(lat), lng: Number(lng) } };
    } else if (type === 'radius') {
      const err = validCoord(lat, lng);
      if (err) { setFormError(err); return; }
      const radiusNum = Number(radiusM);
      if (!radiusM.trim() || !Number.isFinite(radiusNum) || radiusNum <= 0) {
        setFormError('Radius (m) must be a positive number.');
        return;
      }
      payload = { type, coordinates: { lat: Number(lat), lng: Number(lng) }, radius_m: radiusNum };
    } else if (type === 'area' || type === 'subsurface') {
      const err = validBounds();
      if (err) { setFormError(err); return; }
      payload = {
        type,
        bounds: { lat_min: Number(latMin), lat_max: Number(latMax), lng_min: Number(lngMin), lng_max: Number(lngMax) },
      };
    } else {
      // changes — every field is optional
      const anyBound = [latMin, latMax, lngMin, lngMax].some((v) => v.trim());
      let bounds: Record<string, number> | undefined;
      if (anyBound) {
        const err = validBounds();
        if (err) { setFormError(err); return; }
        bounds = { lat_min: Number(latMin), lat_max: Number(latMax), lng_min: Number(lngMin), lng_max: Number(lngMax) };
      }
      if (limit.trim() && (!Number.isFinite(Number(limit)) || Number(limit) <= 0)) {
        setFormError('Limit must be a positive number.');
        return;
      }
      payload = {
        type,
        ...(bounds ? { bounds } : {}),
        ...(since.trim() ? { since: since.trim() } : {}),
        ...(limit.trim() ? { limit: Number(limit) } : {}),
      };
    }

    setFormError(null);
    mutation.mutate(payload);
  }

  return (
    <div className="rounded-lg bg-lattice-elevated/50 border border-lattice-border/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search size={16} className="text-purple-400" />
        <span className="text-sm font-medium text-gray-200">Ad-hoc Spatial Query</span>
      </div>
      <p className="text-xs text-gray-500">
        Power-user query against the atlas substrate — point/area/radius tile lookups, material
        classification, subsurface detail, and change history. This deployment has no
        signal-ingestion pipeline wired yet, so a well-formed query correctly returns an honest
        empty result rather than fabricated data.
      </p>

      <form onSubmit={submit} className="space-y-2">
        <select
          value={type}
          onChange={(e) => { setType(e.target.value as QueryType); setFormError(null); setLastResult(null); setLastType(null); }}
          aria-label="Query type"
          className={inputCls}
        >
          {QUERY_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>

        {fields.point && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number" step="any" placeholder="Latitude *"
              value={lat} onChange={(e) => setLat(e.target.value)}
              className={inputCls}
            />
            <input
              type="number" step="any" placeholder="Longitude *"
              value={lng} onChange={(e) => setLng(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        {fields.radius && (
          <input
            type="number" step="any" min="0" placeholder="Radius (m) *"
            value={radiusM} onChange={(e) => setRadiusM(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        )}

        {fields.bounds && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number" step="any" placeholder={type === 'changes' ? 'lat_min (optional)' : 'lat_min *'}
              value={latMin} onChange={(e) => setLatMin(e.target.value)}
              className={inputCls}
            />
            <input
              type="number" step="any" placeholder={type === 'changes' ? 'lat_max (optional)' : 'lat_max *'}
              value={latMax} onChange={(e) => setLatMax(e.target.value)}
              className={inputCls}
            />
            <input
              type="number" step="any" placeholder={type === 'changes' ? 'lng_min (optional)' : 'lng_min *'}
              value={lngMin} onChange={(e) => setLngMin(e.target.value)}
              className={inputCls}
            />
            <input
              type="number" step="any" placeholder={type === 'changes' ? 'lng_max (optional)' : 'lng_max *'}
              value={lngMax} onChange={(e) => setLngMax(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        {fields.changesExtra && (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text" placeholder="Since (ISO date, optional)"
              value={since} onChange={(e) => setSince(e.target.value)}
              className={inputCls}
            />
            <input
              type="number" step="1" min="1" placeholder="Limit (default 50, max 200)"
              value={limit} onChange={(e) => setLimit(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full flex items-center justify-center gap-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-medium py-1.5 transition-colors"
        >
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Run query
        </button>
      </form>

      {formError && (
        <div role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
        </div>
      )}

      {lastResult && !formError && lastType && (
        <QueryResultPanel type={lastType} result={lastResult} />
      )}
    </div>
  );
}

function QueryResultPanel({ type, result }: { type: QueryType; result: SpatialQueryResult }) {
  if (!result.ok) {
    return (
      <div role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          {result.error || 'Query failed.'}
          {result.message ? ` — ${result.message}` : ''}
          {result.validTypes ? ` (valid types: ${result.validTypes.join(', ')})` : ''}
        </span>
      </div>
    );
  }

  // point / material — a single-location result
  if (type === 'point') {
    if (!result.tile) {
      return (
        <div role="status" className="flex items-center gap-1.5 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 shrink-0" /> No tile at these coordinates — an honestly empty lookup, not an error.
        </div>
      );
    }
    return (
      <div role="status" className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Tile {result.tile.id}
        </div>
        <p className="text-gray-400">
          Confidence {result.tile.confidence !== undefined ? `${Math.round(result.tile.confidence * 100)}%` : '--'}
          {result.tile.resolution_cm ? ` · ${result.tile.resolution_cm}cm resolution` : ''}
        </p>
      </div>
    );
  }

  if (type === 'material') {
    return (
      <div role="status" className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Material: {result.material || 'unknown'}
        {result.confidence !== undefined && ` · ${Math.round(result.confidence * 100)}% confidence`}
        {result.resolution_cm ? ` · ${result.resolution_cm}cm resolution` : ''}
      </div>
    );
  }

  // area / radius / subsurface — a tile list
  if (type === 'area' || type === 'radius' || type === 'subsurface') {
    const count = result.tileCount ?? result.tiles?.length ?? 0;
    if (count === 0) {
      return (
        <div role="status" className="flex items-center gap-1.5 text-xs text-gray-400">
          <Info className="w-3.5 h-3.5 shrink-0" /> No tiles found in this region — an honestly empty lookup, not an error.
        </div>
      );
    }
    return (
      <div role="status" className="space-y-1 text-xs">
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {count} tile{count === 1 ? '' : 's'} found{result.tier ? ` (tier: ${result.tier})` : ''}
        </div>
        <ul className="space-y-0.5 text-gray-400">
          {(result.tiles || []).slice(0, 5).map((t) => (
            <li key={t.id} className="flex items-center gap-1.5">
              <MapPin className="w-3 h-3 shrink-0 text-gray-600" /> {t.id}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // changes
  const count = result.count ?? result.changes?.length ?? 0;
  if (count === 0) {
    return (
      <div role="status" className="flex items-center gap-1.5 text-xs text-gray-400">
        <Info className="w-3.5 h-3.5 shrink-0" /> No changes recorded in this window — an honestly empty lookup, not an error.
      </div>
    );
  }
  return (
    <div role="status" className="space-y-1 text-xs">
      <div className="flex items-center gap-1.5 text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {count} of {result.total ?? count} change{count === 1 ? '' : 's'}
      </div>
      <ul className="space-y-0.5 text-gray-400">
        {(result.changes || []).slice(0, 5).map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <MapPin className="w-3 h-3 shrink-0 text-gray-600" /> {c.type || 'change'} — {c.detectedAt || 'unknown time'}
          </li>
        ))}
      </ul>
    </div>
  );
}
