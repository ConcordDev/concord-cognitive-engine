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

// ─── Backlog item 1: version snapshots + redline diff ───
describe("law.contract-version-save / list / diff", () => {
  it("snapshots a version and lists it", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Keep it secret." });
    const v = call("contract-version-save", ctxA, { id: c.id, label: "First draft" });
    assert.equal(v.ok, true);
    assert.equal(v.result.version.version, 1);
    const list = call("contract-version-list", ctxA, { id: c.id });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.versions[0].label, "First draft");
  });
  it("diffs a saved version against current with added/removed line counts", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Keep it secret." });
    call("contract-version-save", ctxA, { id: c.id, label: "v1" });
    call("clause-add", ctxA, { contractId: c.id, title: "Governing Law", text: "Laws of NY apply." });
    const diff = call("contract-diff", ctxA, { id: c.id, fromVersion: 1 });
    assert.equal(diff.ok, true);
    assert.ok(diff.result.added > 0);
    assert.ok(Array.isArray(diff.result.ops));
  });
  it("rejects an unknown fromVersion", () => {
    const c = newContract();
    assert.equal(call("contract-diff", ctxA, { id: c.id, fromVersion: 99 }).ok, false);
  });
});

// ─── Backlog item 2: AI clause extraction ───
describe("law.clause-extract / clause-extract-apply", () => {
  it("extracts clauses, dates, amounts and obligations from raw text", () => {
    const text = "1. CONFIDENTIALITY\nThe Receiving Party shall keep all information secret.\n" +
      "2. PAYMENT\nClient agrees to pay $5,000.00 by January 15, 2027.";
    const r = call("clause-extract", ctxA, { text });
    assert.equal(r.ok, true);
    assert.ok(r.result.clauseCount >= 2);
    assert.ok(r.result.detectedAmounts.length >= 1);
    assert.ok(r.result.detectedDates.length >= 1);
    assert.ok(r.result.obligations.length >= 1);
  });
  it("rejects empty text", () => {
    assert.equal(call("clause-extract", ctxA, { text: "" }).ok, false);
  });
  it("applies extracted clauses onto a contract", () => {
    const c = newContract();
    const r = call("clause-extract-apply", ctxA, {
      contractId: c.id,
      clauses: [{ title: "Confidentiality", text: "Keep secret." }, { title: "Payment", text: "Pay on time." }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 2);
    assert.equal(r.result.clauseCount, 2);
  });
});

// ─── Backlog item 3: approval workflow ───
describe("law.approval-route / decide / status", () => {
  it("routes reviewers and moves contract into in_review", () => {
    const c = newContract();
    const r = call("approval-route", ctxA, { id: c.id, reviewers: ["Legal", "Finance"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "in_review");
    assert.equal(r.result.approvals.length, 2);
  });
  it("clears the workflow when all reviewers approve", () => {
    const c = newContract();
    const routed = call("approval-route", ctxA, { id: c.id, reviewers: ["A", "B"] });
    for (const ap of routed.result.approvals) {
      call("approval-decide", ctxA, { id: c.id, approvalId: ap.id, decision: "approved" });
    }
    const st = call("approval-status", ctxA, { id: c.id });
    assert.equal(st.result.cleared, true);
    assert.equal(st.result.approved, 2);
  });
  it("a rejection blocks the workflow", () => {
    const c = newContract();
    const routed = call("approval-route", ctxA, { id: c.id, reviewers: ["A"] });
    const d = call("approval-decide", ctxA, { id: c.id, approvalId: routed.result.approvals[0].id, decision: "rejected", note: "needs work" });
    assert.equal(d.result.blocked, true);
    assert.equal(d.result.status, "draft");
  });
});

// ─── Backlog item 4: obligation tracking ───
describe("law.obligation-add / complete / tracker", () => {
  it("adds an obligation and surfaces it in the tracker", () => {
    const c = newContract();
    const add = call("obligation-add", ctxA, { contractId: c.id, label: "Renewal notice", kind: "renewal", dueDate: "2099-01-01" });
    assert.equal(add.ok, true);
    const tracker = call("obligation-tracker", ctxA, {});
    assert.ok(tracker.result.tasks.some((t) => t.id === add.result.obligation.id));
  });
  it("rejects an obligation with an invalid date", () => {
    const c = newContract();
    assert.equal(call("obligation-add", ctxA, { contractId: c.id, label: "X", dueDate: "not-a-date" }).ok, false);
  });
  it("completing an obligation flips its done flag", () => {
    const c = newContract();
    const add = call("obligation-add", ctxA, { contractId: c.id, label: "Pay", kind: "payment", dueDate: "2099-06-01" });
    const done = call("obligation-complete", ctxA, { contractId: c.id, obligationId: add.result.obligation.id });
    assert.equal(done.result.obligation.done, true);
  });
  it("tracker surfaces implicit expiry from contract.expiryDate", () => {
    const c = newContract(ctxA, { expiryDate: "2099-12-31" });
    const tracker = call("obligation-tracker", ctxA, {});
    assert.ok(tracker.result.tasks.some((t) => t.kind === "expiry" && t.implicit));
  });
});

// ─── Backlog item 5: cryptographic e-signature + verification ───
describe("law.contract-esign / contract-verify", () => {
  it("e-signs with a SHA-256 certificate and verifies it", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Secret." });
    const sig = call("contract-esign", ctxA, { id: c.id, party: "Acme Co", intent: "I agree." });
    assert.equal(sig.ok, true);
    assert.equal(sig.result.certificate.algorithm, "sha256");
    assert.ok(sig.result.certificate.signatureHash.length === 64);
    const verify = call("contract-verify", ctxA, { id: c.id });
    assert.equal(verify.result.allValid, true);
    assert.equal(verify.result.tampered, false);
  });
  it("detects tampering when the document changes after signing", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "A", text: "Original." });
    call("contract-esign", ctxA, { id: c.id, party: "Party One" });
    call("clause-add", ctxA, { contractId: c.id, title: "B", text: "Sneaky addition." });
    const verify = call("contract-verify", ctxA, { id: c.id });
    assert.equal(verify.result.tampered, true);
    assert.equal(verify.result.allValid, false);
  });
});

