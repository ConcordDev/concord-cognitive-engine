'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Star, StarOff, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface TokenSummary {
  id: string;
  symbol: string;
  name: string;
  iconUrl?: string;
  priceUsd: number;
  change24h: number;
  marketCap: number;
  rank?: number;
}

interface TokenSearchProps {
  watchlist?: string[];
  onToggleWatch?: (id: string) => void;
  onSelect?: (token: TokenSummary) => void;
  className?: string;
}

const STORAGE_KEY = 'concord:crypto:watchlist:v1';

export function loadWatchlist(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ['bitcoin', 'ethereum', 'solana'];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function saveWatchlist(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* noop */ }
}

export function TokenSearch({ watchlist = [], onToggleWatch, onSelect, className }: TokenSearchProps) {
  const [query, setQuery] = useState('');
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  useEffect(() => {
    refresh(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function refresh(p: number) {
    setLoading(true); setError(null);
    try {
      const res = await lensRun({
        domain: 'crypto',
        action: 'search-tokens',
        input: { query: query.trim(), page: p, pageSize: PAGE_SIZE },
      });
      const items = (res.data?.result?.tokens || []) as TokenSummary[];
      setTokens(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally { setLoading(false); }
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    refresh(1);
  }

  const watchSet = useMemo(() => new Set(watchlist), [watchlist]);

  const visible = useMemo(() => {
    if (!query.trim()) return tokens;
    const q = query.toLowerCase();
    return tokens.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }, [tokens, query]);

  return (
    <div className={cn('flex flex-col bg-[#0d1117] border border-lattice-border rounded overflow-hidden', className)}>
      <form onSubmit={onSearch} className="p-2 border-b border-white/10 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by symbol, name, or CoinGecko id…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
        </div>
        <button type="submit" className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">
          Search
        </button>
      </form>
      <div className="grid grid-cols-12 px-3 py-1.5 border-b border-white/5 text-[10px] uppercase tracking-wider text-gray-500">
        <span className="col-span-1">#</span>
        <span className="col-span-4">Token</span>
        <span className="col-span-3 text-right">Price</span>
        <span className="col-span-2 text-right">24h</span>
        <span className="col-span-2 text-right">Watch</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading market data…
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-xs text-red-400 text-center">{error}</div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-10 text-xs text-gray-500 text-center">No tokens match.</div>
        ) : (
          <ul>
            {visible.map(t => {
              const watched = watchSet.has(t.id);
              const up = t.change24h >= 0;
              return (
                <li key={t.id} className="grid grid-cols-12 px-3 py-1.5 items-center hover:bg-white/[0.03] text-xs border-b border-white/5">
                  <span className="col-span-1 text-gray-500">{t.rank ?? '·'}</span>
                  <button
                    onClick={() => onSelect?.(t)}
                    className="col-span-4 flex items-center gap-2 text-left hover:text-cyan-300"
                  >
                    {t.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.iconUrl} alt="" className="w-5 h-5 rounded-full" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 inline-flex items-center justify-center text-[9px] font-bold">{t.symbol.slice(0, 2)}</span>
                    )}
                    <div className="min-w-0">
                      <div className="text-white truncate">{t.name}</div>
                      <div className="text-[9px] text-gray-500 uppercase">{t.symbol}</div>
                    </div>
                  </button>
                  <span className="col-span-3 text-right text-white tabular-nums">${t.priceUsd?.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  <span className={cn('col-span-2 text-right tabular-nums inline-flex items-center justify-end gap-0.5', up ? 'text-green-400' : 'text-red-400')}>
                    {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {t.change24h?.toFixed(2)}%
                  </span>
                  <button
                    onClick={() => onToggleWatch?.(t.id)}
                    className="col-span-2 flex justify-end pr-1"
                    title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {watched ? <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" /> : <StarOff className="w-3.5 h-3.5 text-gray-500 hover:text-yellow-300" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="px-3 py-2 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-500">
        <span>Page {page} · {visible.length} shown</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="px-2 py-0.5 rounded border border-white/10 hover:text-white disabled:opacity-40"
          >Prev</button>
          <button
            disabled={loading}
            onClick={() => setPage(p => p + 1)}
            className="px-2 py-0.5 rounded border border-white/10 hover:text-white disabled:opacity-40"
          >Next</button>
        </div>
      </footer>
    </div>
  );
}

export default TokenSearch;
