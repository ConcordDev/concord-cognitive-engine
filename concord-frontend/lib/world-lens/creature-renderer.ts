// concord-frontend/lib/world-lens/creature-renderer.ts
//
// Wave 6 — the CreatureSystem render loop. Polls creature.for_world, builds a
// topology-aware mesh per creature (creature-mesh-builder), reconciles by id,
// lerps toward the server position (the boid flock moves them server-side), and
// ticks each creature's gait. This is what makes the simulated bestiary visible:
// wolves walk as quadrupeds, raptors beat wings, eels undulate, a bred steam-
// drake glows. Mirrors the resource-node / crop renderers' fetch→reconcile shape.

import * as THREE from 'three';
import { createCreatureMesh, type CreatureTopology, type CreatureMeshResult } from './creature-mesh-builder';
import { sampleGroundY } from './coord-frame';
import { loadAsset, instanceFromCache, resolveAssetReference } from './asset-loader';

// Real-asset-first (CC0-sourced GLBs at /public/models/creature/{topology}_NN.glb),
// falling back to the procedural silhouette from creature-mesh-builder for any
// topology without a real variant — same fallback-chain shape used for hero
// meshes and buildings. Warmed once per renderer instance; population is
// fire-and-forget so the first poll's creatures render immediately on the
// (always-available) procedural path and later polls pick up real assets
// once warming resolves.
const REAL_ASSET_TOPOLOGIES: Partial<Record<CreatureTopology, string[]>> = {
  quadruped: ['quadruped_01', 'quadruped_02', 'quadruped_03'],
  winged_biped: ['winged_biped_01'],
};

async function warmRealCreatureAssets(): Promise<Map<CreatureTopology, string[]>> {
  const urls = new Map<CreatureTopology, string[]>();
  for (const [topology, ids] of Object.entries(REAL_ASSET_TOPOLOGIES) as [CreatureTopology, string[]][]) {
    const resolved: string[] = [];
    for (const id of ids) {
      try {
        const loaded = await loadAsset({ kind: 'creature', id }, THREE);
        if (loaded) {
          const url = await resolveAssetReference({ kind: 'creature', id });
          if (url) resolved.push(url);
        }
      } catch { /* this variant unavailable — skip it */ }
    }
    if (resolved.length > 0) urls.set(topology, resolved);
  }
  return urls;
}

function hashU(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  }
  return h / 0xffffffff;
}

/** Wraps a cloned real-asset scene in the same {group, tick, dispose} shape
 *  createCreatureMesh returns, so callers never need to know which path a
 *  given creature took. tick() is a light idle bob — real assets in this
 *  pass have no baked gait animation, so this is honest (no fake walk-cycle)
 *  rather than silently doing nothing. */
function wrapRealCreatureMesh(scene: THREE.Object3D, scale: number): CreatureMeshResult {
  const group = new THREE.Group();
  const inst = scene as THREE.Group;
  inst.scale.setScalar(scale);
  group.add(inst);
  let t = 0;
  return {
    group,
    tick: (dt: number, speed = 0) => {
      t += dt * (1 + Math.min(speed, 3));
      inst.position.y = Math.sin(t * 2) * 0.03 * scale;
    },
    dispose: () => {
      inst.traverse((o) => {
        const mesh = o as unknown as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
      });
    },
  };
}

interface CreatureRow {
  id: string;
  species_id: string;
  x: number; y: number; z: number;
  topology: CreatureTopology;
  clade?: string;
  aquatic?: boolean;
  variant?: string | null;
  coatColor?: string;
}

export interface CreatureRendererOpts {
  worldId: string;
  apiBase?: string;
  pollMs?: number;
  authToken?: () => string | null;
}

