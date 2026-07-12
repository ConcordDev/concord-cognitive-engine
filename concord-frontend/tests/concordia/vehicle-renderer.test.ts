import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { createVehicleRenderer } from '@/lib/world-lens/vehicle-renderer';

// Wave 4 backlog #13 — vehicle-renderer was the one sibling polling renderer
// that removed a despawned vehicle's THREE.Group from the scene without
// disposing its geometry/material (a GPU-memory leak on every vehicle
// spawn/despawn cycle). Pin that per-vehicle despawn now disposes every mesh
// in the group, matching resource-node/crop-field/claim-boundary/
// construction-progress/corpse-mesh/uprising-crowd/water-grid.

describe('vehicle-renderer — dispose on despawn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('disposes geometry + material for every mesh in a vehicle group when it despawns via reconcile()', async () => {
    const parent = new THREE.Group();
    const vehicleRow = { id: 'v1', kind: 'car', pos_x: 1, pos_y: 0, pos_z: 2, heading: 0 };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { vehicles: [vehicleRow] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { vehicles: [] } }) });
    vi.stubGlobal('fetch', fetchMock);

    // createVehicleRenderer fires an un-awaited refresh() at construction
    // time, so wait for it (rather than racing it with our own refresh()
    // call, which the 'polling' re-entrancy guard would otherwise no-op).
    const r = createVehicleRenderer(parent, { worldId: 'w' });
    const vehiclesGroup = parent.children.find((c) => c.name === 'vehicles') as THREE.Group;
    await vi.waitFor(() => expect(vehiclesGroup.children.length).toBe(1));
    const vehicleGroup = vehiclesGroup.children[0] as THREE.Group;

    // 'car' kind is a multi-mesh vehicle (body + 4 wheels) — exactly the
    // shape the backlog item called out as mattering more than a single mesh.
    const meshes: THREE.Mesh[] = [];
    vehicleGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes.length).toBeGreaterThan(1);

    const uniqueGeometries = Array.from(new Set(meshes.map((m) => m.geometry)));
    const uniqueMaterials = Array.from(new Set(meshes.map((m) => m.material as THREE.Material)));
    const geometrySpies = uniqueGeometries.map((g) => vi.spyOn(g, 'dispose'));
    const materialSpies = uniqueMaterials.map((m) => vi.spyOn(m, 'dispose'));

    await r.refresh(); // despawn — vehicle no longer in the poll result

    expect(vehiclesGroup.children.length).toBe(0);
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalled();
    for (const spy of materialSpies) expect(spy).toHaveBeenCalled();

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('still disposes remaining vehicles on full teardown (dispose())', async () => {
    const parent = new THREE.Group();
    const vehicleRow = { id: 'v2', kind: 'boat', pos_x: 0, pos_y: 0, pos_z: 0, heading: 0 };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ result: { vehicles: [vehicleRow] } }) });
    vi.stubGlobal('fetch', fetchMock);

    const r = createVehicleRenderer(parent, { worldId: 'w' });
    const vehiclesGroup = parent.children.find((c) => c.name === 'vehicles') as THREE.Group;
    await vi.waitFor(() => expect(vehiclesGroup.children.length).toBe(1));
    const vehicleGroup = vehiclesGroup.children[0] as THREE.Group;
    const meshes: THREE.Mesh[] = [];
    vehicleGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const geometrySpies = Array.from(new Set(meshes.map((m) => m.geometry))).map((g) => vi.spyOn(g, 'dispose'));

    r.dispose();

    for (const spy of geometrySpies) expect(spy).toHaveBeenCalled();
    expect(parent.children.length).toBe(0);
  });
});
