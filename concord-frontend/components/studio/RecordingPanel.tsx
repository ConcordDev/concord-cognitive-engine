'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic2, Loader2, Plus, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RecordConfig {
  id: string;
  projectId: string;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  countInBars: number;
  loopRecord: boolean;
  compMode: boolean;
  punchInBeats: number | null;
  punchOutBeats: number | null;
}
interface Take {
  id: string;
  trackId: string;
  takeNumber: number;
  name: string;
  durationSec: number;
  startBeats: number;
  selected: boolean;
}

export function RecordingPanel({ projectId, trackId }: { projectId?: string; trackId?: string }) {
  const [config, setConfig] = useState<RecordConfig | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(true);
  const [takeName, setTakeName] = useState('');
  const [takeDur, setTakeDur] = useState('0');

  const refresh = useCallback(async () => {
    if (!projectId) { setConfig(null); setTakes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const cfgRes = await lensRun('studio', 'record-config-get', { projectId });
      setConfig((cfgRes.data?.result?.config || null) as RecordConfig | null);
      if (trackId) {
        const tRes = await lensRun('studio', 'takes-list', { trackId });
        setTakes((tRes.data?.result?.takes || []) as Take[]);
      } else {
        setTakes([]);
      }
    } catch (e) { console.error('[Recording] refresh', e); }
    finally { setLoading(false); }
  }, [projectId, trackId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function setCfg(patch: Record<string, unknown>) {
    if (!projectId) return;
    try {
      const res = await lensRun('studio', 'record-config-set', { projectId, ...patch });
      if (res.data?.ok) setConfig(res.data.result.config as RecordConfig);
    } catch (e) { console.error('[Recording] setCfg', e); }
  }

  async function addTake() {
    if (!projectId || !trackId) return;
    try {
      await lensRun('studio', 'takes-add', { projectId, trackId, name: takeName || undefined, durationSec: Number(takeDur) });
      setTakeName(''); setTakeDur('0');
      await refresh();
    } catch (e) { console.error('[Recording] addTake', e); }
  }

  async function selectTake(id: string) {
    try {
      await lensRun('studio', 'takes-comp-select', { id });
      await refresh();
    } catch (e) { console.error('[Recording] selectTake', e); }
  }

  async function removeTake(id: string) {
    try {
      await lensRun('studio', 'takes-delete', { id });
      await refresh();
    } catch (e) { console.error('[Recording] removeTake', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Mic2 className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recording — metronome · count-in · takes</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !projectId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Open a project to configure recording.</div>
      ) : config ? (
        <div className="p-3 space-y-4">
          <section className="space-y-2">
            <div className="text-[10px] uppercase text-violet-300 font-semibold">Record config</div>
            <label className="flex items-center gap-2 text-[11px] text-gray-300">
              <input type="checkbox" checked={config.metronomeEnabled} onChange={(e) => setCfg({ metronomeEnabled: e.target.checked })} className="accent-violet-500" />
              Metronome
            </label>
            <label className="block text-[10px] text-gray-400">Metronome volume {Math.round(config.metronomeVolume * 100)}%
              <input type="range" min="0" max="1" step="0.05" value={config.metronomeVolume} onChange={(e) => setCfg({ metronomeVolume: Number(e.target.value) })} className="block w-full accent-violet-500" />
            </label>
            <label className="block text-[10px] text-gray-400">Count-in bars
              <select value={config.countInBars} onChange={(e) => setCfg({ countInBars: Number(e.target.value) })} className="block mt-0.5 w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-300">
              <input type="checkbox" checked={config.loopRecord} onChange={(e) => setCfg({ loopRecord: e.target.checked })} className="accent-violet-500" />
              Loop recording
            </label>
            <label className="flex items-center gap-2 text-[11px] text-gray-300">
              <input type="checkbox" checked={config.compMode} onChange={(e) => setCfg({ compMode: e.target.checked })} className="accent-violet-500" />
              Comp mode (take comping)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-gray-400">Punch-in beat
                <input type="number" step="0.5" defaultValue={config.punchInBeats ?? ''} placeholder="off"
                  onBlur={(e) => setCfg({ punchInBeats: e.target.value === '' ? null : Number(e.target.value) })}
                  className="block w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              </label>
              <label className="text-[10px] text-gray-400">Punch-out beat
                <input type="number" step="0.5" defaultValue={config.punchOutBeats ?? ''} placeholder="off"
                  onBlur={(e) => setCfg({ punchOutBeats: e.target.value === '' ? null : Number(e.target.value) })}
                  className="block w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              </label>
            </div>
          </section>

          <section className="space-y-2 pt-2 border-t border-white/10">
            <div className="text-[10px] uppercase text-violet-300 font-semibold">Takes {trackId ? `· ${trackId.slice(0, 10)}` : ''}</div>
            {!trackId ? (
              <div className="text-[10px] text-gray-400">Paste a Track ID above to manage takes.</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <input value={takeName} onChange={(e) => setTakeName(e.target.value)} placeholder="Take name" className="col-span-2 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <input type="number" step="0.5" value={takeDur} onChange={(e) => setTakeDur(e.target.value)} placeholder="Dur s" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <button onClick={addTake} className="col-span-3 px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add take</button>
                </div>
                {takes.length === 0 ? (
                  <div className="text-[10px] text-gray-400">No takes recorded yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {takes.map((t) => (
                      <li key={t.id} className={'flex items-center gap-2 px-2 py-1.5 rounded text-[11px] ' + (t.selected ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-white/[0.03]')}>
                        <button onClick={() => selectTake(t.id)} title="Select for comp" className={'w-4 h-4 rounded-full flex items-center justify-center border ' + (t.selected ? 'bg-emerald-500 border-emerald-500' : 'border-white/20')}>
                          {t.selected && <Check className="w-3 h-3 text-black" />}
                        </button>
                        <span className="text-white">#{t.takeNumber} {t.name}</span>
                        <span className="text-gray-400">{t.durationSec}s</span>
                        <button aria-label="Delete" onClick={() => removeTake(t.id)} className="ml-auto text-rose-400"><Trash2 className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default RecordingPanel;
