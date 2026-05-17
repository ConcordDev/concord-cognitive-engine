'use client';

/**
 * OsmGeocodePanel — real OpenStreetMap Nominatim geocode search for
 * the atlas lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Backed by
 * atlas.live_geocode (server/domains/free-api-live.js). Polite-use
 * compliant (1 req/sec, distinct User-Agent set server-side).
 *
 * Search any place; get real lat/lon + bounding box + address
 * components. Click a result to drop a pin on whichever map your atlas
 * lens has mounted (caller wires onSelect to its own pin handler).
 */

import { useState, useCallback, useRef } from 'react';
import { Search, Loader2, MapPin, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GeocodeResult {
  placeId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  category: string;
  type: string;
  importance: number;
  boundingBox: number[] | null;
  address: Record<string, string> | null;
}

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'atlas', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface OsmGeocodePanelProps {
  className?: string;
  onSelect?: (result: GeocodeResult) => void;
  /** Limit results. Default 5. Capped at 20 server-side. */
  limit?: number;
}

export function OsmGeocodePanel({ className, onSelect, limit = 5 }: OsmGeocodePanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; results?: GeocodeResult[]; reason?: string }>(
      'live_geocode', { query: q, limit },
    );
    if (r?.ok && Array.isArray(r.results)) {
      setResults(r.results);
    } else {
      setError(r?.reason || 'fetch_failed');
      setResults([]);
    }
    setLoading(false);
  }, [limit]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Nominatim asks for 1 req/sec — we respect with 600ms debounce.
    debounceRef.current = setTimeout(() => void search(next), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <MapPin className="w-4 h-4 text-emerald-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">OpenStreetMap · Geocode</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
      </header>

      <div className="p-3 border-b border-zinc-800/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search any place — city, landmark, ZIP, country…"
            className="w-full pl-8 pr-8 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-zinc-400" aria-hidden="true" />
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          OpenStreetMap unreachable ({error})
        </div>
      )}

      {!error && results.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="px-3 py-4 text-xs text-zinc-500 italic text-center">
          No matches for &ldquo;{query.trim()}&rdquo;.
        </div>
      )}

      {!error && results.length === 0 && query.trim().length < 2 && (
        <div className="px-3 py-4 text-xs text-zinc-500 italic text-center">
          Type at least 2 characters to search.
        </div>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-zinc-800/60 max-h-[400px] overflow-y-auto">
          {results.map((r) => (
            <li key={r.placeId}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 text-xs hover:bg-zinc-900/60 transition-colors"
                >
                  <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-200 truncate">{r.displayName}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {r.latitude.toFixed(4)}°, {r.longitude.toFixed(4)}° · {r.category}/{r.type}
                    </div>
                  </div>
                </button>
              ) : (
                <div className="flex items-start gap-2 px-3 py-2 text-xs">
                  <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-200 truncate">{r.displayName}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {r.latitude.toFixed(4)}°, {r.longitude.toFixed(4)}° · {r.category}/{r.type}
                    </div>
                  </div>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=14/${r.latitude}/${r.longitude}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-emerald-300 shrink-0 mt-0.5"
                    aria-label="View on OpenStreetMap"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: OpenStreetMap Nominatim · 1 req/sec polite-use
      </footer>
    </section>
  );
}

export default OsmGeocodePanel;
