'use client';

import { useCallback, useEffect, useState } from 'react';
import { Music, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Note { id: string; clipId: string; pitch: number; velocity: number; startBeats: number; lengthBeats: number }

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(p: number): string { return `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`; }

export function MidiPianoRoll({ clipId }: { clipId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ pitch: '60', velocity: '96', startBeats: '0', lengthBeats: '0.5' });

  const refresh = useCallback(async () => {
    if (!clipId) { setNotes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'midi-notes-list', input: { clipId } });
      setNotes((res.data?.result?.notes || []) as Note[]);
    } catch (e) { console.error('[MIDI] failed', e); }
    finally { setLoading(false); }
  }, [clipId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!clipId) return;
    try {
      await lensRun({ domain: 'studio', action: 'midi-notes-add', input: { clipId, pitch: Number(form.pitch), velocity: Number(form.velocity), startBeats: Number(form.startBeats), lengthBeats: Number(form.lengthBeats) } });
      await refresh();
    } catch (e) { console.error('[MIDI] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'midi-notes-delete', input: { id } });
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) { console.error('[MIDI] delete', e); }
  }

  // Mini piano roll viz: show pitch range 36-84 (C2-C6)
  const pitchLo = 36, pitchHi = 84;
  const maxBeats = Math.max(8, ...notes.map(n => n.startBeats + n.lengthBeats));

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Music className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Piano roll {clipId && `· ${clipId.slice(0, 12)}`}</span>
        <span className="ml-auto text-[10px] text-gray-400">{notes.length} notes</span>
      </header>
      {clipId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input type="number" min={0} max={127} value={form.pitch} onChange={e => setForm({ ...form, pitch: e.target.value })} placeholder="Pitch 0-127" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" min={1} max={127} value={form.velocity} onChange={e => setForm({ ...form, velocity: e.target.value })} placeholder="Velocity" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.25" value={form.startBeats} onChange={e => setForm({ ...form, startBeats: e.target.value })} placeholder="Start" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.0625" value={form.lengthBeats} onChange={e => setForm({ ...form, lengthBeats: e.target.value })} placeholder="Length" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add note</button>
        </div>
      )}
      {!clipId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400"><Music className="w-6 h-6 mx-auto mb-2 opacity-30" />Select a MIDI clip to edit notes.</div>
      ) : loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="relative bg-[#080a0e] border-b border-white/10" style={{ height: 180 }}>
            {notes.map(n => {
              const top = ((pitchHi - n.pitch) / (pitchHi - pitchLo)) * 180;
              const left = (n.startBeats / maxBeats) * 100;
              const width = (n.lengthBeats / maxBeats) * 100;
              return (
                <div
                  key={n.id}
                  className="absolute rounded-sm hover:ring-2 hover:ring-violet-300 cursor-pointer"
                  style={{
                    top: `${top}px`,
                    left: `${left}%`,
                    width: `${width}%`,
                    height: 4,
                    backgroundColor: `hsl(${280 - (n.velocity / 127) * 60}, 80%, ${40 + (n.velocity / 127) * 30}%)`,
                  }}
                  title={`${noteName(n.pitch)} · vel ${n.velocity}`}
                  onDoubleClick={() => remove(n.id)}
                />
              );
            })}
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-white/5">
            {notes.map(n => (
              <li key={n.id} className="px-3 py-1 text-xs flex items-center gap-3 hover:bg-white/[0.03] group">
                <span className="font-mono text-violet-300 w-12">{noteName(n.pitch)}</span>
                <span className="text-gray-400">vel {n.velocity}</span>
                <span className="text-gray-400">@{n.startBeats}b · {n.lengthBeats}b</span>
                <button aria-label="Delete" onClick={() => remove(n.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default MidiPianoRoll;
