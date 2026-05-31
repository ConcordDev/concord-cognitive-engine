// WAVE ART Layer-2 — per-world atmosphere profiles (structural completeness).
import { describe, it, expect } from 'vitest';
import { ATMOSPHERE_PROFILES, atmosphereForWorld } from '@/lib/world-lens/atmosphere-profiles';
import { CANON_WORLD_THEMES } from '@/lib/world-lens/concordia-theme';

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

describe('atmosphere profiles', () => {
  it('every canon world has a complete, valid profile', () => {
    for (const id of CANON_WORLD_THEMES) {
      const p = ATMOSPHERE_PROFILES[id];
      expect(p, `missing profile for ${id}`).toBeDefined();
      expect(isHex(p.palette.primary) && isHex(p.palette.secondary) && isHex(p.palette.accent)).toBe(true);
      expect(isHex(p.fogColor) && isHex(p.lightColor)).toBe(true);
      expect(p.fogDensity).toBeGreaterThanOrEqual(0);
      expect(p.fogDensity).toBeLessThanOrEqual(1);
      expect(p.sky.rayleigh).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(typeof p.lut).toBe('string');
    }
  });

  it('fantasy is the most painterly (highest rayleigh / clearest sky)', () => {
    const fantasy = ATMOSPHERE_PROFILES.fantasy;
    const cyber = ATMOSPHERE_PROFILES.cyber;
    expect(fantasy.sky.rayleigh).toBeGreaterThan(cyber.sky.rayleigh);
    expect(fantasy.exposure).toBeGreaterThan(cyber.exposure);
  });

  it('atmosphereForWorld falls back to the hub for unknown worlds', () => {
    expect(atmosphereForWorld('nope')).toBe(ATMOSPHERE_PROFILES['concordia-hub']);
    expect(atmosphereForWorld('tunya').lut).toBe('ember-ash');
  });
});
