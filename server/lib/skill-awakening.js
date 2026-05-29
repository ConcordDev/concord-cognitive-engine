// server/lib/skill-awakening.js
//
// WS4(b) — power evolution: AWAKENING + SPECIALIZATION (the Deku/Bakugo axis).
//
// Two MHA mechanics distinct from the level-gated skill-evolution lineage:
//
//   1. SPECIALIZATION — one base power branches into tactical modes. Bakugo's
//      Explosion → AP Shot (precision), Howitzer (area), Cluster (sustained).
//      Same power, different tuning; the player picks a niche.
//
//   2. AWAKENING — a stress-triggered one-time power spike. Surviving a
//      near-death hit or felling a named threat awakens the power (à la a quirk
//      awakening), granting a permanent multiplier + unlocking a deeper branch.
//
// Pure (no DB/I/O) so it's deterministic + testable; callers persist results via
// the existing skill-evolution / createSkill paths. Dials env-overridable.

function envNum(name, dflt, { min = 0, max = Infinity } = {}) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

// Specialization branches: multiplicative tuning off the base skill.
export const SPECIALIZATIONS = Object.freeze({
  precision: { suffix: "AP Shot",   damageMult: 1.35, rangeMult: 0.7, cooldownMult: 0.85, aoeMult: 0.4, mode: "precision" },
  area:      { suffix: "Howitzer",  damageMult: 0.85, rangeMult: 1.0, cooldownMult: 1.3,  aoeMult: 2.2, mode: "area" },
  sustained: { suffix: "Cluster",   damageMult: 0.7,  rangeMult: 0.9, cooldownMult: 1.1,  aoeMult: 1.4, mode: "sustained", ticks: 4 },
  defensive: { suffix: "Bulwark",   damageMult: 0.6,  rangeMult: 0.6, cooldownMult: 0.9,  aoeMult: 1.0, mode: "defensive", guard: 0.3 },
});

export const AWAKENING_DIALS = Object.freeze({
  nearDeathMult: envNum("CONCORD_AWAKEN_NEAR_DEATH_MULT", 1.25, { min: 1 }),
  namedKillMult: envNum("CONCORD_AWAKEN_NAMED_KILL_MULT", 1.2, { min: 1 }),
  // HP fraction at/below which a survived hit counts as a near-death awakening.
  nearDeathHpFraction: envNum("CONCORD_AWAKEN_NEAR_DEATH_HP_FRAC", 0.1, { min: 0, max: 1 }),
});

const TRIGGER_MULT = {
  near_death_survived: () => AWAKENING_DIALS.nearDeathMult,
  named_threat_defeated: () => AWAKENING_DIALS.namedKillMult,
};

/** Whether a survived hit qualifies as a near-death awakening trigger. Pure. */
export function isNearDeath(remainingHp, maxHp) {
  const max = Number(maxHp) || 0;
  if (max <= 0) return false;
  const hp = Math.max(0, Number(remainingHp) || 0);
  return hp > 0 && hp / max <= AWAKENING_DIALS.nearDeathHpFraction;
}

/**
 * Apply a specialization branch to a base skill descriptor
 * { name, element, maxDamage, rangeM, cooldownMs, aoeRadius }. Pure.
 */
export function applySpecialization(skill, branch) {
  const spec = SPECIALIZATIONS[branch];
  if (!spec) return { ok: false, reason: "unknown_branch", branches: Object.keys(SPECIALIZATIONS) };
  const baseDmg = Math.max(0, Number(skill?.maxDamage) || 0);
  const baseName = String(skill?.name || "Power").replace(/\s*\((AP Shot|Howitzer|Cluster|Bulwark)\)$/i, "");
  return {
    ok: true,
    branch,
    mode: spec.mode,
    skill: {
      name: `${baseName} (${spec.suffix})`,
      element: skill?.element || "physical",
      maxDamage: Math.max(1, Math.round(baseDmg * spec.damageMult)),
      rangeM: skill?.rangeM != null ? Math.round(Number(skill.rangeM) * spec.rangeMult) : undefined,
      cooldownMs: skill?.cooldownMs != null ? Math.round(Number(skill.cooldownMs) * spec.cooldownMult) : undefined,
      aoeRadius: skill?.aoeRadius != null ? Math.round(Number(skill.aoeRadius) * spec.aoeMult * 10) / 10 : undefined,
      mode: spec.mode,
      ...(spec.ticks ? { ticks: spec.ticks } : {}),
      ...(spec.guard ? { guard: spec.guard } : {}),
    },
  };
}

/**
 * Compute an awakening for a skill from a stress trigger. Returns the awakened
 * descriptor with a permanent multiplier + an unlocked specialization branch
 * (deterministic by seed). Pure.
 */
export function computeAwakening(skill, trigger, seedKey = "") {
  const mfn = TRIGGER_MULT[trigger];
  if (!mfn) return { ok: false, reason: "unknown_trigger", triggers: Object.keys(TRIGGER_MULT) };
  const mult = mfn();
  const baseDmg = Math.max(1, Number(skill?.maxDamage) || 1);
  // Deterministic branch unlock from the seed.
  const branches = Object.keys(SPECIALIZATIONS);
  let h = 5381;
  const s = `${skill?.name || ""}|${trigger}|${seedKey}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  const unlockedBranch = branches[h % branches.length];
  return {
    ok: true,
    awakened: true,
    trigger,
    multiplier: mult,
    unlockedBranch,
    newMaxDamage: Math.round(baseDmg * mult),
    name: `Awakened ${String(skill?.name || "Power")}`,
  };
}
