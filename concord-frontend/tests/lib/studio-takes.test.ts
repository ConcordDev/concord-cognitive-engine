import { describe, it, expect } from 'vitest';
import { createProject, createTrack, createAudioClip, normalizeProject } from '@/lib/daw/project';
import { collectEvents } from '@/lib/daw/scheduler';
import { applyCompSwipe, clipGaps, compPlaybackSpecs, cycleCompTake, renderCompMix, sliceLoopCapture, trimPunch, COMP_XFADE_SEC } from '@/lib/daw/takes';
import { planRecording, recordingStartBeat } from '@/lib/daw/record-plan';
import { envelopeGain } from '@/lib/daw/dsp/fades';
import type { AudioTake, CompRegion } from '@/lib/daw/types';
import type { TempoPoint } from '@/lib/daw/tempo-map';

const points: TempoPoint[] = [{ beat: 0, bpm: 120, curve: 'step' }];

function take(id: string, start: number, len: number, buffer = id): AudioTake {
  return { id, audioBufferId: buffer, startBeat: start, lengthBeats: len, offsetSec: 0, name: id, createdAt: id.charCodeAt(0) };
}

function ones(n: number, value = 1): Float32Array[] {
  return [new Float32Array(n).fill(value)];
}

describe('comp swipe', () => {
  it('replaces coverage, leaves gaps, and merges adjacent regions of the same take', () => {
    let comp: CompRegion[] = [];
    comp = applyCompSwipe(comp, 'a', 0, 2);
    comp = applyCompSwipe(comp, 'a', 2, 4);
    expect(comp).toEqual([{ takeId: 'a', startBeat: 0, endBeat: 4 }]);
    comp = applyCompSwipe(comp, 'b', 1, 3);
    expect(comp).toEqual([
      { takeId: 'a', startBeat: 0, endBeat: 1 },
      { takeId: 'b', startBeat: 1, endBeat: 3 },
      { takeId: 'a', startBeat: 3, endBeat: 4 },
    ]);
    comp = applyCompSwipe(comp, 'c', 1.5, 2);
    expect(comp.map((r) => r.takeId)).toEqual(['a', 'b', 'c', 'b', 'a']);
  });

  it('cycles the take under a beat', () => {
    const takes = [take('a', 0, 4), take('b', 0, 4)];
    const comp = applyCompSwipe([], 'a', 0, 4);
    const next = cycleCompTake(comp, takes, 1, 1);
    expect(next[0].takeId).toBe('b');
    expect(cycleCompTake(next, takes, 1, -1)[0].takeId).toBe('a');
  });
});

describe('loop record slicing', () => {
  it('cuts N passes on the loop boundaries with no gaps or overlap', () => {
    const sr = 1000;
    const channels = ones(6000);
    for (let i = 0; i < 6000; i++) channels[0][i] = i;
    const slices = sliceLoopCapture(channels, sr, { startBeat: 0, loopStart: 0, loopEnd: 4, points });
    expect(slices).toHaveLength(3);
    expect(slices.every((s) => s.startBeat === 0 && s.lengthBeats === 4)).toBe(true);
    expect(slices.map((s) => s.channels[0].length)).toEqual([2000, 2000, 2000]);
    const joined = Float32Array.from(slices.flatMap((s) => Array.from(s.channels[0])));
    expect(Array.from(joined)).toEqual(Array.from(channels[0]));
  });

  it('keeps a partial first pass, then full passes', () => {
    const sr = 1000;
    const slices = sliceLoopCapture(ones(4000), sr, { startBeat: 2, loopStart: 0, loopEnd: 4, points });
    expect(slices.map((s) => [s.startBeat, s.lengthBeats])).toEqual([[2, 2], [0, 4], [0, 2]]);
    expect(slices.reduce((n, s) => n + s.channels[0].length, 0)).toBe(4000);
  });
});

describe('punch', () => {
  it('keeps only the punch span and fades the edges', () => {
    const sr = 1000;
    const channels = ones(4000);
    const out = trimPunch(channels, sr, { recordStartBeat: 0, rangeStart: 4, rangeEnd: 8, points, fadeSec: 0.008 });
    expect(out).not.toBeNull();
    expect(out!.startBeat).toBe(4);
    expect(out!.lengthBeats).toBe(4);
    expect(out!.channels[0].length).toBe(2000);
    expect(out!.channels[0][0]).toBe(0);
    expect(out!.channels[0][1000]).toBeCloseTo(1, 5);
    expect(out!.channels[0][out!.channels[0].length - 1]).toBeLessThan(0.2);
  });

  it('plans a pre-roll and a comp take', () => {
    const start = recordingStartBeat(10, { bpm: 120, timeSignature: [4, 4], swing: 0, loopEnabled: false, loopStart: 0, loopEnd: 16, metronome: false, preRoll: 0, punchEnabled: true, punchIn: 8, punchOut: 12, punchPreRollBars: 1 }, 4);
    expect(start.noLoop).toBe(true);
    expect(start.startBeat).toBe(4);
    const planned = planRecording({
      channels: ones(4000),
      sampleRate: 1000,
      startBeat: 4,
      transport: { bpm: 120, timeSignature: [4, 4], swing: 0, loopEnabled: false, loopStart: 0, loopEnd: 16, metronome: false, preRoll: 0, punchEnabled: true, punchIn: 8, punchOut: 12 },
      points,
    });
    expect(planned.pieces).toHaveLength(1);
    expect(planned.pieces[0].asTake).toBe(true);
    expect(planned.pieces[0].startBeat).toBe(8);
    expect(planned.pieces[0].lengthBeats).toBe(4);
  });
});

