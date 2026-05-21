'use client';

/**
 * Orbit3DGlobe — 3D orbit visualization. Calls space.orbit-3d (pure
 * compute) for sampled ECI XYZ points and renders them around a globe
 * with a dependency-free isometric SVG projection the user can rotate.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Orbit, Loader2, RotateCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface OrbitPoint {
  x: number;
  y: number;
  z: number;
}

interface Orbit3DResult {
  altitudeKm: number;
  inclinationDeg: number;
  orbitalRadiusKm: number;
  earthRadiusKm: number;
  periodMinutes: number;
  velocityKmS: number;
  orbitsPerDay: number;
  zone: string;
  points: OrbitPoint[];
}

export function Orbit3DGlobe() {
  const [altitude, setAltitude] = useState(420);
  const [inclination, setInclination] = useState(51.6);
  const [yaw, setYaw] = useState(35);
  const [result, setResult] = useState<Orbit3DResult | null>(null);
  const [loading, setLoading] = useState(false);

  const compute = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<Orbit3DResult>('space', 'orbit-3d', {
      altitudeKm: altitude,
      inclinationDeg: inclination,
      samples: 120,
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    setLoading(false);
  }, [altitude, inclination]);

  useEffect(() => {
    compute();
  }, [compute]);

  // Project ECI points to 2D with a rotating isometric camera.
  const projected = useMemo(() => {
    if (!result) return { earthR: 0, dots: [] as { sx: number; sy: number; depth: number }[] };
    const yawR = (yaw * Math.PI) / 180;
    const pitchR = (28 * Math.PI) / 180;
    const scale = 110 / result.orbitalRadiusKm;
    const project = (x: number, y: number, z: number) => {
      const rx = x * Math.cos(yawR) - y * Math.sin(yawR);
      const ry = x * Math.sin(yawR) + y * Math.cos(yawR);
      const sy0 = ry * Math.sin(pitchR) + z * Math.cos(pitchR);
      const depth = ry * Math.cos(pitchR) - z * Math.sin(pitchR);
      return { sx: rx * scale, sy: -sy0 * scale, depth };
    };
    const dots = result.points.map((p) => project(p.x, p.y, p.z));
    return { earthR: result.earthRadiusKm * scale, dots };
  }, [result, yaw]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Orbit className="w-4 h-4 text-indigo-400" /> 3D Orbit Visualization
        </h3>
        <div className="flex items-center gap-3">
          <label className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            Altitude
            <input
              type="number"
              min={100}
              max={40000}
              value={altitude}
              onChange={(e) => setAltitude(Number(e.target.value))}
              className="w-20 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-white text-xs"
            />
            km
          </label>
          <label className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            Inclination
            <input
              type="number"
              min={0}
              max={180}
              step={0.1}
              value={inclination}
              onChange={(e) => setInclination(Number(e.target.value))}
              className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-white text-xs"
            />
            °
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
          </div>
        )}
        <svg viewBox="-160 -160 320 320" className="w-full" style={{ height: 320 }}>
          {/* star field */}
          {Array.from({ length: 40 }, (_, i) => {
            const a = (i * 137.5 * Math.PI) / 180;
            const r = 40 + ((i * 53) % 110);
            return (
              <circle
                key={`star${i}`}
                cx={Math.cos(a) * r}
                cy={Math.sin(a) * r}
                r={0.6}
                fill="#52525b"
              />
            );
          })}
          {/* far orbit half (behind earth) */}
          {projected.dots
            .filter((d) => d.depth < 0)
            .map((d, i) => (
              <circle key={`far${i}`} cx={d.sx} cy={d.sy} r={1.3} fill="#4f46e5" opacity={0.35} />
            ))}
          {/* earth */}
          <defs>
            <radialGradient id="earthGrad" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="70%" stopColor="#1e3a8a" />
              <stop offset="100%" stopColor="#0c1a3d" />
            </radialGradient>
          </defs>
          <circle cx={0} cy={0} r={projected.earthR} fill="url(#earthGrad)" />
          {/* near orbit half (in front of earth) */}
          {projected.dots
            .filter((d) => d.depth >= 0)
            .map((d, i) => (
              <circle key={`near${i}`} cx={d.sx} cy={d.sy} r={1.6} fill="#818cf8" />
            ))}
          {/* satellite marker = first point */}
          {projected.dots[0] && (
            <circle cx={projected.dots[0].sx} cy={projected.dots[0].sy} r={3.4} fill="#fbbf24" />
          )}
        </svg>
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2">
          <RotateCw className="w-3.5 h-3.5 text-zinc-500" />
          <input
            type="range"
            min={0}
            max={360}
            value={yaw}
            onChange={(e) => setYaw(Number(e.target.value))}
            className="flex-1 accent-indigo-500"
            aria-label="Rotate orbit view"
          />
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Zone', value: result.zone },
            { label: 'Period', value: `${result.periodMinutes} min` },
            { label: 'Velocity', value: `${result.velocityKmS} km/s` },
            { label: 'Orbits / day', value: String(result.orbitsPerDay) },
          ].map((s) => (
            <div key={s.label} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className="text-[11px] text-zinc-500">{s.label}</p>
              <p className="text-sm font-mono font-semibold text-white">{s.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
