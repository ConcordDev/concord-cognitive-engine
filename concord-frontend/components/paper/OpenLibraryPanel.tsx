'use client';

/**
 * OpenLibraryPanel — real Open Library book search, drop-in for paper +
 * education lenses. No API key.
 *
 * Phase 4 of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Library, RefreshCw, AlertTriangle, ExternalLink, Search, BookOpen } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface OpenLibraryBook {
  key: string;
  title: string;
  authors: string[];
  firstPublishYear: number | null;
  isbn: string[];
  publishers: string[];
  subjects: string[];
  pages: number | null;
  coverUrl: string | null;
  openLibraryUrl: string;
  avgRating: number | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface OpenLibraryPanelProps {
  domain: 'paper' | 'education';
  className?: string;
}

export function OpenLibraryPanel({ domain, className }: OpenLibraryPanelProps) {
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<OpenLibraryBook[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setBooks([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; books?: OpenLibraryBook[]; total?: number; fetchedAt?: number; reason?: string }>(
      domain, 'live_openlibrary', { query: q, limit: 12 },
    );
    if (r?.ok) {
      setBooks(r.books || []);
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
        <Library className="w-4 h-4 text-amber-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Open Library · book search</h3>
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
          placeholder="Title, author, ISBN…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          Open Library unreachable ({error})
        </div>
      )}

      {!error && !loading && books.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">No books match.</div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">Search Open Library.</div>
      )}

      {books.length > 0 && (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-3 max-h-[600px] overflow-y-auto">
          {books.map((b) => (
            <li key={b.key} className="rounded border border-zinc-800/80 bg-zinc-900/40 p-2 flex gap-2 hover:border-amber-500/40 transition-colors">
              {b.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.coverUrl} alt="" className="w-12 h-16 rounded object-cover shrink-0" />
              ) : (
                <div className="w-12 h-16 rounded bg-zinc-800/60 shrink-0 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-zinc-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={b.openLibraryUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="text-zinc-200 text-xs font-medium hover:text-amber-300 leading-tight line-clamp-2"
                >
                  {b.title}
                </a>
                {b.authors.length > 0 && (
                  <div className="text-[10px] text-zinc-400 truncate">
                    by {b.authors.slice(0, 2).join(', ')}{b.authors.length > 2 && ` +${b.authors.length - 2}`}
                  </div>
                )}
                <div className="text-[10px] text-zinc-500 truncate">
                  {b.firstPublishYear || ''}{b.pages ? ` · ${b.pages}p` : ''}{b.isbn[0] ? ` · ISBN ${b.isbn[0]}` : ''}
                </div>
                {b.subjects.length > 0 && (
                  <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                    {b.subjects.slice(0, 3).join(' · ')}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: Open Library · {total > 0 && `${total.toLocaleString()} total · `}{updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default OpenLibraryPanel;
