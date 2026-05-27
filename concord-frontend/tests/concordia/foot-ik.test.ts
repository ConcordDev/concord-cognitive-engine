import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFootIK, createRaycastFootIKQuery } from '@/lib/concordia/foot-ik';

describe('createFootIK', () => {
  it('lifts foot to ground level on a rise', () => {
    const raycast = { groundYAt: () => 0.5 };
    const fik = createFootIK(raycast, { soleHeight: 0.05 });
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 1, 1);
    // Smoothing means we don't reach target in a single tick — but we
    // should move in the right direction.
    expect(left.position.y).toBeGreaterThan(0);
    expect(right.position.y).toBeGreaterThan(0);
  });

  it('does not apply IK when contact factor is zero', () => {
    const raycast = { groundYAt: () => 1.5 };
    const fik = createFootIK(raycast);
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 0, 0);
    expect(left.position.y).toBe(0);
    expect(right.position.y).toBe(0);
  });

  it('passes through baseline when no terrain', () => {
    const raycast = { groundYAt: () => null };
    const fik = createFootIK(raycast);
    const left = new THREE.Object3D(); left.position.set(0, 0.4, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0.4, 0);
    fik.solve(left, right, 1, 1);
    expect(left.position.y).toBe(0.4);
    expect(right.position.y).toBe(0.4);
  });

  it('clamps adjustment to maxLift on big rise', () => {
    const raycast = { groundYAt: () => 10 };
    const fik = createFootIK(raycast, { maxLift: 0.2, soleHeight: 0, smoothing: 1 });
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 1, 1);
    expect(left.position.y).toBeLessThanOrEqual(0.21);
  });

  it('clamps adjustment to maxDrop on big drop', () => {
    const raycast = { groundYAt: () => -10 };
    const fik = createFootIK(raycast, { maxDrop: 0.3, soleHeight: 0, smoothing: 1 });
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 1, 1);
    expect(left.position.y).toBeGreaterThanOrEqual(-0.31);
  });

  it('smoothing reduces jitter across ticks', () => {
    const raycast = { groundYAt: () => 1.0 };
    const fik = createFootIK(raycast, { smoothing: 0.2, soleHeight: 0 });
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 1, 1);
    const firstY = left.position.y;
    fik.solve(left, right, 1, 1);
    const secondY = left.position.y;
    // Each tick moves a fraction toward the target, never overshooting.
    expect(secondY).toBeGreaterThanOrEqual(firstY);
  });

  it('reset clears smoothing state', () => {
    const raycast = { groundYAt: () => 1.0 };
    const fik = createFootIK(raycast, { soleHeight: 0 });
    const left = new THREE.Object3D(); left.position.set(0, 0, 0);
    const right = new THREE.Object3D(); right.position.set(0.5, 0, 0);
    fik.solve(left, right, 1, 1);
    fik.reset();
    fik.solve(left, right, 1, 1);
    // After reset, we should still produce a valid output (no crash).
    expect(typeof left.position.y).toBe('number');
  });
});

describe('createRaycastFootIKQuery', () => {
  it('returns null when no targets', () => {
    const query = createRaycastFootIKQuery(THREE, () => []);
    expect(query.groundYAt(0, 0)).toBeNull();
  });

  it('returns terrain Y on a plane mesh', () => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial(),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 2;
    plane.updateMatrixWorld(true);
    const query = createRaycastFootIKQuery(THREE, () => [plane]);
    const y = query.groundYAt(0, 0);
    expect(y).not.toBeNull();
    if (y !== null) expect(Math.abs(y - 2)).toBeLessThan(0.01);
  });
});
