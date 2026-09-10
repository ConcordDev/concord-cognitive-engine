'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import {
  Search, X, Loader2, AlertCircle, RefreshCw, Coins,
} from 'lucide-react';
import {
  RECIPE_TYPES,
  TYPE_META,
  type RecipeType,
  type MarketplaceListing,
} from './crafting-shared';

export function BrowsePanel({ onPurchased }: { onPurchased: () => void }) {
  const [items, setItems] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<RecipeType | 'all'>('all');
  const [sort, setSort] = useState<'newest' | 'price-asc' | 'price-desc'>('newest');
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [bought, setBought] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get('/api/marketplace/artifacts', {
        params: { types: 'fighting_style_recipe,spell_recipe,blueprint,food_recipe' },
      });
      setItems((r.data?.items ?? r.data?.artifacts ?? []) as MarketplaceListing[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = items.slice();
    if (typeFilter !== 'all') arr = arr.filter((m) => m.type === typeFilter);
    if (q) arr = arr.filter((m) => (m.title ?? m.id).toLowerCase().includes(q));
    if (sort === 'price-asc')  arr.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    if (sort === 'price-desc') arr.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    return arr;
  }, [items, search, typeFilter, sort]);

  async function buy(dtuId: string, title: string) {
    setPurchasing(dtuId);
    try {
      const r = await api.post('/api/marketplace/purchaseWithRoyalties', { dtuId });
      if (r.data?.ok) {
        setBought((prev) => ({ ...prev, [dtuId]: `Purchased: ${title}` }));
        onPurchased();
      } else {
        setBought((prev) => ({ ...prev, [dtuId]: r.data?.error ?? 'Purchase failed' }));
      }
    } catch (e: unknown) {
      type AxiosLike = { response?: { data?: { error?: string } }; message?: string };
      const ax = e as AxiosLike;
      setBought((prev) => ({
        ...prev,
        [dtuId]: ax.response?.data?.error ?? ax.message ?? 'Purchase failed',
      }));
    } finally {
      setPurchasing(null);
    }
  }

  return (
    <section>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 flex-1">
          <Search className="w-3.5 h-3.5 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search marketplace…"
            aria-label="Search marketplace"
            className="bg-transparent outline-none text-sm flex-1 placeholder:text-white/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-white/40 hover:text-white" aria-label="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as RecipeType | 'all')}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
        >
          <option value="all">All types</option>
          {RECIPE_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'newest' | 'price-asc' | 'price-desc')}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
        >
          <option value="newest">Newest</option>
          <option value="price-asc">Price ↑</option>
          <option value="price-desc">Price ↓</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 mb-3">
          <span className="text-sm text-red-300 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
          <button
            onClick={load}
            className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-white/60">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : error ? null : filtered.length === 0 ? (
        <p className="text-white/50 text-sm">
          {items.length === 0 ? 'No recipes listed yet.' : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => {
            const meta = TYPE_META[(m.type ?? '') as string];
            const status = bought[m.id];
            return (
              <li key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs inline-flex items-center gap-1 ${meta?.color ?? 'text-white/60'}`}>
                      {meta?.icon}{meta?.label ?? (m.type ?? '').replace(/_/g, ' ')}
                    </span>
                    <p className="text-sm font-semibold truncate">{m.title || m.id}</p>
                  </div>
                  {m.creator_handle && (
                    <p className="text-[11px] text-white/50 mt-0.5">by {m.creator_handle}</p>
                  )}
                  {m.tier_prices && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(m.tier_prices).map(([tier, price]) => (
                        <span key={tier} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/70">
                          {tier}: {price}
                        </span>
                      ))}
                    </div>
                  )}
                  {status && <p className="text-[11px] text-white/70 mt-1">{status}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm text-amber-400 font-mono">
                    {m.price != null ? `${m.price} CC` : '—'}
                  </span>
                  <button
                    onClick={() => buy(m.id, m.title || m.id)}
                    disabled={purchasing === m.id}
                    className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-md text-xs hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {purchasing === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}
                    Buy
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
