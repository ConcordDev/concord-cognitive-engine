'use client';

/**
 * ItunesPodcastPanel — real iTunes podcast directory search, drop-in
 * for the podcast lens. No API key.
 *
 * Phase 4 of the UX completeness sprint.
 */

import { useState, useCallback, useRef } from 'react';
import { Headphones, RefreshCw, AlertTriangle, Search, Rss } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PodcastResult {
  trackId: number;
  collectionId: number;
  name: string;
  artist: string;
  feedUrl: string | null;
  artworkUrl: string | null;
  primaryGenre: string;
  genres: string[];
  releaseDate: string;
  trackCount: number;
  itunesUrl: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export interface ItunesPodcastPanelProps {
  className?: string;
}

export function ItunesPodcastPanel({ className }: ItunesPodcastPanelProps) {
  const [query, setQuery] = useState('');
  const [podcasts, setPodcasts] = useState<PodcastResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q: string) => {
    if (!q.trim()) {
      setPodcasts([]);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; podcasts?: PodcastResult[]; total?: number; fetchedAt?: number; reason?: string }>(
      'podcast', 'live_itunes_search', { query: q, limit: 18 },
    );
    if (r?.ok) {
      setPodcasts(r.podcasts || []);
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
        <Headphones className="w-4 h-4 text-pink-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">iTunes podcast directory</h3>
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
          placeholder="Search podcasts…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-pink-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
          iTunes unreachable ({error})
        </div>
      )}

      {!error && !loading && podcasts.length === 0 && query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          No podcasts for that query.
        </div>
      )}

      {!error && !query.trim() && (
        <div className="px-3 py-6 text-xs text-zinc-500 italic text-center">
          Search the iTunes podcast directory.
        </div>
      )}

      {podcasts.length > 0 && (
        <ul className="grid grid-cols-2 lg:grid-cols-3 gap-2 p-3 max-h-[600px] overflow-y-auto">
          {podcasts.map((p) => (
            <li key={p.trackId} className="rounded border border-zinc-800/80 bg-zinc-900/40 p-2 hover:border-pink-500/40 transition-colors">
              <div className="flex gap-2">
                {p.artworkUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.artworkUrl} alt="" className="w-14 h-14 rounded object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={p.itunesUrl || '#'}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 text-xs font-medium hover:text-pink-300 leading-tight line-clamp-2"
                  >
                    {p.name}
                  </a>
                  <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{p.artist}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{p.primaryGenre}{p.trackCount ? ` · ${p.trackCount} eps` : ''}</div>
                </div>
              </div>
              {p.feedUrl && (
                <a
                  href={p.feedUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-zinc-500 hover:text-pink-300 flex items-center gap-1 mt-1.5"
                >
                  <Rss className="w-2.5 h-2.5" /> RSS feed
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-zinc-800/40">
        Source: iTunes Search API · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default ItunesPodcastPanel;
