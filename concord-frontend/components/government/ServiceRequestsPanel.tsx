'use client';

import { useEffect, useState } from 'react';
import { Megaphone, Plus, Loader2, MapPin, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Request {
  id: string; referenceNumber: string; category: string; description: string;
  lat: number; lng: number; address: string;
  reporterName: string; reporterEmail: string;
  assignedDepartmentId: string | null; assignedDepartmentName?: string;
  status: string; priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
}
interface Department { id: string; name: string }

const CATEGORIES = ['pothole', 'streetlight_out', 'graffiti', 'trash_missed', 'tree_down', 'noise_complaint', 'abandoned_vehicle', 'sidewalk_damage', 'traffic_signal', 'water_leak', 'illegal_dumping', 'park_maintenance', 'animal_control', 'other'];
const STATUSES = ['submitted', 'assigned', 'in_progress', 'needs_more_info', 'closed_resolved', 'closed_duplicate', 'closed_invalid'];
const PRIORITY_COLOUR: Record<Request['priority'], string> = {
  urgent: 'bg-rose-500 text-white',
  high: 'bg-amber-500 text-black',
  medium: 'bg-cyan-500 text-black',
  low: 'bg-gray-500 text-gray-100',
};

export function ServiceRequestsPanel() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ category: 'pothole', description: '', lat: '', lng: '', address: '', reporterName: '', reporterEmail: '', priority: 'medium' as Request['priority'] });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.post('/api/lens/run', { domain: 'government', action: 'service-requests-list', input: {} }),
        api.post('/api/lens/run', { domain: 'government', action: 'departments-list', input: {} }),
      ]);
      setRequests((r.data?.result?.requests || []) as Request[]);
      setDepts((d.data?.result?.departments || []) as Department[]);
    } catch (e) { console.error('[SR] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.description.trim() || !form.lat || !form.lng) return;
    try {
      const res = await api.post('/api/lens/run', { domain: 'government', action: 'service-requests-create', input: { ...form, lat: Number(form.lat), lng: Number(form.lng) } });
      if (res.data?.ok === false) alert(res.data?.error);
      setForm({ ...form, description: '', address: '', reporterName: '', reporterEmail: '' });
      await refresh();
    } catch (e) { console.error('[SR] create', e); }
  }

  async function assign(id: string, departmentId: string) {
    if (!departmentId) return;
    try {
      await api.post('/api/lens/run', { domain: 'government', action: 'service-requests-assign', input: { id, departmentId } });
      await refresh();
    } catch (e) { console.error('[SR] assign', e); }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api.post('/api/lens/run', { domain: 'government', action: 'service-requests-update-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[SR] status', e); }
  }

  const filtered = filter ? requests.filter(r => r.status === filter) : requests;

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">311 service requests</span>
        <span className="ml-auto text-[10px] text-gray-500">{requests.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as Request['priority'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <input type="number" step="0.0001" value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="Lat" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" step="0.0001" value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="Lng" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.reporterName} onChange={e => setForm({ ...form, reporterName: e.target.value })} placeholder="Reporter name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.reporterEmail} onChange={e => setForm({ ...form, reporterEmail: e.target.value })} placeholder="Reporter email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Issue description" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="col-span-6 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />File service request</button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Megaphone className="w-6 h-6 mx-auto mb-2 opacity-30" />No requests in this view.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-3 h-3 text-amber-300" />
                  <span className="text-[10px] font-mono text-cyan-300">{r.referenceNumber}</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', PRIORITY_COLOUR[r.priority])}>{r.priority}</span>
                  <span className="text-sm text-white truncate">{r.category.replace(/_/g, ' ')}</span>
                  <span className="ml-auto text-[10px] text-gray-500">{r.address || `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`}</span>
                </div>
                <div className="text-xs text-gray-300">{r.description}</div>
                <div className="mt-1 flex items-center gap-2">
                  <select value={r.assignedDepartmentId || ''} onChange={e => assign(r.id, e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
                    <option value="">Unassigned</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <select value={r.status} onChange={e => setStatus(r.id, e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
                    {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                  {r.status.startsWith('closed_') && <CheckCircle className="w-3 h-3 text-emerald-300" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ServiceRequestsPanel;
