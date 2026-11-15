// insurance-text-limits.test.js
//
// FIX-insurance-006: policy-add and claim-file accepted 300+ char
// text unbounded. Both now refuse over-limit text BY NAME at the
// governing limits (carrier/insuredName 120 — the domain's name
// convention; policyNumber 64 — its identifier convention; claim
// description 5,000 — the platform description limit). policy-add
// also validates supplied dates: real calendar dates only, renewal
// not before the start (the create form now sends both).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`insurance.${name}`);
  assert.ok(fn, `insurance.${name} not registered`);
  return fn(ctx, params);
}

before(() => { registerInsuranceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "ins_user" }, userId: "ins_user" };
const LONG = "x".repeat(301);

describe("insurance text limits + policy dates (FIX-insurance-006)", () => {
  it("policy-add refuses a 301-char carrier by name and stores nothing", () => {
    const r = call("policy-add", ctx, { carrier: LONG, policyNumber: "P1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /carrier must be 120 characters or fewer/);
    assert.equal(call("policy-list", ctx).result.policies.length, 0);
  });

  it("policy-add refuses an over-long policy number by name", () => {
    const r = call("policy-add", ctx, { carrier: "Acme", policyNumber: "y".repeat(65) });
    assert.equal(r.ok, false);
    assert.match(r.error, /policyNumber must be 64 characters or fewer/);
  });

  it("policy-add validates supplied dates and stores the picked ones", () => {
    const bad = call("policy-add", ctx, { carrier: "Acme", policyNumber: "P2", effectiveDate: "2026-02-30" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /effectiveDate must be a real date/);
    const backwards = call("policy-add", ctx, { carrier: "Acme", policyNumber: "P2", effectiveDate: "2026-06-01", renewalDate: "2026-01-01" });
    assert.equal(backwards.ok, false);
    assert.match(backwards.error, /renewalDate must not be before effectiveDate/);
    const good = call("policy-add", ctx, { carrier: "Acme", policyNumber: "P2", effectiveDate: "2026-06-01", renewalDate: "2027-06-01" });
    assert.equal(good.ok, true);
    assert.equal(good.result.policy.effectiveDate, "2026-06-01");
    assert.equal(good.result.policy.renewalDate, "2027-06-01");
  });

  it("claim-file refuses over-limit carrier and description by name", () => {
    const c = call("claim-file", ctx, { carrier: LONG, description: "a crash" });
    assert.equal(c.ok, false);
    assert.match(c.error, /carrier must be 120 characters or fewer/);
    const d = call("claim-file", ctx, { carrier: "Acme", description: "z".repeat(5001) });
    assert.equal(d.ok, false);
    assert.match(d.error, /description must be 5,000 characters or fewer/);
    const ok = call("claim-file", ctx, { carrier: "Acme", description: "a crash" });
    assert.equal(ok.ok, true);
  });
});
