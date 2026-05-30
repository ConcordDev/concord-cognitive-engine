/**
 * Tier-2 contract tests for Layer 9: embodied dream cycle.
 *
 * Pins:
 *   - gatherFragments aggregates from each canonical source table
 *   - signature is stable across re-runs of the same window
 *   - composeDeterministic produces grounded DTU shape (no invention)
 *   - tryComposeForUser inserts a dream + DTU row in one transaction
 *   - tryComposeForUser throttles via MIN_COMPOSE_INTERVAL_S
 *   - tryComposeForUser dedupes via signature
 *   - runEmbodiedDreamCycle skips currently-active users
 *
 * Run: node --test tests/embodied-dream.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  gatherFragments,
  composeDeterministic,
  tryComposeForUser,
  getRecentDreams,
  WINDOW_HOURS,
  MIN_FRAGMENTS,
} from "../lib/embodied/dream-engine.js";
import { runEmbodiedDreamCycle } from "../emergent/embodied-dream-cycle.js";
import { up as up109 } from "../migrations/114_pain_signals.js";
import { up as up110 } from "../migrations/115_dreams.js";

function setupDb() {
  const db = new Database(":memory:");
  up109(db);
  up110(db);
  db.exec(`
    CREATE TABLE damage_events (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      attacker_id TEXT,
      attacker_type TEXT,
      target_id TEXT,
      target_type TEXT,
      element TEXT,
      raw_damage REAL,
      resistance_pct REAL,
      final_damage REAL,
      kill INTEGER DEFAULT 0,
      occurred_at INTEGER
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      world_id TEXT DEFAULT 'concordia-hub',
      item_type TEXT,
      item_id TEXT,
      item_name TEXT,
      quantity INTEGER DEFAULT 1,
      acquired_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_visits (
      world_id TEXT,
      user_id TEXT,
      arrived_at INTEGER,
      departed_at INTEGER
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      kind TEXT,
      type TEXT,
      title TEXT,
      scope TEXT,
      data TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

function seedActivity(db, userId, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  // 3 attacks, 1 kill
  for (let i = 0; i < 3; i++) {
    db.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, element, final_damage, kill, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`de_${i}`, 'w1', userId, 'player', `npc_${i}`, 'npc', 'fire', 25 + i * 5, i === 2 ? 1 : 0, now - 600 - i * 60);
  }
  // 2 hits taken
  for (let i = 0; i < 2; i++) {
    db.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, element, final_damage, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`det_${i}`, 'w1', `npc_${i}`, 'npc', userId, 'player', 'physical', 12 + i * 3, now - 700 - i * 60);
  }
  // pain
  db.prepare(`
    INSERT INTO pain_signals (id, user_id, world_id, region, intensity, source, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`p1`, userId, 'w1', 'torso', 0.3, 'combat', now - 690);
  // gather
  db.prepare(`
    INSERT INTO player_inventory (id, user_id, world_id, item_id, item_name, quantity, acquired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('inv_1', userId, 'w1', 'iron_ore', 'Iron Ore', 4, now - 800);
  // visit
  db.prepare(`
    INSERT INTO world_visits (world_id, user_id, arrived_at, departed_at)
    VALUES (?, ?, ?, ?)
  `).run('w1', userId, now - 7200, opts.online ? null : now - 600);
  // dtu created
  db.prepare(`
    INSERT INTO dtus (id, creator_id, kind, type, title, scope, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('dtu_authored', userId, 'note', 'note', 'Idle thought', 'personal', '{}', now - 1500);
}

// ───────────────────────────────────────────────────────────────────────────
// gatherFragments
// ───────────────────────────────────────────────────────────────────────────

describe("gatherFragments aggregates canonical sources", () => {
  it("pulls combat, pain, gathered, visits, dtus", () => {
    const db = setupDb();
    seedActivity(db, "u1");
    const { fragments, summary } = gatherFragments(db, "u1");
    assert.equal(summary.combatHits, 3);
    assert.equal(summary.kills, 1);
    assert.equal(summary.combatTaken, 2);
    assert.equal(summary.painCount, 1);
    assert.ok(summary.painTotal > 0.25 && summary.painTotal < 0.35);
    assert.equal(summary.gathered, 1);
    assert.equal(summary.visited, 1);
    assert.equal(summary.dtusCreated, 1);
    assert.ok(fragments.length >= 8);
  });

  it("respects window: events older than WINDOW_HOURS are excluded", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, final_damage, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old_de', 'w1', 'u2', 'player', 'npc_x', 'npc', 30, now - (WINDOW_HOURS + 1) * 3600);
    const { fragments } = gatherFragments(db, "u2");
    assert.equal(fragments.length, 0);
  });

  it("signature is stable across re-runs of the same window", () => {
    const db = setupDb();
    seedActivity(db, "u1");
    const a = gatherFragments(db, "u1");
    const b = gatherFragments(db, "u1");
    assert.equal(a.signature, b.signature);
  });

  it("signature changes when a new fragment lands", () => {
    const db = setupDb();
    seedActivity(db, "u1");
    const a = gatherFragments(db, "u1");

    db.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, element, final_damage, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('de_new', 'w1', 'u1', 'player', 'npc_new', 'npc', 'ice', 33, Math.floor(Date.now() / 1000) - 100);
    const b = gatherFragments(db, "u1");
    assert.notEqual(a.signature, b.signature);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// composeDeterministic
// ───────────────────────────────────────────────────────────────────────────

describe("composeDeterministic", () => {
  it("returns null on empty fragments", () => {
    const r = composeDeterministic({ fragments: [], summary: {} }, "u");
    assert.equal(r, null);
  });

  it("produces a DTU-shaped result with grounded prose", () => {
    const db = setupDb();
    seedActivity(db, "u1");
    const { fragments, summary } = gatherFragments(db, "u1");
    const dream = composeDeterministic({ fragments, summary }, "u1");
    assert.ok(dream);
    assert.equal(dream.kind, 'dream');
    assert.equal(dream.scope, 'personal');
    assert.equal(dream.creatorId, 'u1');
    assert.ok(typeof dream.human === 'string' && dream.human.length > 0);
    assert.ok(dream.machine.composer === 'deterministic');
    assert.ok(Array.isArray(dream.core.fragments));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// tryComposeForUser
// ───────────────────────────────────────────────────────────────────────────

describe("tryComposeForUser", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    seedActivity(db, "u1");
  });

  it("inserts a dream + DTU row and returns ok", async () => {
    const r = await tryComposeForUser(db, "u1");
    assert.equal(r.ok, true);
    assert.ok(r.dreamRowId);
    assert.ok(r.dreamDtuId);

    const dream = db.prepare(`SELECT * FROM dreams WHERE id = ?`).get(r.dreamRowId);
    assert.ok(dream);
    assert.equal(dream.user_id, "u1");

    const dtu = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(r.dreamDtuId);
    assert.ok(dtu);
    assert.equal(dtu.kind, 'dream');
    assert.equal(dtu.scope, 'personal');
  });

  it("respects MIN_COMPOSE_INTERVAL_S (cooldown)", async () => {
    const r1 = await tryComposeForUser(db, "u1");
    assert.equal(r1.ok, true);
    const r2 = await tryComposeForUser(db, "u1");
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'cooldown');
  });

  it("dedupes duplicate signatures across cooldown boundary", async () => {
    const r1 = await tryComposeForUser(db, "u1");
    assert.equal(r1.ok, true);
    // Pretend cooldown elapsed by manually backdating the dream row.
    const old = Math.floor(Date.now() / 1000) - 7 * 3600;
    db.prepare(`UPDATE dreams SET composed_at = ? WHERE id = ?`).run(old, r1.dreamRowId);

    // No new fragments → same signature → duplicate.
    const r2 = await tryComposeForUser(db, "u1");
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'duplicate_signature');
  });

  it("requires MIN_FRAGMENTS to compose", async () => {
    const db2 = setupDb();
    // Only 2 events — below MIN_FRAGMENTS
    const now = Math.floor(Date.now() / 1000);
    db2.prepare(`
      INSERT INTO damage_events (id, world_id, attacker_id, attacker_type, target_id, target_type, final_damage, occurred_at)
      VALUES ('a', 'w', 'u', 'player', 'n', 'npc', 10, ?)
    `).run(now - 100);

    const r = await tryComposeForUser(db2, "u");
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_few_fragments');
    assert.ok(r.count < MIN_FRAGMENTS);
  });
});

describe("getRecentDreams", () => {
  it("returns dreams ordered by composed_at DESC", async () => {
    const db = setupDb();
    seedActivity(db, "u1");
    await tryComposeForUser(db, "u1");
    const dreams = getRecentDreams(db, "u1", 5);
    assert.equal(dreams.length, 1);
    assert.ok(dreams[0].dream_dtu_id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runEmbodiedDreamCycle
// ───────────────────────────────────────────────────────────────────────────

describe("runEmbodiedDreamCycle", () => {
  it("skips currently-active users", async () => {
    const db = setupDb();
    seedActivity(db, "u-online", { online: true });
    const r = await runEmbodiedDreamCycle({ db });
    assert.equal(r.composed ?? 0, 0);
  });

  it("composes for offline users with enough fragments", async () => {
    const db = setupDb();
    seedActivity(db, "u-offline");
    const r = await runEmbodiedDreamCycle({ db });
    assert.equal(r.composed, 1);
    const dreams = db.prepare(`SELECT COUNT(*) AS n FROM dreams WHERE user_id = ?`).get("u-offline");
    assert.equal(dreams.n, 1);
  });

  it("idempotent across passes (cooldown + signature)", async () => {
    const db = setupDb();
    seedActivity(db, "u-offline");
    await runEmbodiedDreamCycle({ db });
    const r2 = await runEmbodiedDreamCycle({ db });
    assert.equal(r2.composed, 0);
    assert.ok(r2.cooldown >= 1, "second pass should report cooldown skip");
  });
});
