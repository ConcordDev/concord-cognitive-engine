'use client';

/**
 * ForecastPanel — National Weather Service forecast for a US place.
 * Click to load. api.weather.gov needs no key. Outside the US, OpenWeatherMap
 * is used only when its key is configured; otherwise the panel shows an
 * honest unavailable state.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { CloudSun, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Forecast {
  dt?: number | null;
  dtTxt?: string | null;
  temp?: number | null;
  feelsLike?: number | null;
  humidity?: number | null;
  weather?: string | null;
  description?: string | null;
  windSpeed?: string | number | null;
  pop?: number | null;
  temperatureUnit?: string | null;
}
interface CurrentObs {
  description?: string | null;
  tempF?: number | null;
  tempC?: number | null;
  humidity?: number | null;
  observedAt?: string | null;
  stationId?: string | null;
}
interface AlertRow {
  event?: string | null;
  headline?: string | null;
  severity?: string | null;
}
interface ForecastResponse {
  ok: boolean;
  source?: string;
  sourceNote?: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  units?: string;
  forecasts?: Forecast[];
  hourly?: Forecast[];
  current?: CurrentObs | null;
  alerts?: AlertRow[];
  reason?: string;
  error?: string;
  message?: string;
}

function readForecast(body: unknown): ForecastResponse | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as ForecastResponse & { result?: ForecastResponse | null };
  const nested = raw.result && typeof raw.result === 'object' ? raw.result : null;
  const payload = nested && (nested.forecasts || nested.reason || nested.ok != null || nested.source || nested.error)
    ? nested
    : raw;
  if (payload.ok === false || (payload.reason && payload.ok !== true)) {
    return {
      ok: false,
      reason: payload.reason || payload.error || 'unknown',
      error: payload.error,
      message: payload.message,
      source: payload.source,
      city: payload.city,
      country: payload.country,
    };
  }
  if (payload.forecasts || payload.ok === true) return { ...payload, ok: true };
  if (raw.ok === false) return { ok: false, reason: raw.error || raw.reason || 'unknown' };
  return null;
}

async function runMacro(input: Record<string, unknown>) {
  try {
    const r = await api.post('/api/lens/run', { domain: 'weather', name: 'live_forecast', input });
    return readForecast(r?.data);
  } catch (e) {
    const body = (e as { response?: { data?: unknown } })?.response?.data;
    return readForecast(body) || { ok: false, reason: 'upstream_unreachable' };
  }
}

export interface ForecastPanelProps { className?: string; }

export function ForecastPanel({ className }: ForecastPanelProps) {
  const [city, setCity] = useState('San Francisco');
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (c: string) => {
    setLoading(true);
    const r = await runMacro({ city: c });
    setData(r);
    setLoading(false);
  }, []);

  function onLookup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = String(new FormData(e.currentTarget).get('city') || '').trim();
    if (!c) return;
    setCity(c);
    void fetchData(c);
  }

  const place = [data?.city || city, data?.state, data?.country].filter(Boolean).join(', ');
  const outside = data && !data.ok && data.reason === 'unavailable_outside_us';

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <CloudSun className="w-4 h-4 text-sky-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Forecast · {place}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">NWS</span>
        <button type="button" onClick={() => void fetchData(city)} disabled={loading} className="p-1 text-zinc-400 hover:text-zinc-200" aria-label="Refresh">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <form onSubmit={onLookup} className="px-3 py-2 border-b border-zinc-800/40 flex gap-2">
        <input
          type="text"
          name="city"
          defaultValue={city}
          placeholder="US city"
          aria-label="City"
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1"
        />
        <button type="submit" disabled={loading} className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-200 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50">
          Load forecast
        </button>
      </form>

      {!data && !loading && (
        <p className="px-3 py-6 text-xs text-zinc-400 text-center">
          Load the forecast to query the National Weather Service for this place.
        </p>
      )}

      {loading && !data && (
        <p className="px-3 py-6 text-xs text-zinc-400 text-center">Querying api.weather.gov…</p>
      )}

      {outside && (
        <div className="px-3 py-3 text-xs text-amber-200/90">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> {data.message || 'unavailable outside the US'}
        </div>
      )}

      {data && !data.ok && !outside && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Forecast unavailable ({data.reason || data.error || 'unknown'})
        </div>
      )}

      {data?.ok && data.current && (data.current.tempF != null || data.current.description) && (
        <div className="px-3 py-2 text-xs border-b border-zinc-800/40 flex items-baseline justify-between gap-2">
          <div className="text-zinc-200">
            {data.current.description || 'Observation'}
            {data.current.stationId ? <span className="text-zinc-500"> · {data.current.stationId}</span> : null}
          </div>
          <div className="font-mono text-zinc-100">
            {data.current.tempF != null ? `${Math.round(data.current.tempF)}°F` : '—'}
            {typeof data.current.humidity === 'number' ? <span className="text-zinc-400"> · {Math.round(data.current.humidity)}%</span> : null}
          </div>
        </div>
      )}

      {data?.ok && data.alerts && data.alerts.length > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-amber-200 border-b border-zinc-800/40">
          {data.alerts[0].event || data.alerts[0].headline}
          {data.alerts.length > 1 ? ` · ${data.alerts.length} alerts` : ''}
        </div>
      )}

      {data?.ok && (data.forecasts?.length ?? 0) === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No forecast for that location.</div>
      )}

      {data?.ok && data.forecasts && data.forecasts.length > 0 && (
        <ul className="px-3 py-2 space-y-1 max-h-80 overflow-y-auto">
          {data.forecasts.slice(0, 16).map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="text-[10px] text-zinc-400 font-mono w-28 flex-shrink-0">{f.dtTxt}</div>
              <div className="flex-1 min-w-0 text-zinc-300 truncate">{f.description}</div>
              <div className="text-zinc-200 tabular-nums font-medium w-14 text-right">
                {typeof f.temp === 'number' ? `${Math.round(f.temp)}°${f.temperatureUnit || ''}` : '—'}
              </div>
              <div className="text-[10px] text-zinc-400 w-12 text-right tabular-nums">
                {typeof f.humidity === 'number' ? `${Math.round(f.humidity)}%` : ''}
              </div>
              <div className="text-[10px] text-sky-300/80 w-10 text-right tabular-nums">
                {typeof f.pop === 'number' ? `${Math.round(f.pop * 100)}%` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        {data?.source?.includes('OpenWeatherMap')
          ? 'Source: OpenWeatherMap · openweathermap.org'
          : 'Source: National Weather Service · api.weather.gov'}
      </footer>
    </section>
  );
}

export default ForecastPanel;
