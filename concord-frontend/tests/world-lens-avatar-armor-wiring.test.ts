import { describe, it, expect, vi, beforeEach } from 'vitest';

// AvatarSystem3D.tsx is a large Three.js/DOM-heavy component (this repo's
// established pattern for such files is a source-pinning regression test
// rather than a full render, see tests/world-page-*.test.ts). The
// "everyone unique" armor wiring (hero-GLB NPCs get the SAME deterministic
// rich.armor a procedural-fallback build of them would have gotten,
// computed once and reused, not skipped or double-rolled) used to be
// buried inside `createAvatarMeshSmart`'s inline closure, verifiable only
// via source-text regex. It has since been extracted into two standalone
// exported functions — `readAvatarAppearanceHint` and `tryLoadHeroMesh`
// — specifically so this behavior is directly callable and testable
// without mounting the full Three.js avatar scene. This file now drives
// the REAL exported functions (with the two dynamic-import module
// dependencies they call — character-schema + hero-mesh-registry —
// mocked) rather than regex-matching source text.

const generateAppearance = vi.fn();
const loadHeroMesh = vi.fn();

vi.mock('@/lib/world-lens/character-schema', () => ({
  generateAppearance: (...args: unknown[]) => generateAppearance(...args),
}));
vi.mock('@/lib/concordia/hero-mesh-registry', () => ({
  loadHeroMesh: (...args: unknown[]) => loadHeroMesh(...args),
}));

import {
  tryLoadHeroMesh,
  readAvatarAppearanceHint,
  type AppearanceConfig,
} from '@/components/world-lens/AvatarSystem3D';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Kept for the one genuinely-structural claim below (single call site) —
// every other assertion in this file drives the real exported functions.
const src = readFileSync(join(process.cwd(), 'components/world-lens/AvatarSystem3D.tsx'), 'utf8');

const appearance: AppearanceConfig = {
  skinColor: '#eeddcc',
  hairColor: '#221100',
  hairStyle: 'short',
  bodyType: 'average',
  clothing: {
    top: { color: '#333333', type: 'shirt' },
    bottom: { color: '#333333', type: 'pants' },
  },
};

beforeEach(() => {
  generateAppearance.mockReset();
  loadHeroMesh.mockReset();
  delete (window as unknown as { __CONCORD_NPC_APPEARANCE_CACHE__?: unknown }).__CONCORD_NPC_APPEARANCE_CACHE__;
});

describe('AvatarSystem3D — hero-GLB armor wiring', () => {
  it('computes the rich appearance (generateAppearance) before attempting the hero-GLB load', async () => {
    const callOrder: string[] = [];
    generateAppearance.mockImplementation(() => {
      callOrder.push('generateAppearance');
      return { armor: { helmet: 'plate', chest: 'plate' } };
    });
    loadHeroMesh.mockImplementation(async () => {
      callOrder.push('loadHeroMesh');
      return { group: { name: 'heroGroup' } };
    });

    await tryLoadHeroMesh(
      'npc-1',
      appearance,
      { isHero: true, isLocalPlayer: false, worldId: 'concordia-hub' },
      undefined,
    );

    expect(callOrder).toEqual(['generateAppearance', 'loadHeroMesh']);
  });

  it('passes rich.armor as the 4th argument to loadHeroMesh', async () => {
    const richArmor = { helmet: 'iron', chest: 'iron' };
    generateAppearance.mockReturnValue({ armor: richArmor });
    loadHeroMesh.mockResolvedValue({ group: { name: 'heroGroup' } });

    await tryLoadHeroMesh(
      'npc-2',
      appearance,
      { isHero: true, isLocalPlayer: false, worldId: 'concordia-hub', archetype: 'warrior' },
      undefined,
    );

    expect(loadHeroMesh).toHaveBeenCalledWith('npc-2', 'warrior', 'concordia-hub', richArmor);
  });

  it('returns the already-computed rich appearance for the caller to reuse (nullish-assign, not a second generateAppearance call) even when the GLB itself fails to load', async () => {
    const richArmor = { helmet: 'bronze' };
    generateAppearance.mockReturnValue({ armor: richArmor });
    loadHeroMesh.mockResolvedValue({ group: null }); // GLB load failed/absent

    const result = await tryLoadHeroMesh(
      'npc-3',
      appearance,
      { isHero: true, isLocalPlayer: false, worldId: 'concordia-hub' },
      undefined,
    );

    // group is null (createAvatarMeshSmart falls through to the
    // enhanced-avatar builder) but rich is NOT discarded — the caller's
    // `rich = heroResult.rich; ... rich ??= schemaMod.generateAppearance(...)`
    // reuse depends on this surviving a failed hero-GLB attempt, and
    // generateAppearance must only have been called the one time above.
    expect(result.group).toBeNull();
    expect(result.rich).toEqual({ armor: richArmor });
    expect(generateAppearance).toHaveBeenCalledTimes(1);
  });

  it('does not attempt the hero-GLB path at all for the local player or a non-hero NPC', async () => {
    const local = await tryLoadHeroMesh('player-1', appearance, { isHero: true, isLocalPlayer: true }, undefined);
    const nonHero = await tryLoadHeroMesh('npc-4', appearance, { isHero: false, isLocalPlayer: false }, undefined);

    expect(local).toEqual({ group: null, rich: null });
    expect(nonHero).toEqual({ group: null, rich: null });
    expect(generateAppearance).not.toHaveBeenCalled();
    expect(loadHeroMesh).not.toHaveBeenCalled();
  });

  it('the appearance-cache hint is read via a single shared Map.get call (reused for both the hero-GLB and procedural-fallback paths)', () => {
    const get = vi.fn().mockReturnValue({ homeWorldId: 'tunya', archetype: 'trader' });
    (window as unknown as { __CONCORD_NPC_APPEARANCE_CACHE__?: { get: typeof get } }).__CONCORD_NPC_APPEARANCE_CACHE__ = { get };

    const hint = readAvatarAppearanceHint('npc-5');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('npc-5');
    expect(hint).toEqual({ homeWorldId: 'tunya', archetype: 'trader' });

    // createAvatarMeshSmart calls this exactly once per avatar — both the
    // hero-GLB path and the procedural-fallback path below read the SAME
    // `hint` local variable, not a second cache read.
    const callSites = src.match(/readAvatarAppearanceHint\(avatarId\)/g) ?? [];
    expect(callSites.length).toBe(1);
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
