/**
 * Concord Link Walker journey tests.
 * Run: node --test tests/concord-link-walkers.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  seedWalkersFromAuthored,
  listAvailableWalkers,
  buildRoute,
  hireWalker,
  advanceJourneyTick,
  trackWalker,
} from "../lib/concord-link-walkers.js";

function setupDB() {
  const db = new Database(":memory:");
  // Mirror migrations 076 + 079 schema (subset needed for these tests)
  db.exec(`
    CREATE TABLE concord_link_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT, sender_kind TEXT, receiver_id TEXT, receiver_kind TEXT,
      source_world TEXT, dest_world TEXT, message_type TEXT,
      payload TEXT, encryption_level TEXT, cost_paid INTEGER, cost_currency TEXT,
      emotional_weight REAL, status TEXT NOT NULL DEFAULT 'sent',
      corruption_note TEXT, link_walker_id TEXT,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
      delivered_at INTEGER, read_at INTEGER
    );
    CREATE TABLE concord_link_anchors (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, name TEXT,
      access_method TEXT, description TEXT, location TEXT,
      controlled_by_faction TEXT, stability REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE concord_link_walkers (
      id TEXT PRIMARY KEY, npc_id TEXT NOT NULL, home_world TEXT NOT NULL,
      current_world TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available',
      contract_id TEXT, reputation INTEGER NOT NULL DEFAULT 50,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      route_anchors TEXT, current_anchor_idx INTEGER NOT NULL DEFAULT 0,
      eta_tick INTEGER, intercept_roll REAL,
      dispatched_at INTEGER, message_id TEXT
    );
    CREATE TABLE concord_link_contracts (
      id TEXT PRIMARY KEY, walker_id TEXT NOT NULL, message_id TEXT,
      payer_id TEXT NOT NULL, fee_sparks INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      source_world TEXT, dest_world TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
  `);

  // Seed two anchors per world
  for (const w of ["concordia", "fantasy", "cyber"]) {
    db.prepare(`INSERT INTO concord_link_anchors (id, world_id, name, access_method, stability) VALUES (?, ?, ?, 'gate', 1.0)`)
      .run(`anchor_${w}_1`, w, `${w} primary`);
  }
  return db;
}

describe("Walker seeding", () => {
  it("registers authored NPCs with link_walker:true", () => {
    const db = setupDB();
    const npcs = [
      { id: "tully_vex", link_walker: true, world_id: "concordia", reputation: 78 },
      { id: "sona_karth", link_walker: true, world_id: "concordia" },
      { id: "regular_npc", world_id: "concordia" }, // not a walker
    ];
    const r = seedWalkersFromAuthored(db, npcs);
    assert.strictEqual(r.inserted, 2);
    assert.strictEqual(r.skipped, 1);
    const list = listAvailableWalkers(db);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].npc_id, "tully_vex"); // higher reputation first
  });

  it("is idempotent on re-seed", () => {
    const db = setupDB();
    const npcs = [{ id: "x", link_walker: true, world_id: "concordia" }];
    seedWalkersFromAuthored(db, npcs);
    const r = seedWalkersFromAuthored(db, npcs);
    assert.strictEqual(r.inserted, 0);
    assert.strictEqual(r.skipped, 1);
  });
});

describe("Route construction", () => {
  it("builds same-world route as 2 anchors", () => {
    const db = setupDB();
    const route = buildRoute(db, "concordia", "concordia");
    assert.ok(route.length >= 2);
  });

  it("inserts concordia hub for cross-world routes that bypass it", () => {
    const db = setupDB();
    const route = buildRoute(db, "fantasy", "cyber");
    assert.ok(route.length >= 3, "fantasy → concordia → cyber");
    assert.ok(route.some(a => a.includes("concordia")));
  });

  it("synthesizes symbolic route when anchors missing", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE concord_link_anchors (id TEXT PRIMARY KEY, world_id TEXT, stability REAL DEFAULT 1.0);`);
    const route = buildRoute(db, "x", "y");
    assert.deepStrictEqual(route, ["anchor:x", "anchor:y"]);
  });
});

describe("hireWalker → advanceJourneyTick", () => {
  it("walks a same-world route to delivered status", () => {
    const db = setupDB();
    seedWalkersFromAuthored(db, [{ id: "w1", link_walker: true, world_id: "concordia", reputation: 100 }]);
    const walkerId = `walker_w1`;

    db.prepare(`INSERT INTO concord_link_messages (id, sender_id, sender_kind, source_world, dest_world, message_type, payload, encryption_level, cost_paid, status) VALUES ('msg1', 'u1', 'user', 'concordia', 'concordia', 'physical', '...', 'basic', 100, 'sent')`).run();

    const hire = hireWalker(db, { walkerId, payerId: "u1", sourceWorld: "concordia", destWorld: "concordia", messageId: "msg1" });
    assert.strictEqual(hire.ok, true);
    assert.strictEqual(hire.walker.status, "in_transit");

    // Force a low intercept_roll so we deterministically deliver
    db.prepare(`UPDATE concord_link_walkers SET intercept_roll=0 WHERE id=?`).run(walkerId);

    // Run ticks until journey completes
    let outcome = null;
    for (let i = 0; i < 10; i++) {
      const stats = advanceJourneyTick(db, {
        onDelivered: () => { outcome = "delivered"; },
        onIntercepted: () => { outcome = "intercepted"; },
      });
      if (stats.delivered + stats.intercepted > 0) break;
    }
    assert.strictEqual(outcome, "delivered");

    const msg = db.prepare(`SELECT * FROM concord_link_messages WHERE id='msg1'`).get();
    assert.strictEqual(msg.status, "delivered");
    assert.strictEqual(msg.link_walker_id, walkerId);

    const walker = db.prepare(`SELECT * FROM concord_link_walkers WHERE id=?`).get(walkerId);
    assert.strictEqual(walker.status, "available");
    assert.strictEqual(walker.reputation, 100); // already at ceiling
  });

  it("intercepts a journey when the roll forces it", () => {
    const db = setupDB();
    seedWalkersFromAuthored(db, [{ id: "w2", link_walker: true, world_id: "concordia", reputation: 80 }]);
    const walkerId = `walker_w2`;
    db.prepare(`INSERT INTO concord_link_messages (id, sender_id, sender_kind, source_world, dest_world, message_type, payload, encryption_level, cost_paid, status) VALUES ('msg2', 'u1', 'user', 'fantasy', 'cyber', 'physical', '...', 'basic', 100, 'sent')`).run();

    const hire = hireWalker(db, { walkerId, payerId: "u1", sourceWorld: "fantasy", destWorld: "cyber", messageId: "msg2" });
    assert.strictEqual(hire.ok, true);

    // Force intercept_roll to 1.0 — guaranteed intercept on final hop
    db.prepare(`UPDATE concord_link_walkers SET intercept_roll=1 WHERE id=?`).run(walkerId);

    let final = null;
    for (let i = 0; i < 10; i++) {
      const stats = advanceJourneyTick(db, {
        onIntercepted: ({ messageId }) => { final = messageId; },
      });
      if (stats.intercepted > 0) break;
    }

    assert.strictEqual(final, "msg2");
    const msg = db.prepare(`SELECT * FROM concord_link_messages WHERE id='msg2'`).get();
    assert.strictEqual(msg.status, "intercepted");

    const walker = db.prepare(`SELECT * FROM concord_link_walkers WHERE id=?`).get(walkerId);
    assert.strictEqual(walker.status, "available");
    assert.ok(walker.reputation < 80, "intercept costs reputation");

    const view = trackWalker(db, hire.contract.id);
    assert.strictEqual(view.contract.status, "intercepted");
  });

  it("rejects double-hire of an in_transit walker", () => {
    const db = setupDB();
    seedWalkersFromAuthored(db, [{ id: "w3", link_walker: true, world_id: "concordia" }]);
    const walkerId = `walker_w3`;
    const a = hireWalker(db, { walkerId, payerId: "u1", sourceWorld: "concordia", destWorld: "fantasy" });
    assert.strictEqual(a.ok, true);
    const b = hireWalker(db, { walkerId, payerId: "u2", sourceWorld: "concordia", destWorld: "cyber" });
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.reason, "walker_unavailable");
  });
});
