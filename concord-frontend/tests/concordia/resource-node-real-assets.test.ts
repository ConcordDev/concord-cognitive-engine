import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// 2026-07-21 — resource nodes previously rendered as flat-color primitive
// shapes with no real asset attempt and no click interaction ("no rendered
// resource nodes or anything else" — the reported gap). Real CC0 tree/bush
// GLBs already existed on disk (public/models/vegetation/) but were never
// tried for tree/herb node kinds. Every built node object is also now
// tagged with userData.isResourceNode + nodeId so ConcordiaScene's canvas
// raycaster can resolve a click back to a specific node.
//
// Test-setup note: createResourceNodeRenderer fires an internal fetch as
// soon as it's constructed (the synchronous portion of its own `void
// refresh()` call runs before the constructor returns). global.fetch MUST
// be stubbed BEFORE calling createResourceNodeRenderer in every test below
// — stubbing it after construction races that internal call and produces
// a flaky, order-dependent failure (caught once during development: the
// depleted-node test intermittently picked up a PRIOR test's still-
// installed fetch mock because the reassignment happened one tick too
// late). vi.resetAllMocks() (not clearAllMocks) in beforeEach because
// clearAllMocks does not undo a prior test's `.mockResolvedValue(...)`.

vi.mock('@/lib/world-lens/asset-loader', () => ({
  loadAsset: vi.fn(),
  instanceFromCache: vi.fn(),
  resolveAssetReference: vi.fn(),
}));

import { instanceFromCache } from '@/lib/world-lens/asset-loader';
import { createResourceNodeRenderer } from '@/lib/world-lens/resource-node-renderer';

function makeGlbGroup(height = 5): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1), new THREE.MeshStandardMaterial());
  mesh.position.y = height / 2;
  g.add(mesh);
  return g;
}

function stubFetch(nodes: Array<Record<string, unknown>>): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, nodes }),
  }));
}

describe('resource-node-renderer — real-asset-first for tree/bush', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries a real tree GLB for a tree node when one is available, and tags it with nodeId', async () => {
    const { loadAsset, resolveAssetReference } = await import('@/lib/world-lens/asset-loader');
    (loadAsset as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (resolveAssetReference as ReturnType<typeof vi.fn>).mockResolvedValue('/models/vegetation/tree_01.glb');
    (instanceFromCache as ReturnType<typeof vi.fn>).mockResolvedValue(makeGlbGroup(8));
    stubFetch([{ id: 'node-1', node_type: 'tree', x: 0, y: 0, z: 0, quantity_remaining: 100, max_quantity: 100 }]);

    const parent = new THREE.Group();
    const renderer = createResourceNodeRenderer(parent, { worldId: 'w1', pollMs: 999999 });
    await renderer.refresh();

    expect(instanceFromCache).toHaveBeenCalled();
    const found = parent.children.find((c) => (c.userData as { nodeId?: string }).nodeId === 'node-1');
    expect(found).toBeTruthy();
    expect((found!.userData as { isResourceNode?: boolean }).isResourceNode).toBe(true);
    expect((found!.userData as { nodeType?: string }).nodeType).toBe('tree');

    renderer.dispose();
  });

  it('falls back to the procedural cone/cylinder tree shape when no real asset is available', async () => {
    const { loadAsset, resolveAssetReference } = await import('@/lib/world-lens/asset-loader');
    (loadAsset as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (resolveAssetReference as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (instanceFromCache as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    stubFetch([{ id: 'node-2', node_type: 'tree', x: 0, y: 0, z: 0, quantity_remaining: 100, max_quantity: 100 }]);

    const parent = new THREE.Group();
    const renderer = createResourceNodeRenderer(parent, { worldId: 'w1', pollMs: 999999 });
    await renderer.refresh();

    const found = parent.children.find((c) => (c.userData as { nodeId?: string }).nodeId === 'node-2') as THREE.Group;
    expect(found).toBeTruthy();
    // Procedural tree is a Group with a cylinder trunk + cone canopy (2 children).
    expect(found.children.length).toBe(2);

    renderer.dispose();
  });

  it('every mesh in a multi-mesh node object is tagged (traverse, not just the root)', async () => {
    const { loadAsset } = await import('@/lib/world-lens/asset-loader');
    (loadAsset as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (instanceFromCache as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    stubFetch([{ id: 'node-3', node_type: 'tree', x: 0, y: 0, z: 0, quantity_remaining: 100, max_quantity: 100 }]);

    const parent = new THREE.Group();
    const renderer = createResourceNodeRenderer(parent, { worldId: 'w1', pollMs: 999999 });
    await renderer.refresh();

    const found = parent.children.find((c) => (c.userData as { nodeId?: string }).nodeId === 'node-3')!;
    let taggedCount = 0;
    found.traverse((child) => {
      if ((child.userData as { nodeId?: string }).nodeId === 'node-3') taggedCount++;
    });
    // root group + trunk mesh + canopy mesh = 3
    expect(taggedCount).toBe(3);

    renderer.dispose();
  });

  it('a depleted node is tagged depleted:true (stump shape, no real-asset attempt)', async () => {
    stubFetch([{ id: 'node-4', node_type: 'tree', x: 0, y: 0, z: 0, quantity_remaining: 0, max_quantity: 100, is_depleted: 1 }]);

    const parent = new THREE.Group();
    const renderer = createResourceNodeRenderer(parent, { worldId: 'w1', pollMs: 999999 });
    await renderer.refresh();

    const found = parent.children.find((c) => (c.userData as { nodeId?: string }).nodeId === 'node-4');
    expect(found).toBeTruthy();
    expect((found!.userData as { depleted?: boolean }).depleted).toBe(true);
    // instanceFromCache must not be called for a depleted stump.
    expect(instanceFromCache).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it('does not throw when asset-loader rejects (network failure) — falls back honestly', async () => {
    const { loadAsset } = await import('@/lib/world-lens/asset-loader');
    (loadAsset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    stubFetch([{ id: 'node-5', node_type: 'herb', x: 0, y: 0, z: 0, quantity_remaining: 100, max_quantity: 100 }]);

    const parent = new THREE.Group();
    const renderer = createResourceNodeRenderer(parent, { worldId: 'w1', pollMs: 999999 });
    await expect(renderer.refresh()).resolves.not.toThrow();
    const found = parent.children.find((c) => (c.userData as { nodeId?: string }).nodeId === 'node-5');
    expect(found).toBeTruthy();

    renderer.dispose();
  });
});
