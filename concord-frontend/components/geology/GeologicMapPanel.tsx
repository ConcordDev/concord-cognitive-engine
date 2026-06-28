'use client';

/**
 * GeologicMapPanel — bedrock geologic-map overlay + "rocks near me"
 * lookup. Wires geology.geologic-map and geology.rock-units-here, both
 * backed by the free, keyless Macrostrat API (the data behind Rockd's
 * geologic-map overlay). All values are live API data — no seeds.
 */

import { useCallback, useState } from 'react';
import { Layers, Crosshair, Loader2, Mountain } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface GeoUnit {
  mapId?: number;
  name: string;
  ageInterval: string | null;
  ageTop: number | null;
  ageBottom: number | null;
  lithology: string | null;
  description: string | null;
  color: string | null;
}
interface ColumnUnit {
  unitName: string;
  ageInterval: string | null;
  ageTop: number | null;
  ageBottom: number | null;
  lithology: string | null;
  maxThicknessM: number | null;
}

const SCALES = ['tiny', 'small', 'medium', 'large'] as const;
type Scale = (typeof SCALES)[number];

/** True when the transport succeeded AND the handler didn't reject (result.ok !== false). */
function r_ok(transportOk: boolean | undefined, inner: { ok?: boolean } | undefined): boolean {
  return !!transportOk && inner?.ok !== false;
}

export function GeologicMapPanel() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [scale, setScale] = useState<Scale>('medium');
  const [units, setUnits] = useState<GeoUnit[]>([]);
  const [column, setColumn] = useState<ColumnUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(5)); setLon(p.coords.longitude.toFixed(5)); },
      () => setError('Could not read GPS location'),
    );
  }, []);

  const lookup = useCallback(async () => {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) { setError('Enter valid coordinates'); return; }
    setLoading(true); setError(null);
    try {
      const [mapR, hereR] = await Promise.all([
        lensRun('geology', 'geologic-map', { lat: la, lon: lo, scale }),
        lensRun('geology', 'rock-units-here', { lat: la, lon: lo }),
      ]);
      // /api/lens/run unwraps one { ok, result } layer; a handler rejection
      // surfaces as result.ok === false (transport r.data.ok is always true).
      const mapInner = mapR.data?.result as { ok?: boolean; error?: string; units?: GeoUnit[] } | undefined;
      const hereInner = hereR.data?.result as { ok?: boolean; columnUnits?: ColumnUnit[] } | undefined;
      if (r_ok(mapR.data?.ok, mapInner)) setUnits(mapInner?.units || []);
      else { setError(mapInner?.error || mapR.data?.error || 'Geologic map lookup failed'); setUnits([]); }
      if (r_ok(hereR.data?.ok, hereInner)) setColumn(hereInner?.columnUnits || []);
      else setColumn([]);
      setRan(true);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, scale]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Geologic Map &amp; Bedrock</h3>
        <span className="text-[11px] text-zinc-400">Macrostrat</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={scale} onChange={(e) => setScale(e.target.value as Scale)}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
          {SCALES.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
        </select>
        <button onClick={useGps}
          className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
          <Crosshair className="w-3 h-3" />GPS
        </button>
        <button onClick={lookup} disabled={loading}
          className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mountain className="w-3 h-3" />}Map
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {ran && !error && units.length === 0 && (
        <p className="text-xs text-zinc-400 italic">No geologic-map units returned for this location yet.</p>
      )}

      {units.length > 0 && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto mb-3">
          {units.map((u, i) => (
            <div key={u.mapId ?? i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm border border-zinc-700 shrink-0"
                  style={{ background: u.color || '#3f3f46' }} />
                <span className="text-xs font-semibold text-zinc-100 flex-1">{u.name}</span>
                {u.ageInterval && <span className="text-[10px] text-amber-300">{u.ageInterval}</span>}
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {u.lithology && <span>{u.lithology}</span>}
                {u.ageTop != null && u.ageBottom != null && (
                  <span> · {u.ageBottom}–{u.ageTop} Ma</span>
                )}
              </p>
              {u.description && <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{u.description}</p>}
            </div>
          ))}
        </div>
      )}

      {column.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Stratigraphic column here</p>
          <div className="space-y-0.5">
            {column.map((c, i) => (
              <div key={`${c.unitName}-${i}`}
                className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800/60 rounded px-2 py-1">
                <span className="text-[11px] text-zinc-200 truncate">{c.unitName}</span>
                <span className="text-[10px] text-zinc-400 shrink-0 ml-2">
                  {c.ageInterval || (c.ageTop != null ? `${c.ageBottom}–${c.ageTop} Ma` : '')}
                  {c.maxThicknessM != null && ` · ${c.maxThicknessM} m`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
