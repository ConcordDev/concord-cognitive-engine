'use client';

import { useEffect, useState } from 'react';
import { Package, Plus, Loader2, MapPin, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Shipment {
  id: string;
  trackingNumber: string | null;
  reference?: string;
  carrier: 'UPS' | 'FedEx' | 'USPS' | 'DHL' | 'Other';
  from: string;
  to: string;
  status: 'label_created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
  currentLocation?: string;
  etaDate?: string;
  events: Array<{ at: string; location: string; description: string }>;
}

export function ShipmentTracker() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState<Shipment['carrier']>('UPS');
  // FIX-logistics-012: a refused track (tracking not configured on the
  // server, carrier unreachable) used to vanish into console.error —
  // the input cleared, the list stayed empty, and nothing on the panel
  // said why. Refusals now surface in the panel, the typed number is
  // kept, and the list load reports whether live tracking is
  // configured at all so the unavailable state shows before submit.
  const [notice, setNotice] = useState<string | null>(null);
  const [trackingConfigured, setTrackingConfigured] = useState<boolean | null>(null);

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'shipments-list', input: {} });
      setShipments((res.data?.result?.shipments || []) as Shipment[]);
      if (typeof res.data?.result?.trackingConfigured === 'boolean') {
        setTrackingConfigured(res.data.result.trackingConfigured);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }
  async function track() {
    if (!tracking.trim()) return;
    try {
      const res = await lensRun({ domain: 'logistics', action: 'shipment-track', input: { trackingNumber: tracking.trim(), carrier } });
      if (!res.data?.ok) {
        setNotice(res.data?.error || 'Tracking failed — the carrier could not be reached.');
        return;
      }
      setNotice(null);
      setTracking('');
      await refresh();
    } catch (e) {
      console.error(e);
      setNotice('Tracking request failed — the carrier could not be reached.');
    }
  }

  const STATUS: Record<Shipment['status'], { label: string; color: string }> = {
    label_created: { label: 'Label created', color: 'bg-gray-500/20 text-gray-300' },
    picked_up: { label: 'Picked up', color: 'bg-blue-500/20 text-blue-300' },
    in_transit: { label: 'In transit', color: 'bg-cyan-500/20 text-cyan-300' },
    out_for_delivery: { label: 'Out for delivery', color: 'bg-yellow-500/20 text-yellow-300' },
    delivered: { label: 'Delivered', color: 'bg-green-500/20 text-green-300' },
    exception: { label: 'Exception', color: 'bg-red-500/20 text-red-300' },
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Shipment tracker</span>
        <span className="ml-auto text-[10px] text-gray-400">{shipments.length} tracked</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2 text-xs">
        <select value={carrier} onChange={e => setCarrier(e.target.value as Shipment['carrier'])} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
          {(['UPS','FedEx','USPS','DHL','Other'] as const).map(c => <option key={c}>{c}</option>)}
        </select>
        <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking number" className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={track} disabled={!tracking.trim()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Track
        </button>
      </div>
      {trackingConfigured === false && !notice && (
        <p className="mx-3 mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
          Live tracking isn&apos;t configured on this server, so tracking numbers can&apos;t be looked up right now.
        </p>
      )}
      {notice && (
        <p className="mx-3 mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">{notice}</p>
      )}
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : shipments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" /> No shipments tracked.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {shipments.map(s => {
              const events = s.events || [];
              const st = STATUS[s.status] || { label: s.status || 'Unknown', color: 'bg-gray-500/20 text-gray-300' };
              return (
                <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    {s.status === 'delivered' ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
                     s.status === 'exception' ? <AlertTriangle className="w-4 h-4 text-red-400" /> :
                     <Package className="w-4 h-4 text-cyan-400" />}
                    <span className="text-sm text-white font-mono">{s.trackingNumber || s.reference || 'No tracking #'}</span>
                    <span className="text-[10px] text-gray-400">{s.carrier}</span>
                    <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold', st.color)}>{st.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {s.from} → {s.to}</span>
                    {s.currentLocation && <span>Now: {s.currentLocation}</span>}
                    {s.etaDate && <span>ETA: {new Date(s.etaDate).toLocaleDateString()}</span>}
                    <span>{events.length} events</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
export default ShipmentTracker;
