// World Lens plan Phase 2 ("Activate Existing Rendering") — day/night sky
// (+ rain/snow/cloud shadows, bundled in the same component) and river/creek
// water were DISCONNECTED per the plan: both SkyWeatherRenderer.tsx and
// WaterRenderer.tsx built a fully real THREE.Group (shaders, particle
// systems, per-frame update functions) and dispatched a "ready" CustomEvent,
// but that event only ever reached a no-op startup-readiness stub in
// lib/event-router.ts — scene.add() was never called, so none of it ever
// reached the screen, and the frozen-at-15:00 procedural sky-shader.ts dome
// (plus a static decorative water plane) rendered instead.
//
// Fix: both components now mirror TreeLayer.tsx's real, already-working
// `concordia:scene-ready` pattern — listen for it, attach their group, and
// (since neither is an EffectComposer-driven system) drive their own
// `userData.update(delta, elapsed)` via a local requestAnimationFrame loop.
// ConcordiaScene.tsx's own redundant static water plane was removed (it
// would otherwise double-render at the same coordinates WaterRenderer now
// owns); its real server-hydrology grid (waterGridRef / water-grid-renderer)
// is untouched.
//
// These components pull in Three.js scene construction that isn't mountable
// in jsdom — this file follows the same established source-pinning pattern
// as tests/concordia-scene-resource-leak-fix.test.tsx /
// tests/components/water-renderer-texture-dispose.test.tsx.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skySrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/world-lens/SkyWeatherRenderer.tsx'),
  'utf8'
);
const waterSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/world-lens/WaterRenderer.tsx'),
  'utf8'
);
const sceneSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', '..', 'app/lenses/world/page.tsx'),
  'utf8'
);

describe('Phase 2 fix — SkyWeatherRenderer attaches to the live scene', () => {
  it('still dispatches the original sky-weather-ready readiness signal (back-compat)', () => {
    expect(skySrc).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:sky-weather-ready', \{/);
  });

  it('listens for concordia:scene-ready and adds skyGroup to the real scene', () => {
    expect(skySrc).toMatch(/window\.addEventListener\('concordia:scene-ready', onSceneReady\);/);
    expect(skySrc).toMatch(/detail\.scene\.add\(skyGroup\);/);
  });

  it('requests the scene on mount for the late-mount race (mirrors TreeLayer.tsx)', () => {
    expect(skySrc).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:scene-request-ready'\)\);/);
  });

  it('drives skyGroup.userData.update via a local rAF loop (sun position, rain/snow motion, cloud-shadow drift)', () => {
    expect(skySrc).toMatch(/skyGroup\.userData\.update\?\.\(delta, elapsed\);/);
    expect(skySrc).toMatch(/animId = requestAnimationFrame\(tick\);/);
  });

  it('cleans up the scene listener, cancels the rAF loop, and detaches the group', () => {
    expect(skySrc).toMatch(/window\.removeEventListener\('concordia:scene-ready', onSceneReady\);\s*\n\s*cancelAnimationFrame\(animId\);\s*\n\s*detachScene\?\.\(\);/);
  });
});

describe('Phase 2 fix — WaterRenderer attaches to the live scene', () => {
  it('still dispatches the original water-ready readiness signal (back-compat)', () => {
    expect(waterSrc).toMatch(/window\.dispatchEvent\(new CustomEvent\('concordia:water-ready', \{/);
  });

  it('listens for concordia:scene-ready and adds waterGroup to the real scene', () => {
    expect(waterSrc).toMatch(/window\.addEventListener\('concordia:scene-ready', onSceneReady\);/);
    expect(waterSrc).toMatch(/detail\.scene\.add\(waterGroup\);/);
  });

  it('drives waterGroup.userData.update via a local rAF loop (wave time, foam drift)', () => {
    expect(waterSrc).toMatch(/waterGroup\.userData\.update\?\.\(delta, elapsed\);/);
    expect(waterSrc).toMatch(/animId = requestAnimationFrame\(tick\);/);
  });
});

describe('Phase 2 fix — ConcordiaScene no longer double-renders a decorative water plane', () => {
  it('the old flat river/creek Mesh construction is gone', () => {
    expect(sceneSrc).not.toMatch(/river\.name = 'water:river';/);
    expect(sceneSrc).not.toMatch(/creek\.name = 'water:creek';/);
    expect(sceneSrc).not.toMatch(/new THREE\.PlaneGeometry\(120, 600, 1, 1\)/);
  });

  it('the swim-plane registration (physicsWorld.registerWaterPlane) survives — swim-mode detection is unaffected', () => {
    expect(sceneSrc).toMatch(/physicsWorld\.registerWaterPlane\?\.\(worldId, waterY\);/);
  });

  it('the real server-hydrology grid (waterGridRef) is untouched', () => {
    expect(sceneSrc).toMatch(/const waterGridRef = useRef</);
    expect(sceneSrc).toMatch(/createWaterGridRenderer/);
  });
});

describe('Phase 2 fix — page.tsx wires real river/creek geometry into WaterRenderer, not placeholder values', () => {
  it('riverConfig matches the real river-bluff placement (was a disconnected placeholder at world origin)', () => {
    expect(pageSrc).toMatch(/riverConfig=\{\{ width: 120, flowDirection: 0, flowSpeed: 1, centerX: -700, length: 600 \}\}/);
  });

  it('creekPath is populated (was an empty array, which meant WaterRenderer\'s creek branch never built)', () => {
    expect(pageSrc).toMatch(/creekPath=\{\[\{ x: 150, z: -370 \}, \{ x: 150, z: -150 \}\]\}/);
  });

  it('timeOfDay is threaded from the live world clock, not a hardcoded noon value', () => {
    expect(pageSrc).toMatch(/<WaterRenderer[\s\S]{0,200}timeOfDay=\{worldPhaseForSky \* 24\}/);
  });
});
