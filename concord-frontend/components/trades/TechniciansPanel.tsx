'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Loader2, Phone, Mail } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Tech {
  id: string; name: string; skills: string[]; phone: string; email: string;
  status: 'available' | 'on_route' | 'on_site' | 'break' | 'off';
  hireDate: string;
}

const STATUS = [
  { id: 'available', label: 'Available', dot: 'bg-emerald-400' },
  { id: 'on_route', label: 'On route', dot: 'bg-cyan-400' },
  { id: 'on_site', label: 'On site', dot: 'bg-violet-400' },
  { id: 'break', label: 'Break', dot: 'bg-amber-400' },
  { id: 'off', label: 'Off', dot: 'bg-gray-500' },
] as const;

export function TechniciansPanel() {
  const [techs, setTechs] = useState<Tech[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', skills: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'technicians-list', input: {} });
      setTechs((res.data?.result?.technicians || []) as Tech[]);
    } catch (e) { console.error('[Techs] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim()) return;
    try {
      await lensRun({
        domain: 'trades', action: 'technicians-add',
        input: { name: form.name, phone: form.phone, email: form.email, skills: form.skills.split(',').map(s => s.trim()).filter(Boolean) },
      });
      setForm({ name: '', phone: '', email: '', skills: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Techs] add', e); }
  }

  async function setStatus(id: string, status: Tech['status']) {
    try {
      await lensRun({ domain: 'trades', action: 'technicians-set-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Techs] status', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'trades', action: 'technicians-delete', input: { id } });
      setTechs(prev => prev.filter(t => t.id !== id));
    } catch (e) { console.error('[Techs] remove', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Technicians</span>
        <span className="ml-auto text-[10px] text-gray-400">{techs.length}</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.skills} onChange={e => setForm({ ...form, skills: e.target.value })} placeholder="Skills (csv)" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : techs.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />No technicians yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {techs.map(t => (
              <li key={t.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-xs font-bold">{t.name.slice(0, 2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{t.name}</div>
                    <div className="text-[10px] text-gray-400 inline-flex items-center gap-2 truncate">
                      {t.phone && <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{t.phone}</span>}
                      {t.email && <span className="inline-flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{t.email}</span>}
                    </div>
                  </div>
                  <select value={t.status} onChange={e => setStatus(t.id, e.target.value as Tech['status'])} className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-0.5 text-white">
                    {STATUS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <button aria-label="Delete" onClick={() => remove(t.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                {t.skills.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 ml-11">
                    {t.skills.map(sk => <span key={sk} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{sk}</span>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TechniciansPanel;
