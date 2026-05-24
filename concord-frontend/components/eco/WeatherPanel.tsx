'use client';

/**
 * WeatherPanel — bespoke Open-Meteo weather + AQI for the eco lens.
 * Backed by eco.weather-forecast + eco.aqi-current.
 *
 * Per category-leader research (Apple Weather, AccuWeather, Dark Sky,
 * Carrot Weather): hero temp + condition, hourly strip, 7-day cards,
 * AQI gradient bar with EPA color stops + Save-as-DTU.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Cloud, Loader2, MapPin, Wind, Droplets, Sun } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Forecast {
  current: {
    temperature: number; feelsLike: number; humidity: number;
    windSpeed: number; windDirection: number; precipitationMm: number;
    weatherCode: number; isDay: boolean;
  };
  daily: Array<{ date: string; high: number; low: number; precipitationMm: number; precipitationProbability: number; windSpeedMax: number; weatherCode: number; uvIndex: number }>;
  hourly: Array<{ time: string; temperature: number; precipitationMm: number; humidity: number }>;
  location: { lat: number; lng: number };
}

interface Aqi {
  current: { us_aqi: number; pm10: number; pm2_5: number; ozone: number; carbon_monoxide: number; nitrogen_dioxide: number; sulphur_dioxide: number };
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('eco', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const WEATHER_CODE_LABEL: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Severe thunderstorm',
};

function aqiBand(n: number) {
  if (n <= 50) return { label: 'Good', color: 'bg-emerald-500 text-emerald-50' };
  if (n <= 100) return { label: 'Moderate', color: 'bg-yellow-500 text-yellow-950' };
  if (n <= 150) return { label: 'USG', color: 'bg-orange-500 text-orange-950' };
  if (n <= 200) return { label: 'Unhealthy', color: 'bg-red-500 text-red-50' };
  if (n <= 300) return { label: 'Very Unhealthy', color: 'bg-violet-600 text-violet-50' };
  return { label: 'Hazardous', color: 'bg-rose-900 text-rose-50' };
}

export function WeatherPanel() {
  const [lat, setLat] = useState(37.7749);
  const [lng, setLng] = useState(-122.4194);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [aqi, setAqi] = useState<Aqi | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMutation = useMutation({
    mutationFn: async () => {
      const f = await callMacro<Forecast>('weather-forecast', { lat, lng });
      const a = await callMacro<Aqi>('aqi-current', { lat, lng });
      return { f, a };
    },
    onSuccess: ({ f, a }) => {
      if (f.ok && f.result) setForecast(f.result); else { setForecast(null); setError(f.error || 'forecast failed'); }
      if (a.ok && a.result) setAqi(a.result); else setAqi(null);
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Weather + AQI</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">open-meteo</span>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-zinc-400" />
        <input type="number" step="0.0001" value={lat} onChange={(e) => setLat(Number(e.target.value))} placeholder="lat" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
        <input type="number" step="0.0001" value={lng} onChange={(e) => setLng(Number(e.target.value))} placeholder="lng" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
        <button type="button" onClick={() => loadMutation.mutate()} disabled={loadMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          Load
        </button>
        {forecast && (
          <SaveAsDtuButton
            compact
            apiSource="open-meteo"
            title={`Weather ${lat.toFixed(2)}, ${lng.toFixed(2)} — ${WEATHER_CODE_LABEL[forecast.current.weatherCode] || 'condition'}`}
            content={JSON.stringify({ forecast, aqi }, null, 2)}
            extraTags={['eco', 'weather', 'open-meteo']}
            rawData={{ forecast, aqi }}
          />
        )}
      </div>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {forecast && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-5xl font-bold text-white">{Math.round(forecast.current.temperature)}°</div>
                <div className="mt-1 text-sm text-cyan-300">{WEATHER_CODE_LABEL[forecast.current.weatherCode] || 'condition'}</div>
                <div className="mt-1 text-[11px] text-zinc-400">Feels {Math.round(forecast.current.feelsLike)}° · {lat.toFixed(2)}, {lng.toFixed(2)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Mini label="Humidity" value={`${forecast.current.humidity}%`} icon={Droplets} />
                <Mini label="Wind" value={`${Math.round(forecast.current.windSpeed)} km/h`} icon={Wind} />
                <Mini label="Precip" value={`${forecast.current.precipitationMm}mm`} icon={Cloud} />
              </div>
            </div>
          </div>

          {aqi && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">US AQI</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${aqiBand(aqi.current.us_aqi).color}`}>
                  {aqi.current.us_aqi} · {aqiBand(aqi.current.us_aqi).label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] sm:grid-cols-6">
                <Pol label="PM2.5" value={aqi.current.pm2_5} unit="µg/m³" />
                <Pol label="PM10" value={aqi.current.pm10} unit="µg/m³" />
                <Pol label="O3" value={aqi.current.ozone} unit="µg/m³" />
                <Pol label="NO2" value={aqi.current.nitrogen_dioxide} unit="µg/m³" />
                <Pol label="SO2" value={aqi.current.sulphur_dioxide} unit="µg/m³" />
                <Pol label="CO" value={aqi.current.carbon_monoxide} unit="µg/m³" />
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">7-day forecast</div>
            <div className="grid grid-cols-7 gap-1.5">
              {forecast.daily.map((d) => (
                <div key={d.date} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center text-[11px]">
                  <div className="text-zinc-400">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="mt-1 text-cyan-300">{Math.round(d.high)}°</div>
                  <div className="text-zinc-400">{Math.round(d.low)}°</div>
                  {d.uvIndex > 0 && <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[9px] text-amber-400"><Sun className="h-2 w-2" />{d.uvIndex.toFixed(0)}</div>}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Mini({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Cloud }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-center">
      <div className="flex items-center justify-center gap-0.5 text-[10px] text-zinc-400"><Icon className="h-2.5 w-2.5" />{label}</div>
      <div className="font-mono text-xs text-white">{value}</div>
    </div>
  );
}

function Pol({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-center">
      <div className="text-zinc-400">{label}</div>
      <div className="font-mono text-cyan-300">{value?.toFixed?.(1) ?? '—'}</div>
      <div className="text-[9px] text-zinc-400">{unit}</div>
    </div>
  );
}
