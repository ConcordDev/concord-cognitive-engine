// server/domains/skill-tree.js
//
// Phase II Wave 16 — skill tree aggregator domain macros.

import {
  getSkillTreeForActor,
  checkSkillGate,
  SKILL_TREE_CONSTANTS,
} from "../lib/skill-tree-engine.js";

export default function registerSkillTreeMacros(register) {
  register("skill_tree", "for_me", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return getSkillTreeForActor(db, "player", userId);
  });

  register("skill_tree", "for_actor", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return getSkillTreeForActor(db, String(input?.actorKind || "player"), String(input?.actorId || ""));
  });

  register("skill_tree", "check_gate", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return checkSkillGate(db, "player", userId, input?.requirements || []);
  });

  register("skill_tree", "catalog", async () => {
    return { ok: true, catalog: SKILL_TREE_CONSTANTS.SKILL_CATALOG };
  });
}
