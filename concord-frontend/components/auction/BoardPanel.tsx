'use client';

/**
 * BoardPanel — active auction grid + bid/list modals.
 * Extracted from lenses/auction/page.tsx. Preserves /api/auctions/* + socket events.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Coins, Clock, X, Check, AlertCircle, RefreshCcw, BarChart3 } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { type AuctionRow, fmtTime } from '@/components/auction/auction-shared';

export function BoardPanel({ onCheckMarket }: { onCheckMarket?: (itemId: string) => void }) {
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidTarget, setBidTarget] = useState<AuctionRow | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [createForm, setCreateForm] = useState({ title: '', itemKind: 'dtu' as 'dtu' | 'inventory', itemId: '', startCc: 1, buyoutCc: '', durationS: 3600 });
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auctions/active');
      if (!res.ok) throw new Error(`auctions ${res.status}`);
      const r = await res.json();
      if (r?.ok) { setAuctions(r.auctions || []); setLoadError(null); }
      else throw new Error(r?.error || 'auctions load failed');
    } catch {
      const msg = 'Could not reach the auction house. Check your connection and retry.';
      setLoadError(msg);
      showFlash('err', msg);
    }
    setLoading(false);
  }, [showFlash]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    const offBid = subscribe('auction:bid-placed', handler);
    const offSettled = subscribe('auction:settled', handler);
    const offBuyOrderPlaced = subscribe('auction:buy-order-placed', handler);
    const offBuyOrderFilled = subscribe('auction:buy-order-filled', handler);
    return () => {
      offBid?.();
      offSettled?.();
      offBuyOrderPlaced?.();
      offBuyOrderFilled?.();
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        <button onClick={refresh} aria-label="Refresh" className="rounded-full border border-amber-500/30 bg-amber-500/10 p-1.5 text-amber-300 hover:bg-amber-500/20">
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-500/30">
          <Plus className="h-3 w-3" />
          List item
        </button>
      </div>
      {flash && (
        <div className={`mb-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
          {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {flash.msg}
        </div>
      )}
      {!loading && loadError && (
        <div data-testid="auction-error" role="alert"
          className="mb-3 flex flex-col items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-center text-[12px] text-rose-200">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span>{loadError}</span>
          <button onClick={refresh} aria-label="Retry loading auctions"
            className="mt-1 flex items-center gap-1 rounded-md border border-rose-400/40 bg-rose-500/20 px-3 py-1 text-[11px] text-rose-100 hover:bg-rose-500/30 focus:outline-none focus:ring-2 focus:ring-rose-400">
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
                  onClick={() => onCheckMarket?.(a.itemId)}
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

      {bidTarget && (
        <div role="button" tabIndex={0} aria-label="Close bid dialog"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={() => setBidTarget(null)}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setBidTarget(null); }}>
          <div role="dialog" aria-modal="true" tabIndex={-1}
            aria-label={`Bid on ${bidTarget.title || bidTarget.itemId}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-950 p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-amber-100">Bid on {bidTarget.title || bidTarget.itemId}</h2>
              <button onClick={() => setBidTarget(null)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
            </header>
            <p className="mb-3 text-[11px] text-amber-300/80">Current bid: {bidTarget.currentBidCc} CC. Next bid must exceed this.</p>
            <input type="number" min={bidTarget.currentBidCc + 1} step={1} value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              className="block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-amber-500/50 focus:outline-none" />
            <button onClick={() => handleBid(bidTarget.id, Number(bidAmount))}
              disabled={busy === `bid-${bidTarget.id}` || Number(bidAmount) <= bidTarget.currentBidCc}
              className="mt-3 w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40">
              Place bid
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div role="button" tabIndex={0} aria-label="Close listing dialog"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur"
          onClick={() => setShowCreate(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setShowCreate(false); }}>
          <div role="dialog" aria-modal="true" tabIndex={-1} aria-label="List an item"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-950 p-4">
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
    </div>
  );
}
