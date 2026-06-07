// tests/depth/disputes-behavior.test.js — REAL behavioral tests for the
// disputes domain (online dispute resolution / arbitration). lensRun family:
// `registerLensAction("disputes", …)`. Calc macros assert exact computed values;
// lifecycle macros round-trip through the per-user case substrate; validation
// macros assert rejection shape (`r.result.ok === false` + error match).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("disputes — AI calc contracts (pure compute)", () => {
  it("assessDispute: tiers by value, flags multi-party, picks Arbitration on high amount", async () => {
    const r = await lensRun("disputes", "assessDispute", { data: { parties: ["a", "b", "c"], disputeAmount: 60000, category: "Quality" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.parties, 3);
    assert.equal(r.result.complexity, "multi-party");      // >2 parties
    assert.equal(r.result.valueTier, "medium-value");      // 10k < 60k <= 100k
    assert.equal(r.result.disputeAmount, 60000);
    assert.equal(r.result.category, "quality");            // lowercased
    assert.equal(r.result.preferredMethod, "Arbitration"); // >= 50000
  });

  it("settlementCalc: expectedValue = claimed × winProb, settlement zone derived", async () => {
    const r = await lensRun("disputes", "settlementCalc", { data: { claimedAmount: 10000, offerAmount: 5000, legalCosts: 2000, winProbability: 0.6 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.expectedValue, 6000);            // 10000 × 0.6
    assert.equal(r.result.netAfterCosts, 4000);            // 6000 − 2000
    assert.equal(r.result.winProbability, 60);             // pct
    assert.equal(r.result.settlementZone.min, 3600);       // 6000 × 0.6
    assert.equal(r.result.settlementZone.midpoint, 5100);  // 6000 × 0.85
    assert.match(r.result.recommendation, /within settlement zone/i); // 5000 >= 3600
  });

  it("evidenceStrength: weight × reliability score, sorted strongest-first", async () => {
    const r = await lensRun("disputes", "evidenceStrength", { data: { evidence: [
      { name: "Email thread", type: "correspondence", reliability: 0.8 }, // 2 × 0.8 = 1.6
      { name: "Expert report", type: "expert", reliability: 1.0 },        // 3.5 × 1.0 = 3.5
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPieces, 2);
    assert.equal(r.result.evidence[0].score, 3.5);          // strongest first
    assert.equal(r.result.strongestEvidence, "Expert report");
    assert.equal(r.result.avgStrength, 2.55);               // (3.5 + 1.6) / 2
    assert.equal(r.result.caseStrength, "strong");          // avg > 2
  });

  it("timelineTrack: sorts events, computes elapsed days + status", async () => {
    const r = await lensRun("disputes", "timelineTrack", { data: { events: [
      { date: "2026-01-10", description: "Filed" },
      { date: "2026-01-01", description: "Purchase" },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalEvents, 2);
    assert.equal(r.result.daysElapsed, 9);                  // Jan 1 → Jan 10
    assert.equal(r.result.events[0].event, "Purchase");     // earliest first
    assert.equal(r.result.status, "active");                // <= 90 days
  });
});

describe("disputes — case lifecycle round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("disputes-life"); });

  it("case-open → case-list: case reads back with status open + auto caseNumber", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Item not as described", disputeType: "not_as_described", disputeAmount: 250 } }, ctx);
    assert.equal(open.ok, true);
    assert.equal(open.result.case.status, "open");
    assert.equal(open.result.case.dispute_type, "not_as_described");
    assert.equal(open.result.case.disputeAmount, 250);
    const id = open.result.case.id;
    const list = await lensRun("disputes", "case-list", { params: {} }, ctx);
    assert.ok((list.result.cases || []).some((c) => c.id === id), "case listed");
    assert.ok(list.result.stats.total >= 1 && list.result.stats.open >= 1, "stats count it");
  });

  it("case-open rejects an invalid disputeType (validation)", async () => {
    const bad = await lensRun("disputes", "case-open", { params: { title: "X", disputeType: "nonsense" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /invalid disputeType/i);
  });

  it("case-advance: open → under_review, then explicit toStatus", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Late delivery", disputeType: "non_delivery" } }, ctx);
    const caseId = open.result.case.id;
    const adv = await lensRun("disputes", "case-advance", { params: { caseId } }, ctx);
    assert.equal(adv.ok, true);
    assert.equal(adv.result.case.status, "under_review");   // next in STATUS_FLOW
    const esc = await lensRun("disputes", "case-advance", { params: { caseId, toStatus: "escalated" } }, ctx);
    assert.equal(esc.result.case.status, "escalated");
  });

  it("evidence-add → case-detail: evidence attaches and reads back", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Quality issue", disputeType: "quality" } }, ctx);
    const caseId = open.result.case.id;
    const add = await lensRun("disputes", "evidence-add", { params: { caseId, label: "Defect photo", kind: "photo", reliability: 0.9 } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.added.label, "Defect photo");
    assert.equal(add.result.added.kind, "photo");
    const detail = await lensRun("disputes", "case-detail", { params: { caseId } }, ctx);
    assert.ok((detail.result.evidence || []).some((e) => e.label === "Defect photo"), "evidence in detail");

    const badKind = await lensRun("disputes", "evidence-add", { params: { caseId, label: "X", kind: "telepathy" } }, ctx);
    assert.equal(badKind.result.ok, false);
    assert.match(String(badKind.result.error), /invalid evidence kind/i);
  });

  it("message-post → message-list: message threads with role tallies", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Refund chat", disputeType: "other" } }, ctx);
    const caseId = open.result.case.id;
    const post = await lensRun("disputes", "message-post", { params: { caseId, body: "Please refund me", role: "claimant" } }, ctx);
    assert.equal(post.ok, true);
    assert.equal(post.result.posted.body, "Please refund me");
    const ml = await lensRun("disputes", "message-list", { params: { caseId } }, ctx);
    assert.equal(ml.result.total, 1);
    assert.equal(ml.result.byRole.claimant, 1);
  });
});

describe("disputes — mediation / offers / escrow / resolution", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("disputes-resolve"); });

  it("mediator-assign rejects a party as mediator (must be neutral)", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Mediate me", disputeType: "quality", respondentId: "seller-9" } }, ctx);
    const caseId = open.result.case.id;
    // claimant is the actor (the depthCtx user); assigning them is non-neutral
    const claimantId = open.result.case.claimantId;
    const bad = await lensRun("disputes", "mediator-assign", { params: { caseId, mediatorId: claimantId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /neutral third party/i);
    const good = await lensRun("disputes", "mediator-assign", { params: { caseId, mediatorId: "mediator-7", mediatorName: "Pat" } }, ctx);
    assert.equal(good.ok, true);
    assert.equal(good.result.mediatorId, "mediator-7");
    assert.equal(good.result.case.status, "mediation");     // assignment moves to mediation
  });

  it("offer-make → offer-respond(accept): accepting an offer resolves the case", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Settle this", disputeType: "non_delivery", disputeAmount: 400 } }, ctx);
    const caseId = open.result.case.id;
    const mk = await lensRun("disputes", "offer-make", { params: { caseId, amount: 300, fromRole: "respondent", terms: "partial" } }, ctx);
    assert.equal(mk.ok, true);
    assert.equal(mk.result.made.amount, 300);
    const offerId = mk.result.made.id;
    const resp = await lensRun("disputes", "offer-respond", { params: { caseId, offerId, decision: "accept" } }, ctx);
    assert.equal(resp.ok, true);
    assert.equal(resp.result.case.status, "resolved");      // accepting settles
    const detail = await lensRun("disputes", "case-detail", { params: { caseId } }, ctx);
    assert.equal(detail.result.case.outcome.settlementAmount, 300);
  });

  it("offer-respond rejects an invalid decision (validation)", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Bad decide", disputeType: "other" } }, ctx);
    const caseId = open.result.case.id;
    const mk = await lensRun("disputes", "offer-make", { params: { caseId, amount: 50 } }, ctx);
    const bad = await lensRun("disputes", "offer-respond", { params: { caseId, offerId: mk.result.made.id, decision: "maybe" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /accept or reject/i);
  });

  it("escrow-freeze → escrow-status → escrow-release: full escrow round-trip", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Hold funds", disputeType: "fraudulent_listing", disputeAmount: 1000 } }, ctx);
    const caseId = open.result.case.id;
    const freeze = await lensRun("disputes", "escrow-freeze", { params: { caseId, amount: 750 } }, ctx);
    assert.equal(freeze.ok, true);
    assert.equal(freeze.result.escrowAmount, 750);
    assert.equal(freeze.result.case.escrowFrozen, true);
    const status = await lensRun("disputes", "escrow-status", { params: {} }, ctx);
    assert.ok(status.result.holds.some((h) => h.caseId === caseId && h.amount === 750), "hold listed");
    const release = await lensRun("disputes", "escrow-release", { params: { caseId, releaseTo: "claimant" } }, ctx);
    assert.equal(release.ok, true);
    assert.equal(release.result.released, 750);
    assert.equal(release.result.case.escrowFrozen, false);
  });

  it("case-resolve(partial_refund) → archive-search: refund computed and archived", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Partial outcome", disputeType: "quality", disputeAmount: 200 } }, ctx);
    const caseId = open.result.case.id;
    const res = await lensRun("disputes", "case-resolve", { params: { caseId, outcomeType: "partial_refund", refundPercent: 25, rationale: "minor defect" } }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.case.status, "resolved");
    assert.equal(res.result.outcome.refundAmount, 50);      // 200 × 25%
    const arch = await lensRun("disputes", "archive-search", { params: { query: "partial" } }, ctx);
    assert.ok(arch.result.cases.some((c) => c.id === caseId), "resolved case archived");
    assert.equal(arch.result.outcomeBreakdown.partial_refund >= 1, true);
  });

  it("sla-check: auto-escalates a case whose SLA deadline is in the past", async () => {
    const open = await lensRun("disputes", "case-open", { params: { title: "Stalled", disputeType: "other" } }, ctx);
    const caseId = open.result.case.id;
    // force the SLA deadline into the past by reaching into STATE
    const { STATE } = await import("../../server.js").then((m) => m.__TEST__);
    const list = STATE.disputesLens.cases.get(ctx.actor.userId) || [];
    const target = list.find((c) => c.id === caseId);
    target.slaDeadline = new Date(Date.now() - 3600000).toISOString();
    const check = await lensRun("disputes", "sla-check", { params: {} }, ctx);
    assert.equal(check.ok, true);
    assert.ok(check.result.escalated.some((e) => e.caseId === caseId), "stalled case escalated");
    const detail = await lensRun("disputes", "case-detail", { params: { caseId } }, ctx);
    assert.equal(detail.result.case.status, "escalated");
  });
});
