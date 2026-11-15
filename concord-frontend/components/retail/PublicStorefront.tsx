'use client';

/**
 * PublicStorefront — the public /shop/<slug> page (FIX-retail-013).
 *
 * storefront-publish hands the merchant a shareable URL and the
 * manager UI prints "Published at /shop/<slug>", but no /shop route
 * existed and the only catalog read was owner-scoped, so the shared
 * URL 404'd. This view reads the by-slug public catalog
 * (retail.storefront-public) and renders it with honest states:
 * not found, not published, published with an empty selection
 * (FIX-retail-002: an empty selection publishes nothing), and the
 * product grid. No checkout is offered here — visitor checkout is
 * not wired to another merchant's store, and this page does not
 * pretend otherwise.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Store } from 'lucide-react';

interface PublicProduct {
  sku: string;
  name: string;
  price: number;
  category?: string;
  inStock: boolean;
  stock: number;
  avgRating: number | null;
  reviewCount: number;
}

interface PublicCatalog {
  published: boolean;
  slug?: string;
  storeName?: string;
  tagline?: string;
  theme?: string;
  products?: PublicProduct[];
}

export function PublicStorefront({ slug }: { slug: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadErr(null);
      setNotFound(false);
      try {
        const r = await lensRun<PublicCatalog>('retail', 'storefront-public', { slug });
        if (cancelled) return;
        if (r.data?.ok && r.data.result) {
          setCatalog(r.data.result);
        } else if (r.data && r.data.ok === false && /not found/i.test(r.data.error || '')) {
          setNotFound(true);
        } else {
          setLoadErr(r.data?.error || 'Could not load this storefront.');
        }
      } catch {
        if (!cancelled) setLoadErr('Could not load this storefront.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-label="Loading storefront" />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold text-zinc-100">Store not found</h1>
        <p className="mt-2 text-sm text-zinc-400">
          There is no storefront at <span className="font-mono text-zinc-200">/shop/{slug}</span>.
          The address may be mistyped, or the store may have been removed.
        </p>
      </main>
    );
  }

  if (loadErr || !catalog) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold text-zinc-100">Storefront unavailable</h1>
        <p className="mt-2 text-sm text-zinc-400">{loadErr || 'Could not load this storefront.'}</p>
      </main>
    );
  }

  if (!catalog.published) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-lg font-semibold text-zinc-100">This store is not published</h1>
        <p className="mt-2 text-sm text-zinc-400">
          The storefront at <span className="font-mono text-zinc-200">/shop/{slug}</span> exists
          but is not public right now.
        </p>
      </main>
    );
  }

  const products = catalog.products || [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="flex items-start gap-3">
        <Store className="mt-1 h-6 w-6 text-emerald-500" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">{catalog.storeName || 'Storefront'}</h1>
          {catalog.tagline ? <p className="mt-1 text-sm text-zinc-400">{catalog.tagline}</p> : null}
        </div>
      </header>

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-400">
          This store has not selected any products to publish yet.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((p) => (
            <li key={p.sku} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">{p.name}</span>
                <span className="text-sm text-zinc-200">${p.price.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-xs text-zinc-400">
                {p.inStock ? `${p.stock} in stock` : 'Out of stock'}
                {p.avgRating != null ? ` · ★ ${p.avgRating} (${p.reviewCount})` : ''}
              </div>
              {p.category ? <div className="mt-1 text-xs text-zinc-500">{p.category}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
