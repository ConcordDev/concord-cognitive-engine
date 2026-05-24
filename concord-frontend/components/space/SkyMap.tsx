'use client';

/**
 * SkyMap — planetarium view. Calls space.sky-map (pure-compute J2000
 * ephemeris) for the alt/azimuth of the visible planets at the user's
 * location and plots them on an azimuthal horizon dome.
 */

import { useState, useCallback } from 'react';
import { Compass, MapPin, Loader2, AlertTriangle, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SkyObject {
  name: string;
  rightAscensionHours: number;
  declinationDeg: number;
  altitudeDeg: number;
  azimuthDeg: number;
  distanceAu: number;
  aboveHorizon: boolean;
}

interface SkyMapResult {
  observer: { latitude: number; longitude: number };
  instant: string;
  localSiderealTimeDeg: number;
  objects: SkyObject[];
  visibleCount: number;
}

const PLANET_COLOR: Record<string, string> = {
  Mercury: '#a1a1aa',
  Venus: '#fcd34d',
  Mars: '#f87171',
  Jupiter: '#fbbf24',
  Saturn: '#fde68a',
};

export function SkyMap() {
  const [result, setResult] = useState<SkyMapResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback((lat: number, lon: number) => {
    setLoading(true);
    setError(null);
    lensRun<SkyMapResult>('space', 'sky-map', { latitude: lat, longitude: lon }).then((r) => {
      if (r.data?.ok && r.data.result) setResult(r.data.result);
      else setError(r.data?.error || 'Sky map failed');
      setLoading(false);
    });
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => compute(p.coords.latitude, p.coords.longitude),
      (e) => {
        setError(`Location denied: ${e.message}`);
        setLoading(false);
      },
      { timeout: 10000 },
    );
  }, [compute]);

  // Azimuthal projection: zenith at centre, horizon at edge.
  const R = 130;
  const project = (alt: number, az: number) => {
    const r = ((90 - alt) / 90) * R;
    const a = ((az - 90) * Math.PI) / 180;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Compass className="w-4 h-4 text-violet-400" /> Sky Map · Planetarium
        </h3>
        <button
          onClick={locate}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
          Use my location
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!result && !error && (
        <p className="text-xs text-zinc-400 border border-dashed border-zinc-800 rounded-lg p-4 text-center">
          Share your location to render the planets currently above your horizon.
        </p>
      )}

      {result && (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 flex justify-center py-3">
            <svg viewBox="-150 -150 300 300" style={{ width: 300, height: 300 }}>
              {/* horizon dome rings */}
              {[R, R * 0.66, R * 0.33].map((rr) => (
                <circle
                  key={rr}
                  cx={0}
                  cy={0}
                  r={rr}
                  fill="none"
                  stroke="#27272a"
                  strokeWidth={1}
                />
              ))}
              {/* cardinal labels */}
              {[
                { l: 'N', x: 0, y: -R - 8 },
                { l: 'E', x: R + 8, y: 4 },
                { l: 'S', x: 0, y: R + 14 },
                { l: 'W', x: -R - 10, y: 4 },
              ].map((c) => (
                <text
                  key={c.l}
                  x={c.x}
                  y={c.y}
                  fill="#71717a"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {c.l}
                </text>
              ))}
              {/* planets above the horizon */}
              {result.objects
                .filter((o) => o.aboveHorizon)
                .map((o) => {
                  const { x, y } = project(o.altitudeDeg, o.azimuthDeg);
                  return (
                    <g key={o.name}>
                      <circle cx={x} cy={y} r={4} fill={PLANET_COLOR[o.name] || '#a78bfa'} />
                      <text x={x + 7} y={y + 3} fill="#d4d4d8" fontSize={9}>
                        {o.name}
                      </text>
                    </g>
                  );
                })}
            </svg>
          </div>

          <p className="text-[11px] text-zinc-400 text-center">
            {result.visibleCount} of {result.objects.length} planets above the horizon ·{' '}
            {new Date(result.instant).toLocaleTimeString()}
          </p>

          <div className="space-y-1.5">
            {result.objects.map((o) => (
              <div
                key={o.name}
                className="flex items-center gap-3 p-2 bg-zinc-900 rounded-lg border border-zinc-800 text-xs"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: PLANET_COLOR[o.name] || '#a78bfa' }}
                />
                <span className="font-medium text-white w-16">{o.name}</span>
                <span className="text-zinc-400">
                  alt {o.altitudeDeg.toFixed(1)}° · az {o.azimuthDeg.toFixed(0)}°
                </span>
                <span className="text-zinc-400 ml-auto">{o.distanceAu.toFixed(2)} AU</span>
                <span
                  className={cn(
                    'flex items-center gap-1',
                    o.aboveHorizon ? 'text-emerald-400' : 'text-zinc-600',
                  )}
                >
                  <Star className="w-3 h-3" />
                  {o.aboveHorizon ? 'visible' : 'below'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