interface CreatureRendererHandle {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

interface CreatureEntry {
  mesh: CreatureMeshResult;
  target: THREE.Vector3;
  lastSpeed: number;
}

const SIZE_BY_CLADE: Record<string, number> = {
  fish: 0.6, cephalopod: 0.8, arthropod: 0.6, avian: 0.7, sprite: 0.7,
  reptile: 0.9, mammal: 1.0, construct: 1.0, humanoid: 1.0,
};

export function createCreatureRenderer(
  parentGroup: THREE.Group,
  opts: CreatureRendererOpts,
): CreatureRendererHandle {
  const group = new THREE.Group();
  group.name = 'creatures';
  parentGroup.add(group);

  const entries = new Map<string, CreatureEntry>();
  const pollMs = opts.pollMs ?? 4000;
  const apiBase = opts.apiBase ?? '';
  let disposed = false;
  let lastPoll = 0;
  let polling = false;
  let realAssetUrls = new Map<CreatureTopology, string[]>();
  void warmRealCreatureAssets().then((urls) => { if (!disposed) realAssetUrls = urls; });

  async function refresh(): Promise<void> {
    if (disposed || polling) return;
    polling = true;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const token = opts.authToken ? opts.authToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiBase}/api/lens/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ domain: 'creatures', name: 'for_world', input: { worldId: opts.worldId } }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const rows: CreatureRow[] = json?.result?.creatures ?? [];
      if (disposed) return;
      await reconcile(rows);
    } catch {
      // honest-empty: a failed poll keeps the existing meshes; never throws.
    } finally {
      polling = false;
    }
  }

  async function reconcile(rows: CreatureRow[]): Promise<void> {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      let entry = entries.get(row.id);
      if (!entry) {
        const topology = row.topology || 'quadruped';
        const scale = SIZE_BY_CLADE[row.clade || 'mammal'] ?? 1;
        let mesh: CreatureMeshResult | null = null;
        const variants = realAssetUrls.get(topology);
        if (variants && variants.length > 0) {
          const pick = variants[Math.floor(hashU(row.id + ':variant') * variants.length)];
          try {
            const inst = await instanceFromCache(pick, THREE);
            if (inst) mesh = wrapRealCreatureMesh(inst as THREE.Object3D, scale);
          } catch { /* fall through to procedural for this one creature */ }
        }
        if (!mesh) {
          mesh = createCreatureMesh(THREE, {
            topology,
            coatColor: row.coatColor,
            variant: row.variant,
            scale,
          });
        }
        mesh.group.position.set(row.x, row.y ?? 0, row.z);
        group.add(mesh.group);
        entry = { mesh, target: new THREE.Vector3(row.x, row.y ?? 0, row.z), lastSpeed: 0 };
        entries.set(row.id, entry);
      } else {
        entry.target.set(row.x, row.y ?? 0, row.z);
      }
    }
    // Remove creatures no longer present (dead / despawned / out of range).
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        group.remove(entry.mesh.group);
        entry.mesh.dispose();
        entries.delete(id);
      }
    }
  }

  function update(delta: number, elapsed: number): void {
    if (disposed) return;
    if (elapsed - lastPoll > pollMs / 1000) {
      lastPoll = elapsed;
      void refresh();
    }
    // Lerp toward server target + tick gait by approach speed.
    for (const entry of entries.values()) {
      const pos = entry.mesh.group.position;
      const dist = pos.distanceTo(entry.target);
      entry.lastSpeed = dist;
      if (dist > 0.001) {
        pos.lerp(entry.target, Math.min(1, delta * 3));
        // Face the direction of travel.
        const dx = entry.target.x - pos.x, dz = entry.target.z - pos.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.01) entry.mesh.group.rotation.y = Math.atan2(dx, dz);
      }
      // Plant on the terrain surface — creatures arrive at server Y=0 but the
      // ground is ~40m on the plateau, so without this they'd be buried.
      const gy = sampleGroundY(pos.x, pos.z);
      if (gy !== null) pos.y = gy;
      entry.mesh.tick(delta, dist * 4);
    }
  }

  function dispose(): void {
    disposed = true;
    for (const entry of entries.values()) entry.mesh.dispose();
    entries.clear();
    parentGroup.remove(group);
  }

  // Kick an initial fetch.
  void refresh();

  return { update, dispose, refresh };
}
