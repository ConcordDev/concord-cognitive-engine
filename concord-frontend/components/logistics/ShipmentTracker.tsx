'use client';

import { useEffect, useState } from 'react';
import { Package, Plus, Loader2, MapPin, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Shipment {
  id: string;
  trackingNumber: string;
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

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'shipments-list', input: {} });
      setShipments((res.data?.result?.shipments || []) as Shipment[]);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }
  async function track() {
    if (!tracking.trim()) return;
    try {
      await lensRun({ domain: 'logistics', action: 'shipment-track', input: { trackingNumber: tracking.trim(), carrier } });
      setTracking('');
      await refresh();
    } catch (e) { console.error(e); }
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
        <span className="ml-auto text-[10px] text-gray-500">{shipments.length} tracked</span>
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
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : shipments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" /> No shipments tracked.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {shipments.map(s => {
              const st = STATUS[s.status];
              return (
                <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    {s.status === 'delivered' ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
                     s.status === 'exception' ? <AlertTriangle className="w-4 h-4 text-red-400" /> :
                     <Package className="w-4 h-4 text-cyan-400" />}
                    <span className="text-sm text-white font-mono">{s.trackingNumber}</span>
                    <span className="text-[10px] text-gray-500">{s.carrier}</span>
                    <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold', st.color)}>{st.label}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {s.from} → {s.to}</span>
                    {s.currentLocation && <span>Now: {s.currentLocation}</span>}
                    {s.etaDate && <span>ETA: {new Date(s.etaDate).toLocaleDateString()}</span>}
                    <span>{s.events.length} events</span>
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
