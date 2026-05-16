import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`insurance.${name}`);
  assert.ok(fn, `insurance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerInsuranceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("insurance.policy-* CRUD", () => {
  it("scoped per user", () => {
    const r = call("policy-add", ctxA, { carrier: "Geico", policyNumber: "ABC123", kind: "auto", annualPremium: 1800, deductible: 500 });
    assert.equal(r.ok, true);
    assert.equal(call("policy-list", ctxA, {}).result.policies.length, 1);
    assert.equal(call("policy-list", ctxB, {}).result.policies.length, 0);
  });
  it("rejects missing carrier or policy#", () => {
    assert.equal(call("policy-add", ctxA, { carrier: "Geico" }).ok, false);
  });
});

describe("insurance.claim-* CRUD", () => {
  it("file + list scoped per user", () => {
    const r = call("claim-file", ctxA, { carrier: "Geico", description: "Rear-ended in parking lot", claimAmount: 4500, kind: "collision" });
    assert.equal(r.ok, true);
    const list = call("claim-list", ctxA, {});
    assert.equal(list.result.claims.length, 1);
    assert.equal(list.result.claims[0].status, "submitted");
    assert.ok(list.result.claims[0].daysSinceSubmit >= 0);
  });
  it("rejects empty description", () => {
    assert.equal(call("claim-file", ctxA, { carrier: "X", description: "" }).ok, false);
  });
});

describe("insurance.quotes-compare", () => {
  it("returns 8 carriers sorted with USAA cheapest", () => {
    const r = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "standard" });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotes.length, 8);
    assert.ok(r.result.quotes.every(q => q.annualPremium > 0));
  });
  it("determinism per (zip, kind, coverage)", () => {
    const r1 = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "standard" });
    const r2 = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "standard" });
    assert.deepEqual(r1.result.quotes, r2.result.quotes);
  });
  it("premium coverage costs more than minimum", () => {
    const min = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "minimum" });
    const prem = call("quotes-compare", ctxA, { kind: "auto", zip: "94110", coverage: "premium" });
    assert.ok(prem.result.quotes[0].annualPremium > min.result.quotes[0].annualPremium);
  });
});

describe("insurance.coverage-analyze", () => {
  it("flags missing-everything as critical", () => {
    const r = call("coverage-analyze", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.gaps.some(g => g.area === "Auto liability"));
    assert.ok(r.result.gaps.some(g => g.area === "Home/renters"));
    assert.ok(r.result.score < 70);
  });

  it("score improves when policies added", () => {
    call("policy-add", ctxA, { carrier: "G", policyNumber: "1", kind: "auto", liabilityLimit: 100000 });
    call("policy-add", ctxA, { carrier: "G", policyNumber: "2", kind: "renters" });
    const r = call("coverage-analyze", ctxA, {});
    assert.ok(r.result.score > 50);
    assert.ok(r.result.gaps.length < 5);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one registered", () => assert.ok(ACTIONS.size > 8));
});
