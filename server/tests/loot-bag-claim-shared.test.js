/**
 * Shared loot-bag claim (Aura REQ-5). The HTTP claim route and the game
 * clients' loot:claim verb both go through claimLootBagToInventory, so a bag
 * credits the same way whichever client claims it — and only once.
 *
 * Run: node --test tests/loot-bag-claim-shared.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createLootBag,
  claimLootBagToInventory,
  listOpenLootBags,
  lootDroppedPayload,
} from "../lib/loot-generator.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sparks_ledger (id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, world_id TEXT);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_type TEXT, item_id TEXT, item_name TEXT,
      quantity INTEGER DEFAULT 1, quality INTEGER, schema_id TEXT, gear_level INTEGER
    );
    CREATE TABLE loot_bags (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, position TEXT NOT NULL,
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, killer_type TEXT NOT NULL, killer_id TEXT,
      items TEXT NOT NULL DEFAULT '[]', claimed_by TEXT, claimed_at INTEGER,
      expires_at INTEGER NOT NULL, created_at INTEGER DEFAULT (unixepoch())
    );
  `);
  db.prepare("INSERT INTO users (id, sparks) VALUES ('p1', 0), ('p2', 0)").run();
});

const ITEMS = [
  { id: "iron-ore", name: "Iron Ore", type: "resource", quantity: 3 },
  { id: "sparks", name: "Sparks", type: "currency", quantity: 25 },
];

describe("claimLootBagToInventory", () => {
  it("credits items to inventory and sparks to the wallet with a ledger row", () => {
    const bagId = createLootBag(db, "concordia-hub", { x: 4, y: 0, z: -2 }, "npc", "npc_1", "player", "p1", ITEMS);
    const r = claimLootBagToInventory(db, bagId, "p1", "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    const inv = db.prepare("SELECT item_id, quantity FROM player_inventory WHERE user_id = 'p1'").all();
    assert.deepEqual(inv, [{ item_id: "iron-ore", quantity: 3 }]);
    assert.equal(db.prepare("SELECT sparks FROM users WHERE id = 'p1'").get().sparks, 25);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sparks_ledger WHERE user_id = 'p1' AND reason = 'loot_claim'").get().n, 1);
  });

  it("stacks onto an existing inventory row", () => {
    db.prepare("INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity) VALUES ('x', 'p1', 'resource', 'iron-ore', 'Iron Ore', 2)").run();
    const bagId = createLootBag(db, "w", { x: 0, z: 0 }, "npc", "n", "player", "p1", [ITEMS[0]]);
    claimLootBagToInventory(db, bagId, "p1", "w");
    assert.equal(db.prepare("SELECT quantity FROM player_inventory WHERE id = 'x'").get().quantity, 5);
  });

  it("a second claim of the same bag is refused and credits nothing", () => {
    const bagId = createLootBag(db, "w", { x: 0, z: 0 }, "npc", "n", "player", "p1", ITEMS);
    assert.equal(claimLootBagToInventory(db, bagId, "p1", "w").ok, true);
    assert.deepEqual(claimLootBagToInventory(db, bagId, "p2", "w"), { ok: false, reason: "bag_unavailable" });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM player_inventory WHERE user_id = 'p2'").get().n, 0);
    assert.equal(db.prepare("SELECT sparks FROM users WHERE id = 'p2'").get().sparks, 0);
  });

  it("refuses an unknown or expired bag", () => {
    assert.equal(claimLootBagToInventory(db, "nope", "p1").reason, "bag_unavailable");
    const bagId = createLootBag(db, "w", { x: 0, z: 0 }, "npc", "n", "player", "p1", ITEMS);
    db.prepare("UPDATE loot_bags SET expires_at = 1 WHERE id = ?").run(bagId);
    assert.equal(claimLootBagToInventory(db, bagId, "p1").reason, "bag_unavailable");
  });
});

describe("listOpenLootBags / lootDroppedPayload", () => {
  it("lists only open bags in the world and marks the viewer's own kills", () => {
    const mine = createLootBag(db, "w", { x: 1, z: 2 }, "npc", "n", "player", "p1", ITEMS);
    const theirs = createLootBag(db, "w", { x: 3, z: 4 }, "npc", "n", "player", "p2", ITEMS);
    createLootBag(db, "other", { x: 0, z: 0 }, "npc", "n", "player", "p1", ITEMS);
    claimLootBagToInventory(db, theirs, "p2", "w");
    const bags = listOpenLootBags(db, "w", "p1");
    assert.deepEqual(bags.map((b) => b.id), [mine]);
    assert.equal(bags[0].killerPriority, true);
    assert.equal(bags[0].itemCount, 2);
    assert.deepEqual(bags[0].position, { x: 1, z: 2 });
  });

  it("builds the loot:dropped shape without inventing rarity", () => {
    const p = lootDroppedPayload("bag1", "w", { x: 1.5, y: 0, z: -3 }, [...ITEMS, { id: "gem", name: "Gem", type: "gem", quantity: 1, rarity: "rare" }]);
    assert.deepEqual(p, {
      bagId: "bag1", worldId: "w", x: 1.5, y: 0, z: -3,
      items: [
        { id: "iron-ore", name: "Iron Ore", qty: 3, type: "resource", rarity: null },
        { id: "sparks", name: "Sparks", qty: 25, type: "currency", rarity: null },
        { id: "gem", name: "Gem", qty: 1, type: "gem", rarity: "rare" },
      ],
    });
  });
});
