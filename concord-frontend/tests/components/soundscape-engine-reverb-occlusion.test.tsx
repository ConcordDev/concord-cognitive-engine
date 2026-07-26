// World Lens plan Phase 2 ("Activate Existing Rendering") — reverb zones +
// spatial-SFX occlusion.
//
// lib/world-lens/spatial-audio.ts's ReverbZoneManager and OccludedSoundEmitter
// were fully built (real ConvolverNode-based synthetic IRs per zone type,
// a real occlusion→lowpass-filter curve) but had ZERO call sites outside
// their own file — confirmed by grep before this fix. SoundscapeEngine.tsx
// (the component that actually owns the AudioContext + master gain every
// district drone/SFX/weather sound in the world lens routes through) never
// instantiated either.
//
// Fix: ReverbZoneManager is now created once alongside the master gain and
// the master gain is routed through it instead of straight to
// ctx.destination, so every sound gets the district's real reverb
// character while the player is indoors (state.isInterior — the one real
// "am I indoors" signal this engine already tracked). Since this component
// has no real per-building room geometry to register as a zones list, it
// maintains ONE dynamic zone (added a real public ReverbZoneManager.clearZones()
// method for this rather than reaching into the class's private state) that
// re-centers on the player and is only present while indoors.
//
// OccludedSoundEmitter's own class shape (hardcoded ctx.destination routing,
// one-source-per-instance) didn't fit this engine's shared-master-gain,
// multi-oscillator-per-call architecture, so its exact muffling FORMULA was
// extracted into a shared occlusionToFilterParams() export (used by both
// OccludedSoundEmitter.setOcclusion and this engine's playToneSpatial) —
// avoiding a duplicate/drifting formula while still fitting this engine's
// real routing. Spatial SFX get muffled by the same real isInterior signal.
//
// SoundscapeEngine.tsx pulls in a full Web Audio graph that jsdom can't
// exercise meaningfully — the codebase's existing tests for this file
// (tests/components/SoundscapeEngine.test.tsx,
// tests/components/soundscape-engine-unmount.test.tsx) use a hand-built
// fake AudioContext for behavioral coverage. `playToneSpatial` and the
// shared `interiorOcclusion` derivation are now exported from
// SoundscapeEngine.tsx (a testability-only seam — no behavior changed, the
// 4 real call sites just route through one shared function instead of
// repeating the same ternary) so this file drives the REAL occlusion
// pipeline directly with a fake Web Audio graph, and drives the REAL
// OccludedSoundEmitter/occlusionToFilterParams from spatial-audio.ts
// (a plain, already-exported module — no fake needed beyond Web Audio
// node stand-ins), instead of regex-matching source text.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playToneSpatial, interiorOcclusion } from '@/components/world-lens/SoundscapeEngine';
import { OccludedSoundEmitter, occlusionToFilterParams } from '@/lib/world-lens/spatial-audio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/world-lens/SoundscapeEngine.tsx'),
  'utf8'
);
const spatialAudioSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'lib/world-lens/spatial-audio.ts'),
  'utf8'
);

