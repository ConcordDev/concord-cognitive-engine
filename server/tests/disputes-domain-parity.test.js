// Contract tests for server/domains/disputes.js — the ODR case-lifecycle
// substrate plus the pure-math AI helpers. Every macro is exercised and
// asserted to return { ok }.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDisputesActions from "../domains/disputes.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`disputes.${name}`);
  if (!fn) throw new Error(`disputes.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerDisputesActions(register); });

beforeEach(() => {
  // Fresh per-user case substrate for every test.
  globalThis._concordSTATE = { disputesLens: { cases: new Map(), seq: new Map() } };
});

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

function openCase(extra = {}) {
  const r = call("case-open", ctx, {}, {
    title: "Item arrived damaged",
    disputeType: "not_as_described",
    disputeAmount: 200,
    description: "The box was crushed.",
    ...extra,
  });
  assert.equal(r.ok, true);
  return r.result.case;
}

/* ---------------------------------------------------------------- */
/*  AI helpers (pure compute)                                        */
/* ---------------------------------------------------------------- */

describe("disputes AI helpers", () => {
  it("assessDispute classifies value tier + recommends methods", () => {
    const r = call("assessDispute", ctx, { data: { parties: ["a", "b"], disputeAmount: 5000, category: "trade" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.valueTier, "low-value");
    assert.ok(Array.isArray(r.result.recommendedMethods));
    assert.ok(r.result.preferredMethod);
  });

  it("timelineTrack sorts + computes daysElapsed", () => {
    const r = call("timelineTrack", ctx, { data: { events: [
      { date: "2026-01-01", description: "opened" },
      { date: "2026-03-01", description: "escalated" },
    ] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
    assert.ok(r.result.daysElapsed > 50);
  });

  it("settlementCalc derives settlement zone", () => {
    const r = call("settlementCalc", ctx, { data: { claimedAmount: 1000, offerAmount: 600, winProbability: 0.7 } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.settlementZone.min <= r.result.settlementZone.max);
  });

  it("evidenceStrength scores + ranks evidence", () => {
    const r = call("evidenceStrength", ctx, { data: { evidence: [
      { name: "receipt", type: "receipt", reliability: 0.9 },
      { name: "chat log", type: "correspondence", reliability: 0.6 },
    ] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPieces, 2);
    assert.ok(["strong", "moderate", "weak"].includes(r.result.caseStrength));
  });
});

/* ---------------------------------------------------------------- */
/*  Case lifecycle                                                   */
/* ---------------------------------------------------------------- */

describe("disputes case lifecycle", () => {
  it("case-open creates a case, case-list returns it with stats", () => {
    openCase();
    const r = call("case-list", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.cases.length, 1);
    assert.equal(r.result.stats.total, 1);
    assert.equal(r.result.stats.open, 1);
  });

  it("case-open rejects missing title", () => {
    const r = call("case-open", ctx, {}, { title: "" });
    assert.equal(r.ok, false);
  });

  it("case-detail returns evidence/messages/offers/history", () => {
    const c = openCase();
    const r = call("case-detail", ctx, {}, { caseId: c.id });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.evidence));
    assert.ok(Array.isArray(r.result.history));
  });

  it("case-advance moves to the next stage", () => {
    const c = openCase();
    const r = call("case-advance", ctx, {}, { caseId: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.case.status, "under_review");
  });
});

/* ---------------------------------------------------------------- */
/*  Evidence                                                         */
/* ---------------------------------------------------------------- */

describe("disputes evidence", () => {
  it("evidence-add attaches an item, evidence-remove removes it", () => {
    const c = openCase();
    const add = call("evidence-add", ctx, {}, { caseId: c.id, label: "Damage photo", kind: "photo", url: "https://x/p.png" });
    assert.equal(add.ok, true);
    assert.equal(add.result.evidence.length, 1);
    const evId = add.result.added.id;
    const rm = call("evidence-remove", ctx, {}, { caseId: c.id, evidenceId: evId });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.evidence.length, 0);
  });

  it("evidence-add rejects an invalid kind", () => {
    const c = openCase();
    const r = call("evidence-add", ctx, {}, { caseId: c.id, label: "X", kind: "telepathy" });
    assert.equal(r.ok, false);
  });
});

/* ---------------------------------------------------------------- */
/*  Messaging                                                        */
/* ---------------------------------------------------------------- */

describe("disputes messaging", () => {
  it("message-post appends, message-list returns thread with byRole", () => {
    const c = openCase();
    assert.equal(call("message-post", ctx, {}, { caseId: c.id, body: "Hello", role: "claimant" }).ok, true);
    assert.equal(call("message-post", ctx, {}, { caseId: c.id, body: "Reply", role: "respondent" }).ok, true);
    const list = call("message-list", ctx, {}, { caseId: c.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 2);
    assert.equal(list.result.byRole.claimant, 1);
  });

  it("message-post rejects an empty body", () => {
    const c = openCase();
    const r = call("message-post", ctx, {}, { caseId: c.id, body: "" });
    assert.equal(r.ok, false);
  });
});

/* ---------------------------------------------------------------- */
/*  Mediator                                                         */
/* ---------------------------------------------------------------- */

describe("disputes mediator workflow", () => {
  it("mediator-assign moves the case to mediation, mediator-unassign clears", () => {
    const c = openCase();
    const a = call("mediator-assign", ctx, {}, { caseId: c.id, mediatorId: "mediator_x", mediatorName: "Neutral X" });
    assert.equal(a.ok, true);
    assert.equal(a.result.case.status, "mediation");
    const u = call("mediator-unassign", ctx, {}, { caseId: c.id });
    assert.equal(u.ok, true);
    assert.equal(u.result.case.mediatorId, null);
  });

  it("mediator-assign rejects a party as mediator", () => {
    const c = openCase();
    const r = call("mediator-assign", ctx, {}, { caseId: c.id, mediatorId: "user_a" });
    assert.equal(r.ok, false);
  });
});

/* ---------------------------------------------------------------- */
/*  Settlement offers                                                */
/* ---------------------------------------------------------------- */

describe("disputes settlement offers", () => {
  it("offer-make + offer-respond(accept) resolves the case", () => {
    const c = openCase();
    const made = call("offer-make", ctx, {}, { caseId: c.id, amount: 150, fromRole: "respondent", terms: "partial" });
    assert.equal(made.ok, true);
    const offerId = made.result.made.id;
    const resp = call("offer-respond", ctx, {}, { caseId: c.id, offerId, decision: "accept" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.case.status, "resolved");
  });

  it("offer-make supersedes a prior pending offer", () => {
    const c = openCase();
    const first = call("offer-make", ctx, {}, { caseId: c.id, amount: 100, fromRole: "respondent" });
    call("offer-make", ctx, {}, { caseId: c.id, amount: 130, fromRole: "claimant" });
    const detail = call("case-detail", ctx, {}, { caseId: c.id });
    const firstOffer = detail.result.offers.find((o) => o.id === first.result.made.id);
    assert.equal(firstOffer.status, "superseded");
  });

  it("offer-respond rejects an unknown decision", () => {
    const c = openCase();
    const made = call("offer-make", ctx, {}, { caseId: c.id, amount: 50, fromRole: "respondent" });
    const r = call("offer-respond", ctx, {}, { caseId: c.id, offerId: made.result.made.id, decision: "maybe" });
    assert.equal(r.ok, false);
  });
});

/* ---------------------------------------------------------------- */
/*  SLA timers                                                       */
/* ---------------------------------------------------------------- */

describe("disputes SLA timers", () => {
  it("sla-check auto-escalates a case past its deadline", () => {
    const c = openCase();
    // Force the deadline into the past.
    const stored = globalThis._concordSTATE.disputesLens.cases.get("user_a")[0];
    stored.slaDeadline = new Date(Date.now() - 3600000).toISOString();
    const r = call("sla-check", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.escalatedCount, 1);
    assert.equal(r.result.escalated[0].caseId, c.id);
  });

  it("sla-check reports clean when nothing is breached", () => {
    openCase();
    const r = call("sla-check", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.escalatedCount, 0);
  });
});

/* ---------------------------------------------------------------- */
/*  Resolution + archive                                             */
/* ---------------------------------------------------------------- */

describe("disputes resolution + archive", () => {
  it("case-resolve records an outcome and closes the case", () => {
    const c = openCase();
    const r = call("case-resolve", ctx, {}, { caseId: c.id, outcomeType: "partial_refund", refundPercent: 50, rationale: "split fault" });
    assert.equal(r.ok, true);
    assert.equal(r.result.case.status, "resolved");
    assert.equal(r.result.outcome.refundAmount, 100);
  });

  it("archive-search returns closed cases with analytics", () => {
    const c = openCase();
    call("case-resolve", ctx, {}, { caseId: c.id, outcomeType: "full_refund" });
    const r = call("archive-search", ctx, {}, { query: "damaged" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
    assert.equal(r.result.totalRefunded, 200);
    assert.ok(r.result.outcomeBreakdown.full_refund >= 1);
  });

  it("archive-search filters by outcomeType", () => {
    const c1 = openCase();
    const c2 = openCase({ title: "Second case" });
    call("case-resolve", ctx, {}, { caseId: c1.id, outcomeType: "full_refund" });
    call("case-resolve", ctx, {}, { caseId: c2.id, outcomeType: "no_refund" });
    const r = call("archive-search", ctx, {}, { outcomeType: "no_refund" });
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
  });
});

/* ---------------------------------------------------------------- */
/*  Escrow                                                           */
/* ---------------------------------------------------------------- */

describe("disputes escrow", () => {
  it("escrow-freeze holds funds, escrow-release frees them", () => {
    const c = openCase();
    const f = call("escrow-freeze", ctx, {}, { caseId: c.id, amount: 200 });
    assert.equal(f.ok, true);
    assert.equal(f.result.case.escrowFrozen, true);
    const rel = call("escrow-release", ctx, {}, { caseId: c.id, releaseTo: "claimant" });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.released, 200);
  });

  it("escrow-freeze rejects a double freeze", () => {
    const c = openCase();
    call("escrow-freeze", ctx, {}, { caseId: c.id, amount: 100 });
    const r = call("escrow-freeze", ctx, {}, { caseId: c.id, amount: 100 });
    assert.equal(r.ok, false);
  });

  it("escrow-status aggregates active holds", () => {
    const c = openCase();
    call("escrow-freeze", ctx, {}, { caseId: c.id, amount: 200 });
    const r = call("escrow-status", ctx, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.activeHolds, 1);
    assert.equal(r.result.totalHeld, 200);
  });
});
