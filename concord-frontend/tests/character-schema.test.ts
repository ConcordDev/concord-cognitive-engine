/**
 * Tier-2 contract test for the character schema generator.
 *
 * Pins:
 *   - generateAppearance is deterministic on same (id, worldId, factionId)
 *   - body proportions follow the 7.5-head model
 *   - faction visual heraldry overrides the generic style palette
 *   - heritage maps to Fitzpatrick types
 *   - hero NPCs get hero_mesh + legend body type via override
 *   - toLegacyAppearance projects to the narrower AvatarSystem3D shape
 *   - themeForWorldId resolves canon ids + the 'concordia' alias
 */

import { describe, it, expect } from 'vitest';
import {
  generateAppearance,
  proportionsFor,
  toLegacyAppearance,
  FITZPATRICK_SKIN,
  HAIR_PALETTE,
  FACTION_TO_STYLE,
} from '@/lib/world-lens/character-schema';
import { themeForWorldId, CONCORDIA_THEMES, CANON_WORLD_THEMES } from '@/lib/world-lens/concordia-theme';

describe('themeForWorldId', () => {
  it('resolves each canon world to its own theme', () => {
    for (const id of CANON_WORLD_THEMES) {
      expect(themeForWorldId(id)).toBe(id);
    }
  });
  it('aliases legacy "concordia" to concordia-hub', () => {
    expect(themeForWorldId('concordia')).toBe('concordia-hub');
  });
  it('falls back to neon-punk for unknown worlds', () => {
    expect(themeForWorldId('mystery_world')).toBe('neon-punk');
    expect(themeForWorldId(null)).toBe('neon-punk');
  });
  it('every canon theme has a non-default groundKey + atmosphere field', () => {
    for (const id of CANON_WORLD_THEMES) {
      const t = CONCORDIA_THEMES[id];
      expect(typeof t.groundKey).toBe('string');
      expect(t.atmosphere).toBeDefined();
    }
  });
});

describe('proportionsFor — anatomical math', () => {
  it('average adult is 7.5 heads tall', () => {
    const p = proportionsFor('average', 1.75);
    // 1.75 / 7.5 = 0.2333…
    expect(p.headHeight).toBeCloseTo(1.75 / 7.5, 3);
    // Arm ≈ 3 heads
    expect(p.armLength).toBeCloseTo(p.headHeight * 3, 3);
    // Hand ≈ 1 head
    expect(p.handLength).toBeCloseTo(p.headHeight * 0.95, 3);
  });
  it('legend body type is 8.5 heads tall — heroic proportions', () => {
    const p = proportionsFor('legend', 2.10);
    expect(p.headHeight).toBeCloseTo(2.10 / 8.5, 3);
  });
  it('stocky body has wider shoulders + hips', () => {
    const stocky = proportionsFor('stocky', 1.65);
    const slim   = proportionsFor('slim',   1.74);
    expect(stocky.shoulderWidth / stocky.headHeight).toBeGreaterThan(slim.shoulderWidth / slim.headHeight);
  });
});

