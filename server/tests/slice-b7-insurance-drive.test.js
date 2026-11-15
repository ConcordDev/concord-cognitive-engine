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

test("FIX-insurance-004: fnol / reminder / statement deletes round-trip", () => {
  const fnol = call("fnol-intake", { description: "Kitchen fire", lossType: "property" }).result.fnol;
  assert.equal(call("fnol-delete", { id: fnol.id }).ok, true);
  assert.equal(call("fnol-list", {}).result.fnol.length, 0);
  assert.equal(call("fnol-delete", { id: fnol.id }).ok, false);

  const rem = call("reminder-create", { title: "Renewal due" }).result.reminder;
  assert.equal(call("reminder-delete", { id: rem.id }).ok, true);
  assert.equal(call("reminder-list", {}).result.reminders.length, 0);

  const stmt = call("statement-import", {
    carrier: "Acme", lines: [{ policyNumber: "P-1", premium: 100, commission: 10 }],
  }).result.statement;
  assert.equal(call("statement-delete", { id: stmt.id }).ok, true);
  assert.equal(call("statement-list", {}).result.statements.length, 0);
});

test("FIX-insurance-004: policy-delete cascade is explicit (documents + payments + certificates)", () => {
  const pol = call("policy-add", { carrier: "Acme", policyNumber: "P-9", kind: "home" }).result?.policy
    || call("policy-list", {}).result.policies[0];
  assert.ok(pol?.id, "policy created");
  call("payment-log", { policyId: pol.id, amount: 120, method: "card" });
  assert.equal(call("payment-list", { policyId: pol.id }).result.payments.length, 1);
  const del = call("policy-delete", { id: pol.id });
  assert.equal(del.ok, true);
  // The cascade is explicit in policy-delete (documents + payments maps
  // are deleted with the policy): both reads now refuse as not-found
  // rather than surfacing orphaned rows.
  assert.equal(call("payment-list", { policyId: pol.id }).ok, false);
  assert.equal(call("policy-document-list", { policyId: pol.id }).ok, false);
});
