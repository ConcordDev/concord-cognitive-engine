// server/domains/jobs.js
//
// Concordia Phase 10 — Tunyan jobs + rations macros.

import {
  listOpenJobs,
  applyForJob,
  resign,
  completeShift,
  getMyEmployment,
  listRationEntitlements,
  setDemographicKind,
} from "../lib/tunyan-jobs.js";

const DEFAULT_WORLD = "concordia-hub";

export default function registerJobsMacros(register) {
  register("jobs", "list", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, jobs: listOpenJobs(db) };
  });

  register("jobs", "my_employment", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, employment: getMyEmployment(db, userId, String(input?.worldId || DEFAULT_WORLD)) };
  });

  register("jobs", "apply", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const jobId = String(input?.jobId || "").trim();
    if (!jobId) return { ok: false, reason: "missing_inputs" };
    return applyForJob(db, userId, String(input?.worldId || DEFAULT_WORLD), jobId);
  });

  register("jobs", "resign", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return resign(db, userId, String(input?.worldId || DEFAULT_WORLD));
  });

  register("jobs", "complete_shift", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    // Wages are paid on the sparks ledger (completeShift's default payer).
    return completeShift(db, userId, String(input?.worldId || DEFAULT_WORLD));
  });

  register("jobs", "set_demographic", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const dk = String(input?.demographic_kind || "").trim();
    if (!dk) return { ok: false, reason: "missing_inputs" };
    // Ration-bearing categories need an admin; players can only mark
    // themselves employed/unemployed.
    const role = ctx?.actor?.role;
    const isAdmin = role === "admin" || role === "owner" || role === "sovereign" || role === "founder";
    const target = isAdmin && input?.userId ? String(input.userId) : userId;
    return setDemographicKind(db, target, String(input?.worldId || DEFAULT_WORLD), dk, { verified: isAdmin });
  });

  register("jobs", "rations_table", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, entitlements: listRationEntitlements(db) };
  });
}
