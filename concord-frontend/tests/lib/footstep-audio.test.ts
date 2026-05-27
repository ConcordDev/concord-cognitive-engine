import { describe, it, expect } from 'vitest';
import {
  FOOTSTEP_SPECS,
  withWetVariant,
  normalizeTerrainMaterial,
  type TerrainMaterial,
} from '@/lib/world-lens/footstep-audio';

describe('FOOTSTEP_SPECS', () => {
  it('defines specs for all 9 terrain materials', () => {
    const expected: TerrainMaterial[] = ['grass', 'sand', 'stone', 'wood', 'snow', 'tile', 'mud', 'dirt', 'metal'];
    for (const m of expected) {
      expect(FOOTSTEP_SPECS[m]).toBeDefined();
      expect(FOOTSTEP_SPECS[m].centreFreqHz).toBeGreaterThan(0);
    }
  });

  it('stone has higher Q than sand (stone is tonal, sand is whiter)', () => {
    expect(FOOTSTEP_SPECS.stone.filterQ).toBeGreaterThan(FOOTSTEP_SPECS.sand.filterQ);
  });

  it('mud has squelch modulation, stone does not', () => {
    expect(FOOTSTEP_SPECS.mud.squelchHz).toBeDefined();
    expect(FOOTSTEP_SPECS.stone.squelchHz).toBeUndefined();
  });

  it('tile is louder than snow (sharp hard surface vs soft)', () => {
    expect(FOOTSTEP_SPECS.tile.peakGain).toBeGreaterThan(FOOTSTEP_SPECS.snow.peakGain);
  });

  it('snow has slower attack than stone', () => {
    expect(FOOTSTEP_SPECS.snow.attackSec).toBeGreaterThan(FOOTSTEP_SPECS.stone.attackSec);
  });
});

describe('withWetVariant', () => {
  it('lowers centre frequency', () => {
    const dry = FOOTSTEP_SPECS.stone;
    const wet = withWetVariant(dry);
    expect(wet.centreFreqHz).toBeLessThan(dry.centreFreqHz);
  });

  it('softens the attack', () => {
    const dry = FOOTSTEP_SPECS.stone;
    const wet = withWetVariant(dry);
    expect(wet.attackSec).toBeGreaterThan(dry.attackSec);
  });

  it('adds squelch when dry had none', () => {
    const wet = withWetVariant(FOOTSTEP_SPECS.stone);
    expect(wet.squelchHz).toBeDefined();
    expect(wet.squelchDepth).toBeGreaterThan(0);
  });

  it('increases existing squelch depth on already-wet materials', () => {
    const dryMud = FOOTSTEP_SPECS.mud;
    const wetMud = withWetVariant(dryMud);
    expect(wetMud.squelchDepth ?? 0).toBeGreaterThan(dryMud.squelchDepth ?? 0);
  });
});

describe('normalizeTerrainMaterial', () => {
  it('maps known variants to canonical kinds', () => {
    expect(normalizeTerrainMaterial('grass')).toBe('grass');
    expect(normalizeTerrainMaterial('meadow')).toBe('grass');
    expect(normalizeTerrainMaterial('beach-sand')).toBe('sand');
    expect(normalizeTerrainMaterial('cobblestone')).toBe('stone');
    expect(normalizeTerrainMaterial('Wooden Plank')).toBe('wood');
    expect(normalizeTerrainMaterial('snow-drift')).toBe('snow');
    expect(normalizeTerrainMaterial('marble_floor')).toBe('tile');
    expect(normalizeTerrainMaterial('swamp.mud')).toBe('mud');
    expect(normalizeTerrainMaterial('iron-grate')).toBe('metal');
  });

  it('falls back to dirt for unknown', () => {
    expect(normalizeTerrainMaterial('unknown-mystery')).toBe('dirt');
    expect(normalizeTerrainMaterial('')).toBe('dirt');
    expect(normalizeTerrainMaterial(null)).toBe('dirt');
    expect(normalizeTerrainMaterial(undefined)).toBe('dirt');
  });
});
