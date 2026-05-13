// server/domains/realm-access.js
//
// Concordia Phase 4 — player-facing realm-access macros.
//
// Macros:
//   realm_access.check         — { realmId } → welcome/neutral/suspicious/exiled
//   realm_access.move_check    — { worldId, x, z } → can the player move here?
//   realm_access.list_my_exiles — list active exiles for the caller

import {
  canEnterRealm,
  assertCanMoveTo,
  listExilesForUser,
  pardonExile,
} from "../lib/realm-access.js";

export default function registerRealmAccessMacros(register) {
  register("realm_access", "check", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const realmId = String(input?.realmId || "").trim();
    if (!realmId) return { ok: false, reason: "missing_inputs" };
    return canEnterRealm(db, userId, realmId);
  });

  register("realm_access", "move_check", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = String(input?.worldId || "").trim();
    const x = Number(input?.x), z = Number(input?.z);
    if (!worldId || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "missing_inputs" };
    return assertCanMoveTo(db, userId, worldId, { x, z });
  });

  register("realm_access", "list_my_exiles", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, exiles: listExilesForUser(db, userId) };
  });

  // pardon is a privileged op — only realm ruler / system can call.
  // For Phase 4 we keep this open at the macro layer; tighter auth
  // arrives with Phase 16 (council-as-playable) which has the
  // appropriate gates already.
  register("realm_access", "pardon", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const realmId = String(input?.realmId || "").trim();
    const targetUserId = String(input?.targetUserId || "").trim();
    if (!realmId || !targetUserId) return { ok: false, reason: "missing_inputs" };
    return pardonExile(db, realmId, targetUserId, userId);
  });
}
