/**
 * Resource Node Renderer — surfaces the world's harvestable resource nodes
 * (trees, ore veins, stone, crystal, herbs, springs, fuel) as real 3D meshes
 * inside the Concordia world lens, and makes them VISIBLY DEPLETE as players
 * harvest them.
 *
 * Ground truth: the server endpoint `GET /api/worlds/:worldId/nodes` returns
 * `{ ok, nodes, count }` where each node is a `world_resource_nodes` row:
 *   { id, world_id, node_type, resource_id, resource_name, x, y, z,
 *     quantity_remaining, max_quantity, is_depleted, ... }
 * (see server/routes/worlds.js around the `/:worldId/nodes` GET handler and
 * the table definition in migration 063_world_environment.js).
 *
 * This module renders ONLY real server rows — no demo / fake nodes. On any
 * network or parse failure it renders nothing (honest absence, not a fake
 * placeholder), in keeping with the "VFX never crashes the scene" invariant.
 *
 * Layer contract (ConcordiaScene.tsx ~794-801 + ~1106-1112): a scene layer is
 * a THREE.Group whose `userData.update(delta, elapsed)` runs every frame. This
 * renderer is mounted under a parent Group; the caller drives `update()` from
 * that layer's per-frame loop. The renderer reconciles a Map of nodeId →
 * Object3D under the parent group, lerps each mesh toward its target scale so
 * depletion reads as a smooth shrink, and applies gentle idle motion (tree
 * sway). Removed/depleted nodes dispose their geometry + materials.
 */
import * as THREE from 'three';
import { worldToSceneAxis, sampleGroundY } from './coord-frame';
import { loadAsset, instanceFromCache, resolveAssetReference } from './asset-loader';
import { resolveMaterialUpgrade } from '@/lib/evo-asset/loader';

// ── Wire types ──────────────────────────────────────────────────────────────

export interface ResourceNode {
  id: string;
  world_id?: string;
  node_type: string;
  resource_id?: string;
  resource_name?: string;
  x: number;
  y: number;
  z: number;
  quantity_remaining: number;
  max_quantity: number;
  is_depleted?: number | boolean;
}

export interface ResourceNodeRendererOptions {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
}

export interface ResourceNodeRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export type NodeVisualKind =
  | 'tree'
  | 'rock'
  | 'crystal'
  | 'bush'
  | 'water'
  | 'generic';

export interface NodeVisual {
  kind: NodeVisualKind;
  color: number;
  scale: number;
  depleted: boolean;
}

// ── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Map a server resource-node row to its visual descriptor. PURE and
 * unit-testable: no THREE, no DOM, no network.
 *
 * - scale = clamp(0.35 + 0.65 * remaining/max, 0.2, 1.0) — a full node renders
 *   at 1.0, a near-empty one shrinks toward 0.2.
 * - depleted true when `is_depleted` is set OR remaining <= 0.
 * - node_type → kind + color:
 *     tree                       → tree, green
 *     ore_vein | stone | fuel    → rock, grey
 *     crystal                    → crystal, cyan
 *     herb                       → bush, light-green
 *     spring                     → water, blue
 *     (anything else)            → generic
 */
export function nodeVisual(node: {
  node_type: string;
  quantity_remaining: number;
  max_quantity: number;
  is_depleted?: number | boolean;
}): NodeVisual {
  const max = node.max_quantity > 0 ? node.max_quantity : 1;
  const remaining = Number.isFinite(node.quantity_remaining)
    ? node.quantity_remaining
    : 0;
  const ratio = remaining / max;
  const scale = Math.min(1.0, Math.max(0.2, 0.35 + 0.65 * ratio));
  const depleted = Boolean(node.is_depleted) || remaining <= 0;

  let kind: NodeVisualKind;
  let color: number;
  switch (node.node_type) {
    case 'tree':
      kind = 'tree';
      color = 0x3f8f3a; // green
      break;
    case 'ore_vein':
    case 'stone':
    case 'fuel':
      kind = 'rock';
      color = 0x808080; // grey
      break;
    case 'crystal':
      kind = 'crystal';
      color = 0x35d6e0; // cyan
      break;
    case 'herb':
      kind = 'bush';
      color = 0x9fdf6a; // light-green
      break;
    case 'spring':
      kind = 'water';
      color = 0x3a7fdf; // blue
      break;
    default:
      kind = 'generic';
      color = 0xb0a070; // muted earth
      break;
  }

  return { kind, color, scale, depleted };
}

