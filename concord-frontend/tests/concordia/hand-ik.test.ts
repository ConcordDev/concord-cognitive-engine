import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createHandIK } from '@/lib/concordia/hand-ik';

function makeArmChain(upperLen = 0.3, lowerLen = 0.27) {
  const root = new THREE.Object3D();
  root.position.set(0, 1.5, 0);
  root.updateMatrixWorld();
  const shoulder = new THREE.Object3D();
  shoulder.position.set(0.18, 0, 0);
  const elbow = new THREE.Object3D();
  elbow.position.set(upperLen, 0, 0);
  const wrist = new THREE.Object3D();
  wrist.position.set(lowerLen, 0, 0);
  root.add(shoulder);
  shoulder.add(elbow);
  elbow.add(wrist);
  root.updateMatrixWorld(true);
  return { root, shoulder, elbow, wrist };
}

describe('createHandIK', () => {
  it('reports unreached when target is beyond arm length', () => {
    const ik = createHandIK(THREE);
    const { shoulder, elbow, wrist } = makeArmChain();
    const res = ik.solve({
      shoulder, elbow, wrist,
      target:   { x: 10, y: 1.5, z: 0 },
      poleHint: { x: 0,  y: 0,   z: 0 },
    });
    expect(res.reached).toBe(false);
  });

  it('reports reached when target is within arm length', () => {
    const ik = createHandIK(THREE);
    const { shoulder, elbow, wrist } = makeArmChain(0.3, 0.27);
    const res = ik.solve({
      shoulder, elbow, wrist,
      target:   { x: 0.4, y: 1.5, z: 0.1 },
      poleHint: { x: 0,   y: -1,  z: 0 },
    });
    expect(res.reached).toBe(true);
  });

  it('blendFactor 0 returns no-op', () => {
    const ik = createHandIK(THREE);
    const { shoulder, elbow, wrist } = makeArmChain();
    const startShoulderQuat = shoulder.quaternion.clone();
    const res = ik.solve({
      shoulder, elbow, wrist,
      target:   { x: 0.4, y: 1.5, z: 0.1 },
      poleHint: { x: 0,   y: -1,  z: 0 },
      blendFactor: 0,
    });
    expect(res.reached).toBe(false);
    expect(shoulder.quaternion.equals(startShoulderQuat)).toBe(true);
  });

  it('mutates shoulder + elbow quaternions on solve', () => {
    const ik = createHandIK(THREE);
    const { shoulder, elbow, wrist } = makeArmChain();
    const beforeShoulder = shoulder.quaternion.clone();
    const beforeElbow = elbow.quaternion.clone();
    ik.solve({
      shoulder, elbow, wrist,
      target:   { x: 0.4, y: 1.6, z: 0.2 },
      poleHint: { x: 0,   y: 0,   z: 0 },
    });
    const shoulderChanged = !shoulder.quaternion.equals(beforeShoulder);
    const elbowChanged = !elbow.quaternion.equals(beforeElbow);
    expect(shoulderChanged || elbowChanged).toBe(true);
  });

  it('handles zero-distance target gracefully', () => {
    const ik = createHandIK(THREE);
    const { shoulder, elbow, wrist } = makeArmChain();
    const shoulderWorld = new THREE.Vector3();
    shoulder.getWorldPosition(shoulderWorld);
    const res = ik.solve({
      shoulder, elbow, wrist,
      target:   { x: shoulderWorld.x, y: shoulderWorld.y, z: shoulderWorld.z },
      poleHint: { x: 0, y: -1, z: 0 },
    });
    expect(res.reached).toBe(false);
    expect(res.reach).toBe(0);
  });
});
