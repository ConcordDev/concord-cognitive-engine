// concord-frontend/lib/world-lens/water-grid-renderer.ts
//
// Destructible-world Part A (A4) — render the hydrology grid as a DYNAMIC water
// surface. The server flow solver (terrain-water.js) moves water cell-to-cell
// and pools it; `GET /api/worlds/:id/terrain` returns the wet cells
// (`water: [{cell_x,cell_z,water_height}]`). This draws one translucent quad per
// wet cell at `terrainTop(cellCentre) + water_height`, lerps the height between
// polls so a filling ditch reads as a rise, and refetches on the
// `concordia:water-updated` hint (poll fallback). A splash `concordia:particle-
// effect` fires when the player enters a wet cell.
//
// Factory matching the other world renderers: `(parentGroup, opts) => {update,
// dispose, refresh}`. Pure `waterCellQuad(cell, terrainTop)` is unit-testable.
// Guarded by the caller via `CONCORD_HYDRO_RENDER` (mounted only when enabled).

import * as THREE from 'three';

export interface WaterCell {
  cell_x: number;
  cell_z: number;
  water_height: number;
}

export interface WaterCellVisual {
  /** World Y of the water surface (terrain top + column). */
  surfaceY: number;
  /** Opacity scaling with depth (deeper = more opaque). */
  opacity: number;
}

/** PURE: water surface attributes for a cell given its terrain top. */
export function waterCellQuad(cell: WaterCell, terrainTop: number): WaterCellVisual {
  const wh = Math.max(0, Number(cell?.water_height) || 0);
  return {
    surfaceY: terrainTop + wh,
    opacity: Math.max(0.25, Math.min(0.75, 0.3 + wh * 0.12)),
  };
}

export interface WaterGridRendererOpts {
  worldId: string;
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  /** terrain top (base+delta) at a world point; defaults to 0 (flat). */
  elevationAt?: (wx: number, wz: number) => number;
  /** active deformation cell size (metres). */
  cellSize?: number;
  /** socket-ish for the concordia:water-updated refetch hint. */
  socket?: { on(ev: string, cb: (p: unknown) => void): void; off(ev: string, cb: (p: unknown) => void): void } | null;
  /** test seam */
  fetchWater?: () => Promise<WaterCell[]>;
}

interface TrackedCell {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  targetY: number;
  overlapping: boolean; // player currently over this cell (for splash debounce)
}

const WATER_COLOR = 0x2c6ea1;

export interface WaterGridRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createWaterGridRenderer(
  parentGroup: THREE.Group,
  opts: WaterGridRendererOpts,
): WaterGridRenderer {
  const pollMs = opts.pollMs ?? 5000;
  const apiBase = opts.apiBase ?? '';
  const url = `${apiBase}/api/worlds/${opts.worldId}/terrain`;
  const cellSize = opts.cellSize ?? 10;
  const elevationAt = opts.elevationAt ?? (() => 0);
  const tracked = new Map<string, TrackedCell>();
  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function cellCentre(cx: number, cz: number): { x: number; z: number } {
    return { x: cx * cellSize + cellSize / 2, z: cz * cellSize + cellSize / 2 };
  }

  function reconcile(rows: WaterCell[]): void {
    if (disposed) return;
    const seen = new Set<string>();
    for (const c of rows) {
      if (!c || !Number.isFinite(c.cell_x) || !Number.isFinite(c.cell_z)) continue;
      if ((Number(c.water_height) || 0) <= 0) continue;
      const key = `${c.cell_x},${c.cell_z}`;
      seen.add(key);
      const { x, z } = cellCentre(c.cell_x, c.cell_z);
      const visual = waterCellQuad(c, elevationAt(x, z));
      let t = tracked.get(key);
      if (!t) {
        const geo = new THREE.PlaneGeometry(cellSize, cellSize);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          color: WATER_COLOR, transparent: true, opacity: visual.opacity,
          roughness: 0.2, metalness: 0.1, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, visual.surfaceY, z);
        parentGroup.add(mesh);
        t = { mesh, targetY: visual.surfaceY, overlapping: false };
        tracked.set(key, t);
      } else {
        t.targetY = visual.surfaceY;
        t.mesh.material.opacity = visual.opacity;
      }
    }
    for (const [key, t] of tracked) {
      if (!seen.has(key)) {
        try { parentGroup.remove(t.mesh); } catch { /* idempotent */ }
        try { t.mesh.geometry.dispose(); } catch { /* idempotent */ }
        try { t.mesh.material.dispose(); } catch { /* idempotent */ }
        tracked.delete(key);
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      let rows: WaterCell[];
      if (opts.fetchWater) {
        rows = await opts.fetchWater();
      } else {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const token = opts.authToken ? opts.authToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = (await res.json()) as { water?: WaterCell[] };
        if (!data || !Array.isArray(data.water)) return;
        rows = data.water;
      }
      reconcile(rows);
    } catch {
      // Network/parse failure → keep current surface.
    }
  }

  function onWaterUpdated(): void { void refresh(); }

  void refresh();
  intervalId = setInterval(() => void refresh(), pollMs);
  if (opts.socket) opts.socket.on('concordia:water-updated', onWaterUpdated);

  function update(delta: number): void {
    if (disposed) return;
    const lerp = Math.min(1, delta * 2); // ~500ms catch-up so a fill reads as a rise
    const pp = (typeof window !== 'undefined'
      && (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos) || null;
    for (const [key, t] of tracked) {
      const cur = t.mesh.position.y;
      t.mesh.position.y = cur + (t.targetY - cur) * lerp;
      // Splash when the player first enters this wet cell.
      if (pp) {
        const k = `${Math.floor(pp.x / cellSize)},${Math.floor(pp.z / cellSize)}`;
        const over = k === key;
        if (over && !t.overlapping) {
          try {
            window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
              detail: { type: 'splash', position: { x: pp.x, y: t.mesh.position.y, z: pp.z }, duration: 500, intensity: 1 },
            }));
          } catch { /* vfx optional */ }
        }
        t.overlapping = over;
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    if (opts.socket) { try { opts.socket.off('concordia:water-updated', onWaterUpdated); } catch { /* ok */ } }
    for (const t of tracked.values()) {
      try { parentGroup.remove(t.mesh); } catch { /* idempotent */ }
      try { t.mesh.geometry.dispose(); } catch { /* idempotent */ }
      try { t.mesh.material.dispose(); } catch { /* idempotent */ }
    }
    tracked.clear();
  }

  return { update, dispose, refresh };
}
