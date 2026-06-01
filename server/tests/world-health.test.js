// Maintenance — Homeostasis loop. Pins the boundary: mechanical pathologies are
// auto-healed (stuck scheduler re-ticked), value/arc pathologies are ESCALATED,
// never auto-mutated; every finding is logged; the pass never throws.
//
// Run: node --test tests/world-health.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as migHealth from "../migrations/304_health_check_log.js";
import { detectPathologies, classifyDisposition, runWorldHealthPass } from "../lib/world-health.js";

let db;
const NOW = 1_000_000;
beforeEach(() => {
  db = new Database(":memory:");
  migHealth.up(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL);
    CREATE TABLE royalty_lineage (child_id TEXT, parent_id TEXT);
    CREATE TABLE faction_strategy_state (faction_id TEXT PRIMARY KEY, next_move_at INTEGER);
  `);
  db.prepare(`INSERT INTO users VALUES ('u_bad', -50)`).run();
  db.prepare(`INSERT INTO users VALUES ('u_ok', 100)`).run();
  db.prepare(`INSERT INTO royalty_lineage VALUES ('c1','p1'),('c1','p1')`).run(); // dupe
  db.prepare(`INSERT INTO royalty_lineage VALUES ('c2','p2')`).run();             // clean
  db.prepare(`INSERT INTO faction_strategy_state VALUES ('fStuck', ?)`).run(NOW - 200_000); // overdue
  db.prepare(`INSERT INTO faction_strategy_state VALUES ('fOk', ?)`).run(NOW + 1000);        // future
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("world-health classification boundary", () => {
  it("classifies value pathologies as escalate, mechanical as heal", () => {
    assert.equal(classifyDisposition("negative_balance"), "escalated");
    assert.equal(classifyDisposition("dupe_citation"), "escalated");
    assert.equal(classifyDisposition("stuck_scheduler"), "healed");
  });

  it("detects exactly the seeded pathologies", () => {
    const p = detectPathologies(db, NOW);
    const kinds = p.map((x) => x.pathology).sort();
    assert.deepEqual(kinds, ["dupe_citation", "negative_balance", "stuck_scheduler"]);
  });
});

describe("runWorldHealthPass", () => {
  it("heals the stuck scheduler (re-ticks) and escalates value findings WITHOUT mutating them", () => {
    const escalated = [];
    const r = runWorldHealthPass(db, { now: NOW, escalate: (f) => escalated.push(f.pathology) });
    assert.equal(r.ok, true);
    assert.equal(r.healed, 1);      // stuck scheduler
    assert.equal(r.escalated, 2);   // negative balance + dupe citation

    // mechanical heal happened: the overdue scheduler is re-ticked to now.
    assert.equal(db.prepare(`SELECT next_move_at FROM faction_strategy_state WHERE faction_id='fStuck'`).get().next_move_at, NOW);
    // value is UNTOUCHED — the negative balance is escalated, never zeroed.
    assert.equal(db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id='u_bad'`).get().balance, -50);
    assert.deepEqual(escalated.sort(), ["dupe_citation", "negative_balance"]);

    // every finding is logged with its disposition.
    const log = db.prepare(`SELECT pathology, disposition FROM health_check_log ORDER BY pathology`).all();
    assert.equal(log.length, 3);
    assert.equal(log.find((l) => l.pathology === "stuck_scheduler").disposition, "healed");
    assert.equal(log.find((l) => l.pathology === "negative_balance").disposition, "escalated");
  });

  it("never throws on a missing db / empty world", () => {
    assert.equal(runWorldHealthPass(null).ok, false);
    const empty = new Database(":memory:");
    migHealth.up(empty);
    assert.equal(runWorldHealthPass(empty, { now: NOW }).ok, true);
    empty.close();
  });
});
