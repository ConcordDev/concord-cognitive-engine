// server/tests/insurance-build-slices.test.js
//
// Behaviour pins for the insurance full-lens build (GB-1089 replacement pair;
// R5 first pass 2026-11-01 + Lead compilation repair order F2 → F4 → F3 → F6
// → F5). Hermetic harness in the insurance-client-crm.test.js shape: import
// the real registrar, call handlers as (ctx, params).
//   S2 (F4) — claim↔policy link: stamped at file time, unknown policy
//             refused, older rows enriched at list time.
//   S4 (F6) — governed lifecycle: client-delete detaches (names preserved),
//             policy-delete cascades its certificates, certificate-delete.
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

const CTX = { actor: { userId: "u-ins-1" }, userId: "u-ins-1" };

function seedBook() {
  const client = call("client-add", CTX, { name: "Dana Whitfield", referralSource: "Agent referral", notes: "Prefers email" }).result.client;
  const policy = call("policy-add", CTX, {
    carrier: "Acme Mutual", policyNumber: "POL-100", kind: "auto",
    annualPremium: 1200, clientId: client.id,
  }).result.policy;
  return { client, policy };
}

describe("insurance build — S2 (F4) the claim's policy link", () => {
  it("stamps the policy number, the policy's carrier and the claimant at file time", () => {
    const { client, policy } = seedBook();
    const r = call("claim-file", CTX, {
      carrier: "Typed Carrier", description: "Rear-end collision", kind: "collision",
      claimAmount: 2400, policyId: policy.id,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.policyId, policy.id);
    assert.equal(r.result.claim.policyNumber, "POL-100");
    assert.equal(r.result.claim.carrier, "Acme Mutual", "the claim inherits the policy's carrier");
    assert.equal(r.result.claim.clientId, client.id, "the policy's insured becomes the claimant");
    assert.equal(r.result.claim.claimantName, "Dana Whitfield");
    const listed = call("claim-list", CTX, {}).result.claims;
    assert.equal(listed[0].policyNumber, "POL-100");
    assert.equal(listed[0].claimantName, "Dana Whitfield");
  });

  it("refuses a claim linked to a policy that is not in the book", () => {
    seedBook();
    const r = call("claim-file", CTX, {
      carrier: "Acme Mutual", description: "x", policyId: "pol_missing",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "policy_not_found");
    assert.equal(call("claim-list", CTX, {}).result.claims.length, 0);
  });

  it("an unlinked claim still files, with no fabricated link", () => {
    seedBook();
    const r = call("claim-file", CTX, { carrier: "Acme Mutual", description: "Water damage", kind: "property" });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.policyId, "");
    assert.equal(r.result.claim.policyNumber, null);
  });
});

describe("insurance build — S4 (F6) the governed lifecycle", () => {
  it("client-delete detaches linked records and preserves their stamped names", () => {
    const { client, policy } = seedBook();
    call("claim-file", CTX, { carrier: "Acme Mutual", description: "Claim", policyId: policy.id });
    const r = call("client-delete", CTX, { id: client.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.detachedPolicies, 1);
    assert.equal(r.result.detachedClaims, 1);
    assert.equal(call("client-list", CTX, {}).result.count, 0);
    const pol = call("policy-list", CTX, {}).result.policies[0];
    assert.equal(pol.clientId, null);
    assert.equal(pol.insuredName, "Dana Whitfield", "the policy keeps the name it was stamped with");
    const clm = call("claim-list", CTX, {}).result.claims[0];
    assert.equal(clm.clientId, null);
    assert.equal(clm.claimantName, "Dana Whitfield");
    const again = call("client-delete", CTX, { id: client.id });
    assert.equal(again.ok, false);
    assert.equal(again.error, "client_not_found");
  });

  it("policy-delete removes the policy's certificates with it; certificate-delete is its own exit", () => {
    const { policy } = seedBook();
    const cert = call("certificate-issue", CTX, { policyId: policy.id, certificateHolder: "Holder Co" }).result.certificate;
    assert.equal(call("certificate-list", CTX, {}).result.certificates.length, 1);
    const del = call("policy-delete", CTX, { id: policy.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.certificatesRemoved, 1);
    assert.equal(call("certificate-list", CTX, {}).result.certificates.length, 0,
      "no orphaned certificate survives its policy");

    const p2 = call("policy-add", CTX, { carrier: "Acme Mutual", policyNumber: "POL-200", kind: "home", annualPremium: 800 }).result.policy;
    const cert2 = call("certificate-issue", CTX, { policyId: p2.id, certificateHolder: "Holder Two" }).result.certificate;
    const cd = call("certificate-delete", CTX, { id: cert2.id });
    assert.equal(cd.ok, true);
    assert.equal(call("certificate-list", CTX, {}).result.certificates.length, 0);
    assert.equal(call("policy-list", CTX, {}).result.policies.length, 1, "deleting a certificate leaves its policy standing");
    assert.ok(cert.id !== cert2.id);
  });
});
