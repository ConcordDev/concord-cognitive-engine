/**
 * Death VFX — Wave 1 / T2.3.
 *
 * Subscribes to `world:npc-death` and spawns a short-lived collapse +
 * mist mesh at the NPC's position. Uses primitives only (no model load)
 * so it works for both authored NPCs and procedural hybrids.
 *
 * Visual recipe:
 *   1. A pale slumping capsule that scales toward the ground over 600ms
 *   2. A rising vertical mist cylinder (low-opacity, fades out)
 *   3. A small darkening disc that lingers as a "marker" for ~6s
 *
 * Note: full ragdoll integration with physics-world.spawnRagdoll requires
 * the live NPC mesh registry — that comes in a follow-up. This shipped
 * VFX is the visual closure that tells the player "this NPC died here"
 * without depending on the avatar registry.
 */

import * as THREE from 'three';
import { subscribe } from '@/lib/realtime/socket';

interface NpcDeathPayload {
  worldId: string;
  npcId: string;
  position: { x: number; y: number; z: number };
  impulse: { x: number; y: number; z: number };
  archetype: string | null;
  isCreature: boolean;
}

interface SceneLike {
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
}

interface ActiveDeath {
  npcId: string;
  group: THREE.Group;
  spawnedAt: number;
  durationMs: number;
}

const DEATH_DURATION_MS = 6000;     // total lifespan of the VFX
const SLUMP_DURATION_MS = 600;      // capsule slump animation
const MIST_RISE_MS = 1500;          // mist rises over this window

function buildDeathMesh(payload: NpcDeathPayload): THREE.Group {
  const g = new THREE.Group();

  const tint = payload.isCreature ? 0xc97a4a : 0xd4b896;

  // Slumping capsule — scaled to NPC silhouette
  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.2, 4, 8),
    new THREE.MeshLambertMaterial({ color: tint, transparent: true, opacity: 0.85 }),
  );
  capsule.position.y = 0.8;
  capsule.name = 'slump-capsule';
  g.add(capsule);

  // Mist cylinder
  const mist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 1.5, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xb0c4de, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  mist.position.y = 0.75;
  mist.name = 'mist';
  g.add(mist);

  // Ground marker disc — lingers
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.5 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01;
  disc.name = 'death-disc';
  g.add(disc);

  return g;
}

type Cleanup = () => void;

interface AttachOptions { worldId?: string; }

export function attachDeathVFX(scene: SceneLike, opts: AttachOptions = {}): Cleanup {
  const worldId = opts.worldId || 'concordia-hub';
  const active = new Map<string, ActiveDeath>();
  let animFrame: number | null = null;
  let disposed = false;

  function spawn(payload: NpcDeathPayload) {
    if (disposed) return;
    if (payload.worldId !== worldId) return;
    if (active.has(payload.npcId)) return;
    try {
      const group = buildDeathMesh(payload);
      group.position.set(payload.position.x, payload.position.y, payload.position.z);
      scene.add(group);
      active.set(payload.npcId, {
        npcId: payload.npcId,
        group,
        spawnedAt: performance.now(),
        durationMs: DEATH_DURATION_MS,
      });
    } catch { /* never crash */ }
  }

  function remove(npcId: string) {
    const a = active.get(npcId);
    if (!a) return;
    try { scene.remove(a.group); } catch { /* ok */ }
    a.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
      else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
    });
    active.delete(npcId);
  }

  const unsub = subscribe<NpcDeathPayload>('world:npc-death', spawn);

  const tick = () => {
    if (disposed) return;
    const now = performance.now();
    for (const [, a] of active) {
      const ageMs = now - a.spawnedAt;
      if (ageMs >= a.durationMs) { remove(a.npcId); continue; }

      // Slump phase: capsule shrinks downward over SLUMP_DURATION_MS
      const slumpT = Math.min(1, ageMs / SLUMP_DURATION_MS);
      const capsule = a.group.getObjectByName('slump-capsule') as THREE.Mesh | null;
      if (capsule) {
        capsule.scale.y = 1 - slumpT * 0.85;
        capsule.position.y = 0.8 - slumpT * 0.6;
        const m = capsule.material as THREE.MeshLambertMaterial;
        m.opacity = 0.85 * (1 - slumpT * 0.5);
      }

      // Mist phase: rises + fades
      const mistT = Math.min(1, ageMs / MIST_RISE_MS);
      const mist = a.group.getObjectByName('mist') as THREE.Mesh | null;
      if (mist) {
        mist.position.y = 0.75 + mistT * 0.6;
        mist.scale.set(1 + mistT * 0.3, 1, 1 + mistT * 0.3);
        const m = mist.material as THREE.MeshBasicMaterial;
        m.opacity = 0.18 * (1 - mistT);
      }

      // Disc fades over total lifespan.
      const disc = a.group.getObjectByName('death-disc') as THREE.Mesh | null;
      if (disc) {
        const m = disc.material as THREE.MeshBasicMaterial;
        m.opacity = 0.5 * (1 - ageMs / a.durationMs);
      }
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    if (animFrame != null) cancelAnimationFrame(animFrame);
    try { unsub(); } catch { /* ok */ }
    for (const [npcId] of [...active]) remove(npcId);
    active.clear();
  };
}
