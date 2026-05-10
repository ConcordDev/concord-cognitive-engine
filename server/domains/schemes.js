// server/domains/schemes.js
//
// Sprint C / Track A4 — macro surface for NPC + player schemes.

import {
  proposePlayerScheme,
  discoverScheme,
  listSchemesForUser,
  listSchemesAgainstUser,
} from "../lib/npc-schemes.js";

export default function registerSchemesMacros(register) {
  /**
   * schemes.list_for_user — schemes the caller is plotting.
   */
  register("schemes", "list_for_user", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, schemes: listSchemesForUser(db, userId) };
  });

  /**
   * schemes.list_against_user — schemes the caller is targeted by (suspected).
   * Caller's discovered evidence count gates how much detail is exposed.
   */
  register("schemes", "list_against_user", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, schemes: listSchemesAgainstUser(db, userId) };
  });

  /**
   * schemes.propose_player_scheme — open a player-driven scheme.
   * input: { targetKind, targetId, kind }
   */
  register("schemes", "propose_player_scheme", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return proposePlayerScheme(db, userId, input);
  });

  /**
   * schemes.discover_evidence — caller marks scheme evidence as discovered.
   * input: { schemeId, evidenceKind? }
   */
  register("schemes", "discover_evidence", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.schemeId) return { ok: false, reason: "missing_inputs" };
    return discoverScheme(db, userId, input.schemeId, input.evidenceKind);
  });
}
