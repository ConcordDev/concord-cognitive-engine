/**
 * F1.2 — gift system (Stardew-style affinity-via-gifts).
 *
 * Pins:
 *   - giftReaction derives from archetype (scholar loves books, warrior loves
 *     weapons) and honours an authored gift_preferences override
 *   - giveGift consumes one item from the player's inventory in this world and
 *     shifts courtship affinity by the reaction
 *   - a loved gift raises affinity more than a disliked one (which lowers it)
 *   - giving an item the player doesn't own is rejected (nothing consumed)
 *
 * Run: node --test tests/integration/gift-system.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up050 } from "../../migrations/050_player_inventory.js";
import { up as up206 } from "../../migrations/206_romance.js";
import { giftReaction, itemCategory, giveGift, GIFT_DELTA } from "../../lib/gifting.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY);`); // player_inventory FKs users
  up050(db); up206(db);
  db.prepare(`INSERT INTO users (id) VALUES ('u1')`).run();
  // minimal world_npcs + the per-world inventory column (mig 101 adds world_id).
  db.exec(`CREATE TABLE world_npcs (id TEXT PRIMARY KEY, archetype TEXT, name TEXT);`);
  try { db.exec(`ALTER TABLE player_inventory ADD COLUMN world_id TEXT DEFAULT 'concordia-hub'`); } catch { /* may exist */ }
  return db;
}

function npc(db, id, archetype) {
  db.prepare(`INSERT INTO world_npcs (id, archetype, name) VALUES (?, ?, ?)`).run(id, archetype, id);
}
function give(db, userId, itemId, itemName, qty = 1, world = "concordia-hub") {
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, world_id)
    VALUES (?, ?, 'material', ?, ?, ?, ?)
  `).run(`${userId}-${itemId}`, userId, itemId, itemName, qty, world);
}

describe("F1.2 — gift reactions are archetype-grounded", () => {
  it("a scholar loves books, a warrior loves weapons", () => {
    assert.equal(giftReaction({ archetype: "scholar" }, "Ancient Tome"), "loved");
    assert.equal(giftReaction({ archetype: "warrior" }, "Iron Sword"), "loved");
    assert.equal(giftReaction({ archetype: "healer" }, "Healing Herb"), "loved");
  });
  it("a scholar dislikes a pelt", () => {
    assert.equal(giftReaction({ archetype: "scholar" }, "Wolf Pelt"), "disliked");
  });
  it("authored gift_preferences override the archetype", () => {
    // A warrior normally dislikes books; the authored override makes it loved.
    const r = giftReaction({ archetype: "warrior", gift_preferences: { loved: ["book"] } }, "Ancient Tome");
    assert.equal(r, "loved");
  });
  it("itemCategory classifies by keyword", () => {
    assert.equal(itemCategory("Steel Greaves"), "armor");
    assert.equal(itemCategory("Ruby Gem"), "gem");
    assert.equal(itemCategory("Mystery Thing"), "misc");
  });
});

describe("F1.2 — giveGift consumes + shifts affinity", () => {
  it("a loved gift raises affinity and consumes the item", () => {
    const db = freshDb();
    npc(db, "kestra", "scholar");
    give(db, "u1", "tome01", "Ancient Tome", 2);
    const r = giveGift(db, { userId: "u1", npcId: "kestra", itemId: "tome01" });
    assert.equal(r.ok, true);
    assert.equal(r.reaction, "loved");
    assert.equal(r.delta, GIFT_DELTA.loved);
    assert.ok(r.affinity > 0);
    // one consumed, one left
    const left = db.prepare(`SELECT quantity FROM player_inventory WHERE user_id='u1' AND item_id='tome01'`).get();
    assert.equal(left.quantity, 1);
    db.close();
  });

  it("a disliked gift lowers affinity", () => {
    const db = freshDb();
    npc(db, "kestra", "scholar");
    give(db, "u1", "pelt01", "Wolf Pelt", 1);
    const r = giveGift(db, { userId: "u1", npcId: "kestra", itemId: "pelt01" });
    assert.equal(r.reaction, "disliked");
    assert.ok(r.affinity < 0);
    // last one consumed → row gone
    const left = db.prepare(`SELECT * FROM player_inventory WHERE user_id='u1' AND item_id='pelt01'`).get();
    assert.equal(left, undefined);
    db.close();
  });

  it("rejects an unowned item (nothing consumed)", () => {
    const db = freshDb();
    npc(db, "kestra", "scholar");
    const r = giveGift(db, { userId: "u1", npcId: "kestra", itemId: "ghost" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "item_not_owned");
    db.close();
  });

  it("rejects an unknown NPC", () => {
    const db = freshDb();
    give(db, "u1", "tome01", "Ancient Tome", 1);
    const r = giveGift(db, { userId: "u1", npcId: "nobody", itemId: "tome01" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "npc_not_found");
    db.close();
  });
});
