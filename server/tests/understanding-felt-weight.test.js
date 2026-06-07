// Test for Wave 7 / A6 — felt weighting in understanding promotion.
// "What you felt strongly is what you become": a high-felt understanding promotes
// with fewer raw confirmations (PROMOTE_MIN_EVIDENCE = 3) than a dull one.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig120 from "../migrations/120_understandings.js";
import * as mig121 from "../migrations/121_understanding_evolution.js";
import { parseUnderstanding, saveUnderstanding } from "../lib/understanding-engine.js";
import { recordEvidence, evaluatePromotion } from "../lib/understanding-evolve.js";

function setup() {
  const db = new Database(":memory:");
  mig120.up(db);
  mig121.up(db);
  return db;
}
function seed(db) {
  const u = parseUnderstanding({
    subjectId: "dtu_x", subjectKind: "claims",
    claims: [{ text: "the meadow is dangerous", confidence: 0.95 }],
  });
  saveUnderstanding(db, u);
  // ensure confidence floor is met so only evidence count is the variable
  db.prepare(`UPDATE understandings SET confidence = 0.9 WHERE id = ?`).run(u.id);
  return u;
}

test("A6 — felt weighting in understanding promotion", async (t) => {
  await t.test("a dull understanding needs the full evidence count to promote", () => {
    const db = setup();
    const u = seed(db);
    recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "e1", payload: { feltPer: { intensity: 0.02, valence: 0 } } });
    recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "e2", payload: { feltPer: { intensity: 0.02, valence: 0 } } });
    // 2 dull confirmations < PROMOTE_MIN_EVIDENCE (3) → hold
    assert.equal(evaluatePromotion(db, u.id).decision, "hold");
  });

  await t.test("a strongly-felt understanding promotes with fewer confirmations", () => {
    const db = setup();
    const u = seed(db);
    // 2 confirmations, but each was felt intensely (a fright) → the felt bonus
    // substitutes for the missing third, so it promotes.
    recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "e1", payload: { feltPer: { intensity: 0.95, valence: -0.9, dominantDrive: "FEAR" } } });
    recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "e2", payload: { feltPer: { intensity: 0.9, valence: -0.85, dominantDrive: "FEAR" } } });
    assert.equal(evaluatePromotion(db, u.id).decision, "promote", "felt peaks become character faster");
  });

  await t.test("felt weighting never overrides the contradiction gate", () => {
    const db = setup();
    const u = seed(db);
    recordEvidence(db, { understandingId: u.id, kind: "confirm", evidenceRefId: "e1", payload: { feltPer: { intensity: 1, valence: -1 } } });
    // pile on contradictions past the dispute threshold
    for (let i = 0; i < 10; i++) recordEvidence(db, { understandingId: u.id, kind: "contradict", evidenceRefId: `c${i}` });
    assert.equal(evaluatePromotion(db, u.id).decision, "dispute", "felt intensity can't promote a disputed belief");
  });
});
