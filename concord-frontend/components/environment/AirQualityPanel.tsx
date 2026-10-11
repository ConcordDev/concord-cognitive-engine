'use client';

/**
 * AirQualityPanel — current US AQI by ZIP from Open-Meteo (CAMS model).
 * No API key. The request waits for Load AQI; the ZIP field starts at
 * 94110 only as an editable example.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { Wind, RefreshCw, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Observation {
  reportingArea?: string | null;
  stateCode?: string | null;
  parameter?: string;
  parameterName?: string;
  aqi?: number | null;
  category?: string | null;
  dateObserved?: string | null;
  hourObserved?: number | null;
  value?: number | null;
  unit?: string | null;
  pm2_5?: number | null;
  pm10?: number | null;
  ozone?: number | null;
  no2?: number | null;
  co?: number | null;
}
interface AQResponse {
  ok: boolean;
  source?: string;
  sourceNote?: string;
  observations?: Observation[];
  reason?: string;
  error?: string;
}

function aqiTone(aqi: number | null | undefined) {
  if (typeof aqi !== 'number') return 'text-zinc-400';
  if (aqi <= 50) return 'text-emerald-300';
  if (aqi <= 100) return 'text-yellow-300';
  if (aqi <= 150) return 'text-orange-300';
  if (aqi <= 200) return 'text-rose-300';
  if (aqi <= 300) return 'text-violet-300';
  return 'text-rose-500';
}

function readAirQuality(
  data:
    | {
        ok?: boolean;
        result?: unknown;
        error?: string | null;
        reason?: string;
        observations?: Observation[];
      }
    | null
    | undefined
): AQResponse | null {
  if (!data) return null;
  const nested = data.result;
  if (nested && typeof nested === 'object') {
    const payload = nested as AQResponse;
    if (payload.ok === true || payload.reason || payload.observations) {
      if (payload.ok === false) {
        return { ok: false, reason: payload.reason || payload.error || 'unknown' };
      }
      return { ...payload, ok: true };
    }
  }
  if (data.ok === false) return { ok: false, reason: data.reason || data.error || 'unknown' };
  if (data.observations) return { ...(data as AQResponse), ok: true };
  return null;
}

async function runMacro(input: Record<string, unknown>) {
  try {
    const r = await lensRun({ domain: 'environment', name: 'live_air_quality', input });
    return readAirQuality(r?.data);
  } catch {
    return null;
  }
}

const POLLUTANTS: Array<{ key: keyof Observation; label: string }> = [
  { key: 'pm2_5', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'ozone', label: 'Ozone' },
  { key: 'no2', label: 'NO2' },
  { key: 'co', label: 'CO' },
];

export interface AirQualityPanelProps {
  className?: string;
}

export function AirQualityPanel({ className }: AirQualityPanelProps) {
  const [zip, setZip] = useState('94110');
  const [data, setData] = useState<AQResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (z: string) => {
    setLoading(true);
    const r = await runMacro({ zipCode: z });
    setData(r);
    setLoading(false);
  }, []);

  function onLookup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const z = String(new FormData(e.currentTarget).get('zip') || '');
    if (!/^\d{5}$/.test(z)) return;
    setZip(z);
    void fetchData(z);
  }

  const aqiRow = data?.observations?.find((o) => o.parameter === 'US AQI' || o.parameterName === 'US AQI')
    ?? data?.observations?.find((o) => typeof o.aqi === 'number');

  return (
    <section
      className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Wind className="w-4 h-4 text-sky-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Air quality · ZIP {zip}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">Open-Meteo</span>
        <button
          type="button"
          onClick={() => void fetchData(zip)}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <form onSubmit={onLookup} className="px-3 py-2 border-b border-zinc-800/40 flex gap-2">
        <input
          type="text"
          name="zip"
          defaultValue={zip}
          inputMode="numeric"
          maxLength={5}
          placeholder="5-digit US ZIP"
          aria-label="ZIP code"
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1"
        />
        <button
          type="submit"
          disabled={loading}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-200 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
        >
          Load AQI
        </button>
      </form>

      {!data && !loading && (
        <p className="px-3 py-6 text-xs text-zinc-400 text-center">
          Load AQI to query Open-Meteo for this ZIP. Readings are modeled CAMS data, not EPA monitor readings.
        </p>
      )}

      {loading && !data && (
        <p className="px-3 py-6 text-xs text-zinc-400 text-center">Querying Open-Meteo…</p>
      )}

      {data && !data.ok && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Air quality unavailable (
          {data.reason || 'unknown'})
        </div>
      )}

      {data?.ok && !aqiRow && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">
          No air-quality reading for that ZIP.
        </div>
      )}

      {data?.ok && aqiRow && (
        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div>
              <div className="font-medium text-zinc-200">
                US AQI · {aqiRow.reportingArea}
                {aqiRow.stateCode ? `, ${aqiRow.stateCode}` : ''}
              </div>
              <div className="text-[10px] text-zinc-400">
                {aqiRow.dateObserved} {aqiRow.hourObserved != null ? `${aqiRow.hourObserved}:00` : ''}
              </div>
            </div>
            <div className="text-right">
              <div className={cn('text-xl font-bold tabular-nums', aqiTone(aqiRow.aqi))}>
                {typeof aqiRow.aqi === 'number' ? aqiRow.aqi : '—'}
              </div>
              {aqiRow.category && <div className="text-[10px] text-zinc-400">{aqiRow.category}</div>}
            </div>
          </div>
          <ul className="grid grid-cols-5 gap-1">
            {POLLUTANTS.map(({ key, label }) => {
              const value = aqiRow[key];
              return (
                <li key={key} className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-1 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
                  <div className="font-mono text-[11px] text-zinc-200">
                    {typeof value === 'number' ? value : '—'}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Open-Meteo · modeled CAMS, not EPA monitor readings
      </footer>
    </section>
  );
}

export default AirQualityPanel;
