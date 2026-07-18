'use client';

import { useCallback, useEffect, useState } from 'react';
import { Package, Loader2, CheckCircle, Truck, XCircle, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui/Skeleton';

interface Order {
  id: string; number: string;
  listingTitle: string; listingKind: string;
  qty: number; unitPriceUsd: number;
  subtotalUsd: number; shippingUsd: number; totalUsd: number;
  buyerName: string; buyerEmail: string; buyerAddress: string;
  status: 'paid' | 'shipped' | 'delivered' | 'refunded' | 'pending';
  placedAt: string; shippedAt: string | null; deliveredAt: string | null;
  trackingNumber?: string; carrier?: string;
}
interface PublishedListing { id: string; title: string; priceUsd: number; stockQty: number | null }

const STATUS_COLOUR: Record<Order['status'], string> = {
  pending:   'bg-gray-500/20 text-gray-300',
  paid:      'bg-amber-500/20 text-amber-300',
  shipped:   'bg-cyan-500/20 text-cyan-300',
  delivered: 'bg-emerald-500/20 text-emerald-300',
  refunded:  'bg-rose-500/20 text-rose-300',
};

export function OrdersPanel() {
  const [list, setList] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'all' | Order['status']>('all');
  const [loading, setLoading] = useState(true);
  const [shipForm, setShipForm] = useState<{ id: string; trackingNumber: string; carrier: string } | null>(null);
  const [listings, setListings] = useState<PublishedListing[]>([]);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ listingId: '', qty: '1', buyerName: '', buyerEmail: '', buyerAddress: '', notes: '' });
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [o, l] = await Promise.all([
        lensRun({ domain: 'marketplace', action: 'orders-list', input: { status: filter } }),
        lensRun({ domain: 'marketplace', action: 'listings-list', input: { status: 'published' } }),
      ]);
      setList((o.data?.result?.orders || []) as Order[]);
      setListings((l.data?.result?.listings || []) as PublishedListing[]);
    } catch (e) { console.error('[Orders] failed', e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function recordManualSale() {
    if (!manual.listingId) { setManualError('Pick a listing.'); return; }
    setManualBusy(true);
    setManualError(null);
    try {
      const r = await lensRun({
        domain: 'marketplace', action: 'orders-create',
        input: {
          listingId: manual.listingId, qty: Number(manual.qty) || 1,
          buyerName: manual.buyerName.trim() || undefined, buyerEmail: manual.buyerEmail.trim() || undefined,
          buyerAddress: manual.buyerAddress.trim() || undefined, notes: manual.notes.trim() || undefined,
        },
      });
      if (r.data?.ok === false) { setManualError(r.data?.error || 'Could not record sale'); return; }
      setManual({ listingId: '', qty: '1', buyerName: '', buyerEmail: '', buyerAddress: '', notes: '' });
      setShowManual(false);
      await refresh();
    } catch (e) { console.error('[Orders] manual sale', e); setManualError('Could not record sale'); }
    finally { setManualBusy(false); }
  }

  async function ship() {
    if (!shipForm) return;
    try {
      await lensRun({ domain: 'marketplace', action: 'orders-mark-shipped', input: shipForm });
      setShipForm(null);
      await refresh();
    } catch (e) { console.error('[Orders] ship', e); }
  }

  async function deliver(id: string) {
    try { await lensRun({ domain: 'marketplace', action: 'orders-mark-delivered', input: { id } }); await refresh(); }
    catch (e) { console.error('[Orders] deliver', e); }
  }

  async function refund(id: string) {
    const reason = prompt('Refund reason?'); if (reason === null) return;
    try { await lensRun({ domain: 'marketplace', action: 'orders-refund', input: { id, reason } }); await refresh(); }
    catch (e) { console.error('[Orders] refund', e); }
  }

  return (
    <div className="bg-lattice-deep border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Orders</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="all">All</option>
          <option value="paid">Paid (needs shipping)</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="refunded">Refunded</option>
        </select>
        <button onClick={() => setShowManual(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Record sale
        </button>
      </header>

      {showManual && (
        <div className="px-4 py-3 border-b border-white/10 bg-orange-500/[0.04] grid grid-cols-12 gap-2">
          <p className="col-span-12 text-[10px] text-gray-400 -mb-1">Record an offline / in-person / phone sale against one of your published listings — decrements stock and appears in Orders like any other sale.</p>
          <select value={manual.listingId} onChange={e => setManual({ ...manual, listingId: e.target.value })} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Pick a published listing…</option>
            {listings.map(l => <option key={l.id} value={l.id}>{l.title} · ${l.priceUsd.toFixed(2)}{l.stockQty !== null ? ` (${l.stockQty} in stock)` : ''}</option>)}
          </select>
          <input type="number" min={1} value={manual.qty} onChange={e => setManual({ ...manual, qty: e.target.value })} placeholder="Qty" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={manual.buyerName} onChange={e => setManual({ ...manual, buyerName: e.target.value })} placeholder="Buyer name" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={manual.buyerEmail} onChange={e => setManual({ ...manual, buyerEmail: e.target.value })} placeholder="Buyer email" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={manual.buyerAddress} onChange={e => setManual({ ...manual, buyerAddress: e.target.value })} placeholder="Shipping address (if physical)" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={manual.notes} onChange={e => setManual({ ...manual, notes: e.target.value })} placeholder="Notes (optional)" className="col-span-10 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={recordManualSale} disabled={manualBusy} className="col-span-2 px-2 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
            {manualBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}Save
          </button>
          {manualError && <div className="col-span-12 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1.5">{manualError}</div>}
          <button onClick={() => setShowManual(false)} aria-label="Cancel" className="col-span-12 text-[10px] text-gray-400 hover:text-gray-200 text-right inline-flex items-center justify-end gap-1"><X className="w-3 h-3" />Cancel</button>
        </div>
      )}

      {shipForm && (
        <div className="px-4 py-3 border-b border-white/10 bg-cyan-500/[0.04] grid grid-cols-12 gap-2">
          <input value={shipForm.trackingNumber} onChange={e => setShipForm({ ...shipForm, trackingNumber: e.target.value })} placeholder="Tracking #" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={shipForm.carrier} onChange={e => setShipForm({ ...shipForm, carrier: e.target.value })} placeholder="Carrier (USPS / UPS / FedEx)" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={ship} className="col-span-1 px-2 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save</button>
          <button onClick={() => setShipForm(null)} className="col-span-1 px-2 py-1.5 text-xs rounded text-gray-300 hover:bg-white/[0.05]">×</button>
        </div>
      )}

      <div className="max-h-[36rem] overflow-y-auto">
        {loading ? (
          <SkeletonTableRows rows={6} columns={4} />
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" />No orders in this view.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(o => (
              <li key={o.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', STATUS_COLOUR[o.status])}>{o.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-400">{o.number}</span>
                    <span className="truncate">{o.listingTitle}</span>
                    <span className="text-[10px] text-gray-400">× {o.qty}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">
                    {o.buyerName}{o.buyerEmail && ` · ${o.buyerEmail}`} · placed {o.placedAt.slice(0, 10)}
                    {o.trackingNumber && <span> · 🚚 {o.carrier} {o.trackingNumber}</span>}
                  </div>
                </div>
                <div className="text-sm font-mono tabular-nums text-white w-20 text-right">${o.totalUsd.toFixed(2)}</div>
                {o.status === 'paid' && (
                  <button onClick={() => setShipForm({ id: o.id, trackingNumber: '', carrier: '' })} className="px-2 py-1 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1">
                    <Truck className="w-3 h-3" />Ship
                  </button>
                )}
                {o.status === 'shipped' && (
                  <button onClick={() => deliver(o.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Delivered
                  </button>
                )}
                {o.status !== 'refunded' && (
                  <button onClick={() => refund(o.id)} className="px-2 py-1 text-[10px] rounded text-rose-300 hover:bg-rose-500/20 inline-flex items-center gap-1">
                    <XCircle className="w-3 h-3" />Refund
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OrdersPanel;
