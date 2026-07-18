/**
 * Geometric clearance contract — AABB math with hand-derived expected
 * values, plus an end-to-end pass over a small parsed URDF where the
 * overlap/separation outcome is known by construction. This is explicitly
 * a bounding-volume APPROXIMATION, never a physics/dynamics solve — see
 * lib/robotics/urdf-clearance.ts's header. No Math.random anywhere in the
 * module under test (deterministic by construction).
 */

import { describe, it, expect } from 'vitest';
import { parseUrdf } from '@/lib/robotics/urdf-parser';
import { computeUrdfFk, eulerRpyToMat3, IDENTITY3, type Pose } from '@/lib/robotics/urdf-fk';
import {
  aabbForGeometry,
  aabbIntersect,
  computeLinkAabbs,
  computeGeometricClearance,
} from '@/lib/robotics/urdf-clearance';

describe('aabbForGeometry (hand-derived)', () => {
  it('sphere: rotation-invariant, center +/- radius per axis', () => {
    const pose: Pose = { position: [3, 4, 5], rotation: IDENTITY3 };
    const aabb = aabbForGeometry({ kind: 'sphere', radius: 2 }, pose)!;
    expect(aabb.min).toEqual([1, 2, 3]);
    expect(aabb.max).toEqual([5, 6, 7]);
  });

  it('axis-aligned cylinder: local box is [-r,r]x[-r,r]x[-len/2,len/2]', () => {
    const pose: Pose = { position: [0, 0, 0], rotation: IDENTITY3 };
    const aabb = aabbForGeometry({ kind: 'cylinder', radius: 0.5, length: 4 }, pose)!;
    expect(aabb.min[0]).toBeCloseTo(-0.5, 6);
    expect(aabb.min[1]).toBeCloseTo(-0.5, 6);
    expect(aabb.min[2]).toBeCloseTo(-2, 6);
    expect(aabb.max[0]).toBeCloseTo(0.5, 6);
    expect(aabb.max[1]).toBeCloseTo(0.5, 6);
    expect(aabb.max[2]).toBeCloseTo(2, 6);
  });

  it('box rotated 90deg about Z swaps its X/Y extents (hand-derived: size 2x1x1 -> 1x2x1)', () => {
    const pose: Pose = { position: [0, 0, 0], rotation: eulerRpyToMat3([0, 0, Math.PI / 2]) };
    const aabb = aabbForGeometry({ kind: 'box', size: [2, 1, 1] }, pose)!;
    expect(aabb.min[0]).toBeCloseTo(-0.5, 6);
    expect(aabb.max[0]).toBeCloseTo(0.5, 6);
    expect(aabb.min[1]).toBeCloseTo(-1, 6);
    expect(aabb.max[1]).toBeCloseTo(1, 6);
    expect(aabb.min[2]).toBeCloseTo(-0.5, 6);
    expect(aabb.max[2]).toBeCloseTo(0.5, 6);
  });

  it('a mesh geometry has no known extents — never fabricate a bounding volume for it', () => {
    const pose: Pose = { position: [0, 0, 0], rotation: IDENTITY3 };
    const aabb = aabbForGeometry({ kind: 'mesh', filename: 'x.stl', scale: [1, 1, 1] }, pose);
    expect(aabb).toBeNull();
  });
});

describe('aabbIntersect (hand-derived)', () => {
  it('two overlapping boxes report intersection', () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const b = { min: [0.5, 0.5, 0.5] as [number, number, number], max: [1.5, 1.5, 1.5] as [number, number, number] };
    expect(aabbIntersect(a, b)).toBe(true);
  });

  it('two separated boxes report clearance (no intersection)', () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const c = { min: [2, 2, 2] as [number, number, number], max: [3, 3, 3] as [number, number, number] };
    expect(aabbIntersect(a, c)).toBe(false);
  });

  it('boxes that exactly touch at a face count as intersecting (closed-interval convention)', () => {
    const a = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    const b = { min: [1, 0, 0] as [number, number, number], max: [2, 1, 1] as [number, number, number] };
    expect(aabbIntersect(a, b)).toBe(true);
  });
});

