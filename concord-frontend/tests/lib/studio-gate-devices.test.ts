import { describe, it, expect } from 'vitest';
import { gateCurve, gateGainFor, cutoffForTime, createDevice, GATE_CURVE_SIZE } from '@/lib/daw/dsp/devices';
import { DEVICE_SPECS, newDevice, isSupportedDevice } from '@/components/studio/daw/DevicePanel';
import type { EffectType } from '@/lib/daw/types';

// Minimal recording stand-in for a BaseAudioContext: enough to build device graphs
// and inspect how they are wired.
type FakeNode = { kind: string; outs: unknown[]; connect: (t: unknown) => unknown; disconnect: () => void; [k: string]: unknown };
function param(v = 0) { return { value: v, kind: 'param', setValueAtTime() {}, linearRampToValueAtTime() {} }; }
function fakeCtx() {
  const nodes: FakeNode[] = [];
  const mk = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
    const n: FakeNode = { kind, outs: [], connect(t: unknown) { n.outs.push(t); return t; }, disconnect() {}, ...extra };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 48000,
    createGain: () => mk('gain', { gain: param(1) }),
    createBiquadFilter: () => mk('biquad', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
    createWaveShaper: () => mk('shaper', { curve: null, oversample: 'none' }),
    createDelay: () => mk('delay', { delayTime: param(0) }),
    createDynamicsCompressor: () => mk('comp', { threshold: param(), ratio: param(), attack: param(), release: param(), knee: param() }),
    createConvolver: () => mk('conv', { buffer: null, normalize: true }),
    createOscillator: () => mk('osc', { frequency: param(440), start() {}, stop() {} }),
    createChannelSplitter: () => mk('split'),
    createChannelMerger: () => mk('merge'),
    createBuffer: (ch: number, len: number) => ({ getChannelData: () => new Float32Array(len), numberOfChannels: ch }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, nodes };
}

describe('noise gate (real, not a passthrough)', () => {
  it('curve opens at the threshold and closes to the range below the knee', () => {
    const c = gateCurve(-40, -60);
    expect(c.length).toBe(GATE_CURVE_SIZE);
    expect(gateGainFor(-20, -40, -60)).toBe(1);
    expect(gateGainFor(-40, -40, -60)).toBeCloseTo(1, 2);
    expect(gateGainFor(-60, -40, -60)).toBeCloseTo(0.001, 4);
    const mid = gateGainFor(-43, -40, -60);
    expect(mid).toBeGreaterThan(0.001);
    expect(mid).toBeLessThan(1);
  });

  it('is monotonic in input level', () => {
    let prev = -1;
    for (let db = -90; db <= 0; db += 1) {
      const g = gateGainFor(db, -35, -80);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('release sets the envelope time constant', () => {
    expect(cutoffForTime(0.1)).toBeCloseTo(1.5915, 3);
    expect(cutoffForTime(0.01)).toBeGreaterThan(cutoffForTime(0.5));
  });

  it('drives a VCA gain param from the signal envelope', () => {
    const { ctx, nodes } = fakeCtx();
    const dev = createDevice(ctx, newDevice('gate'));
    expect(dev).not.toBeNull();
    const vca = nodes.find((n) => n.kind === 'gain' && (n.gain as { value: number }).value === 0)!;
    expect(vca).toBeTruthy();
    // Something feeds the VCA's gain AudioParam (the control path).
    expect(nodes.some((n) => n.outs.includes(vca.gain))).toBe(true);
    const shaper = nodes.find((n) => n.kind === 'shaper' && (n.curve as Float32Array)?.length === GATE_CURVE_SIZE);
    expect(shaper).toBeTruthy();
  });
});

describe('device menu only offers devices the engine processes', () => {
  it('every Add-device entry builds a real node graph', () => {
    for (const spec of DEVICE_SPECS) {
      const { ctx } = fakeCtx();
      expect(createDevice(ctx, newDevice(spec.type)), spec.type).not.toBeNull();
      expect(isSupportedDevice(spec.type)).toBe(true);
    }
    expect(DEVICE_SPECS.some((s) => s.type === 'gate')).toBe(true);
  });

  it('device types the engine skips are flagged unsupported (no fake controls)', () => {
    for (const t of ['deesser', 'phaser', 'bitcrusher', 'tremolo', 'pitchShift'] as EffectType[]) {
      const { ctx } = fakeCtx();
      expect(createDevice(ctx, { id: 'x', type: t, name: t, enabled: true, wet: 1, params: {} })).toBeNull();
      expect(isSupportedDevice(t)).toBe(false);
    }
    for (const t of ['eq8', 'parametricEQ', 'autoFilter', 'pingPongDelay', 'overdrive', 'flanger'] as EffectType[]) {
      expect(isSupportedDevice(t)).toBe(true);
    }
  });
});
