'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, Loader2, Thermometer, Droplets, Wind, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface MeteoResponse {
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    weather_code: number[];
    wind_speed_10m_max: number[];
  };
  current?: { temperature_2m: number; relative_humidity_2m: number; weather_code: number };
}

const CITIES = [
  { id: 'sf', label: 'San Francisco (US)', lat: 37.77, lon: -122.42 },
  { id: 'nyc', label: 'New York (US)', lat: 40.71, lon: -74.0 },
  { id: 'london', label: 'London (UK)', lat: 51.51, lon: -0.13 },
  { id: 'tokyo', label: 'Tokyo (JP)', lat: 35.68, lon: 139.69 },
  { id: 'sydney', label: 'Sydney (AU)', lat: -33.87, lon: 151.21 },
  { id: 'lagos', label: 'Lagos (NG)', lat: 6.45, lon: 3.4 },
  { id: 'rio', label: 'Rio de Janeiro (BR)', lat: -22.91, lon: -43.17 },
];

export function WeatherForecast() {
  const [city, setCity] = useState(CITIES[0].id);
  const sel = CITIES.find((c) => c.id === city)!;

  const data = useQuery({
    queryKey: ['weather-forecast', city],
    queryFn: async () => {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${sel.lat}&longitude=${sel.lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_speed_10m_max&forecast_days=7`);
      if (!r.ok) throw new Error(`om ${r.status}`);
      return (await r.json()) as MeteoResponse;
    },
    staleTime: 30 * 60 * 1000,
  });

  const d = data.data?.daily;
  const c = data.data?.current;
  const days = d?.time?.length || 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <CloudSun className="h-5 w-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">7-day forecast</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">open-meteo.com · live</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={city} onChange={(e) => setCity(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{CITIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          {d && (
            <SaveAsDtuButton
              compact
              apiSource="open-meteo-forecast"
              apiUrl={`https://api.open-meteo.com/v1/forecast?latitude=${sel.lat}&longitude=${sel.lon}`}
              title={`${sel.label} — 7-day forecast`}
              content={d.time.map((t, i) => `${t}: ${d.temperature_2m_min[i].toFixed(1)}°C / ${d.temperature_2m_max[i].toFixed(1)}°C · precip ${d.precipitation_sum[i].toFixed(1)}mm · wind ${d.wind_speed_10m_max[i].toFixed(1)}km/h`).join('\n')}
              extraTags={['forecast', 'weather', 'open-meteo', sel.id]}
              rawData={{ city: sel, current: c, daily: d }}
            />
          )}
        </div>
      </header>
      {data.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Open-Meteo unreachable.</div>}
      {c && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Thermometer className="h-2.5 w-2.5" />Now</div><div className="mt-0.5 font-mono text-lg text-sky-300">{c.temperature_2m.toFixed(1)}°C</div></div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Droplets className="h-2.5 w-2.5" />Humidity</div><div className="mt-0.5 font-mono text-lg text-cyan-300">{c.relative_humidity_2m}%</div></div>
        </div>
      )}
      <div className="space-y-1.5">
        {Array.from({ length: days }, (_, i) => (
          <div key={d!.time[i]} className="flex items-center gap-3 rounded-lg border border-sky-500/15 bg-sky-500/5 p-2">
            <span className="w-24 shrink-0 font-mono text-[11px] text-zinc-300">{d!.time[i]}</span>
            <span className="flex items-center gap-1 font-mono text-xs"><Thermometer className="h-3 w-3 text-rose-400" />{d!.temperature_2m_min[i].toFixed(0)}° / {d!.temperature_2m_max[i].toFixed(0)}°</span>
            <span className="flex items-center gap-1 font-mono text-xs text-cyan-300"><Droplets className="h-3 w-3" />{d!.precipitation_sum[i].toFixed(1)}mm</span>
            <span className="flex items-center gap-1 font-mono text-xs text-zinc-400"><Wind className="h-3 w-3" />{d!.wind_speed_10m_max[i].toFixed(0)}km/h</span>
          </div>
        ))}
      </div>
      {data.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
      <p className="flex items-center gap-1 text-[10px] text-zinc-400"><ExternalLink className="h-3 w-3" />Open-Meteo · refreshes every 30 min.</p>
    </div>
  );
}
