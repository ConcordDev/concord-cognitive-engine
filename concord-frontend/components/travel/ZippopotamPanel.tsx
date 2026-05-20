'use client';

/**
 * ZippopotamPanel — real Zippopotam.us postal-code lookup, drop-in for
 * travel / retail / logistics lenses. No API key.
 *
 * Phase 4 (sixth wave) of the UX completeness sprint.
 */

import { useState, useCallback } from 'react';
import { MapPin, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Place {
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  state: string | null;
  stateAbbrev: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

const SUPPORTED_COUNTRIES = [
  { code: 'us', label: 'United States' },
  { code: 'ca', label: 'Canada' },
  { code: 'gb', label: 'United Kingdom' },
  { code: 'de', label: 'Germany' },
  { code: 'fr', label: 'France' },
  { code: 'au', label: 'Australia' },
  { code: 'jp', label: 'Japan' },
  { code: 'br', label: 'Brazil' },
  { code: 'mx', label: 'Mexico' },
  { code: 'es', label: 'Spain' },
];

export interface ZippopotamPanelProps {
  domain: 'travel' | 'retail' | 'logistics';
  className?: string;
}

export function ZippopotamPanel({ domain, className }: ZippopotamPanelProps) {
  const [country, setCountry] = useState('us');
  const [postalCode, setPostalCode] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [resolvedPostal, setResolvedPostal] = useState<string | null>(null);
  const [resolvedCountry, setResolvedCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    if (!postalCode.trim()) return;
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; places?: Place[]; postalCode?: string; country?: string; reason?: string }>(
      domain, 'live_zippopotam', { country, postalCode: postalCode.trim() },
    );
    if (r?.ok) {
      setPlaces(r.places || []);
      setResolvedPostal(r.postalCode || postalCode);
      setResolvedCountry(r.country || country);
    } else {
      setPlaces([]);
      setError(r?.reason || 'fetch_failed');
    }
    setLoading(false);
  }, [country, postalCode, domain]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <MapPin className="w-4 h-4 text-cyan-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Postal code lookup</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); void lookup(); }}
        className="px-3 py-2 border-b border-zinc-800/40 flex gap-2 items-center"
      >
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        >
          {SUPPORTED_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
          <input
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            placeholder="Postal code…"
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !postalCode.trim()}
          className="text-xs px-2 py-1.5 rounded bg-cyan-800/40 hover:bg-cyan-800/60 text-cyan-100 border border-cyan-700/60 disabled:opacity-40"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Look up'}
        </button>
      </form>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> {error === 'fetch_failed' ? 'No match (postal code not found)' : `Zippopotam unreachable (${error})`}
        </div>
      )}

      {!error && places.length > 0 && (
        <div>
          <div className="px-3 py-2 bg-zinc-900/30 text-[11px] text-zinc-400 font-mono border-b border-zinc-800/40">
            {resolvedCountry} · {resolvedPostal} → {places.length} place{places.length === 1 ? '' : 's'}
          </div>
          <ul className="divide-y divide-zinc-800/40 max-h-[400px] overflow-y-auto">
            {places.map((p, i) => (
              <li key={i} className="px-3 py-2 text-xs">
                <div className="text-zinc-200 font-medium">{p.placeName || '—'}</div>
                <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  {p.state}{p.stateAbbrev ? ` (${p.stateAbbrev})` : ''}
                  {p.latitude != null && p.longitude != null && (
                    <>  · {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}</>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Zippopotam.us · zippopotam.us
      </footer>
    </section>
  );
}

export default ZippopotamPanel;
