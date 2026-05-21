// Contract tests for server/domains/vote.js — Polis/Decidim/Snapshot parity.
// Covers the analytic macros (tally/fairness/consensus) plus the persistent
// governance substrate: multi-method polls, lifecycle, delegation, opinion
// clustering, and verifiable audit trail.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVoteActions from "../domains/vote.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`vote.${name}`);
  if (!fn) throw new Error(`vote.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerVoteActions(register); });

// fresh STATE before each test so polls don't bleed across cases
beforeEach(() => {
  globalThis._concordSTATE = { voteLens: {} };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

// ── analytic macros ────────────────────────────────────────────────────────
describe("vote.tallyVotes (multi-method analysis)", () => {
  it("rejects empty input", () => {
    assert.equal(call("tallyVotes", ctxA, { data: {} }, {}).ok, false);
  });
  it("computes plurality + borda + condorcet winners", () => {
    const r = call("tallyVotes", ctxA, {
      data: {
        ballots: [
          { rankings: ["A", "B", "C"] },
          { rankings: ["A", "C", "B"] },
          { rankings: ["B", "C", "A"] },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.plurality.winner, "A");
    assert.ok(r.result.candidates.length === 3);
  });
});

describe("vote.fairnessCheck", () => {
  it("rejects no ballots", () => {
    assert.equal(call("fairnessCheck", ctxA, { data: {} }, {}).ok, false);
  });
  it("detects a majority candidate", () => {
    const r = call("fairnessCheck", ctxA, {
      data: { ballots: [{ rankings: ["X"] }, { rankings: ["X"] }, { rankings: ["Y"] }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.majorityCriterion.majorityCandidate, "X");
  });
});

describe("vote.consensusMeasure", () => {
  it("rejects insufficient data", () => {
    assert.equal(call("consensusMeasure", ctxA, { data: {} }, {}).ok, false);
  });
  it("measures agreement across raters", () => {
    const r = call("consensusMeasure", ctxA, {
      data: {
        ratings: [
          { items: { a: 5, b: 1 } },
          { items: { a: 5, b: 2 } },
          { items: { a: 4, b: 1 } },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.agreementPercent === "number");
  });
});

// ── poll lifecycle ─────────────────────────────────────────────────────────
describe("vote.poll-create / poll-list / poll-close", () => {
  it("rejects polls with fewer than 2 options", () => {
    const r = call("poll-create", ctxA, {}, { title: "T", options: ["only"] });
    assert.equal(r.ok, false);
  });
  it("creates a plurality poll with quorum + threshold rules", () => {
    const r = call("poll-create", ctxA, {}, {
      title: "Adopt budget?", method: "plurality", options: ["Yes", "No"],
      quorum: 2, passThreshold: 0.5, durationDays: 7,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.poll.method, "plurality");
    assert.equal(r.result.poll.status, "open");
    assert.ok(r.result.poll.deadline);
  });
  it("lists polls and closes one (owner only)", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", options: ["A", "B"] });
    const id = c.result.poll.id;
    const list = call("poll-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    // non-owner cannot close
    assert.equal(call("poll-close", ctxB, {}, { pollId: id }).ok, false);
    const closed = call("poll-close", ctxA, {}, { pollId: id });
    assert.equal(closed.ok, true);
    assert.equal(closed.result.poll.status, "closed");
  });
});

// ── ballot casting + voting methods ────────────────────────────────────────
describe("vote.cast-ballot (multiple methods)", () => {
  it("rejects ballots on closed polls", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", options: ["A", "B"] });
    call("poll-close", ctxA, {}, { pollId: c.result.poll.id });
    const r = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, choice: "A" });
    assert.equal(r.ok, false);
  });
  it("casts a plurality ballot and emits a verifiable receipt", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "plurality", options: ["A", "B"] });
    const r = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, choice: "A" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ballot.choice, "A");
    assert.ok(r.result.receipt.hash);
    assert.equal(r.result.receipt.verified, true);
  });
  it("re-casting overwrites the prior ballot", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "plurality", options: ["A", "B"] });
    call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, choice: "A" });
    const r2 = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, choice: "B" });
    assert.equal(r2.result.replaced, true);
  });
  it("casts a ranked ballot and rejects duplicate ranks", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "ranked", options: ["A", "B", "C"] });
    const ok = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, rankings: ["A", "B", "C"] });
    assert.equal(ok.ok, true);
    const dup = call("cast-ballot", ctxC, {}, { pollId: c.result.poll.id, rankings: ["A", "A"] });
    assert.equal(dup.ok, false);
  });
  it("casts an approval ballot", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "approval", options: ["A", "B", "C"] });
    const r = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, approved: ["A", "C"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.ballot.approved.sort(), ["A", "C"]);
  });
  it("casts a score ballot clamped to scoreMax", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "score", options: ["A", "B"], scoreMax: 5 });
    const r = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, scores: { A: 99, B: 3 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.ballot.scores.A, 5);
  });
  it("rejects quadratic ballots over the credit budget", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "quadratic", options: ["A", "B"], creditBudget: 50 });
    const over = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, credits: { A: 60 } });
    assert.equal(over.ok, false);
    const ok = call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, credits: { A: 25, B: 25 } });
    assert.equal(ok.ok, true);
  });
  it("enforces eligibility lists", () => {
    const c = call("poll-create", ctxA, {}, {
      title: "P", options: ["A", "B"], eligibility: "list", eligibleVoters: ["user_b"],
    });
    assert.equal(call("cast-ballot", ctxB, {}, { pollId: c.result.poll.id, choice: "A" }).ok, true);
    assert.equal(call("cast-ballot", ctxC, {}, { pollId: c.result.poll.id, choice: "A" }).ok, false);
  });
});

// ── results: tally + resolution + IRV rounds ───────────────────────────────
describe("vote.poll-results", () => {
  it("resolves a plurality poll against quorum", () => {
    const c = call("poll-create", ctxA, {}, {
      title: "P", method: "plurality", options: ["A", "B"], quorum: 2, passThreshold: 0.5,
    });
    const id = c.result.poll.id;
    call("cast-ballot", ctxB, {}, { pollId: id, choice: "A" });
    const r1 = call("poll-results", ctxA, {}, { pollId: id });
    assert.equal(r1.result.resolution.outcome, "failed"); // quorum not met (1/2)
    call("cast-ballot", ctxC, {}, { pollId: id, choice: "A" });
    const r2 = call("poll-results", ctxA, {}, { pollId: id });
    assert.equal(r2.result.resolution.quorumMet, true);
    assert.equal(r2.result.tally.winner, "A");
    assert.equal(r2.result.resolution.outcome, "passed");
    assert.ok(Array.isArray(r2.result.chartData));
    assert.ok(Array.isArray(r2.result.consensusSeries));
  });
  it("runs instant-runoff rounds for ranked polls", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "ranked", options: ["A", "B", "C"] });
    const id = c.result.poll.id;
    call("cast-ballot", ctxA, {}, { pollId: id, rankings: ["C", "A", "B"] });
    call("cast-ballot", ctxB, {}, { pollId: id, rankings: ["A", "B", "C"] });
    call("cast-ballot", ctxC, {}, { pollId: id, rankings: ["B", "A", "C"] });
    const r = call("poll-results", ctxA, {}, { pollId: id });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.tally.rounds));
    assert.ok(r.result.tally.winner);
  });
});

// ── liquid democracy / delegation ──────────────────────────────────────────
describe("vote.delegate-vote / revoke-delegation / delegation-list", () => {
  it("rejects self-delegation", () => {
    assert.equal(call("delegate-vote", ctxA, {}, { delegateTo: "user_a" }).ok, false);
  });
  it("delegates voting power and folds it into the delegate's ballot", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "plurality", options: ["A", "B"], quorum: 1 });
    const id = c.result.poll.id;
    // user_c delegates to user_b for this poll
    const d = call("delegate-vote", ctxC, {}, { delegateTo: "user_b", pollId: id });
    assert.equal(d.ok, true);
    // only user_b casts a ballot
    call("cast-ballot", ctxB, {}, { pollId: id, choice: "A" });
    const r = call("poll-results", ctxA, {}, { pollId: id });
    assert.equal(r.result.delegatedBallots, 1);
    // user_b's ballot now carries weight 2
    assert.equal(r.result.tally.ranking[0].votes, 2);
  });
  it("prevents direct delegation cycles", () => {
    call("delegate-vote", ctxA, {}, { delegateTo: "user_b" });
    assert.equal(call("delegate-vote", ctxB, {}, { delegateTo: "user_a" }).ok, false);
  });
  it("revokes a delegation and lists incoming/outgoing", () => {
    call("delegate-vote", ctxA, {}, { delegateTo: "user_b" });
    const list = call("delegation-list", ctxB, {}, {});
    assert.equal(list.result.incomingCount, 1);
    const rev = call("revoke-delegation", ctxA, {}, {});
    assert.equal(rev.ok, true);
    assert.equal(call("delegation-list", ctxA, {}, {}).result.outgoingCount, 0);
  });
});

// ── Polis-style opinion clustering ─────────────────────────────────────────
describe("vote.opinion-cluster", () => {
  it("rejects too few voters", () => {
    assert.equal(call("opinion-cluster", ctxA, {}, { comments: ["c1"], votes: [{ voter: "x", opinions: {} }] }).ok, false);
  });
  it("groups voters by agreement and flags divisive comments", () => {
    const r = call("opinion-cluster", ctxA, {}, {
      comments: ["c1", "c2", "c3"],
      votes: [
        { voter: "a", opinions: { c1: 1, c2: 1, c3: -1 } },
        { voter: "b", opinions: { c1: 1, c2: 1, c3: -1 } },
        { voter: "c", opinions: { c1: -1, c2: -1, c3: 1 } },
        { voter: "d", opinions: { c1: -1, c2: -1, c3: 1 } },
      ],
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.numGroups >= 2);
    assert.ok(Array.isArray(r.result.divisiveComments));
  });
});

// ── audit trail / verifiable receipts ──────────────────────────────────────
describe("vote.audit-trail / verify-receipt", () => {
  it("returns a consistent receipt log", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "plurality", options: ["A", "B"] });
    const id = c.result.poll.id;
    call("cast-ballot", ctxB, {}, { pollId: id, choice: "A" });
    call("cast-ballot", ctxC, {}, { pollId: id, choice: "B" });
    const audit = call("audit-trail", ctxA, {}, { pollId: id });
    assert.equal(audit.ok, true);
    assert.equal(audit.result.receiptCount, 2);
    assert.equal(audit.result.integrity, "consistent");
  });
  it("verifies a receipt against its ballot", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", method: "plurality", options: ["A", "B"] });
    const id = c.result.poll.id;
    const cast = call("cast-ballot", ctxB, {}, { pollId: id, choice: "A" });
    const v = call("verify-receipt", ctxA, {}, { pollId: id, receiptId: cast.result.receipt.id });
    assert.equal(v.ok, true);
    assert.equal(v.result.valid, true);
    assert.equal(v.result.hashValid, true);
  });
  it("rejects unknown receipts", () => {
    const c = call("poll-create", ctxA, {}, { title: "P", options: ["A", "B"] });
    assert.equal(call("verify-receipt", ctxA, {}, { pollId: c.result.poll.id, receiptId: "nope" }).ok, false);
  });
});
