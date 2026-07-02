/**
 * Fuel consumption must honour the USER-GLOBAL inventory invariant.
 *
 * mintSpell verifies fuel OWNERSHIP globally by (user_id, item_id) but the
 * CONSUMPTION query previously added `AND world_id = ?`. So a fuel item acquired
 * in another world passed the ownership check, boosted the spell, and was NEVER
 * debited — the player kept the fuel AND got the boost (a free-boost dupe on a
 * world hop). This drives mintSpell with fuel acquired in a DIFFERENT world than
 * the mint world and asserts the fuel is actually consumed.
 *
 * Run: node --test tests/glyph-spells-fuel-world-global.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedDefaultGlyphLibrary, listGlyphComponents, mintSpell } from "../lib/glyph-spells.js";

async function seededDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedDefaultGlyphLibrary(db);
  return db;
}

function ownedQty(db, userId, itemId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(quantity),0) AS qty FROM player_inventory WHERE user_id = ? AND item_id = ?`
  ).get(userId, itemId);
  return row?.qty ?? 0;
}

test("fuel acquired in ANOTHER world is boosted AND consumed on mint", async () => {
  const db = await seededDb();
  const comps = listGlyphComponents(db).slice(0, 2).map((c) => c.id);

  // Fuel lives in 'far-world'; we mint in 'concordia-hub'.
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, world_id, acquired_at)
    VALUES ('inv1','u1','material','grand_soul_gem','Grand Soul Gem',1,'far-world', 1)
  `).run();
  assert.equal(ownedQty(db, "u1", "grand_soul_gem"), 1, "precondition: user owns 1 fuel");

  const ret = mintSpell(db, {
    userId: "u1", worldId: "concordia-hub", componentIds: comps,
    name: "Cross-World Bolt", fuelItemIds: ["grand_soul_gem"],
  });

  assert.equal(ret.ok, true, JSON.stringify(ret));
  assert.ok(ret.fuel, "fuel must be applied (ownership is global)");
  assert.ok(ret.fuel.multiplier > 1, `fuel multiplier should amplify, got ${ret.fuel?.multiplier}`);

  // The fix: the fuel row (in far-world) must be debited despite the world hop.
  assert.equal(ownedQty(db, "u1", "grand_soul_gem"), 0, "fuel must be consumed, not duped across worlds");
});

test("fuel in the SAME world is still consumed (no regression)", async () => {
  const db = await seededDb();
  const comps = listGlyphComponents(db).slice(0, 2).map((c) => c.id);
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, world_id, acquired_at)
    VALUES ('inv2','u2','material','mana_crystal','Mana Crystal',2,'concordia-hub', 1)
  `).run();

  const ret = mintSpell(db, {
    userId: "u2", worldId: "concordia-hub", componentIds: comps,
    name: "Home Bolt", fuelItemIds: ["mana_crystal"],
  });
  assert.equal(ret.ok, true, JSON.stringify(ret));
  assert.ok(ret.fuel);
  // One of the stack of 2 consumed → 1 remains.
  assert.equal(ownedQty(db, "u2", "mana_crystal"), 1, "exactly one fuel unit consumed");
});
