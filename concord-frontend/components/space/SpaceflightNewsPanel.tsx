'use client';

/**
 * SpaceflightNewsPanel — real Spaceflight News v4 articles, drop-in
 * for astronomy + space lenses. No API key.
 *
 * Phase 4 (fifth wave) of the UX completeness sprint.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Rocket, RefreshCw, AlertTriangle, ExternalLink, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SpaceflightArticle {
  id: number;
  title: string;
  url: string;
  imageUrl: string | null;
  newsSite: string | null;
  summary: string | null;
  publishedAt: string | null;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 3600) return `${Math.max(0, Math.floor(delta / 60))}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

export interface SpaceflightNewsPanelProps {
  domain: 'astronomy' | 'space';
  className?: string;
}

export function SpaceflightNewsPanel({ domain, className }: SpaceflightNewsPanelProps) {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<SpaceflightArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; articles?: SpaceflightArticle[]; reason?: string }>(
      domain, 'live_spaceflight_news', { limit: 12, ...(q ? { query: q } : {}) },
    );
    if (r?.ok) setArticles(r.articles || []);
    else setError(r?.reason || 'fetch_failed');
    setLoading(false);
  }, [domain]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchData(next.trim() || undefined), 600);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Rocket className="w-4 h-4 text-orange-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Spaceflight News</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData(query.trim() || undefined)}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
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
          placeholder="Search articles (optional)…"
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
        />
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" /> Spaceflight News unreachable ({error})
        </div>
      )}

      {!error && !loading && articles.length === 0 && (
        <div className="px-3 py-6 text-xs text-zinc-400 italic text-center">No articles match.</div>
      )}

      {articles.length > 0 && (
        <ul className="divide-y divide-zinc-800/40 max-h-[600px] overflow-y-auto">
          {articles.map((a) => (
            <li key={a.id} className="px-3 py-2.5 text-xs">
              <div className="flex items-start gap-3">
                {a.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imageUrl} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <a
                    href={a.url}
                    target="_blank" rel="noopener noreferrer"
                    className="text-zinc-200 font-medium hover:text-orange-300 leading-snug flex items-center gap-1"
                  >
                    {a.title}
                    <ExternalLink className="w-3 h-3 text-zinc-400 shrink-0" />
                  </a>
                  <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">
                    {a.newsSite && `${a.newsSite} · `}
                    {timeAgo(a.publishedAt)} ago
                  </div>
                  {a.summary && (
                    <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{a.summary}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Spaceflight News API v4 · spaceflightnewsapi.net
      </footer>
    </section>
  );
}

export default SpaceflightNewsPanel;
