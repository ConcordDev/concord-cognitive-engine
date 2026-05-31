// WAVE WD — World Density (every door opens). Pure, headless decision: when
// should a building's interior become visible? The live trigger (a ConcordiaScene
// listener that calls setInteriorVisible on the named building group) reads this;
// keeping the policy pure makes it testable without a Three.js scene.
//
// Two reveal paths, both gated on CONCORD_WORLD_DENSITY (passed as `enabled`):
//   - door entry: the player clicked/walked into the building within reach, OR
//   - zoom-in:    the camera crossed into the 'interior' zoom band.
// Either is sufficient; both off → hidden (== today).

export type ZoomLevel = 'isometric' | 'mid' | 'close' | 'interior';

export interface InteriorRevealInput {
  /** CONCORD_WORLD_DENSITY flag (client-config). When false → never reveal. */
  enabled: boolean;
  /** Player → building-door planar distance, metres. */
  distanceM: number;
  /** Current camera zoom band. */
  zoomLevel: ZoomLevel;
  /** True for a deliberate door-interact (click / walk-through) this frame. */
  enteredViaDoor?: boolean;
}

/** Proximity gate for a deliberate door entry — mirrors the 4m station gate. */
export const DOOR_REACH_M = 4;
/** Within this planar distance, a zoom-in into the 'interior' band reveals. */
export const ZOOM_REVEAL_RADIUS_M = 24;

/**
 * Decide whether a building interior should be visible this frame.
 * Pure: no Three.js, no DOM. Returns false whenever the feature is disabled.
 */
export function shouldRevealInterior(input: InteriorRevealInput): boolean {
  const { enabled, distanceM, zoomLevel, enteredViaDoor = false } = input;
  if (!enabled) return false;
  if (!(distanceM >= 0)) return false; // NaN / negative → no reveal
  // Path 1 — deliberate door entry within reach.
  if (enteredViaDoor && distanceM <= DOOR_REACH_M) return true;
  // Path 2 — camera zoomed into the interior band while standing near the building.
  if (zoomLevel === 'interior' && distanceM <= ZOOM_REVEAL_RADIUS_M) return true;
  return false;
}
