'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cable, Loader2, Plus, Trash2, Radio } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface MidiMap {
  id: string;
  projectId: string;
  target: string;
  msgType: 'cc' | 'note' | 'pitchbend' | 'program';
  controller: number;
  channel: number;
  rangeMin: number;
  rangeMax: number;
  deviceName: string;
}

export function MidiMapPanel({ projectId }: { projectId?: string }) {
  const [maps, setMaps] = useState<MidiMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState('');
  const [msgType, setMsgType] = useState<MidiMap['msgType']>('cc');
  const [controller, setController] = useState('0');
  const [channel, setChannel] = useState('0');
  const [rangeMin, setRangeMin] = useState('0');
  const [rangeMax, setRangeMax] = useState('1');
  const [learning, setLearning] = useState(false);
  const [device, setDevice] = useState('any');
  const [midiAvailable, setMidiAvailable] = useState(false);
  const learnRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!projectId) { setMaps([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun('studio', 'midi-map-list', { projectId });
      setMaps((res.data?.result?.maps || []) as MidiMap[]);
    } catch (e) { console.error('[MidiMap] list', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Web MIDI learn — capture the next CC/note from any attached device.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return;
    let access: MIDIAccess | null = null;
    const onMsg = (e: MIDIMessageEvent) => {
      if (!learnRef.current || !e.data || e.data.length < 2) return;
      const status = e.data[0] & 0xf0;
      const ch = e.data[0] & 0x0f;
      const num = e.data[1];
      if (status === 0xb0) { setMsgType('cc'); setController(String(num)); setChannel(String(ch)); }
      else if (status === 0x90) { setMsgType('note'); setController(String(num)); setChannel(String(ch)); }
      else if (status === 0xe0) { setMsgType('pitchbend'); setChannel(String(ch)); }
      else if (status === 0xc0) { setMsgType('program'); setController(String(num)); setChannel(String(ch)); }
      else return;
      const target = e.target as MIDIInput | null;
      if (target?.name) setDevice(target.name);
      learnRef.current = false;
      setLearning(false);
    };
    navigator.requestMIDIAccess().then((a) => {
      access = a;
      setMidiAvailable(true);
      a.inputs.forEach((inp) => { inp.onmidimessage = onMsg; });
      a.onstatechange = () => a.inputs.forEach((inp) => { inp.onmidimessage = onMsg; });
    }).catch(() => setMidiAvailable(false));
    return () => { if (access) access.inputs.forEach((inp) => { inp.onmidimessage = null; }); };
  }, []);

  function toggleLearn() {
    const next = !learning;
    learnRef.current = next;
    setLearning(next);
  }

  async function add() {
    if (!projectId || !target.trim()) return;
    try {
      await lensRun('studio', 'midi-map-add', {
        projectId, target, msgType,
        controller: Number(controller), channel: Number(channel),
        rangeMin: Number(rangeMin), rangeMax: Number(rangeMax), deviceName: device,
      });
      setTarget('');
      await refresh();
    } catch (e) { console.error('[MidiMap] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun('studio', 'midi-map-delete', { id });
      setMaps((prev) => prev.filter((m) => m.id !== id));
    } catch (e) { console.error('[MidiMap] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Cable className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">MIDI controller mappings</span>
        <span className={'ml-auto text-[10px] ' + (midiAvailable ? 'text-emerald-400' : 'text-gray-400')}>{midiAvailable ? 'Web MIDI ready' : 'No Web MIDI'}</span>
      </header>
      {projectId ? (
        <div className="p-3 border-b border-white/10 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target param (e.g. track1.volume)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={msgType} onChange={(e) => setMsgType(e.target.value as MidiMap['msgType'])} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="cc">CC</option><option value="note">Note</option><option value="pitchbend">Pitch bend</option><option value="program">Program</option>
            </select>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <input type="number" min="0" max="127" value={controller} onChange={(e) => setController(e.target.value)} placeholder="CC#" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" min="0" max="15" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Ch" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" step="0.1" value={rangeMin} onChange={(e) => setRangeMin(e.target.value)} placeholder="Min" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" step="0.1" value={rangeMax} onChange={(e) => setRangeMax(e.target.value)} placeholder="Max" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <div className="flex gap-2">
            <button onClick={toggleLearn} disabled={!midiAvailable}
              className={'px-3 py-1.5 text-xs rounded inline-flex items-center gap-1 disabled:opacity-40 ' + (learning ? 'bg-amber-500 text-black animate-pulse' : 'bg-white/[0.06] text-gray-300')}>
              <Radio className="w-3 h-3" />{learning ? 'Listening — move a control…' : 'MIDI learn'}
            </button>
            <button onClick={add} disabled={!target.trim()} className="ml-auto px-3 py-1.5 text-xs rounded bg-violet-500 disabled:opacity-40 text-white font-bold inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add mapping</button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Open a project to configure MIDI mappings.</div>
      )}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : projectId && maps.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No mappings yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {maps.map((m) => (
              <li key={m.id} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{m.target}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{m.msgType} {m.controller} · ch {m.channel} · {m.rangeMin}–{m.rangeMax} · {m.deviceName}</div>
                </div>
                <button aria-label="Delete" onClick={() => remove(m.id)} className="p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MidiMapPanel;
