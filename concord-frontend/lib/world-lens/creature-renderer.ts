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
      reconcile(rows);
    } catch {
      // honest-empty: a failed poll keeps the existing meshes; never throws.
    } finally {
      polling = false;
    }
  }

  function reconcile(rows: CreatureRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      let entry = entries.get(row.id);
      if (!entry) {
        const mesh = createCreatureMesh(THREE, {
          topology: row.topology || 'quadruped',
          coatColor: row.coatColor,
          variant: row.variant,
          scale: SIZE_BY_CLADE[row.clade || 'mammal'] ?? 1,
        });
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
