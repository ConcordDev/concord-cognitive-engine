'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Lane { id: string; trackId: string; parameter: string; points: Array<{ id: string; timeBeats: number; value: number }>; visible: boolean }

const COMMON_PARAMS = ['volume', 'pan', 'sends.A', 'sends.B', 'filter_cutoff', 'reverb_wet', 'delay_feedback'];

export function AutomationLanesPanel({ trackId }: { trackId?: string }) {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loading, setLoading] = useState(true);
  const [parameter, setParameter] = useState('volume');

  const refresh = useCallback(async () => {
    if (!trackId) { setLanes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'automation-list', input: { trackId } });
      setLanes((res.data?.result?.lanes || []) as Lane[]);
    } catch (e) { console.error('[Automation] failed', e); }
    finally { setLoading(false); }
  }, [trackId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addLane() {
    if (!trackId) return;
    try {
      await lensRun({ domain: 'studio', action: 'automation-add-lane', input: { trackId, parameter } });
      await refresh();
    } catch (e) { console.error('[Automation] add-lane', e); }
  }

  async function addPoint(laneId: string, timeBeats: number, value: number) {
    try {
      await lensRun({ domain: 'studio', action: 'automation-add-point', input: { laneId, timeBeats, value } });
      await refresh();
    } catch (e) { console.error('[Automation] add-point', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'automation-delete-lane', input: { id } });
      setLanes(prev => prev.filter(l => l.id !== id));
    } catch (e) { console.error('[Automation] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Automation lanes</span>
        <span className="ml-auto text-[10px] text-gray-400">{lanes.length}</span>
      </header>
      {trackId && (
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <select value={parameter} onChange={e => setParameter(e.target.value)} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {COMMON_PARAMS.map(p => <option key={p}>{p}</option>)}
          </select>
          <button onClick={addLane} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add lane</button>
        </div>
      )}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !trackId ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />Select a track to add automation.</div>
        ) : lanes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />No automation lanes on this track.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {lanes.map(l => {
              const maxBeats = Math.max(8, ...l.points.map(p => p.timeBeats));
              return (
                <li key={l.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-3 h-3 text-cyan-300" />
                    <span className="text-xs font-mono text-white">{l.parameter}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{l.points.length} pts</span>
                    <button onClick={() => addPoint(l.id, Math.random() * 8, Math.random())} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50">+ pt</button>
                    <button aria-label="Delete" onClick={() => remove(l.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <svg viewBox={`0 0 ${maxBeats * 10} 30`} preserveAspectRatio="none" className="w-full h-8 bg-black/30 rounded">
                    {l.points.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth="1.5"
                        points={l.points.map(p => `${p.timeBeats * 10},${30 - p.value * 28}`).join(' ')}
                      />
                    )}
                    {l.points.map(p => (
                      <circle key={p.id} cx={p.timeBeats * 10} cy={30 - p.value * 28} r="2" fill="#22d3ee" />
                    ))}
                  </svg>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AutomationLanesPanel;
