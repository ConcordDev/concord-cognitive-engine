// concord-frontend/lib/world-lens/claim-boundary-renderer.ts
//
// Concordia world-lens layer: land-claim boundaries.
//
// Fetches the player's real land claims via the macro endpoint
//   POST /api/lens/run { domain: 'land_claims', name: 'list_for_user',
//                        input: { worldId } }
// which returns { ok, claims } where each claim row carries
//   id, owner_user_id, world_id, anchor_x, anchor_z, radius_m, status.
//
// For each claim it draws a boundary RING of radius_m centred at
// (anchor_x, anchor_z) on the ground plane, plus a small banner pole at
// the centre. The ring is tinted by status: active = soft blue,
// seceding/seceded = red (contested). Reconciles + disposes on change.
//
// Uses ONLY real server data. On any network/parse failure the layer
// renders nothing (try/catch). Render nothing when there are no claims.

import * as THREE from "three";

export interface ClaimRow {
  id: string;
  anchor_x: number;
  anchor_z: number;
  radius_m: number;
  owner_user_id?: string;
  status?: string;
}

export interface ClaimBoundaryRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
}

export interface ClaimVisual {
  radius: number;
  color: number;
  tone: "owned" | "contested";
}

const COLOR_OWNED = 0x4a90d9; // soft blue
const COLOR_CONTESTED = 0xd94a4a; // red

/**
 * PURE: map a claim's radius + status to render attributes.
 * radius passes through (clamped to >= 0). seceding/seceded status →
 * contested (red); anything else (active / undefined) → owned (blue).
 */
export function claimVisual(claim: { radius_m: number; status?: string }): ClaimVisual {
  const radius = Math.max(0, Number(claim.radius_m) || 0);
  const status = (claim.status || "active").toLowerCase();
  const contested = status === "seceding" || status === "seceded";
  return {
    radius,
    color: contested ? COLOR_CONTESTED : COLOR_OWNED,
    tone: contested ? "contested" : "owned",
  };
}

interface ClaimEntry {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  banner: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  radius: number;
  status: string;
}

interface ClaimLayerHandle {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createClaimBoundaryRenderer(
  parentGroup: THREE.Group,
  opts: ClaimBoundaryRendererOpts,
): ClaimLayerHandle {
  const group = new THREE.Group();
  group.name = "claim-boundaries";
  parentGroup.add(group);

  const entries = new Map<string, ClaimEntry>();
  const pollMs = opts.pollMs ?? 15000;
  const apiBase = opts.apiBase ?? "";
  let disposed = false;
  let lastPoll = 0;

  function makeRingGeometry(radius: number): THREE.RingGeometry {
    const inner = Math.max(0, radius - 0.5);
    const geo = new THREE.RingGeometry(inner, radius + 0.5, 64);
    geo.rotateX(-Math.PI / 2); // lay flat on the ground plane
    return geo;
  }

  function makeEntry(claim: ClaimRow): ClaimEntry {
    const v = claimVisual(claim);
    const g = new THREE.Group();
    g.position.set(claim.anchor_x, 0.05, claim.anchor_z);

    const ringMat = new THREE.MeshBasicMaterial({
      color: v.color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(makeRingGeometry(v.radius), ringMat);
    g.add(ring);

    // Banner pole at the centre: a thin pole + a small flag plane.
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 6);
    poleGeo.translate(0, 2, 0);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x8a8a8a });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    g.add(pole);

    const bannerGeo = new THREE.PlaneGeometry(1.4, 0.8);
    bannerGeo.translate(0.7, 3.4, 0);
    const bannerMat = new THREE.MeshBasicMaterial({
      color: v.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    g.add(banner);

    group.add(g);
    return { group: g, ring, banner, radius: v.radius, status: claim.status || "active" };
  }

  function applyVisual(entry: ClaimEntry, claim: ClaimRow): void {
    const v = claimVisual(claim);
    if (entry.radius !== v.radius) {
      entry.ring.geometry.dispose();
      entry.ring.geometry = makeRingGeometry(v.radius);
      entry.radius = v.radius;
    }
    entry.ring.material.color.setHex(v.color);
    entry.banner.material.color.setHex(v.color);
    entry.group.position.set(claim.anchor_x, 0.05, claim.anchor_z);
    entry.status = claim.status || "active";
  }

  function disposeEntry(entry: ClaimEntry): void {
    group.remove(entry.group);
    entry.ring.geometry.dispose();
    entry.ring.material.dispose();
    entry.banner.geometry.dispose();
    entry.banner.material.dispose();
    entry.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    });
  }

  async function fetchClaims(): Promise<ClaimRow[]> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = opts.authToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${apiBase}/api/lens/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          domain: "land_claims",
          name: "list_for_user",
          input: { worldId: opts.worldId },
        }),
      });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      if (!body || typeof body !== "object") return [];
      const obj = body as { ok?: boolean; claims?: unknown; result?: { claims?: unknown } };
      const raw = obj.claims ?? obj.result?.claims;
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (c): c is ClaimRow =>
          !!c &&
          typeof c === "object" &&
          typeof (c as ClaimRow).id === "string" &&
          Number.isFinite((c as ClaimRow).anchor_x) &&
          Number.isFinite((c as ClaimRow).anchor_z) &&
          Number.isFinite((c as ClaimRow).radius_m),
      );
    } catch {
      return [];
    }
  }

  function reconcile(claims: ClaimRow[]): void {
    const seen = new Set<string>();
    for (const claim of claims) {
      seen.add(claim.id);
      let entry = entries.get(claim.id);
      if (!entry) {
        entry = makeEntry(claim);
        entries.set(claim.id, entry);
      } else if (entry.radius !== (Number(claim.radius_m) || 0) || entry.status !== (claim.status || "active")) {
        applyVisual(entry, claim);
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        disposeEntry(entry);
        entries.delete(id);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const claims = await fetchClaims();
      if (disposed) return;
      reconcile(claims);
    } catch {
      /* render-nothing on failure */
    }
  }

  function update(delta: number, elapsed: number): void {
    void delta;
    if (disposed) return;
    if (elapsed * 1000 - lastPoll >= pollMs) {
      lastPoll = elapsed * 1000;
      void refresh();
    }
    // Gentle banner flutter.
    for (const entry of entries.values()) {
      entry.banner.rotation.y = Math.sin(elapsed * 2.2) * 0.15;
    }
  }

  function dispose(): void {
    disposed = true;
    for (const entry of entries.values()) disposeEntry(entry);
    entries.clear();
    parentGroup.remove(group);
  }

  void refresh();

  return { update, dispose, refresh };
}
