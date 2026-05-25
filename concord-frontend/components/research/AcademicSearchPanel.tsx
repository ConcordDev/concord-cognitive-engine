'use client';

import { useCallback, useState } from 'react';
import { BookmarkPlus, ExternalLink, Loader2, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Work {
  id: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  openAccessUrl: string | null;
  url: string | null;
  abstract: string | null;
  source: string;
}

type Provider = 'openalex' | 'arxiv';

/**
 * AcademicSearchPanel — Elicit-style live academic search across
 * OpenAlex / arXiv (free, keyless). Results import straight into the
 * reference library. No fake data — all rows come from the live APIs.
 */
export function AcademicSearchPanel() {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<Provider>('openalex');
  const [results, setResults] = useState<Work[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);

  const search = useCallback(async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const r = await lensRun<{ results: Work[] }>('research', 'academic-search', {
        query: query.trim(),
        provider,
        limit: 20,
      });
      if (r.data?.ok && r.data.result) {
        setResults(r.data.result.results || []);
      } else {
        setError(r.data?.error || 'Search failed');
        setResults([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, provider]);

  const importWork = useCallback(async (w: Work, key: string) => {
    try {
      const r = await lensRun('research', 'academic-import', { work: w });
      if (r.data?.ok) {
        setImported((prev) => new Set(prev).add(key));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="Search academic literature…"
            className="w-full pl-7 pr-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
          />
        </div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-200"
        >
          <option value="openalex">OpenAlex</option>
          <option value="arxiv">arXiv</option>
        </select>
        <button
          type="button"
          onClick={search}
          disabled={loading || query.trim().length < 2}
          className="px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded p-2">
          {error}
        </p>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <p className="text-center text-xs text-gray-400 py-6">No results found.</p>
      )}

      <div className="space-y-2">
        {results.map((w, i) => {
          const key = w.id || `${w.title}-${i}`;
          const isImported = imported.has(key);
          return (
            <div key={key} className="rounded border border-white/10 bg-black/20 p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-gray-100 flex-1">{w.title}</p>
                <button
                  type="button"
                  onClick={() => importWork(w, key)}
                  disabled={isImported}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-[10px] text-fuchsia-200 disabled:opacity-50"
                >
                  <BookmarkPlus className="w-3 h-3" />
                  {isImported ? 'Imported' : 'Add to library'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                {w.authors.slice(0, 4).join(', ')}
                {w.authors.length > 4 ? ' et al.' : ''}
                {w.year ? ` · ${w.year}` : ''}
                {w.venue ? ` · ${w.venue}` : ''}
              </p>
              {w.abstract && (
                <p className="text-[11px] text-gray-400 line-clamp-3">{w.abstract}</p>
              )}
              <div className="flex items-center gap-3 text-[10px] text-gray-400">
                {typeof w.citationCount === 'number' && (
                  <span className="text-amber-300">{w.citationCount} citations</span>
                )}
                {w.openAccessUrl && (
                  <a
                    href={w.openAccessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-emerald-300 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> Open access
                  </a>
                )}
                {w.url && (
                  <a
                    href={w.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-sky-300 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> Source
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AcademicSearchPanel;
