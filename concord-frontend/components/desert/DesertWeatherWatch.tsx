'use client';

import { useQueries } from '@tanstack/react-query';
import { Sun, Loader2, Thermometer, Droplets, Wind, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface CurrentWeather {
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  apparent_temperature?: number;
  is_day?: number;
  weather_code?: number;
  time?: string;
}

interface MeteoResponse {
  current?: CurrentWeather;
  current_units?: Record<string, string>;
  latitude: number;
  longitude: number;
}

const DESERTS = [
  { id: 'sahara', label: 'Sahara (Adrar, MR)', lat: 20.5, lon: -12.0 },
  { id: 'mojave', label: 'Mojave (Death Valley)', lat: 36.5, lon: -116.9 },
  { id: 'gobi', label: 'Gobi (Dalanzadgad, MN)', lat: 43.6, lon: 104.4 },
  { id: 'atacama', label: 'Atacama (San Pedro, CL)', lat: -22.9, lon: -68.2 },
  { id: 'sonoran', label: 'Sonoran (Tucson, AZ)', lat: 32.2, lon: -110.9 },
  { id: 'kalahari', label: 'Kalahari (Ghanzi, BW)', lat: -21.7, lon: 21.6 },
  { id: 'arabian', label: 'Arabian (Rub al Khali)', lat: 19.5, lon: 49.5 },
  { id: 'patagonian', label: 'Patagonian (Comodoro)', lat: -45.9, lon: -67.5 },
];

export function DesertWeatherWatch() {
  const results = useQueries({
    queries: DESERTS.map((d) => ({
      queryKey: ['open-meteo', d.id],
      queryFn: async () => {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature,is_day,weather_code`);
        if (!r.ok) throw new Error(`open-meteo ${r.status}`);
        return (await r.json()) as MeteoResponse;
      },
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    })),
  });

  const sites = DESERTS.map((d, i) => ({ d, q: results[i] }));
  const loaded = sites.filter(({ q }) => q.data?.current);
  const avgTemp = loaded.length > 0 ? loaded.reduce((a, { q }) => a + (q.data!.current!.temperature_2m || 0), 0) / loaded.length : 0;
  const maxTemp = loaded.length > 0 ? Math.max(...loaded.map(({ q }) => q.data!.current!.temperature_2m)) : 0;
  const avgHum = loaded.length > 0 ? loaded.reduce((a, { q }) => a + (q.data!.current!.relative_humidity_2m || 0), 0) / loaded.length : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Real-world desert conditions</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">open-meteo.com · live</span>
        </div>
        {loaded.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="open-meteo-desert"
            apiUrl="https://api.open-meteo.com/v1/forecast"
            title={`Desert weather snapshot — ${loaded.length} sites, avg ${avgTemp.toFixed(1)}°C`}
            content={loaded.map(({ d, q }) => {
              const c = q.data!.current!;
              return `${d.label} (${d.lat.toFixed(1)}, ${d.lon.toFixed(1)}): ${c.temperature_2m.toFixed(1)}°C · ${c.relative_humidity_2m}% RH · ${c.wind_speed_10m.toFixed(1)} km/h wind${c.apparent_temperature != null ? ` · feels ${c.apparent_temperature.toFixed(1)}°C` : ''}`;
            }).join('\n')}
            extraTags={['desert', 'weather', 'open-meteo', 'climate']}
            rawData={{ sites: loaded.map(({ d, q }) => ({ ...d, current: q.data?.current })) }}
          />
        )}
      </header>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Avg temp</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{loaded.length > 0 ? `${avgTemp.toFixed(1)}°C` : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Hottest now</div>
          <div className="mt-0.5 font-mono text-lg text-rose-300">{loaded.length > 0 ? `${maxTemp.toFixed(1)}°C` : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Avg humidity</div>
          <div className="mt-0.5 font-mono text-lg text-cyan-300">{loaded.length > 0 ? `${avgHum.toFixed(0)}%` : '—'}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {sites.map(({ d, q }) => {
          const c = q.data?.current;
          return (
            <div key={d.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-amber-200">{d.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">{d.lat.toFixed(1)}°, {d.lon.toFixed(1)}°</span>
              </div>
              {q.isPending && <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> live…</div>}
              {q.isError && <div className="mt-2 text-[10px] text-rose-400">unreachable</div>}
              {c && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="flex items-center gap-1"><Thermometer className="h-3 w-3 text-rose-400" /><span className="font-mono text-zinc-100">{c.temperature_2m.toFixed(1)}°C</span></div>
                  <div className="flex items-center gap-1"><Droplets className="h-3 w-3 text-cyan-400" /><span className="font-mono text-zinc-100">{c.relative_humidity_2m}%</span></div>
                  <div className="flex items-center gap-1"><Wind className="h-3 w-3 text-zinc-400" /><span className="font-mono text-zinc-100">{c.wind_speed_10m.toFixed(1)} km/h</span></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1 text-[10px] text-zinc-500">
        <ExternalLink className="h-3 w-3" />
        Powered by Open-Meteo. Polls every 5 min.
      </p>
    </div>
  );
}
