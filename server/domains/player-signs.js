// server/domains/player-signs.js
//
// Theme deferred (game-feel pass): macros for the async-cooperation
// player-signs substrate. Wraps server/lib/player-signs.js so frontend
// lenses can call the canonical CRUD via runMacro instead of direct
// HTTP routes (the lattice stack uses macros as the public surface).

import {
  placeSign,
  signsNearby,
  mySigns,
  removeSign,
  ALLOWED_KINDS,
  MAX_NEARBY_LIMIT,
} from "../lib/player-signs.js";

export default function registerPlayerSignsMacros(register) {
  register("playerSigns", "place", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return placeSign(db, {
      userId,
      worldId: input.worldId,
      position: input.position,
      kind: input.kind,
      message: input.message,
    });
  }, { note: "drop a sign in the world (rate-limited per user)" });

  register("playerSigns", "nearby", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const signs = signsNearby(db, {
      worldId: input.worldId,
      position: input.position,
      radiusM: input.radiusM,
      limit: Math.min(MAX_NEARBY_LIMIT, Number(input.limit ?? 50)),
    });
    return { ok: true, signs };
  }, { note: "list active signs near a world position", publicReadable: true });

  register("playerSigns", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return { ok: true, signs: mySigns(db, { userId, limit: input.limit }) };
  }, { note: "list signs the caller owns" });

  register("playerSigns", "remove", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return removeSign(db, { userId, signId: input.signId });
  }, { note: "remove a sign owned by the caller" });

  register("playerSigns", "kinds", async () => {
    return { ok: true, kinds: Array.from(ALLOWED_KINDS) };
  }, { note: "list valid sign kinds", publicReadable: true });
}
