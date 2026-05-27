// Phase E — animator protocol round-trip.
//
// Pins the (de)serialization helpers so the worker boundary doesn't drop
// numeric fields when THREE.Euler / Vector3 instances are flattened to
// plain {x,y,z} objects.

import { describe, it, expect } from 'vitest';
import { Euler, Vector3 } from 'three';
import {
  eulerToSerializable,
  vec3ToSerializable,
  gaitPoseToSerializable,
} from '@/lib/concordia/animator-protocol';

describe('avatar-animator protocol', () => {
  it('serializes THREE.Euler to plain {x,y,z,order}', () => {
    const e = new Euler(0.1, -0.25, 1.234, 'YXZ');
    const s = eulerToSerializable(e);
    expect(s).toEqual({ x: 0.1, y: -0.25, z: 1.234, order: 'YXZ' });
  });

  it('serializes THREE.Vector3 to plain {x,y,z}', () => {
    const v = new Vector3(1, 2, 3);
    const s = vec3ToSerializable(v);
    expect(s).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('round-trips a synthesised gait pose into plain object form', () => {
    // Build a minimal gait-pose-like object that satisfies the interface
    // shape — avoids importing synthesizeGait (which would import movement-styles
    // and ripple into chain of deps not needed for this contract test).
    const pose = {
      hips: new Euler(0.1, 0.2, 0.3),
      hipOffset: new Vector3(0.01, 0.02, 0.03),
      spine: new Euler(0, 0, 0),
      chest: new Euler(0, 0, 0),
      neck: new Euler(0, 0, 0),
      leftUpperLeg: new Euler(0.5, 0, 0),
      leftLowerLeg: new Euler(0.7, 0, 0),
      leftFoot: new Euler(0.1, 0, 0),
      rightUpperLeg: new Euler(-0.5, 0, 0),
      rightLowerLeg: new Euler(-0.7, 0, 0),
      rightFoot: new Euler(-0.1, 0, 0),
      leftUpperArm: new Euler(0.4, 0, 0),
      leftForearm: new Euler(0.6, 0, 0),
      rightUpperArm: new Euler(-0.4, 0, 0),
      rightForearm: new Euler(-0.6, 0, 0),
    };
    const s = gaitPoseToSerializable(pose);
    expect(s.hips).toEqual({ x: 0.1, y: 0.2, z: 0.3, order: 'XYZ' });
    expect(s.hipOffset).toEqual({ x: 0.01, y: 0.02, z: 0.03 });
    expect(s.leftUpperLeg.x).toBeCloseTo(0.5);
    expect(s.rightForearm.x).toBeCloseTo(-0.6);
    // Every key in the GaitPose interface must be present in the
    // serializable form — drift would break the worker boundary.
    for (const key of [
      'hips', 'hipOffset', 'spine', 'chest', 'neck',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
      'leftUpperArm', 'leftForearm',
      'rightUpperArm', 'rightForearm',
    ]) {
      expect(s).toHaveProperty(key);
    }
  });
});
