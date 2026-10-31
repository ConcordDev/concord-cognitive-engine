/**
 * Map a saved Pitch Correct device onto the pure core, and build the
 * offline project copy. Export runs the core on each audio clip, trims the
 * processor delay, and removes the device so the offline graph does not
 * process it twice. Live playback leaves the device in the chain and starts
 * the clip early by the same delay.
 */

import type { DAWProject, EffectInstance } from '../../types';
import {
  PITCH_RANGES,
  processPitchSignalSteps,
  removeLatency,
  runSteps,
  runStepsAsync,
  scaleMaskFor,
  type PitchSettings,
} from './core';

interface PcmAudio {
  channels: Float32Array[];
  sampleRate: number;
}

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function settingsFromEffect(fx: EffectInstance, project: { key: string; scale: string; scaleMask?: number }, sampleRate: number): PitchSettings {
  const range = PITCH_RANGES[Math.max(0, Math.min(PITCH_RANGES.length - 1, Math.round(num(fx.params.range, 1))))];
  const useProject = num(fx.params.useProject, 1) !== 0;
  const key = useProject ? project.key : String(fx.params.keyName ?? 'C');
  const scale = useProject ? project.scale : String(fx.params.scaleName ?? 'chromatic');
  const scaled = scaleMaskFor(key, scale, useProject ? project.scaleMask : undefined);
  return {
    sampleRate,
    retuneMs: Math.max(0, Math.min(400, num(fx.params.retuneMs, 0))),
    humanize: Math.max(0, Math.min(100, num(fx.params.humanize, 0))),
    flexCents: Math.max(0, Math.min(200, num(fx.params.flexCents, 200))),
    preserveVibrato: num(fx.params.preserveVibrato, 0) !== 0,
    transpose: Math.max(-12, Math.min(12, Math.round(num(fx.params.transpose, 0)))),
    formantSemitones: Math.max(-12, Math.min(12, num(fx.params.formantSemitones, 0))),
    mix: Math.max(0, Math.min(1, Number.isFinite(fx.wet) ? fx.wet : 1)),
    mode: num(fx.params.quality, 0) !== 0 ? 'quality' : 'low',
    minHz: range.minHz,
    maxHz: range.maxHz,
    scaleMask: scaled.mask,
    bypass: fx.enabled === false,
  };
}

export function projectScaleKnown(project: { key: string; scale: string }): boolean {
  return scaleMaskFor(project.key, project.scale).known;
}

/** Offline copy: pitch-corrected clip buffers, device removed from the chain. */
export type PreparedPitchExport = { project: DAWProject; audio: Map<string, PcmAudio> };

function* preparePitchExportSteps(project: DAWProject, audio: Map<string, PcmAudio>): Generator<void, PreparedPitchExport, void> {
  const has = project.tracks.some((t) => (t.effectChain || []).some((e) => e.type === 'pitchCorrect' && e.enabled !== false));
  if (!has) return { project, audio };
  const nextAudio = new Map(audio);
  const tracks: typeof project.tracks = [];
  for (const track of project.tracks) {
    const chain = track.effectChain || [];
    const fxs = chain.filter((e) => e.type === 'pitchCorrect' && e.enabled !== false);
    if (!fxs.length) { tracks.push(track); continue; }
    const applied = new Set(fxs.map((e) => e.id));
    const clips: typeof track.clips = [];
    for (const clip of track.clips) {
      if (!clip.audioBufferId) { clips.push(clip); continue; }
      const src = audio.get(clip.audioBufferId);
      if (!src?.channels?.length) { clips.push(clip); continue; }
      let channels = src.channels;
      const rate = src.sampleRate;
      for (const fx of fxs) {
        const settings = settingsFromEffect(fx, project, rate);
        const next: Float32Array[] = [];
        for (const ch of channels) {
          const { output, latency } = yield* processPitchSignalSteps(ch, settings);
          next.push(removeLatency(output, latency));
        }
        channels = next;
      }
      const id = `${clip.audioBufferId}__pitch_${clip.id}`;
      nextAudio.set(id, { channels, sampleRate: rate });
      clips.push({ ...clip, audioBufferId: id });
    }
    // Every enabled Pitch Correct is baked into the clip and removed so the
    // offline graph does not run it again. Disabled devices stay on the chain
    // and the graph skips them. Instrument notes are not rewritten here.
    tracks.push({ ...track, clips, effectChain: chain.filter((e) => !applied.has(e.id)) });
  }
  return { project: { ...project, tracks }, audio: nextAudio };
}

/** Offline copy: pitch-corrected clip buffers, device removed from the chain. */
export function preparePitchExport(project: DAWProject, audio: Map<string, PcmAudio>): PreparedPitchExport {
  return runSteps(preparePitchExportSteps(project, audio));
}

/** Same result as preparePitchExport, but the DSP runs in time-boxed slices so the UI stays responsive. */
export function preparePitchExportAsync(
  project: DAWProject,
  audio: Map<string, PcmAudio>,
  opts: { signal?: AbortSignal; budgetMs?: number } = {},
): Promise<PreparedPitchExport> {
  return runStepsAsync(preparePitchExportSteps(project, audio), opts);
}
