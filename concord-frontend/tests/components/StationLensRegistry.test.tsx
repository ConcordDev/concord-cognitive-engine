// Lens-as-Station registry — every station must point at a REAL lens, and the
// redirect src must carry world + station context. Pure data, no mocks.

import { describe, it, expect } from 'vitest';
import {
  STATION_LENS_REGISTRY, resolveStationLens, lensStationTypes, stationLensSrc,
} from '@/lib/station-lens-registry';
import { LENS_REGISTRY } from '@/lib/lens-registry';

describe('station-lens registry', () => {
  it('every station points at a REAL registered lens (no dead routes)', () => {
    const realIds = new Set(LENS_REGISTRY.map((e) => e.id));
    for (const s of Object.values(STATION_LENS_REGISTRY)) {
      expect(realIds.has(s.lensId), `${s.buildingType} → ${s.lensId} must be a real lens`).toBe(true);
    }
  });

  it('resolves a known building_type and returns null for non-stations', () => {
    expect(resolveStationLens('code_terminal')?.lensId).toBe('code');
    expect(resolveStationLens('clinic')?.lensId).toBe('healthcare');
    expect(resolveStationLens('courthouse')?.lensId).toBe('legal');
    expect(resolveStationLens('bedroom')).toBeNull();
    expect(resolveStationLens(null)).toBeNull();
    expect(resolveStationLens(undefined)).toBeNull();
  });

  it('every entry has a verb, a diegetic place label, and a valid accent', () => {
    const accents = new Set(['amber', 'emerald', 'cyan', 'violet', 'pink', 'rose', 'slate']);
    for (const [key, s] of Object.entries(STATION_LENS_REGISTRY)) {
      expect(s.buildingType).toBe(key); // key matches entry
      expect(s.verb.length).toBeGreaterThan(0);
      expect(s.placeLabel.length).toBeGreaterThan(0);
      expect(accents.has(s.accent)).toBe(true);
    }
    expect(lensStationTypes().length).toBeGreaterThanOrEqual(8);
  });

  it('builds a same-origin lens src carrying world + station context', () => {
    const src = stationLensSrc('code', 'world-1', 'bld-9');
    expect(src.startsWith('/lenses/code?')).toBe(true);
    expect(src).toContain('world=world-1');
    expect(src).toContain('station=bld-9');
    expect(src).toContain('diegetic=1');
  });
});