// ── Mesh construction ────────────────────────────────────────────────────────

interface TrackedNode {
  object: THREE.Object3D;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  kind: NodeVisualKind;
  depleted: boolean;
  targetScale: number;
  swayPhase: number;
}

/** A real-asset candidate: its evo-asset id (used both to resolve the URL
 *  and to look up a promoted material_upgrade) plus the resolved URL. */
interface RealAssetVariant {
  id: string;
  url: string;
}

/**
 * Real-asset-first: try a real GLB for kinds that have one (tree, bush)
 * before falling back to the procedural primitive shape. `realAssetUrls`
 * is pre-warmed once at renderer creation (see `warmRealAssets` below) —
 * this stays synchronous-shaped (returns a Promise but never blocks a
 * caller that doesn't await it) so `reconcile`'s existing structure only
 * needs `await` added, not a rewrite. `variantSeed` picks deterministically
 * among multiple real variants (tree_01..04) so nodes of the same kind
 * aren't visually identical clones.
 */
async function tryRealAsset(
  variants: RealAssetVariant[],
  variantSeed: string,
  targetHeight: number,
): Promise<THREE.Object3D | null> {
  if (variants.length === 0) return null;
  const variant = variants[Math.floor(hashU(variantSeed + ':variant') * variants.length)];
  try {
    const inst = await instanceFromCache(variant.url, THREE);
    if (!inst) return null;
    const cloned = inst as THREE.Object3D;
    const box = new THREE.Box3().setFromObject(cloned);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0.001) cloned.scale.multiplyScalar(targetHeight / size.y);
    cloned.rotation.y = hashU(variantSeed + ':yaw') * Math.PI * 2;
    // Evo-asset material_upgrade: same idiom as BuildingRenderer3D.tsx — if
    // this vegetation asset has a promoted PBR spec, upgrade the loaded
    // GLB's materials in place. Honest-null when no upgrade was ever
    // promoted — a no-op, not a fabricated material.
    try {
      const matUpgrade = await resolveMaterialUpgrade('concordia', variant.id);
      if (matUpgrade) {
        cloned.traverse((child) => {
          const asMesh = child as InstanceType<typeof THREE.Mesh>;
          if (!asMesh.isMesh || !asMesh.material) return;
          const mats = Array.isArray(asMesh.material) ? asMesh.material : [asMesh.material];
          for (const mat of mats) {
            const m = mat as InstanceType<typeof THREE.MeshStandardMaterial> & Record<string, unknown>;
            if (typeof matUpgrade.roughness === 'number' && 'roughness' in m) m.roughness = matUpgrade.roughness;
            if (typeof matUpgrade.metalness === 'number' && 'metalness' in m) m.metalness = matUpgrade.metalness;
            // clearcoat/sheen only on MeshPhysicalMaterial instances.
            if (typeof matUpgrade.clearcoat === 'number' && 'clearcoat' in m) m.clearcoat = matUpgrade.clearcoat;
            if (typeof matUpgrade.clearcoatRoughness === 'number' && 'clearcoatRoughness' in m) m.clearcoatRoughness = matUpgrade.clearcoatRoughness;
            if (typeof matUpgrade.sheen === 'number' && 'sheen' in m) m.sheen = matUpgrade.sheen;
            (m as { needsUpdate?: boolean }).needsUpdate = true;
          }
        });
        cloned.userData.evoMaterialUpgrade = true;
      }
    } catch (matErr) {
      if (typeof console !== 'undefined') console.warn('[resource-node-renderer] material_upgrade skipped, real asset still renders', matErr);
    }
    return cloned;
  } catch {
    return null; // fall through to procedural
  }
}

