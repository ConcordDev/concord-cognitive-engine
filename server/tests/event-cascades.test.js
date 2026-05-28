// Phase BD3 — event cascade tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { defineCascade, triggerCascade, getCascadeChain } from "../lib/event-cascades.js";
import { up as upCascades } from "../migrations/242_event_cascades.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal lattice_born_quests stub so the cascade depth logic works.
  db.exec(`
    CREATE TABLE lattice_born_quests (
      id TEXT PRIMARY KEY, quest_id TEXT, drift_alert_signature TEXT UNIQUE,
      drift_type TEXT, world_id TEXT, target_npc_id TEXT, composer TEXT,
      composed_at INTEGER
    );
  `);
  upCascades(db);
  return db;
}

describe("Phase BD3 — event cascades", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("success branch spawns the on_success child", () => {
    defineCascade(db, "parent-1", { onSuccess: "child-success", onFailure: "child-failure" });
    const r = triggerCascade(db, "parent-1", "success");
    assert.equal(r.spawned, true);
    assert.ok(r.childQuestId.startsWith("lbq_cascade_child-success"));
  });

  it("failure branch spawns the on_failure child", () => {
    defineCascade(db, "parent-1", { onSuccess: "child-success", onFailure: "child-failure" });
    const r = triggerCascade(db, "parent-1", "failure");
    assert.equal(r.spawned, true);
    assert.ok(r.childQuestId.includes("child-failure"));
  });

  it("no-cascade quest completes cleanly (no spawned)", () => {
    const r = triggerCascade(db, "parent-1", "success");
    assert.equal(r.spawned, false);
    assert.equal(r.reason, "no_definition");
  });

  it("missing branch returns spawned:false without error", () => {
    defineCascade(db, "parent-1", { onSuccess: "child-success" }); // no on_failure
    const r = triggerCascade(db, "parent-1", "failure");
    assert.equal(r.spawned, false);
    assert.equal(r.reason, "no_branch");
  });

  it("idempotent on (parent, outcome) — re-trigger returns same childQuestId", () => {
    defineCascade(db, "parent-1", { onSuccess: "child-success" });
    const a = triggerCascade(db, "parent-1", "success");
    const b = triggerCascade(db, "parent-1", "success");
    assert.equal(b.spawned, false);
    assert.equal(b.alreadyExisted, true);
    assert.equal(b.childQuestId, a.childQuestId);
  });

  it("invalid outcome is rejected", () => {
    const r = triggerCascade(db, "parent-1", "tied");
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_outcome");
  });

  it("cascade chain walks parent_quest_id back to the root", () => {
    // Build a 3-step chain manually via the lattice_born_quests table.
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('1', 'root', NULL, 0)`).run();
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('2', 'mid', 'root', 1)`).run();
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('3', 'leaf', 'mid', 2)`).run();
    const chain = getCascadeChain(db, "leaf");
    assert.deepEqual(chain, ["root", "mid", "leaf"]);
  });

  it("max_depth cap blocks spawn", () => {
    defineCascade(db, "parent-1", { onSuccess: "child", maxDepth: 1 });
    // Seed parent at depth 5 — child would land at depth 6, > maxDepth.
    db.prepare(`INSERT INTO lattice_born_quests (id, quest_id, parent_quest_id, cascade_depth) VALUES ('p1', 'parent-1', NULL, 5)`).run();
    const r = triggerCascade(db, "parent-1", "success");
    assert.equal(r.spawned, false);
    assert.equal(r.reason, "max_depth_exceeded");
  });
});
