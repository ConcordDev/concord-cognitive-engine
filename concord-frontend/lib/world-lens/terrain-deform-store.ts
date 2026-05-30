// concord-frontend/lib/world-lens/terrain-deform-store.ts
//
// Destructible-world Part A — the single source of truth for terrain
// deformation deltas on the client. The server's getElevationAt is base+delta;
// this store holds the per-cell delta (metres) so EVERY client consumer agrees:
//   • TerrainRenderer.getElevationAt adds getDeltaAt() → avatar Y-clamp + raycasts
//     sit on the deformed surface;
//   • the terrain mesh chunks displace by the delta (visual);
//   • physics-world.rebuildHeightfieldWithDeltas bakes the same map (collider).
//
// One module-level singleton (the scene is a single world at a time). Pure
// readers (`getDeltaAt`, `cellKeyForWorld`) are unit-testable with no three/DOM.

import { CELL_SIZE_DEFAULT } from './terrain-deform-constants';

let cellSize = CELL_SIZE_DEFAULT;
const deltas = new Map<string, number>(); // "cx,cz" → cumulative delta (metres)
const listeners = new Set<(changed: Set<string>) => void>();

/** Cell key for a world position, using the active cell size. */
export function cellKeyForWorld(wx: number, wz: number): string {
  const cx = Math.floor(wx / cellSize);
  const cz = Math.floor(wz / cellSize);
  return `${cx},${cz}`;
}

/** Delta (metres) at a world position; 0 when undeformed. Hot path — cheap. */
export function getDeltaAt(wx: number, wz: number): number {
  if (deltas.size === 0) return 0;
  return deltas.get(cellKeyForWorld(wx, wz)) || 0;
}

/** Set the active cell size (from the server's GET …/terrain `cellSize`). */
export function setCellSize(size: number): void {
  if (Number.isFinite(size) && size > 0) cellSize = size;
}

export function getCellSize(): number {
  return cellSize;
}

/** Replace the whole delta map (initial load from GET …/terrain). */
export function setAllDeltas(map: Map<string, number>): void {
  const changed = new Set<string>([...deltas.keys(), ...map.keys()]);
  deltas.clear();
  for (const [k, v] of map) if (v !== 0) deltas.set(k, v);
  emit(changed);
}

/** Patch a single cell (live `concordia:terrain-deformed`). Returns true if changed. */
export function setCellDelta(cellKey: string, delta: number): boolean {
  const prev = deltas.get(cellKey) || 0;
  if (prev === delta) return false;
  if (delta === 0) deltas.delete(cellKey);
  else deltas.set(cellKey, delta);
  emit(new Set([cellKey]));
  return true;
}

/** Snapshot of all deltas (for the collider rebuild + mesh apply). */
export function snapshotDeltas(): Map<string, number> {
  return new Map(deltas);
}

export function subscribe(cb: (changed: Set<string>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reset (scene teardown / world switch). */
export function resetDeformStore(): void {
  deltas.clear();
  cellSize = CELL_SIZE_DEFAULT;
  listeners.clear();
}

function emit(changed: Set<string>): void {
  for (const cb of listeners) {
    try { cb(changed); } catch { /* listener must not break the store */ }
  }
}