// linkA and linkB are both children of `base` (1m boxes centered 0.5m apart
// on X) so they overlap by construction; linkC is a 1m box centered 5m away
// so it's separated by construction. `base` itself (a small box at the
// world origin) sits inside linkA's volume too, but base->linkA is a direct
// joint pair so it must be excluded by the adjacency rule.
const OVERLAP_ROBOT = `
<robot name="clearance_test">
  <link name="base"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
  <link name="linkA"><visual><geometry><box size="1 1 1"/></geometry></visual></link>
  <link name="linkB"><visual><geometry><box size="1 1 1"/></geometry></visual></link>
  <link name="linkC"><visual><geometry><box size="1 1 1"/></geometry></visual></link>
  <link name="sensorLink"><visual><geometry><mesh filename="s.stl" scale="1 1 1"/></geometry></visual></link>
  <joint name="jA" type="fixed"><parent link="base"/><child link="linkA"/><origin xyz="0 0 0"/></joint>
  <joint name="jB" type="fixed"><parent link="base"/><child link="linkB"/><origin xyz="0.5 0 0"/></joint>
  <joint name="jC" type="fixed"><parent link="base"/><child link="linkC"/><origin xyz="5 0 0"/></joint>
  <joint name="jS" type="fixed"><parent link="base"/><child link="sensorLink"/><origin xyz="10 0 0"/></joint>
</robot>
`;

function parseOverlapRobot() {
  const r = parseUrdf(OVERLAP_ROBOT);
  if (!r.ok) throw new Error(r.error);
  return r.robot;
}

describe('computeLinkAabbs', () => {
  it('marks the mesh-only link unchecked and captures its filename, without fabricating a size', () => {
    const robot = parseOverlapRobot();
    const poses = computeUrdfFk(robot, {});
    const aabbs = computeLinkAabbs(robot, poses);
    const sensor = aabbs.find((a) => a.link === 'sensorLink')!;
    expect(sensor.unchecked).toBe(true);
    expect(sensor.aabb).toBeNull();
    expect(sensor.meshFilenames).toEqual(['s.stl']);
  });
});

describe('computeGeometricClearance (end-to-end over a parsed URDF)', () => {
  it('reports linkA/linkB as intersecting, linkA/linkC and linkB/linkC as clear, and excludes adjacent (base,*) pairs', () => {
    const robot = parseOverlapRobot();
    const poses = computeUrdfFk(robot, {});
    const report = computeGeometricClearance(robot, poses);

    expect(report.method).toBe('aabb');
    expect(report.label).toBe('geometric clearance (bounding-volume approximation)');

    // Only non-adjacent, boundable pairs are reported: A-B, A-C, B-C (base-*
    // pairs excluded as adjacent; sensorLink excluded as unchecked/mesh).
    const pairNames = report.pairs.map((p) => [p.linkA, p.linkB].sort().join('/')).sort();
    expect(pairNames).toEqual(['linkA/linkB', 'linkA/linkC', 'linkB/linkC']);

    const ab = report.pairs.find((p) => [p.linkA, p.linkB].sort().join('/') === 'linkA/linkB')!;
    expect(ab.intersects).toBe(true);
    const ac = report.pairs.find((p) => [p.linkA, p.linkB].sort().join('/') === 'linkA/linkC')!;
    expect(ac.intersects).toBe(false);
    const bc = report.pairs.find((p) => [p.linkA, p.linkB].sort().join('/') === 'linkB/linkC')!;
    expect(bc.intersects).toBe(false);

    expect(report.intersectingPairCount).toBe(1);
    expect(report.uncheckedLinks).toEqual(['sensorLink']);
  });

  it('reports ground-plane penetration for links whose AABB dips below z=0', () => {
    const robot = parseOverlapRobot();
    const poses = computeUrdfFk(robot, {});
    const report = computeGeometricClearance(robot, poses, { groundZ: 0 });
    // linkA is a 1m box centered at z=0 -> min.z = -0.5 -> penetrates by 0.5.
    const ga = report.groundContacts.find((g) => g.link === 'linkA');
    expect(ga).toBeDefined();
    expect(ga!.penetration).toBeCloseTo(0.5, 6);
  });

  it('setting ignoreAdjacent:false re-includes base/linkA (which genuinely overlap)', () => {
    const robot = parseOverlapRobot();
    const poses = computeUrdfFk(robot, {});
    const report = computeGeometricClearance(robot, poses, { ignoreAdjacent: false });
    const baseA = report.pairs.find((p) => [p.linkA, p.linkB].sort().join('/') === 'base/linkA');
    expect(baseA).toBeDefined();
    expect(baseA!.intersects).toBe(true);
  });
});
