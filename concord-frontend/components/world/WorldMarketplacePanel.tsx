'use client';

import { useEffect, useState, useCallback } from 'react';
import { Store, X, Loader2, Sparkles, Hammer, ScrollText, Flame } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface MarketplaceListing {
  id: string;
  kind: string;
  title: string;
  price: number;
  currency: string;
  sellerName: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | string;
}

interface Props {
  worldId: string;
  open: boolean;
  onClose: () => void;
}

const KIND_TABS = [
  { id: 'all',                     label: 'All',         icon: Store },
  { id: 'spell_recipe',            label: 'Spells',      icon: Sparkles },
  { id: 'blueprint',               label: 'Blueprints',  icon: Hammer },
  { id: 'fighting_style_recipe',   label: 'Recipes',     icon: Flame },
  { id: 'dtu',                     label: 'DTUs',        icon: ScrollText },
] as const;

const RARITY_COLOR: Record<string, string> = {
  common:    'text-gray-300',
  uncommon:  'text-emerald-300',
  rare:      'text-cyan-300',
  legendary: 'text-amber-300',
};

export function WorldMarketplacePanel({ worldId, open, onClose }: Props) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<string>('all');
  const [source, setSource] = useState<'marketplace-per-world' | 'global-listings' | 'dtu-corpus' | 'empty'>('empty');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'world',
        action: 'marketplace-summary',
        input: { worldId, kind: activeKind },
      });
      const result = (res.data as {
        result?: { listings?: MarketplaceListing[]; source?: 'marketplace-per-world' | 'global-listings' | 'dtu-corpus' | 'empty' };
      })?.result;
      setListings(result?.listings || []);
      setSource(result?.source || 'empty');
    } catch (e) {
      console.error('[WorldMarketplacePanel] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [worldId, activeKind]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[460px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Marketplace</span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              source === 'empty'
                ? 'bg-gray-500/15 text-gray-400'
                : 'bg-emerald-500/15 text-emerald-300',
            )}
          >
            {source}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close marketplace"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {KIND_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeKind === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveKind(tab.id)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded uppercase tracking-wider transition flex-shrink-0',
                active
                  ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/40'
                  : 'text-gray-400 hover:text-gray-300 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-8 px-4">
            <Store className="w-8 h-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-400">No listings in this category</p>
          </div>
        ) : (
          listings.map((l) => (
            <div
              key={l.id}
              className="rounded-md border border-white/10 bg-black/20 p-3 hover:bg-white/5 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium truncate', RARITY_COLOR[l.rarity] || 'text-gray-100')}>
                    {l.title}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    by {l.sellerName} · {l.kind}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-mono text-cyan-300">
                    {l.price.toLocaleString()} <span className="text-[10px] text-gray-400 uppercase">{l.currency}</span>
                  </p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">{l.rarity}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <footer className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-400 bg-black/40">
        Listings are scoped to {worldId}. Prices in Concord Coin (CC).
      </footer>
    </div>
  );
}

export default WorldMarketplacePanel;
