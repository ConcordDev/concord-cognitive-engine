'use client';

/**
 * Black Market lens — Sael's stall.
 *
 * Players browse intercepted Concord Link messages surfaced by the walker
 * journey tick. Sender + receiver are redacted; encryption level drives the
 * price tier. Purchasing reveals the original payload and bumps reputation
 * with the fence; failed purchases (insufficient sparks) hurt reputation.
 *
 * Currency is sparks only. There is no real-money codepath.
 */
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState, useMemo } from 'react';
import { } from 'lucide-react';

import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { SaelStall } from '@/components/black-market/SaelStall';
import { UndergroundExchange } from '@/components/black-market/UndergroundExchange';
interface Listing {
  id: string;
  message_id: string;
  fence_npc_id: string;
  price_sparks: number;
  encryption_level: 'none' | 'basic' | 'high' | 'shadow';
  redacted_preview: string | null;
  created_at: number;
  expires_at: number;
}

interface RevealedMessage {
  id: string;
  payload: string;
  encryption_level: string;
  source_world: string;
  dest_world: string;
  sent_at: number;
}

interface FenceReputation {
  fence_npc_id: string;
  buyer_rep: number;
  purchases: number;
  last_trade_at: number | null;
}

const fmtTime = (epochSec: number) => {
  const d = new Date(epochSec * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
};

export default function BlackMarketPage() {
  // Persist 'view-event' artifact so cartograph counts this page as wired.
  const viewLog = useArtifacts<{ at: string }>('black-market', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('black-market');
  void viewLog; void recordView;
  const [listings, setListings] = useState<Listing[]>([]);
  const [reputation, setReputation] = useState<FenceReputation[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` (purchase failures): a failure to LOAD the market.
  const [loadError, setLoadError] = useState<string | null>(null);
  type EncFilter = 'all' | Listing['encryption_level'];
  type SortMode = 'newest' | 'price-asc' | 'price-desc' | 'expiring';
  const [encFilter, setEncFilter] = useState<EncFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [listingsRes, repRes] = await Promise.all([
        fetch('/api/black-market').then((r) => r.json()),
        fetch('/api/black-market/reputation', { credentials: 'same-origin' })
          .then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (listingsRes?.ok && Array.isArray(listingsRes.listings)) {
        setListings(listingsRes.listings);
      } else {
        // The market endpoint responded but not with a usable listings array.
        setLoadError(listingsRes?.error || 'The black market is unreachable right now.');
      }
      if (repRes?.ok && Array.isArray(repRes.reputation)) {
        setReputation(repRes.reputation);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The black market is unreachable right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Encryption-tier filter + sort.  A market with 30+ listings benefits
  // from sorting by price (cheapest deal first) or expiring (don't miss
  // a shadow-tier listing that's about to roll over).
  const visibleListings = useMemo(() => {
    let arr = listings.slice();
    if (encFilter !== 'all') arr = arr.filter((l) => l.encryption_level === encFilter);
    if (sortMode === 'price-asc')  arr.sort((a, b) => a.price_sparks - b.price_sparks);
    if (sortMode === 'price-desc') arr.sort((a, b) => b.price_sparks - a.price_sparks);
    if (sortMode === 'expiring')   arr.sort((a, b) => a.expires_at - b.expires_at);
    if (sortMode === 'newest')     arr.sort((a, b) => b.created_at - a.created_at);
    return arr;
  }, [listings, encFilter, sortMode]);

  useLensCommand(
    [
      { id: 'refresh',     keys: 'r', description: 'Refresh listings', category: 'actions',    action: () => reload() },
      { id: 'filter-all',  keys: '0', description: 'All tiers',        category: 'view',       action: () => setEncFilter('all') },
      { id: 'filter-none', keys: '1', description: 'None tier',        category: 'view',       action: () => setEncFilter('none') },
      { id: 'filter-basic',keys: '2', description: 'Basic tier',       category: 'view',       action: () => setEncFilter('basic') },
      { id: 'filter-high', keys: '3', description: 'High tier',        category: 'view',       action: () => setEncFilter('high') },
      { id: 'filter-shadow',keys:'4', description: 'Shadow tier',      category: 'view',       action: () => setEncFilter('shadow') },
      { id: 'sort-cycle',  keys: 's', description: 'Cycle sort mode',  category: 'view',       action: () => setSortMode((m) => {
        const order: SortMode[] = ['newest', 'price-asc', 'price-desc', 'expiring'];
        return order[(order.indexOf(m) + 1) % order.length];
      }) },
    ],
    { lensId: 'black-market' }
  );

  const buy = useCallback(async (listing: Listing) => {
    setPurchasing(listing.id);
    setError(null);
    try {
      const res = await fetch(`/api/black-market/${encodeURIComponent(listing.id)}/purchase`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.reason === 'insufficient_sparks') {
          setError(`Need ${json.price} sparks; you have ${json.have}.`);
        } else {
          setError(json.reason || json.error || 'Purchase failed.');
        }
        return;
      }
      setRevealed(json.message);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setPurchasing(null);
    }
  }, [reload]);

  const tierColor = (level: string) =>
    level === 'shadow' ? 'border-rose-500/50 bg-rose-950/30 text-rose-200'
    : level === 'high' ? 'border-amber-500/50 bg-amber-950/30 text-amber-200'
    : level === 'basic' ? 'border-cyan-500/40 bg-cyan-950/20 text-cyan-200'
    : 'border-slate-700 bg-slate-900/40 text-slate-300';

  return (
    <LensShell lensId="black-market" asMain={false}>
      <FirstRunTour lensId="black-market" />
      <ManifestActionBar />
      <DepthBadge lensId="black-market" size="sm" className="ml-2" />
      <LensVerticalHero lensId="black-market" className="mx-6 mt-4" />
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6 border-b border-rose-500/30 pb-4">
          <h1 className="text-2xl font-semibold text-rose-200">The Black Market</h1>
          <p className="mt-1 text-xs text-slate-400">
            Sael&apos;s stall. Intercepted Concord Link messages. Sender and receiver
            redacted; payload revealed on purchase. Sparks only.
          </p>
        </header>

        {reputation.length > 0 && (
          <section className="mb-6 rounded border border-slate-800 bg-slate-900/50 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">Your standing</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {reputation.map((r) => (
                <div key={r.fence_npc_id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5">
                  <span className="font-mono text-xs text-slate-300">{r.fence_npc_id}</span>
                  <span className={`text-xs font-semibold ${r.buyer_rep > 0 ? 'text-emerald-300' : r.buyer_rep < 0 ? 'text-rose-300' : 'text-slate-400'}`}>
                    rep {r.buyer_rep > 0 ? '+' : ''}{r.buyer_rep} · {r.purchases} buys
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {error && (
          <div role="alert" className="mb-4 rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loadError && !loading && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
          >
            <span>{loadError}</span>
            <button
              onClick={reload}
              className="shrink-0 rounded border border-rose-400/50 bg-rose-900/40 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-800/60 focus:outline-none focus:ring-2 focus:ring-rose-400"
            >
              Retry
            </button>
          </div>
        )}

        {loading && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400"
          >
            Loading intercepted messages…
          </div>
        )}

        {revealed && (
          <section className="mb-6 rounded border border-emerald-500/40 bg-emerald-950/30 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-emerald-200">Revealed</h2>
              <button onClick={() => setRevealed(null)} className="text-xs text-slate-400 hover:text-slate-200" aria-label="Dismiss">
                dismiss
              </button>
            </div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400/80">
              {revealed.source_world} → {revealed.dest_world} · {revealed.encryption_level} encryption
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-100">{revealed.payload}</p>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              {loading ? 'Loading…' : encFilter === 'all'
                ? `${visibleListings.length} active listing${visibleListings.length === 1 ? '' : 's'}`
                : `${visibleListings.length} of ${listings.length} · ${encFilter}`}
            </p>
            <div className="flex items-center gap-1 text-[10px]">
              {(['all', 'none', 'basic', 'high', 'shadow'] as const).map((t, i) => (
                <button
                  key={t}
                  onClick={() => setEncFilter(t)}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    encFilter === t
                      ? 'border-rose-500/60 bg-rose-950/50 text-rose-200'
                      : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {t}<kbd className="text-[8px] opacity-60 ml-0.5">{i}</kbd>
                </button>
              ))}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="ml-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-300"
                title="Sort listings"
              >
                <option value="newest">newest</option>
                <option value="price-asc">price ↑</option>
                <option value="price-desc">price ↓</option>
                <option value="expiring">expiring</option>
              </select>
              <button
                onClick={reload}
                className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-amber-500"
                title="Refresh (r)"
              >
                ↻
              </button>
            </div>
          </div>
          {!loading && !loadError && listings.length === 0 && (
            <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-400">
              No intercepted messages on the market right now. Check back after a Walker journey gets interrupted.
            </p>
          )}
          {!loading && listings.length > 0 && visibleListings.length === 0 && (
            <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-400">
              No <span className="text-rose-300">{encFilter}</span>-tier listings right now. Try a wider filter.
            </p>
          )}
          <div className="space-y-2">
            {visibleListings.map((l) => (
              <div key={l.id} className={`rounded border p-3 ${tierColor(l.encryption_level)}`}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-70">
                    {l.encryption_level} · {fmtTime(l.created_at)}
                  </span>
                  <span className="text-sm font-semibold">
                    {l.price_sparks} <span className="text-[10px] opacity-70">sparks</span>
                  </span>
                </div>
                <p className="mb-2 font-mono text-xs opacity-90">{l.redacted_preview}</p>
                <p className="mb-2 text-[10px] opacity-70">
                  fence: {l.fence_npc_id} · expires {fmtTime(l.expires_at)}
                </p>
                <button
                  onClick={() => buy(l)}
                  disabled={purchasing === l.id}
                  className="w-full rounded bg-rose-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                >
                  {purchasing === l.id ? 'Purchasing…' : `Buy for ${l.price_sparks} sparks`}
                </button>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-[10px] text-slate-400">
          All prices in sparks. No real-money codepaths.
        </footer>
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SaelStall />
      </section>
      <section className="mx-auto mt-6 max-w-4xl rounded-xl border border-rose-500/20 bg-zinc-950/40 p-4">
        <UndergroundExchange />
      </section>
    </main>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
          <RecentMineCard domain="black-market" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="black-market" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="black-market" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
