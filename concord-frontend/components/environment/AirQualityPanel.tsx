'use client';

/**
 * AirQualityPanel — EPA AirNow real-time AQI by ZIP. REAL_FREE;
 * requires EPA_AIRNOW_API_KEY env var.
 *
 * Phase 11 (Item 9). Empty/missing-key/error states are honest.
 */

import { useState, useEffect, useCallback } from 'react';
import { Wind, RefreshCw, AlertTriangle, KeyRound, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Observation {
  reportingArea?: string;
  stateCode?: string;
  parameter?: string;
  aqi?: number;
  category?: string;
  dateObserved?: string;
  hourObserved?: number;
}
interface AQResponse {
  ok: boolean;
  source?: string;
  observations?: Observation[];
  reason?: string;
  envVar?: string;
  signupUrl?: string;
}

function aqiTone(aqi: number | undefined) {
  if (aqi == null) return 'text-zinc-400';
  if (aqi <= 50) return 'text-emerald-300';
  if (aqi <= 100) return 'text-yellow-300';
  if (aqi <= 150) return 'text-orange-300';
  if (aqi <= 200) return 'text-rose-300';
  if (aqi <= 300) return 'text-violet-300';
  return 'text-rose-500';
}

async function runMacro(input: Record<string, unknown>) {
  try { const r = await api.post('/api/lens/run', { domain: 'environment', name: 'live_air_quality', input }); return r?.data as AQResponse | null; }
  catch { return null; }
}

export interface AirQualityPanelProps { className?: string; }

export function AirQualityPanel({ className }: AirQualityPanelProps) {
  const [zip, setZip] = useState('94110');
  const [data, setData] = useState<AQResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (z: string) => {
    setLoading(true);
    const r = await runMacro({ zipCode: z });
    setData(r);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(zip); }, [fetchData, zip]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Wind className="w-4 h-4 text-sky-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Air quality · ZIP {zip}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button type="button" onClick={() => void fetchData(zip)} disabled={loading} className="p-1 text-zinc-500 hover:text-zinc-200" aria-label="Refresh">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const z = String(fd.get('zip') || ''); if (/^\d{5}$/.test(z)) setZip(z); }}
        className="px-3 py-2 border-b border-zinc-800/40 flex gap-2"
      >
        <input
          type="text"
          name="zip"
          defaultValue={zip}
          inputMode="numeric"
          maxLength={5}
          placeholder="5-digit US ZIP"
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 flex-1"
        />
        <button type="submit" className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-200 hover:border-sky-500 hover:text-sky-300">Lookup</button>
      </form>

      {data && !data.ok && data.reason === 'missing_api_key' && (
        <div className="px-3 py-4 text-xs space-y-2 bg-amber-500/5 border-y border-amber-500/20">
          <div className="flex items-center gap-1.5 text-amber-300"><KeyRound className="w-3.5 h-3.5" /> <span className="font-medium">API key required</span></div>
          <p className="text-zinc-300">Set <code className="text-amber-300 bg-zinc-900 px-1 rounded">{data.envVar}</code> in <code className="text-zinc-300 bg-zinc-900 px-1 rounded">.env</code> to enable real AirNow data.</p>
          {data.signupUrl && <a href={data.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"><ExternalLink className="w-3 h-3" /> Free signup</a>}
        </div>
      )}

      {data && !data.ok && data.reason !== 'missing_api_key' && (
        <div className="px-3 py-3 text-xs text-rose-300/80"><AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> AirNow unreachable ({data.reason || 'unknown'})</div>
      )}

      {data?.ok && (data.observations?.length ?? 0) === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No active monitors near that ZIP.</div>
      )}

      {data?.ok && data.observations && data.observations.length > 0 && (
        <ul className="px-3 py-2 space-y-1.5">
          {data.observations.slice(0, 5).map((o, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <div>
                <div className="font-medium text-zinc-200">{o.parameter} · {o.reportingArea}</div>
                <div className="text-[10px] text-zinc-500">{o.dateObserved} {o.hourObserved}:00</div>
              </div>
              <div className="text-right">
                <div className={cn('text-xl font-bold tabular-nums', aqiTone(o.aqi))}>{o.aqi ?? '—'}</div>
                {o.category && <div className="text-[10px] text-zinc-400">{o.category}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: US EPA AirNow · airnowapi.org
      </footer>
    </section>
  );
}

export default AirQualityPanel;
