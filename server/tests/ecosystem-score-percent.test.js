// tests/ecosystem-score-percent.test.js
//
// Pins the 0-100 display scale for the world Environment gauge. The stored
// player_world_metrics.ecosystem_score is signed [-100, 100]; every reader
// (the /api/analytics route and the analytics world-summary lens action)
// must go through ecosystemScoreToPercent / worldEcosystemPercent so the
// mapping exists once. A missing input is null with a reason, never 50.
//
// Run: node --test tests/ecosystem-score-percent.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  ECOSYSTEM_SCORE_MIN,
  ECOSYSTEM_SCORE_MAX,
  ecosystemScoreToPercent,
  worldEcosystemPercent,
} from "../lib/ecosystem/score-engine.js";

describe("ecosystemScoreToPercent", () => {
  it("exposes the canonical signed range", () => {
    assert.equal(ECOSYSTEM_SCORE_MIN, -100);
    assert.equal(ECOSYSTEM_SCORE_MAX, 100);
  });

  it("maps the signed range linearly onto 0-100 with 0 as neutral 50", () => {
    assert.equal(ecosystemScoreToPercent(-100), 0);
    assert.equal(ecosystemScoreToPercent(-37.5), 31.3); // 31.25 → 1 dp
    assert.equal(ecosystemScoreToPercent(0), 50);
    assert.equal(ecosystemScoreToPercent(0.05), 50); // 50.025 → 50.0
    assert.equal(ecosystemScoreToPercent(100), 100);
  });

  it("clamps out-of-range stored values before mapping", () => {
    assert.equal(ecosystemScoreToPercent(150), 100);
    assert.equal(ecosystemScoreToPercent(-150), 0);
  });

  it("returns null for missing or non-numeric input, never a neutral 50", () => {
    assert.equal(ecosystemScoreToPercent(null), null);
    assert.equal(ecosystemScoreToPercent(undefined), null);
    assert.equal(ecosystemScoreToPercent(NaN), null);
    assert.equal(ecosystemScoreToPercent(Infinity), null);
    assert.equal(ecosystemScoreToPercent("abc"), null);
  });
});

describe("worldEcosystemPercent", () => {
  let db;
  beforeEach(() => { db = new Database(":memory:"); });

  it("reports no_metrics_table when the table is absent", () => {
    assert.deepEqual(worldEcosystemPercent(db, "w1"), { envScore: null, envReason: "no_metrics_table" });
  });

  it("reports no_ecosystem_score when the column is absent", () => {
    db.exec(`CREATE TABLE player_world_metrics (user_id TEXT, world_id TEXT)`);
    assert.deepEqual(worldEcosystemPercent(db, "w1"), { envScore: null, envReason: "no_ecosystem_score" });
  });

  it("reports no_sample for a world with no rows (an empty sample is not 0)", () => {
    db.exec(`CREATE TABLE player_world_metrics (
      user_id TEXT NOT NULL, world_id TEXT NOT NULL, ecosystem_score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, world_id))`);
    assert.deepEqual(worldEcosystemPercent(db, "w1"), { envScore: null, envReason: "no_sample" });
  });

  it("averages stored values to the 0-100 scale: -100 and 0 -> 25", () => {
    db.exec(`CREATE TABLE player_world_metrics (
      user_id TEXT NOT NULL, world_id TEXT NOT NULL, ecosystem_score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, world_id))`);
    db.prepare("INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)").run("u1", "w1", -100);
    db.prepare("INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)").run("u2", "w1", 0);
    assert.deepEqual(worldEcosystemPercent(db, "w1"), { envScore: 25, envReason: null });
  });

  it("ignores other worlds' rows", () => {
    db.exec(`CREATE TABLE player_world_metrics (
      user_id TEXT NOT NULL, world_id TEXT NOT NULL, ecosystem_score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, world_id))`);
    db.prepare("INSERT INTO player_world_metrics (user_id, world_id, ecosystem_score) VALUES (?, ?, ?)").run("u1", "w2", 100);
    assert.deepEqual(worldEcosystemPercent(db, "w1"), { envScore: null, envReason: "no_sample" });
    assert.deepEqual(worldEcosystemPercent(db, "w2"), { envScore: 100, envReason: null });
  });

  it("reports metrics_unreadable when the db handle is missing", () => {
    assert.deepEqual(worldEcosystemPercent(null, "w1"), { envScore: null, envReason: "metrics_unreadable" });
  });
});
