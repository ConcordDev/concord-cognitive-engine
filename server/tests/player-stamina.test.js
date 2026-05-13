/**
 * Tier-2 contract tests for Concordia Phase 5 — player-stamina.
 *
 * Pins:
 *   - getStamina ensures row + returns lazy-projected value
 *   - setState transitions state; refuses sprint/climb when exhausted
 *   - climbing drains; rest regens
 *   - drain refuses when insufficient
 *   - exhausted recovery threshold at value ≥ 25 transitions back to rest
 *   - resetStamina restores to full
 *
 * Run: node --test tests/player-stamina.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  getStamina,
  setState,
  drain,
  resetStamina,
  STAMINA_CONSTANTS,
} from "../lib/player-stamina.js";
import { up as up176 } from "../migrations/176_player_stamina.js";

function setupDb() {
  const db = new Database(":memory:");
  up176(db);
  return db;
}

describe("Phase 5 / player-stamina — bootstrapping", () => {
  it("getStamina creates row at full when first read", () => {
    const db = setupDb();
    const s = getStamina(db, "user_1");
    assert.equal(s.value, 100);
    assert.equal(s.state, "rest");
  });

  it("getStamina is null without inputs", () => {
    const s = getStamina(null, "user_1");
    assert.equal(s, null);
  });
});

describe("Phase 5 / player-stamina — setState transitions", () => {
  it("rest → climbing", () => {
    const db = setupDb();
    const r = setState(db, "user_1", "concordia-hub", "climbing");
    assert.equal(r.state, "climbing");
  });

  it("rejects bad state", () => {
    const db = setupDb();
    const r = setState(db, "user_1", "concordia-hub", "swimming-fast");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_state");
  });

  it("refuses climbing when exhausted", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO player_stamina (user_id, world_id, value, state, last_update)
      VALUES ('user_1', 'concordia-hub', 0, 'exhausted', unixepoch())
    `).run();
    const r = setState(db, "user_1", "concordia-hub", "climbing");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "exhausted");
  });
});

describe("Phase 5 / player-stamina — drain / regen via lazy projection", () => {
  it("climbing drains over time", () => {
    const db = setupDb();
    // start climb 10s ago at full
    db.prepare(`
      INSERT INTO player_stamina (user_id, world_id, value, state, last_update)
      VALUES ('user_1', 'concordia-hub', 100, 'climbing', unixepoch() - 10)
    `).run();
    const s = getStamina(db, "user_1");
    // 1.0 drain × 10s = -10 → 90
    assert.ok(Math.abs(s.value - 90) < 1);
  });

  it("rest regens over time", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO player_stamina (user_id, world_id, value, state, last_update)
      VALUES ('user_1', 'concordia-hub', 50, 'rest', unixepoch() - 5)
    `).run();
    const s = getStamina(db, "user_1");
    // 5/s × 5s = +25 → 75
    assert.ok(Math.abs(s.value - 75) < 1);
  });

  it("climbing → exhausted at value ≤ 0", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO player_stamina (user_id, world_id, value, state, last_update)
      VALUES ('user_1', 'concordia-hub', 5, 'climbing', unixepoch() - 30)
    `).run();
    const s = getStamina(db, "user_1");
    assert.equal(s.state, "exhausted");
    assert.equal(s.value, 0);
  });

  it("exhausted → rest at value ≥ 25", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO player_stamina (user_id, world_id, value, state, last_update)
      VALUES ('user_1', 'concordia-hub', 0, 'exhausted', unixepoch() - 20)
    `).run();
    const s = getStamina(db, "user_1");
    // 2.5 × 20 = 50 → above threshold 25 → rest
    assert.equal(s.state, "rest");
  });
});

describe("Phase 5 / player-stamina — drain (one-shot)", () => {
  it("succeeds when value sufficient", () => {
    const db = setupDb();
    const r = drain(db, "user_1", "concordia-hub", 30);
    assert.equal(r.ok, true);
    assert.equal(r.value, 70);
  });

  it("refuses when insufficient", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO player_stamina (user_id, world_id, value) VALUES ('user_1', 'concordia-hub', 10)`).run();
    const r = drain(db, "user_1", "concordia-hub", 30);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient");
  });

  it("transitions to exhausted when value drops to 0", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO player_stamina (user_id, world_id, value, state, last_update) VALUES ('user_1', 'concordia-hub', 30, 'rest', unixepoch())`).run();
    const r = drain(db, "user_1", "concordia-hub", 30);
    assert.equal(r.state, "exhausted");
  });
});

describe("Phase 5 / player-stamina — reset", () => {
  it("resetStamina restores to full", () => {
    const db = setupDb();
    drain(db, "user_1", "concordia-hub", 80);
    resetStamina(db, "user_1", "concordia-hub");
    const s = getStamina(db, "user_1");
    assert.equal(s.value, 100);
    assert.equal(s.state, "rest");
  });
});

describe("Phase 5 / player-stamina — world scoping (mig 101 invariant)", () => {
  it("separate stamina per world", () => {
    const db = setupDb();
    drain(db, "user_1", "concordia-hub", 50);
    const concordia = getStamina(db, "user_1", "concordia-hub");
    const tunya = getStamina(db, "user_1", "tunya");
    assert.equal(concordia.value, 50);
    assert.equal(tunya.value, 100);
  });
});

describe("Phase 5 / player-stamina — constants", () => {
  it("exposes drain/regen rates", () => {
    assert.ok(STAMINA_CONSTANTS.REGEN_REST > 0);
    assert.ok(STAMINA_CONSTANTS.DRAIN_CLIMBING > 0);
  });
});
