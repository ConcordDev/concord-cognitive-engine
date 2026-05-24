'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, Loader2, Send, Crosshair } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const PinDropMap = dynamic(() => import('./PinDropMap').then(m => m.PinDropMap), { ssr: false });

interface ServiceRequest {
  id: string; referenceNumber: string; category: string; description: string;
  lat: number; lng: number; address: string; status: string;
  priority: 'low' | 'medium' | 'high' | 'urgent'; createdAt: string;
}

const CATEGORIES = [
  'pothole', 'streetlight_out', 'graffiti', 'trash_missed', 'tree_down', 'noise_complaint',
  'abandoned_vehicle', 'sidewalk_damage', 'traffic_signal', 'water_leak', 'illegal_dumping',
  'park_maintenance', 'animal_control', 'other',
];

export function ServiceRequestReporter() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({ category: 'pothole', description: '', address: '', reporterName: '', reporterEmail: '', priority: 'medium' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'service-requests-list', input: {} });
      setRequests((res.data?.result?.requests || []) as ServiceRequest[]);
    } catch (e) { console.error('[Reporter] refresh', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function useMyLocation() {
    if (!navigator.geolocation) { setError('Geolocation not available in this browser.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError('Could not get your location — drop a pin on the map instead.'),
    );
  }

  async function submit() {
    setError(null);
    if (!pin) { setError('Click the map to drop a pin first.'); return; }
    if (!form.description.trim()) { setError('Describe the issue.'); return; }
    setSubmitting(true);
    try {
      const res = await lensRun({
        domain: 'government', action: 'service-requests-create',
        input: { ...form, lat: pin.lat, lng: pin.lng },
      });
      if (res.data?.ok === false) { setError((res.data?.error as string) || 'submit failed'); return; }
      setForm({ category: 'pothole', description: '', address: '', reporterName: '', reporterEmail: '', priority: 'medium' });
      setPin(null);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setSubmitting(false); }
  }

  const geocoded = requests.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapPinned className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Report an issue — drop a pin</span>
        <span className="ml-auto text-[10px] text-gray-400">{geocoded.length} mapped</span>
      </header>

      <div className="p-3 grid lg:grid-cols-2 gap-3">
        {/* Map */}
        <div>
          <div className="text-[10px] text-gray-400 mb-1.5 inline-flex items-center gap-1">
            <Crosshair className="w-3 h-3" />Click the map to place your report
          </div>
          <PinDropMap
            existing={geocoded.map(r => ({ lat: r.lat, lng: r.lng, label: r.referenceNumber, category: r.category, status: r.status }))}
            pin={pin}
            onPick={(lat, lng) => setPin({ lat, lng })}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button onClick={useMyLocation} className="px-2 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10 inline-flex items-center gap-1">
              <Crosshair className="w-3 h-3" />Use my location
            </button>
            {pin && <span className="text-[10px] text-cyan-300 font-mono">{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</span>}
          </div>
        </div>

        {/* Form */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue (e.g. deep pothole blocking the bike lane)" rows={3} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Nearest address / cross street (optional)" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.reporterName} onChange={e => setForm({ ...form, reporterName: e.target.value })} placeholder="Your name (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={form.reporterEmail} onChange={e => setForm({ ...form, reporterEmail: e.target.value })} placeholder="Email for updates (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          {error && <div className="text-[10px] text-rose-400">{error}</div>}
          <button onClick={submit} disabled={submitting} className="w-full px-3 py-2 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}Submit report
          </button>
        </div>
      </div>

      {/* Recent reports */}
      <div className="px-3 pb-3">
        <div className="text-[10px] uppercase text-gray-400 mb-1.5">Recent reports</div>
        {loading ? (
          <div className="text-xs text-gray-400"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading…</div>
        ) : requests.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">No reports yet.</div>
        ) : (
          <ul className="divide-y divide-white/5 max-h-40 overflow-y-auto">
            {requests.slice(0, 12).map(r => (
              <li key={r.id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="font-mono text-cyan-300">{r.referenceNumber}</span>
                <span className="text-gray-300 flex-1 truncate">{r.category.replace(/_/g, ' ')} — {r.description}</span>
                <span className="text-[10px] text-gray-400">{r.status.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ServiceRequestReporter;
