'use client';

/**
 * RegionalForecast — per-district outlook. Each of the 7 cognitive-geography
 * districts reads real embodied_signal_log rows near its world-space anchor.
 * Districts with no measured signals show an honest "no data" state.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface RegionWeather {
  kind: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  air_quality: number | null;
  light: number | null;
  noise: number | null;
  structural_stress: number | null;
}

interface Region {
  id: string;
  name: string;
  anchor: { x: number; z: number };
  hasData: boolean;
  weather: RegionWeather | null;
}

interface RegionalResult {
  ok: boolean;
  regions: Region[];
}

// Compact SVG plot of each district's real world-space anchor (server-derived
// `regionAnchor`, a stable ring around the world origin — see
// server/lib/world-forecast.js). No fabricated positions: every dot is the
// exact (x, z) the backend used to sample embodied signals for that district.
function DistrictCompass({
  regions,
  selectedId,
  onSelect,
}: {
  regions: Region[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const SIZE = 220;
  const CENTER = SIZE / 2;
  const maxR = Math.max(1, ...regions.map((r) => Math.hypot(r.anchor.x, r.anchor.z)));
  const scale = (CENTER - 24) / maxR;
  const rings = [0.33, 0.66, 1];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="District position compass" className="mx-auto">
        {rings.map((f) => (
          <circle key={f} cx={CENTER} cy={CENTER} r={(CENTER - 24) * f} fill="none" stroke="#27272a" strokeWidth={1} />
        ))}
        <line x1={CENTER} y1={12} x2={CENTER} y2={SIZE - 12} stroke="#1f1f23" strokeWidth={1} />
        <line x1={12} y1={CENTER} x2={SIZE - 12} y2={CENTER} stroke="#1f1f23" strokeWidth={1} />
        <circle cx={CENTER} cy={CENTER} r={2.5} fill="#52525b" />
        {regions.map((reg) => {
          const px = CENTER + reg.anchor.x * scale;
          const py = CENTER - reg.anchor.z * scale;
          const selected = selectedId === reg.id;
          return (
            <g
              key={reg.id}
              transform={`translate(${px}, ${py})`}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Select ${reg.name}`}
              onClick={() => onSelect(reg.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(reg.id); } }}
            >
              <circle
                r={selected ? 8 : 6}
                fill={reg.hasData ? '#10b981' : '#3f3f46'}
                stroke={selected ? '#22d3ee' : '#fff'}
                strokeWidth={selected ? 1.75 : 0.75}
                opacity={0.92}
              />
              <text y={-11} textAnchor="middle" fontSize={8} fill="#a1a1aa" fontFamily="monospace">
                {reg.name.replace('The ', '')}
              </text>
              <title>{`${reg.name} · (${reg.anchor.x}, ${reg.anchor.z}) · ${reg.hasData ? reg.weather?.kind || 'measured' : 'no data'}`}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-1.5 flex items-center justify-center gap-3 text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />measured</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-600" />no data</span>
        <span>· click a district to select it below</span>
      </p>
    </div>
  );
}

export function RegionalForecast({ worldId }: { worldId: string }) {
  const [regions, setRegions] = useState<Region[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<RegionalResult>('forecast', 'regional', { worldId });
    if (r.data?.ok && r.data.result?.ok) {
      setRegions(r.data.result.regions || []);
    } else {
      setRegions([]);
    }
    setLoading(false);
  }, [worldId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-zinc-400">Reading district signals…</p>;
  if (!regions || regions.length === 0) {
    return <p className="py-8 text-center text-xs italic text-zinc-400">No data yet.</p>;
  }

  const withData = regions.filter((r) => r.hasData);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        {withData.length} of {regions.length} districts have measured embodied signals.
      </p>
      <DistrictCompass regions={regions} selectedId={selectedId} onSelect={setSelectedId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {regions.map((reg) => (
          <div
            key={reg.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${reg.name}`}
            onClick={() => setSelectedId(reg.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(reg.id); } }}
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              selectedId === reg.id
                ? 'border-cyan-500/60 bg-cyan-500/10'
                : reg.hasData
                ? 'border-emerald-700/30 bg-emerald-500/5'
                : 'border-zinc-800 bg-zinc-950/40'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-100">{reg.name}</h3>
              <span className="font-mono text-[10px] text-zinc-400">
                ({reg.anchor.x}, {reg.anchor.z})
              </span>
            </div>
            {reg.hasData && reg.weather ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex justify-between"><dt className="text-zinc-400">Sky</dt><dd className="text-zinc-200">{reg.weather.kind}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-400">Temp</dt><dd className="font-mono text-cyan-300">{reg.weather.temperature_c !== null ? `${reg.weather.temperature_c}°C` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-400">Humidity</dt><dd className="font-mono text-zinc-200">{reg.weather.humidity_pct !== null ? `${reg.weather.humidity_pct}%` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-400">Air</dt><dd className="font-mono text-zinc-200">{reg.weather.air_quality !== null ? reg.weather.air_quality.toFixed(2) : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-400">Light</dt><dd className="font-mono text-zinc-200">{reg.weather.light !== null ? reg.weather.light.toFixed(0) : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-zinc-400">Noise</dt><dd className="font-mono text-zinc-200">{reg.weather.noise !== null ? `${reg.weather.noise.toFixed(0)}dB` : '—'}</dd></div>
                {reg.weather.structural_stress !== null && reg.weather.structural_stress > 0 && (
                  <div className="col-span-2 flex justify-between"><dt className="text-rose-400">Stress</dt><dd className="font-mono text-rose-300">{reg.weather.structural_stress.toFixed(2)}</dd></div>
                )}
              </dl>
            ) : (
              <p className="mt-2 text-[11px] italic text-zinc-400">No measured signals at this district yet.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
