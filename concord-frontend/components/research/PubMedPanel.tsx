'use client';

/**
 * PubMedPanel — real PubMed (NCBI E-utilities) feed, drop-in for any
 * lens whose backend registered live_pubmed or live_pubmed_neuro.
 *
 * Phase 4 of the UX completeness sprint. No API key required; rate
 * limited by NCBI to 3 req/sec unauthenticated.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { FlaskConical, RefreshCw, AlertTriangle, ExternalLink, Search, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PubMedArticle {
  pmid: string;
  title: string;
  journal: string;
  pubdate: string;
  authors: string[];
  doi: string | null;
  pubmedUrl: string;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface PubMedPanelProps {
  /** Lens domain to query. */
  domain: string;
  /** Macro to call — defaults to live_pubmed; neuro lens uses live_pubmed_neuro. */
  macro?: string;
  /** Display title. */
  title?: string;
  /** Initial query (required — PubMed needs a search term). */
  initialQuery?: string;
  /** Default max results (1–25). */
  limit?: number;
  className?: string;
}

export function PubMedPanel({ domain, macro = 'live_pubmed', title, initialQuery = '', limit = 12, className }: PubMedPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [articles, setArticles] = useState<PubMedArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setArticles([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; articles?: PubMedArticle[]; total?: number; fetchedAt?: number; reason?: string }>(
      domain, macro, { query: q, limit },
    );
    if (r?.ok) {
      setArticles(r.articles || []);
      setTotal(r.total || 0);
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain, macro, limit]);

  useEffect(() => {
    if (initialQuery) void fetchData(initialQuery);
  }, [fetchData, initialQuery]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <FlaskConical className="w-4 h-4 text-emerald-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          {title || `PubMed · ${domain}`}
        </h3>
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
          placeholder="Search PubMed (free text)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          PubMed unreachable ({error})
        </div>
      )}

      {!error && !loading && articles.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">
          No PubMed articles for that query.
        </div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">
          Type a query to search PubMed.
        </div>
      )}

      {articles.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {articles.map((a) => (
            <li key={a.pmid} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <FileText className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <a
                    href={a.pubmedUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-emerald-300 leading-snug"
                  >
                    {a.title}
                  </a>
                  <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                    {a.journal} · {a.pubdate} · PMID:{a.pmid}
                    {a.doi && ` · DOI:${a.doi}`}
                  </div>
                  {a.authors.length > 0 && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {a.authors.slice(0, 4).join(', ')}{a.authors.length > 4 && ` +${a.authors.length - 4}`}
                    </div>
                  )}
                </div>
                <a
                  href={a.pubmedUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-emerald-300 shrink-0 text-[10px] flex items-center gap-0.5 mt-0.5"
                  aria-label="Open PubMed page"
                >
                  PubMed<ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: PubMed (NCBI) · {total > 0 && `${total.toLocaleString()} total · `}{updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default PubMedPanel;
