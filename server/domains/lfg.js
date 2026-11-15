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
import { registerLensExportProvider } from "../lib/lens-export.js";

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


// ── lens export provider (FIX-lfg-007) ────────────────────────────────
// An open LFG request is a row in lfg_requests — not an artifact and not
// STATE — so the shared export told a queued player they had nothing to
// export. Emit the caller's own OPEN, unexpired requests, projecting the
// same fields listOpenLfg projects. The requester's raw id is never an
// export field (the lib's identity-display rule); the rows are the
// caller's own regardless.
function lfgExportRows(ctx) {
  const db = ctx?.db;
  const userId = ctx?.actor?.userId || ctx?.userId || null;
  if (!db || !userId) return [];
  try {
    const rows = db.prepare(`
      SELECT id, world_id AS worldId, role, party_type AS partyType, note,
             created_at AS createdAt, expires_at AS expiresAt,
             party_max_size AS partyMaxSize, current_party_size AS currentSize
        FROM lfg_requests
       WHERE requester_user_id = ? AND status = 'open' AND expires_at > unixepoch()
       ORDER BY created_at DESC
       LIMIT 1000
    `).all(userId);
    return rows.map((r) => ({
      id: r.id,
      type: "lfg-request",
      title: r.note || (r.role ? `LFG: ${r.role}` : "LFG request"),
      createdAt: r.createdAt ?? null,
      updatedAt: r.createdAt ?? null,
      data: {
        worldId: r.worldId || null,
        role: r.role || null,
        partyType: r.partyType || null,
        partyMaxSize: r.partyMaxSize ?? null,
        currentSize: r.currentSize ?? null,
        expiresAt: r.expiresAt ?? null,
      },
    }));
  } catch {
    return [];
  }
}

export default function registerLfgMacros(register) {
  registerLensExportProvider("lfg", lfgExportRows);
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
