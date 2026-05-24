'use client';

/**
 * MapView — lightweight equirectangular world plot for lenses that need
 * a geographic surface (atlas, travel, geology, ocean, global, weather,
 * astronomy ground tracks, emergency-services incidents). Dependency-free
 * SVG — no tile provider. Renders markers and an optional value-shaded
 * (choropleth-style) point layer.
 */

import { useState } from 'react';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  /** optional 0..1 intensity → colour ramp */
  value?: number;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
}

const TONE: Record<string, string> = {
  default: '#a1a1aa', good: '#22c55e', warn: '#f59e0b', bad: '#ef4444', info: '#6366f1',
};

function ramp(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(30 + t * 225);
  const g = Math.round(80 + (1 - t) * 120);
  const b = Math.round(220 - t * 160);
  return `rgb(${r},${g},${b})`;
}

export function MapView({
  markers,
  height = 300,
  onSelect,
}: {
  markers: MapMarker[];
  height?: number;
  onSelect?: (m: MapMarker) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const W = 720;
  const H = 360;
  const x = (lon: number) => ((lon + 180) / 360) * W;
  const y = (lat: number) => ((90 - lat) / 180) * H;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} role="img" aria-label="map">
        <rect width={W} height={H} fill="#0a0a0f" />
        {/* graticule */}
        {[...Array(11)].map((_, i) => (
          <line key={`v${i}`} x1={(i / 10) * W} y1={0} x2={(i / 10) * W} y2={H} stroke="#1f1f29" strokeWidth={1} />
        ))}
        {[...Array(7)].map((_, i) => (
          <line key={`h${i}`} x1={0} y1={(i / 6) * H} x2={W} y2={(i / 6) * H} stroke="#1f1f29" strokeWidth={1} />
        ))}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#2f2f3a" strokeWidth={1.5} />
        {markers.map((m) => {
          const fill = m.value != null ? ramp(m.value) : TONE[m.tone || 'default'];
          const r = active === m.id ? 7 : 4.5;
          return (
            <g key={m.id} onClick={() => { setActive(m.id); onSelect?.(m); }} style={{ cursor: 'pointer' }}>
              <circle cx={x(m.lon)} cy={y(m.lat)} r={r} fill={fill} stroke="#fff" strokeWidth={active === m.id ? 1.5 : 0.5} opacity={0.9} />
            </g>
          );
        })}
      </svg>
      {markers.length === 0 && (
        <p className="py-2 text-center text-[11px] text-zinc-400">No mapped points yet.</p>
      )}
      {active && (() => {
        const m = markers.find((x) => x.id === active);
        if (!m) return null;
        return (
          <p className="px-1 pt-1 text-[11px] text-zinc-400">
            <span className="text-zinc-200 font-medium">{m.label || m.id}</span>
            {' · '}{m.lat.toFixed(3)}, {m.lon.toFixed(3)}
            {m.value != null ? ` · ${(m.value * 100).toFixed(0)}%` : ''}
          </p>
        );
      })()}
    </div>
  );
}
