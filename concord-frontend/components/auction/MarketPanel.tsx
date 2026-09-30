'use client';

/**
 * MarketPanel — item price-history + order-book depth.
 * Extracted from lenses/auction/page.tsx. Wires price-history + depth REST.
 */

import { useCallback, useEffect, useState } from 'react';
import { Search, TrendingUp, TrendingDown } from 'lucide-react';
import { type MarketData } from '@/components/auction/auction-shared';

export function MarketPanel({ initialItemId = '' }: { initialItemId?: string }) {
  const [marketItemId, setMarketItemId] = useState(initialItemId);
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

  useEffect(() => {
    if (initialItemId.trim()) checkMarket(initialItemId);
  }, [initialItemId, checkMarket]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-amber-200">Item market</h2>
        <span className="text-[10px] text-amber-300/60">Real sale history + live order-book depth — check before you bid or price a buy order.</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); checkMarket(marketItemId); }} className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-amber-300/50" />
          <input value={marketItemId} onChange={(e) => setMarketItemId(e.target.value)}
            placeholder="item id / descriptor…"
            className="w-full rounded-md border border-slate-700 bg-slate-900/60 py-1.5 pl-8 pr-2 text-[12px] text-slate-100" />
        </div>
        <button type="submit" disabled={!marketItemId.trim() || marketLoading}
          className="rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[11px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40">
          {marketLoading ? 'Checking…' : 'Check market'}
        </button>
      </form>
      {marketError && <p role="alert" className="mb-3 text-[11px] text-rose-300">{marketError}</p>}
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
    </div>
  );
}
