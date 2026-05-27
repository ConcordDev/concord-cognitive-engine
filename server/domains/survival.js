// server/domains/survival.js
//
// Phase II Wave 20 — survival sim domain macros.

import {
  ensureBudget,
  getBudget,
  tickSurvival,
  eat,
  drink,
  sleepRestore,
  contractDisease,
  tickDiseases,
  listActiveDiseases,
  curePartial,
  SURVIVAL_CONSTANTS,
} from "../lib/survival-engine.js";

export default function registerSurvivalMacros(register) {
  register("survival", "get_budget", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, budget: ensureBudget(db, userId) };
  });

  register("survival", "tick", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const ambientTempC = typeof input?.ambientTempC === "number" ? input.ambientTempC : null;
    const out = tickSurvival(db, userId, { ambientTempC });
    return { ok: true, ...out };
  });

  register("survival", "eat", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return eat(db, userId, input?.nutritionValue);
  });

  register("survival", "drink", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return drink(db, userId, input?.hydrationValue);
  });

  register("survival", "sleep", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return sleepRestore(db, userId, input?.quality, input?.minutes);
  });

  register("survival", "contract_disease", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.diseaseId) return { ok: false, reason: "missing_inputs" };
    return contractDisease(db, userId, String(input.diseaseId), {
      severity: input?.severity,
      contagionRadiusM: input?.contagionRadiusM,
      symptoms: input?.symptoms,
    });
  });

  register("survival", "tick_diseases", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, events: tickDiseases(db, userId) };
  });

  register("survival", "list_diseases", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, diseases: listActiveDiseases(db, userId) };
  });

  register("survival", "cure_partial", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input?.diseaseId) return { ok: false, reason: "missing_inputs" };
    return curePartial(db, userId, String(input.diseaseId), input?.severityReduction);
  });

  register("survival", "constants", async () => {
    return { ok: true, constants: SURVIVAL_CONSTANTS };
  });

  register("survival", "summary", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const budget = getBudget(db, userId) || ensureBudget(db, userId);
    const diseases = listActiveDiseases(db, userId);
    return {
      ok: true,
      budget,
      diseases,
      diseaseCount: diseases.length,
    };
  });
}
