'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flag, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Marker { id: string; projectId: string; name: string; timeBeats: number; colour: string; kind: string }

export function MarkersPanel({ projectId }: { projectId?: string }) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', timeBeats: '0', kind: 'section', colour: '#fbbf24' });

  const refresh = useCallback(async () => {
    if (!projectId) { setMarkers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'markers-list', input: { projectId } });
      setMarkers((res.data?.result?.markers || []) as Marker[]);
    } catch (e) { console.error('[Markers] failed', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!projectId || !form.name.trim()) return;
    try {
      await lensRun({ domain: 'studio', action: 'markers-add', input: { projectId, ...form, timeBeats: Number(form.timeBeats) } });
      setForm({ name: '', timeBeats: '0', kind: 'section', colour: '#fbbf24' });
      await refresh();
    } catch (e) { console.error('[Markers] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'markers-delete', input: { id } });
      setMarkers(prev => prev.filter(m => m.id !== id));
    } catch (e) { console.error('[Markers] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Flag className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Markers</span>
        <span className="ml-auto text-[10px] text-gray-400">{markers.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Marker name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.25" value={form.timeBeats} onChange={e => setForm({ ...form, timeBeats: e.target.value })} placeholder="Time beats" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="section">Section</option><option value="cue">Cue</option><option value="loop_start">Loop start</option><option value="loop_end">Loop end</option>
          </select>
          <button onClick={add} className="col-span-4 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add marker</button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !projectId ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Flag className="w-6 h-6 mx-auto mb-2 opacity-30" />Select a project.</div>
        ) : markers.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Flag className="w-6 h-6 mx-auto mb-2 opacity-30" />No markers yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {markers.map(m => (
              <li key={m.id} className="px-3 py-1.5 hover:bg-white/[0.03] group flex items-center gap-2">
                <Flag className="w-3 h-3" style={{ color: m.colour }} />
                <span className="text-sm text-white flex-1 truncate">{m.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">{m.timeBeats}b</span>
                <span className="text-[9px] uppercase text-gray-400">{m.kind.replace('_', ' ')}</span>
                <button aria-label="Delete" onClick={() => remove(m.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MarkersPanel;
