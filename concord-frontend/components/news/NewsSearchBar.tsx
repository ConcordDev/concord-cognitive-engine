'use client';

/**
 * NewsSearchBar — real full-text search over the personalized-reader article
 * directory, wired to `news.article-search` (title/source/topic/summary
 * substring match server-side). Distinct from the Live Desk's client-side
 * source filter: this searches the STATE-backed directory that follows,
 * saves, alerts and offline sync all read from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { NewsArticleCard, type NewsArticle } from './NewsArticleCard';

export function NewsSearchBar({ onChange }: { onChange?: () => void } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NewsArticle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    const r = await lensRun('news', 'article-search', { query: q.trim() });
    setResults(r.data?.ok ? (r.data.result?.articles as NewsArticle[]) || [] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(query); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  const clear = () => { setQuery(''); setResults(null); };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <div className="relative p-3">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your article directory — title, source, topic, summary…"
          className="input-lattice w-full pl-9 pr-9 text-sm"
        />
        {query && (
          <button type="button" onClick={clear} aria-label="Clear search"
            className="absolute right-6 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 px-4 pb-3 text-[11px] text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </div>
      )}

      {!loading && results !== null && (
        <div className="border-t border-zinc-800 px-3 py-3">
          {results.length === 0 ? (
            <p className="text-[11px] italic text-zinc-500">No articles match &ldquo;{query}&rdquo;.</p>
          ) : (
            <>
              <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {results.map((a) => (
                  <NewsArticleCard key={a.id} article={a} onChange={() => { void search(query); onChange?.(); }} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
