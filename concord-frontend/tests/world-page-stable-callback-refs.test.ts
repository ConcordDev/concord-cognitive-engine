// Regression coverage for two unstable-prop-identity bugs in
// app/lenses/world/page.tsx, both found chasing a live "no game, just
// panels" report: the World Lens's WorldEntryOverlay never reached
// `sceneReady` because the page kept re-triggering child effects that
// exist to run once (or on genuine data change), driving React's
// "Maximum update depth exceeded" warning and starving the Three.js render
// loop of main-thread time.
//
// Bug A (the severe one — a real parent<->child feedback loop, not just
// wasted re-renders): `<WalkerNpcInjector onWalkers={(npcs) =>
// setWalkerNpcs(npcs)} />` wrapped the setState setter in a fresh arrow
// function every render. WalkerNpcInjector's own 100ms-interval effect
// depends on `onWalkers` (correctly, from its side) — so every page
// re-render tore down that effect (whose cleanup calls `onWalkers([])` →
// `setWalkerNpcs([])` in the PARENT) and immediately re-ran it (which
// fires an immediate tick → `onWalkers(npcs)` → `setWalkerNpcs(npcs)` in
// the parent again). Each of those parent setState calls triggers another
// page re-render, recreating the arrow function again — a genuine,
// self-sustaining ping-pong loop. Fixed by passing the already-stable
// `setWalkerNpcs` setter directly (React guarantees setState setter
// identity is stable across renders) instead of wrapping it.
//
// Bug B (unstable-prop churn, same class already fixed once on this page
// for `buildingRendererBuildings`/`mergedNpcs` — see the comments at
// those useMemo call sites): `<TerrainRenderer districts={
// deriveTerrainZones(worldBuildings)} lodCenter={{ x: 0, z: 0 }} />` handed
// a fresh array and a fresh object literal to TerrainRenderer on every
// render. Both sit in TerrainRenderer's terrain-build effect dependency
// array, so the effect re-ran on nearly every page render — including
// re-dispatching 'concordia:terrain-ready', which (before a separate fix
// in physics-world.ts) piled up duplicate Rapier heightfield colliders and
// was the root cause of a live WASM crash. Fixed by memoizing `districts`
// on `worldBuildings` and hoisting `lodCenter` to a module-level constant.
//
// The page is too large (9000+ lines) to render in a unit test — this file
// follows the same source-pin convention already used for this page
// elsewhere (see tests/world-page-wind-direction-threading.test.ts,
// tests/power-clusters-layer.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx'), 'utf8');

describe('world lens page — stable callback/prop identity into child effects', () => {
  it('passes the setWalkerNpcs setter directly to WalkerNpcInjector, not wrapped in a fresh arrow function', () => {
    const slice = src.slice(src.indexOf('<WalkerNpcInjector'), src.indexOf('<WalkerNpcInjector') + 200);
    expect(slice).toMatch(/onWalkers=\{setWalkerNpcs\}/);
    expect(slice).not.toMatch(/onWalkers=\{\s*\(/); // no inline arrow wrapper
  });

  it('memoizes TerrainRenderer\'s districts prop on worldBuildings instead of recomputing it inline every render', () => {
    expect(src).toMatch(/const terrainDistricts = useMemo\(\s*\(\)\s*=>\s*deriveTerrainZones\(worldBuildings\),\s*\[worldBuildings\]\s*\)/);
    const slice = src.slice(src.indexOf('<TerrainRenderer'), src.indexOf('<TerrainRenderer') + 300);
    expect(slice).toMatch(/districts=\{terrainDistricts\}/);
    expect(slice).not.toMatch(/districts=\{deriveTerrainZones\(/);
  });

  it('hoists TerrainRenderer\'s lodCenter to a stable module-level constant instead of an inline object literal', () => {
    expect(src).toMatch(/^const TERRAIN_LOD_CENTER_ORIGIN = \{ x: 0, z: 0 \};/m);
    const slice = src.slice(src.indexOf('<TerrainRenderer'), src.indexOf('<TerrainRenderer') + 300);
    expect(slice).toMatch(/lodCenter=\{TERRAIN_LOD_CENTER_ORIGIN\}/);
    expect(slice).not.toMatch(/lodCenter=\{\{/);
  });
});
