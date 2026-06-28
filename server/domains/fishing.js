// server/domains/fishing.js
//
// Macro surface for the fishing minigame (`/lenses/fishing`).
//
// The lens drives the REST routes (`/api/fishing/*` in server.js +
// server/routes/fishing.js), which are themselves thin wrappers over
// server/lib/fishing.js. This file exposes the SAME lib functions as
// registered macros so:
//   - the Orchestrated Invariant Engine (macro-assassin) can drive the
//     cast / reel / catalog paths adversarially against a real DB, and
//   - the generic lens shell / ⌘K / mobile MacroClient can reach fishing
//     through the uniform `POST /api/lens/run { domain:"fishing", name, input }`
//     path without bespoke endpoints.
//
// Every macro delegates to the real lib — no cast/reel/catch/species logic is
// duplicated here. Read macros (catalog / species / catches / session) are
// headless-safe; write macros (cast / reel / create) validate inputs and
// return a clean { ok:false, reason } envelope rather than throwing.

import {
  castLine,
  resolveFishCatch,
  mintFishCatch,
  getSession,
  listFishForWorld,
} from "../lib/fishing.js";

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.user?.id || ctx?.user?.userId || null;
}

function clampStr(v, n, fallback) {
  if (v === undefined || v === null) return fallback;
  return String(v).slice(0, n);
}

export default function registerFishingMacros(register) {
  // ── reads (headless-safe) ──────────────────────────────────────────────

  /**
   * fishing.catalog — all fish authored for a world (optionally biome-filtered).
   * input: { worldId?, biome? }
   */
  register("fishing", "catalog", async (_ctx, input = {}) => {
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const biome = input.biome ? clampStr(input.biome, 32, null) : null;
    return { ok: true, worldId, biome: biome || null, fish: listFishForWorld(worldId, biome) };
  }, { note: "list fish authored for a world (biome-filterable)" });

  /**
   * fishing.species — biome-scoped species table (the per-biome pool a cast in
   * that biome can yield). Alias-shaped read used by the lens species browser.
   * input: { worldId?, biome }
   */
  register("fishing", "species", async (_ctx, input = {}) => {
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const biome = clampStr(input.biome, 32, "water");
    return { ok: true, worldId, biome, fish: listFishForWorld(worldId, biome) };
  }, { note: "biome-scoped species pool for a cast" });

  /**
   * fishing.list — generic lens read alias (catalog) so the lens manifest's
   * `lens.fishing.list` resolves. input: { worldId?, biome? }
   */
  register("fishing", "list", async (_ctx, input = {}) => {
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const biome = input.biome ? clampStr(input.biome, 32, null) : null;
    return { ok: true, items: listFishForWorld(worldId, biome) };
  }, { note: "generic lens list (fish catalog)" });

  /**
   * fishing.get — one fish descriptor by id. input: { worldId?, fishId }
   */
  register("fishing", "get", async (_ctx, input = {}) => {
    if (!input.fishId) return { ok: false, reason: "no_fish_id" };
    const worldId = clampStr(input.worldId, 64, "concordia-hub");
    const fish = listFishForWorld(worldId).find((f) => f.id === input.fishId);
    if (!fish) return { ok: false, reason: "no_fish" };
    return { ok: true, fish };
  }, { note: "get one fish descriptor" });

  /**
   * fishing.catches — a user's recent catches from player_inventory.
   * input: { userId?, limit? }
   */
  register("fishing", "catches", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    try {
      const catches = db.prepare(`
        SELECT id, world_id, item_id, item_name, acquired_at, metadata AS meta_json
        FROM player_inventory
        WHERE user_id = ? AND item_type = 'raw_fish'
        ORDER BY acquired_at DESC LIMIT ?
      `).all(userId, limit);
      return { ok: true, catches };
    } catch (e) {
      // Minimal-schema fallback (item_type/item_name may be absent on a
      // partially-migrated DB) — return an honest empty list, never throw.
      return { ok: true, catches: [], reason: e?.message };
    }
  }, { note: "recent raw_fish catches for the user" });

  /**
   * fishing.session — inspect an open cast session (bite timing). Read-only.
   * input: { sessionId }
   */
  register("fishing", "session", async (_ctx, input = {}) => {
    if (!input.sessionId) return { ok: false, reason: "no_session_id" };
    const s = getSession(String(input.sessionId));
    if (!s) return { ok: false, reason: "session_not_found" };
    return {
      ok: true,
      session: {
        worldId: s.worldId, biome: s.biome,
        biteAtEpochMs: s.biteAt, expiresAt: s.expiresAt,
        resolved: s.resolved, candidateCount: s.candidatePool.length,
      },
    };
  }, { note: "inspect an open cast session" });

  // ── writes (validate, never throw) ─────────────────────────────────────

  /**
   * fishing.cast — open a cast session. input: { worldId?, x?, z?, biome? }
   * Returns sessionId + biteAtEpochMs.
   */
  register("fishing", "cast", async (ctx, input = {}) => {
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    const result = castLine({
      userId,
      worldId: clampStr(input.worldId, 64, "concordia-hub"),
      x: Number(input.x) || 0,
      z: Number(input.z) || 0,
      biome: clampStr(input.biome, 32, "water"),
    });
    // castLine returns { ok:false, error } — normalize to a reason envelope.
    if (!result.ok) return { ok: false, reason: result.error };
    return result;
  }, { note: "open a fishing cast session" });

  // Shared reel→mint path used by both `reel` and the `create` artifact verb,
  // so the catch logic lives in exactly one place and both delegate to the lib.
  async function doReel(ctx, input = {}) {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = actorId(ctx);
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.sessionId) return { ok: false, reason: "no_session_id" };
    const session = getSession(String(input.sessionId));
    const result = resolveFishCatch({
      sessionId: String(input.sessionId),
      reactionMs: Number(input.reactionMs) || 1000,
      tensionAccuracy: Number(input.tensionAccuracy) || 0.5,
      fishingSkill: Number(input.fishingSkill) || 0,
    });
    if (!result.ok) return { ok: false, reason: result.error };
    const mint = mintFishCatch(db, {
      userId,
      worldId: session?.worldId || "concordia-hub",
      fish: result.fish,
      qualityScore: result.qualityScore,
      sessionId: String(input.sessionId),
    });
    return { ok: true, fish: result.fish, qualityScore: result.qualityScore, tier: result.tier, mint };
  }

  /**
   * fishing.reel — resolve a reel attempt for an open session and mint the
   * catch into inventory. input: { sessionId, reactionMs?, tensionAccuracy?,
   * fishingSkill? }
   *
   * A successful reel yields a real species from the biome's pool AND adds
   * exactly one raw_fish inventory row.
   */
  register("fishing", "reel", doReel, {
    note: "resolve a reel + mint the caught fish into inventory",
  });

  /**
   * fishing.create — the generic lens `create` artifact verb: a "catch"
   * artifact is created by reeling in an open session. Surfaced so the
   * manifest's `lens.fishing.create` resolves and the catch path emits its
   * DTU exhaust through the SAME code as reel (no duplicated logic).
   * input: { sessionId, reactionMs?, tensionAccuracy?, fishingSkill? }
   */
  register("fishing", "create", doReel, {
    note: "create a catch artifact (reel an open session)",
  });
}
