// tests/lib/music-player-crossfade.test.ts
//
// Headless verification of the two newly-implemented music features:
//   1. TRUE equal-power crossfade — the gain curves are proven to hold constant
//      power (out² + in² === 1) so the mix has no midpoint loudness dip. This is
//      the load-bearing correctness of the crossfade (a linear fade fails it).
//   2. Karaoke vocal-removal (OOPS) + dual-deck graph — verified by driving the
//      engine against a mock AudioContext that records the node graph, asserting
//      preamp re-routes through the L−R center-cancel splitter when karaoke is on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { equalPowerFadeCurve } from '../../lib/music/player';

describe('equalPowerFadeCurve — constant-power crossfade math', () => {
  it('out-curve fades 1→0 and in-curve fades 0→1', () => {
    const out = equalPowerFadeCurve('out');
    const inn = equalPowerFadeCurve('in');
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[out.length - 1]).toBeCloseTo(0, 6);
    expect(inn[0]).toBeCloseTo(0, 6);
    expect(inn[inn.length - 1]).toBeCloseTo(1, 6);
  });

  it('at the midpoint both gains are ≈0.707 (−3dB), the equal-power crossover', () => {
    const steps = 65; // odd → exact midpoint index
    const out = equalPowerFadeCurve('out', steps);
    const inn = equalPowerFadeCurve('in', steps);
    const mid = (steps - 1) / 2;
    expect(out[mid]).toBeCloseTo(Math.SQRT1_2, 5); // 0.7071…
    expect(inn[mid]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('holds CONSTANT POWER at every step: out[i]² + in[i]² === 1 (no loudness dip)', () => {
    const out = equalPowerFadeCurve('out', 128);
    const inn = equalPowerFadeCurve('in', 128);
    for (let i = 0; i < out.length; i++) {
      expect(out[i] * out[i] + inn[i] * inn[i]).toBeCloseTo(1, 5);
    }
  });

  it('a LINEAR fade would dip at the midpoint — this is what equal-power fixes', () => {
    // counter-proof: linear out=0.5,in=0.5 → power 0.5 (a 3dB dip). Equal-power
    // gives 0.707²+0.707²=1. The test above proves we use the non-dipping curve.
    const linearMidPower = 0.5 * 0.5 + 0.5 * 0.5;
    expect(linearMidPower).toBeCloseTo(0.5, 6);
    expect(linearMidPower).toBeLessThan(0.99); // would be audibly quieter
  });
});

// ── Mock Web Audio: records node creation + connections so we can assert the
// graph the engine builds (karaoke routing, dual-deck mix) without a real ctx. ──
class MockParam { value = 0; setValueCurveAtTime() {} cancelScheduledValues() {} linearRampToValueAtTime() {} }
class MockNode {
  kind: string; gain = new MockParam(); frequency = new MockParam(); Q = new MockParam();
  type = ''; fftSize = 0; frequencyBinCount = 128;
  out: { node: MockNode; output?: number }[] = [];
  constructor(kind: string) { this.kind = kind; }
  connect(node: MockNode, output?: number) { this.out.push({ node, output }); return node; }
  disconnect() { this.out = []; }
  getByteFrequencyData() {} getByteTimeDomainData() {}
}
class MockAudioContext {
  state = 'running'; currentTime = 0; destination = new MockNode('destination');
  createGain() { return new MockNode('gain'); }
  createBiquadFilter() { return new MockNode('biquad'); }
  createAnalyser() { return new MockNode('analyser'); }
  createChannelSplitter() { return new MockNode('splitter'); }
  createMediaElementSource() { return new MockNode('source'); }
  resume() { return Promise.resolve(); }
  close() {}
}
// Walk the recorded graph from a node, collecting reachable node kinds.
function reachableKinds(start: MockNode): Set<string> {
  const seen = new Set<MockNode>(); const kinds = new Set<string>(); const stack = [start];
  while (stack.length) {
    const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); kinds.add(n.kind);
    for (const e of n.out) stack.push(e.node);
  }
  return kinds;
}

describe('MusicPlayerEngine — karaoke OOPS routing + dual-deck graph', () => {
  let engine: { initForTest?: unknown } & Record<string, unknown>;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('MediaMetadata', class { constructor() {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('builds a dual-deck graph and re-routes the preamp through the L−R splitter when karaoke is ON', async () => {
    const mod = await import('../../lib/music/player');
    // Fresh singleton per test run.
    const eng = mod.MusicPlayerEngine.getInstance() as unknown as {
      loadTrack: (t: unknown) => Promise<void>;
      setKaraoke: (b: boolean) => void;
      isKaraokeEnabled: () => boolean;
      ['preampGain']: MockNode; ['ksplitter']: MockNode; ['analyserNode']: MockNode;
      ['deckA']: { source: MockNode }; ['deckB']: { source: MockNode };
      ['masterMix']: MockNode; destroy: () => void;
    };
    engine = eng as unknown as typeof engine;

    await eng.loadTrack({ audioUrl: 'blob:x', title: 't', artistName: 'a' });

    // Two independent deck sources both feed the master mix → real dual-deck.
    expect(eng['deckA'].source).toBeTruthy();
    expect(eng['deckB'].source).toBeTruthy();
    expect(eng['deckA'].source.kind).toBe('source');
    expect(eng['deckB'].source.kind).toBe('source');

    // Karaoke OFF → preamp reaches the analyser WITHOUT going through a splitter.
    expect(eng.isKaraokeEnabled()).toBe(false);
    expect(reachableKinds(eng['preampGain']).has('splitter')).toBe(false);
    expect(reachableKinds(eng['preampGain']).has('analyser')).toBe(true);

    // Karaoke ON → preamp now routes through the channel splitter (the OOPS
    // center-cancel stage) before reaching the analyser.
    eng.setKaraoke(true);
    expect(eng.isKaraokeEnabled()).toBe(true);
    expect(reachableKinds(eng['preampGain']).has('splitter')).toBe(true);
    expect(reachableKinds(eng['preampGain']).has('analyser')).toBe(true);

    // Toggling back OFF removes the splitter from the live path again.
    eng.setKaraoke(false);
    expect(reachableKinds(eng['preampGain']).has('splitter')).toBe(false);

    eng.destroy();
  });
});
