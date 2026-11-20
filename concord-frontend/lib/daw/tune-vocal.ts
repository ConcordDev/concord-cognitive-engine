/**
 * One-tap vocal tuning for the Booth's Write room, plus the before/after
 * report it shows. Pure functions over the same Pitch Correct core the live
 * worklet and the export path run, so the numbers on screen are the numbers
 * the speakers and the bounced file get.
 *
 * tuneVocal:   puts (or re-voices) a Pitch Correct at the head of a vocal
 *              track, in the song's key. If the song has no usable key it
 *              detects one from the take first and writes it to the song.
 * pitchReport: how far each sung note sits from the nearest note in the key,
 *              in cents. Run it on the raw take and on the tuned render.
 */

import type { DAWProject, DAWTrack, EffectInstance } from './types';
import { effect } from './project';
import { PITCH_PRESETS, PITCH_RANGES, scaleMaskFor } from './dsp/pitch/core';
import { analyzePitch, snapMidi } from './dsp/pitch/editor';
import { detectKeyFromAudio } from './dsp/pitch/key-detect';
import { preparePitchExportAsync } from './dsp/pitch/settings';

export type TuneStyle = 'natural' | 'hard';

export interface PcmAudio {
  channels: Float32Array[];
  sampleRate: number;
}

const PRESET_FOR: Record<TuneStyle, string> = { natural: 'rnb-natural', hard: 'rap-hard' };

/** The Pitch Correct device every new instance starts from (one source of truth for the card and the Booth). */
export function pitchCorrectParams(): EffectInstance['params'] {
  return {
    retuneMs: 0,
    humanize: 0,
    flexCents: 200,
    preserveVibrato: 0,
    transpose: 0,
    formantSemitones: 0,
    quality: 0,
    range: 1,
    useProject: 1,
    keyName: 'C',
    scaleName: 'chromatic',
  };
}

function mono(pcm: PcmAudio): Float32Array {
  const [a, b] = pcm.channels;
  if (!b) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}

/** The loaded takes on a track, longest first. */
export function trackTakes(track: DAWTrack, audio: Map<string, PcmAudio>): Array<{ clipId: string; bufferId: string; pcm: PcmAudio }> {
  const out: Array<{ clipId: string; bufferId: string; pcm: PcmAudio }> = [];
  for (const c of track.clips) {
    if (c.type !== 'audio' || !c.audioBufferId) continue;
    const pcm = audio.get(c.audioBufferId);
    if (pcm?.channels?.length && pcm.channels[0].length) out.push({ clipId: c.id, bufferId: c.audioBufferId, pcm });
  }
  return out.sort((x, y) => y.pcm.channels[0].length - x.pcm.channels[0].length);
}

/**
 * The singer's range: the narrowest voice range (Low male / Tenor-Alto /
 * Soprano) that covers the take's 10th–90th percentile voiced pitch, or
 * Instrument when no vocal range covers it.
 */
export function rangeForTake(pcm: PcmAudio): number {
  const hz = analyzePitch(mono(pcm), pcm.sampleRate).frames.filter((f) => f.hz > 0 && f.conf >= 0.6).map((f) => f.hz).sort((a, b) => a - b);
  if (!hz.length) return 1;
  const lo = hz[Math.floor(hz.length * 0.1)];
  const hi = hz[Math.min(hz.length - 1, Math.floor(hz.length * 0.9))];
  let best = -1;
  for (let i = 0; i < PITCH_RANGES.length; i++) {
    const r = PITCH_RANGES[i];
    if (r.id === 'instrument' || lo < r.minHz || hi > r.maxHz) continue;
    if (best < 0 || r.maxHz - r.minHz < PITCH_RANGES[best].maxHz - PITCH_RANGES[best].minHz) best = i;
  }
  return best >= 0 ? best : PITCH_RANGES.findIndex((r) => r.id === 'instrument');
}

export type TuneResult =
  | {
    ok: true;
    project: DAWProject;
    fxId: string;
    key: string;
    scale: string;
    /** 'song' = the song's key was used; 'detected' = detected from the take and written to the song; 'chromatic' = no key found, nearest semitone. */
    keySource: 'song' | 'detected' | 'chromatic';
    /** True when the track already had a Pitch Correct that was re-voiced instead of a second one added. */
    reused: boolean;
    range: string;
  }
  | { ok: false; reason: string };

