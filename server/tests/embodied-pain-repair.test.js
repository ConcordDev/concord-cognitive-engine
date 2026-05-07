/**
 * Tier-2 contract tests for Layer 8: pain signals + repair cycle.
 *
 * Pins:
 *   - recordPain shape + region/source CHECK
 *   - regionForElement element → body region table
 *   - getPainBudget aggregation
 *   - consumePainBudget idempotency
 *   - decayProcessedPain GC
 *   - runRepairCycle XP grant + resist buff insert + ledger transition
 *
 * Run: node --test tests/embodied-pain-repair.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  recordPain,
  getPainBudget,
  consumePainBudget,
  decayProcessedPain,
  regionForElement,
  REGIONS,
  REGION_SKILL,
} from "../lib/embodied/pain.js";
import { runRepairCycle, REGION_XP_PER_PAIN_UNIT } from "../emergent/repair-cycle.js";
import { up as up109 } from "../migrations/109_pain_signals.js";

function setupDb() {
  const db = new Database(":memory:");
  up109(db);
  // user_active_effects (migration 095) — needed for resist buff insert
  db.exec(`
    CREATE TABLE user_active_effects (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      effect_id     TEXT NOT NULL,
      kind          TEXT NOT NULL,
      magnitude     REAL NOT NULL DEFAULT 1.0,
      source_dtu_id TEXT,
      started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER NOT NULL
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      native_world_type TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      xp REAL NOT NULL DEFAULT 0,
      xp_to_next REAL NOT NULL DEFAULT 100,
      last_used_at INTEGER
    );
  `);
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
// recordPain + regionForElement
// ───────────────────────────────────────────────────────────────────────────

describe("regionForElement table", () => {
  it("each element maps to a valid region", () => {
    for (const el of ["fire","ice","water","lightning","bio","poison","energy","physical","none","unknown"]) {
      const r = regionForElement(el);
      assert.ok(REGIONS.includes(r), `region for ${el} is ${r} which must be in REGIONS`);
    }
  });
  it("specific mappings are stable", () => {
    assert.equal(regionForElement("energy"),    "head");
    assert.equal(regionForElement("ice"),       "torso");
    assert.equal(regionForElement("physical"),  "torso");
    assert.equal(regionForElement("fire"),      "systemic");
    assert.equal(regionForElement("lightning"), "systemic");
  });
});

describe("recordPain shape + validation", () => {
  it("inserts a row with intensity clamped to [0,1]", () => {
    const db = setupDb();
    const r = recordPain(db, "u1", {
      region: "torso", intensity: 1.5, source: "combat",
    });
    assert.ok(r?.id);
    const row = db.prepare(`SELECT intensity FROM pain_signals WHERE id = ?`).get(r.id);
    assert.equal(row.intensity, 1, "intensity must be clamped to 1.0");
  });

  it("rejects invalid region", () => {
    const db = setupDb();
    assert.equal(recordPain(db, "u1", { region: "tail", intensity: 0.5, source: "combat" }), null);
  });

  it("rejects invalid source", () => {
    const db = setupDb();
    assert.equal(recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "vibes" }), null);
  });

  it("rejects no userId", () => {
    const db = setupDb();
    assert.equal(recordPain(db, null, { region: "torso", intensity: 0.5, source: "combat" }), null);
  });

  it("rejects negative intensity", () => {
    const db = setupDb();
    assert.equal(recordPain(db, "u1", { region: "torso", intensity: -0.2, source: "combat" }), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// getPainBudget + consumePainBudget
// ───────────────────────────────────────────────────────────────────────────

describe("getPainBudget aggregates pending rows by region", () => {
  it("sums intensity per region", () => {
    const db = setupDb();
    recordPain(db, "u1", { region: "torso", intensity: 0.3, source: "combat" });
    recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "combat" });
    recordPain(db, "u1", { region: "head",  intensity: 0.2, source: "spell" });
    const b = getPainBudget(db, "u1");
    assert.equal(b.count, 3);
    assert.ok(Math.abs(b.total - 1.0) < 0.0001);
    assert.ok(Math.abs(b.byRegion.torso - 0.8) < 0.0001);
    assert.ok(Math.abs(b.byRegion.head  - 0.2) < 0.0001);
  });

  it("excludes already-processed rows", () => {
    const db = setupDb();
    recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "combat" });
    consumePainBudget(db, "u1");
    const b = getPainBudget(db, "u1");
    assert.equal(b.count, 0);
    assert.equal(b.total, 0);
  });

  it("empty user returns zeros", () => {
    const db = setupDb();
    const b = getPainBudget(db, "uX");
    assert.deepStrictEqual(b, { total: 0, byRegion: {}, count: 0 });
  });
});

describe("consumePainBudget", () => {
  it("transitions ledger and returns the budget", () => {
    const db = setupDb();
    recordPain(db, "u1", { region: "legs",  intensity: 0.4, source: "fall" });
    recordPain(db, "u1", { region: "torso", intensity: 0.6, source: "combat" });

    const b = consumePainBudget(db, "u1");
    assert.equal(b.count, 2);
    assert.ok(Math.abs(b.total - 1.0) < 0.0001);

    // Idempotent: second call returns zero.
    const b2 = consumePainBudget(db, "u1");
    assert.equal(b2.count, 0);

    // Rows are marked processed, not deleted.
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM pain_signals WHERE processed_at IS NULL`).get();
    assert.equal(remaining.n, 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM pain_signals`).get();
    assert.equal(total.n, 2);
  });
});

describe("decayProcessedPain GC", () => {
  it("removes processed rows older than cutoff", () => {
    const db = setupDb();
    recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "combat" });
    consumePainBudget(db, "u1");

    // Backdate the row 31 days
    const old = Math.floor(Date.now() / 1000) - 31 * 86400;
    db.prepare(`UPDATE pain_signals SET processed_at = ? WHERE user_id = ?`).run(old, "u1");

    const removed = decayProcessedPain(db, 30);
    assert.equal(removed, 1);
  });

  it("preserves unprocessed rows even if old", () => {
    const db = setupDb();
    const r = recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "combat" });
    // Backdate recorded_at; do NOT mark processed.
    const old = Math.floor(Date.now() / 1000) - 60 * 86400;
    db.prepare(`UPDATE pain_signals SET recorded_at = ? WHERE id = ?`).run(old, r.id);
    decayProcessedPain(db, 30);
    const still = db.prepare(`SELECT COUNT(*) AS n FROM pain_signals WHERE id = ?`).get(r.id);
    assert.equal(still.n, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runRepairCycle: full integration
// ───────────────────────────────────────────────────────────────────────────

describe("runRepairCycle: drains budget and grants resist buff", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    // Multiple pain entries across regions.
    recordPain(db, "u1", { region: "torso", intensity: 0.5, source: "combat" });
    recordPain(db, "u1", { region: "torso", intensity: 0.4, source: "combat" });
    recordPain(db, "u1", { region: "legs",  intensity: 0.3, source: "fall" });
    recordPain(db, "u1", { region: "head",  intensity: 0.2, source: "spell" });
  });

  it("processes pending rows and reports counts", async () => {
    const r = await runRepairCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.users, 1);
    assert.equal(r.processed, 4);
    assert.ok(r.buffsGranted >= 1, "expected at least one resist buff inserted");
  });

  it("inserts a damage_resist user_active_effects row", async () => {
    await runRepairCycle({ db });
    const eff = db.prepare(`
      SELECT effect_id, kind, magnitude FROM user_active_effects WHERE user_id = ?
    `).get("u1");
    assert.ok(eff, "expected a user_active_effects row");
    assert.equal(eff.effect_id, "damage_resist");
    assert.equal(eff.kind, "buff");
    // total intensity = 1.4, magnitude = 1.4 * 0.04 = 0.056 (< RESIST_BUFF_MAX 0.25)
    assert.ok(eff.magnitude > 0.05 && eff.magnitude < 0.07,
      `expected ~0.056, got ${eff.magnitude}`);
  });

  it("buff magnitude caps at RESIST_BUFF_MAX (0.25)", async () => {
    // Push a huge pile of pain
    for (let i = 0; i < 50; i++) {
      recordPain(db, "u-big", { region: "torso", intensity: 1, source: "combat" });
    }
    await runRepairCycle({ db });
    const eff = db.prepare(`
      SELECT magnitude FROM user_active_effects WHERE user_id = ?
    `).get("u-big");
    assert.equal(eff.magnitude, 0.25, "buff capped at RESIST_BUFF_MAX");
  });

  it("idempotent on a quiet world", async () => {
    await runRepairCycle({ db }); // first pass drains
    const r = await runRepairCycle({ db });
    assert.equal(r.users ?? 0, 0);
    assert.equal(r.processed ?? 0, 0);
  });

  it("constants are exported and stable", () => {
    assert.equal(REGION_XP_PER_PAIN_UNIT, 35);
    assert.equal(Object.keys(REGION_SKILL).length, REGIONS.length);
  });
});
