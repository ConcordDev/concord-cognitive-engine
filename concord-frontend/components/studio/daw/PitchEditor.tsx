'use client';

/**
 * Graphical Pitch Editor for a mono audio clip. Analysis runs in a worker.
 * Edits are project JSON. The engine renders the derived buffer.
 * Formant controls are omitted: the shifter does not change formants.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DAWClip, DAWProject } from '@/lib/daw/types';
import {
  PITCH_EDITOR_MONO_MESSAGE,
  PITCH_EDITOR_POLY_MESSAGE,
  type PitchAnalysis,
  type PitchEditDoc,
  type PitchNoteEdit,
} from '@/lib/daw/pitch-edit-types';
import { analyzePitch, editorNoteLabel, projectSnapMask, seedEdits, snapMidi, splitPitchNote, mergePitchNote } from '@/lib/daw/dsp/pitch/editor';
import { analyzeOffThread, loadCachedAnalysis, rememberAnalysis } from '@/lib/daw/pitch-edit-cache';

const LOW_MIDI = 48;
const HIGH_MIDI = 84;
const NO_NOTES: PitchNoteEdit[] = [];

interface Pcm {
  channels: Float32Array[];
  sampleRate: number;
}

interface Props {
  clip: DAWClip;
  project: DAWProject;
  pcm: Pcm | null;
  onEdits: (doc: PitchEditDoc | null, coalesceKey?: string) => void;
}

function shownMidi(note: PitchNoteEdit, macroCenter: number): number {
  const center = Math.max(note.center, macroCenter) / 100;
  const target = note.targetMidi + note.cents / 100;
  return note.midi + (target - note.midi) * center;
}

export function PitchEditor({ clip, project, pcm, onEdits }: Props) {
  const assetId = clip.audioBufferId || '';
  const mono = pcm?.channels.length === 1 ? pcm.channels[0] : null;
  const [analysis, setAnalysis] = useState<PitchAnalysis | null>(null);
  const [status, setStatus] = useState('Analyzing pitch…');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<PitchEditDoc | null>(null);
  const pending = useRef<PitchEditDoc | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; y: number; midi: number; cents: number; alt: boolean } | null>(null);
  const mask = projectSnapMask(project);
  const doc = draft || clip.pitchEdits || null;
  const notes = doc?.notes || analysis?.notes || NO_NOTES;
  const selectedNote = notes.find((n) => n.id === selected) || null;
  const clipKey = `${assetId}:${pcm?.sampleRate || 0}:${mono?.length || 0}:${pcm?.channels.length || 0}`;
  const [scope, setScope] = useState('');
  if (scope !== clipKey) {
    setScope(clipKey);
    setDraft(null);
    setSelected(null);
    setAnalysis(null);
    setStatus(!pcm ? 'Audio is not loaded yet.' : pcm.channels.length !== 1 ? PITCH_EDITOR_MONO_MESSAGE : 'Analyzing pitch…');
  }

  useEffect(() => {
    pending.current = null;
    if (!mono || !pcm) return;
    let cancel = false;
    const run = async () => {
      const cached = await loadCachedAnalysis(assetId, pcm.sampleRate, mono.length);
      const result = cached || await analyzeOffThread(mono, pcm.sampleRate, analyzePitch);
      if (cancel) return;
      if (!cached) void rememberAnalysis(assetId, pcm.sampleRate, mono.length, result);
      setAnalysis(result);
      setStatus(result.singleVoice ? (result.notes.length ? 'Drag a note to retune it. Alt drags free cents.' : 'No pitched notes in this clip.') : PITCH_EDITOR_POLY_MESSAGE);
    };
    void run();
    return () => { cancel = true; };
  }, [assetId, mono, pcm]);

  const duration = useMemo(() => {
    const fromPcm = mono && pcm ? mono.length / pcm.sampleRate : 0;
    const fromNotes = notes.reduce((m, n) => Math.max(m, n.endSec), 0);
    return Math.max(0.001, fromPcm, fromNotes);
  }, [mono, pcm, notes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#09090d';
    g.fillRect(0, 0, w, h);
    const yOf = (midi: number) => (1 - (midi - LOW_MIDI) / (HIGH_MIDI - LOW_MIDI)) * h;
    for (let midi = LOW_MIDI; midi <= HIGH_MIDI; midi++) {
      const on = (mask & (1 << (midi % 12))) !== 0;
      g.fillStyle = on ? 'rgba(124,58,237,0.16)' : 'rgba(255,255,255,0.02)';
      g.fillRect(0, yOf(midi + 0.5), w, h / (HIGH_MIDI - LOW_MIDI));
    }
    const frames = analysis?.frames || [];
    if (frames.length) {
      g.beginPath();
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1;
      let moved = false;
      for (const frame of frames) {
        if (!(frame.hz > 0) || frame.conf < 0.6) { moved = false; continue; }
        const midi = 69 + 12 * Math.log2(frame.hz / 440);
        const x = (frame.t / duration) * w;
        const y = yOf(midi);
        if (!moved) { g.moveTo(x, y); moved = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    const macro = doc?.macroCenter || 0;
    for (const note of notes) {
      const x = (note.startSec / duration) * w;
      const width = Math.max(4, ((note.endSec - note.startSec) / duration) * w);
      const midi = shownMidi(note, macro);
      const y = yOf(midi);
      g.fillStyle = note.id === selected ? '#f59e0b' : '#7c3aed';
      g.fillRect(x, y - 6, width, 12);
    }
  }, [analysis, notes, duration, mask, selected, doc?.macroCenter]);

  const ensureDoc = (): PitchEditDoc | null => {
    if (doc) return doc;
    if (!analysis) return null;
    return seedEdits(assetId, analysis);
  };

  const hold = (next: PitchEditDoc | null) => {
    pending.current = next;
    setDraft(next);
  };

  const commit = (next: PitchEditDoc | null) => {
    pending.current = null;
    setDraft(null);
    onEdits(next, `pitch:${clip.id}`);
  };

  const commitPending = () => {
    if (pending.current) commit(pending.current);
  };

  const patchNote = (id: string, patch: Partial<PitchNoteEdit>, save: boolean) => {
    const base = ensureDoc();
    if (!base || !analysis?.singleVoice) return;
    const next = { ...base, notes: base.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
    hold(next);
    if (save) commit(next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!analysis?.singleVoice) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = notes.find((n) => {
      const nx = (n.startSec / duration) * rect.width;
      const nw = Math.max(4, ((n.endSec - n.startSec) / duration) * rect.width);
      const ny = (1 - (shownMidi(n, doc?.macroCenter || 0) - LOW_MIDI) / (HIGH_MIDI - LOW_MIDI)) * rect.height;
      return x >= nx && x <= nx + nw && Math.abs(y - ny) <= 10;
    });
    setSelected(hit?.id || null);
    if (hit) drag.current = { id: hit.id, y, midi: hit.targetMidi, cents: hit.cents, alt: e.altKey };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    const semis = -dy / 10;
    if (d.alt || e.altKey) {
      const total = d.midi + d.cents / 100 + semis;
      const targetMidi = Math.max(0, Math.min(127, Math.round(total)));
      const cents = Math.max(-100, Math.min(100, Math.round((total - targetMidi) * 100)));
      patchNote(d.id, { targetMidi, cents, center: 100 }, false);
    } else {
      patchNote(d.id, { targetMidi: snapMidi(d.midi + semis, mask), cents: 0, center: 100 }, false);
    }
  };

  const onPointerUp = () => {
    if (drag.current) commitPending();
    drag.current = null;
  };

  const nudge = (dir: number, alt: boolean) => {
    if (!selectedNote || !analysis?.singleVoice) return;
    if (alt) patchNote(selectedNote.id, { cents: Math.max(-100, Math.min(100, selectedNote.cents + dir * 10)), center: 100 }, true);
    else patchNote(selectedNote.id, { targetMidi: snapMidi(selectedNote.targetMidi + dir, mask), cents: 0, center: 100 }, true);
  };

  const setMacro = (patch: Partial<Pick<PitchEditDoc, 'macroCenter' | 'macroDrift'>>, save: boolean) => {
    const base = ensureDoc();
    if (!base) return;
    const next = { ...base, ...patch };
    hold(next);
    if (save) commit(next);
  };

  const blocked = !mono || (analysis && !analysis.singleVoice);
  const field = 'w-16 rounded bg-black/40 px-1 py-0.5 text-[11px] text-white';

  return (
    <div className="flex h-full flex-col" data-testid="studio-pitch-editor" onKeyDown={(e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(e.key === 'ArrowUp' ? 1 : -1, e.altKey);
      }
    }}>
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-400">
        <span>{clip.name}</span>
        <span data-testid="studio-pitch-status">{status}</span>
        {selectedNote && <span>{editorNoteLabel(selectedNote.targetMidi)} {selectedNote.cents > 0 ? `+${selectedNote.cents}` : selectedNote.cents} cents</span>}
      </div>
      <div className="min-h-0 flex-1 px-2">
        <canvas
          ref={canvasRef}
          className="h-full w-full rounded bg-black/40"
          aria-label="Pitch Editor note grid"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-[11px] text-zinc-300">
        <label>Correct pitch center
          <input aria-label="Correct pitch center" className={field} type="range" min={0} max={100} disabled={!!blocked || !analysis?.notes.length} value={doc?.macroCenter || 0}
            onChange={(e) => setMacro({ macroCenter: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <label>Correct drift
          <input aria-label="Correct drift" className={field} type="range" min={0} max={200} disabled={!!blocked || !analysis?.notes.length} value={doc?.macroDrift || 0}
            onChange={(e) => setMacro({ macroDrift: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <label>Pitch center
          <input aria-label="Pitch center" className={field} type="range" min={0} max={100} disabled={!selectedNote || !!blocked} value={selectedNote?.center || 0}
            onChange={(e) => selectedNote && patchNote(selectedNote.id, { center: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <label>Drift
          <input aria-label="Drift" className={field} type="range" min={0} max={200} disabled={!selectedNote || !!blocked} value={selectedNote?.drift || 0}
            onChange={(e) => selectedNote && patchNote(selectedNote.id, { drift: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <label>Vibrato
          <input aria-label="Vibrato" className={field} type="range" min={0} max={200} disabled={!selectedNote || !!blocked} value={selectedNote?.vibrato ?? 100}
            onChange={(e) => selectedNote && patchNote(selectedNote.id, { vibrato: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <label>Gain
          <input aria-label="Note gain" className={field} type="range" min={-24} max={24} disabled={!selectedNote || !!blocked} value={selectedNote?.gainDb || 0}
            onChange={(e) => selectedNote && patchNote(selectedNote.id, { gainDb: Number(e.target.value) }, false)}
            onPointerUp={commitPending}
            onKeyUp={commitPending}
            onBlur={commitPending} />
        </label>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5" disabled={!selectedNote || !!blocked} onClick={() => { const base = ensureDoc(); if (base && selectedNote) commit(splitPitchNote(base, selectedNote.id)); }}>Split</button>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5" disabled={!selectedNote || !!blocked} onClick={() => { const base = ensureDoc(); if (base && selectedNote) commit(mergePitchNote(base, selectedNote.id)); }}>Merge</button>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => { setSelected(cycle(notes, selected, -1)); }}>Previous note</button>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => { setSelected(cycle(notes, selected, 1)); }}>Next note</button>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5" disabled={!clip.pitchEdits} onClick={() => commit(null)}>Clear pitch edits</button>
      </div>
    </div>
  );
}

function cycle(notes: PitchNoteEdit[], selected: string | null, dir: number): string | null {
  if (!notes.length) return null;
  const index = Math.max(0, notes.findIndex((n) => n.id === selected));
  return notes[(index + dir + notes.length) % notes.length].id;
}
