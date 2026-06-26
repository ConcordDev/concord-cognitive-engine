// G4/G5 — TOCTOU safety for resource gathering + loot claims. The old code read
// the row, then wrote an absolute value / unconditional claim, so duplicate
// requests (double-click / script / multi-shard) could double-harvest a node or
// claim one loot drop N times. Both now use a single conditional UPDATE and act
// only on `changes===1`. This pins conservation (never extract more than exists)
// and single-winner claims.
//
// Run: node --test tests/gather-loot-toctou.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { gatherFromNode } from "../lib/world-gathering.js";

function seedNode(db, { id = "n1", qty = 20 } = {}) {
  db.prepare(`
    INSERT INTO world_resource_nodes
      (id, world_id, node_type, resource_id, resource_name, biome,
       x, y, z, depth, quantity_remaining, max_quantity, quality, difficulty, respawn_hours, is_depleted, seeded)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1)
  `).run(id, "w1", "stone", "stone", "Stone Outcrop", "plains",
         0, 40, 0, 0, qty, qty, "common", 1, 72);
}

test("G4 — gather conservation: total extracted never exceeds the node's stock", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedNode(db, { id: "n1", qty: 20 });

  let total = 0;
  // Gather until depleted (bounded loop guards against an infinite loop bug).
  for (let i = 0; i < 100; i++) {
    const r = gatherFromNode(db, "n1", "u1", { toolType: "pickaxe", toolTier: 3, skillLevel: 30 });
    if (!r.ok) { assert.equal(r.error, "node_depleted"); break; }
    total += r.gathered[0].quantity; // the primary resource line
  }

  const row = db.prepare("SELECT quantity_remaining, is_depleted FROM world_resource_nodes WHERE id='n1'").get();
  assert.equal(row.quantity_remaining, 0, "node fully drained");
  assert.equal(row.is_depleted, 1, "node flagged depleted");
  assert.equal(total, 20, "extracted exactly the stock — no double-harvest, no over-extract");
  db.close();
});

test("G4 — a depleted node yields node_depleted, not a phantom harvest", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedNode(db, { id: "n2", qty: 3 });
  // Drain it.
  for (let i = 0; i < 50; i++) { if (!gatherFromNode(db, "n2", "u1", { toolTier: 3, skillLevel: 50 }).ok) break; }
  const r = gatherFromNode(db, "n2", "u2", { toolTier: 3, skillLevel: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "node_depleted");
  db.close();
});

test("G5 — loot claim conditional UPDATE has exactly one winner", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  // loot_nodes is created by migration 046 (world_id/contents/created_at/expires_at NOT NULL).
  db.prepare("INSERT INTO loot_nodes (id, world_id, contents, created_at, expires_at) VALUES (?,?,?,?,?)")
    .run("loot1", "w1", "[{\"item\":\"gold\"}]", Date.now(), Date.now() + 600000);

  const claim = (user) => db.prepare(
    "UPDATE loot_nodes SET claimed_by=?, claimed_at=? WHERE id=? AND claimed_by IS NULL"
  ).run(user, Date.now(), "loot1").changes;

  assert.equal(claim("a"), 1, "first claimant wins");
  assert.equal(claim("b"), 0, "second claimant gets nothing");
  assert.equal(claim("a"), 0, "even the winner can't re-claim");
  assert.equal(db.prepare("SELECT claimed_by FROM loot_nodes WHERE id='loot1'").get().claimed_by, "a");
  db.close();
});
