// server/domains/craft-chains.js
//
// Concordia Phase 11 — multi-step craft chain macros.

import {
  registerChain,
  listChains,
  getChain,
  startChain,
  advanceStep,
  listJobsForUser,
  abandonJob,
} from "../lib/craft-chains.js";

export default function registerCraftChainsMacros(register) {
  register("craft_chains", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input?.worldId ? String(input.worldId) : null;
    return { ok: true, chains: listChains(db, worldId) };
  });

  register("craft_chains", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input?.chainId || "").trim();
    if (!id) return { ok: false, reason: "missing_inputs" };
    const chain = getChain(db, id);
    if (!chain) return { ok: false, reason: "chain_not_found" };
    return { ok: true, chain };
  });

  register("craft_chains", "register", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return registerChain(db, input);
  });

  register("craft_chains", "start", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const chainId = String(input?.chainId || "").trim();
    const worldId = String(input?.worldId || "concordia-hub");
    if (!chainId) return { ok: false, reason: "missing_inputs" };
    return startChain(db, userId, worldId, chainId);
  });

  register("craft_chains", "advance", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const jobId = String(input?.jobId || "").trim();
    if (!jobId) return { ok: false, reason: "missing_inputs" };
    return advanceStep(db, userId, jobId, {
      currentSeason: input?.currentSeason || null,
    });
  });

  register("craft_chains", "my_jobs", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, jobs: listJobsForUser(db, userId, input?.worldId ? String(input.worldId) : null) };
  });

  register("craft_chains", "abandon", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const jobId = String(input?.jobId || "").trim();
    if (!jobId) return { ok: false, reason: "missing_inputs" };
    return abandonJob(db, userId, jobId);
  });
}
