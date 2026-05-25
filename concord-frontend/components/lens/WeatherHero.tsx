'use client';

// WeatherHero — Apple Weather / Carrot Weather style hero panel.
// Mounted in the eco + agriculture lenses to surface the Open-Meteo
// realtime feed (free, no key) as a real weather UI rather than the
// JSON-dump fallback. Renders:
//   - Big current temperature + condition glyph + feels-like
//   - Wind / precipitation / location metadata
//   - 7-day forecast strip (max/min + precipitation bar)
//
// Data shape (from server/emergent/realtime-feeds.js#tickWeatherFeeds):
//   current: { temperature_2m, apparent_temperature, wind_speed_10m,
//              precipitation, weather_code }
//   daily:   { temperature_2m_max:[], temperature_2m_min:[],
//              precipitation_sum:[], time:[] }
//   location: { lat, lon, timezone }

import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudLightning,
  CloudFog, Wind, Droplets, MapPin, Wifi, WifiOff,
} from 'lucide-react';

export interface WeatherPayload {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    time?: string[];
    weather_code?: number[];
  };
  location?: { lat?: number; lon?: number; timezone?: string };
}

interface WeatherHeroProps {
  data: WeatherPayload | null | undefined;
  isLive?: boolean;
  lastUpdated?: string | null;
  className?: string;
}

// Open-Meteo WMO weather codes → { label, icon }.
// Reference: https://open-meteo.com/en/docs (interpretation table).
function decodeWeatherCode(code: number | undefined) {
  if (code === undefined || code === null) return { label: 'Clear', Icon: Sun };
  if (code === 0)                       return { label: 'Clear sky',         Icon: Sun };
  if (code <= 3)                        return { label: 'Partly cloudy',     Icon: Cloud };
  if (code === 45 || code === 48)       return { label: 'Fog',               Icon: CloudFog };
  if (code >= 51 && code <= 57)         return { label: 'Drizzle',           Icon: CloudDrizzle };
  if (code >= 61 && code <= 67)         return { label: 'Rain',              Icon: CloudRain };
  if (code >= 71 && code <= 77)         return { label: 'Snow',              Icon: CloudSnow };
  if (code >= 80 && code <= 82)         return { label: 'Rain showers',      Icon: CloudRain };
  if (code >= 85 && code <= 86)         return { label: 'Snow showers',      Icon: CloudSnow };
  if (code >= 95)                       return { label: 'Thunderstorm',      Icon: CloudLightning };
  return { label: 'Variable', Icon: Cloud };
}

function relTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000)      return 'just now';
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function dayLabel(iso: string, idx: number): string {
  if (idx === 0) return 'Today';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `Day ${idx + 1}`;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

export default function WeatherHero({ data, isLive, lastUpdated, className = '' }: WeatherHeroProps) {
  if (!data?.current) {
    return (
      <section className={`rounded-xl border border-white/10 bg-gradient-to-br from-sky-900/30 to-zinc-900/40 backdrop-blur-sm p-6 ${className}`}>
        <div className="text-xs text-zinc-400">Open-Meteo feed connecting…</div>
      </section>
    );
  }

  const cur = data.current;
  const decoded = decodeWeatherCode(cur.weather_code);
  const Icon = decoded.Icon;

  const days = Math.min(
    data.daily?.temperature_2m_max?.length || 0,
    data.daily?.temperature_2m_min?.length || 0,
    data.daily?.time?.length || 0,
  );
  // Precip bar normalization
  const maxPrecip = Math.max(
    1,
    ...((data.daily?.precipitation_sum || []).map(p => Number(p) || 0)),
  );

  return (
    <section className={`rounded-xl border border-white/10 bg-gradient-to-br from-sky-900/30 to-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      {/* Hero */}
      <div className="p-6 flex items-center gap-6">
        <Icon className="w-20 h-20 text-sky-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-sky-300/80 flex items-center gap-1 mb-1">
            <MapPin className="w-3 h-3" />
            <span>
              {data.location?.lat?.toFixed(2)}°, {data.location?.lon?.toFixed(2)}°
              {data.location?.timezone ? ` · ${data.location.timezone}` : ''}
            </span>
            <span className="ml-2 inline-flex items-center gap-1">
              {isLive ? (
                <><Wifi className="w-3 h-3 text-green-400 animate-pulse" /><span className="text-green-400">live</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-zinc-400" /><span className="text-zinc-400">offline</span></>
              )}
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-6xl font-light text-zinc-100">{Math.round(Number(cur.temperature_2m))}°</span>
            <span className="text-lg text-zinc-300">{decoded.label}</span>
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            Feels like {Math.round(Number(cur.apparent_temperature))}°
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1"><Wind className="w-3 h-3" />{cur.wind_speed_10m ?? '—'} km/h</span>
            <span className="inline-flex items-center gap-1"><Droplets className="w-3 h-3" />{cur.precipitation ?? 0} mm</span>
            {lastUpdated && <span className="text-zinc-600">· {relTime(lastUpdated)}</span>}
          </div>
        </div>
      </div>

      {/* 7-day strip */}
      {days > 0 && (
        <div className="border-t border-white/10 bg-black/20 px-4 py-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days}, minmax(0,1fr))` }}>
            {Array.from({ length: days }).map((_, i) => {
              const t = data.daily!.time![i];
              const max = Number(data.daily!.temperature_2m_max![i]);
              const min = Number(data.daily!.temperature_2m_min![i]);
              const precip = Number(data.daily!.precipitation_sum?.[i] ?? 0);
              const precipPct = Math.min(100, (precip / maxPrecip) * 100);
              const code = data.daily?.weather_code?.[i];
              const dayDecoded = decodeWeatherCode(code);
              const DayIcon = dayDecoded.Icon;
              return (
                <div key={i} className="text-center">
                  <div className="text-[10px] text-zinc-400 mb-1">{dayLabel(t, i)}</div>
                  <DayIcon className="w-5 h-5 text-sky-300 mx-auto" />
                  <div className="mt-1 text-xs text-zinc-200">{Math.round(max)}°</div>
                  <div className="text-[10px] text-zinc-400">{Math.round(min)}°</div>
                  <div className="mt-1.5 h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-400/60"
                      style={{ width: `${precipPct}%` }}
                      aria-label={`${precip} mm`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
