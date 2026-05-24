'use client';

/**
 * CityMap — purpose-built city-scale GIS surface for the urban-planning
 * lens. Unlike the equirectangular world MapView in components/viz,
 * this auto-fits a bounding box around the supplied parcels + transit
 * stops and renders zone-coloured parcel squares, transit-stop dots
 * and walk-shed catchment circles in real local coordinates.
 */

import { useMemo, useState } from 'react';

export interface MapParcel {
  id: string;
  apn: string;
  address?: string;
  zoneType: string;
  lotSizeSqFt: number;
  lat?: number | null;
  lng?: number | null;
}

export interface MapCatchment {
  id: string;
  name: string;
  mode: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  radiusDegLat: number;
  catchmentAcres: number;
}

const ZONE_FILL: Record<string, string> = {
  residential: '#22c55e',
  commercial: '#3b82f6',
  mixed: '#a855f7',
  industrial: '#f97316',
};

const MODE_FILL: Record<string, string> = {
  bus: '#06b6d4',
  brt: '#0ea5e9',
  rail: '#6366f1',
  ferry: '#14b8a6',
};

const M_PER_DEG_LAT = 111_320;

export function CityMap({
  parcels,
  catchments = [],
  height = 420,
  onSelectParcel,
}: {
  parcels: MapParcel[];
  catchments?: MapCatchment[];
  height?: number;
  onSelectParcel?: (p: MapParcel) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const geo = useMemo(() => {
    const pts: { lat: number; lng: number; r?: number }[] = [];
    for (const p of parcels) {
      if (p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
        pts.push({ lat: p.lat, lng: p.lng });
      }
    }
    for (const c of catchments) {
      pts.push({ lat: c.lat, lng: c.lng, r: c.radiusDegLat });
    }
    if (pts.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of pts) {
      const r = p.r || 0;
      minLat = Math.min(minLat, p.lat - r);
      maxLat = Math.max(maxLat, p.lat + r);
      minLng = Math.min(minLng, p.lng - r);
      maxLng = Math.max(maxLng, p.lng + r);
    }
    // pad the box by 8% so markers aren't on the edge
    const padLat = Math.max((maxLat - minLat) * 0.08, 0.001);
    const padLng = Math.max((maxLng - minLng) * 0.08, 0.001);
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;
    return { minLat, maxLat, minLng, maxLng };
  }, [parcels, catchments]);

  const W = 720;
  const H = 480;

  if (!geo) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-[11px] text-zinc-400"
        style={{ height }}
      >
        Add parcels or transit stops with lat/lng to plot the city map.
      </div>
    );
  }

  const { minLat, maxLat, minLng, maxLng } = geo;
  const spanLat = maxLat - minLat || 1e-6;
  const spanLng = maxLng - minLng || 1e-6;
  const x = (lng: number) => ((lng - minLng) / spanLng) * W;
  const y = (lat: number) => ((maxLat - lat) / spanLat) * H;
  // meters → svg pixels (use latitude axis, locally accurate enough)
  const mToPx = (m: number) => (m / (spanLat * M_PER_DEG_LAT)) * H;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height }}
        role="img"
        aria-label="city parcel map"
      >
        <rect width={W} height={H} fill="#0a0a0f" />
        {[...Array(13)].map((_, i) => (
          <line key={`v${i}`} x1={(i / 12) * W} y1={0} x2={(i / 12) * W} y2={H} stroke="#16161e" strokeWidth={1} />
        ))}
        {[...Array(9)].map((_, i) => (
          <line key={`h${i}`} x1={0} y1={(i / 8) * H} x2={W} y2={(i / 8) * H} stroke="#16161e" strokeWidth={1} />
        ))}
        {/* transit catchment buffers (under parcels) */}
        {catchments.map((c) => (
          <circle
            key={`buf-${c.id}`}
            cx={x(c.lng)}
            cy={y(c.lat)}
            r={Math.max(2, mToPx(c.radiusMeters))}
            fill={MODE_FILL[c.mode] || MODE_FILL.bus}
            fillOpacity={0.1}
            stroke={MODE_FILL[c.mode] || MODE_FILL.bus}
            strokeOpacity={0.45}
            strokeDasharray="4 3"
            strokeWidth={1}
          />
        ))}
        {/* parcels */}
        {parcels
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => {
            const cx = x(p.lng as number);
            const cy = y(p.lat as number);
            const sel = active === p.id;
            const size = sel ? 14 : 10;
            return (
              <g
                key={p.id}
                onClick={() => { setActive(p.id); onSelectParcel?.(p); }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={cx - size / 2}
                  y={cy - size / 2}
                  width={size}
                  height={size}
                  rx={2}
                  fill={ZONE_FILL[p.zoneType] || '#a1a1aa'}
                  stroke="#fff"
                  strokeWidth={sel ? 1.6 : 0.6}
                  opacity={0.92}
                />
              </g>
            );
          })}
        {/* transit stops (on top) */}
        {catchments.map((c) => (
          <g key={`stop-${c.id}`}>
            <circle
              cx={x(c.lng)}
              cy={y(c.lat)}
              r={5}
              fill={MODE_FILL[c.mode] || MODE_FILL.bus}
              stroke="#fff"
              strokeWidth={1}
            />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 text-[10px] text-zinc-400">
        {Object.entries(ZONE_FILL).map(([z, col]) => (
          <span key={z} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: col }} /> {z}
          </span>
        ))}
        {catchments.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MODE_FILL.rail }} /> transit stop + walk-shed
          </span>
        )}
      </div>
      {active && (() => {
        const p = parcels.find((x) => x.id === active);
        if (!p) return null;
        return (
          <p className="px-1 pt-1 text-[11px] text-zinc-400">
            <span className="font-medium text-zinc-200">{p.apn}</span>
            {p.address ? ` · ${p.address}` : ''}
            {' · '}{p.zoneType} · {p.lotSizeSqFt.toLocaleString()} sqft
          </p>
        );
      })()}
    </div>
  );
}
