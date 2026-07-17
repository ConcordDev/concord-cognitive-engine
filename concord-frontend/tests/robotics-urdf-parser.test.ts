/**
 * URDF parser contract — a small, hand-authored URDF string parsed into the
 * exact link/joint tree it describes, plus honest rejection of malformed
 * documents (no partial/guessed reconstruction). Framework-free: this pins
 * the parse contract without mounting WebGL.
 */

import { describe, it, expect } from 'vitest';
import { parseUrdf } from '@/lib/robotics/urdf-parser';

const TWO_LINK_ARM = `
<robot name="test_arm">
  <link name="base">
    <visual>
      <geometry><box size="0.2 0.2 0.1"/></geometry>
    </visual>
  </link>
  <link name="link1">
    <visual>
      <origin xyz="0.5 0 0" rpy="0 0 0"/>
      <geometry><box size="1 0.1 0.1"/></geometry>
      <material name="steel"><color rgba="0.6 0.6 0.7 1"/></material>
    </visual>
  </link>
  <link name="link2">
    <visual>
      <origin xyz="0.5 0 0" rpy="0 0 0"/>
      <geometry><cylinder radius="0.05" length="1"/></geometry>
    </visual>
  </link>
  <link name="sensor_mount">
    <visual>
      <geometry><mesh filename="package://robot/meshes/sensor.stl" scale="1 1 1"/></geometry>
    </visual>
  </link>
  <joint name="joint1" type="revolute">
    <parent link="base"/>
    <child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="10" velocity="1"/>
  </joint>
  <joint name="joint2" type="revolute">
    <parent link="link1"/>
    <child link="link2"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.57" upper="1.57" effort="5" velocity="1"/>
  </joint>
  <joint name="mount_fixed" type="fixed">
    <parent link="link2"/>
    <child link="sensor_mount"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
  </joint>
</robot>
`;

describe('parseUrdf', () => {
  it('parses a known 4-link / 3-joint URDF into the exact expected tree', () => {
    const r = parseUrdf(TWO_LINK_ARM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.robot.name).toBe('test_arm');
    expect(r.robot.links.map((l) => l.name)).toEqual(['base', 'link1', 'link2', 'sensor_mount']);
    expect(r.robot.joints.map((j) => j.name)).toEqual(['joint1', 'joint2', 'mount_fixed']);

    const link1 = r.robot.links.find((l) => l.name === 'link1')!;
    expect(link1.visuals).toHaveLength(1);
    expect(link1.visuals[0].geometry).toEqual({ kind: 'box', size: [1, 0.1, 0.1] });
    expect(link1.visuals[0].origin.xyz).toEqual([0.5, 0, 0]);
    expect(link1.visuals[0].color).toEqual([0.6, 0.6, 0.7, 1]);

    const link2 = r.robot.links.find((l) => l.name === 'link2')!;
    expect(link2.visuals[0].geometry).toEqual({ kind: 'cylinder', radius: 0.05, length: 1 });

    const sensorMount = r.robot.links.find((l) => l.name === 'sensor_mount')!;
    expect(sensorMount.visuals[0].geometry).toEqual({
      kind: 'mesh',
      filename: 'package://robot/meshes/sensor.stl',
      scale: [1, 1, 1],
    });

    const joint1 = r.robot.joints.find((j) => j.name === 'joint1')!;
    expect(joint1.type).toBe('revolute');
    expect(joint1.parent).toBe('base');
    expect(joint1.child).toBe('link1');
    expect(joint1.origin.xyz).toEqual([0, 0, 0.1]);
    expect(joint1.axis).toEqual([0, 0, 1]);
    expect(joint1.limit).toEqual({ lower: -3.14, upper: 3.14, effort: 10, velocity: 1 });

    const mountFixed = r.robot.joints.find((j) => j.name === 'mount_fixed')!;
    expect(mountFixed.type).toBe('fixed');
    expect(mountFixed.limit).toBeNull();
  });

  it('rejects an empty document honestly rather than returning a synthetic robot', () => {
    const r = parseUrdf('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/empty/i);
  });

  it('rejects a non-<robot> root', () => {
    const r = parseUrdf('<not_a_robot></not_a_robot>');
    expect(r.ok).toBe(false);
  });

  it('rejects a URDF with zero links', () => {
    const r = parseUrdf('<robot name="empty"></robot>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/link/i);
  });

  it('rejects a joint that references an unknown parent/child link', () => {
    const xml = `
      <robot name="bad">
        <link name="a"/>
        <joint name="j1" type="fixed"><parent link="a"/><child link="ghost"/></joint>
      </robot>`;
    const r = parseUrdf(xml);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unknown child link/i);
  });

  it('rejects a link that has two parent joints (not a tree)', () => {
    const xml = `
      <robot name="bad">
        <link name="a"/><link name="b"/><link name="c"/>
        <joint name="j1" type="fixed"><parent link="a"/><child link="c"/></joint>
        <joint name="j2" type="fixed"><parent link="b"/><child link="c"/></joint>
      </robot>`;
    const r = parseUrdf(xml);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/more than one parent/i);
  });

  it('rejects a kinematic cycle', () => {
    const xml = `
      <robot name="bad">
        <link name="a"/><link name="b"/>
        <joint name="j1" type="fixed"><parent link="a"/><child link="b"/></joint>
        <joint name="j2" type="fixed"><parent link="b"/><child link="a"/></joint>
      </robot>`;
    const r = parseUrdf(xml);
    expect(r.ok).toBe(false);
  });

  it('defaults a joint with no <axis> to [1,0,0] and warns on a missing <limit> for a revolute joint', () => {
    const xml = `
      <robot name="r">
        <link name="a"/><link name="b"/>
        <joint name="j1" type="revolute"><parent link="a"/><child link="b"/></joint>
      </robot>`;
    const r = parseUrdf(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.robot.joints[0].axis).toEqual([1, 0, 0]);
    expect(r.robot.joints[0].limit).toBeNull();
    expect(r.warnings.some((w) => /limit/i.test(w))).toBe(true);
  });
});
