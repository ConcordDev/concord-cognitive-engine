'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Plus, Loader2, MapPin, FileSignature, Camera } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface POD { id: string; shipmentId: string; signatureName: string; signatureUrl: string | null; photoUrl: string | null; gpsLat: number | null; gpsLng: number | null; deliveredAt: string; receivedBy: string }
interface Shipment { id: string; trackingNumber: string; origin: string; destination: string; status: string }

export function DeliveryProofPanel() {
  const [pods, setPods] = useState<POD[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ shipmentId: '', signatureName: '', receivedBy: '', photoUrl: '', gpsLat: '', gpsLng: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        lensRun({ domain: 'logistics', action: 'pods-list', input: {} }),
        lensRun({ domain: 'logistics', action: 'shipments-list', input: {} }),
      ]);
      setPods((p.data?.result?.pods || []) as POD[]);
      const items = (s.data?.result?.shipments || s.data?.result?.items || []) as Shipment[];
      setShipments(items.filter(x => x.status !== 'delivered'));
    } catch (e) { console.error('[POD] failed', e); }
    finally { setLoading(false); }
  }

  async function confirm() {
    if (!form.shipmentId) return;
    try {
      await lensRun({
        domain: 'logistics', action: 'delivery-confirm',
        input: { ...form, gpsLat: form.gpsLat ? Number(form.gpsLat) : undefined, gpsLng: form.gpsLng ? Number(form.gpsLng) : undefined },
      });
      setForm({ shipmentId: '', signatureName: '', receivedBy: '', photoUrl: '', gpsLat: '', gpsLng: '' });
      await refresh();
    } catch (e) { console.error('[POD] confirm', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Proof of delivery</span>
        <span className="ml-auto text-[10px] text-gray-500">{pods.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-3 gap-2">
        <select value={form.shipmentId} onChange={e => setForm({ ...form, shipmentId: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select pending shipment…</option>
          {shipments.map(s => <option key={s.id} value={s.id}>{s.trackingNumber} · {s.destination}</option>)}
        </select>
        <input value={form.signatureName} onChange={e => setForm({ ...form, signatureName: e.target.value })} placeholder="Signed by (name)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.receivedBy} onChange={e => setForm({ ...form, receivedBy: e.target.value })} placeholder="Received by" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.gpsLat} onChange={e => setForm({ ...form, gpsLat: e.target.value })} placeholder="GPS lat" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.gpsLng} onChange={e => setForm({ ...form, gpsLng: e.target.value })} placeholder="GPS lng" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.photoUrl} onChange={e => setForm({ ...form, photoUrl: e.target.value })} placeholder="Photo URL" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={confirm} disabled={!form.shipmentId} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Confirm POD</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : pods.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><CheckCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />No POD records yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {pods.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-emerald-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white">{p.receivedBy || p.signatureName}</div>
                  <div className="text-[10px] text-gray-500 inline-flex items-center gap-2 mt-0.5">
                    {p.signatureName && <span className="inline-flex items-center gap-0.5"><FileSignature className="w-2.5 h-2.5" />Sig</span>}
                    {p.photoUrl && <span className="inline-flex items-center gap-0.5"><Camera className="w-2.5 h-2.5" />Photo</span>}
                    {p.gpsLat != null && <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />GPS</span>}
                    <span className="ml-1">{new Date(p.deliveredAt).toLocaleString()}</span>
                  </div>
                  {p.gpsLat != null && <div className="text-[10px] text-gray-500 font-mono">{p.gpsLat.toFixed(4)},{p.gpsLng?.toFixed(4)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DeliveryProofPanel;
