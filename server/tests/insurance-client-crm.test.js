// server/tests/insurance-client-crm.test.js
//
// Behavioral contract for the persisted Client/CRM entity (Wave 4 gap
// closure — docs/lens-specs/insurance-capability-map.md's "Client/CRM
// record management" item). Mirrors the hermetic no-server-boot harness
// already used by insurance-domain-parity.test.js: import the real domain
// registrar directly and call handlers as (ctx, params) — exactly how
// runMacro / POST /api/lens/run dispatch a register()-path macro. No DB,
// no network — globalThis._concordSTATE is a plain in-memory object, so no
// DB_PATH isolation is required for this file.
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

const ctxA = { actor: { userId: "crm_user_a" }, userId: "crm_user_a" };
const ctxB = { actor: { userId: "crm_user_b" }, userId: "crm_user_b" };

describe("insurance.client-add / client-list — CRM round-trip", () => {
  it("adds a client with the full CRM field set and lists it back", () => {
    const r = call("client-add", ctxA, {
      name: "Dana Whitfield",
      phone: "555-0142",
      email: "dana@example.com",
      address: "88 Concord Ave",
      dob: "1985-04-12",
      riskProfile: "elevated",
      referralSource: "Google Ads",
      notes: "Prefers email contact",
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.client.id);
    assert.equal(r.result.client.name, "Dana Whitfield");
    assert.equal(r.result.client.phone, "555-0142");
    assert.equal(r.result.client.email, "dana@example.com");
    assert.equal(r.result.client.address, "88 Concord Ave");
    assert.equal(r.result.client.dob, "1985-04-12");
    assert.equal(r.result.client.riskProfile, "elevated");
    assert.equal(r.result.client.referralSource, "Google Ads");
    assert.equal(r.result.client.notes, "Prefers email contact");
    assert.ok(r.result.client.createdAt);

    const list = call("client-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.clients[0].name, "Dana Whitfield");
    // freshly-added client has no linked documents yet
    assert.equal(list.result.clients[0].policyCount, 0);
    assert.equal(list.result.clients[0].claimCount, 0);
  });

  it("defaults riskProfile to 'standard' for an invalid/omitted value", () => {
    const r = call("client-add", ctxA, { name: "No Risk Given" });
    assert.equal(r.ok, true);
    assert.equal(r.result.client.riskProfile, "standard");
    const bad = call("client-add", ctxA, { name: "Bad Risk", riskProfile: "extreme_bogus" });
    assert.equal(bad.result.client.riskProfile, "standard");
  });

  it("rejects a missing name", () => {
    const r = call("client-add", ctxA, { phone: "555-0000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });

  it("client-list filters by a case-insensitive substring query", () => {
    call("client-add", ctxA, { name: "Acme Holdings" });
    call("client-add", ctxA, { name: "Union Station HOA" });
    const r = call("client-list", ctxA, { query: "acme" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.clients[0].name, "Acme Holdings");
  });

  it("clients are scoped per user", () => {
    call("client-add", ctxA, { name: "A's Client" });
    call("client-add", ctxB, { name: "B's Client 1" });
    call("client-add", ctxB, { name: "B's Client 2" });
    assert.equal(call("client-list", ctxA, {}).result.count, 1);
    assert.equal(call("client-list", ctxB, {}).result.count, 2);
  });
});

describe("insurance.policy-add — optional clientId resolution", () => {
  it("resolves a saved client's name onto the policy as insuredName + clientId", () => {
    const c = call("client-add", ctxA, { name: "Priya Nair", phone: "555-1010" });
    const clientId = c.result.client.id;
    const r = call("policy-add", ctxA, {
      carrier: "Geico", policyNumber: "AUTO-1", kind: "auto",
      annualPremium: 1200, deductible: 500, clientId,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.policy.clientId, clientId);
    assert.equal(r.result.policy.insuredName, "Priya Nair");
  });

  it("rejects an unknown clientId with a real reason", () => {
    const r = call("policy-add", ctxA, {
      carrier: "Geico", policyNumber: "AUTO-2", kind: "auto", clientId: "cli_does_not_exist",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "client_not_found");
  });

  it("REGRESSION: omitting clientId leaves every pre-existing field byte-identical", () => {
    const r = call("policy-add", ctxA, {
      carrier: "State Farm", policyNumber: "HOME-1", kind: "home",
      annualPremium: 900, deductible: 1000, liabilityLimit: 300000,
      effectiveDate: "2026-01-01", renewalDate: "2027-01-01",
    });
    assert.equal(r.ok, true);
    const p = r.result.policy;
    assert.equal(p.carrier, "State Farm");
    assert.equal(p.policyNumber, "HOME-1");
    assert.equal(p.kind, "home");
    assert.equal(p.annualPremium, 900);
    assert.equal(p.deductible, 1000);
    assert.equal(p.liabilityLimit, 300000);
    assert.equal(p.effectiveDate, "2026-01-01");
    assert.equal(p.renewalDate, "2027-01-01");
    assert.equal(p.status, "active");
    assert.equal(p.documents, 0);
    assert.ok(p.id);
    assert.ok(p.createdAt);
    // additive-only fields: present, but null/unset — no pre-existing
    // behavior was ever driven by them, so their presence is not a
    // behavior change.
    assert.equal(p.clientId, null);
    assert.equal(p.insuredName, null);
  });

  it("optional free-text insuredName still works when no clientId is given", () => {
    const r = call("policy-add", ctxA, {
      carrier: "Progressive", policyNumber: "AUTO-3", kind: "auto", insuredName: "Walk-in prospect",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.policy.clientId, null);
    assert.equal(r.result.policy.insuredName, "Walk-in prospect");
  });
});

describe("insurance.claim-file — optional clientId resolution", () => {
  it("stamps clientId onto the claim when resolved", () => {
    const c = call("client-add", ctxA, { name: "Marcus Webb" });
    const clientId = c.result.client.id;
    const r = call("claim-file", ctxA, {
      carrier: "Geico", description: "Windshield crack", claimAmount: 300, clientId,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.clientId, clientId);
  });

  it("rejects an unknown clientId with a real reason", () => {
    const r = call("claim-file", ctxA, {
      carrier: "Geico", description: "Fender bender", clientId: "cli_ghost",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "client_not_found");
  });

  it("REGRESSION: omitting clientId leaves every pre-existing field byte-identical", () => {
    const r = call("claim-file", ctxA, {
      carrier: "Allstate", description: "Rear-ended in parking lot",
      claimAmount: 4500, kind: "collision", incidentDate: "2026-06-01",
    });
    assert.equal(r.ok, true);
    const c = r.result.claim;
    assert.equal(c.carrier, "Allstate");
    assert.equal(c.description, "Rear-ended in parking lot");
    assert.equal(c.claimAmount, 4500);
    assert.equal(c.kind, "collision");
    assert.equal(c.incidentDate, "2026-06-01");
    assert.equal(c.status, "submitted");
    assert.equal(c.documents, 0);
    assert.ok(c.id);
    assert.ok(c.submittedDate);
    assert.equal(c.clientId, null);
  });
});

describe("insurance.certificate-issue — optional clientId resolution", () => {
  function seedPolicy(ctx) {
    const p = call("policy-add", ctx, {
      carrier: "Hartford", policyNumber: "GL-1", kind: "business",
      annualPremium: 2400, deductible: 1000, liabilityLimit: 1000000,
    });
    return p.result.policy.id;
  }

  it("defaults certificateHolder/insured from the resolved client when not explicitly given", () => {
    const policyId = seedPolicy(ctxA);
    const c = call("client-add", ctxA, { name: "Riverside Property Mgmt" });
    const r = call("certificate-issue", ctxA, { policyId, clientId: c.result.client.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.certificate.certificateHolder, "Riverside Property Mgmt");
    assert.equal(r.result.certificate.insured, "Riverside Property Mgmt");
    assert.equal(r.result.certificate.clientId, c.result.client.id);
  });

  it("explicit certificateHolder/insuredName still win over the resolved client", () => {
    const policyId = seedPolicy(ctxA);
    const c = call("client-add", ctxA, { name: "Should Not Appear LLC" });
    const r = call("certificate-issue", ctxA, {
      policyId, clientId: c.result.client.id,
      certificateHolder: "Explicit Holder Inc", insuredName: "Explicit Insured",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.certificate.certificateHolder, "Explicit Holder Inc");
    assert.equal(r.result.certificate.insured, "Explicit Insured");
  });

  it("rejects an unknown clientId with a real reason", () => {
    const policyId = seedPolicy(ctxA);
    const r = call("certificate-issue", ctxA, { policyId, clientId: "cli_ghost", certificateHolder: "X" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "client_not_found");
  });

  it("REGRESSION: omitting clientId requires certificateHolder exactly as before, byte-identical fields", () => {
    const policyId = seedPolicy(ctxA);
    const missing = call("certificate-issue", ctxA, { policyId });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "certificateHolder required");

    const r = call("certificate-issue", ctxA, {
      policyId, certificateHolder: "ACME Landlord LLC", insuredName: "Hartford Insured",
      description: "GL coverage for leased premises",
    });
    assert.equal(r.ok, true);
    const cert = r.result.certificate;
    assert.equal(cert.certificateHolder, "ACME Landlord LLC");
    assert.equal(cert.insured, "Hartford Insured");
    assert.equal(cert.description, "GL coverage for leased premises");
    assert.equal(cert.formType, "ACORD_25");
    assert.equal(cert.policyId, policyId);
    assert.equal(cert.revoked, false);
    assert.equal(cert.clientId, null);
  });
});

describe("insurance.client-list — cross-document aggregation (linked policies/claims)", () => {
  it("aggregates real policyCount/activePolicyCount/claimCount/totalAnnualPremium joined on clientId", () => {
    const c = call("client-add", ctxA, { name: "Book Test Client" });
    const clientId = c.result.client.id;

    call("policy-add", ctxA, { carrier: "Geico", policyNumber: "P1", kind: "auto", annualPremium: 1200, clientId });
    call("policy-add", ctxA, { carrier: "Geico", policyNumber: "P2", kind: "home", annualPremium: 800, clientId });
    // a policy for a DIFFERENT client must not be counted
    const other = call("client-add", ctxA, { name: "Other Client" });
    call("policy-add", ctxA, { carrier: "Geico", policyNumber: "P3", kind: "auto", annualPremium: 500, clientId: other.result.client.id });
    // a policy with no clientId at all must not be counted
    call("policy-add", ctxA, { carrier: "Geico", policyNumber: "P4", kind: "auto", annualPremium: 999 });

    call("claim-file", ctxA, { carrier: "Geico", description: "Claim 1", claimAmount: 300, clientId });

    const list = call("client-list", ctxA, { query: "book test" });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const row = list.result.clients[0];
    assert.equal(row.policyCount, 2);
    assert.equal(row.activePolicyCount, 2); // policy-add always creates status:"active"
    assert.equal(row.claimCount, 1);
    assert.equal(row.totalAnnualPremium, 2000); // 1200 + 800
  });

  it("lapsed/cancelled policies are excluded from activePolicyCount and totalAnnualPremium", () => {
    const c = call("client-add", ctxA, { name: "Lapse Test Client" });
    const clientId = c.result.client.id;
    const p1 = call("policy-add", ctxA, { carrier: "Geico", policyNumber: "L1", kind: "auto", annualPremium: 1000, clientId });
    call("policy-add", ctxA, { carrier: "Geico", policyNumber: "L2", kind: "auto", annualPremium: 700, clientId });
    call("policy-update", ctxA, { id: p1.result.policy.id, status: "lapsed" });

    const list = call("client-list", ctxA, { query: "lapse test" });
    const row = list.result.clients[0];
    assert.equal(row.policyCount, 2);
    assert.equal(row.activePolicyCount, 1);
    assert.equal(row.totalAnnualPremium, 700);
  });
});
