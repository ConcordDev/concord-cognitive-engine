'use client';

/**
 * AssetMarketplaceBrowser — the "buy someone's asset" half of the Asset
 * Studio economic surface (the list-for-sale half lives inline in
 * AssetStudioPanel.tsx's "My authored buildings" section).
 *
 * Two real endpoints, both traced to their source before wiring:
 *   - GET  /api/creative-marketplace/artifacts?type=blueprint&status=active
 *     (server/routes/creative-marketplace.js -> searchArtifacts() in
 *     server/economy/creative-marketplace.js) to browse listings.
 *   - POST /api/creative-marketplace/artifacts/:id/purchase
 *     { buyerId, requestId } -> purchaseArtifact() in the same file — the
 *     SAME rights-ladder purchase primitive every other content type on
 *     the marketplace uses: it debits the buyer, credits the seller minus
 *     platform fees, and pays the real royalty cascade to remix ancestors
 *     (30% cap, halving per generation) when the listed building itself
 *     has remix lineage. Every price/fee/earnings figure rendered below is
 *     copied verbatim from that call's response — never computed or
 *     guessed client-side.
 *
 * Two honest gaps found while tracing this path (neither fixable from the
 * frontend — noted here so nobody re-discovers them the hard way):
 *   1. Per-tier pricing (download/usage/commercial/resale, the ladder in
 *      server/economy/rights-enforcement.js#TIER_HIERARCHY.blueprint) has
 *      no corresponding entry in creative-marketplace.js's tier-key map or
 *      in license-tiers.js's LICENSE_TIERS catalog for the 'blueprint'
 *      content type. A listing's tierPrices are accepted by the HTTP
 *      route but collapse to a single headline price server-side — so
 *      this component only ever offers/shows a single price, matching
 *      what the backend can actually produce today.
 *   2. The purchase route never forwards a `tier` query/body field to
 *      purchaseArtifact() at all, so tiered purchases aren't reachable
 *      from any frontend today regardless of (1) — which is fine here
 *      since (1) means a blueprint listing is never tiered anyway.
 */

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { ShoppingCart, Loader2, AlertTriangle, CheckCircle2, RefreshCw, Store } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

function apiErrorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string; message?: string; reason?: string } | undefined;
    return data?.error || data?.message || data?.reason || e.message || fallback;
  }
  return e instanceof Error ? e.message : fallback;
}

interface MarketplaceListing {
  id: string;
  creatorId: string;
  title: string;
  price: number;
}

interface PurchaseReceipt {
  price: number;
  creatorEarnings: number;
  cascadeTotal: number;
  cascadeCount: number;
}

export function AssetMarketplaceBrowser() {
  const { user, isAuthenticated } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyErrors, setBuyErrors] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, PurchaseReceipt>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/api/creative-marketplace/artifacts', {
        params: { type: 'blueprint', status: 'active', sortBy: 'newest', limit: 25 },
      });
      const items = (res.data?.items as Array<Record<string, unknown>> | undefined) || [];
      setListings(items.map((it) => ({
        id: String(it.id),
        creatorId: String(it.creatorId ?? ''),
        title: String(it.title ?? 'Untitled'),
        price: Number(it.price ?? 0),
      })));
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'Failed to load marketplace listings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const buy = async (listingId: string) => {
    if (!user?.id) return;
    setBuyingId(listingId);
    setBuyErrors((prev) => {
      if (!(listingId in prev)) return prev;
      const next = { ...prev };
      delete next[listingId];
      return next;
    });
    try {
      const res = await api.post(`/api/creative-marketplace/artifacts/${encodeURIComponent(listingId)}/purchase`, {
        buyerId: user.id,
        requestId: crypto.randomUUID(),
      });
      if (res.data?.ok === false) {
        setBuyErrors((prev) => ({ ...prev, [listingId]: res.data?.error || res.data?.message || 'Purchase failed.' }));
        return;
      }
      const r = res.data as {
        price?: number; creatorEarnings?: number; cascade?: { total?: number; payments?: unknown[] };
      };
      setReceipts((prev) => ({
        ...prev,
        [listingId]: {
          price: r.price ?? 0,
          creatorEarnings: r.creatorEarnings ?? 0,
          cascadeTotal: r.cascade?.total ?? 0,
          cascadeCount: r.cascade?.payments?.length ?? 0,
        },
      }));
      await refresh();
    } catch (e) {
      setBuyErrors((prev) => ({ ...prev, [listingId]: apiErrorMessage(e, 'Purchase failed.') }));
    } finally {
      setBuyingId(null);
    }
  };

  const others = listings.filter((l) => !user?.id || l.creatorId !== user.id);

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Store className="w-3.5 h-3.5 text-lime-400" /> Marketplace — buy an authored building
        </h4>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {loading && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading marketplace listings…
        </p>
      )}
      {!loading && loadError && (
        <p role="alert" className="flex items-center gap-1.5 text-[11px] text-rose-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loadError}
        </p>
      )}
      {!loading && !loadError && others.length === 0 && (
        <p className="text-[11px] text-zinc-400 italic py-3 text-center">
          No other creators have listed a building yet.
        </p>
      )}
      {!loading && !isAuthenticated && others.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-950/20 border border-amber-900/40 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Sign in to buy.
        </p>
      )}

      {others.length > 0 && (
        <ul className="space-y-1.5">
          {others.map((l) => {
            const receipt = receipts[l.id];
            const error = buyErrors[l.id];
            return (
              <li key={l.id} className="flex flex-col gap-1 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-200">{l.title}</span>
                  <span className="text-zinc-500 font-mono">by {l.creatorId.slice(0, 10) || 'unknown'}…</span>
                  <div className="flex-1" />
                  <span className="font-semibold text-lime-400">{l.price} CC</span>
                  <button
                    type="button"
                    onClick={() => buy(l.id)}
                    disabled={!isAuthenticated || buyingId === l.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-lime-600 hover:bg-lime-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md"
                  >
                    {buyingId === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3" />}
                    {buyingId === l.id ? 'Buying…' : 'Buy'}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="flex items-center gap-1 text-rose-400">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
                  </p>
                )}
                {receipt && (
                  <p className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    Bought for {receipt.price} CC — {receipt.creatorEarnings} CC to the creator
                    {receipt.cascadeTotal > 0
                      ? ` (${receipt.cascadeTotal} CC to ${receipt.cascadeCount} remix-ancestor royalty payment${receipt.cascadeCount === 1 ? '' : 's'})`
                      : ''}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AssetMarketplaceBrowser;
