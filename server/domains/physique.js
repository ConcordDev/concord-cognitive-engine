// server/domains/physique.js
//
// Concordia Phase 3 — actor physique macros (mass / height / body type).
//
// Macros:
//   physique.get_mine            — caller's physique (or defaults)
//   physique.set_mine            — set caller's physique
//   physique.preview_combat      — preview the mass multiplier vs a target
//
// The set_mine surface is intentionally generous (no rate limit) so
// the character-creation UI + the heir-takeover Phase 12 cascade can
// drive it. Combat path enforces clamping at compute time; nothing
// here trusts client values without bounds-checks in lib/actor-physique.

import {
  getPhysique,
  setPhysique,
  combatMassMultiplier,
  PHYSIQUE_CONSTANTS,
} from "../lib/actor-physique.js";

export default function registerPhysiqueMacros(register) {
  register("physique", "get_mine", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, physique: getPhysique(db, "player", userId) };
  });

  register("physique", "set_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setPhysique(db, "player", userId, {
      mass_kg: input?.mass_kg,
      height_m: input?.height_m,
      body_type: input?.body_type,
    });
  });

  register("physique", "preview_combat", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const targetKind = String(input?.targetKind || "npc");
    const targetId = String(input?.targetId || "").trim();
    if (!targetId) return { ok: false, reason: "missing_inputs" };
    if (!["player", "npc"].includes(targetKind)) return { ok: false, reason: "bad_target_kind" };
    return {
      ok: true,
      ...combatMassMultiplier(db,
        { kind: "player", id: userId },
        { kind: targetKind, id: targetId }),
    };
  });

  register("physique", "constants", async () => {
    return { ok: true, constants: PHYSIQUE_CONSTANTS };
  });
}
