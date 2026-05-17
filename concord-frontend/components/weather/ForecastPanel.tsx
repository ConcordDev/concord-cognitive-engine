'use client';

/**
 * ForecastPanel — OpenWeatherMap 5-day / 3-hourly forecast.
 * REAL_FREE; requires OPENWEATHERMAP_API_KEY env var.
 *
 * Phase 11 (Item 9). Empty/missing-key/error states are honest.
 */

import { useState, useEffect, useCallback } from 'react';
import { CloudSun, RefreshCw, AlertTriangle, KeyRound, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Forecast {
  dt?: number;
  dtTxt?: string;
  temp?: number;
  feelsLike?: number;
  humidity?: number;
  weather?: string;
  description?: string;
  icon?: string;
  windSpeed?: number;
  pop?: number;
}
interface ForecastResponse {
  ok: boolean;
  source?: string;
  city?: string;
  country?: string | null;
  units?: string;
  forecasts?: Forecast[];
  reason?: string;
  envVar?: string;
  signupUrl?: string;
}

async function runMacro(input: Record<string, unknown>) {
  try { const r = await api.post('/api/lens/run', { domain: 'weather', name: 'live_forecast', input }); return r?.data as ForecastResponse | null; }
  catch { return null; }
}

export interface ForecastPanelProps { className?: string; }

export function ForecastPanel({ className }: ForecastPanelProps) {
  const [city, setCity] = useState('San Francisco');
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (c: string) => {
    setLoading(true);
    const r = await runMacro({ city: c });
    setData(r);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(city); }, [fetchData, city]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <CloudSun className="w-4 h-4 text-sky-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Forecast · {data?.city || city}{data?.country ? `, ${data.country}` : ''}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button type="button" onClick={() => void fetchData(city)} disabled={loading} className="p-1 text-zinc-500 hover:text-zinc-200" aria-label="Refresh">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const c = String(fd.get('city') || '').trim(); if (c) setCity(c); }}
        className="px-3 py-2 border-b border-zinc-800/40 flex gap-2"
      >
        <input
          type="text"
          name="city"
          defaultValue={city}
          placeholder="City name"
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1"
        />
        <button type="submit" className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-200 hover:border-sky-500 hover:text-sky-300">Lookup</button>
      </form>

      {data && !data.ok && data.reason === 'missing_api_key' && (
        <div className="px-3 py-4 text-xs space-y-2 bg-amber-500/5 border-y border-amber-500/20">
          <div className="flex items-center gap-1.5 text-amber-300"><KeyRound className="w-3.5 h-3.5" /> <span className="font-medium">API key required</span></div>
          <p className="text-zinc-300">Set <code className="text-amber-300 bg-zinc-900 px-1 rounded">{data.envVar}</code> in <code className="text-zinc-300 bg-zinc-900 px-1 rounded">.env</code> to enable real OpenWeatherMap forecasts.</p>
          {data.signupUrl && <a href={data.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><ExternalLink className="w-3 h-3" /> Free signup</a>}
        </div>
      )}

      {data && !data.ok && data.reason !== 'missing_api_key' && (
        <div className="px-3 py-3 text-xs text-rose-300/80"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Forecast unreachable ({data.reason || 'unknown'})</div>
      )}

      {data?.ok && (data.forecasts?.length ?? 0) === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No forecast for that location.</div>
      )}

      {data?.ok && data.forecasts && data.forecasts.length > 0 && (
        <ul className="px-3 py-2 space-y-1 max-h-80 overflow-y-auto">
          {data.forecasts.slice(0, 16).map((f, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs">
              <div className="text-[10px] text-zinc-500 font-mono w-28 flex-shrink-0">{f.dtTxt}</div>
              <div className="flex-1 min-w-0 text-zinc-300 truncate">{f.description}</div>
              <div className="text-zinc-200 tabular-nums font-medium w-14 text-right">{f.temp?.toFixed(0)}°</div>
              <div className="text-[10px] text-zinc-500 w-12 text-right tabular-nums">{f.humidity}%</div>
              <div className="text-[10px] text-sky-300/80 w-10 text-right tabular-nums">{f.pop ? `${Math.round(f.pop * 100)}%` : ''}</div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: OpenWeatherMap · openweathermap.org
      </footer>
    </section>
  );
}

export default ForecastPanel;
