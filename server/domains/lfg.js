// server/domains/lfg.js
//
// Phase U5 — macro surface for Looking-For-Group matchmaking.
//
// Thin delegation layer over server/lib/lfg.js. The HTTP routes
// (/api/lfg/*) already exist in server.js; these macros give the
// lens runner + the invariant-engine a registry-addressable surface
// with the SAME real behavior (no duplicated logic here — every macro
// calls straight through to the lib).
//
// Wired in server.js:
//   import registerLfgMacros from "./domains/lfg.js";
//   registerLfgMacros(register);

import {
  postLfg,
  cancelLfg,
  listOpenLfg,
  inviteFromLfg,
} from "../lib/lfg.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before it can
// silently clamp through the lib's Math.min/max bounds and still return ok:true.
// An absent field is fine (the macro/lib uses its default). Returns null when
// clean, or the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerLfgMacros(register) {
  /**
   * lfg.post — post a Looking-For-Group request. Auto-cancels any prior
   * OPEN request from the same user in the same world (a player can't be
   * queued in two roles at once — see content/contracts/overrides).
   * input: { worldId?, role?, partyType?, partyMaxSize?, note? }
   */
  register("lfg", "post", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const badNum = badNumericField(input, ["partyMaxSize"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    return postLfg(db, userId, input);
  }, { note: "post an LFG request (auto-cancels prior open in same world)" });

  /**
   * lfg.list — list open LFG requests, optionally filtered by world/role.
   * input: { worldId?, role?, limit? }
   */
  register("lfg", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    return {
      ok: true,
      requests: listOpenLfg(db, {
        worldId: input.worldId,
        role: input.role,
        limit: input.limit,
      }),
    };
  }, { note: "list open LFG requests (world/role filtered)" });

  /**
   * lfg.cancel — cancel one of the caller's own OPEN requests.
   * input: { lfgId }
   */
  register("lfg", "cancel", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.lfgId) return { ok: false, reason: "no_lfg_id" };
    return cancelLfg(db, input.lfgId, userId);
  }, { note: "cancel an own open LFG request" });

  /**
   * lfg.join — invite the LFG poster into the caller's party (creating
   * one if the caller has none) and mark the request matched.
   * input: { lfgId }
   */
  register("lfg", "join", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.lfgId) return { ok: false, reason: "no_lfg_id" };
    return inviteFromLfg(db, input.lfgId, userId);
  }, { note: "invite an LFG poster into the caller's party (matchmaking)" });
}
