'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudRain, Sun, Snowflake, Wind, Droplets, Thermometer, AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';

interface ForecastDay {
  date: string;
  high: number;
  low: number;
  precipitationMm: number;
  precipitationProbability: number;
  windSpeedMax: number;
  weatherCode: number;
  uvIndex: number;
}

interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
}

interface ForecastData {
  current: CurrentWeather;
  daily: ForecastDay[];
  hourly: Array<{ time: string; temperature: number; precipitationMm: number; humidity: number }>;
  location: { lat: number; lng: number; label?: string };
  alerts?: Array<{ event: string; severity: string; description: string }>;
}

interface WeatherRadarProps {
  lat?: number;
  lng?: number;
  locationLabel?: string;
}

const WEATHER_CODES: Record<number, { label: string; icon: typeof Sun }> = {
  0: { label: 'Clear', icon: Sun },
  1: { label: 'Mostly clear', icon: Sun },
  2: { label: 'Partly cloudy', icon: Cloud },
  3: { label: 'Overcast', icon: Cloud },
  45: { label: 'Fog', icon: Cloud },
  48: { label: 'Rime fog', icon: Cloud },
  51: { label: 'Light drizzle', icon: CloudRain },
  53: { label: 'Drizzle', icon: CloudRain },
  55: { label: 'Heavy drizzle', icon: CloudRain },
  61: { label: 'Light rain', icon: CloudRain },
  63: { label: 'Rain', icon: CloudRain },
  65: { label: 'Heavy rain', icon: CloudRain },
  71: { label: 'Light snow', icon: Snowflake },
  73: { label: 'Snow', icon: Snowflake },
  75: { label: 'Heavy snow', icon: Snowflake },
  80: { label: 'Showers', icon: CloudRain },
  81: { label: 'Heavy showers', icon: CloudRain },
  82: { label: 'Violent showers', icon: CloudRain },
  95: { label: 'Thunderstorm', icon: CloudRain },
  96: { label: 'Storm w/ hail', icon: CloudRain },
};

export function WeatherRadar({ lat, lng, locationLabel }: WeatherRadarProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number; label?: string } | null>(
    lat != null && lng != null ? { lat, lng, label: locationLabel } : null
  );
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coords && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCoords({ lat: 37.7749, lng: -122.4194, label: 'San Francisco (default)' }),
        { maximumAge: 5 * 60 * 1000, timeout: 5000 }
      );
    }
  }, [coords]);

  useEffect(() => {
    if (!coords) return;
    setLoading(true); setError(null);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', {
          domain: 'eco', action: 'weather-forecast',
          input: { lat: coords.lat, lng: coords.lng },
        });
        // /api/lens/run single-unwraps: a handler rejection (e.g. Open-Meteo
        // unreachable) arrives as res.data.result = { ok:false, error }. Surface
        // it so the error branch renders instead of crashing on data.current.
        const node = res.data?.result as (ForecastData & { ok?: boolean; error?: string }) | null;
        if (node && node.ok === false) {
          setError(node.error || 'Weather source unavailable.');
          setData(null);
        } else {
          setData((node as ForecastData) || null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'fetch failed');
      } finally { setLoading(false); }
    })();
  }, [coords]);

  if (!coords) {
    return (
      <div className="bg-[#0d1117] border border-lattice-border rounded-lg p-6 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Locating you…
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-[#0d1117] border border-lattice-border rounded-lg p-6 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading forecast…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0d1117] border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
        Failed to load weather: {error || 'no data'}
      </div>
    );
  }

  const code = WEATHER_CODES[data.current.weatherCode] || { label: 'Unknown', icon: Cloud };
  const CodeIcon = code.icon;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CloudRain className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Weather forecast</span>
        <span className="ml-auto text-[10px] text-gray-400 inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> {data.location.label || `${data.location.lat.toFixed(3)}, ${data.location.lng.toFixed(3)}`}
        </span>
      </header>

      {data.alerts && data.alerts.length > 0 && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 space-y-1">
          {data.alerts.slice(0, 3).map((a, i) => (
            <div key={i} className="text-xs text-yellow-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold">{a.event}</span> — {a.description}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-4 flex items-start gap-4 border-b border-white/5">
        <div className="flex-1 flex items-center gap-3">
          <CodeIcon className="w-14 h-14 text-cyan-300" />
          <div>
            <div className="text-4xl font-bold text-white tabular-nums">{Math.round(data.current.temperature)}°C</div>
            <div className="text-sm text-gray-400">{code.label}</div>
            <div className="text-xs text-gray-400">Feels like {Math.round(data.current.feelsLike)}°C</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-300">
          <Pill icon={Droplets} label="Humidity" value={`${data.current.humidity}%`} />
          <Pill icon={Wind} label="Wind" value={`${Math.round(data.current.windSpeed)} km/h`} />
          <Pill icon={CloudRain} label="Rain" value={`${data.current.precipitationMm.toFixed(1)} mm`} />
          <Pill icon={Thermometer} label="UV today" value={`${Math.round(data.daily[0]?.uvIndex || 0)}`} />
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">7-day forecast</h3>
        <div className="grid grid-cols-7 gap-1">
          {data.daily.slice(0, 7).map(d => {
            const dc = WEATHER_CODES[d.weatherCode] || { label: '', icon: Cloud };
            const DIcon = dc.icon;
            return (
              <div key={d.date} className="flex flex-col items-center gap-1 py-1.5 rounded hover:bg-white/[0.04]">
                <span className="text-[10px] text-gray-400">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <DIcon className="w-5 h-5 text-cyan-300" />
                <span className="text-[10px] text-gray-300 tabular-nums">{Math.round(d.high)}°</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{Math.round(d.low)}°</span>
                {d.precipitationProbability > 30 && (
                  <span className="text-[9px] text-blue-300">{d.precipitationProbability}%</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="px-4 py-1.5 border-t border-white/10 text-[10px] text-gray-400">
        Source: Open-Meteo · refreshed at {new Date().toLocaleTimeString()}
      </footer>
    </div>
  );
}

function Pill({ icon: Icon, label, value }: { icon: typeof Sun; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-cyan-400" />
      <span className="text-gray-400">{label}:</span>
      <span className="text-white tabular-nums">{value}</span>
    </div>
  );
}

export default WeatherRadar;
