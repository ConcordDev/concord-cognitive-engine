/**
 * World Doors — Wave G6. Renders interactable doors hinged to each
 * building's front face. Doors swing 90° open via THREE.MathUtils.lerp
 * (existing tween style, no GSAP).
 *
 * Architecture mirrors `dungeon-interior.ts` and `world-props.ts`:
 *   - `buildDoorsForWorld(doors)` returns { group, doorMeshes }
 *   - `attachWorldDoors(scene)` returns { setActive, openDoor, closeDoor, dispose }
 *
 * On `door:opened` / `door:closed` realtime events, the renderer
 * tweens the matching door's rotation toward its target angle.
 */

import * as THREE from 'three';

export interface WorldDoor {
  id: string;
  world_id: string;
  building_id: string;
  hinge_x: number;
  hinge_z: number;
  normal_x: number;
  normal_z: number;
  state: 'closed' | 'opening' | 'open' | 'closing';
  last_opened_at: number | null;
}

interface SceneLike {
  add: (obj: THREE.Object3D) => void;
  remove: (obj: THREE.Object3D) => void;
}

type Cleanup = () => void;

const DOOR_WIDTH = 1.2;
const DOOR_HEIGHT = 2.0;
const DOOR_THICKNESS = 0.08;
const OPEN_ANGLE_DEG = 90;
const TWEEN_DURATION_MS = 400;

interface DoorMesh {
  doorId: string;
  pivot: THREE.Group;
  state: 'closed' | 'open';
  targetAngle: number;
  tweenStartMs: number | null;
  startAngle: number;
  endAngle: number;
}

function buildDoorMesh(d: WorldDoor): DoorMesh {
  // The hinge pivot sits at (hinge_x, 1, hinge_z); the door panel
  // extends along +X in pivot local space so a rotation around Y
  // sweeps it through the wall plane.
  const pivot = new THREE.Group();
  pivot.position.set(d.hinge_x, 1.0, d.hinge_z);
  // Orient pivot so +X local = along the wall (perpendicular to normal).
  const wallAngle = Math.atan2(d.normal_x, d.normal_z);
  pivot.rotation.y = wallAngle;

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, DOOR_THICKNESS),
    new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
  );
  // Move panel so its inner edge is at the pivot.
  panel.position.x = DOOR_WIDTH / 2;
  pivot.add(panel);

  // Handle.
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xc8b070 }),
  );
  handle.position.set(DOOR_WIDTH * 0.85, 0, DOOR_THICKNESS / 2 + 0.04);
  pivot.add(handle);

  // Tag for raycast + door event resolution.
  pivot.userData = { doorId: d.id };
  pivot.traverse((c) => { c.userData = { ...c.userData, doorId: d.id }; });

  const isOpen = d.state === 'open' || d.state === 'opening';
  const targetRad = isOpen ? (OPEN_ANGLE_DEG * Math.PI) / 180 : 0;

  // Apply initial pose. The door rotates around its OWN local Y inside
  // the pivot — but we kept the panel at +X from pivot, so rotating
  // the pivot itself works. Easier: store a child group for the swing.
  const swing = new THREE.Group();
  swing.add(...pivot.children.splice(0));
  swing.rotation.y = targetRad;
  pivot.add(swing);

  return {
    doorId: d.id,
    pivot,
    state: isOpen ? 'open' : 'closed',
    targetAngle: targetRad,
    tweenStartMs: null,
    startAngle: targetRad,
    endAngle: targetRad,
  };
}

export function buildDoorsForWorld(doors: WorldDoor[]): {
  group: THREE.Group;
  doorMeshes: Map<string, DoorMesh>;
} {
  const group = new THREE.Group();
  group.name = 'world-doors';
  const doorMeshes = new Map<string, DoorMesh>();
  for (const d of doors) {
    try {
      const dm = buildDoorMesh(d);
      group.add(dm.pivot);
      doorMeshes.set(d.id, dm);
    } catch { /* skip malformed */ }
  }
  return { group, doorMeshes };
}

export function findDoorAncestor(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const ud = cur.userData as { doorId?: string } | undefined;
    if (ud?.doorId) return ud.doorId;
    cur = cur.parent;
  }
  return null;
}

/**
 * Attach the doors renderer to a scene. Tween each door's pivot when
 * its state changes via openDoor / closeDoor.
 */
export function attachWorldDoors(scene: SceneLike): {
  setActive: (worldId: string | null) => Promise<void>;
  openDoor: (doorId: string) => void;
  closeDoor: (doorId: string) => void;
  getDoorMeshes: () => Map<string, DoorMesh>;
  dispose: Cleanup;
} {
  let current: {
    worldId: string;
    group: THREE.Group;
    doorMeshes: Map<string, DoorMesh>;
  } | null = null;
  let animFrame: number | null = null;
  let disposed = false;

  const detach = () => {
    if (!current) return;
    try { scene.remove(current.group); } catch { /* ok */ }
    current.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) try { m.geometry.dispose(); } catch { /* ok */ }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => { try { mm.dispose(); } catch { /* ok */ } });
      else if (mat?.dispose) try { mat.dispose(); } catch { /* ok */ }
    });
    current = null;
  };

  const setActive = async (worldId: string | null) => {
    if (disposed) return;
    if (current && current.worldId === worldId) return;
    detach();
    if (!worldId) return;
    try {
      const r = await fetch(`/api/world-doors?worldId=${encodeURIComponent(worldId)}`, { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.doors)) return;
      const built = buildDoorsForWorld(j.doors as WorldDoor[]);
      scene.add(built.group);
      current = { worldId, group: built.group, doorMeshes: built.doorMeshes };
    } catch { /* ok */ }
  };

  const flipDoor = (doorId: string, openOrClose: 'open' | 'close') => {
    if (!current) return;
    const dm = current.doorMeshes.get(doorId);
    if (!dm) return;
    const swing = dm.pivot.children[0] as THREE.Group | undefined;
    if (!swing) return;
    dm.startAngle = swing.rotation.y;
    dm.endAngle = openOrClose === 'open' ? (OPEN_ANGLE_DEG * Math.PI) / 180 : 0;
    dm.tweenStartMs = performance.now();
    dm.state = openOrClose === 'open' ? 'open' : 'closed';
  };

  // Tween loop.
  const tick = () => {
    if (disposed) return;
    if (current) {
      const now = performance.now();
      current.doorMeshes.forEach((dm) => {
        if (dm.tweenStartMs == null) return;
        const t = Math.min(1, (now - dm.tweenStartMs) / TWEEN_DURATION_MS);
        // Ease-out quad.
        const ease = 1 - (1 - t) * (1 - t);
        const ang = dm.startAngle + (dm.endAngle - dm.startAngle) * ease;
        const swing = dm.pivot.children[0] as THREE.Group | undefined;
        if (swing) swing.rotation.y = ang;
        if (t >= 1) dm.tweenStartMs = null;
      });
    }
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);

  return {
    setActive,
    openDoor: (id) => flipDoor(id, 'open'),
    closeDoor: (id) => flipDoor(id, 'close'),
    getDoorMeshes: () => current?.doorMeshes ?? new Map(),
    dispose: () => {
      disposed = true;
      if (animFrame != null) cancelAnimationFrame(animFrame);
      detach();
    },
  };
}
