import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// AvatarSystem3D.tsx is a large Three.js/DOM-heavy component (this repo's
// established pattern for such files is a source-pinning regression test
// rather than a full render, see tests/world-page-*.test.ts). This pins
// the "everyone unique" armor wiring: hero-GLB NPCs now get the SAME
// deterministic rich.armor a procedural-fallback build of them would
// have gotten, computed once and reused, not skipped or double-rolled.
const src = readFileSync(join(process.cwd(), 'components/world-lens/AvatarSystem3D.tsx'), 'utf8');

describe('AvatarSystem3D — hero-GLB armor wiring', () => {
  it('computes the rich appearance before attempting the hero-GLB load, not only in the procedural fallback', () => {
    const heroBlockIdx = src.indexOf("if (opts.isHero && !opts.isLocalPlayer)");
    const richAssignIdx = src.indexOf('rich = schemaMod.generateAppearance(', heroBlockIdx);
    expect(heroBlockIdx).toBeGreaterThan(-1);
    expect(richAssignIdx).toBeGreaterThan(heroBlockIdx);
  });

  it('passes rich.armor as the 4th argument to loadHeroMesh', () => {
    expect(src).toContain('heroMod.loadHeroMesh(avatarId, archetype, homeWorld, rich.armor)');
  });

  it('the procedural-fallback path reuses the already-computed rich via nullish-assignment, not a second generateAppearance call', () => {
    const fallbackIdx = src.indexOf('const result = buildEnhancedAvatar(rich,');
    const reuseIdx = src.lastIndexOf('rich ??= schemaMod.generateAppearance(', fallbackIdx);
    expect(fallbackIdx).toBeGreaterThan(-1);
    expect(reuseIdx).toBeGreaterThan(-1);
    expect(reuseIdx).toBeLessThan(fallbackIdx);
  });

  it('the appearance-cache hint (including homeWorldId) is read exactly once for both paths', () => {
    const matches = src.match(/cache\?\.get\(avatarId\)/g) ?? [];
    expect(matches.length).toBe(1);
    expect(src).toContain('homeWorldId?: string;');
  });
});

// 2026-07-21 (later same session) — quality floor: every avatar that gets
// a mesh at all (already budget-capped at MAX_FULLY_ANIMATED, unchanged)
// now gets the enhanced builder (hair-cards, skin-SSS, real armor)
// instead of a large fraction silently falling to the flat-color box/
// cylinder/sphere legacy tier. Regression guard against silently
// reverting to the old tiered gate.
describe('AvatarSystem3D — quality floor (no more flat-primitive default)', () => {
  it('wantEnhanced is unconditionally true, not gated on isLocalPlayer/isHero/legend', () => {
    expect(src).toContain('const wantEnhanced = true;');
    // The old gated expression must be gone, not just shadowed.
    expect(src).not.toContain("opts.isLocalPlayer || opts.isHero || appearance.bodyType === 'legend';");
  });

  it('the legacy primitive builder (createAvatarMesh) is still reachable as the exception-safety fallback, not deleted out from under error handling', () => {
    const wantEnhancedIdx = src.indexOf('const wantEnhanced = true;');
    const fallbackCallIdx = src.indexOf('return await createAvatarMesh(appearance, THREE);', wantEnhancedIdx);
    expect(fallbackCallIdx).toBeGreaterThan(wantEnhancedIdx);
  });
});