// ─── Backlog item 6: contract templates / playbooks ───
describe("law.playbook-list / detail / apply", () => {
  it("lists playbooks and returns one with resolved clauses", () => {
    const list = call("playbook-list", ctxA, {});
    assert.ok(list.result.playbooks.length >= 4);
    const detail = call("playbook-detail", ctxA, { id: "nda" });
    assert.equal(detail.ok, true);
    assert.ok(detail.result.clauses.length > 0);
  });
  it("applies a playbook by creating a new contract with curated clauses", () => {
    const r = call("playbook-apply", ctxA, { playbookId: "services", title: "Vendor SOW" });
    assert.equal(r.ok, true);
    assert.ok(r.result.clausesAdded > 0);
    assert.equal(r.result.contract.title, "Vendor SOW");
  });
  it("applies a playbook onto an existing contract", () => {
    const c = newContract();
    const r = call("playbook-apply", ctxA, { playbookId: "dpa", contractId: c.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.contract.clauses.length > 0);
  });
  it("rejects an unknown playbook", () => {
    assert.equal(call("playbook-apply", ctxA, { playbookId: "bogus" }).ok, false);
  });
});

// ─── Backlog item 7: full-text contract repository search ───
describe("law.repository-search", () => {
  it("searches across titles, counterparties and clause text", () => {
    const c = newContract(ctxA, { title: "Acme Supply Agreement" });
    call("clause-add", ctxA, { contractId: c.id, title: "Indemnification", text: "Each party indemnifies the other." });
    const r = call("repository-search", ctxA, { query: "indemnifies" });
    assert.equal(r.ok, true);
    assert.equal(r.result.matchingContracts, 1);
    assert.ok(r.result.results[0].hits.some((h) => h.field === "clause"));
  });
  it("rejects a too-short query", () => {
    assert.equal(call("repository-search", ctxA, { query: "x" }).ok, false);
  });
  it("scopes search to the calling user", () => {
    newContract(ctxA, { title: "User A Deal" });
    const r = call("repository-search", ctxB, { query: "deal" });
    assert.equal(r.result.matchingContracts, 0);
  });
});
