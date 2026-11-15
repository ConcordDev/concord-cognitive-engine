// FIX-defense-005 — readinessScore publishes its weighting.
//
// The readiness card showed 79% for personnel 8/10, equipment 9/10,
// training 80%, supply 60% with no formula anywhere: an unweighted mean
// is 77.5%, so the number read as arbitrary. The weighting (personnel
// 30 / equipment 30 / training 20 / supplies 20) lived only in the
// computation. The result now carries the weights it used, so the card
// can show the formula the number came from — and this pin holds the
// returned weights honest against the returned overall.
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/defense-readiness-weights.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDefenseActions from "../domains/defense.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

before(() => { registerDefenseActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function readiness(data) {
  const fn = ACTIONS.get("defense.readinessScore");
  return fn(ctxA, { id: null, data, meta: {} }, {});
}

describe("readinessScore publishes its weights (FIX-defense-005)", () => {
  it("the walker's sample: 8/10, 9/10, 80, 60 → 79, explained by the returned weights", () => {
    const r = readiness({
      personnelReady: 8, personnelTotal: 10,
      equipmentOperational: 9, equipmentTotal: 10,
      trainingCompletionPercent: 80, suppliesPercent: 60,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.personnelReadiness, 80);
    assert.equal(r.result.equipmentReadiness, 90);
    assert.equal(r.result.overallReadiness, 79);
    assert.deepEqual(r.result.weights, { personnel: 0.3, equipment: 0.3, training: 0.2, supplies: 0.2 });
    // The published weights reproduce the published number.
    const w = r.result.weights;
    const explained = Math.round(
      r.result.personnelReadiness * w.personnel +
      r.result.equipmentReadiness * w.equipment +
      r.result.trainingCompletion * w.training +
      r.result.supplyLevel * w.supplies,
    );
    assert.equal(explained, r.result.overallReadiness);
  });

  it("the weights sum to 1, so the overall stays a true percentage", () => {
    const r = readiness({
      personnelReady: 50, personnelTotal: 100,
      equipmentOperational: 50, equipmentTotal: 100,
      trainingCompletionPercent: 50, suppliesPercent: 50,
    });
    const w = r.result.weights;
    assert.equal(w.personnel + w.equipment + w.training + w.supplies, 1);
    assert.equal(r.result.overallReadiness, 50);
  });
});
