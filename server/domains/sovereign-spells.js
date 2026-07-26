// server/domains/sovereign-spells.js
//
// sovereign-ruins bespoke mechanic — "Still-Running Spells" macro
// surface (see server/lib/sovereign-spells.js for the full lore
// citation + implementation, and migration 392 for the schema).

import {
  seedSite,
  listSites,
  readSite,
  catalogueSite,
  completeSite,
  totalShardsEarned,
  SOVEREIGN_RUINS_WORLD_ID,
} from "../lib/sovereign-spells.js";

export default function registerSovereignSpellsMacros(register) {
  register("sovereign_spells", "seed_site", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return seedSite(db, {
      worldId: input.worldId || SOVEREIGN_RUINS_WORLD_ID,
      district: input.district,
      spellKind: input.spellKind,
      ageAnnums: input.ageAnnums,
      difficulty: input.difficulty,
      x: input.x,
      z: input.z,
    });
  }, { note: "persists a still-running spell site; identity/placement is the caller's (content-seeder / admin) responsibility" });

  register("sovereign_spells", "list_sites", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return listSites(db, { worldId: input.worldId || SOVEREIGN_RUINS_WORLD_ID });
  }, { note: "lists sites without revealing spell_kind/stability/difficulty — those require an actual read" });

  register("sovereign_spells", "read_site", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return readSite(db, { worldId: input.worldId || SOVEREIGN_RUINS_WORLD_ID, userId, siteId: input.siteId });
  }, { note: "real refusal_glyph_reading skill check against user_skills; honest revealed:false on insufficient skill" });

  register("sovereign_spells", "catalogue_site", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return catalogueSite(db, { worldId: input.worldId || SOVEREIGN_RUINS_WORLD_ID, userId, siteId: input.siteId });
  }, { note: "the Archivists' stated goal — requires a genuine prior read; awards memory_shards" });

  register("sovereign_spells", "complete_site", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return completeSite(db, {
      worldId: input.worldId || SOVEREIGN_RUINS_WORLD_ID,
      userId,
      siteId: input.siteId,
      acknowledgeRecipientDead: input.acknowledgeRecipientDead === true,
    });
  }, { note: "the Long Summons's own mechanic — completes on stability decay or explicit acknowledgement the recipient is dead" });

  register("sovereign_spells", "shards_earned", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return { ok: true, shardsEarned: totalShardsEarned(db, { userId }) };
  }, { note: "sums memory_shards earned via read/catalogue/complete for the caller" });
}
