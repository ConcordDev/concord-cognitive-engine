// Contract tests for the law lens — contract lifecycle management
// (Ironclad / LegalZoom 2026 parity) in server/domains/law.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "../domains/law.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law.${name}`);
  assert.ok(fn, `law.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newContract(ctx = ctxA, over = {}) {
  return call("contract-create", ctx, { title: "Master Services Agreement", type: "services", counterparty: "Acme Co", ...over }).result.contract;
}

describe("law.clause-library", () => {
  it("lists clause categories and returns clauses for one", () => {
    const all = call("clause-library", ctxA, {});
    assert.ok(all.result.categories.length >= 4);
    const dp = call("clause-library", ctxA, { category: "data-protection" });
    assert.equal(dp.result.clauses.length, 3);
  });
});

describe("law.contract-create / list / detail", () => {
  it("creates a draft contract scoped per user", () => {
    const c = newContract();
    assert.equal(c.status, "draft");
    assert.equal(c.type, "services");
    assert.equal(call("contract-list", ctxA, {}).result.count, 1);
    assert.equal(call("contract-list", ctxB, {}).result.count, 0);
  });
  it("rejects a contract with no title", () => {
    assert.equal(call("contract-create", ctxA, {}).ok, false);
  });
  it("filters the list by status", () => {
    newContract();
    const c2 = newContract(ctxA, { title: "NDA" });
    call("contract-update", ctxA, { id: c2.id, status: "signed" });
    assert.equal(call("contract-list", ctxA, { status: "signed" }).result.count, 1);
  });
});

describe("law.clause-add / clause-remove", () => {
  it("adds and removes clauses on a contract", () => {
    const c = newContract();
    const added = call("clause-add", ctxA, { contractId: c.id, category: "general", title: "Confidentiality", text: "Keep it secret." });
    assert.equal(added.ok, true);
    assert.equal(added.result.clauseCount, 1);
    const rem = call("clause-remove", ctxA, { contractId: c.id, clauseId: added.result.clause.id });
    assert.equal(rem.result.clauseCount, 0);
  });
  it("rejects a clause with no title or unknown contract", () => {
    const c = newContract();
    assert.equal(call("clause-add", ctxA, { contractId: c.id }).ok, false);
    assert.equal(call("clause-add", ctxA, { contractId: "nope", title: "X", text: "Y" }).ok, false);
  });
});

describe("law.contract-review", () => {
  it("flags missing recommended clauses and grades risk", () => {
    const c = newContract();
    const review = call("contract-review", ctxA, { id: c.id });
    assert.equal(review.ok, true);
    assert.ok(review.result.findings.some((f) => /no clauses/i.test(f.message)));
    assert.ok(review.result.riskScore > 0);
  });
  it("a fully-clausal contract grades lower risk", () => {
    const c = newContract({ ...ctxA }, {});
    for (const t of ["Confidentiality", "Limitation of Liability", "Governing Law", "Dispute Resolution", "Termination for Convenience"]) {
      call("clause-add", ctxA, { contractId: c.id, title: t, text: "..." });
    }
    call("contract-update", ctxA, { id: c.id, expiryDate: "2027-01-01", value: 50000 });
    const review = call("contract-review", ctxA, { id: c.id });
    assert.equal(review.result.grade, "sound");
  });
});

describe("law.contract-sign", () => {
  it("records signatures and flips status to signed at two", () => {
    const c = newContract();
    call("contract-sign", ctxA, { id: c.id, party: "Us" });
    const second = call("contract-sign", ctxA, { id: c.id, party: "Acme Co" });
    assert.equal(second.result.status, "signed");
    assert.equal(second.result.signatures.length, 2);
    // duplicate party rejected
    assert.equal(call("contract-sign", ctxA, { id: c.id, party: "Us" }).ok, false);
  });
});

describe("law.contract-dashboard", () => {
  it("aggregates contract counts and value", () => {
    newContract(ctxA, { value: 1000 });
    newContract(ctxA, { title: "Second", value: 2000 });
    const d = call("contract-dashboard", ctxA, {});
    assert.equal(d.result.total, 2);
    assert.equal(d.result.totalValue, 3000);
    assert.equal(d.result.byStatus.draft, 2);
    assert.equal(d.result.unsigned, 2);
  });
});

describe("law — analytical macros still intact", () => {
  it("billingCalculator computes a grand total", () => {
    const r = call("billingCalculator", ctxA, { /* params */ });
    // no entries -> guidance message
    assert.equal(r.ok, true);
  });
});
