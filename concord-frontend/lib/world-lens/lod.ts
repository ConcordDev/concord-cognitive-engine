/**
 * LOD utility for Concordia world meshes — Phase 12 of polish-to-ten.
 *
 * Three.js ships with `THREE.LOD` which switches between meshes at
 * distance thresholds. This wrapper bakes in the four standard bands
 * the spec calls for and exposes a simpler factory API so callers
 * don't have to remember the threshold values.
 *
 * Usage:
 *   const lod = makeStandardLOD(THREE, {
 *     high:      detailedTreeMesh,    // <50m
 *     medium:    midTreeMesh,         // 50–200m
 *     low:       lowTreeMesh,         // 200–500m
 *     billboard: treeBillboardSprite, // 500m+
 *   });
 *   scene.add(lod);
 *
 * Bands chosen to match human visual perception of mesh detail at
 * Concordia's typical view distances. Adjust if perf budget changes.
 */

export interface LODLevels {
  /** Highest detail mesh, shown closest to camera */
  high: unknown;
  /** Mid detail mesh, ~50–200m */
  medium?: unknown;
  /** Low detail mesh, ~200–500m */
  low?: unknown;
  /** Sprite billboard or simplest geometry, 500m+ */
  billboard?: unknown;
}

export interface LODBands {
  highMax:      number; // default 50
  mediumMax:    number; // default 200
  lowMax:       number; // default 500
}

export const STANDARD_LOD_BANDS: LODBands = {
  highMax:   50,
  mediumMax: 200,
  lowMax:    500,
};

export function makeStandardLOD(
  THREE: typeof import('three'),
  levels: LODLevels,
  bands: LODBands = STANDARD_LOD_BANDS,
): InstanceType<typeof import('three').LOD> {
  const lod = new THREE.LOD();

  // THREE.LOD expects levels added in distance-ascending order.
  // addLevel(object, distance) means "show this object when camera is
  // BEYOND distance" — so we layer:
  //   distance 0:        high
  //   distance highMax:  medium (or fallback)
  //   distance mediumMax: low (or fallback)
  //   distance lowMax:   billboard (or fallback)
  const high = levels.high as InstanceType<typeof import('three').Object3D>;
  lod.addLevel(high, 0);

  if (levels.medium) {
    lod.addLevel(levels.medium as InstanceType<typeof import('three').Object3D>, bands.highMax);
  }
  if (levels.low) {
    lod.addLevel(levels.low as InstanceType<typeof import('three').Object3D>, bands.mediumMax);
  }
  if (levels.billboard) {
    lod.addLevel(levels.billboard as InstanceType<typeof import('three').Object3D>, bands.lowMax);
  }

  return lod;
}

/**
 * Distance-cull helper for far props that don't merit a full LOD chain.
 * Sets `mesh.visible = distance < cullAt` based on the supplied camera
 * position. Cheap — one Vector3.distanceTo per mesh per frame.
 *
 * Designed to run inside the existing per-frame update tick. Frustum
 * culling already handles the view-cone case; this catches the
 * "behind the player but still in scene" case at extreme distances.
 */
export function distanceCullMeshes(
  meshes: Iterable<{ position: { distanceTo: (other: unknown) => number }; visible: boolean }>,
  cameraPosition: unknown,
  cullAt: number = 600,
): void {
  for (const m of meshes) {
    const d = m.position.distanceTo(cameraPosition);
    m.visible = d < cullAt;
  }
}
