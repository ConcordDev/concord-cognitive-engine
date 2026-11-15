import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInsuranceActions from "../domains/insurance.js";

const actions = new Map();
registerInsuranceActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`insurance:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "insurance", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

function writePact(userId = "u1") {
  const r = call("pact-write", {
    payoutSparks: 5000,
    premiumSparks: 100,
    premiumFrequency: "upfront",
    durationDays: 90,
    beneficiaries: [{ userId: "u2_beneficiary", sharePct: 100 }],
  }, userId);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.pact;
}

test("FIX-death-insurance-007: only a revoked pact can be removed, and only by its writer", () => {
  const pact = writePact();
  // Active pact: removal refused, record untouched.
  const early = call("pact-remove", { pactId: pact.id });
  assert.equal(early.ok, false);
  assert.match(early.error, /only revoked/);
  assert.equal(call("pact-list", {}).result.written.length, 1);

  // Revoke, then a stranger still cannot remove it (writer-scoped).
  assert.equal(call("pact-revoke", { pactId: pact.id }).ok, true);
  assert.equal(call("pact-remove", { pactId: pact.id }, "u9_stranger").ok, false);
  assert.equal(call("pact-list", {}).result.written.length, 1);

  // The writer removes it; it leaves the list; a second remove refuses.
  const rm = call("pact-remove", { pactId: pact.id });
  assert.equal(rm.ok, true);
  assert.equal(rm.result.removed, true);
  assert.equal(call("pact-list", {}).result.written.length, 0);
  assert.equal(call("pact-remove", { pactId: pact.id }).ok, false);
});
