'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gavel, X, Loader2, RefreshCw, Clock, TrendingUp, User, Tag, ChevronLeft,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Backend shapes (verified against server/server.js + server/lib/auctions.js) ──
//
// GET /api/auctions/active?limit=50  → { ok, auctions: Auction[] }
//   The HTTP route does NOT filter by world (listActiveAuctions takes only a
//   limit), but each row carries `worldId`, so we filter client-side to this
//   world. Times (startsAt/endsAt) are UNIX SECONDS.
//
// GET /api/auctions/item/:itemId/price-history?limit=100
//   → { ok, points: [{ cc, at }], stats: { count,min,max,avg,last,changePct } | null }
//
// POST /api/auctions/:auctionId/bid  { amountCc }
//   → { ok, bid, endsAt }  OR  { ok:false, error } (must_exceed_current,
//     insufficient_funds, cannot_bid_on_own, expired, …) — surfaced verbatim.

interface Auction {
  id: string;
  sellerUserId?: string;
  worldId?: string;
  itemKind?: string;
  itemId?: string;
  title?: string;
  startCc?: number;
  currentBidCc?: number;
  buyoutCc?: number | null;
  bidCount?: number;
  leadingBidderUserId?: string | null;
  startsAt?: number; // unix seconds
  endsAt?: number; // unix seconds
}

interface PricePoint { cc: number; at: number }
interface PriceStats {
  count: number; min: number; max: number; avg: number; last: number; changePct: number;
}

interface Props {
  worldId: string;
  onClose?: () => void;
}

function humanizeRemaining(endsAtSec: number | undefined, nowMs: number): string {
  if (endsAtSec == null) return 'no deadline';
  const ms = endsAtSec * 1000 - nowMs;
  if (ms <= 0) return 'ended';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m left`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h left`;
  return `${Math.round(h / 24)}d left`;
}

/** Lowest acceptable next bid: must strictly exceed the current bid (or meet start). */
function minNextBid(a: Auction): number {
  const cur = a.currentBidCc ?? 0;
  if (cur > 0) return cur + 1;
  return a.startCc ?? 1;
}

