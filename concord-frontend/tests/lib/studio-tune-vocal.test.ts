// The Booth's one-tap "Tune vocal", measured. An off-key sung line goes
// through the same Pitch Correct core the worklet and the export run, and
// every note's pitch is measured on the way out with YIN.
import { describe, it, expect } from 'vitest';
import { createAudioClip, createProject, createTrack, effect } from '@/lib/daw/project';
import { scaleMaskFor, yinDetect } from '@/lib/daw/dsp/pitch/core';
import { preparePitchExport } from '@/lib/daw/dsp/pitch/settings';
import { pitchReport, rangeForTake, tuneVocal, tunedReport, type PcmAudio } from '@/lib/daw/tune-vocal';

const SR = 48000;
const NOTE_SEC = 0.5;
const GAP_SEC = 0.06;

// A natural minor line, each note sung off by a known amount (cents).
const LINE: Array<[midi: number, cents: number]> = [
  [69, +30], // A4 sharp
  [72, -35], // C5 flat
  [76, +25], // E5 sharp
  [74, -40], // D5 flat
  [72, +20], // C5 sharp
  [71, -30], // B4 flat
  [69, +35], // A4 sharp
];
const hz = (midi: number, cents = 0) => 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);

/** A voice-like tone: fundamental plus decaying harmonics, 5.5 Hz vibrato of ±12 cents, short silences between notes. */
function sing(line: Array<[number, number]>): Float32Array {
  const per = Math.round(SR * NOTE_SEC);
  const gap = Math.round(SR * GAP_SEC);
  const out = new Float32Array(line.length * (per + gap));
  let phase = 0;
  let v = 0;
  line.forEach(([midi, cents], i) => {
    const f0 = hz(midi, cents);
    const start = i * (per + gap);
    for (let n = 0; n < per; n++) {
      const env = Math.min(1, n / 960, (per - n) / 960);
      const f = f0 * Math.pow(2, (12 / 1200) * Math.sin(v));
      out[start + n] = env * 0.5 * (Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(4 * phase));
      phase += (2 * Math.PI * f) / SR;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
      v += (2 * Math.PI * 5.5) / SR;
    }
  });
  return out;
}

/** Median YIN pitch over the steady middle of note i, in cents from its in-key target. */
function measuredOffsets(signal: Float32Array): number[] {
  const per = Math.round(SR * NOTE_SEC);
  const gap = Math.round(SR * GAP_SEC);
  return LINE.map(([midi], i) => {
    const mid = i * (per + gap);
    const found: number[] = [];
    for (let at = mid + 9000; at + 4096 <= mid + per - 3000; at += 1024) {
      const r = yinDetect(signal.subarray(at, at + 4096), SR, 70, 1100);
      if (r.hz > 0 && r.confidence > 0.6) found.push(r.hz);
    }
    found.sort((a, b) => a - b);
    const med = found[Math.floor(found.length / 2)];
    return 1200 * Math.log2(med / hz(midi));
  });
}

function vocalSong(scale = 'chromatic') {
  const project = createProject('Booth take', 92, 'C', scale);
  const vocal = createTrack('audio', 0, { name: 'Lead vocal' });
  const take = createAudioClip(vocal, 0, 8, 'take-1', 'Take 1');
  vocal.clips = [take];
  vocal.effectChain = [effect('compressor', 'Compressor', { threshold: -18, ratio: 3 }, 1, 'comp')];
  const keys = createTrack('instrument', 1, { name: 'Keys' });
  project.tracks = [vocal, keys];
  const pcm: PcmAudio = { channels: [sing(LINE)], sampleRate: SR };
  const audio = new Map([['take-1', pcm]]);
  return { project, vocal, keys, take, pcm, audio };
}