describe('comp playback', () => {
  it('crossfades adjacent regions and emits nothing in a gap', () => {
    const takes = [take('a', 0, 4, 'bufA'), take('b', 0, 4, 'bufB')];
    const comp = [
      { takeId: 'a', startBeat: 0, endBeat: 2 },
      { takeId: 'b', startBeat: 2, endBeat: 4 },
    ];
    const specs = compPlaybackSpecs(takes, comp, 0, 16, points, true);
    expect(specs).toHaveLength(2);
    expect(specs[0].fadeOutSec).toBe(COMP_XFADE_SEC);
    expect(specs[1].fadeInSec).toBe(COMP_XFADE_SEC);
    expect(specs[1].beat).toBeCloseTo(2 - (COMP_XFADE_SEC / 2) * 2, 5);
    expect(specs[1].fadeShape).toBe('equalPower');
    const gapped = compPlaybackSpecs(takes, [{ takeId: 'a', startBeat: 0, endBeat: 1 }, { takeId: 'b', startBeat: 3, endBeat: 4 }], 0, 16, points, false);
    expect(gapped.map((s) => s.beat)).toEqual([0, 3]);
    expect(gapped.every((s) => s.fadeInSec === 0 && s.fadeOutSec === 0)).toBe(true);
    const mid = envelopeGain(COMP_XFADE_SEC / 2, 1, COMP_XFADE_SEC, COMP_XFADE_SEC, 'equalPower');
    expect(mid * mid + mid * mid).toBeGreaterThan(0.9);
  });

  it('trims arrangement clips out of the comp and the scheduler agrees', () => {
    expect(clipGaps(0, 8, [{ takeId: 'a', startBeat: 2, endBeat: 4 }])).toEqual([{ start: 0, end: 2 }, { start: 4, end: 8 }]);
    const track = createTrack('audio', 0);
    const clip = createAudioClip(track, 0, 8, 'song', 'Song');
    const withComp = {
      ...track,
      clips: [clip],
      takes: [take('a', 2, 2, 'punch')],
      comp: [{ takeId: 'a', startBeat: 2, endBeat: 4 }],
    };
    const ev = collectEvents(0, 16, { tracks: [withComp], beatsPerBar: 4, bpm: 120, metronome: false, mode: 'arrange' }).filter((e) => e.kind === 'audio');
    const ids = ev.map((e) => (e.kind === 'audio' ? e.bufferId : ''));
    expect(ids).toEqual(['song', 'punch', 'song']);
  });

  it('flattens without deleting the source audio', () => {
    const a = ones(2000, 0.5);
    const b = ones(2000, 0.25);
    const takes = [take('a', 0, 2, 'A'), take('b', 2, 2, 'B')];
    const comp = applyCompSwipe(applyCompSwipe([], 'a', 0, 2), 'b', 2, 4);
    const mix = renderCompMix(takes, comp, new Map([['A', a], ['B', b]]), 1000, points);
    expect(mix).not.toBeNull();
    expect(mix!.channels[0].length).toBeGreaterThan(1000);
    expect(Math.abs(mix!.channels[0][100] - 0.5)).toBeLessThan(0.05);
    expect(takes).toHaveLength(2);
  });
});

describe('normalize takes', () => {
  it('opens an old project with empty takes and the same clip', () => {
    const raw = createProject('Old');
    const track = createTrack('audio', 0);
    raw.tracks = [{ ...track, clips: [createAudioClip(track, 1, 2, 'buf', 'v')] }];
    const saved = JSON.parse(JSON.stringify(raw)) as { tracks: Array<Record<string, unknown>> };
    delete saved.tracks[0].takes;
    delete saved.tracks[0].comp;
    const opened = normalizeProject(saved);
    expect(opened.tracks[0].clips[0].audioBufferId).toBe('buf');
    expect(opened.tracks[0].takes).toEqual([]);
    expect(opened.tracks[0].comp).toEqual([]);
    expect(opened.transport.loopRecord).toBe(false);
    expect(opened.transport.punchEnabled).toBe(false);
  });
});
