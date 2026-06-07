// server/domains/city.js
//
// Phase II Wave 18 — city institution macros.

import {
  ensureBudget, getBudget,
  setTaxRate, setAllocations,
  enactPolicy, repealPolicy, listActivePolicies,
  snapshotHappiness, latestSnapshot,
  CITY_CONSTANTS,
} from "../lib/city-engine.js";

export default function registerCityMacros(register) {
  register("city", "get_budget", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, budget: ensureBudget(db, String(input?.worldId || "")) };
  });

  register("city", "set_tax_rate", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return setTaxRate(db, String(input?.worldId || ""), input?.taxRatePct);
  });

  register("city", "set_allocations", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return setAllocations(db, String(input?.worldId || ""), input?.allocations || {});
  });

  register("city", "enact", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    return enactPolicy(db, String(input?.worldId || ""), String(input?.kind || ""), {
      enactedByUser: userId, payload: input?.payload,
    });
  });

  register("city", "repeal", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return repealPolicy(db, String(input?.worldId || ""), String(input?.kind || ""));
  });

  register("city", "policies", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, policies: listActivePolicies(db, String(input?.worldId || "")) };
  });

  register("city", "snapshot_happiness", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return snapshotHappiness(db, String(input?.worldId || ""));
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  register("city", "latest_happiness", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, snapshot: latestSnapshot(db, String(input?.worldId || "")) };
  });

  register("city", "summary", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "");
    return {
      ok: true,
      budget: getBudget(db, worldId),
      policies: listActivePolicies(db, worldId),
      happiness: latestSnapshot(db, worldId),
    };
  });

  register("city", "constants", async () => {
    return { ok: true, constants: CITY_CONSTANTS };
  });
}