/** Build the mesh for a node given its visual descriptor. Tries a real
 *  asset first for kinds that have one (see `realAssets` param); the
 *  procedural shape below is the honest fallback when no real asset is
 *  available for this kind, not a placeholder that's meant to be removed. */
async function buildNodeObject(
  visual: NodeVisual,
  nodeId: string,
  realAssets: { tree: RealAssetVariant[]; bush: RealAssetVariant[] },
): Promise<{
  object: THREE.Object3D;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}> {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  if (!visual.depleted) {
    if (visual.kind === 'tree') {
      const real = await tryRealAsset(realAssets.tree, nodeId, 3.5 + hashU(nodeId + ':height') * 2.5);
      if (real) return { object: real, geometries, materials };
    } else if (visual.kind === 'bush') {
      const real = await tryRealAsset(realAssets.bush, nodeId, 0.9 + hashU(nodeId + ':height') * 0.4);
      if (real) return { object: real, geometries, materials };
    }
  }

  if (visual.depleted) {
    // Depleted → a short stump / hollow marker so the spot reads as "spent".
    const geo = new THREE.CylinderGeometry(0.45, 0.55, 0.4, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5a4632,
      roughness: 0.95,
      metalness: 0.0,
    });
    geometries.push(geo);
    materials.push(mat);
    const stump = new THREE.Mesh(geo, mat);
    stump.position.y = 0.2;
    return { object: stump, geometries, materials };
  }

  const group = new THREE.Group();

  switch (visual.kind) {
    case 'tree': {
      const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.0, 6);
      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x6b4a2b,
        roughness: 0.9,
        metalness: 0.0,
      });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.0;
      const canopyGeo = new THREE.ConeGeometry(1.4, 2.6, 8);
      const canopyMat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.85,
        metalness: 0.0,
      });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.y = 3.0;
      group.add(trunk, canopy);
      geometries.push(trunkGeo, canopyGeo);
      materials.push(trunkMat, canopyMat);
      break;
    }
    case 'rock': {
      const geo = new THREE.DodecahedronGeometry(1.0, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.95,
        metalness: 0.1,
        flatShading: true,
      });
      const rock = new THREE.Mesh(geo, mat);
      rock.position.y = 0.7;
      group.add(rock);
      geometries.push(geo);
      materials.push(mat);
      break;
    }
    case 'crystal': {
      const geo = new THREE.OctahedronGeometry(1.0, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.2,
        metalness: 0.3,
        emissive: visual.color,
        emissiveIntensity: 0.25,
        flatShading: true,
      });
      const crystal = new THREE.Mesh(geo, mat);
      crystal.position.y = 1.0;
      group.add(crystal);
      geometries.push(geo);
      materials.push(mat);
      break;
    }
    case 'bush': {
      const geo = new THREE.IcosahedronGeometry(0.7, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.9,
        metalness: 0.0,
        flatShading: true,
      });
      const bush = new THREE.Mesh(geo, mat);
      bush.position.y = 0.6;
      group.add(bush);
      geometries.push(geo);
      materials.push(mat);
      break;
    }
    case 'water': {
      const geo = new THREE.CylinderGeometry(1.1, 1.1, 0.25, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.15,
        metalness: 0.2,
        transparent: true,
        opacity: 0.8,
      });
      const pool = new THREE.Mesh(geo, mat);
      pool.position.y = 0.12;
      group.add(pool);
      geometries.push(geo);
      materials.push(mat);
      break;
    }
    case 'generic':
    default: {
      const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
      const mat = new THREE.MeshStandardMaterial({
        color: visual.color,
        roughness: 0.8,
        metalness: 0.0,
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.y = 0.5;
      group.add(box);
      geometries.push(geo);
      materials.push(mat);
      break;
    }
  }

  return { object: group, geometries, materials };
}

