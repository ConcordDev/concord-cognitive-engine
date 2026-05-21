'use client';

import { useCallback, useEffect, useState } from 'react';
import { Truck, Loader2, Printer, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ShippingLabel {
  id: string; orderId: string; orderNumber: string; carrier: string;
  service: string; trackingNumber: string; labelUrl: string;
  costCents: number; trackingStatus: string; purchasedAt: string;
}
interface QueueOrder { id: string; number: string; trackingNumber: string | null }
interface TrackEvent { status?: string; description?: string; location?: string; timestamp?: string }

const CARRIERS = ['usps', 'ups', 'fedex', 'dhl'];
const SERVICES = ['ground', 'priority', 'express'];

/**
 * ShippingLabelsPanel — carrier label purchase + tracking. Goes beyond
 * rate quotes: buys a real label for an order through a configured
 * carrier-aggregator and tracks the shipment. Without provider config
 * the macros return a clear "not configured" message — no fake labels.
 */
export function ShippingLabelsPanel() {
  const [labels, setLabels] = useState<ShippingLabel[]>([]);
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [buyForm, setBuyForm] = useState({
    orderId: '', carrier: 'usps', service: 'ground',
    toName: '', toStreet: '', toCity: '', toState: '', toZip: '',
  });
  const [trackForm, setTrackForm] = useState({ trackingNumber: '', carrier: '' });
  const [trackResult, setTrackResult] = useState<{ status: string; events: TrackEvent[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, qRes] = await Promise.all([
        lensRun('retail', 'shipping-labels-list', {}),
        lensRun('retail', 'fulfillment-queue', {}),
      ]);
      setLabels((lRes.data?.result?.labels || []) as ShippingLabel[]);
      setOrders((qRes.data?.result?.queue || []) as QueueOrder[]);
    } catch (e) { console.error('[ShippingLabels] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function buyLabel() {
    if (!buyForm.orderId) { setNotice('Pick an order'); return; }
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'shipping-label-buy', {
        orderId: buyForm.orderId, carrier: buyForm.carrier, service: buyForm.service,
        toAddress: {
          name: buyForm.toName, street1: buyForm.toStreet, city: buyForm.toCity,
          state: buyForm.toState, zip: buyForm.toZip,
        },
        parcel: { weight_oz: 16 },
      });
      if (r.data?.ok === false) setNotice(r.data.error || 'Label purchase failed');
      else { setNotice(`Label bought — tracking ${r.data?.result?.label?.trackingNumber}`); await refresh(); }
    } catch (e) { console.error('[ShippingLabels] buy failed', e); }
    finally { setBusy(false); }
  }

  async function track() {
    if (!trackForm.trackingNumber.trim()) { setNotice('Enter a tracking number'); return; }
    setBusy(true); setNotice(null); setTrackResult(null);
    try {
      const r = await lensRun('retail', 'shipping-track', { trackingNumber: trackForm.trackingNumber, carrier: trackForm.carrier });
      if (r.data?.ok === false) setNotice(r.data.error || 'Tracking lookup failed');
      else setTrackResult({ status: r.data?.result?.status || 'unknown', events: (r.data?.result?.events || []) as TrackEvent[] });
    } catch (e) { console.error('[ShippingLabels] track failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-blue-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Shipping labels & tracking</span>
        <span className="ml-auto text-[10px] text-gray-500">{labels.length} labels</span>
      </header>

      {/* Buy label */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <p className="text-[10px] uppercase text-gray-500">Buy a carrier label</p>
        <div className="grid grid-cols-3 gap-2">
          <select value={buyForm.orderId} onChange={e => setBuyForm({ ...buyForm, orderId: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Select order…</option>
            {orders.map(o => <option key={o.id} value={o.id}>{o.number}{o.trackingNumber ? ' (labeled)' : ''}</option>)}
          </select>
          <select value={buyForm.carrier} onChange={e => setBuyForm({ ...buyForm, carrier: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CARRIERS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <select value={buyForm.service} onChange={e => setBuyForm({ ...buyForm, service: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={buyForm.toName} onChange={e => setBuyForm({ ...buyForm, toName: e.target.value })} placeholder="Recipient name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={buyForm.toStreet} onChange={e => setBuyForm({ ...buyForm, toStreet: e.target.value })} placeholder="Street" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <input value={buyForm.toCity} onChange={e => setBuyForm({ ...buyForm, toCity: e.target.value })} placeholder="City" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={buyForm.toState} onChange={e => setBuyForm({ ...buyForm, toState: e.target.value })} placeholder="State" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={buyForm.toZip} onChange={e => setBuyForm({ ...buyForm, toZip: e.target.value })} placeholder="ZIP" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <button onClick={buyLabel} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
          <Printer className="w-3 h-3" /> Buy label
        </button>
      </div>

      {/* Track */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <p className="text-[10px] uppercase text-gray-500">Track a shipment</p>
        <div className="grid grid-cols-4 gap-2">
          <input value={trackForm.trackingNumber} onChange={e => setTrackForm({ ...trackForm, trackingNumber: e.target.value })} placeholder="Tracking number" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={trackForm.carrier} onChange={e => setTrackForm({ ...trackForm, carrier: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Any carrier</option>
            {CARRIERS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <button onClick={track} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-40">Track</button>
        </div>
        {trackResult && (
          <div className="text-[11px] text-gray-300">
            <span className="text-emerald-300">Status: {trackResult.status}</span>
            {trackResult.events.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {trackResult.events.slice(0, 6).map((ev, i) => (
                  <li key={i} className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5 text-gray-500" />{ev.status || ev.description} {ev.location && `· ${ev.location}`}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {notice && <div className="px-3 py-2 text-[11px] text-amber-300 border-b border-white/10">{notice}</div>}

      {/* Labels list */}
      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : labels.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No labels purchased yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {labels.map(l => (
              <li key={l.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white font-mono">{l.orderNumber} · {l.carrier.toUpperCase()} {l.service}</p>
                  <p className="text-[10px] text-gray-500">{l.trackingNumber} · ${(l.costCents / 100).toFixed(2)}</p>
                </div>
                <span className={cn('px-2 py-0.5 text-[10px] rounded font-mono', l.trackingStatus === 'delivered' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-blue-500/15 text-blue-300')}>{l.trackingStatus}</span>
                {l.labelUrl && <a href={l.labelUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-300 hover:underline">PDF</a>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ShippingLabelsPanel;
