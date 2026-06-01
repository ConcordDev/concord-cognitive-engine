/**
 * Contract tests for the headless-verifiable playtest fixes
 * (Vael's Expedition — docs/PLAYTEST_FINDINGS_PLAN.md).
 *
 *   #6  — creatures.taxonomy accepts the codebase-standard species_id alias.
 *   #2  — domains/minigames.js registers its resolver macros when wired.
 *   #30 — glyph_spells.cast license check no longer hard-throws on a non-owner
 *         (the dtu_citations column-drift returns a clean rejection, not a 500).
 *
 * Run: node --test server/tests/playtest-fixes.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Minimal register harness: capture (domain,name)->fn like the macro bus.
function makeRegistry() {
  const map = new Map();
  const register = (domain, name, fn) => map.set(`${domain}.${name}`, fn);
  return { map, register, get: (k) => map.get(k) };
}

describe("#6 — creatures.taxonomy param alias", () => {
  it("accepts species_id (snake_case) and speciesId (legacy)", async () => {
    const reg = makeRegistry();
    const mod = await import("../domains/creatures.js");
    (mod.default || mod.registerCreatureMacros)(reg.register);
    const taxonomy = reg.get("creatures.taxonomy");
    assert.ok(taxonomy, "taxonomy macro registered");

    const bySnake = await taxonomy({}, { species_id: "wolf" });
    assert.equal(bySnake.ok, true, "species_id resolves");
    const byCamel = await taxonomy({}, { speciesId: "wolf" });
    assert.equal(byCamel.ok, true, "speciesId still resolves");
    const missing = await taxonomy({}, {});
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing_species_id");
  });
});

describe("#2 — minigames domain registers its macros", () => {
  it("registerMinigameMacros wires the resolver macro surface", async () => {
    const reg = makeRegistry();
    const mod = await import("../domains/minigames.js");
    (mod.default || mod.registerMinigameMacros)(reg.register);
    // The domain registers the minigame resolver surface; assert it wired
    // something rather than pinning exact names (which the domain owns).
    assert.ok(reg.map.size > 0, "minigame macros registered");
  });
});

describe("#30 — glyph_spells.cast license check is crash-guarded", () => {
  it("a non-owner cast returns a clean rejection, not a thrown 500", async () => {
    const reg = makeRegistry();
    const mod = await import("../domains/glyph-spells.js");
    (mod.default || mod.registerGlyphSpellMacros || mod.registerGlyphMacros)(reg.register);
    const cast = reg.get("glyph_spells.cast");
    assert.ok(cast, "cast macro registered");

    const db = new Database(":memory:");
    // player_glyph_spells (mig 136 shape the cast reads) + the citation table
    // WITHOUT the phantom creator_id/parent_id/kind columns (the real schema).
    db.exec(`
      CREATE TABLE player_glyph_spells (id TEXT PRIMARY KEY, user_id TEXT, recipe_dtu_id TEXT, element TEXT);
      CREATE TABLE dtu_citations (dtu_id TEXT PRIMARY KEY, citation_count INTEGER DEFAULT 0);
    `);
    db.prepare(`INSERT INTO player_glyph_spells (id,user_id,recipe_dtu_id,element) VALUES (?,?,?,?)`)
      .run("spell1", "owner", "dtu1", "fire");

    // Non-owner ("intruder") casting "owner"'s spell — the license query would
    // hard-throw on the missing columns pre-fix. Assert it resolves cleanly.
    const ctx = { db, actor: { userId: "intruder" } };
    const r = await cast(ctx, { spellId: "spell1", worldId: "fantasy" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner_or_licensed");
    db.close();
  });
});
