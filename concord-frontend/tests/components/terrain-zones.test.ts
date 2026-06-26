// Terrain zone derivation — turns REAL building coordinates into TerrainZone
// splat regions. Pure data; the coordinates come from the buildings, not the
// abstract (coordinate-less) ZoneDTU records. No mocks.

import { describe, it, expect } from 'vitest';
import { buildingTypeToTerrainZone, deriveTerrainZones } from '@/lib/world-lens/terrain-zones';

describe('buildingTypeToTerrainZone', () => {
  it('tints by purpose: civic→cobblestone, commerce→brick, forge→gravel, care→grass', () => {
    expect(buildingTypeToTerrainZone('courthouse')).toBe('cobblestone');
    expect(buildingTypeToTerrainZone('trading_floor')).toBe('brick');
    expect(buildingTypeToTerrainZone('forge')).toBe('gravel');
    expect(buildingTypeToTerrainZone('clinic')).toBe('grass');
    expect(buildingTypeToTerrainZone('tide_station')).toBe('sand');
  });

  it('defaults unmapped/empty types to grass (never broken-looking)', () => {
    expect(buildingTypeToTerrainZone('totally_unknown')).toBe('grass');
    expect(buildingTypeToTerrainZone(undefined)).toBe('grass');
    expect(buildingTypeToTerrainZone(null)).toBe('grass');
  });
});

describe('deriveTerrainZones', () => {
  it('derives a zone per building from its real x/z, enclosing the footprint', () => {
    const zones = deriveTerrainZones([
      { id: 'b1', building_type: 'courthouse', x: 800, z: 948, width: 14, depth: 12 },
      { id: 'b2', building_type: 'forge', x: 778, z: 1014, width: 12, depth: 10 },
    ]);
    expect(zones.length).toBe(2);
    const court = zones[0];
    expect(court.zone).toBe('cobblestone');
    expect(court.id).toBe('zone_b1');
    // bounds [minX, minZ, maxX, maxZ] must enclose the building centre + footprint
    const [minX, minZ, maxX, maxZ] = court.bounds;
    expect(minX).toBeLessThan(800);
    expect(maxX).toBeGreaterThan(800);
    expect(minZ).toBeLessThan(948);
    expect(maxZ).toBeGreaterThan(948);
    expect(zones[1].zone).toBe('gravel');
  });

  it('skips buildings with non-finite coordinates; never throws', () => {
    const zones = deriveTerrainZones([
      { id: 'ok', building_type: 'market', x: 100, z: 200 },
      { id: 'bad', building_type: 'market', x: NaN, z: 0 },
      // @ts-expect-error — defensive: tolerate a malformed row
      null,
    ]);
    expect(zones.length).toBe(1);
    expect(zones[0].id).toBe('zone_ok');
  });

  it('applies the world→scene offset so zones match the shifted building frame', () => {
    // Server city (800,1000) with the 1000 offset → scene-centred (-200, 0).
    const [z] = deriveTerrainZones([{ id: 'c', building_type: 'courthouse', x: 800, z: 1000, width: 14, depth: 12 }], 1000);
    const [minX, minZ, maxX, maxZ] = z.bounds;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    expect(cx).toBe(-200); // 800 - 1000
    expect(cz).toBe(0);    // 1000 - 1000
  });

  it('uses a minimum apron so tiny buildings still tint a visible patch', () => {
    const [z] = deriveTerrainZones([{ id: 't', building_type: 'code_terminal', x: 0, z: 0, width: 4, depth: 4 }]);
    const [minX, , maxX] = z.bounds;
    expect(maxX - minX).toBeGreaterThanOrEqual(24); // ≥ 2×apron around the footprint
  });
});
