'use client';

/**
 * IssPassPanel — real Open Notify ISS pass times for a lat/lon, drop-in
 * for astronomy + space lenses. No API key.
 *
 * Phase 4 (sixth wave) of the UX completeness sprint.
 */

import { useState, useCallback, useEffect } from 'react';
import { Satellite, RefreshCw, AlertTriangle, MapPin, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Pass {
  risetime: number;
  riseTimeIso: string | null;
  durationSeconds: number;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r}s`;
}

const SAMPLE_CITIES = [
  { label: 'New York, NY',    latitude: 40.7128, longitude: -74.0060 },
  { label: 'London, UK',       latitude: 51.5074, longitude: -0.1278 },
  { label: 'Tokyo, JP',        latitude: 35.6762, longitude: 139.6503 },
  { label: 'Sydney, AU',       latitude: -33.8688, longitude: 151.2093 },
  { label: 'São Paulo, BR',    latitude: -23.5505, longitude: -46.6333 },
  { label: 'Mumbai, IN',       latitude: 19.0760, longitude: 72.8777 },
];

export interface IssPassPanelProps {
  domain: 'astronomy' | 'space';
  className?: string;
}

export function IssPassPanel({ domain, className }: IssPassPanelProps) {
  const [city, setCity] = useState(SAMPLE_CITIES[0]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; passes?: Pass[]; reason?: string }>(
      domain, 'live_iss_pass', { latitude: city.latitude, longitude: city.longitude, count: 5 },
    );
    if (r?.ok) setPasses(r.passes || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain, city]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Satellite className="w-4 h-4 text-cyan-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">ISS pass times</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40">
        <select
          value={city.label}
          onChange={(e) => {
            const next = SAMPLE_CITIES.find(c => c.label === e.target.value);
            if (next) setCity(next);
          }}
          className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        >
          {SAMPLE_CITIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
        <div className="text-[10px] text-zinc-500 font-mono mt-1 flex items-center gap-1">
          <MapPin className="w-2.5 h-2.5" />
          {city.latitude.toFixed(4)}, {city.longitude.toFixed(4)}
        </div>
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Open Notify unreachable ({error})
        </div>
      )}

      {!error && passes.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No passes calculated.</div>
      )}

      {passes.length > 0 && (
        <ul className="divide-y divide-zinc-800/40">
          {passes.map((p, i) => (
            <li key={p.risetime} className="px-3 py-2 text-xs flex items-center justify-between">
              <div>
                <div className="text-zinc-200 font-mono">
                  {p.riseTimeIso ? new Date(p.riseTimeIso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </div>
                <div className="text-[10px] text-zinc-500">Pass #{i + 1}</div>
              </div>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1 font-mono">
                <Clock className="w-3 h-3" />
                {fmtDuration(p.durationSeconds)}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Open Notify · open-notify.org
      </footer>
    </section>
  );
}

export default IssPassPanel;
