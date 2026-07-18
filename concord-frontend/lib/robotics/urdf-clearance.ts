// concord-frontend/lib/robotics/urdf-clearance.ts
//
// Real geometric clearance check — axis-aligned bounding volumes computed
// from the FK-posed link geometry, pairwise-tested for overlap. This is
// deliberately NOT a physics/dynamics solve: no cannon/rapier or any other
// physics engine is used here (that's a separate, larger deferred item —
// see docs/lens-specs/robotics-capability-map.md's "Simulated physics/
// collision environment" row). Everything below is labeled "geometric
// clearance (bounding-volume approximation)" everywhere it surfaces, never
// "collision-verified safe" — an AABB pass can report a false positive
// (two rotated shapes whose boxes touch but true geometry doesn't) but
// never silently fabricates a result: it is a real, deterministic geometric
// computation from the actual parsed link sizes and actual FK poses.
//
// Framework-free by design — no three.js import — so the math is
// unit-testable without mounting WebGL.

import type { UrdfRobot, UrdfGeometry, Vec3 } from './urdf-types';
import type { Pose, Mat3 } from './urdf-fk';
import { composePose, matMulVec3, vec3Add, eulerRpyToMat3 } from './urdf-fk';

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

function transformPoint(pose: Pose, local: Vec3): Vec3 {
  return vec3Add(pose.position, matMulVec3(pose.rotation, local));
}

function aabbFromPoints(pts: Vec3[]): Aabb {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { min, max };
}

const CORNER_SIGNS: Array<[number, number, number]> = [
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
];

/**
 * World-space AABB for one geometry primitive posed by `pose`. Returns
 * `null` for a mesh reference — its true extents are unknown (no mesh
 * loader in this build) and this function never fabricates a placeholder
 * size to stand in for real geometry.
 */
export function aabbForGeometry(geom: UrdfGeometry, pose: Pose): Aabb | null {
  if (geom.kind === 'sphere') {
    const [cx, cy, cz] = pose.position;
    const r = geom.radius;
    return { min: [cx - r, cy - r, cz - r], max: [cx + r, cy + r, cz + r] };
  }
  if (geom.kind === 'box') {
    const [hx, hy, hz] = [geom.size[0] / 2, geom.size[1] / 2, geom.size[2] / 2];
    const corners = CORNER_SIGNS.map(([sx, sy, sz]) => transformPoint(pose, [sx * hx, sy * hy, sz * hz] as Vec3));
    return aabbFromPoints(corners);
  }
  if (geom.kind === 'cylinder') {
    // The cylinder's local bounding box is exactly [-r,r]x[-r,r]x[-len/2,len/2]
    // (axis along local Z, URDF convention). Transforming that box's 8 corners
    // gives a true superset of the rotated cylinder — conservative but never
    // wrong, which is the right trade-off for a "clearance" check.
    const r = geom.radius, h = geom.length / 2;
    const corners = CORNER_SIGNS.map(([sx, sy, sz]) => transformPoint(pose, [sx * r, sy * r, sz * h] as Vec3));
    return aabbFromPoints(corners);
  }
  return null;
}

export function aabbIntersect(a: Aabb, b: Aabb): boolean {
  return (
    a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
  );
}

export function aabbUnion(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export interface LinkAabb {
  link: string;
  aabb: Aabb | null;
  /** True when the link has no boundable visual geometry (mesh-only or no visuals). */
  unchecked: boolean;
  meshFilenames: string[];
}

/** Union AABB per link from its visual geometries (mesh visuals excluded). */
export function computeLinkAabbs(robot: UrdfRobot, poses: Map<string, Pose>): LinkAabb[] {
  const identityRot: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return robot.links.map((link) => {
    const linkPose = poses.get(link.name) || { position: [0, 0, 0] as Vec3, rotation: identityRot };
    const boxes: Aabb[] = [];
    const meshFilenames: string[] = [];
    for (const v of link.visuals) {
      if (!v.geometry) continue;
      if (v.geometry.kind === 'mesh') { meshFilenames.push(v.geometry.filename); continue; }
      const originPose: Pose = { position: v.origin.xyz, rotation: eulerRpyToMat3(v.origin.rpy) };
      const visualPose = composePose(linkPose, originPose);
      const box = aabbForGeometry(v.geometry, visualPose);
      if (box) boxes.push(box);
    }
    if (boxes.length === 0) return { link: link.name, aabb: null, unchecked: true, meshFilenames };
    return { link: link.name, aabb: boxes.reduce(aabbUnion), unchecked: false, meshFilenames };
  });
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Links directly joined by a joint are expected to touch at the joint — excluded from the pairwise self-check by default, same convention as MoveIt's SRDF "adjacent link" exclusion. */
export function buildAdjacency(robot: UrdfRobot): Set<string> {
  const s = new Set<string>();
  for (const j of robot.joints) s.add(pairKey(j.parent, j.child));
  return s;
}

export interface ClearancePairResult {
  linkA: string;
  linkB: string;
  intersects: boolean;
}
export interface GroundContactResult {
  link: string;
  penetration: number;
}
export interface ClearanceReport {
  method: 'aabb';
  label: 'geometric clearance (bounding-volume approximation)';
  pairs: ClearancePairResult[];
  groundContacts: GroundContactResult[];
  uncheckedLinks: string[];
  intersectingPairCount: number;
}

/**
 * The real geometric clearance pass: pairwise AABB overlap over every
 * non-adjacent link pair, plus a ground-plane (z=0, URDF's Z-up convention)
 * penetration check. NOT a physics/dynamics solve — see the module header.
 */
export function computeGeometricClearance(
  robot: UrdfRobot,
  poses: Map<string, Pose>,
  opts: { groundZ?: number; ignoreAdjacent?: boolean } = {}
): ClearanceReport {
  const groundZ = opts.groundZ ?? 0;
  const ignoreAdjacent = opts.ignoreAdjacent !== false;
  const linkAabbs = computeLinkAabbs(robot, poses);
  const adjacency = ignoreAdjacent ? buildAdjacency(robot) : new Set<string>();

  const uncheckedLinks = linkAabbs.filter((la) => la.unchecked).map((la) => la.link);

  const pairs: ClearancePairResult[] = [];
  for (let i = 0; i < linkAabbs.length; i++) {
    for (let j = i + 1; j < linkAabbs.length; j++) {
      const a = linkAabbs[i], b = linkAabbs[j];
      if (!a.aabb || !b.aabb) continue;
      if (adjacency.has(pairKey(a.link, b.link))) continue;
      pairs.push({ linkA: a.link, linkB: b.link, intersects: aabbIntersect(a.aabb, b.aabb) });
    }
  }

  const groundContacts: GroundContactResult[] = [];
  for (const la of linkAabbs) {
    if (!la.aabb) continue;
    if (la.aabb.min[2] < groundZ) groundContacts.push({ link: la.link, penetration: groundZ - la.aabb.min[2] });
  }

  return {
    method: 'aabb',
    label: 'geometric clearance (bounding-volume approximation)',
    pairs,
    groundContacts,
    uncheckedLinks,
    intersectingPairCount: pairs.filter((p) => p.intersects).length,
  };
}
