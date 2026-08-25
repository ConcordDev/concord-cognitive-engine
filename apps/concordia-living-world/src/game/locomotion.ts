/** Player body motion on top of Combatant xz. Does not replace combat.ts. */

import { canAct, type Combatant } from "./combat";
import type { WorldId } from "./content";
import { resolveCollision, resolveBoxes, type Collider } from "./layout";
import { heightAt } from "./life";
import { onRoad } from "./realms";

export type Gait = "idle" | "walk" | "jog" | "sprint" | "crouch" | "air" | "dodge" | "land";

export type Motion = {
  vx: number;
  vz: number;
  hop: number;
  vy: number;
  grounded: boolean;
  gait: Gait;
  coyote: number;
  landUntil: number;
  dodgeT: number;
};

export function freshMotion(): Motion {
  return {
    vx: 0,
    vz: 0,
    hop: 0,
    vy: 0,
    grounded: true,
    gait: "idle",
    coyote: 0,
    landUntil: 0,
    dodgeT: 0,
  };
}

export function tractionOf(world: WorldId, weather: string, x: number, z: number): number {
  let t = 1;
  if (world === "sovereign-ruins" || weather === "ash") t *= 0.82;
  if (world === "tunya" || weather === "grove") t *= 0.78;
  if (weather === "rain") t *= 0.88;
  if (weather === "wind" || world === "concord-link-frontier") t *= 0.92;
  if (world === "lattice-crucible" || weather === "drift") t *= 0.86;
  if (world !== "concordia-hub" && onRoad(world, x, z)) t *= 1.16;
  return t;
}

export type GroundKind = "stone" | "ash" | "dirt" | "grass" | "metal" | "mud";

export function groundKind(world: WorldId, weather: string): GroundKind {
  if (world === "sovereign-ruins" || weather === "ash") return "ash";
  if (world === "tunya" || weather === "grove") return "mud";
  if (world === "cyber") return "metal";
  if (world === "concordia-hub" || world === "crime") return "stone";
  if (world === "fantasy" || weather === "clear") return "grass";
  if (weather === "rain") return "dirt";
  return "dirt";
}

export function applyImpulse(m: Motion, ix: number, iz: number) {
  m.vx += ix;
  m.vz += iz;
}

function angDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function turnToward(yaw: number, want: number, rate: number, dt: number) {
  const d = angDelta(yaw, want);
  const max = rate * dt;
  if (d > max) return yaw + max;
  if (d < -max) return yaw - max;
  return want;
}

function accelToward(cx: number, cz: number, tx: number, tz: number, maxDelta: number) {
  const dx = tx - cx;
  const dz = tz - cz;
  const d = Math.hypot(dx, dz);
  if (d <= 1e-6) return { x: tx, z: tz };
  const step = Math.min(d, maxDelta);
  return { x: cx + (dx / d) * step, z: cz + (dz / d) * step };
}

export function dodgeImpulse(
  m: Motion,
  camYaw: number,
  axes: { x: number; y: number },
) {
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  const dx = fx * Math.max(axes.y, 0.35) + rx * axes.x;
  const dz = fz * Math.max(axes.y, 0.35) + rz * axes.x;
  const n = Math.hypot(dx, dz) || 1;
  m.vx = (dx / n) * 11.6;
  m.vz = (dz / n) * 11.6;
  m.dodgeT = 0.001;
}

