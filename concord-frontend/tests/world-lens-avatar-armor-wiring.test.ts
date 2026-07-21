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