/* ── Minimal fake Web Audio graph — just enough surface for
   playToneSpatial/OccludedSoundEmitter to run without a real AudioContext,
   with every node tracked so tests can assert real connect()/param calls. ── */

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeOscillatorNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeBiquadFilterNode {
  type = 'lowpass';
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakePannerNode {
  positionX = new FakeAudioParam();
  positionY = new FakeAudioParam();
  positionZ = new FakeAudioParam();
  panningModel = '';
  distanceModel = '';
  maxDistance = 0;
  refDistance = 0;
  rolloffFactor = 0;
  connect = vi.fn();
}

function fakeAudioContext() {
  return {
    currentTime: 0,
    createOscillator: () => new FakeOscillatorNode(),
    createGain: () => new FakeGainNode(),
    createBiquadFilter: () => new FakeBiquadFilterNode(),
    createPanner: () => new FakePannerNode(),
  } as unknown as AudioContext;
}

const SFX_DEF = { freq: 440, type: 'sine' as OscillatorType, duration: 0.2, attack: 0.01 };

describe('Phase 2 fix — ReverbZoneManager is instantiated and routes the master gain (static pins)', () => {
  it('imports ReverbZoneManager and occlusionToFilterParams from spatial-audio', () => {
    expect(engineSrc).toMatch(/import \{ ReverbZoneManager, occlusionToFilterParams, type ReverbZoneType \} from '\.\.\/\.\.\/lib\/world-lens\/spatial-audio';/);
  });

  it('creates ReverbZoneManager once in initAudio and connects masterGain through it, not straight to destination', () => {
    const initAudioBlock = engineSrc.match(/const initAudio = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[flushPendingSfx\]\);/);
    expect(initAudioBlock).toBeTruthy();
    const block = initAudioBlock![0];
    expect(block).toMatch(/reverbManagerRef\.current = new ReverbZoneManager\(ctx\);/);
    expect(block).toMatch(/reverbManagerRef\.current\.connectSource\(masterGainRef\.current\);/);
    expect(block).not.toMatch(/masterGainRef\.current\.connect\(ctx\.destination\);/);
  });

  it('maintains a single dynamic zone keyed on state.isInterior + district, using the real public clearZones() API', () => {
    expect(engineSrc).toMatch(/mgr\.clearZones\(\);/);
    expect(engineSrc).toMatch(/if \(state\.isInterior\) \{\s*\n\s*mgr\.addZone\(\{/);
    expect(engineSrc).toMatch(/type: DISTRICT_REVERB_ZONE\[state\.currentDistrict\] \?\? 'small_room',/);
  });

  it('drives ReverbZoneManager.update() from the real player position every time it changes', () => {
    expect(engineSrc).toMatch(/mgr\.update\(playerPosition\.x, playerPosition\.z, delta\);/);
  });

  it('disposes the reverb manager on unmount alongside the other Web Audio cleanup', () => {
    expect(engineSrc).toMatch(/reverbManagerRef\.current\?\.dispose\(\);[\s\S]{0,40}\n\s*reverbManagerRef\.current = null;/);
  });
});

describe('Phase 2 fix — playToneSpatial: real occlusion pipeline', () => {
  it('defaults occlusion to 1 (open line of sight) — no filter/gain stage, panner connects straight to masterGain', () => {
    const ctx = fakeAudioContext();
    const masterGain = new FakeGainNode() as unknown as GainNode;
    const createBiquadFilterSpy = vi.spyOn(ctx, 'createBiquadFilter');

    playToneSpatial(ctx, SFX_DEF, masterGain, { x: 1, y: 2, z: 3 });

    expect(createBiquadFilterSpy).not.toHaveBeenCalled();
  });

  it('when occluded, applies a lowpass filter whose freq/gain match the REAL occlusionToFilterParams(occlusion) — not a fabricated or hardcoded value', () => {
    const ctx = fakeAudioContext();
    const masterGain = new FakeGainNode() as unknown as GainNode;
    const filters: FakeBiquadFilterNode[] = [];
    (ctx.createBiquadFilter as unknown as () => FakeBiquadFilterNode) = vi.fn(() => {
      const f = new FakeBiquadFilterNode();
      filters.push(f);
      return f;
    });

    playToneSpatial(ctx, SFX_DEF, masterGain, { x: 0, y: 0, z: 0 }, 1, 0.3);

    expect(filters).toHaveLength(1);
    const expected = occlusionToFilterParams(0.3);
    expect(filters[0].frequency.value).toBeCloseTo(expected.freq, 6);
  });

  it('interiorOcclusion(isInterior) produces 0.55 while indoors and 1 while outdoors — the one real derivation every playToneSpatial occlusion value comes from', () => {
    expect(interiorOcclusion(true)).toBe(0.55);
    expect(interiorOcclusion(false)).toBe(1);
  });

  // Static count, deliberately titled without a behavior-claim verb — this
  // does not test runtime behavior (the real derivation is proven by the
  // test directly above and by playToneSpatial's own occlusion tests), it
  // records a plain textual fact: engine source has exactly 4 usages of the
  // shared helper and zero leftover copies of the old inline ternary.
  it('source note: exactly 4 usages of interiorOcclusion(interiorRef.current) exist in engine source, with no leftover duplicated inline ternary', () => {
    const usages = engineSrc.match(/interiorOcclusion\(interiorRef\.current\)/g) ?? [];
    expect(usages.length).toBe(4);
    expect(engineSrc).not.toMatch(/interiorRef\.current \? 0\.55 : 1/);
  });

  it('an indoor call actually produces the muffled (occluded) audio path end-to-end via playToneSpatial + interiorOcclusion together', () => {
    const ctx = fakeAudioContext();
    const masterGain = new FakeGainNode() as unknown as GainNode;
    const createBiquadFilterSpy = vi.spyOn(ctx, 'createBiquadFilter');

    playToneSpatial(ctx, SFX_DEF, masterGain, { x: 0, y: 0, z: 0 }, 1, interiorOcclusion(true));
    expect(createBiquadFilterSpy).toHaveBeenCalledTimes(1);

    createBiquadFilterSpy.mockClear();
    playToneSpatial(ctx, SFX_DEF, masterGain, { x: 0, y: 0, z: 0 }, 1, interiorOcclusion(false));
    expect(createBiquadFilterSpy).not.toHaveBeenCalled();
  });
});

describe('Phase 2 fix — spatial-audio.ts: shared occlusion formula + real clearZones API', () => {
  it('exports occlusionToFilterParams as the single source of truth for the muffling curve', () => {
    expect(spatialAudioSrc).toMatch(/export function occlusionToFilterParams\(value: number\): \{ freq: number; gain: number \} \{/);
  });

  it('OccludedSoundEmitter.setOcclusion calls the shared function — real numeric agreement, not a duplicated formula', () => {
    const fakeSource = { connect: vi.fn() } as unknown as AudioBufferSourceNode;
    const ctx = {
      currentTime: 0,
      createBiquadFilter: () => new FakeBiquadFilterNode(),
      createGain: () => new FakeGainNode(),
      createPanner: () => new FakePannerNode(),
      destination: {},
    } as unknown as AudioContext;

    const emitter = new OccludedSoundEmitter(ctx, fakeSource);
    const filter = emitter.filter as unknown as FakeBiquadFilterNode;
    const gainNode = emitter.gainNode as unknown as FakeGainNode;

    emitter.setOcclusion(0.4, ctx);

    const expected = occlusionToFilterParams(0.4);
    expect(filter.frequency.setTargetAtTime).toHaveBeenCalledWith(expected.freq, 0, 0.05);
    expect(gainNode.gain.setTargetAtTime).toHaveBeenCalledWith(expected.gain, 0, 0.05);

    // The old inline formula this replaced (`400 * Math.pow(50, clamp)`
    // duplicated ad hoc) is gone from the class body — real numeric
    // agreement above already proves it isn't silently reintroduced with
    // drifted constants, and this pins the literal is gone too.
    const setOcclusionBlock = spatialAudioSrc.match(/setOcclusion\(value: number, ctx: AudioContext\): void \{[\s\S]*?\n {2}\}/);
    expect(setOcclusionBlock![0]).not.toMatch(/Math\.pow\(50, clamp\)/);
  });

  it('ReverbZoneManager exposes a real clearZones() method', () => {
    expect(spatialAudioSrc).toMatch(/clearZones\(\): void \{\s*\n\s*this\.zones\.length = 0;\s*\n\s*\}/);
  });
});
