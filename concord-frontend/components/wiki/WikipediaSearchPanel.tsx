'use client';

/**
 * WikipediaSearchPanel — real Wikipedia REST API search with page-
 * summary inline previews. Drop-in for any lens whose backend
 * registered live_wiki_search.
 *
 * Phase 4 (fourth wave) of the UX completeness sprint. No API key.
 */

import { useState, useCallback, useRef } from 'react';
import { Globe2, RefreshCw, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WikiResult {
  title: string;
  description: string | null;
  extract: string | null;
  thumbnail: string | null;
  url: string | null;
  type: string | null;
  lang: string;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface WikipediaSearchPanelProps {
  domain: string;
  title?: string;
  initialQuery?: string;
  className?: string;
}

export function WikipediaSearchPanel({ domain, title, initialQuery = '', className }: WikipediaSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<WikiResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]); return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; results?: WikiResult[]; fetchedAt?: number; reason?: string }>(
      domain, 'live_wiki_search', { query: q, limit: 10 },
    );
    if (r?.ok) {
      setResults(r.results || []);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Globe2 className="w-4 h-4 text-blue-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          {title || `Wikipedia · ${domain}`}
        </h3>
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
          placeholder="Search Wikipedia…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Wikipedia unreachable ({error})
        </div>
      )}

      {!error && !loading && results.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No Wikipedia matches.</div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">Type a topic to search Wikipedia.</div>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {results.map((r) => (
            <li key={`${r.title}-${r.lang}`} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-3">
                {r.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={r.url || '#'}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-blue-300 leading-snug flex items-center gap-1"
                  >
                    {r.title}
                    {r.url && <ExternalLink className="w-3 h-3 text-zinc-500 shrink-0" />}
                  </a>
                  {r.description && (
                    <div className="text-[10px] text-zinc-500 mt-0.5 italic">{r.description}</div>
                  )}
                  {r.extract && (
                    <p className="text-[11px] text-zinc-400 mt-1 line-clamp-3">{r.extract}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Wikipedia · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default WikipediaSearchPanel;
