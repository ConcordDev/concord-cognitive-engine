'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DAWClip, DAWTrack, MIDINote } from '@/lib/daw/types';
import { newId } from '@/lib/daw/project';
import { DRUM_LANES, isDrumInstrument } from '@/lib/daw/presets';
import { quantizeNotes } from './ops';
import { useBeatFrame } from './engine-hooks';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
const nameOf = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

export interface PianoRollProps {
  track: DAWTrack;
  clip: DAWClip;
  onChange: (notes: MIDINote[], coalesceKey?: string) => void;
  onClipChange: (patch: Partial<DAWClip>) => void;
  onAudition: (pitch: number, velocity: number) => void;
}

interface NoteDrag {
  ids: string[];
  mode: 'move' | 'resize';
  x0: number;
  y0: number;
  orig: Map<string, MIDINote>;
  dBeat: number;
  dPitch: number;
  dLen: number;
}

export function PianoRoll({ track, clip, onChange, onClipChange, onAudition }: PianoRollProps) {
  const drums = isDrumInstrument(track.instrumentId);
  const rows = useMemo(() => (drums ? DRUM_LANES.map((l) => l.pitch) : Array.from({ length: 85 }, (_, i) => 108 - i)), [drums]);
  const rowH = drums ? 22 : 14;
  const [grid, setGrid] = useState(0.25);
  const [bw, setBw] = useState(drums ? 56 : 48);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<NoteDrag | null>(null);
  const lastLen = useRef(drums ? 0.25 : 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const notes = useMemo(() => clip.midiNotes || [], [clip.midiNotes]);
  const len = clip.looped ? clip.loopLength : clip.lengthBeats;
  const width = Math.max(len, 1) * bw;
  const rowOf = (pitch: number) => rows.indexOf(pitch);

  // Scroll to the notes on open.
  useEffect(() => {
    if (drums || !scrollRef.current) return;
    const avg = notes.length ? notes.reduce((a, n) => a + n.pitch, 0) / notes.length : 60;
    scrollRef.current.scrollTop = Math.max(0, rowOf(Math.round(avg)) * rowH - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  useBeatFrame((beat) => {
    const el = headRef.current;
    if (!el) return;
    const local = beat - clip.startBeat;
    const inClip = local >= 0 && local < clip.lengthBeats;
    el.style.display = inClip ? 'block' : 'none';
    if (inClip) el.style.transform = `translateX(${(local % Math.max(0.25, len)) * bw}px)`;
  });

  const display = (n: MIDINote): MIDINote => {
    if (!drag || !drag.ids.includes(n.id)) return n;
    const o = drag.orig.get(n.id) || n;
    if (drag.mode === 'move') {
      const pitch = drums ? rows[Math.max(0, Math.min(rows.length - 1, rowOf(o.pitch) - drag.dPitch))] : Math.max(0, Math.min(127, o.pitch + drag.dPitch));
      return { ...o, startBeat: Math.max(0, o.startBeat + drag.dBeat), pitch };
    }
    return { ...o, lengthBeats: Math.max(grid / 2, o.lengthBeats + drag.dLen) };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const g = e.altKey ? grid / 4 : grid;
      const dBeat = Math.round(((e.clientX - drag.x0) / bw) / g) * g;
      const dPitch = Math.round(-(e.clientY - drag.y0) / rowH);
      setDrag((d) => (d ? { ...d, dBeat, dPitch, dLen: dBeat } : d));
    };
    const up = () => {
      const d = drag;
      setDrag(null);
      if (!d.dBeat && !d.dPitch && !d.dLen) return;
      const next = notes.map((n) => {
        if (!d.ids.includes(n.id)) return n;
        const o = d.orig.get(n.id) || n;
        if (d.mode === 'move') {
          const pitch = drums ? rows[Math.max(0, Math.min(rows.length - 1, rowOf(o.pitch) - d.dPitch))] : Math.max(0, Math.min(127, o.pitch + d.dPitch));
          return { ...o, startBeat: Math.max(0, o.startBeat + d.dBeat), pitch };
        }
        const l = Math.max(grid / 2, o.lengthBeats + d.dLen);
        lastLen.current = l;
        return { ...o, lengthBeats: l };
      });
      onChange(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, grid, bw, rowH, notes]);

  const addAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const beat = Math.floor((e.clientX - r.left) / bw / grid) * grid;
    const row = Math.floor((e.clientY - r.top) / rowH);
    const pitch = rows[row];
    if (pitch === undefined || beat >= len) return;
    const n: MIDINote = { id: newId('n'), pitch, startBeat: beat, lengthBeats: drums ? grid : lastLen.current, velocity: 100, channel: 0 };
    onChange([...notes, n]);
    setSel(new Set([n.id]));
    onAudition(pitch, 100);
  };

  const startNoteDrag = (e: React.PointerEvent, n: MIDINote, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ids = sel.has(n.id) ? Array.from(sel) : [n.id];
    if (!sel.has(n.id)) setSel(new Set([n.id]));
    const orig = new Map(notes.filter((x) => ids.includes(x.id)).map((x) => [x.id, x]));
    setDrag({ ids, mode, x0: e.clientX, y0: e.clientY, orig, dBeat: 0, dPitch: 0, dLen: 0 });
    if (mode === 'move') onAudition(n.pitch, n.velocity);
  };

  // Keyboard: Delete removes selection, ⌘A selects all, arrows nudge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); e.stopPropagation(); onChange(notes.filter((n) => !sel.has(n.id))); setSel(new Set()); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(notes.map((n) => n.id))); }
      if (sel.size && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !drums) {
        e.preventDefault();
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        onChange(notes.map((n) => (sel.has(n.id) ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + d)) } : n)), 'nudge');
      }
      if (sel.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const d = (e.key === 'ArrowRight' ? 1 : -1) * grid;
        onChange(notes.map((n) => (sel.has(n.id) ? { ...n, startBeat: Math.max(0, n.startBeat + d) } : n)), 'nudge');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, notes, onChange, grid, drums]);

  const setVelocityAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const beat = (e.clientX - r.left) / bw;
    const vel = Math.max(1, Math.min(127, Math.round((1 - (e.clientY - r.top) / r.height) * 127)));
    const hit = notes.filter((n) => beat >= n.startBeat && beat < n.startBeat + Math.max(grid, n.lengthBeats) && (!sel.size || sel.has(n.id)));
    if (hit.length) onChange(notes.map((n) => (hit.includes(n) ? { ...n, velocity: vel } : n)), 'velocity');
  };

  return (
    <div className="flex h-full flex-col" data-testid="studio-piano-roll">
      <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-white/5 px-2 text-[11px] text-zinc-400">
        <span className="font-medium text-zinc-200">{clip.name}</span>
        <span>{drums ? 'Drum steps — click to add hits' : 'Click to add notes · drag to move · drag edge to resize · Delete removes'}</span>
        <label className="ml-auto flex items-center gap-1">Grid
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className="rounded bg-white/5 px-1 py-0.5 text-zinc-200">
            <option value={1}>1/4</option><option value={0.5}>1/8</option><option value={0.25}>1/16</option><option value={0.125}>1/32</option>
          </select>
        </label>
        <button onClick={() => onChange(sel.size ? notes.map((n) => (sel.has(n.id) ? quantizeNotes([n], grid)[0] : n)) : quantizeNotes(notes, grid))} className="rounded bg-white/5 px-2 py-0.5 hover:bg-white/10">Quantize</button>
        <label className="flex items-center gap-1">Length
          <select value={clip.lengthBeats} onChange={(e) => { const v = Number(e.target.value); onClipChange({ lengthBeats: v, loopLength: clip.looped ? clip.loopLength : v }); }} className="rounded bg-white/5 px-1 py-0.5 text-zinc-200">
            {[1, 2, 4, 8, 16, 32, 64].map((b) => <option key={b} value={b}>{b / 4 >= 1 ? `${b / 4} bar${b > 4 ? 's' : ''}` : `${b} beat${b > 1 ? 's' : ''}`}</option>)}
          </select>
        </label>
        <button onClick={() => setBw((w) => Math.max(16, w / 1.25))} className="rounded bg-white/5 px-1.5">−</button>
        <button onClick={() => setBw((w) => Math.min(160, w * 1.25))} className="rounded bg-white/5 px-1.5">+</button>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ width: width + 56 }}>
          <div className="sticky left-0 z-10 w-14 flex-shrink-0 bg-[#121218]">
            {rows.map((pitch) => (
              <button
                key={pitch}
                onPointerDown={() => onAudition(pitch, 100)}
                className={cn('block w-full border-b border-black/40 pr-1 text-right text-[9px]', drums ? 'bg-[#1b1b23] text-zinc-300' : isBlack(pitch) ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-200 text-zinc-600')}
                style={{ height: rowH }}
              >
                {drums ? DRUM_LANES.find((l) => l.pitch === pitch)?.name : pitch % 12 === 0 ? nameOf(pitch) : ''}
              </button>
            ))}
          </div>
          <div className="relative" style={{ width, height: rows.length * rowH }}>
            <div
              className="absolute inset-0"
              onPointerDown={(e) => { if (e.button === 0 && e.target === e.currentTarget) { setSel(new Set()); addAt(e); } }}
              style={{
                backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.09) 0 1px, transparent 1px ${bw * 4}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px ${bw * grid}px), repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 1px, transparent 1px ${rowH}px)`,
                backgroundColor: '#15151c',
              }}
            />
            {!drums && rows.map((pitch, i) => isBlack(pitch) ? <div key={pitch} className="pointer-events-none absolute w-full bg-black/20" style={{ top: i * rowH, height: rowH }} /> : null)}
            {notes.map((n0) => {
              const n = display(n0);
              const r = rowOf(n.pitch);
              if (r < 0) return null;
              return (
                <div
                  key={n.id}
                  onPointerDown={(e) => startNoteDrag(e, n0, 'move')}
                  onDoubleClick={(e) => { e.stopPropagation(); onChange(notes.filter((x) => x.id !== n.id)); }}
                  onContextMenu={(e) => { e.preventDefault(); onChange(notes.filter((x) => x.id !== n.id)); }}
                  className={cn('absolute cursor-grab rounded-[3px] border', sel.has(n.id) ? 'border-white' : 'border-black/40')}
                  style={{ left: n.startBeat * bw, top: r * rowH + 1, width: Math.max(4, n.lengthBeats * bw - 1), height: rowH - 2, background: track.color, opacity: 0.45 + (n.velocity / 127) * 0.55 }}
                  title={`${drums ? DRUM_LANES.find((l) => l.pitch === n.pitch)?.name : nameOf(n.pitch)} · vel ${n.velocity}`}
                  data-testid="studio-note"
                >
                  <div onPointerDown={(e) => startNoteDrag(e, n0, 'resize')} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
                </div>
              );
            })}
            {len > 0 && <div className="pointer-events-none absolute top-0 h-full w-px bg-white/30" style={{ left: len * bw }} />}
            <div ref={headRef} className="pointer-events-none absolute top-0 h-full w-px bg-emerald-300" />
          </div>
        </div>
      </div>
      <div className="relative h-12 flex-shrink-0 border-t border-white/5 bg-[#111117]" style={{ marginLeft: 56 }}>
        <div className="absolute inset-0 cursor-ns-resize" onPointerDown={setVelocityAt} onPointerMove={(e) => { if (e.buttons === 1) setVelocityAt(e); }} title="Velocity — drag to set">
          {notes.map((n) => (
            <div key={n.id} className={cn('pointer-events-none absolute bottom-0 w-1 rounded-t', sel.has(n.id) ? 'bg-white' : 'bg-zinc-400')} style={{ left: n.startBeat * bw - (scrollRef.current?.scrollLeft || 0), height: `${(n.velocity / 127) * 100}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
