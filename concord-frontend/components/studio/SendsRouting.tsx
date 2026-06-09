'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitMerge, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Send { id: string; projectId: string; fromTrackId: string; toTrackId: string; levelDb: number; prePost: 'pre' | 'post' }

export function SendsRouting({ projectId }: { projectId?: string }) {
  const [sends, setSends] = useState<Send[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fromTrackId: '', toTrackId: '', levelDb: '-6', prePost: 'post' });

  const refresh = useCallback(async () => {
    if (!projectId) { setSends([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'sends-list', input: { projectId } });
      setSends((res.data?.result?.sends || []) as Send[]);
    } catch (e) { console.error('[Sends] failed', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function set() {
    if (!projectId || !form.fromTrackId.trim() || !form.toTrackId.trim()) return;
    try {
      await lensRun({ domain: 'studio', action: 'sends-set', input: { projectId, ...form, levelDb: Number(form.levelDb) } });
      setForm({ fromTrackId: '', toTrackId: '', levelDb: '-6', prePost: 'post' });
      await refresh();
    } catch (e) { console.error('[Sends] set', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'sends-delete', input: { id } });
      setSends(prev => prev.filter(s => s.id !== id));
    } catch (e) { console.error('[Sends] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <GitMerge className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Sends & busses</span>
        <span className="ml-auto text-[10px] text-gray-400">{sends.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.fromTrackId} onChange={e => setForm({ ...form, fromTrackId: e.target.value })} placeholder="From track ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={form.toTrackId} onChange={e => setForm({ ...form, toTrackId: e.target.value })} placeholder="To bus/track ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={form.prePost} onChange={e => setForm({ ...form, prePost: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="post">Post</option><option value="pre">Pre</option>
          </select>
          <input type="number" step="0.5" value={form.levelDb} onChange={e => setForm({ ...form, levelDb: e.target.value })} placeholder="Level dB" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={set} className="col-span-4 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Set send</button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : sends.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><GitMerge className="w-6 h-6 mx-auto mb-2 opacity-30" />No sends configured.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {sends.map(s => (
              <li key={s.id} className="px-3 py-1.5 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                <GitMerge className="w-3 h-3 text-cyan-300" />
                <span className="font-mono text-white">{s.fromTrackId.slice(0, 10)}</span>
                <span className="text-gray-400">→</span>
                <span className="font-mono text-cyan-300">{s.toTrackId.slice(0, 10)}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{s.prePost}</span>
                <span className="ml-auto font-mono tabular-nums text-emerald-300">{s.levelDb} dB</span>
                <button aria-label="Delete" onClick={() => remove(s.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SendsRouting;
