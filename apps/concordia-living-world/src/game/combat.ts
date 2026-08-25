/** Momentum-vs-poise combat. Stagger is physics, never a dice roll. */

export type Stagger = "graze" | "flinch" | "rocked" | "knockdown";
export type AttackKind = "light" | "heavy" | "riposte";

export const IFRAME_DODGE_MS = 350;
export const IFRAME_PERFECT_MS = 500;
export const PARRY_WINDOW_MS = 180;
export const LIGHT_STARTUP_MS = 180;
export const LIGHT_ACTIVE_MS = 90;
export const LIGHT_RECOVERY_MS = 220;
export const HEAVY_STARTUP_MS = 380;
export const HEAVY_ACTIVE_MS = 120;
export const HEAVY_RECOVERY_MS = 420;
export const DODGE_RECOVERY_MS = 280;
export const POISE_REGEN_PER_SEC = 4.2;
export const STAMINA_REGEN_PER_SEC = 18;
export const MAX_HP = 100;
export const MAX_STAMINA = 100;
export const MAX_POISE = 12;

/** Dempster-ish forearm+hand ratio × 72kg adult. */
export const BONE_MASS_LIGHT = 1.58;
export const BONE_MASS_HEAVY = 2.4;

export function computeImpactMomentum(opts: {
  boneMass: number;
  angularVelocity: number;
  leverArmM: number;
}): number {
  return opts.boneMass * opts.leverArmM * opts.angularVelocity;
}

export function attackKinematics(kind: AttackKind): {
  boneMass: number;
  angularVelocity: number;
  leverArmM: number;
  staminaCost: number;
  hyperarmor: boolean;
} {
  if (kind === "heavy") {
    return { boneMass: BONE_MASS_HEAVY, angularVelocity: 16.5, leverArmM: 0.52, staminaCost: 28, hyperarmor: true };
  }
  if (kind === "riposte") {
    return { boneMass: BONE_MASS_HEAVY, angularVelocity: 18, leverArmM: 0.48, staminaCost: 16, hyperarmor: false };
  }
  return { boneMass: BONE_MASS_LIGHT, angularVelocity: 12.2, leverArmM: 0.34, staminaCost: 12, hyperarmor: false };
}

export function momentumOf(kind: AttackKind): number {
  const k = attackKinematics(kind);
  return computeImpactMomentum(k);
}

export function resolvePoiseStagger(momentum: number, poise: number): Stagger {
  const overflow = momentum - poise;
  if (overflow <= 0) return "graze";
  if (overflow < 2.2) return "flinch";
  if (overflow < 5.4) return "rocked";
  return "knockdown";
}

export function hitFeel(momentum: number, stagger: Stagger): {
  hitPauseMs: number;
  knockback: number;
  trauma: number;
  damage: number;
} {
  const m = Math.max(0, momentum);
  const base =
    stagger === "knockdown" ? 22 : stagger === "rocked" ? 14 : stagger === "flinch" ? 8 : 4;
  return {
    hitPauseMs: clamp(m * 18, 24, 140),
    knockback: clamp(m * 0.55, 0.4, 6),
    trauma: clamp(m / 14, 0.12, 0.85),
    damage: Math.round(base + m * 1.1),
  };
}

export function parryMomentumMul(perfect: boolean): number {
  return perfect ? 0 : 0.08;
}

export function stancePoise(opts: {
  base: number;
  blocking: boolean;
  midStride: boolean;
  stamina: number;
}): number {
  let p = opts.base;
  if (opts.blocking) p *= 1.55;
  if (opts.midStride) p *= 0.72;
  p *= 0.55 + 0.45 * clamp(opts.stamina / MAX_STAMINA, 0, 1);
  return p;
}

export function telegraphKind(seed: number): "thrust" | "sweep" | "grab" {
  const i = Math.abs(Math.floor(seed)) % 3;
  return i === 0 ? "thrust" : i === 1 ? "sweep" : "grab";
}

