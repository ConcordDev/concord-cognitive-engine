'use client';

import { useEffect, useState } from 'react';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { Users, Plus, Trash2, Star, Mail, Pencil, Eye, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui';

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
  const [addError, setAddError] = useState<string | null>(null);
  const [activeSegment, setActiveSegment] = useState<'all' | 'new' | 'repeat' | 'vip' | 'atRisk' | 'dormant'>('all');
  // FIX-retail-007: search + a detail view with an edit form.
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; email: string; phone: string; city: string; state: string; acceptsMarketing: boolean } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  async function saveEdit(id: string) {
    if (!editForm) return;
    if (!editForm.name.trim()) { setEditError('Name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+$/.test(editForm.email.trim())) { setEditError('Email must include a name and a domain, like name@example.com.'); return; }
    try {
      const r = await lensRun({ domain: 'retail', action: 'customers-update', input: { id, ...editForm } });
      if (r.data?.ok === false) { setEditError(String(r.data.message || r.data.error || 'Could not save the customer.')); return; }
      setEditError(null);
      setEditForm(null);
      await refresh();
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Could not save the customer.'); }
  }

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
    // Name AND email are required (the server refuses without an email);
    // say so in the panel instead of returning in silence.
    if (!form.name.trim()) { setAddError('Name is required.'); return; }
    if (!form.email.trim()) { setAddError('Email is required — a customer cannot be created without one.'); return; }
    if (!/^[^\s@]+@[^\s@]+$/.test(form.email.trim())) { setAddError('Email must include a name and a domain, like name@example.com.'); return; }
    try {
      const r = await lensRun({ domain: 'retail', action: 'customers-add', input: form });
      if (r.data?.ok === false) { setAddError(String(r.data.error || 'Could not add the customer.')); return; }
      setAddError(null);
      setForm({ name: '', email: '', phone: '', city: '', state: '' });
      setCreating(false);
      await refresh();
    } catch (e) { setAddError(e instanceof Error ? e.message : 'Could not add the customer.'); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'retail', action: 'customers-delete', input: { id } });
      setCustomers(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Customers] delete failed', e); }
  }

  const day = 86400000;
  const now = Date.now();
  const q = query.trim().toLowerCase();
  const searched = q
    ? customers.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))
    : customers;
  const filtered = searched.filter(c => {
    if (activeSegment === 'all') return true;
    if (activeSegment === 'new') return c.orderCount <= 1;
    if (activeSegment === 'repeat') return c.orderCount >= 2 && c.orderCount < 5;
    if (activeSegment === 'vip') return c.totalSpent >= 1000 || c.orderCount >= 5;
    if (activeSegment === 'atRisk') return c.lastOrderAt && (now - new Date(c.lastOrderAt).getTime()) > 90 * day && c.orderCount > 0;
    if (activeSegment === 'dormant') return !!c.lastOrderAt && (now - new Date(c.lastOrderAt).getTime()) > 180 * day;
    return true;
  });

  return (
    <div className="bg-lattice-deep border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Customers</span>
        <span className="ml-auto text-[10px] text-gray-400">{customers.length} total</span>
        <button onClick={() => setCreating(v => !v)} aria-label="New customer" className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
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
          {addError && <div className="col-span-5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300" role="alert">{addError}</div>}
          <input id="retail-name" name="name" aria-label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input id="retail-email-required" name="email-required" aria-label="Email (required)" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email (required)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input id="retail-phone" name="phone" aria-label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Add</button>
          <input id="retail-city" name="city" aria-label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input id="retail-state" name="state" aria-label="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="State" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
      )}

      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-gray-500" />
        <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search customers" placeholder="Search name, email, or city"
          className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <span className="text-[10px] text-gray-400">{filtered.length} shown</span>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <SkeletonTableRows rows={5} columns={4} />
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />{q ? `No customers match "${query.trim()}".` : `No customers in ${activeSegment}.`}</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(c => {
              const isVip = c.totalSpent >= 1000 || c.orderCount >= 5;
              const selected = selectedId === c.id;
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-3">
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
                  <button onClick={() => { setSelectedId(selected ? null : c.id); setEditForm(null); setEditError(null); }}
                    aria-label={`View customer ${c.name}`} aria-expanded={selected}
                    className="p-1 text-gray-400 hover:text-white">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <StickyDeleteConfirm onConfirm={() => remove(c.id)} armAriaLabel={`Delete customer ${c.name}`} confirmAriaLabel={`Confirm delete customer ${c.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-gray-400 hover:text-rose-400" armLabel={<Trash2 className="w-3 h-3" />} />
                  </div>
                  {selected && (
                    <div className="mt-2 ml-12 border-t border-white/5 pt-2 text-xs text-gray-300 space-y-1">
                      <p>Email: {c.email}</p>
                      {c.phone && <p>Phone: {c.phone}</p>}
                      <p>Location: {c.city}{c.state ? `, ${c.state}` : ''}</p>
                      <p>Lifetime: ${c.totalSpent.toFixed(2)} across {c.orderCount} order{c.orderCount === 1 ? '' : 's'}{c.lastOrderAt ? ` · last order ${new Date(c.lastOrderAt).toLocaleDateString()}` : ''}</p>
                      <p>Marketing: {c.acceptsMarketing ? 'opted in' : 'opted out'}{c.tags.length > 0 ? ` · Tags: ${c.tags.join(', ')}` : ''}</p>
                      {editForm ? (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {editError && <div className="col-span-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300" role="alert">{editError}</div>}
                          <input aria-label="Edit customer name" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Edit customer email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Edit customer phone" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Edit customer city" value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} placeholder="City" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Edit customer state" value={editForm.state} onChange={e => setEditForm({ ...editForm, state: e.target.value })} placeholder="State" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <label className="flex items-center gap-2 text-[11px] text-gray-300">
                            <input type="checkbox" checked={editForm.acceptsMarketing} onChange={e => setEditForm({ ...editForm, acceptsMarketing: e.target.checked })} aria-label="Edit customer marketing opt-in" />
                            Accepts marketing
                          </label>
                          <div className="col-span-2 flex gap-2">
                            <button onClick={() => saveEdit(c.id)} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save</button>
                            <button onClick={() => setEditForm(null)} className="text-xs text-gray-400 px-2">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setEditForm({ name: c.name, email: c.email, phone: c.phone, city: c.city, state: c.state, acceptsMarketing: c.acceptsMarketing })}
                          aria-label={`Edit customer ${c.name}`}
                          className="inline-flex items-center gap-1 mt-1 px-2 py-1 rounded border border-white/10 text-[11px] text-gray-200 hover:bg-white/5">
                          <Pencil className="w-3 h-3" /> Edit customer
                        </button>
                      )}
                    </div>
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

export default CustomersPanel;
