// server/domains/religion.js
//
// Phase II Wave 24 — religion / faith lens macros.

import {
  foundFaith,
  getFaith,
  listFaiths,
  join,
  leave,
  pray,
  sermon,
  convert,
  accuseHeresy,
  excommunicate,
  getWorshipper,
  listWorshippersForActor,
  tickFaiths,
  listRecentEvents,
  RELIGION_CONSTANTS,
} from "../lib/religion-engine.js";

export default function registerReligionMacros(register) {
  register("religion", "found", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      return foundFaith(db, {
        actorKind: "player",
        actorId: userId,
        name: input?.name,
        doctrine: input?.doctrine,
      });
    } catch (err) {
      return { ok: false, reason: "invalid_input", message: err?.message || String(err) };
    }
  });

  register("religion", "list", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, faiths: listFaiths(db) };
  });

  register("religion", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const faith = getFaith(db, String(input?.faithId || ""));
    if (!faith) return { ok: false, reason: "faith_not_found" };
    return { ok: true, faith };
  });

  register("religion", "join", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return join(db, String(input?.faithId || ""), "player", userId);
  });

  register("religion", "leave", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return leave(db, String(input?.faithId || ""), "player", userId);
  });

  register("religion", "pray", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return pray(db, String(input?.faithId || ""), "player", userId);
  });

  register("religion", "sermon", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return sermon(db, String(input?.faithId || ""), "player", userId, {
      audienceSize: input?.audienceSize,
      recruitedOverride: input?.recruitedOverride,
    });
  });

  register("religion", "convert", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return convert(
      db,
      String(input?.faithId || ""),
      String(input?.targetActorKind || "npc"),
      String(input?.targetActorId || ""),
      "player",
      userId,
    );
  });

  register("religion", "accuse_heresy", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return accuseHeresy(
      db,
      String(input?.faithId || ""),
      "player",
      userId,
      String(input?.targetActorKind || "npc"),
      String(input?.targetActorId || ""),
    );
  });

  register("religion", "excommunicate", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return excommunicate(
      db,
      String(input?.faithId || ""),
      "player",
      userId,
      String(input?.targetActorKind || "npc"),
      String(input?.targetActorId || ""),
    );
  });

  register("religion", "my_worship", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, worship: listWorshippersForActor(db, "player", userId) };
  });

  register("religion", "worshipper", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    // actorId falls back to the caller (look up MY worshipper detail for a faith);
    // pass an explicit actorId to inspect someone else. Without the fallback the
    // default "" never matched, so worshipper({faithId}) always returned
    // not_a_worshipper even for a member. Pinned by religion-behavior.test.js.
    const actorId = String(input?.actorId || ctx?.actor?.userId || "");
    const w = getWorshipper(db, String(input?.faithId || ""), String(input?.actorKind || "player"), actorId);
    if (!w) return { ok: false, reason: "not_a_worshipper" };
    return { ok: true, worshipper: w };
  });

  register("religion", "tick", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return tickFaiths(db);
  });

  register("religion", "recent_events", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, events: listRecentEvents(db, String(input?.faithId || ""), input?.limit) };
  });

  register("religion", "constants", async () => {
    return { ok: true, constants: RELIGION_CONSTANTS };
  });
}
