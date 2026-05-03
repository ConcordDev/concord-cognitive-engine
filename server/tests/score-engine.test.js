// Tests for the EvoEcosystem score-engine.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  adjust,
  getMetrics,
  runMetricsDecay,
  sovereignVisitSignal,
  concordVisitSignal,
  concordiaVisitSignal,
} from "../lib/ecosystem/score-engine.js";

function makeFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_world_metrics (
      user_id              TEXT NOT NULL,
      world_id             TEXT NOT NULL,
      ecosystem_score      REAL NOT NULL DEFAULT 0,
      concord_alignment    REAL NOT NULL DEFAULT 0,
      concordia_alignment  REAL NOT NULL DEFAULT 0,
      refusal_debt         REAL NOT NULL DEFAULT 0,
      updated_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, world_id)
    );
  `);
  return db;
}

describe("score-engine", () => {
  let db;
  before(() => { db = makeFixture(); });

  test("getMetrics returns zeros for a fresh player", () => {
    const m = getMetrics(db, "u1", "concordia-hub");
    assert.equal(m.ecosystem_score, 0);
    assert.equal(m.concord_alignment, 0);
    assert.equal(m.concordia_alignment, 0);
    assert.equal(m.refusal_debt, 0);
  });

  test("adjust applies a single-axis delta", () => {
    adjust(db, "u1", "concordia-hub", { ecosystem_score: 5 });
    assert.equal(getMetrics(db, "u1", "concordia-hub").ecosystem_score, 5);
  });

  test("adjust applies multi-axis deltas in one call", () => {
    adjust(db, "u1", "concordia-hub", { concord_alignment: 3, concordia_alignment: -2, refusal_debt: 8 });
    const m = getMetrics(db, "u1", "concordia-hub");
    assert.equal(m.concord_alignment, 3);
    assert.equal(m.concordia_alignment, -2);
    assert.equal(m.refusal_debt, 8);
  });

  test("adjust clamps to [-100, 100]", () => {
    adjust(db, "u2", "w", { ecosystem_score: 9999 });
    assert.equal(getMetrics(db, "u2", "w").ecosystem_score, 100);
    adjust(db, "u2", "w", { ecosystem_score: -9999 });
    assert.equal(getMetrics(db, "u2", "w").ecosystem_score, -100);
  });

  test("runMetricsDecay relaxes refusal_debt toward zero", () => {
    adjust(db, "u3", "w", { refusal_debt: 50 });
    runMetricsDecay({ state: {}, db, tickCount: 0 });
    const after = getMetrics(db, "u3", "w").refusal_debt;
    assert.ok(after < 50);
    assert.ok(after >= 0);
  });

  test("runMetricsDecay does not touch alignment scalars", () => {
    adjust(db, "u4", "w", { concord_alignment: 30, concordia_alignment: -30 });
    runMetricsDecay({ state: {}, db, tickCount: 0 });
    const m = getMetrics(db, "u4", "w");
    assert.equal(m.concord_alignment, 30);
    assert.equal(m.concordia_alignment, -30);
  });

  test("sovereignVisitSignal rises with refusal_debt OR alignment imbalance", () => {
    assert.equal(sovereignVisitSignal({ refusal_debt: 0, concord_alignment: 0, concordia_alignment: 0, ecosystem_score: 0 }), 0);
    assert.ok(sovereignVisitSignal({ refusal_debt: 50, concord_alignment: 0, concordia_alignment: 0, ecosystem_score: 0 }) > 0);
    assert.ok(sovereignVisitSignal({ refusal_debt: 0, concord_alignment: 80, concordia_alignment: -80, ecosystem_score: 0 }) > 0);
  });

  test("concordVisitSignal triggers only on positive concord_alignment", () => {
    assert.equal(concordVisitSignal({ concord_alignment: -50 }), 0);
    assert.equal(concordVisitSignal({ concord_alignment: 0 }), 0);
    assert.ok(concordVisitSignal({ concord_alignment: 50 }) > 0);
  });

  test("concordiaVisitSignal triggers on EITHER warm OR cold ecosystem_score", () => {
    assert.equal(concordiaVisitSignal({ ecosystem_score: 0 }), 0);
    assert.ok(concordiaVisitSignal({ ecosystem_score: 50 }) > 0);
    assert.ok(concordiaVisitSignal({ ecosystem_score: -50 }) > 0);
  });
});
