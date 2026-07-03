/**
 * Persistent DTU confidence layer tests (migration 354 `dtu_confidence`,
 * server/lib/dtu-confidence.js).
 *
 * Covers:
 *   (a) migration 354 applies cleanly against a fresh in-memory DB.
 *   (b) getConfidence — honest-unknown default when no row exists yet,
 *       distinguishable from a real confirmed-neutral 0.5.
 *   (c) updateConfidence — moves the score in the right direction, with
 *       diminishing influence as evidence accumulates (NOT a full Bayesian
 *       posterior — a documented, cheap heuristic, see the lib's header).
 *   (d) lazy read-time decay — a stale score blends back toward 0.5 using
 *       the SAME exponential shape as forgetting-engine.js#retentionScore's
 *       ageDecay term, applied only at read time (the row itself is
 *       untouched by a read).
 *   (e) citation-registration hook — exercised end-to-end through the real
 *       `dtu.create` macro (server.js), NOT by importing anything from
 *       server/economy/royalty-cascade.js directly. A cited parent DTU's
 *       confidence moves up.
 *   (f) drift-monitor hook — an UNEXPLAINED contradiction (no causal edge)
 *       nudges both DTUs down; a causally-EXPLAINED contradiction
 *       (`corrects`/`prevents` edge) does NOT touch confidence.
 *
 * (e) boots the real server once via the shared depth harness (same pattern
 * as tests/conkay-k1-dtu-create-stage-beats.test.js) — MUST run under the
 * standard no-egress preload, as `npm test` already does.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs server/tests/dtu-confidence.test.js
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig354 from "../migrations/354_dtu_confidence.js";
import * as mig352 from "../migrations/352_dtu_causal_edges.js";
import { getConfidence, updateConfidence } from "../lib/dtu-confidence.js";
import { addCausalEdge } from "../lib/causal-edges.js";
import { createEdge } from "../emergent/edges.js";
import { runDriftScan } from "../emergent/drift-monitor.js";
import { macroRuntime } from "./depth/_harness.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig354.up(db);
  mig352.up(db);
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

describe("migration 354 — dtu_confidence", () => {
  it("applies cleanly and creates the table", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dtu_confidence'").get();
    assert.ok(t, "dtu_confidence table exists after mig 354");
    assert.doesNotThrow(() => mig354.up(db), "idempotent");
  });

  it("the CHECK constraint rejects an out-of-range score at the raw SQL level", () => {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO dtu_confidence (dtu_id, score, evidence_count, last_updated) VALUES (?,?,?,?)",
      ).run("dtu_x", 1.5, 0, Date.now());
    }, /CHECK constraint failed/);
  });
});

describe("(b) getConfidence — honest-unknown default", () => {
  it("returns known:false + score:0.5 + evidenceCount:0 for a DTU with no row", () => {
    const c = getConfidence(db, "dtu_never_touched");
    assert.equal(c.known, false, "no row -> honest unknown, not a fabricated neutral reading");
    assert.equal(c.score, 0.5);
    assert.equal(c.evidenceCount, 0);
    assert.equal(c.lastUpdated, null);
  });

  it("a genuinely confirmed-neutral score (evidence that cancels out) is distinguishable: known:true", () => {
    updateConfidence(db, "dtu_neutral", 0.05, "cited");
    updateConfidence(db, "dtu_neutral", -0.05, "contradicted");
    const c = getConfidence(db, "dtu_neutral");
    assert.equal(c.known, true, "has a real row -> known, even though score settled back near 0.5");
    assert.equal(c.evidenceCount, 2);
  });

  it("never throws for a missing table (minimal build), missing db, or missing dtuId", () => {
    const barebonesDb = new Database(":memory:");
    assert.doesNotThrow(() => getConfidence(barebonesDb, "dtu_x"));
    assert.equal(getConfidence(barebonesDb, "dtu_x").known, false);
    assert.doesNotThrow(() => getConfidence(null, "dtu_x"));
    assert.equal(getConfidence(null, "dtu_x").known, false);
    assert.doesNotThrow(() => getConfidence(db, null));
    barebonesDb.close();
  });
});

describe("(c) updateConfidence — directional movement with diminishing influence", () => {
  it("a positive delta moves the score up from the 0.5 default", () => {
    const r = updateConfidence(db, "dtu_up", 0.1, "cited");
    assert.ok(r.score > 0.5, `expected score above 0.5, got ${r.score}`);
    assert.equal(r.evidenceCount, 1);
  });

  it("a negative delta moves the score down from the 0.5 default", () => {
    const r = updateConfidence(db, "dtu_down", -0.1, "contradicted");
    assert.ok(r.score < 0.5, `expected score below 0.5, got ${r.score}`);
    assert.equal(r.evidenceCount, 1);
  });

  it("influence shrinks as evidence accumulates — the 2nd nudge moves the score less than the 1st", () => {
    const r1 = updateConfidence(db, "dtu_diminish", 0.2, "cited");
    const delta1 = r1.score - 0.5;
    const r2 = updateConfidence(db, "dtu_diminish", 0.2, "cited");
    const delta2 = r2.score - r1.score;
    assert.ok(delta1 > 0 && delta2 > 0, "both nudges move the score up");
    assert.ok(delta2 < delta1, `2nd nudge (${delta2}) should move the score less than the 1st (${delta1})`);
    assert.equal(r2.evidenceCount, 2);
  });

  it("clamps to [0,1] under repeated extreme nudges", () => {
    let r;
    for (let i = 0; i < 50; i++) r = updateConfidence(db, "dtu_clamp", 1, "cited");
    assert.ok(r.score <= 1 && r.score >= 0, `score stayed in bounds: ${r.score}`);
  });

  it("never throws for a missing table / db (returns null instead)", () => {
    const barebonesDb = new Database(":memory:");
    assert.doesNotThrow(() => updateConfidence(barebonesDb, "dtu_x", 0.1, "cited"));
    assert.equal(updateConfidence(barebonesDb, "dtu_x", 0.1, "cited"), null);
    assert.equal(updateConfidence(null, "dtu_x", 0.1, "cited"), null);
    barebonesDb.close();
  });
});

describe("(d) lazy read-time decay — blends toward 0.5 as the row ages", () => {
  it("a fresh row (age ~0) reads back essentially unchanged", () => {
    updateConfidence(db, "dtu_fresh", 0.3, "cited");
    const c = getConfidence(db, "dtu_fresh");
    // score should be close to the raw stored value (0.5 + 0.3*1 = 0.8)
    assert.ok(Math.abs(c.score - 0.8) < 0.01, `expected ~0.8, got ${c.score}`);
  });

  it("a very old row blends most of the way back to 0.5, using the same 90-day exponential shape as forgetting-engine.js's ageDecay", () => {
    updateConfidence(db, "dtu_stale", 0.4, "cited"); // raw stored score = 0.9
    // Manually age the row: 180 days old (2x the 90-day decay constant).
    const twoHalfLivesAgo = Date.now() - 180 * 86400000;
    db.prepare("UPDATE dtu_confidence SET last_updated = ? WHERE dtu_id = ?").run(twoHalfLivesAgo, "dtu_stale");

    const c = getConfidence(db, "dtu_stale");
    const ageDecay = Math.exp(-(180 * 86400000) / (90 * 86400000)); // same formula, independently computed
    const expected = 0.5 + (0.9 - 0.5) * ageDecay;
    assert.ok(Math.abs(c.score - expected) < 0.001, `expected ~${expected}, got ${c.score}`);
    assert.ok(c.score < 0.9, "stale score has decayed toward 0.5, not still pinned at the raw stored value");
    assert.ok(c.score > 0.5, "but hasn't fully reset — some signal remains");
    // known stays true and evidenceCount stays what it was — decay is a read-time
    // presentation blend, it does not erase the fact that real evidence exists.
    assert.equal(c.known, true);
    assert.equal(c.evidenceCount, 1);
  });

  it("decay does NOT rewrite the stored row — a second read produces the same blended value modulo elapsed time", () => {
    updateConfidence(db, "dtu_noclobber", 0.4, "cited");
    const oldTs = Date.now() - 45 * 86400000;
    db.prepare("UPDATE dtu_confidence SET last_updated = ? WHERE dtu_id = ?").run(oldTs, "dtu_noclobber");
    getConfidence(db, "dtu_noclobber"); // a read
    const rawRow = db.prepare("SELECT * FROM dtu_confidence WHERE dtu_id = ?").get("dtu_noclobber");
    assert.equal(rawRow.last_updated, oldTs, "read-time decay must not mutate the persisted last_updated/score");
  });
});

describe("(e) citation-registration hook — exercised through the real dtu.create macro", () => {
  // A DTU substantive enough to clear the deterministic council value gate,
  // same shape as tests/conkay-k1-dtu-create-stage-beats.test.js's richDtu.
  function richDtu(n, extra = {}) {
    return {
      title: `confidence-hook probe ${n}`,
      source: "user",
      core: {
        definitions: [`DTU confidence hook probe ${n}: a real citation registration.`],
        claims: [
          "Being cited is weak positive evidence for the cited DTU.",
          "The confidence layer observes citation success from server.js, never from royalty-cascade.js.",
        ],
      },
      human: { summary: `Confidence-hook probe ${n}.` },
      ...extra,
    };
  }

  let runMacro, STATE, ctxA, ctxB;
  before(async () => {
    const a = await macroRuntime("confidence-hook-user-a");
    const b = await macroRuntime("confidence-hook-user-b");
    runMacro = a.runMacro;
    STATE = a.STATE;
    ctxA = a.ctx;
    ctxB = b.ctx;
  });

  it("a DTU with no citations yet has honest-unknown confidence", async () => {
    const parent = await runMacro("dtu", "create", richDtu("lonely", { visibility: "public" }), ctxA);
    assert.equal(parent.ok, true, `create should succeed: ${JSON.stringify(parent)}`);
    const parentId = parent.dtu?.id || parent.id;
    const c = getConfidence(STATE.db, parentId);
    assert.equal(c.known, false, "never cited -> still honest-unknown");
  });

  it("a successful cross-user citation nudges the cited (parent) DTU's confidence up", async () => {
    // Parent authored by user A, made public so user B can cite it.
    const parent = await runMacro("dtu", "create", richDtu("cited-parent", { visibility: "public" }), ctxA);
    assert.equal(parent.ok, true, `parent create should succeed: ${JSON.stringify(parent)}`);
    const parentId = parent.dtu?.id || parent.id;
    assert.ok(parentId);

    const before = getConfidence(STATE.db, parentId);
    assert.equal(before.known, false, "sanity: not yet cited");

    // Child authored by a DIFFERENT user, citing the parent — this is the
    // real cross-user path that calls economyRegisterCitation and, on
    // success, the confidence-update hook right alongside awardCitationXP.
    const child = await runMacro("dtu", "create", richDtu("citing-child", { lineage: [parentId] }), ctxB);
    assert.equal(child.ok, true, `child create should succeed: ${JSON.stringify(child)}`);

    const after = getConfidence(STATE.db, parentId);
    assert.equal(after.known, true, "the cited parent now has a real confidence row");
    assert.equal(after.evidenceCount, 1);
    assert.ok(after.score > 0.5, `expected the cited parent's score to move up, got ${after.score}`);
  });

  it("a same-owner self-citation does NOT register (and so does not move confidence) — matches the existing self-citation guard", async () => {
    const parent = await runMacro("dtu", "create", richDtu("self-cite-parent", { visibility: "public" }), ctxA);
    const parentId = parent.dtu?.id || parent.id;
    // Same actor (ctxA) citing their own DTU.
    const child = await runMacro("dtu", "create", richDtu("self-cite-child", { lineage: [parentId] }), ctxA);
    assert.equal(child.ok, true);
    const c = getConfidence(STATE.db, parentId);
    assert.equal(c.known, false, "self-citation never calls economyRegisterCitation, so confidence is untouched");
  });
});

describe("(f) drift-monitor hook — unexplained contradictions only", () => {
  function makeSTATE(dbHandle) {
    return { __emergent: {}, db: dbHandle, dtus: new Map() };
  }

  it("an UNEXPLAINED contradiction (no causal edge) nudges BOTH DTUs' confidence down", () => {
    const STATE = makeSTATE(db);
    createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });

    const beforeX = getConfidence(db, "dtu_x");
    const beforeY = getConfidence(db, "dtu_y");
    assert.equal(beforeX.known, false);
    assert.equal(beforeY.known, false);

    runDriftScan(STATE);

    const afterX = getConfidence(db, "dtu_x");
    const afterY = getConfidence(db, "dtu_y");
    assert.equal(afterX.known, true, "unexplained contradiction created a confidence row for dtu_x");
    assert.equal(afterY.known, true, "unexplained contradiction created a confidence row for dtu_y");
    assert.ok(afterX.score < 0.5, `expected dtu_x confidence to drop, got ${afterX.score}`);
    assert.ok(afterY.score < 0.5, `expected dtu_y confidence to drop, got ${afterY.score}`);
  });

  it("a causally-EXPLAINED contradiction (`corrects` edge) does NOT touch confidence", () => {
    const STATE = makeSTATE(db);
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "corrects" });
    createEdge(STATE, { sourceId: "dtu_a", targetId: "dtu_b", edgeType: "contradicts" });

    runDriftScan(STATE);

    const a = getConfidence(db, "dtu_a");
    const b = getConfidence(db, "dtu_b");
    assert.equal(a.known, false, "expected/explained contradiction must not create a confidence row for dtu_a");
    assert.equal(b.known, false, "expected/explained contradiction must not create a confidence row for dtu_b");
  });

  it("an unusual (non-corrects/prevents) causal edge between a contradicting pair also does NOT touch confidence", () => {
    const STATE = makeSTATE(db);
    addCausalEdge(db, { childId: "dtu_b", parentId: "dtu_a", edgeType: "causes" });
    createEdge(STATE, { sourceId: "dtu_a", targetId: "dtu_b", edgeType: "contradicts" });

    runDriftScan(STATE);

    const a = getConfidence(db, "dtu_a");
    const b = getConfidence(db, "dtu_b");
    assert.equal(a.known, false, "the 'unusual but causally-linked' branch is distinct from the unexplained branch");
    assert.equal(b.known, false);
  });

  it("never throws even when STATE has no db (best-effort enrichment)", () => {
    const STATE = { __emergent: {}, dtus: new Map() };
    createEdge(STATE, { sourceId: "dtu_x", targetId: "dtu_y", edgeType: "contradicts" });
    assert.doesNotThrow(() => runDriftScan(STATE));
  });
});
