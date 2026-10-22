import { describe, expect, it } from 'vitest';
import { yinDetect } from '@/lib/daw/dsp/pitch/core';
import { shiftSignalByRatio } from '@/lib/daw/dsp/pitch/core';
import {
  analyzePitch,
  editorShiftLatency,
  mergePitchNote,
  pitchEditBufferId,
  renderPitchEdit,
  seedEdits,
  snapMidi,
  splitPitchNote,
} from '@/lib/daw/dsp/pitch/editor';
import { PITCH_EDITOR_POLY_MESSAGE } from '@/lib/daw/pitch-edit-types';
import { normalizeProject, createAudioClip, createTrack } from '@/lib/daw/project';
import { collectEvents } from '@/lib/daw/scheduler';

const SR = 48000;

function cents(actual: number, expected: number): number {
  return Math.abs(1200 * Math.log2(actual / expected));
}

function sine(hz: number, n: number, sr = SR): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

describe('Pitch Editor analysis', () => {
  it('treats a stable sine as one voice and a two-sine mix as not', () => {
    const tone = analyzePitch(sine(440, SR), SR);
    expect(tone.singleVoice).toBe(true);
    expect(tone.notes.length).toBeGreaterThan(0);
    expect(seedEdits('asset', tone)?.notes.length).toBe(tone.notes.length);
    const mix = sine(440, SR);
    const fifth = sine(440 * Math.pow(2, 4 / 12), SR);
    for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * (mix[i] + fifth[i]);
    const poly = analyzePitch(mix, SR);
    expect(poly.singleVoice).toBe(false);
    expect(poly.notes).toEqual([]);
    expect(seedEdits('asset', poly)).toBeNull();
  });

  it('keeps vibrato as one note and splits a sustained jump', () => {
    const n = Math.round(SR * 0.7);
    const vib = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const hz = 440 * Math.pow(2, (50 / 1200) * Math.sin(2 * Math.PI * 5.5 * t));
      vib[i] = Math.sin(phase);
      phase += (2 * Math.PI * hz) / SR;
    }
    const vibrato = analyzePitch(vib, SR);
    expect(vibrato.singleVoice).toBe(true);
    expect(vibrato.notes.length).toBe(1);
    const jump = new Float32Array(n);
    const mid = Math.floor(n / 2);
    phase = 0;
    for (let i = 0; i < n; i++) {
      const hz = i < mid ? 440 : 554;
      jump[i] = Math.sin(phase);
      phase += (2 * Math.PI * hz) / SR;
    }
    const jumped = analyzePitch(jump, SR);
    expect(jumped.singleVoice).toBe(true);
    expect(jumped.notes.length).toBe(2);
  });

  it('moves a 440 Hz sine onto B4', () => {
    const channel = sine(440, SR);
    const analysis = analyzePitch(channel, SR);
    const doc = seedEdits('asset', analysis);
    expect(doc).not.toBeNull();
    if (!doc) return;
    doc.notes = doc.notes.map((note) => ({ ...note, targetMidi: 71, center: 100, drift: 100 }));
    const out = renderPitchEdit(channel, SR, analysis.frames, doc);
    const found = yinDetect(out.subarray(8000, 20000), SR, 60, 1400);
    expect(cents(found.hz, 493.88)).toBeLessThan(15);
    expect(pitchEditBufferId('asset', SR, doc)).toMatch(/^pe_/);
  });
});

describe('Pitch Editor edits', () => {
  it('reports shifter latency as the impulse offset', () => {
    const latency = editorShiftLatency(SR);
    const input = new Float32Array(latency + 64);
    input[0] = 1;
    const shifted = shiftSignalByRatio(input, () => 1, SR);
    expect(shifted.latency).toBe(latency);
    let at = 0;
    let peak = 0;
    for (let i = 0; i < shifted.output.length; i++) {
      if (Math.abs(shifted.output[i]) > peak) { peak = Math.abs(shifted.output[i]); at = i; }
    }
    expect(at).toBe(latency);
  });

  it('snaps to the scale, splits, and merges', () => {
    expect(snapMidi(70, 0xfff)).toBe(70);
    const cMajor = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11);
    expect(snapMidi(70.2, cMajor)).toBe(71);
    const doc = {
      version: 1 as const,
      analysisVersion: 1,
      assetId: 'a',
      macroCenter: 0,
      macroDrift: 0,
      notes: [
        { id: 'n0', startSec: 0, endSec: 1, midi: 69, hz: 440, targetMidi: 69, cents: 0, center: 0, drift: 0, vibrato: 100, gainDb: 0 },
        { id: 'n1', startSec: 1.02, endSec: 2, midi: 71, hz: 494, targetMidi: 71, cents: 0, center: 40, drift: 0, vibrato: 100, gainDb: 0 },
      ],
    };
    const split = splitPitchNote(doc, 'n0');
    expect(split.notes.map((n) => n.id)).toEqual(['n0a', 'n0b', 'n1']);
    const merged = mergePitchNote(doc, 'n0');
    expect(merged.notes).toHaveLength(1);
    expect(merged.notes[0].endSec).toBe(2);
    expect(merged.notes[0].center).toBe(40);
  });

  it('round-trips edits and plays the derived buffer id', () => {
    const saved = normalizeProject({
      tracks: [{
        id: 't', type: 'audio', name: 'Vox',
        clips: [{
          id: 'c', type: 'audio', audioBufferId: 'buf', startBeat: 0, lengthBeats: 4,
          pitchEdits: {
            version: 1, assetId: 'buf', macroCenter: 25, macroDrift: 0,
            notes: [{ id: 'n0', startSec: 0.1, endSec: 0.8, midi: 69, hz: 440, targetMidi: 71, cents: 0, center: 100, drift: 0, vibrato: 100, gainDb: 0 }],
          },
        }],
      }],
    });
    expect(saved.tracks[0].clips[0].pitchEdits?.macroCenter).toBe(25);
    expect(saved.tracks[0].clips[0].pitchEdits?.notes[0].targetMidi).toBe(71);
    const old = normalizeProject({ title: 'Old', tracks: [{ id: 't', type: 'audio', clips: [{ id: 'c', type: 'audio', audioBufferId: 'buf', startBeat: 1, lengthBeats: 2 }] }] });
    expect(old.tracks[0].clips[0].pitchEdits).toBeUndefined();
    expect(old.tracks[0].clips[0].audioBufferId).toBe('buf');
    const track = createTrack('audio', 0);
    const clip = createAudioClip(track, 0, 4, 'buf', 'Vox');
    const ev = collectEvents(0, 2, {
      tracks: [{ ...track, clips: [clip] }],
      beatsPerBar: 4,
      bpm: 120,
      metronome: false,
      mode: 'arrange',
      bufferOverrides: { [clip.id]: 'derived' },
    }).find((e) => e.kind === 'audio');
    expect(ev && ev.kind === 'audio' && ev.bufferId).toBe('derived');
  });
});

describe('Pitch Editor copy', () => {
  it('uses the single-voice sentence and no vendor name', () => {
    expect(PITCH_EDITOR_POLY_MESSAGE).toBe('Pitch Editor only works on a single voice');
    expect(PITCH_EDITOR_POLY_MESSAGE.toLowerCase()).not.toMatch(/melodyne|auto-tune|autotune|flex pitch/);
  });
});
