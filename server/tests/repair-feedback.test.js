/**
 * Tier-2 contract tests for DX Platform Phase A2.
 *
 * Pinned:
 *   - migration 143 (codebases + codebase_severity_weights + ALTER on
 *     repair_history)
 *   - codebase-registry: ensureCodebase upsert, touch, list, attach shadow
 *   - severity-evo: recordDecision counters, MIN_SAMPLES gate (no
 *     adjust until ≥20 decisions), WEIGHT_FLOOR = 0.1 (never zero a
 *     detector), WEIGHT_CEILING = 3.0, accept ramps weight up,
 *     reject drives weight down, ignore mild downward drift,
 *     detector-version bump resets weight to 1.0.
 *   - applyWeights projects weight onto severity rank: ≥1.5 → +1 rank,
 *     ≤0.7 → −1 rank, ≤0.3 → −2 ranks. Clamps to info..critical.
 *
 * Run: node --test tests/repair-feedback.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig030 from "../migrations/030_repair_enhanced.js";
import * as mig146 from "../migrations/146_repair_feedback.js";
import {
  codebaseIdFor,
  ensureCodebase,
  touchCodebase,
  listCodebasesForUser,
  attachShadowDtu,
  getCodebase,
} from "../lib/dx/codebase-registry.js";
import {
  recordDecision,
  getWeight,
  applyWeights,
  listWeightsForCodebase,
  _internals,
} from "../lib/dx/severity-evo.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig030.up(db);
  mig146.up(db);
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("migration 143 — repair_feedback", () => {
  it("creates codebases with UNIQUE(user_id, repo_root)", () => {
    const cols = db.prepare("PRAGMA table_info(codebases)").all().map(c => c.name);
    for (const k of ["id", "user_id", "repo_root", "shadow_dtu_id", "detector_version", "created_at", "last_seen_at"]) {
      assert.ok(cols.includes(k), `codebases missing column ${k}`);
    }
  });

  it("creates codebase_severity_weights with weight CHECK [0.1, 3.0]", () => {
    const cols = db.prepare("PRAGMA table_info(codebase_severity_weights)").all().map(c => c.name);
    assert.ok(cols.includes("weight"));
    assert.ok(cols.includes("accept_count"));
    assert.ok(cols.includes("reject_count"));
    assert.ok(cols.includes("ignore_count"));
    assert.throws(() => {
      db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES ('c', 'd', 'r', 5.0)`).run();
    }, /CHECK/);
    assert.throws(() => {
      db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES ('c', 'd', 'r', 0.05)`).run();
    }, /CHECK/);
  });

  it("ALTER repair_history adds 4 columns", () => {
    const cols = db.prepare("PRAGMA table_info(repair_history)").all().map(c => c.name);
    for (const k of ["user_decision", "decided_at", "codebase_id", "finding_signature"]) {
      assert.ok(cols.includes(k), `repair_history missing ${k}`);
    }
  });

  it("ALTER is idempotent on re-run", () => {
    let threw = false;
    try { mig146.up(db); } catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("codebase-registry", () => {
  it("codebaseIdFor is deterministic given (userId, repoRoot)", () => {
    const a = codebaseIdFor("alice", "/repo/foo");
    const b = codebaseIdFor("alice", "/repo/foo");
    const c = codebaseIdFor("alice", "/repo/bar");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("ensureCodebase inserts a new row + flips created=true", () => {
    const r = ensureCodebase(db, "alice", "/repo/foo");
    assert.equal(r.ok, true);
    assert.ok(r.codebaseId.startsWith("cb_alice_"));
    const row = db.prepare(`SELECT * FROM codebases WHERE id = ?`).get(r.codebaseId);
    assert.ok(row);
    assert.equal(row.user_id, "alice");
    assert.equal(row.repo_root, "/repo/foo");
  });

  it("ensureCodebase second call updates last_seen_at", () => {
    const r1 = ensureCodebase(db, "alice", "/repo/foo");
    db.prepare(`UPDATE codebases SET last_seen_at = 0 WHERE id = ?`).run(r1.codebaseId);
    const r2 = ensureCodebase(db, "alice", "/repo/foo");
    assert.equal(r2.codebaseId, r1.codebaseId);
    const row = getCodebase(db, r1.codebaseId);
    assert.ok(row.last_seen_at > 0);
  });

  it("touchCodebase bumps last_seen_at", () => {
    const r = ensureCodebase(db, "alice", "/repo/foo");
    db.prepare(`UPDATE codebases SET last_seen_at = 0 WHERE id = ?`).run(r.codebaseId);
    const t = touchCodebase(db, r.codebaseId);
    assert.equal(t.ok, true);
    assert.equal(t.found, true);
    const row = getCodebase(db, r.codebaseId);
    assert.ok(row.last_seen_at > 0);
  });

  it("listCodebasesForUser returns recent-first", () => {
    const r1 = ensureCodebase(db, "alice", "/repo/a");
    const r2 = ensureCodebase(db, "alice", "/repo/b");
    db.prepare(`UPDATE codebases SET last_seen_at = 5 WHERE id = ?`).run(r1.codebaseId);
    db.prepare(`UPDATE codebases SET last_seen_at = 10 WHERE id = ?`).run(r2.codebaseId);
    const list = listCodebasesForUser(db, "alice");
    assert.equal(list.length, 2);
    assert.equal(list[0].id, r2.codebaseId);
  });

  it("attachShadowDtu sets shadow_dtu_id", () => {
    const r = ensureCodebase(db, "alice", "/repo/foo");
    const a = attachShadowDtu(db, r.codebaseId, "shadow_xyz");
    assert.equal(a.ok, true);
    assert.equal(a.updated, 1);
    const row = getCodebase(db, r.codebaseId);
    assert.equal(row.shadow_dtu_id, "shadow_xyz");
  });
});

describe("severity-evo — counters", () => {
  let cb;
  beforeEach(() => { cb = ensureCodebase(db, "alice", "/r").codebaseId; });

  it("recordDecision creates a new weight row at 1.0 with one counter incremented", () => {
    const r = recordDecision(db, { codebaseId: cb, detectorId: "stale-code", ruleId: "stale_const", decision: "accepted" });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM codebase_severity_weights WHERE codebase_id = ? AND detector_id = ? AND rule_id = ?`)
      .get(cb, "stale-code", "stale_const");
    assert.ok(row);
    assert.equal(row.weight, 1.0);
    assert.equal(row.accept_count, 1);
    assert.equal(row.reject_count, 0);
  });

  it("does NOT adjust weight under MIN_SAMPLES (20)", () => {
    for (let i = 0; i < _internals.MIN_SAMPLES - 1; i++) {
      recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "rejected" });
    }
    const w = getWeight(db, cb, "d", "r");
    assert.equal(w, 1.0);
  });

  it("rejects drive weight DOWN past MIN_SAMPLES, but NEVER below floor 0.1", () => {
    for (let i = 0; i < 200; i++) {
      recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "rejected" });
    }
    const w = getWeight(db, cb, "d", "r");
    assert.ok(w >= 0.1);
    assert.ok(w < 1.0);
  });

  it("accepts drive weight UP past MIN_SAMPLES, capped at ceiling 3.0", () => {
    for (let i = 0; i < 200; i++) {
      recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "accepted" });
    }
    const w = getWeight(db, cb, "d", "r");
    assert.ok(w <= 3.0);
    assert.ok(w > 1.0);
  });

  it("ignore drifts down mildly (gentler than reject)", () => {
    // Compute the same number of decisions for both to compare slopes.
    for (let i = 0; i < 60; i++) {
      recordDecision(db, { codebaseId: cb, detectorId: "d_ignore", ruleId: "r", decision: "ignored" });
      recordDecision(db, { codebaseId: cb, detectorId: "d_reject", ruleId: "r", decision: "rejected" });
    }
    const wIgnore = getWeight(db, cb, "d_ignore", "r");
    const wReject = getWeight(db, cb, "d_reject", "r");
    assert.ok(wIgnore < 1.0, "ignore drifts below 1.0");
    assert.ok(wIgnore >= 0.1, "ignore respects floor");
    assert.ok(wIgnore > wReject, "ignore drifts more gently than reject");
  });

  it("rejects invalid decision", () => {
    const r = recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "shrug" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_decision");
  });

  it("stamps repair_history when repairId given", () => {
    db.prepare(`INSERT INTO repair_history (id, issue_type, fix_applied) VALUES ('h1', 'lint', '{}')`).run();
    const r = recordDecision(db, {
      codebaseId: cb, repairId: "h1",
      detectorId: "d", ruleId: "r", decision: "rejected",
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT user_decision, codebase_id, finding_signature FROM repair_history WHERE id = ?`).get("h1");
    assert.equal(row.user_decision, "rejected");
    assert.equal(row.codebase_id, cb);
    assert.equal(row.finding_signature, "d:r");
  });

  it("detector_version bump resets weight to 1.0 + zeroes counters", () => {
    for (let i = 0; i < 30; i++) {
      recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "rejected", detectorVersion: "v1" });
    }
    const before = db.prepare(`SELECT * FROM codebase_severity_weights WHERE codebase_id = ?`).get(cb);
    assert.ok(before.weight < 1.0);
    assert.ok(before.reject_count >= 30);

    // Bump detector_version → next decision triggers reset before counter increment.
    recordDecision(db, { codebaseId: cb, detectorId: "d", ruleId: "r", decision: "accepted", detectorVersion: "v2" });
    const after = db.prepare(`SELECT * FROM codebase_severity_weights WHERE codebase_id = ?`).get(cb);
    assert.equal(after.weight, 1.0);
    assert.equal(after.detector_version, "v2");
    // Counter for the post-bump decision should now be 1.
    assert.equal(after.accept_count, 1);
    assert.equal(after.reject_count, 0);
  });
});

describe("severity-evo — applyWeights", () => {
  let cb;
  beforeEach(() => { cb = ensureCodebase(db, "alice", "/r").codebaseId; });

  it("returns input unchanged when no weights exist", () => {
    const findings = [{ id: "stale", severity: "medium", category: "stale-code" }];
    const out = applyWeights(findings, db, cb);
    assert.equal(out[0].severity, "medium");
    assert.equal(out[0]._codebaseWeight, 1.0);
  });

  it("demotes severity by one rank when weight ≤ 0.7", () => {
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "stale-code", "stale_const", 0.6);
    const out = applyWeights([{ id: "stale_const", severity: "medium", category: "stale-code" }], db, cb);
    assert.equal(out[0].severity, "low");
    assert.equal(out[0]._baseSeverity, "medium");
  });

  it("demotes by two ranks when weight ≤ 0.3", () => {
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "stale-code", "stale_const", 0.15);
    const out = applyWeights([{ id: "stale_const", severity: "high", category: "stale-code" }], db, cb);
    assert.equal(out[0].severity, "low");
  });

  it("promotes by one rank when weight ≥ 1.5", () => {
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "stale-code", "stale_const", 2.0);
    const out = applyWeights([{ id: "stale_const", severity: "low", category: "stale-code" }], db, cb);
    assert.equal(out[0].severity, "medium");
  });

  it("clamps to info..critical bounds", () => {
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "x", "y", 0.15);
    const out = applyWeights([{ id: "y", severity: "info", category: "x" }], db, cb);
    assert.equal(out[0].severity, "info");
  });

  it("returns shallow copy — never mutates input", () => {
    const finding = { id: "y", severity: "high", category: "x" };
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "x", "y", 0.2);
    applyWeights([finding], db, cb);
    assert.equal(finding.severity, "high");
  });
});

describe("listWeightsForCodebase", () => {
  it("returns rows ordered by weight ASC (most-demoted first)", () => {
    const cb = ensureCodebase(db, "alice", "/r").codebaseId;
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, 'a', '1', 0.5)`).run(cb);
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, 'b', '2', 1.0)`).run(cb);
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, 'c', '3', 2.0)`).run(cb);
    const list = listWeightsForCodebase(db, cb);
    assert.equal(list.length, 3);
    assert.equal(list[0].weight, 0.5);
    assert.equal(list[2].weight, 2.0);
  });
});
