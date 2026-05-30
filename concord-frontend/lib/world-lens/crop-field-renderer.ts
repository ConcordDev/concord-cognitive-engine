// concord-frontend/lib/world-lens/crop-field-renderer.ts
//
// Concordia world-lens layer: crop fields that visibly GROW.
//
// Reconciles one plant mesh per real crop tile returned by the server.
// A crop tile is { claim_id, tile_x, tile_y, crop_kind, growth_stage(0..3) }.
// The plant mesh scales / recolours by growth_stage (sprout → ripe) and
// sways gently each frame. Removed crops are disposed.
//
// Tile → world mapping: each tile is TILE_METRES (2 m) on a side, so a
// crop at (tile_x, tile_y) sits at world position
//   x = tile_x * TILE_METRES, z = tile_y * TILE_METRES, y = 0 (ground).
// (Mirrors the farm grid convention — FarmTileEditor GRID_W/GRID_H tiles.)
//
// Uses ONLY real server data. Without an injected `fetchCrops` (no
// per-world crops GET endpoint exists at time of writing) nothing renders.
// All network is wrapped in try/catch — on failure the layer renders
// nothing rather than throwing into the render loop.

import * as THREE from "three";

const TILE_METRES = 2;

export interface CropRow {
  claim_id: string;
  tile_x: number;
  tile_y: number;
  crop_kind: string;
  growth_stage: number;
}

export interface CropFieldRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  fetchCrops?: () => Promise<CropRow[]>;
}

export interface CropVisual {
  height: number;
  color: number;
  ripe: boolean;
}

/**
 * PURE: map a crop's kind + growth stage to render attributes.
 * Height grows with stage (0 ≈ 0.1 m sprout … 3 ≈ 0.8 m ripe).
 * Colour lerps from green (young) toward golden (ripe).
 * ripe === true once growth_stage >= 3.
 */
export function cropVisual(crop: { crop_kind: string; growth_stage: number }): CropVisual {
  const stage = Math.max(0, Math.min(3, Number(crop.growth_stage) || 0));
  const t = stage / 3; // 0 .. 1
  const height = 0.1 + t * 0.7; // 0.1 → 0.8

  // Young green (0x4caf50) → golden ripe (0xd4af37).
  const green = new THREE.Color(0x4caf50);
  const golden = new THREE.Color(0xd4af37);
  const color = green.clone().lerp(golden, t).getHex();

  return { height, color, ripe: stage >= 3 };
}

interface CropEntry {
  mesh: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
  stage: number;
  phase: number;
}

interface CropLayerHandle {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

function tileKey(c: CropRow): string {
  return `${c.claim_id}:${c.tile_x}:${c.tile_y}`;
}

export function createCropFieldRenderer(
  parentGroup: THREE.Group,
  opts: CropFieldRendererOpts,
): CropLayerHandle {
  const group = new THREE.Group();
  group.name = "crop-fields";
  parentGroup.add(group);

  const entries = new Map<string, CropEntry>();
  const pollMs = opts.pollMs ?? 15000;
  const apiBase = opts.apiBase ?? "";
  let disposed = false;
  let lastPoll = 0;

  function applyVisual(entry: CropEntry, row: CropRow): void {
    const v = cropVisual(row);
    entry.mesh.scale.set(1, Math.max(0.01, v.height / 0.8), 1);
    entry.mesh.material.color.setHex(v.color);
    entry.mesh.material.emissive.setHex(v.ripe ? 0x332200 : 0x000000);
    entry.stage = row.growth_stage;
  }

  function makeEntry(row: CropRow): CropEntry {
    // Base geometry sized for the ripe (0.8 m) plant; scaled per-stage.
    const geo = new THREE.ConeGeometry(0.18, 0.8, 5);
    geo.translate(0, 0.4, 0); // anchor base at y=0
    const mat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.85 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(row.tile_x * TILE_METRES, 0, row.tile_y * TILE_METRES);
    group.add(mesh);
    const entry: CropEntry = { mesh, stage: row.growth_stage, phase: Math.random() * Math.PI * 2 };
    applyVisual(entry, row);
    return entry;
  }

  function disposeEntry(entry: CropEntry): void {
    group.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
  }

  async function fetchRows(): Promise<CropRow[]> {
    if (opts.fetchCrops) {
      try {
        const rows = await opts.fetchCrops();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    }
    // No injected fetcher and no per-world crops endpoint → render nothing.
    return [];
  }

  function reconcile(rows: CropRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      if (
        !row ||
        typeof row.claim_id !== "string" ||
        !Number.isFinite(row.tile_x) ||
        !Number.isFinite(row.tile_y)
      ) {
        continue;
      }
      const key = tileKey(row);
      seen.add(key);
      let entry = entries.get(key);
      if (!entry) {
        entry = makeEntry(row);
        entries.set(key, entry);
      } else if (entry.stage !== row.growth_stage) {
        applyVisual(entry, row);
      }
    }
    for (const [key, entry] of entries) {
      if (!seen.has(key)) {
        disposeEntry(entry);
        entries.delete(key);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const rows = await fetchRows();
      if (disposed) return;
      reconcile(rows);
    } catch {
      /* render-nothing on failure */
    }
  }

  function update(delta: number, elapsed: number): void {
    void delta;
    if (disposed) return;
    // Poll on cadence.
    if (elapsed * 1000 - lastPoll >= pollMs) {
      lastPoll = elapsed * 1000;
      void refresh();
    }
    // Gentle sway — lean proportional to height so taller plants sway more.
    for (const entry of entries.values()) {
      const sway = Math.sin(elapsed * 1.6 + entry.phase) * 0.06;
      entry.mesh.rotation.z = sway;
      entry.mesh.rotation.x = Math.cos(elapsed * 1.3 + entry.phase) * 0.03;
    }
  }

  function dispose(): void {
    disposed = true;
    for (const entry of entries.values()) disposeEntry(entry);
    entries.clear();
    parentGroup.remove(group);
  }

  // Reference apiBase/authToken so future server-fetch paths can use them
  // without unused-symbol lint noise; harmless no-op today.
  void apiBase;
  void opts.authToken;

  // Kick an initial fetch.
  void refresh();

  return { update, dispose, refresh };
}
