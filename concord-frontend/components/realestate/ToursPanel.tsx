'use client';

import { useEffect, useState } from 'react';
import { Calendar, Plus, X, Loader2, Video, User, Key } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Tour {
  id: string;
  listingId: string;
  date: string;
  time: string;
  kind: 'in_person' | 'video' | 'self_tour';
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled';
  requestedAt: string;
  notes: string;
}

const KIND_ICON = { in_person: User, video: Video, self_tour: Key };

export function ToursPanel({ defaultListingId }: { defaultListingId?: string }) {
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ listingId: defaultListingId || '', date: '', time: '11:00', kind: 'in_person' as Tour['kind'], notes: '' });

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (defaultListingId) setForm(f => ({ ...f, listingId: defaultListingId })); }, [defaultListingId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'tours-list', input: {} });
      setTours((res.data?.result?.tours || []) as Tour[]);
    } catch (e) { console.error('[Tours] list failed', e); }
    finally { setLoading(false); }
  }

  async function request() {
    if (!form.listingId.trim() || !form.date) return;
    try {
      await lensRun({
        domain: 'realestate', action: 'tours-request',
        input: { listingId: form.listingId, date: form.date, time: form.time, kind: form.kind, notes: form.notes },
      });
      setForm({ listingId: defaultListingId || '', date: '', time: '11:00', kind: 'in_person', notes: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Tours] request failed', e); }
  }

  async function cancel(id: string) {
    try {
      await lensRun({ domain: 'realestate', action: 'tours-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error('[Tours] cancel failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Tours</span>
        <span className="ml-auto text-[10px] text-gray-400">{tours.filter(t => t.status === 'requested').length} upcoming</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.listingId} onChange={e => setForm({ ...form, listingId: e.target.value })} placeholder="Listing ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Tour['kind'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="in_person">In person</option>
            <option value="video">Video</option>
            <option value="self_tour">Self tour</option>
          </select>
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={request} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Request</button>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : tours.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No tours scheduled.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {tours.map(t => {
              const Icon = KIND_ICON[t.kind];
              return (
                <li key={t.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', t.status === 'cancelled' && 'opacity-50')}>
                  <div className="w-10 h-10 rounded bg-cyan-500/10 flex flex-col items-center justify-center text-[10px] text-cyan-300 font-mono">
                    <span className="text-[8px] uppercase">{t.date.slice(5, 7)}</span>
                    <span className="font-bold">{t.date.slice(8)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-cyan-300" />
                      {t.listingId}
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', t.status === 'requested' ? 'bg-amber-500/15 text-amber-300' : t.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{t.status}</span>
                    </div>
                    <div className="text-[10px] text-gray-400">{t.time} · {t.kind.replace('_', ' ')}{t.notes ? ` · ${t.notes}` : ''}</div>
                  </div>
                  {t.status === 'requested' && (
                    <button onClick={() => cancel(t.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Cancel"><X className="w-3.5 h-3.5" /></button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ToursPanel;
