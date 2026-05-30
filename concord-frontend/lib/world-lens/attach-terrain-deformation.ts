// concord-frontend/lib/world-lens/attach-terrain-deformation.ts
//
// Destructible-world Part A (A3) — the orchestrator that makes terrain
// deformation real end-to-end on the client. It:
//   1. fetches GET /api/worlds/:id/terrain on load → seeds the delta store;
//   2. subscribes to `concordia:terrain-deformed` socket events → patches one
//      cell in the store live;
//   3. on any store change, re-pushes the affected terrain mesh chunk vertices
//      (visual) AND schedules a DEBOUNCED Rapier heightfield collider rebuild
//      (physics) so a dug pit is a real, walk-into-able hole;
//   4. fires a dust `concordia:particle-effect` at the dug cell.
//
// The store is the single source of truth (TerrainRenderer.getElevationAt also
// reads it, so the avatar Y-clamp + raycasts follow the deformed surface).
//
// Guarded by `CONCORD_TERRAIN_DEFORM_RENDER` (default on): when 0, attach is a
// no-op and the scene keeps today's static terrain.
//
// Pure helper `planChunkVertexUpdates` (no three) is unit-tested; the
// orchestrator is a thin consumer.

import { authedHeaders, getInjectedJwt } from '@/lib/auth-bridge';
import {
  setAllDeltas, setCellDelta, setCellSize, snapshotDeltas, subscribe, resetDeformStore, getCellSize,
} from './terrain-deform-store';
import { deltaMapFromRows } from './terrain-deform-math';
import { TERRAIN_MAX_ELEV } from './terrain-deform-constants';

type Vec3 = { x: number; y: number; z: number };

/** Minimal three-ish shapes we touch (kept loose to avoid a hard three dep). */
interface PositionAttr {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
  setY(i: number, v: number): void;
  needsUpdate: boolean;
}
interface ChunkGeometry {
  getAttribute(name: 'position'): PositionAttr;
  computeVertexNormals(): void;
}
interface ChunkMesh {
  position: Vec3;
  geometry: ChunkGeometry;
}

export interface PlannedUpdate {
  i: number;
  newY: number;
}

/**
 * PURE: given a chunk's vertices (local positions + the chunk's world offset),
 * the cumulative cell→delta map, and what's ALREADY baked into the mesh
 * (appliedByCell), return the Y updates needed + the new applied map for the
 * cells this chunk touched. Increments are `cumulative - applied` so repeated
 * events never double-count.
 */
export function planChunkVertexUpdates(
  verts: Array<{ i: number; wx: number; wz: number; curY: number }>,
  cumulative: Map<string, number>,
  appliedByCell: Map<string, number>,
  cellSize: number,
): { updates: PlannedUpdate[]; touchedCells: Map<string, number> } {
  const updates: PlannedUpdate[] = [];
  const touchedCells = new Map<string, number>();
  for (const v of verts) {
    const cx = Math.floor(v.wx / cellSize);
    const cz = Math.floor(v.wz / cellSize);
    const key = `${cx},${cz}`;
    const want = cumulative.get(key) || 0;
    const have = appliedByCell.get(key) || 0;
    const inc = want - have;
    if (inc === 0) continue;
    updates.push({ i: v.i, newY: v.curY + inc });
    touchedCells.set(key, want);
  }
  return { updates, touchedCells };
}

export interface TerrainDeformHandle {
  dispose(): void;
}

export interface AttachTerrainDeformationOpts {
  worldId: string;
  apiBase?: string;
  /** Returns the live terrain THREE.Group (chunk meshes are its children). */
  getTerrainGroup: () => { children: unknown[] } | null;
  /** physics-world singleton with rebuildHeightfieldWithDeltas. */
  physicsWorld: { rebuildHeightfieldWithDeltas?: (m: Map<string, number>, cell?: number, maxElev?: number) => void } | null;
  /** Socket.io-ish client for `concordia:terrain-deformed`. */
  socket?: { on(ev: string, cb: (p: unknown) => void): void; off(ev: string, cb: (p: unknown) => void): void } | null;
  /** Debounce window for the collider rebuild (ms). */
  rebuildDebounceMs?: number;
  enabled?: boolean;
}

