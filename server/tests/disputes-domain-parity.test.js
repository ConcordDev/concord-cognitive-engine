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
  // Fresh shared case substrate + users stub for lookupUserIdentity (INC-77).
  const people = [
    { id: "user_a", username: "acct_a", displayName: "Acct A" },
    { id: "user_b", username: "acct_b", displayName: "Acct B" },
    { id: "user_c", username: "acct_c", displayName: "Acct C" },
  ];
  globalThis._concordSTATE = {
    disputesLens: { casesById: new Map(), seq: 1 },
    db: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("PRAGMA")) {
          return { all() { return [{ name: "id" }, { name: "username" }, { name: "display_name" }]; } };
        }
        return {
          get(param) {
            return people.find((r) => r.id === String(param || "")) || null;
          },
        };
      },
    },
  };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_a", displayName: "Acct A" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", displayName: "Acct B" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c", displayName: "Acct C" }, userId: "user_c" };
const RAW_IDS = ["user_a", "user_b", "user_c"];
function assertNoRawUserIds(value, ids = RAW_IDS) {
  const blob = JSON.stringify(value);
  for (const id of ids) {
    assert.ok(!blob.includes(id), `payload must not contain raw id ${id}: ${blob.slice(0, 200)}`);
  }
}

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
    const c = openCase({ respondentId: "user_b" });
    assert.equal(call("message-post", ctx, {}, { caseId: c.id, body: "Hello" }).ok, true);
    assert.equal(call("message-post", ctxB, {}, { caseId: c.id, body: "Reply" }).ok, true);
    const list = call("message-list", ctx, {}, { caseId: c.id });
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 2);
    assert.equal(list.result.byRole.claimant, 1);
    assert.equal(list.result.byRole.respondent, 1);
  });

  it("message-post rejects an empty body", () => {
    const c = openCase();
    const r = call("message-post", ctx, {}, { caseId: c.id, body: "" });
    assert.equal(r.ok, false);
  });

  it("F2 claimant cannot store a message/offer as respondent", () => {
    const c = openCase({ respondentId: "user_b" });
    const spoofMsg = call("message-post", ctx, {}, { caseId: c.id, body: "spoof", role: "respondent" });
    assert.equal(spoofMsg.ok, true);
    assert.equal(spoofMsg.result.posted.role, "claimant");
    assert.equal(spoofMsg.result.posted.authorIsMe, true);
    const spoofOffer = call("offer-make", ctx, {}, { caseId: c.id, amount: 11, fromRole: "respondent", terms: "nope" });
    assert.equal(spoofOffer.ok, true);
    assert.equal(spoofOffer.result.made.fromRole, "claimant");
    assert.equal(spoofOffer.result.made.fromMe, true);
    const asResp = call("message-post", ctxB, {}, { caseId: c.id, body: "real respondent", role: "claimant" });
    assert.equal(asResp.ok, true);
    assert.equal(asResp.result.posted.role, "respondent");
    assert.equal(asResp.result.posted.authorIsMe, true);
    const detail = call("case-detail", ctx, {}, { caseId: c.id });
    assert.deepEqual(detail.result.messages.map((m) => [m.authorIsMe, m.role]), [
      [true, "claimant"],
      [false, "respondent"],
    ]);
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
    const c = openCase({ respondentId: "user_b" });
    const made = call("offer-make", ctxB, {}, { caseId: c.id, amount: 150, terms: "partial" });
    assert.equal(made.ok, true);
    assert.equal(made.result.made.fromRole, "respondent");
    const offerId = made.result.made.id;
    const resp = call("offer-respond", ctx, {}, { caseId: c.id, offerId, decision: "accept" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.case.status, "resolved");
  });

  it("offer-make supersedes a prior pending offer", () => {
    const c = openCase({ respondentId: "user_b" });
    const first = call("offer-make", ctxB, {}, { caseId: c.id, amount: 100 });
    call("offer-make", ctx, {}, { caseId: c.id, amount: 130 });
    const detail = call("case-detail", ctx, {}, { caseId: c.id });
    const firstOffer = detail.result.offers.find((o) => o.id === first.result.made.id);
    assert.equal(firstOffer.status, "superseded");
  });

  it("offer-respond rejects an unknown decision", () => {
    const c = openCase();
    const made = call("offer-make", ctx, {}, { caseId: c.id, amount: 50 });
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
    const stored = globalThis._concordSTATE.disputesLens.casesById.get(c.id);
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

  it("F6 member resolve records resolvedRole member (not admin)", () => {
    const c = openCase({ respondentId: "user_b" });
    const r = call("case-resolve", ctx, {}, {
      caseId: c.id,
      outcomeType: "replacement",
      rationale: "member clicked resolve",
      role: "admin", // ignored — must derive from caller
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.outcome.resolvedRole, "member");
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

/* ---------------------------------------------------------------- */
/*  F1 — shared store, party access, restart persistence             */
/* ---------------------------------------------------------------- */

describe("disputes F1 shared party access + persistence", () => {
  it("respondent lists and reads the case; status change is identical; third party 404", () => {
    const opened = call("case-open", ctx, {}, {
      title: "Shared case",
      disputeType: "non_delivery",
      disputeAmount: 42,
      description: "Named respondent must see this",
      respondentId: "user_b",
    });
    assert.equal(opened.ok, true);
    const caseId = opened.result.case.id;
    assert.ok(!caseId.includes("user_a"), "case id must not embed claimant uuid");

    const listB = call("case-list", ctxB, {}, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.cases.length, 1);
    assert.equal(listB.result.cases[0].id, caseId);

    const detailB = call("case-detail", ctxB, {}, { caseId });
    assert.equal(detailB.ok, true);
    assert.equal(detailB.result.case.status, "open");
    assert.equal(detailB.result.description, "Named respondent must see this");

    const adv = call("case-advance", ctxB, {}, { caseId });
    assert.equal(adv.ok, true);
    assert.equal(adv.result.case.status, "under_review");

    const detailA = call("case-detail", ctx, {}, { caseId });
    assert.equal(detailA.result.case.status, "under_review");

    const third = call("case-detail", ctxC, {}, { caseId });
    assert.equal(third.ok, false);
    assert.match(String(third.error), /case not found/i);
    const listC = call("case-list", ctxC, {}, {});
    assert.equal(listC.result.cases.length, 0);
  });

  it("RESTART-PERSISTENCE: case + messages + offers survive serialize/hydrate for both parties", async () => {
    const { serializeLensState, hydrateLensState } = await import("../lib/lens-state-persistence.js");
    const opened = call("case-open", ctx, {}, {
      title: "Persist me",
      disputeType: "not_as_described",
      disputeAmount: 7,
      description: "survives restart",
      respondentId: "user_b",
    });
    const caseId = opened.result.case.id;
    assert.equal(call("message-post", ctx, {}, { caseId, body: "from claimant", role: "claimant" }).ok, true);
    assert.equal(call("offer-make", ctx, {}, { caseId, amount: 3, fromRole: "claimant", terms: "partial" }).ok, true);

    const snap = serializeLensState(globalThis._concordSTATE);
    const db = globalThis._concordSTATE.db;
    globalThis._concordSTATE = { db };
    hydrateLensState(globalThis._concordSTATE, snap);

    const detailA = call("case-detail", ctx, {}, { caseId });
    const detailB = call("case-detail", ctxB, {}, { caseId });
    assert.equal(detailA.ok, true);
    assert.equal(detailB.ok, true);
    assert.equal(detailA.result.description, "survives restart");
    assert.equal(detailB.result.description, "survives restart");
    assert.equal(detailA.result.messages.length, 1);
    assert.equal(detailB.result.messages.length, 1);
    assert.equal(detailA.result.messages[0].body, "from claimant");
    assert.equal(detailB.result.offers.length, 1);
    assert.equal(detailB.result.offers[0].amount, 3);
    assert.equal(detailA.result.case.status, detailB.result.case.status);
  });

  it("F5 history + cross-account payloads contain no raw uuid", () => {
    const opened = call("case-open", ctx, {}, {
      title: "Privacy case",
      disputeType: "other",
      respondentId: "user_b",
      description: "opaque",
    });
    const caseId = opened.result.case.id;
    call("message-post", ctx, {}, { caseId, body: "hi" });
    call("case-advance", ctxB, {}, { caseId });
    const detailA = call("case-detail", ctx, {}, { caseId });
    const detailB = call("case-detail", ctxB, {}, { caseId });
    assert.equal(detailA.ok, true);
    assertNoRawUserIds(detailA.result);
    assertNoRawUserIds(detailB.result);
    assert.ok(detailA.result.history.some((h) => h.actor === "Acct A" || h.actor === "Acct B"));
    assert.ok(!detailA.result.history.some((h) => RAW_IDS.includes(h.actor)));
    assert.ok(String(detailA.result.case.claimantId).startsWith("u_"));
    assert.ok(String(caseId).startsWith("dispute_"));
    assert.ok(!caseId.includes("user_a") && !caseId.includes("user_b"));
  });
});
