/** Full-body pose solver. Presentation only — combat.ts stays authoritative. */

import {
  HEAVY_ACTIVE_MS,
  HEAVY_RECOVERY_MS,
  HEAVY_STARTUP_MS,
  LIGHT_ACTIVE_MS,
  LIGHT_RECOVERY_MS,
  LIGHT_STARTUP_MS,
  type AttackKind,
} from "./combat";
import type { Gait } from "./locomotion";
import type { Pose } from "./sim";

export type Joint = { rx: number; ry: number; rz: number; py?: number };

export type BodyTargets = {
  rootRx: number;
  rootSy: number;
  pelvis: Joint;
  spine: Joint;
  chest: Joint;
  head: Joint;
  clavR: Joint;
  clavL: Joint;
  armR: Joint;
  armL: Joint;
  foreR: Joint;
  foreL: Joint;
  handR: Joint;
  handL: Joint;
  thighR: Joint;
  thighL: Joint;
  shinR: Joint;
  shinL: Joint;
  weaponDrawn: boolean;
  twoHand: boolean;
};

export type AnimIn = {
  t: number;
  speed: number;
  gait: Gait;
  phase: number;
  pose: Pose;
  act: string;
  stagger: string;
  hitDirX: number;
  hitDirZ: number;
  now: number;
  attackKind: AttackKind | null;
  windupUntil: number;
  activeUntil: number;
  recoverUntil: number;
  lookYaw: number;
  accel: number;
  armed?: boolean;
};

type PhaseName = "anticipate" | "accel" | "contact" | "follow" | "recover";

export function combatClock(a: Pick<AnimIn, "attackKind" | "now" | "windupUntil" | "activeUntil" | "recoverUntil">): { name: PhaseName; u: number; kind: AttackKind } | null {
  const kind = a.attackKind;
  if (!kind) return null;
  const now = a.now;
  if (now < a.windupUntil) {
    const span = kind === "heavy" ? HEAVY_STARTUP_MS : LIGHT_STARTUP_MS;
    const u = span > 0 ? 1 - Math.max(0, a.windupUntil - now) / span : 1;
    return { name: "anticipate", u: clamp(u, 0, 1), kind };
  }
  if (now < a.activeUntil) {
    const span = kind === "heavy" ? HEAVY_ACTIVE_MS : LIGHT_ACTIVE_MS;
    const u = span > 0 ? 1 - Math.max(0, a.activeUntil - now) / span : 1;
    const cu = clamp(u, 0, 1);
    return cu < 0.42 ? { name: "accel", u: cu / 0.42, kind } : { name: "contact", u: (cu - 0.42) / 0.58, kind };
  }
  if (now < a.recoverUntil) {
    const span = kind === "heavy" ? HEAVY_RECOVERY_MS : LIGHT_RECOVERY_MS;
    const u = span > 0 ? 1 - Math.max(0, a.recoverUntil - now) / span : 1;
    const cu = clamp(u, 0, 1);
    return cu < 0.4 ? { name: "follow", u: cu / 0.4, kind } : { name: "recover", u: (cu - 0.4) / 0.6, kind };
  }
  return null;
}