function disposeTracked(tracked: TrackedNode, parentGroup: THREE.Group): void {
  parentGroup.remove(tracked.object);
  for (const geo of tracked.geometries) geo.dispose();
  for (const mat of tracked.materials) mat.dispose();
}

// ── Factory ──────────────────────────────────────────────────────────────────

interface NodesResponse {
  ok?: boolean;
  nodes?: ResourceNode[];
  count?: number;
}

/**
 * Create the resource-node renderer. Polls the server, reconciles meshes under
 * `parentGroup`, and exposes the layer-contract `update`/`dispose` plus an
 * on-demand `refresh`.
 */
export function createResourceNodeRenderer(
  parentGroup: THREE.Group,
  opts: ResourceNodeRendererOptions,
): ResourceNodeRenderer {
  const pollMs = opts.pollMs ?? 5000;
  const apiBase = opts.apiBase ?? '';
  const url = `${apiBase}/api/worlds/${opts.worldId}/nodes`;

  const tracked = new Map<string, TrackedNode>();
  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Real-asset-first: pre-warm the CC0 tree/bush GLBs once at creation
  // (mirrors TreeLayer.tsx's exact pattern) so buildNodeObject's per-node
  // real-asset attempt is a cache hit, not a fresh network fetch, in the
  // common case. loadAsset never throws — a missing variant just leaves
  // that slot out of the array and the node falls back to the existing
  // procedural cone/icosahedron shape (never a fake or blocked node).
  const realAssets: { tree: RealAssetVariant[]; bush: RealAssetVariant[] } = { tree: [], bush: [] };
  const realAssetsReady = (async () => {
    for (const id of ['tree_01', 'tree_02', 'tree_03', 'tree_04']) {
      try {
        const loaded = await loadAsset({ kind: 'vegetation', id }, THREE);
        if (loaded) {
          const assetUrl = await resolveAssetReference({ kind: 'vegetation', id });
          if (assetUrl) realAssets.tree.push({ id, url: assetUrl });
        }
      } catch { /* variant unavailable — skip it */ }
    }
    try {
      const loaded = await loadAsset({ kind: 'vegetation', id: 'bush_01' }, THREE);
      if (loaded) {
        const assetUrl = await resolveAssetReference({ kind: 'vegetation', id: 'bush_01' });
        if (assetUrl) realAssets.bush.push({ id: 'bush_01', url: assetUrl });
      }
    } catch { /* unavailable — skip it */ }
  })();

  // reconcile is async (real-asset lookups await network/cache work) —
  // unlike the old fully-synchronous version, two calls CAN now overlap
  // (the construction-time auto-refresh racing an explicit refresh() or
  // poll tick under slow network). Without serialization, two concurrent
  // calls can both pass the "not yet in `tracked`" check for the same
  // node before either writes back, each building + adding its own
  // object — a real duplicate-mesh bug, not a hypothetical one (caught
  // via a real headless-browser render during development: 5 nodes
  // rendered as 10 objects). `reconcileChain` makes every call wait for
  // the previous one to fully finish before it starts.
  let reconcileChain: Promise<void> = Promise.resolve();
  function reconcile(nodes: ResourceNode[]): Promise<void> {
    reconcileChain = reconcileChain.then(() => reconcileOnce(nodes));
    return reconcileChain;
  }

  async function reconcileOnce(nodes: ResourceNode[]): Promise<void> {
    if (disposed) return;
    await realAssetsReady;

    const seen = new Set<string>();

    for (const node of nodes) {
      if (!node || typeof node.id !== 'string') continue;
      seen.add(node.id);

      const visual = nodeVisual(node);
      const existing = tracked.get(node.id);

      // Plant on the exact visual surface. node.y is the server's getElevation,
      // which differs from the rendered mesh by the noise term (server sin vs
      // client simplex) — up to a few metres of float/sink. Sampling the actual
      // heightmap makes trees/rocks sit flush; fall back to node.y pre-terrain.
      const sx = worldToSceneAxis(node.x);
      const sz = worldToSceneAxis(node.z);
      const ny = sampleGroundY(sx, sz) ?? node.y;

      // Rebuild when the kind or depleted-state changes (different geometry).
      if (existing && (existing.kind === visual.kind) &&
          (existing.depleted === visual.depleted)) {
        existing.targetScale = visual.scale;
        existing.object.position.set(sx, ny, sz);
        continue;
      }

      if (existing) disposeTracked(existing, parentGroup);
      if (disposed) return; // renderer disposed while an await above was in flight

      const built = await buildNodeObject(visual, node.id, realAssets);
      if (disposed) return;
      built.object.position.set(sx, ny, sz);
      const initialScale = existing ? existing.object.scale.x : visual.scale;
      built.object.scale.setScalar(initialScale);
      // Tag every mesh in the (possibly multi-mesh real GLB) object with
      // the node id + a resource-node marker so ConcordiaScene's
      // click-to-gather raycast can resolve a hit back to this node
      // regardless of which sub-mesh the ray actually intersects.
      built.object.userData = { ...built.object.userData, isResourceNode: true, nodeId: node.id, nodeType: node.node_type, depleted: visual.depleted };
      built.object.traverse((child) => {
        child.userData = { ...child.userData, isResourceNode: true, nodeId: node.id, nodeType: node.node_type, depleted: visual.depleted };
      });
      parentGroup.add(built.object);

      tracked.set(node.id, {
        object: built.object,
        geometries: built.geometries,
        materials: built.materials,
        kind: visual.kind,
        depleted: visual.depleted,
        targetScale: visual.scale,
        // Deterministic-ish phase offset from id so trees don't sway in lockstep.
        swayPhase: hashPhase(node.id),
      });
    }

    // Remove nodes no longer present in server data.
    for (const [id, t] of tracked) {
      if (!seen.has(id)) {
        disposeTracked(t, parentGroup);
        tracked.delete(id);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const token = opts.authToken ? opts.authToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, { headers });
      if (!res.ok) return; // honest: render nothing on a bad response
      const data = (await res.json()) as NodesResponse;
      if (!data || !Array.isArray(data.nodes)) return;
      await reconcile(data.nodes);
    } catch {
      // Network/parse failure → render nothing new (no fake nodes).
    }
  }

  // Kick off an immediate fetch + the poll loop.
  void refresh();
  intervalId = setInterval(() => {
    void refresh();
  }, pollMs);

  function update(delta: number, elapsed: number): void {
    if (disposed) return;
    const lerp = Math.min(1, delta * 4); // smooth ~250ms scale catch-up
    for (const t of tracked.values()) {
      // Smooth scale toward target so depletion reads as a shrink.
      const cur = t.object.scale.x;
      const next = cur + (t.targetScale - cur) * lerp;
      t.object.scale.setScalar(next);

      // Gentle idle motion: trees sway, crystals bob/spin subtly.
      if (!t.depleted) {
        if (t.kind === 'tree') {
          t.object.rotation.z =
            Math.sin(elapsed * 0.8 + t.swayPhase) * 0.04;
        } else if (t.kind === 'crystal') {
          t.object.rotation.y += delta * 0.3;
        }
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    for (const [, t] of tracked) {
      disposeTracked(t, parentGroup);
    }
    tracked.clear();
  }

  return { update, dispose, refresh };
}

/** Stable [0, 2π) phase from a node id so motion is varied but deterministic. */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

/** Stable [0, 1) float from a seed string — same FNV-1a technique as
 *  TreeLayer.tsx's own `hashU`, used here to pick a real-asset variant
 *  and jitter its height/yaw deterministically per node id. */
function hashU(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h / 0xffffffff;
}