export function counterFor(kind: "thrust" | "sweep" | "grab"): "parry" | "dodge" | "dodge" {
  if (kind === "thrust") return "parry";
  return "dodge";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export type Combatant = {
  hp: number;
  stamina: number;
  poise: number;
  iframeUntil: number;
  stunUntil: number;
  windupUntil: number;
  activeUntil: number;
  recoverUntil: number;
  parryUntil: number;
  attackKind: AttackKind | null;
  hyperarmor: boolean;
  facing: number;
  x: number;
  z: number;
};

export function freshCombatant(x: number, z: number, facing: number): Combatant {
  return {
    hp: MAX_HP,
    stamina: MAX_STAMINA,
    poise: MAX_POISE,
    iframeUntil: 0,
    stunUntil: 0,
    windupUntil: 0,
    activeUntil: 0,
    recoverUntil: 0,
    parryUntil: 0,
    attackKind: null,
    hyperarmor: false,
    facing,
    x,
    z,
  };
}

export function canAct(c: Combatant, now: number): boolean {
  return now >= c.stunUntil && now >= c.recoverUntil && now >= c.windupUntil && now >= c.activeUntil;
}

export function beginAttack(c: Combatant, kind: AttackKind, now: number): boolean {
  if (now < c.stunUntil) return false;
  if (c.attackKind && now < c.windupUntil) return false;
  if (c.attackKind && now < c.activeUntil) return false;
  const chained = Boolean(c.attackKind === "light" && kind === "light" && now >= c.activeUntil && now < c.recoverUntil);
  const k = attackKinematics(kind);
  if (c.stamina < k.staminaCost) return false;
  c.stamina -= k.staminaCost;
  c.attackKind = kind;
  c.hyperarmor = k.hyperarmor;
  const start = chained ? 70 : kind === "heavy" ? HEAVY_STARTUP_MS : LIGHT_STARTUP_MS;
  const active = kind === "heavy" ? HEAVY_ACTIVE_MS : chained ? 70 : LIGHT_ACTIVE_MS;
  const recover = kind === "heavy" ? HEAVY_RECOVERY_MS : chained ? 160 : LIGHT_RECOVERY_MS;
  c.windupUntil = now + start;
  c.activeUntil = now + start + active;
  c.recoverUntil = now + start + active + recover;
  return true;
}

export function beginDodge(c: Combatant, now: number, perfect: boolean): boolean {
  if (now < c.stunUntil) return false;
  if (now < c.recoverUntil && c.attackKind && now < c.activeUntil) return false;
  if (c.stamina < 18) return false;
  c.stamina -= 18;
  c.iframeUntil = now + (perfect ? IFRAME_PERFECT_MS : IFRAME_DODGE_MS);
  c.attackKind = null;
  c.hyperarmor = false;
  c.windupUntil = 0;
  c.activeUntil = 0;
  c.recoverUntil = now + DODGE_RECOVERY_MS;
  return true;
}

export function beginParry(c: Combatant, now: number): boolean {
  if (!canAct(c, now)) return false;
  if (c.stamina < 10) return false;
  c.stamina -= 10;
  c.parryUntil = now + PARRY_WINDOW_MS;
  c.recoverUntil = now + 160;
  return true;
}

export function tickVitals(c: Combatant, dt: number, now: number) {
  if (now >= c.activeUntil) c.hyperarmor = false;
  if (now >= c.recoverUntil) c.attackKind = null;
  if (now >= c.stunUntil) {
    c.stamina = Math.min(MAX_STAMINA, c.stamina + STAMINA_REGEN_PER_SEC * dt);
    c.poise = Math.min(MAX_POISE, c.poise + POISE_REGEN_PER_SEC * dt);
  }
}

export function applyHit(
  attacker: Combatant,
  defender: Combatant,
  now: number,
  opts: { flanked?: boolean; parried?: boolean; midStride?: boolean; massMul?: number; poiseMul?: number },
): {
  landed: boolean;
  iframed: boolean;
  parried: boolean;
  stagger: Stagger;
  momentum: number;
  feel: ReturnType<typeof hitFeel>;
} | null {
  if (!attacker.attackKind) return null;
  if (now < attacker.windupUntil || now > attacker.activeUntil) return null;
  let momentum = momentumOf(attacker.attackKind) * (opts.massMul ?? 1);
  if (opts.flanked) momentum *= 1.28;
  if (opts.parried) momentum *= parryMomentumMul(true);

  if (now < defender.iframeUntil) {
    return {
      landed: false,
      iframed: true,
      parried: false,
      stagger: "graze",
      momentum,
      feel: hitFeel(momentum, "graze"),
    };
  }

  if (opts.parried) {
    attacker.stunUntil = now + 420;
    attacker.recoverUntil = now + 420;
    attacker.attackKind = null;
    return {
      landed: false,
      iframed: false,
      parried: true,
      stagger: "graze",
      momentum: 0,
      feel: hitFeel(0, "graze"),
    };
  }

  if (defender.hyperarmor && now < defender.activeUntil) {
    momentum *= 0.35;
  }

  const poise = stancePoise({
    base: defender.poise * (opts.poiseMul ?? 1),
    blocking: false,
    midStride: opts.midStride ?? false,
    stamina: defender.stamina,
  });
  const stagger = resolvePoiseStagger(momentum, poise);
  const feel = hitFeel(momentum, stagger);
  defender.hp = Math.max(0, defender.hp - feel.damage);
  defender.poise = Math.max(0, defender.poise - momentum * 0.45);
  const stun =
    stagger === "knockdown" ? 900 : stagger === "rocked" ? 520 : stagger === "flinch" ? 220 : 0;
  if (stun && !(defender.hyperarmor && now < defender.activeUntil)) {
    defender.stunUntil = now + stun;
    defender.attackKind = null;
    defender.windupUntil = 0;
    defender.activeUntil = 0;
    defender.recoverUntil = now + stun;
  }
  return { landed: true, iframed: false, parried: false, stagger, momentum, feel };
}
