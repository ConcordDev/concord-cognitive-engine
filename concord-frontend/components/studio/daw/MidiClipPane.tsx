'use client';

import { useEffect, useRef, useState } from 'react';
import type { DAWClip, DAWProject, DAWTrack, MIDINote } from '@/lib/daw/types';
import { isDrumInstrument, DRUM_LANES } from '@/lib/daw/presets';
import { patternToNotes } from '@/lib/daw/drum-steps';
import { encodeMidiFile } from '@/lib/daw/midi-file';
import { noteFromMidi, sustainFromMidi } from '@/lib/daw/midi-messages';
import { newId } from '@/lib/daw/project';
import { PianoRoll } from './PianoRoll';
import { StepGrid } from './StepGrid';
import * as ops from './ops';

function place(beat: number, clip: DAWClip): number | null {
  if (!(beat >= 0)) return null;
  const rel = beat - clip.startBeat;
  if (clip.looped && clip.loopLength > 0) return rel < 0 ? null : rel % clip.loopLength;
  if (rel < 0 || rel >= clip.lengthBeats) return null;
  return rel;
}

export function MidiClipPane({ project, track, clip, playing, getBeat, onEdit, onAudition }: {
  project: DAWProject;
  track: DAWTrack;
  clip: DAWClip;
  playing: boolean;
  getBeat: () => number;
  onEdit: (fn: (p: DAWProject) => DAWProject, key?: string) => void;
  onAudition: (pitch: number, velocity?: number) => void;
}) {
  const drums = isDrumInstrument(track.instrumentId);
  const [view, setView] = useState<'steps' | 'notes'>(drums ? 'steps' : 'notes');
  const [inputs, setInputs] = useState<Array<{ id: string; name: string }>>([]);
  const [inputId, setInputId] = useState('');
  const midiOk = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  const accessRef = useRef<MIDIAccess | null>(null);
  const held = useRef(new Map<number, { start: number; velocity: number }>());
  const waiting = useRef(new Set<number>());
  const pedal = useRef(false);
  const live = useRef({ project, track, clip, playing });
  useEffect(() => {
    live.current = { project, track, clip, playing };
  });

  const commit = (pitch: number, endBeat: number | null) => {
    const hit = held.current.get(pitch);
    held.current.delete(pitch);
    waiting.current.delete(pitch);
    if (!hit || endBeat == null) return;
    let length = endBeat - hit.start;
    const loop = live.current.clip.loopLength;
    if (length < 0 && live.current.clip.looped && loop > 0) length += loop;
    if (!(length > 0)) length = 0.05;
    const note: MIDINote = { id: newId('n'), pitch, velocity: hit.velocity, startBeat: hit.start, lengthBeats: length, channel: 0 };
    onEdit((p) => {
      const found = p.tracks.flatMap((t) => t.clips).find((c) => c.id === live.current.clip.id);
      return ops.setNotes(p, live.current.clip.id, [...(found?.midiNotes || []), note]);
    });
  };

  const onData = (data: Uint8Array) => {
    const pedalNext = sustainFromMidi(data);
    if (pedalNext != null) {
      pedal.current = pedalNext;
      if (!pedalNext) {
        const at = place(getBeat(), live.current.clip);
        for (const pitch of [...waiting.current]) commit(pitch, at);
      }
      return;
    }
    const msg = noteFromMidi(data);
    if (!msg) return;
    const { track: tr, clip: cl, playing: on } = live.current;
    if (msg.kind === 'on') {
      onAudition(msg.pitch, msg.velocity);
      if (!on || !tr.armed) return;
      const pattern = cl.patternId ? live.current.project.drumPatterns?.[cl.patternId] : undefined;
      const at = place(getBeat(), cl);
      if (at == null) return;
      if (pattern) {
        const row = DRUM_LANES.findIndex((l) => l.pitch === msg.pitch);
        if (row < 0) return;
        const step = Math.round(at / (pattern.resolution || 0.25));
        if (step < 0 || step >= pattern.steps) return;
        onEdit((p) => {
          const cur = p.drumPatterns?.[pattern.id];
          if (!cur) return p;
          const tracks = cur.tracks.map((lane, i) => i !== row ? lane : {
            ...lane,
            steps: lane.steps.map((s, n) => n === step ? { ...s, active: true, velocity: msg.velocity } : s),
          });
          return { ...p, drumPatterns: { ...p.drumPatterns, [cur.id]: { ...cur, tracks } } };
        });
        return;
      }
      held.current.set(msg.pitch, { start: at, velocity: msg.velocity });
      return;
    }
    if (pedal.current) { waiting.current.add(msg.pitch); return; }
    commit(msg.pitch, place(getBeat(), live.current.clip));
  };
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });

  useEffect(() => () => {
    const access = accessRef.current;
    access?.inputs.forEach((input) => { input.onmidimessage = null; });
  }, []);

  const connect = async () => {
    if (!midiOk) return;
    const access = await navigator.requestMIDIAccess({ sysex: false });
    accessRef.current = access;
    const list = [...access.inputs.values()].map((input) => ({ id: input.id, name: input.name || 'MIDI input' }));
    setInputs(list);
    const id = list[0]?.id || '';
    setInputId(id);
    access.inputs.forEach((input) => {
      input.onmidimessage = input.id === id ? (ev) => onDataRef.current(ev.data) : null;
    });
  };

  const choose = (id: string) => {
    setInputId(id);
    accessRef.current?.inputs.forEach((input) => {
      input.onmidimessage = input.id === id ? (ev) => onDataRef.current(ev.data) : null;
    });
  };

  const download = () => {
    const pattern = clip.patternId ? project.drumPatterns?.[clip.patternId] : undefined;
    const notes = pattern ? patternToNotes(pattern, 0) : (clip.midiNotes || []);
    const bytes = encodeMidiFile(notes, project.bpm || 120);
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.name || 'clip'}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-2 py-1 text-[11px]">
        {drums && (
          <>
            <button type="button" aria-pressed={view === 'steps'} className="rounded px-2 py-0.5 text-zinc-200" onClick={() => setView('steps')}>Steps</button>
            <button type="button" aria-pressed={view === 'notes'} className="rounded px-2 py-0.5 text-zinc-200" onClick={() => setView('notes')}>Notes</button>
          </>
        )}
        <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-zinc-100" onClick={download}>Download MIDI</button>
        {midiOk && !inputs.length && <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-zinc-100" onClick={() => void connect()}>MIDI input</button>}
        {midiOk && inputs.length > 0 && (
          <label>Input
            <select aria-label="MIDI input" className="ml-1 rounded bg-black/40 px-1 py-0.5 text-zinc-100" value={inputId} onChange={(e) => choose(e.target.value)}>
              {inputs.map((input) => <option key={input.id} value={input.id}>{input.name}</option>)}
            </select>
          </label>
        )}
        {midiOk && <span className="text-zinc-500">Armed tracks record while the transport plays. Count-in beats are not written. Sustain holds the note.</span>}
      </div>
      <div className="min-h-0 flex-1">
        {drums && view === 'steps' ? (
          <StepGrid project={project} track={track} clip={clip} onEdit={onEdit} />
        ) : (
          <PianoRoll
            key={clip.id}
            track={track}
            clip={clip}
            onChange={(notes, key) => onEdit((p) => ops.setNotes(p, clip.id, notes), key)}
            onClipChange={(patch) => onEdit((p) => ops.mapClip(p, clip.id, (c) => ({ ...c, ...patch })))}
            onAudition={onAudition}
          />
        )}
      </div>
    </div>
  );
}
