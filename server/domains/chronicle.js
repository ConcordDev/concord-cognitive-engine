// server/domains/chronicle.js
//
// Living Society — Phase 7: Chronicle macro surface.
//
// list_entries     — the world's recent narrative beats.
// world_chronicle  — alias for list_entries (the public read).
// realm_health     — the ruler's derived labor-symptom surface.
// my_saga / compose_saga — mint a kind='chronicle' saga DTU from the beats.

import { listEntries, realmHealth, mintSaga } from "../lib/chronicle/chronicle.js";

export default function registerChronicleMacros(register) {
  const list = async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || "concordia-hub";
    return { ok: true, entries: listEntries(db, worldId, Math.min(200, Number(input.limit) || 50)) };
  };
  register("chronicle", "list_entries", list, { note: "recent world chronicle beats" });
  register("chronicle", "world_chronicle", list, { note: "public chronicle read" });

  register("chronicle", "realm_health", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, health: realmHealth(db, input.worldId || "concordia-hub", input.realmId || null) };
  }, { note: "ruler labor-symptom surface (not a rebellion bar)" });

  register("chronicle", "compose_saga", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return mintSaga(db, { worldId: input.worldId || "concordia-hub", userId, title: input.title, entryLimit: Number(input.entryLimit) || 20 });
  }, { note: "mint a saga DTU from the chronicle" });

  register("chronicle", "my_saga", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    try {
      const sagas = db.prepare(`SELECT id, title, created_at FROM dtus WHERE creator_id = ? AND kind = 'chronicle' ORDER BY created_at DESC LIMIT 20`).all(userId);
      return { ok: true, sagas };
    } catch { return { ok: true, sagas: [] }; }
  }, { note: "list the player's minted sagas" });
}
