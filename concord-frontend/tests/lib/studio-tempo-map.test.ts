import { describe, expect, it } from 'vitest';
import {
  beatFromSeconds,
  bpmAt,
  projectTempoPoints,
  renderClickTrack,
  secondsBetween,
  secondsFromBeat,
  type TempoPoint,
} from '@/lib/daw/tempo-map';
import { createHistory, pushHistory, undo } from '@/lib/daw/history';
import { createProject, normalizeProject, snapshotForSave, writeTempoPoints } from '@/lib/daw/project';

const ramp: TempoPoint[] = [
  { beat: 0, bpm: 120, curve: 'linear' },
  { beat: 4, bpm: 60, curve: 'step' },
];

describe('tempo map', () => {
  it('integrates a linear ramp and a step, and round-trips beats', () => {
    const full = 4 * Math.log(2);
    expect(secondsFromBeat(ramp, 4)).toBeCloseTo(full, 9);
    expect(secondsBetween(ramp, 0, 4)).toBeCloseTo(full, 9);
    const step: TempoPoint[] = [
      { beat: 0, bpm: 120, curve: 'step' },
      { beat: 4, bpm: 60, curve: 'step' },
    ];
    expect(secondsFromBeat(step, 4)).toBeCloseTo(2, 9);
    expect(bpmAt(step, 3.9)).toBeCloseTo(120, 6);
    expect(bpmAt(step, 4)).toBeCloseTo(60, 6);
    expect(secondsFromBeat(ramp, -4)).toBeCloseTo(-2, 9);
    for (const b of [0, 0.5, 2, 3.25, 4, 6, 10]) {
      expect(beatFromSeconds(ramp, secondsFromBeat(ramp, b))).toBeCloseTo(b, 6);
    }
    const flat: TempoPoint[] = [{ beat: 0, bpm: 120, curve: 'step' }];
    expect(secondsFromBeat(flat, 4)).toBe(2);
    expect(beatFromSeconds(flat, 3)).toBeCloseTo(6, 9);
  });

  it('places offline clicks on the ramp within 1 ms', () => {
    const sr = 48000;
    const click = renderClickTrack(ramp, { fromBeat: 0, toBeat: 8, beatsPerBar: 4, sampleRate: sr });
    const at = (beat: number) => {
      const sec = secondsFromBeat(ramp, beat);
      const sample = click.positions[click.beats.indexOf(beat)];
      expect(sample).toBeDefined();
      expect(Math.abs(sample / sr - sec)).toBeLessThanOrEqual(0.001);
    };
    at(0);
    at(2);
    at(4);
    expect(click.samples[0]).toBe(1);
    const beat2 = click.positions[click.beats.indexOf(2)];
    expect(click.samples[beat2]).toBe(0.5);
    expect(Math.abs(beat2 / sr - (-4 * Math.log(0.75)))).toBeLessThanOrEqual(0.001);
    expect(Math.abs(click.positions[click.beats.indexOf(4)] / sr - 4 * Math.log(2))).toBeLessThanOrEqual(0.001);
  });

  it('saves the map with the project and undo restores it', () => {
    const base = createProject('Tempo');
    const next = writeTempoPoints(base, [
      { beat: 0, bpm: 100, curve: 'step' },
      { beat: 8, bpm: 140, curve: 'linear' },
    ]);
    const history = pushHistory(createHistory(base), next);
    const saved = snapshotForSave(history.present);
    expect(saved.arrangement.tempo.map((p) => p.bpm)).toEqual([100, 140]);
    expect(saved.arrangement.tempo[1].beat).toBe(8);
    expect(undo(history).present.bpm).toBe(120);
    expect(undo(history).present.arrangement.tempo).toEqual([]);
    const opened = normalizeProject(saved);
    expect(projectTempoPoints(opened).map((p) => [p.beat, p.bpm])).toEqual([[0, 100], [8, 140]]);
    const clamped = normalizeProject({ ...saved, bpm: 2000, arrangement: { ...saved.arrangement, tempo: [{ bar: 0, beat: 0, bpm: 5, curve: 'exponential' }, { bar: 2, beat: 8, bpm: 5000, curve: 'logarithmic' }] } });
    expect(clamped.bpm).toBe(999);
    expect(clamped.arrangement.tempo[0].bpm).toBe(20);
    expect(clamped.arrangement.tempo[0].curve).toBe('linear');
    expect(clamped.arrangement.tempo[1].bpm).toBe(999);
  });
});
