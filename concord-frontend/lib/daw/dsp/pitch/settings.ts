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
  processPitchSignal,
  removeLatency,
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

export function settingsFromEffect(fx: EffectInstance, project: { key: string; scale: string }, sampleRate: number): PitchSettings {
  const range = PITCH_RANGES[Math.max(0, Math.min(PITCH_RANGES.length - 1, Math.round(num(fx.params.range, 1))))];
  const useProject = num(fx.params.useProject, 1) !== 0;
  const key = useProject ? project.key : String(fx.params.keyName ?? 'C');
  const scale = useProject ? project.scale : String(fx.params.scaleName ?? 'chromatic');
  const scaled = scaleMaskFor(key, scale);
  return {
    sampleRate,
    retuneMs: Math.max(0, Math.min(400, num(fx.params.retuneMs, 0))),
    humanize: Math.max(0, Math.min(100, num(fx.params.humanize, 0))),
    flexCents: Math.max(0, Math.min(200, num(fx.params.flexCents, 200))),
    preserveVibrato: num(fx.params.preserveVibrato, 0) !== 0,
    transpose: Math.max(-12, Math.min(12, Math.round(num(fx.params.transpose, 0)))),
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
export function preparePitchExport(project: DAWProject, audio: Map<string, PcmAudio>): { project: DAWProject; audio: Map<string, PcmAudio> } {
  const has = project.tracks.some((t) => (t.effectChain || []).some((e) => e.type === 'pitchCorrect' && e.enabled !== false));
  if (!has) return { project, audio };
  const nextAudio = new Map(audio);
  const tracks = project.tracks.map((track) => {
    const chain = track.effectChain || [];
    const fxs = chain.filter((e) => e.type === 'pitchCorrect' && e.enabled !== false);
    if (!fxs.length) return track;
    const applied = new Set(fxs.map((e) => e.id));
    const clips = track.clips.map((clip) => {
      if (!clip.audioBufferId) return clip;
      const src = audio.get(clip.audioBufferId);
      if (!src?.channels?.length) return clip;
      let channels = src.channels;
      const rate = src.sampleRate;
      for (const fx of fxs) {
        const settings = settingsFromEffect(fx, project, rate);
        channels = channels.map((ch) => {
          const { output, latency } = processPitchSignal(ch, settings);
          return removeLatency(output, latency);
        });
      }
      const id = `${clip.audioBufferId}__pitch_${clip.id}`;
      nextAudio.set(id, { channels, sampleRate: rate });
      return { ...clip, audioBufferId: id };
    });
    // Every enabled Pitch Correct is baked into the clip and removed so the
    // offline graph does not run it again. Disabled devices stay on the chain
    // and the graph skips them. Instrument notes are not rewritten here.
    return { ...track, clips, effectChain: chain.filter((e) => !applied.has(e.id)) };
  });
  return { project: { ...project, tracks }, audio: nextAudio };
}
