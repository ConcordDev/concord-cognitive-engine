// server/domains/culture.js
//
// Concordia Phase 13 — culture / friction / marriage macros.

import {
  getCulture,
  setCulture,
  getFriction,
  setFriction,
  opinionFrictionDelta,
  marry,
  listMarriagesFor,
  dissolveMarriage,
} from "../lib/culture-friction.js";

export default function registerCultureMacros(register) {
  register("culture", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const actorKind = String(input?.actorKind || "player");
    const actorId = String(input?.actorId || ctx?.actor?.userId || "").trim();
    if (!actorId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, culture: getCulture(db, actorKind, actorId) };
  });

  register("culture", "set_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const culture_id = String(input?.culture_id || "").trim();
    if (!culture_id) return { ok: false, reason: "missing_inputs" };
    return setCulture(db, "player", userId, culture_id, input?.faith_id || null);
  });

  register("culture", "friction", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const a = String(input?.a || "").trim();
    const b = String(input?.b || "").trim();
    if (!a || !b) return { ok: false, reason: "missing_inputs" };
    return { ok: true, friction: getFriction(db, a, b) };
  });

  register("culture", "set_friction", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const a = String(input?.a || "").trim();
    const b = String(input?.b || "").trim();
    const friction = Number(input?.friction);
    if (!a || !b || !Number.isFinite(friction)) return { ok: false, reason: "missing_inputs" };
    return setFriction(db, a, b, friction);
  });

  register("culture", "preview_friction_delta", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const targetKind = String(input?.targetKind || "npc");
    const targetId = String(input?.targetId || "").trim();
    if (!targetId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, delta: opinionFrictionDelta(db, "player", userId, targetKind, targetId) };
  });

  register("marriage", "marry", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const partner = {
      kind: String(input?.partnerKind || "npc"),
      id: String(input?.partnerId || "").trim(),
    };
    if (!partner.id) return { ok: false, reason: "missing_inputs" };
    return marry(db, { kind: "player", id: userId }, partner);
  });

  register("marriage", "list_mine", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, marriages: listMarriagesFor(db, "player", userId) };
  });

  register("marriage", "dissolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const marriageId = String(input?.marriageId || "").trim();
    if (!marriageId) return { ok: false, reason: "missing_inputs" };
    return dissolveMarriage(db, marriageId, input?.reason || "divorced");
  });
}