export function AuctionBrowsePanel({ worldId, onClose }: Props) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Selected auction → bid form + price history.
  const [selected, setSelected] = useState<Auction | null>(null);
  const [bidAmount, setBidAmount] = useState<string>('');
  const [bidding, setBidding] = useState(false);
  const [bidMsg, setBidMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [history, setHistory] = useState<{ points: PricePoint[]; stats: PriceStats | null } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/auctions/active', { params: { limit: 100 } });
      const data = res.data as { ok?: boolean; auctions?: Auction[] };
      const all = Array.isArray(data?.auctions) ? data.auctions : [];
      // Filter to this world (rows that omit worldId are shown to be safe).
      setAuctions(all.filter((a) => !a.worldId || a.worldId === worldId));
      setNow(Date.now());
    } catch (e) {
      console.error('[AuctionBrowsePanel] fetch failed', e);
      setError('Could not load active auctions. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Keep "time left" fresh without refetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const openAuction = useCallback(async (a: Auction) => {
    setSelected(a);
    setBidAmount(String(minNextBid(a)));
    setBidMsg(null);
    setHistory(null);
    if (!a.itemId) return;
    setHistoryLoading(true);
    try {
      const res = await api.get(`/api/auctions/item/${encodeURIComponent(a.itemId)}/price-history`, {
        params: { limit: 100 },
      });
      const d = res.data as { ok?: boolean; points?: PricePoint[]; stats?: PriceStats | null };
      setHistory({ points: Array.isArray(d?.points) ? d.points : [], stats: d?.stats ?? null });
    } catch (e) {
      console.error('[AuctionBrowsePanel] price-history failed', e);
      setHistory({ points: [], stats: null });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const placeBid = useCallback(async () => {
    if (!selected) return;
    const amountCc = Number(bidAmount);
    if (!Number.isFinite(amountCc) || amountCc <= 0) {
      setBidMsg({ kind: 'err', text: 'Enter a valid bid amount.' });
      return;
    }
    setBidding(true);
    setBidMsg(null);
    try {
      const res = await api.post(`/api/auctions/${encodeURIComponent(selected.id)}/bid`, { amountCc });
      const d = res.data as { ok?: boolean; bid?: number; error?: string };
      if (d?.ok) {
        setBidMsg({ kind: 'ok', text: `Bid placed: ${d.bid} CC` });
        refresh();
      } else {
        setBidMsg({ kind: 'err', text: `Bid rejected: ${d?.error || 'unknown error'}` });
      }
    } catch (e) {
      console.error('[AuctionBrowsePanel] bid failed', e);
      setBidMsg({ kind: 'err', text: 'Bid failed. Try again.' });
    } finally {
      setBidding(false);
    }
  }, [selected, bidAmount, refresh]);

  const sorted = useMemo(
    () => [...auctions].sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity)),
    [auctions],
  );

  const bidNum = Number(bidAmount);
  const totalCost = Number.isFinite(bidNum) && bidNum > 0 ? bidNum : 0;

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-[100vw] z-40 flex flex-col bg-black/80 backdrop-blur-sm border-l border-white/10 text-white shadow-2xl overflow-hidden">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-amber-950/40 to-transparent">
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="p-1 rounded-md hover:bg-white/5 text-gray-400"
              aria-label="Back to auctions"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
            <Gavel className="w-4 h-4 text-amber-400" />
          )}
          <span className="text-sm font-semibold text-gray-200">
            {selected ? selected.title || 'Auction' : 'Auction house'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400 disabled:opacity-50"
            aria-label="Refresh auctions"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md hover:bg-white/5 text-gray-400"
              aria-label="Close auction house"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ── Detail / bid view ─────────────────────────────────────── */}
        {selected ? (
          <div className="space-y-4">
            <div className="rounded-md border border-white/10 bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-100">{selected.title || 'Untitled item'}</span>
                {selected.itemKind && (
                  <span className="text-[10px] uppercase tracking-wider text-amber-300/80">{selected.itemKind}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Current: {selected.currentBidCc ?? 0} CC
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {humanizeRemaining(selected.endsAt, now)}
                </span>
                <span className="inline-flex items-center gap-1">
                  {(selected.bidCount ?? 0)} bid{(selected.bidCount ?? 0) === 1 ? '' : 's'}
                </span>
              </div>
              {selected.sellerUserId && (
                <div className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                  <User className="w-3 h-3" /> Seller: {selected.sellerUserId}
                </div>
              )}
            </div>

            {/* Price history */}
            <section>
              <h3 className="px-1 mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                <TrendingUp className="w-3 h-3 text-cyan-400" /> Recent prices
              </h3>
              {historyLoading ? (
                <p className="px-3 py-2 text-xs text-gray-400 inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading price history…
                </p>
              ) : history && history.stats ? (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-gray-300 space-y-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Last: <span className="text-gray-100">{history.stats.last} CC</span></span>
                    <span>Avg: <span className="text-gray-100">{history.stats.avg} CC</span></span>
                    <span>Min: {history.stats.min}</span>
                    <span>Max: {history.stats.max}</span>
                  </div>
                  <div className="text-gray-500">
                    {history.stats.count} past sale{history.stats.count === 1 ? '' : 's'} ·{' '}
                    <span className={history.stats.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {history.stats.changePct >= 0 ? '+' : ''}{history.stats.changePct}%
                    </span>
                  </div>
                </div>
              ) : (
                <p className="px-3 py-2 text-xs text-gray-500 italic">No prior sales recorded for this item</p>
              )}
            </section>

            {/* Bid form */}
            <section className="rounded-md border border-white/10 bg-black/20 p-3 space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                <Gavel className="w-3 h-3 text-amber-400" /> Place a bid
              </h3>
              <p className="text-[11px] text-gray-500">
                Minimum next bid: {minNextBid(selected)} CC
              </p>
              <input
                type="number"
                min={minNextBid(selected)}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                aria-label="Bid amount in CC"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30"
                placeholder="Bid amount (CC)"
              />
              <div className="text-[11px] text-amber-200/90">
                You will be charged <span className="font-semibold">{totalCost} CC</span> if you win.
              </div>
              {bidMsg && (
                <div
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px]',
                    bidMsg.kind === 'ok'
                      ? 'border border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                      : 'border border-red-500/30 bg-red-950/20 text-red-300',
                  )}
                >
                  {bidMsg.text}
                </div>
              )}
              <button
                type="button"
                onClick={placeBid}
                disabled={bidding || totalCost <= 0}
                className="w-full rounded-lg bg-amber-600/80 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
              >
                {bidding ? 'Placing bid…' : `Bid ${totalCost} CC`}
              </button>
            </section>
          </div>
        ) : loading && auctions.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading auctions…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/30 bg-red-950/20 px-4 py-6 text-center">
            <p className="text-xs text-red-300">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 px-3 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-gray-200"
            >
              Retry
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-gray-500 italic">
            No active auctions in this world right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => openAuction(a)}
                  className="w-full text-left rounded-md border border-white/10 bg-black/20 px-3 py-2 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-gray-100 truncate">
                      {a.title || a.itemId || 'Untitled item'}
                    </span>
                    {a.itemKind && (
                      <span className="text-[10px] uppercase tracking-wider text-amber-300/80 flex-shrink-0">
                        {a.itemKind}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                    <span className="inline-flex items-center gap-1 text-amber-200/90">
                      <Tag className="w-3 h-3" />
                      {a.currentBidCc ?? 0} CC
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {humanizeRemaining(a.endsAt, now)}
                    </span>
                    {a.sellerUserId && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <User className="w-3 h-3" />
                        {a.sellerUserId}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AuctionBrowsePanel;