describe('tuneVocal: one tap puts the vocal in key', () => {
  it('the raw take really is off: every note measures 20–40 cents from its note', () => {
    const { pcm } = vocalSong();
    const off = measuredOffsets(pcm.channels[0]);
    off.forEach((c, i) => expect(Math.abs(c - LINE[i][1])).toBeLessThan(4));
  });

  it('with no song key, detects A minor (or its relative C major) from the take and writes it to the song', () => {
    const { project, vocal, audio } = vocalSong('chromatic');
    const r = tuneVocal(project, vocal.id, audio, 'natural');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.keySource).toBe('detected');
    expect(scaleMaskFor(r.key, r.scale).mask).toBe(scaleMaskFor('A', 'minor').mask);
    expect(r.project.key).toBe(r.key);
    expect(r.project.scale).toBe(r.scale);
    // The line runs A4–E5 (440–659 Hz): past Tenor-Alto's 520 Hz top, inside Soprano.
    expect(r.range).toBe('Soprano');
  });

  it('puts Pitch Correct first in the chain, keeps the rest, and leaves the source take untouched', () => {
    const { project, vocal, audio, pcm } = vocalSong('chromatic');
    const original = pcm.channels[0].slice();
    const r = tuneVocal(project, vocal.id, audio, 'natural');
    if (!r.ok) throw new Error(r.reason);
    const chain = r.project.tracks[0].effectChain;
    expect(chain.map((e) => e.type)).toEqual(['pitchCorrect', 'compressor']);
    expect(chain[0].id).toBe(r.fxId);
    expect(chain[0].params).toMatchObject({ retuneMs: 50, humanize: 60, flexCents: 70, preserveVibrato: 1, useProject: 1, range: 2 });
    expect(project.tracks[0].effectChain.map((e) => e.type)).toEqual(['compressor']); // input project not mutated
    expect(Array.from(pcm.channels[0].subarray(0, 4000))).toEqual(Array.from(original.subarray(0, 4000)));
  });

  it('natural tune: every note lands within 6 cents of its in-key note (measured on the export render)', () => {
    const { project, vocal, audio } = vocalSong('chromatic');
    const r = tuneVocal(project, vocal.id, audio, 'natural');
    if (!r.ok) throw new Error(r.reason);
    const out = preparePitchExport(r.project, audio);
    const tuned = out.audio.get(out.project.tracks[0].clips[0].audioBufferId!)!.channels[0];
    const after = measuredOffsets(tuned);
    after.forEach((c) => expect(Math.abs(c)).toBeLessThan(6));
  });

  it('hard tune: every note lands within 5 cents (YIN measures to about ±4)', () => {
    const { project, vocal, audio } = vocalSong('chromatic');
    const r = tuneVocal(project, vocal.id, audio, 'hard');
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.tracks[0].effectChain[0].params).toMatchObject({ retuneMs: 0, humanize: 0, flexCents: 200 });
    const out = preparePitchExport(r.project, audio);
    const tuned = out.audio.get(out.project.tracks[0].clips[0].audioBufferId!)!.channels[0];
    measuredOffsets(tuned).forEach((c) => expect(Math.abs(c)).toBeLessThan(5));
  });

  it('a note sung between two scale degrees goes to the in-key one, not the nearest semitone', () => {
    // G#4 is not in A natural minor. Sung 30 cents flat of G#4 it is 70 cents above G4 and 130 below A4,
    // so it must land on G4, never on the out-of-key G# it is nearest to.
    const project = createProject('Key test', 92, 'A', 'minor');
    const vocal = createTrack('audio', 0);
    vocal.clips = [createAudioClip(vocal, 0, 2, 'gs', 'G#')];
    project.tracks = [vocal];
    const line: Array<[number, number]> = [[68, -30]];
    const audio = new Map([['gs', { channels: [sing(line)], sampleRate: SR }]]);
    const r = tuneVocal(project, vocal.id, audio, 'hard');
    if (!r.ok) throw new Error(r.reason);
    expect(r.keySource).toBe('song');
    const out = preparePitchExport(r.project, audio);
    const tuned = out.audio.get(out.project.tracks[0].clips[0].audioBufferId!)!.channels[0];
    const found: number[] = [];
    for (let at = 9000; at + 4096 <= 21000; at += 1024) found.push(yinDetect(tuned.subarray(at, at + 4096), SR, 70, 1100).hz);
    found.sort((a, b) => a - b);
    const f = found[Math.floor(found.length / 2)];
    expect(Math.abs(1200 * Math.log2(f / hz(67)))).toBeLessThan(5);
  });

  it('a second tap re-voices the same device instead of stacking another one', () => {
    const { project, vocal, audio } = vocalSong('chromatic');
    const first = tuneVocal(project, vocal.id, audio, 'natural');
    if (!first.ok) throw new Error(first.reason);
    const second = tuneVocal(first.project, vocal.id, audio, 'hard');
    if (!second.ok) throw new Error(second.reason);
    expect(second.reused).toBe(true);
    expect(second.fxId).toBe(first.fxId);
    expect(second.keySource).toBe('song'); // the key the first tap wrote is now the song's
    const pcs = second.project.tracks[0].effectChain.filter((e) => e.type === 'pitchCorrect');
    expect(pcs).toHaveLength(1);
    expect(pcs[0].params.retuneMs).toBe(0);
  });

  it('refuses honestly: wrong track, instrument track, nothing recorded', () => {
    const { project, keys, audio } = vocalSong();
    expect(tuneVocal(project, 'nope', audio)).toEqual({ ok: false, reason: 'Pick the vocal track first.' });
    expect(tuneVocal(project, keys.id, audio).ok).toBe(false);
    const empty = vocalSong();
    expect(tuneVocal(empty.project, empty.vocal.id, new Map()).ok).toBe(false);
  });

  it('a voice the key detector cannot place falls back to nearest-semitone, and says so', () => {
    const project = createProject('One note', 92, 'C', 'chromatic');
    const vocal = createTrack('audio', 0);
    vocal.clips = [createAudioClip(vocal, 0, 2, 'one', 'one')];
    project.tracks = [vocal];
    // A single repeated pitch class is not enough to call a key with margin.
    const audio = new Map([['one', { channels: [sing([[69, 25], [69, 25]])], sampleRate: SR }]]);
    const r = tuneVocal(project, vocal.id, audio, 'hard');
    if (!r.ok) throw new Error(r.reason);
    if (r.keySource === 'chromatic') {
      expect(r.project.key).toBe('C');
      expect(r.project.tracks[0].effectChain[0].params).toMatchObject({ useProject: 0, scaleName: 'chromatic' });
    } else {
      // If a key is detected it must contain A, the only sung note.
      expect((scaleMaskFor(r.key, r.scale).mask >> 9) & 1).toBe(1);
    }
  });
});

