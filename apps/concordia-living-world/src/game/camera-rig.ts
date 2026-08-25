/** Over-the-shoulder chase cam (SR2-style). Extends existing camYaw/camPitch. */

import * as THREE from "three";
import { heightAt } from "./life";
import type { WorldId } from "./content";
import type { Motion } from "./locomotion";
import type { Collider } from "./layout";

export function chaseCamera(opts: {
  px: number;
  pz: number;
  hop: number;
  camYaw: number;
  camPitch: number;
  motion: Motion;
  world: WorldId;
  dt: number;
  punch: number;
  shake: { x: number; y: number };
  sprinting: boolean;
  locked: { x: number; z: number } | null;
  cam: THREE.Camera;
  colliders?: Collider[];
  inCombat?: boolean;
}): void {
  const groundY = heightAt(opts.world, opts.px, opts.pz);
  const hop = opts.hop;
  const lookAhead = 0.18;
  const ax = opts.motion.vx * lookAhead;
  const az = opts.motion.vz * lookAhead;
  const cfwdX = -Math.sin(opts.camYaw);
  const cfwdZ = -Math.cos(opts.camYaw);
  const rx = Math.cos(opts.camYaw);
  const rz = -Math.sin(opts.camYaw);

  let lookX = opts.px + ax + cfwdX * 1.35;
  let lookZ = opts.pz + az + cfwdZ * 1.35;
  const lookY = 1.18 + groundY + hop * 0.2;
  if (opts.locked) {
    lookX = THREE.MathUtils.lerp(lookX, opts.locked.x, 0.18);
    lookZ = THREE.MathUtils.lerp(lookZ, opts.locked.z, 0.18);
  }

  const distBase =
    opts.sprinting && opts.motion.gait === "sprint" ? 7.4 : opts.inCombat ? 5.6 : 6.6;
  const dist = distBase + opts.punch * 0.4;
  const shoulder = opts.locked ? 0.14 : 0.42;
  const height = 1.55 + groundY + hop * 0.08 - opts.camPitch * 1.7;

  let useDist = dist;
  const samples = 7;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const sx = lookX - cfwdX * dist * t + rx * shoulder;
    const sz = lookZ - cfwdZ * dist * t + rz * shoulder;
    const sy = THREE.MathUtils.lerp(lookY + 0.35, height, t);
    const gy = heightAt(opts.world, sx, sz) + 0.55;
    if (sy < gy) {
      useDist = Math.max(1.85, dist * (t * 0.88));
      break;
    }
  }

  const desiredX = lookX - cfwdX * useDist + rx * shoulder + opts.shake.x;
  let desiredY = height + opts.shake.y;
  const desiredZ = lookZ - cfwdZ * useDist + rz * shoulder;

  if (opts.colliders) {
    for (const c of opts.colliders) {
      const dx = desiredX - c.x;
      const dz = desiredZ - c.z;
      const min = c.r + 1.35;
      const d = Math.hypot(dx, dz);
      if (d < min) {
        const pull = (min - Math.max(d, 0.05)) / min;
        desiredY += pull * 0.55;
        useDist = Math.max(1.9, useDist * (1 - pull * 0.45));
      }
    }
  }

  const finalX = lookX - cfwdX * useDist + rx * shoulder + opts.shake.x;
  const finalZ = lookZ - cfwdZ * useDist + rz * shoulder;

  const lag = opts.sprinting ? 7.2 : 8.6;
  opts.cam.position.x = THREE.MathUtils.damp(opts.cam.position.x, finalX, lag, opts.dt);
  opts.cam.position.y = THREE.MathUtils.damp(opts.cam.position.y, desiredY, lag, opts.dt);
  opts.cam.position.z = THREE.MathUtils.damp(opts.cam.position.z, finalZ, lag, opts.dt);
  opts.cam.lookAt(lookX + rx * 0.12, lookY, lookZ + rz * 0.12);

  const persp = opts.cam as THREE.PerspectiveCamera;
  if (persp.isPerspectiveCamera) {
    const want = opts.sprinting && opts.motion.gait === "sprint" ? 62 : opts.inCombat ? 52 : 56;
    persp.fov = THREE.MathUtils.damp(persp.fov, want + opts.punch * 2.4, 6, opts.dt);
    persp.updateProjectionMatrix();
  }
}
