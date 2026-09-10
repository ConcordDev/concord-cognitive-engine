'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, lensRun } from '@/lib/api/client';
import {
  Search, X, Loader2, AlertCircle, RefreshCw, Star, Flame, Sparkles, ChevronRight,
} from 'lucide-react';
import {
  RECIPE_TYPES,
  TYPE_META,
  activeWorldId,
  activeAvatarId,
  type RecipeType,
  type RecipeRow,
} from './crafting-shared';

export function MinePanel({ onChanged }: { onChanged: () => void }) {
  const [mine, setMine] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<RecipeType | 'all'>('all');
  const [cooking, setCooking] = useState<string | null>(null);
  const [cookResults, setCookResults] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<RecipeRow | null>(null);
  const [listing, setListing] = useState<{ dtuId: string } | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const loadFavorites = useCallback(async () => {
    const r = await lensRun('crafting', 'favorite_list', {});
    if (r.data?.ok) {
      const favs = (r.data.result as { favorites: Array<{ recipeId: string }> }).favorites;
      setFavorites(new Set(favs.map((f) => f.recipeId)));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const avatarId = activeAvatarId();
      const r = await api.get('/api/personal-locker/dtus', {
        params: { lens: 'concordia', ...(avatarId ? { avatarId } : {}) },
      });
      const all = (r.data?.dtus ?? []) as RecipeRow[];
      const recipes = all.filter((d) => {
        const t = d.meta?.type ?? d.type;
        return t === 'fighting_style_recipe' || t === 'spell_recipe' || t === 'blueprint' || t === 'food_recipe';
      });
      setMine(recipes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  async function toggleFavorite(r: RecipeRow) {
    const res = await lensRun('crafting', 'favorite_toggle', {
      recipeId: r.id,
      recipeName: r.title,
      recipeType: r.meta?.type ?? r.type ?? '',
    });
    if (res.data?.ok) {
      const { favorited } = res.data.result as { favorited: boolean };
      setFavorites((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(r.id); else next.delete(r.id);
        return next;
      });
    }
  }

  useEffect(() => { load(); loadFavorites(); }, [load, loadFavorites]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('concordia:avatar-changed', h);
    return () => window.removeEventListener('concordia:avatar-changed', h);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mine.filter((r) => {
      const t = (r.meta?.type ?? r.type ?? '') as string;
      if (typeFilter !== 'all' && t !== typeFilter) return false;
      if (!q) return true;
      return (
        r.title?.toLowerCase().includes(q) ||
        r.meta?.description?.toLowerCase().includes(q) ||
        t.toLowerCase().includes(q)
      );
    });
  }, [mine, search, typeFilter]);

  async function cookRecipe(recipeId: string) {
    setCooking(recipeId);
    setCookResults((prev) => ({ ...prev, [recipeId]: '' }));
    try {
      const res = await api.post('/api/world/cook', { recipeId, worldId: activeWorldId() });
      const dtuTitle = res.data?.dtu?.title ?? res.data?.itemAdded?.item_name ?? 'cooked dish';
      setCookResults((prev) => ({ ...prev, [recipeId]: `Cooked: ${dtuTitle}` }));
      onChanged();
    } catch (e: unknown) {
      setCookResults((prev) => ({ ...prev, [recipeId]: e instanceof Error ? e.message : 'Cook failed' }));
    } finally {
      setCooking(null);
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
            placeholder="Search recipes…"
            aria-label="Search recipes"
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
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 mb-3">
          <span className="text-sm text-red-300 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
          <button
            onClick={() => { load(); loadFavorites(); }}
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
          {mine.length === 0 ? 'No personal recipes yet. Author one to get started.' : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const recipeType = (r.meta?.type ?? r.type ?? '') as string;
            const isFood = recipeType === 'food_recipe';
            const meta = TYPE_META[recipeType];
            return (
              <li
                key={r.id}
                className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center justify-between gap-3 hover:bg-white/10 transition"
              >
                <button
                  onClick={() => setDetail(r)}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs inline-flex items-center gap-1 ${meta?.color ?? 'text-white/60'}`}>
                      {meta?.icon}{meta?.label ?? recipeType.replace(/_/g, ' ')}
                    </span>
                    <p className="text-sm font-semibold truncate">{r.title}</p>
                  </div>
                  {cookResults[r.id] && (
                    <p className="text-[11px] text-emerald-300 mt-1 inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> {cookResults[r.id]}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleFavorite(r)}
                    className={`p-1 rounded ${favorites.has(r.id) ? 'text-amber-300' : 'text-white/30 hover:text-amber-300'}`}
                    title={favorites.has(r.id) ? 'Unfavorite' : 'Favorite'}
                    aria-label="Toggle favorite"
                  >
                    <Star className={`w-4 h-4 ${favorites.has(r.id) ? 'fill-current' : ''}`} />
                  </button>
                  {isFood && (
                    <button
                      onClick={() => cookRecipe(r.id)}
                      disabled={cooking === r.id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-orange-500/20 border border-orange-500/40 rounded-md text-xs hover:bg-orange-500/30 disabled:opacity-50"
                    >
                      {cooking === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
                      Cook
                    </button>
                  )}
                  <button
                    onClick={() => setListing({ dtuId: r.id })}
                    className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-md text-xs hover:bg-amber-500/30"
                  >
                    List on marketplace
                  </button>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detail && <RecipeDetailModal recipe={detail} onClose={() => setDetail(null)} />}
      {listing && (
        <ListingModal
          dtuId={listing.dtuId}
          onClose={() => setListing(null)}
          onListed={() => { setListing(null); load(); onChanged(); }}
        />
      )}
    </section>
  );
}

function RecipeDetailModal({ recipe, onClose }: { recipe: RecipeRow; onClose: () => void }) {
  const t = (recipe.meta?.type ?? recipe.type ?? '') as string;
  const meta = TYPE_META[t];
  const description =
    recipe.meta?.description ??
    recipe.body?.meta?.description ??
    'No description provided.';

  // ingredients can be a list, a string, or absent — render permissively
  let ingredientsBlock: ReactNode = null;
  const ing = recipe.meta?.ingredients;
  if (Array.isArray(ing)) {
    ingredientsBlock = (
      <ul className="list-disc pl-4 text-xs text-white/70 space-y-0.5">
        {ing.map((i, idx) => (
          <li key={idx}>{typeof i === 'string' ? i : JSON.stringify(i)}</li>
        ))}
      </ul>
    );
  } else if (typeof ing === 'string') {
    ingredientsBlock = <p className="text-xs text-white/70 whitespace-pre-wrap">{ing}</p>;
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="bg-black/95 border border-amber-500/30 rounded-2xl p-5 w-full max-w-md text-white"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-start justify-between mb-3 gap-2">
          <div>
            <div className={`text-xs inline-flex items-center gap-1 ${meta?.color ?? 'text-white/60'} mb-1`}>
              {meta?.icon}{meta?.label ?? t.replace(/_/g, ' ')}
            </div>
            <h3 className="text-base font-bold leading-tight">{recipe.title}</h3>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-white/70 mb-3 whitespace-pre-wrap">{description}</p>
        {ingredientsBlock && (
          <div className="border-t border-white/10 pt-3 mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Ingredients</p>
            {ingredientsBlock}
          </div>
        )}
        {recipe.created_at && (
          <p className="text-[10px] text-white/30 mt-3 font-mono">
            Created {new Date(recipe.created_at).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function ListingModal({
  dtuId, onClose, onListed,
}: { dtuId: string; onClose: () => void; onListed: () => void }) {
  const [listPrice, setListPrice] = useState('15');
  const [listUseTiers, setListUseTiers] = useState(false);
  const [listTierUsage, setListTierUsage] = useState('5');
  const [listTierRemix, setListTierRemix] = useState('15');
  const [listTierCommercial, setListTierCommercial] = useState('60');
  const [listSubmitting, setListSubmitting] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  async function submit() {
    setListSubmitting(true); setListError(null);
    try {
      const price = Number(listPrice);
      if (!Number.isFinite(price) || price <= 0) {
        setListError('Headline price must be a positive number');
        return;
      }
      const body: Record<string, unknown> = { price };
      if (listUseTiers) {
        const usage = Number(listTierUsage);
        const remix = Number(listTierRemix);
        const commercial = Number(listTierCommercial);
        if (![usage, remix, commercial].every((n) => Number.isFinite(n) && n >= 0)) {
          setListError('Each tier price must be a non-negative number');
          return;
        }
        body.tierPrices = { usage, remix, commercial };
      }
      await api.post(
        `/api/personal-locker/dtus/${encodeURIComponent(dtuId)}/list-on-marketplace`,
        body
      );
      onListed();
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'List failed');
    } finally {
      setListSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={() => !listSubmitting && onClose()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="bg-black/95 border border-amber-500/30 rounded-2xl p-5 w-full max-w-md text-white"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">List on marketplace</h3>
          <button
            onClick={() => !listSubmitting && onClose()}
            className="text-white/50 hover:text-white text-sm"
          >
            close
          </button>
        </div>

        <label className="block text-xs text-white/70 mb-1">Headline price (CC)</label>
        <input
          type="number" min={1}
          value={listPrice}
          onChange={(e) => setListPrice(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm mb-3 outline-none focus:border-amber-500/40"
        />

        <label className="flex items-center gap-2 text-xs text-white/70 mb-3">
          <input type="checkbox" checked={listUseTiers} onChange={(e) => setListUseTiers(e.target.checked)} />
          Tier pricing (usage / remix / commercial)
        </label>

        {listUseTiers && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <label className="block text-[11px] text-white/60 mb-1">Usage</label>
              <input type="number" min={0} value={listTierUsage}      onChange={(e) => setListTierUsage(e.target.value)}      className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-white/60 mb-1">Remix</label>
              <input type="number" min={0} value={listTierRemix}      onChange={(e) => setListTierRemix(e.target.value)}      className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-white/60 mb-1">Commercial</label>
              <input type="number" min={0} value={listTierCommercial} onChange={(e) => setListTierCommercial(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
            </div>
          </div>
        )}

        {listError && <p className="text-xs text-red-400 mb-3">{listError}</p>}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={listSubmitting}
            className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={listSubmitting}
            className="px-4 py-1.5 text-xs font-semibold bg-amber-500/20 border border-amber-500/40 rounded hover:bg-amber-500/30 disabled:opacity-50"
          >
            {listSubmitting ? 'Listing…' : 'List'}
          </button>
        </div>
      </div>
    </div>
  );
}
