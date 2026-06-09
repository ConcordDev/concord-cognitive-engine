'use client';

import { useEffect, useState } from 'react';
import { Building, Plus, Trash2, Loader2, Mail, Phone } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Department { id: string; name: string; shortCode: string; email: string; phone: string; head: string; categories: string[] }

export function DepartmentsPanel() {
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', shortCode: '', email: '', phone: '', head: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'departments-list', input: {} });
      setDepts((res.data?.result?.departments || []) as Department[]);
    } catch (e) { console.error('[Depts] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim()) return;
    try {
      await lensRun({ domain: 'government', action: 'departments-add', input: form });
      setForm({ name: '', shortCode: '', email: '', phone: '', head: '' });
      await refresh();
    } catch (e) { console.error('[Depts] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'departments-delete', input: { id } });
      setDepts(prev => prev.filter(d => d.id !== id));
    } catch (e) { console.error('[Depts] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Departments</span>
        <span className="ml-auto text-[10px] text-gray-400">{depts.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Department name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.shortCode} onChange={e => setForm({ ...form, shortCode: e.target.value.toUpperCase() })} placeholder="DPW" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.head} onChange={e => setForm({ ...form, head: e.target.value })} placeholder="Department head" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : depts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Building className="w-6 h-6 mx-auto mb-2 opacity-30" />No departments yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {depts.map(d => (
              <li key={d.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-[10px] font-mono font-bold">{d.shortCode || d.name.slice(0, 3).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{d.name}</div>
                  <div className="text-[10px] text-gray-400 inline-flex items-center gap-2 truncate">
                    {d.head && <span>Head: {d.head}</span>}
                    {d.email && <span className="inline-flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{d.email}</span>}
                    {d.phone && <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{d.phone}</span>}
                  </div>
                </div>
                <button aria-label="Delete" onClick={() => remove(d.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DepartmentsPanel;
