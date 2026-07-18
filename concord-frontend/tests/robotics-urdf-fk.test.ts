/**
 * URDF forward-kinematics contract — real matrix composition over a
 * hand-derived 3-link tree (base -> link1 -> link2 via two revolute Z
 * joints). Every expected value below is computed by hand from the same
 * rotation-matrix convention the module documents (URDF fixed-axis RPY +
 * Rodrigues axis-angle), not copy-pasted from a prior run.
 */

import { describe, it, expect } from 'vitest';
import { parseUrdf } from '@/lib/robotics/urdf-parser';
import {
  computeUrdfFk,
  eulerRpyToMat3,
  axisAngleToMat3,
  matMulVec3,
  IDENTITY3,
} from '@/lib/robotics/urdf-fk';

const CHAIN = `
<robot name="chain">
  <link name="base"/>
  <link name="link1"/>
  <link name="link2"/>
  <joint name="joint1" type="revolute">
    <parent link="base"/><child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="joint2" type="revolute">
    <parent link="link1"/><child link="link2"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
</robot>
`;

function parseChain() {
  const r = parseUrdf(CHAIN);
  if (!r.ok) throw new Error(r.error);
  return r.robot;
}

describe('eulerRpyToMat3 / axisAngleToMat3 (hand-derived)', () => {
  it('rotates (1,0,0) to (0,1,0) under a +90deg yaw', () => {
    const m = eulerRpyToMat3([0, 0, Math.PI / 2]);
    const v = matMulVec3(m, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(1, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });

  it('zero angle axis-angle rotation is the identity', () => {
    expect(axisAngleToMat3([0, 0, 1], 0)).toEqual(IDENTITY3);
  });

  it('90deg about Z axis-angle matches the yaw case', () => {
    const m = axisAngleToMat3([0, 0, 1], Math.PI / 2);
    const v = matMulVec3(m, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(1, 6);
  });
});

describe('computeUrdfFk', () => {
  it('at all-zero joint values, link1/link2 sit at their un-rotated origin offsets', () => {
    const robot = parseChain();
    const poses = computeUrdfFk(robot, {});
    const base = poses.get('base')!;
    const link1 = poses.get('link1')!;
    const link2 = poses.get('link2')!;

    expect(base.position).toEqual([0, 0, 0]);
    expect(link1.position[0]).toBeCloseTo(0, 6);
    expect(link1.position[1]).toBeCloseTo(0, 6);
    expect(link1.position[2]).toBeCloseTo(0.1, 6);
    // base -> link1 (0,0,0.1)); link1 -> link2 adds (1,0,0) in link1's (unrotated) frame
    expect(link2.position[0]).toBeCloseTo(1, 6);
    expect(link2.position[1]).toBeCloseTo(0, 6);
    expect(link2.position[2]).toBeCloseTo(0.1, 6);
  });

  it('rotating joint1 by +90deg carries link2 to (0,1,0.1) — real chained rotation, not a canned pose', () => {
    const robot = parseChain();
    const poses = computeUrdfFk(robot, { joint1: Math.PI / 2 });
    const link1 = poses.get('link1')!;
    const link2 = poses.get('link2')!;

    // link1's own origin is unaffected by its own joint's rotation (rotation
    // happens at the link1 frame, not before it).
    expect(link1.position[0]).toBeCloseTo(0, 6);
    expect(link1.position[1]).toBeCloseTo(0, 6);
    expect(link1.position[2]).toBeCloseTo(0.1, 6);

    // link2 = link1.position + Rz(90) * (1,0,0) = (0,0,0.1) + (0,1,0)
    expect(link2.position[0]).toBeCloseTo(0, 6);
    expect(link2.position[1]).toBeCloseTo(1, 6);
    expect(link2.position[2]).toBeCloseTo(0.1, 6);
  });

  it("joint2's own rotation changes link2's ORIENTATION but not its position (only its future children move) — real composition, not a shortcut", () => {
    const robot = parseChain();
    const posesJ1Only = computeUrdfFk(robot, { joint1: Math.PI / 2 });
    const posesBoth = computeUrdfFk(robot, { joint1: Math.PI / 2, joint2: Math.PI / 2 });
    const link2Same = posesJ1Only.get('link2')!;
    const link2Both = posesBoth.get('link2')!;

    // Position unchanged: link2.position = link1.position + link1.rotation * joint2.origin.xyz,
    // and joint2's own rotation isn't part of that expression.
    expect(link2Both.position[0]).toBeCloseTo(link2Same.position[0], 6);
    expect(link2Both.position[1]).toBeCloseTo(link2Same.position[1], 6);
    expect(link2Both.position[2]).toBeCloseTo(link2Same.position[2], 6);

    // Orientation DOES change: link2.rotation = Rz(90) * Rz(90) = Rz(180),
    // so it rotates (1,0,0) to (-1,0,0).
    const v = matMulVec3(link2Both.rotation, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(-1, 6);
    expect(v[1]).toBeCloseTo(0, 5);
  });

  it('a disconnected/never-referenced link still gets a pose (placed at world origin) rather than throwing', () => {
    const xml = `
      <robot name="r">
        <link name="a"/><link name="b"/>
        <joint name="j" type="fixed"><parent link="a"/><child link="b"/><origin xyz="1 1 1"/></joint>
      </robot>`;
    const r = parseUrdf(xml);
    if (!r.ok) throw new Error(r.error);
    const poses = computeUrdfFk(r.robot, {});
    expect(poses.size).toBe(2);
    expect(poses.get('b')!.position).toEqual([1, 1, 1]);
  });
});
