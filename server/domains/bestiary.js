// server/domains/bestiary.js
//
// Wave 2 / T1.2 — macro surface for the player creature-bestiary loop.
//
// Read + write macros so the BestiaryPanel can list discovered species
// and the world layer can record sightings. Discoveries are personal —
// no privacy gating needed beyond ownership.

import { recordSighting, getDiscoveries, getStats } from "../lib/bestiary.js";

export default function registerBestiaryMacros(register) {
  /**
   * bestiary.list — list the caller's discovered creatures.
   * input: { worldId?, kind?, limit? }
   */
  register("bestiary", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
    const kind = ["hybrid", "authored", "tamed", "bred"].includes(input.kind) ? input.kind : null;
    return {
      ok: true,
      discoveries: getDiscoveries(db, userId, {
        worldId: input.worldId || null,
        kind,
        limit,
      }),
    };
  });

  /**
   * bestiary.sight — record a sighting. Called by the world layer
   * when a player comes into render distance of a creature.
   * input: { worldId, kind, speciesRef, meta? }
   */
  register("bestiary", "sight", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.worldId || !input.kind || !input.speciesRef) {
      return { ok: false, reason: "missing_args" };
    }
    return recordSighting(db, userId, {
      worldId: input.worldId,
      kind: input.kind,
      speciesRef: input.speciesRef,
      meta: input.meta ?? null,
    });
  });

  /**
   * bestiary.stats — per-kind counts for the caller. Drives the
   * BestiaryPanel header.
   * input: { worldId? }
   */
  register("bestiary", "stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, stats: getStats(db, userId, { worldId: input.worldId || null }) };
  });
}
