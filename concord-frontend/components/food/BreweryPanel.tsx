'use client';

/**
 * BreweryPanel — real Open Brewery DB lookup, drop-in for food + cooking
 * lenses. No API key.
 *
 * Phase 4 (sixth wave) of the UX completeness sprint.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Beer, RefreshCw, AlertTriangle, ExternalLink, MapPin, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Brewery {
  id: string;
  name: string;
  type: string;
  street: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  websiteUrl: string | null;
  phone: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

const TYPE_COLOR: Record<string, string> = {
  micro:    'text-amber-300',
  nano:     'text-amber-200',
  regional: 'text-emerald-300',
  brewpub:  'text-rose-300',
  large:    'text-blue-300',
  planning: 'text-zinc-500',
  closed:   'text-zinc-600',
  contract: 'text-purple-300',
};

export interface BreweryPanelProps {
  domain: 'food' | 'cooking';
  className?: string;
}

export function BreweryPanel({ domain, className }: BreweryPanelProps) {
  const [city, setCity] = useState('');
  const [breweries, setBreweries] = useState<Brewery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (c: string) => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; breweries?: Brewery[]; reason?: string }>(
      domain, 'live_breweries', { ...(c.trim() ? { city: c } : {}), limit: 20 },
    );
    if (r?.ok) setBreweries(r.breweries || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  useEffect(() => { void fetchData(''); }, [fetchData]);

  const onCityChange = (next: string) => {
    setCity(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Beer className="w-4 h-4 text-amber-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Open Brewery DB · US breweries</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(city)}
          disabled={loading}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
        <input
          type="search"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder="Filter by city (or leave empty)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Open Brewery unreachable ({error})
        </div>
      )}

      {!error && breweries.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No breweries match.</div>
      )}

      {breweries.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[500px] overflow-y-auto">
          {breweries.map((b) => (
            <li key={b.id} className="px-3 py-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-zinc-200 font-medium truncate">{b.name}</span>
                    {b.type && (
                      <span className={cn('text-[10px] font-mono', TYPE_COLOR[b.type] || 'text-zinc-500')}>
                        {b.type}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate flex items-center gap-1 mt-0.5">
                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                    {b.street ? `${b.street}, ` : ''}{b.city}, {b.state} {b.postalCode || ''}
                  </div>
                </div>
                {b.websiteUrl && (
                  <a
                    href={b.websiteUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-amber-300 shrink-0 mt-0.5"
                    aria-label="Open website"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Open Brewery DB · openbrewerydb.org
      </footer>
    </section>
  );
}

export default BreweryPanel;
