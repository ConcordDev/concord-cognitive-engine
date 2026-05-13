// server/domains/dynasty.js
//
// Concordia Phase 12 — dynasty + heir macros.

import {
  foundDynasty,
  getDynastyForUser,
  getDynasty,
  acceptHeir,
  bumpRenown,
  listHeirTakeoverLog,
} from "../lib/player-dynasty.js";
import { setBirth, getAge, advanceAging } from "../lib/aging-engine.js";

export default function registerDynastyMacros(register) {
  register("dynasty", "found", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const houseName = String(input?.houseName || "").trim();
    if (!houseName) return { ok: false, reason: "missing_inputs" };
    return foundDynasty(db, userId, houseName);
  });

  register("dynasty", "mine", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, dynasty: getDynastyForUser(db, userId) };
  });

  register("dynasty", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input?.dynastyId || "").trim();
    if (!id) return { ok: false, reason: "missing_inputs" };
    const d = getDynasty(db, id);
    if (!d) return { ok: false, reason: "dynasty_not_found" };
    return { ok: true, dynasty: d };
  });

  register("dynasty", "accept_heir", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dynastyId = String(input?.dynastyId || "").trim();
    const heirUserId = String(input?.heirUserId || "").trim();
    if (!dynastyId || !heirUserId) return { ok: false, reason: "missing_inputs" };
    return acceptHeir(db, dynastyId, heirUserId, { cause: input?.cause || "natural_death" });
  });

  register("dynasty", "bump_renown", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dynastyId = String(input?.dynastyId || "").trim();
    const delta = Number(input?.delta);
    if (!dynastyId || !Number.isFinite(delta)) return { ok: false, reason: "missing_inputs" };
    return bumpRenown(db, dynastyId, delta);
  });

  register("dynasty", "log", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dynastyId = String(input?.dynastyId || "").trim();
    if (!dynastyId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, takeovers: listHeirTakeoverLog(db, dynastyId) };
  });

  register("dynasty", "set_birth", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const npcId = String(input?.npcId || "").trim();
    if (!npcId) return { ok: false, reason: "missing_inputs" };
    return setBirth(db, npcId, input?.archetype || null, Number(input?.currentConcordiaDay) || 0);
  });

  register("dynasty", "get_age", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const npcId = String(input?.npcId || "").trim();
    if (!npcId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, age: getAge(db, npcId, Number(input?.currentConcordiaDay) || 0) };
  });

  register("dynasty", "advance_aging", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return advanceAging(db, Number(input?.currentConcordiaDay) || 0);
  });
}