export function stepLocomotion(opts: {
  body: Combatant;
  motion: Motion;
  yaw: number;
  dt: number;
  now: number;
  axes: { x: number; y: number };
  camYaw: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  lockYaw: number | null;
  speedMul: number;
  massMul: number;
  world: WorldId;
  weather: string;
  colliders: Collider[];
  boxes?: { x: number; z: number; w: number; d: number; rot: number }[];
  bound: number;
  attacking: boolean;
  dodging: boolean;
}): { yaw: number; speed: number; landed: boolean } {
  const { body, motion: m, dt, axes, camYaw } = opts;
  const mass = Math.max(0.7, opts.massMul);
  const traction = tractionOf(opts.world, opts.weather, body.x, body.z);
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);

  const mag = Math.hypot(axes.x, axes.y);
  const acting = canAct(body, opts.now) && !opts.dodging && opts.now >= m.landUntil;

  let top = 4.55 * opts.speedMul;
  if (opts.sprint && !opts.crouch && mag > 0.2) top = 6.85 * opts.speedMul;
  if (opts.crouch) top = 1.85 * opts.speedMul;
  if (opts.attacking) top *= 0.42;
  if (body.hp < 25) top *= 0.85;
  if (opts.world !== "concordia-hub" && onRoad(opts.world, body.x, body.z)) top *= 1.12;
  if (opts.weather === "wind" || opts.world === "concord-link-frontier") top *= 1.08;

  const walk = 2.15 * opts.speedMul;
  const jog = 4.35 * opts.speedMul;

  let wishX = 0;
  let wishZ = 0;
  if (acting && mag > 0.04) {
    const mx = fx * axes.y + rx * axes.x;
    const mz = fz * axes.y + rz * axes.x;
    const n = Math.hypot(mx, mz) || 1;
    wishX = (mx / n) * top;
    wishZ = (mz / n) * top;
  }

  const accel = ((opts.sprint ? 18 : 24) * traction) / mass;
  const decel = (42 * traction) / mass;

  if (opts.dodging) {
    m.dodgeT += dt;
    const damp = Math.exp(-3.6 * dt);
    m.vx *= damp;
    m.vz *= damp;
  } else if (!m.grounded) {
    const next = accelToward(m.vx, m.vz, wishX, wishZ, accel * 0.28 * dt);
    m.vx = next.x;
    m.vz = next.z;
  } else if (mag > 0.04 && acting) {
    const next = accelToward(m.vx, m.vz, wishX, wishZ, accel * dt);
    m.vx = next.x;
    m.vz = next.z;
  } else {
    const sp = Math.hypot(m.vx, m.vz);
    if (sp > 1e-4) {
      if (sp < 0.7) {
        m.vx = 0;
        m.vz = 0;
      } else {
        const ns = Math.max(0, sp - decel * dt);
        const k = ns / sp;
        m.vx *= k;
        m.vz *= k;
      }
    } else {
      m.vx = 0;
      m.vz = 0;
    }
  }

  if (opts.attacking && opts.now >= body.windupUntil && opts.now <= body.activeUntil) {
    const lx = -Math.sin(opts.yaw);
    const lz = -Math.cos(opts.yaw);
    const burst = body.attackKind === "heavy" ? 2.4 : 1.5;
    m.vx += lx * burst * dt * 3.2;
    m.vz += lz * burst * dt * 3.2;
  }

  const GRAV = 22;
  let landed = false;
  if (m.grounded) m.coyote = 0.12;
  else m.coyote = Math.max(0, m.coyote - dt);

  if (opts.jump && (m.grounded || m.coyote > 0) && acting) {
    m.vy = 7.2 / Math.sqrt(mass);
    m.grounded = false;
    m.coyote = 0;
    m.hop = 0.04;
  }
  if (!m.grounded) {
    m.vy -= GRAV * dt;
    m.hop += m.vy * dt;
    if (m.hop <= 0) {
      const heavy = m.vy < -8;
      m.hop = 0;
      m.vy = 0;
      m.grounded = true;
      landed = true;
      m.landUntil = opts.now + (heavy ? 220 : 110);
    }
  }

  const h0 = heightAt(opts.world, body.x, body.z);
  const h1 = heightAt(opts.world, body.x + m.vx * 0.18, body.z + m.vz * 0.18);
  if (h1 - h0 > 0.55) {
    m.vx *= 0.84;
    m.vz *= 0.84;
  }

  body.x += m.vx * dt;
  body.z += m.vz * dt;
  if (opts.world === "concord-link-frontier") {
    body.x += Math.sin(opts.now * 0.0004) * 0.35 * dt;
  }
  const resolved = resolveCollision(body.x, body.z, 0.48, opts.colliders, opts.bound);
  const boxed = resolveBoxes(resolved.x, resolved.z, 0.48, opts.boxes ?? []);
  const px = boxed.x - body.x;
  const pz = boxed.z - body.z;
  const pushed = Math.hypot(px, pz);
  if (pushed > 1e-4) {
    const nx = px / pushed;
    const nz = pz / pushed;
    const vn = m.vx * nx + m.vz * nz;
    if (vn < 0) {
      m.vx -= vn * nx;
      m.vz -= vn * nz;
    }
    m.vx *= 0.55;
    m.vz *= 0.55;
  }
  body.x = boxed.x;
  body.z = boxed.z;

  const speed = Math.hypot(m.vx, m.vz);
  let yaw = opts.yaw;
  if (opts.lockYaw != null) {
    yaw = turnToward(yaw, opts.lockYaw, 10.5, dt);
  } else if (speed > 0.28) {
    const want = Math.atan2(-m.vx, -m.vz);
    const rate = speed < 2 ? 14 : speed < 5 ? 9.2 : 6.6;
    yaw = turnToward(yaw, want, rate, dt);
  } else {
    yaw = turnToward(yaw, camYaw, 18, dt);
  }
  body.facing = yaw;

  if (!m.grounded) m.gait = "air";
  else if (opts.dodging) m.gait = "dodge";
  else if (opts.now < m.landUntil) m.gait = "land";
  else if (opts.crouch && speed > 0.2) m.gait = "crouch";
  else if (speed < 0.25) m.gait = "idle";
  else if (speed < walk + 0.35) m.gait = "walk";
  else if (speed < jog + 0.45 || !opts.sprint) m.gait = "jog";
  else m.gait = "sprint";

  return { yaw, speed, landed };
}
