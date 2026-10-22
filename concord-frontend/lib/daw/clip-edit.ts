/**
 * Arrangement edits for clips. Audio assets stay immutable.
 * Split, trim, and slip change timing. Stretch renders a derived buffer elsewhere.
 */

import type { DAWClip, DAWProject } from './types';
import { newId } from './project';
import { clipNeedsPlayback, clipPlaybackId, renderChannel, transientSamples, type ClipPlayback } from './dsp/stretch';

interface PcmAudio {
  channels: Float32Array[];
  sampleRate: number;
}

function playbackOf(clip: DAWClip): ClipPlayback {
  return {
    reverse: !!clip.reversed,
    semitones: clip.pitch || 0,
    stretch: clip.timeStretch > 0 ? clip.timeStretch : 1,
    regions: clip.regionEdits,
  };
}

/**
 * Derived buffers for reverse, pitch, stretch, and region edits.
 * `prior` is the Pitch Editor override map. This does not mutate `audio`.
 */
export function bakeClipPlayback(project: DAWProject, audio: Map<string, PcmAudio>, prior: Record<string, string> = {}): { produced: Map<string, PcmAudio>; overrides: Record<string, string> } {
  const produced = new Map<string, PcmAudio>();
  const overrides: Record<string, string> = { ...prior };
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'audio' || !clip.audioBufferId) continue;
      const spec = playbackOf(clip);
      const sourceId = prior[clip.id] || clip.audioBufferId;
      if (!clipNeedsPlayback(spec)) continue;
      const src = audio.get(sourceId);
      if (!src?.channels?.length) continue;
      const id = clipPlaybackId(sourceId, spec);
      overrides[clip.id] = id;
      if (audio.has(id) || produced.has(id)) continue;
      produced.set(id, {
        sampleRate: src.sampleRate,
        channels: src.channels.map((ch) => renderChannel(ch, src.sampleRate, spec)),
      });
    }
  }
  return { produced, overrides };
}

function mapClip(p: DAWProject, clipId: string, fn: (c: DAWClip) => DAWClip): DAWProject {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) } : t)),
  };
}

function find(p: DAWProject, clipId: string): { trackId: string; clip: DAWClip } | null {
  for (const t of p.tracks) {
    const clip = t.clips.find((c) => c.id === clipId);
    if (clip) return { trackId: t.id, clip };
  }
  return null;
}

export function splitClip(p: DAWProject, clipId: string, beat: number, secPerBeat: number): DAWProject {
  const found = find(p, clipId);
  if (!found) return p;
  const c = found.clip;
  const at = beat - c.startBeat;
  if (at <= 0.05 || at >= c.lengthBeats - 0.05) return p;
  const right: DAWClip = {
    ...c,
    id: newId('clip'),
    name: `${c.name} 2`,
    startBeat: c.startBeat + at,
    lengthBeats: c.lengthBeats - at,
    offset: (c.offset || 0) + at * secPerBeat,
    midiNotes: c.midiNotes?.filter((n) => n.startBeat >= at).map((n) => ({ ...n, id: newId('n'), startBeat: n.startBeat - at })),
    fadeIn: 0,
  };
  const left: DAWClip = {
    ...c,
    lengthBeats: at,
    fadeOut: 0,
    midiNotes: c.midiNotes?.filter((n) => n.startBeat < at).map((n) => ({ ...n, lengthBeats: Math.min(n.lengthBeats, at - n.startBeat) })),
  };
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === found.trackId ? { ...t, clips: t.clips.flatMap((x) => (x.id === c.id ? [left, right] : [x])) } : t)),
  };
}

/** Move the left edge. Offset follows so the audio under the playhead stays put. */
export function trimClipStart(p: DAWProject, clipId: string, startBeat: number, secPerBeat: number): DAWProject {
  return mapClip(p, clipId, (c) => {
    const start = Math.max(0, Math.min(c.startBeat + c.lengthBeats - 0.25, startBeat));
    const delta = start - c.startBeat;
    return {
      ...c,
      startBeat: start,
      lengthBeats: Math.max(0.25, c.lengthBeats - delta),
      offset: Math.max(0, (c.offset || 0) + delta * secPerBeat),
    };
  });
}

export function slipClip(p: DAWProject, clipId: string, deltaSec: number): DAWProject {
  return mapClip(p, clipId, (c) => ({ ...c, offset: Math.max(0, (c.offset || 0) + deltaSec) }));
}

