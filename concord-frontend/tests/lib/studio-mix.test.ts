import { describe, expect, it } from 'vitest';
import { audibleIds, buildRoutePlan, type RouteTrack } from '@/lib/daw/routing';
import { gainPoints, valueAtBeat } from '@/lib/daw/automation';
import { biquadMagnitude, eq8HasBands } from '@/lib/daw/dsp/eq-bands';
import { compressorGain } from '@/lib/daw/dsp/mix-devices';
import { correlation, LiveLoudness } from '@/lib/daw/dsp/live-loudness';
import { integratedLoudness } from '@/lib/daw/dsp/loudness';
import { createBus, createVca, normalizeProject } from '@/lib/daw/project';
import { dbToGain } from '@/lib/daw/dsp/rng';

const track = (id: string, extra: Partial<RouteTrack> = {}): RouteTrack => ({ id, type: 'audio', ...extra });

describe('routing', () => {
  it('falls a cycle back to master and aligns path delays', () => {
    const tracks: RouteTrack[] = [
      track('a', { effectLatency: 100, outputTarget: 'bus1' }),
      track('b', { effectLatency: 0, outputTarget: 'master' }),
      { id: 'bus1', type: 'bus', outputTarget: 'bus2', effectLatency: 40 },
      { id: 'bus2', type: 'bus', outputTarget: 'bus1', effectLatency: 10 },
    ];
    const plan = buildRoutePlan(tracks);
    expect(plan.fellBack).toContain('a');
    expect(plan.direct.a.destId).toBe('master');
    expect(plan.direct.a.delaySamples + 100).toBe(plan.direct.b.delaySamples);
    expect(plan.fellBack).toContain('bus1');
  });

  it('delays the short path so a send and a direct track arrive together', () => {
    const plan = buildRoutePlan([
      track('dry', { effectLatency: 0, outputTarget: 'master', sendLevels: { rev: -6 }, sendPre: { rev: true } }),
      track('late', { effectLatency: 200, outputTarget: 'master' }),
      { id: 'rev', type: 'bus', outputTarget: 'master', effectLatency: 50 },
    ]);
    const send = plan.sends.dry[0];
    expect(send.pre).toBe(true);
    expect(send.levelDb).toBe(-6);
    expect(send.delaySamples + 50).toBe(plan.direct.late.delaySamples + 200);
    expect(plan.direct.dry.delaySamples + 0).toBe(plan.direct.late.delaySamples + 200);
  });

  it('keeps the bus a solo track feeds and drops the other track', () => {
    const tracks: RouteTrack[] = [
      track('vocal', { solo: true, outputTarget: 'vox' }),
      track('drums', { outputTarget: 'master' }),
      { id: 'vox', type: 'bus', outputTarget: 'master' },
      { id: 'vca', type: 'bus', vca: true },
    ];
    const heard = audibleIds(tracks);
    expect(heard.has('vocal')).toBe(true);
    expect(heard.has('vox')).toBe(true);
    expect(heard.has('drums')).toBe(false);
    expect(heard.has('vca')).toBe(false);
    expect(buildRoutePlan(tracks).direct.vca).toBeUndefined();
  });
});

describe('automation and dynamics', () => {
  it('uses a linear segment when an exponential end is not strictly positive', () => {
    const points = [
      { beat: 0, value: -12, curve: 'exponential' as const },
      { beat: 4, value: 0 },
    ];
    expect(valueAtBeat(points, 2)).toBe(-6);
    const up = [
      { beat: 0, value: 2, curve: 'exponential' as const },
      { beat: 4, value: 8 },
    ];
    expect(valueAtBeat(up, 2)).toBeCloseTo(4, 6);
    expect(valueAtBeat([{ beat: 0, value: 1, curve: 'step' }, { beat: 2, value: 5 }], 1.9)).toBe(1);
    expect(valueAtBeat([{ beat: 1, value: -3 }], 0)).toBe(-3);
    const gains = gainPoints(points, 0, 4, dbToGain, 4);
    expect(gains[0].gain).toBeCloseTo(dbToGain(-12), 6);
    expect(gains[gains.length - 1].gain).toBeCloseTo(1, 5);
  });

  it('compresses only above the threshold', () => {
    expect(compressorGain(-40, -18, 4, 0)).toBe(1);
    expect(compressorGain(0, -18, 4, 0)).toBeLessThan(1);
  });
});

describe('eq, meters, project fields', () => {
  it('matches the peaking biquad gain at the center frequency', () => {
    const mag = biquadMagnitude('peak', 1000, 0.707, 6, 1000, 48000);
    expect(Math.abs(mag - Math.pow(10, 6 / 20))).toBeLessThan(1e-6);
    expect(eq8HasBands({ lowGain: 2, midGain: -1, highGain: 1 })).toBe(false);
    expect(eq8HasBands({ bands: 1 })).toBe(true);
  });

  it('reports correlation for mono, inverted, and decorrelated pairs', () => {
    const n = 256;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = Math.sin((2 * Math.PI * 4 * i) / n);
      b[i] = -a[i];
      c[i] = (i % 2 === 0 ? 1 : -1) * 0.2;
    }
    expect(correlation(a, a)).toBeGreaterThan(0.99);
    expect(correlation(a, b)).toBeLessThan(-0.99);
    expect(Math.abs(correlation(a, c))).toBeLessThan(0.2);
  });

  it('matches live block loudness to the offline integrated measurement', () => {
    const sr = 48000;
    const n = sr * 3;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const offline = integratedLoudness([ch, ch], sr);
    const live = new LiveLoudness();
    const hop = 2048;
    for (let i = 0; i < n; i += hop) live.push(ch.subarray(i, i + hop), ch.subarray(i, i + hop), sr);
    expect(Number.isFinite(offline)).toBe(true);
    expect(Math.abs(live.integratedLufs() - offline)).toBeLessThan(0.1);
  });

  it('keeps buses, sends, and VCA through normalize', () => {
    const bus = createBus(0, 'Reverb');
    const vca = createVca(1, 'Vocals');
    const raw = normalizeProject({
      title: 'Old',
      tracks: [{
        id: 't',
        type: 'audio',
        name: 'Vox',
        sendLevels: { [bus.id]: -12 },
        sendPre: { [bus.id]: true },
        vcaId: vca.id,
        outputTarget: bus.id,
      }, bus, vca],
    });
    const vox = raw.tracks.find((t) => t.id === 't')!;
    expect(vox.sendLevels[bus.id]).toBe(-12);
    expect(vox.sendPre?.[bus.id]).toBe(true);
    expect(vox.vcaId).toBe(vca.id);
    expect(raw.tracks.find((t) => t.id === vca.id)?.vca).toBe(true);
    expect(raw.tracks.find((t) => t.id === bus.id)?.type).toBe('bus');
    const legacy = normalizeProject({ title: 'Bare', tracks: [{ id: 'a', type: 'midi', name: 'Keys' }] });
    expect(legacy.tracks[0].sendLevels).toEqual({});
    expect(legacy.tracks[0].vca).toBeUndefined();
    expect(legacy.transport.automation).toBeUndefined();
  });
});
