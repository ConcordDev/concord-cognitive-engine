// server/domains/glyph-spells.js
//
// Phase 5d — macro surface for player glyph composition.

import {
  seedDefaultGlyphLibrary,
  listGlyphComponents,
  composeSpell,
  mintSpell,
  listSpellsForUser,
} from "../lib/glyph-spells.js";

export default function registerGlyphSpellMacros(register) {
  register("glyph_spells", "list_components", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, components: listGlyphComponents(db) };
  }, { note: "list available glyph components" });

  register("glyph_spells", "preview", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return composeSpell(db, input.componentIds || []);
  }, { note: "preview a composed spell without minting" });

  register("glyph_spells", "mint", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return mintSpell(db, {
      userId,
      worldId: input.worldId || "concordia-hub",
      componentIds: input.componentIds || [],
      name: input.name,
    });
  }, { note: "mint a composed spell as a recipe DTU" });

  register("glyph_spells", "list_for_user", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return { ok: true, spells: listSpellsForUser(db, userId) };
  }, { note: "list user's composed spells" });

  register("glyph_spells", "seed_library", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return seedDefaultGlyphLibrary(db);
  }, { note: "seed the default 10-glyph library (idempotent)" });
}
