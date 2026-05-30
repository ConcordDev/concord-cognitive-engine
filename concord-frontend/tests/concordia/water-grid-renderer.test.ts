import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { waterCellQuad, createWaterGridRenderer } from '@/lib/world-lens/water-grid-renderer';

// WS-A4 — dynamic water surface from world_water_cells. Pin the pure surface map
// + the renderer's fill→drain lifecycle (fetchWater seam, no network).

describe('WS-A4 — waterCellQuad (pure)', () => {
  it('surface sits on terrain top + water column', () => {
    expect(waterCellQuad({ cell_x: 0, cell_z: 0, water_height: 2 }, 10).surfaceY).toBe(12);
  });
  it('deeper water is more opaque, clamped', () => {
    const shallow = waterCellQuad({ cell_x: 0, cell_z: 0, water_height: 0.2 }, 0);
    const deep = waterCellQuad({ cell_x: 0, cell_z: 0, water_height: 5 }, 0);
    expect(deep.opacity).toBeGreaterThan(shallow.opacity);
    expect(deep.opacity).toBeLessThanOrEqual(0.75);
    expect(shallow.opacity).toBeGreaterThanOrEqual(0.25);
  });
  it('negative/garbage water height floors at 0', () => {
    expect(waterCellQuad({ cell_x: 0, cell_z: 0, water_height: -3 }, 5).surfaceY).toBe(5);
  });
});

describe('WS-A4 — createWaterGridRenderer lifecycle', () => {
  it('renders a quad per wet cell at terrain top + height, drains when dry', async () => {
    const group = new THREE.Group();
    let rows = [{ cell_x: 2, cell_z: 3, water_height: 1.5 }];
    const r = createWaterGridRenderer(group, {
      worldId: 'w',
      cellSize: 10,
      elevationAt: () => 4, // flat terrain top at y=4
      fetchWater: async () => rows,
    });
    await r.refresh();
    expect(group.children.length).toBe(1);
    const mesh = group.children[0] as THREE.Mesh;
    // cell (2,3) centre = (25, 35); surface = 4 + 1.5 = 5.5
    expect(mesh.position.x).toBeCloseTo(25, 5);
    expect(mesh.position.z).toBeCloseTo(35, 5);
    // a few frames lerp the y toward target without throwing
    for (let i = 0; i < 6; i++) r.update(0.1, i * 0.1);
    expect(mesh.position.y).toBeGreaterThan(4); // risen toward 5.5

    // cell dries → quad removed
    rows = [];
    await r.refresh();
    expect(group.children.length).toBe(0);

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('skips cells with zero/absent water', async () => {
    const group = new THREE.Group();
    const r = createWaterGridRenderer(group, {
      worldId: 'w',
      fetchWater: async () => [{ cell_x: 0, cell_z: 0, water_height: 0 }],
    });
    await r.refresh();
    expect(group.children.length).toBe(0);
    r.dispose();
  });
});
