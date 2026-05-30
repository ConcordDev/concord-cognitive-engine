// Destructible-world Part A — shared constants for the terrain-deform client.
// Kept in their own tiny module so the pure store + the orchestrator + tests
// don't pull in three/Rapier.

/** Default deformation cell size in metres (server CONCORD_TERRAIN_CELL_M, 10). */
export const CELL_SIZE_DEFAULT = 10;

/** Terrain max elevation in metres (client maxElevation, server WORLD scale.y). */
export const TERRAIN_MAX_ELEV = 80;

/** Terrain world size in metres (TERRAIN_SIZE / WORLD_SIZE — both 2000). */
export const TERRAIN_WORLD_SIZE = 2000;
