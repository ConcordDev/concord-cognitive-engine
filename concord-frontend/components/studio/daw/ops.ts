/** Pure project edits used by the Studio editor (each returns a new project). */

import type { DAWProject, DAWTrack, DAWClip, MIDINote, EffectInstance } from '@/lib/daw/types';
import { createTrack, createMidiClip, createAudioClip, newId, type NewTrackKind } from '@/lib/daw/project';

export const mapTrack = (p: DAWProject, id: string, fn: (t: DAWTrack) => DAWTrack): DAWProject => ({
  ...p,
  tracks: p.tracks.map((t) => (t.id === id ? fn(t) : t)),
});

export const mapClip = (p: DAWProject, clipId: string, fn: (c: DAWClip) => DAWClip): DAWProject => ({
  ...p,
  tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) } : t)),
});

export function findClip(p: DAWProject, clipId: string | null): { track: DAWTrack; clip: DAWClip } | null {
  if (!clipId) return null;
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function addTrack(p: DAWProject, kind: NewTrackKind, instrumentId?: string): { project: DAWProject; track: DAWTrack } {
  const track = createTrack(kind, p.tracks.length, { instrumentId });
  return { project: { ...p, tracks: [...p.tracks, track] }, track };
}

export function removeTrack(p: DAWProject, id: string): DAWProject {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== id).map((t) => (t.duck?.sourceTrackId === id ? { ...t, duck: undefined } : t)) };
}

export function duplicateTrack(p: DAWProject, id: string): DAWProject {
  const i = p.tracks.findIndex((t) => t.id === id);
  if (i < 0) return p;
  const src = p.tracks[i];
  const tid = newId('trk');
  const takeIds = new Map<string, string>();
  const takes = (src.takes || []).map((t) => {
    const id = newId('take');
    takeIds.set(t.id, id);
    return { ...t, id };
  });
  const comp = (src.comp || []).flatMap((r) => {
    const takeId = takeIds.get(r.takeId);
    return takeId ? [{ ...r, takeId }] : [];
  });
  const copy: DAWTrack = {
    ...src,
    id: tid,
    name: `${src.name} copy`,
    armed: false,
    clips: src.clips.map((c) => ({ ...c, id: newId('clip'), trackId: tid, midiNotes: c.midiNotes?.map((n) => ({ ...n, id: newId('n') })) })),
    effectChain: src.effectChain.map((e) => ({ ...e, id: e.id.startsWith('am-') ? e.id : newId('fx') })),
    takes,
    comp,
  };
  const tracks = [...p.tracks];
  tracks.splice(i + 1, 0, copy);
  return { ...p, tracks };
}

export function addMidiClip(p: DAWProject, trackId: string, startBeat: number, lengthBeats = 4, slot?: number): { project: DAWProject; clip: DAWClip | null } {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t || t.type === 'audio') return { project: p, clip: null };
  const clip = createMidiClip(t, Math.max(0, startBeat), lengthBeats);
  if (slot !== undefined) clip.slot = slot;
  return { project: mapTrack(p, trackId, (x) => ({ ...x, clips: [...x.clips, clip] })), clip };
}

export function addAudioClip(p: DAWProject, trackId: string, startBeat: number, lengthBeats: number, bufferId: string, name: string, slot?: number): { project: DAWProject; clip: DAWClip | null } {
  const t = p.tracks.find((x) => x.id === trackId);
  if (!t) return { project: p, clip: null };
  const clip = createAudioClip(t, Math.max(0, startBeat), lengthBeats, bufferId, name);
  if (slot !== undefined) clip.slot = slot;
  return { project: mapTrack(p, trackId, (x) => ({ ...x, clips: [...x.clips, clip] })), clip };
}

export function moveClip(p: DAWProject, clipId: string, toTrackId: string, startBeat: number): DAWProject {
  const found = findClip(p, clipId);
  if (!found) return p;
  const target = p.tracks.find((t) => t.id === toTrackId);
  const compatible = target && (target.type === 'audio') === (found.clip.type === 'audio');
  const destId = compatible ? toTrackId : found.track.id;
  const moved = { ...found.clip, trackId: destId, startBeat: Math.max(0, startBeat) };
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      let clips = t.clips.filter((c) => c.id !== clipId);
      if (t.id === destId) clips = [...clips, moved];
      return clips === t.clips ? t : { ...t, clips };
    }),
  };
}

export function resizeClip(p: DAWProject, clipId: string, lengthBeats: number): DAWProject {
  return mapClip(p, clipId, (c) => ({ ...c, lengthBeats: Math.max(0.25, lengthBeats), loopLength: c.looped ? c.loopLength : Math.max(0.25, lengthBeats) }));
}

export function deleteClip(p: DAWProject, clipId: string): DAWProject {
  return { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t)) };
}

export function duplicateClip(p: DAWProject, clipId: string): { project: DAWProject; clip: DAWClip | null } {
  const found = findClip(p, clipId);
  if (!found) return { project: p, clip: null };
  const c = found.clip;
  const copy: DAWClip = { ...c, id: newId('clip'), startBeat: c.startBeat + c.lengthBeats, midiNotes: c.midiNotes?.map((n) => ({ ...n, id: newId('n') })), slot: c.slot !== undefined ? c.slot + 1 : undefined };
  return { project: mapTrack(p, found.track.id, (t) => ({ ...t, clips: [...t.clips, copy] })), clip: copy };
}

export function setNotes(p: DAWProject, clipId: string, notes: MIDINote[]): DAWProject {
  return mapClip(p, clipId, (c) => ({ ...c, midiNotes: notes }));
}

export function setEffects(p: DAWProject, trackId: string, effects: EffectInstance[]): DAWProject {
  return mapTrack(p, trackId, (t) => ({ ...t, effectChain: effects }));
}

/** Quantize note starts (and optionally lengths) to `grid` beats. */
export function quantizeNotes(notes: MIDINote[], grid: number, lengths = false): MIDINote[] {
  return notes.map((n) => ({
    ...n,
    startBeat: Math.max(0, Math.round(n.startBeat / grid) * grid),
    lengthBeats: lengths ? Math.max(grid, Math.round(n.lengthBeats / grid) * grid) : n.lengthBeats,
  }));
}
