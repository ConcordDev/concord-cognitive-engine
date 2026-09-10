'use client';

/**
 * BuyOrdersPanel — EVE-style open buy orders + post form.
 * Extracted from lenses/auction/page.tsx. Preserves buy-order REST + socket refresh.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { type BuyOrderRow } from '@/components/auction/auction-shared';

export function BuyOrdersPanel({ onCheckMarket }: { onCheckMarket?: (itemId: string) => void }) {
  const [buyOrders, setBuyOrders] = useState<BuyOrderRow[]>([]);
  const [buyForm, setBuyForm] = useState({ itemDescriptor: '', unitPriceCc: 1, quantity: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auctions/buy-orders?limit=20');
      if (!res.ok) throw new Error(`buy-orders ${res.status}`);
      const r = await res.json();
      if (r?.ok) setBuyOrders(r.buyOrders || []);
      else throw new Error(r?.error || 'buy-orders load failed');
    } catch {
      showFlash('err', 'Could not load buy orders.');
    }
  }, [showFlash]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    const handler = () => refresh();
    const a = subscribe('auction:buy-order-placed', handler);
    const b = subscribe('auction:buy-order-filled', handler);
    return () => { a?.(); b?.(); };
  }, [refresh]);

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
      if (j.ok) { showFlash('ok', `Sold ${j.fillQty} for ${j.payment} CC.`); refresh(); }
      else showFlash('err', j.error || 'fill failed');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleCancelBuyOrder = useCallback(async (orderId: string) => {
    setBusy(`cancel-${orderId}`);
    try {
      const r = await fetch(`/api/auctions/buy-orders/${orderId}/cancel`, {
        method: 'POST', credentials: 'include',
      });
      const j = await r.json();
      if (j.ok) { showFlash('ok', `Cancelled — ${j.refundCc} CC refunded.`); refresh(); }
      else showFlash('err', j.error || 'cancel failed');
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-amber-200">Buy orders</h2>
        <span className="text-[10px] text-amber-300/60">EVE-style — escrow CC up front, fill from your inventory in one click.</span>
      </div>
      {flash && (
        <div className={`mb-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
          {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {flash.msg}
        </div>
      )}
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
                        <button disabled={busy === `fill-${o.id}` || remaining <= 0}
                          onClick={() => handleFillBuyOrder(o.id, remaining)}
                          className="rounded bg-emerald-500/30 px-2 py-0.5 text-emerald-100 hover:bg-emerald-500/40 disabled:opacity-40">
                          Fill {remaining}
                        </button>
                        <button disabled={busy === `cancel-${o.id}`}
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
                <button type="button" onClick={() => onCheckMarket?.(buyForm.itemDescriptor)}
                  disabled={!buyForm.itemDescriptor.trim()}
                  className="normal-case tracking-normal text-amber-300/80 hover:text-amber-200 disabled:opacity-30">
                  check market price
                </button>
              </span>
              <input value={buyForm.itemDescriptor}
                onChange={(e) => setBuyForm({ ...buyForm, itemDescriptor: e.target.value })}
                placeholder="rare_herb / dtu_id"
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Unit price (CC)</span>
                <input type="number" min={1} value={buyForm.unitPriceCc}
                  onChange={(e) => setBuyForm({ ...buyForm, unitPriceCc: Number(e.target.value) || 1 })}
                  className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Quantity</span>
                <input type="number" min={1} value={buyForm.quantity}
                  onChange={(e) => setBuyForm({ ...buyForm, quantity: Number(e.target.value) || 1 })}
                  className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100" />
              </label>
            </div>
            <p className="text-[10px] text-amber-300/60">
              Escrow: {(buyForm.unitPriceCc * buyForm.quantity).toFixed(2)} CC up front.
            </p>
            <button onClick={handlePlaceBuyOrder}
              disabled={!buyForm.itemDescriptor.trim() || busy === 'place-buy-order'}
              className="w-full rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[12px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-40">
              Post buy order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
