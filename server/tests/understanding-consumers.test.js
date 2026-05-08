/**
 * Tier-2 contract test for the Understanding consumer helpers.
 *
 * Pins the call-site shims that wire understanding into the natural
 * consumers: DTU citation flow, chat turn flow, forge/council
 * constraint verification, cognition unifier, and the live-state
 * lookup used by lens surfaces. Each helper has a robustness contract:
 * NEVER throw to the caller, NEVER block the primary pipeline.
 *
 * Run: node --test tests/understanding-consumers.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig120 from "../migrations/120_understandings.js";
import * as mig121 from "../migrations/121_understanding_evolution.js";
import { parseUnderstanding, saveUnderstanding } from "../lib/understanding-engine.js";
import {
  noteCitationAsEvidence,
  composeForChatTurn,
  verifyAgainstConstraints,
  composeForCognition,
  liveUnderstandingForSubject,
} from "../lib/understanding-consumers.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig120.up(db);
  mig121.up(db);
});

afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

// ── DTU citation hook ──────────────────────────────────────────────────────

describe("noteCitationAsEvidence — DTU citation → confirm evidence", () => {
  function seedAt(subjectId, status = "candidate") {
    const u = parseUnderstanding({ subjectId, subjectKind: "dtu", claims: ["Subject is well-formed"] });
    saveUnderstanding(db, u);
    if (status !== "candidate") {
      db.prepare(`UPDATE understandings SET status = ? WHERE id = ?`).run(status, u.id);
    }
    return u.id;
  }

  it("bumps evidence_count on every active understanding of the parent", () => {
    const a = seedAt("dtu_parent");
    const b = seedAt("dtu_parent");
    seedAt("dtu_other"); // unrelated
    const r = noteCitationAsEvidence(db, { parentId: "dtu_parent", childId: "dtu_child", lineageId: "lin_1" });
    assert.equal(r.ok, true);
    assert.equal(r.evidenced, 2);

    const aRow = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(a);
    const bRow = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(b);
    assert.equal(aRow.evidence_count, 1);
    assert.equal(bRow.evidence_count, 1);
  });

  it("skips disputed and archived understandings", () => {
    const live = seedAt("dtu_p");
    const disputed = seedAt("dtu_p", "disputed");
    const archived = seedAt("dtu_p", "archived");
    const r = noteCitationAsEvidence(db, { parentId: "dtu_p", childId: "c", lineageId: "lin_2" });
    assert.equal(r.evidenced, 1, "only the live candidate should beat");

    const dispRow = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(disputed);
    const archRow = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(archived);
    assert.equal(dispRow.evidence_count, 0);
    assert.equal(archRow.evidence_count, 0);
  });

  it("is idempotent on lineageId — replays don't double-count", () => {
    const id = seedAt("dtu_pp");
    noteCitationAsEvidence(db, { parentId: "dtu_pp", childId: "c", lineageId: "lin_dup" });
    noteCitationAsEvidence(db, { parentId: "dtu_pp", childId: "c", lineageId: "lin_dup" });
    const row = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(id);
    assert.equal(row.evidence_count, 1);
  });

  it("returns ok with evidenced=0 when the parent has no active understandings (no-op)", () => {
    const r = noteCitationAsEvidence(db, { parentId: "dtu_unknown", childId: "c", lineageId: "lin_x" });
    assert.equal(r.ok, true);
    assert.equal(r.evidenced, 0);
  });

  it("never throws on bad input — returns { ok: false } instead", () => {
    assert.equal(noteCitationAsEvidence(null, {}).ok, false);
    assert.equal(noteCitationAsEvidence(db, {}).ok, false);
  });
});

// ── Chat turn hook ─────────────────────────────────────────────────────────

describe("composeForChatTurn — per-thread compose + evidence", () => {
  it("compose verdict creates a fresh understanding tagged with the thread id and composer", () => {
    const r = composeForChatTurn(db, {
      threadId: "thread_42",
      userMessage: "What is constraint geometry?",
      assistantReply: "Constraint geometry is the math of allowed transitions in a state space.",
      verdict: "compose",
      composerUserId: "user_aria",
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "composed");
    assert.ok(r.understandingId);

    const row = db.prepare(`SELECT subject_id, subject_kind, composer_user_id FROM understandings WHERE id = ?`).get(r.understandingId);
    assert.equal(row.subject_id, "thread_42");
    assert.equal(row.subject_kind, "raw");
    assert.equal(row.composer_user_id, "user_aria");
  });

  it("confirm verdict on a subsequent turn bumps evidence on the live thread understanding", () => {
    const c = composeForChatTurn(db, { threadId: "t1", userMessage: "Premise A", assistantReply: "Implication B" });
    assert.equal(c.ok, true);

    const f = composeForChatTurn(db, { threadId: "t1", verdict: "confirm", evidenceRefId: "msg_2" });
    assert.equal(f.ok, true);
    assert.equal(f.action, "confirm");

    const row = db.prepare(`SELECT evidence_count FROM understandings WHERE id = ?`).get(c.understandingId);
    assert.equal(row.evidence_count, 1);
  });

  it("contradict verdict bumps contradiction_count", () => {
    const c = composeForChatTurn(db, { threadId: "t2", userMessage: "X", assistantReply: "Y" });
    composeForChatTurn(db, { threadId: "t2", verdict: "contradict", evidenceRefId: "msg_neg" });
    const row = db.prepare(`SELECT contradiction_count FROM understandings WHERE id = ?`).get(c.understandingId);
    assert.equal(row.contradiction_count, 1);
  });

  it("falls back to compose when verdict is confirm but no prior thread understanding exists", () => {
    const r = composeForChatTurn(db, { threadId: "t_new", verdict: "confirm", userMessage: "Hello" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "composed", "must compose when no prior exists");
  });

  it("returns ok with skipped='no_text' on compose with empty text", () => {
    const r = composeForChatTurn(db, { threadId: "t_empty", verdict: "compose" });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "no_text");
  });
});

// ── Constraint verification ────────────────────────────────────────────────

describe("verifyAgainstConstraints — forge / council gate", () => {
  it("returns satisfied=true when no constraints and no contradictions", () => {
    const r = verifyAgainstConstraints(db, { claims: ["The sky is blue", "Water boils at 100C"] });
    assert.equal(r.ok, true);
    assert.equal(r.satisfied, true);
    assert.equal(r.blockers.length, 0);
  });

  it("flags unsatisfied 'must' constraints as blockers", () => {
    const r = verifyAgainstConstraints(db, {
      claims: ["The artifact must include a signature"],
    });
    assert.equal(r.satisfied, false);
    assert.ok(r.blockers.some((b) => b.kind === "unsatisfied_constraint"));
  });

  it("flags contradictions as blockers", () => {
    const r = verifyAgainstConstraints(db, {
      claims: ["Room is hot", "Room is cold"],
    });
    assert.equal(r.satisfied, false);
    assert.ok(r.blockers.some((b) => b.kind === "contradiction"));
  });

  it("does not persist by default; persists when opts.persist=true", () => {
    verifyAgainstConstraints(db, { claims: ["Aria authored Stance_Cold"] });
    let count = db.prepare(`SELECT COUNT(*) AS n FROM understandings`).get().n;
    assert.equal(count, 0, "default verify is read-only");

    verifyAgainstConstraints(db, { claims: ["Aria authored Stance_Cold"] }, { persist: true });
    count = db.prepare(`SELECT COUNT(*) AS n FROM understandings`).get().n;
    assert.equal(count, 1, "persist=true should write a row");
  });
});

// ── Cognition unifier ──────────────────────────────────────────────────────

describe("composeForCognition — single-call unifier", () => {
  it("composes + saves in one call and returns the artifact", () => {
    const r = composeForCognition(db, { subjectId: "topic_z", claims: ["X holds", "Y follows"] });
    assert.equal(r.ok, true);
    assert.ok(r.understanding);
    assert.equal(r.understanding.subjectKind, "claims");
  });

  it("never throws on bad input", () => {
    const r = composeForCognition(db, null);
    assert.ok(r); // returns an object even on garbage input
  });
});

// ── Live state lookup ──────────────────────────────────────────────────────

describe("liveUnderstandingForSubject — UI surface helper", () => {
  it("returns the most recent live understanding for a subject", async () => {
    const u1 = parseUnderstanding({ subjectId: "topic_q", subjectKind: "dtu", claims: ["Old draft"] });
    saveUnderstanding(db, u1);
    await new Promise((r) => setTimeout(r, 1100));
    const u2 = parseUnderstanding({ subjectId: "topic_q", subjectKind: "dtu", claims: ["Newer take"] });
    saveUnderstanding(db, u2);

    const live = liveUnderstandingForSubject(db, { subjectId: "topic_q", subjectKind: "dtu" });
    assert.ok(live);
    assert.equal(live.id, u2.id);
  });

  it("returns null when nothing exists", () => {
    const live = liveUnderstandingForSubject(db, { subjectId: "nothing", subjectKind: "dtu" });
    assert.equal(live, null);
  });

  it("ignores disputed + archived rows", () => {
    const u = parseUnderstanding({ subjectId: "topic_dead", subjectKind: "dtu", claims: ["dead claim"] });
    saveUnderstanding(db, u);
    db.prepare(`UPDATE understandings SET status = 'disputed' WHERE id = ?`).run(u.id);
    const live = liveUnderstandingForSubject(db, { subjectId: "topic_dead", subjectKind: "dtu" });
    assert.equal(live, null);
  });
});
