'use client';

// Crafting lens — v2.0 entry point for personal recipes + recipe execution.
// Three sub-tabs: My Recipes, Browse Marketplace, Author New.

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { Hammer, ShoppingBag, Plus, Loader2, Flame, Sparkles } from 'lucide-react';

const RecipeAuthorPanel = dynamic(() => import('@/components/concordia/recipes/RecipeAuthorPanel'), { ssr: false });

interface RecipeRow {
  id: string;
  title: string;
  type?: string;
  meta?: { type?: string };
  created_at?: string;
}

interface MarketplaceListing {
  id: string;
  title?: string;
  type?: string;
  price?: number;
  tier_prices?: Record<string, number>;
}

type Tab = 'mine' | 'browse' | 'author';

export default function CraftingPage() {
  const [tab, setTab] = useState<Tab>('mine');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-mine', keys: 'm', description: 'Mine', category: 'navigation', action: () => setTab('mine') },
      { id: 'tab-browse', keys: 'b', description: 'Browse', category: 'navigation', action: () => setTab('browse') },
      { id: 'tab-author', keys: 'a', description: 'Author', category: 'navigation', action: () => setTab('author') },
    ],
    { lensId: 'crafting' }
  );
  const [mine, setMine] = useState<RecipeRow[]>([]);
  const [marketRecipes, setMarketRecipes] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMine() {
    setLoading(true);
    setError(null);
    try {
      const avatarId = typeof window !== 'undefined' ? window.localStorage.getItem('concordia:activeAvatarId') : null;
      const r = await api.get('/api/personal-locker/dtus', { params: { lens: 'concordia', ...(avatarId ? { avatarId } : {}) } });
      const all = (r.data?.dtus ?? []) as Array<RecipeRow>;
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
  }

  async function loadMarketplace() {
    setLoading(true);
    setError(null);
    try {
      // Multi-type search via the `types` (plural) param the route accepts
      // as a comma-separated list. Response shape is { items, total }.
      const r = await api.get('/api/marketplace/artifacts', {
        params: { types: 'fighting_style_recipe,spell_recipe,blueprint' },
      });
      setMarketRecipes((r.data?.items ?? r.data?.artifacts ?? []) as MarketplaceListing[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'mine') loadMine();
    if (tab === 'browse') loadMarketplace();
  }, [tab]);

  // Listen for avatar switches so the recipe roster refreshes when the
  // user activates a different avatar from AvatarSwitcher.
  useEffect(() => {
    function onAvatarChanged() {
      if (tab === 'mine') loadMine();
    }
    window.addEventListener('concordia:avatar-changed', onAvatarChanged);
    return () => window.removeEventListener('concordia:avatar-changed', onAvatarChanged);
  }, [tab]);

  // Inline tier-pricing modal state. Triggered by the "List on
  // marketplace" button in the My Recipes tab. Replaces the prior
  // window.prompt flow with a real form that supports the marketplace's
  // tier-pricing model (e.g. usage / remix / commercial).
  const [listing, setListing] = useState<null | { dtuId: string }>(null);
  const [listPrice, setListPrice] = useState('15');
  const [listUseTiers, setListUseTiers] = useState(false);
  const [listTierUsage, setListTierUsage] = useState('5');
  const [listTierRemix, setListTierRemix] = useState('15');
  const [listTierCommercial, setListTierCommercial] = useState('60');
  const [listSubmitting, setListSubmitting] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  function listOnMarketplace(dtuId: string) {
    setListing({ dtuId });
    setListError(null);
  }

  // Cook a food_recipe DTU. Server wraps craft-engine.executeCraft and
  // stamps spoils_at on the cooked output; the resulting consumable
  // appears in the player's inventory and can be eaten via /api/world/
  // consume/:dtuId (the active-effects HUD picks up the buff in real
  // time).
  const [cooking, setCooking] = useState<string | null>(null);
  const [cookResults, setCookResults] = useState<Record<string, string>>({});

  async function cookRecipe(recipeId: string) {
    setCooking(recipeId);
    setCookResults((prev) => ({ ...prev, [recipeId]: '' }));
    try {
      const res = await api.post('/api/world/cook', { recipeId, worldId: 'concordia-hub' });
      const dtuTitle = res.data?.dtu?.title ?? res.data?.itemAdded?.item_name ?? 'cooked dish';
      setCookResults((prev) => ({ ...prev, [recipeId]: `Cooked: ${dtuTitle}` }));
    } catch (e: unknown) {
      setCookResults((prev) => ({ ...prev, [recipeId]: e instanceof Error ? e.message : 'Cook failed' }));
    } finally {
      setCooking(null);
    }
  }

  async function submitListing() {
    if (!listing) return;
    setListSubmitting(true);
    setListError(null);
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
      await api.post(`/api/personal-locker/dtus/${encodeURIComponent(listing.dtuId)}/list-on-marketplace`, body);
      setListing(null);
      await loadMine();
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : 'List failed');
    } finally {
      setListSubmitting(false);
    }
  }

  return (
    <LensShell lensId="crafting" asMain={false}>
      <ManifestActionBar />
    <main className="min-h-screen p-6 max-w-4xl mx-auto text-white">
      <header className="flex items-center gap-3 mb-6">
        <Hammer className="w-7 h-7 text-amber-400" />
        <h1 className="text-2xl font-bold">Crafting</h1>
        <span className="text-xs text-white/40 ml-2">Personal recipes — fighting styles, spells, blueprints.</span>
      </header>

      <nav className="flex gap-2 mb-6 border-b border-white/10 pb-3">
        <TabButton current={tab} value="mine" label="My Recipes" onClick={() => setTab('mine')} icon={<Hammer className="w-3.5 h-3.5" />} />
        <TabButton current={tab} value="browse" label="Browse Marketplace" onClick={() => setTab('browse')} icon={<ShoppingBag className="w-3.5 h-3.5" />} />
        <TabButton current={tab} value="author" label="Author New" onClick={() => setTab('author')} icon={<Plus className="w-3.5 h-3.5" />} />
      </nav>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {tab === 'mine' && (
        <section>
          {loading ? (
            <div className="flex items-center gap-2 text-white/60"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : mine.length === 0 ? (
            <p className="text-white/50 text-sm">No personal recipes yet. Author one to get started.</p>
          ) : (
            <ul className="space-y-3">
              {mine.map((r) => {
                const recipeType = r.meta?.type ?? r.type ?? '';
                const isFood = recipeType === 'food_recipe';
                return (
                  <li key={r.id} className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{r.title}</p>
                      <p className="text-[11px] text-white/50">{recipeType.replace(/_/g, ' ')}</p>
                      {cookResults[r.id] && (
                        <p className="text-[11px] text-emerald-300 mt-1 inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> {cookResults[r.id]}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
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
                        onClick={() => listOnMarketplace(r.id)}
                        className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-md text-xs hover:bg-amber-500/30"
                      >
                        List on marketplace
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'browse' && (
        <section>
          {loading ? (
            <div className="flex items-center gap-2 text-white/60"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : marketRecipes.length === 0 ? (
            <p className="text-white/50 text-sm">No recipes listed yet.</p>
          ) : (
            <ul className="space-y-3">
              {marketRecipes.map((m) => (
                <li key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{m.title || m.id}</p>
                    <p className="text-[11px] text-white/50">{(m.type ?? '').replace(/_/g, ' ')}</p>
                  </div>
                  <p className="text-sm text-amber-400 font-mono">${m.price ?? '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'author' && (
        <section className="flex justify-center">
          <RecipeAuthorPanel onPublished={() => setTab('mine')} />
        </section>
      )}

      {listing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !listSubmitting && setListing(null)}>
          <div className="bg-black/95 border border-amber-500/30 rounded-2xl p-5 w-full max-w-md text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">List on marketplace</h3>
              <button onClick={() => !listSubmitting && setListing(null)} className="text-white/50 hover:text-white text-sm">close</button>
            </div>

            <label className="block text-xs text-white/70 mb-1">Headline price (sparks)</label>
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
                  <input type="number" min={0} value={listTierUsage} onChange={(e) => setListTierUsage(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[11px] text-white/60 mb-1">Remix</label>
                  <input type="number" min={0} value={listTierRemix} onChange={(e) => setListTierRemix(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[11px] text-white/60 mb-1">Commercial</label>
                  <input type="number" min={0} value={listTierCommercial} onChange={(e) => setListTierCommercial(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-2 text-sm" />
                </div>
              </div>
            )}

            {listError && <p className="text-xs text-red-400 mb-3">{listError}</p>}

            <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
              <button onClick={() => setListing(null)} disabled={listSubmitting} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded">Cancel</button>
              <button onClick={submitListing} disabled={listSubmitting} className="px-4 py-1.5 text-xs font-semibold bg-amber-500/20 border border-amber-500/40 rounded hover:bg-amber-500/30 disabled:opacity-50">
                {listSubmitting ? 'Listing…' : 'List'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </LensShell>
  );
}

function TabButton({ current, value, label, onClick, icon }: { current: Tab; value: Tab; label: string; onClick: () => void; icon: React.ReactNode }) {
  const active = current === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
        active ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/70'
      }`}
    >
      {icon}{label}
    </button>
  );
}
