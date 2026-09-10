'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, Loader2, Plus, Save, X } from 'lucide-react';
import { ListingVerificationBadge } from '@/components/marketplace/ListingVerificationBadge';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { useCreator } from './CreatorProvider';
import type { MyListing } from './types';

const PANEL = ds.panel;

function ListingsTab({
  listings, onChanged,
}: { listings: MyListing[]; onChanged: () => void }) {
  const [sort, setSort] = useState<'newest' | 'price-desc' | 'downloads' | 'earnings'>('newest');
  const [filter, setFilter] = useState<'all' | 'active' | 'withdrawn'>('all');
  const [search, setSearch] = useState('');

  // CSV export of every listing — creators need this for tax / accounting
  // workflows.  Same shape as the wallet CSV: receipt-friendly headers
  // and properly-escaped fields so titles with commas don't break it.
  const exportListingsCSV = useCallback(() => {
    const headers = ['id', 'title', 'status', 'price', 'downloads', 'totalEarnings', 'listedAt'];
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = listings.map((l) => [
      l.id, l.title || '', l.status, l.price,
      l.downloads ?? 0,
      l.totalEarnings ?? (l.downloads * l.price),
      l.listedAt,
    ].map(escape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `creator-listings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [listings]);

  // id === the listing's sourceDtuId (dtu.marketplace lives on the DTU
  // itself — there's no separate listing row). See marketplace.updateListing
  // / marketplace.unlist / marketplace.relist in server.js.
  const updateListing = useCallback(async (id: string, patch: Partial<MyListing>) => {
    await lensRun('marketplace', 'updateListing', {
      dtuId: id, price: patch.price, title: patch.title, tierPrices: patch.tierPrices,
    });
    onChanged();
  }, [onChanged]);

  const withdrawListing = useCallback(async (id: string) => {
    await lensRun('marketplace', 'unlist', { dtuId: id });
    onChanged();
  }, [onChanged]);

  const relistListing = useCallback(async (id: string) => {
    await lensRun('marketplace', 'relist', { dtuId: id });
    onChanged();
  }, [onChanged]);

  const visible = useMemo(() => {
    let arr = listings.slice();
    if (filter !== 'all') arr = arr.filter((l) => l.status === filter);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((l) => (l.title || '').toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
    if (sort === 'price-desc') arr.sort((a, b) => b.price - a.price);
    if (sort === 'downloads')  arr.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
    if (sort === 'earnings')   arr.sort((a, b) => (b.totalEarnings ?? b.downloads * b.price) - (a.totalEarnings ?? a.downloads * a.price));
    if (sort === 'newest')     arr.sort((a, b) => new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime());
    return arr;
  }, [listings, sort, filter, search]);

  // Top-3 earners summary strip.
  const topEarners = useMemo(() => {
    return [...listings]
      .map((l) => ({ ...l, computedEarnings: l.totalEarnings ?? (l.downloads * l.price) }))
      .sort((a, b) => b.computedEarnings - a.computedEarnings)
      .slice(0, 3);
  }, [listings]);

  return (
    <div className="space-y-4">
      <NewListingForm existingListings={listings} onListed={onChanged} />
    <section className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <ListChecks className="w-4 h-4" /> Your listings
          {search && (
            <span className="text-xs text-gray-400 font-normal ml-1">
              ({visible.length} of {listings.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title or id…"
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 w-44 focus:outline-none focus:border-amber-400/40"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200"
          >
            <option value="newest">Newest</option>
            <option value="price-desc">Price ↓</option>
            <option value="downloads">Downloads ↓</option>
            <option value="earnings">Earnings ↓</option>
          </select>
          <button
            onClick={exportListingsCSV}
            disabled={listings.length === 0}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 hover:bg-white/5 hover:border-white/20 disabled:opacity-40"
            title="Export every listing to CSV (for tax / accounting)"
          >
            CSV ↓
          </button>
        </div>
      </div>

      {topEarners.length > 0 && (
        <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          {topEarners.map((l, i) => (
            <div key={l.id} className="bg-amber-500/5 border border-amber-500/20 rounded-md p-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-300 mb-0.5">
                {['#1 earner', '#2 earner', '#3 earner'][i]}
              </div>
              <div className="text-sm text-white truncate">{l.title}</div>
              <div className="text-xs text-amber-200 font-mono">{l.computedEarnings.toFixed(0)} CC</div>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-gray-400 italic">No listings match.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((l) => (
            <ListingRow
              key={l.id}
              listing={l}
              onUpdate={updateListing}
              onWithdraw={withdrawListing}
              onRelist={relistListing}
            />
          ))}
        </div>
      )}
    </section>
    </div>
  );
}

// List a personal DTU on the marketplace via the marketplace.list macro —
// the real, purchasable dtu.marketplace + purchaseWithRoyalties system (95%
// creator / 5% platform, royalty cascade to ancestors) that already has live
// buyer-facing callers elsewhere in the app (PurchaseButton, TrackCard,
// crafting/music lenses). This form previously posted to
// `/api/marketplace/submit`, which only ever wrote STATE.marketplaceListings
// — an in-memory store with no purchase route anywhere in Concord, so every
// listing created there was permanently unsellable. See
// docs/lens-specs/creator-capability-map.md finding #3.
function NewListingForm({
  existingListings, onListed,
}: { existingListings: MyListing[]; onListed: () => void }) {
  const [open, setOpen] = useState(false);
  const [dtus, setDtus] = useState<{ id: string; title: string }[]>([]);
  const [loadingDtus, setLoadingDtus] = useState(false);
  const [dtuId, setDtuId] = useState('');
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyListedIds = useMemo(
    () => new Set(
      existingListings
        .filter((l) => l.status === 'active' && l.sourceDtuId)
        .map((l) => l.sourceDtuId as string)
    ),
    [existingListings]
  );

  const loadDtus = useCallback(async () => {
    setLoadingDtus(true);
    try {
      const r = await lensRun<{ dtus?: { id: string; title: string; scope?: string }[] }>('dtu', 'list', { mine: true, limit: 200 });
      const all = r.data?.result?.dtus ?? [];
      const eligible = all
        .filter((d) => (d.scope ?? 'personal') === 'personal' && !alreadyListedIds.has(d.id))
        .map((d) => ({ id: d.id, title: d.title || d.id.slice(0, 16) }));
      setDtus(eligible);
      if (eligible.length > 0 && !dtuId) setDtuId(eligible[0].id);
    } catch {
      setDtus([]);
    } finally {
      setLoadingDtus(false);
    }
  }, [alreadyListedIds, dtuId]);

  useEffect(() => { if (open) void loadDtus(); }, [open, loadDtus]);

  const submit = useCallback(async () => {
    setError(null);
    if (!dtuId) { setError('Pick a DTU to list.'); return; }
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount < 0) { setError('Enter a valid price (0 or more CC).'); return; }
    setSubmitting(true);
    try {
      const res = await lensRun('marketplace', 'list', { dtuId, price: amount });
      if (!res.data.ok) {
        setError(res.data.error || 'Listing failed.');
        return;
      }
      setPrice('');
      setDtuId('');
      setOpen(false);
      onListed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Listing failed.');
    } finally {
      setSubmitting(false);
    }
  }, [dtuId, price, onListed]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-amber-600/90 hover:bg-amber-500 rounded text-white"
      >
        <Plus className="w-3.5 h-3.5" /> List a DTU for sale
      </button>
    );
  }

  return (
    <section className={PANEL}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> List a DTU for sale
        </h2>
        <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white" aria-label="Close listing form">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {loadingDtus ? (
        <div className="text-gray-400 italic text-sm inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your DTUs…
        </div>
      ) : dtus.length === 0 ? (
        <div className="text-gray-400 italic text-sm">
          No personal DTUs available to list — everything you own is already listed, or you
          haven&apos;t created a personal DTU yet.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dtuId}
            onChange={(e) => setDtuId(e.target.value)}
            className="flex-1 min-w-[220px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
          >
            {dtus.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Price (CC)"
            className="w-32 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
          />
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-gray-400 rounded text-white"
          >
            {submitting ? 'Listing…' : 'List it'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
}

interface ListingRowProps {
  listing: MyListing;
  onUpdate: (id: string, patch: Partial<MyListing>) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
  onRelist: (id: string) => Promise<void>;
}

function ListingRow({ listing, onUpdate, onWithdraw, onRelist }: ListingRowProps) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(listing.price));
  const [title, setTitle] = useState(listing.title);
  const [useTiers, setUseTiers] = useState(!!listing.tierPrices);
  const [tierUsage, setTierUsage] = useState(String(listing.tierPrices?.usage ?? 5));
  const [tierRemix, setTierRemix] = useState(String(listing.tierPrices?.remix ?? 15));
  const [tierCommercial, setTierCommercial] = useState(String(listing.tierPrices?.commercial ?? 60));
  const isWithdrawn = listing.status === 'withdrawn';

  async function save() {
    const patch: Partial<MyListing> = { title, price: Number(price) || 0 };
    if (useTiers) {
      patch.tierPrices = {
        usage:      Number(tierUsage)      || 0,
        remix:      Number(tierRemix)      || 0,
        commercial: Number(tierCommercial) || 0,
      };
    }
    await onUpdate(listing.id, patch);
    setEditing(false);
  }

  return (
    <div className="border border-white/10 rounded p-3">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-gray-100 font-medium truncate inline-flex items-center gap-2">
              {listing.title}
              <ListingVerificationBadge listing={listing} />
            </div>
            <div className="text-xs text-gray-400">
              {listing.price} CC · {listing.downloads} downloads · {listing.status}
              {listing.totalEarnings != null && (
                <span className="text-amber-300/80"> · {listing.totalEarnings.toFixed(0)} CC earned</span>
              )}
            </div>
            {listing.tierPrices && (
              <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                {Object.entries(listing.tierPrices).map(([t, p]) => (
                  <span key={t} className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/70">
                    {t}: {p}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs bg-violet-700 hover:bg-violet-600 rounded text-white">edit</button>
          {!isWithdrawn ? (
            <button onClick={() => onWithdraw(listing.id)} className="px-2 py-1 text-xs bg-rose-700 hover:bg-rose-600 rounded text-white">withdraw</button>
          ) : (
            <button onClick={() => onRelist(listing.id)} className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 rounded text-white">re-list</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200" />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200"
              placeholder="price"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={useTiers} onChange={(e) => setUseTiers(e.target.checked)} />
            Tier pricing (usage / remix / commercial)
          </label>
          {useTiers && (
            <div className="grid grid-cols-3 gap-2">
              <input value={tierUsage}      onChange={(e) => setTierUsage(e.target.value)}      placeholder="usage"      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
              <input value={tierRemix}      onChange={(e) => setTierRemix(e.target.value)}      placeholder="remix"      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
              <input value={tierCommercial} onChange={(e) => setTierCommercial(e.target.value)} placeholder="commercial" className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setEditing(false); setPrice(String(listing.price)); setTitle(listing.title); }} className="px-2 py-1 text-xs bg-stone-700 rounded text-gray-200">cancel</button>
            <button onClick={save} className="px-2 py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded text-white inline-flex items-center gap-1">
              <Save className="w-3 h-3" /> save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


export function ListingsPanel() {
  const { listings, refreshListings, refreshDashboard, refreshWithdrawal } = useCreator();
  const onChanged = () => {
    refreshListings();
    refreshDashboard();
    refreshWithdrawal();
  };
  return <ListingsTab listings={listings} onChanged={onChanged} />;
}
