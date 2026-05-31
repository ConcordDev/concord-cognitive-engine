// concord-frontend/lib/world-lens/vehicle-renderer.ts
//
// Wave 7b — the VehicleSystem render loop. Vehicles were fully simulated
// (world_vehicles: spawn, mount, occupants, fare, move) but had ZERO in-world
// render and the discovery chain was severed (the concordia:proximity-update
// listener exists but was never dispatched). This polls vehicles.list_in_world,
// builds a recognizable mesh per kind, reconciles by id, and — using the player
// position the avatar system publishes — dispatches concordia:proximity-update
// so the "V: Mount" prompt finally appears near a vehicle.

import * as THREE from 'three';

interface VehicleRow {
  id: string;
  kind: string;
  owner_kind?: string;
  capacity?: number;
  pos_x: number; pos_y?: number; pos_z: number;
  heading?: number;
}

export interface VehicleRendererOpts {
  worldId: string;
  apiBase?: string;
  pollMs?: number;
  authToken?: () => string | null;
}

interface VehicleRendererHandle {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

interface VehicleEntry {
  group: THREE.Group;
  target: THREE.Vector3;
  heading: number;
  kind: string;
}

const KIND_COLOR: Record<string, number> = {
  cart: 0x8b5a2b, carriage: 0x6b4423, boat: 0x4a6a8a, canal_taxi: 0x3a7a9a,
  car: 0xb03030, motorcycle: 0x303030, hovercraft: 0x40a0c0, spaceship: 0xc0c0d0,
  glider: 0xd0c060,
};
const MOUNT_PROMPT_RADIUS = 6;

function buildVehicleMesh(kind: string): THREE.Group {
  const g = new THREE.Group();
  g.name = `vehicle_${kind}`;
  const color = KIND_COLOR[kind] ?? 0x888888;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: kind === 'spaceship' || kind === 'hovercraft' ? 0.7 : 0.1 });

  if (kind === 'boat' || kind === 'canal_taxi') {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 3), mat);
    hull.position.y = 0.3; g.add(hull);
    const prow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1, 4), mat);
    prow.rotation.x = Math.PI / 2; prow.position.set(0, 0.3, 1.8); g.add(prow);
  } else if (kind === 'motorcycle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 1.6), mat);
    body.position.y = 0.6; g.add(body);
    addWheels(g, mat, 0.4, 0.7);
  } else if (kind === 'spaceship') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 2, 6, 12), mat);
    body.rotation.x = Math.PI / 2; body.position.y = 0.8; g.add(body);
  } else if (kind === 'hovercraft' || kind === 'glider') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2.4), mat);
    body.position.y = 0.7; g.add(body);
    if (kind === 'glider') {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, 0.8), mat);
      wing.position.y = 1.0; g.add(wing);
    }
  } else {
    // cart / carriage / car — a body on wheels.
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.4), mat);
    body.position.y = 0.7; g.add(body);
    addWheels(g, mat, 0.7, 0.9);
  }
  return g;
}

function addWheels(g: THREE.Group, mat: THREE.Material, halfW: number, halfL: number): void {
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.9 });
  const wGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 12);
  for (const sx of [-halfW, halfW]) {
    for (const sz of [-halfL, halfL]) {
      const w = new THREE.Mesh(wGeom, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx, 0.35, sz);
      g.add(w);
    }
  }
  void mat;
}

declare global {
  interface Window { __concordiaPlayerPos?: { x: number; y: number; z: number } }
}

export function createVehicleRenderer(
  parentGroup: THREE.Group,
  opts: VehicleRendererOpts,
): VehicleRendererHandle {
  const group = new THREE.Group();
  group.name = 'vehicles';
  parentGroup.add(group);

  const entries = new Map<string, VehicleEntry>();
  const pollMs = opts.pollMs ?? 5000;
  const apiBase = opts.apiBase ?? '';
  let disposed = false;
  let lastPoll = 0;
  let polling = false;
  let lastPromptId: string | null = null;

  async function refresh(): Promise<void> {
    if (disposed || polling) return;
    polling = true;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const token = opts.authToken ? opts.authToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiBase}/api/lens/run`, {
        method: 'POST', headers,
        body: JSON.stringify({ domain: 'vehicles', name: 'list_in_world', input: { worldId: opts.worldId } }),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (disposed) return;
      reconcile(json?.result?.vehicles ?? []);
    } catch { /* honest-empty */ } finally { polling = false; }
  }

  function reconcile(rows: VehicleRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      let entry = entries.get(row.id);
      if (!entry) {
        const g = buildVehicleMesh(row.kind);
        g.position.set(row.pos_x, row.pos_y ?? 0, row.pos_z);
        g.rotation.y = row.heading ?? 0;
        group.add(g);
        entry = { group: g, target: new THREE.Vector3(row.pos_x, row.pos_y ?? 0, row.pos_z), heading: row.heading ?? 0, kind: row.kind };
        entries.set(row.id, entry);
      } else {
        entry.target.set(row.pos_x, row.pos_y ?? 0, row.pos_z);
        entry.heading = row.heading ?? entry.heading;
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) { group.remove(entry.group); entries.delete(id); }
    }
  }

  function update(delta: number, elapsed: number): void {
    if (disposed) return;
    if (elapsed - lastPoll > pollMs / 1000) { lastPoll = elapsed; void refresh(); }
    const playerPos = typeof window !== 'undefined' ? window.__concordiaPlayerPos : null;
    let nearest: { id: string; kind: string; dist: number; pos: THREE.Vector3 } | null = null;
    for (const [id, entry] of entries) {
      entry.group.position.lerp(entry.target, Math.min(1, delta * 4));
      entry.group.rotation.y += (entry.heading - entry.group.rotation.y) * Math.min(1, delta * 4);
      if (playerPos) {
        const d = Math.hypot(playerPos.x - entry.group.position.x, playerPos.z - entry.group.position.z);
        if (d < MOUNT_PROMPT_RADIUS && (!nearest || d < nearest.dist)) {
          nearest = { id, kind: entry.kind, dist: d, pos: entry.group.position };
        }
      }
    }
    // Wave 7b — fire the proximity event the HUD already listens for (the
    // discovery break). Only re-dispatch when the nearest target changes.
    if (typeof window !== 'undefined' && nearest && nearest.id !== lastPromptId) {
      lastPromptId = nearest.id;
      window.dispatchEvent(new CustomEvent('concordia:proximity-update', {
        detail: { kind: 'vehicle', id: nearest.id, label: `Mount ${nearest.kind}`, key: 'V',
          position: { x: nearest.pos.x, y: nearest.pos.y, z: nearest.pos.z } },
      }));
    } else if (!nearest && lastPromptId) {
      lastPromptId = null;
      window.dispatchEvent(new CustomEvent('concordia:proximity-update', { detail: null }));
    }
  }

  function dispose(): void {
    disposed = true;
    for (const entry of entries.values()) {
      entry.group.traverse((m) => {
        const mesh = m as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } };
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
      });
    }
    entries.clear();
    parentGroup.remove(group);
  }

  void refresh();
  return { update, dispose, refresh };
}
