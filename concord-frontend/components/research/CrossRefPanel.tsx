'use client';

/**
 * CrossRefPanel — real CrossRef DOI metadata search, drop-in for paper +
 * research lenses. No API key (polite User-Agent recommended; the server
 * sets one).
 *
 * Phase 4 (third wave) of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { BookText, RefreshCw, AlertTriangle, ExternalLink, Search, Quote } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CrossRefWork {
  doi: string;
  title: string | null;
  authors: { name: string; orcid: string | null }[];
  publishedYear: number | null;
  containerTitle: string | null;
  publisher: string | null;
  type: string | null;
  subjects: string[];
  citationCount: number | null;
  url: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface CrossRefPanelProps {
  domain: 'paper' | 'research';
  className?: string;
}

export function CrossRefPanel({ domain, className }: CrossRefPanelProps) {
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<CrossRefWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setWorks([]); setTotal(0); return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; works?: CrossRefWork[]; total?: number; fetchedAt?: number; reason?: string }>(
      domain, 'live_crossref', { query: q, limit: 15 },
    );
    if (r?.ok) {
      setWorks(r.works || []);
      setTotal(r.total || 0);
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
        <BookText className="w-4 h-4 text-violet-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">CrossRef · DOI search</h3>
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
          placeholder="Title, author, DOI…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> CrossRef unreachable ({error})
        </div>
      )}

      {!error && !loading && works.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No CrossRef works for that query.</div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">Search 130M+ scholarly works by DOI metadata.</div>
      )}

      {works.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {works.map((w) => (
            <li key={w.doi} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <Quote className="w-3 h-3 text-zinc-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <a
                    href={w.url || `https://doi.org/${w.doi}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-violet-300 leading-snug"
                  >
                    {w.title || w.doi}
                  </a>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {w.publishedYear ? `${w.publishedYear} · ` : ''}
                    {w.containerTitle || w.publisher || ''}
                    {w.doi ? ` · DOI:${w.doi}` : ''}
                    {typeof w.citationCount === 'number' && w.citationCount > 0 ? ` · ${w.citationCount.toLocaleString()} cites` : ''}
                  </div>
                  {w.authors.length > 0 && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {w.authors.slice(0, 4).map(a => a.name).join(', ')}
                      {w.authors.length > 4 && ` +${w.authors.length - 4}`}
                    </div>
                  )}
                  {w.subjects.length > 0 && (
                    <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{w.subjects.slice(0, 3).join(' · ')}</div>
                  )}
                </div>
                {w.url && (
                  <a
                    href={w.url}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-violet-300 shrink-0 text-[10px] flex items-center gap-0.5 mt-0.5"
                    aria-label="Open work"
                  >
                    DOI<ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: CrossRef · {total > 0 && `${total.toLocaleString()} total · `}{updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default CrossRefPanel;