function j(rx = 0, ry = 0, rz = 0, py?: number): Joint {
  return py === undefined ? { rx, ry, rz } : { rx, ry, rz, py };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpJ(a: Joint, b: Joint, t: number): Joint {
  return {
    rx: lerp(a.rx, b.rx, t),
    ry: lerp(a.ry, b.ry, t),
    rz: lerp(a.rz, b.rz, t),
    py: a.py != null || b.py != null ? lerp(a.py ?? 0, b.py ?? 0, t) : undefined,
  };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

type GaitSample = {
  pelvisY: number;
  pelvisRy: number;
  pelvisRz: number;
  thighR: number;
  thighL: number;
  shinR: number;
  shinL: number;
  armR: number;
  armL: number;
  chestRy: number;
  chestRz: number;
};

/** Authored walk — not a single sine. Right heel strike → mid → left heel → mid. */
const WALK: GaitSample[] = [
  { pelvisY: -0.018, pelvisRy: 0.1, pelvisRz: -0.045, thighR: 0.52, thighL: -0.38, shinR: 0.12, shinL: 0.62, armR: -0.62, armL: 0.58, chestRy: -0.1, chestRz: 0.05 },
  { pelvisY: 0.022, pelvisRy: 0.05, pelvisRz: 0.01, thighR: 0.08, thighL: -0.72, shinR: 0.22, shinL: 0.28, armR: -0.82, armL: 0.78, chestRy: -0.14, chestRz: 0.02 },
  { pelvisY: -0.018, pelvisRy: -0.1, pelvisRz: 0.045, thighR: -0.38, thighL: 0.52, shinR: 0.62, shinL: 0.12, armR: 0.58, armL: -0.62, chestRy: 0.1, chestRz: -0.05 },
  { pelvisY: 0.022, pelvisRy: -0.05, pelvisRz: -0.01, thighR: -0.72, thighL: 0.08, shinR: 0.28, shinL: 0.22, armR: 0.78, armL: -0.82, chestRy: 0.14, chestRz: -0.02 },
];

function sampleGait(phase: number, amp: number): GaitSample {
  const p = ((phase % 1) + 1) % 1;
  const i = Math.floor(p * 4) % 4;
  const n = (i + 1) % 4;
  const u = p * 4 - i;
  const a = WALK[i]!;
  const b = WALK[n]!;
  const k = (x: number) => x * amp;
  return {
    pelvisY: lerp(a.pelvisY, b.pelvisY, u) * (0.65 + amp * 0.35),
    pelvisRy: k(lerp(a.pelvisRy, b.pelvisRy, u)),
    pelvisRz: k(lerp(a.pelvisRz, b.pelvisRz, u)),
    thighR: k(lerp(a.thighR, b.thighR, u)),
    thighL: k(lerp(a.thighL, b.thighL, u)),
    shinR: lerp(0.1, lerp(a.shinR, b.shinR, u), amp),
    shinL: lerp(0.1, lerp(a.shinL, b.shinL, u), amp),
    armR: k(lerp(a.armR, b.armR, u)),
    armL: k(lerp(a.armL, b.armL, u)),
    chestRy: k(lerp(a.chestRy, b.chestRy, u)),
    chestRz: k(lerp(a.chestRz, b.chestRz, u)),
  };
}

function empty(): BodyTargets {
  const z = j();
  return {
    rootRx: 0,
    rootSy: 1,
    pelvis: j(0, 0, 0, 0),
    spine: z,
    chest: z,
    head: z,
    clavR: z,
    clavL: z,
    armR: z,
    armL: z,
    foreR: j(0.38),
    foreL: j(0.36),
    handR: z,
    handL: z,
    thighR: z,
    thighL: z,
    shinR: j(0.12),
    shinL: j(0.12),
    weaponDrawn: false,
    twoHand: false,
  };
}

export function solveBody(a: AnimIn): BodyTargets {
  const o = empty();
  const combat = a.pose === "windup" || a.pose === "strike" || a.pose === "dodge" || a.pose === "hurt" || a.pose === "down";
  const clock = combatClock(a);
  const sleeping = !combat && !clock && a.act === "sleep";
  const eating = !combat && !clock && a.act === "eat";
  const working = !combat && !clock && (a.act === "work" || a.act === "gather");
  const stagger = a.stagger;
  const armed = !!a.armed;

  o.rootSy =
    a.pose === "down" || stagger === "knockdown"
      ? 0.4
      : a.pose === "hurt" && stagger === "rocked"
        ? 0.82
        : a.pose === "hurt"
          ? 0.9
          : a.pose === "dodge"
            ? 0.94
            : sleeping
              ? 0.38
              : eating
                ? 0.9
                : a.gait === "crouch" || a.act === "hide"
                  ? 0.86
                  : 1;

  const walkAmt = combat && !clock ? 0 : clamp(a.speed / 4.5, 0, 1);
  const sprint = a.gait === "sprint" ? 1 : a.gait === "jog" ? 0.7 : 0.45;
  const g = sampleGait(a.phase, walkAmt * (0.75 + sprint * 0.4));
  const breathe = Math.sin(a.t * 1.65) * 0.012 * (1 - walkAmt);

  o.rootRx = walkAmt * (a.gait === "sprint" ? 0.14 : a.gait === "jog" ? 0.08 : 0.045);
  if (working) o.rootRx = 0.2;
  if (eating) o.rootRx = 0.1;
  if (sleeping) o.rootRx = 1.12;

  o.pelvis = j(0, g.pelvisRy, g.pelvisRz, g.pelvisY + breathe * 0.35 + (eating ? -0.32 : sleeping ? -0.04 : 0));
  o.spine = j(breathe * 2, g.chestRy * 0.4, g.chestRz * 0.5);
  o.chest = j(breathe, g.chestRy, g.chestRz);
  o.head = j(breathe * 0.4, clamp(a.lookYaw, -0.7, 0.7), 0);

  const hang = 0.08 + walkAmt * 0.04;
  o.armR = j(g.armR + Math.sin(a.t * 1.3) * 0.04 * (1 - walkAmt), 0, hang);
  o.armL = j(g.armL + Math.sin(a.t * 1.3 + 1) * 0.04 * (1 - walkAmt), 0, -hang);
  o.foreR = j(0.38 + walkAmt * 0.2);
  o.foreL = j(0.36 + walkAmt * 0.18);
  o.thighR = j(sleeping ? 0.85 : eating ? 1.48 : g.thighR);
  o.thighL = j(sleeping ? 0.4 : eating ? 1.48 : g.thighL);
  o.shinR = j(sleeping ? -0.35 : eating ? -1.58 : g.shinR);
  o.shinL = j(sleeping ? -0.15 : eating ? -1.58 : g.shinL);

  if (a.accel > 2.2 && walkAmt > 0.05) {
    o.pelvis.py = (o.pelvis.py ?? 0) - 0.03;
    o.thighR.rx += 0.22;
    o.chest.rx += 0.06;
  } else if (a.accel < -2.4) {
    o.pelvis.py = (o.pelvis.py ?? 0) - 0.025;
    o.thighR.rx *= 0.4;
    o.thighL.rx *= 0.4;
    o.rootRx += 0.06;
  }

  if (working) {
    o.armR = j(Math.sin(a.t * 3.1) * 0.7, 0.1, 0.2);
    o.foreR = j(0.7);
    o.armL = j(0.35, 0, -0.15);
  } else if (sleeping) {
    o.armR = j(0.55, 0.1, 0.35);
    o.foreR = j(0.7);
    o.armL = j(0.4, -0.1, -0.25);
    o.foreL = j(0.6);
    o.chest.ry = 0.15;
  } else if (eating) {
    o.armR = j(0.85, 0.1, 0.2);
    o.foreR = j(1.05);
    o.armL = j(0.55, 0, -0.12);
    o.foreL = j(0.7);
  } else if (a.pose === "idle" && walkAmt < 0.04) {
    o.armR.rx = Math.sin(a.t * 1.25) * 0.05;
    o.armL.rx = -Math.sin(a.t * 1.25 + 0.4) * 0.045;
    o.thighR.rx = 0.06;
    o.thighL.rx = -0.04;
    o.pelvis.ry = Math.sin(a.t * 0.4) * 0.03;
  }

  if (armed && !clock && a.pose !== "hurt" && a.pose !== "down" && a.pose !== "dodge" && !sleeping) {
    o.weaponDrawn = true;
    o.armR = j(g.armR * 0.18 + 0.32, 0.16, 0.4);
    o.foreR = j(0.5 + walkAmt * 0.08);
    o.handR = j(0.42, 0.08, 0.12);
    o.clavR = j(0, 0, 0.08);
  }

  if (a.pose === "dodge") {
    o.rootRx = 0.32;
    o.pelvis = j(0.1, 0, 0, -0.04);
    o.armR = j(0.7, 0.2, 0.45);
    o.armL = j(0.55, -0.15, -0.4);
    o.foreR = j(1.0);
    o.foreL = j(0.95);
    o.thighR = j(0.85);
    o.thighL = j(0.55);
    o.shinR = j(-0.7);
    o.shinL = j(-0.4);
  }

  if (clock) {
    applyAttack(o, clock, a);
  }

  if (a.pose === "hurt" || stagger === "flinch" || stagger === "rocked" || stagger === "knockdown" || a.pose === "down") {
    applyHit(o, a);
  }

  o.head.ry = clamp(o.head.ry + a.lookYaw * (clock ? 0.35 : 1), -0.85, 0.85);
  return o;
}

function applyAttack(
  o: BodyTargets,
  clock: { name: PhaseName; u: number; kind: AttackKind },
  a: AnimIn,
) {
  const heavy = clock.kind === "heavy";
  o.weaponDrawn = true;
  o.twoHand = heavy;
  const u = clock.u;
  const slash = (from: Joint, to: Joint) => lerpJ(from, to, u);

  const guardR = j(-0.28, 0.22, 0.32);
  const backR = j(heavy ? -1.72 : -1.45, heavy ? -0.55 : -0.42, heavy ? 0.95 : 0.78);
  const midR = j(-0.05, 0.15, 0.45);
  const hitR = j(heavy ? 1.65 : 1.42, heavy ? 0.62 : 0.48, -0.15);
  const followR = j(heavy ? 1.82 : 1.55, heavy ? 0.78 : 0.58, -0.28);
  const guardL = j(-0.15, -0.1, -0.22);
  const helpL = j(heavy ? -0.85 : -0.35, 0.2, heavy ? 0.55 : 0.28);
  const holdL = j(0.95, 0.35, 0.55);

  o.rootRx = lerp(o.rootRx, heavy ? 0.16 : 0.08, 0.8);
  o.clavR = j(0, 0, 0.12);
  o.clavL = j(0, 0, -0.08);

  if (clock.name === "anticipate") {
    o.pelvis.ry = lerp(0, heavy ? -0.28 : -0.16, u);
    o.pelvis.rz = lerp(0, 0.06, u);
    o.chest.ry = lerp(0, heavy ? -0.38 : -0.22, u);
    o.chest.rx = lerp(0, -0.12, u);
    o.spine.ry = o.chest.ry * 0.5;
    o.armR = slash(guardR, backR);
    o.foreR = j(lerp(0.45, heavy ? 1.05 : 0.82, u));
    o.handR = j(lerp(0, -0.25, u), 0, 0.1);
    o.armL = slash(guardL, helpL);
    o.foreL = j(lerp(0.4, 0.85, u));
    o.thighR.rx = lerp(o.thighR.rx, 0.35, u);
    o.thighL.rx = lerp(o.thighL.rx, -0.22, u);
    o.head.rx = -0.08;
  } else if (clock.name === "accel") {
    o.pelvis.ry = lerp(heavy ? -0.28 : -0.16, 0.06, u);
    o.chest.ry = lerp(heavy ? -0.38 : -0.22, 0.1, u);
    o.chest.rx = lerp(-0.12, 0.06, u);
    o.spine.ry = o.chest.ry * 0.55;
    o.armR = slash(backR, midR);
    o.foreR = j(lerp(heavy ? 1.05 : 0.82, 0.28, u));
    o.handR = j(lerp(-0.25, 0.15, u));
    o.armL = slash(helpL, holdL);
    o.foreL = j(lerp(0.85, 0.7, u));
    o.rootRx = lerp(0.08, 0.18, u);
  } else if (clock.name === "contact") {
    o.pelvis.ry = lerp(0.06, heavy ? 0.32 : 0.2, u);
    o.chest.ry = lerp(0.1, heavy ? 0.42 : 0.28, u);
    o.chest.rx = 0.1;
    o.spine.ry = o.chest.ry * 0.6;
    o.armR = slash(midR, hitR);
    o.foreR = j(lerp(0.28, 0.06, u));
    o.handR = j(lerp(0.15, 0.35, u), 0.12, 0);
    o.armL = holdL;
    o.foreL = j(0.55);
    o.rootRx = 0.2;
    o.thighR.rx = -0.15;
    o.thighL.rx = 0.28;
  } else if (clock.name === "follow") {
    o.pelvis.ry = lerp(heavy ? 0.32 : 0.2, heavy ? 0.18 : 0.1, u);
    o.chest.ry = lerp(heavy ? 0.42 : 0.28, 0.12, u);
    o.armR = slash(hitR, followR);
    o.foreR = j(lerp(0.06, 0.35, u));
    o.handR = j(lerp(0.35, 0.1, u));
    o.armL = slash(holdL, guardL);
    o.foreL = j(lerp(0.55, 0.4, u));
    o.rootRx = lerp(0.2, 0.06, u);
  } else {
    o.pelvis.ry = lerp(heavy ? 0.18 : 0.1, 0, u);
    o.chest.ry = lerp(0.12, 0, u);
    o.armR = slash(followR, guardR);
    o.foreR = j(lerp(0.35, 0.42, u));
    o.handR = j();
    o.armL = slash(guardL, j(-0.08, 0, -0.12));
    o.foreL = j(lerp(0.4, 0.36, u));
    o.weaponDrawn = u < 0.85 || a.speed < 0.4;
    o.twoHand = heavy && u < 0.5;
  }
}

function applyHit(o: BodyTargets, a: AnimIn) {
  const knocked = a.pose === "down" || a.stagger === "knockdown";
  const rocked = a.stagger === "rocked";
  const w = knocked ? 1 : rocked ? 0.72 : 0.4;
  const yaw = Math.atan2(a.hitDirX, a.hitDirZ);
  o.rootRx = knocked ? 1.05 : rocked ? -0.42 : -0.22;
  o.rootSy = knocked ? 0.4 : rocked ? 0.82 : 0.9;
  o.pelvis = j(0.15 * w, yaw * 0.25, 0, -0.06 * w);
  o.spine = j(-0.35 * w, yaw * 0.35, 0);
  o.chest = j(-0.28 * w, yaw * 0.45, 0.1 * w);
  o.head = j(rocked ? 0.35 : 0.15, yaw * 0.5, 0);
  o.armR = j(rocked ? 0.95 : 0.55, 0.2, 0.55);
  o.armL = j(rocked ? 0.85 : 0.45, -0.15, -0.5);
  o.foreR = j(1.05);
  o.foreL = j(1.0);
  o.clavR = j(0, 0, 0.2);
  o.clavL = j(0, 0, -0.2);
  if (knocked) {
    o.thighR = j(1.1);
    o.thighL = j(0.85);
    o.shinR = j(-1.15);
    o.shinL = j(-0.9);
    o.weaponDrawn = false;
  }
}
