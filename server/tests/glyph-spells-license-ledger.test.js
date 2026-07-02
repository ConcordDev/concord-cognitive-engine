/**
 * License-ledger integration pin (stale-claim guard).
 *
 * The concern: "casting a licensed spell should register the license against the
 * real ledger, not be silently skipped." Verified against the code: the license
 * GRANT is written by the marketplace purchase path through the SAME
 * rights-enforcement `dtu_licenses` ledger (server/economy/rights-enforcement.js
 * grantLicense; mirrored at creative-marketplace.js), and glyph_spells.cast reads
 * that exact ledger. No per-cast citation is part of the royalty model (royalties
 * flow at purchase). This pins the integration: a license written by the REAL
 * ledger writer is honoured by the cast — so the two can't silently drift apart.
 *
 * Run: node --test tests/glyph-spells-license-ledger.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up136 } from "../migrations/136_player_glyph_spells.js";
import { ensureLicenseTables, grantLicense, revokeLicense } from "../economy/rights-enforcement.js";
import registerGlyphSpellMacros from "../domains/glyph-spells.js";

function loadMacros() {
  const macros = new Map();
  registerGlyphSpellMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  return macros;
}

function seededDb() {
  const db = new Database(":memory:");
  up136(db);
  ensureLicenseTables(db); // the REAL dtu_licenses ledger (rights-enforcement)
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','author','w','dtu1','⟲⊚','["g_flame_seed"]','fire',10,5,1,2,0.5,0)
  `).run();
  return db;
}

const cast = (macros, db, userId) =>
  macros.get("glyph_spells.cast")({ db, actor: { userId } }, { spellId: "s1", worldId: "w", x: 9999, z: 9999 });

test("a license written by the real rights-enforcement ledger enables cast", async () => {
  const db = seededDb();
  // buyer has NO license yet → refused.
  const before = await cast(loadMacros(), db, "buyer");
  assert.equal(before.ok, false);
  assert.equal(before.reason, "not_owner_or_licensed");

  // The marketplace purchase path grants through grantLicense → dtu_licenses.
  const g = grantLicense(db, {
    dtuId: "dtu1", userId: "buyer", contentType: "spell", licenseTier: "use", txId: "tx1", expiresAt: null,
  });
  assert.equal(g.ok, true);
  // Assert the row actually landed in the ledger the cast reads.
  const row = db.prepare("SELECT * FROM dtu_licenses WHERE dtu_id='dtu1' AND user_id='buyer' AND revoked=0").get();
  assert.ok(row, "grantLicense must persist a dtu_licenses row");

  const after = await cast(loadMacros(), db, "buyer");
  assert.equal(after.ok, true, JSON.stringify(after));
});

test("revoking the ledger license removes cast access", async () => {
  const db = seededDb();
  grantLicense(db, { dtuId: "dtu1", userId: "buyer", contentType: "spell", licenseTier: "use", txId: "tx1" });
  assert.equal((await cast(loadMacros(), db, "buyer")).ok, true);

  revokeLicense(db, { dtuId: "dtu1", userId: "buyer", licenseTier: "use", reason: "refund" });
  const r = await cast(loadMacros(), db, "buyer");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_owner_or_licensed");
});
