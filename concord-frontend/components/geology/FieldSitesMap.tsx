'use client';

/**
 * FieldSitesMap — the Map view's sites layer. The page previously
 * mounted MapView with a hardcoded empty marker set under copy
 * promising that geotagged observations and strike/dip measurements
 * appear once logged — so no logged site could ever appear. This
 * component loads both record families and renders every record that
 * carries coordinates.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Map as MapIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { MapMarker } from '@/components/common/MapView';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface ObsRow { name: string; kind: string; lat: number | null; lon: number | null; locationName: string | null; formation: string | null }
interface MeasRow { planeKind: string; strike: number; dip: number; dipDirection: number; lat: number | null; lon: number | null; locationName: string | null }

export function FieldSitesMap() {
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ol, ml] = await Promise.all([
          lensRun('geology', 'observation-list', {}),
          lensRun('geology', 'measurement-list', {}),
        ]);
        if (cancelled) return;
        const obs = (ol.data?.result as { observations?: ObsRow[] } | undefined)?.observations || [];
        const meas = (ml.data?.result as { measurements?: MeasRow[] } | undefined)?.measurements || [];
        const next: MapMarker[] = [];
        for (const o of obs) {
          if (o.lat != null && o.lon != null) {
            next.push({
              lat: o.lat, lng: o.lon, label: o.name,
              popup: `${o.kind}${o.formation ? ` · ${o.formation}` : ''}${o.locationName ? ` · ${o.locationName}` : ''}`,
            });
          }
        }
        for (const m of meas) {
          if (m.lat != null && m.lon != null) {
            next.push({
              lat: m.lat, lng: m.lon, label: `${m.planeKind} ${m.strike}°/${m.dip}°`,
              popup: `dip direction ${m.dipDirection}°${m.locationName ? ` · ${m.locationName}` : ''}`,
            });
          }
        }
        setMarkers(next);
      } catch { /* an unreachable list leaves an honest empty map */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">
        <MapIcon className="w-4 h-4 text-orange-400" /> Field Sites Map
        {loaded && <span className="text-[11px] font-normal text-zinc-400">{markers.length} geotagged {markers.length === 1 ? 'site' : 'sites'}</span>}
      </h3>
      <MapView markers={markers} className="h-[420px]" />
      <p className="text-[11px] text-gray-500 mt-2">
        Geotagged observations and strike/dip measurements appear here once logged in Field Log / Structure — add coordinates when you log the record.
      </p>
    </div>
  );
}
