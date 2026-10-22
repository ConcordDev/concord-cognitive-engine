import { describe, it, expect } from 'vitest';
import { collectEvents, LookaheadScheduler, nextBarBeat, type CollectSource, type TimelineEvent } from '@/lib/daw/scheduler';
import { createTrack, createMidiClip, createAudioClip, note } from '@/lib/daw/project';

function src(over: Partial<CollectSource> = {}): CollectSource {
  const t = createTrack('instrument', 0);
  const clip = createMidiClip(t, 4, 4, [note(60, 0, 1), note(64, 1, 1), note(67, 3.5, 2)]);
  const a = createTrack('audio', 1);
  const ac = createAudioClip(a, 8, 8, 'buf1', 'Take');
  return { tracks: [{ ...t, clips: [clip] }, { ...a, clips: [ac] }], beatsPerBar: 4, bpm: 120, metronome: false, mode: 'arrange', ...over };
}

describe('collectEvents', () => {
  it('returns notes in [from, to) at absolute beats, trimmed to the clip end', () => {
    const ev = collectEvents(0, 8, src()).filter((e) => e.kind === 'note');
    expect(ev.map((e) => e.beat)).toEqual([4, 5, 7.5]);
    const last = ev[2] as Extract<TimelineEvent, { kind: 'note' }>;
    expect(last.lengthBeats).toBeCloseTo(0.5); // clip ends at 8
  });

  it('windows are half-open and never duplicate events across boundaries', () => {
    const s = src();
    const all: number[] = [];
    for (let b = 0; b < 16; b += 0.37) all.push(...collectEvents(b, b + 0.37, s).filter((e) => e.kind === 'note').map((e) => e.beat));
    expect(all).toEqual([4, 5, 7.5]);
  });

  it('schedules audio clips at their start and catches up mid-clip with an offset', () => {
    const s = src();
    expect(collectEvents(8, 9, s).filter((e) => e.kind === 'audio')).toHaveLength(1);
    expect(collectEvents(10, 11, s).filter((e) => e.kind === 'audio')).toHaveLength(0);
    const caught = collectEvents(10, 11, s, { catchUp: true }).find((e) => e.kind === 'audio') as Extract<TimelineEvent, { kind: 'audio' }>;
    expect(caught.offsetSec).toBeCloseTo(1); // 2 beats @120bpm
    expect(caught.lengthBeats).toBeCloseTo(6);
  });

  it('respects mute and solo', () => {
    const s = src();
    s.tracks[1] = { ...s.tracks[1], solo: true };
    expect(collectEvents(0, 16, s).some((e) => e.kind === 'note')).toBe(false);
    s.tracks[1] = { ...s.tracks[1], solo: false, mute: true };
    expect(collectEvents(0, 16, s).some((e) => e.kind === 'audio')).toBe(false);
  });

  it('count-in clicks on negative beats even with the metronome off; accent on the bar', () => {
    const clicks = collectEvents(-4, 0, src()).filter((e) => e.kind === 'click') as Array<Extract<TimelineEvent, { kind: 'click' }>>;
    expect(clicks.map((c) => c.beat)).toEqual([-4, -3, -2, -1]);
    expect(clicks[0].accent).toBe(true);
    expect(collectEvents(0, 4, src()).some((e) => e.kind === 'click')).toBe(false);
    expect(collectEvents(0, 4, src({ metronome: true })).filter((e) => e.kind === 'click')).toHaveLength(4);
  });

  it('loops looped clips and session-launched clips', () => {
    const s = src();
    const t = s.tracks[0];
    s.tracks[0] = { ...t, clips: [{ ...t.clips[0], startBeat: 0, lengthBeats: 8, looped: true, loopLength: 4 }] };
    expect(collectEvents(0, 8, s).filter((e) => e.kind === 'note').map((e) => e.beat)).toEqual([0, 1, 3.5, 4, 5, 7.5]);
    const sess = src({ mode: 'session', launched: { [s.tracks[0].id]: { clipId: s.tracks[0].clips[0].id, launchBeat: 16 } } });
    sess.tracks[0] = s.tracks[0];
    expect(collectEvents(16, 26, sess).filter((e) => e.kind === 'note').map((e) => e.beat)).toEqual([16, 17, 19.5, 24, 25]);
  });

  it('nextBarBeat quantizes launches', () => {
    expect(nextBarBeat(0, 4)).toBe(0);
    expect(nextBarBeat(0.1, 4)).toBe(4);
    expect(nextBarBeat(7.99, 4)).toBe(8);
  });
});

describe('LookaheadScheduler', () => {
  function harness(source: CollectSource, loop?: { enabled: boolean; start: number; end: number }) {
    let now = 0;
    let fn: (() => void) | null = null;
    const got: Array<{ ev: TimelineEvent; time: number }> = [];
    const s = new LookaheadScheduler({
      getSource: () => source,
      onEvent: (ev, time) => got.push({ ev, time }),
      clock: { now: () => now, setInterval: (f) => { fn = f; return 1; }, clearInterval: () => { fn = null; } },
      lookaheadSec: 0.1,
      loop: loop ? () => loop : undefined,
    });
    return { s, got, advance(sec: number, step = 0.025) { for (let t = 0; t < sec; t += step) { now += step; fn?.(); } }, get now() { return now; } };
  }

  it('stamps events on the audio clock regardless of timer jitter', () => {
    const h = harness(src());
    h.s.start(0, 1); // beat 0 at t=1s
    h.advance(6, 0.037);
    const notes = h.got.filter((g) => g.ev.kind === 'note');
    expect(notes.map((n) => +n.time.toFixed(6))).toEqual([3, 3.5, 4.75]); // beats 4,5,7.5 @ 0.5 s/beat
    expect(h.s.beatAt(3)).toBeCloseTo(4);
  });

  it('wraps at the loop end without dropping or doubling events', () => {
    const h = harness(src(), { enabled: true, start: 4, end: 8 });
    h.s.start(4, 0);
    h.advance(5);
    const beats = h.got.filter((g) => g.ev.kind === 'note').map((g) => g.ev.beat);
    expect(beats.slice(0, 6)).toEqual([4, 5, 7.5, 4, 5, 7.5]);
    expect(h.s.beatAt(2.25)).toBeCloseTo(4.5); // second pass
  });
});
