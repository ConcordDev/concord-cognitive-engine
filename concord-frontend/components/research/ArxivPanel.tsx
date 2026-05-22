'use client';

/**
 * ArxivPanel — real arXiv feed, drop-in for any lens whose backend
 * registered the arXiv live macro (physics, quantum, robotics, neuro,
 * bio, chem, math, ml, ai).
 *
 * Phase 4 of the 10-dimension UX completeness sprint.
 *
 * Sorted by submission date desc. Search-as-you-type (debounced 600ms)
 * filters within the category. Each paper has authors / published date
 * / abstract preview / PDF link / arXiv landing-page link.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { BookText, RefreshCw, AlertTriangle, ExternalLink, Search, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ArxivPaper {
  arxivId: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  authors: string[];
  abstractUrl: string;
  pdfUrl: string;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface ArxivPanelProps {
  /** Domain to query; must be one that registered live_arxiv. */
  domain: string;
  /** Display title. Defaults to "arXiv · <domain>". */
  title?: string;
  /** Default max results. Default 15, max 30. */
  limit?: number;
  className?: string;
}

export function ArxivPanel({ domain, title, limit = 15, className }: ArxivPanelProps) {
  const [query, setQuery] = useState('');
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [category, setCategory] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; papers?: ArxivPaper[]; category?: string; fetchedAt?: number; reason?: string }>(
      domain, 'live_arxiv', { limit, ...(q ? { query: q } : {}) },
    );
    if (r?.ok) {
      setPapers(r.papers || []);
      setCategory(r.category || '');
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
    } else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain, limit]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next.trim() || undefined), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <BookText className="w-4 h-4 text-indigo-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">
          {title || `arXiv · ${domain}`}
          {category && <span className="ml-2 text-[10px] font-mono text-zinc-500">cat:{category}</span>}
        </h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query.trim() || undefined)}
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
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter within category (free text)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          arXiv unreachable ({error})
        </div>
      )}

      {!error && papers.length === 0 && !loading && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No papers returned. Try a broader query.
        </div>
      )}

      {papers.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {papers.map((p) => (
            <li key={p.arxivId} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-2">
                <FileText className="w-3 h-3 text-zinc-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <a
                    href={p.abstractUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-indigo-300 leading-snug"
                  >
                    {p.title}
                  </a>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {p.published?.slice(0, 10)} · {p.authors.slice(0, 3).join(', ')}
                    {p.authors.length > 3 && ` +${p.authors.length - 3}`}
                    {p.arxivId && ` · ${p.arxivId}`}
                  </div>
                  <details className="mt-1">
                    <summary className="text-[11px] text-zinc-400 hover:text-indigo-300 cursor-pointer">Abstract</summary>
                    <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed line-clamp-6">{p.summary}</p>
                  </details>
                </div>
                <a
                  href={p.pdfUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="text-zinc-500 hover:text-indigo-300 shrink-0 text-[10px] flex items-center gap-0.5 mt-0.5"
                  aria-label="Open PDF"
                >
                  PDF<ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: arXiv · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default ArxivPanel;
