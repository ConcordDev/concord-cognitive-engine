// concord-frontend/lib/world-lens/corpse-mesh-renderer.ts
//
// Render-Everything WS3.4 — butchered drops / corpses are real 3D OBJECTS.
//
// When a creature is killed it leaves a `creature_corpses` row (x/y/z, species,
// expiry) that the player can butcher. Today only a 2D HUD card list shows them;
// the world itself has no corpse. This renders each active corpse as a low mound
// mesh at its world position, tinted per-species, gently settling — a thing you
// can see and walk up to, not an inventory row. Removed when the corpse expires
// or is butchered (no longer returned by the endpoint). A faint glint marks an
// un-butchered corpse so loot reads as lootable.
//
// Polls `GET /api/world/creature/corpses/:worldId`. Pure helper
// `corpseVisual(corpse)` is unit-testable; the renderer is a factory matching
// the other infrastructure-layer renderers.

import * as THREE from "three";

export interface CorpseRow {
  id: string;
  species_id?: string;
  x?: number;
  y?: number;
  z?: number;
  expires_at?: number;
}

export interface CorpseMeshRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  /** Test seam — supply rows directly instead of fetching. */
  fetchCorpses?: () => Promise<CorpseRow[]>;
}

export interface CorpseVisual {
  /** 0xRRGGBB tint derived deterministically from the species id. */
  color: number;
  /** Mound footprint scale (metres). */
  scale: number;
}

// Deterministic hue from a species id so the same creature always tints the same.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 360) / 360;
}

/**
 * PURE: map a corpse to its render attributes. Colour is a desaturated,
 * darkened hue keyed to the species (a corpse is dull, not vivid); scale is a
 * small mound. Unknown species → a neutral grey-brown.
 */
export function corpseVisual(corpse: { species_id?: string }): CorpseVisual {
  const sp = String(corpse?.species_id ?? "").trim();
  if (!sp) return { color: 0x5a4a3a, scale: 1.4 };
  const c = new THREE.Color();
  c.setHSL(hashHue(sp), 0.28, 0.32); // low saturation + lightness = dull, dead
  return { color: c.getHex(), scale: 1.4 };
}

interface TrackedCorpse {
  group: THREE.Group;
  glint: THREE.Mesh;
  moundMat: THREE.MeshStandardMaterial;
}

function buildCorpse(visual: CorpseVisual): TrackedCorpse {
  const group = new THREE.Group();
  const moundMat = new THREE.MeshStandardMaterial({ color: visual.color, roughness: 0.95, metalness: 0 });
  // A flattened sphere reads as a slumped carcass.
  const moundGeo = new THREE.SphereGeometry(visual.scale, 10, 8);
  moundGeo.scale(1, 0.45, 1.3);
  const mound = new THREE.Mesh(moundGeo, moundMat);
  mound.position.y = visual.scale * 0.45;
  group.add(mound);

  // A small additive glint so an un-butchered corpse reads as lootable.
  const glintMat = new THREE.MeshBasicMaterial({
    color: 0xffe6a0,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), glintMat);
  glint.position.set(0, visual.scale * 0.9, 0);
  group.add(glint);

  return { group, glint, moundMat };
}

function disposeCorpse(c: TrackedCorpse, parent: THREE.Group): void {
  try { parent.remove(c.group); } catch { /* idempotent */ }
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) { try { m.geometry.dispose(); } catch { /* idempotent */ } }
    if (m.material) { try { (m.material as THREE.Material).dispose(); } catch { /* idempotent */ } }
  });
}

export interface CorpseMeshRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createCorpseMeshRenderer(
  parentGroup: THREE.Group,
  opts: CorpseMeshRendererOpts,
): CorpseMeshRenderer {
  const pollMs = opts.pollMs ?? 8000;
  const apiBase = opts.apiBase ?? "";
  const url = `${apiBase}/api/world/creature/corpses/${opts.worldId}`;
  const tracked = new Map<string, TrackedCorpse>();
  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function reconcile(rows: CorpseRow[]): void {
    if (disposed) return;
    const seen = new Set<string>();
    for (const c of rows) {
      if (!c || !c.id) continue;
      if (!Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.z))) continue;
      seen.add(c.id);
      if (!tracked.has(c.id)) {
        const corpse = buildCorpse(corpseVisual(c));
        corpse.group.position.set(Number(c.x), Number(c.y) || 0, Number(c.z));
        parentGroup.add(corpse.group);
        tracked.set(c.id, corpse);
      }
    }
    for (const [id, corpse] of tracked) {
      if (!seen.has(id)) {
        disposeCorpse(corpse, parentGroup);
        tracked.delete(id);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      let rows: CorpseRow[];
      if (opts.fetchCorpses) {
        rows = await opts.fetchCorpses();
      } else {
        const headers: Record<string, string> = { Accept: "application/json" };
        const token = opts.authToken ? opts.authToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = (await res.json()) as { corpses?: CorpseRow[] };
        if (!data || !Array.isArray(data.corpses)) return;
        rows = data.corpses;
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
    for (const corpse of tracked.values()) {
      // Slow glint pulse so the lootable marker breathes.
      const phase = 0.5 + 0.5 * Math.sin(elapsed * 2 + corpse.group.position.x);
      (corpse.glint.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.45 * phase;
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    for (const corpse of tracked.values()) disposeCorpse(corpse, parentGroup);
    tracked.clear();
  }

  return { update, dispose, refresh };
}
