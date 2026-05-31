// Wave 7c — NPC behavioral parity drivers.
//
// Pins that the EXISTING verbs (mount ownership, vehicle spawn, gear mint) work
// pointed at NPC owners — the structural parity (schema accepts npc owners) made
// behavioural. Kill-switch respected.
//
// Run: node --test tests/npc-husbandry.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig104 from "../migrations/104_player_companions.js";
import * as mig142 from "../migrations/142_mount_substrate.js";
import * as mig177 from "../migrations/177_world_vehicles.js";
import { ensureCrossbreedingTables } from "../lib/creature-crossbreeding.js";
import { npcAcquireMount, npcSpawnVehicle, npcMintGear } from "../lib/npc-husbandry.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  mig104.up(db);
  mig142.up(db);
  mig177.up(db);
  ensureCrossbreedingTables(db);
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, creator_id TEXT,
    data TEXT, skill_level INTEGER, total_experience INTEGER, created_at INTEGER
  )`);
});
afterEach(() => { delete process.env.CONCORD_NPC_HUSBANDRY; try { db.close(); } catch { /* noop */ } });

describe("Wave 7c — NPC mount ownership", () => {
  it("an NPC owns a mount (owner_id = npc); rideable from a hybrid blueprint", () => {
    db.prepare(`INSERT INTO creature_lineage (child_id, parent_a, parent_b, generation, stability, cross_world, blueprint, created_at)
                VALUES ('hyb1','a','b',1,0.8,0,?,unixepoch())`).run(JSON.stringify({ topology: "quadruped", massKg: 360, mountEligible: true }));
    const r = npcAcquireMount(db, { npcId: "npc_stablehand", creatureId: "hyb1", name: "Dawnmare" });
    assert.equal(r.ok, true);
    assert.equal(r.mountEligible, true);
    const row = db.prepare(`SELECT owner_id, mount_eligible FROM player_companions WHERE id = ?`).get(r.companionId);
    assert.equal(row.owner_id, "npc_stablehand");
    assert.equal(row.mount_eligible, 1);
    // idempotent
    assert.equal(npcAcquireMount(db, { npcId: "npc_stablehand", creatureId: "hyb1" }).already, true);
  });

  it("flags rideable by explicit topology when no lineage", () => {
    const r = npcAcquireMount(db, { npcId: "npc1", creatureId: "wild_horse", topology: "quadruped", massKg: 400 });
    assert.equal(r.ok, true);
    assert.equal(r.mountEligible, true);
  });
});

describe("Wave 7c — NPC-owned vehicles", () => {
  it("an NPC spawns a vehicle it owns (owner_kind = npc)", () => {
    const r = npcSpawnVehicle(db, { npcId: "npc_trader", worldId: "tunya", kind: "cart" });
    assert.equal(r.ok, true);
    const v = db.prepare(`SELECT owner_kind, owner_id FROM world_vehicles WHERE world_id = 'tunya'`).get();
    assert.equal(v.owner_kind, "npc");
    assert.equal(v.owner_id, "npc_trader");
  });
});

describe("Wave 7c — NPC mints gear DTUs", () => {
  it("an NPC mints a saddle DTU it created (creator_id = npc)", () => {
    const r = npcMintGear(db, { npcId: "npc_smith", slot: "saddle", name: "Smith's Saddle" });
    assert.equal(r.ok, true);
    const d = db.prepare(`SELECT type, creator_id FROM dtus WHERE id = ?`).get(r.dtuId);
    assert.equal(d.type, "mount_gear");
    assert.equal(d.creator_id, "npc_smith");
  });
  it("rejects a bad slot", () => {
    assert.equal(npcMintGear(db, { npcId: "n", slot: "hat" }).ok, false);
  });
});

describe("Wave 7c — kill-switch", () => {
  it("CONCORD_NPC_HUSBANDRY=0 → all drivers no-op", () => {
    process.env.CONCORD_NPC_HUSBANDRY = "0";
    assert.equal(npcAcquireMount(db, { npcId: "n", creatureId: "c" }).ok, false);
    assert.equal(npcSpawnVehicle(db, { npcId: "n", worldId: "w", kind: "cart" }).ok, false);
    assert.equal(npcMintGear(db, { npcId: "n", slot: "saddle" }).ok, false);
  });
});
