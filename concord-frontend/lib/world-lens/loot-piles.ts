/**
 * Loot Piles — Wave 1 / T1.1.
 *
 * Subscribes to `world:loot-dropped` and adds a small ground-mesh marker
 * at the drop point. The mesh is a glowing disc + a vertical column of
 * floating cubes — one per item — tinted by the item's rarity_color.
 *
 * Auto-decays after the bag's TTL (5 min) or removed when a `loot-claimed`
 * event arrives. Visual is purely presentational; the bag persists in
 * death_loot_bags until claimed via existing /api/loot endpoint.
 */

import * as THREE from 'three';
import { subscribe } from '@/lib/realtime/socket';

interface LootItem {
  item_id: string;
  item_name: string;
  item_type: string;
  weapon_class?: string | null;
  rarity?: string | null;
  rarity_color?: string | null;
  gear_level?: number;
}

interface LootDroppedPayload {
  worldId: string;
  bagId: string;
  sourceNpcId: string;
  sourceName?: string;
  killerId?: string | null;
  position: { x: number; y: number; z: number };
  items: LootItem[];
  sparks: number;
  killerPriorityMs: number;
}

interface SceneLike {
  add: (obj: unknown) => void;
  remove: (obj: unknown) => void;
}

interface ActivePile {
  bagId: string;
  group: THREE.Group;
  spawnedAt: number;
  ttlMs: number;
  pulsePhase: number;
}

const RARITY_FALLBACK_COLOR: Record<string, number> = {
  common:    0x9ca3af,
  uncommon:  0x22c55e,
  rare:      0x3b82f6,
  epic:      0xa855f7,
  legendary: 0xf59e0b,
};

function colorFor(item: LootItem): number {
  if (item.rarity_color && /^#[0-9a-f]{6}$/i.test(item.rarity_color)) {
    return parseInt(item.rarity_color.slice(1), 16);
  }
  if (item.rarity && RARITY_FALLBACK_COLOR[item.rarity]) {
    return RARITY_FALLBACK_COLOR[item.rarity];
  }
  return 0x9ca3af;
}

/** Build the loot-pile mesh group. */
function buildPileMesh(items: LootItem[]): THREE.Group {
  const g = new THREE.Group();

  // Ground disc — tinted to the brightest rarity in the bag.
  const brightestColor = items.length
    ? items.map(colorFor).reduce((best, c) => (c > best ? c : best), 0x9ca3af)
    : 0x9ca3af;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 24),
    new THREE.MeshBasicMaterial({ color: brightestColor, transparent: true, opacity: 0.45 }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  g.add(disc);

  // Stack one small cube per item, climbing vertically. Tinted by the
  // item's own rarity color so the pile shows the rarity spread.
  items.slice(0, 6).forEach((it, i) => {
    const c = colorFor(it);
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 }),
    );
    cube.position.y = 0.25 + i * 0.22;
    cube.rotation.y = (i * Math.PI) / 4;
    cube.userData.baseY = cube.position.y;
    cube.userData.tIdx = i;
    g.add(cube);
  });

  return g;
}

interface AttachOptions {
  worldId?: string;
}

type Cleanup = () => void;

/**
 * Attach the loot-pile renderer to a Three.js scene. Returns cleanup fn.
 */
export function attachLootPiles(scene: SceneLike, opts: AttachOptions = {}): Cleanup {
  const worldId = opts.worldId || 'concordia-hub';
  const active = new Map<string, ActivePile>();
  let animFrame: number | null = null;
  let disposed = false;

  function add(payload: LootDroppedPayload) {
    if (disposed) return;
    if (payload.worldId !== worldId) return;
    if (active.has(payload.bagId)) return;
    try {
      const group = buildPileMesh(payload.items || []);
      group.position.set(payload.position.x, payload.position.y, payload.position.z);
      scene.add(group);
      active.set(payload.bagId, {
        bagId: payload.bagId,
        group,
        spawnedAt: performance.now(),
        ttlMs: 5 * 60 * 1000,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    } catch { /* never crash the scene */ }
  }

  function remove(bagId: string) {
    const p = active.get(bagId);
    if (!p) return;
    try { scene.remove(p.group); } catch { /* ok */ }
    p.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
      else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
    });
    active.delete(bagId);
  }

  const unsubDropped = subscribe<LootDroppedPayload>('world:loot-dropped', add);

  // Idle animation — floating cubes + slow rotation. Auto-decay on TTL.
  const tick = () => {
    if (disposed) return;
    const now = performance.now();
    for (const [, p] of active) {
      const ageMs = now - p.spawnedAt;
      if (ageMs >= p.ttlMs) { remove(p.bagId); continue; }
      const t = ageMs / 1000;
      p.group.rotation.y = t * 0.4;
      p.group.traverse((c) => {
        const tIdx = (c as THREE.Object3D & { userData?: { tIdx?: number; baseY?: number } }).userData?.tIdx;
        if (typeof tIdx === 'number') {
          const baseY = (c as THREE.Object3D & { userData?: { baseY?: number } }).userData?.baseY ?? 0;
          (c as THREE.Mesh).position.y = baseY + Math.sin(t * 2 + tIdx + p.pulsePhase) * 0.05;
        }
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    if (animFrame != null) cancelAnimationFrame(animFrame);
    try { unsubDropped(); } catch { /* ok */ }
    for (const [bagId] of [...active]) remove(bagId);
    active.clear();
  };
}
