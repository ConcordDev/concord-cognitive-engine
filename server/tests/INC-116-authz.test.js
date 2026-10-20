// INC-116: a party cannot unilaterally close a two-party dispute.
// Closing outcomes are mediator/admin, or the claimant withdrawing their
// own claim. An offer is accepted only by the other party. case-advance
// cannot jump to a terminal status. Evidence URLs are http(s) only.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDisputesActions from "../domains/disputes.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`disputes.${name} not registered`);
  return fn(ctx, { id: null, domain: "disputes", type: "domain_action", data: input, meta: {} }, input);
}
before(() => { registerDisputesActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const A = { actor: { userId: "user_a", displayName: "Acct A" }, userId: "user_a" };
const B = { actor: { userId: "user_b", displayName: "Acct B" }, userId: "user_b" };
const MED = { actor: { userId: "user_c", displayName: "Med" }, userId: "user_c" };
const ADMIN = { actor: { userId: "user_admin", role: "admin", displayName: "Admin" }, userId: "user_admin" };

function openCase() {
  const r = call("case-open", A, {
    title: "Item arrived damaged",
    disputeType: "not_as_described",
    disputeAmount: 200,
    description: "The box was crushed.",
    respondentId: "user_b",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.case.id;
}

function stored(caseId) {
  return globalThis._concordSTATE.disputesLens.casesById.get(caseId);
}

describe("INC-116 dispute close authority", () => {
  it("respondent cannot dismiss with no_refund", () => {
    const id = openCase();
    const r = call("case-resolve", B, { caseId: id, outcomeType: "no_refund" });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /mediator or admin/i);
    assert.equal(stored(id).status, "open");
    assert.equal(stored(id).outcome, null);
  });

  it("claimant cannot rule a refund; claimant may withdraw as dismissed", () => {
    const id = openCase();
    const refund = call("case-resolve", A, { caseId: id, outcomeType: "full_refund" });
    assert.equal(refund.ok, false);
    assert.equal(stored(id).status, "open");
    const withdraw = call("case-resolve", A, { caseId: id, outcomeType: "dismissed" });
    assert.equal(withdraw.ok, true, JSON.stringify(withdraw));
    assert.equal(withdraw.result.case.status, "dismissed");
    assert.equal(withdraw.result.outcome.resolvedRole, "member");
    assert.equal(stored(id).status, "dismissed");
  });

  it("mediator and admin can resolve", () => {
    const mediated = openCase();
    assert.equal(call("mediator-assign", A, { caseId: mediated, mediatorId: "user_c" }).ok, true);
    const byMed = call("case-resolve", MED, { caseId: mediated, outcomeType: "partial_refund", refundPercent: 50 });
    assert.equal(byMed.ok, true, JSON.stringify(byMed));
    assert.equal(byMed.result.outcome.resolvedRole, "mediator");
    assert.equal(byMed.result.case.status, "resolved");
    assert.equal(byMed.result.outcome.refundAmount, 100);

    const ruled = openCase();
    const byAdmin = call("case-resolve", ADMIN, { caseId: ruled, outcomeType: "no_refund" });
    assert.equal(byAdmin.ok, true, JSON.stringify(byAdmin));
    assert.equal(byAdmin.result.outcome.resolvedRole, "admin");
    assert.equal(stored(ruled).status, "dismissed");
  });

  it("claimant cannot accept their own offer; the other party can", () => {
    const id = openCase();
    const made = call("offer-make", A, { caseId: id, amount: 40, terms: "half" });
    assert.equal(made.ok, true);
    const offerId = made.result.made.id;
    const self = call("offer-respond", A, { caseId: id, offerId, decision: "accept" });
    assert.equal(self.ok, false);
    assert.match(String(self.error), /own offer/i);
    assert.equal(stored(id).status, "open");
    const other = call("offer-respond", B, { caseId: id, offerId, decision: "accept" });
    assert.equal(other.ok, true, JSON.stringify(other));
    assert.equal(other.result.case.status, "resolved");
    assert.equal(stored(id).outcome.type, "negotiated_settlement");
  });

  it("case-advance cannot reach resolved or dismissed", () => {
    const id = openCase();
    const resolved = call("case-advance", A, { caseId: id, toStatus: "resolved" });
    assert.equal(resolved.ok, false);
    assert.match(String(resolved.error), /resolved or dismissed/i);
    const dismissed = call("case-advance", B, { caseId: id, toStatus: "dismissed" });
    assert.equal(dismissed.ok, false);
    assert.equal(stored(id).status, "open");
    const next = call("case-advance", A, { caseId: id });
    assert.equal(next.ok, true);
    assert.equal(next.result.case.status, "under_review");
  });

  it("evidence urls are http(s) only and length-capped", () => {
    const id = openCase();
    const js = call("evidence-add", A, { caseId: id, label: "xss", url: "javascript:alert(1)" });
    assert.equal(js.ok, false);
    assert.match(String(js.error), /http or https/i);
    const padded = call("evidence-add", A, { caseId: id, label: "xss2", url: "  JAVASCRIPT:alert(1)" });
    assert.equal(padded.ok, false);
    const data = call("evidence-add", A, { caseId: id, label: "data", url: "data:text/html,hi" });
    assert.equal(data.ok, false);
    const long = call("evidence-add", A, { caseId: id, label: "long", url: `https://example.com/${"a".repeat(2048)}` });
    assert.equal(long.ok, false);
    assert.match(String(long.error), /max 2048/);
    assert.equal(stored(id).evidence.length, 0);
    const ok = call("evidence-add", A, { caseId: id, label: "photo", url: "https://example.com/a.png" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.added.url, "https://example.com/a.png");
    const bare = call("evidence-add", A, { caseId: id, label: "note only" });
    assert.equal(bare.ok, true);
    assert.equal(bare.result.added.url, null);
  });
});
