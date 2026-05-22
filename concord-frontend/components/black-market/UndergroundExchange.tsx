'use client';

/**
 * UndergroundExchange — the live, player-driven layer of Sael's stall.
 *
 * Sits alongside the read-only intercept rack (`SaelStall`). Every feature
 * here is wired to the `black-market` lens domain macros and persists real
 * user input — no seed/demo data. Six sub-surfaces:
 *   - Auctions: list a rare intercept for bidding; bid; settle.
 *   - Reputation: live fence standing + which encryption tiers it unlocks.
 *   - Haggle: negotiate an open auction's price with the fence NPC.
 *   - Owned + Resale: player-to-player resale of won intercepts.
 *   - Watchlist: saved searches that surface matching live listings.
 *   - Decrypt: a Caesar-shift mini-game on owned shadow-tier intercepts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gavel, ShieldCheck, MessageSquare, Repeat, Bell, KeyRound, RefreshCw,
} from 'lucide-react';

import { lensRun } from '@/lib/api/client';

const DOMAIN = 'black-market';
const TIERS = ['none', 'basic', 'high', 'shadow'] as const;
type Tier = (typeof TIERS)[number];

interface Auction {
  id: string;
  sellerId: string;
  title: string;
  preview: string;
  encryptionLevel: Tier;
  minBid: number;
  status: string;
  createdAt: number;
  endsAt: number;
  topBid: number;
  bidCount: number;
  isOwner: boolean;
}
interface Rep {
  score: number;
  purchases: number;
  lastTradeAt: number | null;
  unlockedTiers: Tier[];
  nextTier: { tier: Tier; repNeeded: number } | null;
  gates: Record<string, number>;
}
interface Owned {
  id: string;
  title: string;
  payload: string;
  encryptionLevel: Tier;
  acquiredVia: string;
  pricePaid: number;
  acquiredAt: number;
  decrypted?: boolean;
}
interface Resale {
  id: string;
  sellerId: string;
  title: string;
  encryptionLevel: Tier;
  price: number;
  listedAt: number;
}
interface Watch {
  id: string;
  keyword: string;
  maxPrice: number | null;
  tier: Tier | null;
  createdAt: number;
}
interface Alert {
  watchId: string;
  keyword: string;
  kind: string;
  refId: string;
  title: string;
  price: number;
  encryptionLevel: Tier;
}
interface HaggleResult {
  auctionId: string;
  round: number;
  roundsLeft: number;
  counter: number;
  accepted: boolean;
  agreedPrice: number | null;
  line: string;
}
interface DecryptSession {
  ownedId: string;
  ciphertext: string;
  hint: string;
}

const fmtAgo = (ms: number): string => {
  const d = Date.now() - ms;
  if (d <= 0) return 'just now';
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
};
const fmtUntil = (ms: number) => {
  const d = ms - Date.now();
  if (d <= 0) return 'expired';
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
};
const tierClass = (t: Tier) =>
  t === 'shadow' ? 'border-rose-500/50 bg-rose-950/30 text-rose-200'
  : t === 'high' ? 'border-amber-500/50 bg-amber-950/30 text-amber-200'
  : t === 'basic' ? 'border-cyan-500/40 bg-cyan-950/20 text-cyan-200'
  : 'border-slate-700 bg-slate-900/40 text-slate-300';

type TabId = 'auctions' | 'rep' | 'owned' | 'watch' | 'decrypt';

export function UndergroundExchange() {
  const [tab, setTab] = useState<TabId>('auctions');
  const [rep, setRep] = useState<Rep | null>(null);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [lockedCount, setLockedCount] = useState(0);
  const [owned, setOwned] = useState<Owned[]>([]);
  const [resaleMarket, setResaleMarket] = useState<Resale[]>([]);
  const [resaleMine, setResaleMine] = useState<Resale[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create-auction form.
  const [acTitle, setAcTitle] = useState('');
  const [acPreview, setAcPreview] = useState('');
  const [acPayload, setAcPayload] = useState('');
  const [acTier, setAcTier] = useState<Tier>('none');
  const [acMinBid, setAcMinBid] = useState('10');
  const [acDuration, setAcDuration] = useState('60');

  // Per-auction inputs.
  const [bidInput, setBidInput] = useState<Record<string, string>>({});
  const [haggleInput, setHaggleInput] = useState<Record<string, string>>({});
  const [haggleResult, setHaggleResult] = useState<Record<string, HaggleResult>>({});

  // Resale form.
  const [resalePrice, setResalePrice] = useState<Record<string, string>>({});

  // Watchlist form.
  const [watchKeyword, setWatchKeyword] = useState('');
  const [watchMaxPrice, setWatchMaxPrice] = useState('');
  const [watchTier, setWatchTier] = useState<'' | Tier>('');

  // Decrypt sessions.
  const [decrypt, setDecrypt] = useState<Record<string, DecryptSession>>({});
  const [decryptGuess, setDecryptGuess] = useState<Record<string, string>>({});
  const [decryptMsg, setDecryptMsg] = useState<Record<string, string>>({});

  const run = useCallback(
    async <T,>(macro: string, params: Record<string, unknown> = {}): Promise<T | null> => {
      const r = await lensRun<T>(DOMAIN, macro, params);
      if (!r.data?.ok) {
        setError(r.data?.error || `${macro} failed`);
        return null;
      }
      return r.data.result;
    },
    [],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [repR, invR, ownedR, resaleR, watchR, alertR] = await Promise.all([
      lensRun<Rep>(DOMAIN, 'rep-get', {}),
      lensRun<{ auctions: Auction[]; lockedCount: number }>(DOMAIN, 'inventory', {}),
      lensRun<{ owned: Owned[] }>(DOMAIN, 'owned-list', {}),
      lensRun<{ market: Resale[]; mine: Resale[] }>(DOMAIN, 'resale-market', {}),
      lensRun<{ watches: Watch[] }>(DOMAIN, 'watch-list', {}),
      lensRun<{ alerts: Alert[] }>(DOMAIN, 'watch-check', {}),
    ]);
    if (repR.data?.ok && repR.data.result) setRep(repR.data.result);
    if (invR.data?.ok && invR.data.result) {
      setAuctions(invR.data.result.auctions || []);
      setLockedCount(invR.data.result.lockedCount || 0);
    }
    if (ownedR.data?.ok && ownedR.data.result) setOwned(ownedR.data.result.owned || []);
    if (resaleR.data?.ok && resaleR.data.result) {
      setResaleMarket(resaleR.data.result.market || []);
      setResaleMine(resaleR.data.result.mine || []);
    }
    if (watchR.data?.ok && watchR.data.result) setWatches(watchR.data.result.watches || []);
    if (alertR.data?.ok && alertR.data.result) setAlerts(alertR.data.result.alerts || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setError(null);
  }, []);

  // ── Auctions ──────────────────────────────────────────────────────────
  const createAuction = useCallback(async () => {
    setBusy('create-auction');
    const res = await run<{ auction: Auction }>('auction-create', {
      title: acTitle,
      preview: acPreview,
      payload: acPayload,
      encryptionLevel: acTier,
      minBid: Number(acMinBid) || 1,
      durationMin: Number(acDuration) || 60,
    });
    setBusy(null);
    if (res) {
      flash(`Listed "${res.auction.title}" for auction.`);
      setAcTitle('');
      setAcPreview('');
      setAcPayload('');
      setAcMinBid('10');
      await reload();
    }
  }, [run, acTitle, acPreview, acPayload, acTier, acMinBid, acDuration, flash, reload]);

  const placeBid = useCallback(async (a: Auction) => {
    const amount = Number(bidInput[a.id]);
    if (!amount) {
      setError('Enter a bid amount.');
      return;
    }
    setBusy(`bid-${a.id}`);
    const res = await run<{ topBid: number }>('auction-bid', { auctionId: a.id, amount });
    setBusy(null);
    if (res) {
      flash(`Top bid on "${a.title}" is now ${res.topBid} sparks.`);
      setBidInput((s) => ({ ...s, [a.id]: '' }));
      await reload();
    }
  }, [run, bidInput, flash, reload]);

  const settle = useCallback(async (a: Auction) => {
    setBusy(`settle-${a.id}`);
    const res = await run<{ sold: boolean; winnerId: string | null }>('auction-settle', { auctionId: a.id });
    setBusy(null);
    if (res) {
      flash(res.sold ? `"${a.title}" sold to the high bidder.` : `"${a.title}" closed unsold.`);
      await reload();
    }
  }, [run, flash, reload]);

  // ── Haggle ────────────────────────────────────────────────────────────
  const haggle = useCallback(async (a: Auction) => {
    const offer = Number(haggleInput[a.id]);
    if (!offer) {
      setError('Enter an offer.');
      return;
    }
    setBusy(`haggle-${a.id}`);
    const res = await run<HaggleResult>('haggle', { auctionId: a.id, offer });
    setBusy(null);
    if (res) {
      setHaggleResult((s) => ({ ...s, [a.id]: res }));
      flash(res.line);
    }
  }, [run, haggleInput, flash]);

  const acceptHaggle = useCallback(async (a: Auction) => {
    setBusy(`haggle-accept-${a.id}`);
    const res = await run<{ pricePaid: number }>('haggle-accept', { auctionId: a.id });
    setBusy(null);
    if (res) {
      flash(`Deal closed at ${res.pricePaid} sparks — the intercept is yours.`);
      setHaggleResult((s) => {
        const next = { ...s };
        delete next[a.id];
        return next;
      });
      await reload();
    }
  }, [run, flash, reload]);

  // ── Resale ────────────────────────────────────────────────────────────
  const listResale = useCallback(async (o: Owned) => {
    const price = Number(resalePrice[o.id]);
    if (!price) {
      setError('Enter a resale price.');
      return;
    }
    setBusy(`resale-${o.id}`);
    const res = await run<{ resale: Resale }>('resale-create', { ownedId: o.id, price });
    setBusy(null);
    if (res) {
      flash(`Listed "${o.title}" for resale at ${price} sparks.`);
      setResalePrice((s) => ({ ...s, [o.id]: '' }));
      await reload();
    }
  }, [run, resalePrice, flash, reload]);

  const buyResale = useCallback(async (r: Resale) => {
    setBusy(`resale-buy-${r.id}`);
    const res = await run<{ resale: Resale }>('resale-buy', { resaleId: r.id });
    setBusy(null);
    if (res) {
      flash(`Bought "${r.title}" for ${r.price} sparks.`);
      await reload();
    }
  }, [run, flash, reload]);

  // ── Watchlist ─────────────────────────────────────────────────────────
  const addWatch = useCallback(async () => {
    if (!watchKeyword.trim()) {
      setError('Enter a keyword to watch.');
      return;
    }
    setBusy('add-watch');
    const params: Record<string, unknown> = { keyword: watchKeyword.trim() };
    if (watchMaxPrice) params.maxPrice = Number(watchMaxPrice);
    if (watchTier) params.tier = watchTier;
    const res = await run<{ watch: Watch }>('watch-add', params);
    setBusy(null);
    if (res) {
      flash(`Watching "${res.watch.keyword}".`);
      setWatchKeyword('');
      setWatchMaxPrice('');
      setWatchTier('');
      await reload();
    }
  }, [run, watchKeyword, watchMaxPrice, watchTier, flash, reload]);

  const removeWatch = useCallback(async (w: Watch) => {
    setBusy(`rm-watch-${w.id}`);
    const res = await run<{ removed: string }>('watch-remove', { watchId: w.id });
    setBusy(null);
    if (res) {
      flash(`Stopped watching "${w.keyword}".`);
      await reload();
    }
  }, [run, flash, reload]);

  // ── Decrypt ───────────────────────────────────────────────────────────
  const startDecrypt = useCallback(async (o: Owned) => {
    setBusy(`decrypt-start-${o.id}`);
    const res = await run<DecryptSession>('decrypt-start', { ownedId: o.id });
    setBusy(null);
    if (res) {
      setDecrypt((s) => ({ ...s, [o.id]: res }));
      setDecryptMsg((s) => ({ ...s, [o.id]: res.hint }));
    }
  }, [run]);

  const submitGuess = useCallback(async (o: Owned) => {
    const shift = Number(decryptGuess[o.id]);
    if (!shift) {
      setError('Enter a shift (1–25).');
      return;
    }
    setBusy(`decrypt-guess-${o.id}`);
    const res = await run<{
      correct: boolean;
      attempts: number;
      hint?: string;
      plaintext?: string;
      repAwarded?: number;
    }>('decrypt-guess', { ownedId: o.id, shift });
    setBusy(null);
    if (res) {
      if (res.correct) {
        setDecryptMsg((s) => ({
          ...s,
          [o.id]: `Cracked in ${res.attempts} ${res.attempts === 1 ? 'try' : 'tries'} — +${res.repAwarded} rep.`,
        }));
        flash('Shadow-tier intercept decrypted.');
        await reload();
      } else {
        setDecryptMsg((s) => ({ ...s, [o.id]: res.hint || 'Wrong key.' }));
      }
    }
  }, [run, decryptGuess, flash, reload]);

  const shadowOwned = useMemo(
    () => owned.filter((o) => o.encryptionLevel === 'shadow'),
    [owned],
  );

  const tabs: { id: TabId; label: string; icon: typeof Gavel; count?: number }[] = [
    { id: 'auctions', label: 'Auctions', icon: Gavel, count: auctions.length },
    { id: 'rep', label: 'Standing', icon: ShieldCheck },
    { id: 'owned', label: 'Owned & Resale', icon: Repeat, count: owned.length },
    { id: 'watch', label: 'Watchlist', icon: Bell, count: alerts.length },
    { id: 'decrypt', label: 'Decrypt', icon: KeyRound, count: shadowOwned.length },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-rose-500/20 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-rose-200">Underground Exchange</h2>
          <p className="text-[10px] text-slate-500">
            Player auctions, haggling, resale, watchlists and shadow-tier decryption. Sparks only.
          </p>
        </div>
        <button
          onClick={() => void reload()}
          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="h-3 w-3" /> refresh
        </button>
      </header>

      <nav className="flex flex-wrap gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] transition-colors ${
                tab === t.id
                  ? 'bg-rose-600/80 text-white'
                  : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Icon className="h-3 w-3" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="rounded bg-black/30 px-1 text-[9px]">{t.count}</span>
              )}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs text-rose-200">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded border border-emerald-500/30 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      {loading && <p className="text-xs text-slate-500">Loading the exchange…</p>}

      {/* ── AUCTIONS ───────────────────────────────────────────────── */}
      {!loading && tab === 'auctions' && (
        <div className="space-y-4">
          <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              List an intercept for auction
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={acTitle}
                onChange={(e) => setAcTitle(e.target.value)}
                placeholder="Title (e.g. Cipher fragment)"
                maxLength={120}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <input
                value={acPreview}
                onChange={(e) => setAcPreview(e.target.value)}
                placeholder="Redacted preview (shown to buyers)"
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
            </div>
            <textarea
              value={acPayload}
              onChange={(e) => setAcPayload(e.target.value)}
              placeholder="Full payload (revealed to the winner)"
              rows={2}
              className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={acTier}
                onChange={(e) => setAcTier(e.target.value as Tier)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                aria-label="Encryption tier"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t} tier</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                min bid
                <input
                  type="number"
                  min={1}
                  value={acMinBid}
                  onChange={(e) => setAcMinBid(e.target.value)}
                  className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                duration (min)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={acDuration}
                  onChange={(e) => setAcDuration(e.target.value)}
                  className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                />
              </label>
              <button
                onClick={() => void createAuction()}
                disabled={busy === 'create-auction'}
                className="rounded bg-rose-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {busy === 'create-auction' ? 'Listing…' : 'List auction'}
              </button>
            </div>
          </section>

          {lockedCount > 0 && (
            <p className="text-[11px] text-amber-300/80">
              {lockedCount} listing{lockedCount === 1 ? '' : 's'} hidden — your reputation has not
              unlocked their encryption tier.
            </p>
          )}

          {auctions.length === 0 ? (
            <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-500">
              No open auctions yet. List an intercept above to start one.
            </p>
          ) : (
            <div className="space-y-2">
              {auctions.map((a) => {
                const hag = haggleResult[a.id];
                return (
                  <div key={a.id} className={`rounded border p-3 ${tierClass(a.encryptionLevel)}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{a.title}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {a.encryptionLevel} · ends in {fmtUntil(a.endsAt)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs opacity-90">{a.preview}</p>
                    <p className="mt-1 text-[11px] opacity-80">
                      top bid {a.topBid} sparks · {a.bidCount} bid{a.bidCount === 1 ? '' : 's'} ·
                      listed {fmtAgo(a.createdAt)}
                    </p>
                    {!a.isOwner && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={a.topBid + 1}
                          value={bidInput[a.id] || ''}
                          onChange={(e) => setBidInput((s) => ({ ...s, [a.id]: e.target.value }))}
                          placeholder={`> ${a.topBid}`}
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                        />
                        <button
                          onClick={() => void placeBid(a)}
                          disabled={busy === `bid-${a.id}`}
                          className="rounded bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                        >
                          {busy === `bid-${a.id}` ? 'Bidding…' : 'Bid'}
                        </button>
                        <span className="text-slate-500">·</span>
                        <input
                          type="number"
                          min={1}
                          value={haggleInput[a.id] || ''}
                          onChange={(e) => setHaggleInput((s) => ({ ...s, [a.id]: e.target.value }))}
                          placeholder="offer Sael"
                          className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                        />
                        <button
                          onClick={() => void haggle(a)}
                          disabled={busy === `haggle-${a.id}`}
                          className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-900/40 disabled:opacity-50"
                        >
                          <MessageSquare className="h-3 w-3" /> Haggle
                        </button>
                      </div>
                    )}
                    {hag && (
                      <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-100">
                        <p className="italic">&ldquo;{hag.line}&rdquo;</p>
                        <p className="mt-0.5 text-amber-300/80">
                          counter {hag.counter} sparks · round {hag.round} ·
                          {' '}{hag.roundsLeft} left
                        </p>
                        {hag.accepted && (
                          <button
                            onClick={() => void acceptHaggle(a)}
                            disabled={busy === `haggle-accept-${a.id}`}
                            className="mt-1 rounded bg-emerald-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Accept deal at {hag.agreedPrice} sparks
                          </button>
                        )}
                      </div>
                    )}
                    {a.isOwner && (
                      <button
                        onClick={() => void settle(a)}
                        disabled={busy === `settle-${a.id}`}
                        className="mt-2 rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                      >
                        {busy === `settle-${a.id}` ? 'Settling…' : 'Settle auction'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── REPUTATION ─────────────────────────────────────────────── */}
      {!loading && tab === 'rep' && (
        <div className="space-y-3">
          {!rep ? (
            <p className="text-xs text-slate-500">No reputation data yet.</p>
          ) : (
            <>
              <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold text-rose-200">{rep.score}</span>
                  <span className="text-[11px] text-slate-500">
                    {rep.purchases} trade{rep.purchases === 1 ? '' : 's'} ·
                    {' '}{rep.lastTradeAt ? `last ${fmtAgo(rep.lastTradeAt)}` : 'no trades yet'}
                  </span>
                </div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">fence reputation</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                  Encryption tiers
                </p>
                <div className="space-y-1.5">
                  {TIERS.map((t) => {
                    const unlocked = rep.unlockedTiers.includes(t);
                    const need = rep.gates[t] ?? 0;
                    return (
                      <div
                        key={t}
                        className={`flex items-center justify-between rounded border px-2 py-1.5 text-xs ${
                          unlocked ? tierClass(t) : 'border-slate-800 bg-slate-950/50 text-slate-600'
                        }`}
                      >
                        <span className="font-medium">{t} tier</span>
                        <span>
                          {unlocked ? 'unlocked' : `needs ${need} rep`}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {rep.nextTier && (
                  <p className="mt-2 text-[11px] text-amber-300/80">
                    {rep.nextTier.repNeeded - rep.score} more rep unlocks the
                    {' '}<span className="font-semibold">{rep.nextTier.tier}</span> tier.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── OWNED & RESALE ─────────────────────────────────────────── */}
      {!loading && tab === 'owned' && (
        <div className="space-y-4">
          <section>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Your intercepts
            </p>
            {owned.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-500">
                No owned intercepts yet. Win an auction or buy a resale.
              </p>
            ) : (
              <div className="space-y-2">
                {owned.map((o) => (
                  <div key={o.id} className={`rounded border p-3 ${tierClass(o.encryptionLevel)}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{o.title}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {o.encryptionLevel} · via {o.acquiredVia}
                      </span>
                    </div>
                    {o.encryptionLevel !== 'shadow' || o.decrypted ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs opacity-90">{o.payload}</p>
                    ) : (
                      <p className="mt-1 text-[11px] italic opacity-70">
                        Shadow-tier — decrypt it in the Decrypt tab to read the payload.
                      </p>
                    )}
                    <p className="mt-1 text-[11px] opacity-70">
                      paid {o.pricePaid} sparks · acquired {fmtAgo(o.acquiredAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={resalePrice[o.id] || ''}
                        onChange={(e) => setResalePrice((s) => ({ ...s, [o.id]: e.target.value }))}
                        placeholder="resale price"
                        className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                      />
                      <button
                        onClick={() => void listResale(o)}
                        disabled={busy === `resale-${o.id}`}
                        className="inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                      >
                        <Repeat className="h-3 w-3" /> List for resale
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Resale market
            </p>
            {resaleMarket.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-3 text-center text-xs text-slate-500">
                No resale listings from other players right now.
              </p>
            ) : (
              <div className="space-y-2">
                {resaleMarket.map((r) => (
                  <div key={r.id} className={`flex items-center justify-between gap-2 rounded border p-2.5 ${tierClass(r.encryptionLevel)}`}>
                    <div>
                      <span className="text-xs font-semibold">{r.title}</span>
                      <p className="text-[10px] opacity-70">
                        {r.encryptionLevel} tier · listed {fmtAgo(r.listedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => void buyResale(r)}
                      disabled={busy === `resale-buy-${r.id}`}
                      className="rounded bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                    >
                      {busy === `resale-buy-${r.id}` ? 'Buying…' : `Buy ${r.price}✦`}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {resaleMine.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                Your resale listings
              </p>
              <div className="space-y-1.5">
                {resaleMine.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-xs text-slate-300">
                    <span>{r.title}</span>
                    <span className="text-slate-500">{r.price}✦ · {r.encryptionLevel}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── WATCHLIST ──────────────────────────────────────────────── */}
      {!loading && tab === 'watch' && (
        <div className="space-y-4">
          <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              New saved search
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={watchKeyword}
                onChange={(e) => setWatchKeyword(e.target.value)}
                placeholder="keyword (title / preview)"
                maxLength={60}
                className="flex-1 min-w-[160px] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <input
                type="number"
                min={1}
                value={watchMaxPrice}
                onChange={(e) => setWatchMaxPrice(e.target.value)}
                placeholder="max price (optional)"
                className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
              />
              <select
                value={watchTier}
                onChange={(e) => setWatchTier(e.target.value as '' | Tier)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                aria-label="Tier filter"
              >
                <option value="">any tier</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>{t} only</option>
                ))}
              </select>
              <button
                onClick={() => void addWatch()}
                disabled={busy === 'add-watch'}
                className="rounded bg-rose-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                Watch
              </button>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Live alerts ({alerts.length})
            </p>
            {alerts.length === 0 ? (
              <p className="rounded border border-slate-800 bg-slate-900/40 p-3 text-center text-xs text-slate-500">
                No matches yet. Alerts appear when a live auction or resale matches a saved search.
              </p>
            ) : (
              <div className="space-y-1.5">
                {alerts.map((a) => (
                  <div
                    key={`${a.watchId}-${a.refId}`}
                    className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-xs ${tierClass(a.encryptionLevel)}`}
                  >
                    <div>
                      <span className="font-semibold">{a.title}</span>
                      <p className="text-[10px] opacity-70">
                        {a.kind} · matched &ldquo;{a.keyword}&rdquo;
                      </p>
                    </div>
                    <span className="font-mono">{a.price}✦</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {watches.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                Saved searches
              </p>
              <div className="space-y-1.5">
                {watches.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-xs text-slate-300"
                  >
                    <span>
                      &ldquo;{w.keyword}&rdquo;
                      {w.maxPrice != null && <span className="text-slate-500"> · ≤{w.maxPrice}✦</span>}
                      {w.tier && <span className="text-slate-500"> · {w.tier}</span>}
                    </span>
                    <button
                      onClick={() => void removeWatch(w)}
                      disabled={busy === `rm-watch-${w.id}`}
                      className="text-slate-500 hover:text-rose-300 disabled:opacity-50"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── DECRYPT ────────────────────────────────────────────────── */}
      {!loading && tab === 'decrypt' && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">
            Shadow-tier intercepts ship encrypted. Guess the Caesar shift (1–25) to crack the
            payload. Fewer attempts earn more reputation.
          </p>
          {shadowOwned.length === 0 ? (
            <p className="rounded border border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-500">
              You own no shadow-tier intercepts. Win one at auction to play the decryption game.
            </p>
          ) : (
            <div className="space-y-2">
              {shadowOwned.map((o) => {
                const sess = decrypt[o.id];
                const msg = decryptMsg[o.id];
                return (
                  <div key={o.id} className={`rounded border p-3 ${tierClass('shadow')}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{o.title}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-70">
                        {o.decrypted ? 'decrypted' : 'encrypted'}
                      </span>
                    </div>
                    {o.decrypted ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs opacity-90">{o.payload}</p>
                    ) : !sess ? (
                      <button
                        onClick={() => void startDecrypt(o)}
                        disabled={busy === `decrypt-start-${o.id}`}
                        className="mt-2 inline-flex items-center gap-1 rounded bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        <KeyRound className="h-3 w-3" /> Start decryption
                      </button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <p className="break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-rose-200">
                          {sess.ciphertext}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={25}
                            value={decryptGuess[o.id] || ''}
                            onChange={(e) =>
                              setDecryptGuess((s) => ({ ...s, [o.id]: e.target.value }))
                            }
                            placeholder="shift 1–25"
                            className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                          />
                          <button
                            onClick={() => void submitGuess(o)}
                            disabled={busy === `decrypt-guess-${o.id}`}
                            className="rounded bg-rose-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                          >
                            Guess
                          </button>
                        </div>
                      </div>
                    )}
                    {msg && (
                      <p className="mt-1.5 text-[11px] text-amber-200">{msg}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
