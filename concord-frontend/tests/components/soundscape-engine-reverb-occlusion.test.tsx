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
// fake AudioContext for behavioral coverage and source-text pins elsewhere
// in this plan's own work for the parts that aren't practically fake-able.
// This file follows the source-pinning half of that pattern.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/world-lens/SoundscapeEngine.tsx'),
  'utf8'
);
const spatialAudioSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'lib/world-lens/spatial-audio.ts'),
  'utf8'
);

describe('Phase 2 fix — ReverbZoneManager is instantiated and routes the master gain', () => {
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

describe('Phase 2 fix — spatial SFX occlusion driven by the real isInterior signal', () => {
  it('playToneSpatial accepts an occlusion parameter defaulting to 1 (open/back-compat)', () => {
    expect(engineSrc).toMatch(/occlusion = 1,\s*\n\): void \{/);
  });

  it('applies a lowpass filter via the shared occlusionToFilterParams curve when occluded', () => {
    expect(engineSrc).toMatch(/const \{ freq, gain: occGain \} = occlusionToFilterParams\(occlusion\);/);
  });

  it('every playToneSpatial call site threads a real occlusion value derived from isInterior (not hardcoded/fabricated)', () => {
    // 4 real call sites, checked individually rather than via a generic
    // paren-balanced regex extraction (one call's last arg is
    // pitchJitter(), whose own inner ')' breaks a naive "up to the next )"
    // match). 3 reference interiorRef.current directly; the 4th (inside
    // the delayed-layer loop) reads a local `occ` const assigned from
    // interiorRef.current one line above — real, not fabricated, just named.
    expect(engineSrc).toMatch(/playToneSpatial\(ctx, def, masterGainRef\.current, entry\.spatial, 1, interiorRef\.current \? 0\.55 : 1\);/);
    expect(engineSrc).toMatch(/const occ = interiorRef\.current \? 0\.55 : 1;\s*\n\s*if \(step\.delayMs <= 0\) playToneSpatial\(ctx, def, masterGainRef\.current, worldPos, jit, occ\);/);
    expect(engineSrc).toMatch(/if \(masterGainRef\.current\) playToneSpatial\(ctx, def, masterGainRef\.current, worldPos, jit, interiorRef\.current \? 0\.55 : 1\);/);
    expect(engineSrc).toMatch(/playToneSpatial\(ctx, def, masterGainRef\.current, worldPos, pitchJitter\(\), interiorRef\.current \? 0\.55 : 1\);/);
  });
});

describe('Phase 2 fix — spatial-audio.ts: shared occlusion formula + real clearZones API', () => {
  it('exports occlusionToFilterParams as the single source of truth for the muffling curve', () => {
    expect(spatialAudioSrc).toMatch(/export function occlusionToFilterParams\(value: number\): \{ freq: number; gain: number \} \{/);
  });

  it('OccludedSoundEmitter.setOcclusion calls the shared function instead of duplicating the formula', () => {
    const setOcclusionBlock = spatialAudioSrc.match(/setOcclusion\(value: number, ctx: AudioContext\): void \{[\s\S]*?\n {2}\}/);
    expect(setOcclusionBlock).toBeTruthy();
    expect(setOcclusionBlock![0]).toMatch(/const \{ freq, gain \} = occlusionToFilterParams\(value\);/);
    expect(setOcclusionBlock![0]).not.toMatch(/Math\.pow\(50, clamp\)/);
  });

  it('ReverbZoneManager exposes a real clearZones() method', () => {
    expect(spatialAudioSrc).toMatch(/clearZones\(\): void \{\s*\n\s*this\.zones\.length = 0;\s*\n\s*\}/);
  });
});
