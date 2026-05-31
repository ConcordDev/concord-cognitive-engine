/**
 * Wave 5a — contract test for the authored-appearance parser + its merge into
 * generateAppearance.
 *
 * Pins:
 *   - parseAuthoredAppearance handles BOTH shapes (structured object + prose)
 *   - it is pure + total (unknown/empty/garbage → {} or partial, never throws)
 *   - prose keyword scan extracts build/skin/hair/eyes/scars/augments/weapon
 *   - generateAppearance MERGES the patch over the hash seed: authored scalars
 *     win, scars/markings/augments/carry APPEND, un-authored fields stay hashed
 *   - an un-authored NPC (no text) is byte-identical to the prior output
 *     (the drop-safety guarantee)
 */

import { describe, it, expect } from 'vitest';
import { parseAuthoredAppearance, authoredWantsGlow } from '@/lib/world-lens/appearance-parse';
import { generateAppearance } from '@/lib/world-lens/character-schema';

describe('parseAuthoredAppearance — totality', () => {
  it('returns {} for empty / null / whitespace', () => {
    expect(parseAuthoredAppearance(null)).toEqual({});
    expect(parseAuthoredAppearance(undefined)).toEqual({});
    expect(parseAuthoredAppearance('')).toEqual({});
    expect(parseAuthoredAppearance('   ')).toEqual({});
  });

  it('never throws on garbage input', () => {
    expect(() => parseAuthoredAppearance('{not valid json')).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => parseAuthoredAppearance(12345 as any)).not.toThrow();
  });
});

describe('parseAuthoredAppearance — structured shape', () => {
  it('maps build/skin/hair/eyes/age to palette keys', () => {
    const p = parseAuthoredAppearance({
      build: 'broad-shouldered',
      skin: 'dark',
      hair: 'silver, shorn close',
      eyes: 'amber',
      age: 'elder',
    });
    expect(p.bodyArchetype).toBe('broad');
    expect(p.heritage).toBe('dark-brown');
    expect(p.hairColorKey).toBe('silver');
    expect(p.hairStyle).toBe('shaved'); // "shorn"
    expect(p.eyeColorKey).toBe('amber');
    expect(p.facialPatch?.age).toBe('elder');
  });

  it('extracts tells (scar) + weapon', () => {
    const p = parseAuthoredAppearance({ tells: 'a long burn scar across one arm', weapon: 'katana' });
    expect(p.scars?.[0]).toMatchObject({ region: 'arm', kind: 'burn' });
    expect(p.carry).toContain('sword'); // katana → sword
  });
});

describe('parseAuthoredAppearance — prose shape', () => {
  it('parses a scarred, augmented warlord', () => {
    const p = parseAuthoredAppearance(
      'a towering, broad warlord with silver hair shorn close, one milky eye, and a chrome left arm',
    );
    expect(p.bodyArchetype).toBeDefined(); // tall/broad both present; first match wins
    expect(p.hairColorKey).toBe('silver');
    // chrome left arm → augment + glow
    expect(p.augments?.some((a) => a.material === 'chrome')).toBe(true);
    expect(authoredWantsGlow(p)).toBe(true);
    // milky eye → face scar + eye augment
    expect(p.scars && p.scars.length).toBeGreaterThan(0);
  });

  it('glyph tells set glow', () => {
    const p = parseAuthoredAppearance('robed scholar marked with a glowing memory-glyph on the brow');
    expect(p.markings?.some((m) => m.kind === 'glyph')).toBe(true);
    expect(authoredWantsGlow(p)).toBe(true);
  });
});

describe('generateAppearance — merge behaviour', () => {
  const base = {
    id: 'npc_test_warlord',
    worldId: 'tunya',
    factionId: null,
    themeId: 'tunya' as const,
  };

  it('un-authored NPC is byte-identical to no-text (drop-safety)', () => {
    const a = generateAppearance({ ...base });
    const b = generateAppearance({ ...base, npcAppearanceText: null });
    const c = generateAppearance({ ...base, npcAppearanceText: '' });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('authored description overrides the hash + appends arrays', () => {
    const hashOnly = generateAppearance({ ...base });
    const authored = generateAppearance({
      ...base,
      npcAppearanceText: 'a broad warlord, silver hair, amber eyes, with a chrome left arm and a glyph scar',
    });
    // authored scalars win
    expect(authored.bodyArchetype).toBe('broad');
    expect(authored.hairColorKey).toBe('silver');
    expect(authored.eyeColorKey).toBe('amber');
    // augment appended (chrome arm)
    expect(authored.accessories.augments?.some((a) => a.material === 'chrome')).toBe(true);
    // it actually changed something vs the pure hash
    expect(authored).not.toEqual(hashOnly);
  });

  it('is still deterministic for the same authored text', () => {
    const t = 'a tall pale mystic with long red hair and green eyes';
    expect(generateAppearance({ ...base, npcAppearanceText: t }))
      .toEqual(generateAppearance({ ...base, npcAppearanceText: t }));
  });
});
