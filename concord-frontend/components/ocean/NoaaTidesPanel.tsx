'use client';

/**
 * NoaaTidesPanel — real NOAA tide predictions for the ocean lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Backed by
 * ocean.live_tides (server/domains/free-api-live.js).
 *
 * Lists hi/lo tide predictions for the next 24h. Station picker
 * (defaults to Boston 8443970); user can paste any 7-digit NOAA
 * CO-OPS station ID.
 */

import { useState, useCallback, useEffect } from 'react';
import { Loader2, Waves, RefreshCw, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Prediction {
  time: string;
  heightMeters: number;
  type: 'high' | 'low';
}

const STATIONS = [
  { id: '8443970', name: 'Boston, MA' },
  { id: '8518750', name: 'The Battery, NY' },
  { id: '9410230', name: 'La Jolla, CA' },
  { id: '9447130', name: 'Seattle, WA' },
  { id: '8665530', name: 'Charleston, SC' },
  { id: '8771341', name: 'Galveston Pier 21, TX' },
  { id: '1611400', name: 'Nawiliwili, HI' },
];

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'ocean', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function NoaaTidesPanel({ className }: { className?: string }) {
  const [station, setStation] = useState(STATIONS[0].id);
  const [stationName, setStationName] = useState(STATIONS[0].name);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{
      ok: boolean; predictions?: Prediction[]; reason?: string; fetchedAt?: number;
    }>('live_tides', { station });
    if (r?.ok && Array.isArray(r.predictions)) {
      setPredictions(r.predictions);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else {
      setError(r?.reason || 'fetch_failed');
    }
    setLoading(false);
  }, [station]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Refresh every 30 min (tide predictions are stable).
  useEffect(() => {
    const id = setInterval(() => { void fetchData(); }, 30 * 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const onStationChange = (id: string) => {
    setStation(id);
    const match = STATIONS.find(s => s.id === id);
    if (match) setStationName(match.name);
  };

  const nextHigh = predictions.find(p => p.type === 'high' && new Date(p.time).getTime() > Date.now());
  const nextLow = predictions.find(p => p.type === 'low' && new Date(p.time).getTime() > Date.now());

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Waves className="w-4 h-4 text-cyan-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">NOAA · Tides · {stationName}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <select
          value={station}
          onChange={(e) => onStationChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-zinc-200 text-[10px]"
          aria-label="NOAA station"
        >
          {STATIONS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
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

      {(nextHigh || nextLow) && !error && (
        <div className="grid grid-cols-2 divide-x divide-zinc-800/60 border-b border-zinc-800/40">
          {nextHigh && (
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">
                <ArrowUp className="w-3 h-3 text-cyan-400" />Next high
              </div>
              <div className="text-sm font-mono text-cyan-200 mt-0.5">{nextHigh.heightMeters.toFixed(2)} m</div>
              <div className="text-[10px] text-zinc-500 font-mono">{nextHigh.time}</div>
            </div>
          )}
          {nextLow && (
            <div className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">
                <ArrowDown className="w-3 h-3 text-zinc-400" />Next low
              </div>
              <div className="text-sm font-mono text-zinc-300 mt-0.5">{nextLow.heightMeters.toFixed(2)} m</div>
              <div className="text-[10px] text-zinc-500 font-mono">{nextLow.time}</div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          NOAA unreachable ({error})
        </div>
      )}

      {!error && predictions.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No tide predictions returned for this station today.
        </div>
      )}

      {predictions.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[300px] overflow-y-auto">
          {predictions.map((p, idx) => (
            <li key={idx} className="flex items-center gap-3 px-3 py-1.5 text-xs">
              <span className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded shrink-0',
                p.type === 'high' ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/30' : 'bg-zinc-900 text-zinc-400 border border-zinc-700',
              )}>
                {p.type === 'high' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              </span>
              <span className="text-zinc-300 font-mono w-32 shrink-0">{p.time}</span>
              <span className="text-zinc-100 font-mono ml-auto">{p.heightMeters.toFixed(2)} m</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: NOAA CO-OPS · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
        {loading && <Loader2 className="inline w-2.5 h-2.5 ml-1 animate-spin" aria-hidden="true" />}
      </footer>
    </section>
  );
}

export default NoaaTidesPanel;
