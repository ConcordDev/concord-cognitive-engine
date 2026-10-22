import { describe, it, expect } from 'vitest';
import { createProject, createTrack, note } from '@/lib/daw/project';
import * as ops from '@/components/studio/daw/ops';
import { collectEvents } from '@/lib/daw/scheduler';

function base() {
  const p = createProject('T', 120);
  const a = createTrack('audio', 0, { name: 'Vox' });
  const m = createTrack('instrument', 1, { name: 'Keys' });
  return { p: { ...p, tracks: [...p.tracks, a, m] }, a, m };
}

describe('studio editor ops', () => {
  it('adds tracks of every kind', () => {
    let { p } = base();
    for (const k of ['audio', 'instrument', 'drums'] as const) p = ops.addTrack(p, k).project;
    expect(p.tracks.filter((t) => t.type !== 'master').length).toBe(5);
  });

  it('creates MIDI clips only on MIDI tracks, with optional session slot', () => {
    const { p, a, m } = base();
    expect(ops.addMidiClip(p, a.id, 0).clip).toBeNull();
    const r = ops.addMidiClip(p, m.id, 4, 4, 2);
    expect(r.clip?.slot).toBe(2);
    expect(r.project.tracks.find((t) => t.id === m.id)!.clips).toHaveLength(1);
  });

  it('slot clips do not play in the arrangement', () => {
    const { p, m } = base();
    const r = ops.addMidiClip(p, m.id, 0, 4, 0);
    const q = ops.setNotes(r.project, r.clip!.id, [note(60, 0, 1)]);
    const evs = collectEvents(0, 4, { tracks: q.tracks, beatsPerBar: 4, bpm: 120, metronome: false, mode: 'arrange', launched: {} });
    expect(evs.filter((e) => e.kind === 'note')).toHaveLength(0);
  });

  it('moves clips between compatible tracks only and resizes with a floor', () => {
    const { p, a, m } = base();
    const r = ops.addMidiClip(p, m.id, 0);
    const moved = ops.moveClip(r.project, r.clip!.id, a.id, 8);
    const found = ops.findClip(moved, r.clip!.id)!;
    expect(found.track.id).toBe(m.id); // MIDI can't land on audio
    expect(found.clip.startBeat).toBe(8);
    const small = ops.resizeClip(moved, r.clip!.id, 0.01);
    expect(ops.findClip(small, r.clip!.id)!.clip.lengthBeats).toBe(0.25);
  });

  it('duplicates and deletes clips', () => {
    const { p, m } = base();
    const r = ops.addMidiClip(p, m.id, 0, 4);
    const d = ops.duplicateClip(r.project, r.clip!.id);
    expect(d.clip!.startBeat).toBe(4);
    const del = ops.deleteClip(d.project, r.clip!.id);
    expect(ops.findClip(del, r.clip!.id)).toBeNull();
    expect(ops.findClip(del, d.clip!.id)).not.toBeNull();
  });

  it('removing a track clears ducking that pointed at it', () => {
    const { p, a, m } = base();
    const q = ops.mapTrack(p, a.id, (t) => ({ ...t, duck: { sourceTrackId: m.id, depthDb: 6, releaseMs: 100 } }));
    const r = ops.removeTrack(q, m.id);
    expect(r.tracks.find((t) => t.id === a.id)!.duck).toBeUndefined();
  });

  it('quantizes note starts and lengths', () => {
    const q = ops.quantizeNotes([note(60, 0.13, 0.4), note(62, 0.9, 0.1)], 0.25, true);
    expect(q.map((n) => n.startBeat)).toEqual([0.25, 1]);
    expect(q.map((n) => n.lengthBeats)).toEqual([0.5, 0.25]);
  });
});
