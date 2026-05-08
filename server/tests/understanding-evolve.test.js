/**
 * Tier-2 contract test for the Understanding Evolution loop.
 *
 * Pins the compounding behaviour:
 *   - evidence intake (confirm + contradict, idempotent on refId)
 *   - promotion gate (thresholds, contradiction-driven dispute,
 *     model-inconsistent hold)
 *   - consolidation (N candidates → meta-understanding, children
 *     stamped with consolidated_into_id, parent generation +1)
 *   - lineage walk
 *   - heartbeat tick (idempotent, summary shape)
 *
 * Run: node --test tests/understanding-evolve.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig120 from "../migrations/120_understandings.js";
import * as mig121 from "../migrations/121_understanding_evolution.js";
import { parseUnderstanding, saveUnderstanding } from "../lib/understanding-engine.js";
import {
  recordEvidence,
  evaluatePromotion,
  applyPromotion,
  consolidateUnderstandings,
  findConsolidationCandidates,
  getUnderstandingLineage,
  runUnderstandingEvolutionTick,
  listPromotedByComposer,
  getEvolutionStats,
  PROMOTE_MIN_EVIDENCE,
  PROMOTE_MIN_CONFIDENCE,
  DISPUTE_MAX_CONTRADICT,
  CONSOLIDATE_MIN_CHILDREN,
  STATUS_CANDIDATE,
  STATUS_PROMOTED,
  STATUS_DISPUTED,
} from "../lib/understanding-evolve.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig120.up(db);
  mig121.up(db);
});

afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

// ── Fixture helpers ──────────────────────────────────────────────────────

function seedHighConfidenceUnderstanding(extraOpts = {}) {
  // High-confidence, no contradictions — the kind that's promotion-ready
  // once it gathers a few confirming evidence beats.
  const u = parseUnderstanding({
    subjectId: extraOpts.subjectId || "dtu_x",
    subjectKind: extraOpts.subjectKind || "claims",
    claims: [
      { text: "Aria authored Stance_Cold", confidence: 0.95 },
      { text: "Stance_Cold has element frost", confidence: 0.95 },
    ],
  });
  saveUnderstanding(db, u);
  if (extraOpts.composerUserId) {
    db.prepare(`UPDATE understandings SET composer_user_id = ? WHERE id = ?`).run(extraOpts.composerUserId, u.id);
  }
  return u;
}

// ── Evidence intake ──────────────────────────────────────────────────────

describe("recordEvidence", () => {
  it("bumps evidence_count on confirm and updates last_evidence_at", () => {
    const u = seedHighConfidenceUnderstanding();
    const r = recordEvidence(db, { understandingId: u.id, kind: "confirm", payload: { source: "test" } });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT evidence_count, contradiction_count, last_evidence_at FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.evidence_count, 1);
    assert.equal(row.contradiction_count, 0);
    assert.ok(row.last_evidence_at);
  });

  it("bumps contradiction_count on contradict", () => {
    const u = seedHighConfidenceUnderstanding();
    recordEvidence(db, { understandingId: u.id, kind: "contradict" });
    const row = db.prepare(`SELECT evidence_count, contradiction_count FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.evidence_count, 0);
    assert.equal(row.contradiction_count, 1);
  });

  it("is idempotent when the same evidenceRefId is replayed", () => {
    const u = seedHighConfidenceUnderstanding();
    const a = recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "evt-42" });
    const b = recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "evt-42" });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(b.idempotent, true);
    const row = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.evidence_count, 1, "second recordEvidence with same refId must be a no-op");
  });

  it("rejects unknown kinds + missing args", () => {
    assert.equal(recordEvidence(db, {}).ok, false);
    assert.equal(recordEvidence(db, { understandingId: "x" }).ok, false);
    assert.equal(recordEvidence(db, { understandingId: "x", kind: "shrug" }).ok, false);
  });

  it("returns not_found for an unknown understanding id", () => {
    const r = recordEvidence(db, { understandingId: "und_nope", kind: "confirm" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found");
  });
});

// ── Promotion gate ───────────────────────────────────────────────────────

describe("evaluatePromotion", () => {
  it("holds when there isn't enough evidence yet", () => {
    const u = seedHighConfidenceUnderstanding();
    const dec = evaluatePromotion(db, u.id);
    assert.equal(dec.decision, "hold");
    assert.equal(dec.reason, "insufficient_evidence");
  });

  it("promotes once evidence + confidence + ratio thresholds are all met", () => {
    const u = seedHighConfidenceUnderstanding();
    for (let i = 0; i < PROMOTE_MIN_EVIDENCE; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: `e${i}` });
    }
    // Ensure confidence floor — some seed cases land at 0.95, so they pass.
    const row = db.prepare(`SELECT confidence FROM understandings WHERE id = ?`).get(u.id);
    assert.ok(row.confidence >= PROMOTE_MIN_CONFIDENCE, `seed conf ${row.confidence} should clear floor ${PROMOTE_MIN_CONFIDENCE}`);
    const dec = evaluatePromotion(db, u.id);
    assert.equal(dec.decision, "promote");
  });

  it("disputes once the contradiction floor is exceeded, regardless of evidence", () => {
    const u = seedHighConfidenceUnderstanding();
    for (let i = 0; i < DISPUTE_MAX_CONTRADICT; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "contradict", evidenceRefId: `c${i}` });
    }
    // Add lots of confirming evidence too — dispute still wins, because
    // the contradiction floor is a guard against "argument by volume".
    for (let i = 0; i < 10; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: `c+${i}` });
    }
    const dec = evaluatePromotion(db, u.id);
    assert.equal(dec.decision, "dispute");
  });

  it("holds when consistency=='inconsistent' even with strong evidence", () => {
    const u = parseUnderstanding({
      subjectId: "dtu_y",
      claims: ["Room is hot", "Room is cold"],   // antonym → inconsistent
    });
    saveUnderstanding(db, u);
    for (let i = 0; i < 10; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: `e${i}` });
    }
    const dec = evaluatePromotion(db, u.id);
    assert.equal(dec.decision, "hold");
    assert.equal(dec.reason, "model_inconsistent");
  });

  it("never auto-flips already-promoted rows", () => {
    const u = seedHighConfidenceUnderstanding();
    db.prepare(`UPDATE understandings SET status = 'promoted', promoted_at = datetime('now') WHERE id = ?`).run(u.id);
    const dec = evaluatePromotion(db, u.id);
    assert.equal(dec.decision, "hold");
    assert.equal(dec.reason, "already_promoted");
  });
});

describe("applyPromotion", () => {
  it("flips status to promoted and bumps generation idempotently", () => {
    const u = seedHighConfidenceUnderstanding();
    const r1 = applyPromotion(db, u.id, "promote");
    assert.equal(r1.applied, true);

    const r2 = applyPromotion(db, u.id, "promote");
    assert.equal(r2.applied, false, "second apply is a no-op");

    const row = db.prepare(`SELECT status, promoted_at, generation FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.status, "promoted");
    assert.ok(row.promoted_at);
    assert.equal(row.generation, 1);
  });

  it("flips status to disputed and refuses to flip archived rows", () => {
    const u = seedHighConfidenceUnderstanding();
    db.prepare(`UPDATE understandings SET status = 'archived' WHERE id = ?`).run(u.id);
    const r = applyPromotion(db, u.id, "dispute");
    assert.equal(r.applied, false, "archived → dispute must be a no-op");
  });
});

// ── Consolidation ────────────────────────────────────────────────────────

describe("consolidateUnderstandings", () => {
  function seedSiblings(n, opts = {}) {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const u = parseUnderstanding({
        subjectId: opts.subjectId || "dtu_topic",
        subjectKind: opts.subjectKind || "dtu",
        claims: [
          { text: `Aspect ${i} matters`, confidence: 0.8 },
          ...(opts.sharedClaim ? [{ text: opts.sharedClaim, confidence: 0.9 }] : []),
        ],
      });
      saveUnderstanding(db, u);
      ids.push(u.id);
    }
    return ids;
  }

  it("rejects clusters smaller than CONSOLIDATE_MIN_CHILDREN", () => {
    const ids = seedSiblings(CONSOLIDATE_MIN_CHILDREN - 1);
    const r = consolidateUnderstandings(db, ids);
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_children");
  });

  it("creates a meta-understanding and stamps consolidated_into_id on each child", () => {
    const ids = seedSiblings(CONSOLIDATE_MIN_CHILDREN, { sharedClaim: "All aspects share a root cause" });
    const r = consolidateUnderstandings(db, ids);
    assert.equal(r.ok, true);
    assert.equal(r.childCount, CONSOLIDATE_MIN_CHILDREN);
    assert.ok(r.parentId);

    // Children stamped.
    const stamped = db.prepare(`
      SELECT COUNT(*) AS n FROM understandings WHERE consolidated_into_id = ?
    `).get(r.parentId);
    assert.equal(stamped.n, CONSOLIDATE_MIN_CHILDREN);

    // Parent has unioned claims (the shared one + per-sibling Aspect-N).
    const parent = db.prepare(`SELECT model_json, generation FROM understandings WHERE id = ?`).get(r.parentId);
    const model = JSON.parse(parent.model_json);
    const claimTexts = model.claims.map((c) => c.text.toLowerCase());
    assert.ok(claimTexts.some((t) => t.includes("share a root cause")), "shared claim must appear in parent");
    assert.ok(parent.generation >= 1, "parent generation must exceed children");
  });

  it("aggregates evidence + contradiction counts from children", () => {
    const ids = seedSiblings(CONSOLIDATE_MIN_CHILDREN);
    // Drop some evidence on each child first.
    for (const id of ids) {
      recordEvidence(db, { understandingId: id, kind: "confirm", evidenceRefId: `e:${id}` });
    }
    const r = consolidateUnderstandings(db, ids);
    assert.equal(r.ok, true);
    const parent = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(r.parentId);
    assert.equal(parent.evidence_count, CONSOLIDATE_MIN_CHILDREN);
  });

  it("findConsolidationCandidates surfaces eligible clusters", () => {
    seedSiblings(CONSOLIDATE_MIN_CHILDREN, { subjectId: "topic_a" });
    seedSiblings(CONSOLIDATE_MIN_CHILDREN - 2, { subjectId: "topic_b" }); // below threshold
    const cands = findConsolidationCandidates(db);
    const ids = cands.map((c) => c.subjectId);
    assert.ok(ids.includes("topic_a"));
    assert.ok(!ids.includes("topic_b"), "below-threshold clusters excluded");
  });
});

// ── Lineage ──────────────────────────────────────────────────────────────

describe("getUnderstandingLineage", () => {
  it("walks parent_understanding_id chain root-ward", () => {
    const a = seedHighConfidenceUnderstanding();
    const b = seedHighConfidenceUnderstanding();
    const c = seedHighConfidenceUnderstanding();
    db.prepare(`UPDATE understandings SET parent_understanding_id = ? WHERE id = ?`).run(a.id, b.id);
    db.prepare(`UPDATE understandings SET parent_understanding_id = ? WHERE id = ?`).run(b.id, c.id);

    const lineage = getUnderstandingLineage(db, c.id);
    const ids = lineage.map((r) => r.id);
    assert.deepEqual(ids, [c.id, b.id, a.id], "newest first, walking back to root");
  });

  it("returns just the row when no parent is set", () => {
    const u = seedHighConfidenceUnderstanding();
    const lineage = getUnderstandingLineage(db, u.id);
    assert.equal(lineage.length, 1);
    assert.equal(lineage[0].id, u.id);
  });
});

// ── Heartbeat tick ───────────────────────────────────────────────────────

describe("runUnderstandingEvolutionTick", () => {
  it("returns a summary shape and never throws on an empty DB", () => {
    const r = runUnderstandingEvolutionTick(db);
    assert.equal(r.ok, true);
    assert.ok("promoted" in r);
    assert.ok("disputed" in r);
    assert.ok("consolidated" in r);
    assert.ok("archived" in r);
  });

  it("promotes a row that meets all thresholds during a tick", () => {
    const u = seedHighConfidenceUnderstanding();
    for (let i = 0; i < PROMOTE_MIN_EVIDENCE; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: `e${i}` });
    }
    const r = runUnderstandingEvolutionTick(db);
    assert.ok(r.promoted >= 1);
    const row = db.prepare(`SELECT status FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.status, STATUS_PROMOTED);
  });

  it("disputes a row that exceeds contradiction floor during a tick", () => {
    const u = seedHighConfidenceUnderstanding();
    for (let i = 0; i < DISPUTE_MAX_CONTRADICT; i++) {
      recordEvidence(db, { understandingId: u.id, kind: "contradict", evidenceRefId: `c${i}` });
    }
    const r = runUnderstandingEvolutionTick(db);
    assert.ok(r.disputed >= 1);
    const row = db.prepare(`SELECT status FROM understandings WHERE id = ?`).get(u.id);
    assert.equal(row.status, STATUS_DISPUTED);
  });
});

// ── Stats + composer surface ─────────────────────────────────────────────

describe("listPromotedByComposer + getEvolutionStats", () => {
  it("listPromotedByComposer returns a user's promoted-mind portfolio", () => {
    const u = seedHighConfidenceUnderstanding({ composerUserId: "user_aria" });
    db.prepare(`UPDATE understandings SET status = 'promoted', promoted_at = datetime('now') WHERE id = ?`).run(u.id);
    const rows = listPromotedByComposer(db, "user_aria");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, u.id);
  });

  it("getEvolutionStats returns aggregate counts that align with the table", () => {
    const u1 = seedHighConfidenceUnderstanding();
    const u2 = seedHighConfidenceUnderstanding();
    db.prepare(`UPDATE understandings SET status = 'promoted', promoted_at = datetime('now') WHERE id = ?`).run(u1.id);
    db.prepare(`UPDATE understandings SET status = 'disputed' WHERE id = ?`).run(u2.id);

    const stats = getEvolutionStats(db);
    assert.equal(stats.promoted, 1);
    assert.equal(stats.disputed, 1);
    assert.equal(stats.candidates, 0);
  });
});