describe('pitchReport / tunedReport: the numbers the Write room shows', () => {
  it('reports the raw take as ~31 cents off on average and the tuned render under 6', async () => {
    const { project, vocal, audio } = vocalSong('chromatic');
    const r = tuneVocal(project, vocal.id, audio, 'natural');
    if (!r.ok) throw new Error(r.reason);
    const rep = await tunedReport(r.project, vocal.id, audio);
    expect(rep?.before?.singleVoice).toBe(true);
    // The note segmenter may split a vibrato note in two; it never merges two sung notes.
    expect(rep!.before!.notes).toBeGreaterThanOrEqual(LINE.length);
    const meanOff = LINE.reduce((s, [, c]) => s + Math.abs(c), 0) / LINE.length; // 30.7 cents
    expect(Math.abs(rep!.before!.meanCents - meanOff)).toBeLessThan(4);
    expect(rep!.before!.worstCents).toBeGreaterThan(35);
    expect(rep!.after!.notes).toBeGreaterThanOrEqual(LINE.length);
    expect(rep!.after!.meanCents).toBeLessThan(6);
  });

  it('picks the singer range from the take', () => {
    const low = { channels: [sing([[45, 0], [48, 0]])], sampleRate: SR }; // A2, C3
    const high = { channels: [sing([[79, 0], [81, 0]])], sampleRate: SR }; // G5, A5
    expect(rangeForTake(low)).toBe(0);
    expect(rangeForTake(high)).toBe(2);
  });

  it('silence has no report', () => {
    expect(pitchReport({ channels: [new Float32Array(SR)], sampleRate: SR }, 0xfff)?.notes ?? 0).toBe(0);
  });
});
