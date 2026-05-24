'use client';

import { useCallback, useEffect, useState } from 'react';
import { Store, Loader2, Globe, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Storefront {
  slug: string | null; name: string; tagline: string;
  published: boolean; theme: string; publishedSkus: string[];
}
interface CatalogProduct {
  sku: string; name: string; price: number; category: string;
  inStock: boolean; stock: number; avgRating: number | null; reviewCount: number;
}
interface AdminProduct { sku: string; name: string; price: number; stock: number }

const THEMES = ['minimal', 'bold', 'warm'] as const;

/**
 * StorefrontManager — buyer-facing public shop. Merchants configure +
 * publish a storefront, pick which SKUs to expose, and preview the live
 * buyer browse + checkout experience. All data is real: catalog comes
 * from the merchant's own product list, orders write through the
 * storefront-checkout macro.
 */
export function StorefrontManager() {
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', tagline: '', theme: 'minimal' as string });
  const [buyerCart, setBuyerCart] = useState<Record<string, number>>({});
  const [buyer, setBuyer] = useState({ name: '', email: '' });
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sfRes, prodRes] = await Promise.all([
        lensRun('retail', 'storefront-get', {}),
        lensRun('retail', 'product-list', {}),
      ]);
      const sf = (sfRes.data?.result?.storefront || null) as Storefront | null;
      setStorefront(sf);
      if (sf) setForm({ name: sf.name, tagline: sf.tagline, theme: sf.theme });
      setProducts((prodRes.data?.result?.products || []) as AdminProduct[]);
      const catRes = await lensRun('retail', 'storefront-catalog', {});
      setCatalog((catRes.data?.result?.products || []) as CatalogProduct[]);
    } catch (e) { console.error('[Storefront] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function saveConfig() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('retail', 'storefront-configure', { name: form.name, tagline: form.tagline, theme: form.theme });
      if (r.data?.ok === false) setNotice(`Error: ${r.data.error}`);
      else { setNotice('Storefront saved'); await refresh(); }
    } catch (e) { console.error('[Storefront] configure failed', e); }
    finally { setBusy(false); }
  }

  async function togglePublish(publish: boolean, skus?: string[]) {
    setBusy(true);
    try {
      const input: Record<string, unknown> = { published: publish };
      if (skus) input.publishedSkus = skus;
      const r = await lensRun('retail', 'storefront-publish', input);
      if (r.data?.ok === false) setNotice(`Error: ${r.data.error}`);
      else { setNotice(publish ? `Published at ${r.data?.result?.publicUrl}` : 'Storefront unpublished'); await refresh(); }
    } catch (e) { console.error('[Storefront] publish failed', e); }
    finally { setBusy(false); }
  }

  function toggleSku(sku: string) {
    if (!storefront) return;
    const set = new Set(storefront.publishedSkus);
    if (set.has(sku)) set.delete(sku); else set.add(sku);
    void togglePublish(storefront.published, Array.from(set));
  }

  async function placeBuyerOrder() {
    const lines = Object.entries(buyerCart).filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku, qty }));
    if (lines.length === 0 || !buyer.name.trim() || !buyer.email.trim()) {
      setNotice('Enter buyer name, email and add items'); return;
    }
    setBusy(true);
    try {
      const r = await lensRun('retail', 'storefront-checkout', { buyerName: buyer.name, buyerEmail: buyer.email, lines });
      if (r.data?.ok === false) setNotice(`Checkout failed: ${r.data.error}`);
      else {
        setNotice(`Order ${r.data?.result?.order?.number} placed — $${r.data?.result?.order?.total}`);
        setBuyerCart({}); setBuyer({ name: '', email: '' });
        await refresh();
      }
    } catch (e) { console.error('[Storefront] checkout failed', e); }
    finally { setBusy(false); }
  }

  const cartTotal = catalog.reduce((sum, p) => sum + (buyerCart[p.sku] || 0) * p.price, 0);
  const publishedSet = new Set(storefront?.publishedSkus || []);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Store className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Storefront</span>
        {storefront?.published && storefront.slug && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-300">
            <Globe className="w-3 h-3" />/shop/{storefront.slug}
          </span>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Configure */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Store name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={form.tagline} onChange={e => setForm({ ...form, tagline: e.target.value })} placeholder="Tagline" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveConfig} disabled={busy || !form.name.trim()} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40">Save storefront</button>
            {storefront?.slug && (
              <button onClick={() => togglePublish(!storefront.published)} disabled={busy} className={cn('px-3 py-1.5 text-xs rounded font-bold disabled:opacity-40', storefront.published ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30')}>
                {storefront.published ? 'Unpublish' : 'Publish'}
              </button>
            )}
            {notice && <span className="text-[11px] text-emerald-300 truncate">{notice}</span>}
          </div>

          {/* SKU publish picker */}
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Published products {publishedSet.size > 0 && `(${publishedSet.size} selected)`}</p>
            {products.length === 0 ? (
              <p className="text-[11px] text-gray-400">No products in catalog yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {products.map(p => (
                  <button key={p.sku} onClick={() => toggleSku(p.sku)} disabled={busy} className={cn('px-2 py-0.5 text-[10px] font-mono rounded border', publishedSet.has(p.sku) ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-lattice-deep text-gray-400 border-lattice-border')}>
                    {publishedSet.has(p.sku) && <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />}{p.sku}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-1">No products selected = whole catalog is exposed.</p>
          </div>

          {/* Buyer preview */}
          <div className="border-t border-white/10 pt-3">
            <p className="text-[10px] uppercase text-gray-400 mb-2 flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> Buyer preview {storefront?.published ? '' : '(publish to enable)'}</p>
            {!storefront?.published ? (
              <p className="text-[11px] text-gray-400">Storefront is not published.</p>
            ) : catalog.length === 0 ? (
              <p className="text-[11px] text-gray-400">No products published yet.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catalog.map(p => (
                    <div key={p.sku} className="flex items-center gap-2 p-2 rounded bg-lattice-deep border border-lattice-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white truncate">{p.name}</p>
                        <p className="text-[10px] text-gray-400">
                          ${p.price.toFixed(2)} · {p.inStock ? `${p.stock} in stock` : 'out of stock'}
                          {p.avgRating != null && ` · ★ ${p.avgRating} (${p.reviewCount})`}
                        </p>
                      </div>
                      <input type="number" min={0} max={p.stock} value={buyerCart[p.sku] || 0}
                        onChange={e => setBuyerCart({ ...buyerCart, [p.sku]: Math.max(0, Math.min(p.stock, Number(e.target.value) || 0)) })}
                        disabled={!p.inStock}
                        className="w-14 px-1 py-0.5 text-xs bg-lattice-void border border-lattice-border rounded text-white disabled:opacity-30" />
                    </div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} placeholder="Buyer name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <input value={buyer.email} onChange={e => setBuyer({ ...buyer, email: e.target.value })} placeholder="Buyer email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <button onClick={placeBuyerOrder} disabled={busy || cartTotal <= 0} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40">
                    Place order · ${cartTotal.toFixed(2)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StorefrontManager;
