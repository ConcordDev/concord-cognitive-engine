'use client';

import { useCallback, useEffect, useState } from 'react';
import { Grid3x3, Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { getAudioContext, resumeAudioContext } from '@/lib/daw/engine';

interface Pad {
  index: number;
  label: string;
  sampleUrl: string | null;
  gainDb: number;
  pan: number;
  tuneSemitones: number;
  loop: boolean;
  reverse: boolean;
  chokeGroup: number;
  rootNote: number;
}
interface Rack {
  id: string;
  projectId: string;
  name: string;
  kind: 'drumrack' | 'sampler';
  pads: Pad[];
}

// Audition a pad via a short oscillator burst tuned to the pad root note.
function auditionPad(pad: Pad) {
  try {
    resumeAudioContext();
    const ctx = getAudioContext();
    const freq = 440 * Math.pow(2, (pad.rootNote + pad.tuneSemitones - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    osc.type = pad.chokeGroup > 0 ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    const amp = Math.pow(10, pad.gainDb / 20) * 0.3;
    gain.gain.setValueAtTime(amp, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    panner.pan.setValueAtTime(pad.pan, ctx.currentTime);
    osc.connect(gain).connect(panner).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) { console.warn('[DrumRack] audition', e); }
}

export function DrumRackPanel({ projectId }: { projectId?: string }) {
  const [racks, setRacks] = useState<Rack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'drumrack' | 'sampler'>('drumrack');
  const [padCount, setPadCount] = useState('16');
  const [editPad, setEditPad] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setRacks([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun('studio', 'drumrack-list', { projectId });
      const list = (res.data?.result?.racks || []) as Rack[];
      setRacks(list);
      setSelectedId((prev) => (prev && list.some((r) => r.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) { console.error('[DrumRack] list', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = racks.find((r) => r.id === selectedId) || null;

  async function create() {
    if (!projectId || !name.trim()) return;
    try {
      await lensRun('studio', 'drumrack-create', { projectId, name, kind, padCount: Number(padCount) });
      setName('');
      await refresh();
    } catch (e) { console.error('[DrumRack] create', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun('studio', 'drumrack-delete', { id });
      await refresh();
    } catch (e) { console.error('[DrumRack] delete', e); }
  }

  async function assignPad(rackId: string, padIndex: number, patch: Record<string, unknown>) {
    try {
      await lensRun('studio', 'drumrack-pad-assign', { rackId, padIndex, ...patch });
      await refresh();
    } catch (e) { console.error('[DrumRack] assign', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Grid3x3 className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Drum rack / sampler</span>
        <span className="ml-auto text-[10px] text-gray-400">{racks.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rack name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={kind} onChange={(e) => setKind(e.target.value as 'drumrack' | 'sampler')} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="drumrack">Drum rack</option><option value="sampler">Sampler</option>
          </select>
          <select value={padCount} onChange={(e) => setPadCount(e.target.value)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="8">8 pads</option><option value="16">16 pads</option><option value="32">32 pads</option>
          </select>
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Create</button>
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !projectId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Open a project to build drum racks.</div>
      ) : racks.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No racks yet.</div>
      ) : (
        <div>
          <div className="flex gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
            {racks.map((r) => (
              <button key={r.id} onClick={() => { setSelectedId(r.id); setEditPad(null); }}
                className={'px-2 py-1 text-[11px] rounded whitespace-nowrap inline-flex items-center gap-1 ' + (selectedId === r.id ? 'bg-violet-500/20 text-violet-200' : 'text-gray-400 hover:text-white')}>
                {r.name}
                <span onClick={(e) => { e.stopPropagation(); remove(r.id); }} className="text-rose-400"><Trash2 className="w-3 h-3" /></span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="p-3">
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {selected.pads.map((pad) => (
                  <button key={pad.index}
                    onClick={() => { auditionPad(pad); setEditPad(pad.index); }}
                    className={'aspect-square rounded text-[9px] font-mono flex flex-col items-center justify-center border transition active:scale-95 ' +
                      (pad.sampleUrl ? 'bg-violet-600/40 border-violet-500/50 text-white' : 'bg-white/[0.04] border-white/10 text-gray-400 hover:bg-white/[0.08]') +
                      (editPad === pad.index ? ' ring-2 ring-amber-400' : '')}>
                    <span className="truncate w-full px-0.5 text-center">{pad.label}</span>
                    <span className="text-[8px] text-gray-400">{pad.rootNote}</span>
                  </button>
                ))}
              </div>
              {editPad !== null && selected.pads[editPad] && (
                <div className="mt-3 p-2 rounded border border-white/10 bg-white/[0.02] space-y-2">
                  <div className="text-[10px] uppercase text-violet-300 font-semibold">Pad {editPad + 1} mapping</div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                    <label>Label<input defaultValue={selected.pads[editPad].label} onBlur={(e) => assignPad(selected.id, editPad, { label: e.target.value })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                    <label>Sample URL<input defaultValue={selected.pads[editPad].sampleUrl || ''} placeholder="/api/media/…/stream" onBlur={(e) => assignPad(selected.id, editPad, { sampleUrl: e.target.value })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                    <label>Gain dB<input type="number" step="0.5" defaultValue={selected.pads[editPad].gainDb} onBlur={(e) => assignPad(selected.id, editPad, { gainDb: Number(e.target.value) })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                    <label>Tune semis<input type="number" defaultValue={selected.pads[editPad].tuneSemitones} onBlur={(e) => assignPad(selected.id, editPad, { tuneSemitones: Number(e.target.value) })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                    <label>Root note<input type="number" min="0" max="127" defaultValue={selected.pads[editPad].rootNote} onBlur={(e) => assignPad(selected.id, editPad, { rootNote: Number(e.target.value) })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                    <label>Choke group<input type="number" min="0" max="8" defaultValue={selected.pads[editPad].chokeGroup} onBlur={(e) => assignPad(selected.id, editPad, { chokeGroup: Number(e.target.value) })} className="block w-full px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DrumRackPanel;
