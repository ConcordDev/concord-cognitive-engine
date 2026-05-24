'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Loader2, Star, Mail } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Customer {
  id: string; name: string; email: string; phone: string; city: string; state: string;
  totalSpent: number; orderCount: number; lastOrderAt: string | null;
  acceptsMarketing: boolean; tags: string[];
}
interface Segments { new: number; repeat: number; vip: number; atRisk: number; dormant: number; marketingOptIn: number }

export function CustomersPanel() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [segments, setSegments] = useState<Segments | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', city: '', state: '' });
  const [activeSegment, setActiveSegment] = useState<'all' | 'new' | 'repeat' | 'vip' | 'atRisk' | 'dormant'>('all');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        lensRun({ domain: 'retail', action: 'customers-list', input: {} }),
        lensRun({ domain: 'retail', action: 'customers-segments', input: {} }),
      ]);
      setCustomers((a.data?.result?.customers || []) as Customer[]);
      setSegments(b.data?.result?.segments || null);
    } catch (e) { console.error('[Customers] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim() || !form.email.trim()) return;
    try {
      await lensRun({ domain: 'retail', action: 'customers-add', input: form });
      setForm({ name: '', email: '', phone: '', city: '', state: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Customers] add failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'retail', action: 'customers-delete', input: { id } });
      setCustomers(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Customers] delete failed', e); }
  }

  const day = 86400000;
  const now = Date.now();
  const filtered = customers.filter(c => {
    if (activeSegment === 'all') return true;
    if (activeSegment === 'new') return c.orderCount <= 1;
    if (activeSegment === 'repeat') return c.orderCount >= 2 && c.orderCount < 5;
    if (activeSegment === 'vip') return c.totalSpent >= 1000 || c.orderCount >= 5;
    if (activeSegment === 'atRisk') return c.lastOrderAt && (now - new Date(c.lastOrderAt).getTime()) > 90 * day && c.orderCount > 0;
    if (activeSegment === 'dormant') return !c.lastOrderAt || (now - new Date(c.lastOrderAt).getTime()) > 180 * day;
    return true;
  });

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Customers</span>
        <span className="ml-auto text-[10px] text-gray-400">{customers.length} total</span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {segments && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
          {([
            ['all', 'All', customers.length],
            ['new', 'New', segments.new],
            ['repeat', 'Repeat', segments.repeat],
            ['vip', 'VIP', segments.vip],
            ['atRisk', 'At risk', segments.atRisk],
            ['dormant', 'Dormant', segments.dormant],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setActiveSegment(id)}
              className={cn(
                'px-2 py-1 rounded text-[10px] uppercase tracking-wider transition inline-flex items-center gap-1',
                activeSegment === id ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-emerald-300'
              )}
            >
              {label} <span className="text-gray-400">{count}</span>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Add</button>
          <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="State" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />No customers in {activeSegment}.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(c => {
              const isVip = c.totalSpent >= 1000 || c.orderCount >= 5;
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold', isVip ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/15 text-emerald-300')}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate flex items-center gap-2">
                      {c.name}
                      {isVip && <Star className="w-3 h-3 text-amber-300 fill-amber-300" />}
                      {c.acceptsMarketing && <Mail className="w-3 h-3 text-cyan-400" />}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">{c.email} · {c.city}{c.state ? `, ${c.state}` : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono tabular-nums text-white">${c.totalSpent.toFixed(0)}</div>
                    <div className="text-[10px] text-gray-400">{c.orderCount} order{c.orderCount === 1 ? '' : 's'}</div>
                  </div>
                  <button onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CustomersPanel;
