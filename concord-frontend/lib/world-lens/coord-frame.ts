// World ↔ scene coordinate frame — the single source of truth.
//
// The SERVER places seed content (the world-seeder: buildings + resource nodes)
// in a [0, WORLD_SIZE] frame — the seed city sits at (800, 1000). The FRONTEND
// renders in a frame centred on the origin: the terrain spans
// [-TERRAIN_SIZE/2, +TERRAIN_SIZE/2], the player spawns at (0,0), and the live
// spawners (NPCs, fauna) already place entities around the origin. The two frames
// differ by exactly TERRAIN_SIZE/2 = 1000 in both x and z.
//
// Rule: convert server→scene on the way IN (when rendering or proximity-checking
// server entities) and scene→world on the way OUT (when sending player/scene
// coords to a server endpoint). At this offset the server elevation (nx=x/2000)
// and the frontend terrain elevation (nx=(x+1000)/2000) agree, so shifted
// content sits on the ground.

export const WORLD_TO_SCENE_OFFSET = 1000; // = TERRAIN_SIZE / 2

/** Server world coord → frontend scene coord (scalar). */
export function worldToSceneAxis(v: number): number { return v - WORLD_TO_SCENE_OFFSET; }
/** Frontend scene coord → server world coord (scalar). */
export function sceneToWorldAxis(v: number): number { return v + WORLD_TO_SCENE_OFFSET; }

/** Shift an {x, z[, ...]} from the server world frame into the scene frame. */
export function worldToScene<T extends { x: number; z: number }>(p: T): T {
  return { ...p, x: p.x - WORLD_TO_SCENE_OFFSET, z: p.z - WORLD_TO_SCENE_OFFSET };
}
/** Shift an {x, z[, ...]} from the scene frame back into the server world frame. */
export function sceneToWorld<T extends { x: number; z: number }>(p: T): T {
  return { ...p, x: p.x + WORLD_TO_SCENE_OFFSET, z: p.z + WORLD_TO_SCENE_OFFSET };
}

const coordFrame = { WORLD_TO_SCENE_OFFSET, worldToSceneAxis, sceneToWorldAxis, worldToScene, sceneToWorld };
export default coordFrame;
