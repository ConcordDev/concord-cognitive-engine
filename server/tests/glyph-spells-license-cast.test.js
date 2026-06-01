/**
 * #30 — spell licensing on cast.
 *
 * domains/glyph-spells.js#cast lets a NON-owner cast a spell IFF they hold a
 * valid (unrevoked, unexpired) license for the spell's DTU in the real grant
 * ledger `dtu_licenses` (mig 034). The pre-fix code queried `dtu_citations` for
 * columns that don't exist → a 500 for every non-owner cast. This pins the fixed
 * branch against the REAL schema by driving the actual macro.
 *
 * Run: node --test tests/glyph-spells-license-cast.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up136 } from "../migrations/136_player_glyph_spells.js";
import registerGlyphSpellMacros from "../domains/glyph-spells.js";

// Capture the registered macro fns into a map so we can invoke `cast` directly.
function loadMacros() {
  const macros = new Map();
  registerGlyphSpellMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  return macros;
}

function seededDb() {
  const db = new Database(":memory:");
  up136(db);
  // dtu_licenses (mig 034 shape) — minimal CREATE so the test is migration-light.
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_licenses (
      id TEXT PRIMARY KEY, dtu_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'spell', license_tier TEXT NOT NULL DEFAULT 'use',
      granted_at TEXT NOT NULL DEFAULT (datetime('now')), tx_id TEXT,
      expires_at TEXT, revoked INTEGER DEFAULT 0,
      UNIQUE(dtu_id, user_id, license_tier)
    );
  `);
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','owner','w','dtu1','⟲⊚','["g_flame_seed"]','fire',10,5,1,2,0.5,0)
  `).run();
  return db;
}

const cast = (macros, db, userId) =>
  macros.get("glyph_spells.cast")({ db, actor: { userId } }, { spellId: "s1", worldId: "w" });

test("owner casts without any license", async () => {
  const db = seededDb();
  const r = await cast(loadMacros(), db, "owner");
  assert.equal(r.ok, true);
  assert.equal(r.element, "fire");
});

test("non-owner WITHOUT a license is refused", async () => {
  const db = seededDb();
  const r = await cast(loadMacros(), db, "stranger");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_owner_or_licensed");
});

test("non-owner WITH a valid unrevoked unexpired license may cast", async () => {
  const db = seededDb();
  db.prepare(`INSERT INTO dtu_licenses (id, dtu_id, user_id, revoked, expires_at)
              VALUES ('L1','dtu1','licensee',0,NULL)`).run();
  const r = await cast(loadMacros(), db, "licensee");
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("a REVOKED license does not grant cast", async () => {
  const db = seededDb();
  db.prepare(`INSERT INTO dtu_licenses (id, dtu_id, user_id, revoked, expires_at)
              VALUES ('L1','dtu1','licensee',1,NULL)`).run();
  const r = await cast(loadMacros(), db, "licensee");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_owner_or_licensed");
});

test("an EXPIRED license does not grant cast", async () => {
  const db = seededDb();
  db.prepare(`INSERT INTO dtu_licenses (id, dtu_id, user_id, revoked, expires_at)
              VALUES ('L1','dtu1','licensee',0,'2000-01-01 00:00:00')`).run();
  const r = await cast(loadMacros(), db, "licensee");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_owner_or_licensed");
});
