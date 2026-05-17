'use client';

/**
 * UsgsQuakePanel — real USGS earthquake feed for the geology lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Same wire
 * pattern as NasaLivePanel — proves the REAL_FREE tier for geology.
 *
 * Lists the past 24 hours of M2.5+ earthquakes, sorted by magnitude
 * descending, with tsunami flag, depth, and a click-through to USGS
 * event page. Refresh-on-demand button + auto-refresh every 60s.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Activity, AlertTriangle, RefreshCw, Waves, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Quake {
  id: string;
  magnitude: number;
  place: string;
  timeMs: number;
  depthKm: number;
  latitude: number;
  longitude: number;
  tsunami: boolean;
  url: string;
}

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'geology', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

function magColour(m: number): string {
  if (m >= 6) return 'text-rose-300 bg-rose-950/60 border-rose-500/40';
  if (m >= 5) return 'text-amber-300 bg-amber-950/60 border-amber-500/40';
  if (m >= 4) return 'text-yellow-300 bg-yellow-950/60 border-yellow-500/40';
  if (m >= 3) return 'text-sky-300 bg-sky-950/60 border-sky-500/40';
  return 'text-zinc-400 bg-zinc-900 border-zinc-700';
}

function formatRelative(ms: number): string {
  const diffSec = (Date.now() - ms) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function UsgsQuakePanel({ className, minMagnitude = 2.5 }: { className?: string; minMagnitude?: number }) {
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [minMag, setMinMag] = useState(minMagnitude);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; quakes?: Quake[]; total?: number; reason?: string; fetchedAt?: number }>(
      'live_quakes_today',
      { minMagnitude: minMag },
    );
    if (r?.ok && Array.isArray(r.quakes)) {
      setQuakes(r.quakes);
      setTotal(r.total || r.quakes.length);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else {
      setError(r?.reason || 'fetch_failed');
    }
    setLoading(false);
  }, [minMag]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Auto-refresh every 60s.
  useEffect(() => {
    const id = setInterval(() => { void fetchData(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Activity className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">USGS · Earthquakes (24h)</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <label className="text-[10px] text-zinc-500 flex items-center gap-1">
          ≥M
          <select
            className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200 font-mono text-[10px]"
            value={minMag}
            onChange={(e) => setMinMag(parseFloat(e.target.value))}
          >
            <option value="2.5">2.5</option>
            <option value="4.5">4.5</option>
          </select>
        </label>
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

      <div className="px-3 py-2 border-b border-zinc-800/40 text-[10px] text-zinc-500 flex items-center gap-2">
        <span>{total} events ≥M{minMag.toFixed(1)}</span>
        {updatedAt && <span className="ml-auto font-mono">updated {new Date(updatedAt * 1000).toLocaleTimeString()}</span>}
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          USGS unreachable ({error})
        </div>
      )}

      {!error && quakes.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No quakes ≥M{minMag.toFixed(1)} in the past 24 hours.
        </div>
      )}

      {quakes.length > 0 && (
        <ul className="divide-y divide-zinc-800/60 max-h-[600px] overflow-y-auto">
          {quakes.map((q) => (
            <li key={q.id} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-zinc-900/40 transition-colors">
              <span className={cn(
                'inline-flex items-center justify-center w-9 h-9 rounded-md border font-mono font-semibold text-xs shrink-0',
                magColour(q.magnitude),
              )}>
                {q.magnitude.toFixed(1)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200 truncate">{q.place || 'Unknown location'}</span>
                  {q.tsunami && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shrink-0">
                      <Waves className="w-2.5 h-2.5" />tsunami
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  depth {q.depthKm?.toFixed(1) ?? '—'} km · {q.latitude?.toFixed(2)}°, {q.longitude?.toFixed(2)}° · {formatRelative(q.timeMs)}
                </div>
              </div>
              {q.url && (
                <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-amber-400 shrink-0" aria-label="USGS event details">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: USGS Earthquake Catalog · auto-refresh 60s
        {loading && <Loader2 className="inline w-2.5 h-2.5 ml-1 animate-spin" aria-hidden="true" />}
      </footer>
    </section>
  );
}

export default UsgsQuakePanel;
