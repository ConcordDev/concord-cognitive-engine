// The Booth's pure logic: VU and tuner needles, MIDI learn, saved chains,
// groove feel, rooms and the world-score stem size. Expected values are
// worked by hand in the comments.
import { describe, it, expect } from 'vitest';
import { dbfsToVu, vuAngle, vuStep, tunerAngle, VU_TAU_SEC } from '@/components/studio/booth/vu';
import { parseCc, parseTarget, valueFor, targetLabel, trackTarget, defaultRange, MASTER_TARGET } from '@/components/studio/booth/midiLearn';
import { chainToUnits, unitsToChain } from '@/components/studio/booth/chains';
import { swingFromGroove, grooveForSwing } from '@/components/studio/booth/grooves';
import { roomFromKey, parseRoom, ROOMS } from '@/components/studio/booth/rooms';
import { meterZone } from '@/components/studio/booth/tokens';
import { wavBytes, songManifest } from '@/components/studio/booth/ScoreWorld';
import { createProject, createTrack, effect } from '@/lib/daw/project';

describe('VU meter', () => {
  it('aligns 0 VU to −18 dBFS and clamps to the −20…+3 face', () => {
    expect(dbfsToVu(-18)).toBe(0);
    expect(dbfsToVu(-24)).toBe(-6);
    expect(dbfsToVu(-120)).toBe(-20);
    expect(dbfsToVu(0)).toBe(3);
    expect(dbfsToVu(NaN)).toBe(-20);
  });

  it('pins −20 VU left and +3 VU right, and puts 0 VU where the voltage scale says', () => {
    expect(vuAngle(-20)).toBeCloseTo(-48, 6);
    expect(vuAngle(3)).toBeCloseTo(48, 6);
    // p = (1 − 0.1) / (1.41254 − 0.1) = 0.68569 → −48 + 0.68569·96 = 17.83°
    expect(vuAngle(0)).toBeCloseTo(17.83, 2);
    // Monotonic.
    expect(vuAngle(-7)).toBeLessThan(vuAngle(-3));
  });

  it('reaches 99% of a step in 300 ms (the VU standard) and never overshoots', () => {
    expect(VU_TAU_SEC).toBeCloseTo(0.0651, 4);
    let v = -20;
    for (let t = 0; t < 300; t += 10) v = vuStep(v, 0, 0.01);
    expect(v).toBeGreaterThan(-0.2 - 1e-9);
    expect(v).toBeLessThanOrEqual(0);
    expect(vuStep(-20, 0, 0)).toBe(-20);
    expect(vuStep(-20, 0, NaN)).toBe(-20);
  });

  it('tuner: ±50 cents is ±45°, clamped beyond', () => {
    expect(tunerAngle(0)).toBe(0);
    expect(tunerAngle(25)).toBe(22.5);
    expect(tunerAngle(-80)).toBe(-45);
    expect(tunerAngle(NaN)).toBe(0);
  });

  it('meter zones: green, yellow from −6, red from the clip point', () => {
    expect(meterZone(-12)).toBe('ok');
    expect(meterZone(-6)).toBe('hot');
    expect(meterZone(-0.5)).toBe('clip');
    expect(meterZone(-3, -12, -3)).toBe('clip');
  });
});

describe('MIDI learn', () => {
  it('reads Control Change on every channel and ignores everything else', () => {
    expect(parseCc([0xb0, 7, 100])).toEqual({ channel: 0, controller: 7, value: 100 });
    expect(parseCc([0xbf, 74, 127])).toEqual({ channel: 15, controller: 74, value: 127 });
    expect(parseCc([0x90, 60, 100])).toBeNull(); // note on
    expect(parseCc([0xb0, 7])).toBeNull();
    expect(parseCc(null)).toBeNull();
    // Data bytes are 7-bit; a stray high bit is masked off, never read as 255.
    expect(parseCc([0xb2, 0x87, 0xff])).toEqual({ channel: 2, controller: 7, value: 127 });
  });

  it('parses only the three target shapes', () => {
    expect(parseTarget('track:trk_9:volume')).toEqual({ scope: 'track', trackId: 'trk_9', kind: 'volume' });
    expect(parseTarget('track:trk_9:pan')).toEqual({ scope: 'track', trackId: 'trk_9', kind: 'pan' });
    expect(parseTarget(MASTER_TARGET)).toEqual({ scope: 'master', trackId: null, kind: 'volume' });
    expect(parseTarget('track1.volume')).toBeNull();
    expect(parseTarget('track:../x:volume')).toBeNull();
    expect(trackTarget('a', 'pan')).toBe('track:a:pan');
  });

  it('maps 0–127 onto the stored range: fader −∞ at the bottom, +6 at the top; pan −1…+1', () => {
    const { rangeMin, rangeMax } = defaultRange('volume');
    expect(valueFor('volume', 0, rangeMin, rangeMax)).toBe(-Infinity);
    expect(valueFor('volume', 127, rangeMin, rangeMax)).toBe(6);
    // −60 + 66·(100/127) = −8.03… → −8.0
    expect(valueFor('volume', 100, rangeMin, rangeMax)).toBe(-8);
    const pan = defaultRange('pan');
    expect(valueFor('pan', 0, pan.rangeMin, pan.rangeMax)).toBe(-1);
    expect(valueFor('pan', 127, pan.rangeMin, pan.rangeMax)).toBe(1);
    // −1 + 2·(64/127) = 0.00787 → 0.01
    expect(valueFor('pan', 64, pan.rangeMin, pan.rangeMax)).toBe(0.01);
    expect(valueFor('volume', 999, rangeMin, rangeMax)).toBe(6);
  });

  it('labels a map against the open song and flags a removed track', () => {
    const p = createProject();
    const t = createTrack('audio', 0, { name: 'Lead vocal' });
    p.tracks = [t];
    expect(targetLabel(trackTarget(t.id, 'volume'), p)).toBe('Lead vocal fader');
    expect(targetLabel(trackTarget(t.id, 'pan'), p)).toBe('Lead vocal pan');
    expect(targetLabel(MASTER_TARGET, p)).toBe('Master fader');
    expect(targetLabel('track:gone:volume', p)).toBeNull();
  });
});