export function tuneVocal(project: DAWProject, trackId: string, audio: Map<string, PcmAudio>, style: TuneStyle = 'natural'): TuneResult {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return { ok: false, reason: 'Pick the vocal track first.' };
  if (track.type !== 'audio') return { ok: false, reason: 'Tuning works on a recorded (audio) track, not an instrument.' };
  const takes = trackTakes(track, audio);
  if (!takes.length) return { ok: false, reason: 'Record or drop a vocal on this track first. There is nothing to tune yet.' };

  let key = project.key;
  let scale = project.scale;
  let keySource: 'song' | 'detected' | 'chromatic' = 'song';
  const songKey = scaleMaskFor(project.key, project.scale, project.scaleMask);
  if (!songKey.known || songKey.mask === 0xfff) {
    const found = detectKeyFromAudio(mono(takes[0].pcm), takes[0].pcm.sampleRate);
    if (found) { key = found.key; scale = found.scale; keySource = 'detected'; }
    else { keySource = 'chromatic'; }
  }

  const preset = PITCH_PRESETS.find((p) => p.id === PRESET_FOR[style]) ?? PITCH_PRESETS[0];
  const range = rangeForTake(takes[0].pcm);
  const voiced: EffectInstance['params'] = {
    retuneMs: preset.retuneMs,
    humanize: preset.humanize,
    flexCents: preset.flexCents,
    preserveVibrato: preset.preserveVibrato ? 1 : 0,
    quality: preset.mode === 'quality' ? 1 : 0,
    range,
    useProject: keySource === 'chromatic' ? 0 : 1,
    scaleName: keySource === 'chromatic' ? 'chromatic' : String(scale),
    keyName: String(key),
  };
  const chain = track.effectChain || [];
  const existing = chain.find((e) => e.type === 'pitchCorrect');
  let fx: EffectInstance;
  let nextChain: EffectInstance[];
  if (existing) {
    fx = { ...existing, enabled: true, wet: 1, params: { ...existing.params, ...voiced } };
    nextChain = chain.map((e) => (e.id === existing.id ? fx : e));
  } else {
    fx = effect('pitchCorrect', 'Pitch Correct', { ...pitchCorrectParams(), ...voiced }, 1);
    nextChain = [fx, ...chain];
  }
  const next: DAWProject = {
    ...project,
    ...(keySource === 'detected' ? { key, scale } : {}),
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, effectChain: nextChain } : t)),
  };
  return { ok: true, project: next, fxId: fx.id, key, scale, keySource, reused: !!existing, range: PITCH_RANGES[range].name };
}

export interface PitchReport {
  /** Sung notes the analysis found (a single voice is required). */
  notes: number;
  /** Mean distance from the nearest in-key note, in cents. */
  meanCents: number;
  /** Furthest note, in cents. */
  worstCents: number;
  singleVoice: boolean;
}

/** How far a take sits from the key, per sung note. Null when nothing voiced was found. */
export function pitchReport(pcm: PcmAudio, mask: number): PitchReport | null {
  const analysis = analyzePitch(mono(pcm), pcm.sampleRate);
  if (!analysis.singleVoice || !analysis.notes.length) {
    return analysis.frames.length ? { notes: 0, meanCents: 0, worstCents: 0, singleVoice: false } : null;
  }
  let sum = 0;
  let worst = 0;
  for (const n of analysis.notes) {
    const midi = 69 + 12 * Math.log2(n.hz / 440);
    const off = Math.abs(midi - snapMidi(midi, mask)) * 100;
    sum += off;
    worst = Math.max(worst, off);
  }
  return { notes: analysis.notes.length, meanCents: sum / analysis.notes.length, worstCents: worst, singleVoice: true };
}

/** Render one track's takes through its tuning exactly as the export does, and report the result. */
export async function tunedReport(
  project: DAWProject,
  trackId: string,
  audio: Map<string, PcmAudio>,
  opts: { signal?: AbortSignal } = {},
): Promise<{ before: PitchReport | null; after: PitchReport | null } | null> {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const take = trackTakes(track, audio)[0];
  if (!take) return null;
  const solo: DAWProject = {
    ...project,
    tracks: [{ ...track, clips: track.clips.filter((c) => c.id === take.clipId) }],
  };
  const prepared = await preparePitchExportAsync(solo, new Map([[take.bufferId, take.pcm]]), { signal: opts.signal });
  const renderedId = prepared.project.tracks[0].clips[0]?.audioBufferId;
  const rendered = renderedId ? prepared.audio.get(renderedId) : undefined;
  const fx = track.effectChain.find((e) => e.type === 'pitchCorrect' && e.enabled !== false);
  const useProject = Number(fx?.params.useProject ?? 1) !== 0;
  const mask = useProject
    ? scaleMaskFor(project.key, project.scale, project.scaleMask).mask
    : scaleMaskFor(String(fx?.params.keyName ?? 'C'), String(fx?.params.scaleName ?? 'chromatic')).mask;
  return {
    before: pitchReport(take.pcm, mask),
    after: rendered && rendered !== take.pcm ? pitchReport(rendered, mask) : null,
  };
}
