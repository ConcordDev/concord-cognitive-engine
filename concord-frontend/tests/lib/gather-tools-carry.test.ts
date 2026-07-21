import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildEnhancedAvatar } from '@/lib/world-lens/enhanced-avatar-builder';
import { generateAppearance } from '@/lib/world-lens/character-schema';
import { clearProceduralCache } from '@/lib/world-lens/procedural-texture';

function richFor(id: string, archetype: string | null, overrides: Parameters<typeof generateAppearance>[0]['override'] = {}) {
  return generateAppearance({ id, worldId: 'concordia-hub', archetype, themeId: 'concordia-hub', override: overrides });
}

// 2026-07-21 — "It's hard to [depict NPCs gathering resources] with no
// tool." Accessories['carry'] previously had no axe/pickaxe/hoe/sickle
// values at all, and enhanced-avatar-builder.ts had no branch to render
// them even if it did. Civilian (unmatched-archetype) characters now get
// a seeded chance to carry a real gathering tool.
describe('gathering tools — carry-item type + rendering', () => {
  it('generateAppearance can produce all 4 gather-tool carry values via override', () => {
    for (const tool of ['axe', 'pickaxe', 'hoe', 'sickle'] as const) {
      const rich = richFor(`npc_tool_${tool}`, null, { accessories: { jewelry: [], markings: [], carry: [tool], augments: [] } });
      expect(rich.accessories.carry).toContain(tool);
    }
  });

  it('civilians (null archetype) get a real, non-trivial chance of carrying a gather tool across a sample', () => {
    const sample = Array.from({ length: 40 }, (_, i) =>
      richFor(`npc_civ_gather_${i}`, null));
    const withTool = sample.filter((r) =>
      r.accessories.carry?.some((c) => (['axe', 'pickaxe', 'hoe', 'sickle'] as const).includes(c as 'axe' | 'pickaxe' | 'hoe' | 'sickle')));
    expect(withTool.length).toBeGreaterThan(0);
    expect(withTool.length).toBeLessThan(sample.length); // not everyone — it's a seeded chance, not forced
  });

  it('buildEnhancedAvatar renders a real mesh group for each gather tool, never throwing', () => {
    clearProceduralCache();
    for (const tool of ['axe', 'pickaxe', 'hoe', 'sickle'] as const) {
      const rich = richFor(`npc_render_${tool}`, null, { accessories: { jewelry: [], markings: [], carry: [tool], augments: [] } });
      const { group } = buildEnhancedAvatar(rich);
      const found = group.children.find((c) => c.name === `carry_${tool}` || (tool === 'axe' && c.name?.startsWith('weapon_axe')));
      expect(found, `${tool} should render a real mesh group`).toBeTruthy();
    }
  });

  it('the axe carry item reuses the real axe weapon archetype (weapon_axe name), not a duplicate asset', () => {
    clearProceduralCache();
    const rich = richFor('npc_axe_reuse', null, { accessories: { jewelry: [], markings: [], carry: ['axe'], augments: [] } });
    const { group } = buildEnhancedAvatar(rich);
    const axe = group.children.find((c) => (c as THREE.Group).name?.startsWith('weapon_axe'));
    expect(axe).toBeTruthy();
  });

  it('pickaxe/hoe/sickle are procedural (wood shaft + metal head), each a distinct named group', () => {
    clearProceduralCache();
    const rich = richFor('npc_tools_all', null, { accessories: { jewelry: [], markings: [], carry: ['pickaxe', 'hoe', 'sickle'], augments: [] } });
    const { group } = buildEnhancedAvatar(rich);
    const names = group.children.map((c) => c.name).filter(Boolean);
    expect(names).toContain('carry_pickaxe');
    expect(names).toContain('carry_hoe');
    expect(names).toContain('carry_sickle');
  });

  it('a character with no carry array (or an empty one) renders no gather-tool meshes', () => {
    clearProceduralCache();
    const rich = richFor('npc_no_tools', null, { accessories: { jewelry: [], markings: [], carry: [], augments: [] } });
    const { group } = buildEnhancedAvatar(rich);
    const names = group.children.map((c) => c.name).filter(Boolean);
    expect(names).not.toContain('carry_pickaxe');
    expect(names).not.toContain('carry_hoe');
    expect(names).not.toContain('carry_sickle');
  });
});
