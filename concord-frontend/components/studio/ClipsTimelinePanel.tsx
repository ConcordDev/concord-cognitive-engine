'use client';

import { useCallback, useEffect, useState } from 'react';
import { Music, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Clip { id: string; projectId: string; trackId: string; name: string; kind: 'audio' | 'midi' | 'drum'; startBeats: number; lengthBeats: number; colour: string; muted: boolean }

export function ClipsTimelinePanel({ projectId, trackId }: { projectId?: string; trackId?: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', startBeats: '0', lengthBeats: '4', kind: 'midi' });

  const refresh = useCallback(async () => {
    if (!projectId) { setClips([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'clips-list', input: { projectId, trackId } });
      setClips((res.data?.result?.clips || []) as Clip[]);
    } catch (e) { console.error('[Clips] failed', e); }
    finally { setLoading(false); }
  }, [projectId, trackId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (!projectId || !trackId || !form.name.trim()) return;
    try {
      await lensRun({ domain: 'studio', action: 'clips-create', input: { projectId, trackId, name: form.name, startBeats: Number(form.startBeats), lengthBeats: Number(form.lengthBeats), kind: form.kind } });
      setForm({ name: '', startBeats: '0', lengthBeats: '4', kind: 'midi' });
      await refresh();
    } catch (e) { console.error('[Clips] create', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'clips-delete', input: { id } });
      setClips(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Clips] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Music className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Clips {trackId && `· ${trackId.slice(0, 12)}`}</span>
        <span className="ml-auto text-[10px] text-gray-400">{clips.length}</span>
      </header>
      {projectId && trackId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Clip name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.25" value={form.startBeats} onChange={e => setForm({ ...form, startBeats: e.target.value })} placeholder="Start beats" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.25" value={form.lengthBeats} onChange={e => setForm({ ...form, lengthBeats: e.target.value })} placeholder="Length beats" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="midi">MIDI</option><option value="audio">Audio</option><option value="drum">Drum</option>
          </select>
          <button onClick={create} className="col-span-5 px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />New clip</button>
        </div>
      )}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !projectId ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Music className="w-6 h-6 mx-auto mb-2 opacity-30" />Open a project to manage clips.</div>
        ) : clips.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Music className="w-6 h-6 mx-auto mb-2 opacity-30" />No clips yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {clips.map(c => (
              <li key={c.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', c.muted && 'opacity-50')}>
                <span className="w-2 h-8 rounded" style={{ backgroundColor: c.colour }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{c.name}</div>
                  <div className="text-[10px] text-gray-400">{c.kind} · start {c.startBeats} · length {c.lengthBeats} beats</div>
                </div>
                <button aria-label="Delete" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ClipsTimelinePanel;
