// Highs with a local root cause: growth bounds, invoice client, patient
// registration, claim deductible, campaign gifts, and pact beneficiaries.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerParenting from "../domains/parenting.js";
import registerPlumbing from "../domains/plumbing.js";
import registerHealth from "../domains/healthcare.js";
import registerInsurance from "../domains/insurance.js";
import registerNonprofit from "../domains/nonprofit.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const ctx = { actor: { userId: "owner" }, userId: "owner" };

before(() => {
  registerParenting(register);
  registerPlumbing(register);
  registerHealth(register);
  registerInsurance(register);
  registerNonprofit(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("remaining highs", () => {
  it("refuses a growth weight of a trillion kilograms", () => {
    const child = call("parenting", "child-add", ctx, { name: "Ada", birthDate: "2020-01-01" }).result.child;
    const bad = call("parenting", "growth-log", ctx, { childId: child.id, weightKg: 999999999999 });
    assert.equal(bad.ok, false);
    assert.equal(call("parenting", "growth-history", ctx, { childId: child.id }).result.count, 0);
    assert.equal(call("parenting", "growth-log", ctx, { childId: child.id, weightKg: 12.4 }).ok, true);
  });

  it("refuses a plumbing invoice with no client", () => {
    const bare = call("plumbing", "invoiceFromQuote", ctx, { lines: [{ name: "Trap", quantity: 1, unitPrice: 25 }] });
    assert.equal(bare.ok, false);
    assert.equal(bare.error, "client required");
    const made = call("plumbing", "invoiceFromQuote", ctx, {
      client: "Ada", lines: [{ name: "Trap", quantity: 1, unitPrice: 25 }],
    });
    assert.equal(made.ok, true);
    assert.equal(made.result.invoice.client, "Ada");
  });

  it("refuses a future date of birth and a 600-character last name", () => {
    assert.equal(call("healthcare", "patients-create", ctx, { firstName: "A", lastName: "B", dob: "2030-01-01" }).ok, false);
    assert.equal(call("healthcare", "patients-create", ctx, { firstName: "A", lastName: "x".repeat(600) }).ok, false);
    assert.equal(call("healthcare", "patients-create", ctx, { firstName: "", lastName: "" }).ok, false);
    const ok = call("healthcare", "patients-create", ctx, { firstName: "Ada", lastName: "Lovelace", dob: "1990-01-01" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.patient.dob, "1990-01-01");
  });

  it("pays a claim net of the policy deductible", () => {
    const policy = call("insurance", "policy-add", ctx, {
      carrier: "QA", policyNumber: "P-1", deductible: 500, annualPremium: 100,
    }).result.policy;
    const claim = call("insurance", "claim-file", ctx, {
      carrier: "QA", description: "Storm", claimAmount: 2000, policyId: policy.id,
    }).result.claim;
    const paid = call("insurance", "claim-update", ctx, { id: claim.id, status: "paid" });
    assert.equal(paid.ok, true);
    assert.equal(paid.result.claim.payoutAmount, 1500);
  });

  it("counts a donor gift toward the named campaign", () => {
    const campaign = call("nonprofit", "campaign-create", ctx, { name: "Roof", goal: 1000 }).result.campaign;
    const donor = call("nonprofit", "donor-create", ctx, { name: "Ada" }).result.donor;
    assert.equal(call("nonprofit", "donor-gift-log", ctx, { donorId: donor.id, amount: 40, campaign: campaign.name }).ok, true);
    const listed = call("nonprofit", "campaign-list", ctx, {}).result.campaigns[0];
    assert.equal(listed.raised, 40);
    assert.equal(listed.donorCount, 1);
  });

  it("refuses a pact beneficiary who is not a user when a user table is present", () => {
    const db = {
      prepare() {
        return { get(id) { return id === "real-user" ? { id } : undefined; } };
      },
    };
    const withDb = { ...ctx, db };
    const missing = call("insurance", "pact-write", withDb, {
      beneficiaryUserId: "nobody", payoutSparks: 100, premiumSparks: 10, requireHandshake: false,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "beneficiary_unresolved");
    const ok = call("insurance", "pact-write", withDb, {
      beneficiaryUserId: "real-user", payoutSparks: 100, premiumSparks: 10, requireHandshake: false,
    });
    assert.equal(ok.ok, true);
  });
});
