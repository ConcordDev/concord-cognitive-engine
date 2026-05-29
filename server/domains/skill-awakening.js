// server/domains/skill-awakening.js
//
// WS4(b) — awakening + specialization macros (Deku/Bakugo power growth).
//   - skill-awakening.specialize: branch a base power into a tactical mode
//     (AP Shot / Howitzer / Cluster / Bulwark). Pure preview; persists when the
//     caller is authed and passes persist:true.
//   - skill-awakening.awaken: realise a stress-triggered awakening (near-death
//     survival / named-threat kill) into a permanent power spike + branch unlock.
//   - skill-awakening.branches: list the available specialization branches.

import {
  SPECIALIZATIONS, applySpecialization, computeAwakening,
} from "../lib/skill-awakening.js";
import { createSkill } from "../lib/emergent-skills.js";

function normalize(d) {
  if (!d || typeof d !== "object") return null;
  const maxDamage = Number(d.maxDamage ?? d.max_damage ?? 0);
  if (!(maxDamage > 0)) return null;
  return {
    name: String(d.name || "Power"),
    element: String(d.element || "physical"),
    maxDamage,
    rangeM: Number(d.rangeM ?? d.range_m) || undefined,
    cooldownMs: Number(d.cooldownMs ?? d.cooldown_ms) || undefined,
    aoeRadius: Number(d.aoeRadius ?? d.aoe_radius) || undefined,
  };
}

function persistIfRequested(ctx, input, descriptor, origin, gameplayEvent) {
  if (!input.persist) return { skillId: null };
  const db = ctx?.db;
  const userId = ctx?.actor?.userId || ctx?.userId || null;
  if (!db || !userId) return { skillId: null, persistError: "auth_required" };
  const created = createSkill(db, {
    name: descriptor.name,
    verb: "specialized_strike",
    requires: { bodyParts: [], topologies: [] },
    costs: { stamina: 14, cooldownMs: descriptor.cooldownMs || 4000 },
    effects: [{ kind: "damage", params: { amount: descriptor.maxDamage, element: descriptor.element } }],
    origin,
    parentId: userId,
    gameplayEvent,
  });
  return created.ok ? { skillId: created.skill.id } : { skillId: null, persistError: created.reason };
}

export default function registerSkillAwakeningMacros(register) {
  register("skill-awakening", "branches", async () => {
    return { ok: true, branches: Object.entries(SPECIALIZATIONS).map(([k, v]) => ({ branch: k, suffix: v.suffix, mode: v.mode })) };
  }, { note: "list specialization branches" });

  register("skill-awakening", "specialize", async (ctx, input = {}) => {
    const skill = normalize(input.skill);
    if (!skill) return { ok: false, reason: "valid_skill_required" };
    const r = applySpecialization(skill, String(input.branch || ""));
    if (!r.ok) return r;
    const persisted = persistIfRequested(ctx, input, r.skill, "specialization", `specialize ${skill.name} → ${r.skill.name}`);
    return { ok: true, branch: r.branch, mode: r.mode, skill: r.skill, ...persisted };
  }, { note: "branch a power into a tactical mode" });

  register("skill-awakening", "awaken", async (ctx, input = {}) => {
    const skill = normalize(input.skill);
    if (!skill) return { ok: false, reason: "valid_skill_required" };
    const r = computeAwakening(skill, String(input.trigger || ""), input.seedKey || "");
    if (!r.ok) return r;
    const awakened = { ...skill, name: r.name, maxDamage: r.newMaxDamage };
    const persisted = persistIfRequested(ctx, input, awakened, "awakening", `awaken ${skill.name} (${r.trigger})`);
    return { ok: true, awakening: r, skill: awakened, ...persisted };
  }, { note: "realise a stress-triggered awakening into a power spike + branch unlock" });
}
