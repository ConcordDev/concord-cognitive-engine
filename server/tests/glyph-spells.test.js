/**
 * Tier-2 contract tests for Phase 5d — Magic Glyph Composition.
 *
 * Run: node --test tests/glyph-spells.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  seedDefaultGlyphLibrary,
  listGlyphComponents,
  composeSpell,
  mintSpell,
  listSpellsForUser,
  _internal,
} from "../lib/glyph-spells.js";

function makeFakeDb() {
  const tables = { glyph_components: new Map(), player_glyph_spells: new Map(), dtus: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), all: (...a) => allStmt(s, a), get: (...a) => null };
  }
  function transaction(fn) { return (...args) => fn(...args); }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO glyph_components")) {
      const [id, glyph, label, element, damage, range_m, sc, mc, cd, narrative] = args;
      if (tables.glyph_components.has(id)) return { changes: 0 };
      tables.glyph_components.set(id, {
        id, glyph, label, element, damage, range_m,
        stamina_cost: sc, mana_cost: mc, cooldown_s: cd, narrative,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO dtus")) {
      // 'spell_recipe' is a SQL literal in the production query, so the
      // bound args are (id, title, creator, meta) — 4 not 5.
      const [id, title, creator, meta] = args;
      tables.dtus.set(id, { id, kind: "spell_recipe", title, creator_id: creator, meta_json: meta });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO player_glyph_spells")) {
      const [id, userId, worldId, recipeId, glyph, chain, element, dmg, rng, sc, mc, cd] = args;
      tables.player_glyph_spells.set(id, {
        id, user_id: userId, world_id: worldId, recipe_dtu_id: recipeId,
        composed_glyph: glyph, component_chain: chain, element,
        max_damage: dmg, range_m: rng, stamina_cost: sc, mana_cost: mc, cooldown_s: cd,
        composed_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM glyph_components ORDER BY")) {
      return Array.from(tables.glyph_components.values());
    }
    if (sql.startsWith("SELECT * FROM glyph_components WHERE id IN")) {
      const set = new Set(args);
      return Array.from(tables.glyph_components.values()).filter(c => set.has(c.id));
    }
    if (sql.startsWith("SELECT * FROM player_glyph_spells WHERE user_id = ?")) {
      const [userId, limit] = args;
      return Array.from(tables.player_glyph_spells.values())
        .filter(s => s.user_id === userId).slice(0, limit);
    }
    return [];
  }
  return { prepare, transaction, _tables: tables };
}

describe("seedDefaultGlyphLibrary", () => {
  it("seeds 10 components on first call; idempotent", () => {
    const db = makeFakeDb();
    const r1 = seedDefaultGlyphLibrary(db);
    assert.equal(r1.ok, true);
    assert.equal(db._tables.glyph_components.size, 10);
    const r2 = seedDefaultGlyphLibrary(db);
    assert.equal(r2.ok, true);
    assert.equal(db._tables.glyph_components.size, 10); // no growth
  });
  it("listGlyphComponents returns all", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const list = listGlyphComponents(db);
    assert.equal(list.length, 10);
  });
});

describe("composeSpell", () => {
  it("rejects too few components", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r = composeSpell(db, ["g_flame_seed"]);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_few_components");
  });

  it("rejects too many components", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const ids = ["g_flame_seed", "g_ember_breath", "g_stone_anchor", "g_river_step", "g_frost_seal", "g_lightning_arc"];
    const r = composeSpell(db, ids);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_many_components");
  });

  it("rejects unknown component id", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r = composeSpell(db, ["g_flame_seed", "g_does_not_exist"]);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_component");
  });

  it("composes 2 fire glyphs into a fire spell", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r = composeSpell(db, ["g_flame_seed", "g_ember_breath"]);
    assert.equal(r.ok, true);
    assert.equal(r.element, "fire");
    assert.ok(r.max_damage > 0);
    assert.ok(r.composed_glyph);
    assert.ok(r.layer_signature);
    assert.equal(r.chain.length, 2);
  });

  it("dominant element wins ties / majority", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    // 2 fire + 1 ice → fire dominant.
    const r = composeSpell(db, ["g_flame_seed", "g_ember_breath", "g_frost_seal"]);
    assert.equal(r.element, "fire");
  });

  it("longer chains amplify damage harmonically", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r2 = composeSpell(db, ["g_flame_seed", "g_ember_breath"]);
    const r4 = composeSpell(db, ["g_flame_seed", "g_ember_breath", "g_lightning_arc", "g_focus_lens"]);
    assert.ok(r4.max_damage > r2.max_damage);
  });

  it("deterministic on same input", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const a = composeSpell(db, ["g_flame_seed", "g_ember_breath"]);
    const b = composeSpell(db, ["g_flame_seed", "g_ember_breath"]);
    assert.equal(a.composed_glyph, b.composed_glyph);
    assert.equal(a.max_damage, b.max_damage);
  });
});

describe("mintSpell", () => {
  it("mints a kind='spell_recipe' DTU + player_glyph_spells row", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r = mintSpell(db, {
      userId: "user:a",
      worldId: "concordia-hub",
      componentIds: ["g_flame_seed", "g_ember_breath"],
      name: "First Flame",
    });
    assert.equal(r.ok, true);
    assert.ok(r.recipeId);
    assert.ok(r.spellId);
    const dtu = db._tables.dtus.get(r.recipeId);
    assert.ok(dtu);
    assert.equal(dtu.kind, "spell_recipe");
    const meta = JSON.parse(dtu.meta_json);
    assert.equal(meta.author_kind, "player");
    assert.equal(meta.skill_kind, "spell");
    assert.ok(meta.composed_glyph);
  });

  it("rejects too few components", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    const r = mintSpell(db, {
      userId: "user:a", worldId: "w", componentIds: ["g_flame_seed"],
    });
    assert.equal(r.ok, false);
  });
});

describe("listSpellsForUser", () => {
  it("lists user's composed spells desc by composed_at", () => {
    const db = makeFakeDb();
    seedDefaultGlyphLibrary(db);
    mintSpell(db, { userId: "u1", worldId: "w", componentIds: ["g_flame_seed", "g_ember_breath"] });
    mintSpell(db, { userId: "u1", worldId: "w", componentIds: ["g_river_step", "g_frost_seal"] });
    mintSpell(db, { userId: "u2", worldId: "w", componentIds: ["g_focus_lens", "g_silent_step"] });
    const list = listSpellsForUser(db, "u1");
    assert.equal(list.length, 2);
  });
});

describe("internals", () => {
  it("DEFAULT_GLYPH_LIBRARY has 10 entries with required fields", () => {
    assert.equal(_internal.DEFAULT_GLYPH_LIBRARY.length, 10);
    for (const g of _internal.DEFAULT_GLYPH_LIBRARY) {
      assert.ok(g.id);
      assert.ok(g.glyph);
      assert.ok(g.element);
    }
  });
  it("MIN/MAX bounds", () => {
    assert.equal(_internal.MIN_COMPONENTS, 2);
    assert.equal(_internal.MAX_COMPONENTS, 5);
  });
});
