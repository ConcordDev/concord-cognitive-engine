// server/domains/crucible.js
//
// lattice-crucible bespoke mechanic — macro surface for "player-conditional
// drift" (see server/lib/embodied/crucible-observer-drift.js for the full
// lore citation + implementation, and migration 391 for the schema).

import {
  recordObserverDrift,
  getOrlaCorpus,
  discloseCorpus,
  CRUCIBLE_WORLD_ID,
} from "../lib/embodied/crucible-observer-drift.js";

export default function registerCrucibleMacros(register) {
  register("crucible", "check_observer_drift", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return recordObserverDrift(db, {
      worldId: input.worldId || CRUCIBLE_WORLD_ID,
      userId,
    });
  }, { note: "records a real player-conditional drift event iff the caller has an open presence in lattice-crucible" });

  register("crucible", "orla_corpus", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return getOrlaCorpus(db, { worldId: input.worldId || CRUCIBLE_WORLD_ID });
  }, { note: "Orla's private compiled corpus of player-conditional drift events" });

  register("crucible", "disclose_corpus", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return discloseCorpus(db, { worldId: input.worldId || CRUCIBLE_WORLD_ID });
  }, { note: "the deliberate act of releasing the corpus to the other Witnesses (Charter Question resolution hook)" });
}
