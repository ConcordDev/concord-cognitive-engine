'use client';

// Crafting lens — v2.0 entry point for personal recipes + recipe execution.
// Three sub-tabs: My Recipes, Browse Marketplace, Author New.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { Hammer, ShoppingBag, Plus, Loader2 } from 'lucide-react';

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
  const [mine, setMine] = useState<RecipeRow[]>([]);
  const [marketRecipes, setMarketRecipes] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMine() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/api/personal-locker/dtus', { params: { lens: 'concordia' } });
      const all = (r.data?.dtus ?? []) as Array<RecipeRow>;
      const recipes = all.filter((d) => {
        const t = d.meta?.type ?? d.type;
        return t === 'fighting_style_recipe' || t === 'spell_recipe' || t === 'blueprint';
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
      // Existing marketplace listings endpoint, filtered by recipe artifact types.
      const r = await api.get('/api/marketplace/artifacts', {
        params: { type: 'fighting_style_recipe,spell_recipe,blueprint' },
      });
      setMarketRecipes((r.data?.artifacts ?? []) as MarketplaceListing[]);
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

  async function listOnMarketplace(dtuId: string) {
    const priceStr = window.prompt('Headline price (e.g. 15):', '15');
    if (!priceStr) return;
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) {
      window.alert('Invalid price');
      return;
    }
    try {
      await api.post(`/api/personal-locker/dtus/${encodeURIComponent(dtuId)}/list-on-marketplace`, { price });
      await loadMine();
    } catch (e: unknown) {
      window.alert(`List failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return (
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
              {mine.map((r) => (
                <li key={r.id} className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="text-[11px] text-white/50">{(r.meta?.type ?? r.type ?? '').replace(/_/g, ' ')}</p>
                  </div>
                  <button
                    onClick={() => listOnMarketplace(r.id)}
                    className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-md text-xs hover:bg-amber-500/30"
                  >
                    List on marketplace
                  </button>
                </li>
              ))}
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
    </main>
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
