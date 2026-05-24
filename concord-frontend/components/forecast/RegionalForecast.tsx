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

export function RegionalForecast({ worldId }: { worldId: string }) {
  const [regions, setRegions] = useState<Region[] | null>(null);
  const [loading, setLoading] = useState(false);

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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {regions.map((reg) => (
          <div
            key={reg.id}
            className={`rounded-xl border p-3 ${
              reg.hasData
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
