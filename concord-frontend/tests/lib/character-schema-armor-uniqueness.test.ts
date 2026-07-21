import { describe, it, expect } from 'vitest';
import { generateAppearance } from '@/lib/world-lens/character-schema';

// 2026-07-21 — every character now gets a deterministic, individually-
// seeded armor kit (character-schema.ts's generateAppearance armor
// block) so no two NPCs read as recolored clones of their archetype/
// faction — "everyone unique" per the session's own framing.
describe('generateAppearance — per-character armor uniqueness', () => {
  it('every character gets a real ArmorAppearance with all required fields', () => {
    const rich = generateAppearance({ id: 'npc_a', worldId: 'concordia-hub', archetype: 'warrior', themeId: 'concordia-hub' });
    expect(rich.armor).toBeDefined();
    expect(rich.armor.silhouette).toBeTypeOf('string');
    expect(rich.armor.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(rich.armor.secondaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(rich.armor.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(rich.armor.tier).toBeGreaterThanOrEqual(1);
    expect(rich.armor.tier).toBeLessThanOrEqual(5);
    expect(rich.armor.wear).toBeGreaterThanOrEqual(0);
    expect(rich.armor.wear).toBeLessThanOrEqual(1);
    expect(rich.armor.seed).toBeTypeOf('string');
  });

  it('is fully deterministic — same (id, worldId, factionId) always produces identical armor', () => {
    const a = generateAppearance({ id: 'npc_aldra_sahm', worldId: 'concordia-hub', factionId: 'concordant_curators', archetype: 'scholar', themeId: 'concordia-hub' });
    const b = generateAppearance({ id: 'npc_aldra_sahm', worldId: 'concordia-hub', factionId: 'concordant_curators', archetype: 'scholar', themeId: 'concordia-hub' });
    expect(a.armor).toEqual(b.armor);
  });

  it('different ids produce different armor (tier and/or wear and/or seed vary across a sample)', () => {
    const sample = Array.from({ length: 20 }, (_, i) =>
      generateAppearance({ id: `npc_civilian_${i}`, worldId: 'concordia-hub', archetype: null, themeId: 'concordia-hub' }));
    const tiers = new Set(sample.map((r) => r.armor.tier));
    const wears = new Set(sample.map((r) => Math.round(r.armor.wear * 1000)));
    const seeds = new Set(sample.map((r) => r.armor.seed));
    // Every one of the 20 seed strings must be distinct (identity-keyed).
    expect(seeds.size).toBe(20);
    // Tier and wear should show real variation across 20 samples, not
    // all collapse to one value (which would mean the RNG salt is dead).
    expect(tiers.size).toBeGreaterThan(1);
    expect(wears.size).toBeGreaterThan(1);
  });

  it('archetype maps to the expected default silhouette', () => {
    const cases: Array<[string, string]> = [
      ['warrior', 'heavy_plate'],
      ['guard', 'heavy_plate'],
      ['scholar', 'robed'],
      ['mystic', 'robed'],
      ['hunter', 'leather'],
      ['trader', 'leather'],
    ];
    for (const [archetype, expected] of cases) {
      const rich = generateAppearance({ id: `npc_${archetype}_test`, worldId: 'concordia-hub', archetype, themeId: 'concordia-hub' });
      expect(rich.armor.silhouette, `archetype ${archetype}`).toBe(expected);
    }
  });

  it('civilians (no recognized archetype) still get a real silhouette, never undefined', () => {
    const sample = Array.from({ length: 10 }, (_, i) =>
      generateAppearance({ id: `npc_civ_${i}`, worldId: 'concordia-hub', archetype: 'some-unmapped-job', themeId: 'concordia-hub' }));
    for (const rich of sample) {
      expect(['leather', 'exposed']).toContain(rich.armor.silhouette);
    }
  });

  it("'legend' body archetype always gets the top armor tier (5)", () => {
    const rich = generateAppearance({
      id: 'goddess_test', worldId: 'concordia-hub', archetype: 'legend', themeId: 'concordia-hub',
      override: { bodyArchetype: 'legend' },
    });
    expect(rich.bodyArchetype).toBe('legend');
    expect(rich.armor.tier).toBe(5);
  });

  it('armor colors reuse the character\'s own clothing palette (coherent outfit, not a mismatched overlay)', () => {
    const rich = generateAppearance({ id: 'npc_coherence_test', worldId: 'concordia-hub', archetype: 'guard', themeId: 'concordia-hub' });
    expect(rich.armor.primaryColor).toBe(rich.clothing.top.color);
    expect(rich.armor.secondaryColor).toBe(rich.clothing.bottom.color);
  });

  it("armor seed is the character's own composite identity string, matching the base appearance seed source", () => {
    const rich = generateAppearance({ id: 'npc_seed_check', worldId: 'concordia-hub', factionId: 'crime_syndicate', archetype: 'trader', themeId: 'concordia-hub' });
    expect(rich.armor.seed).toBe('concordia-hub::crime_syndicate::npc_seed_check');
  });
});
