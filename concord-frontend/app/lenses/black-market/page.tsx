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

import { useCallback, useEffect, useState } from 'react';

import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
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
  const [listings, setListings] = useState<Listing[]>([]);
  const [reputation, setReputation] = useState<FenceReputation[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [listingsRes, repRes] = await Promise.all([
        fetch('/api/black-market').then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/black-market/reputation', { credentials: 'same-origin' })
          .then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      if (listingsRes?.ok && Array.isArray(listingsRes.listings)) {
        setListings(listingsRes.listings);
      }
      if (repRes?.ok && Array.isArray(repRes.reputation)) {
        setReputation(repRes.reputation);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      <ManifestActionBar />
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
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Your standing</p>
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
          <div className="mb-4 rounded border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
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
          <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
            {loading ? 'Loading…' : `${listings.length} active listing${listings.length === 1 ? '' : 's'}`}
          </p>
          {!loading && listings.length === 0 && (
            <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-500">
              No intercepted messages on the market right now. Check back after a Walker journey gets interrupted.
            </p>
          )}
          <div className="space-y-2">
            {listings.map((l) => (
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

        <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-[10px] text-slate-500">
          All prices in sparks. No real-money codepaths.
        </footer>
      </div>
    </main>
    </LensShell>
  );
}
