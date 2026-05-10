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

  // Phase 4 (idea #10): cast a composed spell to affect the world.
  // Two cumulative effects: (1) embodied signal deltas pushed into
  // signalsForWorld at the cast cell — cast 100 cold-spells in a region
  // → permanent winter because the recency-weighted fold persists;
  // (2) row in spell_cast_log so terraform thresholds and hidden
  // sub-world unlocks via glyph-sequence hashing can query history.
  register("glyph_spells", "cast", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { spellId, worldId = "concordia-hub", x = 0, z = 0, magnitude = 1 } = input || {};
    if (!spellId) return { ok: false, reason: "missing_spellId" };

    const spell = db.prepare(`
      SELECT id, user_id, name, components_json, dtu_id
      FROM player_glyph_spells WHERE id = ?
    `).get(spellId);
    if (!spell) return { ok: false, reason: "spell_not_found" };
    if (spell.user_id !== userId) {
      const license = db.prepare(`
        SELECT 1 FROM dtu_citations
        WHERE creator_id = ? AND parent_id = ? AND kind = 'license'
      `).get(userId, spell.dtu_id);
      if (!license) return { ok: false, reason: "not_owner_or_licensed" };
    }

    let components = [];
    try { components = JSON.parse(spell.components_json || "[]"); } catch { components = []; }
    let element = "physical";
    if (Array.isArray(components) && components.length) {
      const counts = new Map();
      for (const c of components) counts.set(c.element || "physical", (counts.get(c.element || "physical") || 0) + 1);
      element = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    let feedbackApplied = 0;
    try {
      const sigMod = await import("../lib/embodied/signals.js");
      const skEnv = await import("../lib/embodied/skill-environment.js").catch(() => null);
      if (sigMod && skEnv?.elementalEnvFeedback) {
        const deltas = skEnv.elementalEnvFeedback(element, Number(magnitude) || 1);
        for (const d of deltas) {
          try {
            sigMod.recordSignal(db, {
              worldId, x, z,
              channel: d.channel,
              value: d.value,
              ttlSeconds: d.ttlSeconds || 600,
              source: "spell_cast",
            });
            feedbackApplied++;
          } catch { /* per-channel best-effort */ }
        }
      }
    } catch { /* embodied modules optional */ }

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spell_cast_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spell_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          world_id TEXT NOT NULL,
          x REAL NOT NULL,
          z REAL NOT NULL,
          element TEXT NOT NULL,
          magnitude REAL NOT NULL,
          cast_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_spell_cast_user ON spell_cast_log(user_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_spell_cast_world_loc ON spell_cast_log(world_id, x, z)`);
      db.prepare(`
        INSERT INTO spell_cast_log (spell_id, user_id, world_id, x, z, element, magnitude)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(spellId, userId, worldId, Number(x), Number(z), element, Number(magnitude));
    } catch { /* logging best-effort */ }

    return {
      ok: true,
      spellId, element, worldId,
      position: { x, z },
      magnitude,
      feedbackApplied,
      cumulativeNote: "embodied signals fold recency-weighted; repeated casts compound in cell",
    };
  }, { note: "Cast a composed spell at world coords. Cumulative env-signal deltas." });

  register("glyph_spells", "casts_in_region", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId = "concordia-hub", x = 0, z = 0, radius = 50 } = input || {};
    try {
      const rows = db.prepare(`
        SELECT element, COUNT(*) as count, AVG(magnitude) as avg_magnitude
        FROM spell_cast_log
        WHERE world_id = ?
          AND ABS(x - ?) <= ? AND ABS(z - ?) <= ?
        GROUP BY element
        ORDER BY count DESC
      `).all(worldId, Number(x), Number(radius), Number(z), Number(radius));
      return { ok: true, worldId, x, z, radius, byElement: rows };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Count of casts within radius m of (x,z) grouped by element." });
}
