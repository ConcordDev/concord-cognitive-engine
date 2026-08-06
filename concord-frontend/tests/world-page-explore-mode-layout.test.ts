// Regression coverage for a layout bug reported live: "I can see it kinda
// loading in but blocked by hella panels — in the background you can see
// the health bar."
//
// Root cause, confirmed by measuring COMPUTED layout in a live Playwright
// session (not a guess from reading source): the 3D Explore-mode container
// (`<div ref={exploreShellRef} className="flex-1 relative min-h-0">`, which
// holds the Three.js canvas) was a flex-column sibling of several other,
// unconditionally-rendered blocks that don't belong to the 3D game view:
//   - "World Actions Panel" (country-compare / indicator-track / trade-flow
//     / demographic-profile — 2D district-inspection tools)
//   - "Lens Features" (a generic feature-icon scaffold, LensFeaturePanel —
//     since removed from this page entirely as part of the zero-generic-
//     tendencies cleanup, rather than kept and viewMode-gated; its absence
//     is strictly better than the original fix, so this file now asserts
//     that instead of a gate around a panel that no longer exists)
//   - the Factions/Quests/Marketplace/Adventure-kit affordance bar
//   - the EarthEventsLive NASA-EONET "Earth events" dashboard section
//     (by far the single biggest, measured at ~200px alone)
// None of these were gated on `viewMode`, so they always claimed their full
// content height in the flex column — leaving the `flex-1` 3D container
// only whatever space was left over. Measured before the fix: the 3D canvas
// rendered at 114px tall out of a 572px content area. After hiding the
// remaining 2D-dashboard blocks (World Actions, Earth events) while
// `viewMode === 'explore'` — and removing Lens Features outright — the same
// content area gave the 3D canvas 452px — a 4x increase, confirmed live.
// The Factions/Quests/Marketplace/Adventure-kit affordance bar was
// deliberately KEPT visible in 3D mode (only ~39px, and its buttons open
// genuinely useful slide-over panels — quest log, marketplace — while
// exploring in 3D).
//
// The page is too large (9000+ lines) to render in a unit test — this file
// follows the same source-pin convention already used for this page
// elsewhere (see tests/world-page-stable-callback-refs.test.ts,
// tests/world-page-wind-direction-threading.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx'), 'utf8');

describe('world lens page — 2D dashboard panels hidden in 3D Explore mode', () => {
  it('hides the World Actions Panel while viewMode is explore', () => {
    const idx = src.indexOf('{/* World Actions Panel');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 800);
    expect(slice).toMatch(/\{viewMode !== 'explore' && \(/);
  });

  it('never mounts the generic Lens Features scaffold panel at all (removed, not just hidden)', () => {
    // LensFeaturePanel was fully removed from this page (zero-generic-
    // tendencies cleanup) rather than kept and gated on viewMode — its
    // absence is the stronger guarantee the original bug fix was after.
    expect(src).not.toMatch(/<LensFeaturePanel\b/);
    expect(src).not.toContain('{/* Lens Features (collapsible)');
  });

  it('hides the EarthEventsLive dashboard section while viewMode is explore', () => {
    const idx = src.indexOf('<EarthEventsLive');
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/\{viewMode !== 'explore' && \(/);
  });

  it('keeps the Factions/Quests/Marketplace/Adventure-kit affordance bar visible in every mode (deliberately not hidden)', () => {
    const idx = src.indexOf('2026 parity polish — affordance bar');
    expect(idx).toBeGreaterThan(-1);
    // No viewMode gate immediately preceding this comment/bar.
    const before = src.slice(Math.max(0, idx - 200), idx);
    expect(before).not.toMatch(/viewMode !== 'explore'/);
  });
});
