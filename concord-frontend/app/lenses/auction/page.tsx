'use client';

/**
 * /lenses/auction — auction house.
 *
 * Active auctions sorted by ending soonest. Each card shows item, current
 * bid, leading bidder, time remaining, and a "Bid" modal. Buyout button
 * appears when the auction has a buyout_cc set.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gavel, Plus, Coins, Clock, X, Check, AlertCircle, RefreshCcw, TrendingUp, TrendingDown, BarChart3, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { subscribe } from '@/lib/realtime/socket';

interface PricePoint { cc: number; at: number }
interface PriceStats { count: number; min: number; max: number; avg: number; last: number; changePct: number }
interface DepthLevel { price: number; qty: number }
interface MarketData {
  points: PricePoint[];
  stats: PriceStats | null;
  asks: DepthLevel[];
  bids: DepthLevel[];
  bestAsk: number | null;
  bestBid: number | null;
  spread: number | null;
}

interface AuctionRow {
  id: string;
  sellerUserId: string;
  title: string;
  itemKind: 'dtu' | 'inventory';
  itemId: string;
  startCc: number;
  currentBidCc: number;
  buyoutCc: number | null;
  bidCount: number;
  leadingBidderUserId: string | null;
  endsAt: number;
}

interface BuyOrderRow {
  id: string;
  buyer_user_id: string;
  world_id: string;
  item_kind: 'dtu' | 'inventory';
  item_descriptor: string;
  unit_price_cc: number;
  quantity_wanted: number;
  quantity_filled: number;
  total_escrow_cc: number;
  status: string;
  posted_at: number;
  expires_at: number;
}

export default function AuctionLensPage() {
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidTarget, setBidTarget] = useState<AuctionRow | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [createForm, setCreateForm] = useState({ title: '', itemKind: 'dtu' as 'dtu' | 'inventory', itemId: '', startCc: 1, buyoutCc: '', durationS: 3600 });
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const [buyOrders, setBuyOrders] = useState<BuyOrderRow[]>([]);
  const [buyForm, setBuyForm] = useState({
    itemDescriptor: '', unitPriceCc: 1, quantity: 1,
  });
  // Honest error state: a failed fetch (network/5xx) surfaces a real banner
  // with a retry, rather than silently showing a stale-or-empty board.
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Item market — price-history + order-book depth for one item id.
  // Backed by the same lib the buy-order/auction paths already use
  // (getPriceHistory / getMarketDepth), just never surfaced in this lens
  // before: a bidder had no way to check whether a price was fair.
  const [marketItemId, setMarketItemId] = useState('');
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);

  const checkMarket = useCallback(async (itemId: string) => {
    const id = itemId.trim();
    if (!id) return;
    setMarketItemId(id);
    setMarketLoading(true);
    setMarketError(null);
    try {
      const [hRes, dRes] = await Promise.all([
        fetch(`/api/auctions/item/${encodeURIComponent(id)}/price-history?limit=60`),
        fetch(`/api/auctions/item/${encodeURIComponent(id)}/depth`),
      ]);
      const [h, d] = await Promise.all([hRes.json(), dRes.json()]);
      if (!h.ok || !d.ok) throw new Error(h.error || d.error || 'market lookup failed');
      setMarketData({
        points: h.points || [], stats: h.stats || null,
        asks: d.asks || [], bids: d.bids || [], bestAsk: d.bestAsk ?? null, bestBid: d.bestBid ?? null, spread: d.spread ?? null,
      });
    } catch (e) {
      setMarketData(null);
      setMarketError(e instanceof Error ? e.message : 'market lookup failed');
    }
    setMarketLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    let failed = false;
    try {
      const res = await fetch('/api/auctions/active');
      if (!res.ok) throw new Error(`auctions ${res.status}`);
      const r = await res.json();
      if (r?.ok) setAuctions(r.auctions || []);
      else throw new Error(r?.error || 'auctions load failed');
    } catch { failed = true; }
    try {
      const res = await fetch('/api/auctions/buy-orders?limit=20');
      if (!res.ok) throw new Error(`buy-orders ${res.status}`);
      const r = await res.json();
      if (r?.ok) setBuyOrders(r.buyOrders || []);
      else throw new Error(r?.error || 'buy-orders load failed');
    } catch { failed = true; }
    if (failed) {
      const msg = 'Could not reach the auction house. Check your connection and retry.';
      setLoadError(msg);
      showFlash('err', msg);
    } else {
      setLoadError(null);
    }
    setLoading(false);
  }, [showFlash]);

  const handlePlaceBuyOrder = useCallback(async () => {
    if (!buyForm.itemDescriptor.trim()) return;
    setBusy('place-buy-order');
    try {
      const r = await fetch('/api/auctions/buy-orders', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemDescriptor: buyForm.itemDescriptor,
          unitPriceCc: Number(buyForm.unitPriceCc) || 1,
          quantity: Number(buyForm.quantity) || 1,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', `Buy order placed — ${j.escrowCc} CC escrowed.`);
        setBuyForm({ itemDescriptor: '', unitPriceCc: 1, quantity: 1 });
        refresh();
      } else {
        showFlash('err', j.error || 'place buy order failed');
      }
    } finally { setBusy(null); }
  }, [buyForm, refresh, showFlash]);

  const handleFillBuyOrder = useCallback(async (orderId: string, qty: number) => {
    setBusy(`fill-${orderId}`);
    try {
      const r = await fetch(`/api/auctions/buy-orders/${orderId}/fill`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', `Sold ${j.fillQty} for ${j.payment} CC.`);
        refresh();
      } else {
        showFlash('err', j.error || 'fill failed');
      }
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleCancelBuyOrder = useCallback(async (orderId: string) => {
    setBusy(`cancel-${orderId}`);
    try {
      const r = await fetch(`/api/auctions/buy-orders/${orderId}/cancel`, {
        method: 'POST', credentials: 'include',
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', `Cancelled — ${j.refundCc} CC refunded.`);
        refresh();
      } else {
        showFlash('err', j.error || 'cancel failed');
      }
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    const offBid = subscribe('auction:bid-placed', handler);
    const offSettled = subscribe('auction:settled', handler);
    return () => {
      offBid?.();
      offSettled?.();
    };
  }, [refresh]);

  const handleBid = useCallback(async (auctionId: string, amount: number) => {
    setBusy(`bid-${auctionId}`);
    try {
      const r = await fetch(`/api/auctions/${auctionId}/bid`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountCc: amount }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', j.settled ? 'Bought out — congratulations!' : `Bid placed at ${amount} CC.`);
        setBidTarget(null);
        setBidAmount('');
        refresh();
      } else {
        showFlash('err', j.error || 'bid failed');
      }
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleCreate = useCallback(async () => {
    if (!createForm.itemId.trim()) return;
    setBusy('create');
    try {
      const r = await fetch('/api/auctions', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: createForm.title || createForm.itemId,
          itemKind: createForm.itemKind,
          itemId: createForm.itemId,
          startCc: Number(createForm.startCc) || 0,
          buyoutCc: createForm.buyoutCc ? Number(createForm.buyoutCc) : null,
          durationS: Number(createForm.durationS) || 3600,
        }),
      });
      const j = await r.json();
      if (j.ok) { showFlash('ok', 'Auction posted.'); setShowCreate(false); refresh(); }
      else showFlash('err', j.error || 'create failed');
    } finally { setBusy(null); }
  }, [createForm, refresh, showFlash]);

  const fmtTime = (endsAt: number) => {
    const s = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
    if (s > 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    if (s > 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${s}s`;
  };

  return (
    <LensShell lensId="auction" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Gavel className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Auction house</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Time-bound bidding · 60s snipe protection · 5% platform fee.</p>
            </div>
            <button onClick={refresh} aria-label="Refresh" className="rounded-full border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-300 hover:bg-amber-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-500/30">
              <Plus className="h-3 w-3" />
              List item
            </button>
          </div>
          {flash && (
            <div className={`mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {!loading && loadError && (
            <div
              data-testid="auction-error"
              role="alert"
              className="mb-3 flex flex-col items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-center text-[12px] text-rose-200"
            >
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              <span>{loadError}</span>
              <button
                onClick={refresh}
                aria-label="Retry loading auctions"
                className="mt-1 flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-500/20 px-3 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30 focus:outline-none focus:ring-2 focus:ring-rose-400"
              >
                <RefreshCcw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}
          <div data-testid="auction-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading}>
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} data-testid="auction-loading" className="h-28 animate-pulse rounded-xl border border-white/5 bg-white/5" aria-hidden="true" />
            ))}
            {!loading && !loadError && auctions.length === 0 && (
              <p data-testid="auction-empty" className="col-span-full px-4 py-8 text-center text-[12px] text-slate-500">No active auctions. Post one yourself.</p>
            )}
            {auctions.map((a) => {
              const timeLeft = fmtTime(a.endsAt);
              const nextBid = Math.max(a.currentBidCc + 1, a.startCc);
              return (
                <div key={a.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <h3 className="truncate font-semibold text-amber-100">{a.title || a.itemId}</h3>
                  <p className="mt-0.5 text-[10px] text-amber-300/60">{a.itemKind} · {a.itemId.slice(0, 14)}</p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <Coins className="h-4 w-4 text-yellow-300" />
                    <span className="text-lg font-bold text-yellow-200">{a.currentBidCc || a.startCc}</span>
                    <span className="text-[10px] text-amber-300/70">CC ({a.bidCount} bid{a.bidCount === 1 ? '' : 's'})</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300/80">
                    <Clock className="h-3 w-3" /> {timeLeft} left
                  </div>
                  <div className="mt-3 flex gap-1">
                    <button
                      onClick={() => { setBidTarget(a); setBidAmount(String(nextBid)); }}
                      aria-label={`Bid on ${a.title || a.itemId}, minimum ${nextBid} CC`}
                      className="flex-1 rounded-md bg-amber-500/30 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-500/40 focus:outline-none focus:ring-2 focus:ring-amber-400">
                      Bid {nextBid}+
                    </button>
                    {a.buyoutCc && (
                      <button
                        onClick={() => handleBid(a.id, a.buyoutCc!)}
                        disabled={busy === `bid-${a.id}`}
                        aria-label={`Buy out ${a.title || a.itemId} for ${a.buyoutCc} CC`}
                        className="rounded-md bg-emerald-500/30 px-3 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-40">
                        Buy {a.buyoutCc}
                      </button>
                    )}
                    <button
                      onClick={() => checkMarket(a.itemId)}
                      aria-label={`Check market price for ${a.title || a.itemId}`}
                      title="Price history + order-book depth for this item"
                      className="rounded-md border border-amber-500/30 bg-transparent px-2 py-1 text-[11px] text-amber-300/80 hover:bg-amber-500/10">
                      <BarChart3 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Item market — price-history + order-book depth (never surfaced in
            this lens before; auctions.price_history / auctions.market_depth
            + their REST twins already existed and are real). */}
        <section className="mx-auto max-w-screen-2xl border-t border-amber-500/15 px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-amber-200">Item market</h2>
            <span className="text-[10px] text-amber-300/60">Real sale history + live order-book depth — check before you bid or price a buy order.</span>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); checkMarket(marketItemId); }}
            className="mb-3 flex items-center gap-2"
          >
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-amber-300/50" />
              <input
                value={marketItemId}
                onChange={(e) => setMarketItemId(e.target.value)}
                placeholder="item id / descriptor…"
                className="w-full rounded-md border border-slate-700 bg-slate-900/60 py-1.5 pl-8 pr-2 text-[12px] text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={!marketItemId.trim() || marketLoading}
              className="rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[11px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
            >
              {marketLoading ? 'Checking…' : 'Check market'}
            </button>
          </form>

          {marketError && (
            <p role="alert" className="mb-3 text-[11px] text-rose-300">{marketError}</p>
          )}

          {marketData && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3">
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Price history — {marketItemId}</h3>
                {!marketData.stats ? (
                  <p className="py-6 text-center text-[12px] text-slate-500">No completed sales for this item yet.</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-slate-300">
                      <span>Last <b className="text-yellow-200">{marketData.stats.last}</b> CC</span>
                      <span>Avg {marketData.stats.avg} CC</span>
                      <span>Range {marketData.stats.min}–{marketData.stats.max} CC</span>
                      <span className={`flex items-center gap-0.5 ${marketData.stats.changePct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {marketData.stats.changePct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {marketData.stats.changePct >= 0 ? '+' : ''}{marketData.stats.changePct}%
                      </span>
                      <span className="text-slate-500">{marketData.stats.count} sale{marketData.stats.count === 1 ? '' : 's'}</span>
                    </div>
                    {/* Lightweight CSS sparkline — no chart dependency */}
                    <div className="flex h-14 items-end gap-[2px]" aria-hidden="true">
                      {marketData.points.map((p, i) => {
                        const range = marketData.stats!.max - marketData.stats!.min || 1;
                        const h = Math.max(4, Math.round(((p.cc - marketData.stats!.min) / range) * 100));
                        return <div key={i} className="flex-1 rounded-t bg-amber-400/60" style={{ height: `${h}%` }} title={`${p.cc} CC`} />;
                      })}
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] uppercase tracking-wider text-amber-300/60">Order-book depth</h3>
                  {marketData.spread != null && (
                    <span className="text-[10px] text-amber-300/70">spread {marketData.spread} CC</span>
                  )}
                </div>
                {marketData.asks.length === 0 && marketData.bids.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-slate-500">No active asks or buy orders for this item.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <p className="mb-1 text-rose-300/80">Asks (sell)</p>
                      {marketData.asks.length === 0 ? <p className="text-slate-500">—</p> : marketData.asks.map((l, i) => (
                        <div key={i} className="flex justify-between text-slate-300"><span>{l.price} CC</span><span className="text-slate-500">×{l.qty}</span></div>
                      ))}
                    </div>
                    <div>
                      <p className="mb-1 text-emerald-300/80">Bids (buy orders)</p>
                      {marketData.bids.length === 0 ? <p className="text-slate-500">—</p> : marketData.bids.map((l, i) => (
                        <div key={i} className="flex justify-between text-slate-300"><span>{l.price} CC</span><span className="text-slate-500">×{l.qty}</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Phase AC — buy orders (two-pane: open + post) */}
        <section className="mx-auto max-w-screen-2xl border-t border-amber-500/15 px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-amber-200">Buy orders</h2>
            <span className="text-[10px] text-amber-300/60">EVE-style — escrow CC up front, fill from your inventory in one click.</span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3">
              <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Open buy orders</h3>
              {buyOrders.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-slate-500">No open buy orders yet.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-amber-300/60">
                      <th className="py-1">Item</th>
                      <th className="py-1">Unit price</th>
                      <th className="py-1">Wanted / filled</th>
                      <th className="py-1">Escrow</th>
                      <th className="py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyOrders.map((o) => {
                      const remaining = o.quantity_wanted - o.quantity_filled;
                      return (
                        <tr key={o.id} className="border-t border-amber-500/10 text-slate-200">
                          <td className="py-1.5 font-medium">{o.item_descriptor}</td>
                          <td className="py-1.5 text-yellow-200">{o.unit_price_cc} CC</td>
                          <td className="py-1.5">{o.quantity_filled} / {o.quantity_wanted}</td>
                          <td className="py-1.5">{o.total_escrow_cc} CC</td>
                          <td className="py-1.5 space-x-1">
                            <button
                              disabled={busy === `fill-${o.id}` || remaining <= 0}
                              onClick={() => handleFillBuyOrder(o.id, remaining)}
                              className="rounded bg-emerald-500/30 px-2 py-0.5 text-emerald-100 hover:bg-emerald-500/40 disabled:opacity-40">
                              Fill {remaining}
                            </button>
                            <button
                              disabled={busy === `cancel-${o.id}`}
                              onClick={() => handleCancelBuyOrder(o.id)}
                              className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-200 hover:bg-rose-500/30">
                              Cancel
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-zinc-950/60 p-3">
              <h3 className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/60">Post a buy order</h3>
              <div className="space-y-2">
                <label className="block">
                  <span className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                    Item descriptor
                    <button
                      type="button"
                      onClick={() => checkMarket(buyForm.itemDescriptor)}
                      disabled={!buyForm.itemDescriptor.trim()}
                      className="normal-case tracking-normal text-amber-300/80 hover:text-amber-200 disabled:opacity-30"
                    >
                      check market price
                    </button>
                  </span>
                  <input
                    value={buyForm.itemDescriptor}
                    onChange={(e) => setBuyForm({ ...buyForm, itemDescriptor: e.target.value })}
                    placeholder="rare_herb / dtu_id"
                    className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Unit price (CC)</span>
                    <input type="number" min={1}
                      value={buyForm.unitPriceCc}
                      onChange={(e) => setBuyForm({ ...buyForm, unitPriceCc: Number(e.target.value) || 1 })}
                      className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Quantity</span>
                    <input type="number" min={1}
                      value={buyForm.quantity}
                      onChange={(e) => setBuyForm({ ...buyForm, quantity: Number(e.target.value) || 1 })}
                      className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  </label>
                </div>
                <p className="text-[10px] text-amber-300/60">
                  Escrow: {(buyForm.unitPriceCc * buyForm.quantity).toFixed(2)} CC up front.
                </p>
                <button
                  onClick={handlePlaceBuyOrder}
                  disabled={!buyForm.itemDescriptor.trim() || busy === 'place-buy-order'}
                  className="w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40">
                  Post buy order
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Bid modal */}
        {bidTarget && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Close bid dialog"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur"
            onClick={() => setBidTarget(null)}
            onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setBidTarget(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              aria-label={`Bid on ${bidTarget.title || bidTarget.itemId}`}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-950 p-4"
            >
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-amber-100">Bid on {bidTarget.title || bidTarget.itemId}</h2>
                <button onClick={() => setBidTarget(null)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
              </header>
              <p className="mb-3 text-[11px] text-amber-300/80">Current bid: {bidTarget.currentBidCc} CC. Next bid must exceed this.</p>
              <input
                type="number" min={bidTarget.currentBidCc + 1} step={1}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-amber-500/50 focus:outline-none"
              />
              <button
                onClick={() => handleBid(bidTarget.id, Number(bidAmount))}
                disabled={busy === `bid-${bidTarget.id}` || Number(bidAmount) <= bidTarget.currentBidCc}
                className="mt-3 w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40"
              >
                Place bid
              </button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Close listing dialog"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur"
            onClick={() => setShowCreate(false)}
            onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setShowCreate(false); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              aria-label="List an item"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-950 p-4"
            >
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-amber-100">List an item</h2>
                <button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
              </header>
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">Item kind</span>
                  <select value={createForm.itemKind} onChange={(e) => setCreateForm({ ...createForm, itemKind: e.target.value as 'dtu' | 'inventory' })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100">
                    <option value="dtu">DTU</option>
                    <option value="inventory">Inventory item</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">Item id</span>
                  <input value={createForm.itemId} onChange={(e) => setCreateForm({ ...createForm, itemId: e.target.value })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">Title (optional)</span>
                  <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Start CC</span>
                    <input type="number" value={createForm.startCc} onChange={(e) => setCreateForm({ ...createForm, startCc: Number(e.target.value) || 0 })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Buyout (opt)</span>
                    <input type="number" value={createForm.buyoutCc} onChange={(e) => setCreateForm({ ...createForm, buyoutCc: e.target.value })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">Duration (s)</span>
                    <input type="number" value={createForm.durationS} onChange={(e) => setCreateForm({ ...createForm, durationS: Number(e.target.value) || 3600 })} className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
                  </label>
                </div>
                <button onClick={handleCreate} disabled={!createForm.itemId.trim() || busy === 'create'} className="w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40">
                  Post auction
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </LensShell>
  );
}