describe('saved chains', () => {
  it('round-trips a real chain with fresh ids, keeping bypass, wet and params', () => {
    const chain = [
      effect('pitchCorrect', 'Pitch Correct', { retuneMs: 50, scaleName: 'minor' }, 1, 'a'),
      { ...effect('deesser', 'De-esser', { frequency: 6500 }, 0.8, 'b'), enabled: false },
    ];
    const units = chainToUnits(chain);
    expect(units).toEqual([
      { type: 'pitchCorrect', name: 'Pitch Correct', bypassed: false, wet: 1, params: { retuneMs: 50, scaleName: 'minor' } },
      { type: 'deesser', name: 'De-esser', bypassed: true, wet: 0.8, params: { frequency: 6500 } },
    ]);
    const back = unitsToChain(units.map((u, i) => ({ ...u, id: `u${i}` })));
    expect(back.skipped).toBe(0);
    expect(back.chain.map((f) => [f.type, f.enabled, f.wet])).toEqual([['pitchCorrect', true, 1], ['deesser', false, 0.8]]);
    expect(back.chain.map((f) => f.id)).not.toContain('a');
    expect(new Set(back.chain.map((f) => f.id)).size).toBe(2);
  });

  it('skips a unit that is not a Studio device instead of guessing', () => {
    const r = unitsToChain([
      { id: '1', type: 'eq', bypassed: false, wet: 1, params: {} },
      { id: '2', type: 'compressor', bypassed: false, wet: 7, params: { ratio: 3 } },
    ]);
    expect(r.skipped).toBe(1);
    expect(r.chain).toHaveLength(1);
    expect(r.chain[0].wet).toBe(1);
  });
});

describe('groove feel', () => {
  it('maps template swing to transport swing (0.5 = triplet = 100)', () => {
    expect(swingFromGroove(0)).toBe(0);
    expect(swingFromGroove(0.16)).toBe(32);
    expect(swingFromGroove(0.32)).toBe(64); // MPC 58%
    expect(swingFromGroove(0.5)).toBe(100);
    expect(swingFromGroove(0.75)).toBe(100);
    expect(swingFromGroove(NaN)).toBe(0);
    const g = [{ id: 'straight', swing: 0 }, { id: 'mpc', swing: 0.32 }];
    expect(grooveForSwing(g, 64)?.id).toBe('mpc');
    expect(grooveForSwing(g, 40)).toBeNull();
  });
});

describe('rooms', () => {
  it('1 · 2 · 3 switch Write · Produce · Mix; anything else is not a room', () => {
    expect(ROOMS.map((r) => r.id)).toEqual(['write', 'produce', 'mix']);
    expect(roomFromKey('1')).toBe('write');
    expect(roomFromKey('3')).toBe('mix');
    expect(roomFromKey('4')).toBeNull();
    expect(parseRoom('mix')).toBe('mix');
    expect(parseRoom('<script>')).toBeNull();
  });
});

describe('score a world', () => {
  it('sizes the 16-bit stem the publish dialog encodes against the 20 MB cap', () => {
    // 104 s stereo 48 kHz: 44 + 104·48000·2·2 = 19,968,044 bytes (under 20,971,520)
    expect(wavBytes(104 * 48000, 2)).toBe(19_968_044);
    expect(wavBytes(110 * 48000, 2)).toBeGreaterThan(20 * 1024 * 1024);
  });

  it('describes the song structure and nothing else', () => {
    const p = createProject('Night drive', 92, 'A', 'minor');
    const t = createTrack('audio', 0, { name: 'Vox' });
    t.effectChain = [effect('pitchCorrect', 'Pitch Correct', {}, 1)];
    p.tracks = [t];
    const m = songManifest(p) as { tracks: Array<Record<string, unknown>>; bpm: number; key: string };
    expect(m.bpm).toBe(92);
    expect(m.key).toBe('A');
    expect(m.tracks).toEqual([{ name: 'Vox', type: 'audio', instrumentId: t.instrumentId, clips: 0, effects: ['pitchCorrect'] }]);
  });
});
