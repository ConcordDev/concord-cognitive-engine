// concord-frontend/lib/world-lens/uprising-crowd-renderer.ts
//
// Render-Everything WS2.7 — uprisings are a VISIBLE CROWD.
//
// The Living Society keystone: a grievance seeds a movement, the movement
// recruits, and at threshold it ERUPTS (status 'acting'). Until now that drama
// lived in server tables + a 2D feed. This renders an erupted uprising as a real
// crowd at the centroid of its rebels' positions (server-resolved): a cluster of
// raised-banner poles + a flickering torch glow, the cluster sized by member
// count, pulsing an angry red. When the uprising resolves (no longer 'acting'),
// the crowd disperses (disposed).
//
// Polls `GET /api/worlds/:id/uprisings` (rows already carry the member centroid;
// rows with null position are skipped — no fake crowds). Pure helper
// `crowdVisual(uprising)` is unit-testable; the renderer is a factory matching
// the other infrastructure-layer renderers.

import * as THREE from "three";

export interface UprisingRow {
  movementId: string;
  targetKind?: string;
  targetId?: string;
  memberCount: number;
  grievance?: number;
  x: number | null;
  z: number | null;
}

export interface UprisingCrowdRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  /** Test seam — supply rows directly instead of fetching. */
  fetchUprisings?: () => Promise<UprisingRow[]>;
}

export interface CrowdVisual {
  /** True when this uprising can be rendered (has a resolved position). */
  renderable: boolean;
  /** Number of banner markers to show (capped). */
  bannerCount: number;
  /** Crowd cluster radius in metres (grows with member count). */
  radius: number;
  /** Anger tint intensity 0..1 (grievance-driven). */
  heat: number;
}

const MAX_BANNERS = 12;
const BANNER_PER_MEMBERS = 3; // one banner per ~3 rebels

/**
 * PURE: map an uprising row to crowd render attributes.
 * renderable === false when the server couldn't resolve a member centroid.
 * bannerCount scales with memberCount (1..MAX_BANNERS); radius grows with the
 * crowd; heat rises with grievance severity (0..10 → 0..1).
 */
export function crowdVisual(u: UprisingRow): CrowdVisual {
  const renderable = u && Number.isFinite(u.x as number) && Number.isFinite(u.z as number);
  const members = Math.max(0, Number(u?.memberCount) || 0);
  const bannerCount = Math.max(1, Math.min(MAX_BANNERS, Math.ceil(members / BANNER_PER_MEMBERS)));
  const radius = Math.max(2, Math.min(12, 2 + members * 0.4));
  const heat = Math.max(0.3, Math.min(1, (Number(u?.grievance) || 0) / 10));
  return { renderable: !!renderable, bannerCount, radius, heat };
}

interface TrackedCrowd {
  group: THREE.Group;
  torch: THREE.PointLight;
  bannerMat: THREE.MeshStandardMaterial;
  heat: number;
}

const BANNER_COLOR = 0x8a1c1c; // rebel crimson

function buildCrowd(visual: CrowdVisual): TrackedCrowd {
  const group = new THREE.Group();
  const bannerMat = new THREE.MeshStandardMaterial({
    color: BANNER_COLOR,
    emissive: new THREE.Color(0x3a0a0a),
    roughness: 0.8,
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b2a17, roughness: 1.0 });

  for (let i = 0; i < visual.bannerCount; i++) {
    const angle = (i / visual.bannerCount) * Math.PI * 2;
    const r = visual.radius * (0.5 + 0.5 * ((i % 3) / 2));
    const bx = Math.cos(angle) * r;
    const bz = Math.sin(angle) * r;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), poleMat);
    pole.position.set(bx, 1.2, bz);
    group.add(pole);

    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), bannerMat);
    banner.position.set(bx + 0.45, 1.9, bz);
    banner.rotation.y = angle;
    group.add(banner);
  }

  // A flickering torch glow at the crowd's heart.
  const torch = new THREE.PointLight(0xff5522, 1.5 * visual.heat, visual.radius * 3, 2);
  torch.position.set(0, 2.0, 0);
  group.add(torch);

  return { group, torch, bannerMat, heat: visual.heat };
}

function disposeCrowd(c: TrackedCrowd, parent: THREE.Group): void {
  try { parent.remove(c.group); } catch { /* idempotent */ }
  c.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) { try { mesh.geometry.dispose(); } catch { /* idempotent */ } }
  });
  try { c.bannerMat.dispose(); } catch { /* idempotent */ }
}

export interface UprisingCrowdRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createUprisingCrowdRenderer(
  parentGroup: THREE.Group,
  opts: UprisingCrowdRendererOpts,
): UprisingCrowdRenderer {
  const pollMs = opts.pollMs ?? 6000;
  const apiBase = opts.apiBase ?? "";
  const url = `${apiBase}/api/worlds/${opts.worldId}/uprisings`;
  const tracked = new Map<string, TrackedCrowd>();
  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function reconcile(rows: UprisingRow[]): void {
    if (disposed) return;
    const seen = new Set<string>();
    for (const u of rows) {
      if (!u || !u.movementId) continue;
      const visual = crowdVisual(u);
      if (!visual.renderable) continue;
      seen.add(u.movementId);
      if (!tracked.has(u.movementId)) {
        const crowd = buildCrowd(visual);
        crowd.group.position.set(Number(u.x), 0, Number(u.z));
        parentGroup.add(crowd.group);
        tracked.set(u.movementId, crowd);
      }
    }
    // Crowds that resolved / dispersed.
    for (const [id, crowd] of tracked) {
      if (!seen.has(id)) {
        disposeCrowd(crowd, parentGroup);
        tracked.delete(id);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      let rows: UprisingRow[];
      if (opts.fetchUprisings) {
        rows = await opts.fetchUprisings();
      } else {
        const headers: Record<string, string> = { Accept: "application/json" };
        const token = opts.authToken ? opts.authToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = (await res.json()) as { uprisings?: UprisingRow[] };
        if (!data || !Array.isArray(data.uprisings)) return;
        rows = data.uprisings;
      }
      reconcile(rows);
    } catch {
      // Network/parse failure → render nothing new.
    }
  }

  void refresh();
  intervalId = setInterval(() => void refresh(), pollMs);

  function update(_delta: number, elapsed: number): void {
    if (disposed) return;
    for (const crowd of tracked.values()) {
      // Torch flicker — pseudo-random brightness modulation.
      const flicker = 0.75 + 0.25 * Math.sin(elapsed * 9 + crowd.group.position.x);
      crowd.torch.intensity = 1.5 * crowd.heat * flicker;
      // Banners sway in the unrest.
      crowd.group.rotation.y = 0.05 * Math.sin(elapsed * 0.8);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    for (const crowd of tracked.values()) disposeCrowd(crowd, parentGroup);
    tracked.clear();
  }

  return { update, dispose, refresh };
}
