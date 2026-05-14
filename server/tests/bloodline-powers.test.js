/**
 * Tier-2 contract tests for Concordia Phase 2 — bloodline-powers.
 *
 * Pins:
 *   - getBloodlineMultiplier matrix:
 *       matched+pure       → 1.20
 *       matched+mild       → 1.00
 *       matched+heavy      → 0.60
 *       matched+faded(.95) → refused
 *       mismatched         → 0.85
 *       no_ancestry        → 1.00 (neutral)
 *       no_element         → 1.00 (neutral)
 *   - dilution boundary values: < 0.30, < 0.60, < 0.90 cutoffs
 *   - all 10 BLOODLINES have ≥ 1 element
 *   - setUserAncestry idempotent upsert
 *   - setNpcAncestry idempotent upsert
 *   - unknown bloodline rejected
 *   - attackerMultiplier returns neutral when no row
 *
 * Run: node --test tests/bloodline-powers.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  getBloodlineMultiplier,
  getUserAncestry,
  getNpcAncestry,
  setUserAncestry,
  setNpcAncestry,
  attackerMultiplier,
  isKnownBloodline,
  elementsForBloodline,
  KNOWN_BLOODLINES,
  BLOODLINE_CONSTANTS,
} from "../lib/bloodline-powers.js";
import { up as up173 } from "../migrations/173_bloodline_ancestry.js";

function setupDb() {
  const db = new Database(":memory:");
  up173(db);
  return db;
}

describe("Phase 2 / bloodline-powers — KNOWN_BLOODLINES", () => {
  it("exposes 10 bloodlines", () => {
    assert.equal(KNOWN_BLOODLINES.length, 10);
  });
  it("every bloodline has at least one element", () => {
    for (const id of KNOWN_BLOODLINES) {
      assert.ok(elementsForBloodline(id).length >= 1, `${id} has no elements`);
    }
  });
  it("isKnownBloodline true for sanguire, false for nonsense", () => {
    assert.equal(isKnownBloodline("sanguire"), true);
    assert.equal(isKnownBloodline("badname"), false);
    assert.equal(isKnownBloodline(null), false);
    assert.equal(isKnownBloodline(undefined), false);
  });
});

describe("Phase 2 / bloodline-powers — getBloodlineMultiplier matrix", () => {
  it("matched + pure (dilution < 0.30) → 1.20", () => {
    const r = getBloodlineMultiplier("sanguire", 0.1, "fire");
    assert.equal(r.kind, "pure_match");
    assert.equal(r.multiplier, BLOODLINE_CONSTANTS.MULTIPLIER_PURE_MATCH);
    assert.equal(r.refused, false);
  });

  it("matched + mild (0.30 ≤ d < 0.60) → 1.00", () => {
    const r = getBloodlineMultiplier("sanguire", 0.45, "fire");
    assert.equal(r.kind, "mild_match");
    assert.equal(r.multiplier, BLOODLINE_CONSTANTS.MULTIPLIER_MILD_MATCH);
    assert.equal(r.refused, false);
  });

  it("matched + heavy (0.60 ≤ d < 0.90) → 0.60", () => {
    const r = getBloodlineMultiplier("sanguire", 0.75, "fire");
    assert.equal(r.kind, "weak_match");
    assert.equal(r.multiplier, BLOODLINE_CONSTANTS.MULTIPLIER_WEAK_MATCH);
    assert.equal(r.refused, false);
  });

  it("matched + faded (d ≥ 0.90) → refused", () => {
    const r = getBloodlineMultiplier("sanguire", 0.95, "fire");
    assert.equal(r.kind, "refused_faded");
    assert.equal(r.multiplier, 0);
    assert.equal(r.refused, true);
  });

  it("mismatched element → 0.85 (never refused)", () => {
    const r = getBloodlineMultiplier("sanguire", 0.1, "ice");
    assert.equal(r.kind, "mismatch");
    assert.equal(r.multiplier, BLOODLINE_CONSTANTS.MULTIPLIER_MISMATCH);
    assert.equal(r.refused, false);
  });

  it("unknown bloodline → neutral pass-through", () => {
    const r = getBloodlineMultiplier("nonsense", 0.0, "fire");
    assert.equal(r.kind, "no_ancestry");
    assert.equal(r.multiplier, 1.0);
  });

  it("element=none → neutral pass-through", () => {
    const r = getBloodlineMultiplier("sanguire", 0.0, "none");
    assert.equal(r.kind, "no_element");
    assert.equal(r.multiplier, 1.0);
  });

  it("element=null → neutral pass-through", () => {
    const r = getBloodlineMultiplier("sanguire", 0.0, null);
    assert.equal(r.kind, "no_element");
    assert.equal(r.multiplier, 1.0);
  });

  it("boundary: dilution=0.30 jumps from pure → mild", () => {
    const pure = getBloodlineMultiplier("sanguire", 0.299, "fire");
    const mild = getBloodlineMultiplier("sanguire", 0.30, "fire");
    assert.equal(pure.kind, "pure_match");
    assert.equal(mild.kind, "mild_match");
  });

  it("boundary: dilution=0.60 jumps from mild → heavy", () => {
    const mild = getBloodlineMultiplier("sanguire", 0.599, "fire");
    const heavy = getBloodlineMultiplier("sanguire", 0.60, "fire");
    assert.equal(mild.kind, "mild_match");
    assert.equal(heavy.kind, "weak_match");
  });

  it("boundary: dilution=0.90 jumps from heavy → faded", () => {
    const heavy = getBloodlineMultiplier("sanguire", 0.899, "fire");
    const faded = getBloodlineMultiplier("sanguire", 0.90, "fire");
    assert.equal(heavy.kind, "weak_match");
    assert.equal(faded.kind, "refused_faded");
  });

  it("Medici heal matches medici bloodline", () => {
    const r = getBloodlineMultiplier("medici", 0.0, "heal");
    assert.equal(r.kind, "pure_match");
  });

  it("Akeia water matches akeia bloodline", () => {
    const r = getBloodlineMultiplier("akeia", 0.0, "water");
    assert.equal(r.kind, "pure_match");
  });

  it("Asbir lightning matches asbir bloodline", () => {
    const r = getBloodlineMultiplier("asbir", 0.0, "lightning");
    assert.equal(r.kind, "pure_match");
  });
});

describe("Phase 2 / bloodline-powers — ancestry tables", () => {
  it("setUserAncestry upserts on user_id", () => {
    const db = setupDb();
    const r1 = setUserAncestry(db, "user_1", "sanguire", 0.2);
    assert.equal(r1.action, "set");
    const r2 = setUserAncestry(db, "user_1", "medici", 0.5);
    assert.equal(r2.action, "set");
    const a = getUserAncestry(db, "user_1");
    assert.equal(a.primary_bloodline, "medici");
    assert.equal(a.dilution, 0.5);
  });

  it("setNpcAncestry upserts on npc_id", () => {
    const db = setupDb();
    setNpcAncestry(db, "npc_1", "iron_warden", 0.0);
    setNpcAncestry(db, "npc_1", "sahm", 0.3);
    const a = getNpcAncestry(db, "npc_1");
    assert.equal(a.primary_bloodline, "sahm");
    assert.equal(a.dilution, 0.3);
  });

  it("setUserAncestry rejects unknown bloodline", () => {
    const db = setupDb();
    const r = setUserAncestry(db, "user_1", "imaginary", 0.0);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_bloodline");
  });

  it("setUserAncestry clamps dilution to [0,1]", () => {
    const db = setupDb();
    setUserAncestry(db, "user_1", "sanguire", 1.5);
    assert.equal(getUserAncestry(db, "user_1").dilution, 1.0);
    setUserAncestry(db, "user_2", "sanguire", -0.5);
    assert.equal(getUserAncestry(db, "user_2").dilution, 0.0);
  });

  it("getUserAncestry returns null when no row", () => {
    const db = setupDb();
    assert.equal(getUserAncestry(db, "user_unknown"), null);
  });
});

describe("Phase 2 / bloodline-powers — attackerMultiplier (combat-path entry)", () => {
  it("returns neutral when no ancestry row", () => {
    const db = setupDb();
    const r = attackerMultiplier(db, "user_no_ancestry", "fire");
    assert.equal(r.kind, "no_ancestry");
    assert.equal(r.multiplier, 1.0);
  });

  it("returns pure match for sanguire user casting fire", () => {
    const db = setupDb();
    setUserAncestry(db, "user_1", "sanguire", 0.1);
    const r = attackerMultiplier(db, "user_1", "fire");
    assert.equal(r.kind, "pure_match");
    assert.equal(r.multiplier, 1.20);
  });

  it("returns refused for faded sanguire user casting fire", () => {
    const db = setupDb();
    setUserAncestry(db, "user_1", "sanguire", 0.95);
    const r = attackerMultiplier(db, "user_1", "fire");
    assert.equal(r.refused, true);
  });

  it("returns mismatch for sanguire user casting ice", () => {
    const db = setupDb();
    setUserAncestry(db, "user_1", "sanguire", 0.0);
    const r = attackerMultiplier(db, "user_1", "ice");
    assert.equal(r.kind, "mismatch");
    assert.equal(r.multiplier, 0.85);
  });
});