export function attachTerrainDeformation(opts: AttachTerrainDeformationOpts): TerrainDeformHandle {
  if (opts.enabled === false) return { dispose() { /* disabled */ } };

  const apiBase = opts.apiBase ?? '';
  const appliedByCell = new Map<string, number>();
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const debounceMs = opts.rebuildDebounceMs ?? 450;

  function scheduleColliderRebuild(): void {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (disposed) return;
      try {
        opts.physicsWorld?.rebuildHeightfieldWithDeltas?.(snapshotDeltas(), undefined, TERRAIN_MAX_ELEV);
      } catch { /* physics optional */ }
    }, debounceMs);
  }

  // Walk the terrain chunk meshes and push the deformed Y onto changed cells.
  function applyToMesh(): void {
    const group = opts.getTerrainGroup?.();
    if (!group || !Array.isArray(group.children)) return;
    const cumulative = snapshotDeltas();
    const cellSize = getCellSizeSafe();
    for (const child of group.children as ChunkMesh[]) {
      const geo = child?.geometry;
      const pos = geo?.getAttribute?.('position');
      if (!pos) continue;
      const ox = child.position?.x ?? 0;
      const oz = child.position?.z ?? 0;
      const verts: Array<{ i: number; wx: number; wz: number; curY: number }> = [];
      for (let i = 0; i < pos.count; i++) {
        verts.push({ i, wx: pos.getX(i) + ox, wz: pos.getZ(i) + oz, curY: pos.getY(i) });
      }
      const { updates } = planChunkVertexUpdates(verts, cumulative, appliedByCell, cellSize);
      if (updates.length === 0) continue;
      for (const u of updates) pos.setY(u.i, u.newY);
      pos.needsUpdate = true;
      try { geo.computeVertexNormals(); } catch { /* ok */ }
    }
    // Mark every cumulative cell as applied (mesh now matches the store).
    appliedByCell.clear();
    for (const [k, v] of cumulative) appliedByCell.set(k, v);
  }

  function getCellSizeSafe(): number {
    return getCellSize();
  }

  // Initial load: fetch the bulk terrain state.
  async function loadInitial(): Promise<void> {
    try {
      const headers = authedHeaders();
      const tok = getInjectedJwt();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${apiBase}/api/worlds/${opts.worldId}/terrain`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as { cellSize?: number; deformations?: Array<{ cell_x: number; cell_z: number; height_delta: number }> };
      if (data?.cellSize) setCellSize(data.cellSize);
      if (Array.isArray(data?.deformations) && data.deformations.length > 0) {
        setAllDeltas(deltaMapFromRows(data.deformations));
      }
    } catch { /* render nothing new on failure */ }
  }

  // Live patch from the socket.
  function onDeformed(payload: unknown): void {
    const p = payload as { cell?: { cx: number; cz: number }; newDelta?: number } | undefined;
    if (!p?.cell || typeof p.newDelta !== 'number') return;
    const key = `${p.cell.cx},${p.cell.cz}`;
    if (setCellDelta(key, p.newDelta)) {
      // dust at the dug cell
      try {
        const cs = getCellSizeSafe();
        const wx = p.cell.cx * cs + cs / 2;
        const wz = p.cell.cz * cs + cs / 2;
        window.dispatchEvent(new CustomEvent('concordia:particle-effect', {
          detail: { type: 'dust', position: { x: wx, y: 1, z: wz }, duration: 700, intensity: 1 },
        }));
      } catch { /* vfx optional */ }
    }
  }

  // React to any store change → mesh re-push + debounced collider rebuild.
  const unsub = subscribe(() => {
    if (disposed) return;
    applyToMesh();
    scheduleColliderRebuild();
  });

  if (opts.socket) opts.socket.on('concordia:terrain-deformed', onDeformed);
  void loadInitial();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = null;
      try { unsub(); } catch { /* ok */ }
      if (opts.socket) { try { opts.socket.off('concordia:terrain-deformed', onDeformed); } catch { /* ok */ } }
      resetDeformStore();
      appliedByCell.clear();
    },
  };
}
