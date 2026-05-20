'use client';

import { useEffect, useState } from 'react';
import { Gauge, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Change { id: string; projectId: string; bpm: number; atBeats: number; timeSignatureNum: number; timeSignatureDen: number }

export function TempoMap({ projectId }: { projectId?: string }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ bpm: '120', atBeats: '0', tsNum: '4', tsDen: '4' });

  useEffect(() => { refresh(); }, [projectId]);

  async function refresh() {
    if (!projectId) { setChanges([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'tempo-changes', input: { projectId } });
      setChanges((res.data?.result?.changes || []) as Change[]);
    } catch (e) { console.error('[Tempo] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!projectId) return;
    try {
      await lensRun({ domain: 'studio', action: 'tempo-add', input: { projectId, bpm: Number(form.bpm), atBeats: Number(form.atBeats), timeSignatureNum: Number(form.tsNum), timeSignatureDen: Number(form.tsDen) } });
      await refresh();
    } catch (e) { console.error('[Tempo] add', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Tempo map</span>
        <span className="ml-auto text-[10px] text-gray-500">{changes.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input type="number" min={20} max={999} value={form.bpm} onChange={e => setForm({ ...form, bpm: e.target.value })} placeholder="BPM" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.25" value={form.atBeats} onChange={e => setForm({ ...form, atBeats: e.target.value })} placeholder="At beats" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.tsNum} onChange={e => setForm({ ...form, tsNum: e.target.value })} placeholder="TS num" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.tsDen} onChange={e => setForm({ ...form, tsDen: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="1">1</option><option value="2">2</option><option value="4">4</option><option value="8">8</option><option value="16">16</option>
          </select>
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : changes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Gauge className="w-6 h-6 mx-auto mb-2 opacity-30" />No tempo changes.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {changes.map(c => (
              <li key={c.id} className="px-3 py-1.5 hover:bg-white/[0.03] flex items-center gap-3">
                <Gauge className="w-3 h-3 text-cyan-300" />
                <span className="font-mono text-sm tabular-nums text-cyan-300">{c.bpm} BPM</span>
                <span className="font-mono text-xs text-gray-400">{c.timeSignatureNum}/{c.timeSignatureDen}</span>
                <span className="ml-auto text-[10px] text-gray-500 font-mono">@ {c.atBeats} beats</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TempoMap;
