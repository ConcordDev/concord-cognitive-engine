// server/domains/skill-fusion.js
//
// WS4(d) — player cross-skill fusion. Lets a player combine two of their own
// powers into a novel stronger one (the MHA fusion engine, applied to players
// rather than bred creatures). Two macros:
//   - skill-fusion.preview: pure, returns what the fusion WOULD produce (safe to
//     call freely; no writes). Powers a "what do these make?" UI.
//   - skill-fusion.fuse: persists the fused power via the emergent-skills
//     createSkill path (the same proven persistence creature fusion uses),
//     owned by the caller.
//
// Inputs are normalized skill descriptors { name, element, maxDamage, rangeM }
// (the frontend already has these from the player's skill list), so this stays
// out of the dtus-schema-variance minefield.

import { fuseTwoSkills, skillFusionEnabled } from "../lib/skill-fusion.js";
import { createSkill } from "../lib/emergent-skills.js";

function normalizeDescriptor(d) {
  if (!d || typeof d !== "object") return null;
  const maxDamage = Number(d.maxDamage ?? d.max_damage ?? 0);
  if (!(maxDamage > 0)) return null;
  return {
    name: String(d.name || "power"),
    element: String(d.element || "physical"),
    maxDamage,
    rangeM: Number(d.rangeM ?? d.range_m) || undefined,
  };
}

export default function registerSkillFusionMacros(register) {
  register("skill-fusion", "preview", async (_ctx, input = {}) => {
    const a = normalizeDescriptor(input.a);
    const b = normalizeDescriptor(input.b);
    if (!a || !b) return { ok: false, reason: "two_damaging_skills_required" };
    const fused = fuseTwoSkills(a, b, {
      stability: Number(input.stability ?? 1),
      generation: Number(input.generation ?? 1),
      inbred: !!input.inbred,
      seedKey: `${a.name}|${b.name}`,
    });
    return { ok: true, fused };
  }, { note: "preview the fusion of two skills (no writes)" });

  register("skill-fusion", "fuse", async (ctx, input = {}) => {
  try {
    if (!skillFusionEnabled()) return { ok: false, reason: "fusion_disabled" };
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId || ctx?.userId || null;
    if (!userId) return { ok: false, reason: "auth_required" };

    const a = normalizeDescriptor(input.a);
    const b = normalizeDescriptor(input.b);
    if (!a || !b) return { ok: false, reason: "two_damaging_skills_required" };

    const fused = fuseTwoSkills(a, b, {
      stability: Number(input.stability ?? 1),
      generation: Number(input.generation ?? 1),
      inbred: !!input.inbred,
      seedKey: `${userId}|${a.name}|${b.name}`,
    });

    const created = createSkill(db, {
      name: fused.name,
      verb: "fusion_strike",
      requires: { bodyParts: [], topologies: [] },
      costs: { stamina: 16, cooldownMs: 4000 },
      effects: [{ kind: "damage", params: { amount: fused.maxDamage, element: fused.element } }],
      origin: "player_fusion",
      parentId: userId,
      gameplayEvent: `player ${userId} fused ${a.name} + ${b.name}`,
    });
    if (!created.ok) return { ok: false, reason: created.reason || "persist_failed" };
    return { ok: true, fused, skillId: created.skill.id, skill: created.skill };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
}, { note: "fuse two of the player's skills into a new stronger power" });
}
