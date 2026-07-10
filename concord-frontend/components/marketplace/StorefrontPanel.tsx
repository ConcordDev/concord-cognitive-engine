'use client';

/**
 * StorefrontPanel — buyer-facing public catalog + cart + checkout.
 *
 * Aggregates every seller's published listings into a browsable
 * storefront (Etsy buyer surface), with category navigation, price
 * filters, sort, an add-to-cart flow, and a checkout that splits the
 * cart per shop. All data is real — pulled from the marketplace
 * `storefront-browse` / `cart-*` / `checkout-create` macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Store, Loader2, ShoppingCart, Search, Plus, Trash2, Check, X, Star, Receipt, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface StoreListing {
  listingId: string;
  sellerId: string;
  shopName: string;
  number: string;
  title: string;
  kind: string;
  priceUsd: number;
  currency: string;
  description: string;
  tags: string[];
  images: string[];
  stockQty: number | null;
  shippingCostUsd: number;
  avgRating: number | null;
  reviewCount: number;
  salesCount: number;
  publishedAt: string | null;
}

interface CartLine {
  id: string;
  listingId: string;
  listingTitle: string;
  listingKind: string;
  variationId: string;
  variationLabel: string;
  qty: number;
  unitPriceUsd: number;
  shippingCostUsd: number;
  image: string;
}

interface CartShop {
  sellerId: string;
  shopName: string;
  lines: CartLine[];
  subtotalUsd: number;
  shippingUsd: number;
}

interface CheckoutResult {
  number: string;
  grandTotalUsd: number;
  orders: Array<{ orderId: string; number: string; sellerId: string; totalUsd: number }>;
}
interface CheckoutHistoryEntry {
  id: string; number: string; grandTotalUsd: number; placedAt: string;
  orders: Array<{ orderId: string; number: string; sellerId: string; totalUsd: number }>;
}
interface ShopDetail {
  shop: { id: string; name: string; tagline: string; bio: string; policies?: string };
  listingCount: number;
  avgShopRating: number | null;
  shopReviewCount: number;
  listings: Array<{ listingId: string; title: string; priceUsd: number; stockQty: number | null }>;
}

type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'popular';

export function StorefrontPanel() {
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [cart, setCart] = useState<CartShop[]>([]);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);
  const [showCart, setShowCart] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [buyer, setBuyer] = useState({ buyerName: '', buyerEmail: '', buyerAddress: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<StoreListing | null>(null);
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [shopLoading, setShopLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CheckoutHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const searchTerm = search.trim();
      const input: Record<string, unknown> = { sort };
      if (searchTerm) input.search = searchTerm;
      if (kind) input.kind = kind;
      if (minPrice !== '') input.minPrice = Number(minPrice);
      if (maxPrice !== '') input.maxPrice = Number(maxPrice);
      const r = await lensRun('marketplace', 'storefront-browse', input);
      if (r.data?.ok) {
        const results = (r.data.result?.listings || []) as StoreListing[];
        setListings(results);
        setCategories((r.data.result?.categories || []) as string[]);
        // Search visibility (Etsy Stats parity): every listing surfaced against a
        // keyword search racks up an impression the seller can see in Insights.
        if (searchTerm) {
          for (const l of results.slice(0, 24)) {
            void lensRun('marketplace', 'search-impression', { listingId: l.listingId, keyword: searchTerm });
          }
        }
      }
    } catch (e) {
      console.error('[Storefront] browse failed', e);
    } finally {
      setLoading(false);
    }
  }, [search, kind, sort, minPrice, maxPrice]);

  const refreshCart = useCallback(async () => {
    try {
      const r = await lensRun('marketplace', 'cart-get', {});
      if (r.data?.ok) {
        setCart((r.data.result?.shops || []) as CartShop[]);
        setCartCount((r.data.result?.itemCount as number) || 0);
        setCartTotal((r.data.result?.grandTotalUsd as number) || 0);
      }
    } catch (e) {
      console.error('[Storefront] cart-get failed', e);
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);
  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  async function addToCart(l: StoreListing) {
    setError(null);
    try {
      const r = await lensRun('marketplace', 'cart-add', {
        sellerId: l.sellerId,
        listingId: l.listingId,
        qty: 1,
      });
      if (r.data?.ok === false) {
        setError(r.data.error || 'Could not add to cart');
        return;
      }
      // A click on a listing that was surfaced by an active keyword search
      // counts as the click-through half of the CTR the seller sees in Insights.
      if (search.trim()) {
        void lensRun('marketplace', 'search-impression', { listingId: l.listingId, keyword: search.trim(), click: true });
      }
      await refreshCart();
    } catch (e) {
      console.error('[Storefront] cart-add failed', e);
    }
  }

  function openListing(l: StoreListing) {
    setViewing(l);
    // Etsy Stats parity: opening a listing's detail is the "view" event the
    // seller's Analytics tab (analytics-summary / analytics-by-listing) counts.
    void lensRun('marketplace', 'analytics-track-view', { listingId: l.listingId, uniqueVisit: true });
  }

  async function openShop(sellerId: string) {
    setShopLoading(true);
    setShop(null);
    try {
      const r = await lensRun<ShopDetail>('marketplace', 'storefront-shop', { sellerId });
      if (r.data?.ok) setShop((r.data.result as ShopDetail) || null);
    } catch (e) {
      console.error('[Storefront] shop failed', e);
    } finally {
      setShopLoading(false);
    }
  }

  async function loadHistory() {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const r = await lensRun<{ checkouts: CheckoutHistoryEntry[] }>('marketplace', 'checkout-history', {});
      setHistory((r.data?.result?.checkouts || []) as CheckoutHistoryEntry[]);
    } catch (e) {
      console.error('[Storefront] checkout-history failed', e);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function updateLine(lineId: string, qty: number) {
    try {
      await lensRun('marketplace', 'cart-update', { lineId, qty });
      await refreshCart();
    } catch (e) {
      console.error('[Storefront] cart-update failed', e);
    }
  }

  async function removeLine(lineId: string) {
    try {
      await lensRun('marketplace', 'cart-update', { lineId, remove: true });
      await refreshCart();
    } catch (e) {
      console.error('[Storefront] cart-remove failed', e);
    }
  }

  async function placeOrder() {
    if (cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('marketplace', 'checkout-create', {
        buyerName: buyer.buyerName.trim(),
        buyerEmail: buyer.buyerEmail.trim(),
        buyerAddress: buyer.buyerAddress.trim(),
      });
      if (r.data?.ok === false) {
        setError(r.data.error || 'Checkout failed');
        return;
      }
      setCheckout((r.data?.result as CheckoutResult) || null);
      await refreshCart();
    } catch (e) {
      console.error('[Storefront] checkout failed', e);
      setError('Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  const cartGrand = useMemo(
    () => cart.reduce((s, sh) => s + sh.subtotalUsd + sh.shippingUsd, 0),
    [cart],
  );

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2 flex-wrap">
          <Store className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Storefront</span>
          <span className="text-[10px] text-gray-400">{listings.length} listings</span>
          <button
            onClick={loadHistory}
            className="ml-auto px-2.5 py-1 text-xs rounded bg-white/[0.04] text-gray-300 border border-white/10 hover:bg-white/[0.08] inline-flex items-center gap-1"
          >
            <Receipt className="w-3 h-3" />
            My orders
          </button>
          <button
            onClick={() => setShowCart((v) => !v)}
            className="relative px-2.5 py-1 text-xs rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 inline-flex items-center gap-1"
          >
            <ShoppingCart className="w-3 h-3" />
            Cart
            {cartCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-orange-500 text-black font-bold">
                {cartCount}
              </span>
            )}
          </button>
        </header>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <div className="col-span-5 relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search listings…"
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
            <option value="popular">Popular</option>
          </select>
          <input
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min $"
            className="col-span-1 px-1.5 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max $"
            className="col-span-1 px-1.5 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-rose-300 bg-rose-500/10 border-b border-white/10">
            {error}
          </div>
        )}

        {/* Catalog */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading catalog…
            </div>
          ) : listings.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              <Store className="w-7 h-7 mx-auto mb-2 opacity-30" />
              No published listings yet.
            </div>
          ) : (
            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {listings.map((l) => (
                <li
                  key={l.listingId}
                  className="rounded-lg border border-white/10 bg-black/40 overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => openListing(l)}
                    className="aspect-square bg-black/40 border-b border-white/5 flex items-center justify-center overflow-hidden"
                  >
                    {l.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.images[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <Store className="w-8 h-8 text-gray-600" />
                    )}
                  </button>
                  <div className="p-2.5 space-y-1.5 flex flex-col flex-1">
                    <button type="button" onClick={() => openListing(l)} className="text-sm text-white font-medium truncate text-left hover:text-orange-300">{l.title}</button>
                    <button type="button" onClick={() => openShop(l.sellerId)} className="text-[10px] text-gray-400 truncate text-left hover:text-orange-300 w-fit">{l.shopName}</button>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      {l.avgRating !== null ? (
                        <span className="text-amber-300">
                          ★ {l.avgRating} ({l.reviewCount})
                        </span>
                      ) : (
                        <span className="text-gray-600">No reviews</span>
                      )}
                      {l.salesCount > 0 && <span>· {l.salesCount} sold</span>}
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-1.5">
                      <span className="text-sm font-mono text-orange-300">
                        ${l.priceUsd.toFixed(2)}
                      </span>
                      <button
                        onClick={() => addToCart(l)}
                        disabled={l.stockQty === 0}
                        className="px-2 py-1 text-[10px] rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        {l.stockQty === 0 ? 'Sold out' : 'Add'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cart drawer */}
      {showCart && (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={() => setShowCart(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div
            className="w-full max-w-md bg-[#0d1117] border-l border-orange-500/20 h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 sticky top-0 bg-[#0d1117]">
              <ShoppingCart className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200">Your cart</span>
              <button onClick={() => setShowCart(false)} className="ml-auto text-gray-400 hover:text-white" aria-label="Close cart">
                <X className="w-4 h-4" />
              </button>
            </header>

            {checkout ? (
              <div className="p-4 space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <Check className="w-4 h-4" /> Order {checkout.number} placed
                  </div>
                  <div className="text-emerald-100">
                    {checkout.orders.length} order{checkout.orders.length !== 1 ? 's' : ''} ·{' '}
                    <span className="font-mono">${checkout.grandTotalUsd.toFixed(2)}</span>
                  </div>
                  <ul className="space-y-0.5 text-emerald-200/80">
                    {checkout.orders.map((o) => (
                      <li key={o.orderId} className="font-mono">
                        {o.number} — ${o.totalUsd.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={() => {
                    setCheckout(null);
                    setShowCart(false);
                  }}
                  className="w-full px-3 py-2 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400"
                >
                  Continue shopping
                </button>
              </div>
            ) : cart.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-400">
                <ShoppingCart className="w-7 h-7 mx-auto mb-2 opacity-30" />
                Your cart is empty.
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {cart.map((sh) => (
                  <div key={sh.sellerId} className="rounded-lg border border-white/10 bg-black/30">
                    <div className="px-3 py-2 border-b border-white/5 text-xs font-semibold text-gray-300">
                      {sh.shopName}
                    </div>
                    <ul className="divide-y divide-white/5">
                      {sh.lines.map((ln) => (
                        <li key={ln.id} className="px-3 py-2 flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-white truncate">{ln.listingTitle}</div>
                            {ln.variationLabel && (
                              <div className="text-[10px] text-gray-400">{ln.variationLabel}</div>
                            )}
                            <div className="text-[10px] text-gray-400 font-mono">
                              ${ln.unitPriceUsd.toFixed(2)} ea
                            </div>
                          </div>
                          <input
                            type="number"
                            min={1}
                            value={ln.qty}
                            onChange={(e) => updateLine(ln.id, Number(e.target.value) || 1)}
                            className="w-12 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                          />
                          <button
                            onClick={() => removeLine(ln.id)}
                            className="p-1 rounded hover:bg-rose-500/20 text-rose-300"
                            aria-label="Remove line"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="px-3 py-1.5 text-[10px] text-gray-400 flex justify-between">
                      <span>Subtotal ${sh.subtotalUsd.toFixed(2)}</span>
                      <span>Shipping ${sh.shippingUsd.toFixed(2)}</span>
                    </div>
                  </div>
                ))}

                <div className="space-y-2">
                  <input
                    value={buyer.buyerName}
                    onChange={(e) => setBuyer({ ...buyer, buyerName: e.target.value })}
                    placeholder="Your name"
                    className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <input
                    value={buyer.buyerEmail}
                    onChange={(e) => setBuyer({ ...buyer, buyerEmail: e.target.value })}
                    placeholder="Email"
                    className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <textarea
                    value={buyer.buyerAddress}
                    onChange={(e) => setBuyer({ ...buyer, buyerAddress: e.target.value })}
                    placeholder="Shipping address"
                    rows={2}
                    className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                </div>

                <div className="flex items-center justify-between text-sm border-t border-white/10 pt-2">
                  <span className="font-semibold text-gray-300">Total</span>
                  <span className="font-mono text-orange-300 font-bold">
                    ${cartGrand.toFixed(2)}
                  </span>
                </div>
                {cartTotal !== cartGrand && (
                  <div className="text-[10px] text-gray-400 text-right">cart total ${cartTotal.toFixed(2)}</div>
                )}
                {error && <div className="text-xs text-rose-300">{error}</div>}
                <button
                  onClick={placeOrder}
                  disabled={busy}
                  className={cn(
                    'w-full px-3 py-2 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 inline-flex items-center justify-center gap-1',
                    busy && 'opacity-50',
                  )}
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Place order
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Listing detail modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setViewing(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setViewing(null); }}>
          <div className="w-full max-w-lg bg-[#0d1117] border border-orange-500/20 rounded-lg overflow-hidden max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => e.stopPropagation()}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 sticky top-0 bg-[#0d1117]">
              <Store className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200 truncate flex-1">{viewing.title}</span>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-4 space-y-3">
              {viewing.images?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewing.images[0]} alt="" className="w-full aspect-video object-cover rounded" />
              )}
              <div className="flex items-center justify-between">
                <button onClick={() => { setViewing(null); openShop(viewing.sellerId); }} className="text-xs text-gray-400 hover:text-orange-300 underline">{viewing.shopName}</button>
                {viewing.avgRating !== null ? (
                  <span className="text-xs text-amber-300 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-amber-300" /> {viewing.avgRating} ({viewing.reviewCount})</span>
                ) : (
                  <span className="text-xs text-gray-600">No reviews yet</span>
                )}
              </div>
              {viewing.description && <p className="text-xs text-gray-300 whitespace-pre-wrap">{viewing.description}</p>}
              {viewing.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {viewing.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{t}</span>)}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-white/10 pt-3">
                <span className="text-lg font-mono text-orange-300 font-bold">${viewing.priceUsd.toFixed(2)}</span>
                <button
                  onClick={() => { addToCart(viewing); }}
                  disabled={viewing.stockQty === 0}
                  className="px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />{viewing.stockQty === 0 ? 'Sold out' : 'Add to cart'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shop page modal */}
      {(shop || shopLoading) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setShop(null); setShopLoading(false); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setShop(null); setShopLoading(false); } }}>
          <div className="w-full max-w-lg bg-[#0d1117] border border-orange-500/20 rounded-lg overflow-hidden max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => e.stopPropagation()}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 sticky top-0 bg-[#0d1117]">
              <Store className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200 truncate flex-1">{shop ? shop.shop.name : 'Loading shop…'}</span>
              <button onClick={() => { setShop(null); setShopLoading(false); }} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </header>
            {shopLoading ? (
              <div className="p-8 flex items-center justify-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading shop…</div>
            ) : shop && (
              <div className="p-4 space-y-3">
                {shop.shop.tagline && <p className="text-xs text-orange-300 italic">{shop.shop.tagline}</p>}
                {shop.shop.bio && <p className="text-xs text-gray-300">{shop.shop.bio}</p>}
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <span>{shop.listingCount} listings</span>
                  {shop.avgShopRating !== null && (
                    <span className="text-amber-300 inline-flex items-center gap-1"><Star className="w-3 h-3 fill-amber-300" />{shop.avgShopRating} ({shop.shopReviewCount})</span>
                  )}
                </div>
                <ul className="divide-y divide-white/5 border-t border-white/10 pt-1">
                  {shop.listings.map((l) => (
                    <li key={l.listingId} className="py-2 flex items-center justify-between text-xs">
                      <span className="text-white truncate flex-1">{l.title}</span>
                      <span className="font-mono text-orange-300">${l.priceUsd.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order history modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowHistory(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowHistory(false); }}>
          <div className="w-full max-w-lg bg-[#0d1117] border border-orange-500/20 rounded-lg overflow-hidden max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => e.stopPropagation()}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 sticky top-0 bg-[#0d1117]">
              <Receipt className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">My order history</span>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-4">
              {historyLoading ? (
                <div className="py-8 flex items-center justify-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
              ) : !history || history.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400"><Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />No past checkouts yet.</div>
              ) : (
                <ul className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="rounded border border-white/10 bg-black/30 p-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-gray-400">{h.number}</span>
                        <span className="font-mono text-orange-300 font-bold">${h.grandTotalUsd.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{new Date(h.placedAt).toLocaleString()} · {h.orders.length} order{h.orders.length !== 1 ? 's' : ''}</div>
                      <ul className="mt-1 space-y-0.5 text-[10px] text-gray-400">
                        {h.orders.map((o) => (
                          <li key={o.orderId} className="font-mono inline-flex items-center gap-1">{o.number} — ${o.totalUsd.toFixed(2)}<ExternalLink className="w-2.5 h-2.5 opacity-50" /></li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StorefrontPanel;
