'use client';

/**
 * GbifPanel — real GBIF species + occurrence search, drop-in for
 * environment / forestry / agriculture lenses. No API key.
 *
 * Phase 4 of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Leaf, RefreshCw, AlertTriangle, ExternalLink, Search, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GbifOccurrence {
  key: number;
  country: string | null;
  stateProvince: string | null;
  latitude: number;
  longitude: number;
  eventDate: string | null;
  basisOfRecord: string;
  datasetName: string | null;
}

interface GbifTaxon {
  scientificName: string | null;
  canonicalName: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  rank: string | null;
  status: string | null;
  matchType: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface GbifPanelProps {
  domain: 'environment' | 'forestry' | 'agriculture';
  className?: string;
}

export function GbifPanel({ domain, className }: GbifPanelProps) {
  const [query, setQuery] = useState('');
  const [taxon, setTaxon] = useState<GbifTaxon | null>(null);
  const [occurrences, setOccurrences] = useState<GbifOccurrence[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setTaxon(null);
      setOccurrences([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; taxon?: GbifTaxon; occurrences?: GbifOccurrence[]; total?: number; fetchedAt?: number; reason?: string }>(
      domain, 'live_gbif', { query: q, limit: 20 },
    );
    if (r?.ok) {
      setTaxon(r.taxon || null);
      setOccurrences(r.occurrences || []);
      setTotal(r.total || 0);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Leaf className="w-4 h-4 text-green-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">GBIF · species + occurrences</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query)}
          disabled={loading || !query.trim()}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Species name (e.g. Quercus robur, Apis mellifera)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-green-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          GBIF unreachable ({error})
        </div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">Type a scientific or common name.</div>
      )}

      {taxon && taxon.scientificName && (
        <div className="px-3 py-2 border-b border-zinc-800/40 bg-zinc-900/30">
          <div className="text-sm text-zinc-100 font-medium italic">{taxon.scientificName}</div>
          <div className="text-[10px] text-zinc-400 mt-0.5">
            {[taxon.kingdom, taxon.phylum, taxon.class, taxon.order, taxon.family, taxon.genus].filter(Boolean).join(' › ')}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
            rank: {taxon.rank || '—'} · status: {taxon.status || '—'} · match: {taxon.matchType || '—'}
          </div>
        </div>
      )}

      {occurrences.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] text-zinc-400 font-mono border-b border-zinc-800/40">
            {total.toLocaleString()} total occurrences · showing {occurrences.length}
          </div>
          <ul className="divide-y divide-zinc-800/40 max-h-[400px] overflow-y-auto">
            {occurrences.map((o) => (
              <li key={o.key} className="px-3 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-zinc-400 shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-300 truncate">
                      {[o.country, o.stateProvince].filter(Boolean).join(', ')} · {o.latitude.toFixed(3)}, {o.longitude.toFixed(3)}
                    </div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      {o.eventDate?.slice(0, 10) || '—'} · {o.basisOfRecord}{o.datasetName ? ` · ${o.datasetName}` : ''}
                    </div>
                  </div>
                  <a
                    href={`https://www.gbif.org/occurrence/${o.key}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-green-300 text-[10px] shrink-0"
                    aria-label="Open GBIF record"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: GBIF · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default GbifPanel;