/** Keyboard: S splits, arrows nudge, alt+arrows slip. Returns null when the key is not a clip edit. */
export function editClipFromKey(p: DAWProject, clipId: string, key: string, alt: boolean, shift: boolean, beat: number, secPerBeat: number): DAWProject | null {
  if (key === 's' || key === 'S') return splitClip(p, clipId, beat, secPerBeat);
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const dir = key === 'ArrowRight' ? 1 : -1;
  const step = shift ? 1 : 0.25;
  return alt ? slipClip(p, clipId, dir * step * secPerBeat) : nudgeClip(p, clipId, dir * step);
}

export function nudgeClip(p: DAWProject, clipId: string, deltaBeats: number): DAWProject {
  return mapClip(p, clipId, (c) => ({ ...c, startBeat: Math.max(0, c.startBeat + deltaBeats) }));
}

/** Delete the clip and pull later arrangement clips on that track back by its length. */
export function rippleDelete(p: DAWProject, clipId: string): DAWProject {
  const found = find(p, clipId);
  if (!found) return p;
  const gap = found.clip.lengthBeats;
  const end = found.clip.startBeat + gap;
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.id !== found.trackId) return t;
      return {
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId).map((c) => (
          c.slot == null && c.startBeat >= end - 1e-6 ? { ...c, startBeat: Math.max(0, c.startBeat - gap) } : c
        )),
      };
    }),
  };
}

/** Equal-power fades across arrangement overlaps on one track. Gaps stay silent. */
export function crossfadeOverlaps(p: DAWProject, trackId: string): DAWProject {
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const audio = t.clips.filter((c) => c.type === 'audio' && c.slot == null).slice().sort((a, b) => a.startBeat - b.startBeat);
      const fade = new Map<string, { fadeIn?: number; fadeOut?: number }>();
      for (let i = 0; i < audio.length - 1; i++) {
        const a = audio[i];
        const b = audio[i + 1];
        const overlap = a.startBeat + a.lengthBeats - b.startBeat;
        if (overlap <= 0.01) continue;
        const beats = Math.min(overlap, a.lengthBeats / 2, b.lengthBeats / 2);
        fade.set(a.id, { ...(fade.get(a.id) || {}), fadeOut: beats });
        fade.set(b.id, { ...(fade.get(b.id) || {}), fadeIn: beats });
      }
      if (!fade.size) return t;
      return {
        ...t,
        clips: t.clips.map((c) => {
          const n = fade.get(c.id);
          return n ? { ...c, ...n, fadeShape: 'equalPower' as const } : c;
        }),
      };
    }),
  };
}

export function followTempoStretch(bufferSec: number, lengthBeats: number, bpm: number): number {
  if (!(bufferSec > 0) || !(lengthBeats > 0) || !(bpm > 0)) return 1;
  const clipSec = lengthBeats * 60 / bpm;
  return Math.max(0.25, Math.min(4, clipSec / bufferSec));
}

/** Replace one audio clip with transient slices quantised to `gridBeats`. */
export function sliceClipToGrid(p: DAWProject, clipId: string, channel: Float32Array, sampleRate: number, bpm: number, gridBeats: number): DAWProject {
  const found = find(p, clipId);
  if (!found || found.clip.type !== 'audio') return p;
  const hits = transientSamples(channel, sampleRate);
  if (hits.length < 2) return p;
  const grid = Math.max(0.25, gridBeats);
  const spb = 60 / bpm;
  const slices: DAWClip[] = [];
  const points = [...hits, channel.length];
  for (let i = 0; i < hits.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b - a < sampleRate * 0.03) continue;
    const offsetSec = (found.clip.offset || 0) + a / sampleRate;
    const srcBeats = ((b - a) / sampleRate) / spb;
    const start = Math.round((found.clip.startBeat + (a / sampleRate) / spb) / grid) * grid;
    const lengthBeats = Math.max(grid, Math.round(srcBeats / grid) * grid);
    slices.push({
      ...found.clip,
      id: i === 0 ? found.clip.id : newId('clip'),
      name: i === 0 ? found.clip.name : `${found.clip.name} ${i + 1}`,
      startBeat: start,
      lengthBeats,
      offset: offsetSec,
      timeStretch: Math.max(0.25, Math.min(4, lengthBeats / Math.max(0.05, srcBeats))),
      regionEdits: undefined,
      pitchEdits: i === 0 ? found.clip.pitchEdits : undefined,
    });
  }
  if (slices.length < 2) return p;
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === found.trackId
      ? { ...t, clips: [...t.clips.filter((c) => c.id !== clipId), ...slices] }
      : t)),
  };
}
