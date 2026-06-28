// D2 game-loop honesty: NPC-kills-player loot consequence must LAND.
//
// handleNPCKilledPlayer (lib/pvp-loot.js) is a complete grant — it deducts the
// victim's sparks (with a ledger row), drops 1–3 items into a loot_bag, and the
// killer NPC claims them — but it had ZERO callers, so the npc-attack route fired
// "You have been defeated" while the player's wallet/inventory stayed untouched
// (a toast-without-grant, the canonical Layer-2 defect). The route now calls it
// on a real kill (routes/worlds.js POST /:worldId/combat/npc-attack). This test
// pins the consequence: after the call the player REALLY lost sparks + items and
// the NPC REALLY gained them — asserted against the DB, not assumed.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { handleNPCKilledPlayer } from "../../lib/pvp-loot.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT, item_name TEXT,
      quantity INTEGER DEFAULT 1, quality TEXT, item_type TEXT
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, wealth_sparks INTEGER NOT NULL DEFAULT 0,
      activity_resources TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, world_id TEXT
    );
    CREATE TABLE loot_bags (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, position TEXT NOT NULL,
      owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
      killer_type TEXT NOT NULL, killer_id TEXT,
      items TEXT NOT NULL DEFAULT '[]', expires_at INTEGER NOT NULL,
      claimed_by TEXT, claimed_at INTEGER
    );
  `);
  db.prepare("INSERT INTO users (id, sparks) VALUES ('player_1', 1000)").run();
  db.prepare("INSERT INTO world_npcs (id, wealth_sparks, activity_resources) VALUES ('npc_1', 0, '{}')").run();
  for (let i = 1; i <= 2; i++) {
    db.prepare(`INSERT INTO player_inventory (id, user_id, item_id, item_name, quantity, quality, item_type)
                VALUES (?, 'player_1', ?, ?, 1, 'common', 'material')`)
      .run(`inv_${i}`, `item_${i}`, `Item ${i}`);
  }
});

describe("handleNPCKilledPlayer — the kill consequence lands", () => {
  it("deducts 30% sparks from the victim with a ledger row", () => {
    const before = db.prepare("SELECT sparks FROM users WHERE id='player_1'").get().sparks;
    handleNPCKilledPlayer(db, { npcId: "npc_1", playerId: "player_1", worldId: "w1", x: 5, z: 7 });
    const after = db.prepare("SELECT sparks FROM users WHERE id='player_1'").get().sparks;
    assert.equal(after, before - Math.floor(before * 0.30), "victim sparks really reduced by 30%");
    const ledger = db.prepare("SELECT delta, reason FROM sparks_ledger WHERE user_id='player_1'").get();
    assert.ok(ledger, "a sparks_ledger row was written");
    assert.equal(ledger.delta, -300);
    assert.match(ledger.reason, /^npc_kill:/);
  });

  it("removes the dropped items from the victim's inventory (real DELETE)", () => {
    const r = handleNPCKilledPlayer(db, { npcId: "npc_1", playerId: "player_1", worldId: "w1", x: 5, z: 7 });
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM player_inventory WHERE user_id='player_1'").get().n;
    assert.equal(remaining, 2 - r.items.length, "exactly the dropped items were removed");
    assert.ok(r.items.length >= 1, "at least one item dropped");
  });

  it("creates a loot bag the killer NPC claims, and credits the NPC's wealth + resources", () => {
    const r = handleNPCKilledPlayer(db, { npcId: "npc_1", playerId: "player_1", worldId: "w1", x: 5, z: 7 });
    const bag = db.prepare("SELECT * FROM loot_bags WHERE id = ?").get(r.bagId);
    assert.ok(bag, "loot bag row exists");
    assert.equal(bag.owner_type, "player");
    assert.equal(bag.owner_id, "player_1");
    assert.equal(bag.killer_type, "npc");
    assert.equal(bag.killer_id, "npc_1");
    assert.equal(bag.claimed_by, "npc_1", "NPC immediately claimed the bag");
    assert.ok(bag.claimed_at, "claim timestamp set");

    const npc = db.prepare("SELECT wealth_sparks, activity_resources FROM world_npcs WHERE id='npc_1'").get();
    assert.equal(npc.wealth_sparks, 300, "NPC really gained the dropped sparks");
    const res = JSON.parse(npc.activity_resources);
    const totalGained = Object.values(res).reduce((a, b) => a + b, 0);
    assert.equal(totalGained, r.items.length, "NPC inventory gained exactly the looted items");
  });

  it("HONEST failure: an unknown victim grants nothing (no fabricated drop)", () => {
    const r = handleNPCKilledPlayer(db, { npcId: "npc_1", playerId: "ghost", worldId: "w1" });
    assert.equal(r, null, "no victim → null, never a fake success");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM loot_bags").get().n, 0);
    assert.equal(db.prepare("SELECT wealth_sparks FROM world_npcs WHERE id='npc_1'").get().wealth_sparks, 0);
  });
});
