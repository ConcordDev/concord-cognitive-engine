'use client';

import { useEffect, useState } from 'react';
import { Inbox, Plus, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Booking {
  id: string; customerName: string; customerEmail: string; customerPhone: string;
  serviceType: string; address: string;
  preferredDate: string | null; preferredTime: string; notes: string;
  status: 'pending' | 'confirmed';
}

export function BookingsPanel() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', serviceType: '', address: '', preferredDate: '', notes: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'bookings-list', input: {} });
      setBookings((res.data?.result?.bookings || []) as Booking[]);
    } catch (e) { console.error('[Bookings] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.customerName.trim() || !form.customerEmail.trim() || !form.serviceType.trim()) return;
    try {
      await lensRun({ domain: 'trades', action: 'bookings-create', input: form });
      setForm({ customerName: '', customerEmail: '', customerPhone: '', serviceType: '', address: '', preferredDate: '', notes: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Bookings] create', e); }
  }

  async function confirm(id: string) {
    try {
      await lensRun({ domain: 'trades', action: 'bookings-confirm', input: { id } });
      await refresh();
    } catch (e) { console.error('[Bookings] confirm', e); }
  }

  const pending = bookings.filter(b => b.status === 'pending').length;

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Inbox className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Online bookings</span>
        <span className="ml-auto text-[10px] text-gray-400">{pending} pending · {bookings.length} total</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
          <input value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} placeholder="Customer name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} placeholder="Phone" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.serviceType} onChange={e => setForm({ ...form, serviceType: e.target.value })} placeholder="Service type" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={form.preferredDate} onChange={e => setForm({ ...form, preferredDate: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Submit</button>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : bookings.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Inbox className="w-6 h-6 mx-auto mb-2 opacity-30" />No bookings yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {bookings.map(b => (
              <li key={b.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-start gap-3', b.status === 'confirmed' && 'opacity-60')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white truncate">{b.customerName}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">{b.serviceType}</span>
                    {b.status === 'confirmed' && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">confirmed</span>}
                  </div>
                  <div className="text-[10px] text-gray-400">{b.customerEmail}{b.customerPhone && ` · ${b.customerPhone}`}</div>
                  {b.address && <div className="text-[10px] text-gray-400 truncate">{b.address}</div>}
                  {b.preferredDate && <div className="text-[10px] text-amber-300">Prefers {b.preferredDate} ({b.preferredTime})</div>}
                </div>
                {b.status === 'pending' && (
                  <button onClick={() => confirm(b.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" />Confirm</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BookingsPanel;
