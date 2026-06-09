'use client';

import { useEffect, useState } from 'react';
import { Sliders, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Preset { id: string; name: string; pluginName: string; category: string; tags: string[]; createdAt: string }

export function PresetsLibraryPanel() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', pluginName: '', category: 'user', tags: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'presets-list', input: {} });
      setPresets((res.data?.result?.presets || []) as Preset[]);
    } catch (e) { console.error('[Presets] failed', e); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!form.name.trim() || !form.pluginName.trim()) return;
    try {
      await lensRun({
        domain: 'studio', action: 'presets-save',
        input: { name: form.name, pluginName: form.pluginName, category: form.category, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) },
      });
      setForm({ name: '', pluginName: '', category: 'user', tags: '' });
      await refresh();
    } catch (e) { console.error('[Presets] save', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'presets-delete', input: { id } });
      setPresets(prev => prev.filter(p => p.id !== id));
    } catch (e) { console.error('[Presets] delete', e); }
  }

  const filtered = filter ? presets.filter(p => p.pluginName.toLowerCase().includes(filter.toLowerCase()) || p.name.toLowerCase().includes(filter.toLowerCase())) : presets;

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sliders className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Presets library</span>
        <span className="ml-auto text-[10px] text-gray-400">{filtered.length} / {presets.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Preset name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.pluginName} onChange={e => setForm({ ...form, pluginName: e.target.value })} placeholder="Plugin (ReverbX)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Category" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="Tags (csv)" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={save} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Save</button>
      </div>
      <div className="px-3 py-2 border-b border-white/10">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by plugin or name…" className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Sliders className="w-6 h-6 mx-auto mb-2 opacity-30" />No presets.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(p => (
              <li key={p.id} className="px-3 py-1.5 hover:bg-white/[0.03] group flex items-center gap-3">
                <Sliders className="w-3 h-3 text-violet-300" />
                <span className="text-sm text-white truncate">{p.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">{p.pluginName}</span>
                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{p.category}</span>
                {p.tags.length > 0 && <span className="ml-auto text-[10px] text-violet-300">{p.tags.slice(0, 2).join(' · ')}</span>}
                <button aria-label="Delete" onClick={() => remove(p.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PresetsLibraryPanel;
