'use client';

/**
 * CrisisMap — geospatial plot of live incidents (USGS quakes + NWS
 * alerts) merged via the crisis.map macro and rendered on the shared
 * MapView surface.
 */

import { useEffect, useState, useCallback } from 'react';
import { Globe2, Loader2, RefreshCw } from 'lucide-react';
import { MapView, type MapMarker } from '@/components/viz';
import { lensRun } from '@/lib/api/client';

interface Incident {
  id: string;
  kind: string;
  label: string;
  lat: number;
  lon: number;
  intensity: number;
  severity: string;
  magnitude?: number;
  headline?: string;
  area?: string;
  url?: string;
}

const SEV_TONE: Record<string, MapMarker['tone']> = {
  critical: 'bad', high: 'warn', moderate: 'info', low: 'default',
};

export function CrisisMap() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [sources, setSources] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Incident | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('crisis', 'map', {});
    if (r.data?.ok && r.data.result) {
      setIncidents((r.data.result.incidents as Incident[]) || []);
      setSources((r.data.result.sources as Record<string, unknown>) || {});
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const markers: MapMarker[] = incidents
    .filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon))
    .map((i) => ({
      id: i.id,
      lat: i.lat,
      lon: i.lon,
      label: i.label,
      value: i.intensity,
      tone: SEV_TONE[i.severity] || 'default',
    }));

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between border-b border-rose-500/15 pb-2">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-rose-300" />
          <h2 className="text-sm font-semibold text-white">Incident map</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            USGS · NWS · live
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Pulling live incident feeds…
        </div>
      )}

      {!loading && (
        <>
          <div className="rounded-lg border border-white/10 bg-black/20 p-2">
            <MapView markers={markers} height={320} onSelect={(m) => {
              setSelected(incidents.find((i) => i.id === m.id) || null);
            }} />
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-400">
            <span>{incidents.length} incidents plotted</span>
            {typeof sources.usgs === 'number' && <span>· {sources.usgs as number} quakes</span>}
            {typeof sources.nws === 'number' && <span>· {sources.nws as number} weather alerts</span>}
          </div>
          {selected && (
            <div className="rounded-lg border border-rose-500/25 bg-rose-900/15 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-rose-200">{selected.label}</span>
                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-rose-200">
                  {selected.severity}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-zinc-300">
                {selected.kind === 'earthquake'
                  ? `Magnitude ${selected.magnitude} · ${selected.lat.toFixed(2)}, ${selected.lon.toFixed(2)}`
                  : (selected.headline || selected.area || `${selected.lat.toFixed(2)}, ${selected.lon.toFixed(2)}`)}
              </p>
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 hover:underline">
                  Source detail →
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
