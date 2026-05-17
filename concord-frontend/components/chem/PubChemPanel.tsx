'use client';

/**
 * PubChemPanel — real PubChem (NIH) compound lookup, drop-in for the
 * chem lens. No API key; free public PUG REST.
 *
 * Phase 4 of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Beaker, RefreshCw, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PubChemCompound {
  cid: number;
  molecularFormula: string;
  molecularWeight: number;
  smiles: string;
  inchiKey: string;
  iupacName: string;
  pubchemUrl: string;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface PubChemPanelProps {
  className?: string;
}

export function PubChemPanel({ className }: PubChemPanelProps) {
  const [query, setQuery] = useState('');
  const [compounds, setCompounds] = useState<PubChemCompound[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setCompounds([]);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; compounds?: PubChemCompound[]; fetchedAt?: number; reason?: string }>(
      'chem', 'live_pubchem', { query: q },
    );
    if (r?.ok) {
      setCompounds(r.compounds || []);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, []);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Beaker className="w-4 h-4 text-cyan-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">PubChem · compound lookup</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query)}
          disabled={loading || !query.trim()}
          className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Compound name (e.g. caffeine, aspirin)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          PubChem unreachable ({error})
        </div>
      )}

      {!error && !loading && compounds.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No PubChem records for that name.
        </div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          Type a compound name to look it up.
        </div>
      )}

      {compounds.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[480px] overflow-y-auto">
          {compounds.map((c) => (
            <li key={c.cid} className="px-3 py-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <a
                    href={c.pubchemUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-cyan-300 leading-snug"
                  >
                    {c.iupacName || `CID ${c.cid}`}
                  </a>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    Formula: {c.molecularFormula} · MW: {c.molecularWeight} · CID:{c.cid}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono break-all">
                    InChIKey: {c.inchiKey}
                  </div>
                  <details className="mt-1">
                    <summary className="text-[11px] text-zinc-400 hover:text-cyan-300 cursor-pointer">SMILES</summary>
                    <code className="block text-[10px] text-zinc-400 mt-1 break-all bg-zinc-900/60 rounded p-1.5 font-mono">{c.smiles}</code>
                  </details>
                </div>
                <a
                  href={c.pubchemUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="text-zinc-500 hover:text-cyan-300 shrink-0 text-[10px] flex items-center gap-0.5 mt-0.5"
                  aria-label="Open PubChem page"
                >
                  PubChem<ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: PubChem (NIH) · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default PubChemPanel;
