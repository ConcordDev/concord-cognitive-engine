// server/lib/combat-hp-authority.js
//
// Server HP for Concordia actors (training dummy / hostile / player fallback).
// Momentum × poise from combat-impact.js is the damage authority — not Unity HitScan.
// cityPresence.applyAttack remains the PvP path; this covers dummy names the
// Unity client sends when the actor is not yet in presence.

import { momentumFor, resolvePoiseStagger, poiseBudget } from "./combat-impact.js";
import { stampGeographicOnHit, domainFromSkillKind } from "./concordia-world-field.js";

/** @type {Map<string, {id:string, hp:number, maxHp:number, poise:number, worldId:string, x:number, z:number}>} */
const actors = new Map();

export function ensureActor(id, opts = {}) {
  const key = String(id || "").slice(0, 128);
  if (!key) return null;
  if (!actors.has(key)) {
    actors.set(key, {
      id: key,
      hp: Number(opts.hp ?? 80),
      maxHp: Number(opts.maxHp ?? opts.hp ?? 80),
      poise: Number(opts.poise ?? poiseBudget({})),
      worldId: String(opts.worldId || "concordia-hub"),
      x: Number(opts.x || 0),
      z: Number(opts.z || 0),
    });
  }
  return actors.get(key);
}

export function getActor(id) {
  return actors.get(String(id || "")) || null;
}

export function resetCombatHpAuthorityForTest() {
  actors.clear();
}

/**
 * Apply a hit. Client baseDamage is a hint only — momentum vs poise decides HP.
 */
export function applyAuthoritativeHit({
  attackerId,
  targetId,
  weapon = "sword",
  baseDamage = 20,
  worldId = "concordia-hub",
  refuseHubCombat = false,
  localX = null,
  localZ = null,
  origin = null,
  skillKind = null,
  nativeStrength = 0,
  actorKind = "player",
} = {}) {
  if (!targetId) return { ok: false, error: "missing_target" };
  const wid = String(worldId || "concordia-hub");
  if (refuseHubCombat && wid === "concordia-hub") {
    return { ok: true, refused: true, reason: "hub_ground_no_combat", damage: 0, targetHealth: getActor(targetId)?.hp ?? 80 };
  }
  const target = ensureActor(targetId, { worldId: wid });
  if (attackerId) ensureActor(attackerId, { worldId: wid, hp: 100, maxHp: 100 });

  const mom = momentumFor({ kind: String(weapon || "sword"), tier: 1 });
  const stagger = resolvePoiseStagger({ momentum: mom, poise: target.poise });
  const hint = Math.max(0, Number(baseDamage) || 0);
  const damage = Math.max(1, Math.round(mom * 0.35 + hint * 0.15));
  const before = target.hp;
  const result = {
    ok: true,
    authority: "combat-hp-authority",
    damage,
    hpBefore: before,
    hpAfter: target.hp,
    targetHealth: target.hp,
    targetMaxHealth: target.maxHp,
    targetKilled: false,
    momentum: mom,
    severity: stagger.severity,
    poise: stagger.poise,
    overflowRatio: stagger.overflowRatio,
    weapon: String(weapon || "sword"),
    targetId: target.id,
    attackerId: attackerId || null,
    worldId: wid,
    localHpApplied: false,
  };
  stampGeographicOnHit(result, {
    worldId: wid,
    localX,
    localZ,
    origin: origin || wid,
    domain: domainFromSkillKind(skillKind, "athletics"),
    nativeStrength,
    actorKind,
  });
  target.hp = Math.max(0, target.hp - result.damage);
  result.hpAfter = target.hp;
  result.targetHealth = target.hp;
  result.targetKilled = target.hp <= 0;
  return result;
}

export default { ensureActor, getActor, applyAuthoritativeHit, resetCombatHpAuthorityForTest };
