// IDLE-03 (GB-1540) — the real novelty gate, pinned hermetically:
// similarity near-duplicates (not just exact hashes) are rejected,
// including cross-citizen copies; substrate-derived creations require
// their DTU link before persistence; promotable is a positive proof
// (accepted AND linked), replacing the 1.0 rubber-stamp. Runs on
// node:sqlite with the migration-041 table shape.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { assessCreation, shingleSet, jaccardSimilarity, _resetForTest } from "../lib/emergents/quality/creation-gate.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.prepare(`
    CREATE TABLE emergent_quality_history (
      id TEXT PRIMARY KEY, emergent_id TEXT NOT NULL, task_id TEXT,
      artifact_id TEXT, decision TEXT NOT NULL,
      quality_score REAL NOT NULL DEFAULT 0, stages_json TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
  db.prepare(`CREATE TABLE dtus (id TEXT PRIMARY KEY, content_hash TEXT)`).run();
  return db;
}

const BASE = "the harbor lights ripple across quiet water while gulls circle above the morning tide and fishing boats drift slowly toward the open sea";
const NEAR = "the harbor lights ripple across quiet water while gulls circle above the morning tide and fishing boats drift slowly toward the open ocean";
const OTHER = "quantum circuits entangle photons inside a cryogenic chamber where engineers calibrate microwave pulses for tomorrow's experiment run";

describe("IDLE-03 novelty gate", () => {
  beforeEach(() => _resetForTest());

  it("shingle similarity: near-identical texts score high, unrelated texts low", () => {
    assert.ok(jaccardSimilarity(shingleSet(BASE), shingleSet(NEAR)) >= 0.8);
    assert.ok(jaccardSimilarity(shingleSet(BASE), shingleSet(OTHER)) < 0.3);
    assert.equal(jaccardSimilarity(shingleSet(BASE), shingleSet(BASE)), 1);
  });

  it("a first creation is accepted; its exact repeat is rejected (existing behaviour kept)", () => {
    const db = freshDb();
    const a = assessCreation({ kind: "observation", text: BASE, emergentId: "cit_a", db, artifactIds: ["dtu_1"], requireDtuLink: true });
    assert.equal(a.status, "accepted");
    const b = assessCreation({ kind: "observation", text: BASE, emergentId: "cit_a", db, artifactIds: ["dtu_1"], requireDtuLink: true });
    assert.equal(b.status, "rejected");
    assert.ok(b.reasons.includes("near_duplicate"));
  });

  it("a one-word paraphrase is rejected as a near-duplicate — the old hash-only gate passed it", () => {
    const db = freshDb();
    assessCreation({ kind: "observation", text: BASE, emergentId: "cit_a", db, artifactIds: ["dtu_1"], requireDtuLink: true });
    const b = assessCreation({ kind: "observation", text: NEAR, emergentId: "cit_a", db, artifactIds: ["dtu_2"], requireDtuLink: true });
    assert.equal(b.status, "rejected");
    assert.ok(b.reasons.includes("near_duplicate"));
  });

  it("a cross-citizen copy is rejected too (fleet window, not per-citizen)", () => {
    const db = freshDb();
    assessCreation({ kind: "observation", text: BASE, emergentId: "cit_a", db, artifactIds: ["dtu_1"], requireDtuLink: true });
    const b = assessCreation({ kind: "observation", text: NEAR, emergentId: "cit_b", db, artifactIds: ["dtu_9"], requireDtuLink: true });
    assert.equal(b.status, "rejected");
    assert.ok(b.reasons.includes("near_duplicate"));
  });

  it("a genuinely new creation from another citizen is accepted", () => {
    const db = freshDb();
    assessCreation({ kind: "observation", text: BASE, emergentId: "cit_a", db, artifactIds: ["dtu_1"], requireDtuLink: true });
    const b = assessCreation({ kind: "observation", text: OTHER, emergentId: "cit_b", db, artifactIds: ["dtu_9"], requireDtuLink: true });
    assert.equal(b.status, "accepted");
  });

  it("a substrate-derived creation without its DTU link is rejected before persistence", () => {
    const db = freshDb();
    const a = assessCreation({ kind: "observation", text: OTHER, emergentId: "cit_a", db, requireDtuLink: true });
    assert.equal(a.status, "rejected");
    assert.ok(a.reasons.includes("missing_dtu_link"));
    assert.equal(a.promotable, false);
  });

  it("promotable is a positive proof: accepted AND linked; the link lands in artifact_id", () => {
    const db = freshDb();
    const a = assessCreation({ kind: "observation", text: OTHER, emergentId: "cit_a", db, artifactIds: ["dtu_7", "dtu_8"], requireDtuLink: true });
    assert.equal(a.status, "accepted");
    assert.equal(a.promotable, true);
    const row = db.prepare("SELECT artifact_id, stages_json FROM emergent_quality_history").get();
    assert.equal(row.artifact_id, "dtu_7");
    const stages = JSON.parse(row.stages_json);
    assert.deepEqual(stages.artifactIds, ["dtu_7", "dtu_8"]);
    assert.equal(stages.promotable, true);
  });

  it("a dream (no link by design) can be accepted but is never promotable", () => {
    const db = freshDb();
    const a = assessCreation({ kind: "dream", text: OTHER, emergentId: "cit_a", db });
    assert.equal(a.status, "accepted");
    assert.equal(a.promotable, false);
  });
});