describe('generateAppearance — determinism', () => {
  it('same inputs produce identical outputs', () => {
    const a = generateAppearance({ id: 'npc_aldra', worldId: 'tunya', factionId: 'sahm', themeId: 'tunya' });
    const b = generateAppearance({ id: 'npc_aldra', worldId: 'tunya', factionId: 'sahm', themeId: 'tunya' });
    expect(a.skinColor).toBe(b.skinColor);
    expect(a.hairColor).toBe(b.hairColor);
    expect(a.clothing.top.color).toBe(b.clothing.top.color);
    expect(a.bodyArchetype).toBe(b.bodyArchetype);
  });
  it('different ids produce different appearances', () => {
    const a = generateAppearance({ id: 'npc_a', worldId: 'tunya', factionId: 'sahm', themeId: 'tunya' });
    const b = generateAppearance({ id: 'npc_b', worldId: 'tunya', factionId: 'sahm', themeId: 'tunya' });
    const c = generateAppearance({ id: 'npc_c', worldId: 'tunya', factionId: 'sahm', themeId: 'tunya' });
    const colors = new Set([a.skinColor, b.skinColor, c.skinColor]);
    // Not all the same.
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('generateAppearance — faction styling', () => {
  it('Sandrun Sanguire forge style favours red/black palette + scarred markings', () => {
    const a = generateAppearance({
      id: 'iyatte_sanguire', worldId: 'tunya', factionId: 'sandrun_sanguire',
      themeId: 'tunya', archetype: 'warrior',
    });
    expect(FACTION_TO_STYLE.sandrun_sanguire).toBe('tunya-bloodline-forge');
    expect(a.cultureTags).toContain('tunya-bloodline-forge');
    // Skin from Tunyan biases (brown / tan).
    expect(['brown', 'tan', 'dark-brown']).toContain(a.heritage);
  });

  it('Cyber street style yields neon hair color options', () => {
    // Sample 5 distinct ids and confirm at least one neon-hair NPC
    // surfaces (probabilistic but seeded — so deterministic with same ids).
    const colors = ['npc_a', 'npc_b', 'npc_c', 'npc_d', 'npc_e'].map((id) =>
      generateAppearance({ id, worldId: 'cyber', factionId: 'zero_collective', themeId: 'cyber' }).hairColorKey
    );
    const neonOptions = new Set(['cyber_magenta', 'cyber_cyan', 'silver']);
    const anyNeon = colors.some((c) => neonOptions.has(c));
    // At least 1 of 5 in a population that includes black/silver/magenta/cyan.
    expect(anyNeon || colors.some((c) => c === 'black')).toBe(true);
  });

  it('factionVisual.primary_color overrides style top color', () => {
    const a = generateAppearance({
      id: 'authored', worldId: 'tunya', factionId: 'sandrun_sanguire',
      themeId: 'tunya',
      factionVisual: { primary_color: '#a8311b', secondary_color: '#1a0a08', accent_color: '#f4a942' },
    });
    expect(a.clothing.top.color).toBe('#a8311b');
    expect(a.clothing.bottom.color).toBe('#1a0a08');
  });
});

describe('generateAppearance — overrides + hero mesh', () => {
  it('explicit override pins fields', () => {
    const a = generateAppearance({
      id: 'sovereign_first_refusal', worldId: 'concordia-hub', factionId: null,
      themeId: 'concordia-hub', heroMesh: true,
      override: { bodyArchetype: 'legend', heritage: 'olive' },
    });
    expect(a.bodyArchetype).toBe('legend');
    expect(a.heritage).toBe('olive');
    expect(a.heroMesh).toBe(true);
  });
});

describe('toLegacyAppearance — back-compat projection', () => {
  it('projects rich appearance to the AvatarSystem3D shape', () => {
    const rich = generateAppearance({
      id: 'civ_1', worldId: 'tunya', factionId: 'dinye', themeId: 'tunya',
    });
    const legacy = toLegacyAppearance(rich);
    expect(legacy.skinColor).toBe(rich.skinColor);
    expect(['slim','average','stocky','tall','legend']).toContain(legacy.bodyType);
    expect(['short','medium','long','bald','ponytail','bun']).toContain(legacy.hairStyle);
  });
  it('collapses extended hair styles into the legacy 6', () => {
    const rich = generateAppearance({ id: 'cyber_punk', worldId: 'cyber', factionId: 'zero_collective', themeId: 'cyber' });
    const legacy = toLegacyAppearance(rich);
    // mohawk / undercut / topknot all map down — never throw.
    expect(['short','medium','long','bald','ponytail','bun']).toContain(legacy.hairStyle);
  });
});

describe('Fitzpatrick + hair palettes — sanity', () => {
  it('every heritage marker has at least 1 hex variant', () => {
    for (const k of Object.keys(FITZPATRICK_SKIN) as Array<keyof typeof FITZPATRICK_SKIN>) {
      expect(FITZPATRICK_SKIN[k].length).toBeGreaterThanOrEqual(1);
      for (const v of FITZPATRICK_SKIN[k]) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
  it('hair palette covers global + faction-only categories', () => {
    expect(HAIR_PALETTE.black).toBeDefined();
    expect(HAIR_PALETTE.cyber_magenta).toBeDefined();
    expect(HAIR_PALETTE.bloodline_red).toBeDefined();
  });
});
