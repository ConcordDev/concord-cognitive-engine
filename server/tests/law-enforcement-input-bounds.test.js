// FIX-law-enforcement-006 — Quick Analysis numeric bounds.
//
// patrolOptimize used to pass zone numbers through parseFloat/parseInt
// with only a NaN fallback, so negatives and absurd magnitudes
// computed straight into the plan (Patrol -1/-1; a 1e9 crime rate
// "needs 100000000 units"), and caseAnalysis summed
// (evidenceLinks || []).length, so a non-array evidenceLinks poisoned
// the strength to NaN. The macros now refuse out-of-range zone fields
// by name and count suspect links defensively (array-only, capped).
//
// Run: cd server && NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/law-enforcement-input-bounds.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerLawEnforcementActions from "../domains/lawenforcement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, data = {}) {
  const fn = ACTIONS.get(`law-enforcement.${name}`);
  if (!fn) throw new Error(`law-enforcement.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, {});
}

before(() => { registerLawEnforcementActions(register); });

let seq = 0;
const freshCtx = () => { seq += 1; return { actor: { userId: `le_bounds_${seq}` }, userId: `le_bounds_${seq}` }; };

describe("patrolOptimize input bounds (FIX-law-enforcement-006)", () => {
  it("a valid zone still computes exactly as before", () => {
    const r = call("patrolOptimize", freshCtx(), { zones: [{ name: "North", crimeRate: "80", population: "1000", currentPatrols: "1" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.zones[0].recommended, 8);
    assert.equal(r.result.totalUnitsNeeded, 8);
    assert.equal(r.result.totalCurrentUnits, 1);
    assert.deepEqual(r.result.hotspots, ["North"]);
  });

  it("a negative crime rate is refused by name instead of planning Patrol -1/-1", () => {
    const r = call("patrolOptimize", freshCtx(), { zones: [{ name: "South", crimeRate: "-15", population: "1000", currentPatrols: "-1" }] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.reason, /Zone "South": crime rate must be a number between 0 and 10,000\./);
  });

  it("a huge crime rate is refused instead of needing 100000000 units", () => {
    const r = call("patrolOptimize", freshCtx(), { zones: [{ name: "East", crimeRate: "1000000000", population: "1000", currentPatrols: "2" }] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /crime rate/);
  });

  it("negative population and non-numeric patrols are refused by name", () => {
    const pop = call("patrolOptimize", freshCtx(), { zones: [{ name: "West", crimeRate: "10", population: "-5", currentPatrols: "1" }] });
    assert.equal(pop.ok, false);
    assert.match(pop.reason, /population must be a number between 0 and 100,000,000\./);
    const cur = call("patrolOptimize", freshCtx(), { zones: [{ name: "West", crimeRate: "10", population: "5", currentPatrols: "abc" }] });
    assert.equal(cur.ok, false);
    assert.match(cur.reason, /current patrols must be a number between 0 and 100,000\./);
  });

  it("blank fields still count as 0, as they did", () => {
    const r = call("patrolOptimize", freshCtx(), { zones: [{ name: "Blank", crimeRate: "", population: "", currentPatrols: "" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalUnitsNeeded, 0);
    assert.equal(r.result.totalCurrentUnits, 0);
  });
});

describe("caseAnalysis link counting (FIX-law-enforcement-006)", () => {
  it("a numeric (non-array) evidenceLinks no longer poisons the strength to NaN", () => {
    const r = call("caseAnalysis", freshCtx(), { evidence: [{ description: "photo" }], witnesses: [], suspects: [{ name: "X", evidenceLinks: 5 }] });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.caseStrength), `caseStrength was ${r.result.caseStrength}`);
  });

  it("an enormous links array is counted under the cap and the strength stays the capped value", () => {
    const huge = Array(2000000).fill(true);
    const r = call("caseAnalysis", freshCtx(), { evidence: [], witnesses: [], suspects: [{ name: "Y", evidenceLinks: huge }] });
    assert.equal(r.ok, true);
    // links term: min(100, 1000 * 25) = 100 → 100 * 0.3 = 30; nothing else counts.
    assert.equal(r.result.caseStrength, 30);
  });
});
